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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { assembleRuntime, createBundleLoader } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { createNodeProvider, loadBundleNode, primitiveVocabOf } from "./sources-node.js";
import { createViteProvider, loadBundleVite } from "./sources-vite.js";

const PRIMS = ["base64", "hex", "recipe", "regex"];
const VOCABS = ["base64.fth", "classical.fth", "hex.fth", "recipe.fth", "regex.fth", "text.fth"];

describe("primitiveVocabOf: exclusions", () => {
  test("a module of the selected extension is a vocabulary", () => {
    expect(primitiveVocabOf("hex.ts", ".ts")).toBe("hex");
    expect(primitiveVocabOf("hex.js", ".js")).toBe("hex");
    expect(primitiveVocabOf("find-all.ts", ".ts")).toBe("find-all");
  });

  test("declaration files are ignored", () => {
    expect(primitiveVocabOf("ambient.d.ts", ".ts")).toBeUndefined();
    expect(primitiveVocabOf("hex.d.ts", ".ts")).toBeUndefined();
  });

  test("test files are ignored, whatever the second extension", () => {
    expect(primitiveVocabOf("hex.test.ts", ".ts")).toBeUndefined();
    expect(primitiveVocabOf("hex.test.js", ".js")).toBeUndefined();
    expect(primitiveVocabOf("hex.test.tsx", ".ts")).toBeUndefined();
    expect(primitiveVocabOf("hex.spec.ts", ".ts")).toBe("hex.spec");
  });

  test("other extensions and empty names are ignored", () => {
    expect(primitiveVocabOf("hex.js", ".ts")).toBeUndefined();
    expect(primitiveVocabOf("hex.ts", ".js")).toBeUndefined();
    expect(primitiveVocabOf("hex.js.map", ".js")).toBeUndefined();
    expect(primitiveVocabOf(".ts", ".ts")).toBeUndefined();
    expect(primitiveVocabOf("README.md", ".ts")).toBeUndefined();
  });

  test("the default extension is that of the running module (.ts under Vitest)", () => {
    expect(primitiveVocabOf("hex.ts")).toBe("hex");
    expect(primitiveVocabOf("hex.js")).toBeUndefined();
  });
});

