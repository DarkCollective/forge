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
 * Tests for the `deflate` vocabulary (vocab/deflate.fth, primitives in src/prims/deflate.ts). The
 * independent tool is the host's zlib (Node's zlib module, i.e. zlib itself): everything Forge writes
 * must read there, and everything zlib writes must read in Forge. Known answers are in
 * vocab/deflate.test.json (Python's zlib and gzip modules). Also here: 64 KiB round trips with step
 * counts, the gzip header fields, concatenated members, corrupt and cut-short data, and the
 * decompression bomb rule (the output stops at `maxValueBytes`).
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import {
  deflateRawSync,
  deflateSync,
  gunzipSync,
  gzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["deflate"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array | undefined) =>
  Array.from(u ?? [], (c) => String.fromCharCode(c)).join("");

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

/** Compressible data: words from a small vocabulary. */
function prose(n: number, seed: number): Uint8Array {
  const words = [
    "forge",
    "deflate",
    "the",
    "of",
    "stream",
    "huffman",
    "window",
    "zlib",
    "gzip",
    "\n",
  ];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[s >>> 28 > 9 ? 0 : s >>> 28] as string} `;
  }
  return text(t.slice(0, n));
}

const call = (op: string, args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call(op, args, limits === undefined ? undefined : { limits });
const deflate = (d: Uint8Array, level = 6) => call("deflate:deflate", [bytes(d), int(level)]);
const inflate = (d: Uint8Array, start = 0, limits?: { maxValueBytes: number }) =>
  call("deflate:inflate", [bytes(d), int(start)], limits);
const zlibDeflate = (d: Uint8Array, level = 6) =>
  call("deflate:zlib-deflate", [bytes(d), int(level)]);
const zlibInflate = (d: Uint8Array, start = 0, verify = true, limits?: { maxValueBytes: number }) =>
  call("deflate:zlib-inflate", [bytes(d), int(start), bool(verify)], limits);
const gzip = (d: Uint8Array, level = 6, name = "", comment = "", hcrc = false, mtime = 0) =>
  call("deflate:gzip", [bytes(d), int(level), str(name), str(comment), bool(hcrc), int(mtime)]);
const gunzip = (d: Uint8Array, verify = true, limits?: { maxValueBytes: number }) =>
  call("deflate:gunzip", [bytes(d), bool(verify)], limits);

const SAMPLES: [string, Uint8Array][] = [
  ["empty", new Uint8Array(0)],
  ["one byte", Uint8Array.of(65)],
  ["text", text("hello hello hello hello world, hello deflate")],
  ["prose", prose(5000, 3)],
  ["random", randBytes(3000, 9)],
  ["zeros", new Uint8Array(40_000)],
];

describe("deflate:deflate and deflate:inflate", () => {
  for (const [name, data] of SAMPLES) {
    for (const level of [0, 1, 6, 9]) {
      test(`${name} at level ${level} is read by zlib`, async () => {
        const c = out(await deflate(data, level)) as Uint8Array;
        expect(Array.from(inflateRawSync(c))).toEqual(Array.from(data));
        expect(Array.from(out(await inflate(c)) as Uint8Array)).toEqual(Array.from(data));
      });
    }
    test(`${name}: zlib's deflate streams (levels 1 to 9) inflate`, async () => {
      for (const level of [1, 5, 9]) {
        const c = deflateRawSync(data, { level });
        expect(Array.from(out(await inflate(c)) as Uint8Array)).toEqual(Array.from(data));
      }
    });
  }

  test("level 0 stores the data in stored blocks (the first byte is BFINAL=1, BTYPE=00)", async () => {
    const c = out(await deflate(text("abc"), 0)) as Uint8Array;
    expect(Array.from(c)).toEqual([1, 3, 0, 252, 255, 97, 98, 99]);
  });

  test("a level outside 0 to 9 is E_RANGE", async () => {
    expect(code(await deflate(text("a"), 10))).toBe("E_RANGE");
    expect(code(await deflate(text("a"), -1))).toBe("E_RANGE");
  });

  test("start index: the stream may begin later; bytes after it are ignored", async () => {
    const c = deflateRawSync(text("start index"));
    const framed = Uint8Array.from([0xde, 0xad, 0xbe, ...c, 1, 2, 3]);
    expect(ascii(out(await inflate(framed, 3)))).toBe("start index");
    expect(code(await inflate(framed, 999))).toBe("E_RANGE");
    expect(code(await inflate(framed, -1))).toBe("E_RANGE");
  });

  test("corrupt streams are E_COERCE and name the fault", async () => {
    const reserved = await inflate(Uint8Array.of(0x07)); // BTYPE 11
    expect(code(reserved)).toBe("E_COERCE");
    expect(reserved.ok ? "" : reserved.error.message).toMatch(/invalid block type/);
    const stored = await inflate(Uint8Array.of(1, 3, 0, 0, 0, 97, 98, 99)); // NLEN is not ~LEN
    expect(["E_COERCE", "ok"]).toContain(code(stored));
    const garbage = await inflate(randBytes(200, 4));
    expect(code(garbage)).toBe("E_COERCE");
  });

  test("a cut-short stream is E_COERCE", async () => {
    const c = deflateRawSync(prose(4000, 5));
    for (const n of [0, 1, 2, c.length >> 1, c.length - 1]) {
      const r = await inflate(c.subarray(0, n));
      expect(code(r), `cut at ${n}`).toBe("E_COERCE");
    }
  });

  test("65536 random and compressible bytes round trip inside the step limit", async () => {
    for (const data of [randBytes(65_536, 1), prose(65_536, 2)]) {
      const e = await deflate(data, 6);
      expect(e.ok).toBe(true);
      const c = out(e) as Uint8Array;
      expect(Array.from(inflateRawSync(c))).toEqual(Array.from(data));
      const d = await inflate(c);
      expect(Array.from(out(d) as Uint8Array)).toEqual(Array.from(data));
      expect(d.ok && d.steps).toBeLessThan(1000);
    }
  }, 60_000);
});

