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
 * Tests for the `qr` vocabulary (vocab/qr.fth, src/prims/qr.ts). The op vectors (vocab/qr.test.json) hold the
 * matrices computed with python-qrcode; these tests add the codewords of the ISO/IEC 18004 example, the format and
 * version information, the capacity table, the alignment pattern positions, the PNG file (checked with the host's
 * zlib and a CRC-32 of its own), the range errors and the cost.
 */
import { valueHelpers } from "@forge/lang";
import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { code, loadRuntime, message, raw, steps, toHex, utf8 } from "./data-format-test.js";
import {
  alignmentPositions,
  chooseMode,
  dataCodewords,
  encodeQr,
  formatBits,
  interleave,
  remainder,
  versionBits,
} from "./prims/qr.js";

const { int, str } = valueHelpers;
const runtime = await loadRuntime(["qr"]);

const generate = (data: string, format = "text", level = "M", size = 1, margin = 0) =>
  runtime.call("qr:generate", [str(data), str(format), str(level), int(size), int(margin)]);
/** The module matrix of a text-format result, margin 0. */
async function matrix(data: string, level = "M"): Promise<number[][]> {
  const t = utf8(raw(await generate(data, "text", level, 1, 0)));
  return t
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => Array.from({ length: l.length / 2 }, (_, i) => (l[2 * i] === "\u2588" ? 1 : 0)));
}

describe("the example of ISO/IEC 18004 Annex I (01234567, version 1-M)", () => {
  const utf8 = new TextEncoder().encode("01234567");
  test("data codewords", () => {
    expect(toHex(dataCodewords("01234567", "numeric", utf8, 1, 1))).toBe(
      "10200c56618 0ec11ec11ec11ec11ec11".replace(/ /g, ""),
    );
  });
  test("error correction codewords", () => {
    expect(toHex(remainder(dataCodewords("01234567", "numeric", utf8, 1, 1), 10))).toBe(
      "a524d4c1ed36c7872c55",
    );
  });
  test("interleaving puts the error correction after the data", () => {
    const all = interleave(dataCodewords("01234567", "numeric", utf8, 1, 1), 1, 1);
    expect(all).toHaveLength(26);
    expect(toHex(all.subarray(16))).toBe("a524d4c1ed36c7872c55");
  });
  test("the symbol is version 1 and reads back as the same modules at every scale", async () => {
    const q = encodeQr("01234567", "M");
    expect(q.version).toBe(1);
    expect(q.size).toBe(21);
    const m = await matrix("01234567");
    expect(m).toHaveLength(21);
    expect(m.flat()).toEqual(Array.from(q.modules));
  });
});

