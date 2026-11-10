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
import { primitives } from "./sigaba.js";

type Run = (
  data: Uint8Array,
  cipher: Uint8Array,
  control: Uint8Array,
  state: Uint8Array,
  index: Uint8Array,
  decrypt: boolean,
) => Uint8Array;
const run = primitives.find((p) => p.name === "_run")!.fn as Run;

const identity26 = Uint8Array.from({ length: 26 }, (_, i) => i);
const shift1 = Uint8Array.from({ length: 26 }, (_, i) => (i + 1) % 26);
const wires = (w: Uint8Array) => Uint8Array.from({ length: 130 }, (_, i) => w[i % 26] as number);
const state = Uint8Array.from({ length: 20 }, (_, i) => (i < 10 ? 0 : 14));
const index = Uint8Array.from({ length: 10 }, (_, i) => i);

describe("sigaba._run", () => {
  test("five identity rotors leave the letters alone, five shift rotors add 5", () => {
    const data = Uint8Array.from([0, 1, 2, 25]);
    expect([...run(data, wires(identity26), wires(identity26), state, index, false)]).toEqual([
      0, 1, 2, 25,
    ]);
    expect([...run(data, wires(shift1), wires(identity26), state, index, false)]).toEqual([
      5, 6, 7, 4,
    ]);
    expect([
      ...run(Uint8Array.from([5, 6, 7, 4]), wires(shift1), wires(identity26), state, index, true),
    ]).toEqual([0, 1, 2, 25]);
  });

  test("bad tables are E_RANGE", () => {
    const d = Uint8Array.of(0);
    expect(() => run(d, new Uint8Array(129), wires(identity26), state, index, false)).toThrow(
      /wrong size/,
    );
    expect(() => run(d, wires(new Uint8Array(26)), wires(identity26), state, index, false)).toThrow(
      /permutation/,
    );
    expect(() =>
      run(d, wires(identity26), wires(identity26), state, new Uint8Array(10), false),
    ).toThrow(/permutation/);
    expect(() =>
      run(Uint8Array.of(26), wires(identity26), wires(identity26), state, index, false),
    ).toThrow(/over 25/);
    const badPos = state.slice();
    badPos[10] = 26;
    expect(() => run(d, wires(identity26), wires(identity26), badPos, index, false)).toThrow(
      /not a letter/,
    );
  });
});
