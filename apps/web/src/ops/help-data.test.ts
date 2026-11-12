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
import { describe, expect, test, vi } from "vitest";
import type { Catalogue, HelpDoc } from "@forge/ops";
import { createHelpLoader, indexHelp, isHelpDoc, judge } from "./help-data.js";

const op = (qname: string, vocab: string) => ({ qname, vocab }) as Catalogue["ops"][number];
const catalogue = (version: string, ...ops: Catalogue["ops"][number][]): Catalogue =>
  ({ format: 1, version, vocabs: [], ops }) as unknown as Catalogue;
const doc = (version: string, ...qnames: string[]): HelpDoc => ({
  format: 1,
  catalogue: version,
  version: "h",
  ops: qnames.map((qname) => ({ qname, useWhen: "when", links: [], inverse: null, examples: [] })),
});

describe("isHelpDoc", () => {
  test("accepts the document and refuses other shapes", () => {
    expect(isHelpDoc(doc("v", "a:b"))).toBe(true);
    expect(isHelpDoc(null)).toBe(false);
    expect(isHelpDoc({ ...doc("v"), format: 2 })).toBe(false);
    expect(isHelpDoc({ ...doc("v"), ops: [{ qname: "a:b" }] })).toBe(false);
  });
});

describe("the catalogue-version rule", () => {
  const plain = catalogue("v1", op("a:b", "a"));
  const withUser = catalogue("v2", op("a:b", "a"), op("user:x", "user"));

  test("equal versions: everything applies", () => {
    expect(judge(doc("v1"), plain, null)).toBe("all");
  });
  test("different versions and no user words: ignored", () => {
    expect(judge(doc("v0"), plain, null)).toBe("none");
  });
  test("different versions with user words: bundled ops when the bundled version matches", () => {
    expect(judge(doc("v1"), withUser, "v1")).toBe("bundled");
    expect(judge(doc("v1"), withUser, "v9")).toBe("none");
    expect(judge(doc("v1"), withUser, null)).toBe("none");
  });
  test("a user word never gets help, and unknown ops are dropped", () => {
    const idx = indexHelp(doc("v1", "a:b", "user:x", "gone:y"), withUser, "bundled");
    expect(idx.get("a:b")).toBeDefined();
    expect(idx.get("user:x")).toBeUndefined();
    expect(idx.get("gone:y")).toBeUndefined();
    expect(indexHelp(doc("v1", "a:b"), withUser, "none").size).toBe(0);
  });
});

describe("createHelpLoader", () => {
  test("loads once, caches, and indexes by qname", async () => {
    const loadDoc = vi.fn(async () => doc("v1", "a:b"));
    const bundledVersion = vi.fn(async () => "v1");
    const loader = createHelpLoader({ loadDoc, bundledVersion });
    const cat = catalogue("v1", op("a:b", "a"));
    expect(loader.cached(cat)).toBeNull();
    const index = await loader.load(cat);
    expect(index.get("a:b")?.useWhen).toBe("when");
    await loader.load(cat);
    expect(loadDoc).toHaveBeenCalledTimes(1);
    expect(bundledVersion).not.toHaveBeenCalled();
    expect(loader.cached(cat)).toBe(index);
  });

  test("a failed load is not cached", async () => {
    const loadDoc = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(doc("v1", "a:b"));
    const loader = createHelpLoader({ loadDoc, bundledVersion: async () => "v1" });
    const cat = catalogue("v1", op("a:b", "a"));
    await expect(loader.load(cat)).rejects.toThrow("offline");
    expect((await loader.load(cat)).size).toBe(1);
  });

  test("a document of the wrong shape is a failure", async () => {
    const loader = createHelpLoader({ loadDoc: async () => ({}), bundledVersion: async () => "" });
    await expect(loader.load(catalogue("v1"))).rejects.toThrow(/unexpected format/);
  });

  test("user words: the bundled version is read, and a failed read ignores the document", async () => {
    const withUser = catalogue("v2", op("a:b", "a"), op("user:x", "user"));
    const ok = createHelpLoader({
      loadDoc: async () => doc("v1", "a:b"),
      bundledVersion: async () => "v1",
    });
    expect((await ok.load(withUser)).get("a:b")).toBeDefined();
    const bad = createHelpLoader({
      loadDoc: async () => doc("v1", "a:b"),
      bundledVersion: async () => {
        throw new Error("x");
      },
    });
    expect((await bad.load(withUser)).size).toBe(0);
  });
});
