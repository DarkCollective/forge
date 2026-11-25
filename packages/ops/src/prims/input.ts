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
 * The primitive of the input vocabulary (vocab/input.fth): `_read`, the one reader of the named tabs of a bake
 * (RECIPES-1.2.md section 7.3). It asks the host that the baker installs for the bake (src/input-host.ts). A name
 * the bake does not have, or a runtime with no host, is E_PARAM_INVALID with the shape of section 7.4; the word that
 * calls it (input:tab, and through it relix:input) is the one the error names.
 */
import { ForgeError, definePrimitive } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef } from "@forge/lang";
import { inputHostFor, noSuchInputDetail, noSuchInputMessage } from "../input-host.js";

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "input",
    "_read",
    "( tab:str -- bytes )",
    (tab: string, ctx: PrimitiveContext): Uint8Array => {
      const host = inputHostFor(ctx.signal);
      const found = host?.read(tab);
      if (found === undefined) {
        throw new ForgeError({
          code: "E_PARAM_INVALID",
          message: noSuchInputMessage(tab),
          detail: noSuchInputDetail(tab, host?.names() ?? []),
        });
      }
      // A copy, so that no step can change the page's bytes; the VM meters it as a new value.
      return found.slice();
    },
    {
      doc: "The raw bytes of the input tab with this exact name, from the named inputs of the bake (private helper of input:tab).",
      category: "Input",
    },
  ),
];
