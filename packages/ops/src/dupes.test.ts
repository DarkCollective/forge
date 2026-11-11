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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  extractDefinitions,
  findDuplicates,
  formatReport,
  groupNames,
  pendingByName,
  primitiveSet,
  similarity,
} from "./dupes.js";
import { createNodeProvider } from "./sources-node.js";
import type { SourceFile } from "./types.js";

/** The package's primitives as `vocab:name`, read from src/prims the way the bundle loader reads them. */
const PRIMS = await primitiveSet(createNodeProvider().primitiveLoaders());

const file = (vocab: string, body: string): SourceFile => ({
  name: `${vocab}.fth`,
  text: `\\ comment\nIN: ${vocab}\n${body}\n`,
});

describe("extractDefinitions", () => {
  test("renames input names to positions, so the names do not matter", () => {
    const a = extractDefinitions([
      file("a", ": _ws ( b:int -- bool ) b 32 = b 9 >= b 13 <= and or ;"),
    ]);
    const b = extractDefinitions([
      file("b", ": _sp ( code:int -- bool ) code 32 = code 9 >= code 13 <= and or ;"),
    ]);
    expect(a[0]?.tokens).toEqual(b[0]?.tokens);
    expect(a[0]?.tokens[0]).toBe("$0");
    expect(a[0]?.inputs).toEqual(["int"]);
    expect(a[0]?.outputs).toEqual(["bool"]);
  });

  test("drops comments and the doc and category lines", () => {
    const [d] = extractDefinitions([
      file(
        "a",
        '\\ a comment\n: op ( x:str -- str )\n  "Does it." doc\n  "Cat" category\n  x upper ( inline ) ;',
      ),
    ]);
    expect(d?.tokens).toEqual(["$0", "w:upper"]);
  });

  test("keeps other strings and numbers, with their kind", () => {
    const [d] = extractDefinitions([file("a", ': f ( -- str ) "x" 1 [ 2 ] drop ;')]);
    expect(d?.tokens).toEqual(["s:x", "int:1", "[", "int:2", "]", "w:drop"]);
  });

  test("qualifies words of the same vocabulary and qualified words alike", () => {
    const defs = extractDefinitions([
      file("a", ": _h ( x:int -- int ) x ;\n: f ( x:int -- int ) x _h util:space? ;"),
    ]);
    expect(defs[1]?.tokens).toEqual(["$0", "w:a:_h", "w:util:space?"]);
  });

  test("parses names and types of the header, ignoring defaults and constraints", () => {
    const [d] = extractDefinitions([
      file("a", ": f ( bytes n:int[2..36]=16 c:choice{a|b}=a -- str str ) n ;"),
    ]);
    expect(d?.inputs).toEqual(["bytes", "int", "choice"]);
    expect(d?.outputs).toEqual(["str", "str"]);
  });

  test("ignores META blocks and non-fth files", () => {
    const defs = extractDefinitions([
      file("a", ': f ( -- int ) 1 ;\nMETA: f\n  param x "y" ;\n;'),
      { name: "notes.txt", text: ": g ( -- int ) 2 ;" },
    ]);
    expect(defs.map((d) => d.qname)).toEqual(["a:f"]);
  });
});

