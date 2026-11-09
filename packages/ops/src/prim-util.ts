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

/** ASCII whitespace as the text formats ignore it: space, tab, LF, VT, FF, CR. */
export function isAsciiSpace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}
