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
 * RW4: the catalogue fields of RECIPES-1.2.md for slots (section 4.5), pins (section 9), conversions
 * (section 6.9) and hard kill (section 19.1 a), over fixture vocabularies. There are no real `relix:` ops yet,
 * so the fixtures register fixture kinds named as the Relix pack will name them.
 */
import { WORD_META_SCHEMA, definePrimitive, registerExtKind } from "@forge/lang";
import type { ExtKind } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue, catalogueIssues, parsePinsCompat } from "./catalogue.js";
import schema from "./catalogue.schema.json" with { type: "json" };
import { loadBundleNode, loadPinsCompatNode } from "./sources-node.js";
import { SLOT_FAMILIES, SLOT_KINDS } from "./types.js";
import type { Catalogue, CatalogueOp } from "./types.js";

/** A kind that holds its text, with a faithful text form. */
function textKind(kind: string, faithful = true): ExtKind<string> {
  return {
    kind,
    equals: (a, b) => a === b,
    sizeOf: (p) => p.length,
    toText: (p) => p,
    ...(faithful ? { fromText: (t: string) => t } : {}),
  };
}
registerExtKind(textKind("relation"));
registerExtKind(textKind("relix-expr"));
registerExtKind(textKind("fx-opaque", false));

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(WORD_META_SCHEMA);
ajv.addSchema(schema);
const validateCatalogue = ajv.getSchema("urn:forge:schema:catalogue:1");
const validateOp = ajv.getSchema("urn:forge:schema:catalogue:1#/$defs/op");

const empty = { vocabs: [], units: [], primitives: [] };
const units = (source: string) => ({ units: [{ name: "t.fth", source }] });
const H = (c: string) => c.repeat(64);

const FIXTURE = `IN: t
: theta-join ( left:ext{relation} right:ext{relation} on:ext{relix-expr}="true" -- ext{relation} )
  "Join." doc "Relational" category left ;
: union ( left:ext{relation} right:ext{relation} -- ext{relation} )
  "Union." doc "Relational" category left ;
: fix ( base:ext{relation} step:ext{relation} name:str="x" -- ext{relation} )
  "Fixpoint." doc "Relational" category base ;
: iterate ( base:ext{relation} step:ext{relation} -- ext{relation} )
  "Iterate." doc "Relational" category base ;
: select ( r:ext{relation} on:ext{relix-expr}="true" -- ext{relation} )
  "Select." doc "Relational" category r ;
: from ( t:str text:str="" -- ext{relation} )
  "From." doc "Relational" category t ;
: run ( r:ext{relation} limit:int=0 -- str )
  "Run." doc "Relational" category drop "" ;
: late ( r:ext{relation} name:str other:ext{relation} -- ext{relation} )
  "Late." doc "Relational" category r ;
: upper ( s:str -- str ) "Upper." doc "Text" category s ;
`;

const fixture = (options = {}): Catalogue =>
  buildCatalogue(assembleRuntime(empty, units(FIXTURE)), options);
const op = (cat: Catalogue, q: string): CatalogueOp => {
  const found = cat.ops.find((o) => o.qname === q);
  if (found === undefined) throw new Error(`no op ${q}`);
  return found;
};

describe("constants", () => {
  test("SLOT_KINDS and SLOT_FAMILIES", () => {
    expect([...SLOT_KINDS]).toEqual(["relation"]);
    expect(SLOT_FAMILIES).toEqual({
      right: { slots: ["left", "right"], pipeable: ["left", "right"], data: "left" },
      step: { slots: ["base", "step"], pipeable: ["base"], data: "base" },
    });
  });
});

describe("slot marking (RECIPES-1.2.md section 4.5)", () => {
  const cat = fixture();

  test("right for the binary ops, step for the base-and-step ops, absent for every other op", () => {
    expect(op(cat, "t:theta-join").slot).toBe("right");
    expect(op(cat, "t:union").slot).toBe("right");
    expect(op(cat, "t:fix").slot).toBe("step");
    expect(op(cat, "t:iterate").slot).toBe("step");
    for (const q of ["t:select", "t:from", "t:run", "t:late", "t:upper"]) {
      expect(op(cat, q), q).not.toHaveProperty("slot");
    }
  });

  test("the fixture catalogue and each op validate against the schema", () => {
    expect(validateCatalogue?.(cat), ajv.errorsText(validateCatalogue?.errors)).toBe(true);
    for (const o of cat.ops) expect(validateOp?.(o), o.qname).toBe(true);
  });

  test("slot is last in an op's key order, after needsHardKill", () => {
    expect(Object.keys(op(cat, "t:union")).slice(-2)).toEqual(["needsHardKill", "slot"]);
  });

  test("CR268: a slot parameter named neither right nor step fails buildCatalogue", () => {
    const src = `IN: t
: bad ( a:ext{relation} other:ext{relation} -- ext{relation} ) "d." doc "R" category a ;
`;
    expect(() => buildCatalogue(assembleRuntime(empty, units(src)))).toThrow(
      /t:bad.*'other'.*'right' and 'step'/,
    );
  });

  test("the schema allows only right and step", () => {
    const o = op(cat, "t:union");
    expect(validateOp?.({ ...o, slot: "left" })).toBe(false);
    expect(validateOp?.({ ...o, slot: "base" })).toBe(false);
    expect(validateOp?.({ ...o, slot: "right" })).toBe(true);
  });
});

