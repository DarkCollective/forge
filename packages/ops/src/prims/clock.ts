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
 * clock primitive: `now-ms`, the host clock in whole milliseconds since the Unix epoch (+time). Every other
 * vocabulary that needs the time calls `clock:now-ms` (or `clock:now-s`) instead of keeping a private clock
 * primitive. Date and time formatting is not here (see the datetime vocabulary).
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

/** The current Unix time in whole milliseconds. */
export function nowMs(): number {
  return Date.now();
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("clock", "now-ms", "( -- int )", nowMs, {
    effects: ["+time"],
    doc: "The current time as whole milliseconds since the Unix epoch (1970-01-01T00:00:00Z), from the host clock. Shared word: call it qualified from any vocabulary.",
  }),
];
