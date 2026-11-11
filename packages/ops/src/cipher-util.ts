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
 * Small helpers shared by the block cipher primitive modules in `prims/` (des, triple-des, blowfish,
 * rc2, rc6, twofish, sm4). This file is not in `prims/` because every file there is loaded as a
 * vocabulary's primitive module.
 */
import { rangeFailure } from "./prim-util.js";

/** 32-bit left rotation. */
export function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

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
 * Memoises a key schedule on the last key (and the numeric parameters) it saw. A mode calls the block
 * primitive once per block with the same key, so the schedule is derived once per call of the word.
 * `derive` may throw (a bad key length); nothing is cached then.
 */
export function keyCache<T>(
  derive: (key: Uint8Array, ...params: number[]) => T,
): (key: Uint8Array, ...params: number[]) => T {
  let lastKey: Uint8Array | undefined;
  let lastParams: number[] = [];
  let lastValue: T | undefined;
  return (key, ...params) => {
    if (
      lastKey !== undefined &&
      sameBytes(lastKey, key) &&
      params.length === lastParams.length &&
      params.every((p, i) => p === lastParams[i])
    )
      return lastValue as T;
    const value = derive(key, ...params);
    lastKey = Uint8Array.from(key);
    lastParams = params;
    lastValue = value;
    return value;
  };
}
