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
// WP 6.28: the lazy loader of checks.json and the evaluator: load once, cache, a failure is not cached,
// the catalogue-version rule, and the shape guard.
import type { Catalogue, ChecksDoc } from "@forge/ops";
import { describe, expect, test, vi } from "vitest";
import { createChecksLoader, indexChecks, isChecksDoc } from "./checks-data.js";
import type { Evaluator } from "./checks-data.js";

const op = (qname: string, vocab: string) => ({ qname, vocab }) as Catalogue["ops"][number];
const catalogue = (version: string, ...ops: Catalogue["ops"][number][]): Catalogue =>
  ({ format: 1, version, vocabs: [], ops }) as unknown as Catalogue;
const doc = (version: string, ...qnames: string[]): ChecksDoc => ({
  format: 1,
  catalogue: version,
  version: "c",
  ops: Object.fromEntries(qnames.map((q) => [q, { expects: "x data", checks: [] }])),
});
const evaluator = {} as Evaluator;

describe("isChecksDoc", () => {
  test("accepts the document and refuses other shapes", () => {
    expect(isChecksDoc(doc("v", "a:b"))).toBe(true);
    expect(isChecksDoc(null)).toBe(false);
    expect(isChecksDoc({ ...doc("v"), format: 2 })).toBe(false);
    expect(isChecksDoc({ ...doc("v"), ops: { "a:b": { expects: null } } })).toBe(false);
  });
});

describe("the catalogue-version rule", () => {
  const plain = catalogue("v1", op("a:b", "a"));
  const withUser = catalogue("v2", op("a:b", "a"), op("user:x", "user"));

  test("equal versions: everything applies", async () => {
    const loader = createChecksLoader({
      loadDoc: async () => doc("v1", "a:b", "gone:y"),
      loadEvaluator: async () => evaluator,
      bundledVersion: async () => "v1",
    });
    const { index } = await loader.load(plain);
    expect(index.get("a:b")).toBeDefined();
    expect(index.get("gone:y")).toBeUndefined();
  });
  test("different versions and no user words: ignored", async () => {
    const loader = createChecksLoader({
      loadDoc: async () => doc("v0", "a:b"),
      loadEvaluator: async () => evaluator,
      bundledVersion: async () => "v0",
    });
    expect((await loader.load(plain)).index.size).toBe(0);
  });
  test("user words: the bundled version decides, and a user word never gets checks", async () => {
    const bundledVersion = vi.fn(async () => "v1");
    const loader = createChecksLoader({
      loadDoc: async () => doc("v1", "a:b", "user:x"),
      loadEvaluator: async () => evaluator,
      bundledVersion,
    });
    const { index } = await loader.load(withUser);
    expect(index.get("a:b")).toBeDefined();
    expect(index.get("user:x")).toBeUndefined();
    const stranger = createChecksLoader({
      loadDoc: async () => doc("v1", "a:b"),
      loadEvaluator: async () => evaluator,
      bundledVersion: async () => "v9",
    });
    expect((await stranger.load(withUser)).index.size).toBe(0);
  });
  test("indexChecks with the verdict none is empty", () => {
    expect(indexChecks(doc("v1", "a:b"), plain, "none").size).toBe(0);
  });
});

describe("loading", () => {
  test("nothing is loaded until load is called, and then once", async () => {
    const loadDoc = vi.fn(async () => doc("v1", "a:b"));
    const loadEvaluator = vi.fn(async () => evaluator);
    const loader = createChecksLoader({ loadDoc, loadEvaluator, bundledVersion: async () => "v1" });
    const cat = catalogue("v1", op("a:b", "a"));
    expect(loadDoc).not.toHaveBeenCalled();
    expect(loadEvaluator).not.toHaveBeenCalled();
    expect(loader.cached(cat)).toBeNull();
    const [a, b] = await Promise.all([loader.load(cat), loader.load(cat)]);
    expect(a).toBe(b);
    await loader.load(cat);
    expect(loadDoc).toHaveBeenCalledTimes(1);
    expect(loadEvaluator).toHaveBeenCalledTimes(1);
    expect(loader.cached(cat)).toBe(a);
  });

  test("a failed load is not cached: the next call tries again", async () => {
    let fail = true;
    const loadDoc = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return doc("v1", "a:b");
    });
    const loader = createChecksLoader({
      loadDoc,
      loadEvaluator: async () => evaluator,
      bundledVersion: async () => "v1",
    });
    const cat = catalogue("v1", op("a:b", "a"));
    await expect(loader.load(cat)).rejects.toThrow("offline");
    expect(loader.cached(cat)).toBeNull();
    fail = false;
    expect((await loader.load(cat)).index.get("a:b")).toBeDefined();
    expect(loadDoc).toHaveBeenCalledTimes(2);
  });

  test("a failed evaluator load is not cached either", async () => {
    let fail = true;
    const loadEvaluator = vi.fn(async () => {
      if (fail) throw new Error("chunk");
      return evaluator;
    });
    const loader = createChecksLoader({
      loadDoc: async () => doc("v1"),
      loadEvaluator,
      bundledVersion: async () => "v1",
    });
    const cat = catalogue("v1");
    await expect(loader.load(cat)).rejects.toThrow("chunk");
    fail = false;
    await expect(loader.load(cat)).resolves.toBeDefined();
  });

  test("a document of the wrong shape is a failed load", async () => {
    const loader = createChecksLoader({
      loadDoc: async () => ({ nope: true }),
      loadEvaluator: async () => evaluator,
      bundledVersion: async () => "v1",
    });
    await expect(loader.load(catalogue("v1"))).rejects.toThrow("unexpected format");
  });
});
