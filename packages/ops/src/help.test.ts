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
import { WORD_META_SCHEMA } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { buildHelp } from "./help.js";
import schema from "./help.schema.json" with { type: "json" };
import { loadBundleNode } from "./sources-node.js";
import { HELP_FORMAT, HELP_MAX_BYTES } from "./types.js";
import type { HelpDoc, HelpOp, VectorFile } from "./types.js";

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(WORD_META_SCHEMA);
const validateHelp = ajv.compile(schema);

const bundleRuntime = assembleRuntime(await loadBundleNode("all"));
const empty = { vocabs: [], units: [], primitives: [] };
const FX = (name: string, extra = ""): string =>
  `: ${name} ( s:str -- str ) "${name}." doc "Fixture" category s ${extra};\n`;

function build(source: string, vectors: unknown[] = []) {
  const runtime = assembleRuntime(empty, {
    units: [{ name: "t.fth", source: `IN: t\n${source}` }],
  });
  const catalogue = buildCatalogue(runtime);
  const files: VectorFile[] = [{ vocab: "t", vectors }];
  return { runtime, catalogue, help: () => buildHelp(runtime, catalogue, files) };
}

const vector = (op: string, title: string, extra: Record<string, unknown> = {}) => ({
  name: `vector ${title}`,
  ref: "RFC 0",
  op,
  params: {},
  input: { value: "abc", enc: "utf8" },
  expect: { value: "ABC", enc: "utf8" },
  example: { title, note: "A note." },
  ...extra,
});

const find = (doc: HelpDoc, q: string): HelpOp => {
  const op = doc.ops.find((o) => o.qname === q);
  if (op === undefined) throw new Error(`no help for ${q}`);
  return op;
};

describe("buildHelp: use-when, links and the inverse closure", () => {
  const src = [
    FX("enc"),
    FX("dec"),
    FX("plain"),
    'META: dec use-when "Reach for it." ; link "https://example.com/spec" "The spec" ; link "https://example.org/a" ; inverse enc ; ;\n',
  ].join("");
  const { help } = build(src);
  const doc = help();

  test("copies use-when and links, in order, and leaves out ops with nothing to say", () => {
    expect(find(doc, "t:dec")).toEqual({
      qname: "t:dec",
      useWhen: "Reach for it.",
      links: [
        { url: "https://example.com/spec", label: "The spec" },
        { url: "https://example.org/a", label: null },
      ],
      inverse: "t:enc",
      examples: [],
    });
    expect(doc.ops.map((o) => o.qname)).toEqual(["t:dec", "t:enc"]);
  });

  test("the inverse is made symmetric; the declaring word keeps its own entry", () => {
    expect(find(doc, "t:enc")).toEqual({
      qname: "t:enc",
      useWhen: null,
      links: [],
      inverse: "t:dec",
      examples: [],
    });
  });

  test("a pair that declares each other, and a word that is its own inverse", () => {
    const both = build(
      [
        FX("a"),
        FX("b"),
        FX("flip"),
        "META: a inverse b ; ;\nMETA: b inverse a ; ;\nMETA: flip inverse flip ; ;\n",
      ].join(""),
    ).help();
    expect(find(both, "t:a").inverse).toBe("t:b");
    expect(find(both, "t:b").inverse).toBe("t:a");
    expect(find(both, "t:flip").inverse).toBe("t:flip");
  });

  test("a conflict names both words", () => {
    const declares = (body: string) => () =>
      build([FX("a"), FX("b"), FX("c"), body].join("")).help();
    expect(declares("META: a inverse b ; ;\nMETA: b inverse c ; ;\n")).toThrow(
      "t:a declares t:b, but t:b declares t:c",
    );
    expect(declares("META: a inverse c ; ;\nMETA: b inverse c ; ;\n")).toThrow(
      /t:a and t:b both declare t:c/,
    );
    expect(declares("META: a inverse b ; ;\nMETA: b inverse b ; ;\n")).toThrow(/conflict/);
  });

  test("an inverse that is not an operation is an error", () => {
    const src2 = [
      FX("a"),
      ': two ( s:str -- str str ) "Two." doc "Fixture" category s dup ;\n',
      "META: a inverse two ; ;\n",
    ].join("");
    expect(() => build(src2).help()).toThrow("t:a: inverse t:two is not an operation");
  });

  test("the document: format, catalogue version, own version, sorted, optionDocs absent", () => {
    const b = build(src);
    expect(doc.format).toBe(HELP_FORMAT);
    expect(doc.catalogue).toBe(b.catalogue.version);
    expect(doc.version).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(doc)).toEqual(["format", "catalogue", "version", "ops"]);
    expect(Object.keys(doc.ops[0] as HelpOp)).toEqual([
      "qname",
      "useWhen",
      "links",
      "inverse",
      "examples",
    ]);
    expect(b.help()).toEqual(doc);
    expect(validateHelp(doc), ajv.errorsText(validateHelp.errors)).toBe(true);
  });

  test("a catalogue from another runtime is refused", () => {
    const a = build(FX("a"));
    const other = build(FX("a", "dup drop "));
    expect(() => buildHelp(a.runtime, other.catalogue, [])).toThrow(/not built from this runtime/);
  });

  test("the catalogue bytes do not depend on the discovery clauses", () => {
    const bare = build([FX("enc"), FX("dec"), FX("plain")].join("")).catalogue;
    const rich = build(src).catalogue;
    expect(JSON.stringify(rich)).toBe(JSON.stringify(bare));
  });
});

