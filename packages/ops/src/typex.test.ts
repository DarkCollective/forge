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

// typex is FL (vocab/typex.fth); these tests drive typex:encrypt through the runtime. Typex rotor
// wirings are unpublished, so the vectors in vocab/typex.test.json are self-derived with an
// independent simulator, and the tests here are round trips and structural properties. The
// conventions (rotor order, notch timing, reversed rotors, entry plugboard, stepping) follow
// CyberChef's for compatibility, so the vectors are of a CyberChef-compatible machine.
const { str, bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["typex"]));

// The package has no TextEncoder typings; the text here is ASCII.
const encode = (t: string): Uint8Array => Uint8Array.from(t, (c) => c.charCodeAt(0) & 255);
const decode = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

const PARAM_NAMES = [
  "rotor-1",
  "rotor-2",
  "rotor-3",
  "rotor-4",
  "rotor-5",
  "reflector",
  "notches-3",
  "notches-2",
  "reversed",
  "rings",
  "positions",
  "plugboard",
  "others",
] as const;

type Settings = Record<(typeof PARAM_NAMES)[number], string>;

function defaults(): Settings {
  const meta = runtime.meta("typex:encrypt");
  const out: Record<string, string> = {};
  for (const p of meta.params) out[p.name] = String(p.default);
  return out as Settings;
}

const DEFAULTS = defaults();

async function run(input: Uint8Array, s: Partial<Settings>) {
  const o = { ...DEFAULTS, ...s };
  return runtime.call("typex:encrypt", [bytes(input), ...PARAM_NAMES.map((n) => str(o[n]))]);
}

async function enc(text: string, s: Partial<Settings> = {}): Promise<string> {
  const r = await run(encode(text), s);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const top = r.stack[r.stack.length - 1] as { v: Uint8Array };
  return decode(top.v);
}

async function errorOf(
  s: Partial<Settings>,
  text = "HELLO",
): Promise<{ code: string; message: string }> {
  const r = await run(encode(text), s);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function shuffled(next: () => number): string[] {
  const a = [...LETTERS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j] as string, a[i] as string];
  }
  return a;
}

function randomLetters(next: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += LETTERS[Math.floor(next() * 26)];
  return out;
}

function randomReflector(next: () => number): string {
  const p = shuffled(next);
  const map: Record<string, string> = {};
  for (let i = 0; i < 26; i += 2) {
    map[p[i] as string] = p[i + 1] as string;
    map[p[i + 1] as string] = p[i] as string;
  }
  return [...LETTERS].map((c) => map[c]).join("");
}

function randomNotches(next: () => number): string {
  return randomLetters(next, Math.floor(next() * 8));
}

function randomMachine(next: () => number): Partial<Settings> {
  const reversed = [1, 2, 3, 4, 5].filter(() => next() < 0.3).join(" ");
  return {
    "rotor-1": shuffled(next).join(""),
    "rotor-2": shuffled(next).join(""),
    "rotor-3": shuffled(next).join(""),
    "rotor-4": shuffled(next).join(""),
    "rotor-5": shuffled(next).join(""),
    reflector: randomReflector(next),
    "notches-3": randomNotches(next),
    "notches-2": randomNotches(next),
    reversed,
    rings: randomLetters(next, 5),
    positions: randomLetters(next, 5),
    plugboard: next() < 0.5 ? "" : shuffled(next).join(""),
  };
}

