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
 * Tests for the `units` vocabulary (vocab/units.fth, no primitives). Known answers are in
 * vocab/units.test.json; these compare random inputs with an independent exact-rational reference
 * (BigInt long division) and check the number reader and the rounding edges.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["units", "raise"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const conv = async (op: string, value: string, from: string, to: string, digits = 20) =>
  top(await runtime.call(`units:${op}`, [str(value), str(from), str(to), int(digits)])) as string;

interface Ratio {
  n: bigint;
  d: bigint;
}
const dec = (s: string): Ratio => {
  const [i = "", f = ""] = s.split(".");
  return { n: BigInt(i + f), d: 10n ** BigInt(f.length) };
};
const mul = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.n, d: a.d * b.d });
const div = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.d, d: a.d * b.n });
const whole = (x: bigint | number): Ratio => ({ n: BigInt(x), d: 1n });

/** r to `sig` significant digits, halves away from zero, plain decimal text (long division). */
function show(r: Ratio, sig: number): string {
  let { n } = r;
  const { d } = r;
  const neg = n < 0n;
  if (neg) n = -n;
  if (n === 0n) return "0";
  const ge = (x: number) => (x >= 0 ? n >= d * 10n ** BigInt(x) : n * 10n ** BigInt(-x) >= d);
  let e = n.toString().length - d.toString().length;
  while (ge(e + 1)) e++;
  while (!ge(e)) e--;
  const sn = e >= 0 ? n : n * 10n ** BigInt(-e);
  const sd = e >= 0 ? d * 10n ** BigInt(e) : d;
  let digits = "";
  let rem = sn;
  for (let i = 0; i < sig; i++) {
    digits += (rem / sd).toString();
    rem = (rem % sd) * 10n;
  }
  let num = BigInt(digits);
  if (rem >= sd * 5n) num += 1n;
  const s = num.toString();
  const point = e + 1 + (s.length - sig);
  let out: string;
  if (point <= 0) out = "0." + "0".repeat(-point) + s;
  else if (point >= s.length) out = s + "0".repeat(point - s.length);
  else out = s.slice(0, point) + "." + s.slice(point);
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return (neg ? "-" : "") + out;
}

const inch = dec("0.0254");
const foot = mul(inch, whole(12));
const yard = mul(foot, whole(3));
const mile = mul(yard, whole(1760));
const lb = dec("0.45359237");

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

describe("the number reader", () => {
  test("accepts signs, points and exponents", async () => {
    expect(await conv("convert-distance", ".5", "metre", "metre")).toBe("0.5");
    expect(await conv("convert-distance", "5.", "metre", "metre")).toBe("5");
    expect(await conv("convert-distance", "  12  ", "metre", "metre")).toBe("12");
    expect(await conv("convert-distance", "1E3", "metre", "kilometre")).toBe("1");
    expect(await conv("convert-distance", "1.5e-3", "kilometre", "metre")).toBe("1.5");
    expect(await conv("convert-distance", "-0", "metre", "foot")).toBe("0");
    expect(await conv("convert-distance", "007", "metre", "metre")).toBe("7");
  });

  test("refuses anything else", async () => {
    for (const bad of [
      "",
      ".",
      "e5",
      "1e",
      "1e+",
      "1,5",
      "1 2",
      "0x10",
      "1e2.5",
      "--1",
      "NaN",
      "1/2",
    ]) {
      const r = await runtime.call("units:convert-distance", [
        str(bad),
        str("metre"),
        str("foot"),
        int(20),
      ]);
      expect(code(r), bad).toBe("E_COERCE");
    }
    const r = await runtime.call("units:convert-distance", [
      str("1e401"),
      str("metre"),
      str("foot"),
      int(20),
    ]);
    expect(code(r)).toBe("E_RANGE");
  });

  test("a very large number is exact", async () => {
    expect(await conv("convert-mass", "1" + "0".repeat(60), "kilogram", "kilogram", 60)).toBe(
      "1" + "0".repeat(60),
    );
    expect(await conv("convert-data", "123456789012345678901234567890", "bit", "bit", 30)).toBe(
      "123456789012345678901234567890",
    );
  });
});

describe("agrees with an independent exact reference", () => {
  test("random distances, masses and data sizes", async () => {
    const next = lcg(7);
    const dist: [string, Ratio][] = [
      ["metre", whole(1)],
      ["inch", inch],
      ["foot", foot],
      ["mile", mile],
      ["fathom", mul(yard, whole(2))],
      ["nautical-mile", whole(1852)],
    ];
    const mass: [string, Ratio][] = [
      ["kilogram", whole(1)],
      ["pound", lb],
      ["ounce", div(lb, whole(16))],
      ["stone", mul(lb, whole(14))],
      ["gram", dec("0.001")],
    ];
    for (let i = 0; i < 40; i++) {
      const value = `${next() % 100000}.${String(next() % 1000).padStart(3, "0")}`;
      const sig = 1 + (next() % 25);
      const [fa, fr] = dist[next() % dist.length] as [string, Ratio];
      const [ta, tr] = dist[next() % dist.length] as [string, Ratio];
      expect(
        await conv("convert-distance", value, fa, ta, sig),
        `${value} ${fa} ${ta} ${sig}`,
      ).toBe(show(div(mul(dec(value), fr), tr), sig));
      const [fb, gr] = mass[next() % mass.length] as [string, Ratio];
      const [tb, hr] = mass[next() % mass.length] as [string, Ratio];
      expect(await conv("convert-mass", value, fb, tb, sig), `${value} ${fb} ${tb} ${sig}`).toBe(
        show(div(mul(dec(value), gr), hr), sig),
      );
    }
  });

  test("converting there and back is exact for terminating ratios", async () => {
    for (const [op, a, b] of [
      ["convert-distance", "inch", "centimetre"],
      ["convert-mass", "pound", "gram"],
      ["convert-area", "acre", "square-metre"],
      ["convert-speed", "mile-per-hour", "metre-per-second"],
      ["convert-data", "kibibyte", "bit"],
    ] as const) {
      const there = await conv(op, "123.456", a, b, 40);
      expect(await conv(op, there, b, a, 40), `${op} ${a} ${b}`).toBe("123.456");
    }
  });
});

describe("rounding", () => {
  test("halves go away from zero", async () => {
    expect(await conv("convert-distance", "2.5", "metre", "metre", 1)).toBe("3");
    expect(await conv("convert-distance", "-2.5", "metre", "metre", 1)).toBe("-3");
    expect(await conv("convert-distance", "0.125", "metre", "metre", 2)).toBe("0.13");
    expect(await conv("convert-distance", "1250", "metre", "metre", 2)).toBe("1300");
  });

  test("never uses exponent form", async () => {
    const small = await conv("convert-distance", "1", "angstrom", "light-year", 5);
    expect(small).toBe(show(div(dec("0.0000000001"), whole(9460730472580800n)), 5));
    expect(small).toMatch(/^0\.0{20,}[1-9]\d*$/);
    const big = await conv("convert-distance", "1", "light-year", "angstrom", 5);
    expect(big).toBe("94607000000000000000000000");
  });
});
