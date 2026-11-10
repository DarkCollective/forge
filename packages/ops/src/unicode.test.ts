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
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// unicode is FL (vocab/unicode.fth) plus the private primitive _normalize; these tests drive its
// public words through the runtime.
const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["unicode"]));

function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

function isAscii(s: string): boolean {
  return [...s].every((c) => c.charCodeAt(0) < 128);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Pools to draw from. The ASCII pool has no backslash, %, U+ or & so the literal text cannot form
 * an escape of its own; it does have hex digits and letters, which exercises the U+ digit rule.
 */
const ASCII = "abcdefABCDEF0123456789 xyz";
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0xa1, 0xff],
  [0x391, 0x3c9],
  [0x4e00, 0x4e80],
  [0xe000, 0xe010],
  [0x1f600, 0x1f640],
  [0x10000, 0x10020],
  [0x10ffe0, 0x10ffff],
];

function randomText(next: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    if (next() < 0.5) out += ASCII.charAt(Math.floor(next() * ASCII.length));
    else {
      const [lo, hi] = WIDE[Math.floor(next() * WIDE.length)] as readonly [number, number];
      out += String.fromCodePoint(lo + Math.floor(next() * (hi - lo + 1)));
    }
  }
  return out;
}

describe("unicode:escape and unicode:unescape round trip", () => {
  test("unescape(escape(x)) == x for every format, case and scope", async () => {
    const next = rng(4);
    for (const format of ["u", "U+", "%u", "x{}", "html"]) {
      for (const letterCase of ["upper", "lower"]) {
        for (const scope of ["non-ascii", "all"]) {
          for (let trial = 0; trial < 25; trial++) {
            const text = randomText(next, Math.floor(next() * 40));
            const enc = await runtime.call("unicode:escape", [
              str(text),
              str(format),
              str(letterCase),
              str(scope),
            ]);
            expect(enc.ok).toBe(true);
            const escaped = top(enc).v as string;
            if (scope === "non-ascii") expect(isAscii(escaped)).toBe(true);
            const dec = await runtime.call("unicode:unescape", [str(escaped)]);
            expect(top(dec).v).toBe(text);
          }
        }
      }
    }
  });

  test("64 KiB of escaped text round trips", async () => {
    const text = "aé😀€\n".repeat(2260);
    const enc = await runtime.call("unicode:escape", [
      str(text),
      str("u"),
      str("upper"),
      str("non-ascii"),
    ]);
    expect((top(enc).v as string).length).toBeGreaterThan(50_000);
    const dec = await runtime.call("unicode:unescape", [str(top(enc).v as string)]);
    expect(top(dec).v).toBe(text);
  }, 60_000);
});

describe("unicode:unescape rules", () => {
  async function unescape(s: string): Promise<string> {
    return top(await runtime.call("unicode:unescape", [str(s)])).v as string;
  }

  test("a surrogate pair split across two escapes of different forms is left alone", async () => {
    expect(await unescape("\\uD83D%uDE00")).toBe("\\uD83D%uDE00");
  });

  test("U+ reads the longest valid run of up to 6 digits", async () => {
    expect(await unescape("U+1F600")).toBe("😀");
    // 110000 is above U+10FFFF, so the 5 digit run U+11000 is read and the last 0 stays text.
    expect(await unescape("U+110000")).toBe("\u{11000}0");
  });

  test("a minus sign or white space is not a hex digit", async () => {
    expect(await unescape("\\u-001")).toBe("\\u-001");
    expect(await unescape("\\u 041")).toBe("\\u 041");
  });
});

describe("unicode:normalize", () => {
  test("nfc(nfd(x)) == nfc(x) and nfkc(nfkd(x)) == nfkc(x) for random text", async () => {
    const next = rng(6);
    const call = async (s: string, form: string) =>
      top(await runtime.call("unicode:normalize", [str(s), str(form)])).v as string;
    for (let trial = 0; trial < 40; trial++) {
      const text = randomText(next, 20) + "éÅﬁ가";
      expect(await call(await call(text, "nfd"), "nfc")).toBe(await call(text, "nfc"));
      expect(await call(await call(text, "nfkd"), "nfkc")).toBe(await call(text, "nfkc"));
    }
  });
});

describe("unicode:smart-to-ascii", () => {
  test("random text has no typographic character left, ASCII is unchanged", async () => {
    const next = rng(2);
    const smart = "‘’‚‛“”„‟–—… ";
    for (let trial = 0; trial < 40; trial++) {
      let text = "";
      for (let i = 0; i < 30; i++)
        text += next() < 0.5 ? smart.charAt(Math.floor(next() * smart.length)) : "ab \"'-.";
      const out = top(await runtime.call("unicode:smart-to-ascii", [str(text)])).v as string;
      expect(isAscii(out)).toBe(true);
      const ascii = 'plain ascii "text" - ok...';
      const same = top(await runtime.call("unicode:smart-to-ascii", [str(ascii)])).v;
      expect(same).toBe(ascii);
    }
  });
});

describe("module", () => {
  test("every public word has a doc string and a category", () => {
    for (const w of ["escape", "unescape", "normalize", "smart-to-ascii"]) {
      const meta = runtime.meta(`unicode:${w}`);
      expect(meta.doc).toBeTruthy();
      expect(meta.category).toBe(w === "smart-to-ascii" ? "Text" : "Encodings");
    }
  });

  test("the choice parameters have help", () => {
    expect(runtime.meta("unicode:escape").params.map((p) => p.name)).toEqual([
      "format",
      "case",
      "scope",
    ]);
    for (const p of runtime.meta("unicode:escape").params) expect(p.doc).toBeTruthy();
    expect(runtime.meta("unicode:normalize").params[0]?.doc).toBeTruthy();
  });
});