describe("the output limit (decompression bombs)", () => {
  const LIMIT = 1024 * 1024;

  test("a stream that expands past maxValueBytes stops with E_LIMIT_VALUE", async () => {
    const bomb = deflateRawSync(new Uint8Array(50 * 1024 * 1024)); // 50 MiB of zeros, about 50 KiB
    expect(bomb.length).toBeLessThan(100_000);
    const t0 = Date.now();
    const r = await inflate(bomb, 0, { maxValueBytes: LIMIT });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/decompressed data/);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 60_000);

  test("exactly the limit is allowed, one byte more is not", async () => {
    const at = deflateRawSync(new Uint8Array(LIMIT));
    expect(out(await inflate(at, 0, { maxValueBytes: LIMIT }))?.length).toBe(LIMIT);
    const over = deflateRawSync(new Uint8Array(LIMIT + 1));
    expect(code(await inflate(over, 0, { maxValueBytes: LIMIT }))).toBe("E_LIMIT_VALUE");
  }, 60_000);

  test("zlib and gzip bombs stop the same way, before the trailer is read", async () => {
    const z = deflateSync(new Uint8Array(20 * 1024 * 1024));
    expect(code(await zlibInflate(z, 0, true, { maxValueBytes: LIMIT }))).toBe("E_LIMIT_VALUE");
    const g = gzipSync(new Uint8Array(20 * 1024 * 1024));
    expect(code(await gunzip(g, true, { maxValueBytes: LIMIT }))).toBe("E_LIMIT_VALUE");
  }, 60_000);

  test("a gzip trailer that claims 4 GiB allocates nothing (the size is only checked afterwards)", async () => {
    const g = Uint8Array.from(gzipSync(text("small")));
    g.set([255, 255, 255, 255], g.length - 4);
    expect(code(await gunzip(g))).toBe("E_COERCE");
    expect(ascii(out(await gunzip(g, false)))).toBe("small");
  });
});

