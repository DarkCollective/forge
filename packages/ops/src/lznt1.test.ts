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
 * Tests for the `lznt1` vocabulary (vocab/lznt1.fth, primitive in src/prims/lznt1.ts). No local tool
 * produces LZNT1, so the tests carry a test-only greedy ENCODER written from [MS-XCA] section 2.5
 * (compressed and uncompressed chunks, the displacement/length split that follows the chunk
 * position, an optional end-of-buffer marker) and check decode(encode(x)) = x on many inputs, up to
 * 64 KiB. The worked example of [MS-XCA] section 3.3 (read from the specification) is a test too.
 * The encoder's streams for a few inputs are the fixed vectors of vocab/lznt1.test.json; the test
 * "the encoder vectors in lznt1.test.json are the encoder's output" keeps them in step (the
 * file was generated from the encoder and formatted with prettier).
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lznt1"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (s: string) => new TextEncoder().encode(s);
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) =>
  Uint8Array.from((h.replace(/\s+/g, "").match(/../g) ?? []).map((b) => parseInt(b, 16)));
const call = (args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call("lznt1:decompress", args, limits === undefined ? undefined : { limits });
const decompress = (d: Uint8Array, limits?: { maxValueBytes: number }) => call([bytes(d)], limits);

function randBytes(n: number, seed: number, mod = 256): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 24) % mod;
  });
}

