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

// sigaba is FL (vocab/sigaba.fth) with one private primitive (_run, src/prims/sigaba.ts). These
// tests drive the public op through the runtime; the known answers (cross-checked against an
// independent simulator) are in vocab/sigaba.test.json.
const { str, bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["sigaba"]));

interface Key {
  mode: string;
  cipherRotors: string;
  controlRotors: string;
  indexRotors: string;
  cipherPositions: string;
  controlPositions: string;
  indexPositions: string;
  wirings: string;
  indexWirings: string;
  other: string;
}

const DEFAULT: Key = {
  mode: "encrypt",
  cipherRotors: "0 1 2 3 4",
  controlRotors: "5 6 7 8 9",
  indexRotors: "0 1 2 3 4",
  cipherPositions: "OOOOO",
  controlPositions: "OOOOO",
  indexPositions: "00000",
  wirings: "",
  indexWirings: "",
  other: "drop",
};

const enc = new TextEncoder();
const dec = new TextDecoder();

async function crypt(text: string | Uint8Array, over: Partial<Key> = {}) {
  const k = { ...DEFAULT, ...over };
  return runtime.call("sigaba:crypt", [
    bytes(typeof text === "string" ? enc.encode(text) : text),
    str(k.mode),
    str(k.cipherRotors),
    str(k.controlRotors),
    str(k.indexRotors),
    str(k.cipherPositions),
    str(k.controlPositions),
    str(k.indexPositions),
    str(k.wirings),
    str(k.indexWirings),
    str(k.other),
  ]);
}

