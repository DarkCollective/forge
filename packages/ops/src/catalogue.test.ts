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
import { WORD_META_SCHEMA, sha256 } from "@forge/lang";
import type { WordMeta } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue, isCatalogueOp } from "./catalogue.js";
import schema from "./catalogue.schema.json" with { type: "json" };
import { loadBundleNode } from "./sources-node.js";
import { CATALOGUE_FORMAT, INTERNAL_VOCABS, UI_PARAM_TYPES } from "./types.js";
import type { Catalogue, CatalogueOp } from "./types.js";

const bundle = await loadBundleNode("all");
const real = assembleRuntime(bundle);
const catalogue = buildCatalogue(real);

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(WORD_META_SCHEMA);
ajv.addSchema(schema);
const validateCatalogue = ajv.getSchema("urn:forge:schema:catalogue:1");
const validateOp = ajv.getSchema("urn:forge:schema:catalogue:1#/$defs/op");

function units(source: string) {
  return { units: [{ name: "t.fth", source }] };
}
const empty = { vocabs: [], units: [], primitives: [] };

describe("the bundled catalogue", () => {
  test("has the twelve seed ops, sorted by qname, and no internal vocabularies", () => {
    const names = catalogue.ops.map((o) => o.qname);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining([
        "base64:decode",
        "base64:encode",
        "classical:rot",
        "hex:decode",
        "hex:encode",
        "regex:find-all",
        "regex:replace",
        "regex:split",
        "regex:test",
        "text:lower",
        "text:reverse",
        "text:upper",
      ]),
    );
    expect(catalogue.vocabs).toEqual([...catalogue.vocabs].sort());
    expect(catalogue.vocabs).toEqual(
      expect.arrayContaining(["base64", "classical", "hex", "regex", "text"]),
    );
    expect(catalogue.vocabs).not.toContain("recipe");
    expect(names.some((n) => n.startsWith("recipe:"))).toBe(false);
    expect(catalogue.format).toBe(CATALOGUE_FORMAT);
  });

  test("the whole document validates against the schema", () => {
    expect(validateCatalogue?.(catalogue), ajv.errorsText(validateCatalogue?.errors)).toBe(true);
  });

  test.each(catalogue.ops.map((o) => [o.qname, o] as const))(
    "%s validates against the schema",
    (_name, op) => {
      expect(validateOp?.(op), ajv.errorsText(validateOp?.errors)).toBe(true);
    },
  );

  test("the schema rejects broken documents", () => {
    const op = catalogue.ops[0] as CatalogueOp;
    const broken: unknown[] = [
      { ...catalogue, format: 2 },
      { ...catalogue, version: "xyz" },
      { ...catalogue, extra: 1 },
      { ...catalogue, vocabs: ["a", "a"] },
      { ...catalogue, ops: [{ ...op, hash: "abc" }] },
      { ...catalogue, ops: [{ ...op, needsHardKill: "no" }] },
      { ...catalogue, ops: [{ ...op, extra: true }] },
      { ...catalogue, ops: [{ ...op, input: "nope" }] },
      { ...catalogue, ops: [{ ...op, effects: ["+bad"] }] },
      { ...catalogue, ops: [{ ...op, qname: "no colon" }] },
    ];
    for (const doc of broken) expect(validateCatalogue?.(doc)).toBe(false);
    const missing: Record<string, unknown> = { ...op };
    delete missing.needsHardKill;
    expect(validateCatalogue?.({ ...catalogue, ops: [missing] })).toBe(false);
  });

  test("key order of an op is the order of CatalogueOp", () => {
    expect(Object.keys(catalogue.ops[0] as CatalogueOp)).toEqual([
      "qname",
      "name",
      "vocab",
      "category",
      "doc",
      "aliases",
      "seeAlso",
      "input",
      "output",
      "effect",
      "params",
      "effects",
      "version",
      "hash",
      "needsHardKill",
    ]);
    expect(Object.keys(catalogue)).toEqual(["format", "version", "vocabs", "ops"]);
  });

  test("rot: the entry of RECIPES 2.3", () => {
    const rot = catalogue.ops.find((o) => o.qname === "classical:rot") as CatalogueOp;
    expect(rot).toMatchObject({
      name: "rot",
      vocab: "classical",
      category: "Classical ciphers",
      doc: "Rotate each ASCII letter by a fixed amount; other bytes pass through.",
      aliases: ["rot13"],
      seeAlso: ["classical:atbash"],
      input: "bytes",
      output: "bytes",
      effect: "( bytes amount:int[0..25]=13 -- bytes )",
      effects: [],
      version: "1",
      needsHardKill: false,
    });
    expect(rot.params).toEqual([
      {
        name: "amount",
        type: "int",
        index: 1,
        required: false,
        constraint: { min: 0, max: 25 },
        default: 13,
        doc: "Shift (13 = ROT13)",
      },
    ]);
    expect(rot.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the alias is not an op of its own", () => {
    expect(catalogue.ops.some((o) => o.name === "rot13")).toBe(false);
  });

  test("categories", () => {
    const category = (q: string) => catalogue.ops.find((o) => o.qname === q)?.category;
    expect(category("base64:decode")).toBe("Encodings");
    expect(category("hex:encode")).toBe("Encodings");
    expect(category("text:upper")).toBe("Text");
    expect(category("regex:split")).toBe("Regular expressions");
  });

  test("input and output types", () => {
    const io = (q: string) => {
      const op = catalogue.ops.find((o) => o.qname === q) as CatalogueOp;
      return [op.input, op.output];
    };
    expect(io("base64:encode")).toEqual(["bytes", "str"]);
    expect(io("regex:test")).toEqual(["str", "bool"]);
    expect(io("regex:find-all")).toEqual(["str", "list"]);
    expect(io("text:reverse")).toEqual(["str", "str"]);
  });

  test("version is the first 16 hex digits of the hash of the ops", () => {
    expect(catalogue.version).toBe(sha256(JSON.stringify(catalogue.ops)).slice(0, 16));
  });

  test("version is stable across builds and across runtimes", () => {
    expect(buildCatalogue(real).version).toBe(catalogue.version);
    expect(buildCatalogue(assembleRuntime(bundle)).version).toBe(catalogue.version);
    expect(JSON.parse(JSON.stringify(catalogue))).toEqual(catalogue);
  });

  test("the catalogue has no source text", () => {
    expect(JSON.stringify(catalogue)).not.toContain("source");
  });

  test("a promoted user word shows up in a rebuilt catalogue; the version changes", () => {
    const rt = assembleRuntime(bundle, {
      units: [
        {
          name: "mine.fth",
          source:
            'IN: mine\n: twice ( s:str -- str ) "Say it twice." doc "Mine" category s upper ;\n',
        },
      ],
    });
    const after = buildCatalogue(rt);
    expect(after.ops.map((o) => o.qname)).toContain("mine:twice");
    expect(after.vocabs).toContain("mine");
    expect(after.version).not.toBe(catalogue.version);
    expect(after.ops.filter((o) => o.vocab !== "mine")).toEqual(catalogue.ops);
  });
});

