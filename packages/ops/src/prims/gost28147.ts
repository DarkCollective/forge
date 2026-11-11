/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * gost28147 primitives. The GOST 28147-89 block cipher as RFC 5830 describes it (64-bit block as the 32-bit
 * registers N1, N2; 256-bit key as eight words K1..K8; 32 rounds in the order K1..K8 three times, then K8..K1;
 * the round adds the key word modulo 2^32, substitutes eight 4-bit nibbles, rotates left by 11 and XORs the
 * other half). Words and blocks are little-endian (RFC 5830 numbers bit 1 as the least significant of N1, so
 * byte 0 of a block is the low byte of N1). Also here, from RFC 4357 and RFC 5830:
 *
 *  - the S-box sets: E-TEST, E-A, E-B, E-C, E-D (RFC 4357 section 11.1, id-Gost28147-89-TestParamSet and
 *    CryptoPro-A..D), D-TEST and D-A (the RFC 4357 section 11.2 digest sets, shared with gost.ts by import) and
 *    E-Z (the id-tc26-gost-28147-param-Z set, which is the pi' of Magma in RFC 8891 section 4.1). A table is
 *    64 bytes, four per row i = 0..15, byte 4i+p holding K(2p+1)[i] in the high nibble and K(2p+2)[i] in the
 *    low one (RFC 4357 section 11.1); K(j+1) substitutes nibble j (j = 0 the lowest);
 *  - `_crypt-ext`: the modes that the shared `blockmode` layer cannot do: CryptoPro key meshing (RFC 4357
 *    section 2.3.2) in CBC, CFB and OFB, and the GOST counter ("gamma") mode of RFC 5830 section 6.2, with or
 *    without meshing;
 *  - IMIT, the 4-byte MAC of RFC 5830 section 8 (16 rounds per block, zero-padded last block, the initial
 *    register an IV);
 *  - key wrap and unwrap: RFC 4357 section 6.1/6.2 (the plain one, "NO") and section 6.3/6.4 (CryptoPro, "CP",
 *    with the KEK diversification of section 6.5).
 * The words of vocab/gost28147.fth hold the metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { fromHex } from "../hash-util.js";
import { checkBlock, KeyCache, le32, putLe32 } from "../cipher-util-b.js";
import { coerceFailure, rangeFailure } from "../prim-util.js";
import { SBOXES as DIGEST_SBOXES } from "./gost.js";

/** RFC 4357 section 11.1: the 64-byte cipher S-boxes. */
const CIPHER_SBOXES: Readonly<Record<string, string>> = {
  "E-TEST":
    "4cde389c2989efb6ffeb56c55ec29b029875613b113f896003970c798aa1d55de210ad43375db38eb42c77e7cd46cafad66a201f70f41ea4ab03f22165b844d8",
  "E-A":
    "93eeb31b67475ada3e6a1d2f292c9c9588bd8170ba31d2ac1fd3f06e70890b08a5c0e78642f245c2e65b2943fca43459cb0fc8f104787f37dd15aebd519666e4",
  "E-B":
    "80e7285041c57324b200c2ab1aadf6be349b94985d265d1305d1aec79cb2bb3129731c7ae75a4142a38c07d9cfffdf06db346a6f686e80fd7619e985fe4835ec",
  "E-C":
    "10838ca7b126d994c750bb602d0101859b4548dad49d5ee205fa122ff2a8240e483b97fc5e7233368fc9c651ecd7e5bba96e6a4d7aeff019661cafc333b47d78",
  "E-D":
    "fb110831c6c5c00a23be8f66a40c93f86cfad21f4fe725eb5e60ae90025dbb2477a671dc9dd23a83e84b64c5d084574915994cb7ba33e9ad897ffd523128167e",
};

/** RFC 8891 section 4.1, pi'_0..pi'_7: the id-tc26-gost-28147-param-Z set, one array per nibble position. */
const PI_Z: readonly (readonly number[])[] = [
  [12, 4, 6, 2, 10, 5, 11, 9, 14, 8, 13, 7, 0, 3, 15, 1],
  [6, 8, 2, 3, 9, 10, 5, 12, 1, 14, 4, 7, 11, 13, 0, 15],
  [11, 3, 5, 8, 2, 15, 10, 13, 14, 1, 7, 4, 12, 9, 6, 0],
  [12, 8, 2, 1, 13, 4, 15, 6, 7, 0, 10, 5, 3, 14, 9, 11],
  [7, 15, 5, 10, 8, 1, 6, 13, 0, 9, 3, 14, 11, 4, 2, 12],
  [5, 13, 15, 6, 9, 2, 12, 10, 11, 7, 8, 1, 4, 3, 14, 0],
  [8, 14, 2, 5, 6, 9, 1, 12, 15, 4, 11, 0, 13, 10, 3, 7],
  [1, 7, 14, 13, 0, 5, 8, 3, 4, 15, 10, 6, 9, 12, 11, 2],
];

/** The S-box as nibble substitutions: sub[16 * j + v] for nibble position j (0 = lowest) and value v. */
function substitutions(name: string): Uint8Array {
  const sub = new Uint8Array(128);
  if (name === "E-Z") {
    for (let j = 0; j < 8; j++) for (let v = 0; v < 16; v++) sub[16 * j + v] = PI_Z[j]![v]!;
    return sub;
  }
  const hex =
    name === "D-TEST"
      ? DIGEST_SBOXES.test
      : name === "D-A"
        ? DIGEST_SBOXES.cryptopro
        : Object.hasOwn(CIPHER_SBOXES, name)
          ? CIPHER_SBOXES[name]
          : undefined;
  if (hex === undefined) throw rangeFailure(`unknown GOST S-box '${name.slice(0, 20)}'`);
  const b = fromHex(hex);
  for (let j = 0; j < 8; j++)
    for (let v = 0; v < 16; v++) {
      const byte = b[4 * v + (j >> 1)]!;
      sub[16 * j + v] = j & 1 ? byte & 15 : byte >> 4;
    }
  return sub;
}

/** Four 256-entry tables: the substitution of byte p of the sum, already rotated left by 11. */
function makeTables(name: string): Uint32Array[] {
  const sub = substitutions(name);
  const tables: Uint32Array[] = [];
  for (let p = 0; p < 4; p++) {
    const t = new Uint32Array(256);
    for (let x = 0; x < 256; x++) {
      const v = ((sub[16 * (2 * p + 1) + (x >> 4)]! << 4) | sub[16 * 2 * p + (x & 15)]!) << (8 * p);
      t[x] = ((v << 11) | (v >>> 21)) >>> 0;
    }
    tables.push(t);
  }
  return tables;
}

const tableCache = new Map<string, Uint32Array[]>();

function tablesFor(name: string): Uint32Array[] {
  let t = tableCache.get(name);
  if (t === undefined) {
    t = makeTables(name);
    tableCache.set(name, t);
  }
  return t;
}

const ENC_ORDER = [...Array(24).keys()].map((i) => i % 8).concat([7, 6, 5, 4, 3, 2, 1, 0]);
const DEC_ORDER = [0, 1, 2, 3, 4, 5, 6, 7].concat([...Array(24).keys()].map((i) => 7 - (i % 8)));
const MAC_ORDER = ENC_ORDER.slice(0, 16);

function keyWords(key: Uint8Array): Uint32Array {
  if (key.length !== 32)
    throw rangeFailure(`the GOST 28147-89 key must be 32 bytes, not ${key.length}`, {
      length: key.length,
    });
  const k = new Uint32Array(8);
  for (let i = 0; i < 8; i++) k[i] = le32(key, 4 * i);
  return k;
}

/** The cipher under one key and S-box. */
class Gost {
  readonly t: Uint32Array[];
  readonly k: Uint32Array;
  constructor(key: Uint8Array, sbox: string) {
    this.k = keyWords(key);
    this.t = tablesFor(sbox);
  }

  private f(x: number): number {
    const t = this.t;
    return (
      (t[0]![x & 255]! | t[1]![(x >>> 8) & 255]! | t[2]![(x >>> 16) & 255]! | t[3]![x >>> 24]!) >>>
      0
    );
  }

  /** The registers (n1, n2) after the rounds in `order` (each with the swap), without the swap of the last. */
  private rounds(
    n1: number,
    n2: number,
    order: readonly number[],
    swapLast: boolean,
  ): [number, number] {
    const last = order.length - 1;
    for (let r = 0; r <= last; r++) {
      const nf = (this.f((n1 + this.k[order[r]!]!) >>> 0) ^ n2) >>> 0;
      if (r === last && !swapLast) n2 = nf;
      else {
        n2 = n1;
        n1 = nf;
      }
    }
    return [n1, n2];
  }

  /** Encrypts or decrypts the 8 bytes at `o` of `buf` in place. */
  block(buf: Uint8Array, o: number, decrypt: boolean): void {
    const [a, b] = this.rounds(
      le32(buf, o),
      le32(buf, o + 4),
      decrypt ? DEC_ORDER : ENC_ORDER,
      false,
    );
    putLe32(buf, o, a);
    putLe32(buf, o + 4, b);
  }

  /** The 4-byte IMIT of RFC 5830 section 8 over `data` (zero-padded to blocks) from the register `iv`. */
  imit(data: Uint8Array, iv: Uint8Array): Uint8Array {
    let n1 = le32(iv, 0);
    let n2 = le32(iv, 4);
    const blocks = Math.ceil(data.length / 8);
    const padded = new Uint8Array(blocks * 8);
    padded.set(data);
    for (let i = 0; i < blocks; i++) {
      n1 = (n1 ^ le32(padded, 8 * i)) >>> 0;
      n2 = (n2 ^ le32(padded, 8 * i + 4)) >>> 0;
      [n1, n2] = this.rounds(n1, n2, MAC_ORDER, true);
    }
    const out = new Uint8Array(4);
    putLe32(out, 0, n1);
    return out;
  }
}

const cache = new KeyCache<Gost>();

function cipher(key: Uint8Array, sbox: string): Gost {
  return cache.get(key, sbox, () => new Gost(key, sbox));
}

/** One 8-byte block encrypted. */
export function encryptBlock(block: Uint8Array, key: Uint8Array, sbox: string): Uint8Array {
  const g = cipher(key, sbox);
  checkBlock(block, 8, "GOST 28147-89");
  const out = Uint8Array.from(block);
  g.block(out, 0, false);
  return out;
}

/** One 8-byte block decrypted. */
export function decryptBlock(block: Uint8Array, key: Uint8Array, sbox: string): Uint8Array {
  const g = cipher(key, sbox);
  checkBlock(block, 8, "GOST 28147-89");
  const out = Uint8Array.from(block);
  g.block(out, 0, true);
  return out;
}

/** RFC 4357 section 2.3.2: the constant C of the CryptoPro key meshing. */
const MESH_C = Uint8Array.from([
  0x69, 0x00, 0x72, 0x22, 0x64, 0xc9, 0x04, 0x23, 0x8d, 0x3a, 0xdb, 0x96, 0x46, 0xe9, 0x2a, 0xc4,
  0x18, 0xfe, 0xac, 0x94, 0x00, 0xed, 0x07, 0x12, 0xc0, 0x86, 0xdc, 0xc2, 0xef, 0x4c, 0xa9, 0x2b,
]);

function ecb(g: Gost, data: Uint8Array, decrypt: boolean): Uint8Array {
  const out = Uint8Array.from(data);
  for (let o = 0; o + 8 <= out.length; o += 8) g.block(out, o, decrypt);
  return out;
}

/** The counter of RFC 5830 section 6.2: N3 += C2 mod 2^32 and N4 += C1 mod 2^32-1 (end-around carry). */
function bumpCounter(s: Uint8Array): void {
  const n3 = (le32(s, 0) + 0x01010101) >>> 0;
  let n4 = le32(s, 4) + 0x01010104;
  if (n4 >= 4294967296) n4 -= 4294967295;
  putLe32(s, 0, n3);
  putLe32(s, 4, n4 >>> 0);
}

/**
 * ECB, CBC, CFB, OFB (64-bit feedback) or CTR (the GOST gamma mode) over whole data, with optional CryptoPro
 * key meshing after every 1024 bytes (ECB has no feedback register and no meshing). The input to ECB and CBC
 * must be whole blocks (E_COERCE); padding is the caller's.
 */
export function cryptExt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  mode: string,
  sbox: string,
  mesh: boolean,
  decrypt: boolean,
): Uint8Array {
  let g = cipher(key, sbox);
  if (mode !== "ECB" && iv.length !== 8)
    throw rangeFailure(`the IV must be 8 bytes, not ${iv.length}`, { length: iv.length });
  if ((mode === "ECB" || mode === "CBC") && data.length % 8 !== 0)
    throw coerceFailure("bytes", "bytes", "the input is not a whole number of 8-byte blocks");
  if (mode === "ECB") return ecb(g, data, decrypt);
  const out = new Uint8Array(data.length);
  let s: Uint8Array = Uint8Array.from(iv);
  if (mode === "CTR") {
    g.block(s, 0, false);
  }
  const full = Math.floor(data.length / 8);
  const ks = new Uint8Array(8);
  for (let i = 0; i < full; i++) {
    const o = 8 * i;
    const inBlock = data.subarray(o, o + 8);
    const outBlock = out.subarray(o, o + 8);
    if (mode === "CBC") {
      if (decrypt) {
        outBlock.set(inBlock);
        g.block(out, o, true);
        for (let j = 0; j < 8; j++) outBlock[j]! ^= s[j]!;
        s = Uint8Array.from(inBlock);
      } else {
        for (let j = 0; j < 8; j++) outBlock[j] = inBlock[j]! ^ s[j]!;
        g.block(out, o, false);
        s = Uint8Array.from(outBlock);
      }
    } else if (mode === "CFB") {
      ks.set(s);
      g.block(ks, 0, false);
      for (let j = 0; j < 8; j++) outBlock[j] = inBlock[j]! ^ ks[j]!;
      s = Uint8Array.from(decrypt ? inBlock : outBlock);
    } else if (mode === "OFB") {
      g.block(s, 0, false);
      for (let j = 0; j < 8; j++) outBlock[j] = inBlock[j]! ^ s[j]!;
    } else {
      bumpCounter(s);
      ks.set(s);
      g.block(ks, 0, false);
      for (let j = 0; j < 8; j++) outBlock[j] = inBlock[j]! ^ ks[j]!;
    }
    if (mesh && ((i + 1) * 8) % 1024 === 0) {
      const next = ecb(g, MESH_C, true);
      g = cipher(next, sbox);
      s = ecb(g, s, false);
    }
  }
  const rest = data.length - 8 * full;
  if (rest > 0) {
    const o = 8 * full;
    if (mode === "CTR") {
      bumpCounter(s);
      ks.set(s);
    } else {
      ks.set(s);
    }
    g.block(ks, 0, false);
    for (let j = 0; j < rest; j++) out[o + j] = data[o + j]! ^ ks[j]!;
  }
  return out;
}

