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
 * unicode primitives. Only `_normalize` is a primitive: the core has no Unicode normalisation (the
 * composition and decomposition tables of UAX #15 are far too large to carry in FL). It is a thin
 * wrapper over String.prototype.normalize; the op `unicode:normalize` and its metadata are FL
 * (vocab/unicode.fth). The name starts with `_`, so the word is private and not an operation.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { guardResult, rangeFailure } from "../prim-util.js";

const FORMS: Readonly<Record<string, "NFC" | "NFD" | "NFKC" | "NFKD">> = {
  nfc: "NFC",
  nfd: "NFD",
  nfkc: "NFKC",
  nfkd: "NFKD",
};

function normalizeText(text: string, form: string, ctx: PrimitiveContext): string {
  const f = FORMS[form];
  if (f === undefined) throw rangeFailure(`unknown normalisation form '${form}'`);
  const out = text.normalize(f);
  guardResult(ctx, 2 * out.length, "normalised text");
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("unicode", "_normalize", "( str form:str -- str )", normalizeText, {
    doc: "Unicode normalisation (UAX #15) to nfc, nfd, nfkc or nfkd (private helper of unicode:normalize).",
    category: "Text",
  }),
];
