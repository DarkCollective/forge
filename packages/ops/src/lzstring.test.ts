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
 * Tests for the `lzstring` vocabulary (vocab/lzstring.fth, primitives in src/prims/lzstring.ts). The
 * format is defined by lz-string 1.5.0, so the library is the reference here: every format must equal
 * the library's own call, and the `measure` guard that bounds the output must agree with the library
 * on valid and on damaged streams. The known answers in vocab/lzstring.test.json were produced by the
 * library (see the provenance in their `ref` fields). Also here: round trips (text with astral
 * characters, 64 KiB), the errors and the decompression bomb rule.
 */
import LZString from "lz-string";
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

// The package builds against ES2022 only (no DOM typings), so declare the global used.
declare class TextDecoder {
  decode(input?: Uint8Array): string;
}

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["lzstring"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result) =>
  r.ok ? (r.stack[r.stack.length - 1] as { v: Uint8Array }).v : undefined;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (s: string) => new TextEncoder().encode(s);
const ascii = (u: Uint8Array | undefined) => new TextDecoder().decode(u);

const call = (op: string, args: Value[], limits?: { maxValueBytes: number }) =>
  runtime.call(op, args, limits === undefined ? undefined : { limits });
const compress = (d: Uint8Array, format = "default", limits?: { maxValueBytes: number }) =>
  call("lzstring:compress", [bytes(d), str(format)], limits);
const decompress = (d: Uint8Array, format = "default", limits?: { maxValueBytes: number }) =>
  call("lzstring:decompress", [bytes(d), str(format)], limits);

function prose(n: number, seed: number): string {
  const words = ["forge", "lz", "string", "the", "of", "dictionary", "token", "bits", "\n", "café"];
  let s = seed >>> 0;
  let t = "";
  while (t.length < n) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    t += `${words[(s >>> 28) % words.length] as string} `;
  }
  return t.slice(0, n);
}

const SAMPLES: [string, string][] = [
  ["empty", ""],
  ["one char", "a"],
  ["text", "hello hello hello hello world, hello lzstring"],
  ["unicode", "café über 中文 \u{1F600} end"],
  ["prose", prose(5000, 3)],
  ["run", "a".repeat(3000)],
];

const FORMATS = ["default", "utf16", "base64", "uri"] as const;

/** The library's own output for a format, as the bytes the vocabulary writes. */
function reference(s: string, format: (typeof FORMATS)[number]): Uint8Array {
  switch (format) {
    case "default":
      return LZString.compressToUint8Array(s);
    case "utf16":
      return text(LZString.compressToUTF16(s));
    case "base64":
      return text(LZString.compressToBase64(s));
    case "uri":
      return text(LZString.compressToEncodedURIComponent(s));
  }
}

describe("lzstring:compress and lzstring:decompress", () => {
  for (const [name, s] of SAMPLES) {
    for (const format of FORMATS) {
      test(`${name} in ${format}: equals the library and round-trips`, async () => {
        const c = out(await compress(text(s), format)) as Uint8Array;
        expect(Array.from(c)).toEqual(Array.from(reference(s, format)));
        expect(ascii(out(await decompress(c, format)))).toBe(s);
      });
    }
  }

  test("the default format is UCS-2 big-endian and holds lone surrogates the text forms cannot", async () => {
    // Long enough that the 16-bit units cover many values, some of them in the surrogate range.
    const s = prose(20_000, 5);
    const c = out(await compress(text(s), "default")) as Uint8Array;
    expect(c.length % 2).toBe(0);
    const units = Array.from(
      { length: c.length / 2 },
      (_, i) => (c[2 * i] as number) * 256 + (c[2 * i + 1] as number),
    );
    expect(units.some((u) => u >= 0xd800 && u <= 0xdfff)).toBe(true);
    expect(ascii(out(await decompress(c, "default")))).toBe(s);
  });

  test("the text formats only use their alphabets", async () => {
    const s = prose(4000, 9);
    expect(ascii(out(await compress(text(s), "base64")))).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(ascii(out(await compress(text(s), "uri")))).toMatch(/^[A-Za-z0-9+\-$]+$/);
    const u = ascii(out(await compress(text(s), "utf16")));
    for (const ch of u) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x8020);
  });

  test("64 KiB round-trips in every format", { timeout: 60_000 }, async () => {
    const s = prose(65_536, 11);
    for (const format of FORMATS) {
      const c = out(await compress(text(s), format)) as Uint8Array;
      expect(c.length).toBeLessThan(65_536);
      expect(ascii(out(await decompress(c, format)))).toBe(s);
    }
  });

  test("input that is not UTF-8 is E_COERCE; an unknown format is E_RANGE", async () => {
    expect(code(await compress(Uint8Array.of(0xff, 0xfe), "default"))).toBe("E_COERCE");
    expect(code(await compress(text("x"), "zip"))).toMatch(/E_RANGE|E_PARAM/);
  });
});

