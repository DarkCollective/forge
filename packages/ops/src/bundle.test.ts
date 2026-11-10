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
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { definePrimitive, isForgeError } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime, createBundleLoader } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";
import type { PrimitiveModule, SourceFile, VocabBundle, VocabSourceProvider } from "./types.js";

const file = (vocab: string, body = "", extra = ""): SourceFile => ({
  name: `${vocab}.fth`,
  text: `IN: ${vocab}\n${extra}\n${body}\n`,
});
const prim = (vocab: string, name: string): PrimitiveDef =>
  definePrimitive(vocab, name, "( bytes -- bytes )", (b: Uint8Array) => b.slice(), {
    doc: "test",
    category: "Test",
  });

interface Fake extends VocabSourceProvider {
  listed: number;
  imported: string[];
}
function fake(
  files: SourceFile[],
  modules: Record<string, PrimitiveModule | (() => unknown)> = {},
): Fake {
  const provider: Fake = {
    listed: 0,
    imported: [],
    fthFiles() {
      provider.listed++;
      return Promise.resolve(files);
    },
    primitiveLoaders() {
      return Object.fromEntries(
        Object.entries(modules).map(([vocab, mod]) => [
          vocab,
          () => {
            provider.imported.push(vocab);
            return Promise.resolve(typeof mod === "function" ? (mod() as PrimitiveModule) : mod);
          },
        ]),
      );
    },
  };
  return provider;
}

