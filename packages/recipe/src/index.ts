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
export type * from "./types.js";
export {
  DEFAULT_RECIPE_VOCAB,
  DEFAULT_RECIPE_WORD,
  NAMED_INPUT_OPS,
  NAMED_INPUT_PARAM,
  RECIPE_FORMAT_VERSION,
  RECIPE_ISSUE_CODES,
  RECIPE_LIMITS,
  RECIPE_VOCAB,
  RECUR_OP,
  SHARE_ERROR_CODES,
  SHARE_FORMAT_VERSION,
  SHARE_LIMITS,
  SLOT_FAMILIES,
  SLOT_NAMES,
  STEP_KINDS,
} from "./types.js";
export { validateRecipe } from "./validate.js";
export { canonicalRecipe, normaliseRecipe, pinRecipe, resolveRecipe } from "./normalise.js";
export { compileRecipe } from "./compile.js";
export { attributeError, recipeNeedsHardKill, resolveStepIps } from "./stepmap.js";
export { parseRecipeText } from "./text.js";
export { decodeShare, encodeShare } from "./share.js";
export {
  REGISTER_NAME_RE,
  isRegisterRef,
  recipeUsesV11,
  registerInfo,
  registersInScope,
} from "./registers.js";
export type { RegisterInfo } from "./registers.js";
export { dataSourcePath, inputNames, recipeUsesSlots, recipeUsesV12 } from "./uses.js";
export type { InputName, UsesV12Options } from "./uses.js";
export { escapePointer, unescapePointer } from "./pointer.js";
export { decodeEncoded, encodeBytes } from "./encoding.js";
