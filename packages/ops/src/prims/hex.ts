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
 * hex primitives. `vocab/hex.fth` adds the parameter help.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { coerceFailure, guardResult, isAsciiSpace } from "../prim-util.js";

function digitValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return -1;
}

function fail(reason: string) {
  return coerceFailure("str", "bytes", reason);
}

/** Pairs of hex digits (either case); ASCII white space between digits is ignored. */
function decode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / 2));
  let digits = 0;
  for (const byte of data) {
    if (isAsciiSpace(byte)) continue;
    const v = digitValue(byte);
    if (v < 0) throw fail(`byte 0x${byte.toString(16).padStart(2, "0")} is not a hex digit`);
    if (digits % 2 === 0) out[digits / 2] = v << 4;
    else out[(digits - 1) / 2] = (out[(digits - 1) / 2] as number) | v;
    digits++;
  }
  if (digits % 2 !== 0) throw fail("odd number of hex digits");
  return out.slice(0, digits / 2);
}

const LOWER = "0123456789abcdef";
const UPPER = "0123456789ABCDEF";
const DELIMITERS: Readonly<Record<string, string>> = { none: "", space: " ", colon: ":" };

function encode(
  data: Uint8Array,
  delimiter: string,
  upper: boolean,
  ctx: PrimitiveContext,
): string {
  const digits = upper ? UPPER : LOWER;
  const sep = DELIMITERS[delimiter] ?? "";
  const length = data.length === 0 ? 0 : data.length * 2 + (data.length - 1) * sep.length;
  guardResult(ctx, 2 * length, "hex text");
  const parts = new Array<string>(data.length);
  for (let i = 0; i < data.length; i++) {
    const b = data[i] as number;
    parts[i] = digits.charAt(b >> 4) + digits.charAt(b & 15);
  }
  return parts.join(sep);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("hex", "decode", "( bytes -- bytes )", decode, {
    doc: "Decode pairs of hex digits (either case); white space between digits is ignored.",
    category: "Encodings",
  }),
  definePrimitive(
    "hex",
    "encode",
    "( bytes delimiter:choice{none|space|colon}=none case:choice{lower|upper}=lower -- str )",
    (data: Uint8Array, delimiter: string, letterCase: string, ctx: PrimitiveContext) =>
      encode(data, delimiter, letterCase === "upper", ctx),
    { doc: "Encode bytes as hex digits, two per byte.", category: "Encodings" },
  ),
];