describe("rule 4 for ext parameters (RECIPES-1.2.md section 3.1)", () => {
  const build = (kind: string): Catalogue =>
    buildCatalogue(
      assembleRuntime(
        empty,
        units(`IN: t\n: f ( s:str p:ext{${kind}} -- str ) "d." doc "C" category s ;\n`),
      ),
    );

  test("a kind with a fromText gives an op", () => {
    expect(build("relix-expr").ops.map((o) => o.qname)).toEqual(["t:f"]);
  });

  test("a kind with no fromText, or no registration, gives no op", () => {
    expect(build("fx-opaque").ops).toEqual([]);
    expect(build("fx-unregistered").ops).toEqual([]);
  });
});

describe("previousHashes (RECIPES-1.2.md section 9.2)", () => {
  const plain = fixture();

  test("core-only output is unchanged: no key, same version, with and without an empty pins list", () => {
    expect(fixture({ pinsCompat: {} })).toEqual(plain);
    expect(plain.ops.some((o) => "previousHashes" in o)).toBe(false);
  });

  test("pinsCompat adds the list after hash, ignores an op that is absent, and changes the version", () => {
    const cat = fixture({ pinsCompat: { "t:upper": [H("a"), H("b")], "t:gone": [H("c")] } });
    const upper = op(cat, "t:upper");
    expect(upper.previousHashes).toEqual([H("a"), H("b")]);
    const keys = Object.keys(upper);
    expect(keys.indexOf("previousHashes")).toBe(keys.indexOf("hash") + 1);
    expect(cat.ops).toHaveLength(plain.ops.length);
    expect(cat.version).not.toBe(plain.version);
    expect(validateCatalogue?.(cat), ajv.errorsText(validateCatalogue?.errors)).toBe(true);
    expect(catalogueIssues(cat)).toEqual([]);
  });

  test("an empty list adds nothing", () => {
    expect(fixture({ pinsCompat: { "t:upper": [] } })).toEqual(plain);
  });

  test("buildCatalogue refuses five entries, a malformed hash and the current hash", () => {
    const five = [H("a"), H("b"), H("c"), H("d"), H("e")];
    expect(() => fixture({ pinsCompat: { "t:upper": five } })).toThrow(/t:upper/);
    expect(() => fixture({ pinsCompat: { "t:upper": ["xyz"] } })).toThrow(/t:upper/);
    expect(() => fixture({ pinsCompat: { "t:upper": [H("A")] } })).toThrow(/t:upper/);
    const hash = op(plain, "t:upper").hash;
    expect(() => fixture({ pinsCompat: { "t:upper": [hash] } })).toThrow(/t:upper/);
  });

  test("CR252: five entries, a malformed hash or the current hash fail validation", () => {
    const o = op(plain, "t:upper");
    const withList = (previousHashes: string[]): Catalogue => ({
      ...plain,
      ops: plain.ops.map((x) => (x === o ? { ...x, previousHashes } : x)),
    });
    expect(validateOp?.({ ...o, previousHashes: [H("a")] })).toBe(true);
    expect(validateOp?.({ ...o, previousHashes: [H("a"), H("b"), H("c"), H("d")] })).toBe(true);
    // five entries
    expect(validateOp?.({ ...o, previousHashes: [H("a"), H("b"), H("c"), H("d"), H("e")] })).toBe(
      false,
    );
    // not 64 lowercase hex digits
    expect(validateOp?.({ ...o, previousHashes: ["abc"] })).toBe(false);
    expect(validateOp?.({ ...o, previousHashes: [H("A")] })).toBe(false);
    // a repeat
    expect(validateOp?.({ ...o, previousHashes: [H("a"), H("a")] })).toBe(false);
    // equal to hash: a schema cannot compare two fields, so `catalogueIssues` states it
    expect(catalogueIssues(withList([o.hash]))).toEqual([
      "t:upper: previousHashes contains the current hash",
    ]);
    expect(catalogueIssues(withList([H("a")]))).toEqual([]);
  });

  test("parsePinsCompat reads the file text and refuses anything else", () => {
    expect(parsePinsCompat("")).toEqual({});
    expect(parsePinsCompat("{}")).toEqual({});
    expect(parsePinsCompat(JSON.stringify({ "a:b": [H("a")] }))).toEqual({ "a:b": [H("a")] });
    for (const bad of [
      "[]",
      "null",
      '{"a:b": "x"}',
      '{"a:b": ["x"]}',
      '{"a:b": [1]}',
      JSON.stringify({ "a:b": [H("a"), H("a")] }),
      JSON.stringify({ "a:b": [H("a"), H("b"), H("c"), H("d"), H("e")] }),
    ]) {
      expect(() => parsePinsCompat(bad), bad).toThrow(/pins-compat\.json/);
    }
  });

  test("the shipped vocab/pins-compat.json loads, and an absent file is an empty object", () => {
    expect(loadPinsCompatNode()).toEqual({});
    expect(loadPinsCompatNode("/no/such/dir")).toEqual({});
  });
});

