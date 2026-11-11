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
 * Tests for the `mac` vocabulary (vocab/mac.fth, no primitives): Format MAC addresses. The op vectors
 * (vocab/mac.test.json) hold the cases computed in Python and the example of RFC 4291 appendix A; these tests add
 * random addresses against a model, separators, hostile input and the cost at 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["mac"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};

const format = (
  data: string,
  o: {
    letters?: string;
    none?: boolean;
    dash?: boolean;
    colon?: boolean;
    cisco?: boolean;
    v6?: boolean;
  } = {},
) =>
  runtime.call("mac:format", [
    str(data),
    str(o.letters ?? "both"),
    bool(o.none ?? true),
    bool(o.dash ?? true),
    bool(o.colon ?? true),
    bool(o.cisco ?? false),
    bool(o.v6 ?? false),
  ]);

let seed = 0x3ac1;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);
const randomMac = () => Array.from({ length: 6 }, () => below(256));
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

function model(b: number[], letters: string): string[] {
  const c = b.map(hex2).join("");
  const eui = [b[0]! ^ 2, b[1]!, b[2]!, 0xff, 0xfe, b[3]!, b[4]!, b[5]!].map(hex2).join("");
  const forms = [
    c,
    b.map(hex2).join("-"),
    b.map(hex2).join(":"),
    `${c.slice(0, 4)}.${c.slice(4, 8)}.${c.slice(8)}`,
    `${eui.slice(0, 4)}:${eui.slice(4, 8)}:${eui.slice(8, 12)}:${eui.slice(12)}`,
  ];
  return forms.flatMap((f) =>
    letters === "both" ? [f, f.toUpperCase()] : letters === "upper" ? [f.toUpperCase()] : [f],
  );
}

describe("Format MAC addresses against the model", () => {
  test("random addresses in random notations and cases", async () => {
    for (let i = 0; i < 100; i++) {
      const b = randomMac();
      const letters = ["both", "upper", "lower"][below(3)] as string;
      const text = [
        b.map(hex2).join(":"),
        b.map(hex2).join("-").toUpperCase(),
        b.map(hex2).join(""),
        `${b.slice(0, 2).map(hex2).join("")}.${b.slice(2, 4).map(hex2).join("")}.${b.slice(4).map(hex2).join("")}`,
      ][below(4)] as string;
      const r = out(await format(text, { letters, cisco: true, v6: true }));
      expect(r).toBe(`${model(b, letters).join("\n")}\n`);
    }
  });

  test("separators between addresses", async () => {
    const a = "00:11:22:33:44:55";
    const b = "aa:bb:cc:dd:ee:ff";
    const one = out(await format(`${a}`, { letters: "lower", dash: false, colon: false }));
    const two = out(await format(`${a},${b}`, { letters: "lower", dash: false, colon: false }));
    for (const sep of [" ", ",", "\n", "\r\n", "\t", " , ", ",,\n\n  "]) {
      expect(
        out(await format(`${a}${sep}${b}`, { letters: "lower", dash: false, colon: false })),
        JSON.stringify(sep),
      ).toBe(two);
    }
    expect(two).toBe(
      `${one}\n${out(await format(b, { letters: "lower", dash: false, colon: false }))}`,
    );
  });

  test("addresses that are not addresses", async () => {
    for (const bad of [
      "00:11:22:33:44",
      "00:11:22:33:44:55:66",
      "0011.2233.4455.66",
      "gg:11:22:33:44:55",
      "00:11:22:33:44:5",
      "0x001122334455",
      "00::22:33:44:55",
    ]) {
      expect(code(await format(bad)), bad).toBe("E_COERCE");
    }
  });

  test("a 64 KiB list", { timeout: 60_000 }, async () => {
    const macs = Array.from({ length: 3800 }, () => randomMac().map(hex2).join(":"));
    const text = macs.join("\n");
    expect(text.length).toBeGreaterThan(64 * 1024 - 5000);
    const r = await format(text, { cisco: true, v6: true });
    expect(out(r).split("\n").length).toBe(3800 * 11);
    expect(r.ok && r.steps).toBeLessThan(10_000_000);
    process.stderr.write(
      `\nmac format ${text.length} chars (3800 addresses, 5 notations, both cases): ${r.ok && r.steps} steps\n`,
    );
  });
});

describe("truncated and mutated input", () => {
  test("every prefix of an address is a result or E_COERCE", async () => {
    const seedText = "00:1A:2B:3C:4D:5E, 001a.2b3c.4d5e";
    for (let cut = 0; cut <= seedText.length; cut++)
      expect(["ok", "E_COERCE"]).toContain(
        code(await format(seedText.slice(0, cut), { cisco: true, v6: true })),
      );
  });
});
