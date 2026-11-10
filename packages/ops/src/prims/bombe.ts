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
 * bombe primitive. Only `_search`, the loop over the 17,576 start positions of one rotor order, is a
 * primitive. Per position it makes the Enigma permutation of every menu edge and merges up to 26
 * wire pairs per edge in a union-find; over 17,576 positions that is tens of millions of simple
 * operations per rotor order, where one FL VM step costs far more than a native one (the measured
 * numbers are in the report of WP 5.11). Everything else stays in FL (vocab/bombe.fth): reading and
 * checking the parameters, the menu, the rotor tables, the output and the check step.
 *
 * Model (it is the model of vocab/enigma.fth, which the check step runs again independently). A
 * rotor is stepped by its row offset s*26 (s is the shift: window letter minus ring setting). A key
 * press first steps the machine (when the middle rotor is at its notch the middle and left rotors
 * step; else when the right rotor is at its notch the middle rotor steps; the right rotor always
 * steps), then the signal goes right rotor, middle rotor, the "left rotor, reflector, left rotor"
 * table, middle rotor back and right rotor back. The plugboard is not part of this permutation E:
 * it is the unknown the search is for.
 *
 * Diagonal board. A menu edge (j, p, c) says: the letter p was enciphered as c by the machine in its
 * state after offset + j + 1 key presses, so with Pl the plugboard, Pl(c) = E_j(Pl(p)). A wire
 * (u, a) means Pl(u) = a. The edge joins (p, a) and (c, E_j(a)) for every a, and the diagonal board
 * joins (u, a) and (a, u) because the plugboard is symmetric. Wires are merged in a union-find over
 * the 351 unordered pairs {u, a} (the diagonal board is built in). For the test letter T, a start
 * position is a stop for the hypothesis h (Pl(T) = h) when the wires reached from (T, h) light
 * exactly one wire of T's bundle (the "test register"); a wrong hypothesis floods the bundle.
 *
 * A stop is 30 bytes: the three start shifts (left, middle, right rotor: window letter minus ring
 * setting), the hypothesis h, and for each letter its stecker partner (the letter itself when it is
 * not plugged), NONE (255) when no wire of the letter is lit, or CONFLICT (254) when two or more are
 * (a contradiction, found by the diagonal board away from the test register). With `clean` the
 * stops that have a contradiction are not returned (and do not count against `limit`).
 *
 * Speed. The edges on a cycle of the menu are merged first and the pendant ones last, and a start
 * position is dropped as soon as no wire of the test register can still be a stop (every wire is
 * joined to another); only cycles do that, so most positions stop after the cycle edges.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

const STATES = 17576;
const TABLE = 676;
/** Bytes of one stop: the three start shifts (left, middle, right), the hypothesis, 26 partners. */
export const STOP_BYTES = 30;
/** In a partner entry: no wire of this letter is lit. */
export const NONE = 255;
/** In a partner entry: two or more wires of this letter are lit, a contradiction. */
export const CONFLICT = 254;

const CLASS_COUNT = 351;
/** Index of the unordered pair {u, a} among the 351 pairs, for the 676 ordered pairs. */
const CLASS_OF = new Uint16Array(676);
const CLASS_A = new Uint8Array(CLASS_COUNT);
const CLASS_B = new Uint8Array(CLASS_COUNT);
{
  let k = 0;
  for (let u = 0; u < 26; u++)
    for (let a = u; a < 26; a++) {
      CLASS_OF[u * 26 + a] = k;
      CLASS_OF[a * 26 + u] = k;
      CLASS_A[k] = u;
      CLASS_B[k] = a;
      k++;
    }
}
const IDENTITY = Uint16Array.from({ length: CLASS_COUNT }, (_, i) => i);

