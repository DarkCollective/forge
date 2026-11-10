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
 * Property tests for the `bcd` vocabulary (vocab/bcd.fth, no primitives). Fixed answers are in
 * vocab/bcd.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bcd"]));

let seed = 0xbcd;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const digits = (n: number) =>
  Array.from({ length: n }, () => String(Math.floor(rand() * 10))).join("");

const SCHEMES = ["8421", "7421", "4221", "excess-3"];

async function encode(text: string, scheme: string, packed: boolean, signed: boolean) {
  const r = await runtime.call("bcd:encode", [str(text), str(scheme), bool(packed), bool(signed)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}
async function decode(data: Uint8Array, scheme: string, packed: boolean, signed: boolean) {
  const r = await runtime.call("bcd:decode", [
    bytes(data),
    str(scheme),
    bool(packed),
    bool(signed),
  ]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: string }).v };
}

describe("bcd", () => {
  test("each scheme's code of a digit has the weighted sum (or +3) of that digit", async () => {
    const weights: Record<string, number[]> = {
      "8421": [8, 4, 2, 1],
      "7421": [7, 4, 2, 1],
      "4221": [4, 2, 2, 1],
    };
    for (const scheme of SCHEMES) {
      const enc = (await encode("0123456789", scheme, false, false)).out!;
      expect(enc.length).toBe(10);
      enc.forEach((nib, d) => {
        if (scheme === "excess-3") return expect(nib).toBe(d + 3);
        const w = weights[scheme] as number[];
        const sum = w.reduce((acc, wt, bit) => acc + ((nib >> (3 - bit)) & 1 ? wt : 0), 0);
        expect(sum).toBe(d);
      });
    }
  });

  test("4221 is self-complementary: the code of 9 - d is the complement of the code of d", async () => {
    const enc = (await encode("0123456789", "4221", false, false)).out!;
    for (let d = 0; d < 10; d++) expect(enc[9 - d]).toBe(~(enc[d] as number) & 15);
  });

  test("decode(encode(x)) round trips in every mode", async () => {
    for (let i = 0; i < 80; i++) {
      const scheme = SCHEMES[i % 4] as string;
      const packed = i % 3 !== 0;
      const signed = i % 2 === 0;
      const n = 1 + Math.floor(rand() * 40);
      const sign = signed ? ["", "-"][Math.floor(rand() * 2)] : "";
      const text = sign + digits(n);
      const enc = await encode(text, scheme, packed, signed);
      expect(enc.out).toBeDefined();
      const dec = (await decode(enc.out!, scheme, packed, signed)).out as string;
      // Packed data of an odd digit count (unsigned) or an even one (signed) shows a leading 0.
      const nibbles = n + (signed ? 1 : 0);
      const lead = packed && nibbles % 2 === 1 ? "0" : "";
      expect(dec).toBe(sign + lead + text.slice(sign.length));
    }
  });

  test("a number of digits in the packed data is two per byte", async () => {
    for (const n of [1, 2, 7, 8, 63, 64]) {
      const enc = (await encode(digits(n), "8421", true, false)).out!;
      expect(enc.length).toBe(Math.ceil(n / 2));
    }
  });
});
