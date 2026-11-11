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
 * Tests for the aes-kw primitives (src/prims/aes-kw.ts): the exported private helpers and their argument checks. The
 * RFC 3394 vectors and the words are tested in src/aes-kw.test.ts and vocab/aes-kw.test.json.
 */
import { describe, expect, test } from "vitest";
import { primitives, unwrap, wrap } from "./aes-kw.js";

describe("aes-kw primitives", () => {
  test("are exported as the private helpers _wrap and _unwrap", () => {
    expect(primitives.map((p) => p.name)).toEqual(["_wrap", "_unwrap"]);
  });

  test("wrap and unwrap check the lengths and the key", () => {
    const kek = new Uint8Array(16);
    expect(() => wrap(new Uint8Array(8), kek)).toThrow(/at least 16/);
    expect(() => unwrap(new Uint8Array(16), kek)).toThrow(/at least 24/);
    expect(() => wrap(new Uint8Array(16), new Uint8Array(17))).toThrow(/16, 24 or 32 bytes/);
  });
});