describe("typex round trip and structure", () => {
  test(
    "encrypting twice with the same settings is the identity, for random machines",
    { timeout: 60_000 },
    async () => {
      const next = rng(11);
      for (let trial = 0; trial < 50; trial++) {
        const s = randomMachine(next);
        const plain = randomLetters(next, 1 + Math.floor(next() * 150));
        const cipher = await enc(plain, s);
        expect(cipher).toHaveLength(plain.length);
        expect(await enc(cipher, s)).toBe(plain);
      }
    },
  );

  test("a letter never enciphers to itself", async () => {
    const next = rng(12);
    for (let trial = 0; trial < 15; trial++) {
      const s = randomMachine(next);
      const plain = randomLetters(next, 200);
      const cipher = await enc(plain, s);
      for (let i = 0; i < plain.length; i++) expect(cipher[i]).not.toBe(plain[i]);
    }
  });

  test("the example rotors make the same letter vary (rotors turn)", async () => {
    expect(new Set(await enc("A".repeat(60))).size).toBeGreaterThan(10);
  });

  test("rings and positions given as numbers equal the same letters", async () => {
    const letters = await enc("HELLOWORLD", { rings: "BCDEF", positions: "QWERT" });
    expect(await enc("HELLOWORLD", { rings: "2 3 4 5 6", positions: "17,23,5,18,20" })).toBe(
      letters,
    );
    expect(await enc("HELLOWORLD", { rings: "bcdef", positions: "qwert" })).toBe(letters);
  });

  test("with no notches only rotor 3 moves, so the text has the fast rotor's period of 26", async () => {
    const s = { "notches-3": "", "notches-2": "" };
    const cipher = await enc("A".repeat(78), s);
    expect(cipher.slice(0, 26)).toBe(cipher.slice(26, 52));
    expect(cipher.slice(0, 26)).toBe(cipher.slice(52, 78));
  });

  test("a notch on rotor 3 moves rotor 2 and breaks that period", async () => {
    const cipher = await enc("A".repeat(78));
    expect(cipher.slice(0, 26)).not.toBe(cipher.slice(26, 52));
  });

  test("a notch at every window letter makes rotor 2 step at every press", async () => {
    // Rotor 2 stepping at every press, with rotor 1 held still, is a machine whose rotors 3 and 2
    // both advance each press; it differs from the same machine with no notches.
    const all = await enc("A".repeat(40), { "notches-3": LETTERS, "notches-2": "" });
    const none = await enc("A".repeat(40), { "notches-3": "", "notches-2": "" });
    expect(all).not.toBe(none);
  });

  test("a rotor fitted back to front changes the text; an unfitted list is the default", async () => {
    const plain = "REVERSEDROTOR";
    expect(await enc(plain, { reversed: "" })).toBe(await enc(plain));
    for (const n of ["1", "2", "3", "4", "5"])
      expect(await enc(plain, { reversed: n })).not.toBe(await enc(plain));
    expect(await enc(plain, { reversed: "2,4" })).toBe(await enc(plain, { reversed: "4 2" }));
  });

  test("an empty entry plugboard is the identity wiring, which is not the same as no mirroring", async () => {
    expect(await enc("PLUGS", { plugboard: LETTERS })).toBe(await enc("PLUGS"));
    expect(
      await enc("PLUGS", { plugboard: "a b c d e f g h i j k l m n o p q r s t u v w x y z" }),
    ).toBe(await enc("PLUGS"));
    expect(await enc("PLUGS", { plugboard: "BADCFEHGJILKNMPORQTSVUXWZY" })).not.toBe(
      await enc("PLUGS"),
    );
  });

  test("the notch is tested after the step: the fast rotor steps onto it, then the middle one moves", async () => {
    // Identity rotors and a reflector put the whole effect in the shifts. With the fast rotor
    // standing one before its notch the middle rotor moves on the first press, so the text equals
    // that of a machine started with the middle rotor already one on and no notch at all.
    const base = { "notches-2": "", positions: "AAAAA" };
    const carried = await enc("A".repeat(30), { ...base, "notches-3": "F", positions: "AAEAA" });
    const preset = await enc("A".repeat(30), {
      "notches-3": "",
      "notches-2": "",
      positions: "ABEAA",
    });
    expect(carried.slice(0, 1)).toBe(preset.slice(0, 1));
    expect(carried.slice(0, 20)).toBe(preset.slice(0, 20));
  });

  test("the double step: the middle rotor steps on the press before its own notch, the slow one with it", async () => {
    // Middle rotor at C, notch D, no fast notches: the first press steps middle and slow together.
    const stepped = await enc("A".repeat(8), {
      "notches-3": "",
      "notches-2": "D",
      positions: "ACAAA",
    });
    const preset = await enc("A".repeat(8), {
      "notches-3": "",
      "notches-2": "",
      positions: "BDAAA",
    });
    expect(stepped).toBe(preset);
  });

  test("stator ring and position only matter by their difference", async () => {
    expect(await enc("STATORS", { rings: "AAABC", positions: "AAABC" })).toBe(await enc("STATORS"));
  });
});

