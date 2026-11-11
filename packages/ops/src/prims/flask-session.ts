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
 * flask-session primitive: `_now`, the current Unix time in seconds (+time), the one thing FL cannot read. It
 * is the same clock as `fernet:_now` (the function is shared from ./fernet.js) under this vocabulary's own
 * private name, because a private word cannot be called from another vocabulary. `flask-session:sign` uses it
 * only when no timestamp is given; the construction itself (`_sign`) takes the time as an argument.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { now } from "./fernet.js";

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("flask-session", "_now", "( -- int )", now, {
    effects: ["+time"],
    doc: "The current Unix time in seconds (private helper of flask-session:sign).",
    category: "Encryption",
  }),
];
