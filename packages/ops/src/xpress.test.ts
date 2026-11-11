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
 * Tests for the `xpress` vocabulary (vocab/xpress.fth, primitives in src/prims/xpress.ts). No local
 * tool produces XPRESS, so the tests carry two test-only greedy ENCODERS written from [MS-XCA]:
 * Plain LZ77 (section 2.3, with the shared 4-bit length nibble and the 8-, 16- and 32-bit length
 * extensions) and LZ77+Huffman (section 2.1: 64 KiB blocks, a real canonical Huffman code built
 * from symbol counts and limited to 15 bits, the 16-bit-word bit writer with its two reserved
 * words, the end-of-data symbol). They check decode(encode(x)) = x on many inputs, up to 64 KiB
 * and beyond (several Huffman blocks). The worked examples of [MS-XCA] section 3.1 and 3.2 (read
 * from the specification) are tests too. The encoders' streams for a few inputs are the fixed
 * vectors of vocab/xpress.test.json; the test "the encoder vectors ... are the encoder's output"
 * keeps them in step (the file was generated from these encoders and formatted with prettier).
 *
 * The encoder never emits a length-3 match at distance 1: its Huffman symbol is 256, the same as
 * the end-of-data symbol, and a decoder tells them apart only by "all input read" (section 2.2.4).
 */
import { valueHelpers } from "@forge/lang";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["xpress"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
type Limits = { maxValueBytes: number };
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (s: string) => new TextEncoder().encode(s);
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) =>
  Uint8Array.from((h.replace(/\s+/g, "").match(/../g) ?? []).map((b) => parseInt(b, 16)));
const run = (op: string, d: Uint8Array, limits?: Limits) =>
  runtime.call(op, [bytes(d)], limits === undefined ? undefined : { limits });
const plain = (d: Uint8Array, limits?: Limits) => run("xpress:decompress", d, limits);
const huff = (d: Uint8Array, limits?: Limits) => run("xpress:huffman-decompress", d, limits);
const fault = async (r: Promise<Result>) => {
  const x = await r;
  return x.ok ? "ok" : `${x.error.code}: ${x.error.message}`;
};

function randBytes(n: number, seed: number, mod = 256): Uint8Array {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 24) % mod;
  });
}

