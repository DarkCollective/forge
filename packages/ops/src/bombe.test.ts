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

// bombe is FL (vocab/bombe.fth) plus the primitive bombe._search (src/prims/bombe.ts, tested in
// src/prims/bombe.test.ts). These tests drive bombe:search through the runtime and make the
// ciphertexts with enigma:encrypt, so the Bombe is checked against the Enigma model of the repo.
// The small vectors are in vocab/bombe.test.json.
const { str, bytes, int } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["bombe", "enigma"]));

// The package has no TextEncoder typings; the text here is ASCII.
const encode = (t: string): Uint8Array => Uint8Array.from(t, (c) => c.charCodeAt(0) & 255);
const decode = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

const PLAIN = [
  "WETTERVORHERSAGEBISKAYAHEUTEKEINBESONDERESEREIGNISXKEINEMELDUNGENVOMFEIND",
  "OBERKOMMANDODERWEHRMACHTMELDETDIELAGEIMOSTENISTUNVERAENDERTXKEINEBESONDERENVORKOMMNISSE",
  "ANFANGSUEDAUSGANGBAERWALDEXENDEDREIKMOSTWAERTSNEUSTADTXFEINDLICHEINFANTERIEKOLONNE",
  "ZURUECKGEZOGENEKRAEFTEBEFINDENSICHIMRAUMNORDOSTVONSTALINGRADXFEINDLICHEPANZERVERBAENDE",
];

/** xorshift32, so the "random" settings are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomPlugboard(r: () => number, pairs: number): string {
  const order = [...LETTERS];
  for (let i = 25; i > 0; i--) {
    const j = r() % (i + 1);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  return Array.from({ length: pairs }, (_, k) => `${order[2 * k]}${order[2 * k + 1]}`).join(" ");
}

interface Settings {
  model: string;
  rotors: string;
  reflector: string;
  rings: string;
  positions: string;
  plugboard: string;
}

async function enigma(text: string, s: Settings): Promise<string> {
  const r = await runtime.call("enigma:encrypt", [
    bytes(encode(text)),
    str(s.model),
    str(s.rotors),
    str(s.reflector),
    str(s.rings),
    str(s.positions),
    str(s.plugboard),
    str("keep"),
  ]);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return decode((r.stack[r.stack.length - 1] as { v: Uint8Array }).v);
}

interface Options {
  offset: number;
  model: string;
  rotors: string;
  reflector: string;
  rings: string;
  check: string;
  limit: number;
}
const DEFAULTS: Options = {
  offset: 0,
  model: "I",
  rotors: "I II III",
  reflector: "B",
  rings: "AAA",
  check: "on",
  limit: 20,
};

async function call(ciphertext: string, crib: string, o: Partial<Options> = {}) {
  const x = { ...DEFAULTS, ...o };
  return runtime.call(
    "bombe:search",
    [
      bytes(encode(ciphertext)),
      str(crib),
      int(x.offset),
      str(x.model),
      str(x.rotors),
      str(x.reflector),
      str(x.rings),
      str(x.check),
      int(x.limit),
    ],
    { limits: { maxSteps: 200_000_000, maxMillis: 120_000 } },
  );
}

async function search(ciphertext: string, crib: string, o: Partial<Options> = {}) {
  const r = await call(ciphertext, crib, o);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const text = decode((r.stack[r.stack.length - 1] as { v: Uint8Array }).v);
  return { text, lines: text.split("\n"), steps: r.steps };
}

async function errorOf(ciphertext: string, crib: string, o: Partial<Options> = {}) {
  const r = await call(ciphertext, crib, o);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

interface Stop {
  rotors: string;
  positions: string;
  steckers: string[];
  contradiction: string;
  crib: string;
}
function stopsOf(lines: string[]): Stop[] {
  return lines
    .filter((l) => l.startsWith("rotors "))
    .map((l) => {
      const m =
        /^rotors (.+?) {2}positions (\w+) {2}steckers (.+?)(?: {2}contradiction at (\w+))? {2}crib (\w+)$/.exec(
          l,
        );
      if (m === null) throw new Error(`unreadable stop line: ${l}`);
      return {
        rotors: m[1] as string,
        positions: m[2] as string,
        steckers: m[3] === "none" ? [] : (m[3] as string).split(" "),
        contradiction: m[4] ?? "",
        crib: m[5] as string,
      };
    });
}
const footer = (lines: string[], key: string): string =>
  (lines.find((l) => l.startsWith(`# ${key}:`)) ?? "").slice(key.length + 4);

interface Case {
  ciphertext: string;
  crib: string;
  offset: number;
  settings: Settings;
}

/** A message from a random setting with a crib at an offset. */
async function makeCase(
  seed: number,
  over: Partial<Settings> = {},
  cribLength = 18,
): Promise<Case> {
  const r = rng(seed);
  const names = ["I", "II", "III", "IV", "V"];
  const order: string[] = [];
  while (order.length < 3) {
    const n = names[r() % 5] as string;
    if (!order.includes(n)) order.push(n);
  }
  const text = PLAIN[r() % PLAIN.length] as string;
  const settings: Settings = {
    model: "I",
    rotors: order.join(" "),
    reflector: "B",
    rings: "AAA",
    positions: Array.from({ length: 3 }, () => LETTERS[r() % 26]).join(""),
    plugboard: randomPlugboard(r, 6 + (r() % 5)),
    ...over,
  };
  const ciphertext = await enigma(text, settings);
  const offset = r() % 12;
  return { ciphertext, crib: text.slice(offset, offset + cribLength), offset, settings };
}

