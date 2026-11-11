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
 * Tests for the `protobuf` vocabulary (vocab/protobuf.fth, src/prims/protobuf.ts): Protobuf Decode without a
 * schema. The known-answer vectors (vocab/protobuf.test.json) hold messages serialised by Python's protobuf
 * library; here: truncation at every cut point, the nesting limit, exact big integers, hostile lengths, the value
 * limit, mutated input and the cost on 64 KiB.
 */
import { valueHelpers } from "@forge/lang";
import type { Limits, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_NESTING } from "./prims/protobuf.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, bool, int } = valueHelpers;
const bundle = await loadBundleNode(["protobuf"]);
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
const decode = (b: Uint8Array, types = false, indent = 0, rt = runtime) =>
  rt.call("protobuf:decode", [bytes(b), bool(types), int(indent)]);
const json = async (b: Uint8Array, types = false, rt = runtime): Promise<unknown> =>
  JSON.parse(top(await decode(b, types, 0, rt)).v as string);

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    o.set(p, at);
    at += p.length;
  }
  return o;
};
const varint = (n: bigint): Uint8Array => {
  const o: number[] = [];
  while (n >= 128n) {
    o.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  o.push(Number(n));
  return Uint8Array.from(o);
};
const tag = (field: number, wire: number): Uint8Array => varint(BigInt(field * 8 + wire));
const fVarint = (f: number, v: bigint): Uint8Array => cat(tag(f, 0), varint(v));
const fDelim = (f: number, d: Uint8Array): Uint8Array =>
  cat(tag(f, 2), varint(BigInt(d.length)), d);
const fText = (f: number, s: string): Uint8Array =>
  fDelim(
    f,
    Uint8Array.from(s, (c) => c.charCodeAt(0)),
  );
const f32 = (f: number, v: number): Uint8Array =>
  cat(tag(f, 5), Uint8Array.from([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]));
const f64 = (f: number, v: bigint): Uint8Array =>
  cat(
    tag(f, 1),
    Uint8Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 255n)),
  );
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("fields", () => {
  test("varints, fixed values and exact big integers", async () => {
    const m = cat(
      fVarint(1, 150n),
      fVarint(2, (1n << 64n) - 1n),
      fVarint(3, (1n << 53n) + 1n),
      f64(4, 0xfedcba9876543210n),
      f32(5, 0xdeadbeef),
    );
    // JSON.parse would round the big ones: compare the text
    expect(top(await decode(m)).v).toBe(
      '{"1":150,"2":18446744073709551615,"3":9007199254740993,"4":18364758544493064720,"5":3735928559}',
    );
  });

  test("repeated fields collect in wire order, in a nested message too", async () => {
    const m = cat(
      fVarint(1, 3n),
      fVarint(1, 1n),
      fDelim(2, cat(fVarint(1, 9n), fVarint(1, 8n))),
      fVarint(1, 2n),
    );
    expect(await json(m)).toEqual({ "1": [3, 1, 2], "2": { "1": [9, 8] } });
  });

  test("keys come out in ascending field number", async () => {
    const m = cat(fVarint(300, 1n), fVarint(2, 1n), fVarint(70000, 1n), fVarint(1, 1n));
    expect(top(await decode(m)).v).toBe('{"1":1,"2":1,"300":1,"70000":1}');
  });

  test("a length-delimited field: message first, then text, then hex", async () => {
    expect(await json(fDelim(1, cat(fVarint(1, 5n))))).toEqual({ "1": { "1": 5 } });
    expect(await json(fText(1, "hello"))).toEqual({ "1": "hello" });
    expect(await json(fDelim(1, Uint8Array.from([0xc3, 0xa9])))).toEqual({ "1": "é" });
    expect(await json(fDelim(1, Uint8Array.from([0xc3])))).toEqual({ "1": "c3" });
    expect(await json(fDelim(1, Uint8Array.from([0xff, 0xfe])))).toEqual({ "1": "fffe" });
    expect(await json(fDelim(1, new Uint8Array(0)))).toEqual({ "1": {} });
  });

  test("show types labels every key, nested ones too", async () => {
    const m = cat(
      fVarint(1, 1n),
      f64(2, 1n),
      f32(3, 1),
      fText(4, "hello"),
      fDelim(5, fVarint(1, 1n)),
    );
    expect(await json(m, true)).toEqual({
      "field #1: VarInt (e.g. int32, bool)": 1,
      "field #2: 64-Bit (e.g. fixed64, double)": 1,
      "field #3: 32-Bit (e.g. fixed32, float)": 1,
      "field #4: L-delim (e.g. string, message)": "hello",
      "field #5: L-delim (e.g. string, message)": { "field #1: VarInt (e.g. int32, bool)": 1 },
    });
  });

  test("indent: 4 by default in the sense of CyberChef, 0 is compact", async () => {
    const m = fVarint(1, 1n);
    expect(top(await decode(m, false, 4)).v).toBe('{\n    "1": 1\n}');
    expect(top(await decode(m, false, 0)).v).toBe('{"1":1}');
    expect(top(await decode(m, false, 2)).v).toBe('{\n  "1": 1\n}');
    expect(code(await decode(m, false, 33))).toBe("E_RANGE");
  });

  test("short text that happens to be a message is read as one (CyberChef's guess, as protoc --decode_raw)", async () => {
    // "hi" is field 13 with the varint 105
    expect(await json(fText(1, "hi"))).toEqual({ "1": { "13": 105 } });
    expect(await json(fText(1, "hello"))).toEqual({ "1": "hello" });
  });
});

