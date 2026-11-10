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
 * streebog primitive. GOST R 34.11-2012 ("Streebog") as specified in RFC 6986 (section numbers
 * below are that RFC's), with 256- or 512-bit output. It is a 512-bit-block Merkle-Damgard hash
 * with a checksum block, whose compression function g_N is a 12-round AES-like cipher E over the
 * substitution S, byte permutation P and linear map L. The substitution Pi (6.2), the matrix A
 * (6.4) and the iteration constants C (6.5) are the RFC's tables; the 64-bit linear map is
 * folded with S and P into eight 256-entry tables, built on first use. Vectors are 64-byte
 * little-endian strings (byte 0 is the least significant), as the RFC numbers them: a value the
 * RFC prints is the reverse of the bytes here.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { fromHex } from "../hash-util-b.js";
import { rangeFailure } from "../prim-util.js";

// 6.2 Pi' (Pi'(0) .. Pi'(255)).
const PI =
  "fceedd11cf6e3116fbc4fada23c5044de977f0db932e99ba1736f1bb14cd5fc1" +
  "f918655ae25cef21811c3c428b018e4f058402aee36a8fa0060bed987fd4d31f" +
  "eb342c51eac848abf22a68a2fd3aceccb5700e56080c7612bf7213479cb75d87" +
  "15a19629107b9ac7f391786f9d9eb2b13275193dff358a7e6d54c680c3bd0d57" +
  "dff524a93ea843c9d779d6f67c22b903e00fecde7a94b0bcdce828504e330a4a" +
  "a79760731e0062441ab83882649f2641ad454692275e552f8ca3a57d69d5953b" +
  "0758b34086ac1df730376be488d9e789e11b83494c3ff8fe8d53aa90cad88561" +
  "207167a42d2b095bcb9b25d0bee56c5259a674d2e6f4b4c0d166afc2394b63b6";

// 6.4 The 64 rows of the matrix A, as 64-bit hex numbers (row j is a_(j,15) .. a_(j,0)).
const A = [
  "8e20faa72ba0b470",
  "47107ddd9b505a38",
  "ad08b0e0c3282d1c",
  "d8045870ef14980e",
  "6c022c38f90a4c07",
  "3601161cf205268d",
  "1b8e0b0e798c13c8",
  "83478b07b2468764",
  "a011d380818e8f40",
  "5086e740ce47c920",
  "2843fd2067adea10",
  "14aff010bdd87508",
  "0ad97808d06cb404",
  "05e23c0468365a02",
  "8c711e02341b2d01",
  "46b60f011a83988e",
  "90dab52a387ae76f",
  "486dd4151c3dfdb9",
  "24b86a840e90f0d2",
  "125c354207487869",
  "092e94218d243cba",
  "8a174a9ec8121e5d",
  "4585254f64090fa0",
  "accc9ca9328a8950",
  "9d4df05d5f661451",
  "c0a878a0a1330aa6",
  "60543c50de970553",
  "302a1e286fc58ca7",
  "18150f14b9ec46dd",
  "0c84890ad27623e0",
  "0642ca05693b9f70",
  "0321658cba93c138",
  "86275df09ce8aaa8",
  "439da0784e745554",
  "afc0503c273aa42a",
  "d960281e9d1d5215",
  "e230140fc0802984",
  "71180a8960409a42",
  "b60c05ca30204d21",
  "5b068c651810a89e",
  "456c34887a3805b9",
  "ac361a443d1c8cd2",
  "561b0d22900e4669",
  "2b838811480723ba",
  "9bcf4486248d9f5d",
  "c3e9224312c8c1a0",
  "effa11af0964ee50",
  "f97d86d98a327728",
  "e4fa2054a80b329c",
  "727d102a548b194e",
  "39b008152acb8227",
  "9258048415eb419d",
  "492c024284fbaec0",
  "aa16012142f35760",
  "550b8e9e21f7a530",
  "a48b474f9ef5dc18",
  "70a6a56e2440598e",
  "3853dc371220a247",
  "1ca76e95091051ad",
  "0edd37c48a08a6d8",
  "07e095624504536c",
  "8d70c431ac02a736",
  "c83862965601dd1b",
  "641c314b2b8ee083",
];

// 6.5 Iteration constants C[1] .. C[12], printed most significant byte first.
const C = [
  "b1085bda1ecadae9ebcb2f81c0657c1f2f6a76432e45d016714eb88d7585c4fc" +
    "4b7ce09192676901a2422a08a460d31505767436cc744d23dd806559f2a64507",
  "6fa3b58aa99d2f1a4fe39d460f70b5d7f3feea720a232b9861d55e0f16b50131" +
    "9ab5176b12d699585cb561c2db0aa7ca55dda21bd7cbcd56e679047021b19bb7",
  "f574dcac2bce2fc70a39fc286a3d843506f15e5f529c1f8bf2ea7514b1297b7b" +
    "d3e20fe490359eb1c1c93a376062db09c2b6f443867adb31991e96f50aba0ab2",
  "ef1fdfb3e81566d2f948e1a05d71e4dd488e857e335c3c7d9d721cad685e353f" +
    "a9d72c82ed03d675d8b71333935203be3453eaa193e837f1220cbebc84e3d12e",
  "4bea6bacad4747999a3f410c6ca923637f151c1f1686104a359e35d7800fffbd" +
    "bfcd1747253af5a3dfff00b723271a167a56a27ea9ea63f5601758fd7c6cfe57",
  "ae4faeae1d3ad3d96fa4c33b7a3039c02d66c4f95142a46c187f9ab49af08ec6" +
    "cffaa6b71c9ab7b40af21f66c2bec6b6bf71c57236904f35fa68407a46647d6e",
  "f4c70e16eeaac5ec51ac86febf240954399ec6c7e6bf87c9d3473e33197a93c9" +
    "0992abc52d822c3706476983284a05043517454ca23c4af38886564d3a14d493",
  "9b1f5b424d93c9a703e7aa020c6e41414eb7f8719c36de1e89b4443b4ddbc49a" +
    "f4892bcb929b069069d18d2bd1a5c42f36acc2355951a8d9a47f0dd4bf02e71e",
  "378f5a541631229b944c9ad8ec165fde3a7d3a1b258942243cd955b7e00d0984" +
    "800a440bdbb2ceb17b2b8a9aa6079c540e38dc92cb1f2a607261445183235adb",
  "abbedea680056f52382ae548b2e4f3f38941e71cff8a78db1fffe18a1b336103" +
    "9fe76702af69334b7a1e6c303b7652f43698fad1153bb6c374b4c7fb98459ced",
  "7bcd9ed0efc889fb3002c6cd635afe94d8fa6bbbebab07612001802114846679" +
    "8a1d71efea48b9caefbacd1d7d476e98dea2594ac06fd85d6bcaa4cd81f32d1b",
  "378ee767f11631bad21380b00449b17acda43c32bcdf1d77f82012d430219f9b" +
    "5d80ef9d1891cc86e71da4aa88e12852faf417d5d9b21b9948bc924af11bd720",
];

interface Tables {
  /** For byte q of a 64-bit block and value x: L of (Pi(x) at byte q), as (low, high) words. */
  readonly t: readonly Uint32Array[];
  /** The constants C[1..12] as little-endian byte strings. */
  readonly c: readonly Uint8Array[];
}

let tables: Tables | undefined;

function getTables(): Tables {
  if (tables !== undefined) return tables;
  const pi = fromHex(PI);
  // Row r of A as (low, high) 32-bit words.
  const rows = A.map((r) => [parseInt(r.slice(8), 16), parseInt(r.slice(0, 8), 16)] as const);
  const t: Uint32Array[] = [];
  for (let q = 0; q < 8; q++) {
    const tq = new Uint32Array(512);
    for (let x = 0; x < 256; x++) {
      // 6.4: bit i of the block (i = 8q + bit of Pi(x)) selects row 63 - i.
      let lo = 0;
      let hi = 0;
      for (let b = 0; b < 8; b++) {
        if ((pi[x]! >> b) & 1) {
          const row = rows[63 - (8 * q + b)]!;
          lo ^= row[0];
          hi ^= row[1];
        }
      }
      tq[2 * x] = lo >>> 0;
      tq[2 * x + 1] = hi >>> 0;
    }
    t.push(tq);
  }
  tables = { t, c: C.map((h) => fromHex(h).reverse()) };
  return tables;
}

/**
 * LPS (sections 7 and 8): S on every byte, P (byte k of the result is byte Tau(k), where
 * Tau(k) = 8 (k mod 8) + floor(k / 8), 6.3), then L on each 64-bit block.
 */
function lps(t: readonly Uint32Array[], x: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  for (let j = 0; j < 8; j++) {
    let lo = 0;
    let hi = 0;
    for (let q = 0; q < 8; q++) {
      const v = x[8 * q + j]!; // Tau(8j + q) = 8q + j
      const tq = t[q]!;
      lo ^= tq[2 * v]!;
      hi ^= tq[2 * v + 1]!;
    }
    for (let i = 0; i < 4; i++) {
      out[8 * j + i] = (lo >>> (8 * i)) & 255;
      out[8 * j + 4 + i] = (hi >>> (8 * i)) & 255;
    }
  }
  return out;
}

const xor = (a: Uint8Array, b: Uint8Array): Uint8Array => a.map((v, i) => v ^ b[i]!);

/** g_N(h, m) = E(LPS(h xor N), m) xor h xor m (section 8). */
function g(
  t: readonly Uint32Array[],
  c: readonly Uint8Array[],
  n: Uint8Array,
  h: Uint8Array,
  m: Uint8Array,
): Uint8Array {
  let k = lps(t, xor(h, n));
  let e = m;
  for (let i = 0; i < 12; i++) {
    e = lps(t, xor(e, k)); // X[K_i] then LPS
    k = lps(t, xor(k, c[i]!)); // K_(i+1) = LPS(K_i xor C[i])
  }
  return xor(xor(e, k), xor(h, m)); // X[K_13], then the feed-forward
}

/** Adds the little-endian number `b` to `a` modulo 2^512, in place. */
function addMod(a: Uint8Array, b: Uint8Array): void {
  let carry = 0;
  for (let i = 0; i < 64; i++) {
    const s = a[i]! + (b[i] ?? 0) + carry;
    a[i] = s & 255;
    carry = s >> 8;
  }
}

/** The GOST R 34.11-2012 digest of `data`; `size` is "256" or "512" (the digest length in bits). */
export function hash(data: Uint8Array, size: string): Uint8Array {
  if (size !== "256" && size !== "512") {
    throw rangeFailure(`unknown Streebog size '${size.slice(0, 20)}'`);
  }
  const { t, c } = getTables();
  const zero = new Uint8Array(64);
  // 6.1 and Step 1: IV is 0^512 for 512 bits, and (00000001)^64 for 256 bits.
  let h: Uint8Array = size === "512" ? zero : new Uint8Array(64).fill(1);
  const n = new Uint8Array(64);
  const eps = new Uint8Array(64);
  let pos = 0;
  // Step 2: while at least 512 bits remain, take the 512 bits at the low end (the next 64 bytes).
  while (data.length - pos >= 64) {
    const m = data.subarray(pos, pos + 64);
    h = g(t, c, n, h, m);
    addMod(n, Uint8Array.of(0, 2)); // + 512
    addMod(eps, m);
    pos += 64;
  }
  // Step 3: pad the rest with a 1 bit above it, then the final blocks.
  const rest = data.length - pos;
  const m = new Uint8Array(64);
  m.set(data.subarray(pos));
  m[rest] = 1;
  h = g(t, c, n, h, m);
  const bits = new Uint8Array(64);
  bits[0] = (rest * 8) & 255;
  bits[1] = (rest * 8) >> 8;
  addMod(n, bits);
  addMod(eps, m);
  h = g(t, c, zero, h, n);
  h = g(t, c, zero, h, eps);
  // 3.6: the 256-bit hash is the most significant 256 bits, the last 32 bytes here.
  return size === "512" ? h : h.slice(32);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("streebog", "_hash", "( data:bytes size:str -- bytes )", hash, {
    doc: "The GOST R 34.11-2012 (Streebog) digest of the bytes for a size, 256 or 512 (private helper of streebog:digest).",
    category: "Hashing",
  }),
];