/** The pairs of a plugboard string as sorted "AB" strings. */
const pairsOf = (plugboard: string): string[] =>
  plugboard
    .split(" ")
    .filter((p) => p !== "")
    .map((p) => [...p].sort().join(""));

describe("bombe: finds the true setting", () => {
  // Seeds are fixed; each gives a crib whose menu has loops, so there are only a few stops.
  const seeds = [3, 4, 5, 7, 8, 9, 10, 12];
  test.each(seeds)(
    "random setting, seed %i",
    async (seed) => {
      const c = await makeCase(seed);
      const { text, lines } = await search(c.ciphertext, c.crib, {
        offset: c.offset,
        rotors: c.settings.rotors,
        limit: 100,
      });
      const closures = Number(/(\d+) closures/.exec(text)?.[1]);
      expect(closures, "the crib must give loops").toBeGreaterThanOrEqual(1);
      const stops = stopsOf(lines);
      const truth = stops.find((s) => s.positions === c.settings.positions);
      expect(
        truth,
        `true setting ${c.settings.positions} among ${stops.length} stops`,
      ).toBeDefined();
      expect(truth!.rotors).toBe(c.settings.rotors);
      expect(truth!.contradiction).toBe("");
      // The steckers deduced are part of the real plugboard.
      const real = pairsOf(c.settings.plugboard);
      for (const pair of truth!.steckers) expect(real, pair).toContain(pair);
      // The preview shows the crib wherever the stop decided it (lower case elsewhere).
      for (let i = 0; i < c.crib.length; i++) {
        const ch = truth!.crib[i] as string;
        if (ch === ch.toUpperCase()) expect(ch).toBe(c.crib[i]);
      }
      expect(truth!.crib.length).toBe(c.crib.length);
    },
    60_000,
  );

  test("with other ring settings (the stops are window letters)", async () => {
    const c = await makeCase(21, { rings: "BUL" });
    const { lines } = await search(c.ciphertext, c.crib, {
      offset: c.offset,
      rotors: c.settings.rotors,
      rings: "BUL",
      limit: 100,
    });
    expect(stopsOf(lines).some((s) => s.positions === c.settings.positions)).toBe(true);
  }, 60_000);

  test("M3 rotors VI to VIII with reflector C", async () => {
    const c = await makeCase(31, {
      model: "M3",
      rotors: "VIII VI VII",
      reflector: "C",
      rings: "CDE",
    });
    const { lines } = await search(c.ciphertext, c.crib, {
      offset: c.offset,
      model: "M3",
      rotors: "VIII VI VII",
      reflector: "C",
      rings: "CDE",
      limit: 100,
    });
    expect(stopsOf(lines).some((s) => s.positions === c.settings.positions)).toBe(true);
  }, 60_000);

  test("a crib at a large offset, with the middle rotor stepping inside the crib", async () => {
    // Right rotor III turns the middle rotor over at V: start at T so that it happens within the crib.
    const settings: Settings = {
      model: "I",
      rotors: "II I III",
      reflector: "B",
      rings: "AAA",
      positions: "ABT",
      plugboard: "AB CD EF GH IJ",
    };
    const text = PLAIN[3] as string;
    const ciphertext = await enigma(text, settings);
    const offset = 6;
    const crib = text.slice(offset, offset + 20);
    const { lines } = await search(ciphertext, crib, { offset, rotors: "II I III", limit: 100 });
    expect(stopsOf(lines).some((s) => s.positions === "ABT")).toBe(true);
  }, 60_000);

  test("the output is deterministic", async () => {
    const c = await makeCase(4);
    const o = { offset: c.offset, rotors: c.settings.rotors, limit: 50 };
    const a = await search(c.ciphertext, c.crib, o);
    const b = await search(c.ciphertext, c.crib, o);
    expect(b.text).toBe(a.text);
  }, 60_000);
});

