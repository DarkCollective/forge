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
 * Tests for the `lzma` vocabulary (vocab/lzma.fth, primitives in src/prims/lzma.ts). The known answers
 * (Python's lzma module and xz, and the lzma1 outputs checked by both) are in vocab/lzma.test.json.
 * Here: round trips through the operations, the 64 KiB step counts, the output limit at the operation
 * level, the header checks and the corrupt and cut-short data.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { compress } from "lzma1";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lzma"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (s: string) => new TextEncoder().encode(s);

const call = (op: string, args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call(op, args, limits === undefined ? undefined : { limits });
const compressOp = (d: Uint8Array, level = 7) => call("lzma:compress", [bytes(d), int(level)]);
const decompressOp = (d: Uint8Array, limits?: { maxValueBytes: number }) =>
  call("lzma:decompress", [bytes(d)], limits);

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

/** Compressible data: words from a small vocabulary. */
function prose(n: number, seed: number): Uint8Array {
  const words = ["forge", "lzma", "the", "of", "stream", "range", "coder", "window", "\n"];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[s >>> 28 > 8 ? 0 : s >>> 28] as string} `;
  }
  return text(t.slice(0, n));
}

/** The same stream with the size field set to the unknown marker (xz's and Python's way). */
function unknownSize(stream: Uint8Array): Uint8Array {
  const s = stream.slice();
  s.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 5);
  return s;
}

const SAMPLES: [string, Uint8Array][] = [
  ["empty", new Uint8Array(0)],
  ["one byte", Uint8Array.of(65)],
  ["text", text("hello hello hello world, hello lzma")],
  ["prose", prose(5000, 3)],
  ["random", randBytes(3000, 9)],
  ["zeros", new Uint8Array(40_000)],
];

describe("lzma:compress and lzma:decompress", () => {
  for (const [name, data] of SAMPLES) {
    for (const level of [1, 5, 7, 9]) {
      test(`${name} at level ${level} round trips through the operations`, async () => {
        const c = out(await compressOp(data, level)) as Uint8Array;
        expect(Array.from(c.subarray(0, 1))).toEqual([0x5d]);
        expect(Array.from(out(await decompressOp(c)) as Uint8Array)).toEqual(Array.from(data));
      });
    }
    test(`${name}: the library's stream (known size) and the unknown-size form both decode`, async () => {
      const c = compress(data, 6);
      expect(Array.from(out(await decompressOp(c)) as Uint8Array)).toEqual(Array.from(data));
      expect(Array.from(out(await decompressOp(unknownSize(c))) as Uint8Array)).toEqual(
        Array.from(data),
      );
    });
  }

  test("the output is the same on every run", async () => {
    const a = out(await compressOp(prose(2000, 1), 7)) as Uint8Array;
    const b = out(await compressOp(prose(2000, 1), 7)) as Uint8Array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("a level outside 1 to 9 is E_RANGE", async () => {
    expect(code(await compressOp(text("a"), 0))).toBe("E_RANGE");
    expect(code(await compressOp(text("a"), 10))).toBe("E_RANGE");
  });

  test("a short header, a properties byte out of range and random bytes are E_COERCE", async () => {
    expect(code(await decompressOp(new Uint8Array(0)))).toBe("E_COERCE");
    const c = out(await compressOp(text("properties"))) as Uint8Array;
    expect(code(await decompressOp(c.subarray(0, 12)))).toBe("E_COERCE");
    const bad = c.slice();
    bad[0] = 225;
    const rb = await decompressOp(bad);
    expect(code(rb)).toBe("E_COERCE");
    expect(rb.ok ? "" : rb.error.message).toMatch(/properties byte is out of range/);
    const garbage = await decompressOp(randBytes(300, 4));
    expect(["E_COERCE", "E_LIMIT_VALUE"]).toContain(code(garbage));
  });

  test("a cut-short stream is E_COERCE at several cut points", async () => {
    const c = out(await compressOp(prose(3000, 8), 6)) as Uint8Array;
    for (const n of [13, 14, c.length >> 1, c.length - 3]) {
      const r = await decompressOp(c.subarray(0, n));
      expect(code(r), `cut at ${n}`).toBe("E_COERCE");
    }
    const u = unknownSize(c);
    expect(code(await decompressOp(u.subarray(0, c.length - 2)))).toBe("E_COERCE");
  });

  test("a declared size that is not the data's length is E_COERCE", async () => {
    const c = Uint8Array.from(out(await compressOp(text("0123456789abcdef"))) as Uint8Array);
    c.set([32, 0, 0, 0, 0, 0, 0, 0], 5); // 16 bytes of data: the stream ends first
    const short = await decompressOp(c);
    expect(code(short)).toBe("E_COERCE");
    expect(short.ok ? "" : short.error.message).toMatch(/does not match its declared size/);
  });

  test("a declared size of 1 TiB is E_LIMIT_VALUE, refused before any decoding", async () => {
    const c = Uint8Array.from(out(await compressOp(text("small"))) as Uint8Array);
    c.set([0, 0, 0, 0, 0, 1, 0, 0], 5); // 2^40
    const r = await decompressOp(c);
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/exceeds the limit/);
  });

  test("the output limit: a bomb stops with E_LIMIT_VALUE, and exactly the limit passes", async () => {
    const LIMIT = 1024 * 1024;
    const bomb = compress(new Uint8Array(8 * 1024 * 1024), 9);
    expect(bomb.length).toBeLessThan(50_000);
    for (const stream of [bomb, unknownSize(bomb)]) {
      const r = await decompressOp(stream, { maxValueBytes: LIMIT });
      expect(code(r)).toBe("E_LIMIT_VALUE");
      expect(r.ok ? "" : r.error.message).toMatch(/decompressed data|exceeds the limit/);
    }
    const at = unknownSize(compress(new Uint8Array(LIMIT), 9));
    expect(out(await decompressOp(at, { maxValueBytes: LIMIT }))?.length).toBe(LIMIT);
    const over = unknownSize(compress(new Uint8Array(LIMIT + 1), 9));
    expect(code(await decompressOp(over, { maxValueBytes: LIMIT }))).toBe("E_LIMIT_VALUE");
  }, 60_000);

  test("64 KiB round trip, with the measured step counts", async () => {
    for (const data of [randBytes(65_536, 1), prose(65_536, 2)]) {
      const e = await compressOp(data, 7);
      expect(e.ok).toBe(true);
      const c = out(e) as Uint8Array;
      const d = await decompressOp(c);
      expect(Array.from(out(d) as Uint8Array)).toEqual(Array.from(data));
      expect(d.ok && d.steps).toBeLessThan(1_000_000);
    }
  }, 60_000);
});
