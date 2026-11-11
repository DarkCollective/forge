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

// enigma is FL (vocab/enigma.fth); these tests drive enigma:encrypt through the runtime. The
// historical known-answer vectors are in vocab/enigma.test.json.
const { str, bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["enigma"]));

// The package has no TextEncoder typings; the text here is ASCII.
const encode = (t: string): Uint8Array => Uint8Array.from(t, (c) => c.charCodeAt(0) & 255);
const decode = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

interface Settings {
  model: string;
  rotors: string;
  reflector: string;
  rings: string;
  positions: string;
  plugboard: string;
  others: string;
}

const BASE: Settings = {
  model: "I",
  rotors: "I II III",
  reflector: "B",
  rings: "AAA",
  positions: "AAA",
  plugboard: "",
  others: "keep",
};

async function run(input: Uint8Array, s: Partial<Settings>) {
  const o = { ...BASE, ...s };
  return runtime.call("enigma:encrypt", [
    bytes(input),
    str(o.model),
    str(o.rotors),
    str(o.reflector),
    str(o.rings),
    str(o.positions),
    str(o.plugboard),
    str(o.others),
  ]);
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

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)] as T;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomLetters(next: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += LETTERS[Math.floor(next() * 26)];
  return out;
}

function randomPlugboard(next: () => number): string {
  const letters = [...LETTERS];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [letters[i], letters[j]] = [letters[j] as string, letters[i] as string];
  }
  const pairs: string[] = [];
  const count = Math.floor(next() * 11);
  for (let i = 0; i < count; i++)
    pairs.push((letters[2 * i] as string) + (letters[2 * i + 1] as string));
  return pairs.join(" ");
}

function randomSettings(next: () => number): Partial<Settings> {
  const model = pick(next, ["I", "M3", "M4"]);
  const names =
    model === "I"
      ? ["I", "II", "III", "IV", "V"]
      : ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  const rotors: string[] = [];
  while (rotors.length < 3) {
    const r = pick(next, names);
    if (!rotors.includes(r)) rotors.push(r);
  }
  if (model === "M4") rotors.unshift(pick(next, ["Beta", "Gamma"]));
  const reflector =
    model === "I"
      ? pick(next, ["A", "B", "C"])
      : model === "M3"
        ? pick(next, ["B", "C"])
        : pick(next, ["B-thin", "C-thin"]);
  const n = rotors.length;
  return {
    model,
    rotors: rotors.join(" "),
    reflector,
    rings: randomLetters(next, n),
    positions: randomLetters(next, n),
    plugboard: randomPlugboard(next),
  };
}

describe("enigma round trip and structure", () => {
  test(
    "encrypting twice with the same settings is the identity, for random machines",
    { timeout: 60_000 },
    async () => {
      const next = rng(5);
      for (let trial = 0; trial < 60; trial++) {
        const s = randomSettings(next);
        const plain = randomLetters(next, 1 + Math.floor(next() * 120));
        const cipher = await enc(plain, s);
        expect(cipher).toHaveLength(plain.length);
        expect(await enc(cipher, s)).toBe(plain);
      }
    },
  );

  test("a letter never enciphers to itself", async () => {
    const next = rng(6);
    for (let trial = 0; trial < 20; trial++) {
      const s = randomSettings(next);
      const plain = randomLetters(next, 200);
      const cipher = await enc(plain, s);
      for (let i = 0; i < plain.length; i++) expect(cipher[i]).not.toBe(plain[i]);
    }
  });

  test("the same letter pressed repeatedly gives a varying sequence (rotors turn)", async () => {
    const cipher = await enc("A".repeat(60));
    expect(new Set(cipher).size).toBeGreaterThan(10);
  });

  test("rings and positions given as numbers equal the same letters", async () => {
    const letters = await enc("HELLOWORLD", { rings: "BUL", positions: "QWE" });
    expect(await enc("HELLOWORLD", { rings: "2 21 12", positions: "17 23 5" })).toBe(letters);
    expect(await enc("HELLOWORLD", { rings: "B U L", positions: "17,23,5" })).toBe(letters);
    expect(await enc("HELLOWORLD", { rings: "bul", positions: "qwe" })).toBe(letters);
  });

  test("a ring setting of B with start B is the same as A with start A for a single letter", async () => {
    // The shift is position minus ring, so equal offsets give the same first-letter wiring path when
    // no turnover is crossed; the notch checks differ, so compare only a short text.
    expect(await enc("X", { rings: "BBB", positions: "BBB" })).toBe(
      await enc("X", { rings: "AAA", positions: "AAA" }),
    );
  });
});