describe("similarity", () => {
  test("is 1 for equal sequences, 0 for disjoint ones", () => {
    expect(similarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(similarity(["a", "b", "c"], ["x", "y", "z"])).toBe(0);
  });

  test("is Jaccard over token bigrams", () => {
    // {ab, bc, cd} against {ab, bc, cx}: 2 common of 4 in total
    expect(similarity(["a", "b", "c", "d"], ["a", "b", "c", "x"])).toBe(0.5);
  });
});

describe("findDuplicates", () => {
  const body = "b 32 = b 9 >= b 13 <= and or";
  const sources = (...xs: [string, string, string][]): SourceFile[] =>
    xs.map(([vocab, name, b]) => file(vocab, `: ${name} ( b:int -- bool ) ${b} ;`));

  test("finds an exact duplicate across vocabularies", () => {
    const r = findDuplicates(
      extractDefinitions([
        file("a", `: _ws ( b:int -- bool ) ${body} ;`),
        file("b", ": _sp ( code:int -- bool ) code 32 = code 9 >= code 13 <= and or ;"),
        file("c", ": _x ( b:int -- bool ) 0 drop 1 2 + ;"),
      ]),
    );
    expect(r.exact).toHaveLength(1);
    expect(groupNames(r.exact[0] as never)).toBe("a:_ws, b:_sp");
    expect(r.near).toEqual([]);
  });

  test("two copies in the same vocabulary are not reported", () => {
    const text = `IN: a\n: _p ( b:int -- bool ) ${body} ;\n: _q ( b:int -- bool ) ${body} ;\n`;
    expect(findDuplicates(extractDefinitions([{ name: "a.fth", text }])).exact).toEqual([]);
  });

  test("the same body with a different effect shape is not exact", () => {
    const r = findDuplicates(
      extractDefinitions([
        file("a", `: f ( b:int -- bool ) ${body} ;`),
        file("b", `: g ( b:str -- bool ) ${body} ;`),
      ]),
    );
    expect(r.exact).toEqual([]);
  });

  test("a trivial body is ignored", () => {
    const r = findDuplicates(extractDefinitions(sources(["a", "f", "b 1 +"], ["b", "g", "b 1 +"])));
    expect(r.exact).toEqual([]);
    expect(r.near).toEqual([]);
  });

  test("two thin wrappers over their own distinct primitives are not exact duplicates", () => {
    // `a b c _prim` in each vocabulary, where _prim is a TypeScript primitive of that vocabulary.
    const src = [
      file("a", ": encrypt ( data:bytes key:bytes -- bytes ) data key a b c _prim ;"),
      file("b", ": encrypt ( data:bytes key:bytes -- bytes ) data key a b c _prim ;"),
    ];
    const prims = new Set(["a:_prim", "b:_prim"]);
    expect(findDuplicates(extractDefinitions(src, prims)).exact).toEqual([]);
    expect(findDuplicates(extractDefinitions(src, prims)).similar).toEqual([]);
    // Without the primitives they are the same body, as before the fix.
    expect(findDuplicates(extractDefinitions(src)).exact).toHaveLength(1);
  });

  test("two vocabularies with identical private FL helpers are still exact duplicates", () => {
    const src = [
      file("a", ": _h ( x:int -- int ) x 1 + 2 * 3 - ;\n: f ( x:int -- int ) x _h dup ;"),
      file("b", ": _h ( x:int -- int ) x 1 + 2 * 3 - ;\n: g ( x:int -- int ) x _h dup ;"),
    ];
    const prims = new Set(["a:_prim", "b:_prim"]);
    const { exact } = findDuplicates(extractDefinitions(src, prims));
    expect(exact).toHaveLength(1);
    expect(exact[0]?.members.map((m) => m.qname).sort()).toEqual(["a:_h", "b:_h"]);
  });

  test("a primitive of its own vocabulary is vocabulary-specific, so it is not a core word", () => {
    const [d] = extractDefinitions(
      [file("a", ": encrypt ( data:bytes key:bytes -- bytes ) data key _prim ;")],
      new Set(["a:_prim"]),
    );
    expect(d?.core).toEqual([]);
    expect(d?.tokens).toContain("w:a:_prim");
  });

  test("a call to a private word of its own vocabulary is not the same as in another vocabulary", () => {
    const r = findDuplicates(
      extractDefinitions([
        file("a", ": _h ( x:int -- int ) x 1 + 2 * 3 - ;\n: f ( x:int -- int ) x _h x _h + dup ;"),
        file("b", ": _h ( x:int -- int ) x 4 + 5 * 6 - ;\n: f ( x:int -- int ) x _h x _h + dup ;"),
      ]),
    );
    expect(r.exact).toEqual([]);
  });

  test("finds a near duplicate of the same arity, with its similarity", () => {
    const a = "x 1 + 2 * 3 - 4 + 5 * 6 - 7 + 8 * 9 - 10 + 11 * 12 - 13 + 14 *";
    const b = "x 1 + 2 * 3 - 4 + 5 * 6 - 7 + 8 * 9 - 10 + 11 * 12 - 13 + 14 -";
    const r = findDuplicates(
      extractDefinitions([
        file("a", `: f ( x:int -- int ) ${a} ;`),
        file("b", `: g ( x:int -- int ) ${b} ;`),
      ]),
    );
    expect(r.exact).toEqual([]);
    expect(r.near).toHaveLength(1);
    expect(r.near[0]?.similarity).toBeGreaterThanOrEqual(0.8);
    expect(r.near[0]?.similarity).toBeLessThan(1);
  });

  test("near duplicates need the same arity and a high enough similarity", () => {
    const a = "x 1 + 2 * 3 - 4 + 5 * 6 - 7 + 8 *";
    const r = findDuplicates(
      extractDefinitions([
        file("a", `: f ( x:int -- int ) ${a} ;`),
        file("b", `: g ( x:int y:int -- int ) ${a} ;`),
        file("c", ": h ( x:int -- int ) x dup swap drop over rot nip tuck ;"),
      ]),
    );
    expect(r.near).toEqual([]);
  });

  test("the report names the words and points at util", () => {
    const r = findDuplicates(extractDefinitions(sources(["a", "_ws", body], ["b", "_sp", body])));
    const text = formatReport(r);
    expect(text).toContain("a:_ws, b:_sp");
    expect(text).toContain("vocab/util.fth");
  });
});

describe("util-candidate markers", () => {
  const body = "b 32 = b 9 >= b 13 <= and or";
  const marked = (vocab: string, name: string, proposed: string | null, b = body): SourceFile =>
    file(
      vocab,
      `${proposed === null ? "" : `\\ util-candidate: ${proposed}\n`}: ${name} ( b:int -- bool ) ${b} ;`,
    );

  test("the marker names the proposed util word of the definition right below it", () => {
    const defs = extractDefinitions([
      marked("a", "_ws", "ws?"),
      marked("b", "_sp", null),
      file("c", `\\ util-candidate: nope\n\n: _x ( b:int -- bool ) ${body} ;`),
    ]);
    expect(defs.map((d) => d.candidate)).toEqual(["ws?", null, null]);
  });

  test("a group whose members all carry the marker is pending, not a failure", () => {
    const r = findDuplicates(
      extractDefinitions([marked("a", "_ws", "ws?"), marked("b", "_sp", "ws?")]),
    );
    expect(r.exact).toEqual([]);
    expect(r.pending).toHaveLength(1);
    expect(pendingByName(r).map(([name]) => name)).toEqual(["ws?"]);
    const text = formatReport(r);
    expect(text).toContain("Pending util promotion (util-candidate markers): 1");
    expect(text).toContain("ws?");
    expect(text).toContain("a:_ws, b:_sp");
  });

  test("one unmarked copy makes the whole group a failure", () => {
    const r = findDuplicates(
      extractDefinitions([
        marked("a", "_ws", "ws?"),
        marked("b", "_sp", "ws?"),
        marked("c", "_sp2", null),
      ]),
    );
    expect(r.pending).toEqual([]);
    expect(r.exact).toHaveLength(1);
    expect(r.exact[0]?.members).toHaveLength(3);
  });

  test("a marked copy with a changed body is not exact: the structural check is what catches it", () => {
    const r = findDuplicates(
      extractDefinitions([
        marked("a", "_ws", "ws?"),
        marked("b", "_sp", "ws?", "b 32 = b 13 <= b 9 >= and or"),
      ]),
    );
    expect(r.exact).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.similar).toHaveLength(1);
  });
});

