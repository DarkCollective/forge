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
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { loadBundleNode } from "../sources-node.js";
import { primitives } from "./unicode.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["unicode"]));

describe("unicode._normalize (the only unicode primitive)", () => {
  test("is the one private primitive", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["unicode:_normalize"]);
  });

  test("a private word cannot be called from another vocabulary", async () => {
    const r = await runtime.run('"e" "nfd" unicode:_normalize');
    expect(r.ok).toBe(false);
  });

  test("an unknown form never reaches the primitive: the choice parameter is refused first", async () => {
    const r = await runtime.call("unicode:normalize", [str("e"), str("nfx")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });
});
