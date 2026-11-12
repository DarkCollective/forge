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
import { scanVocab } from "./scan.js";
import type { SourceFile } from "./types.js";

const file = (name: string, text: string): SourceFile => ({ name, text });
const unit = (vocab: string, body = "", extra = ""): SourceFile =>
  file(`${vocab}.fth`, `IN: ${vocab}\n${extra}\n${body}\n`);

describe("scanVocab: ordering", () => {
  test("a unit comes after the units it depends on (qualified reference)", () => {
    const r = scanVocab(
      [
        unit("a", ": f ( x:str -- str ) x b:g ;"),
        unit("b", ": g ( x:str -- str ) x c:h ;"),
        unit("c", ": h ( x:str -- str ) x ;"),
      ],
      [],
    );
    expect(r.units.map((u) => u.vocab)).toEqual(["c", "b", "a"]);
    expect(r.units.map((u) => u.deps)).toEqual([[], ["c"], ["b"]]);
  });

  test("USING: counts as a dependency, and may list core", () => {
    const r = scanVocab([unit("a", "", "USING: core b ;"), unit("b")], []);
    expect(r.units.map((u) => u.vocab)).toEqual(["b", "a"]);
    expect(r.units[1]?.deps).toEqual(["b"]);
  });

  test("an empty USING: is a no-op, and USING: stops at the semicolon", () => {
    const r = scanVocab([unit("a", ": f ( -- int ) 1 ;", "USING: ;")], []);
    expect(r.units[0]?.deps).toEqual([]);
  });

  test("ties are broken by vocabulary name in code point order", () => {
    const r = scanVocab([unit("zeta"), unit("Beta"), unit("alpha"), unit("b2")], []);
    expect(r.units.map((u) => u.vocab)).toEqual(["Beta", "alpha", "b2", "zeta"]);
  });

  test("the order does not depend on the order of the files", () => {
    const files = [unit("a", "", "USING: c ;"), unit("b"), unit("c", "", "USING: b ;")];
    const forward = scanVocab(files, []).units.map((u) => u.vocab);
    const backward = scanVocab([...files].reverse(), []).units.map((u) => u.vocab);
    expect(forward).toEqual(["b", "c", "a"]);
    expect(backward).toEqual(forward);
  });

  test("deps are sorted, unique, without core and without the unit's own vocabulary", () => {
    const r = scanVocab(
      [
        unit("a", ": f ( x:str -- str ) x z:q x m:q core:upper a:g ;"),
        unit("m", ": q ( x:str -- str ) x ;"),
        unit("z", ": q ( x:str -- str ) x ;"),
      ],
      [],
    );
    expect(r.units.find((u) => u.vocab === "a")?.deps).toEqual(["m", "z"]);
  });

  test("a dependency on a primitive-only vocabulary needs no ordering but must exist", () => {
    const r = scanVocab([unit("a", ": f ( x:bytes -- str ) x p:enc ;")], ["p"]);
    expect(r.units.map((u) => u.vocab)).toEqual(["a"]);
    expect(r.units[0]?.deps).toEqual(["p"]);
    expect(r.vocabs).toEqual(["a", "p"]);
  });

  test("vocabs lists units and primitive modules, sorted, once", () => {
    const r = scanVocab([unit("b"), unit("a")], ["c", "a"]);
    expect(r.vocabs).toEqual(["a", "b", "c"]);
  });

  test("a unit keeps its file name, source and vocabulary", () => {
    const f = unit("a", ": f ( -- int ) 1 ;");
    const [u] = scanVocab([f], []).units;
    expect(u).toEqual({ vocab: "a", name: "a.fth", source: f.text, deps: [] });
  });

  test("no files is an empty scan", () => {
    expect(scanVocab([], [])).toEqual({ units: [], vocabs: [] });
  });
});

describe("scanVocab: shared choice types in headers", () => {
  const user = (header: string) => file("a.fth", `IN: a\n: f ( x:bytes ${header} -- bytes ) x ;\n`);

  test("a unit that uses choice<util:padding> comes after util", () => {
    const r = scanVocab(
      [
        user("p:choice<util:padding>=pkcs7"),
        unit("util", "CHOICE: padding\n  option pkcs7 ;\n  option none ;\n;"),
      ],
      [],
    );
    expect(r.units.map((u) => u.vocab)).toEqual(["util", "a"]);
    expect(r.units[1]?.deps).toEqual(["util"]);
  });

  test("the reference counts in a private word and next to other dependencies", () => {
    const r = scanVocab(
      [
        file("a.fth", "IN: a\n: _f ( x:bytes p:choice<z:t> -- bytes ) x m:g ;\n"),
        unit("m", ": g ( x:bytes -- bytes ) x ;"),
        unit("z", "CHOICE: t option a ; ;"),
      ],
      [],
    );
    expect(r.units.find((u) => u.vocab === "a")?.deps).toEqual(["m", "z"]);
  });

  test("an unqualified reference or one to the own vocabulary adds no dependency", () => {
    expect(scanVocab([user("p:choice<t>=a")], []).units[0]?.deps).toEqual([]);
    expect(scanVocab([user("p:choice<a:t>=a")], []).units[0]?.deps).toEqual([]);
  });

  test("text that only looks like a reference is ignored: strings, inline choices", () => {
    const r = scanVocab(
      [user('p:str="choice<zz:t>" q:choice{"choice<yy:t>"|b}="b"'), unit("zz"), unit("yy")],
      [],
    );
    expect(r.units.find((u) => u.vocab === "a")?.deps).toEqual([]);
  });

  test("a reference to an unknown vocabulary is an error naming the file", () => {
    expect(() => scanVocab([user("p:choice<nosuch:t>")], [])).toThrow(
      "unknown vocabulary 'nosuch' used by a.fth",
    );
  });

  test("a cycle through a header reference is reported", () => {
    expect(() =>
      scanVocab(
        [
          file("a.fth", "IN: a\n: f ( x:bytes p:choice<b:t> -- bytes ) x ;\n"),
          file("b.fth", "IN: b\n: g ( x:bytes p:choice<a:t> -- bytes ) x ;\n"),
        ],
        [],
      ),
    ).toThrow("vocabulary dependency cycle: a -> b -> a");
  });
});