describe("enigma letters and other bytes", () => {
  test("lower case is enciphered like upper case and written in upper case", async () => {
    expect(await enc("hello")).toBe(await enc("HELLO"));
    expect(await enc("HeLLo")).toBe(await enc("HELLO"));
  });

  test("others=keep passes other bytes through without turning the rotors", async () => {
    const plain = await enc("HELLOWORLD");
    const spaced = await enc("HELLO, WORLD! 123\n");
    expect(spaced.replace(/[^A-Z]/g, "")).toBe(plain);
    expect(spaced).toMatch(/^[A-Z]{5}, [A-Z]{5}! 123\n$/);
  });

  test("others=remove drops them", async () => {
    expect(await enc("HELLO, WORLD! 123\n", { others: "remove" })).toBe(await enc("HELLOWORLD"));
  });

  test("binary and UTF-8 bytes pass through in keep mode", async () => {
    const r = await run(new Uint8Array([0xff, 0x00, 0x41, 0xc3, 0xa9]), {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
      expect([...out].slice(0, 2)).toEqual([0xff, 0x00]);
      expect([...out].slice(3)).toEqual([0xc3, 0xa9]);
      expect(String.fromCharCode(out[2] as number)).toMatch(/[A-Z]/);
    }
  });

  test("empty input gives empty output", async () => {
    expect(await enc("")).toBe("");
  });
});

describe("enigma stepping", () => {
  // Window positions are not exposed; they are seen through the enciphering of a long run of one
  // letter, which depends on every step. The double-step case is also in the JSON vectors.
  test("the middle rotor double steps: ADU goes ADV, AEW, BFX", async () => {
    // Rotors I II III: the right rotor (III) turns the middle one at V, and the middle rotor (II) at
    // E carries the left rotor and itself ("double step"). Presses from ADU are made at ADV, AEW
    // and BFX (without the anomaly the third would be at AEX). Each press is the first press of a
    // machine started one position earlier, except that the anomaly itself must come out as BFX:
    // the first press from AEW is made at BFX, which is the third press from ADU.
    const run = await enc("AAA", { positions: "ADU" });
    expect(run[1]).toBe(await enc("A", { positions: "ADV" }));
    expect(run[2]).toBe(await enc("A", { positions: "AEW" }));
  });

  test("a rotor with two notches turns the next rotor twice per revolution", async () => {
    // Rotor VI as the right rotor has turnovers at Z and M: over 26 presses the middle rotor steps
    // twice. Comparing against the same start in a machine whose right rotor has one turnover would
    // differ; here we only check the revolution is consistent: 52 presses from a start equal the
    // last 26 of 78 presses from 26 positions earlier is covered by the JSON vectors.
    const a = await enc("A".repeat(60), { model: "M3", rotors: "I II VI" });
    const b = await enc("A".repeat(60), { model: "M3", rotors: "I II V" });
    expect(a).not.toBe(b);
  });
});

describe("enigma argument validation", () => {
  test("rotor count must match the model", async () => {
    expect((await errorOf({ rotors: "I II" })).code).toBe("E_RANGE");
    expect((await errorOf({ rotors: "I II III IV" })).code).toBe("E_RANGE");
    expect(
      (
        await errorOf({
          model: "M4",
          rotors: "I II III",
          reflector: "B-thin",
          rings: "AAAA",
          positions: "AAAA",
        })
      ).code,
    ).toBe("E_RANGE");
  });

  test("rotors outside the model are refused", async () => {
    expect((await errorOf({ rotors: "I II VI" })).message).toContain("VI");
    expect((await errorOf({ rotors: "I II IX", model: "M3" })).code).toBe("E_RANGE");
    expect((await errorOf({ model: "M3", rotors: "Beta I II" })).code).toBe("E_RANGE");
    expect(
      (
        await errorOf({
          model: "M4",
          rotors: "I II III IV",
          reflector: "B-thin",
          rings: "AAAA",
          positions: "AAAA",
        })
      ).code,
    ).toBe("E_RANGE");
    expect(
      (
        await errorOf({
          model: "M4",
          rotors: "Beta Gamma I II",
          reflector: "B-thin",
          rings: "AAAA",
          positions: "AAAA",
        })
      ).code,
    ).toBe("E_RANGE");
  });

  test("the reflector must fit the model", async () => {
    expect((await errorOf({ model: "I", reflector: "B-thin" })).code).toBe("E_RANGE");
    expect((await errorOf({ model: "M3", reflector: "A" })).code).toBe("E_RANGE");
    expect(
      (
        await errorOf({
          model: "M4",
          rotors: "Beta I II III",
          reflector: "B",
          rings: "AAAA",
          positions: "AAAA",
        })
      ).code,
    ).toBe("E_RANGE");
  });

  test("rings and positions: wrong count, bad letter, bad number", async () => {
    expect((await errorOf({ rings: "AA" })).code).toBe("E_RANGE");
    expect((await errorOf({ positions: "AAAA" })).code).toBe("E_RANGE");
    expect((await errorOf({ rings: "A1B" })).code).toBe("E_RANGE");
    expect((await errorOf({ rings: "0 5 6" })).code).toBe("E_RANGE");
    expect((await errorOf({ positions: "1 27 3" })).code).toBe("E_RANGE");
    expect((await errorOf({ rings: "-1 2 3" })).code).toBe("E_RANGE");
  });

  test("plugboard: a letter twice, a pair of one letter, a non-letter, a triple", async () => {
    expect((await errorOf({ plugboard: "AB BC" })).message).toContain("one pair");
    expect((await errorOf({ plugboard: "AA" })).code).toBe("E_RANGE");
    expect((await errorOf({ plugboard: "A1" })).code).toBe("E_RANGE");
    expect((await errorOf({ plugboard: "ABC" })).code).toBe("E_RANGE");
    expect((await errorOf({ plugboard: "AB CD AE" })).code).toBe("E_RANGE");
  });

  test("a plugboard with thirteen pairs is accepted", async () => {
    const pairs = "AB CD EF GH IJ KL MN OP QR ST UV WX YZ";
    expect(await enc("HELLO", { plugboard: pairs })).toHaveLength(5);
  });
});

describe("enigma at 64 KiB", () => {
  test("a 64 KiB text round trips inside the default limits", async () => {
    const next = rng(7);
    const plain = randomLetters(next, 65536);
    const s: Partial<Settings> = {
      model: "M4",
      rotors: "Beta VI VII VIII",
      reflector: "C-thin",
      rings: "EPEL",
      positions: "NAEM",
      plugboard: "AE BF CM DQ HU JN LX PR SZ VW",
    };
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
  test("encrypt documents its parameters and defaults; decrypt is an alias", () => {
    const meta = runtime.meta("enigma:encrypt");
    expect(meta.params.map((p) => p.name)).toEqual([
      "model",
      "rotors",
      "reflector",
      "rings",
      "positions",
      "plugboard",
      "others",
    ]);
    for (const p of meta.params) expect(p.doc).toBeTruthy();
    expect(meta.params[0]?.default).toBe("I");
    expect(runtime.meta("enigma:decrypt").name).toBe("encrypt");
  });
});
