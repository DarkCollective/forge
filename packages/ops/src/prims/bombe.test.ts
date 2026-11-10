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

import { describe, expect, test } from "vitest";
import { primitives } from "./bombe.js";

type Raw = (
  tabs: Uint8Array,
  flags: Uint8Array,
  menu: Uint8Array,
  offset: number,
  test: number,
  limit: number,
  clean: boolean,
) => Uint8Array;
const raw = primitives.find((p) => p.name === "_search")!.fn as Raw;
const search = (
  tabs: Uint8Array,
  flags: Uint8Array,
  menu: Uint8Array,
  offset: number,
  test: number,
  limit: number,
  clean = false,
): Uint8Array => raw(tabs, flags, menu, offset, test, limit, clean);

// ---- a small Enigma written here in window letters (not in the primitive's shift tables) ----

const letters = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0) - 65);
const WIRING = [
  letters("EKMFLGDQVZNTOWYHXUSPAIBRCJ"), // I
  letters("AJDKSIRUXBLHWTMCQGZNPYFVOE"), // II
  letters("BDFHJLCPRTXVZNYEIWGAKMUSQO"), // III
];
const TURNOVER = [16, 4, 21]; // Q, E, V
const REFLECTOR = letters("YRUHQSLDPXNGOKMIEBFZCWVJAT"); // B
const mod = (n: number): number => ((n % 26) + 26) % 26;
const invert = (w: number[]): number[] => {
  const r = new Array<number>(26).fill(0);
  w.forEach((v, i) => (r[v] = i));
  return r;
};
const INVERSE = WIRING.map(invert);

/** Rotors left, middle, right (indices into WIRING) and the three window letters (ring AAA). */
class Machine {
  readonly pos: number[];
  constructor(
    readonly rotors: number[],
    start: number[],
  ) {
    this.pos = start.slice();
  }
  step(): void {
    const [, m, r] = this.pos as [number, number, number];
    if (m === TURNOVER[this.rotors[1] as number]) {
      this.pos[0] = mod((this.pos[0] as number) + 1);
      this.pos[1] = mod(m + 1);
    } else if (r === TURNOVER[this.rotors[2] as number]) {
      this.pos[1] = mod(m + 1);
    }
    this.pos[2] = mod(r + 1);
  }
  /** The machine without plugboard, after stepping: an involution. */
  permutation(): number[] {
    const through = (i: number, x: number, forward: boolean): number => {
      const w = WIRING[this.rotors[i] as number] as number[];
      const p = this.pos[i] as number;
      return mod((forward ? w : (INVERSE[this.rotors[i] as number] as number[]))[mod(x + p)]! - p);
    };
    return Array.from({ length: 26 }, (_, x) => {
      let v = x;
      for (const i of [2, 1, 0]) v = through(i, v, true);
      v = REFLECTOR[v] as number;
      for (const i of [0, 1, 2]) v = through(i, v, false);
      return v;
    });
  }
}

function encipher(text: number[], rotors: number[], start: number[], plug: number[]): number[] {
  const m = new Machine(rotors, start);
  return text.map((x) => {
    m.step();
    const e = m.permutation();
    return plug[e[plug[x] as number] as number] as number;
  });
}

// ---- the tables the primitive takes (same layout as vocab/util.fth builds) ----

function shiftTable(w: number[]): number[] {
  return Array.from({ length: 676 }, (_, i) =>
    mod(w[mod((i % 26) + Math.floor(i / 26))]! - Math.floor(i / 26)),
  );
}
function tables(rotors: number[]): { tabs: Uint8Array; flags: Uint8Array } {
  const wire = (k: number) => WIRING[rotors[k] as number] as number[];
  const fwd = (k: number) => shiftTable(wire(k));
  const inv = (k: number) => shiftTable(invert(wire(k)));
  const left = fwd(0);
  const leftInv = inv(0);
  const reflect = Array.from({ length: 676 }, (_, i) => {
    const base = i - (i % 26);
    return leftInv[base + (REFLECTOR[left[i] as number] as number)] as number;
  });
  const notch = (k: number) =>
    Array.from({ length: 676 }, (_, i) =>
      i % 26 === 0 && Math.floor(i / 26) === TURNOVER[rotors[k] as number] ? 1 : 0,
    );
  return {
    tabs: Uint8Array.from([...fwd(2), ...fwd(1), ...reflect, ...inv(1), ...inv(2)]),
    flags: Uint8Array.from([...notch(2), ...notch(1)]),
  };
}

