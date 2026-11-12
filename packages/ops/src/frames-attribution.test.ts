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
/*
 * LANGUAGE-0.2.md section 14: an error raised far below `bake:main` still carries the frame of the
 * compiled recipe word (the outermost 32 frames are kept), so the baker attributes it to a step path.
 */
import { createInProcessBaker } from "@forge/worker";
import { describe, expect, test } from "vitest";
import { loadBundleNode } from "./sources-node.js";

const DEEP = `IN: mine
: _dive ( n:int -- )
  n 0 > [ n 1 - recurse ] [ "boom" fail ] if ;
: deep ( bytes -- bytes )
  "Raises an error 70 levels down." doc
  "Test" category
  70 _dive ;
`;

const recipe = {
  forge: 1,
  steps: [
    { kind: "op", op: "text:upper" },
    { kind: "op", op: "mine:deep" },
  ],
};

describe("section 14: frames and step attribution", () => {
  test("an error raised 70 levels below bake:main gets a step path", async () => {
    const baker = createInProcessBaker({ loadBundle: loadBundleNode });
    await baker.init({ units: [{ name: "mine.fth", source: DEEP }] });
    const r = await baker.bake(recipe, new TextEncoder().encode("abc"), { trust: "trusted" });
    if (r.ok) throw new Error("expected a failure");
    expect(r.error.code, r.error.message).toBe("E_USER");
    expect(r.error.path).toBe("/steps/1");
    await baker.dispose();
  });
});
