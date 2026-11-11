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
 * Tests for the `bzip2` vocabulary (vocab/bzip2.fth). Known answers from bzip2 1.0.8 and Python's bz2
 * are in vocab/bzip2.test.json; the codec itself is tested in src/prims/bzip2.test.ts. Here: the
 * words through the runtime (parameters, E_RANGE, verify, the value limit) and the step counts.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bzip2"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const call = (op: string, args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call(op, args, limits === undefined ? undefined : { limits });
const compress = (d: Uint8Array, block = 9, work = 30) =>
  call("bzip2:compress", [bytes(d), int(block), int(work)]);
const decompress = (d: Uint8Array, verify = true, limits?: { maxValueBytes: number }) =>
  call("bzip2:decompress", [bytes(d), bool(verify)], limits);
const text = (s: string) => new TextEncoder().encode(s);
const same = (a: Uint8Array | undefined, b: Uint8Array) =>
  a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

function prose(n: number): Uint8Array {
  const words = ["forge", "bzip2", "the", "of", "stream", "block", "huffman", "\n"];
  let s = 5;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[s >>> 29] as string} `;
  }
  return text(t.slice(0, n));
}

describe("bzip2:compress and bzip2:decompress", () => {
  test("round trip, and the header carries the block size", async () => {
    const d = text("hello hello hello bzip2");
    for (const level of [1, 5, 9]) {
      const c = out(await compress(d, level)) as Uint8Array;
      expect(Array.from(c.subarray(0, 4))).toEqual([0x42, 0x5a, 0x68, 0x30 + level]);
      expect(same(out(await decompress(c)), d)).toBe(true);
    }
  });

  test("the empty input gives the empty stream and back", async () => {
    const c = out(await compress(new Uint8Array(0))) as Uint8Array;
    expect(c.length).toBe(14);
    expect(out(await decompress(c))?.length).toBe(0);
  });

  test("the work factor is accepted (0 to 250) and does not change the output", async () => {
    const d = prose(3000);
    const a = out(await compress(d, 9, 0)) as Uint8Array;
    const b = out(await compress(d, 9, 250)) as Uint8Array;
    expect(same(a, b)).toBe(true);
  });

  test("a block size or work factor out of range is E_RANGE", async () => {
    expect(code(await compress(text("a"), 0))).toBe("E_RANGE");
    expect(code(await compress(text("a"), 10))).toBe("E_RANGE");
    expect(code(await compress(text("a"), 9, -1))).toBe("E_RANGE");
    expect(code(await compress(text("a"), 9, 251))).toBe("E_RANGE");
  });

  test("corrupt data is E_COERCE; verify off returns the data despite a bad stream CRC", async () => {
    const d = prose(500);
    const c = (out(await compress(d)) as Uint8Array).slice();
    c[c.length - 2] = (c[c.length - 2] as number) ^ 0xff;
    const r = await decompress(c);
    expect(code(r)).toBe("E_COERCE");
    expect(r.ok ? "" : r.error.message).toMatch(/combined CRC/);
    expect(same(out(await decompress(c, false)), d)).toBe(true);
    expect(code(await decompress(text("not bzip2")))).toBe("E_COERCE");
  });

  test("the value limit stops a bomb", async () => {
    const c = out(await compress(new Uint8Array(4 * 1024 * 1024))) as Uint8Array;
    expect(c.length).toBeLessThan(100);
    expect(code(await decompress(c, true, { maxValueBytes: 64 * 1024 }))).toBe("E_LIMIT_VALUE");
    expect(out(await decompress(c, true, { maxValueBytes: 4 * 1024 * 1024 }))?.length).toBe(
      4 * 1024 * 1024,
    );
  }, 60_000);

  test("65536 bytes round trip, with the measured step counts", async () => {
    const d = prose(65_536);
    const e = await compress(d, 9);
    expect(e.ok && e.steps).toBeLessThan(1000);
    const c = out(e) as Uint8Array;
    const r = await decompress(c);
    expect(same(out(r), d)).toBe(true);
    expect(r.ok && r.steps).toBeLessThan(1000);
  }, 60_000);
});
