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
 * scrypt primitives. Only `_derive` is a primitive: scrypt (RFC 7914) is memory-hard (128 * N * r
 * bytes) and far too slow in FL, so it wraps the audited `@noble/hashes` (synchronous). The word
 * `scrypt:derive` (vocab/scrypt.fth) holds the metadata and the parameters.
 *
 * Caps (the bake deadline is 10 s for untrusted recipes): N is a power of two from 2 to 2^20, the
 * memory 128 * N * r is at most 256 MiB (N * r <= 2^21), the work N * r * p is at most 2^23 (about
 * 2 s) and the key is at most 4096 bytes. So the RFC 7914 vector with N = 1048576 (1 GiB) is out of
 * range.
 */
import { scrypt } from "@noble/hashes/scrypt.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

export const MAX_N = 2 ** 20;
export const MAX_MEMORY = 256 * 1024 * 1024;
export const MAX_WORK = 2 ** 23;
export const MAX_KEY = 4096;

function whole(name: string, v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    throw rangeFailure(`scrypt ${name} must be ${min} to ${max}, not ${String(v)}`);
  return v;
}

/** scrypt of `password` and `salt` with cost N (a power of two), block size r and parallelism p. */
export function derive(
  password: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  length: number,
): Uint8Array {
  whole("N", n, 2, MAX_N);
  if (n % 2 !== 0 || (n & (n - 1)) !== 0)
    throw rangeFailure(`scrypt N must be a power of two, not ${n}`);
  whole("r", r, 1, 1024);
  whole("p", p, 1, 1024);
  whole("key length", length, 1, MAX_KEY);
  if (128 * n * r > MAX_MEMORY)
    throw rangeFailure(
      `scrypt N = ${n} with r = ${r} needs ${(128 * n * r) / 2 ** 20} MiB, over the limit of 256 MiB`,
      { n, r, limit: MAX_MEMORY },
    );
  if (n * r * p > MAX_WORK)
    throw rangeFailure(`scrypt N * r * p = ${n * r * p} is over the limit of ${MAX_WORK}`, {
      n,
      r,
      p,
      limit: MAX_WORK,
    });
  return scrypt(password, salt, { N: n, r, p, dkLen: length, maxmem: 2 ** 30 });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "scrypt",
    "_derive",
    "( password:bytes salt:bytes n:int r:int p:int length:int -- bytes )",
    derive,
    {
      doc: "scrypt (RFC 7914) over the audited noble library (private helper of scrypt:derive).",
      category: "Key derivation",
    },
  ),
];
