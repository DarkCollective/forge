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
 * The bounds of the check evaluator (PLAN.md WP 6.23). Each is one constant, so a consumer and a
 * test read the same number.
 */

/** Regex, charset, entropy and printable tests look only at this many leading bytes. */
export const CHECK_PREFIX_BYTES = 4096;

/** `utf8` and `binary` look at the whole data up to this size (1 MiB); above it they are `unknown`. */
export const UTF8_WHOLE_CAP = 1_048_576;

/** `binary` is `unknown` for data shorter than this: a few random bytes can be valid UTF-8 by chance. */
export const BINARY_MIN_BYTES = 16;
