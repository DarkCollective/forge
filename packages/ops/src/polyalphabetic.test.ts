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

// polyalphabetic is FL (vocab/polyalphabetic.fth); these tests drive its public words through the runtime.
// The published worked examples are in vocab/polyalphabetic.test.json.
const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["polyalphabetic"]));
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

async function run(word: string, text: string, key: string) {
  return runtime.call(`polyalphabetic:${word}`, [bytes(asciiBytes(text)), str(key)]);
}

function outText(r: Awaited<ReturnType<typeof run>>): string {
  expect(r.ok).toBe(true);
  return asciiText(top(r).v as Uint8Array);
}

describe("polyalphabetic: published examples", () => {
  test("autokey, primer QUEENLY: attack at dawn", async () => {
    expect(outText(await run("vigenere-autokey-encrypt", "attackatdawn", "QUEENLY"))).toBe(
      "qnxepvytwtwp",
    );
    expect(outText(await run("vigenere-autokey-decrypt", "QNXEPVYTWTWP", "QUEENLY"))).toBe(
      "ATTACKATDAWN",
    );
  });

  test("Gronsfeld, digits 31415 over attack at dawn", async () => {
    expect(outText(await run("gronsfeld-encrypt", "Attack at dawn", "31415"))).toBe(
      "Duxbhn bx efzo",
    );
    expect(outText(await run("gronsfeld-decrypt", "Duxbhn bx efzo", "31415"))).toBe(
      "Attack at dawn",
    );
  });

  test("Beaufort, key LEMON over ATTACKATDAWN (k - p mod 26)", async () => {
    expect(outText(await run("beaufort", "ATTACKATDAWN", "LEMON"))).toBe("LLTOLBETLNPR");
    expect(outText(await run("beaufort", "LLTOLBETLNPR", "LEMON"))).toBe("ATTACKATDAWN");
  });
});

describe("polyalphabetic: round trips", () => {
  test("autokey, Gronsfeld and Beaufort round-trip random letters and keys", async () => {
    const next = rng(31);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, 1 + Math.floor(next() * 12));
      const text = letters(next, Math.floor(next() * 60));
      const ct = outText(await run("vigenere-autokey-encrypt", text, key));
      expect(outText(await run("vigenere-autokey-decrypt", ct, key))).toBe(text);
      const digits = String(Math.floor(next() * 10)) + String(Math.floor(next() * 10));
      const g = outText(await run("gronsfeld-encrypt", text, digits));
      expect(outText(await run("gronsfeld-decrypt", g, digits))).toBe(text);
      const b = outText(await run("beaufort", text, key));
      expect(outText(await run("beaufort", b, key))).toBe(text);
    }
  });

  test("non-letters pass through and use up no key letter", async () => {
    expect(outText(await run("beaufort", "A-A, A!", "B"))).toBe("B-B, B!");
    expect(outText(await run("gronsfeld-encrypt", "a1 a", "10"))).toBe("b1 a");
  });
});

describe("polyalphabetic: parameters", () => {
  test("an empty key is rejected", async () => {
    const r = await run("beaufort", "ABC", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("a Gronsfeld key with a letter is rejected", async () => {
    const r = await run("gronsfeld-encrypt", "ABC", "1A");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });
});

describe("polyalphabetic: size", () => {
  test("64 KiB of bytes round trips inside the default limits", async () => {
    const next = rng(9);
    const text = Uint8Array.from({ length: 65536 }, () => Math.floor(next() * 256));
    const key = "LEMONADESTANDS";
    const ct = await runtime.call("polyalphabetic:beaufort", [bytes(text), str(key)]);
    expect(ct.ok).toBe(true);
    const back = await runtime.call("polyalphabetic:beaufort", [top(ct) as never, str(key)]);
    expect(back.ok).toBe(true);
    expect(top(back).v).toEqual(text);
    const auto = await runtime.call("polyalphabetic:vigenere-autokey-encrypt", [
      bytes(text),
      str(key),
    ]);
    expect(auto.ok).toBe(true);
    const autoBack = await runtime.call("polyalphabetic:vigenere-autokey-decrypt", [
      top(auto) as never,
      str(key),
    ]);
    expect(autoBack.ok).toBe(true);
    expect(top(autoBack).v).toEqual(text);
  }, 60_000);
});

describe("polyalphabetic: porta", () => {
  test("published example, key FORTIFICATION (both directions)", async () => {
    expect(outText(await run("porta", "DEFENDTHEEASTWALLOFTHECASTLE", "FORTIFICATION"))).toBe(
      "SYNNJSCVRNRLAHUTUKUCVRYRLANY",
    );
    expect(outText(await run("porta", "SYNNJSCVRNRLAHUTUKUCVRYRLANY", "FORTIFICATION"))).toBe(
      "DEFENDTHEEASTWALLOFTHECASTLE",
    );
  });

  test("the AB and CD rows of the tableau", async () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    expect(outText(await run("porta", alphabet, "AB"))).toBe("NOPQRSTUVWXYZABCDEFGHIJKLM");
    expect(outText(await run("porta", alphabet, "C"))).toBe("OPQRSTUVWXYZNMABCDEFGHIJKL");
  });

  test("keeps case, passes other bytes through and uses no key letter for them", async () => {
    expect(outText(await run("porta", "Hello, World!", "A"))).toBe("Uryyb, Jbeyq!");
    expect(outText(await run("porta", "hello, world!", "ab"))).toBe("uryyb, jbeyq!");
    expect(outText(await run("porta", "a1 A", "B"))).toBe("n1 N");
    expect(outText(await run("porta", "AA", "AC"))).toBe("NO");
  });

  test("round trip: porta(porta(x)) == x for random letters and keys", async () => {
    const next = rng(41);
    for (let trial = 0; trial < 40; trial++) {
      const key = letters(next, 1 + Math.floor(next() * 12));
      const text = letters(next, Math.floor(next() * 60));
      const ct = outText(await run("porta", text, key));
      expect(outText(await run("porta", ct, key))).toBe(text);
    }
  });

  test("an empty key is rejected", async () => {
    const r = await run("porta", "ABC", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("a key with a digit is rejected", async () => {
    const r = await run("porta", "ABC", "A1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_PARAM_INVALID");
  });

  test("64 KiB of bytes round trips inside the default limits", async () => {
    const next = rng(9);
    const text = Uint8Array.from({ length: 65536 }, () => Math.floor(next() * 256));
    const ct = await runtime.call("polyalphabetic:porta", [bytes(text), str("FORTIFICATION")]);
    expect(ct.ok).toBe(true);
    const back = await runtime.call("polyalphabetic:porta", [
      top(ct) as never,
      str("FORTIFICATION"),
    ]);
    expect(back.ok).toBe(true);
    expect(top(back).v).toEqual(text);
  }, 60_000);
});
