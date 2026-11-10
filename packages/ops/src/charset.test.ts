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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// charset is FL (vocab/charset.fth) plus the private primitive charset:_decode; these tests drive the
// public words through the runtime. The op vectors (vocab/charset.test.json) hold the known answers.
const { bool, bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["charset"]));

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const source = readFileSync(here.replace(/\/src\/[^/]*$/, "/vocab/charset.fth"), "utf8");

function options(word: "decode" | "encode"): string[] {
  const m = new RegExp(`: ${word} \\([^)]*?encoding:choice\\{([^}]*)\\}`).exec(source);
  return (m?.[1] ?? "").split("|");
}
const DECODE = options("decode");
const ENCODE = options("encode");
const MULTI_BYTE = ["gbk", "gb18030", "big5", "euc-jp", "iso-2022-jp", "shift_jis", "euc-kr"];
const UNICODE = ["utf-8", "utf-16le", "utf-16be"];
const EBCDIC = DECODE.filter((e) => /^ibm\d{3,4}$/.test(e) && e !== "ibm866");
const TABLES = ENCODE.filter((e) => !UNICODE.includes(e) && e !== "iso-8859-1");

type Out = { ok: boolean; stack: readonly unknown[]; error?: { code: string } };
type Tagged = { tag: string; v: unknown };

/** A runtime value as plain JS: lists as arrays, records as objects. */
function plain(value: Tagged): unknown {
  if (value.tag === "list") return (value.v as Tagged[]).map(plain);
  if (value.tag === "record") {
    return Object.fromEntries(
      [...(value.v as Map<string, Tagged>)].map(([k, x]) => [k, plain(x)] as const),
    );
  }
  return value.v;
}
function top(r: Out): unknown {
  return plain(r.stack[r.stack.length - 1] as Tagged);
}
async function decode(data: Uint8Array, encoding: string, strict = true) {
  return (await runtime.call("charset:decode", [
    bytes(data),
    str(encoding),
    bool(strict),
  ])) as unknown as Out;
}
async function encode(text: string, encoding: string) {
  return (await runtime.call("charset:encode", [str(text), str(encoding)])) as unknown as Out;
}
async function decodeText(data: Uint8Array, encoding: string, strict = true): Promise<string> {
  const r = await decode(data, encoding, strict);
  expect(r.ok, `${encoding} should decode`).toBe(true);
  return top(r) as string;
}
async function encodeBytes(text: string, encoding: string): Promise<Uint8Array> {
  const r = await encode(text, encoding);
  expect(r.ok, `${encoding} should encode`).toBe(true);
  return top(r) as Uint8Array;
}

const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function randomBytes(next: () => number, n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
}

describe("the choice lists", () => {
  test("are what the vocabulary documents", () => {
    expect(DECODE).toHaveLength(60);
    expect(ENCODE).toHaveLength(53);
    expect(EBCDIC).toHaveLength(22);
    expect(new Set(DECODE).size).toBe(DECODE.length);
  });

  test("encode offers every decode encoding except the multi-byte ones", () => {
    expect(ENCODE).toEqual(DECODE.filter((e) => !MULTI_BYTE.includes(e)));
  });

  test("brute walks the same encodings in the same order as the decode list", async () => {
    const r = await runtime.call("charset:brute", [bytes(new Uint8Array(0)), int(4096)]);
    expect(r.ok).toBe(true);
    const names = (top(r as unknown as Out) as { encoding: string }[]).map((x) => x.encoding);
    expect(names).toEqual(DECODE);
  });
});

