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
 * random primitives: the one place where Forge reads the host's cryptographic random source (+random).
 * Every other vocabulary that needs random bytes or a random integer calls these words (qualified, e.g.
 * `random:bytes-of`); nothing else may read `crypto.getRandomValues`, and nothing falls back to Math.random:
 * a host with no `crypto.getRandomValues` is `E_PRIMITIVE`.
 *
 *  - `bytes-of ( n:int -- bytes )`: n random bytes (n >= 0; E_RANGE below 0; E_LIMIT_VALUE above maxValueBytes);
 *  - `below ( n:int -- int )`: a uniform integer in [0, n) by rejection sampling (no modulo bias), for n >= 1,
 *    any size up to maxIntBits (E_RANGE for n < 1).
 *
 * The functions `randomBytes` and `randomBelow` are exported for the other primitive modules of this package
 * (`list.ts` shuffles with them).
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { guardResult, rangeFailure } from "../prim-util.js";

const { normaliseInt } = valueHelpers;

interface HostCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** `crypto.getRandomValues` may fill at most 65,536 bytes per call. */
const CHUNK = 65_536;

/** After this many rejected draws something is wrong with the source (the odds of a real run are below 2^-1000). */
const MAX_DRAWS = 1000;

function source(): HostCrypto {
  const c = (globalThis as unknown as { crypto?: HostCrypto }).crypto;
  if (c === undefined || typeof c.getRandomValues !== "function") {
    throw new ForgeError({
      code: "E_PRIMITIVE",
      message: "this host has no cryptographic random source (crypto.getRandomValues)",
    });
  }
  return c;
}

/** n bytes from the host's cryptographic random source. */
export function randomBytes(n: number): Uint8Array {
  const c = source();
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += CHUNK)
    c.getRandomValues(out.subarray(at, Math.min(n, at + CHUNK)));
  return out;
}

/** The number of bits of a positive bigint. */
function bitLength(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

/**
 * A uniform integer in [0, n) for n >= 1: draw ceil(bits(n - 1) / 8) random bytes, mask the top byte to the
 * bit length of n - 1 and retry while the value is n or more (fewer than two draws on average).
 */
export function randomBelowBig(n: bigint): bigint {
  const top = n - 1n;
  if (top === 0n) return 0n;
  const bits = bitLength(top);
  const size = Math.ceil(bits / 8);
  const mask = (1 << (bits - 8 * (size - 1))) - 1;
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    const raw = randomBytes(size);
    raw[0] = (raw[0] as number) & mask;
    let v = 0n;
    for (const b of raw) v = (v << 8n) | BigInt(b);
    if (v <= top) return v;
  }
  throw new ForgeError({
    code: "E_PRIMITIVE",
    message: "the random source did not produce a usable value",
  });
}

/** `randomBelowBig` for a safe-integer bound, without the bigint arithmetic (the shuffle calls it often). */
export function randomBelow(n: number): number {
  if (n <= 1) return 0;
  const top = n - 1;
  const bits = 32 - Math.clz32(top > 0xffffffff ? 0xffffffff : top);
  if (top > 0xffffffff) return Number(randomBelowBig(BigInt(n)));
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  const buf = new Uint8Array(4);
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    source().getRandomValues(buf);
    // four bytes read as one little-endian word, then cut to the bit length of the bound
    const word =
      ((buf[0] as number) |
        ((buf[1] as number) << 8) |
        ((buf[2] as number) << 16) |
        ((buf[3] as number) << 24)) >>>
      0;
    const v = (word & mask) >>> 0;
    if (v <= top) return v;
  }
  throw new ForgeError({
    code: "E_PRIMITIVE",
    message: "the random source did not produce a usable value",
  });
}

function bytesOf(n: number | bigint, ctx: PrimitiveContext): Uint8Array {
  if (typeof n === "bigint" || n < 0)
    throw rangeFailure("the number of random bytes must be 0 or more");
  guardResult(ctx, n, "random bytes");
  return randomBytes(n);
}

function below(n: number | bigint): number | bigint {
  if (n < 1) throw rangeFailure("the bound of a random integer must be 1 or more");
  if (typeof n === "number") return randomBelow(n);
  return randomBelowBig(n);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("random", "bytes-of", "( n:int -- bytes )", bytesOf, {
    effects: ["+random"],
    doc: "n random bytes from the host CSPRNG (n of 0 or more; E_RANGE below 0, E_LIMIT_VALUE above the value limit). Shared word: call it qualified from any vocabulary.",
  }),
  definePrimitive(
    "random",
    "below",
    "( n:int -- int )",
    (n: number | bigint) => normaliseInt(below(n)),
    {
      effects: ["+random"],
      doc: "A uniform random integer in [0, n) from the host CSPRNG, by rejection sampling so there is no modulo bias. n is 1 or more (E_RANGE otherwise) and may be a big integer. Shared word: call it qualified from any vocabulary.",
    },
  ),
];
