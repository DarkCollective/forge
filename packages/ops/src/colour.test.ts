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
 * Tests for the `colour` vocabulary (vocab/colour.fth, no primitives). Known answers are in
 * vocab/colour.test.json; these compare random colours with the formulas of CSS Color Level 4
 * (section 7, sample code hslToRgb, and the usual RGB to HSL) in floating point, and read every
 * notation of the same colour.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["colour", "raise"]));

const parse = async (data: string) => {
  const r = await runtime.call("colour:parse", [str(data)]);
  if (!r.ok) throw new Error(`${data}: ${JSON.stringify(r.error)}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const lines = (text: string) =>
  Object.fromEntries(
    text.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
  );

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

/** CSS Color 4, section 7: hue in degrees, s and l in 0 to 1 -> channels in 0 to 1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
/** hue, saturation and lightness (degrees, percent) of 8-bit channels, from the CSS definitions with the divisions kept on whole numbers so that ties are exact. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (100 * (mx + mn)) / 510;
  if (d === 0) return [0, 0, l];
  const s = (100 * d) / (255 - Math.abs(mx + mn - 255));
  let h: number;
  if (mx === r) h = (60 * (g - b)) / d;
  else if (mx === g) h = (60 * (b - r)) / d + 120;
  else h = (60 * (r - g)) / d + 240;
  return [((h % 360) + 360) % 360, s, l];
}
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

describe("colour:parse", () => {
  test("RGB to HSL and CMYK agrees with the CSS formulas", async () => {
    const next = lcg(21);
    for (let i = 0; i < 60; i++) {
      const [r, g, b] = [next() % 256, next() % 256, next() % 256] as [number, number, number];
      const out = lines(await parse(`rgb(${r}, ${g}, ${b})`));
      const [h, s, l] = rgbToHsl(r, g, b);
      expect(out.HSL, `${r} ${g} ${b}`).toBe(
        `hsl(${Math.round(h) % 360}, ${Math.round(s)}%, ${Math.round(l)}%)`,
      );
      const k = 1 - Math.max(r, g, b) / 255;
      const m = Math.max(r, g, b) / 255;
      const c = m === 0 ? 0 : (m - r / 255) / m;
      const mg = m === 0 ? 0 : (m - g / 255) / m;
      const y = m === 0 ? 0 : (m - b / 255) / m;
      expect(out.CMYK, `${r} ${g} ${b}`).toBe(
        `cmyk(${Math.round(c * 100)}%, ${Math.round(mg * 100)}%, ${Math.round(y * 100)}%, ${Math.round(k * 100)}%)`,
      );
      expect(out.Hex).toBe(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
    }
  });

  test("HSL to RGB agrees with the CSS sample code", async () => {
    const next = lcg(22);
    for (let i = 0; i < 60; i++) {
      const h = next() % 720;
      const s = next() % 101;
      const l = next() % 101;
      const out = lines(await parse(`hsl(${h} ${s}% ${l}%)`));
      const [r, g, b] = hslToRgb(h, s / 100, l / 100).map((x) => Math.round(x * 255)) as [
        number,
        number,
        number,
      ];
      expect(out.RGB, `${h} ${s} ${l}`).toBe(`rgb(${r}, ${g}, ${b})`);
    }
  });

  test("every notation of one colour gives the same report", async () => {
    const want = await parse("#336699");
    for (const t of [
      "336699",
      "#369",
      "  #336699  ",
      "rgb(51,102,153)",
      "RGB(20% 40% 60%)",
      "rgba(51, 102, 153, 1)",
      "hsl(210, 50%, 40%)",
      "hsl(210deg 50% 40%)",
      "hsla(570, 50%, 40%, 100%)",
    ])
      expect(await parse(t), t).toBe(want);
  });

  test("alpha is read as a number or a percentage", async () => {
    expect(lines(await parse("rgba(0 0 0 / 50%)")).RGBA).toBe("rgba(0, 0, 0, 0.5)");
    expect(lines(await parse("rgba(0, 0, 0, .5)")).RGBA).toBe("rgba(0, 0, 0, 0.5)");
    expect(lines(await parse("rgba(0, 0, 0, 0.05)")).RGBA).toBe("rgba(0, 0, 0, 0.05)");
    expect(lines(await parse("#00000080")).Hex).toBe("#00000080");
    expect(lines(await parse("#000000ff")).Hex).toBe("#000000");
  });

  test("the reports of the 16 corners of the colour cube are exact", async () => {
    for (const r of [0, 255])
      for (const g of [0, 255])
        for (const b of [0, 255]) {
          const out = lines(await parse(`#${hex2(r)}${hex2(g)}${hex2(b)}`));
          expect(out.RGB).toBe(`rgb(${r}, ${g}, ${b})`);
          expect(out.CMYK).toMatch(/^cmyk\((0|100)%, (0|100)%, (0|100)%, (0|100)%\)$/);
        }
  });
});
