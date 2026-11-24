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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Ajv compiles schemas with `new Function`, which the production CSP forbids: it is used by the tests only.
import Ajv2020 from "ajv/dist/2020";
import { CORE_EXT_KINDS, listExtKinds } from "@forge/lang";
import { INTERNAL_VOCABS } from "@forge/ops";
import { describe, expect, test } from "vitest";
import schema from "../src/manifest.schema.json";
import {
  CORE_KIND_NAMES,
  CORE_VOCAB_NAMES,
  LICENCE_ALLOW_LIST,
  MANIFEST_EFFECTS,
  PACK_API,
  RESERVED_PACK_IDS,
  validateManifest,
  type ManifestCheckCode,
} from "../src/index.js";
import { structuralProblems } from "../src/structure.js";
import { fixtureContext, invalidFiles, validFiles } from "./corpus.js";

const ajv = new Ajv2020({ strict: true, allErrors: false });
const ajvValidate = ajv.compile(schema);

const IMPLEMENTED: readonly ManifestCheckCode[] = [
  "schema",
  "id-dir",
  "id-reserved",
  "vocab-clash",
  "kind-clash",
  "kind-reserved",
  "entry-missing",
  "requires-unknown",
  "requires-cycle",
  "requires-api",
  "licence-list",
];

const codesOf = (r: ReturnType<typeof validateManifest>): string[] => [
  ...new Set(r.problems.map((p) => p.code)),
];

describe("the corpus of PACKS 10.1", () => {
  const valid = validFiles();
  const invalid = invalidFiles();

  test("the three manifests of PACKS are valid fixtures", () => {
    const names = valid.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["valid/relix.json", "valid/demo.json", "valid/media.json"]),
    );
  });

  test.each(valid.map((f) => [f.name, f] as const))("%s validates", (_n, f) => {
    const r = validateManifest(f.manifest, fixtureContext(f));
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(ajvValidate(f.manifest)).toBe(true);
  });

  test.each(invalid.map((f) => [f.name, f] as const))("%s fails with exactly its code", (_n, f) => {
    const r = validateManifest(f.manifest, fixtureContext(f));
    expect(r.ok).toBe(false);
    expect(codesOf(r)).toEqual([f.code]);
    // The schema cases are decided by the JSON Schema too, except the paths the validator refuses on top of it.
    if (f.code === "schema" && !f.name.includes("x06") && !f.name.includes("x07")) {
      expect(ajvValidate(f.manifest)).toBe(false);
    }
  });

  test("every check this package decides has at least one invalid file", () => {
    const have = new Set(invalid.map((f) => f.code));
    for (const code of IMPLEMENTED) expect(have, code).toContain(code);
    for (const code of have) expect(IMPLEMENTED, code).toContain(code);
  });

  test("the corpus counts", () => {
    expect(valid.length).toBeGreaterThanOrEqual(7);
    expect(invalid.length).toBeGreaterThanOrEqual(50);
    // PC01 to PC14 of section 10.1 are all there.
    for (let i = 1; i <= 14; i++) {
      const pc = `pc${String(i).padStart(2, "0")}-`;
      expect(
        invalid.some((f) => f.name.includes(`schema--${pc}`)),
        pc,
      ).toBe(true);
    }
    // One file per reserved kind name, as section 10.1 asks.
    for (const k of ["table", "null", "array"])
      expect(invalid.some((f) => f.name === `invalid/kind-reserved--${k}.json`)).toBe(true);
  });
});