/** RFC 4357 section 6.5: the CryptoPro KEK diversification of `kek` by the 8-byte `ukm`. */
function diversify(kek: Uint8Array, ukm: Uint8Array, sbox: string): Uint8Array {
  let k: Uint8Array = Uint8Array.from(kek);
  for (let i = 0; i < 8; i++) {
    let s0 = 0;
    let s1 = 0;
    for (let j = 0; j < 8; j++) {
      const w = le32(k, 4 * j);
      if ((ukm[i]! >> j) & 1) s0 = (s0 + w) >>> 0;
      else s1 = (s1 + w) >>> 0;
    }
    const iv = new Uint8Array(8);
    putLe32(iv, 0, s0);
    putLe32(iv, 4, s1);
    k = cryptExt(k, k, iv, "CFB", sbox, false, false);
  }
  return k;
}

function checkWrapArgs(kek: Uint8Array, ukm: Uint8Array, mode: string): void {
  keyWords(kek);
  if (ukm.length !== 8)
    throw rangeFailure(`the user key material must be 8 bytes, not ${ukm.length}`, {
      length: ukm.length,
    });
  if (mode !== "NO" && mode !== "CP")
    throw rangeFailure(`unknown key wrapping '${mode.slice(0, 20)}' (use NO or CP)`);
}