/** Compressible text: words from a small vocabulary. */
function prose(n: number, seed: number): Uint8Array {
  const words = ["forge", "lznt1", "the", "of", "chunk", "flag", "window", "ntfs", "\n", "xpress"];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[s >>> 28 > 9 ? 0 : s >>> 28] as string} `;
  }
  return text(t.slice(0, n));
}

// ---- the test-only encoder (MS-XCA 2.5) ----

const bitLength = (n: number) => (n === 0 ? 0 : 32 - Math.clz32(n));

/** A greedy compressed chunk body (flag groups) for up to 4096 bytes. */
function encodeChunkBody(ch: Uint8Array): Uint8Array {
  const body: number[] = [];
  const seen = new Map<number, number[]>();
  const note = (p: number) => {
    if (p + 2 >= ch.length) return;
    const k = (ch[p] as number) | ((ch[p + 1] as number) << 8) | ((ch[p + 2] as number) << 16);
    const list = seen.get(k) ?? [];
    list.push(p);
    seen.set(k, list);
  };
  let pos = 0;
  while (pos < ch.length) {
    const flagAt = body.length;
    body.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && pos < ch.length; bit++) {
      // U = pos: D displacement bits, L = 16 - D length bits (4 <= D <= 12)
      const d = Math.min(12, Math.max(4, bitLength(Math.max(pos - 1, 0))));
      const lengthBits = 16 - d;
      const maxLength = (1 << lengthBits) + 2;
      let best = 0;
      let bestAt = 0;
      if (pos + 2 < ch.length) {
        const k =
          (ch[pos] as number) | ((ch[pos + 1] as number) << 8) | ((ch[pos + 2] as number) << 16);
        const candidates = seen.get(k) ?? [];
        for (let i = candidates.length - 1, tried = 0; i >= 0 && tried < 64; i--, tried++) {
          const q = candidates[i] as number;
          let l = 0;
          while (pos + l < ch.length && l < maxLength && ch[q + l] === ch[pos + l]) l++;
          if (l > best) {
            best = l;
            bestAt = q;
          }
        }
      }
      if (best >= 3) {
        const word = ((pos - bestAt - 1) << lengthBits) | (best - 3);
        body.push(word & 255, word >> 8);
        flags |= 1 << bit;
        for (let i = 0; i < best; i++) note(pos + i);
        pos += best;
      } else {
        body.push(ch[pos] as number);
        note(pos);
        pos++;
      }
    }
    body[flagAt] = flags;
  }
  return Uint8Array.from(body);
}

interface EncodeOptions {
  /** Append the two-byte End_of_buffer marker. */
  end?: boolean;
  /** Never compress: every chunk is stored. */
  stored?: boolean;
}

/** An LZNT1 buffer: chunks of 4096 input bytes, compressed when that is smaller, else stored. */
function lznt1Encode(data: Uint8Array, opts: EncodeOptions = {}): Uint8Array {
  const parts: number[] = [];
  for (let c = 0; c < data.length; c += 4096) {
    const ch = data.subarray(c, c + 4096);
    const body = opts.stored === true ? undefined : encodeChunkBody(ch);
    if (body !== undefined && body.length < ch.length) {
      const header = 0xb000 | (body.length + 2 - 3);
      parts.push(header & 255, header >> 8, ...body);
    } else {
      const header = 0x3000 | (ch.length - 1);
      parts.push(header & 255, header >> 8, ...ch);
    }
  }
  if (opts.end === true) parts.push(0, 0);
  return Uint8Array.from(parts);
}

// ---- the worked example of [MS-XCA] section 3.3 ----

const SPEC_COMPRESSED = unhex(`
  38 b0 88 46 23 20 00 20  47 20 41 00 10 a2 47 01
  a0 45 20 44 00 08 45 01  50 79 00 c0 45 20 05 24
  13 88 05 b4 02 4a 44 ef  03 58 02 8c 09 16 01 48
  45 00 be 00 9e 00 04 01  18 90 00`);
const SPEC_TEXT =
  "F# F# G A A G F# E D D E F# F# E E F# F# G A A G F# E D D E F# E D D E E F# D E F# G F# D E " +
  "F# G F# E D E A F# F# G A A G F# E D D E F# E D D";

describe("the worked example of MS-XCA section 3.3", () => {
  test("the 59 compressed bytes give the 142-byte string, NUL included", async () => {
    expect(SPEC_COMPRESSED.length).toBe(59);
    const expected = Uint8Array.from([...text(SPEC_TEXT), 0]);
    expect(expected.length).toBe(142);
    const r = await decompress(SPEC_COMPRESSED);
    expect(Array.from(out(r) ?? [])).toEqual(Array.from(expected));
  });
});

// ---- the vectors that come from the encoder ----

const VECTOR_INPUTS: [string, Uint8Array][] = [
  ["a short text with repeats", text("abcabcabcabcabcabc hello hello hello")],
  ["one byte", text("Z")],
  ["alphabet", text("abcdefghijklmnopqrstuvwxyz")],
  ["4096 zero bytes (one chunk, one long match)", new Uint8Array(4096)],
  ["5000 bytes of prose (two chunks)", prose(5000, 7)],
  ["300 bytes of 4-symbol noise", randBytes(300, 11, 4)],
];

interface Vec {
  name: string;
  ref: string;
  op: string;
  params: Record<string, never>;
  input: { value: string; enc: "hex" };
  expect: { value: string; enc: "hex" } | { error: string };
}

function encoderVectors(): Vec[] {
  const ref =
    "test-only greedy LZNT1 encoder in src/lznt1.test.ts, written from MS-XCA 2.5 (not an independent tool)";
  const vecs: Vec[] = [];
  for (const [name, data] of VECTOR_INPUTS) {
    for (const end of [false, true]) {
      vecs.push({
        name: `decompress: ${name}${end ? ", with the end marker" : ""}`,
        ref,
        op: "lznt1:decompress",
        params: {},
        input: { value: hex(lznt1Encode(data, { end })), enc: "hex" },
        expect: { value: hex(data), enc: "hex" },
      });
    }
  }
  vecs.push({
    name: "decompress: random bytes are stored in an uncompressed chunk",
    ref,
    op: "lznt1:decompress",
    params: {},
    input: { value: hex(lznt1Encode(randBytes(100, 5), { stored: true })), enc: "hex" },
    expect: { value: hex(randBytes(100, 5)), enc: "hex" },
  });
  return vecs;
}

const VECTOR_FILE = `${fileURLToPath(import.meta.url).replace(/[^/\\]*$/, "")}../vocab/lznt1.test.json`;

describe("fixed vectors", () => {
  test("the encoder vectors in lznt1.test.json are the encoder's output", () => {
    const generated = encoderVectors();
    const file = JSON.parse(readFileSync(VECTOR_FILE, "utf8")) as Vec[];
    const byName = new Map(file.map((v) => [v.name, v]));
    for (const g of generated) expect(byName.get(g.name), g.name).toEqual(g);
  });

  test("every vector decodes (or fails) as the file says", async () => {
    const file = JSON.parse(readFileSync(VECTOR_FILE, "utf8")) as Vec[];
    expect(file.length).toBeGreaterThan(10);
    for (const v of file) {
      const r = await decompress(unhex(v.input.value));
      if ("error" in v.expect) expect(code(r), v.name).toBe(v.expect.error);
      else expect(hex(out(r) ?? new Uint8Array(0)), v.name).toBe(v.expect.value);
    }
  });
});

// ---- decode(encode(x)) = x ----

describe("lznt1:decompress round trips", () => {
  const SAMPLES: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["one byte", Uint8Array.of(65)],
    ["two bytes", text("ab")],
    ["short text", text("hello hello hello hello world, hello lznt1")],
    ["4095 bytes", prose(4095, 1)],
    ["4096 bytes", prose(4096, 2)],
    ["4097 bytes", prose(4097, 3)],
    ["8192 zeros", new Uint8Array(8192)],
    ["prose", prose(30_000, 4)],
    ["binary noise, 2 symbols", randBytes(10_000, 5, 2)],
    ["binary noise, 4 symbols", randBytes(10_000, 6, 4)],
    ["binary noise, 20 symbols", randBytes(10_000, 7, 20)],
    ["random bytes (stored chunks)", randBytes(9000, 8)],
    ["a long run then text", Uint8Array.from([...new Uint8Array(3000), ...prose(3000, 9)])],
  ];
  for (const [name, data] of SAMPLES) {
    test(`${name}: with and without the end marker, and stored`, async () => {
      for (const opts of [{}, { end: true }, { stored: true }, { stored: true, end: true }]) {
        const r = await decompress(lznt1Encode(data, opts));
        expect(Array.from(out(r) ?? [-1]), JSON.stringify(opts)).toEqual(Array.from(data));
      }
    });
  }

  test("each position class of the displacement/length split is exercised", async () => {
    // Matches at output positions in every band (<=16, <=32, ... <=4096 within a chunk): a period-7
    // pattern repeated gives a match at every band boundary.
    const data = Uint8Array.from({ length: 4096 }, (_, i) => (i * i + (i % 7)) & 3);
    const enc = lznt1Encode(data);
    expect(enc[1]! & 0x80).toBe(0x80); // compressed
    expect(Array.from(out(await decompress(enc)) ?? [])).toEqual(Array.from(data));
  });

  test("65536 compressible and incompressible bytes round trip in a few VM steps", async () => {
    for (const data of [
      prose(65_536, 1),
      randBytes(65_536, 2, 4),
      randBytes(65_536, 3),
      new Uint8Array(65_536),
    ]) {
      const r = await decompress(lznt1Encode(data, { end: true }));
      expect(r.ok).toBe(true);
      expect(Array.from(out(r) ?? [])).toEqual(Array.from(data));
      expect(r.ok && r.steps).toBeLessThan(1000);
    }
  }, 60_000);

  test("bytes after a zero header are ignored", async () => {
    const data = prose(6000, 12);
    const enc = Uint8Array.from([...lznt1Encode(data, { end: true }), 9, 9, 9, 9, 9]);
    expect(Array.from(out(await decompress(enc)) ?? [])).toEqual(Array.from(data));
  });
});

// ---- corrupt data ----

describe("corrupt data is E_COERCE and names the fault", () => {
  const fault = async (d: Uint8Array) => {
    const r = await decompress(d);
    return r.ok ? "ok" : `${r.error.code}: ${r.error.message}`;
  };

  test("a bad chunk signature", async () => {
    expect(await fault(Uint8Array.of(0x04, 0x80, 0, 0x41, 0))).toMatch(
      /E_COERCE.*signature is 0, not 3/,
    );
    expect(await fault(Uint8Array.of(0x00, 0xf0, 0, 0))).toMatch(/E_COERCE.*signature is 7/);
  });

  test("the data ends inside a chunk header", async () => {
    expect(await fault(Uint8Array.of(1))).toMatch(/E_COERCE.*chunk header.*truncated/);
    const enc = lznt1Encode(prose(5000, 1));
    expect(await fault(Uint8Array.from([...enc, 0x07]))).toMatch(/E_COERCE.*chunk header/);
  });

  test("every cut inside a chunk is a truncated chunk", async () => {
    const data = prose(9000, 2);
    const enc = lznt1Encode(data);
    const boundaries = new Set<number>([0]);
    for (let p = 0; p < enc.length;) {
      p += ((enc[p]! | (enc[p + 1]! << 8)) & 0xfff) + 3;
      boundaries.add(p);
    }
    for (let cut = 1; cut < enc.length; cut++) {
      const msg = await fault(enc.subarray(0, cut));
      if (boundaries.has(cut)) expect(msg, `cut ${cut}`).toBe("ok");
      else expect(msg, `cut ${cut}`).toMatch(/E_COERCE/);
    }
  });

  test("a match before the start of the output of its chunk", async () => {
    // the first element is a match
    expect(await fault(Uint8Array.of(0x02, 0xb0, 0x01, 0x00, 0x00))).toMatch(
      /E_COERCE.*before the start/,
    );
    // 'A', then a match 5 back
    expect(await fault(Uint8Array.of(0x03, 0xb0, 0x02, 0x41, 0x00, 0x40))).toMatch(
      /E_COERCE.*before the start/,
    );
    // a second chunk cannot refer into the first
    const two = Uint8Array.from([
      ...lznt1Encode(text("abcdefgh")),
      0x03,
      0xb0,
      0x02,
      0x41,
      0x00,
      0x10,
    ]);
    expect(await fault(two)).toMatch(/E_COERCE.*before the start/);
  });

  test("a compressed word cut short by the end of its chunk", async () => {
    expect(await fault(Uint8Array.of(0x01, 0xb0, 0x01, 0x00))).toMatch(/E_COERCE.*compressed word/);
  });

  test("a chunk that expands past 4096 bytes", async () => {
    // 'A', then a match of 4098 bytes at distance 1
    expect(await fault(Uint8Array.of(0x03, 0xb0, 0x02, 0x41, 0xff, 0x0f))).toMatch(
      /E_COERCE.*4096/,
    );
  });

  test("an error returns no partial output", async () => {
    const enc = lznt1Encode(prose(9000, 3));
    const r = await decompress(enc.subarray(0, enc.length - 3));
    expect(r.ok).toBe(false);
  });
});

// ---- the output limit ----

describe("the output limit (decompression bombs)", () => {
  const LIMIT = 1024 * 1024;
  const zeroChunk = lznt1Encode(new Uint8Array(4096)); // a few bytes that expand to 4096
  const bomb = (chunks: number) =>
    Uint8Array.from(
      { length: chunks * zeroChunk.length },
      (_, i) => zeroChunk[i % zeroChunk.length] as number,
    );

  test("a small stream that expands past maxValueBytes stops with E_LIMIT_VALUE", async () => {
    expect(zeroChunk.length).toBeLessThan(10);
    const b = bomb(5000); // 20 MiB of zeros from about 30 KB
    expect(b.length).toBeLessThan(40_000);
    const t0 = Date.now();
    const r = await decompress(b, { maxValueBytes: LIMIT });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/decompressed data/);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  test("exactly the limit is allowed, one chunk more is not", async () => {
    expect(out(await decompress(bomb(256), { maxValueBytes: LIMIT }))?.length).toBe(LIMIT);
    expect(code(await decompress(bomb(257), { maxValueBytes: LIMIT }))).toBe("E_LIMIT_VALUE");
  });

  test("the default limit protects without being asked", async () => {
    // 68 MB of output is over the 64 MiB default
    expect(code(await decompress(bomb(17_000)))).toBe("E_LIMIT_VALUE");
  });
});
