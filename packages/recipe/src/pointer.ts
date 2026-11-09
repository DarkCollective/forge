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
/** RFC 6901 JSON pointer helpers (RECIPES.md section 3.7). */

/** Escape one reference token: `~` becomes `~0`, `/` becomes `~1`. */
export function escapePointer(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** The inverse of `escapePointer`: `~1` becomes `/`, then `~0` becomes `~`. */
export function unescapePointer(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** `base` + `/` + the escaped token. */
export function childPointer(base: string, token: string | number): string {
  return `${base}/${escapePointer(String(token))}`;
}