describe("version follows content", () => {
  const withDoc = (doc: string, extra = "") =>
    buildCatalogue(
      assembleRuntime(
        empty,
        units(`IN: t\n: f ( s:str -- str ) "${doc}" doc "C" category s ${extra};\n`),
      ),
    );

  test("changing a doc changes the version", () => {
    expect(withDoc("one").version).toBe(withDoc("one").version);
    expect(withDoc("one").version).not.toBe(withDoc("two").version);
  });

  test("changing the body changes the hash and the version", () => {
    const a = withDoc("one");
    const b = withDoc("one", "dup drop ");
    expect(a.ops[0]?.hash).not.toBe(b.ops[0]?.hash);
    expect(a.version).not.toBe(b.version);
  });
});

describe("rules of RECIPES 2.2", () => {
  const meta = (name: string): WordMeta => real.meta(name);

  test("a bundled op passes", () => {
    expect(isCatalogueOp(meta("hex:encode"))).toBe(true);
    expect(isCatalogueOp(meta("text:upper"))).toBe(true);
  });

  test("rule 1: op and exported", () => {
    expect(isCatalogueOp({ ...meta("hex:encode"), op: false })).toBe(false);
    expect(isCatalogueOp({ ...meta("hex:encode"), exported: false })).toBe(false);
  });

  test("rule 2: internal vocabularies are never ops", () => {
    for (const vocab of INTERNAL_VOCABS) {
      expect(isCatalogueOp({ ...meta("hex:encode"), vocab, qname: `${vocab}:encode` })).toBe(false);
    }
    expect(isCatalogueOp(meta("recipe:as-bytes"))).toBe(false);
    expect(isCatalogueOp(meta("recipe:section"))).toBe(false);
  });

  test("rule 3: only fl words and primitives", () => {
    for (const kind of ["intrinsic", "constant", "variable"] as const) {
      expect(isCatalogueOp({ ...meta("hex:encode"), kind })).toBe(false);
    }
    expect(isCatalogueOp({ ...meta("hex:encode"), kind: "fl" })).toBe(true);
  });

  test("rule 4: every parameter type must be a UI type", () => {
    const base = meta("classical:rot");
    const param = base.params[0] as WordMeta["params"][number];
    for (const type of UI_PARAM_TYPES) {
      expect(isCatalogueOp({ ...base, params: [{ ...param, type }] })).toBe(true);
    }
    for (const type of ["any", "list", "quot", "record", "file"] as const) {
      expect(isCatalogueOp({ ...base, params: [{ ...param, type }] })).toBe(false);
    }
  });

  test("rule 5: exactly one output, checked, fixed arity", () => {
    const base = meta("hex:encode");
    const effect = base.effect;
    const out = effect.outputs[0] as WordMeta["effect"]["outputs"][number];
    expect(isCatalogueOp({ ...base, effect: { ...effect, outputs: [] } })).toBe(false);
    expect(isCatalogueOp({ ...base, effect: { ...effect, outputs: [out, out] } })).toBe(false);
    expect(isCatalogueOp({ ...base, effect: { ...effect, unchecked: true } })).toBe(false);
    expect(isCatalogueOp({ ...base, effect: { ...effect, variadicInput: true } })).toBe(false);
  });

  test("rule 6: the canonical entry", () => {
    expect(isCatalogueOp({ ...meta("hex:encode"), qname: "hex:other" })).toBe(false);
  });

  describe("on a fixture runtime", () => {
    const source = `IN: t
: good ( s:str -- str ) "Good." doc "Fixture" category s ;
: nodata ( -- int ) "No input." doc "Fixture" category 1 ;
: twoout ( s:str -- str str ) "Two outputs." doc "Fixture" category s dup ;
: noout ( s:str -- ) "No outputs." doc "Fixture" category s drop ;
: usesquot ( s:str q:quot -- str ) "Takes a quotation." doc "Fixture" category s ;
: useslist ( s:str xs:list -- str ) "Takes a list." doc "Fixture" category s ;
: usesany ( s:str a:any -- str ) "Takes any." doc "Fixture" category s ;
: _hidden ( s:str -- str ) s ;
: bigger ( s:str n:number mode:choice{a|b}="a" key:key flag:bool=true -- str ) "Many params." doc "Fixture" category s ;
42 CONSTANT answer
0 VARIABLE counter
META: good
  alias well ;
  see-also t:bigger ;
;
`;
    const rt = assembleRuntime(empty, units(source));
    const cat = buildCatalogue(rt);

    test("only the words that satisfy every rule are listed", () => {
      expect(cat.ops.map((o) => o.qname)).toEqual(["t:bigger", "t:good"]);
    });

    test("the alias is recorded under aliases", () => {
      const good = cat.ops.find((o) => o.qname === "t:good") as CatalogueOp;
      expect(good.aliases).toEqual(["well"]);
      expect(good.seeAlso).toEqual(["t:bigger"]);
    });

    test("parameters are WordMeta.params unchanged", () => {
      const bigger = cat.ops.find((o) => o.qname === "t:bigger") as CatalogueOp;
      expect(bigger.params).toEqual(rt.meta("t:bigger").params);
      expect(bigger.params.map((p) => p.type)).toEqual(["number", "choice", "key", "bool"]);
    });

    test("an alias resolves to the canonical entry only", () => {
      expect(rt.meta("t:well").qname).toBe("t:good");
      expect(cat.ops.filter((o) => o.name === "well")).toEqual([]);
    });
  });

  describe("doc and category", () => {
    const source = `IN: t
: good ( s:str -- str ) "Good." doc "Fixture" category s ;
: nodoc ( s:str -- str ) "Fixture" category s ;
: nocat ( s:str -- str ) "No category." doc s ;
`;
    const rt = assembleRuntime(empty, units(source));

    test("a bundle op that lacks either throws", () => {
      expect(() => buildCatalogue(rt)).toThrow("t:nocat is an operation but has no category");
      expect(() => buildCatalogue(rt, { bundleVocabs: ["t"] })).toThrow(/has no (doc|category)/);
    });

    test("a missing doc is named", () => {
      const only = assembleRuntime(
        empty,
        units('IN: t\n: nodoc ( s:str -- str ) "Fixture" category s ;\n'),
      );
      expect(() => buildCatalogue(only)).toThrow("t:nodoc is an operation but has no doc");
    });

    test("a user vocabulary only warns and the word is skipped", () => {
      const warnings: string[] = [];
      const cat = buildCatalogue(rt, {
        bundleVocabs: ["hex"],
        warn: (m) => warnings.push(m),
      });
      expect(cat.ops.map((o) => o.qname)).toEqual(["t:good"]);
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain("t:nodoc");
      expect(warnings.join("\n")).toContain("t:nocat");
    });

    test("without a warn callback the skip is silent", () => {
      expect(() => buildCatalogue(rt, { bundleVocabs: [] })).not.toThrow();
    });
  });

  test("internal vocabularies are skipped outright, whatever their words say", () => {
    const rt = assembleRuntime({
      vocabs: ["bake", "recipe"],
      units: [
        {
          vocab: "recipe",
          name: "recipe.fth",
          source: "IN: recipe\n: shout ( s:str -- str ) s ;\n",
          deps: [],
        },
      ],
      primitives: [],
    });
    expect(rt.meta("recipe:shout").op).toBe(true);
    expect(buildCatalogue(rt).ops).toEqual([]);
  });

  test("core is not scanned", () => {
    expect(catalogue.ops.some((o) => o.vocab === "core")).toBe(false);
  });
});

