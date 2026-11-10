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
import { primitives } from "./classical.js";

const ls47 = primitives.find((p) => p.name === "_ls47")!.fn as (
  text: Uint8Array,
  key: Uint8Array,
  dec: boolean,
) => Uint8Array;

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const asciiOf = (b: Uint8Array) => String.fromCharCode(...b);

// The board of the worked example in the README of github.com/exaexa/ls47, row by row, with the
// marker on e, which is the tile at (0, 0).
const README_BOARD =
  "ef_abcd" + "lmghijk" + "()/:?!'" + "stnopqr" + "z.uvwxy" + "5601234" + "+*789,-";
const STANDARD = "_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'()";

describe("classical._ls47", () => {
  test("the first step of the README example turns y into w", () => {
    expect(asciiOf(ls47(ascii("y"), ascii(README_BOARD), false))).toBe("w");
    expect(asciiOf(ls47(ascii("w"), ascii(README_BOARD), true))).toBe("y");
  });

  test("decrypting undoes encrypting on any board", () => {
    const board = ascii([...STANDARD].reverse().join(""));
    const msg = ascii("the_quick_brown_fox.jumps-over+the*lazy/dog:0123456789?!'()");
    const enc = ls47(msg, board, false);
    expect(asciiOf(enc)).not.toBe(asciiOf(msg));
    expect(asciiOf(ls47(enc, board, true))).toBe(asciiOf(msg));
  });

  test("a board that is not 49 distinct LS47 letters is E_COERCE", () => {
    expect(() => ls47(ascii("a"), ascii("abc"), false)).toThrow(/49 tiles/);
    expect(() => ls47(ascii("a"), ascii("a".repeat(49)), false)).toThrow(/each LS47 letter once/);
    expect(() => ls47(ascii("a"), ascii("A" + STANDARD.slice(1)), false)).toThrow(
      /each LS47 letter once/,
    );
  });

  test("a letter outside the alphabet is E_COERCE", () => {
    expect(() => ls47(ascii("A"), ascii(STANDARD), false)).toThrow(/not in the LS47 alphabet/);
  });
});
