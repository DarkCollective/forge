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
 * P1c: merge equality (PACKS.md section 5.2). For every subset of the fixture packs that is closed under `requires`,
 * the core catalogue merged with the fragments of the subset equals the catalogue of one runtime built from core plus
 * the subset: ops, vocabularies, conversions and version.
 */
import { sha256 } from "@forge/lang";
import { assembleRuntime, buildCatalogue, catalogueVersionOf } from "@forge/ops";
import type { Catalogue, CatalogueConversion } from "@forge/ops";
import { describe, expect, test } from "vitest";
import { mergeCatalogues } from "../src/merge.js";

interface FixturePack {
  readonly id: string;
  readonly requires: readonly string[];
  readonly vocabs: readonly string[];
  readonly internal: readonly string[];
  readonly units: readonly { name: string; source: string }[];
  readonly conversions: readonly CatalogueConversion[];
}

const op = (name: string, body: string) =>
  `: ${name} ( s:str -- str ) "An op." doc "Fixture" category ${body} ;\n`;

const CORE_UNITS = [
  { name: "cx.fth", source: `IN: cx\n${op("shout", "s upper")}${op("same", "s")}` },
];

/** a: two vocabularies, one internal. b requires a and calls its words. c is independent and declares a conversion. */
const PACKS: readonly FixturePack[] = [
  {
    id: "a",
    requires: [],
    vocabs: ["a1", "a1x"],
    internal: ["a1x"],
    units: [
      { name: "a1x.fth", source: `IN: a1x\n${op("helper", "s upper")}` },
      { name: "a1.fth", source: `IN: a1\n${op("loud", "s a1x:helper")}${op("plain", "s")}` },
    ],
    conversions: [],
  },
  {
    id: "b",
    requires: ["a"],
    vocabs: ["b1"],
    internal: [],
    units: [{ name: "b1.fth", source: `IN: b1\n${op("louder", "s a1:loud a1:loud")}` }],
    conversions: [],
  },
  {
    id: "c",
    requires: [],
    vocabs: ["c1"],
    internal: [],
    units: [
      {
        name: "c1.fth",
        source: `IN: c1\n: size ( s:str -- int ) "Length." doc "Fixture" category drop 3 ;\n`,
      },
    ],
    conversions: [{ from: "str", to: "int", op: "c1:size" }],
  },
];
const [PA, PB, PC] = PACKS as [FixturePack, FixturePack, FixturePack];
const byId = new Map(PACKS.map((p) => [p.id, p]));

/** The pack and its required closure, in the order of `PACKS`. */
function closure(ids: readonly string[]): FixturePack[] {
  const out = new Set<string>();
  const add = (id: string): void => {
    for (const r of (byId.get(id) as FixturePack).requires) add(r);
    out.add(id);
  };
  ids.forEach(add);
  return PACKS.filter((p) => out.has(p.id));
}

const isClosed = (subset: readonly FixturePack[]): boolean =>
  subset.every((p) => p.requires.every((r) => subset.some((q) => q.id === r)));

const runtimeOf = (packs: readonly FixturePack[]) =>
  assembleRuntime(
    { vocabs: [], units: [], primitives: [] },
    { units: [...CORE_UNITS, ...packs.flatMap((p) => p.units)] },
  );

/** What `packs:gen` step 6 does: one runtime of core, the pack and its required packs, keeping the pack's ops. */
function fragmentOf(pack: FixturePack): Catalogue {
  return buildCatalogue(runtimeOf(closure([pack.id])), {
    internalVocabs: pack.internal,
    onlyVocabs: pack.vocabs,
    conversions: pack.conversions,
  });
}

const coreCatalogue = buildCatalogue(runtimeOf([]));

/** All 2^3 subsets of the fixture packs, in pack order. */
const subsets: FixturePack[][] = PACKS.reduce<FixturePack[][]>(
  (acc, p) => [...acc, ...acc.map((s) => [...s, p])],
  [[]],
);
const label = (s: readonly FixturePack[]) => s.map((p) => p.id).join("+") || "core";