describe("damaged and wrong-format input", () => {
  test("empty input, odd-length default data and non-UTF-8 text formats are E_COERCE", async () => {
    for (const f of FORMATS) expect(code(await decompress(new Uint8Array(0), f))).toBe("E_COERCE");
    expect(code(await decompress(Uint8Array.of(1, 2, 3), "default"))).toBe("E_COERCE");
    expect(code(await decompress(Uint8Array.of(0xff, 0xfe), "base64"))).toBe("E_COERCE");
  });

  test("a stream cut before its end marker is E_COERCE", async () => {
    const full = LZString.compressToBase64(prose(2000, 4));
    for (const cut of [1, 2, 5, 20, full.length - 12]) {
      const r = await decompress(text(full.slice(0, cut)), "base64");
      expect(code(r), `cut at ${cut}`).toBe("E_COERCE");
    }
  });

  test("a code naming no dictionary entry is E_COERCE", async () => {
    // Find a corrupted stream the library rejects with null.
    let found = 0;
    const base = LZString.compressToBase64(prose(300, 2));
    for (let i = 0; i < base.length && found === 0; i++) {
      for (const ch of ["A", "B", "/", "z"]) {
        const bad = base.slice(0, i) + ch + base.slice(i + 1);
        if (LZString.decompressFromBase64(bad) === null) {
          expect(code(await decompress(text(bad), "base64"))).toBe("E_COERCE");
          found++;
          break;
        }
      }
    }
    expect(found).toBe(1);
  });

  test("text with an unpaired surrogate (made by hand) cannot be returned: E_COERCE", async () => {
    const lone = String.fromCharCode(0xd800);
    const c = LZString.compressToUint8Array(lone + "abc");
    expect(code(await decompress(c, "default"))).toBe("E_COERCE");
  });
});

describe("the guard agrees with the library", () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  test("damaged streams: success only with the library's text, and every non-empty library answer is accepted", async () => {
    const rand = rng(42);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let ok = 0;
    for (let n = 0; n < 400; n++) {
      const base = LZString.compressToBase64(prose(50 + Math.floor(rand() * 400), n));
      let bad = base;
      for (let k = 0; k < 1 + (n % 3); k++) {
        const i = Math.floor(rand() * bad.length);
        bad =
          bad.slice(0, i) +
          alphabet.charAt(Math.floor(rand() * alphabet.length)) +
          bad.slice(i + 1);
      }
      if (n % 5 === 0) bad = bad.slice(0, Math.floor(rand() * bad.length) + 1);
      const lib = LZString.decompressFromBase64(bad);
      const r = await decompress(text(bad), "base64");
      let libWellFormed = lib !== null && lib !== "";
      if (
        lib !== null &&
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(lib)
      )
        libWellFormed = false;
      if (r.ok) {
        ok++;
        expect(ascii(out(r))).toBe(lib);
      } else {
        expect(
          libWellFormed,
          `input ${bad} library gave ${JSON.stringify(lib)} but Forge ${code(r)}`,
        ).toBe(false);
      }
    }
    expect(ok).toBeGreaterThan(20);
  });

  test("the other alphabets: utf16 and uri, the same way", async () => {
    const rand = rng(7);
    for (let n = 0; n < 150; n++) {
      const src = prose(80 + (n % 200), n + 1000);
      const u = LZString.compressToUTF16(src);
      const i = Math.floor(rand() * u.length);
      const badU =
        u.slice(0, i) + String.fromCharCode(32 + Math.floor(rand() * 32768)) + u.slice(i + 1);
      const libU = LZString.decompressFromUTF16(badU);
      const rU = await decompress(text(badU), "utf16");
      if (rU.ok) expect(ascii(out(rU))).toBe(libU);
      const e = LZString.compressToEncodedURIComponent(src);
      const j = Math.floor(rand() * e.length);
      const badE = e.slice(0, j) + "-" + e.slice(j + 1);
      const libE = LZString.decompressFromEncodedURIComponent(badE);
      const rE = await decompress(text(badE), "uri");
      if (rE.ok) expect(ascii(out(rE))).toBe(libE);
    }
  });
});

describe("the output limit (decompression bombs)", () => {
  const LIMIT = 100_000;

  test("a few hundred bytes that expand to megabytes stop with E_LIMIT_VALUE", async () => {
    const bomb = text(LZString.compressToBase64("a".repeat(4_000_000)));
    expect(bomb.length).toBeLessThan(10_000);
    const started = Date.now();
    const r = await decompress(bomb, "base64", { maxValueBytes: LIMIT });
    expect(code(r)).toBe("E_LIMIT_VALUE");
    expect(Date.now() - started).toBeLessThan(2000);
    if (!r.ok) {
      const d = r.error.detail as { limit: string; max: number };
      expect(d.limit).toBe("maxValueBytes");
      expect(d.max).toBe(LIMIT);
    }
    // The same stream is fine when the limit allows it.
    expect(out(await decompress(bomb, "base64", { maxValueBytes: 4_000_000 }))?.length).toBe(
      4_000_000,
    );
  });

  test("exactly the limit passes, one byte more does not (every format)", async () => {
    const s = "a".repeat(LIMIT);
    for (const f of FORMATS) {
      const c = out(await compress(text(s), f)) as Uint8Array;
      expect(out(await decompress(c, f, { maxValueBytes: LIMIT }))?.length).toBe(LIMIT);
      expect(code(await decompress(c, f, { maxValueBytes: LIMIT - 1 }))).toBe("E_LIMIT_VALUE");
    }
  });

  test("characters that take three bytes in UTF-8 are measured as bytes", async () => {
    const s = "中".repeat(40_000); // 40,000 characters, 120,000 bytes
    const c = out(await compress(text(s), "base64")) as Uint8Array;
    expect(code(await decompress(c, "base64", { maxValueBytes: 100_000 }))).toBe("E_LIMIT_VALUE");
    expect(out(await decompress(c, "base64", { maxValueBytes: 120_000 }))?.length).toBe(120_000);
  });
});
