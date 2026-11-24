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
// "Suggested next" (T58, F1): the ranking over the real catalogue and checks of the build, and over small
// fixture catalogues for the cases no real op exists for yet (a relation).
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { CatalogueOp, ChecksDoc } from "@forge/ops";
import * as checks from "@forge/ops/checks";
import { describe, expect, test } from "vitest";
import { makeEvaluator } from "./checks-data.js";
import type { ChecksIndex } from "./checks-data.js";
import { analyseContent, contentBytesAtEnd } from "./content.js";
import type { DataFacts } from "./fit.js";
import { SUGGESTED_CAP, buildListModel } from "./group.js";
import { rankSuggestions, suggestNext } from "./suggest.js";

const read = <T>(file: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../../../packages/ops/dist/${file}`, import.meta.url), "utf8"),
  ) as T;
const ops = read<{ ops: CatalogueOp[] }>("catalogue.json").ops;
const doc = read<ChecksDoc>("checks.json");
const index: ChecksIndex = {
  get: (q) => doc.ops[q],
  entries: () => Object.entries(doc.ops)[Symbol.iterator](),
  size: Object.keys(doc.ops).length,
};
const evaluator = makeEvaluator(checks);

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** What the drawer computes for bytes: the facts and the content view. */
function forBytes(bytes: Uint8Array): {
  facts: DataFacts;
  content: ReturnType<typeof analyseContent>;
} {
  let valid = true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    valid = false;
  }
  const utf8 = valid ? "valid" : "invalid";
  const facts: DataFacts = { type: "bytes", utf8 };
  return { facts, content: analyseContent({ bytes, utf8 }, index, evaluator) };
}

const names = (list: readonly CatalogueOp[]): string[] => list.map((o) => o.qname);

describe("suggestions on the real catalogue", () => {
  test("raw text: only ops that can take text, capped, and none is red", () => {
    const { facts, content } = forBytes(text("just some plain words, nothing special"));
    const list = suggestNext(ops, facts, content);
    expect(list.length).toBe(SUGGESTED_CAP);
    for (const op of list) {
      expect(["bytes", "str", "any"]).toContain(op.input);
    }
    // No decoder claims plain words ahead of an op that passed its check.
    expect(names(list)).not.toContain("deflate:gunzip");
  });

  test("base64 text puts the base64 decoder first", () => {
    const { facts, content } = forBytes(text("SGVsbG8sIFdvcmxkISBIZWxsbywgV29ybGQh"));
    expect(names(suggestNext(ops, facts, content))[0]).toBe("base64:decode");
  });

  test("gzip data puts gunzip first, and text-only ops are left out", () => {
    const { facts, content } = forBytes(new Uint8Array(gzipSync(Buffer.from("hello hello hello"))));
    const all = rankSuggestions(ops, facts, content);
    expect(names(all)[0]).toBe("deflate:gunzip");
    expect(names(suggestNext(ops, facts, content))).toContain("deflate:gunzip");
    // The data is not valid text: an op that needs text (str) is red and never listed.
    const str = ops.find((o) => o.input === "str" && o.category !== null);
    expect(str).toBeDefined();
    expect(names(all)).not.toContain(str?.qname);
  });

  test("a table suggests the table words and nothing that needs bytes or text", () => {
    const facts: DataFacts = { type: "ext{table}", utf8: "unknown", shape: "4 columns, 250 rows" };
    const all = rankSuggestions(ops, facts, null);
    expect(names(all)).toEqual(expect.arrayContaining(["table:to-csv", "table:to-json"]));
    for (const op of all) {
      expect(op.input === "ext" || op.input === "any").toBe(true);
    }
  });

  test("an empty input is empty text: suggestions still come", () => {
    const { facts, content } = forBytes(new Uint8Array(0));
    expect(suggestNext(ops, facts, content).length).toBe(SUGGESTED_CAP);
  });

  test("an unknown data type suggests nothing", () => {
    expect(suggestNext(ops, { type: "unknown", utf8: "unknown" }, null)).toEqual([]);
  });
});

function fixture(qname: string, over: Partial<CatalogueOp>): CatalogueOp {
  const colon = qname.indexOf(":");
  return {
    qname,
    name: qname.slice(colon + 1),
    vocab: qname.slice(0, colon),
    category: "Fixture",
    doc: null,
    aliases: [],
    seeAlso: [],
    input: "bytes",
    output: "bytes",
    effect: "( bytes -- bytes )",
    params: [],
    effects: [],
    version: "1",
    hash: "h",
    needsHardKill: false,
    ...over,
  };
}

describe("suggestions on a fixture catalogue", () => {
  const select = fixture("relix:select", {
    input: "ext",
    inputKind: "relation",
    output: "ext",
    outputKind: "relation",
  } as Partial<CatalogueOp>);
  const lift = fixture("relix:from-table", {
    input: "ext",
    inputKind: "table",
    output: "ext",
    outputKind: "relation",
  } as Partial<CatalogueOp>);
  const upper = fixture("str:upper", { input: "str", output: "str" });
  const anyOp = fixture("misc:size", { input: "any", output: "int" });
  const fixtureOps = [upper, select, lift, anyOp];

  test("a relation suggests the relational operators, with nothing special for them", () => {
    const facts: DataFacts = { type: "ext{relation}", utf8: "unknown" };
    expect(names(suggestNext(fixtureOps, facts, null))).toEqual(["relix:select", "misc:size"]);
  });

  test("a table suggests the op that lifts it, not the relational ones", () => {
    const facts: DataFacts = { type: "ext{table}", utf8: "unknown" };
    expect(names(suggestNext(fixtureOps, facts, null))).toEqual(["relix:from-table", "misc:size"]);
  });

  test("green comes before amber, and a passed check before an unchecked op", () => {
    const a = fixture("a:one", { input: "str" });
    const b = fixture("b:two", { input: "bytes" });
    const c = fixture("c:three", { input: "bytes" });
    const facts: DataFacts = { type: "bytes", utf8: "unknown" };
    // a converts (bytes to str, utf8 unknown: amber); c's check passed; b has none.
    const content = {
      identification: null,
      rows: new Map([["c:three", { result: "pass" as const, text: "Expects x" }]]),
    };
    expect(names(rankSuggestions([a, b, c], facts, content))).toEqual([
      "c:three",
      "b:two",
      "a:one",
    ]);
    // A failed check makes a green row amber: it drops below the unchecked green one.
    const failed = {
      identification: null,
      rows: new Map([["b:two", { result: "fail" as const, text: "Expects x" }]]),
    };
    expect(names(rankSuggestions([a, b, c], facts, failed))).toEqual(["c:three", "a:one", "b:two"]);
  });

  test("the group tops the browse view and the search view, and is not counted as matches", () => {
    const many = Array.from({ length: 12 }, (_, i) => fixture(`m:op${i}`, {}));
    const list = rankSuggestions(many, { type: "bytes", utf8: "valid" }, null);
    const browse = buildListModel(many, [], "", new Map(), undefined, list);
    expect(browse.sections[0]?.kind).toBe("suggested");
    expect(browse.sections[0]?.ops.length).toBe(SUGGESTED_CAP);
    expect(browse.sections[0]?.collapsed).toBe(false);
    expect(browse.visible.length).toBe(SUGGESTED_CAP);
    expect(browse.total).toBe(12);
    const search = buildListModel(many, [], "op1", new Map(), undefined, list);
    expect(search.sections.map((s) => s.kind)).toEqual(["suggested", "results"]);
    expect(names(search.sections[0]?.ops ?? [])).toEqual(["m:op1", "m:op10", "m:op11"]);
    expect(search.total).toBe(3);
    const none = buildListModel(many, [], "zzzz", new Map(), undefined, list);
    expect(none.sections.map((s) => s.kind)).toEqual(["results"]);
  });
});

describe("contentBytesAtEnd feeds the same view the suggestions read", () => {
  test("an empty recipe reads the input", () => {
    const bytes = text("hi");
    expect(
      contentBytesAtEnd({
        recipe: { steps: [] } as never,
        bake: { result: null, stale: false },
        ops,
        inputBytes: bytes,
      }),
    ).toBe(bytes);
  });
});