describe("scanVocab: failures name the file", () => {
  test("a cycle lists the cycle", () => {
    expect(() =>
      scanVocab(
        [unit("a", "", "USING: b ;"), unit("b", "", "USING: c ;"), unit("c", "", "USING: a ;")],
        [],
      ),
    ).toThrow(/cycle: a -> b -> c -> a/);
  });

  test("a cycle that does not include the first remaining vocabulary", () => {
    expect(() =>
      scanVocab(
        [unit("a", "", "USING: b ;"), unit("b", "", "USING: c ;"), unit("c", "", "USING: b ;")],
        [],
      ),
    ).toThrow(/cycle: b -> c -> b/);
  });

  test("a unit that uses itself is not a cycle", () => {
    expect(() => scanVocab([unit("a", ": f ( x:str -- str ) x a:g ;")], [])).not.toThrow();
  });

  test("an unknown vocabulary", () => {
    expect(() => scanVocab([unit("a", ": f ( x:str -- str ) x nope:g ;")], [])).toThrow(
      "unknown vocabulary 'nope' used by a.fth",
    );
    expect(() => scanVocab([unit("a", "", "USING: nope ;")], [])).toThrow(
      "unknown vocabulary 'nope' used by a.fth",
    );
  });

  test("IN: must name the file's vocabulary", () => {
    expect(() => scanVocab([file("a.fth", "IN: b\n")], [])).toThrow(
      "a.fth: IN: must name 'a', found b",
    );
    expect(() => scanVocab([file("a.fth", "IN:")], [])).toThrow(/a.fth: IN: must name 'a'/);
    expect(() => scanVocab([file("a.fth", "IN: [")], [])).toThrow(/a.fth: IN: must name 'a'/);
  });

  test("exactly one IN:", () => {
    expect(() => scanVocab([file("a.fth", ": f ( -- int ) 1 ;")], [])).toThrow(
      "a.fth: a vocabulary unit must contain exactly one IN: (found 0)",
    );
    expect(() => scanVocab([file("a.fth", "IN: a\nIN: a\n")], [])).toThrow(/found 2/);
  });

  test("VOCAB and PRIMITIVE are rejected", () => {
    expect(() => scanVocab([file("a.fth", "IN: a\nVOCAB a\n")], [])).toThrow(/a.fth: VOCAB/);
    expect(() => scanVocab([file("a.fth", "IN: a\nPRIMITIVE foo\n")], [])).toThrow(
      /a.fth: PRIMITIVE/,
    );
  });

  test("a lexical error names the file", () => {
    expect(() => scanVocab([file("a.fth", 'IN: a\n"unterminated')], [])).toThrow(/^a.fth: /);
  });

  test("file names", () => {
    expect(() => scanVocab([file("a.txt", "IN: a")], [])).toThrow(/a.txt: .* must end in .fth/);
    expect(() => scanVocab([file("core.fth", "IN: core")], [])).toThrow(/core.fth: 'core'/);
    expect(() => scanVocab([file("user.fth", "IN: user")], [])).toThrow(/user.fth: 'user'/);
    expect(() => scanVocab([file("1bad.fth", "IN: 1bad")], [])).toThrow(/1bad.fth: '1bad'/);
    expect(() => scanVocab([unit("a"), unit("a")], [])).toThrow(
      "a.fth: vocabulary 'a' is defined twice",
    );
  });

  test("primitive module names", () => {
    expect(() => scanVocab([], ["core"])).toThrow(/prims\/core/);
    expect(() => scanVocab([], ["user"])).toThrow(/prims\/user/);
    expect(() => scanVocab([], ["9x"])).toThrow(/prims\/9x/);
  });

  test("a non-lexical failure of read is not swallowed", () => {
    // A source longer than the default maximum is a ForgeError (E_LIMIT_SOURCE), reported with the file name.
    expect(() => scanVocab([file("a.fth", "IN: a\n" + " ".repeat(1_048_577))], [])).toThrow(
      /^a.fth: /,
    );
  });
});