describe("nesting", () => {
  const nest = (levels: number): Uint8Array => {
    let b = fVarint(1, 1n);
    for (let i = 0; i < levels; i++) b = fDelim(1, b);
    return b;
  };
  const depth = (v: unknown): number =>
    typeof v === "object" && v !== null ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0;

  test("the top message and 64 nested levels are records: the next level stays text or hex", async () => {
    expect(MAX_NESTING).toBe(64);
    // nest(n) is n wrappers around {1: 1}, so n + 1 levels of records if all are opened
    expect(depth(await json(nest(0)))).toBe(1);
    expect(depth(await json(nest(63)))).toBe(64);
    expect(depth(await json(nest(64)))).toBe(65);
    expect(depth(await json(nest(65)))).toBe(65);
    expect(depth(await json(nest(5000)))).toBe(65);
  });

  test("a deeply nested hostile input of 64 KiB costs little", async () => {
    let b = fVarint(1, 1n);
    while (b.length < 60_000) b = fDelim(1, b);
    const r = await decode(b, false, 0, strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(100);
  });
});

describe("errors are E_COERCE with the offset", () => {
  const msg = async (b: Uint8Array) => {
    const r = await decode(b);
    expect(code(r)).toBe("E_COERCE");
    return !r.ok ? r.error.message : "";
  };

  test("each kind of fault says what it is", async () => {
    expect(await msg(Uint8Array.from([0x08, 0x80]))).toContain("varint is cut short");
    expect(await msg(Uint8Array.from([0x08]))).toContain("cut short");
    expect(await msg(Uint8Array.from([0x80]))).toContain("cut short");
    expect(await msg(Uint8Array.from([0x0a, 0x05, 0x61]))).toContain("declares 5 bytes but only 1");
    expect(await msg(Uint8Array.from([0x09, 1, 2, 3]))).toContain("64-bit field is cut short");
    expect(await msg(Uint8Array.from([0x0d, 1, 2]))).toContain("32-bit field is cut short");
    expect(await msg(Uint8Array.from([0x0b]))).toContain("start group");
    expect(await msg(Uint8Array.from([0x0c]))).toContain("end group");
    expect(await msg(Uint8Array.from([0x0e]))).toContain("reserved");
    expect(await msg(Uint8Array.from([0x00, 0x01]))).toContain("field number 0");
    expect(
      await msg(
        cat(Uint8Array.from([0x08]), new Uint8Array(9).fill(0xff), Uint8Array.from([0x81, 0x01])),
      ),
    ).toContain("longer than 10");
    expect(await msg(cat(Uint8Array.from([0x08]), new Uint8Array(10).fill(0xff)))).toContain(
      "longer than 10",
    );
    expect(
      await msg(cat(Uint8Array.from([0x08]), new Uint8Array(9).fill(0xff), Uint8Array.from([2]))),
    ).toContain("more than 64 bits");
    expect(await msg(Uint8Array.from([0x08, 0x01, 0x80]))).toContain("offset 2");
  });

  test("a start-group tag inside a nested message only makes the guess fail: the field is text or hex", async () => {
    expect(await json(fDelim(1, Uint8Array.from([0x0b, 0x0c])))).toEqual({ "1": "\u000b\u000c" });
  });

  test("a message cut at every point is E_COERCE unless the cut is between two top-level fields", async () => {
    const fields = [
      fVarint(1, 300n),
      fText(2, "testing"),
      fDelim(3, cat(fVarint(1, 150n), fText(2, "abc"))),
      f64(4, 7n),
      f32(5, 9),
      fVarint(6, (1n << 64n) - 1n),
      fDelim(7, Uint8Array.from([0xff, 0xfe, 0x00])),
      fVarint(300000, 5n),
    ];
    const whole = cat(...fields);
    const boundaries = new Set<number>();
    let at = 0;
    boundaries.add(0);
    for (const f of fields) boundaries.add((at += f.length));
    for (let n = 0; n <= whole.length; n++) {
      const r = await decode(whole.slice(0, n));
      expect(code(r), `cut at ${n} (${toHex(whole.slice(0, n))})`).toBe(
        boundaries.has(n) ? "ok" : "E_COERCE",
      );
    }
  });
});

describe("hostile lengths allocate nothing", () => {
  test("lengths of 2^31, 2^32 and 2^64 - 1 on a tiny message", async () => {
    for (const len of [1n << 31n, 1n << 32n, (1n << 64n) - 1n]) {
      const r = await decode(
        cat(tag(1, 2), varint(len), Uint8Array.from([1, 2, 3])),
        false,
        0,
        strict,
      );
      expect(code(r)).toBe("E_COERCE");
    }
  });

  test("the value limit stops a message of many fields", async () => {
    const fields = cat(
      ...Array.from({ length: 20_000 }, (_, i) => fVarint(1 + (i % 100), BigInt(i))),
    );
    const small = assembleRuntime(bundle, { limits: { ...untrusted, maxValueBytes: 500_000 } });
    const r = await decode(fields, false, 0, small);
    expect(code(r)).toBe("E_LIMIT_VALUE");
    const ok = await decode(fields, false, 0, strict);
    expect(code(ok)).toBe("ok");
  }, 60_000);
});

describe("mutated input gives a result or E_COERCE, nothing else", () => {
  let seed = 20260713;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 8;
  };
  const sample = cat(
    fVarint(1, 150n),
    fText(2, "testing"),
    fDelim(3, cat(fVarint(1, 7n), fText(2, "x"), fDelim(3, fVarint(1, 1n)))),
    f64(4, 77n),
    f32(5, 99),
    fDelim(6, Uint8Array.from([0xff, 0xfe])),
  );
  test(`${sample.length} bytes, 500 mutations, with and without types`, async () => {
    for (let i = 0; i < 500; i++) {
      const m = Uint8Array.from(sample);
      for (let k = 0, n = 1 + (next() % 3); k < n; k++) m[next() % m.length] = next() & 255;
      const r = await decode(m, i % 2 === 0);
      expect(["ok", "E_COERCE"], toHex(m)).toContain(code(r));
    }
  }, 60_000);
});