describe("createBundleLoader", () => {
  const files = [
    file("top", ": f ( x:bytes -- bytes ) x mid:g ;"),
    file("mid", ": g ( x:bytes -- bytes ) x low:h ;"),
    file("low", ": h ( x:bytes -- bytes ) x ;"),
    file("lone"),
  ];

  test('"all" is every vocabulary; units are in dependency order; primitives are collected', async () => {
    const provider = fake(files, {
      p1: { primitives: [prim("p1", "a")] },
      low: { primitives: [prim("low", "b")] },
    });
    const bundle = await createBundleLoader(provider)("all");
    expect(bundle.vocabs).toEqual(["lone", "low", "mid", "p1", "top"]);
    expect(bundle.units.map((u) => u.vocab)).toEqual(["lone", "low", "mid", "top"]);
    expect(bundle.primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual(["low:b", "p1:a"]);
  });

  test("the default is all", async () => {
    const bundle = await createBundleLoader(fake(files))();
    expect(bundle.vocabs).toEqual(["lone", "low", "mid", "top"]);
  });

  test("a request brings its transitive dependencies and nothing else", async () => {
    const provider = fake(files, {
      lone: { primitives: [prim("lone", "x")] },
      low: { primitives: [prim("low", "y")] },
    });
    const bundle = await createBundleLoader(provider)(["top"]);
    expect(bundle.vocabs).toEqual(["low", "mid", "top"]);
    expect(bundle.units.map((u) => u.vocab)).toEqual(["low", "mid", "top"]);
    expect(provider.imported).toEqual(["low"]);
  });

  test("a primitive-only vocabulary can be requested, and duplicates are fine", async () => {
    const provider = fake(files, { p: { primitives: [prim("p", "a")] } });
    const bundle = await createBundleLoader(provider)(["p", "p"]);
    expect(bundle.vocabs).toEqual(["p"]);
    expect(bundle.units).toEqual([]);
  });

  test("an empty request is an empty bundle", async () => {
    const bundle = await createBundleLoader(fake(files))([]);
    expect(bundle).toEqual({ vocabs: [], units: [], primitives: [] });
  });

  test("scans once, however many bundles are asked for", async () => {
    const provider = fake(files);
    const load = createBundleLoader(provider);
    await load(["low"]);
    await load(["mid"]);
    await Promise.all([load("all"), load("all")]);
    expect(provider.listed).toBe(1);
  });

  test("a failed scan is not cached", async () => {
    let broken = true;
    const provider = fake([]);
    provider.fthFiles = () => {
      provider.listed++;
      return Promise.resolve(broken ? [{ name: "a.fth", text: "no in form" }] : files);
    };
    const load = createBundleLoader(provider);
    await expect(load("all")).rejects.toThrow(/a.fth: a vocabulary unit must contain exactly one/);
    broken = false;
    expect((await load("all")).vocabs).toContain("top");
    expect(provider.listed).toBe(2);
  });

  test("an unknown vocabulary is an error", async () => {
    await expect(createBundleLoader(fake(files))(["nope"])).rejects.toThrow(
      "unknown vocabulary 'nope'",
    );
    await expect(createBundleLoader(fake(files))(["core"])).rejects.toThrow(/unknown vocabulary/);
  });

  test("a primitive module must export a primitives array", async () => {
    const provider = fake(files, { p: {} as unknown as PrimitiveModule });
    await expect(createBundleLoader(provider)(["p"])).rejects.toThrow(
      "prims/p: the module does not export a 'primitives' array",
    );
  });

  test("every primitive's vocabulary must equal the module's file name", async () => {
    const provider = fake(files, { p: { primitives: [prim("q", "a")] } });
    await expect(createBundleLoader(provider)(["p"])).rejects.toThrow(
      "prims/p: primitive 'a' is in vocabulary 'q', not 'p'",
    );
  });

  test("the real package: hex alone never loads the regex engine", async () => {
    const hexOnly = await loadBundleNode(["hex"]);
    expect(hexOnly.vocabs).toEqual(["hex"]);
    expect(hexOnly.primitives.every((p) => p.vocab === "hex")).toBe(true);
  });

  test("the real package: recipe brings regex and base64 with it", async () => {
    const bundle = await loadBundleNode(["recipe"]);
    expect(bundle.vocabs).toEqual(["base64", "recipe", "regex"]);
    expect(bundle.units.map((u) => u.vocab)).toEqual(["base64", "regex", "recipe"]);
    expect(bundle.primitives.map((p) => p.vocab)).toContain("recipe");
  });

  test("the real package: all is every bundled vocabulary", async () => {
    const onDisk = readdirSync(`${fileURLToPath(import.meta.url).replace(/\/[^/]*$/, "")}/../vocab`)
      .filter((n) => n.endsWith(".fth"))
      .map((n) => n.slice(0, -4))
      .sort();
    const bundle = await loadBundleNode("all");
    expect(bundle.vocabs).toEqual(onDisk);
    const units = bundle.units.map((u) => u.vocab);
    expect([...units].sort()).toEqual(bundle.vocabs.filter((v) => units.includes(v)));
    expect(units).toHaveLength(onDisk.length);
    // dependency order: recipe uses regex and base64, so they come first
    expect(units.indexOf("regex")).toBeLessThan(units.indexOf("recipe"));
    expect(units.indexOf("base64")).toBeLessThan(units.indexOf("recipe"));
  });
});

describe("assembleRuntime", () => {
  const bundle = async (): Promise<VocabBundle> => loadBundleNode(["hex", "text"]);

  test("binds the primitives and loads the units", async () => {
    const rt = assembleRuntime(await bundle());
    expect(rt.meta("hex:encode").kind).toBe("primitive");
    expect(rt.meta("text:upper").kind).toBe("fl");
    expect(rt.meta("text:upper").source.unit).toBe("text.fth");
  });

  test("the limits option reaches the runtime", async () => {
    const rt = assembleRuntime(await bundle(), { limits: { maxSteps: 3 } });
    const r = await rt.run("1 2 3 4 5 6 7 8 9");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_LIMIT_STEPS");
  });

  test("a failing bundled unit is rethrown with the unit name", () => {
    const broken: VocabBundle = {
      vocabs: ["a"],
      units: [
        {
          vocab: "a",
          name: "a.fth",
          source: "IN: a\n: f ( -- int ) nosuchword ;\n",
          deps: [],
        },
      ],
      primitives: [],
    };
    try {
      assembleRuntime(broken);
      expect.unreachable();
    } catch (e) {
      expect(isForgeError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("E_UNDEFINED");
      expect((e as Error).message).toMatch(/^a\.fth: /);
    }
  });

  test("a user unit may define into user and into a new vocabulary", async () => {
    const rt = assembleRuntime(await bundle(), {
      units: [
        {
          name: "mine.fth",
          source: 'IN: mine\n: shout ( s:str -- str ) "d" doc "X" category s upper ;\n',
        },
        { name: "u.fth", source: ": plain ( -- int ) 1 ;\n" },
        { name: "u2.fth", source: "IN: user\n: other ( -- int ) 2 ;\n" },
      ],
    });
    expect(rt.meta("mine:shout").qname).toBe("mine:shout");
    expect(rt.meta("user:plain").qname).toBe("user:plain");
    expect(rt.meta("user:other").qname).toBe("user:other");
  });

  test.each(["hex", "text", "recipe", "bake", "util", "core"])(
    "a user unit that defines into %s fails with E_READONLY",
    async (vocab) => {
      const b = await bundle();
      try {
        assembleRuntime(b, {
          units: [{ name: "evil.fth", source: `IN: ${vocab}\n: x ( -- int ) 1 ;\n` }],
        });
        expect.unreachable();
      } catch (e) {
        expect((e as { code: string }).code).toBe("E_READONLY");
        expect((e as { detail: { vocab: string } }).detail.vocab).toBe(vocab);
        expect((e as Error).message).toMatch(/^evil\.fth: /);
      }
    },
  );

  test("an IN: after other definitions of the unit is found too", async () => {
    const b = await bundle();
    expect(() =>
      assembleRuntime(b, {
        units: [{ name: "evil.fth", source: ": second ( -- int ) 2 ;\nIN: hex\n" }],
      }),
    ).toThrow(/read-only/);
  });

  test("an IN: with a vocabulary that is not in this bundle is allowed", async () => {
    // A dependency-free bundle (hex mentions no other vocabulary), so `regex` is outside it for sure.
    const hexOnly = await loadBundleNode(["hex"]);
    expect(hexOnly.vocabs).not.toContain("regex");
    const rt = assembleRuntime(hexOnly, {
      units: [{ name: "w.fth", source: "IN: regex\n: x ( -- int ) 1 ;\n" }],
    });
    expect(rt.meta("regex:x").qname).toBe("regex:x");
  });

  test("an IN: with no name after it is left to the compiler", async () => {
    const b = await bundle();
    try {
      assembleRuntime(b, { units: [{ name: "w.fth", source: "IN:" }] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_SYNTAX");
      expect((e as Error).message).toMatch(/^w\.fth: /);
    }
  });

  test("a user unit with a lexical error is reported with its name", async () => {
    const b = await bundle();
    try {
      assembleRuntime(b, { units: [{ name: "lex.fth", source: '"open' }] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_LEX");
      expect((e as Error).message).toMatch(/^lex\.fth: /);
    }
  });

  test("a user unit that fails to compile is reported with its name", async () => {
    const b = await bundle();
    try {
      assembleRuntime(b, { units: [{ name: "bad.fth", source: ": f ( -- int ) nope ;" }] });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("E_UNDEFINED");
      expect((e as Error).message).toMatch(/^bad\.fth: /);
    }
  });
});
