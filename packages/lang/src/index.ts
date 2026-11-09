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
export const FORGE_LANG_VERSION = "0.0.0";
export type * from "./types.js";
export { DEFAULT_LIMITS } from "./types.js";
export {
  ERROR_CODES,
  ForgeError,
  MAX_SNAPSHOT,
  REDACTED,
  formatErrorMessage,
  isCatchable,
  isCatchableError,
  isForgeError,
  redactDetail,
  redactKeySlots,
  redactSnapshot,
  redactValue,
} from "./errors.js";
export {
  bool,
  bytes,
  codePoints,
  coerce,
  coerceTracked,
  constraintText,
  cpAt,
  cpCompare,
  cpLength,
  cpOffset,
  cpSlice,
  display,
  equals,
  hasLoneSurrogate,
  int,
  intBitLength,
  isSecret,
  list,
  markSecret,
  normaliseInt,
  num,
  optionsText,
  quoteString,
  record,
  repr,
  reprShort,
  runtimeTypeOf,
  sizeOf,
  str,
  validate,
  valueHelpers,
} from "./values.js";
export type { CoerceResult } from "./values.js";
export { read } from "./reader.js";