describe("cost on 64 KiB (steps are VM steps, measured)", () => {
  test("33,000 two-byte varint fields (64 KiB): one primitive call", async () => {
    const m = cat(
      ...Array.from({ length: 33_000 }, (_, i) => fVarint(1 + (i % 15), BigInt(i % 100))),
    );
    expect(m.length).toBeGreaterThan(64_000);
    const r = await decode(m, false, 0, strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(100);
  }, 60_000);

  test("one 64 KiB string, and 64 KiB of hex-only bytes", async () => {
    const s = await decode(fText(1, "a".repeat(65_000)), false, 0, strict);
    expect(code(s)).toBe("ok");
    expect(s.ok && s.steps).toBeLessThan(100);
    const h = await decode(fDelim(1, new Uint8Array(65_000).fill(0xff)), false, 4, strict);
    expect(code(h)).toBe("ok");
  });

  test("length-delimited fields that all fail the nested guess at the end cost linear work", async () => {
    // 3,000 fields of 20 bytes, each a short run that parses as a message until its last byte breaks it
    const bad = cat(fVarint(1, 1n), fVarint(2, 2n), Uint8Array.from([0x0b]));
    const m = cat(...Array.from({ length: 3000 }, () => fDelim(1, bad)));
    const r = await decode(m, false, 0, strict);
    expect(code(r)).toBe("ok");
    expect(r.ok && r.steps).toBeLessThan(100);
  });
});
