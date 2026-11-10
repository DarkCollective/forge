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
import { beforeAll, describe, expect, test } from "vitest";
import { assembleRuntime, buildCatalogue } from "@forge/ops";
import type { Catalogue } from "@forge/ops";
import { loadBundleNode } from "@forge/ops/node";
import { checkWordName, definedWords, flString, promoteToWord } from "./promote.js";

type Bundle = Awaited<ReturnType<typeof loadBundleNode>>;
let bundle: Bundle;
let catalogue: Catalogue;

beforeAll(async () => {
  bundle = await loadBundleNode("all");
  catalogue = buildCatalogue(assembleRuntime(bundle), { bundleVocabs: bundle.vocabs });
});

const recipe = {
  forge: 1,
  steps: [{ kind: "op", op: "classical:rot", params: { amount: 5 } }],
} as const;

function catalogueWith(source: string): Catalogue {
  const warnings: string[] = [];
  const rt = assembleRuntime(bundle, { units: [{ name: "user", source }] });
  return buildCatalogue(rt, { bundleVocabs: bundle.vocabs, warn: (m: string) => warnings.push(m) });
}

describe("flString", () => {
  test("escapes quotes and backslashes", () => {
    expect(flString('say "hi" \\ now')).toBe('"say \\"hi\\" \\\\ now"');
  });
});

describe("checkWordName", () => {
  test("accepts lower-kebab-case", () => {
    expect(checkWordName("my-word-2", "")).toBeNull();
  });
  test.each(["", "My", "2x", "a_b", "a b", "-a", "a".repeat(65)])("rejects %j", (n) => {
    expect(checkWordName(n, "")).not.toBeNull();
  });
  test("rejects a name already defined", () => {
    expect(checkWordName("foo", "IN: user\n: foo ( -- ) ;\n")).toMatch(/already defined/);
    expect(definedWords("IN: user\n: foo ( -- ) ;\n: bar ( -- ) ;")).toEqual(
      new Set(["foo", "bar"]),
    );
  });
});

describe("promoteToWord", () => {
  test("creates the header for an empty source and the word becomes an op", () => {
    const r = promoteToWord({
      recipe,
      catalogue,
      name: "rot-five",
      doc: "Rotate by five",
      userSource: "",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.word).toBe("user:rot-five");
    expect(r.source.startsWith("IN: user\n")).toBe(true);
    const lines = r.source.split("\n");
    const header = lines.findIndex((l) => l.startsWith(": rot-five "));
    expect(lines[header + 1]).toBe('  "Rotate by five" doc');
    expect(lines[header + 2]).toBe('  "User recipes" category');

    const cat = catalogueWith(r.source);
    const op = cat.ops.find((o) => o.qname === "user:rot-five");
    expect(op).toBeDefined();
    expect(op?.input).toBe("bytes");
    expect(op?.output).toBe("any");
    expect(op?.doc).toBe("Rotate by five");
    expect(op?.category).toBe("User recipes");
  });

  test("appends to an existing user source and keeps both words", () => {
    const first = promoteToWord({ recipe, catalogue, name: "one", doc: "First", userSource: "" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = promoteToWord({
      recipe,
      catalogue,
      name: "two",
      doc: "Second",
      category: "Mine",
      userSource: first.source,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.source.startsWith(first.source)).toBe(true);
    const cat = catalogueWith(second.source);
    expect(cat.ops.find((o) => o.qname === "user:one")).toBeDefined();
    expect(cat.ops.find((o) => o.qname === "user:two")?.category).toBe("Mine");
  });

  test("quotes and backslashes in the doc survive loading", () => {
    const doc = 'Say "hi" and use a \\ backslash';
    const r = promoteToWord({ recipe, catalogue, name: "quoted", doc, userSource: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(catalogueWith(r.source).ops.find((o) => o.qname === "user:quoted")?.doc).toBe(doc);
  });

  test("a recipe with parameters compiles them into the word", () => {
    const r = promoteToWord({
      recipe: { forge: 1, steps: [{ kind: "op", op: "classical:rot", params: { amount: 7 } }] },
      catalogue,
      name: "seven",
      doc: "Seven",
      userSource: "",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain("7 classical:rot");
  });

  test("refuses a clashing name, control characters and bad input", () => {
    const first = promoteToWord({ recipe, catalogue, name: "dup", doc: "d", userSource: "" });
    if (!first.ok) throw new Error("setup");
    const clash = promoteToWord({
      recipe,
      catalogue,
      name: "dup",
      doc: "d",
      userSource: first.source,
    });
    expect(clash).toMatchObject({ ok: false });
    expect(
      promoteToWord({ recipe, catalogue, name: "x", doc: "a\nb", userSource: "" }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      promoteToWord({ recipe, catalogue, name: "x", doc: "  ", userSource: "" }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      promoteToWord({
        recipe,
        catalogue,
        name: "x",
        doc: "d",
        category: "a\u0007",
        userSource: "",
      }),
    ).toMatchObject({ ok: false });
    expect(
      promoteToWord({ recipe, catalogue, name: "x", doc: "d", userSource: ": foo ( -- ) ;" }),
    ).toMatchObject({ ok: false });
    expect(
      promoteToWord({
        recipe: { forge: 1, steps: [{ kind: "op", op: "no:such" }] },
        catalogue,
        name: "x",
        doc: "d",
        userSource: "",
      }),
    ).toMatchObject({ ok: false });
  });
});