interface Stop {
  start: string;
  h: number;
  partner: number[];
}
function parse(out: Uint8Array): Stop[] {
  const stops: Stop[] = [];
  for (let i = 0; i < out.length; i += 30) {
    stops.push({
      start: String.fromCharCode(65 + out[i]!, 65 + out[i + 1]!, 65 + out[i + 2]!),
      h: out[i + 3]!,
      partner: Array.from(out.subarray(i + 4, i + 30)),
    });
  }
  return stops;
}

/** The menu bytes (step, plain, cipher) for a crib at an offset. */
function menuOf(plain: number[], cipher: number[]): Uint8Array {
  return Uint8Array.from(plain.flatMap((p, j) => [j, p, cipher[j] as number]));
}

/** A deterministic pseudo-random generator (xorshift32). */
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

function randomPlug(r: () => number, pairs: number): number[] {
  const plug = Array.from({ length: 26 }, (_, i) => i);
  const order = plug.slice();
  for (let i = 25; i > 0; i--) {
    const j = r() % (i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  for (let k = 0; k < pairs; k++) {
    const a = order[2 * k] as number;
    const b = order[2 * k + 1] as number;
    plug[a] = b;
    plug[b] = a;
  }
  return plug;
}

const PLAIN = letters(
  "WETTERVORHERSAGEBISKAYAHEUTEKEINBESONDERESEREIGNISXKEINEMELDUNGENVOMFEINDXOBERKOMMANDODERWEHRMACHT",
);

/** The most-connected letter of the menu, as the vocabulary picks the test letter. */
function testLetter(plain: number[], cipher: number[]): number {
  const degree = new Array<number>(26).fill(0);
  plain.forEach((p, j) => {
    degree[p] = (degree[p] as number) + 1;
    degree[cipher[j] as number] = (degree[cipher[j] as number] as number) + 1;
  });
  return degree.indexOf(Math.max(...degree));
}

/** The Bombe test written out with an explicit wire graph and a flood fill (slow, simple). */
function reference(
  rotors: number[],
  plain: number[],
  cipher: number[],
  offset: number,
  test: number,
  lefts: number[],
): Map<string, Stop> {
  const result = new Map<string, Stop>();
  for (const l of lefts)
    for (let mi = 0; mi < 26; mi++)
      for (let r = 0; r < 26; r++) {
        const m = new Machine(rotors, [l, mi, r]);
        for (let i = 0; i < offset; i++) m.step();
        const edges = plain.map((p, j) => {
          m.step();
          return { p, c: cipher[j] as number, e: m.permutation() };
        });
        const link = new Map<number, number[]>();
        const add = (a: number, b: number) => {
          link.set(a, [...(link.get(a) ?? []), b]);
          link.set(b, [...(link.get(b) ?? []), a]);
        };
        for (const { p, c, e } of edges)
          for (let a = 0; a < 26; a++) add(p * 26 + a, c * 26 + (e[a] as number));
        for (let u = 0; u < 26; u++) for (let a = 0; a < 26; a++) add(u * 26 + a, a * 26 + u);
        for (let h = 0; h < 26; h++) {
          const lit = new Set<number>([test * 26 + h]);
          const todo = [test * 26 + h];
          for (let n = todo.pop(); n !== undefined; n = todo.pop())
            for (const v of link.get(n) ?? []) {
              if (lit.has(v)) continue;
              lit.add(v);
              todo.push(v);
            }
          if ([...lit].filter((n) => Math.floor(n / 26) === test).length !== 1) continue;
          const wires = new Map<number, number[]>();
          for (const n of lit)
            wires.set(Math.floor(n / 26), [...(wires.get(Math.floor(n / 26)) ?? []), n % 26]);
          const partner = Array.from({ length: 26 }, (_, u) => {
            const w = wires.get(u);
            return w === undefined ? 255 : w.length === 1 ? (w[0] as number) : 254;
          });
          const start = String.fromCharCode(65 + l, 65 + mi, 65 + r);
          result.set(`${start}${h}`, { start, h, partner });
        }
      }
  return result;
}

describe("bombe._search", () => {
  test("finds the true start position and the true steckers (random settings)", () => {
    const r = rng(20260101);
    for (let k = 0; k < 6; k++) {
      const rotors = [r() % 3, 0, 0];
      rotors[1] = (rotors[0]! + 1 + (r() % 2)) % 3;
      rotors[2] = 3 - rotors[0]! - rotors[1]!;
      const start = [r() % 26, r() % 26, r() % 26];
      const plug = randomPlug(r, 6 + (r() % 5));
      const offset = r() % 40;
      const text = PLAIN.slice(0, 80);
      const cipher = encipher(text, rotors, start, plug);
      const crib = 16 + (r() % 6);
      const plain = text.slice(offset, offset + crib);
      const c = cipher.slice(offset, offset + crib);
      const t = testLetter(plain, c);
      const { tabs, flags } = tables(rotors);
      const stops = parse(search(tabs, flags, menuOf(plain, c), offset, t, 100));
      const truth = String.fromCharCode(65 + start[0]!, 65 + start[1]!, 65 + start[2]!);
      const hit = stops.find((s) => s.start === truth);
      expect(hit, `case ${k}`).toBeDefined();
      expect(hit!.h).toBe(plug[t]);
      for (let u = 0; u < 26; u++) {
        const p = hit!.partner[u] as number;
        if (p < 26) expect(p, `case ${k} letter ${u}`).toBe(plug[u]);
      }
    }
  });

  test("agrees with an explicit wire-graph flood fill (positions of two left-rotor letters)", () => {
    const r = rng(7);
    const rotors = [2, 0, 1];
    const start = [r() % 26, r() % 26, r() % 26];
    const plug = randomPlug(r, 8);
    const offset = 11;
    const text = PLAIN.slice(0, 60);
    const cipher = encipher(text, rotors, start, plug);
    const plain = text.slice(offset, offset + 14);
    const c = cipher.slice(offset, offset + 14);
    const t = testLetter(plain, c);
    const { tabs, flags } = tables(rotors);
    // The flood fill is slow, so it checks the positions of two left-rotor letters (one is the true one).
    const lefts = [start[0] as number, ((start[0] as number) + 7) % 26];
    const all = parse(search(tabs, flags, menuOf(plain, c), offset, t, 100));
    expect(all.length).toBeLessThan(100);
    const got = all.filter((s) => lefts.includes(s.start.charCodeAt(0) - 65));
    const want = [...reference(rotors, plain, c, offset, t, lefts).values()];
    expect(got.length).toBe(want.length);
    expect(got.length).toBeGreaterThan(0);
    for (const s of got) {
      const w = want.find((x) => x.start === s.start && x.h === s.h);
      expect(w, `${s.start} ${s.h}`).toBeDefined();
      expect(s.partner).toEqual(w!.partner);
    }
    // clean: only the stops without a contradiction, and they alone count against the limit.
    const clean = parse(search(tabs, flags, menuOf(plain, c), offset, t, 100, true));
    const wantClean = all.filter((s) => !s.partner.includes(254));
    expect(clean).toEqual(wantClean);
    expect(all.length).toBeGreaterThan(wantClean.length);
    expect(parse(search(tabs, flags, menuOf(plain, c), offset, t, 1, true))).toEqual(
      wantClean.slice(0, 1),
    );
  }, 60_000);

  test("the order of the menu edges does not change the stops", () => {
    const r = rng(99);
    const rotors = [0, 1, 2];
    const plug = randomPlug(r, 7);
    const text = PLAIN.slice(0, 50);
    const cipher = encipher(text, rotors, [3, 9, 20], plug);
    const plain = text.slice(5, 22);
    const c = cipher.slice(5, 22);
    const t = testLetter(plain, c);
    const { tabs, flags } = tables(rotors);
    const forward = menuOf(plain, c);
    const reversed = new Uint8Array(forward.length);
    for (let e = 0; e < forward.length / 3; e++)
      reversed.set(forward.subarray(e * 3, e * 3 + 3), forward.length - 3 - e * 3);
    const a = search(tabs, flags, forward, 5, t, 100);
    expect(a.length).toBeGreaterThan(0);
    expect([...search(tabs, flags, reversed, 5, t, 100)]).toEqual([...a]);
  });

  test("stops come in position order and the limit cuts the list", () => {
    // One edge only: no cycle, so every position is a stop (for every hypothesis that lights one wire).
    const { tabs, flags } = tables([0, 1, 2]);
    const menu = Uint8Array.of(0, 0, 1);
    const stops = parse(search(tabs, flags, menu, 0, 0, 5));
    expect(stops.length).toBe(5);
    expect(stops.map((s) => s.start)).toEqual([...stops.map((s) => s.start)].sort());
    expect(stops[0]!.start).toBe("AAA");
    expect(parse(search(tabs, flags, menu, 0, 0, 1)).length).toBe(1);
  });

  test("the offset moves the rotors the same way the machine does (double step included)", () => {
    // Start with the middle rotor II at its turnover E and the right rotor at A: the first press
    // double-steps. A stop for the true start proves that the primitive steps the same way.
    const rotors = [0, 1, 2];
    const plug = randomPlug(rng(5), 9);
    const text = PLAIN.slice(0, 70);
    const start = [4, 4, 0];
    const cipher = encipher(text, rotors, start, plug);
    const plain = text.slice(30, 48);
    const c = cipher.slice(30, 48);
    const t = testLetter(plain, c);
    const { tabs, flags } = tables(rotors);
    for (const offset of [0, 30]) {
      const p = offset === 0 ? text.slice(0, 18) : plain;
      const cc = offset === 0 ? cipher.slice(0, 18) : c;
      const stops = parse(search(tabs, flags, menuOf(p, cc), offset, testLetter(p, cc), 100));
      expect(
        stops.some((s) => s.start === "EEA"),
        `offset ${offset}`,
      ).toBe(true);
    }
    expect(t).toBeGreaterThanOrEqual(0);
  });

  test("bad arguments are E_RANGE", () => {
    const { tabs, flags } = tables([0, 1, 2]);
    const menu = Uint8Array.of(0, 0, 1);
    const bad = (f: () => unknown, message: RegExp) => expect(f).toThrow(message);
    bad(() => search(tabs.subarray(1), flags, menu, 0, 0, 1), /wrong size/);
    bad(() => search(tabs, flags.subarray(1), menu, 0, 0, 1), /wrong size/);
    bad(() => search(tabs, flags, new Uint8Array(0), 0, 0, 1), /menu/);
    bad(() => search(tabs, flags, Uint8Array.of(0, 0), 0, 0, 1), /menu/);
    bad(() => search(tabs, flags, Uint8Array.of(0, 26, 1), 0, 0, 1), /not a letter/);
    bad(() => search(tabs, flags, Uint8Array.of(0, 0, 1, 0, 2, 3), 0, 0, 1), /two menu edges/);
    bad(() => search(tabs, flags, menu, -1, 0, 1), /offset/);
    bad(() => search(tabs, flags, menu, 0, 26, 1), /test letter/);
    bad(() => search(tabs, flags, menu, 0, 0, 0), /limit/);
    const badTab = tabs.slice();
    badTab[3] = 26;
    bad(() => search(badTab, flags, menu, 0, 0, 1), /over 25/);
    const badFlag = flags.slice();
    badFlag[0] = 2;
    bad(() => search(tabs, badFlag, menu, 0, 0, 1), /notch flag/);
  });
});