describe("buildHelp: examples", () => {
  const two = [FX("enc"), FX("dec"), "META: enc alias en ; ;\n"].join("");

  test("examples keep the file order and carry ref, params, input and expect as written", () => {
    const vs = [
      vector("t:enc", "First"),
      { ...vector("t:dec", "Other"), example: undefined },
      vector("t:enc", "Second", { expect: { error: "E_RANGE" }, ref: undefined, params: { n: 1 } }),
    ];
    const doc = build(two, vs).help();
    expect(doc.ops.map((o) => o.qname)).toEqual(["t:enc"]);
    const ex = find(doc, "t:enc").examples;
    expect(ex.map((e) => e.title)).toEqual(["First", "Second"]);
    expect(ex[0]).toEqual({
      title: "First",
      note: "A note.",
      ref: "RFC 0",
      params: {},
      input: { value: "abc", enc: "utf8" },
      expect: { value: "ABC", enc: "utf8" },
    });
    expect(ex[1]).toMatchObject({ ref: null, params: { n: 1 }, expect: { error: "E_RANGE" } });
    expect(validateHelp(doc), ajv.errorsText(validateHelp.errors)).toBe(true);
  });

  test("a vector without a note gives note null; an alias name is resolved", () => {
    const v = vector("t:en", "Via alias", { example: { title: "Via alias" } });
    const ex = find(build(two, [v]).help(), "t:enc").examples;
    expect(ex).toHaveLength(1);
    expect(ex[0]?.note).toBeNull();
  });

  test("a fourth example for one op fails, three pass; another op has its own count", () => {
    const three = ["A", "B", "C"].map((t) => vector("t:enc", t));
    expect(find(build(two, three).help(), "t:enc").examples).toHaveLength(3);
    expect(() => build(two, [...three, vector("t:enc", "D")]).help()).toThrow(
      "t.test.json[3]: t:enc has more than 3 examples",
    );
    expect(() => build(two, [...three, vector("t:dec", "D")]).help()).not.toThrow();
  });

  test("a repeated title for one op fails", () => {
    expect(() => build(two, [vector("t:enc", "Same"), vector("t:enc", "Same")]).help()).toThrow(
      /t.test.json\[1\].*"Same" is used twice/,
    );
  });

  test("an oversize input, parameter or expected value fails", () => {
    const big = "x".repeat(2049);
    const enc = (value: string) => ({ value, enc: "utf8" });
    expect(() => build(two, [vector("t:enc", "A", { input: enc(big) })]).help()).toThrow(
      /input.value is over 2048/,
    );
    expect(() => build(two, [vector("t:enc", "A", { params: { k: enc(big) } })]).help()).toThrow(
      /param k is over 2048/,
    );
    expect(() => build(two, [vector("t:enc", "A", { expect: enc(big) })]).help()).toThrow(
      /expect.value is over 2048/,
    );
    expect(() =>
      build(two, [vector("t:enc", "A", { input: enc("x".repeat(2048)) })]).help(),
    ).not.toThrow();
  });

  test("an example on something that is not an operation, or without a title, fails", () => {
    expect(() => build(two, [vector("t:nope", "A")]).help()).toThrow(
      /t.test.json\[0\].*t:nope.*not an operation/,
    );
    expect(() => build(two, [vector("t:enc", "A", { example: { note: "x" } })]).help()).toThrow(
      /needs a non-empty title/,
    );
  });

  test("ordinary vectors are ignored, even for words that are not operations", () => {
    const v = { ...vector("t:nope", "A"), example: undefined };
    expect(build(two, [v]).help().ops).toEqual([]);
  });
});

describe("buildHelp: option help of shared choice types", () => {
  const src = [
    'CHOICE: pad\n  option pkcs7 "PKCS#7 padding." ;\n  option none ;\n  option zero "Zero padding." ;\n;\n',
    "CHOICE: plain\n  option a ;\n  option b ;\n;\n",
    ': enc ( s:str p:choice<pad>=pkcs7 q:choice<plain>=a r:choice<pad>=none -- str ) "enc." doc "Fixture" category s ;\n',
    ': plain-op ( s:str q:choice<plain>=a -- str ) "plain." doc "Fixture" category s ;\n',
    FX("bare"),
  ].join("");
  const { help, catalogue } = build(src);
  const doc = help();

  test("an op with option help gets optionDocs per parameter; options without help are omitted", () => {
    const op = find(doc, "t:enc");
    expect(op.optionDocs).toEqual({
      p: { pkcs7: "PKCS#7 padding.", zero: "Zero padding." },
      r: { pkcs7: "PKCS#7 padding.", zero: "Zero padding." },
    });
    expect(Object.keys(op)).toEqual([
      "qname",
      "useWhen",
      "links",
      "inverse",
      "optionDocs",
      "examples",
    ]);
  });

  test("ops whose types have no help, and ops without types, are left out", () => {
    expect(doc.ops.map((o) => o.qname)).toEqual(["t:enc"]);
  });

  test("the document validates and the catalogue params still carry the plain options", () => {
    expect(validateHelp(doc), ajv.errorsText(validateHelp.errors)).toBe(true);
    const enc = catalogue.ops.find((o) => o.qname === "t:enc");
    expect(enc?.params.map((p) => p.options)).toEqual([
      ["pkcs7", "none", "zero"],
      ["a", "b"],
      ["pkcs7", "none", "zero"],
    ]);
    expect(JSON.stringify(enc)).not.toContain("PKCS#7 padding.");
  });
});

