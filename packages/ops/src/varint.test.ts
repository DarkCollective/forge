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
 * Tests for the `varint` vocabulary (vocab/varint.fth): VarInt Encode and VarInt Decode. The known-answer vectors
 * (vocab/varint.test.json) come from Python's protobuf library (encoder._VarintBytes, wire_format.ZigZagEncode);
 * here: a JavaScript encoder as a second opinion over many values, round trips, the 64-bit bounds, every cut
 * of a VarInt, and the cost of hostile inputs.
 */
import { valueHelpers } from "@forge/lang";
import type { Limits, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str, bool } = valueHelpers;
const bundle = await loadBundleNode(["varint"]);
const runtime = assembleRuntime(bundle);
const untrusted: Partial<Limits> = {
  maxSteps: 5_000_000,
  maxDataDepth: 10_000,
  maxValueBytes: 16 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxIntBits: 16_384,
  maxMillis: 10_000,
};
const strict = assembleRuntime(bundle, { limits: untrusted });

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const encode = (n: string | bigint, zigzag = false, rt = runtime) =>
  rt.call("varint:encode", [str(String(n)), bool(zigzag)]);
const decode = (b: Uint8Array, zigzag = false, rt = runtime) =>
  rt.call("varint:decode", [bytes(b), bool(zigzag)]);
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The textbook encoder, on bigints. */
function ref(n: bigint): Uint8Array {
  const o: number[] = [];
  while (n >= 128n) {
    o.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  o.push(Number(n));
  return Uint8Array.from(o);
}
const MAX = (1n << 64n) - 1n;

describe("encode and decode against a plain encoder", () => {
  test("every power of two and its neighbours, up to 2^64 - 1", async () => {
    const values = new Set<bigint>([0n, 1n, MAX]);
    for (let k = 0n; k < 64n; k++)
      for (const d of [-1n, 0n, 1n]) {
        const v = (1n << k) + d;
        if (v >= 0n && v <= MAX) values.add(v);
      }
    for (const v of values) {
      const e = top(await encode(v)).v as Uint8Array;
      expect(hexOf(e), `encode ${v}`).toBe(hexOf(ref(v)));
      expect(top(await decode(e)).v, `decode ${v}`).toBe(v.toString());
    }
  }, 120_000);

  test("2,000 pseudo-random values of 1 to 64 bits", async () => {
    let s = 0x2545f4914f6cdd1dn;
    const next = () => {
      s ^= (s << 13n) & MAX;
      s ^= s >> 7n;
      s ^= (s << 17n) & MAX;
      return s;
    };
    for (let i = 0; i < 2000; i++) {
      const v = next() >> BigInt(next() % 64n);
      const e = top(await encode(v)).v as Uint8Array;
      expect(hexOf(e)).toBe(hexOf(ref(v)));
      expect(top(await decode(e)).v).toBe(v.toString());
    }
  }, 120_000);

  test("zigzag round trips over the signed 64-bit range", async () => {
    const values = [
      0n,
      -1n,
      1n,
      -2n,
      2n,
      63n,
      -64n,
      64n,
      -(1n << 63n),
      (1n << 63n) - 1n,
      -(1n << 31n),
      (1n << 31n) - 1n,
    ];
    for (const v of values) {
      const zz = v >= 0n ? v << 1n : (-v << 1n) - 1n;
      const e = top(await encode(v, true)).v as Uint8Array;
      expect(hexOf(e), `zigzag ${v}`).toBe(hexOf(ref(zz)));
      expect(top(await decode(e, true)).v, `unzigzag ${v}`).toBe(v.toString());
    }
  });

  test("an unsigned decode of a zigzag VarInt is the unsigned value", async () => {
    expect(top(await decode(Uint8Array.from([0x01]))).v).toBe("1");
    expect(top(await decode(Uint8Array.from([0x01]), true)).v).toBe("-1");
  });
});

describe("the bounds", () => {
  test("unsigned: 2^64 - 1 is the largest, 2^64 and negatives are E_RANGE", async () => {
    expect(code(await encode(MAX))).toBe("ok");
    expect(code(await encode(MAX + 1n))).toBe("E_RANGE");
    expect(code(await encode(-1n))).toBe("E_RANGE");
  });

  test("zigzag: the signed 64-bit range", async () => {
    expect(code(await encode(-(1n << 63n), true))).toBe("ok");
    expect(code(await encode((1n << 63n) - 1n, true))).toBe("ok");
    expect(code(await encode(1n << 63n, true))).toBe("E_RANGE");
    expect(code(await encode(-(1n << 63n) - 1n, true))).toBe("E_RANGE");
  });

  test("0x, 0o and 0b prefixes are read as in CyberChef (BigInt)", async () => {
    // 255 = ff 01, 16 = 10, 364 = ec 02, 511 = ff 03 (computed by hand: 7-bit groups, least significant first)
    for (const [s, hexOut] of [
      ["0xFF", "ff01"],
      ["0x10", "10"],
      ["0b101101100", "ec02"],
      ["0o777", "ff03"],
      [" 0Xff ", "ff01"],
    ] as const) {
      const r = await encode(s);
      expect(code(r), s).toBe("ok");
      expect(
        Array.from(top(r).v as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join(""),
        s,
      ).toBe(hexOut);
    }
  });

  test("text that is not a whole number is E_COERCE", async () => {
    for (const s of [
      "",
      " ",
      "abc",
      "1.5",
      "1e3",
      "0xzz",
      "0x",
      "0b2",
      "0o8",
      "+5",
      "1 2",
      "--1",
      "١٢",
    ])
      expect(code(await encode(s)), JSON.stringify(s)).toBe("E_COERCE");
  });

  test("decode: 10 bytes whose last byte is 1 hold 2^64 - 1, a last byte of 2 does not fit", async () => {
    expect(top(await decode(ref(MAX))).v).toBe(MAX.toString());
    const over = Uint8Array.from(ref(MAX));
    over[9] = 2;
    expect(code(await decode(over))).toBe("E_COERCE");
  });
});

describe("damaged VarInts are E_COERCE", () => {
  test("every cut of every length from 1 to 10 bytes", async () => {
    for (let n = 1; n <= 10; n++) {
      const v = n === 10 ? MAX : (1n << BigInt(7 * n - 1)) | 1n;
      const e = ref(v);
      expect(e.length).toBe(n);
      expect(code(await decode(e))).toBe("ok");
      for (let cut = 0; cut < n; cut++)
        expect(code(await decode(e.slice(0, cut))), `${n} bytes cut at ${cut}`).toBe("E_COERCE");
    }
  });

  test("messages say which fault it is", async () => {
    const msg = async (b: Uint8Array) => {
      const r = await decode(b);
      return r.ok ? "ok" : r.error.message;
    };
    expect(await msg(new Uint8Array(0))).toContain("empty");
    expect(await msg(Uint8Array.from([0x80]))).toContain("truncated");
    expect(await msg(new Uint8Array(11).fill(0x80))).toContain("longer than 10");
    expect(await msg(Uint8Array.from([1, 2]))).toContain("1 more bytes");
  });

  test("a non-minimal VarInt is accepted", async () => {
    expect(top(await decode(Uint8Array.from([0x80, 0x00]))).v).toBe("0");
    expect(top(await decode(Uint8Array.from([0xac, 0x82, 0x00]))).v).toBe("300");
  });
});

describe("cost", () => {
  test("a hostile input of 64 KiB of continuation bytes stops after ten bytes", async () => {
    const r = await decode(new Uint8Array(65_536).fill(0x80), false, strict);
    expect(code(r)).toBe("E_COERCE");
    expect(!r.ok && r.error.message).toContain("longer than 10");
  });

  test("64 KiB of VarInt bytes after a valid VarInt is a trailing-bytes error, found in a few steps", async () => {
    const d = new Uint8Array(65_536);
    d[0] = 0x05;
    const r = await decode(d, false, strict);
    expect(code(r)).toBe("E_COERCE");
  });

  test("a number of 65,536 digits is refused by the integer size limit, not parsed", async () => {
    const r = await encode("9".repeat(65_536), false, strict);
    expect(code(r)).not.toBe("ok");
  });

  test("VM steps for a 10-byte VarInt", async () => {
    const e = await encode(MAX, false, strict);
    expect(e.ok && e.steps).toBeLessThan(1500);
    const d = await decode(ref(MAX), true, strict);
    expect(d.ok && d.steps).toBeLessThan(1500);
  });
});