function prose(n: number, seed: number): Uint8Array {
  const words = ["forge", "xpress", "the", "of", "huffman", "flag", "window", "smb", "\n", "lz77"];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[s >>> 28 > 9 ? 0 : s >>> 28] as string} `;
  }
  return text(t.slice(0, n));
}

const key3 = (d: Uint8Array, p: number) =>
  (d[p] as number) | ((d[p + 1] as number) << 8) | ((d[p + 2] as number) << 16);

/** A greedy matcher over a hash of three bytes. Positions of a match are noted only briefly. */
class Matcher {
  private readonly seen = new Map<number, number[]>();
  constructor(
    private readonly data: Uint8Array,
    private readonly window: number,
  ) {}

  note(p: number): void {
    if (p + 2 >= this.data.length) return;
    const k = key3(this.data, p);
    const list = this.seen.get(k);
    if (list === undefined) this.seen.set(k, [p]);
    else list.push(p);
  }

  /** The longest match at `pos` of at most `cap` bytes, as [length, distance] (length 0: none). */
  find(pos: number, cap: number): [number, number] {
    let best = 0;
    let dist = 0;
    if (cap < 3 || pos + 2 >= this.data.length) return [0, 0];
    const list = this.seen.get(key3(this.data, pos)) ?? [];
    for (let i = list.length - 1, tried = 0; i >= 0 && tried < 32; i--, tried++) {
      const q = list[i] as number;
      if (pos - q > this.window) break;
      let l = 0;
      while (l < cap && this.data[q + l] === this.data[pos + l]) l++;
      if (l > best) {
        best = l;
        dist = pos - q;
      }
    }
    return [best, dist];
  }

  /** Notes the first positions of a taken match (enough for a greedy encoder). */
  noteRun(pos: number, len: number): void {
    for (let i = 0; i < Math.min(len, 32); i++) this.note(pos + i);
  }
}

// ---- Plain LZ77 test encoder (MS-XCA 2.3) ----

function plainEncode(data: Uint8Array): Uint8Array {
  const o: number[] = [0, 0, 0, 0];
  let flags = 0;
  let flagCount = 0;
  let flagPos = 0;
  let lastHalf = -1;
  const put32 = (at: number, v: number) => {
    for (let i = 0; i < 4; i++) o[at + i] = (v >>> (8 * i)) & 255;
  };
  const push16 = (v: number) => o.push(v & 255, (v >> 8) & 255);
  const push32 = (v: number) =>
    o.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const flag = (bit: number) => {
    flags = ((flags << 1) | bit) >>> 0;
    flagCount++;
    if (flagCount === 32) {
      put32(flagPos, flags);
      flagCount = 0;
      flags = 0;
      flagPos = o.length;
      o.push(0, 0, 0, 0);
    }
  };
  const matcher = new Matcher(data, 8192);
  let pos = 0;
  while (pos < data.length) {
    const [len, dist] = matcher.find(pos, data.length - pos);
    if (len < 3) {
      o.push(data[pos] as number);
      matcher.note(pos);
      pos++;
      flag(0);
      continue;
    }
    let ml = len - 3;
    let word = (dist - 1) << 3;
    if (ml < 7) {
      push16(word + ml);
    } else {
      word |= 7;
      push16(word);
      ml -= 7;
      let extra = true;
      if (lastHalf < 0) {
        lastHalf = o.length;
        if (ml < 15) {
          o.push(ml);
          extra = false;
        } else o.push(15);
      } else if (ml < 15) {
        o[lastHalf] = (o[lastHalf] as number) | (ml << 4);
        lastHalf = -1;
        extra = false;
      } else {
        o[lastHalf] = (o[lastHalf] as number) | (15 << 4);
        lastHalf = -1;
      }
      if (extra) {
        ml -= 15;
        if (ml < 255) o.push(ml);
        else {
          o.push(255);
          ml += 7 + 15;
          if (ml < 65536) push16(ml);
          else {
            push16(0);
            push32(ml);
          }
        }
      }
    }
    flag(1);
    matcher.noteRun(pos, len);
    pos += len;
  }
  // pad the unused flag bits with ones (a full flag word is already written)
  const mask =
    flagCount === 0
      ? 0xffffffff
      : ((flags << (32 - flagCount)) | (2 ** (32 - flagCount) - 1)) >>> 0;
  put32(flagPos, mask);
  return Uint8Array.from(o);
}

// ---- LZ77+Huffman test encoder (MS-XCA 2.1) ----

/** A literal byte, or a match [length, distance]. */
type Tok = number | [number, number];

const highBit = (d: number) => 31 - Math.clz32(d);

/** Code lengths (1 to 15) of a Huffman code of the counts; every length is 0 for an unused symbol. */
function codeLengths(counts: number[]): number[] {
  let c = counts.slice();
  for (;;) {
    let nodes = c.map((w, s) => ({ w, syms: [s] })).filter((n) => n.w > 0);
    const lens = new Array<number>(c.length).fill(0);
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.w - b.w);
      const [a, b] = nodes as [(typeof nodes)[0], (typeof nodes)[0]];
      for (const s of [...a.syms, ...b.syms]) lens[s] = (lens[s] as number) + 1;
      nodes = [...nodes.slice(2), { w: a.w + b.w, syms: [...a.syms, ...b.syms] }];
    }
    if (Math.max(...lens) <= 15) return lens;
    c = c.map((w) => (w === 0 ? 0 : Math.max(1, w >> 1)));
  }
}

/** The bit writer of MS-XCA 2.1.4.3: 16-bit words go into two reserved slots ahead of the length bytes. */
class BitWriter {
  out: number[];
  private p1 = 256;
  private p2 = 258;
  private free = 16;
  private word = 0;
  constructor(table: number[]) {
    this.out = [...table, 0, 0, 0, 0];
  }
  private put(at: number, w: number) {
    this.out[at] = w & 255;
    this.out[at + 1] = (w >> 8) & 255;
  }
  bits(n: number, v: number) {
    if (n === 0) return;
    if (this.free >= n) {
      this.free -= n;
      this.word = ((this.word << n) + v) & 0xffff;
    } else {
      this.word = ((this.word << this.free) + (v >>> (n - this.free))) & 0xffff;
      this.free -= n;
      this.put(this.p1, this.word);
      this.p1 = this.p2;
      this.p2 = this.out.length;
      this.out.push(0, 0);
      this.free += 16;
      this.word = v & 0xffff;
    }
  }
  byte(b: number) {
    this.out.push(b);
  }
  u16(v: number) {
    this.out.push(v & 255, (v >> 8) & 255);
  }
  u32(v: number) {
    this.out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  }
  flush(): Uint8Array {
    this.put(this.p1, (this.word << this.free) & 0xffff);
    this.put(this.p2, 0);
    return Uint8Array.from(this.out);
  }
}

/**
 * One block: the 256-byte table of code lengths and the bit stream of the tokens. `eof` appends the
 * end-of-data symbol (the last block). `wide` writes every length that needs more than a byte in
 * the 32-bit form (a 16-bit zero then 32 bits), which blocks of 64 KiB never need.
 */
function huffBlock(tokens: Tok[], eof: boolean, wide = false): Uint8Array {
  const counts = new Array<number>(512).fill(0);
  const symOf = (len: number, dist: number) => 256 + Math.min(len - 3, 15) + 16 * highBit(dist);
  for (const t of tokens) {
    if (typeof t === "number") counts[t] = (counts[t] as number) + 1;
    else {
      const s = symOf(t[0], t[1]);
      counts[s] = (counts[s] as number) + 1;
    }
  }
  if (eof) counts[256] = (counts[256] as number) + 1;
  // a prefix code needs two symbols; add unused ones (the table must be complete)
  for (let s = 0; counts.filter((c) => c > 0).length < 2; s++) if (counts[s] === 0) counts[s] = 1;
  const lens = codeLengths(counts);
  const codes = new Array<number>(512).fill(0);
  let next = 0;
  for (let l = 1; l <= 15; l++) {
    for (let s = 0; s < 512; s++) if (lens[s] === l) codes[s] = next++;
    next <<= 1;
  }
  const table = Array.from(
    { length: 256 },
    (_, i) => (lens[2 * i] as number) | ((lens[2 * i + 1] as number) << 4),
  );
  const w = new BitWriter(table);
  const sym = (s: number) => w.bits(lens[s] as number, codes[s] as number);
  for (const t of tokens) {
    if (typeof t === "number") {
      sym(t);
      continue;
    }
    const [len, dist] = t;
    sym(symOf(len, dist));
    let l = len - 3;
    if (l >= 15) {
      l -= 15;
      if (l < 255) w.byte(l);
      else {
        w.byte(255);
        l += 15;
        if (l < 65536 && !wide) w.u16(l);
        else {
          w.u16(0);
          w.u32(l);
        }
      }
    }
    const hb = highBit(dist);
    w.bits(hb, dist - (1 << hb));
  }
  if (eof) sym(256);
  return w.flush();
}

/** LZ77+Huffman: blocks of 64 KiB of input, matches within a block, the end symbol in the last. */
function huffEncode(data: Uint8Array, wide = false): Uint8Array {
  const parts: Uint8Array[] = [];
  const matcher = new Matcher(data, 65535);
  let start = 0;
  do {
    const end = Math.min(data.length, start + 65536);
    const tokens: Tok[] = [];
    let pos = start;
    while (pos < end) {
      const [found, dist] = matcher.find(pos, end - pos);
      const len = found === 3 && dist === 1 ? 0 : found; // length 3 at distance 1 would share the end-of-data symbol
      if (len < 3) {
        tokens.push(data[pos] as number);
        matcher.note(pos);
        pos++;
      } else {
        tokens.push([len, dist]);
        matcher.noteRun(pos, len);
        pos += len;
      }
    }
    parts.push(huffBlock(tokens, end === data.length, wide));
    start = end;
  } while (start < data.length);
  return Uint8Array.from(parts.flatMap((p) => Array.from(p)));
}

// ---- the worked examples of [MS-XCA] section 3 (read from the specification) ----

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const ABC300 = "abc".repeat(100);

/** A Huffman code-length table from [byte index, byte] pairs; every other byte is zero. */
const table = (pairs: [number, number][]) => {
  const t = new Uint8Array(256);
  for (const [i, b] of pairs) t[i] = b;
  return t;
};
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

const SPEC_PLAIN_ALPHABET = unhex("3f000000 6162636465666768696a6b6c6d6e6f707172737475767778797a");
const SPEC_PLAIN_ABC300 = unhex("ffffff1f 616263 1700 0fff 2601");
// section 3.2: the table bytes 48 to 61 and byte 128 are the only non-zero ones
const SPEC_HUFF_ALPHABET = concat(
  table([
    [48, 0x50],
    [49, 0x55],
    [50, 0x55],
    [51, 0x55],
    [52, 0x55],
    [53, 0x55],
    [54, 0x55],
    [55, 0x55],
    [56, 0x55],
    [57, 0x55],
    [58, 0x55],
    [59, 0x45],
    [60, 0x44],
    [61, 0x04],
    [128, 0x04],
  ]),
  unhex("d8523ed794115be9195ff9d67cdf8d04 00000000"),
);
const SPEC_HUFF_ABC300 = concat(
  table([
    [48, 0x30],
    [49, 0x23],
    [128, 0x02],
    [143, 0x20],
  ]),
  unhex("a8dc0000 ff2601"),
);

describe("the worked examples of MS-XCA section 3", () => {
  test("3.1 Plain LZ77: the alphabet as 26 literals", async () => {
    expect(SPEC_PLAIN_ALPHABET.length).toBe(30);
    expect(ascii(out(await plain(SPEC_PLAIN_ALPHABET)))).toBe(ALPHABET);
  });
  test("3.1 Plain LZ77: 300 bytes of abc as abc plus one match of 297 at distance 3", async () => {
    expect(ascii(out(await plain(SPEC_PLAIN_ABC300)))).toBe(ABC300);
  });
  test("3.2 LZ77+Huffman: the alphabet as literals", async () => {
    expect(SPEC_HUFF_ALPHABET.length).toBe(276);
    expect(ascii(out(await huff(SPEC_HUFF_ALPHABET)))).toBe(ALPHABET);
  });
  test("3.2 LZ77+Huffman: 300 bytes of abc, long match length", async () => {
    expect(SPEC_HUFF_ABC300.length).toBe(263);
    expect(ascii(out(await huff(SPEC_HUFF_ABC300)))).toBe(ABC300);
  });
  test("the test encoders produce the same bytes as the specification's examples", () => {
    expect(hex(plainEncode(text(ALPHABET)))).toBe(hex(SPEC_PLAIN_ALPHABET));
    expect(hex(plainEncode(text(ABC300)))).toBe(hex(SPEC_PLAIN_ABC300));
  });
});

function ascii(u: Uint8Array | undefined): string {
  return Array.from(u ?? [], (c) => String.fromCharCode(c)).join("");
}

// ---- fixed vectors that come from the encoders ----

const VECTOR_INPUTS: [string, Uint8Array][] = [
  ["a short text with repeats", text("abcabcabcabcabcabc hello hello hello")],
  ["one byte", text("Z")],
  ["600 zero bytes (a long match)", new Uint8Array(600)],
  ["3000 bytes of prose", prose(3000, 7)],
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
  const vecs: Vec[] = [];
  const add = (op: string, enc: (d: Uint8Array) => Uint8Array, label: string, ref: string) => {
    for (const [name, data] of VECTOR_INPUTS)
      vecs.push({
        name: `${label}: ${name}`,
        ref,
        op,
        params: {},
        input: { value: hex(enc(data)), enc: "hex" },
        expect: { value: hex(data), enc: "hex" },
      });
  };
  add(
    "xpress:decompress",
    plainEncode,
    "decompress",
    "test-only greedy Plain LZ77 encoder in src/xpress.test.ts, written from MS-XCA 2.3 (not an independent tool)",
  );
  add(
    "xpress:huffman-decompress",
    (d) => huffEncode(d),
    "huffman-decompress",
    "test-only LZ77+Huffman encoder (canonical code built from symbol counts) in src/xpress.test.ts, written from MS-XCA 2.1 (not an independent tool)",
  );
  return vecs;
}

const VECTOR_FILE = `${fileURLToPath(import.meta.url).replace(/[^/\\]*$/, "")}../vocab/xpress.test.json`;

describe("fixed vectors", () => {
  test("the encoder vectors in xpress.test.json are the encoder's output", () => {
    const generated = encoderVectors();
    const file = JSON.parse(readFileSync(VECTOR_FILE, "utf8")) as Vec[];
    const byName = new Map(file.map((v) => [v.name, v]));
    for (const g of generated) expect(byName.get(g.name), g.name).toEqual(g);
  });

  test("every vector decodes (or fails) as the file says", async () => {
    const file = JSON.parse(readFileSync(VECTOR_FILE, "utf8")) as Vec[];
    expect(file.length).toBeGreaterThan(15);
    for (const v of file) {
      const r = await run(v.op, unhex(v.input.value));
      if ("error" in v.expect) expect(code(r), v.name).toBe(v.expect.error);
      else expect(hex(out(r) ?? new Uint8Array(0)), v.name).toBe(v.expect.value);
    }
  });
});

// ---- Plain LZ77 ----

const SAMPLES: [string, Uint8Array][] = [
  ["one byte", Uint8Array.of(65)],
  ["two bytes", text("ab")],
  ["short text", text("hello hello hello hello world, hello xpress")],
  ["31 literals", randBytes(31, 1)],
  ["32 literals", randBytes(32, 2)],
  ["33 literals", randBytes(33, 3)],
  ["prose", prose(20_000, 4)],
  ["binary noise, 2 symbols", randBytes(8000, 5, 2)],
  ["binary noise, 5 symbols", randBytes(8000, 6, 5)],
  ["random bytes", randBytes(5000, 7)],
  ["300 zeros (a 16-bit length)", new Uint8Array(300)],
  ["70,000 zeros (a 32-bit length)", new Uint8Array(70_000)],
  [
    "a run, text, a run",
    Uint8Array.from([...new Uint8Array(100), ...prose(500, 8), ...new Uint8Array(100)]),
  ],
];

describe("xpress:decompress round trips", () => {
  for (const [name, data] of SAMPLES) {
    test(name, async () => {
      const r = await plain(plainEncode(data));
      expect(Array.from(out(r) ?? [-1])).toEqual(Array.from(data));
    });
  }

  test("two long matches in a row share the 4-bit length nibble", async () => {
    // matches of lengths 12 and 13 (3 + 7 + 2 and 3 + 7 + 3) one after the other
    const a = prose(40, 1);
    const data = Uint8Array.from([...a, ...a.subarray(0, 12), 1, 2, 3, 4, ...a.subarray(0, 13)]);
    const enc = plainEncode(data);
    expect(Array.from(out(await plain(enc)) ?? [])).toEqual(Array.from(data));
  });

  test("an empty input has no encoding but the flag word: it decodes to nothing", async () => {
    const enc = plainEncode(new Uint8Array(0));
    expect(hex(enc)).toBe("ffffffff");
    expect(out(await plain(enc))?.length).toBe(0);
  });

  test("65536 bytes round trip inside a few VM steps", async () => {
    for (const data of [
      prose(65_536, 1),
      randBytes(65_536, 2, 4),
      randBytes(65_536, 3),
      new Uint8Array(65_536),
    ]) {
      const r = await plain(plainEncode(data));
      expect(r.ok).toBe(true);
      expect(Array.from(out(r) ?? [])).toEqual(Array.from(data));
      expect(r.ok && r.steps).toBeLessThan(1000);
    }
  }, 60_000);

  test("a match may overlap its own output (aaaaaa as a literal and a match of 5)", async () => {
    // flags: literal, match, then ones; match word: distance 1, length 5 - 3
    const enc = Uint8Array.of(0xff, 0xff, 0xff, 0x7f, 0x61, 0x02, 0x00);
    expect(ascii(out(await plain(enc)))).toBe("aaaaaa");
  });
});

describe("xpress:decompress corrupt data is E_COERCE and names the fault", () => {
  test("empty input and a flag word cut short", async () => {
    expect(await fault(plain(new Uint8Array(0)))).toMatch(/E_COERCE.*flag word.*truncated/);
    expect(await fault(plain(Uint8Array.of(0, 0, 0)))).toMatch(/E_COERCE.*flag word/);
  });

  test("a literal cut short", async () => {
    expect(await fault(plain(Uint8Array.of(0, 0, 0, 0)))).toMatch(/E_COERCE.*literal/);
  });

  test("a match word cut short", async () => {
    expect(await fault(plain(Uint8Array.of(0xff, 0xff, 0xff, 0x7f, 0x61, 0x02)))).toMatch(
      /E_COERCE.*match word/,
    );
  });

  test("a match before the start of the output", async () => {
    // flags: match, ... ; distance 1 with nothing written
    expect(await fault(plain(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x00, 0x00)))).toMatch(
      /E_COERCE.*1 bytes back but only 0/,
    );
    // 'a', then a match 3 back
    expect(await fault(plain(Uint8Array.of(0xff, 0xff, 0xff, 0x7f, 0x61, 0x10, 0x00)))).toMatch(
      /E_COERCE.*3 bytes back/,
    );
  });

  test("a long length field that is too small", async () => {
    // 'a'; match distance 1, length nibble 15, byte 255, 16-bit value 5 (< 15 + 7)
    const enc = Uint8Array.of(0xff, 0xff, 0xff, 0x7f, 0x61, 0x07, 0x00, 0x0f, 0xff, 0x05, 0x00);
    expect(await fault(plain(enc))).toMatch(/E_COERCE.*too small/);
  });

  test("a cut inside the stream is E_COERCE, or ends cleanly at a match flag", async () => {
    const data = prose(3000, 3);
    const enc = plainEncode(data);
    for (let cut = 0; cut < enc.length; cut++) {
      const r = await plain(enc.subarray(0, cut));
      if (r.ok) {
        const o = out(r) as Uint8Array;
        expect(Array.from(o), `cut ${cut}`).toEqual(Array.from(data.subarray(0, o.length)));
      } else expect(r.error.code, `cut ${cut}`).toBe("E_COERCE");
      if (cut < 4) expect(r.ok, `cut ${cut}`).toBe(false);
    }
  });
});

// ---- LZ77+Huffman ----

describe("xpress:huffman-decompress round trips", () => {
  const HUFF_SAMPLES: [string, Uint8Array][] = [
    ["empty (only the end symbol)", new Uint8Array(0)],
    ...SAMPLES,
    ["65535 bytes of prose", prose(65_535, 11)],
    ["65536 bytes of prose (one full block)", prose(65_536, 12)],
    ["65537 bytes of prose (a second block of one byte)", prose(65_537, 13)],
    ["200,000 bytes of prose (four blocks)", prose(200_000, 14)],
    ["131072 zeros (two full blocks, the second a single symbol)", new Uint8Array(131_072)],
    ["150,000 random bytes", randBytes(150_000, 15)],
    [
      "a skewed alphabet (long codes)",
      Uint8Array.from({ length: 30_000 }, (_, i) =>
        Math.floor(Math.log2(1 + (((i * 2654435761) >>> 0) % 4096))),
      ),
    ],
  ];
  for (const [name, data] of HUFF_SAMPLES) {
    test(
      name,
      async () => {
        const r = await huff(huffEncode(data));
        expect(r.ok, `${name}: ${r.ok ? "" : r.error.message}`).toBe(true);
        const got = out(r) as Uint8Array;
        expect(got.length).toBe(data.length);
        expect(hex(got) === hex(data)).toBe(true);
      },
      60_000,
    );
  }

  test("the 32-bit long length form is read", async () => {
    for (const data of [new Uint8Array(40_000), prose(300, 1)]) {
      const r = await huff(huffEncode(data, true));
      expect(Array.from(out(r) ?? [-1])).toEqual(Array.from(data));
    }
    // a length of 3 + 70000 does not fit a block but is a valid field
    const big = huffBlock([97, [70_000, 1]], true, true);
    const o = out(await huff(big)) as Uint8Array;
    expect(o.length).toBe(70_001);
  });

  test("a real Huffman table: codes of several lengths, 15 at most, and a complete code", () => {
    const enc = huffEncode(prose(20_000, 5));
    const lens: number[] = [];
    for (let i = 0; i < 256; i++) lens.push((enc[i] as number) & 15, (enc[i] as number) >> 4);
    expect(new Set(lens.filter((l) => l > 0)).size).toBeGreaterThan(3);
    expect(Math.max(...lens)).toBeLessThanOrEqual(15);
    expect(lens.reduce((s, l) => s + (l > 0 ? 2 ** -l : 0), 0)).toBe(1);
  });

  test("65536 bytes round trip inside a few VM steps", async () => {
    for (const data of [prose(65_536, 1), randBytes(65_536, 2, 4), randBytes(65_536, 3)]) {
      const r = await huff(huffEncode(data));
      expect(r.ok).toBe(true);
      expect(hex(out(r) as Uint8Array) === hex(data)).toBe(true);
      expect(r.ok && r.steps).toBeLessThan(1000);
    }
  }, 60_000);
});

describe("xpress:huffman-decompress corrupt data is E_COERCE and names the fault", () => {
  test("empty input", async () => {
    expect(await fault(huff(new Uint8Array(0)))).toMatch(/E_COERCE.*empty/);
  });

  test("a table cut short, or with no bit stream", async () => {
    expect(await fault(huff(new Uint8Array(100)))).toMatch(/E_COERCE.*truncated/);
    expect(await fault(huff(new Uint8Array(258)))).toMatch(/E_COERCE.*truncated/);
  });

  test("an incomplete table", async () => {
    expect(await fault(huff(new Uint8Array(264)))).toMatch(/E_COERCE.*incomplete/);
    // a single code of length 1 fills half of the code space
    const t = table([[0, 0x01]]);
    expect(await fault(huff(concat(t, new Uint8Array(8))))).toMatch(/E_COERCE.*incomplete/);
  });

  test("an over-subscribed table", async () => {
    // 512 codes of length 1
    expect(await fault(huff(concat(new Uint8Array(256).fill(0x11), new Uint8Array(8))))).toMatch(
      /E_COERCE.*over-subscribe/,
    );
  });

  test("a match before the start of the output", async () => {
    const bad = huffBlock([97, [3, 5]], true);
    expect(await fault(huff(bad))).toMatch(/E_COERCE.*5 bytes back but only 1/);
    const first = huffBlock([[4, 1]], true);
    expect(await fault(huff(first))).toMatch(/E_COERCE.*1 bytes back but only 0/);
  });

  test("a long length field that is too small", async () => {
    // the wide form with a field of 5: the encoder writes len - 3 = 5 after the 255 and a zero word
    const w = huffBlock([97, [300, 1]], true, true);
    // find the 255 marker followed by 00 00 and a 32-bit field; overwrite the field with 5
    const i = Array.from(w).findIndex(
      (b, k) => k >= 260 && b === 255 && w[k + 1] === 0 && w[k + 2] === 0,
    );
    expect(i).toBeGreaterThan(0);
    const patched = Uint8Array.from(w);
    // 255, 00 00, then the 32-bit field becomes the 16-bit value read: make the 16-bit field 5
    patched.set([5, 0, 0, 0], i + 1);
    expect(await fault(huff(patched))).toMatch(/E_COERCE.*too small/);
  });

  test("every cut of a one-block stream is E_COERCE", async () => {
    const enc = huffEncode(prose(2000, 3));
    for (let cut = 0; cut < enc.length; cut++) {
      const r = await huff(enc.subarray(0, cut));
      expect(code(r), `cut ${cut}`).toBe("E_COERCE");
    }
  });

  test("a second block cut inside its table is E_COERCE", async () => {
    const enc = huffEncode(prose(70_000, 4));
    const first = huffEncode(prose(65_536, 4)); // not the same bytes, so find the boundary differently
    expect(first.length).toBeGreaterThan(0);
    for (const cut of [enc.length - 1, enc.length - 100, enc.length - 260]) {
      expect(code(await huff(enc.subarray(0, cut))), `cut ${cut}`).toBe("E_COERCE");
    }
  });
});

// ---- the output limit ----

describe("the output limit (decompression bombs)", () => {
  const LIMIT = 100_000;

  test("Plain LZ77: a small stream that expands past maxValueBytes stops with E_LIMIT_VALUE", async () => {
    const enc = plainEncode(new Uint8Array(2_000_000));
    expect(enc.length).toBeLessThan(100);
    const r = await plain(enc, { maxValueBytes: LIMIT });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/decompressed data/);
  });

  test("Plain LZ77: a 32-bit match length of 4 billion allocates and copies nothing", async () => {
    // 'a'; match distance 1; nibble 15; 255; 16-bit 0; 32-bit 0xFFFFFFF0
    const enc = Uint8Array.of(
      0xff,
      0xff,
      0xff,
      0x7f,
      0x61,
      0x07,
      0x00,
      0x0f,
      0xff,
      0x00,
      0x00,
      0xf0,
      0xff,
      0xff,
      0xff,
    );
    const t0 = Date.now();
    expect(code(await plain(enc))).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("Plain LZ77: exactly the limit is allowed, one byte more is not", async () => {
    expect(
      out(await plain(plainEncode(new Uint8Array(LIMIT)), { maxValueBytes: LIMIT }))?.length,
    ).toBe(LIMIT);
    expect(
      code(await plain(plainEncode(new Uint8Array(LIMIT + 1)), { maxValueBytes: LIMIT })),
    ).toBe("E_LIMIT_VALUE");
  });

  test("LZ77+Huffman: a small stream that expands past maxValueBytes stops with E_LIMIT_VALUE", async () => {
    const enc = huffEncode(new Uint8Array(1_000_000));
    expect(enc.length).toBeLessThan(5000);
    const r = await huff(enc, { maxValueBytes: LIMIT });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(r.ok ? "" : r.error.message).toMatch(/decompressed data/);
  });

  test("LZ77+Huffman: a 32-bit match length of 4 billion allocates and copies nothing", async () => {
    const enc = huffBlock([97, [4_294_967_000, 1]], true, true);
    const t0 = Date.now();
    expect(code(await huff(enc))).toBe("E_LIMIT_VALUE");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("LZ77+Huffman: exactly the limit is allowed, one byte more is not", async () => {
    expect(
      out(await huff(huffEncode(new Uint8Array(LIMIT)), { maxValueBytes: LIMIT }))?.length,
    ).toBe(LIMIT);
    expect(code(await huff(huffEncode(new Uint8Array(LIMIT + 1)), { maxValueBytes: LIMIT }))).toBe(
      "E_LIMIT_VALUE",
    );
  });
});
