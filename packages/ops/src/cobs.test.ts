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
 * Property tests for the `cobs` vocabulary (vocab/cobs.fth, all FL).
 * The fixed answers, including the published examples, are in vocab/cobs.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["cobs"]));

let seed = 0x1c0b5;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Random bytes in which each byte is zero with probability `zeros`. */
function randBytes(n: number, zeros: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => (rand() < zeros ? 0 : 1 + Math.floor(rand() * 255)));
}

async function run(word: string, data: Uint8Array) {
  const r = await runtime.call(word, [bytes(data)]);
  if (!r.ok) return { code: r.error.code };
  return { out: (r.stack[r.stack.length - 1] as { v: Uint8Array }).v };
}

describe("cobs", () => {
  test("decode(encode(x)) is x, and the encoding has no zero byte", async () => {
    for (let i = 0; i < 60; i++) {
      const data = randBytes(Math.floor(rand() * 700), [0, 0.002, 0.05, 0.5][i % 4] as number);
      const enc = await run("cobs:encode", data);
      expect(enc.out).toBeDefined();
      expect(enc.out!.includes(0)).toBe(false);
      expect(enc.out!.length).toBeLessThanOrEqual(data.length + Math.ceil(data.length / 254) + 1);
      expect((await run("cobs:decode", enc.out!)).out).toEqual(data);
    }
  });

  test("runs of 253 to 256 non-zero bytes, with and without a zero after, round trip", async () => {
    for (const n of [253, 254, 255, 256, 507, 508, 509]) {
      for (const tail of [[], [0], [0, 7]]) {
        const data = Uint8Array.from([...randBytes(n, 0), ...tail]);
        const enc = await run("cobs:encode", data);
        expect((await run("cobs:decode", enc.out!)).out).toEqual(data);
      }
    }
  });

  test("decode rejects a zero byte anywhere, and a block code that overshoots the end", async () => {
    for (let i = 0; i < 60; i++) {
      const data = randBytes(1 + Math.floor(rand() * 100), 0.1);
      const enc = (await run("cobs:encode", data)).out!;
      expect((await run("cobs:decode", Uint8Array.from([...enc, 0]))).code).toBe("E_COERCE");
      const at = Math.floor(rand() * enc.length);
      const zeroed = Uint8Array.from(enc);
      zeroed[at] = 0;
      expect((await run("cobs:decode", zeroed)).code).toBe("E_COERCE");
      // A first block that claims more bytes than there are.
      const over = Uint8Array.from([enc.length + 1, ...enc.slice(1)]);
      expect((await run("cobs:decode", over)).code).toBe("E_COERCE");
    }
  });

  // 64 KiB: the worst case for decode is one-byte blocks, the encoding of 64 KiB of zero bytes.
  test("64 KiB of zeros and of random data round trip", async () => {
    for (const zeros of [1, 0.01, 0]) {
      const data = randBytes(65536, zeros);
      const enc = (await run("cobs:encode", data)).out!;
      const dec = (await run("cobs:decode", enc)).out!;
      expect(dec).toEqual(data);
    }
  }, 60_000);

  // What the private primitive `_starts` used to check, now checked by decode itself.
  test("decode reads block by block: the zero a block stands for, and the two errors", async () => {
    const dec = async (d: number[]) => {
      const r = await runtime.call("cobs:decode", [bytes(Uint8Array.from(d))]);
      return r.ok
        ? { out: Array.from((r.stack[r.stack.length - 1] as { v: Uint8Array }).v) }
        : { code: r.error.code, message: r.error.message };
    };
    expect(await dec([])).toEqual({ out: [] });
    expect(await dec([1])).toEqual({ out: [] });
    expect(await dec([3, 0x11, 0x22, 2, 0x33])).toEqual({ out: [0x11, 0x22, 0, 0x33] });
    expect(await dec([1, 1, 1, 1])).toEqual({ out: [0, 0, 0] });
    expect(await dec([1, 0])).toMatchObject({
      code: "E_COERCE",
      message: expect.stringMatching(/zero byte/) as string,
    });
    expect(await dec([3, 1])).toMatchObject({
      code: "E_COERCE",
      message: expect.stringMatching(/truncated/) as string,
    });
    expect(await dec([255, 1, 2])).toMatchObject({
      code: "E_COERCE",
      message: expect.stringMatching(/truncated/) as string,
    });
  });

  // The worst case for decode is one-byte blocks, the encoding of 64 KiB of zero bytes, under the untrusted limits
  // of the worker (UNTRUSTED_LIMITS: 5 million steps, 256 MiB in total). The walk over the blocks used to be a
  // primitive (`_starts`); FL gathers the blocks linearly now.
  test("64 KiB of zeros under the untrusted limits", async () => {
    const strict = assembleRuntime(await loadBundleNode(["cobs"]), {
      limits: {
        maxSteps: 5_000_000,
        maxDataDepth: 10_000,
        maxValueBytes: 16 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
        maxIntBits: 16_384,
        maxMillis: 10_000,
      },
    });
    const zeros = new Uint8Array(65536);
    const t0 = Date.now();
    const enc = await strict.call("cobs:encode", [bytes(zeros)]);
    const encMs = Date.now() - t0;
    if (!enc.ok) throw new Error(`${enc.error.code}: ${enc.error.message}`);
    const encoded = (enc.stack[enc.stack.length - 1] as { v: Uint8Array }).v;
    expect(encoded).toEqual(new Uint8Array(65537).fill(1));
    // Measured 4.13 million steps; the limit is 5 million.
    expect(enc.steps).toBeLessThan(4_500_000);
    const t1 = Date.now();
    const dec = await strict.call("cobs:decode", [bytes(encoded)]);
    const decMs = Date.now() - t1;
    if (!dec.ok) throw new Error(`${dec.error.code}: ${dec.error.message}`);
    expect((dec.stack[dec.stack.length - 1] as { v: Uint8Array }).v).toEqual(zeros);
    // Measured 3.01 million steps (46 per block); the limit is 5 million.
    expect(dec.steps).toBeLessThan(3_500_000);
    process.stderr.write(
      `\ncobs 64 KiB of zeros: encode ${enc.steps} steps ${encMs} ms, decode ${dec.steps} steps ${decMs} ms\n`,
    );
  }, 60_000);
});