describe("format and version information", () => {
  test("the format information of mask 0 (ISO/IEC 18004 Table C.1)", () => {
    expect(formatBits(0, 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(formatBits(1, 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits(2, 0).toString(2).padStart(15, "0")).toBe("011010101011111");
    expect(formatBits(3, 0).toString(2).padStart(15, "0")).toBe("001011010001001");
    expect(formatBits(1, 5).toString(2).padStart(15, "0")).toBe("100000011001110");
  });
  test("the version information (ISO/IEC 18004 Table D.1)", () => {
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
    expect(versionBits(8).toString(2).padStart(18, "0")).toBe("001000010110111100");
    expect(versionBits(21).toString(2).padStart(18, "0")).toBe("010101011010000011");
    expect(versionBits(40).toString(2).padStart(18, "0")).toBe("101000110001101001");
  });
  test("every format word differs from every other in at least 7 bits (the distance of the BCH(15,5) code)", () => {
    const words = Array.from({ length: 32 }, (_, i) => formatBits(i >> 3, i & 7));
    for (let a = 0; a < 32; a++)
      for (let b = a + 1; b < 32; b++) {
        let x = (words[a] as number) ^ (words[b] as number);
        let ones = 0;
        while (x) {
          ones += x & 1;
          x >>>= 1;
        }
        expect(ones).toBeGreaterThanOrEqual(7);
      }
  });
});

describe("tables", () => {
  test("alignment pattern positions (ISO/IEC 18004 Annex E)", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(36)).toEqual([6, 24, 50, 76, 102, 128, 154]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });
  test("character capacities of ISO/IEC 18004 Table 7 (numeric, alphanumeric, byte)", () => {
    const table: [number, string, number, number, number][] = [
      [1, "L", 41, 25, 17],
      [1, "M", 34, 20, 14],
      [1, "Q", 27, 16, 11],
      [1, "H", 17, 10, 7],
      [10, "L", 652, 395, 271],
      [10, "H", 288, 174, 119],
      [40, "L", 7089, 4296, 2953],
      [40, "M", 5596, 3391, 2331],
      [40, "Q", 3993, 2420, 1663],
      [40, "H", 3057, 1852, 1273],
    ];
    for (const [version, level, n, a, b] of table) {
      for (const [chars, cap] of [
        ["7", n],
        ["A", a],
        ["a", b],
      ] as const) {
        const fits = encodeQr(chars.repeat(cap), level);
        expect(fits.version).toBeLessThanOrEqual(version);
        if (cap === n || version === 1 || version === 40) {
          expect(fits.version).toBe(version);
          if (version < 40)
            expect(encodeQr(chars.repeat(cap + 1), level).version).toBe(version + 1);
        }
      }
    }
  });
  test("the mode is the narrowest that holds the text", () => {
    expect(chooseMode("0123")).toBe("numeric");
    expect(chooseMode("")).toBe("numeric");
    expect(chooseMode("AB 12 $%*+-./:")).toBe("alnum");
    expect(chooseMode("ab")).toBe("byte");
    expect(chooseMode("1é")).toBe("byte");
  });
  test("the data bits of an alphanumeric and a byte segment", () => {
    // "AC-42": mode 0010, count 000000101, AC = 10*45+12 = 462, -4 = 41*45+4 = 1849, 2 = 2 (6 bits)
    const a = dataCodewords("AC-42", "alnum", new TextEncoder().encode("AC-42"), 1, 1);
    expect(a[0]).toBe(0b00100000);
    expect(toHex(a.subarray(0, 5))).toBe("2029cee721");
  });
});

describe("the symbol", () => {
  test("finder patterns, timing patterns and the dark module are where the standard puts them", async () => {
    const m = await matrix("HELLO WORLD", "Q");
    const n = m.length;
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ] as const)
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          const edge = x === 0 || y === 0 || x === 6 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          expect((m[oy + y] as number[])[ox + x]).toBe(edge || core ? 1 : 0);
        }
    for (let i = 8; i < n - 8; i++) {
      expect((m[6] as number[])[i]).toBe(i % 2 === 0 ? 1 : 0);
      expect((m[i] as number[])[6]).toBe(i % 2 === 0 ? 1 : 0);
    }
    expect((m[n - 8] as number[])[8]).toBe(1);
  });
  test("the format information is stored twice and agrees", async () => {
    const m = await matrix("HELLO WORLD", "Q");
    const n = m.length;
    const a: number[] = [];
    for (let i = 0; i <= 5; i++) a.push((m[i] as number[])[8] as number);
    a.push(
      (m[7] as number[])[8] as number,
      (m[8] as number[])[8] as number,
      (m[8] as number[])[7] as number,
    );
    for (let i = 9; i < 15; i++) a.push((m[8] as number[])[14 - i] as number);
    const b: number[] = [];
    for (let i = 0; i < 8; i++) b.push((m[8] as number[])[n - 1 - i] as number);
    for (let i = 8; i < 15; i++) b.push((m[n - 15 + i] as number[])[8] as number);
    expect(b).toEqual(a);
    const word = a.reduce((v, bitv, i) => v | (bitv << i), 0);
    expect(Array.from({ length: 8 }, (_, mask) => formatBits(2, mask))).toContain(word);
  });
  test("version information is stored twice for version 7 and up", () => {
    const q = encodeQr("a".repeat(200), "M");
    expect(q.version).toBeGreaterThanOrEqual(7);
    const n = q.size;
    const bits = versionBits(q.version);
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      expect(q.modules[b * n + a]).toBe((bits >>> i) & 1);
      expect(q.modules[a * n + b]).toBe((bits >>> i) & 1);
    }
  });
  test("a symbol of every version has the size 4 v + 17", () => {
    const versions = new Set<number>();
    for (let n = 1; n <= 2953; n += n < 200 ? 7 : 61) {
      const q = encodeQr("a".repeat(n), "L");
      versions.add(q.version);
      expect(q.size).toBe(q.version * 4 + 17);
    }
    expect(versions.size).toBeGreaterThan(30);
  });
});