function search(
  tabs: Uint8Array,
  flags: Uint8Array,
  menu: Uint8Array,
  offset: number,
  test: number,
  limit: number,
  clean: boolean,
): Uint8Array {
  if (tabs.length !== 5 * TABLE) throw rangeFailure("bombe: the rotor tables have the wrong size");
  if (flags.length !== 2 * TABLE) throw rangeFailure("bombe: the notch tables have the wrong size");
  if (menu.length % 3 !== 0 || menu.length === 0)
    throw rangeFailure("bombe: the menu is empty or not a list of (step, plain, cipher)");
  for (const v of tabs) if (v > 25) throw rangeFailure("bombe: a rotor table value is over 25");
  for (const f of flags) if (f > 1) throw rangeFailure("bombe: a notch flag is not 0 or 1");
  if (!Number.isInteger(offset) || offset < 0) throw rangeFailure("bombe: the offset is negative");
  if (!Number.isInteger(test) || test < 0 || test > 25)
    throw rangeFailure("bombe: the test letter is not a letter");
  if (!Number.isInteger(limit) || limit < 1) throw rangeFailure("bombe: the limit is below 1");

  const fr = tabs.subarray(0, TABLE);
  const fm = tabs.subarray(TABLE, 2 * TABLE);
  const cl = tabs.subarray(2 * TABLE, 3 * TABLE);
  const im = tabs.subarray(3 * TABLE, 4 * TABLE);
  const ir = tabs.subarray(4 * TABLE, 5 * TABLE);
  const nr = flags.subarray(0, TABLE);
  const nm = flags.subarray(TABLE, 2 * TABLE);

  // The menu: edges (step j, plain, cipher). The edges on a cycle of the menu come first and the
  // pendant ones (a letter that only one edge reaches, repeatedly) last: only cycles can rule out
  // every hypothesis, so most positions are rejected before the pendant edges are merged.
  const count = menu.length / 3;
  let steps = 0;
  const seenStep = new Uint8Array(256);
  const degree = new Uint8Array(26);
  for (let i = 0; i < menu.length; i += 3) {
    const j = menu[i] as number;
    if ((menu[i + 1] as number) > 25 || (menu[i + 2] as number) > 25)
      throw rangeFailure("bombe: a menu letter is not a letter");
    if (seenStep[j] === 1) throw rangeFailure("bombe: two menu edges at one crib step");
    seenStep[j] = 1;
    steps = Math.max(steps, j + 1);
    degree[menu[i + 1] as number] = (degree[menu[i + 1] as number] as number) + 1;
    degree[menu[i + 2] as number] = (degree[menu[i + 2] as number] as number) + 1;
  }
  const pendant = new Uint8Array(count);
  for (let again = true; again;) {
    again = false;
    for (let e = 0; e < count; e++) {
      const p = menu[e * 3 + 1] as number;
      const c = menu[e * 3 + 2] as number;
      if (pendant[e] === 1 || ((degree[p] as number) !== 1 && (degree[c] as number) !== 1))
        continue;
      pendant[e] = 1;
      degree[p] = (degree[p] as number) - 1;
      degree[c] = (degree[c] as number) - 1;
      again = true;
    }
  }
  const order: number[] = [];
  for (let e = 0; e < count; e++) if (pendant[e] === 0) order.push(e);
  for (let e = 0; e < count; e++) if (pendant[e] === 1) order.push(e);
  const edgeStep = Uint8Array.from(order, (e) => menu[e * 3] as number);
  const edgePlain = Uint16Array.from(order, (e) => (menu[e * 3 + 1] as number) * 26);
  const edgeCipher = Uint16Array.from(order, (e) => (menu[e * 3 + 2] as number) * 26);

  // State = left * 676 + middle * 26 + right (the three shifts). next = one key press.
  const next = new Uint16Array(STATES);
  for (let s = 0; s < STATES; s++) {
    let r = s % 26;
    let m = Math.floor(s / 26) % 26;
    let l = Math.floor(s / TABLE);
    if (nm[m * 26] === 1) {
      l = (l + 1) % 26;
      m = (m + 1) % 26;
    } else if (nr[r * 26] === 1) {
      m = (m + 1) % 26;
    }
    r = (r + 1) % 26;
    next[s] = l * TABLE + m * 26 + r;
  }
  // The machine's permutation E for every state: perm[state * 26 + x].
  const perm = new Uint8Array(STATES * 26);
  for (let s = 0; s < STATES; s++) {
    const b1 = (s % 26) * 26;
    const b2 = (Math.floor(s / 26) % 26) * 26;
    const b3 = Math.floor(s / TABLE) * 26;
    for (let x = 0; x < 26; x++) {
      let v = fr[b1 + x] as number;
      v = fm[b2 + v] as number;
      v = cl[b3 + v] as number;
      v = im[b2 + v] as number;
      perm[s * 26 + x] = ir[b1 + v] as number;
    }
  }
  // advance = next applied `offset` times (by repeated squaring).
  let advance = Uint16Array.from({ length: STATES }, (_, i) => i);
  let power = next;
  for (let e = offset; e > 0; e = Math.floor(e / 2)) {
    const p = power;
    if (e % 2 === 1) advance = advance.map((s) => p[s] as number);
    power = p.map((s) => p[s] as number);
  }

  const parent = new Uint16Array(CLASS_COUNT);
  const find = (x: number): number => {
    let v = x;
    while (parent[v] !== v) {
      parent[v] = parent[parent[v] as number] as number;
      v = parent[v] as number;
    }
    return v;
  };
  // lit[root] is how many wires of the test register the wires of that root reach; single is how many
  // roots reach exactly one: when it is 0, every hypothesis for the test letter has failed.
  const lit0 = new Uint8Array(CLASS_COUNT);
  for (let a = 0; a < 26; a++) lit0[CLASS_OF[test * 26 + a] as number] = 1;
  const lit = new Uint8Array(CLASS_COUNT);
  const stateAt = new Uint16Array(steps);
  const stops: number[] = [];

  for (let start = 0; start < STATES; start++) {
    let state = advance[start] as number;
    for (let j = 0; j < steps; j++) {
      state = next[state] as number;
      stateAt[j] = state;
    }
    parent.set(IDENTITY);
    lit.set(lit0);
    let single = 26;
    for (let e = 0; e < count && single > 0; e++) {
      const pb = edgePlain[e] as number;
      const cb = edgeCipher[e] as number;
      const eb = (stateAt[edgeStep[e] as number] as number) * 26;
      for (let a = 0; a < 26; a++) {
        const x = find(CLASS_OF[pb + a] as number);
        const y = find(CLASS_OF[cb + (perm[eb + a] as number)] as number);
        if (x === y) continue;
        parent[x] = y;
        const lx = lit[x] as number;
        const ly = lit[y] as number;
        if (lx === 1) single--;
        if (ly === 1) single--;
        lit[y] = lx + ly;
        if (lx + ly === 1) single++;
      }
    }
    if (single === 0) continue;
    for (let h = 0; h < 26; h++) {
      const root = find(CLASS_OF[test * 26 + h] as number);
      if (lit[root] !== 1) continue;
      const wires = new Uint8Array(26);
      const partner = new Uint8Array(26).fill(NONE);
      for (let k = 0; k < CLASS_COUNT; k++) {
        if (find(k) !== root) continue;
        const u = CLASS_A[k] as number;
        const a = CLASS_B[k] as number;
        wires[u] = (wires[u] as number) + 1;
        partner[u] = a;
        if (u !== a) {
          wires[a] = (wires[a] as number) + 1;
          partner[a] = u;
        }
      }
      let conflict = false;
      for (let u = 0; u < 26; u++)
        if ((wires[u] as number) > 1) {
          partner[u] = CONFLICT;
          conflict = true;
        }
      if (clean && conflict) continue;
      stops.push(Math.floor(start / TABLE), Math.floor(start / 26) % 26, start % 26, h, ...partner);
      if (stops.length >= limit * STOP_BYTES) return Uint8Array.from(stops);
    }
  }
  return Uint8Array.from(stops);
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "bombe",
    "_search",
    "( tabs:bytes flags:bytes menu:bytes offset:int test:int limit:int clean:bool -- bytes )",
    search,
    {
      doc: "Run the Bombe test over all 17,576 start positions of one rotor order and return the stops, 30 bytes each (private helper of bombe:search).",
      category: "Cipher machines",
    },
  ),
];
