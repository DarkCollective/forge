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
 * coords primitives. The core vocabulary has no trigonometric or hyperbolic functions, and the map
 * projection (UTM) and the great-circle distance need them, so two private helpers supply them:
 * `_math` (one argument) and `_atan2`. Everything else in the `coords` vocabulary is FL.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  asinh: Math.asinh,
  atanh: Math.atanh,
};

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "coords",
    "_math",
    "( x:num name:str -- num )",
    (x: number, name: string) => {
      const f = FUNCTIONS[name];
      if (f === undefined) throw rangeFailure(`unknown function ${name}`);
      return f(x);
    },
    {
      doc: "A trigonometric or hyperbolic function by name (sin cos tan asin atan sinh cosh asinh atanh), in radians (private helper of coords).",
      category: "Conversions",
    },
  ),
  definePrimitive(
    "coords",
    "_atan2",
    "( y:num x:num -- num )",
    (y: number, x: number) => Math.atan2(y, x),
    {
      doc: "The angle of the point (x, y) in radians, from -pi to pi (private helper of coords).",
      category: "Conversions",
    },
  ),
];