describe("likely re-implementations", () => {
  const defs = (...xs: [string, string, string, string][]): SourceFile[] =>
    xs.map(([vocab, name, effect, b]) => file(vocab, `: ${name} ( ${effect} ) ${b} ;`));

  test("the same signature and the same set of core words, in another order, is reported", () => {
    const r = findDuplicates(
      extractDefinitions(
        defs(
          ["a", "_pad", "s:str n:int -- str", "s len n < [ s n slice ] [ s ] if s len drop"],
          ["b", "_clip", "s:str n:int -- str", "s s len drop [ s ] [ s n slice ] if n len <"],
        ),
      ),
    );
    expect(r.exact).toEqual([]);
    expect(r.similar).toHaveLength(1);
    expect(r.similar[0]?.members.map((m) => m.qname)).toEqual(["a:_pad", "b:_clip"]);
    expect(formatReport(r)).toContain("Likely re-implementations");
  });

  test("a different signature, a public word or too few core words is not reported", () => {
    const r = findDuplicates(
      extractDefinitions(
        defs(
          ["a", "_f", "s:str n:int -- str", "s len n < [ s n slice ] [ s ] if s len drop"],
          ["b", "_g", "s:str n:int -- int", "s s len drop [ s ] [ s n slice ] if n len <"],
          ["c", "pub", "s:str n:int -- str", "s s len drop [ s ] [ s n slice ] if n len <"],
          ["d", "_h", "x:int y:int -- int", "x y + x y + x y + x y +"],
          ["e", "_i", "x:int y:int -- int", "x y + y x + y x + x y +"],
        ),
      ),
    );
    expect(r.similar).toEqual([]);
  });

  test("copies of one body in several vocabularies are exact duplicates, not re-implementations", () => {
    const r = findDuplicates(
      extractDefinitions(
        defs(
          ["a", "_f", "s:str n:int -- str", "s len n < [ s n slice ] [ s ] if s len drop"],
          ["b", "_g", "s:str n:int -- str", "s len n < [ s n slice ] [ s ] if s len drop"],
        ),
      ),
    );
    expect(r.exact).toHaveLength(1);
    expect(r.similar).toEqual([]);
  });
});

describe("the real vocabularies", () => {
  const dir = `${fileURLToPath(import.meta.url)
    .replaceAll("\\", "/")
    .replace(/\/[^/]*$/, "")}/../vocab`;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".fth"))
    .sort()
    .map((name) => ({ name, text: readFileSync(`${dir}/${name}`, "utf8") }));

  test("no util-candidate marker is left: every pending copy has been promoted", () => {
    const result = findDuplicates(extractDefinitions(files, PRIMS));
    expect(pendingByName(result).map(([name]) => name)).toEqual([]);
  });

  test("no helper is copied between vocabularies", () => {
    const { exact } = findDuplicates(extractDefinitions(files, PRIMS));
    const message = exact
      .map(
        (g) =>
          `${groupNames(g)} have identical bodies. Move the helper into vocab/util.fth ` +
          `(a public word with a doc string) and call it as util:name in each vocabulary.`,
      )
      .join("\n");
    expect(message).toBe("");
  });
});
