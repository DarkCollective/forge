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
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { BitWriter } from "../test/bits.js";
import { Rng } from "../test/gen.js";
import { deflateRaw, deflateStreamLength, inflateRaw } from "./deflate.js";

const text = (s: string) => new TextEncoder().encode(s);

function random(n: number, seed = 1): Uint8Array {
  const rng = new Rng(seed);
  return Uint8Array.from({ length: n }, () => rng.int(256));
}

function words(n: number, seed = 2): Uint8Array {
  const rng = new Rng(seed);
  const vocab = ["alpha", "beta", "gamma", "delta", " ", "\n", "0123456789", "forge", "recipe"];
  let s = "";
  while (s.length < n) s += rng.pick(vocab);
  return text(s.slice(0, n));
}

const samples: [string, Uint8Array][] = [
  ["empty", new Uint8Array(0)],
  ["one byte", Uint8Array.of(7)],
  ["short text", text("hello world")],
  ["repetitive", text("abc".repeat(5000))],
  ["zeros", new Uint8Array(100_000)],
  ["words", words(50_000)],
  ["random", random(20_000)],
  ["mixed", Uint8Array.from([...words(3000), ...random(3000), ...words(3000, 9)])],
];

describe("deflateStreamLength agrees with zlib (RFC 1951)", () => {
  for (const [name, data] of samples) {
    test(`${name}, every compression level`, () => {
      for (let level = 0; level <= 9; level++) {
        const packed = deflateRawSync(data, { level });
        expect(deflateStreamLength(packed)).toBe(packed.length);
        // bytes after the end of the stream are not part of it
        const trailing = Uint8Array.from([...packed, 0, 1, 2]);
        expect(deflateStreamLength(trailing)).toBe(packed.length);
      }
    });
  }

  test("a stream cut short is malformed", () => {
    for (const [, data] of samples.slice(2)) {
      const packed = deflateRawSync(data);
      expect(deflateStreamLength(packed.slice(0, packed.length - 1))).toBe(-1);
      expect(deflateStreamLength(packed.slice(0, 1))).toBe(-1);
    }
    expect(deflateStreamLength(new Uint8Array(0))).toBe(-1);
  });

  test("several blocks in a row", () => {
    const w = new BitWriter();
    // a non-final fixed block with one literal, then a final stored block of two bytes
    w.bits(0, 1).bits(1, 2).fixedLit(0x61).fixedLit(256);
    w.bits(1, 1).bits(0, 2).alignToByte().bits(2, 16).bits(0xfffd, 16).bits(0x41, 8).bits(0x42, 8);
    const bytes = w.bytes();
    expect(deflateStreamLength(bytes)).toBe(bytes.length);
  });
});

