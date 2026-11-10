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
 * Tests for the words added to `classical` in WP 5.9: caesar-box, rot8000, rot-brute, cetacean,
 * ctx1 and ls47. The fixed-answer vectors are in vocab/classical.test.json; these tests drive the
 * words through the runtime for round trips, parameter validation and the 64 KiB limits check.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, bytes, int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["classical"]));

let seed = 0x51ed270b;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randBytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
}

const LS47 = "_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'()";
function randLs47(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += LS47[Math.floor(rand() * 49)];
  return s;
}

/** Text of random BMP code points outside the surrogates, with some ASCII mixed in. */
function randText(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    const r = rand();
    let cp = r < 0.5 ? 32 + Math.floor(rand() * 95) : Math.floor(rand() * 0xd800);
    if (r > 0.9) cp = 0xe000 + Math.floor(rand() * 0x2000);
    s += String.fromCodePoint(cp);
  }
  return s;
}

async function ok(word: string, args: Value[]): Promise<Value> {
  const r = await runtime.call(word, args);
  if (!r.ok) throw new Error(`${word}: ${r.error.code} ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
}
async function fails(word: string, args: Value[]): Promise<string> {
  const r = await runtime.call(word, args);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error.code;
}
// The ops package typings have no TextEncoder or TextDecoder: plain ASCII helpers.
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const asciiOf = (b: Uint8Array) => String.fromCharCode(...b);
const text = (v: Value) => (v as { v: string }).v;
const raw = (v: Value) => (v as { v: Uint8Array }).v;

describe("caesar-box", () => {
  test("decrypt(encrypt(x)) is x for every height and many lengths", async () => {
    for (let n = 0; n <= 40; n++) {
      const data = randBytes(n);
      for (const h of [1, 2, 3, 5, 7, 40, 41]) {
        const enc = await ok("classical:caesar-box-encrypt", [bytes(data), int(h)]);
        expect(raw(enc).length).toBe(n);
        const dec = await ok("classical:caesar-box-decrypt", [enc, int(h)]);
        expect(raw(dec)).toEqual(data);
      }
    }
  });

  test("agrees with a plain implementation", async () => {
    for (let trial = 0; trial < 30; trial++) {
      const n = 1 + Math.floor(rand() * 200);
      const h = 1 + Math.floor(rand() * 12);
      const data = randBytes(n);
      const w = Math.ceil(n / h);
      const want: number[] = [];
      for (let c = 0; c < w; c++)
        for (let r = 0; r < h; r++) if (r * w + c < n) want.push(data[r * w + c] as number);
      const got = await ok("classical:caesar-box-encrypt", [bytes(data), int(h)]);
      expect(Array.from(raw(got))).toEqual(want);
    }
  });

  test("a square box is a transposition", async () => {
    const got = await ok("classical:caesar-box-encrypt", [bytes(ascii("ABCDEFGHI")), int(3)]);
    expect(asciiOf(raw(got))).toBe("ADGBEHCFI");
  });

  test("a height outside 1 to 65536 is rejected", async () => {
    expect(await fails("classical:caesar-box-encrypt", [bytes(randBytes(4)), int(0)])).toBe(
      "E_PARAM_INVALID",
    );
    expect(await fails("classical:caesar-box-decrypt", [bytes(randBytes(4)), int(65537)])).toBe(
      "E_PARAM_INVALID",
    );
  });

  test("64 KiB round trip", { timeout: 60_000 }, async () => {
    const data = randBytes(65536);
    for (const h of [2, 255, 3000]) {
      const enc = await ok("classical:caesar-box-encrypt", [bytes(data), int(h)]);
      const dec = await ok("classical:caesar-box-decrypt", [enc, int(h)]);
      expect(raw(dec)).toEqual(data);
    }
  });
});

describe("rot8000", () => {
  test("it is its own inverse on random BMP text", async () => {
    for (let trial = 0; trial < 20; trial++) {
      const s = randText(300);
      const once = await ok("classical:rot8000", [str(s)]);
      expect(text(once)).not.toBe(s);
      expect(text(await ok("classical:rot8000", [once]))).toBe(s);
    }
  });

  test("every BMP character outside the surrogates survives two rotations, and valid ones move", async () => {
    let all = "";
    for (let cp = 0; cp < 0x10000; cp++)
      if (cp < 0xd800 || cp > 0xdfff) all += String.fromCodePoint(cp);
    const once = text(await ok("classical:rot8000", [str(all)]));
    expect(once.length).toBe(all.length);
    expect(text(await ok("classical:rot8000", [str(once)]))).toBe(all);
    // The invalid characters stay where they are: controls, spaces, the private use area edge...
    for (const cp of [0, 0x20, 0x7f, 0xa0, 0x1680, 0x2000, 0x3000, 0x2028]) {
      expect(once.codePointAt(all.indexOf(String.fromCodePoint(cp)))).toBe(cp);
    }
  });

  test("64 KiB of text", { timeout: 60_000 }, async () => {
    const s = randText(65536);
    const once = await ok("classical:rot8000", [str(s)]);
    expect(text(await ok("classical:rot8000", [once]))).toBe(s);
  });
});

describe("rot-brute", () => {
  test("lists shifts 1 to 25 for rot and 1 to 93 for rot47, each equal to the single word", async () => {
    const data = ascii("Attack at Dawn, 12:30!");
    for (const [variant, word, count] of [
      ["rot", "classical:rot", 25],
      ["rot47", "classical:rot47", 93],
    ] as const) {
      const r = (await ok("classical:rot-brute", [
        bytes(data),
        str(variant),
        str(""),
        bool(false),
      ])) as unknown as {
        v: { v: ReadonlyMap<string, { v: unknown }> }[];
      };
      expect(r.v.length).toBe(count);
      for (const rec of r.v) {
        const shift = rec.v.get("shift")!.v as number;
        const want =
          variant === "rot"
            ? raw(await ok(word, [bytes(data), int(shift)]))
            : Uint8Array.from(data, (c) =>
                c >= 33 && c <= 126 ? ((c - 33 + shift) % 94) + 33 : c,
              );
        expect(rec.v.get("output")!.v).toEqual(want);
        if (variant === "rot47" && shift === 47)
          expect(want).toEqual(raw(await ok(word, [bytes(data)])));
      }
    }
  });

  test("the crib keeps only matching shifts", async () => {
    const r = (await ok("classical:rot-brute", [
      bytes(ascii("Uryyb Jbeyq")),
      str("rot"),
      str("World"),
      bool(false),
    ])) as unknown as { v: { v: ReadonlyMap<string, { v: unknown }> }[] };
    expect(r.v.map((x) => x.v.get("shift")!.v)).toEqual([13]);
  });

  test("the variant must be rot or rot47", async () => {
    expect(
      await fails("classical:rot-brute", [bytes(randBytes(3)), str("rot13"), str(""), bool(false)]),
    ).toBe("E_PARAM_INVALID");
  });

  test("64 KiB with a crib, and with printable-only", { timeout: 60_000 }, async () => {
    const plain = ascii("The quick brown fox jumps over the lazy dog. ".repeat(1500)).slice(
      0,
      65536,
    );
    const enc = await ok("classical:rot", [bytes(plain), int(7)]);
    for (const printable of [false, true]) {
      const r = (await ok("classical:rot-brute", [
        enc,
        str("rot"),
        str("lazy dog"),
        bool(printable),
      ])) as unknown as {
        v: { v: ReadonlyMap<string, { v: unknown }> }[];
      };
      expect(r.v.map((x) => x.v.get("shift")!.v)).toEqual([19]);
    }
    const all = (await ok("classical:rot-brute", [
      bytes(randBytes(65536)),
      str("rot47"),
      str(""),
      bool(false),
    ])) as unknown as {
      v: unknown[];
    };
    expect(all.v.length).toBe(93);
  });
});

describe("cetacean", () => {
  test("decode(encode(x)) is x", async () => {
    for (const s of ["", "hello", "Hello, World! é€ 日本語", "a\u{1F600}b\u{10FFFF}"]) {
      const enc = await ok("classical:cetacean-encode", [str(s)]);
      expect(text(enc)).toMatch(/^[Ee]*$/);
      expect(text(enc).length).toBe(
        [...s].reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 32 : 16), 0),
      );
      expect(text(await ok("classical:cetacean-decode", [enc]))).toBe(s);
    }
    for (let trial = 0; trial < 20; trial++) {
      const s = randText(60);
      const enc = await ok("classical:cetacean-encode", [str(s)]);
      expect(text(await ok("classical:cetacean-decode", [enc]))).toBe(s);
    }
  });

  test("errors are E_COERCE", async () => {
    for (const bad of [
      "E",
      "EEEEEEEEEEEEEEEX",
      "eeEeeEEEEEEEEEEE",
      "eeEeeEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    ]) {
      expect(await fails("classical:cetacean-decode", [str(bad)])).toBe("E_COERCE");
    }
  });

  test("64 KiB round trip", { timeout: 60_000 }, async () => {
    const s = randText(65536);
    const enc = await ok("classical:cetacean-encode", [str(s)]);
    expect(text(enc).length).toBe(65536 * 16);
    expect(text(await ok("classical:cetacean-decode", [enc]))).toBe(s);
  });

  test("32768 characters outside the BMP (64 KiB of UTF-16)", { timeout: 60_000 }, async () => {
    let s = "";
    for (let i = 0; i < 32768; i++) s += String.fromCodePoint(0x1f300 + (i % 700));
    const enc = await ok("classical:cetacean-encode", [str(s)]);
    expect(text(await ok("classical:cetacean-decode", [enc]))).toBe(s);
  });
});

describe("ctx1", () => {
  test("decode(encode(x)) is x", async () => {
    for (const s of ["", "a", "password", "Päss wörd \u{1F600}"]) {
      const enc = await ok("classical:ctx1-encode", [str(s)]);
      expect(text(enc)).toMatch(/^[A-P]*$/);
      expect(text(await ok("classical:ctx1-decode", [enc]))).toBe(s);
    }
    for (let trial = 0; trial < 20; trial++) {
      const s = randText(40);
      const enc = await ok("classical:ctx1-encode", [str(s)]);
      expect(text(await ok("classical:ctx1-decode", [enc]))).toBe(s);
    }
  });

  test("every output letter is in A to P and the length is four per UTF-16 unit", async () => {
    const enc = await ok("classical:ctx1-encode", [str("ab\u{1F600}")]);
    expect(text(enc).length).toBe(4 * 4);
  });

  test("errors are E_COERCE", async () => {
    for (const bad of ["Q", "NFH", "nfha", "AAAAAAAAAAAAAAAA".slice(0, 5)]) {
      expect(await fails("classical:ctx1-decode", [str(bad)])).toBe("E_COERCE");
    }
  });

  test("64 KiB round trip", { timeout: 60_000 }, async () => {
    const s = randText(65536);
    const enc = await ok("classical:ctx1-encode", [str(s)]);
    expect(text(await ok("classical:ctx1-decode", [enc]))).toBe(s);
  });

  test("32768 characters outside the BMP (64 KiB of UTF-16)", { timeout: 60_000 }, async () => {
    let s = "";
    for (let i = 0; i < 32768; i++) s += String.fromCodePoint(0x1f300 + (i % 700));
    const enc = await ok("classical:ctx1-encode", [str(s)]);
    expect(text(await ok("classical:ctx1-decode", [enc]))).toBe(s);
  });
});

describe("ls47", () => {
  const enc = (t: string, pw: string, nonce = "", sig = "") =>
    ok("classical:ls47-encrypt", [str(t), str(pw), str(nonce), str(sig)]);
  const dec = (t: string, pw: string, n = 0, sig = "") =>
    ok("classical:ls47-decrypt", [str(t), str(pw), int(n), str(sig)]);

  test("decrypt(encrypt(x)) is x, with and without nonce and signature", async () => {
    for (let trial = 0; trial < 20; trial++) {
      const t = randLs47(Math.floor(rand() * 80));
      const pw = randLs47(1 + Math.floor(rand() * 30));
      const c = text(await enc(t, pw));
      expect(c.length).toBe(t.length);
      expect(text(await dec(c, pw))).toBe(t);
      const nonce = randLs47(10);
      const c2 = text(await enc(t, pw, nonce, "sig"));
      expect(c2.length).toBe(10 + t.length + 6);
      expect(text(await dec(c2, pw, 10, "sig"))).toBe(t);
    }
  });

  test("a different password or nonce changes the cipher text", async () => {
    const a = text(await enc("attack_at_dawn", "key1"));
    expect(text(await enc("attack_at_dawn", "key2"))).not.toBe(a);
    expect(text(await enc("attack_at_dawn", "key1", "n"))).not.toBe(a);
  });

  test("errors are E_COERCE; empty passwords and long nonces are rejected", async () => {
    expect(await fails("classical:ls47-encrypt", [str("Hi"), str("abc"), str(""), str("")])).toBe(
      "E_COERCE",
    );
    expect(await fails("classical:ls47-encrypt", [str("hi"), str("ABC"), str(""), str("")])).toBe(
      "E_COERCE",
    );
    expect(await fails("classical:ls47-encrypt", [str("hi"), str("abc"), str("N"), str("")])).toBe(
      "E_COERCE",
    );
    expect(await fails("classical:ls47-decrypt", [str("a b"), str("abc"), int(0), str("")])).toBe(
      "E_COERCE",
    );
    expect(await fails("classical:ls47-decrypt", [str("abc"), str("abc"), int(4), str("")])).toBe(
      "E_COERCE",
    );
    expect(await fails("classical:ls47-decrypt", [str("abc"), str("abc"), int(0), str("x")])).toBe(
      "E_COERCE",
    );
    expect(await fails("classical:ls47-encrypt", [str("hi"), str(""), str(""), str("")])).toBe(
      "E_PARAM_INVALID",
    );
    expect(await fails("classical:ls47-decrypt", [str("hi"), str("abc"), int(1001), str("")])).toBe(
      "E_PARAM_INVALID",
    );
  });

  test("64 KiB round trip, and a 4096-letter password", { timeout: 60_000 }, async () => {
    const t = randLs47(65536);
    const pw = randLs47(4096);
    const c = text(await enc(t, pw));
    expect(text(await dec(c, pw))).toBe(t);
  });
});
