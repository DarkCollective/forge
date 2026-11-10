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
 * Tests for the `tcpip` vocabulary (vocab/tcpip.fth, no primitives). Known answers are in
 * vocab/tcpip.test.json; these compare with RFC 1071's loop (add words, fold the carry until it is
 * gone, complement) and check that a message with its checksum inserted sums to zero.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["tcpip"]));

function reference(data: Uint8Array): Uint8Array {
  let sum = 0;
  for (let i = 0; i < data.length; i += 2) {
    sum += ((data[i] as number) << 8) | (data[i + 1] ?? 0);
  }
  while (sum > 0xffff) sum = (sum & 0xffff) + Math.floor(sum / 0x10000);
  const c = 0xffff - sum;
  return Uint8Array.from([c >> 8, c & 255]);
}

async function run(data: Uint8Array) {
  const r = await runtime.call("tcpip:checksum", [bytes(data)]);
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

describe("tcpip:checksum", () => {
  test("agrees with RFC 1071's loop on random lengths", async () => {
    for (let n = 0; n < 80; n++) {
      const data = randBytes(n * 13, n + 1);
      expect((await run(data)).out).toEqual(reference(data));
    }
  });

  test("a message with its checksum appended (even length) verifies to zero", async () => {
    for (let n = 1; n < 40; n++) {
      const data = randBytes(n * 2, n);
      const sum = (await run(data)).out;
      const whole = new Uint8Array([...data, ...sum]);
      expect((await run(whole)).out).toEqual(Uint8Array.from([0, 0]));
    }
  });

  test("65536 bytes fit well inside the default limits", async () => {
    // Measured: about 0.72 million steps; the default limit is 10 million. No primitive is needed.
    const data = randBytes(65536, 5);
    const { out, steps } = await run(data);
    expect(out).toEqual(reference(data));
    expect(steps).toBeLessThan(2_000_000);
  }, 60_000);
});