describe("merge equality", () => {
  const closed = subsets.filter(isClosed);

  test("the fixture has 6 closed subsets of 8; {b} and {b, c} are not closed", () => {
    expect(closed).toHaveLength(6);
    expect(subsets.filter((s) => !isClosed(s)).map(label)).toEqual(["b", "b+c"]);
  });

  test.each(closed.map((s) => [label(s), s] as const))(
    "%s: merge equals one runtime",
    (_name, subset) => {
      const merged = mergeCatalogues(coreCatalogue, subset.map(fragmentOf));
      const whole = buildCatalogue(runtimeOf(subset), {
        internalVocabs: subset.flatMap((p) => p.internal),
        conversions: subset.flatMap((p) => p.conversions),
      });
      expect(merged).toEqual(whole);
      expect(merged.version).toBe(whole.version);
      expect(merged.conversions).toEqual(whole.conversions);
      expect(JSON.stringify(merged)).toBe(JSON.stringify(whole));
    },
  );

  test("a fragment holds only the pack's own non-internal ops", () => {
    expect(fragmentOf(PA).ops.map((o) => o.qname)).toEqual(["a1:loud", "a1:plain"]);
    expect(fragmentOf(PB).ops.map((o) => o.qname)).toEqual(["b1:louder"]);
    expect(fragmentOf(PA).vocabs).toEqual(["a1"]);
  });

  test("an op entry, hash included, does not depend on which other packs are enabled", () => {
    const entry = (subset: FixturePack[], q: string) =>
      mergeCatalogues(coreCatalogue, subset.map(fragmentOf)).ops.find((o) => o.qname === q);
    expect(entry([PA, PB], "b1:louder")).toEqual(entry([PA, PB, PC], "b1:louder"));
    expect(entry([PA], "a1:loud")).toEqual(entry([PA, PB, PC], "a1:loud"));
    expect(entry([PA], "a1:loud")).toBeDefined();
  });

  test("the versions differ per enabled set, and core alone is the core version", () => {
    const versions = closed.map((s) => mergeCatalogues(coreCatalogue, s.map(fragmentOf)).version);
    expect(versions[0]).toBe(coreCatalogue.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe("catalogueVersionOf and the merge rules", () => {
  test("core alone merges to itself, in version and content", () => {
    expect(mergeCatalogues(coreCatalogue, [])).toEqual(coreCatalogue);
    expect(coreCatalogue.version).toBe(catalogueVersionOf(coreCatalogue.ops));
  });

  test("the version is the first 16 hex digits of sha256 over the ops text", () => {
    expect(catalogueVersionOf(coreCatalogue.ops)).toBe(
      sha256(JSON.stringify(coreCatalogue.ops)).slice(0, 16),
    );
  });

  test("the baker's skew check: a filtered op list has the version of a catalogue of those ops", () => {
    const merged = mergeCatalogues(coreCatalogue, [fragmentOf(PA), fragmentOf(PC)]);
    const part = merged.ops.filter((o) => o.vocab === "a1" || o.vocab === "cx");
    expect(catalogueVersionOf(part)).toBe(
      buildCatalogue(runtimeOf([PA]), { internalVocabs: ["a1x"] }).version,
    );
  });

  test("conversions are not part of the version", () => {
    const frag = fragmentOf(PC);
    const bare = buildCatalogue(runtimeOf([PC]), { onlyVocabs: ["c1"] });
    expect(frag.conversions).toHaveLength(1);
    expect(bare).not.toHaveProperty("conversions");
    expect(frag.version).toBe(bare.version);
  });

  test("conversions are concatenated in pack order, after the core's", () => {
    const conv = (op: string): CatalogueConversion => ({ from: "str", to: "int", op });
    const x: Catalogue = { ...coreCatalogue, conversions: [conv("cx:k")] };
    const f1: Catalogue = { ...fragmentOf(PA), conversions: [conv("a1:k")] };
    const f2: Catalogue = { ...fragmentOf(PC), conversions: [conv("c1:k")] };
    expect(mergeCatalogues(x, [f1, f2]).conversions?.map((c) => c.op)).toEqual([
      "cx:k",
      "a1:k",
      "c1:k",
    ]);
  });

  test("the same op in two inputs, or a foreign format, is refused", () => {
    const a = fragmentOf(PA);
    expect(() => mergeCatalogues(coreCatalogue, [a, a])).toThrow(/a1:loud is in more than one/);
    expect(() => mergeCatalogues({ ...coreCatalogue, format: 2 as never }, [])).toThrow(/format 2/);
  });

  test("internalVocabs adds to the built-in list and onlyVocabs narrows to the named ones", () => {
    const rt = runtimeOf(PACKS);
    expect(buildCatalogue(rt).vocabs).toContain("a1x");
    expect(buildCatalogue(rt, { internalVocabs: ["a1x"] }).vocabs).not.toContain("a1x");
    expect(buildCatalogue(rt, { onlyVocabs: ["c1"] }).vocabs).toEqual(["c1"]);
    expect(buildCatalogue(rt, { onlyVocabs: ["a1x"], internalVocabs: ["a1x"] }).ops).toEqual([]);
  });
});
