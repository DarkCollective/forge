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
 * charset primitive. Only `_decode` is a primitive: the FL core has no legacy character decoders
 * (Shift_JIS, GBK, windows-125x, ...), and the browser's `TextDecoder` has them built in. It is a thin
 * wrapper: the encoding choice, the single-byte tables, the EBCDIC tables, `charset:encode` and the
 * brute force are all FL (vocab/charset.fth). The name starts with `_`, so the word is private and not
 * an operation.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { coerceFailure, guardResult, rangeFailure } from "../prim-util.js";

// The package builds against ES2022 only (no DOM or Node typings), so declare the one global used.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

/**
 * Decode `data` with the WHATWG Encoding Standard decoder for `label`. A byte order mark is kept
 * (`ignoreBOM`), so text that starts with U+FEFF round-trips. With `fatal` an undecodable sequence is
 * `E_COERCE`; without it, U+FFFD replaces the sequence.
 */
function decode(data: Uint8Array, label: string, fatal: boolean, ctx: PrimitiveContext): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label, { fatal, ignoreBOM: true });
  } catch {
    throw rangeFailure(`'${label}' is not an encoding this host can decode`, { label });
  }
  // No decoder yields more than one UTF-16 code unit per input byte, so this bounds the result.
  guardResult(ctx, 2 * data.length, "decoded text");
  try {
    return decoder.decode(data);
  } catch {
    throw coerceFailure("bytes", "str", `the bytes are not valid ${label}`);
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("charset", "_decode", "( bytes label:str fatal:bool -- str )", decode, {
    doc: "Decode bytes with the WHATWG decoder for an encoding label (private helper of charset:decode). With fatal, invalid input is E_COERCE; otherwise U+FFFD replaces it.",
    category: "Encodings",
  }),
];
