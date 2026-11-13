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

/* `@forge/ops/checks`: the pure check evaluator (WP 6.23). No vocabulary, no primitive, no bundle. */
export { BINARY_MIN_BYTES, CHECK_PREFIX_BYTES, UTF8_WHOLE_CAP } from "./limits.js";
export { CheckView, dataView, isCheckView, isPrintableCodePoint } from "./data.js";
export type { Utf8Validity } from "./data.js";
export { evaluateChecks, evaluateTest, expectedName, scoreChecks } from "./evaluate.js";
export type { CheckEvaluation, CheckResult, CheckScope } from "./evaluate.js";
