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
 * The one primitive of the magic vocabulary (vocab/magic.fth): `identifyData` of the content checks
 * (src/checks/identify.ts), which is the evaluator itself and so the justified helper under the FL-first
 * rule. Pure: it looks at a bounded prefix, runs no operation and does no search. It is not a regex-engine
 * primitive of the recipe runtime (the evaluator's fixed patterns are its own), so no word of the
 * vocabulary needs a hard kill.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { identifyData } from "../checks/identify.js";

const { str } = valueHelpers;

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "magic",
    "_identity",
    "( data:bytes -- list )",
    (data: Uint8Array) => {
      const found = identifyData(data);
      return found === null ? [str("unknown"), str("unknown")] : [str(found.id), str(found.family)];
    },
    {
      doc: "The id and the family of the most specific identification of the data, as a list of two strings, both unknown when there is none (private helper of magic:identify and magic:is-format).",
      category: "Forensics",
    },
  ),
];
