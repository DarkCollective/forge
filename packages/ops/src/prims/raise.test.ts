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
import { buildCatalogue } from "../catalogue.js";
import { loadBundleNode } from "../sources-node.js";
import { primitives } from "./raise.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["raise"]));

describe("raise", () => {
  test("defines coerce and range with doc and category", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["raise:coerce", "raise:range"]);
    for (const p of primitives) expect(p.doc).toBeTruthy();
  });

  test("raise:coerce raises E_COERCE with the reason", async () => {
    const r = await runtime.call("raise:coerce", [str("why")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.detail.reason).toBe("why");
    }
  });

  test("raise:range raises E_RANGE with the reason", async () => {
    const r = await runtime.call("raise:range", [str("bad")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_RANGE");
  });

  test("the words are not catalogue operations", () => {
    const catalogue = buildCatalogue(runtime);
    expect(catalogue.ops.filter((o) => o.qname.startsWith("raise:"))).toEqual([]);
  });
});