// One byte sequence per encoding and the text it must decode to: from the code charts and the
// WHATWG indexes (see vocab/charset.test.json for the references). Every choice must appear, so that
// adding an encoding without a known answer fails here.
const KNOWN: Record<string, [string, string]> = {
  "utf-8": ["e282ac", "€"],
  "utf-16le": ["ac20", "€"],
  "utf-16be": ["20ac", "€"],
  "iso-8859-1": ["e9", "é"],
  ibm866: ["80", "А"],
  "iso-8859-2": ["a1", "Ą"],
  "iso-8859-3": ["a1", "Ħ"],
  "iso-8859-4": ["a1", "Ą"],
  "iso-8859-5": ["b0", "А"],
  "iso-8859-6": ["c7", "ا"],
  "iso-8859-7": ["c1", "Α"],
  "iso-8859-8": ["e0", "א"],
  "iso-8859-10": ["a1", "Ą"],
  "iso-8859-13": ["a1", "”"],
  "iso-8859-14": ["a1", "Ḃ"],
  "iso-8859-15": ["a4", "€"],
  "iso-8859-16": ["a1", "Ą"],
  "koi8-r": ["c1", "а"],
  "koi8-u": ["a4", "є"],
  macintosh: ["8e", "é"],
  "windows-874": ["a1", "ก"],
  "windows-1250": ["8a", "Š"],
  "windows-1251": ["c0", "А"],
  "windows-1252": ["80", "€"],
  "windows-1253": ["c1", "Α"],
  "windows-1254": ["dd", "İ"],
  "windows-1255": ["e0", "א"],
  "windows-1256": ["c7", "ا"],
  "windows-1257": ["e0", "ą"],
  "windows-1258": ["c0", "À"],
  "x-mac-cyrillic": ["80", "А"],
  gbk: ["c4e3", "你"],
  gb18030: ["81308130", "\u0080"],
  big5: ["a741", "你"],
  "euc-jp": ["a4a2", "あ"],
  "iso-2022-jp": ["1b2442242 21b2842".replace(" ", ""), "あ"],
  shift_jis: ["82a0", "あ"],
  "euc-kr": ["b0a1", "가"],
};

function hex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
}

describe("every encoding in the choice list decodes (Node 20 and Chromium, WHATWG and EBCDIC)", () => {
  test("all of them have a known answer here", () => {
    const covered = new Set([...Object.keys(KNOWN), ...EBCDIC]);
    expect(DECODE.filter((e) => !covered.has(e))).toEqual([]);
  });

  test.each(Object.entries(KNOWN))("%s", async (label, [h, text]) => {
    expect(await decodeText(hex(h), label)).toBe(text);
  });

  test.each(EBCDIC)(
    "%s: F0 is the digit zero and 40 the space, in every EBCDIC page",
    async (label) => {
      expect(await decodeText(Uint8Array.of(0xf0, 0xf9, 0x40), label)).toBe("09 ");
    },
  );
});

describe("single-byte sets", () => {
  test.each(TABLES)("%s: all 256 bytes decode to one character each", async (label) => {
    const text = await decodeText(ALL_BYTES, label, false);
    expect([...text]).toHaveLength(256);
  });

  test.each(TABLES)("%s: decode then encode returns the bytes (assigned ones)", async (label) => {
    const text = await decodeText(ALL_BYTES, label, false);
    const chars = [...text];
    const assigned = chars.filter((c) => c !== "�");
    const back = await encodeBytes(assigned.join(""), label);
    expect(back).toHaveLength(assigned.length);
    // a second decode of the encoded bytes gives the same text
    expect(await decodeText(back, label, true)).toBe(assigned.join(""));
    // no code point appears on two bytes, except U+001A in ibm875
    if (label !== "ibm875") {
      expect(back).toEqual(Uint8Array.from(ALL_BYTES.filter((b) => chars[b] !== "�")));
    }
  });

  test.each(TABLES.filter((t) => !/^ibm/.test(t) || t === "ibm866"))(
    "%s: the ASCII half is ASCII",
    async (label) => {
      const ascii = ALL_BYTES.slice(0, 128);
      expect(await decodeText(ascii, label)).toBe(String.fromCharCode(...ascii));
    },
  );

  test("windows-1252 is not iso-8859-1 at 80 to 9F, and agrees elsewhere", async () => {
    const w = [...(await decodeText(ALL_BYTES, "windows-1252", false))];
    const l = [...(await decodeText(ALL_BYTES, "iso-8859-1"))];
    const diff = ALL_BYTES.filter((b) => w[b] !== l[b]);
    expect(diff.length).toBeGreaterThan(20);
    expect(diff.every((b) => b >= 0x80 && b <= 0x9f)).toBe(true);
  });

  test("the euro pages differ from their base page at exactly one byte, where the currency sign becomes the euro", async () => {
    const pairs: [string, string][] = [
      ["ibm1140", "ibm037"],
      ["ibm1141", "ibm273"],
      ["ibm1142", "ibm277"],
      ["ibm1143", "ibm278"],
      ["ibm1144", "ibm280"],
      ["ibm1145", "ibm284"],
      ["ibm1146", "ibm285"],
      ["ibm1147", "ibm297"],
      ["ibm1148", "ibm500"],
    ];
    for (const [euro, base] of pairs) {
      const e = [...(await decodeText(ALL_BYTES, euro))];
      const b = [...(await decodeText(ALL_BYTES, base))];
      const diff = ALL_BYTES.filter((i) => e[i] !== b[i]);
      expect(diff, `${euro} vs ${base}`).toHaveLength(1);
      expect(b[diff[0] as number]).toBe("¤");
      expect(e[diff[0] as number]).toBe("€");
    }
  });

  test("ibm1047 differs from ibm037 at six bytes, the ones that hold the brackets", async () => {
    const a = [...(await decodeText(ALL_BYTES, "ibm1047"))];
    const b = [...(await decodeText(ALL_BYTES, "ibm037"))];
    const diff = ALL_BYTES.filter((i) => a[i] !== b[i]);
    expect(Array.from(diff)).toEqual([0x5f, 0xad, 0xb0, 0xba, 0xbb, 0xbd]);
  });

  test("ibm875 has no unassigned byte: they decode to U+001A", async () => {
    const t = [...(await decodeText(ALL_BYTES, "ibm875"))];
    for (const b of [0xdc, 0xe1, 0xec, 0xed, 0xfc, 0xfd]) expect(t[b]).toBe("\u001a");
  });

  test("random text round trips through every table encoding that can hold it", async () => {
    const next = rng(5150);
    for (const label of TABLES) {
      const chars = [...(await decodeText(ALL_BYTES, label, false))].filter((c) => c !== "�");
      for (let trial = 0; trial < 3; trial++) {
        let text = "";
        const n = Math.floor(next() * 40);
        for (let i = 0; i < n; i++) text += chars[Math.floor(next() * chars.length)];
        const b = await encodeBytes(text, label);
        expect(await decodeText(b, label)).toBe(text);
      }
    }
  });

  test("encode raises E_COERCE for a character the set lacks, and for U+FFFD", async () => {
    for (const [label, ch] of [
      ["ibm037", "€"],
      ["windows-1252", "日"],
      ["koi8-r", "é"],
      ["windows-1253", "�"],
      ["iso-8859-1", "Ā"],
      ["ibm500", "\u{1f600}"],
    ] as const) {
      const r = await encode(`ok${ch}`, label);
      expect(r.ok, label).toBe(false);
      expect(r.error?.code, label).toBe("E_COERCE");
    }
  });
});

