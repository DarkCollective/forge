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
 * ascon primitives: the Ascon permutation (five 64-bit words, 12 or 8 rounds) and the three modes
 * CyberChef offers, in the byte order of NIST SP 800-232 (little-endian words):
 *
 *  - `_hash`: Ascon-Hash256 (SP 800-232 section 5): 32-byte digest, 8-byte rate, p12 throughout;
 *  - `_mac`: Ascon-Mac (the Ascon-PRF construction of Dobraunig, Eichlseder, Mendel and Schlaeffer,
 *    "Ascon PRF, MAC, and short-input MAC", with the v1.3 constants of the ascon-c reference
 *    implementation): 16-byte key, 32-byte absorption rate, 16-byte tag;
 *  - `_aead`: Ascon-AEAD128 (SP 800-232 section 4): 16-byte key, nonce and tag, 16-byte rate, p12 for
 *    initialisation and finalisation, p8 between blocks. Encryption appends the tag to the ciphertext;
 *    decryption verifies it in constant time before returning the plaintext (E_COERCE on failure).
 *
 * Ascon-Mac is not part of SP 800-232 (which standardises Ascon-Hash256, Ascon-XOF128, Ascon-CXOF128 and
 * Ascon-AEAD128); it is the PRF-based MAC of the Ascon designers' reference code, which CyberChef labels
 * with the standard. Words are BigInt, which is fast enough for the sizes of a recipe (a 64 KiB hash
 * is under a second); a bad key or nonce length is E_RANGE.
 *
 * The permutation, its round constants (0xf0, 0xe1, ..., 0x4b), the S-box in bitsliced form and the
 * rotation distances (19/28, 61/39, 1/6, 10/17, 7/41) are those of the Ascon specification.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

const M64 = (1n << 64n) - 1n;

/** IV words (little-endian values, as in SP 800-232 and the v1.3 reference code). */
const HASH_IV = 0x0000080100cc0002n;
const MAC_IV = 0x0010200080cc0005n;
const AEAD_IV = 0x00001000808c0001n;

const ror = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & M64;

type State = bigint[];

/** The last `rounds` of the twelve rounds of the Ascon permutation, in place. */
function permute(s: State, rounds: 8 | 12): void {
  let [x0, x1, x2, x3, x4] = s as [bigint, bigint, bigint, bigint, bigint];
  for (let i = 12 - rounds; i < 12; i++) {
    // Constant addition.
    x2 ^= BigInt(((15 - i) << 4) | i);
    // Substitution layer (the 5-bit S-box, bitsliced).
    x0 ^= x4;
    x4 ^= x3;
    x2 ^= x1;
    const t0 = ~x0 & M64 & x1;
    const t1 = ~x1 & M64 & x2;
    const t2 = ~x2 & M64 & x3;
    const t3 = ~x3 & M64 & x4;
    const t4 = ~x4 & M64 & x0;
    x0 ^= t1;
    x1 ^= t2;
    x2 ^= t3;
    x3 ^= t4;
    x4 ^= t0;
    x1 ^= x0;
    x0 ^= x4;
    x3 ^= x2;
    x2 = ~x2 & M64;
    // Linear diffusion layer.
    x0 ^= ror(x0, 19n) ^ ror(x0, 28n);
    x1 ^= ror(x1, 61n) ^ ror(x1, 39n);
    x2 ^= ror(x2, 1n) ^ ror(x2, 6n);
    x3 ^= ror(x3, 10n) ^ ror(x3, 17n);
    x4 ^= ror(x4, 7n) ^ ror(x4, 41n);
  }
  s[0] = x0;
  s[1] = x1;
  s[2] = x2;
  s[3] = x3;
  s[4] = x4;
}

/** The little-endian 64-bit word at `off`; bytes past the end of `b` read as zero. */
function load(b: Uint8Array, off: number): bigint {
  let w = 0n;
  for (let i = 7; i >= 0; i--) w = (w << 8n) | BigInt(b[off + i] ?? 0);
  return w;
}

/** Writes the first `n` bytes of the little-endian word `w` at `off`. */
function store(w: bigint, out: Uint8Array, off: number, n: number): void {
  for (let i = 0; i < n; i++) out[off + i] = Number((w >> BigInt(8 * i)) & 0xffn);
}

/** `data[from..]` (less than `rate` bytes) followed by 0x01 and zero bytes, `rate` bytes long. */
function padBlock(data: Uint8Array, from: number, rate: number): Uint8Array {
  const block = new Uint8Array(rate);
  block.set(data.subarray(from));
  block[data.length - from] = 0x01;
  return block;
}

/** Ascon-Hash256 of `data`: 32 bytes. */
export function hash(data: Uint8Array): Uint8Array {
  const s: State = [HASH_IV, 0n, 0n, 0n, 0n];
  permute(s, 12);
  let pos = 0;
  for (; data.length - pos >= 8; pos += 8) {
    s[0] = s[0]! ^ load(data, pos);
    permute(s, 12);
  }
  s[0] = s[0]! ^ load(padBlock(data, pos, 8), 0);
  permute(s, 12);
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    store(s[0]!, out, 8 * i, 8);
    if (i < 3) permute(s, 12);
  }
  return out;
}