describe("bombe: several rotor orders", () => {
  test("a set of five rotors is searched in all 60 orders, inside the bake budget", async () => {
    const c = await makeCase(4);
    const t0 = Date.now();
    const { text, lines, steps } = await search(c.ciphertext, c.crib, {
      offset: c.offset,
      rotors: "I II III IV V",
      limit: 100,
    });
    const ms = Date.now() - t0;
    expect(footer(lines, "rotor orders")).toBe("60");
    const stops = stopsOf(lines);
    expect(
      stops.some((s) => s.rotors === c.settings.rotors && s.positions === c.settings.positions),
    ).toBe(true);
    // Stops come in the order of the orders: each order is listed once, in a fixed sequence.
    expect(text).toContain("# bombe: crib ");
    // The untrusted bake budget is 5,000,000 steps and 10 seconds (packages/worker/src/types.ts).
    expect(steps).toBeLessThan(5_000_000);
    expect(ms).toBeLessThan(30_000);
  }, 60_000);

  test("three rotors are one order; four are twenty-four", async () => {
    const c = await makeCase(4);
    const one = await search(c.ciphertext, c.crib, { offset: c.offset, rotors: c.settings.rotors });
    expect(footer(one.lines, "rotor orders")).toBe("1");
    const names = c.settings.rotors.split(" ");
    const other = ["I", "II", "III", "IV", "V"].find((n) => !names.includes(n)) as string;
    const four = await search(c.ciphertext, c.crib, {
      offset: c.offset,
      rotors: `${c.settings.rotors} ${other}`,
      limit: 100,
    });
    expect(footer(four.lines, "rotor orders")).toBe("24");
    expect(stopsOf(four.lines).some((s) => s.positions === c.settings.positions)).toBe(true);
  }, 60_000);
});