describe("strict and lenient decoding", () => {
  test("strict raises E_COERCE where the host or the table says the bytes are invalid", async () => {
    for (const [label, h] of [
      ["utf-8", "ff"],
      ["utf-16le", "41"],
      ["shift_jis", "ff"],
      ["gbk", "81"],
      ["euc-kr", "ff"],
      ["windows-1253", "aa"],
      ["windows-874", "db"],
      ["iso-8859-3", "a5"],
    ] as const) {
      const r = await decode(hex(h), label);
      expect(r.ok, label).toBe(false);
      expect(r.error?.code, label).toBe("E_COERCE");
      const lenient = await decode(hex(h), label, false);
      expect(lenient.ok, label).toBe(true);
      expect(String(top(lenient))).toContain("�");
    }
  });

  test("lenient decoding of random binary never fails, in any encoding", async () => {
    const next = rng(77);
    const data = randomBytes(next, 600);
    for (const label of DECODE) {
      const r = await decode(data, label, false);
      expect(r.ok, label).toBe(true);
    }
  });

  test("the EBCDIC pages and iso-8859-1 accept any bytes, strictly", async () => {
    const next = rng(78);
    const data = randomBytes(next, 600);
    for (const label of ["iso-8859-1", ...EBCDIC]) {
      expect((await decode(data, label)).ok, label).toBe(true);
    }
  });

  test("a byte order mark is kept", async () => {
    expect(await decodeText(hex("efbbbf41"), "utf-8")).toBe("﻿A");
    expect(await decodeText(hex("fffe4100"), "utf-16le")).toBe("﻿A");
  });
});

