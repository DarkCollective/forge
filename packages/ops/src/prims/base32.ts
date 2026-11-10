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
 * base32: the only TypeScript this vocabulary needs is a private helper that raises a typed error,
 * because FL has no word that raises E_COERCE. The operations are in `vocab/base32.fth`.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure } from "../prim-util.js";

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "base32",
    "_coerce-fail",
    "( reason:str -- )",
    (reason: string) => {
      throw coerceFailure("str", "bytes", reason);
    },
    { doc: "Raise E_COERCE: the text cannot be decoded.", category: "Encodings" },
  ),
];
