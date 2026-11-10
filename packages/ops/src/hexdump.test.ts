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
 * Property tests for the `hexdump` vocabulary (vocab/hexdump.fth, no primitives). Fixed answers,
 * taken from xxd and hexdump -C, are in vocab/hexdump.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["hexdump"]));

let seed = 0x4e7d;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randBytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));

async function encode(data: Uint8Array, width: number, letterCase: string, ascii: boolean) {
  const r = await runtime.call("hexdump:encode", [
    bytes(data),
    int(width),
    str(letterCase),
    bool(ascii),
  ]);
  if (!r.ok) throw new Error(r.error.message);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
}
async function decode(text: string) {
  const r = await runtime.call("hexdump:decode", [str(text)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("hexdump", () => {
  test("decode(encode(x)) is x for every width, case and ASCII setting", async () => {
    for (let i = 0; i < 80; i++) {
      const data = randBytes(Math.floor(rand() * 200));
      const width = 1 + Math.floor(rand() * 64);
      const text = await encode(data, width, i % 2 ? "upper" : "lower", i % 3 !== 0);
      expect((await decode(text)).out).toEqual(data);
    }
  });

  test("the ASCII column of random bytes, which may contain spaces, | and :, is ignored", async () => {
    for (let i = 0; i < 40; i++) {
      const data = Uint8Array.from({ length: 33 }, () => 0x20 + Math.floor(rand() * 95));
      expect((await decode(await encode(data, 16, "lower", true))).out).toEqual(data);
    }
  });

  test("the ASCII column starts at the same place on every line, and there are ceil(n / width) lines", async () => {
    for (const [n, width] of [
      [1, 16],
      [16, 16],
      [17, 16],
      [100, 7],
      [5, 64],
    ] as const) {
      const lines = (await encode(randBytes(n), width, "lower", true)).split("\n");
      expect(lines.length).toBe(Math.ceil(n / width));
      // offset and ": " (10), the hex field of a full line, two spaces, then one character per byte.
      const column = 10 + 2 * width + Math.ceil(width / 2) - 1 + 2;
      lines.forEach((line, i) => {
        expect(line.slice(column - 2, column)).toBe("  ");
        expect(line.length).toBe(column + Math.min(width, n - i * width));
      });
    }
  });

  test("hexdump -C layout, with a middle gap and bars around the ASCII column", async () => {
    const text =
      "00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a 7c 7c  |Hello, world!.||| |\n" +
      "00000010\n";
    const expected = Uint8Array.from([..."Hello, world!\n||"].map((c) => c.charCodeAt(0)));
    expect((await decode(text)).out).toEqual(expected);
  });

  test("64 KiB at width 16", async () => {
    const data = randBytes(65536);
    const t0 = Date.now();
    const text = await encode(data, 16, "lower", true);
    const t1 = Date.now();
    const back = (await decode(text)).out;
    const t2 = Date.now();
    console.log(`hexdump 64 KiB width 16: encode ${t1 - t0} ms, decode ${t2 - t1} ms`);
    expect(back).toEqual(data);
  }, 60_000);
});