describe("typex letters and other bytes", () => {
  test("lower case is enciphered like upper case and written in upper case", async () => {
    expect(await enc("hello")).toBe(await enc("HELLO"));
  });

  test("others=keep passes other bytes through; others=remove drops them", async () => {
    const plain = await enc("HELLOWORLD");
    const text = "HELLO, WORLD! 123\n";
    expect((await enc(text)).replace(/[^A-Z]/g, "")).toBe(plain);
    expect(await enc(text)).toMatch(/^[A-Z]{5}, [A-Z]{5}! 123\n$/);
    expect(await enc(text, { others: "remove" })).toBe(plain);
  });

  test("empty input gives empty output", async () => {
    expect(await enc("")).toBe("");
  });
});

describe("typex argument validation", () => {
  test("a wiring must be 26 distinct letters", async () => {
    const e = await errorOf({ "rotor-2": "AACDEFGHIJKLMNOPQRSTUVWXYZ" });
    expect(e.code).toBe("E_RANGE");
    expect(e.message).toContain("rotor-2");
    expect((await errorOf({ "rotor-5": "BCDEFGHIJKLMNOPQRSTUVWXYZB" })).message).toContain(
      "rotor-5",
    );
  });

  test("a wiring of the wrong length or with a non-letter is refused before it runs", async () => {
    expect((await errorOf({ "rotor-3": "ABC" })).code).toBe("E_PARAM_INVALID");
    expect((await errorOf({ "rotor-3": "1BCDEFGHIJKLMNOPQRSTUVWXYZ" })).code).toBe(
      "E_PARAM_INVALID",
    );
  });

  test("the reflector must pair the letters, none with itself", async () => {
    expect((await errorOf({ reflector: LETTERS })).message).toContain("reflector");
    expect((await errorOf({ reflector: DEFAULTS["rotor-1"] })).code).toBe("E_RANGE");
    expect((await errorOf({ reflector: "BCDEFGHIJKLMNOPQRSTUVWXYZA" })).code).toBe("E_RANGE");
  });

  test("notches, reversed, rings, positions and plugboard are checked", async () => {
    expect((await errorOf({ "notches-3": "A1" })).code).toBe("E_RANGE");
    expect((await errorOf({ reversed: "6" })).code).toBe("E_RANGE");
    expect((await errorOf({ reversed: "two" })).code).toBe("E_RANGE");
    expect((await errorOf({ rings: "A B C D" })).code).toBe("E_RANGE");
    expect((await errorOf({ positions: "1 2 3 4 0" })).code).toBe("E_RANGE");
    expect((await errorOf({ plugboard: "AB AC" })).code).toBe("E_RANGE");
    expect((await errorOf({ plugboard: "A" })).code).toBe("E_RANGE");
    expect((await errorOf({ plugboard: `A${LETTERS.slice(0, 25)}` })).code).toBe("E_RANGE");
    expect((await errorOf({ "notches-2": "A1" })).code).toBe("E_RANGE");
  });
});

describe("typex at 64 KiB", () => {
  test("a 64 KiB text round trips inside the default limits", async () => {
    const next = rng(13);
    const s = randomMachine(next);
    const plain = randomLetters(next, 65536);
    const cipher = await enc(plain, s);
    expect(cipher).toHaveLength(65536);
    expect(await enc(cipher, s)).toBe(plain);
  }, 60_000);

  test("64 KiB of mixed text with others=keep stays inside the step budget", async () => {
    const plain = "The quick brown fox jumps over the lazy dog. ".repeat(1458).slice(0, 65536);
    const cipher = await enc(plain);
    expect(cipher).toHaveLength(65536);
    expect(await enc(cipher)).toBe(plain.toUpperCase());
  }, 60_000);
});

describe("module", () => {
  test("encrypt documents all its parameters; decrypt is an alias; the defaults are examples", () => {
    const meta = runtime.meta("typex:encrypt");
    expect(meta.params.map((p) => p.name)).toEqual([...PARAM_NAMES]);
    for (const p of meta.params) expect(p.doc).toBeTruthy();
    expect(meta.doc).toContain("EXAMPLE");
    expect(runtime.meta("typex:decrypt").name).toBe("encrypt");
  });
});
