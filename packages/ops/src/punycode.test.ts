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

// punycode is FL (vocab/punycode.fth); these tests drive its public words through the runtime.
// The RFC 3492 section 7.1 vectors are in vocab/punycode.test.json.
const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["punycode"]));

function top(r: { stack: readonly unknown[] }): { v: unknown } {
  return r.stack[r.stack.length - 1] as { v: unknown };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Code point ranges to draw from: ASCII, Latin-1, Greek, CJK, Hangul, and the astral planes. */
const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x7e],
  [0xa1, 0xff],
  [0x391, 0x3c9],
  [0x4e00, 0x4e80],
  [0xac00, 0xac40],
  [0x1f600, 0x1f640],
  [0x10000, 0x10020],
];

function randomText(next: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const [lo, hi] = RANGES[Math.floor(next() * RANGES.length)] as readonly [number, number];
    out += String.fromCodePoint(lo + Math.floor(next() * (hi - lo + 1)));
  }
  return out;
}

async function call(word: string, text: string, mode: string) {
  return runtime.call(`punycode:${word}`, [str(text), str(mode)]);
}

describe("punycode round trip", () => {
  test("label: decode(encode(x)) == x for random text over several scripts", async () => {
    const next = rng(8);
    for (let trial = 0; trial < 80; trial++) {
      const text = randomText(next, Math.floor(next() * 40));
      const enc = await call("encode", text, "label");
      expect(enc.ok).toBe(true);
      expect(/^[\x20-\x7e]*$/.test(top(enc).v as string)).toBe(true);
      const dec = await call("decode", top(enc).v as string, "label");
      expect(top(dec).v).toBe(text);
    }
  });

  test("domain: round trip over dotted labels, ASCII labels untouched", async () => {
    const next = rng(9);
    for (let trial = 0; trial < 40; trial++) {
      const labels = Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
        randomText(next, 1 + Math.floor(next() * 10)).replaceAll(".", "_"),
      );
      const name = labels.join(".");
      const enc = await call("encode", name, "domain");
      const text = top(enc).v as string;
      expect(text.split(".").length).toBe(labels.length);
      for (const [i, label] of text.split(".").entries()) {
        const original = labels[i] as string;
        if ([...original].every((c) => c.charCodeAt(0) < 128)) expect(label).toBe(original);
        else expect(label.startsWith("xn--")).toBe(true);
      }
      const dec = await call("decode", text, "domain");
      expect(top(dec).v).toBe(name);
    }
  });

  test("domain mode over 64 KiB of ASCII labels is the identity", async () => {
    const name = "abc-def.".repeat(8192);
    const enc = await call("encode", name, "domain");
    expect(top(enc).v).toBe(name);
    const dec = await call("decode", name, "domain");
    expect(top(dec).v).toBe(name);
  }, 60_000);

  test("domain mode over about 1,300 IDN labels round trips", async () => {
    const name = "bücher€日本.".repeat(1300);
    const enc = await call("encode", name, "domain");
    expect(enc.ok).toBe(true);
    const dec = await call("decode", top(enc).v as string, "domain");
    expect(top(dec).v).toBe(name);
  }, 60_000);
});

describe("punycode rules", () => {
  test("digits are read in either case", async () => {
    const lower = await call("decode", "bcher-kva", "label");
    const upper = await call("decode", "BCHER-KVA", "label");
    expect(top(lower).v).toBe("bücher");
    // The basic code points keep their case; the digits only say where the code point goes.
    expect(top(upper).v).toBe("BüCHER");
  });

  test("domain mode ignores an empty label and a bare dot", async () => {
    const enc = await call("encode", "a..b.", "domain");
    expect(top(enc).v).toBe("a..b.");
  });

  for (const bad of ["ab-9", "ab-!", "é-abc", "9999z"]) {
    test(`decode of ${JSON.stringify(bad)} is E_COERCE`, async () => {
      const r = await call("decode", bad, "label");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_COERCE");
    });
  }
});

describe("module", () => {
  test("both words document the mode parameter, default domain", () => {
    for (const w of ["punycode:encode", "punycode:decode"]) {
      const meta = runtime.meta(w);
      expect(meta.params.map((p) => p.name)).toEqual(["mode"]);
      expect(meta.params[0]?.doc).toBeTruthy();
      expect(meta.params[0]?.default).toBe("domain");
    }
  });
});