describe("bombe: the menu", () => {
  // The menu depends only on the crib and the ciphertext under it, so a made-up ciphertext is fine.
  const menuLine = async (ciphertext: string, crib: string): Promise<string> => {
    const { lines } = await search(ciphertext, crib, { limit: 1 });
    return lines[1] as string;
  };

  test("a chain has no closure; its test letter is the first of the most connected", async () => {
    // A-B, B-C, C-D: B and C have two edges each.
    expect(await menuLine("BCD", "ABC")).toBe(
      "# menu: 3 edges between 4 letters, 0 closures, test letter B",
    );
  });

  test("a loop is a closure", async () => {
    // A-B, B-C, C-A, D-B: four letters, four edges.
    expect(await menuLine("BCAB", "ABCD")).toBe(
      "# menu: 4 edges between 4 letters, 1 closures, test letter B",
    );
  });

  test("the component with the most edges is used", async () => {
    // A-B and B-A (a pair of edges), then X-Y: the pair has two edges against one.
    expect(await menuLine("BAY", "ABX")).toBe(
      "# menu: 2 edges between 2 letters, 1 closures, test letter A",
    );
  });

  test("only letters count, in the crib and in the ciphertext", async () => {
    expect(await menuLine("b-c d", "a b-c")).toBe(
      "# menu: 3 edges between 4 letters, 0 closures, test letter B",
    );
  });

  test("a crib letter equal to the ciphertext letter under it is E_RANGE", async () => {
    const e = await errorOf("BCAB", "ABAD");
    expect(e.code).toBe("E_RANGE");
    expect(e.message).toContain("crib letter 3 (A)");
    expect(e.message).toContain("never produces");
  });

  test("the offset shifts the ciphertext under the crib", async () => {
    // Offset 1: the crib AB lies over the letters C and A of XCAB ...
    const { lines } = await search("XCAB", "AB", { offset: 1, limit: 1 });
    expect(lines[1]).toBe("# menu: 2 edges between 3 letters, 0 closures, test letter A");
    // ... and over the letters A and C of XACB the first crib letter meets itself.
    expect((await errorOf("XACB", "AB", { offset: 1 })).code).toBe("E_RANGE");
  });
});

describe("bombe: output and the check step", () => {
  test("the header, the footer and one line per stop", async () => {
    const c = await makeCase(4);
    const { lines } = await search(c.ciphertext, c.crib, {
      offset: c.offset,
      rotors: c.settings.rotors,
    });
    expect(lines[0]).toBe(
      `# bombe: crib ${c.crib} at offset ${c.offset}, model I, reflector B, rings AAA, check on`,
    );
    expect(lines[1]).toMatch(
      /^# menu: \d+ edges between \d+ letters, \d+ closures, test letter [A-Z]$/,
    );
    const stops = stopsOf(lines);
    expect(footer(lines, "stops")).toBe(String(stops.length));
    expect(footer(lines, "rotor orders")).toBe("1");
  }, 60_000);

  test("no stops is said so", async () => {
    // Rotors that are not the true ones: the true setting is not found, and a crib with loops
    // almost never fits by chance.
    const c = await makeCase(4);
    const wrong = ["I", "II", "III", "IV", "V"].filter(
      (n) => !c.settings.rotors.split(" ").includes(n),
    );
    const { lines } = await search(c.ciphertext, c.crib, {
      offset: c.offset,
      rotors: `${wrong.join(" ")} ${c.settings.rotors.split(" ")[0]}`,
      limit: 100,
    });
    const stops = stopsOf(lines);
    expect(footer(lines, "stops")).toBe(String(stops.length));
    expect(lines.some((l) => l.startsWith("# no stops"))).toBe(stops.length === 0);
    expect(
      stops.every((s) => s.positions !== c.settings.positions || s.rotors !== c.settings.rotors),
    ).toBe(true);
  }, 60_000);

  test("the limit stops the list and says so", async () => {
    // A crib with no loop: nearly every position is a stop.
    const text = PLAIN[0] as string;
    const ciphertext = await enigma(text, {
      model: "I",
      rotors: "I II III",
      reflector: "B",
      rings: "AAA",
      positions: "AAA",
      plugboard: "AB CD",
    });
    const { lines } = await search(ciphertext, text.slice(0, 5), { limit: 3 });
    expect(stopsOf(lines).length).toBe(3);
    expect(lines.some((l) => l.startsWith("# limit reached"))).toBe(true);
  }, 60_000);

  test("check off lists the stops that have a contradiction; check on drops them", async () => {
    // Look through a few settings for a short crib that gives a stop with a contradiction (a letter
    // outside the menu claimed by two menu letters); the check step must remove exactly those.
    let seen = false;
    for (let seed = 41; seed < 80 && !seen; seed++) {
      const c = await makeCase(seed, {}, 14);
      const o = { offset: c.offset, rotors: c.settings.rotors, limit: 60 };
      const off = await search(c.ciphertext, c.crib, { ...o, check: "off" });
      if (off.text.includes("# limit reached")) continue;
      const on = await search(c.ciphertext, c.crib, { ...o, check: "on" });
      const all = stopsOf(off.lines);
      const bad = all.filter((s) => s.contradiction !== "");
      expect(stopsOf(on.lines).map((s) => s.positions)).toEqual(
        all.filter((s) => s.contradiction === "").map((s) => s.positions),
      );
      if (bad.length > 0) {
        seen = true;
        expect(all.length).toBeGreaterThan(stopsOf(on.lines).length);
        expect(stopsOf(on.lines).some((s) => s.positions === c.settings.positions)).toBe(true);
      }
    }
    expect(seen).toBe(true);
  }, 120_000);
});

