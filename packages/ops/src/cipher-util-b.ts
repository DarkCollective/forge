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
 * Shared TypeScript for the lightweight and legacy ciphers of WP 5.27 (rc4, ciphersaber2, rabbit, tea,
 * xtea, xxtea, present, gost28147). This file is not in `prims/`, so it is not loaded as a vocabulary's
 * primitive module.
 */
import { rangeFailure } from "./prim-util.js";

/** Reads the 32-bit big-endian word at `o`. */
export function be32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

/** Writes the 32-bit word `v` big-endian at `o`. */
export function putBe32(b: Uint8Array, o: number, v: number): void {
  b[o] = v >>> 24;
  b[o + 1] = v >>> 16;
  b[o + 2] = v >>> 8;
  b[o + 3] = v;
}

/** Reads the 32-bit little-endian word at `o`. */
export function le32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Writes the 32-bit word `v` little-endian at `o`. */
export function putLe32(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
  b[o + 2] = v >>> 16;
  b[o + 3] = v >>> 24;
}

/** Rejects a block that is not `size` bytes (E_RANGE). */
export function checkBlock(block: Uint8Array, size: number, name: string): void {
  if (block.length !== size)
    throw rangeFailure(`a ${name} block is ${size} bytes, not ${block.length}`, {
      length: block.length,
    });
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

/** Remembers the value derived from the last key a primitive saw (the key is the same for every block of a call). */
export class KeyCache<T> {
  private keyText = "";
  private value: T | undefined;

  get(key: Uint8Array, tag: string, make: () => T): T {
    const text = tag + ":" + Array.from(key, (b) => String.fromCharCode(b)).join("");
    if (this.value === undefined || text !== this.keyText) {
      this.value = make();
      this.keyText = text;
    }
    return this.value;
  }
}