describe("UTF-8 and UTF-16", () => {
  test("encode matches the standard library for random scalar values", async () => {
    const next = rng(4242);
    for (let trial = 0; trial < 30; trial++) {
      let text = "";
      const n = Math.floor(next() * 20);
      for (let i = 0; i < n; i++) {
        const pick = next();
        const cp =
          pick < 0.4
            ? 1 + Math.floor(next() * 0x7f)
            : pick < 0.8
              ? 0x80 + Math.floor(next() * (0xd800 - 0x80))
              : 0x10000 + Math.floor(next() * (0x10ffff - 0x10000 + 1));
        text += String.fromCodePoint(cp);
      }
      const utf8 = await encodeBytes(text, "utf-8");
      expect(utf8).toEqual(new TextEncoder().encode(text));
      const le = Uint8Array.from(
        [...text].flatMap((c) => {
          const out: number[] = [];
          for (let i = 0; i < c.length; i++) out.push(c.charCodeAt(i) & 255, c.charCodeAt(i) >> 8);
          return out;
        }),
      );
      expect(await encodeBytes(text, "utf-16le")).toEqual(le);
      const be = Uint8Array.from(le.map((_, i) => le[i ^ 1] as number));
      expect(await encodeBytes(text, "utf-16be")).toEqual(be);
      expect(await decodeText(le, "utf-16le")).toBe(text);
      expect(await decodeText(be, "utf-16be")).toBe(text);
      expect(await decodeText(utf8, "utf-8")).toBe(text);
    }
  });
});

describe("brute force", () => {
  test("the order is fixed and an encoding that fails strict decoding is left out", async () => {
    const r = await runtime.call("charset:brute", [bytes(hex("ff")), int(4096)]);
    const names = (top(r as unknown as Out) as { encoding: string }[]).map((x) => x.encoding);
    expect(names).not.toContain("utf-8");
    expect(names).not.toContain("shift_jis");
    expect(names).not.toContain("windows-1253");
    expect(names).toContain("windows-1252");
    expect(names).toContain("ibm037");
    expect(names).toEqual(DECODE.filter((e) => names.includes(e)));
  });

  test("every record has exactly an encoding and a text", async () => {
    const r = await runtime.call("charset:brute", [bytes(hex("c0")), int(4096)]);
    const list = top(r as unknown as Out) as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(40);
    for (const rec of list) expect(Object.keys(rec).sort()).toEqual(["encoding", "text"]);
    const ibm037 = list.find((x) => x.encoding === "ibm037");
    expect(ibm037?.text).toBe("{");
    expect(list.find((x) => x.encoding === "windows-1251")?.text).toBe("А");
  });

  test("only the first sample bytes are decoded", async () => {
    const data = new Uint8Array(5000).fill(0x41);
    const dflt = await runtime.call("charset:brute", [bytes(data), int(4096)]);
    const list = top(dflt as unknown as Out) as { encoding: string; text: string }[];
    expect(list.find((x) => x.encoding === "ibm037")?.text).toHaveLength(4096);
    const small = await runtime.call("charset:brute", [bytes(data), int(3)]);
    const l2 = top(small as unknown as Out) as { encoding: string; text: string }[];
    expect(l2.find((x) => x.encoding === "windows-1252")?.text).toBe("AAA");
  });

  test("the largest sample fits the step and size limits", { timeout: 60_000 }, async () => {
    const next = rng(9);
    const r = await runtime.call("charset:brute", [bytes(randomBytes(next, 20000)), int(16384)]);
    expect(r.ok).toBe(true);
    const list = top(r as unknown as Out) as { encoding: string; text: string }[];
    expect(list.length).toBeGreaterThan(30);
  });
});

describe("64 KiB inputs", () => {
  test("decode and encode, single-byte, EBCDIC and UTF-16", { timeout: 60_000 }, async () => {
    const next = rng(64);
    const data = randomBytes(next, 65536);
    for (const label of [
      "windows-1251",
      "ibm037",
      "ibm1140",
      "ibm875",
      "iso-8859-1",
      "utf-8",
      "shift_jis",
    ]) {
      const text = await decodeText(data, label, false);
      expect(text.length).toBeGreaterThan(30000);
    }
    for (const label of ["windows-1252", "ibm500", "ibm1047"]) {
      const text = await decodeText(data, label, false);
      const chars = [...text];
      expect(chars).toHaveLength(65536);
      const back = await encodeBytes(text.replaceAll("�", ""), label);
      expect(back.length).toBeLessThanOrEqual(65536);
      expect(await decodeText(back, label)).toBe(text.replaceAll("�", ""));
    }
    const long = "héllo € \u{1f600}".repeat(5000).slice(0, 65536);
    for (const label of ["utf-16le", "utf-16be"]) {
      const b = await encodeBytes(long, label);
      expect(await decodeText(b, label)).toBe(long);
    }
  });
});