describe("bombe: parameter errors", () => {
  const ct = "BCAB";
  test.each([
    ["no letters in the crib", () => errorOf(ct, "123")],
    ["a crib that runs past the ciphertext", () => errorOf(ct, "ABCDE")],
    ["an offset that runs past the ciphertext", () => errorOf(ct, "AB", { offset: 3 })],
    ["an unknown rotor", () => errorOf(ct, "AB", { rotors: "I II IX" })],
    ["rotor VI on the Enigma I", () => errorOf(ct, "AB", { rotors: "I II VI" })],
    ["only two rotors", () => errorOf(ct, "AB", { rotors: "I II" })],
    ["a rotor twice", () => errorOf(ct, "AB", { rotors: "I II II" })],
    ["a rotor twice in a set", () => errorOf(ct, "AB", { rotors: "I II III III" })],
    ["reflector A on the M3", () => errorOf(ct, "AB", { model: "M3", reflector: "A" })],
    ["a bad ring setting", () => errorOf(ct, "AB", { rings: "AA" })],
    [
      "more than 60 rotor orders",
      () => errorOf(ct, "AB", { rotors: "I II III IV V VI", model: "M3" }),
    ],
    ["a negative offset", () => errorOf(ct, "AB", { offset: -1 })],
    ["a limit of 0", () => errorOf(ct, "AB", { limit: 0 })],
  ])("%s", async (_name, run) => {
    const e = await run();
    expect(["E_RANGE", "E_PARAM_INVALID"]).toContain(e.code);
  });

  test("the message names the problem", async () => {
    expect((await errorOf(ct, "AB", { rotors: "I II VI" })).message).toContain(
      "rotors: VI is not available",
    );
    expect((await errorOf(ct, "AB", { rotors: "I II" })).message).toContain("give three rotors");
    expect((await errorOf(ct, "AB", { rotors: "I II II" })).message).toContain("only once");
    expect((await errorOf(ct, "AB", { model: "M3", reflector: "A" })).message).toContain(
      "does not fit model M3",
    );
    expect((await errorOf(ct, "ABCDE")).message).toContain("past the end of the ciphertext");
    expect(
      (await errorOf(ct, "AB", { rotors: "I II III IV V VI", model: "M3" })).message,
    ).toContain("at most 60 rotor orders");
  });

  test("rotor orders times menu edges is bounded", async () => {
    const c = await makeCase(4, {}, 40);
    const e = await errorOf(c.ciphertext, c.crib, { offset: c.offset, rotors: "I II III IV V" });
    expect(e.code).toBe("E_RANGE");
    expect(e.message).toContain("over the limit of 1200");
  });
});
