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
 * Property tests for the `float` vocabulary (vocab/float.fth, with the private primitives `_pack`
 * and `_unpack`). Fixed answers, from Python's struct module, are in vocab/float.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["float"]));

let seed = 0xf10a7;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** A random finite double over a wide range of magnitudes. */
function randDouble(): number {
  const sign = rand() < 0.5 ? -1 : 1;
  return sign * rand() * 10 ** (Math.floor(rand() * 600) - 300);
}

async function encode(text: string, size: string, endian: string) {
  const r = await runtime.call("float:encode", [str(text), str(size), str(endian)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}
async function decode(data: Uint8Array, size: string, endian: string) {
  const r = await runtime.call("float:decode", [bytes(data), str(size), str(endian)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: string }).v };
}

describe("float", () => {
  test("binary64: encode matches DataView, and decode(encode(x)) reads back as x", async () => {
    for (let i = 0; i < 100; i++) {
      const x = randDouble();
      const little = i % 2 === 0;
      const enc = (await encode(String(x), "64", little ? "little" : "big")).out!;
      const expected = new Uint8Array(8);
      new DataView(expected.buffer).setFloat64(0, x, little);
      expect(enc).toEqual(expected);
      const text = (await decode(enc, "64", little ? "little" : "big")).out!;
      expect(Number(text)).toBe(x);
      expect(text).toBe(String(x));
    }
  });

  test("binary32: decode gives the shortest text that reads back, at most 9 digits", async () => {
    for (let i = 0; i < 200; i++) {
      const x = Math.fround(randDouble() * 1e-290 * 10 ** Math.floor(rand() * 60));
      if (!Number.isFinite(x) || x === 0) continue;
      const enc = (await encode(String(x), "32", "big")).out!;
      expect(enc.length).toBe(4);
      const text = (await decode(enc, "32", "big")).out!;
      expect(Math.fround(Number(text))).toBe(x);
      // No shorter prefix of the significant digits reads back as x.
      const digits = text
        .replace(/e.*$/, "")
        .replace(/[-.]/g, "")
        .replace(/^0+/, "")
        .replace(/0+$/, "");
      expect(digits.length).toBeLessThanOrEqual(9);
      if (digits.length > 1 && x !== 0) {
        expect(Math.fround(Number(x.toPrecision(digits.length - 1)))).not.toBe(x);
      }
    }
  });

  test("several values: the numbers are concatenated and decode separates them with one space", async () => {
    const values = Array.from({ length: 20 }, randDouble);
    const enc = (await encode(values.join(", "), "64", "big")).out!;
    expect(enc.length).toBe(160);
    expect((await decode(enc, "64", "big")).out).toBe(values.join(" "));
  });

  test("special values survive a round trip in both sizes and byte orders", async () => {
    for (const size of ["32", "64"]) {
      for (const endian of ["big", "little"]) {
        const enc = (await encode("NaN Infinity -Infinity -0 0", size, endian)).out!;
        expect((await decode(enc, size, endian)).out).toBe("NaN Infinity -Infinity -0 0");
      }
    }
  });

  test("64 KiB each way", async () => {
    const values = Array.from({ length: 8192 }, randDouble);
    const enc = (await encode(values.join(" "), "64", "big")).out!;
    const text = (await decode(enc, "64", "big")).out!;
    expect(text).toBe(values.join(" "));
  }, 60_000);
});