describe("deflate:zlib-deflate and deflate:zlib-inflate", () => {
  test("the header follows zlib's levels (78 01, 78 5e, 78 9c, 78 da)", async () => {
    const heads: [number, number][] = [
      [0, 0x01],
      [1, 0x01],
      [2, 0x5e],
      [5, 0x5e],
      [6, 0x9c],
      [7, 0xda],
      [9, 0xda],
    ];
    for (const [level, flg] of heads) {
      const c = out(await zlibDeflate(text("abc"), level)) as Uint8Array;
      expect([c[0], c[1]], `level ${level}`).toEqual([0x78, flg]);
      expect(
        Array.from(deflateSync(text("abc"), { level }).subarray(0, 2)),
        `zlib level ${level}`,
      ).toEqual(Array.from(c.subarray(0, 2)));
    }
  });

  for (const [name, data] of SAMPLES) {
    test(`${name}: zlib reads Forge's output and Forge reads zlib's`, async () => {
      for (const level of [0, 1, 6, 9]) {
        const c = out(await zlibDeflate(data, level)) as Uint8Array;
        expect(Array.from(inflateSync(c))).toEqual(Array.from(data));
      }
      const z = deflateSync(data, { level: 9 });
      expect(Array.from(out(await zlibInflate(z)) as Uint8Array)).toEqual(Array.from(data));
    });
  }

  test("the Adler-32 trailer is verified, and a verify of false skips it", async () => {
    const z = Uint8Array.from(deflateSync(text("trailer test")));
    z[z.length - 1] = (z[z.length - 1] as number) ^ 1;
    const bad = await zlibInflate(z);
    expect(code(bad)).toBe("E_COERCE");
    expect(bad.ok ? "" : bad.error.message).toMatch(/Adler-32/);
    expect(ascii(out(await zlibInflate(z, 0, false)))).toBe("trailer test");
    const noTrailer = z.subarray(0, z.length - 4);
    expect(code(await zlibInflate(noTrailer))).toBe("E_COERCE");
    expect(ascii(out(await zlibInflate(noTrailer, 0, false)))).toBe("trailer test");
  });

  test("header faults are E_COERCE with a reason", async () => {
    const cases: [number[], RegExp][] = [
      [[], /shorter than its two header/],
      [[0x78], /shorter than its two header/],
      [[0x78, 0x00, 0, 0], /header check/],
      [[0x79, 0x18, 0, 0], /not deflate/],
      [[0x88, 0x1c, 0, 0], /window/],
      [[0x78, 0x20, 0, 0], /preset dictionary/],
    ];
    for (const [head, why] of cases) {
      const r = await zlibInflate(Uint8Array.from(head));
      expect(code(r), why.source).toBe("E_COERCE");
      expect(r.ok ? "" : r.error.message).toMatch(why);
    }
  });

  test("start index and cut-short data", async () => {
    const z = deflateSync(text("with an offset"));
    const framed = Uint8Array.from([9, 9, ...z]);
    expect(ascii(out(await zlibInflate(framed, 2)))).toBe("with an offset");
    expect(code(await zlibInflate(framed, 99))).toBe("E_RANGE");
    for (const n of [1, 3, z.length >> 1, z.length - 5])
      expect(code(await zlibInflate(z.subarray(0, n)))).toBe("E_COERCE");
  });

  test("65536 bytes round trip, with the measured step count", async () => {
    const data = prose(65_536, 11);
    const e = await zlibDeflate(data, 6);
    expect(e.ok && e.steps).toBeLessThan(2_000_000);
    const c = out(e) as Uint8Array;
    expect(Array.from(inflateSync(c))).toEqual(Array.from(data));
    const d = await zlibInflate(c);
    expect(Array.from(out(d) as Uint8Array)).toEqual(Array.from(data));
    expect(d.ok && d.steps).toBeLessThan(2_000_000);
  }, 60_000);

  test("a level outside 0 to 9 is E_RANGE", async () => {
    expect(code(await zlibDeflate(text("a"), 12))).toBe("E_RANGE");
  });
});

