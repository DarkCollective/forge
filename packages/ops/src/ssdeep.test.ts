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
 * Tests for the `ssdeep` vocabulary (vocab/ssdeep.fth, with the private primitive `_pieces`).
 * The fixed answers that can be cited (the python-ssdeep README pair and its score of 22) are in
 * vocab/ssdeep.test.json. The rest are properties: the format, determinism, similar and unrelated
 * inputs, the small-block-size cap, and a 64 KiB input inside the default limits. No digest of a
 * large input has been checked against the reference ssdeep program.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["ssdeep"]));

function noise(n: number, seed: number): Uint8Array {
  let x = seed;
  return Uint8Array.from(
    { length: n },
    () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 16) & 0xff,
  );
}

async function digest(data: Uint8Array): Promise<string> {
  const r = await runtime.call("ssdeep:digest", [bytes(data)]);
  if (!r.ok) throw new Error(r.error.message);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
}

async function compare(a: string, b: string) {
  const r = await runtime.call("ssdeep:compare", [str(a), str(b)]);
  if (!r.ok) return { code: r.error.code };
  return { score: (r.stack[r.stack.length - 1] as { v: number }).v };
}

const FORMAT = /^[0-9]+:[A-Za-z0-9+/]{0,64}:[A-Za-z0-9+/]{0,32}$/;

describe("ssdeep:digest", () => {
  test("the format is blocksize:hash1:hash2, deterministic", async () => {
    const data = noise(10000, 1);
    const h = await digest(data);
    expect(h).toMatch(FORMAT);
    expect(await digest(data)).toBe(h);
  });

  test("the block size is 3 * 2^k and grows with the input", async () => {
    const bs = async (n: number) => Number((await digest(noise(n, 5))).split(":")[0]);
    for (const n of [200, 5000, 100000]) {
      const b = await bs(n);
      expect(Math.log2(b / 3) % 1).toBe(0);
    }
    expect(await bs(100000)).toBeGreaterThan(await bs(200));
  });

  test("data with no triggers falls back to 3:: after the block size has halved to 3", async () => {
    expect(await digest(new Uint8Array(65536))).toBe("3::");
  });

  test("64 KiB is inside the default limits and gives a full-length first hash", async () => {
    const h = await digest(noise(65536, 12345));
    expect(h).toMatch(FORMAT);
    expect(h.split(":")[1]!.length).toBeGreaterThanOrEqual(32);
  });
});

describe("ssdeep:compare", () => {
  test("a hash scores 100 against itself, for a large input too", async () => {
    const h = await digest(noise(65536, 3));
    expect((await compare(h, h)).score).toBe(100);
  });

  test("one changed byte in 64 KiB scores very high, a different input scores 0", async () => {
    const a = noise(65536, 3);
    const b = a.slice();
    b[1000] ^= 0xff;
    const ha = await digest(a);
    expect((await compare(ha, await digest(b))).score).toBeGreaterThanOrEqual(90);
    expect((await compare(ha, await digest(noise(65536, 4)))).score).toBe(0);
  });

  test("the score is symmetric", async () => {
    const a = noise(30000, 8);
    const b = a.slice();
    b.set(noise(300, 9), 5000);
    const [ha, hb] = [await digest(a), await digest(b)];
    expect((await compare(ha, hb)).score).toBe((await compare(hb, ha)).score);
  });

  test("hashes with block sizes a factor of two apart are compared on the shared hash", async () => {
    const h = "6:AXGBicFlgVNhBGcL6wCrFQEvXXXX:AXGBicFlgVNhBGcL6wCrFQEv";
    const g = "12:AXGBicFlgVNhBGcL6wCrFQEvYYYY:ZZZZZZ";
    expect((await compare(h, g)).score).toBeGreaterThan(0);
  });

  test("a run of more than three equal characters counts as three", async () => {
    const a = "24:abcdefghijklmnopqrstuvwxyz:x";
    const b = "24:abcdefghijkllllllllmnopqrstuvwxyz:x";
    const c = "24:abcdefghijkllllmnopqrstuvwxyz:x";
    expect((await compare(a, b)).score).toBe((await compare(a, c)).score);
  });

  test("the score of small block sizes is capped by the length of the shorter hash", async () => {
    const a = "3:abcdefghijkl:x";
    const b = "3:abcdefghijkm:x";
    expect((await compare(a, b)).score).toBeLessThanOrEqual(12);
  });

  test("a comma and file name after the hash are ignored", async () => {
    const a = "3:AXGBicFlgVNhBGcL6wCrFQEv:AXGHsNhxLsr2C";
    expect((await compare(a, `${a},"file.txt"`)).score).toBe(100);
  });

  test("bad input is E_COERCE", async () => {
    expect((await compare("3:abc", "3:abc:def")).code).toBe("E_COERCE");
    expect((await compare("x:abc:def", "3:abc:def")).code).toBe("E_COERCE");
    expect((await compare("0:abc:def", "3:abc:def")).code).toBe("E_COERCE");
  });
});