async function text(t: string, over: Partial<Key> = {}): Promise<string> {
  const r = await crypt(t, over);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const top = r.stack[r.stack.length - 1] as { v: Uint8Array | string };
  return typeof top.v === "string" ? top.v : dec.decode(top.v);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(next: () => number, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A random complete key: rotors, orientations, positions, and optionally custom wirings. */
function randomKey(next: () => number, custom: boolean): Partial<Key> {
  const ids = shuffle(next, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const tok = (id: number) => `${id}${next() < 0.5 ? "R" : ""}`;
  const letters = () =>
    Array.from({ length: 5 }, () => LETTERS[Math.floor(next() * 26)] as string).join("");
  const key: Partial<Key> = {
    cipherRotors: ids.slice(0, 5).map(tok).join(" "),
    controlRotors: ids.slice(5).map(tok).join(" "),
    indexRotors: shuffle(next, [0, 1, 2, 3, 4]).join(" "),
    cipherPositions: letters(),
    controlPositions: letters(),
    indexPositions: Array.from({ length: 5 }, () => Math.floor(next() * 10)).join(""),
  };
  if (custom) {
    key.wirings = Array.from({ length: 10 }, () => shuffle(next, [...LETTERS]).join("")).join(" ");
    key.indexWirings = Array.from({ length: 5 }, () =>
      shuffle(next, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).join(""),
    ).join(" ");
  }
  return key;
}

/** Text with no Z (it is enciphered as X, so Z does not survive a round trip); spaces included. */
function randomText(next: () => number, length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXY ";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(next() * alphabet.length)];
  return out;
}

async function codeOf(r: Awaited<ReturnType<typeof crypt>>): Promise<string> {
  return r.ok ? "ok" : r.error.code;
}

describe("sigaba round trip", () => {
  test("decrypt(encrypt(x)) == x for random keys, default and custom wirings", async () => {
    const next = rng(58);
    for (let trial = 0; trial < 60; trial++) {
      const key = randomKey(next, trial % 2 === 1);
      const plain = randomText(next, Math.floor(next() * 300));
      const cipher = await text(plain, key);
      expect(cipher).toMatch(/^[A-Z]*$/);
      expect(cipher.length).toBe(plain.length);
      expect(await text(cipher, { ...key, mode: "decrypt" })).toBe(plain);
    }
  });

  test("X and Z both come back as X, a space comes back as a space", async () => {
    const cipher = await text("XZ X Z");
    expect(await text(cipher, { mode: "decrypt" })).toBe("XX X X");
  });

  test("the same letter does not always give the same letter (the rotors step)", async () => {
    const cipher = await text("A".repeat(200));
    expect(new Set(cipher).size).toBeGreaterThan(10);
  });

  test("case does not matter and other bytes are dropped by default", async () => {
    expect(await text("hello,World!42")).toBe(await text("HELLOWORLD"));
  });

  test("encryption is not its own inverse (SIGABA is not reciprocal)", async () => {
    const plain = "THE QUICK BROWN FOX";
    const cipher = await text(plain);
    expect(await text(cipher)).not.toBe(plain);
  });

  test("the control rotors turn over: fast, medium and slow at O", async () => {
    const key = { controlPositions: "AOOOA" };
    const plain = randomText(rng(3), 800);
    const cipher = await text(plain, key);
    expect(await text(cipher, { ...key, mode: "decrypt" })).toBe(plain);
  });

  test("a different start position gives a different ciphertext", async () => {
    const a = await text("ATTACK AT DAWN");
    const b = await text("ATTACK AT DAWN", { cipherPositions: "OOOOP" });
    const c = await text("ATTACK AT DAWN", { controlPositions: "OOOOP" });
    const d = await text("ATTACK AT DAWN", { indexPositions: "00001" });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  test("a reversed rotor changes the ciphertext", async () => {
    const a = await text("ATTACK AT DAWN");
    const b = await text("ATTACK AT DAWN", { cipherRotors: "0R 1 2 3 4" });
    expect(a).not.toBe(b);
  });

  test("shift wirings make a position-independent shift of 15, in either orientation", async () => {
    const shift = Array.from({ length: 10 }, (_, k) =>
      Array.from({ length: 26 }, (_, i) => LETTERS[(i + k + 1) % 26]).join(""),
    ).join(" ");
    const forward = await text("HELLO", { wirings: shift });
    const reversed = await text("HELLO", { wirings: shift, cipherRotors: "0R 1R 2R 3R 4R" });
    expect(forward).toBe("WTAAD");
    expect(reversed).toBe("WTAAD");
  });
});

describe("sigaba input handling", () => {
  test("other = error rejects anything but letters and spaces, other = drop does not", async () => {
    expect(await codeOf(await crypt("AB1", { other: "error" }))).toBe("E_COERCE");
    expect(await codeOf(await crypt(Uint8Array.of(0x41, 0xff), { other: "error" }))).toBe(
      "E_COERCE",
    );
    expect(await codeOf(await crypt(Uint8Array.of(0x41, 0xff), { other: "drop" }))).toBe("ok");
    expect(await codeOf(await crypt("AB C", { other: "error" }))).toBe("ok");
  });

  test("decrypting skips white space even when other = error", async () => {
    const cipher = await text("ATTACK AT DAWN");
    const spaced = cipher.replace(/(.{5})/g, "$1 \n");
    expect(await text(spaced, { mode: "decrypt", other: "error" })).toBe("ATTACK AT DAWN");
  });

  test("empty input gives empty output", async () => {
    expect(await text("")).toBe("");
    expect(await text("", { mode: "decrypt" })).toBe("");
  });
});

describe("sigaba parameter validation", () => {
  const cases: ReadonlyArray<[string, Partial<Key>, string]> = [
    ["a rotor used in both banks", { controlRotors: "4 5 6 7 8" }, "E_RANGE"],
    ["a rotor used twice in one bank", { cipherRotors: "0 1 2 3 3" }, "E_RANGE"],
    ["an index rotor over 4", { indexRotors: "0 1 2 3 5" }, "E_RANGE"],
    ["four rotors", { cipherRotors: "0 1 2 3" }, "E_PARAM_INVALID"],
    ["a rotor with a bad suffix", { cipherRotors: "0 1 2 3 4Q" }, "E_PARAM_INVALID"],
    ["a reversed index rotor", { indexRotors: "0R 1 2 3 4" }, "E_PARAM_INVALID"],
    ["a short position", { cipherPositions: "OOOO" }, "E_PARAM_INVALID"],
    ["a position with a digit", { controlPositions: "OOOO1" }, "E_PARAM_INVALID"],
    ["an index position with a letter", { indexPositions: "0000O" }, "E_PARAM_INVALID"],
    [
      "a wiring that repeats a letter",
      { wirings: Array(10).fill("A".repeat(26)).join(" ") },
      "E_RANGE",
    ],
    ["nine wirings", { wirings: Array(9).fill(LETTERS).join(" ") }, "E_RANGE"],
    [
      "a wiring with 25 letters",
      { wirings: Array(10).fill(LETTERS.slice(1)).join(" ") },
      "E_RANGE",
    ],
    [
      "an index wiring that repeats a digit",
      { indexWirings: Array(5).fill("0000000000").join(" ") },
      "E_RANGE",
    ],
    ["four index wirings", { indexWirings: Array(4).fill("0123456789").join(" ") }, "E_RANGE"],
    ["an unknown mode", { mode: "both" }, "E_PARAM_INVALID"],
    ["an unknown other", { other: "keep" }, "E_PARAM_INVALID"],
  ];
  for (const [name, over, code] of cases) {
    test(`${name} is ${code}`, async () => {
      expect(await codeOf(await crypt("HELLO", over))).toBe(code);
    });
  }
});

describe("sigaba size", () => {
  test("64 KiB round trips within the default limits", async () => {
    const next = rng(64);
    const key = randomKey(next, false);
    const plain = randomText(next, 65536);
    const enc1 = await crypt(plain, key);
    expect(enc1.ok).toBe(true);
    const cipher = (enc1.stack[enc1.stack.length - 1] as { v: Uint8Array }).v;
    expect(cipher.length).toBe(65536);
    const dec1 = await crypt(cipher, { ...key, mode: "decrypt" });
    expect(dec1.ok).toBe(true);
    expect(dec.decode((dec1.stack[dec1.stack.length - 1] as { v: Uint8Array }).v)).toBe(plain);
  }, 60_000);
});

describe("module", () => {
  test("crypt has the rotor, position, wiring and mode parameters with docs and defaults", () => {
    const meta = runtime.meta("sigaba:crypt");
    expect(meta.params.map((p) => p.name)).toEqual([
      "mode",
      "cipher-rotors",
      "control-rotors",
      "index-rotors",
      "cipher-positions",
      "control-positions",
      "index-positions",
      "wirings",
      "index-wirings",
      "other",
    ]);
    for (const p of meta.params) expect(p.doc).toBeTruthy();
    expect(meta.params[0]?.default).toBe("encrypt");
    expect(meta.params[1]?.default).toBe("0 1 2 3 4");
    expect(meta.category).toBe("Cipher machines");
  });
});
