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
 * Tests for the `parity` vocabulary (vocab/parity.fth, no primitives). Known answers are in
 * vocab/parity.test.json; these check round trips, the parity property itself, and 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["parity", "raise"]));

async function text(word: string, args: Parameters<typeof runtime.call>[1]) {
  const r = await runtime.call(word, args);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { out: (r.stack[r.stack.length - 1] as { v: string }).v, steps: r.steps };
}
const encode = (bits: string, mode: string, pos: string, delim: string) =>
  text("parity:encode", [str(bits), str(mode), str(pos), str(delim)]);
const decode = (bits: string, mode: string, pos: string, delim: string, verify = true) =>
  text("parity:decode", [str(bits), str(mode), str(pos), str(delim), bool(verify)]);

function randBits(n: number, seed: number): string {
  let s = seed >>> 0;
  let out = "";
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += s >>> 31 === 1 ? "1" : "0";
  }
  return out;
}
const ones = (s: string) => [...s].filter((c) => c === "1").length;

describe("parity", () => {
  test("the encoded block has an even (odd) number of 1 bits, and decode inverts encode", async () => {
    for (const mode of ["even", "odd"]) {
      for (const pos of ["start", "end"]) {
        for (let n = 1; n < 20; n++) {
          const bits = randBits(n, n + 1);
          const enc = (await encode(bits, mode, pos, "")).out;
          expect(ones(enc) % 2).toBe(mode === "even" ? 0 : 1);
          expect(enc.length).toBe(bits.length + 1);
          expect((await decode(enc, mode, pos, "")).out).toBe(bits);
        }
      }
    }
  });

  test("blocks with a delimiter round trip", async () => {
    const bits = Array.from({ length: 50 }, (_, i) => randBits(8, i + 3)).join(" ");
    const enc = (await encode(bits, "odd", "end", " ")).out;
    expect(enc.split(" ").every((b) => b.length === 9 && ones(b) % 2 === 1)).toBe(true);
    expect((await decode(enc, "odd", "end", " ")).out).toBe(bits);
  });

  test("65536 bits, as one block and as 8192 blocks, fit well inside the default limits", async () => {
    // Measured: about 0.46 million steps (encode) and 0.54 million (verifying decode) for 8192 blocks of 8 bits; a single block is a handful of
    // steps. The default limit is 10 million.
    const bits = randBits(65536, 17);
    const one = await encode(bits, "even", "end", "");
    expect(one.out.length).toBe(65537);
    expect((await decode(one.out, "even", "end", "")).out).toBe(bits);
    const spaced = (bits.match(/.{8}/g) as string[]).join(",");
    const enc = await encode(spaced, "even", "end", ",");
    expect(enc.steps).toBeLessThan(5_000_000);
    const dec = await decode(enc.out, "even", "end", ",");
    expect(dec.out).toBe(spaced);
    expect(dec.steps).toBeLessThan(5_000_000);
  }, 60_000);
});
