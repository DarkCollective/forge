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
 * Tests for the `objectid` vocabulary (vocab/objectid.fth, no primitives). Known answers are in
 * vocab/objectid.test.json; these compare the whole-number calendar with the host's Date for
 * random timestamps and for every day boundary around leap years.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["objectid", "raise"]));

const stamp = async (secs: number, rest = "000000000000000000") => {
  const r = await runtime.call("objectid:timestamp", [
    str(secs.toString(16).padStart(8, "0") + rest.slice(0, 16)),
  ]);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};

describe("objectid:timestamp", () => {
  test("agrees with Date for random timestamps", async () => {
    let s = 99;
    for (let i = 0; i < 60; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      expect(await stamp(s), String(s)).toBe(new Date(s * 1000).toISOString());
    }
  });

  test("agrees with Date at midnight and one second either side, around leap years", async () => {
    for (const day of [
      "1999-12-31",
      "2000-02-28",
      "2000-03-01",
      "2023-02-28",
      "2024-02-28",
      "2024-12-31",
      "2100-02-28",
      "2100-03-01",
    ]) {
      const midnight = Date.parse(`${day}T00:00:00Z`) / 1000;
      for (const t of [
        midnight - 1,
        midnight,
        midnight + 1,
        midnight + 86400 - 1,
        midnight + 86400,
      ]) {
        expect(await stamp(t), `${day} ${t}`).toBe(new Date(t * 1000).toISOString());
      }
    }
  });

  test("the rest of the id is ignored, and the digits may be upper case", async () => {
    const a = await stamp(1350508407, "ffffffffffffffff");
    const b = await stamp(1350508407, "0000000000000000");
    expect(a).toBe(b);
    const r = await runtime.call("objectid:timestamp", [str("507F1F77BCF86CD799439011")]);
    expect(r.ok).toBe(true);
  });
});
