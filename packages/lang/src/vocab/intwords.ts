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

/**
 * Integer and bytes words of `core` (docs/research/int-words.md), kind P: single-step reads and
 * writes of fixed-width integers in bytes, and fixed-width rotates.
 *
 * All of them work on exact integers, check sizes before computing like `shl`, and treat a
 * negative width, offset or count as E_RANGE. A read past the end of the bytes is the `slice` error.
 */
import { CORE_VOCAB } from "../dictionary.js";
import { ForgeError } from "../errors.js";
import { definePrimitive } from "../primitives.js";
import type { PrimitiveContext, PrimitiveDef } from "../types.js";
import { normaliseInt } from "../values.js";

type Int = number | bigint;
const big = (n: Int): bigint => (typeof n === "bigint" ? n : BigInt(n));

function rangeError(message: string, detail: Record<string, unknown>): ForgeError {
  return new ForgeError({ code: "E_RANGE", message, detail });
}

function limitError(what: string, limit: number, value: number): ForgeError {
  return new ForgeError({
    code: "E_LIMIT_VALUE",
    message: `${what} of ${value} exceeds the limit of ${limit}`,
    detail: { limit, value },
  });
}

function readInt(data: Uint8Array, p: Int, n: Int, little: boolean, ctx: PrimitiveContext): Int {
  if (typeof p === "bigint" || typeof n === "bigint" || p < 0 || n < 0 || p + n > data.length) {
    throw rangeError("slice bounds out of range", { from: p, count: n, length: data.length });
  }
  const bits = 8 * n;
  if (bits > ctx.limits.maxIntBits) {
    throw limitError("integer bit length", ctx.limits.maxIntBits, bits);
  }
  if (n <= 6) {
    let r = 0;
    if (little) for (let i = n - 1; i >= 0; i--) r = r * 256 + (data[p + i] as number);
    else for (let i = 0; i < n; i++) r = r * 256 + (data[p + i] as number);
    return r;
  }
  let r = 0n;
  if (little) for (let i = n - 1; i >= 0; i--) r = (r << 8n) | BigInt(data[p + i] as number);
  else for (let i = 0; i < n; i++) r = (r << 8n) | BigInt(data[p + i] as number);
  return normaliseInt(r, ctx.limits.maxIntBits);
}

function writeInt(v: Int, n: Int, little: boolean, ctx: PrimitiveContext): Uint8Array {
  if (typeof n === "bigint" || n < 0) throw rangeError("negative byte count", { count: n });
  if (n > ctx.limits.maxValueBytes) throw limitError("bytes (bytes)", ctx.limits.maxValueBytes, n);
  const out = new Uint8Array(n);
  let x = BigInt.asUintN(8 * n, big(v));
  for (let i = 0; i < n; i++) {
    out[little ? i : n - 1 - i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function checkWidth(width: Int, ctx: PrimitiveContext): bigint {
  if (width <= 0) throw rangeError("width must be positive", { width });
  if (width > ctx.limits.maxIntBits) {
    throw limitError("integer bit length", ctx.limits.maxIntBits, Number(width));
  }
  return big(width);
}

function checkCount(k: Int): bigint {
  if (k < 0) throw rangeError("negative rotate count", { count: k });
  return big(k);
}

/** Rotates the low `w` bits of `v` (unsigned; two's complement for a negative v) left by k. */
function rotate(v: Int, k: Int, width: Int, left: boolean, ctx: PrimitiveContext): Int {
  const w = checkWidth(width, ctx);
  let s = checkCount(k) % w;
  if (!left) s = (w - s) % w;
  const x = BigInt.asUintN(Number(w), big(v));
  if (s === 0n) return normaliseInt(x);
  return normaliseInt(((x << s) | (x >> (w - s))) & ((1n << w) - 1n));
}

function def(
  name: string,
  effect: string,
  category: string,
  doc: string,
  fn: PrimitiveDef["fn"],
): PrimitiveDef {
  return definePrimitive(CORE_VOCAB, name, effect, fn, { category, doc });
}

export const INT_PRIMITIVES: readonly PrimitiveDef[] = Object.freeze([
  def(
    "be-bytes>int",
    "( data:bytes p:int n:int -- int )",
    "conversion",
    "The n bytes of data at p as one big-endian unsigned integer. A negative p or n, or a read past the end, is the slice E_RANGE; n of 0 gives 0.",
    (data: Uint8Array, p: Int, n: Int, ctx: PrimitiveContext) => readInt(data, p, n, false, ctx),
  ),
  def(
    "le-bytes>int",
    "( data:bytes p:int n:int -- int )",
    "conversion",
    "The n bytes of data at p as one little-endian unsigned integer. Errors as be-bytes>int.",
    (data: Uint8Array, p: Int, n: Int, ctx: PrimitiveContext) => readInt(data, p, n, true, ctx),
  ),
  def(
    "int>be-bytes",
    "( v:int n:int -- bytes )",
    "conversion",
    "The low n bytes of v, most significant first (two's complement for a negative v). A negative n is E_RANGE.",
    (v: Int, n: Int, ctx: PrimitiveContext) => writeInt(v, n, false, ctx),
  ),
  def(
    "int>le-bytes",
    "( v:int n:int -- bytes )",
    "conversion",
    "The low n bytes of v, least significant first. A negative n is E_RANGE.",
    (v: Int, n: Int, ctx: PrimitiveContext) => writeInt(v, n, true, ctx),
  ),
  def(
    "rotl",
    "( v:int k:int width:int -- int )",
    "bitwise",
    "The low width bits of v (unsigned) rotated left by k. A width under 1 or a negative k is E_RANGE.",
    (v: Int, k: Int, w: Int, ctx: PrimitiveContext) => rotate(v, k, w, true, ctx),
  ),
  def(
    "rotr",
    "( v:int k:int width:int -- int )",
    "bitwise",
    "The low width bits of v (unsigned) rotated right by k. Errors as rotl.",
    (v: Int, k: Int, w: Int, ctx: PrimitiveContext) => rotate(v, k, w, false, ctx),
  ),
]);
