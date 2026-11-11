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
 * gost primitive. GOST R 34.11-94 as described in RFC 5831 (section numbers below are that RFC's):
 * a 256-bit hash built on the GOST 28147-89 block cipher in ECB mode, with a key-generation
 * step, a shift-register mixing step, and a checksum and length block at the end. The cipher's
 * substitution box is a parameter; two are provided: the RFC 5831 section 7.1 test set and the
 * CryptoPro set (id-GostR3411-94-CryptoProParamSet, RFC 4357 section 11.2). All 256-bit quantities
 * are little-endian byte strings (byte 0 is the least significant), as RFC 5831 section 3
 * numbers them. The initial hash value is zero. The word `gost:digest` (vocab/gost.fth) holds the
 * metadata.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { fromHex } from "../hash-util.js";
import { rangeFailure } from "../prim-util.js";

/**
 * S-boxes as RFC 4357 section 11.2 lists them: 64 bytes, four per index i = 0..15, byte 4i+p
 * holding the nibbles K(2p+1)[i] (high) and K(2p+2)[i] (low).
 */
export const SBOXES: Readonly<Record<string, string>> = {
  // id-GostR3411-94-TestParamSet; the same table as RFC 5831 section 7.1.
  test:
    "4e5764d1ab8dcbbf941a7a4d2cd11010d6a057358d38f2f70f49d15aea2f8d9462ee4309b3f4a6a218c698e3c17ce57e" +
    "706b0966f7023c8b5595bf2839b32ecc",
  // id-GostR3411-94-CryptoProParamSet.
  cryptopro:
    "a57477d14ffa66e354c7424a60ecb41982909d751d4fc90b3b122f547908a0afd13e1a38c7b181c6e656058703" +
    "25ebfe9c6df86d2eabde20ba893c92f8d353bc",
};

/** Four 256-entry tables: the S-box applied to byte p of x, then rotated left by 11. */
function makeTables(sbox: string): Uint32Array[] {
  const b = fromHex(sbox);
  // k[j][i]: nibble j (0 = K1) at index i.
  const k = (j: number, i: number) => {
    const byte = b[4 * i + (j >> 1)]!;
    return j & 1 ? byte & 15 : byte >> 4;
  };
  const tables: Uint32Array[] = [];
  for (let p = 0; p < 4; p++) {
    const t = new Uint32Array(256);
    for (let x = 0; x < 256; x++) {
      const v = ((k(2 * p + 1, x >> 4) << 4) | k(2 * p, x & 15)) << (8 * p);
      t[x] = ((v << 11) | (v >>> 21)) >>> 0;
    }
    tables.push(t);
  }
  return tables;
}

const cache = new Map<string, Uint32Array[]>();

/** The 8 key words order of GOST 28147-89: k1..k8 three times, then k8..k1. */
const KEY_ORDER = [...Array(24).keys()].map((i) => i % 8).concat([7, 6, 5, 4, 3, 2, 1, 0]);

/** GOST 28147-89 encryption of one 64-bit block (section 5.2, ECB); writes 8 bytes to `out`. */
function encrypt(
  t: Uint32Array[],
  key: Uint32Array,
  src: Uint8Array,
  so: number,
  out: Uint8Array,
  oo: number,
): void {
  let n1 = (src[so]! | (src[so + 1]! << 8) | (src[so + 2]! << 16) | (src[so + 3]! << 24)) >>> 0;
  let n2 = (src[so + 4]! | (src[so + 5]! << 8) | (src[so + 6]! << 16) | (src[so + 7]! << 24)) >>> 0;
  for (let r = 0; r < 32; r++) {
    const s = (n1 + key[KEY_ORDER[r]!]!) >>> 0;
    const f =
      (t[0]![s & 255]! ^ t[1]![(s >>> 8) & 255]! ^ t[2]![(s >>> 16) & 255]! ^ t[3]![s >>> 24]!) >>>
      0;
    const nn = (f ^ n2) >>> 0;
    if (r < 31) {
      n2 = n1;
      n1 = nn;
    } else {
      n2 = nn;
    }
  }
  for (let i = 0; i < 4; i++) {
    out[oo + i] = (n1 >>> (8 * i)) & 255;
    out[oo + 4 + i] = (n2 >>> (8 * i)) & 255;
  }
}

/** psi (section 5.3) on 16 sixteen-bit pieces eta1..eta16 (index 0 is eta1), `times` times. */
function psi(x: Uint8Array, times: number): void {
  const e = new Uint16Array(16);
  for (let i = 0; i < 16; i++) e[i] = x[2 * i]! | (x[2 * i + 1]! << 8);
  for (let n = 0; n < times; n++) {
    const top = e[0]! ^ e[1]! ^ e[2]! ^ e[3]! ^ e[12]! ^ e[15]!;
    e.copyWithin(0, 1);
    e[15] = top;
  }
  for (let i = 0; i < 16; i++) {
    x[2 * i] = e[i]! & 255;
    x[2 * i + 1] = e[i]! >> 8;
  }
}

/** Step 2 of section 5.1, A(X): (x1 xor x2) || x4 || x3 || x2. */
function transformA(x: Uint8Array): Uint8Array {
  const r = new Uint8Array(32);
  r.set(x.subarray(8, 32), 0);
  for (let i = 0; i < 8; i++) r[24 + i] = x[i]! ^ x[8 + i]!;
  return r;
}

/** Section 5.1, P: output byte i + 4m is input byte 8i + m (i = 0..3, m = 0..7). */
function transformP(w: Uint8Array): Uint8Array {
  const r = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let m = 0; m < 8; m++) r[i + 4 * m] = w[8 * i + m]!;
  return r;
}