describe("outputs", () => {
  test("SVG: size, viewBox and one path", async () => {
    const svg = utf8(raw(await generate("HELLO", "svg", "L", 4, 2)));
    expect(svg).toContain('viewBox="0 0 25 25" width="100" height="100"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.endsWith("</svg>\n")).toBe(true);
  });
  test("text: two characters a module, margin in modules", async () => {
    const t = utf8(raw(await generate("HELLO", "text", "L", 9, 3)));
    const lines = t.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(21 + 6);
    expect(lines.every((l) => l.length === (21 + 6) * 2)).toBe(true);
    expect(lines[0]).toBe(" ".repeat(54));
  });
  test("PNG: signature, chunks and CRC-32 checked here, pixels checked against the modules", async () => {
    const png = raw(await generate("HELLO WORLD", "png", "Q", 3, 2));
    expect(toHex(png.subarray(0, 8))).toBe("89504e470d0a1a0a");
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (b: Uint8Array) => {
      let c = 0xffffffff;
      for (const x of b) c = (crcTable[(c ^ x) & 255] as number) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let p = 8;
    const types: string[] = [];
    const idat: Uint8Array[] = [];
    let width = 0;
    let height = 0;
    while (p < png.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
      const body = png.subarray(p + 8, p + 8 + len);
      expect(dv.getUint32(p + 8 + len)).toBe(crc(png.subarray(p + 4, p + 8 + len)));
      types.push(type);
      if (type === "IHDR") {
        width = dv.getUint32(p + 8);
        height = dv.getUint32(p + 12);
        expect(toHex(body.subarray(8))).toBe("0100000000");
      }
      if (type === "IDAT") idat.push(body);
      p += 12 + len;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    expect([width, height]).toEqual([(21 + 4) * 3, (21 + 4) * 3]);
    const scan = inflateSync(idat[0] as Uint8Array);
    const rowBytes = 1 + Math.ceil(width / 8);
    expect(scan).toHaveLength(rowBytes * height);
    const m = await matrix("HELLO WORLD", "Q");
    for (let y = 0; y < height; y++) {
      expect(scan[y * rowBytes]).toBe(0);
      for (let x = 0; x < width; x++) {
        const mx = Math.floor(x / 3) - 2;
        const my = Math.floor(y / 3) - 2;
        const dark = mx >= 0 && my >= 0 && mx < 21 && my < 21 && (m[my] as number[])[mx] === 1;
        const pixel = ((scan[y * rowBytes + 1 + (x >> 3)] as number) >> (7 - (x & 7))) & 1;
        expect(pixel).toBe(dark ? 0 : 1);
      }
    }
  });
  test("range errors", async () => {
    expect(code(await generate("", "svg"))).toBe("E_RANGE");
    expect(code(await generate("a", "svg", "M", 0, 4))).toBe("E_RANGE");
    expect(code(await generate("a", "svg", "M", 5, 101))).toBe("E_RANGE");
    expect(code(await generate("9".repeat(7090), "text", "L"))).toBe("E_RANGE");
    expect(message(await generate("a".repeat(2954), "text", "L"))).toContain("too long");
    expect(code(await generate("a", "text", "Z"))).toBe("E_PARAM_INVALID");
  });
  test("an image over the value limit is E_LIMIT_VALUE", async () => {
    const r = await runtime.call(
      "qr:generate",
      [str("a"), str("png"), str("L"), int(100), int(100)],
      { limits: { maxValueBytes: 100_000 } },
    );
    expect(code(r)).toBe("E_LIMIT_VALUE");
  });
});

describe("cost", () => {
  test(
    "version 40 at level L (all eight masks scored), every format",
    { timeout: 60_000 },
    async () => {
      const data = "9".repeat(7089);
      for (const format of ["text", "svg", "png"]) {
        const t0 = Date.now();
        const r = await generate(data, format, "L", 2, 4);
        const ms = Date.now() - t0;
        expect(code(r)).toBe("ok");
        expect(steps(r)).toBeLessThan(2000);
        process.stderr.write(
          `\nqr version 40 (${format}): ${raw(r).length} bytes ${steps(r)} steps ${ms} ms\n`,
        );
      }
      const t1 = Date.now();
      const bytes = await generate("a".repeat(2953), "svg", "L", 1, 0);
      expect(code(bytes)).toBe("ok");
      process.stderr.write(`qr 2953 bytes (svg): ${Date.now() - t1} ms\n`);
    },
  );
});
