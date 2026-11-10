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

// transposition is FL (vocab/transposition.fth); these tests drive its public words through the runtime.
// The published worked examples are in vocab/transposition.test.json.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["transposition"]));
const asciiBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const asciiText = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

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

function letters(next: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String.fromCharCode(65 + Math.floor(next() * 26));
  return out;
}

async function encrypt(text: string, key: string, pad = "") {
  return runtime.call("transposition:transposition-encrypt", [
    bytes(asciiBytes(text)),
    str(key),
    str(pad),
  ]);
}

async function decrypt(text: string, key: string) {
  return runtime.call("transposition:transposition-decrypt", [bytes(asciiBytes(text)), str(key)]);
}

function outText(r: Awaited<ReturnType<typeof encrypt>>): string {
  expect(r.ok).toBe(true);
  return asciiText(top(r).v as Uint8Array);
}

describe("transposition: published examples", () => {
  test("ZEBRAS without a pad: the short last row is left short", async () => {
    expect(outText(await encrypt("WEAREDISCOVEREDFLEEATONCE", "ZEBRAS"))).toBe(
      "EVLNACDTESEAROFODEECWIREE",
    );
  });

  test("decrypt of the irregular cipher text gives the plain text", async () => {
    expect(outText(await decrypt("EVLNACDTESEAROFODEECWIREE", "ZEBRAS"))).toBe(
      "WEAREDISCOVEREDFLEEATONCE",
    );
  });

  test("the ADFGX column step with CARGO (Wikipedia ADFGX example)", async () => {
    expect(outText(await encrypt("AFADADAFGFDXAFADDFFXGFXF", "CARGO"))).toBe(
      "FAXDFADDDGDGFFFAFAXAFAFX",
    );
  });
});

describe("transposition: round trip", () => {
  test("decrypt(encrypt(x)) == x for random letters and keys", async () => {
    const next = rng(21);
    for (let trial = 0; trial < 60; trial++) {
      const key = letters(next, 1 + Math.floor(next() * 9));
      const text = letters(next, Math.floor(next() * 80));
      const ct = outText(await encrypt(text, key));
      expect(ct.length).toBe(text.length);
      expect(outText(await decrypt(ct, key))).toBe(text);
    }
  });

  test("with a pad, decrypt returns the padded text", async () => {
    const next = rng(22);
    for (let trial = 0; trial < 30; trial++) {
      const key = letters(next, 1 + Math.floor(next() * 7));
      const text = letters(next, Math.floor(next() * 50));
      const w = key.length;
      const padded = text + "Z".repeat((w - (text.length % w)) % w);
      const ct = outText(await encrypt(text, key, "Z"));
      expect(ct.length).toBe(padded.length);
      expect(outText(await decrypt(ct, key))).toBe(padded);
    }
  });

  test("bytes that are not letters take part unchanged", async () => {
    const r = await encrypt("a b,cé", "KEY");
    expect(r.ok).toBe(true);
    const back = await runtime.call("transposition:transposition-decrypt", [
      top(r) as never,
      str("KEY"),
    ]);
    expect(back.ok).toBe(true);
    expect(asciiText(top(back).v as Uint8Array)).toBe("a b,cé");
  });
});

describe("transposition: keys and parameters", () => {
  test("equal key letters keep their left-to-right order", async () => {
    // columns: K0 E1 Y2 E3 -> order E1, E3, K0, Y2
    expect(outText(await encrypt("ABCDEFGH", "KEYE"))).toBe("BFDHAECG");
  });

  test("key letters are case-insensitive", async () => {
    expect(outText(await encrypt("ABCDEFGH", "zebras"))).toBe(
      outText(await encrypt("ABCDEFGH", "ZEBRAS")),
    );
  });

  test("an empty key is rejected by the parameter constraint", async () => {
    const r = await encrypt("ABC", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("a key with a non-letter is rejected", async () => {
    const r = await encrypt("ABC", "KE1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("a pad of two letters is rejected", async () => {
    const r = await encrypt("ABC", "KEY", "XY");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });
});

describe("transposition: size", () => {
  test("64 KiB round trips well inside the default limits", async () => {
    const next = rng(9);
    const text = Uint8Array.from({ length: 65536 }, () => Math.floor(next() * 256));
    const key = "ZEBRASQUARTZ";
    const ct = await runtime.call("transposition:transposition-encrypt", [
      bytes(text),
      str(key),
      str(""),
    ]);
    expect(ct.ok).toBe(true);
    const back = await runtime.call("transposition:transposition-decrypt", [
      top(ct) as never,
      str(key),
    ]);
    expect(back.ok).toBe(true);
    expect(top(back).v).toEqual(text);
  }, 60_000);
});