describe("conversions (RECIPES-1.2.md section 6.9)", () => {
  const manifest = [
    { from: "str", to: "relation", op: "t:from" },
    { from: "relation", to: "str", op: "t:run", atEnd: true },
  ] as const;

  test("a conversion list is copied into the catalogue and is not part of the version", () => {
    const cat = fixture({ conversions: manifest });
    expect(cat.conversions).toEqual(manifest);
    expect(cat.version).toBe(fixture().version);
    expect(validateCatalogue?.(cat), ajv.errorsText(validateCatalogue?.errors)).toBe(true);
  });

  test("none declared: the key is absent", () => {
    expect(fixture()).not.toHaveProperty("conversions");
    expect(fixture({ conversions: [] })).not.toHaveProperty("conversions");
  });

  test("an op that is missing, mistyped or has a required parameter fails the build", () => {
    const one = (c: object) => () => fixture({ conversions: [c] });
    expect(one({ from: "str", to: "relation", op: "t:nope" })).toThrow(/not a catalogue operation/);
    expect(one({ from: "bytes", to: "relation", op: "t:from" })).toThrow(/data input/);
    expect(one({ from: "str", to: "str", op: "t:from" })).toThrow(/output/);
    // `t:select` has a data input of kind relation but `t:late` has a required parameter
    expect(one({ from: "relation", to: "relation", op: "t:late" })).toThrow(/no default/);
  });

  test("the schema refuses unknown keys and a false atEnd", () => {
    const cat = fixture({ conversions: manifest });
    const bad = (c: object) => validateCatalogue?.({ ...cat, conversions: [c] });
    expect(bad({ from: "a", to: "b", op: "t:from", extra: 1 })).toBe(false);
    expect(bad({ from: "a", to: "b", op: "t:from", atEnd: false })).toBe(false);
    expect(bad({ from: "A", to: "b", op: "t:from" })).toBe(false);
    expect(bad({ from: "a", to: "b" })).toBe(false);
  });
});

describe("hardKill (RECIPES-1.2.md section 19.1 a), CR267", () => {
  const engine = definePrimitive("hk", "engine", "( str -- str )", (s: unknown) => s, {
    doc: "Runs an engine.",
    category: "Engine",
    hardKill: true,
  });
  const calm = definePrimitive("hk", "calm", "( str -- str )", (s: unknown) => s, {
    doc: "Does not.",
    category: "Engine",
  });
  const rt = assembleRuntime(
    { vocabs: ["hk"], units: [], primitives: [engine, calm] },
    units(`IN: t
USING: hk ;
: direct ( s:str -- str ) "d." doc "T" category hk:engine ;
: _helper ( s:str -- str ) hk:engine ;
: indirect ( s:str -- str ) "i." doc "T" category _helper ;
: fine ( s:str -- str ) "f." doc "T" category hk:calm ;
`),
  );
  const cat = buildCatalogue(rt);
  const flag = (q: string) => op(cat, q).needsHardKill;

  test("a primitive that declares hardKill, and an FL op that reaches it, are flagged", () => {
    expect(flag("hk:engine")).toBe(true);
    expect(flag("t:direct")).toBe(true);
    expect(flag("t:indirect")).toBe(true);
  });

  test("a primitive that does not declare it, and an op over it, are not", () => {
    expect(flag("hk:calm")).toBe(false);
    expect(flag("t:fine")).toBe(false);
  });

  test("the regex primitives are still flagged", async () => {
    const real = buildCatalogue(assembleRuntime(await loadBundleNode("all")));
    expect(op(real, "regex:test").needsHardKill).toBe(true);
    expect(op(real, "hex:encode").needsHardKill).toBe(false);
  });
});
