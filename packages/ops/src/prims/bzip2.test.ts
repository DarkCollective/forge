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
 * Tests for the bzip2 primitives (src/prims/bzip2.ts). Independent tools: Python's bz2 module and
 * bzip2 1.0.8 wrote the decompressor inputs, and read what Forge wrote (the FORGE_* constants are
 * Forge's own output, checked with `bzip2 -dc` and `bz2.decompress` when they were made).
 */
import { describe, expect, test } from "vitest";
import { bunzip2, bzip2Compress, primitives } from "./bzip2.js";

const BIG = 64 * 1024 * 1024;
const hex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function lcg(n: number, seed: number): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  });
}
function prose(n: number, seed: number): Uint8Array {
  const words = [
    "forge",
    "bzip2",
    "the",
    "of",
    "stream",
    "block",
    "huffman",
    "window",
    "sort",
    "\n",
  ];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[s >>> 28 > 9 ? 0 : s >>> 28] as string} `;
  }
  return new TextEncoder().encode(t.slice(0, n));
}
function digits(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => 48 + (i % 10));
}

// Python bz2.compress(b"0123456789" * 25000, 1): three blocks at block size 1
const PY_MULTI_BLOCK =
  "425a68313141592653594a8fffa500138708007fe0200070400c029543099c54151e550547aa82a3e54151854151954151a54151b54151faa0a8e2a0a8e98a0ac9329ac86c1fdee00138704003ff01000382006014aa184ce2a0a8f150547b54151f2a0a8c2a0a8caa0a8d2a0a8daa0a8fd505471505474c50564994d65f993dc98004e2c2001ff808001a829509a1814aa1826e521518a42a319a42a3450a8c142a3250a8d142a3650a8fca151c2854745dc914e142413d73f82c";
// Forge output, verified by bzip2 -dc and Python
const FORGE_PROSE_1 =
  "425a683131415926535985bf5c9a0001fcd9800010400010003fefde90300140c034f5340aa00002800006009aa551ea7a9a69e918d0d0511ebcabda63ec1a9794c158bd8066223f7765b78d7a001c28cbd7826dbae9abdda4f27aae6ea40891500f5dd56ca910e6c461362454842d3b652cadba5263b4d448b3a5448c5655cae1312b212e191bb25c9adc2c2408caa4d7186d5e5dedc89e6134c8bd9efa8512a23f0ae70dd5731d55db2ab318c596659332598998ab30acc330788d257a2b62bee43450e83e0aff1c26eab755bc722b0af23d2ae5b6557d4870570354da35a2ad555d0ac1ac752b41f23f53d8bb9229c284842dfae4d0";
const FORGE_RANDOM_9 =
  "425a68393141592653598e962d5b000023ffffd3f5fbf97db22f3eefc37ebdf5b987bdfef6feefefbd7bfcff2fc564afaf7bafb000fb1840068000000000034000007a86800001a68000000060000001a003206220d000001a1ea0001a000001a034d1a0d0d0068680d36881a0341a1e500343f547a81b48f50f53d01a0100000680000000000000034000000000600000000000000001332f5bad990256121568abacc740fae148f01503d0374580a901972ccac15ff1e00716ecf4705528610f9c1f5cdd8be2502136424f5fbdd4f2635a5543adaf091179895587632335af49de8324defa9d61318eccad4d9c8e61e46d4fc3176487b881c92701802a1808dea38f907931ced14cfeb18b605c2799a0b609381be8e2fcabe660ab928d46f13a5b3d1d2219c8ad53d6b0fac6aa0a087148904405cc6a72bb87f66826da73a5e6e39450e11ad18f420743c0ecc924b6f14976bb947aade9e3e708cb9d46fc8d01041a58c3c205c92744aa9bb9c8e642b15ad2ac4110410164100127bf67411a180d83da89eeb320e8377e4ee7470a4786c0e0d98f475a00b0510586146f531b173003613e1772453850908e962d5b";
// Forge output with the deprecated randomised-block bit set, verified by bzip2 -dc and Python
const FORGE_RANDOMISED =
  "425a6839314159265359d66677a580008959800010400010003fefde903000a604a644a7e94d07a86861400003002a4a8d3d4d0d36a1ea36a282f55ac546c9a257fd749b459784eaad4dcd54fe4c121a786db791c36cb5959a37026090da20de3b407a3da12254aaa8529f634938373aa4689171c8bc323131311a947e8713598a9d1232cc2c368b89693750b47b3487386c3f8bb9229c28486b333bd280";

function fails(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? "?", message: err.message };
  }
  return { code: "none", message: "" };
}

describe("bzip2 primitives", () => {
  test("are exported as private helpers", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "bzip2:_compress",
      "bzip2:_decompress",
    ]);
  });

  test("a multi-block stream written by Python at -1 decodes", () => {
    const out = bunzip2(hex(PY_MULTI_BLOCK), BIG);
    expect(eq(out, digits(250_000))).toBe(true);
  });

  test("Forge output pinned and decoded", () => {
    expect(toHex(bzip2Compress(prose(1500, 7), 1))).toBe(FORGE_PROSE_1);
    expect(toHex(bzip2Compress(lcg(300, 11), 9))).toBe(FORGE_RANDOM_9);
    expect(eq(bunzip2(hex(FORGE_PROSE_1), BIG), prose(1500, 7))).toBe(true);
    expect(eq(bunzip2(hex(FORGE_RANDOM_9), BIG), lcg(300, 11))).toBe(true);
  });

  test("randomised blocks are read (the table of the format)", () => {
    expect(toHex(bzip2Compress(prose(400, 5), 9, true))).toBe(FORGE_RANDOMISED);
    expect(eq(bunzip2(hex(FORGE_RANDOMISED), BIG), prose(400, 5))).toBe(true);
  });

  test("the empty stream is the 14 bytes bzip2 writes", () => {
    expect(toHex(bzip2Compress(new Uint8Array(0), 9))).toBe("425a683917724538509000000000");
    expect(bunzip2(hex("425a683917724538509000000000"), BIG).length).toBe(0);
  });

  test("round trips at every block size, across shapes of input", () => {
    const shapes: Uint8Array[] = [
      new Uint8Array(0),
      Uint8Array.of(0),
      Uint8Array.of(255, 255, 255, 255),
      new Uint8Array(1000),
      new Uint8Array(4).fill(7),
      new Uint8Array(259).fill(9),
      new Uint8Array(260).fill(9),
      prose(5000, 1),
      lcg(4000, 2),
      Uint8Array.from({ length: 3000 }, (_, i) => (i % 2 ? 97 : 98)),
      Uint8Array.from({ length: 1024 }, (_, i) => i & 255),
    ];
    for (const level of [1, 2, 5, 9]) {
      for (const d of shapes) {
        expect(eq(bunzip2(bzip2Compress(d, level), BIG), d), `level ${level}, n ${d.length}`).toBe(
          true,
        );
      }
    }
  });

  test("input over one block at level 1 makes several blocks and round trips", () => {
    const d = Uint8Array.from({ length: 230_000 }, (_, i) => (i * 7 + (i >> 9)) & 255);
    expect(eq(bunzip2(bzip2Compress(d, 1), BIG), d)).toBe(true);
  }, 60_000);

  test("64 KiB: zeros, an alternating pattern, prose and random bytes", () => {
    const cases: [string, Uint8Array][] = [
      ["zeros", new Uint8Array(65_536)],
      ["abab", Uint8Array.from({ length: 65_536 }, (_, i) => 97 + (i & 1))],
      ["period 1000", Uint8Array.from({ length: 65_536 }, (_, i) => (i % 1000) % 251)],
      ["prose", prose(65_536, 21)],
      ["random", lcg(65_536, 4)],
    ];
    for (const [name, d] of cases) {
      const t = Date.now();
      const c = bzip2Compress(d, 9);
      const took = Date.now() - t;
      expect(eq(bunzip2(c, BIG), d), name).toBe(true);
      expect(took, name).toBeLessThan(5000);
    }
  }, 60_000);

  test("900,000 bytes of a period-three pattern sort in reasonable time", () => {
    const d = Uint8Array.from({ length: 900_000 }, (_, i) => 97 + (i % 3));
    const t = Date.now();
    const c = bzip2Compress(d, 9);
    expect(Date.now() - t).toBeLessThan(10_000);
    expect(eq(bunzip2(c, BIG), d)).toBe(true);
  }, 60_000);

  test("two concatenated streams join; trailing bytes that are no stream are ignored", () => {
    const a = bzip2Compress(prose(100, 1), 9);
    const b = bzip2Compress(prose(100, 2), 1);
    const both = Uint8Array.from([...a, ...b]);
    const want = Uint8Array.from([...prose(100, 1), ...prose(100, 2)]);
    expect(eq(bunzip2(both, BIG), want)).toBe(true);
    expect(eq(bunzip2(Uint8Array.from([...both, 0, 0, 0, 0, 0]), BIG), want)).toBe(true);
    expect(fails(() => bunzip2(Uint8Array.from([...a, 0x42, 0x5a, 0x68, 0x39]), BIG)).code).toBe(
      "E_COERCE",
    );
  });

  test("bad block sizes are E_RANGE", () => {
    for (const level of [0, 10, -1, 1.5]) {
      expect(fails(() => bzip2Compress(new Uint8Array(1), level)).code).toBe("E_RANGE");
    }
  });

  test("not bzip2, a bad digit and an empty input are E_COERCE", () => {
    expect(fails(() => bunzip2(new Uint8Array(0), BIG)).code).toBe("E_COERCE");
    expect(fails(() => bunzip2(hex("48656c6c6f"), BIG)).message).toMatch(/magic number BZh/);
    const bad = bzip2Compress(prose(50, 1), 9).slice();
    bad[3] = 0x30;
    expect(fails(() => bunzip2(bad, BIG)).message).toMatch(/block size digit/);
  });

  test("every cut of a stream is E_COERCE, and every flipped bit is caught", () => {
    const c = bzip2Compress(prose(600, 3), 9);
    for (let cut = 0; cut < c.length; cut++) {
      expect(fails(() => bunzip2(c.subarray(0, cut), BIG)).code, `cut ${cut}`).toBe("E_COERCE");
    }
    for (let i = 0; i < c.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const m = c.slice();
        m[i] = (m[i] as number) ^ (1 << bit);
        const r = fails(() => bunzip2(m, BIG));
        // a flip in the padding after the last byte's data, or one that gives another stream, is the only way through
        expect(["E_COERCE", "none"], `byte ${i} bit ${bit}`).toContain(r.code);
        if (r.code === "none")
          expect(
            [3, 14, c.length - 1],
            "only the digit, the randomised bit of a short block or padding may change silently",
          ).toContain(i);
      }
    }
  }, 60_000);

  test("without verify a damaged checksum is ignored", () => {
    const c = bzip2Compress(prose(300, 3), 9).slice();
    // the stored block CRC starts after the 4-byte header, the 6-byte block magic
    c[10] = (c[10] as number) ^ 0xff;
    expect(fails(() => bunzip2(c, BIG)).message).toMatch(/block CRC/);
    expect(eq(bunzip2(c, BIG, false), prose(300, 3))).toBe(true);
  });

  test("the block size of the header caps a block: a larger block is E_COERCE", () => {
    const c = bzip2Compress(prose(150_000, 9), 9).slice();
    c[3] = 0x31;
    const r = fails(() => bunzip2(c, BIG));
    expect(r.code).toBe("E_COERCE");
    expect(r.message).toMatch(/block size/);
  }, 60_000);

  test("decompression bomb: stops at the limit while producing, not afterwards", () => {
    const bomb = bzip2Compress(new Uint8Array(32 * 1024 * 1024), 9);
    expect(bomb.length).toBeLessThan(100);
    const r = fails(() => bunzip2(bomb, 1024 * 1024));
    expect(r.code).toBe("E_LIMIT_VALUE");
    expect(r.message).toMatch(/exceeds the limit/);
    expect(bunzip2(bomb, 32 * 1024 * 1024).length).toBe(32 * 1024 * 1024);
    expect(fails(() => bunzip2(bomb, 32 * 1024 * 1024 - 1)).code).toBe("E_LIMIT_VALUE");
  }, 60_000);

  test("many small streams that add up past the limit stop too", () => {
    const one = bzip2Compress(new Uint8Array(10_000), 1);
    const many = Uint8Array.from(Array.from({ length: 50 }, () => Array.from(one)).flat());
    expect(fails(() => bunzip2(many, 100_000)).code).toBe("E_LIMIT_VALUE");
    expect(bunzip2(many, 500_000).length).toBe(500_000);
  });
});
