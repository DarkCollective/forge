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
 * Tests for the `adler32` vocabulary (vocab/adler32.fth, no primitives). Known answers are in
 * vocab/adler32.test.json; these compare with the RFC 1950 byte-at-a-time loop and measure 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["adler32"]));

/** RFC 1950 section 8.2, reducing at every byte. */
function reference(data: Uint8Array): Uint8Array {
  let a = 1;
  let b = 0;
  for (const x of data) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return Uint8Array.from([b >> 8, b & 255, a >> 8, a & 255]);
}

async function run(data: Uint8Array) {
  const r = await runtime.call("adler32:checksum", [bytes(data)]);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v, steps: r.steps };
}

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

describe("adler32:checksum", () => {
  test("agrees with the byte-at-a-time loop on random lengths", async () => {
    for (let n = 0; n < 80; n++) {
      const data = randBytes(n * 37, n + 1);
      expect((await run(data)).out).toEqual(reference(data));
    }
  });

  test("agrees past the modulus: long runs of 0xff", async () => {
    const data = new Uint8Array(70000).fill(255);
    expect((await run(data)).out).toEqual(reference(data));
  }, 60_000);

  test("65536 bytes fit well inside the default limits", async () => {
    // The loop is the primitive adler32:_adler (0.85 million steps when it was FL); the bound is the old, looser one.
    const data = randBytes(65536, 7);
    const { out, steps } = await run(data);
    expect(out).toEqual(reference(data));
    expect(steps).toBeLessThan(2_000_000);
  }, 60_000);
});
