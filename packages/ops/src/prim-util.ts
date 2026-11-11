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
 * Small error constructors and size guards shared by the primitive modules in `prims/`. This file is
 * not in `prims/` because every file there is loaded as a vocabulary's primitive module.
 */
import { ForgeError } from "@forge/lang";
import type { PrimitiveContext } from "@forge/lang";

/** `E_COERCE` for data that cannot be read as text of a format (the precedent is `hex>bytes`). */
export function coerceFailure(from: string, to: string, reason: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot convert ${from} to ${to}: ${reason}`,
    detail: { from, to, reason },
  });
}

/** `E_RANGE`: a bad argument value. */
export function rangeFailure(message: string, detail: Record<string, unknown> = {}): ForgeError {
  return new ForgeError({ code: "E_RANGE", message, detail });
}

/** `E_LIMIT_VALUE` naming the limit that was exceeded. */
export function limitFailure(limit: string, max: number, value: number, what: string): ForgeError {
  return new ForgeError({
    code: "E_LIMIT_VALUE",
    message: `${what} of ${value} exceeds the limit of ${max}`,
    detail: { limit, max, value },
  });
}

/** Rejects a result of `size` bytes (the LANGUAGE.md 10.8 measure) that would exceed `maxValueBytes`. */
export function guardResult(ctx: PrimitiveContext, size: number, what: string): void {
  const max = ctx.limits.maxValueBytes;
  if (size > max) throw limitFailure("maxValueBytes", max, size, what);
}

/**
 * The decompression bomb rule of the wave 6 conventions (packages/ops/README.md): a decompressor stops at
 * `ctx.limits.maxValueBytes` and raises this, `E_LIMIT_VALUE` naming `maxValueBytes`, while it decompresses.
 * `produced` is the size the output had reached when the decoder stopped.
 */
export function bombFailure(max: number, produced: number): ForgeError {
  return limitFailure("maxValueBytes", max, produced, "decompressed data");
}

/**
 * The output of a streaming decompressor, capped at `max` bytes (pass `ctx.limits.maxValueBytes`).
 * `push` a chunk as the decoder emits it; the chunk that would pass the cap raises `bombFailure` before it is kept.
 */
export class BoundedOutput {
  private readonly pieces: Uint8Array[] = [];
  private total = 0;

  constructor(private readonly max: number) {}

  /** Bytes kept so far. */
  get length(): number {
    return this.total;
  }

  push(chunk: Uint8Array): void {
    if (this.total + chunk.length > this.max)
      throw bombFailure(this.max, this.total + chunk.length);
    this.total += chunk.length;
    this.pieces.push(chunk);
  }

  /** One array of everything pushed. */
  finish(): Uint8Array {
    const out = new Uint8Array(this.total);
    let at = 0;
    for (const piece of this.pieces) {
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  }
}

/** ASCII whitespace as the text formats ignore it: space, tab, LF, VT, FF, CR. */
export function isAsciiSpace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

/** The little-endian unsigned 16-bit integer of `d` at `p` (the caller has checked that both bytes are there). */
export function readU16LE(d: Uint8Array, p: number): number {
  return (d[p] as number) | ((d[p + 1] as number) << 8);
}

/** The little-endian unsigned 32-bit integer of `d` at `p` (the caller has checked that the four bytes are there). */
export function readU32LE(d: Uint8Array, p: number): number {
  return (
    ((d[p] as number) |
      ((d[p + 1] as number) << 8) |
      ((d[p + 2] as number) << 16) |
      ((d[p + 3] as number) << 24)) >>>
    0
  );
}
