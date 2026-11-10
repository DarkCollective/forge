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
 * analysis primitives. Only `_log2` is a primitive: the core vocabulary has no logarithm, and the
 * entropy word needs one. Everything else in the `analysis` vocabulary is written in FL
 * (vocab/analysis.fth). The name starts with `_`, so the word is private and not an operation.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("analysis", "_log2", "( x:num -- num )", (x: number) => Math.log2(x), {
    doc: "Base-2 logarithm of a positive number (private helper of analysis:entropy).",
    category: "Analysis",
  }),
];