describe("the schema file", () => {
  test("is the schema of PACKS 2.2 and compiles under Ajv strict mode", () => {
    expect(schema.$id).toBe("urn:forge:schema:pack-manifest:1");
    expect(() => new Ajv2020({ strict: true }).compile(schema)).not.toThrow();
  });

  test("closes every object it describes (additionalProperties: false)", () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string, branch: boolean): void => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${path}/${i}`, branch));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const o = node as Record<string, unknown>;
      // A `then` or `if` branch adds a requirement to an object that its parent already closed.
      if (o.properties !== undefined && !branch && o.additionalProperties !== false)
        open.push(path);
      for (const [k, v] of Object.entries(o)) {
        if (k === "properties") {
          for (const [pk, pv] of Object.entries(v as object))
            walk(pv, `${path}/properties/${pk}`, branch);
        } else {
          walk(v, `${path}/${k}`, branch || k === "then" || k === "if");
        }
      }
    };
    walk(schema, "", false);
    expect(open).toEqual([]);
  });

  test("no manifest can ask for a script, worker, connect or style source", () => {
    const csp = schema.properties.capabilities.properties.csp;
    expect(Object.keys(csp.properties).sort()).toEqual(["font-src", "img-src", "media-src"]);
    expect(csp.additionalProperties).toBe(false);
    expect(schema.$defs.cspSources.items.enum).toEqual(["blob:", "data:"]);
  });

  test("an unknown keyword is refused by strict mode", () => {
    const bad = { ...schema, "x-bogus": true };
    expect(() => new Ajv2020({ strict: true }).compile(bad)).toThrow();
  });

  test("the effects enum equals MANIFEST_EFFECTS and has no +net (PK11)", () => {
    expect([...schema.properties.capabilities.properties.effects.items.enum]).toEqual([
      ...MANIFEST_EFFECTS,
    ]);
    expect(MANIFEST_EFFECTS).not.toContain("+net");
  });
});

/** Every way to damage a manifest one step: drop a key, break a leaf's type, add a key, shorten an array. */
function mutations(m: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    const edit = (
      f: (parent: Record<string, unknown> | unknown[], key: string | number) => void,
    ): void => {
      const copy = JSON.parse(JSON.stringify(m)) as unknown;
      let cur = copy as Record<string, unknown>;
      for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
      const last = path[path.length - 1];
      if (last === undefined) return;
      f(cur, last);
      out.push(copy);
    };
    if (path.length > 0) {
      edit((p, k) => delete (p as Record<string, unknown>)[k]);
      edit((p, k) => ((p as Record<string, unknown>)[k] = 12345));
      edit((p, k) => ((p as Record<string, unknown>)[k] = ""));
      edit((p, k) => ((p as Record<string, unknown>)[k] = null));
      edit((p, k) => ((p as Record<string, unknown>)[k] = []));
    }
    if (typeof node === "object" && node !== null) {
      const o = node as Record<string, unknown>;
      const copy = JSON.parse(JSON.stringify(m)) as unknown;
      let cur = copy as Record<string, unknown>;
      for (const k of path) cur = cur[k] as Record<string, unknown>;
      cur["unknown-key"] = true;
      out.push(copy);
      for (const k of Object.keys(o)) walk(o[k], [...path, Array.isArray(node) ? Number(k) : k]);
    }
  };
  walk(m, []);
  return out;
}

describe("the hand-written validator agrees with Ajv", () => {
  const seeds = validFiles().map((f) => f.manifest);
  const cases = seeds.flatMap(mutations);

  test("over the mutations of every valid manifest", () => {
    expect(cases.length).toBeGreaterThan(1000);
    let invalid = 0;
    for (const c of cases) {
      const ajvOk = ajvValidate(c) as boolean;
      const mine = structuralProblems(c).length === 0;
      if (!ajvOk) invalid++;
      expect(mine, JSON.stringify(c).slice(0, 200)).toBe(ajvOk);
    }
    expect(invalid).toBeGreaterThan(500);
  });

  test("over scalar edge cases of the length, count and pattern limits", () => {
    const base = JSON.parse(
      JSON.stringify(validFiles().find((f) => f.name === "valid/all-fields.json")?.manifest),
    ) as Record<string, unknown>;
    const variants: Record<string, unknown>[] = [];
    const with_ = (k: string, v: unknown): void => void variants.push({ ...base, [k]: v });
    for (const n of [0, 1, 40, 41]) with_("name", "n".repeat(n));
    for (const n of [119, 120, 121]) with_("summary", "s".repeat(n));
    for (const n of [600, 601]) with_("description", "d".repeat(n));
    for (const v of ["1.0.0", "01.0.0", "1.0.0-", "1.0.0-a.b", "1.0", "v1.0.0"])
      with_("version", v);
    for (const v of ["a", "a-b", "a--b", "-a", "a-", "1a", "a".repeat(32), "a".repeat(33)])
      with_("id", v);
    for (const v of ["Apache-2.0", "A".repeat(41), "bad lic", ""]) with_("licence", v);
    for (const v of ["a/b", "a/../b", "/a", "a..b", "a b", "", "a".repeat(120), "a".repeat(121)])
      with_("notice", v);
    for (const v of ["\u{1F600}".repeat(40), "\u{1F600}".repeat(41)]) with_("name", v);
    with_(
      "conversions",
      Array.from({ length: 17 }, () => ({ from: "a", to: "b", op: "x:y" })),
    );
    with_(
      "vocabularies",
      Array.from({ length: 65 }, (_v, i) => ({ name: `v${i}` })),
    );
    with_("requires", { packApi: 1, packs: Array.from({ length: 17 }, (_v, i) => `p${i}`) });
    with_("requires", { packApi: 1, packs: ["a", "a"] });
    with_("requires", { packApi: 1.5 });
    with_("budget", { total: 0 });
    with_("budget", { total: 1.5 });
    for (const v of variants)
      expect(structuralProblems(v).length === 0, JSON.stringify(v).slice(0, 120)).toBe(
        ajvValidate(v) as boolean,
      );
  });
});

describe("validateManifest", () => {
  const demo = validFiles().find((f) => f.name === "valid/demo.json")?.manifest as Record<
    string,
    unknown
  >;

  test("returns the manifest on success and structured problems on failure", () => {
    const ok = validateManifest(demo);
    expect(ok.ok && ok.manifest.id).toBe("demo");
    const bad = validateManifest({ ...demo, id: "Demo" });
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatchObject({ code: "schema", path: "/id" });
    expect(typeof bad.problems[0]?.message).toBe("string");
  });

  test("is total: any input is a result, never a throw", () => {
    for (const v of [undefined, null, 1, "x", [], {}, true]) {
      const r = validateManifest(v);
      expect(r.ok).toBe(false);
      expect(codesOf(r)).toEqual(["schema"]);
    }
  });

  test("runs a cross-check only when its input is given", () => {
    const clash = { ...demo, vocabularies: [{ name: "base64" }] };
    expect(validateManifest(clash).ok).toBe(true);
    expect(validateManifest(clash, { coreVocabs: ["base64"] }).ok).toBe(false);
    const needy = { ...demo, requires: { packApi: 1, packs: ["ghost"] } };
    expect(validateManifest(needy).ok).toBe(true);
    expect(codesOf(validateManifest(needy, { packs: [] }))).toEqual(["requires-unknown"]);
  });

  test("reports every cross-check problem, not just the first", () => {
    const r = validateManifest(
      { ...demo, id: "core", licence: "GPL-3.0", requires: { packApi: 7 } },
      { dirName: "core" },
    );
    expect(codesOf(r).sort()).toEqual(["id-reserved", "licence-list", "requires-api"]);
  });

  test("skips the cross-checks when the schema fails", () => {
    const r = validateManifest({ ...demo, id: "core", extra: 1 }, { dirName: "core" });
    expect(codesOf(r)).toEqual(["schema"]);
  });

  test("finds a cycle through other packs", () => {
    const ctx = {
      packs: [
        { id: "b", vocabularies: [], kinds: [], requires: ["c"] },
        { id: "c", vocabularies: [], kinds: [], requires: ["demo"] },
      ],
    };
    const r = validateManifest({ ...demo, requires: { packApi: 1, packs: ["b"] } }, ctx);
    expect(r.problems.map((p) => p.message)).toEqual(["requires cycle: demo -> b -> c -> demo"]);
  });

  test("a diamond is not a cycle", () => {
    const ctx = {
      packs: [
        { id: "b", vocabularies: [], kinds: [], requires: ["d"] },
        { id: "c", vocabularies: [], kinds: [], requires: ["d"] },
        { id: "d", vocabularies: [], kinds: [], requires: [] },
      ],
    };
    expect(validateManifest({ ...demo, requires: { packApi: 1, packs: ["b", "c"] } }, ctx).ok).toBe(
      true,
    );
  });

  test("a pack may not claim a kind core owns, and a pack may claim the kinds other docs reserve for packs", () => {
    for (const name of ["table", "null", "array"]) {
      const m = { ...demo, kinds: [{ name, label: "x", viewer: false, paramHelper: false }] };
      expect(codesOf(validateManifest(m))).toEqual(["kind-reserved"]);
    }
    // `relation`, `relix-expr` and `rat` are reserved for the packs that own them, not by core (PK3).
    const m = {
      ...demo,
      kinds: [{ name: "relation", label: "x", viewer: false, paramHelper: false }],
    };
    expect(validateManifest(m).ok).toBe(true);
  });

  test("an empty NOTICE is refused only when the file exists", () => {
    const relix = validFiles().find((f) => f.name === "valid/relix.json")?.manifest;
    expect(codesOf(validateManifest(relix, { fileSize: () => 0 }))).toEqual(["licence-list"]);
    expect(
      validateManifest(relix, { fileSize: () => 0, fileExists: () => false }).problems.map(
        (p) => p.code,
      ),
    ).not.toContain("licence-list");
  });
});

describe("the core name sets", () => {
  test("PACK_API is 1", () => {
    expect(PACK_API).toBe(1);
  });

  test("CORE_KIND_NAMES is table plus the kinds the language owns", () => {
    expect([...CORE_KIND_NAMES].sort()).toEqual(["array", "null", "table"]);
    for (const k of CORE_EXT_KINDS) expect(CORE_KIND_NAMES).toContain(k);
  });

  test("the kinds the language registers when it loads are reserved", () => {
    // `table` is registered by no module today (@forge/ops has no registerExtKind call), so only the
    // language's own kinds can be compared with a registry.
    for (const k of listExtKinds()) {
      if (CORE_EXT_KINDS.includes(k)) expect(CORE_KIND_NAMES).toContain(k);
    }
  });

  test("CORE_VOCAB_NAMES holds core, user and every internal vocabulary of @forge/ops", () => {
    expect(CORE_VOCAB_NAMES).toEqual(expect.arrayContaining(["core", "user", ...INTERNAL_VOCABS]));
  });

  test("the reserved ids and the licence list are the ones of PACKS 2.3 and 2.4", () => {
    expect([...RESERVED_PACK_IDS]).toEqual(["core", "user", "recipe", "all", "none", "packs"]);
    expect([...LICENCE_ALLOW_LIST]).toEqual([
      "Apache-2.0",
      "MIT",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "ISC",
      "0BSD",
    ]);
  });

  test("no vocabulary of the example manifests clashes with the real core vocabularies", () => {
    const opsRoot = join(fileURLToPath(import.meta.url), "..", "..", "..", "ops");
    const files = readdirSync(join(opsRoot, "vocab"))
      .filter((f) => f.endsWith(".fth"))
      .map((f) => f.replace(/\.fth$/, ""));
    const prims = readdirSync(join(opsRoot, "src", "prims"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.ts$/, ""));
    expect(files.length).toBeGreaterThan(10);
    expect(prims.length).toBeGreaterThan(10);
    const coreVocabs = [...files, ...prims];
    for (const name of ["relix", "demo", "media"]) {
      const m = JSON.parse(
        readFileSync(
          join(join(fileURLToPath(import.meta.url), "..", "manifests", "valid"), `${name}.json`),
          "utf8",
        ),
      ) as unknown;
      const r = validateManifest(m, { coreVocabs, dirName: name });
      // The media sketch of PACKS 2.7 names a vocabulary `qr`, which core already has (a finding: the
      // sketch says its names are illustrative, and WP M1 must pick another).
      const expected = name === "media" ? ["vocabulary 'qr' is a core vocabulary"] : [];
      expect(
        r.problems.map((x) => x.message),
        name,
      ).toEqual(expected);
    }
    // And the check does see them: a pack that names a real core vocabulary clashes.
    const demo = JSON.parse(
      readFileSync(
        join(join(fileURLToPath(import.meta.url), "..", "manifests", "valid"), "demo.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const first = files[0] as string;
    expect(
      codesOf(validateManifest({ ...demo, vocabularies: [{ name: first }] }, { coreVocabs })),
    ).toEqual(["vocab-clash"]);
  });
});