describe("the Node provider", () => {
  test("finds the .fth files by pattern, sorted", async () => {
    const files = await createNodeProvider().fthFiles();
    expect(files.map((f) => f.name)).toEqual(VOCABS);
    expect(files.every((f) => f.text.includes("IN: "))).toBe(true);
  });

  test("finds the primitive modules by pattern, and none of the tests or declarations", async () => {
    const loaders = createNodeProvider().primitiveLoaders();
    expect(Object.keys(loaders).sort()).toEqual(PRIMS);
    const mod = await (loaders.hex as () => Promise<{ primitives: unknown[] }>)();
    expect(mod.primitives).toHaveLength(2);
  });

  test("a root without vocab or prims directories is empty", async () => {
    const root = mkdtempSync(`${tmpdir()}/forge-ops-`);
    try {
      const provider = createNodeProvider(root);
      expect(await provider.fthFiles()).toEqual([]);
      expect(provider.primitiveLoaders()).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a custom root: reads its vocab/ and src/prims/, ignores .d.ts and .test.* files", async () => {
    const root = mkdtempSync(`${tmpdir()}/forge-ops-`);
    try {
      mkdirSync(`${root}/vocab`);
      mkdirSync(`${root}/src/prims`, { recursive: true });
      writeFileSync(`${root}/vocab/zed.fth`, "IN: zed\n");
      writeFileSync(`${root}/vocab/alpha.fth`, "IN: alpha\n: f ( -- int ) 1 ;\n");
      writeFileSync(`${root}/vocab/notes.txt`, "not a vocabulary");
      writeFileSync(
        `${root}/src/prims/zed.ts`,
        "export const primitives = [{ vocab: 'zed', name: 'one', effect: '( bytes -- bytes )', " +
          "fn: (b: Uint8Array) => b.slice(), doc: 'one', category: 'Z' }];\n",
      );
      writeFileSync(`${root}/src/prims/zed.d.ts`, "export {};\n");
      writeFileSync(`${root}/src/prims/zed.test.ts`, "throw new Error('must not be loaded');\n");
      writeFileSync(`${root}/src/prims/zed.js`, "throw new Error('wrong extension');\n");
      const provider = createNodeProvider(`${root}/`);
      expect((await provider.fthFiles()).map((f) => f.name)).toEqual(["alpha.fth", "zed.fth"]);
      expect(Object.keys(provider.primitiveLoaders())).toEqual(["zed"]);
      const bundle = await createBundleLoader(provider)("all");
      expect(bundle.vocabs).toEqual(["alpha", "zed"]);
      expect(bundle.primitives.map((p) => p.name)).toEqual(["one"]);
      expect(assembleRuntime(bundle).meta("zed:one").kind).toBe("primitive");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("loadBundleNode caches its scan and answers the same bundle", async () => {
    const a = await loadBundleNode(["hex"]);
    const b = await loadBundleNode(["hex"]);
    expect(a.vocabs).toEqual(["hex"]);
    expect(b.units).toEqual(a.units);
  });
});

describe("the Vite provider (under Vitest, which applies import.meta.glob)", () => {
  test("finds the same .fth files as the Node provider, with the same text", async () => {
    const vite = await createViteProvider().fthFiles();
    const node = await createNodeProvider().fthFiles();
    expect(vite).toEqual(node);
  });

  test("finds the same primitive modules; tests and declarations are excluded by the globs", () => {
    const loaders = createViteProvider().primitiveLoaders();
    expect(Object.keys(loaders).sort()).toEqual(PRIMS);
  });

  test("both providers produce the same bundle and the same catalogue", async () => {
    const node = await loadBundleNode("all");
    const vite = await loadBundleVite("all");
    expect(vite.vocabs).toEqual(node.vocabs);
    expect(vite.units).toEqual(node.units);
    expect(vite.primitives.map((p) => `${p.vocab}:${p.name}:${p.effect}`)).toEqual(
      node.primitives.map((p) => `${p.vocab}:${p.name}:${p.effect}`),
    );
    expect(buildCatalogue(assembleRuntime(vite))).toEqual(buildCatalogue(assembleRuntime(node)));
  });

  test("the package entry @forge/ops/vite loads", async () => {
    const entry = (await import("@forge/ops/vite")) as typeof import("./sources-vite.js");
    const bundle = await entry.loadBundleVite(["text"]);
    expect(bundle.vocabs).toEqual(["text"]);
    expect(Object.keys(entry.createViteProvider().primitiveLoaders()).sort()).toEqual(PRIMS);
  });

  test("the package entries share one module graph, so the catalogue is the same from either source", async () => {
    // A consumer (the worker core, the web app) builds the catalogue with `@forge/ops` and loads the
    // vocabularies with `@forge/ops/vite`. If the two entries resolved to different copies of
    // `regex-engine` (src vs dist), the regex marks would be lost and `needsHardKill` would be false.
    const pkg = await import("@forge/ops");
    const entry = await import("@forge/ops/vite");
    const viaVite = pkg.buildCatalogue(pkg.assembleRuntime(await entry.loadBundleVite("all")));
    const viaNode = pkg.buildCatalogue(pkg.assembleRuntime(await loadBundleNode("all")));
    expect(viaVite.ops.filter((op) => op.needsHardKill).length).toBeGreaterThan(0);
    expect(viaVite).toEqual(viaNode);
    expect(viaVite.version).toBe(viaNode.version);
  });

  test("hex alone does not import the other primitive modules", async () => {
    const bundle = await createBundleLoader(createViteProvider())(["hex"]);
    expect(bundle.primitives.map((p) => p.vocab)).toEqual(["hex", "hex"]);
  });
});
