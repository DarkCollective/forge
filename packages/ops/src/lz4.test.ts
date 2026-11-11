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
 * Tests for the `lz4` vocabulary (vocab/lz4.fth, primitives in src/prims/lz4.ts). Known answers made
 * by the lz4 v1.10.0 command are in vocab/lz4.test.json (and the compressor's output was decoded by
 * `lz4 -d` when the pinned frames below were made). Here: round trips over every option, the frame
 * header bytes Forge writes (pinned; each was decoded by the lz4 command), corrupt and cut data, the
 * legacy and skippable frames, 64 KiB step counts, and the decompression bomb rule.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lz4"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (s: string) => new TextEncoder().encode(s);
const hex = (u: Uint8Array | undefined) =>
  Array.from(u ?? [], (c) => c.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

function randBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}

function prose(n: number, seed: number): Uint8Array {
  const words = ["forge", "lz4", "block", "frame", "xxh32", "\n", "match", "literal", "token"];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[(s >>> 28) % words.length] as string} `;
  }
  return text(t.slice(0, n));
}

const call = (op: string, args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call(op, args, limits === undefined ? undefined : { limits });
interface Opts {
  level?: number;
  size?: string;
  indep?: boolean;
  bchk?: boolean;
  cchk?: boolean;
  csize?: boolean;
}
const compress = (d: Uint8Array, o: Opts = {}) =>
  call("lz4:compress", [
    bytes(d),
    int(o.level ?? 1),
    str(o.size ?? "4MB"),
    bool(o.indep ?? true),
    bool(o.bchk ?? false),
    bool(o.cchk ?? true),
    bool(o.csize ?? false),
  ]);
const decompress = (d: Uint8Array, verify = true, limits?: { maxValueBytes: number }) =>
  call("lz4:decompress", [bytes(d), bool(verify)], limits);

const SAMPLES: [string, Uint8Array][] = [
  ["empty", new Uint8Array(0)],
  ["one byte", Uint8Array.of(65)],
  ["12 bytes", text("abcabcabcabc")],
  ["13 bytes", text("abcabcabcabca")],
  ["text", text("hello hello hello hello world, hello lz4 frame")],
  ["prose", prose(5000, 3)],
  ["random", randBytes(3000, 9)],
  ["zeros", new Uint8Array(40_000)],
];

describe("lz4:compress and lz4:decompress", () => {
  for (const [name, data] of SAMPLES) {
    for (const level of [0, 1, 5, 9]) {
      test(`${name} at level ${level} round-trips`, async () => {
        const c = out(await compress(data, { level })) as Uint8Array;
        expect(hex(c.subarray(0, 4))).toBe("04224d18");
        expect(Array.from(out(await decompress(c)) as Uint8Array)).toEqual(Array.from(data));
      });
    }
  }

  test("every option combination round-trips, over several blocks", async () => {
    const data = prose(150_000, 5);
    for (const size of ["64KB", "256KB", "1MB", "4MB"])
      for (const indep of [true, false])
        for (const bchk of [false, true])
          for (const csize of [false, true]) {
            const c = out(
              await compress(data, { size, indep, bchk, csize, level: 3 }),
            ) as Uint8Array;
            const back = out(await decompress(c)) as Uint8Array;
            expect(back.length, `${size} ${String(indep)} ${String(bchk)} ${String(csize)}`).toBe(
              data.length,
            );
            expect(back.every((v, i) => v === data[i])).toBe(true);
          }
  });

  test("the frame header bytes: lz4js-like defaults, and each flag", async () => {
    const c = (o: Opts) => compress(text("hello"), o).then((r) => hex(out(r)));
    // The empty frame: magic, FLG 0x64 (independent, content checksum), BD 0x70 (4 MB), HC, EndMark,
    // XXH32 of nothing (02cc5d05, little-endian 055dcc02). Matches `lz4 -c` of an empty file except BD.
    const empty = hex(out(await compress(new Uint8Array(0))));
    expect(empty.startsWith("04224d186470")).toBe(true);
    expect(empty.endsWith("00000000055dcc02")).toBe(true);
    expect((await c({ cchk: false })).slice(8, 12)).toBe("6070");
    expect((await c({ indep: false })).slice(8, 12)).toBe("4470");
    expect((await c({ bchk: true })).slice(8, 12)).toBe("7470");
    expect((await c({ csize: true })).slice(8, 12)).toBe("6c70");
    expect((await c({ size: "64KB" })).slice(8, 12)).toBe("6440");
  });

  test("levels 0 to 9 are accepted and others are E_RANGE", async () => {
    expect(code(await compress(text("abc"), { level: 10 }))).toBe("E_RANGE");
    expect(code(await compress(text("abc"), { level: -1 }))).toBe("E_RANGE");
  });

  test("higher levels never do worse than level 1 on text, and compress it", async () => {
    const data = prose(60_000, 8);
    const l1 = (out(await compress(data, { level: 1 })) as Uint8Array).length;
    const l9 = (out(await compress(data, { level: 9 })) as Uint8Array).length;
    expect(l1).toBeLessThan(data.length / 2);
    expect(l9).toBeLessThanOrEqual(l1);
  });

  test("the output is the same every time", async () => {
    const data = prose(20_000, 2);
    const a = hex(out(await compress(data, { level: 6 })));
    const b = hex(out(await compress(data, { level: 6 })));
    expect(a).toBe(b);
  });

  test("64 KiB: round trip and steps", { timeout: 60_000 }, async () => {
    const data = prose(65_536, 13);
    const cr = await compress(data, { level: 6, bchk: true, csize: true });
    const c = out(cr) as Uint8Array;
    const dr = await decompress(c);
    expect(Array.from(out(dr) as Uint8Array)).toEqual(Array.from(data));
    expect(cr.ok && dr.ok).toBe(true);
  });
});

describe("frames Forge reads that it does not write", () => {
  // Frames from the lz4 command (see vocab/lz4.test.json for the full set); here the odd ones.
  const frame = fromHex(
    "04224d186440a71c0000006e68656c6c6f20060063776f726c642c190090" +
      "6c7a34206672616d6500000000" +
      "56b391b8",
  );

  test("a skippable frame, then a frame", async () => {
    const skip = Uint8Array.of(0x55, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3);
    const joined = Uint8Array.from([...skip, ...frame]);
    expect(new TextDecoder().decode(out(await decompress(joined)))).toBe(
      "hello hello hello hello world, hello lz4 frame",
    );
  });

  test("a skippable frame alone gives no bytes; one cut short is E_COERCE", async () => {
    const skip = Uint8Array.of(0x50, 0x2a, 0x4d, 0x18, 2, 0, 0, 0, 9, 9);
    expect(out(await decompress(skip))?.length).toBe(0);
    expect(code(await decompress(skip.subarray(0, 9)))).toBe("E_COERCE");
  });

  test("bytes that are not a frame after a frame are E_COERCE (as the lz4 command rejects them)", async () => {
    expect(code(await decompress(Uint8Array.from([...frame, 1, 2, 3, 4])))).toBe("E_COERCE");
    expect(code(await decompress(Uint8Array.from([...frame, 1, 2])))).toBe("E_COERCE");
  });

  test("a frame that needs a dictionary is E_COERCE", async () => {
    const f = Uint8Array.from(frame);
    f[4] |= 1;
    expect(code(await decompress(f, false))).toBe("E_COERCE");
  });

  test("with verify off a damaged checksum still returns the data; structure errors do not", async () => {
    const bad = Uint8Array.from(frame);
    bad[bad.length - 1] ^= 1;
    expect(code(await decompress(bad))).toBe("E_COERCE");
    expect(out(await decompress(bad, false))?.length).toBe(46);
    expect(code(await decompress(bad.subarray(0, 30), false))).toBe("E_COERCE");
  });

  test("empty input and data shorter than a header are E_COERCE", async () => {
    expect(code(await decompress(new Uint8Array(0)))).toBe("E_COERCE");
    expect(code(await decompress(Uint8Array.of(4, 0x22, 0x4d, 0x18, 0x64)))).toBe("E_COERCE");
  });
});

describe("the output limit (decompression bombs)", () => {
  const LIMIT = 100_000;

  test("a frame that expands past maxValueBytes stops with E_LIMIT_VALUE", async () => {
    const bomb = out(await compress(new Uint8Array(20_000_000), { level: 1 })) as Uint8Array;
    expect(bomb.length).toBeLessThan(100_000);
    const r = await decompress(bomb, true, { maxValueBytes: LIMIT });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    if (!r.ok) expect((r.error.detail as { limit: string }).limit).toBe("maxValueBytes");
  });

  test("exactly the limit passes, one byte more does not", async () => {
    const c = out(await compress(new Uint8Array(LIMIT), { level: 1 })) as Uint8Array;
    expect(out(await decompress(c, true, { maxValueBytes: LIMIT }))?.length).toBe(LIMIT);
    expect(code(await decompress(c, true, { maxValueBytes: LIMIT - 1 }))).toBe("E_LIMIT_VALUE");
  });

  test("a content size that lies allocates nothing and is E_COERCE (or the limit)", async () => {
    const c = Uint8Array.from(
      out(await compress(text("hello hello hello hello"), { csize: true })) as Uint8Array,
    );
    // Claim 2^40 bytes (the header checksum then fails; with verify off the size is not read either).
    c[10] = 0xff;
    c[11] = 0xff;
    expect(code(await decompress(c))).toBe("E_COERCE");
    expect(out(await decompress(c, false))?.length).toBe(23);
  });
});