/** RFC 4357 section 6.1 (NO) or 6.3 (CP) without the UKM prefix: CEK_ENC (32 bytes) then CEK_MAC (4 bytes). */
export function wrap(
  cek: Uint8Array,
  kek: Uint8Array,
  ukm: Uint8Array,
  sbox: string,
  mode: string,
): Uint8Array {
  checkWrapArgs(kek, ukm, mode);
  if (cek.length !== 32)
    throw coerceFailure("bytes", "bytes", `the key to wrap must be 32 bytes, not ${cek.length}`);
  const dek = mode === "CP" ? diversify(kek, ukm, sbox) : kek;
  const g = cipher(dek, sbox);
  const out = new Uint8Array(36);
  out.set(ecb(g, cek, false));
  out.set(g.imit(cek, ukm), 32);
  return out;
}

/** RFC 4357 section 6.2 (NO) or 6.4 (CP) without the UKM prefix; E_COERCE for a wrong length or a MAC that fails. */
export function unwrap(
  data: Uint8Array,
  kek: Uint8Array,
  ukm: Uint8Array,
  sbox: string,
  mode: string,
): Uint8Array {
  checkWrapArgs(kek, ukm, mode);
  if (data.length !== 36)
    throw coerceFailure("bytes", "bytes", `a wrapped key is 36 bytes, not ${data.length}`);
  const dek = mode === "CP" ? diversify(kek, ukm, sbox) : kek;
  const g = cipher(dek, sbox);
  const cek = ecb(g, data.subarray(0, 32), true);
  const mac = g.imit(cek, ukm);
  let diff = 0;
  for (let i = 0; i < 4; i++) diff |= mac[i]! ^ data[32 + i]!;
  if (diff !== 0)
    throw coerceFailure("bytes", "bytes", "the key MAC check failed: wrong key, UKM or S-box");
  return cek;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "gost28147",
    "_encrypt-block",
    "( block:bytes key:bytes sbox:str -- bytes )",
    encryptBlock,
    {
      doc: "Encrypt one 8-byte block with GOST 28147-89 (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "gost28147",
    "_decrypt-block",
    "( block:bytes key:bytes sbox:str -- bytes )",
    decryptBlock,
    {
      doc: "Decrypt one 8-byte block with GOST 28147-89 (private block function for the blockmode layer).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "gost28147",
    "_check-key",
    "( key:bytes sbox:str -- )",
    (key: Uint8Array, sbox: string) => void cipher(key, sbox),
    {
      doc: "Raise E_RANGE unless the key is 32 bytes and the S-box name is known (private helper).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "gost28147",
    "_crypt-ext",
    "( data:bytes key:bytes iv:bytes mode:str sbox:str mesh:bool decrypt:bool -- bytes )",
    cryptExt,
    {
      doc: "GOST 28147-89 in a mode with CryptoPro key meshing or the GOST counter mode (private helper).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "gost28147",
    "_wrap",
    "( cek:bytes kek:bytes ukm:bytes sbox:str mode:str -- bytes )",
    wrap,
    {
      doc: "RFC 4357 GOST 28147-89 key wrap, CEK_ENC and CEK_MAC (private helper of gost28147:wrap-key).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "gost28147",
    "_unwrap",
    "( data:bytes kek:bytes ukm:bytes sbox:str mode:str -- bytes )",
    unwrap,
    {
      doc: "RFC 4357 GOST 28147-89 key unwrap with the MAC check (private helper of gost28147:unwrap-key).",
      category: "Encryption",
    },
  ),
];