describe("deflate:gzip and deflate:gunzip", () => {
  test("the header: magic, flags, mtime, XFL, OS, name and comment", async () => {
    const c = out(await gzip(text("x"), 6, "a.txt", "hi", false, 0x01020304)) as Uint8Array;
    expect(Array.from(c.subarray(0, 10))).toEqual([0x1f, 0x8b, 8, 8 | 16, 4, 3, 2, 1, 0, 255]);
    expect(ascii(c.subarray(10, 19))).toBe("a.txt\0hi\0");
    const plain = out(await gzip(text("x"), 9)) as Uint8Array;
    expect(Array.from(plain.subarray(0, 10))).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255]);
    expect(out(await gzip(text("x"), 1))?.[8]).toBe(4);
    expect(out(await gzip(text("x"), 0))?.[8]).toBe(4);
    expect(out(await gzip(text("x"), 5))?.[8]).toBe(0);
  });

  test("the output is the same on every run (mtime 0)", async () => {
    const a = out(await gzip(prose(2000, 1))) as Uint8Array;
    const b = out(await gzip(prose(2000, 1))) as Uint8Array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  for (const [name, data] of SAMPLES) {
    test(`${name}: zlib's gunzip reads Forge's output (with and without the header CRC)`, async () => {
      for (const hcrc of [false, true]) {
        for (const level of [0, 6, 9]) {
          const c = out(await gzip(data, level, "f.bin", "c", hcrc, 1_700_000_000)) as Uint8Array;
          expect(Array.from(gunzipSync(c))).toEqual(Array.from(data));
          expect(Array.from(out(await gunzip(c)) as Uint8Array)).toEqual(Array.from(data));
        }
      }
    });
    test(`${name}: Forge reads the output of zlib's gzip`, async () => {
      expect(Array.from(out(await gunzip(gzipSync(data, { level: 9 }))) as Uint8Array)).toEqual(
        Array.from(data),
      );
    });
  }

  test("header CRC-16 is verified", async () => {
    const c = Uint8Array.from(out(await gzip(text("data"), 6, "n", "", true)) as Uint8Array);
    expect(Array.from(out(await gunzip(c)) as Uint8Array)).toEqual(Array.from(text("data")));
    c[4] = (c[4] as number) ^ 1; // mtime changed, the header CRC no longer fits
    const r = await gunzip(c);
    expect(code(r)).toBe("E_COERCE");
    expect(r.ok ? "" : r.error.message).toMatch(/header checksum/);
    expect(ascii(out(await gunzip(c, false)))).toBe("data");
  });

  test("concatenated members are joined; trailing zeros are ignored", async () => {
    const a = gzipSync(text("first,"));
    const b = gzipSync(text("second,"));
    const c = gzipSync(text("third"));
    const all = Uint8Array.from([...a, ...b, ...c, 0, 0, 0, 0]);
    expect(ascii(out(await gunzip(all)))).toBe("first,second,third");
  });

  test("the extra field of RFC 1952 is skipped", async () => {
    // header with FEXTRA: SI1 SI2 'A' 'p', length 2, two data bytes, then the member's deflate stream
    const plain = gzipSync(text("extra field"));
    const raw = Uint8Array.from([
      0x1f,
      0x8b,
      8,
      4,
      0,
      0,
      0,
      0,
      0,
      3,
      6,
      0,
      0x41,
      0x70,
      2,
      0,
      9,
      9,
      ...plain.subarray(10),
    ]);
    expect(ascii(out(await gunzip(raw)))).toBe("extra field");
    const cut = raw.slice(0, 14);
    expect(code(await gunzip(cut))).toBe("E_COERCE");
  });

  test("header faults and damage are E_COERCE with a reason", async () => {
    const good = Uint8Array.from(gzipSync(text("some text to damage")));
    const hit = (m: Uint8Array) => gunzip(m);
    expect(code(await hit(new Uint8Array(0)))).toBe("E_COERCE");
    expect(code(await hit(good.subarray(0, 9)))).toBe("E_COERCE");
    const magic = good.slice();
    magic[0] = 0x1e;
    const rm = await hit(magic);
    expect(rm.ok ? "" : rm.error.message).toMatch(/magic number/);
    const method = good.slice();
    method[2] = 7;
    expect((await hit(method)).ok).toBe(false);
    const flags = good.slice();
    flags[3] = 0x20;
    const rf = await hit(flags);
    expect(rf.ok ? "" : rf.error.message).toMatch(/reserved/);
    const crc = good.slice();
    crc[crc.length - 8] = (crc[crc.length - 8] as number) ^ 1;
    const rc = await hit(crc);
    expect(rc.ok ? "" : rc.error.message).toMatch(/CRC-32/);
    const size = good.slice();
    size[size.length - 1] = (size[size.length - 1] as number) ^ 1;
    const rs = await hit(size);
    expect(rs.ok ? "" : rs.error.message).toMatch(/length mismatch/);
    expect(code(await hit(good.subarray(0, good.length - 3)))).toBe("E_COERCE");
    expect(code(await hit(good.subarray(0, 20)))).toBe("E_COERCE");
    const unterminated = Uint8Array.from([0x1f, 0x8b, 8, 8, 0, 0, 0, 0, 0, 3, 65, 66, 67]);
    const ru = await hit(unterminated);
    expect(ru.ok ? "" : ru.error.message).toMatch(/file name is not terminated/);
  });

  test("a bad level, mtime, file name or comment is E_RANGE", async () => {
    expect(code(await gzip(text("a"), 10))).toBe("E_RANGE");
    expect(code(await gzip(text("a"), 6, "", "", false, -1))).toBe("E_RANGE");
    expect(code(await gzip(text("a"), 6, "", "", false, 4294967296))).toBe("E_RANGE");
    expect(code(await gzip(text("a"), 6, "a\0b"))).toBe("E_RANGE");
    expect(code(await gzip(text("a"), 6, "", "snowman ☃"))).toBe("E_RANGE");
  });

  test("a Latin-1 file name is stored as single bytes", async () => {
    const c = out(await gzip(text("x"), 6, "café")) as Uint8Array;
    expect(Array.from(c.subarray(10, 15))).toEqual([99, 97, 102, 0xe9, 0]);
  });

  test("65536 bytes round trip, with the measured step counts", async () => {
    const data = prose(65_536, 21);
    const e = await gzip(data, 6, "big.txt", "", true);
    expect(e.ok && e.steps).toBeLessThan(3_000_000);
    const c = out(e) as Uint8Array;
    expect(Array.from(gunzipSync(c))).toEqual(Array.from(data));
    const d = await gunzip(c);
    expect(Array.from(out(d) as Uint8Array)).toEqual(Array.from(data));
    expect(d.ok && d.steps).toBeLessThan(3_000_000);
  }, 60_000);
});
