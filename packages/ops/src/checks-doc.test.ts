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

import { WORD_META_SCHEMA } from "@forge/lang";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { buildChecks } from "./checks-doc.js";
import schema from "./checks.schema.json" with { type: "json" };
import { loadBundleNode } from "./sources-node.js";
import { CHECKS_FORMAT, CHECKS_MAX_BYTES } from "./types.js";

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(WORD_META_SCHEMA);
const validate = ajv.compile(schema);

const empty = { vocabs: [], units: [], primitives: [] };
const FX = (name: string, extra = ""): string =>
  `: ${name} ( s:str -- str ) "${name}." doc "Fixture" category s ${extra};\n`;

function build(source: string) {
  const runtime = assembleRuntime(empty, {
    units: [{ name: "t.fth", source: `IN: t\n${source}` }],
  });
  const catalogue = buildCatalogue(runtime);
  return { runtime, catalogue, doc: () => buildChecks(runtime, catalogue) };
}

const SRC = [
  FX("gunzip"),
  FX("plain"),
  FX("later"),
  FX("_hidden"),
  'META: gunzip expects "gzip data" ; checks input magic-bytes format "gzip" ; checks input binary ; checks output utf8 ; ;\n',
  'META: later checks input charset "a-z" 0.5 ; checks input entropy 0 4.5 ; ;\n',
].join("");

describe("buildChecks", () => {
  const b = build(SRC);
  const doc = b.doc();

  test("keys the clauses by qname and leaves out ops with none", () => {
    expect(Object.keys(doc.ops)).toEqual(["t:gunzip", "t:later"]);
    expect(doc.ops["t:gunzip"]).toEqual({
      expects: "gzip data",
      checks: [
        { scope: "input", test: { kind: "magic-bytes", format: "gzip" } },
        { scope: "input", test: { kind: "binary" } },
        { scope: "output", test: { kind: "utf8" } },
      ],
    });
    expect(doc.ops["t:later"]).toEqual({
      expects: null,
      checks: [
        { scope: "input", test: { kind: "charset", alphabet: "a-z", min: 0.5 } },
        { scope: "input", test: { kind: "entropy", min: 0, max: 4.5 } },
      ],
    });
  });

  test("records the format, the catalogue version it was built for and its own version", () => {
    expect(doc.format).toBe(CHECKS_FORMAT);
    expect(doc.catalogue).toBe(b.catalogue.version);
    expect(doc.version).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(doc)).toEqual(["format", "catalogue", "version", "ops"]);
  });

  test("is valid against checks.schema.json and fits the budget", () => {
    expect(validate(doc), ajv.errorsText(validate.errors)).toBe(true);
    expect(JSON.stringify(doc).length).toBeLessThan(CHECKS_MAX_BYTES);
  });

  test("the schema refuses a malformed check", () => {
    const bad = {
      ...doc,
      ops: { "t:x": { expects: null, checks: [{ scope: "input", test: { kind: "zip" } }] } },
    };
    expect(validate(bad)).toBe(false);
  });

  test("checks and expects change neither the catalogue version nor a word hash", () => {
    const plain = build([FX("gunzip"), FX("plain"), FX("later"), FX("_hidden")].join(""));
    expect(b.catalogue.version).toBe(plain.catalogue.version);
    for (const q of ["t:gunzip", "t:later", "t:plain"]) {
      expect(b.runtime.meta(q).hash).toBe(plain.runtime.meta(q).hash);
    }
    expect(JSON.stringify(b.catalogue.ops)).toBe(JSON.stringify(plain.catalogue.ops));
  });

  test("a document of a different runtime is refused", () => {
    const other = build(FX("other"));
    expect(() => buildChecks(b.runtime, other.catalogue)).toThrow(/not built from this runtime/);
  });

  test("the version follows the content", () => {
    const changed = build(SRC + 'META: plain expects "text" ; ;\n').doc();
    expect(changed.version).not.toBe(doc.version);
    expect(changed.catalogue).toBe(doc.catalogue);
  });
});

describe("the bundled vocabularies", () => {
  test("build a valid checks document for the whole catalogue", async () => {
    const runtime = assembleRuntime(await loadBundleNode("all"));
    const catalogue = buildCatalogue(runtime, { warn: () => undefined });
    const doc = buildChecks(runtime, catalogue);
    expect(validate(doc), ajv.errorsText(validate.errors)).toBe(true);
    expect(doc.catalogue).toBe(catalogue.version);
  });
});