describe("deflateStreamLength rejects malformed streams", () => {
  const final = (type: number) => new BitWriter().bits(1, 1).bits(type, 2);

  test("block type 3", () => {
    expect(deflateStreamLength(final(3).bits(0, 8).bytes())).toBe(-1);
  });

  test("stored blocks", () => {
    const stored = (len: number, nlen: number, payload = 0) => {
      const w = final(0).alignToByte().bits(len, 16).bits(nlen, 16);
      for (let i = 0; i < payload; i++) w.bits(i, 8);
      return w.bytes();
    };
    expect(deflateStreamLength(stored(0, 0xffff))).toBe(5);
    expect(deflateStreamLength(stored(3, 0xfffc, 3))).toBe(8);
    expect(deflateStreamLength(stored(3, 0xfffc, 2))).toBe(-1); // payload too short
    expect(deflateStreamLength(stored(3, 0x0000, 3))).toBe(-1); // NLEN is not the complement
    expect(deflateStreamLength(final(0).bytes())).toBe(-1); // no length field
  });

  test("fixed blocks", () => {
    // 'a', a match of length 3 at distance 1, end of block
    const ok = final(1).fixedLit(0x61).fixedLit(257).code(0, 5).fixedLit(256).bytes();
    expect(deflateStreamLength(ok)).toBe(ok.length);
    // length symbols 286 and 287 do not exist
    expect(deflateStreamLength(final(1).fixedLit(287).bytes())).toBe(-1);
    // a distance symbol of 30 or 31 does not exist
    expect(deflateStreamLength(final(1).fixedLit(257).code(30, 5).bytes())).toBe(-1);
    // no end-of-block code before the data ends
    expect(deflateStreamLength(final(1).fixedLit(0x61).bytes())).toBe(-1);
    // length 258 (symbol 285, no extra bits) and a long distance with extra bits
    const long = final(1).fixedLit(285).code(29, 5).bits(0x1fff, 13).fixedLit(256).bytes();
    expect(deflateStreamLength(long)).toBe(long.length);
  });

  describe("dynamic blocks", () => {
    /** Code length alphabet where only `used` symbols have a 1-bit code (a complete code needs exactly two). */
    function header(opts: {
      nlen?: number;
      ndist?: number;
      clens: Record<number, number>;
      ncode?: number;
    }) {
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const ncode = opts.ncode ?? 19;
      const w = final(2)
        .bits((opts.nlen ?? 257) - 257, 5)
        .bits((opts.ndist ?? 1) - 1, 5)
        .bits(ncode - 4, 4);
      for (let i = 0; i < ncode; i++) w.bits(opts.clens[order[i] as number] ?? 0, 3);
      return w;
    }

    test("too many literal/length or distance codes", () => {
      expect(deflateStreamLength(header({ nlen: 287, clens: { 0: 1, 1: 1 } }).bytes())).toBe(-1);
      expect(deflateStreamLength(header({ ndist: 31, clens: { 0: 1, 1: 1 } }).bytes())).toBe(-1);
    });

    test("an over-subscribed code length code", () => {
      expect(
        deflateStreamLength(header({ clens: { 16: 1, 17: 1, 18: 1 }, ncode: 4 }).bytes()),
      ).toBe(-1);
    });

    test("a repeat of the previous length with no previous length", () => {
      // symbol 16 has code 0, symbol 17 has code 1
      expect(
        deflateStreamLength(
          header({ clens: { 16: 1, 17: 1 }, ncode: 4 })
            .code(0, 1)
            .bits(0, 2)
            .bytes(),
        ),
      ).toBe(-1);
    });

    test("a repeat that runs past the table", () => {
      // symbol 0 has code 0, symbol 18 has code 1: 138 + 138 zeros overflow the 258 lengths
      const w = header({ clens: { 0: 1, 18: 1 }, ncode: 4 });
      w.code(1, 1).bits(127, 7).code(1, 1).bits(127, 7);
      expect(deflateStreamLength(w.bytes())).toBe(-1);
    });

    test("a table without an end-of-block code", () => {
      const w = header({ clens: { 0: 1, 18: 1 }, ncode: 4 });
      w.code(1, 1).bits(127, 7).code(1, 1).bits(109, 7); // 138 + 120 zeros = 258
      expect(deflateStreamLength(w.bytes())).toBe(-1);
    });

    test("a lone end-of-block code is a valid block", () => {
      // code length symbols: 1 has code 0, 18 has code 1. 256 zeros, then lit[256] = 1 and dist[0] = 1.
      const w = header({ clens: { 1: 1, 18: 1 } });
      w.code(1, 1).bits(127, 7).code(1, 1).bits(107, 7).code(0, 1).code(0, 1);
      const ok = Uint8Array.from(w.code(0, 1).bytes());
      expect(deflateStreamLength(ok)).toBe(ok.length);
      // the code '1' is not assigned: decoding fails
      const w2 = header({ clens: { 1: 1, 18: 1 } });
      w2.code(1, 1).bits(127, 7).code(1, 1).bits(107, 7).code(0, 1).code(0, 1);
      const bad = w2.code(1, 1).bits(0, 16).bytes();
      expect(deflateStreamLength(bad)).toBe(-1);
    });

    test("a code length code that cannot be decoded", () => {
      // only symbol 0 has a code (length 1): the code '1' is unassigned
      const w = header({ clens: { 0: 1 }, ncode: 4 });
      expect(deflateStreamLength(w.code(1, 1).bits(0, 16).bytes())).toBe(-1);
    });
  });
});

describe("deflateRaw and inflateRaw", () => {
  test("round trip", async () => {
    for (const [, data] of samples) {
      const packed = await deflateRaw(data);
      const back = await inflateRaw(packed, 1 << 20);
      expect(back.ok && Array.from(back.bytes)).toEqual(Array.from(data));
    }
  });

  test("zlib streams inflate too", async () => {
    const data = words(30_000);
    const back = await inflateRaw(deflateRawSync(data), data.length);
    expect(back.ok && back.bytes.length).toBe(data.length);
  });

  test("the budget is exact", async () => {
    const packed = await deflateRaw(new Uint8Array(1000));
    expect((await inflateRaw(packed, 1000)).ok).toBe(true);
    expect(await inflateRaw(packed, 999)).toEqual({ ok: false, reason: "too-large" });
  });

  test("a stream with a byte after its end is rejected", async () => {
    const packed = await deflateRaw(text("hello"));
    const result = await inflateRaw(Uint8Array.from([...packed, 0]), 100);
    expect(result).toEqual({ ok: false, reason: "bad-compression" });
  });

  test("garbage and truncated streams are rejected", async () => {
    expect(await inflateRaw(Uint8Array.of(255, 255, 255), 100)).toEqual({
      ok: false,
      reason: "bad-compression",
    });
    expect(await inflateRaw(new Uint8Array(0), 100)).toEqual({
      ok: false,
      reason: "bad-compression",
    });
    const packed = await deflateRaw(words(1000));
    expect(await inflateRaw(packed.slice(0, 10), 5000)).toEqual({
      ok: false,
      reason: "bad-compression",
    });
  });

  test("a match before the start of the output is rejected by the inflater", async () => {
    const bytes = new BitWriter()
      .bits(1, 1)
      .bits(1, 2)
      .fixedLit(257)
      .code(0, 5)
      .fixedLit(256)
      .bytes();
    expect(deflateStreamLength(bytes)).toBe(bytes.length); // well-formed as far as the scanner can tell
    expect(await inflateRaw(bytes, 100)).toEqual({ ok: false, reason: "bad-compression" });
  });
});