function checkLength(what: string, b: Uint8Array): void {
  if (b.length !== 16)
    throw rangeFailure(`the Ascon ${what} must be 16 bytes, not ${b.length}`, { length: b.length });
}

/** Ascon-Mac of `data` under a 16-byte key: a 16-byte tag. */
export function mac(data: Uint8Array, key: Uint8Array): Uint8Array {
  checkLength("key", key);
  const s: State = [MAC_IV, load(key, 0), load(key, 8), 0n, 0n];
  permute(s, 12);
  let pos = 0;
  for (; data.length - pos >= 32; pos += 32) {
    for (let i = 0; i < 4; i++) s[i] = s[i]! ^ load(data, pos + 8 * i);
    permute(s, 12);
  }
  const last = padBlock(data, pos, 32);
  for (let i = 0; i < 4; i++) s[i] = s[i]! ^ load(last, 8 * i);
  s[4] = s[4]! ^ (1n << 63n);
  permute(s, 12);
  const out = new Uint8Array(16);
  store(s[0]!, out, 0, 8);
  store(s[1]!, out, 8, 8);
  return out;
}

/** Ascon-AEAD128: encrypt (ciphertext then 16-byte tag) or decrypt (E_COERCE when the tag fails). */
export function aead(
  data: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  ad: Uint8Array,
  decrypt: boolean,
): Uint8Array {
  checkLength("key", key);
  checkLength("nonce", nonce);
  let input = data;
  let tagIn: Uint8Array | undefined;
  if (decrypt) {
    if (data.length < 16)
      throw coerceFailure("bytes", "bytes", "the input is shorter than the 16-byte Ascon tag");
    input = data.subarray(0, data.length - 16);
    tagIn = data.subarray(data.length - 16);
  }
  const k0 = load(key, 0);
  const k1 = load(key, 8);
  const s: State = [AEAD_IV, k0, k1, load(nonce, 0), load(nonce, 8)];
  permute(s, 12);
  s[3] = s[3]! ^ k0;
  s[4] = s[4]! ^ k1;
  // Associated data, always padded; the domain separation bit follows it (even with no data).
  if (ad.length > 0) {
    let pos = 0;
    for (; ad.length - pos >= 16; pos += 16) {
      s[0] = s[0]! ^ load(ad, pos);
      s[1] = s[1]! ^ load(ad, pos + 8);
      permute(s, 8);
    }
    const last = padBlock(ad, pos, 16);
    s[0] = s[0]! ^ load(last, 0);
    s[1] = s[1]! ^ load(last, 8);
    permute(s, 8);
  }
  s[4] = s[4]! ^ (1n << 63n);
  // Message blocks.
  const out = new Uint8Array(input.length + (decrypt ? 0 : 16));
  let pos = 0;
  for (; input.length - pos >= 16; pos += 16) {
    for (let i = 0; i < 2; i++) {
      const w = load(input, pos + 8 * i);
      if (decrypt) {
        store(s[i]! ^ w, out, pos + 8 * i, 8);
        s[i] = w;
      } else {
        s[i] = s[i]! ^ w;
        store(s[i]!, out, pos + 8 * i, 8);
      }
    }
    permute(s, 8);
  }
  const r = input.length - pos;
  const rest = input.subarray(pos);
  const sb = new Uint8Array(16);
  store(s[0]!, sb, 0, 8);
  store(s[1]!, sb, 8, 8);
  if (decrypt) {
    for (let i = 0; i < r; i++) {
      out[pos + i] = sb[i]! ^ rest[i]!;
      sb[i] = rest[i]!;
    }
  } else {
    for (let i = 0; i < r; i++) {
      sb[i] = sb[i]! ^ rest[i]!;
      out[pos + i] = sb[i]!;
    }
  }
  sb[r] = sb[r]! ^ 0x01;
  s[0] = load(sb, 0);
  s[1] = load(sb, 8);
  // Finalisation.
  s[2] = s[2]! ^ k0;
  s[3] = s[3]! ^ k1;
  permute(s, 12);
  const tag = new Uint8Array(16);
  store(s[3]! ^ k0, tag, 0, 8);
  store(s[4]! ^ k1, tag, 8, 8);
  if (!decrypt) {
    out.set(tag, input.length);
    return out;
  }
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= tag[i]! ^ tagIn![i]!;
  if (diff !== 0)
    throw coerceFailure(
      "bytes",
      "bytes",
      "the Ascon tag check failed: wrong key, nonce, data or associated data",
    );
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("ascon", "_hash", "( data:bytes -- bytes )", hash, {
    doc: "Ascon-Hash256 (SP 800-232): 32 bytes (private helper of ascon:hash).",
    category: "Hashing",
  }),
  definePrimitive("ascon", "_mac", "( data:bytes key:bytes -- bytes )", mac, {
    doc: "Ascon-Mac: 16 bytes under a 16-byte key (private helper of ascon:mac).",
    category: "Hashing",
  }),
  definePrimitive(
    "ascon",
    "_aead",
    "( data:bytes key:bytes nonce:bytes ad:bytes decrypt:bool -- bytes )",
    aead,
    {
      doc: "Ascon-AEAD128 (SP 800-232), the tag appended to the ciphertext (private helper of ascon:encrypt and ascon:decrypt).",
      category: "Encryption",
    },
  ),
];
