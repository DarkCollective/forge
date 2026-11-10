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
 * raise: words that raise typed errors from FL, which has only `fail` (E_USER).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "raise",
    "coerce",
    "( reason:str -- )",
    (reason: string) => {
      throw coerceFailure("str", "bytes", reason);
    },
    {
      doc: "Raise E_COERCE: the data cannot be read as the format (text that does not decode).",
      category: "Errors",
    },
  ),
  definePrimitive(
    "raise",
    "range",
    "( reason:str -- )",
    (reason: string) => {
      throw rangeFailure(reason);
    },
    { doc: "Raise E_RANGE: an argument has a bad value.", category: "Errors" },
  ),
];