describe("help.schema.json", () => {
  const good: HelpDoc = {
    format: 1,
    catalogue: "0123456789abcdef",
    version: "fedcba9876543210",
    ops: [{ qname: "t:enc", useWhen: null, links: [], inverse: null, examples: [] }],
  };

  test("accepts a document, and optionDocs when a later package adds them", () => {
    expect(validateHelp(good)).toBe(true);
    const op = { ...(good.ops[0] as HelpOp), optionDocs: { mode: { a: "Option a." } } };
    expect(validateHelp({ ...good, ops: [op] }), ajv.errorsText(validateHelp.errors)).toBe(true);
  });

  test("rejects broken documents", () => {
    const op = good.ops[0] as HelpOp;
    const example = {
      title: "T",
      note: null,
      ref: null,
      params: {},
      input: { value: "", enc: "utf8" },
      expect: { value: "", enc: "utf8" },
    };
    const link = (url: string) => ({ url, label: null });
    const broken: unknown[] = [
      { ...good, format: 2 },
      { ...good, extra: 1 },
      { ...good, catalogue: "xyz" },
      { ...good, ops: [{ ...op, extra: 1 }] },
      { ...good, ops: [{ ...op, qname: "no colon" }] },
      { ...good, ops: [{ ...op, useWhen: "x".repeat(161) }] },
      { ...good, ops: [{ ...op, useWhen: "two\nlines" }] },
      { ...good, ops: [{ ...op, links: [link("http://example.com/")] }] },
      { ...good, ops: [{ ...op, links: [link("javascript:alert(1)")] }] },
      {
        ...good,
        ops: [
          { ...op, links: Array.from({ length: 9 }, (_, i) => link(`https://example.com/${i}`)) },
        ],
      },
      { ...good, ops: [{ ...op, examples: [example, example, example, example] }] },
      { ...good, ops: [{ ...op, examples: [{ ...example, title: "" }] }] },
      {
        ...good,
        ops: [
          { ...op, examples: [{ ...example, input: { value: "x".repeat(2049), enc: "utf8" } }] },
        ],
      },
    ];
    for (const doc of broken) expect(validateHelp(doc)).toBe(false);
  });
});

describe("the bundled help document", () => {
  const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  const vocabDir = `${here.slice(0, here.lastIndexOf("/"))}/../vocab`;
  const runtime = bundleRuntime;
  const catalogue = buildCatalogue(runtime);
  const files = readdirSync(vocabDir)
    .filter((f) => f.endsWith(".test.json"))
    .sort()
    .map((f) => ({
      vocab: f.slice(0, -".test.json".length),
      vectors: JSON.parse(readFileSync(`${vocabDir}/${f}`, "utf8")) as unknown[],
    }));
  const doc = buildHelp(runtime, catalogue, files);

  test("builds, validates, and is under the size budget", () => {
    expect(doc.catalogue).toBe(catalogue.version);
    expect(validateHelp(doc), ajv.errorsText(validateHelp.errors)).toBe(true);
    expect(JSON.stringify(doc, null, 2).length).toBeLessThan(HELP_MAX_BYTES);
    const names = doc.ops.map((o) => o.qname);
    expect(names).toEqual([...names].sort());
  });

  test("every inverse is a catalogue op and the relation is symmetric", () => {
    const ops = new Set(catalogue.ops.map((o) => o.qname));
    for (const op of doc.ops) {
      if (op.inverse === null) continue;
      expect(ops.has(op.inverse), op.qname).toBe(true);
      expect(find(doc, op.inverse).inverse, op.qname).toBe(op.qname);
    }
  });

  // Ratchet: a later batch of discovery text raises these two numbers, never lowers them.
  const MIN_WITH_USE_WHEN = 201;
  const MIN_WITH_EXAMPLE = 193;

  test("ratchet: ops with a use-when and ops with an example do not fall", () => {
    expect(doc.ops.filter((o) => o.useWhen !== null).length).toBeGreaterThanOrEqual(
      MIN_WITH_USE_WHEN,
    );
    expect(doc.ops.filter((o) => o.examples.length > 0).length).toBeGreaterThanOrEqual(
      MIN_WITH_EXAMPLE,
    );
  });
});