/** Section 5.1: C[3] = 1^8||0^8||1^16||0^24||1^16||0^8||(0^8||1^8)^2||1^8||0^8||(0^8||1^8)^4||(1^8||0^8)^4 (MSB first). */
const C3 = Uint8Array.from(
  [
    [0xff, 0x00],
    [0xff, 0xff],
    [0x00, 0x00, 0x00],
    [0xff, 0xff],
    [0x00],
    [0x00, 0xff, 0x00, 0xff],
    [0xff, 0x00],
    [0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff],
    [0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00],
  ]
    .flat()
    .reverse(),
);

/** chi(M, H) of section 5: the step-by-step hash function; returns the new H. */
function chi(t: Uint32Array[], h: Uint8Array, m: Uint8Array): Uint8Array {
  // 5.1 Key generation.
  const keys: Uint32Array[] = [];
  let u: Uint8Array = h;
  let v: Uint8Array = m;
  for (let i = 1; i <= 4; i++) {
    if (i > 1) {
      u = transformA(u);
      if (i === 3) u = u.map((b, j) => b ^ C3[j]!);
      v = transformA(transformA(v));
    }
    const w = transformP(u.map((b, j) => b ^ v[j]!));
    // The key words k1..k8 are the 32-bit pieces of the key, k1 the least significant.
    keys.push(
      Uint32Array.from(
        { length: 8 },
        (_, j) =>
          (w[4 * j]! | (w[4 * j + 1]! << 8) | (w[4 * j + 2]! << 16) | (w[4 * j + 3]! << 24)) >>> 0,
      ),
    );
  }
  // 5.2 Encryption of the four 64-bit pieces of H, each under its own key.
  const s = new Uint8Array(32);
  for (let i = 0; i < 4; i++) encrypt(t, keys[i]!, h, 8 * i, s, 8 * i);
  // 5.3 Mixing: chi = psi^61(H xor psi(M xor psi^12(S))).
  psi(s, 12);
  const a = s.map((b, j) => b ^ m[j]!);
  psi(a, 1);
  const c = a.map((b, j) => b ^ h[j]!);
  psi(c, 61);
  return c;
}

/** Adds the 256-bit little-endian number `b` to `a` modulo 2^256, in place. */
function addMod(a: Uint8Array, b: Uint8Array): void {
  let carry = 0;
  for (let i = 0; i < 32; i++) {
    const s = a[i]! + b[i]! + carry;
    a[i] = s & 255;
    carry = s >> 8;
  }
}

/** The GOST R 34.11-94 digest (32 bytes) of `data` for an S-box name ("test" or "cryptopro"). */
export function hash(data: Uint8Array, sbox: string): Uint8Array {
  if (!Object.hasOwn(SBOXES, sbox)) {
    throw rangeFailure(`unknown GOST S-box '${sbox.slice(0, 20)}'`);
  }
  let t = cache.get(sbox);
  if (t === undefined) {
    t = makeTables(SBOXES[sbox]!);
    cache.set(sbox, t);
  }
  // Section 6: the iterative procedure.
  let h: Uint8Array = new Uint8Array(32);
  const sigma = new Uint8Array(32);
  const len = new Uint8Array(32);
  let pos = 0;
  const addLen = (bits: number) => {
    const b = new Uint8Array(32);
    let x = bits;
    for (let i = 0; i < 8; i++) {
      b[i] = x % 256;
      x = Math.floor(x / 256);
    }
    addMod(len, b);
  };
  // Step 3: while more than 256 bits remain, process a full block taken from the low end.
  while (data.length - pos > 32) {
    const block = data.subarray(pos, pos + 32);
    h = chi(t, h, block);
    addLen(256);
    addMod(sigma, block);
    pos += 32;
  }
  // Step 2: the last block (0 to 256 bits), zero-padded at the high end, then L and SIGMA.
  const rest = new Uint8Array(32);
  rest.set(data.subarray(pos));
  addLen((data.length - pos) * 8);
  addMod(sigma, rest);
  // The empty message has no data block: the widely published digests of "" (and the other
  // implementations of this hash) go straight to the length and checksum blocks, which are zero.
  if (data.length > 0) h = chi(t, h, rest);
  h = chi(t, h, len);
  h = chi(t, h, sigma);
  return h;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("gost", "_hash", "( data:bytes sbox:str -- bytes )", hash, {
    doc: "The GOST R 34.11-94 digest of the bytes for an S-box name, test or cryptopro (private helper of gost:digest).",
    category: "Hashing",
  }),
];