describe("needsHardKill (computed from the loaded runtime)", () => {
  const flag = (cat: Catalogue, q: string) => cat.ops.find((o) => o.qname === q)?.needsHardKill;

  test("true exactly for the regex primitives among the seed ops", () => {
    for (const q of ["regex:test", "regex:find-all", "regex:replace", "regex:split"]) {
      expect(flag(catalogue, q), q).toBe(true);
    }
    for (const q of [
      "base64:decode",
      "base64:encode",
      "classical:rot",
      "hex:decode",
      "hex:encode",
      "text:lower",
      "text:reverse",
      "text:upper",
    ]) {
      expect(flag(catalogue, q), q).toBe(false);
    }
  });

  test("an FL op that calls a regex word, directly or through another FL word, is flagged", () => {
    const rt = assembleRuntime(
      bundle,
      units(`IN: t
USING: regex ;
: direct ( s:str -- str ) "d" doc "T" category "a" "b" "" regex:replace ;
: _helper ( s:str -- bool ) "a" "" regex:test ;
: indirect ( s:str -- bool ) "i" doc "T" category _helper ;
: twice ( s:str -- bool ) "t" doc "T" category indirect ;
: clean ( s:str -- str ) "c" doc "T" category text:upper ;
: viaquot ( s:str -- str ) "q" doc "T" category [ "x" "y" "" regex:replace ] call ;
`),
    );
    const cat = buildCatalogue(rt);
    expect(flag(cat, "t:direct")).toBe(true);
    expect(flag(cat, "t:indirect")).toBe(true);
    expect(flag(cat, "t:twice")).toBe(true);
    expect(flag(cat, "t:viaquot")).toBe(true);
    expect(flag(cat, "t:clean")).toBe(false);
  });

  test("an op that reaches the recipe vocabulary's regex primitive is flagged", () => {
    const rt = assembleRuntime(
      bundle,
      units(`IN: t
: sec ( s:str -- bytes ) "s" doc "T" category str>bytes "a" "" "utf8" [ ] recipe:section ;
`),
    );
    expect(flag(buildCatalogue(rt), "t:sec")).toBe(true);
  });

  test("a shared dependency is visited once and a cycle-free diamond is fine", () => {
    const rt = assembleRuntime(
      bundle,
      units(`IN: t
: _leaf ( s:str -- str ) s upper ;
: _left ( s:str -- str ) _leaf ;
: _right ( s:str -- str ) _leaf ;
: top ( s:str -- str ) "d" doc "T" category _left _right ;
`),
    );
    expect(flag(buildCatalogue(rt), "t:top")).toBe(false);
  });
});

describe("module facts", () => {
  test("constants", () => {
    expect(CATALOGUE_FORMAT).toBe(1);
    expect([...INTERNAL_VOCABS]).toEqual(["recipe", "bake", "util", "blockmode"]);
    expect([...UI_PARAM_TYPES]).toEqual([
      "bytes",
      "str",
      "int",
      "num",
      "number",
      "bool",
      "choice",
      "toggle",
      "regex",
      "charset",
      "key",
    ]);
  });
});
