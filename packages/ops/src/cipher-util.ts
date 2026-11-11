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
 * Small helpers shared by the cipher primitive modules in `prims/` (des, triple-des, blowfish, rc2, rc6,
 * twofish, sm4, and the lightweight and legacy ciphers rc4, ciphersaber2, rabbit, tea, xtea, xxtea, present
 * and gost28147). This file is not in `prims/` because every file there is loaded as a vocabulary's
 * primitive module.
 */
import { rangeFailure } from "./prim-util.js";

/** 32-bit left rotation (the one of `hash-util.ts`). */
export { rotl32 } from "./hash-util.js";

/** 32-bit right rotation. */
export function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** The big-endian 32-bit word at byte offset `i`. */
export function getBE32(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

/** Writes `v` as a big-endian 32-bit word at byte offset `i`. */
export function putBE32(b: Uint8Array, i: number, v: number): void {
  b[i] = v >>> 24;
  b[i + 1] = v >>> 16;
  b[i + 2] = v >>> 8;
  b[i + 3] = v;
}

/** The little-endian 32-bit word at byte offset `i`. */
export function getLE32(b: Uint8Array, i: number): number {
  return ((b[i + 3]! << 24) | (b[i + 2]! << 16) | (b[i + 1]! << 8) | b[i]!) >>> 0;
}

/** Writes `v` as a little-endian 32-bit word at byte offset `i`. */
export function putLE32(b: Uint8Array, i: number, v: number): void {
  b[i] = v;
  b[i + 1] = v >>> 8;
  b[i + 2] = v >>> 16;
  b[i + 3] = v >>> 24;
}

/** Rejects a block that is not `n` bytes (E_RANGE). */
export function checkBlock(block: Uint8Array, n: number, cipher: string): void {
  if (block.length !== n)
    throw rangeFailure(`a ${cipher} block is ${n} bytes, not ${block.length}`, {
      length: block.length,
    });
}

/** True when two byte strings are equal. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Memoises a key schedule on the last key (and the numeric or text parameters) it saw. A mode calls the
 * block primitive once per block with the same key, so the schedule is derived once per call of the word.
 * `derive` may throw (a bad key length); nothing is cached then.
 */
export function keyCache<T, P extends (number | string)[]>(
  derive: (key: Uint8Array, ...params: P) => T,
): (key: Uint8Array, ...params: P) => T {
  let lastKey: Uint8Array | undefined;
  let lastParams: P | undefined;
  let lastValue: T | undefined;
  return (key, ...params) => {
    if (
      lastKey !== undefined &&
      lastParams !== undefined &&
      sameBytes(lastKey, key) &&
      params.length === lastParams.length &&
      params.every((p, i) => p === lastParams![i])
    )
      return lastValue as T;
    const value = derive(key, ...params);
    lastKey = Uint8Array.from(key);
    lastParams = params;
    lastValue = value;
    return value;
  };
}

/**
 * RC4 key setup (the KSA of the Rivest/Schneier descriptions), repeated `rounds` times with the index j
 * carried over: one round is plain RC4, more rounds are CipherSaber-2. `key` is cycled to fill 256 bytes.
 */
export function rc4Schedule(key: Uint8Array, rounds: number): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  const n = key.length;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 256; i++) {
      j = (j + s[i]! + key[i % n]!) & 255;
      const t = s[i]!;
      s[i] = s[j]!;
      s[j] = t;
    }
  }
  return s;
}

/**
 * The RC4 pseudo-random generation (PRGA) from a scheduled state: skips `drop` key stream bytes, then
 * XORs the rest into a copy of `data`. The state is consumed (it is a fresh array per call).
 */
export function rc4Xor(s: Uint8Array, data: Uint8Array, drop: number): Uint8Array {
  const out = new Uint8Array(data.length);
  let i = 0;
  let j = 0;
  const step = (): number => {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
    return s[(s[i]! + s[j]!) & 255]!;
  };
  for (let d = 0; d < drop; d++) step();
  for (let x = 0; x < data.length; x++) out[x] = data[x]! ^ step();
  return out;
}
