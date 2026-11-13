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
import { readFileSync } from "node:fs";
import type { Catalogue } from "@forge/ops";
import { describe, expect, test } from "vitest";
import {
  assertUniquePaths,
  categoryId,
  fileOfPath,
  opPath,
  slugSegment,
  unslugSegment,
} from "./slug.js";

const catalogue = JSON.parse(
  readFileSync(new URL("../../../../packages/ops/dist/catalogue.json", import.meta.url), "utf8"),
) as Catalogue;

const AWKWARD = [
  "",
  "A",
  "Zip",
  "a>b",
  "a?b",
  "a+b",
  "a*b",
  "a/b",
  "a.b",
  "..",
  ".",
  "a b",
  "a%2fb",
  "_",
  "_5f_",
  "a_b",
  "é",
  "日本",
  "😀",
  "a\u0000b",
  "a\\b",
  "a:b",
];

describe("slug rule", () => {
  test("simple names are unchanged", () => {
    for (const s of ["derive", "base64", "aes-kw", "x-1"]) expect(slugSegment(s)).toBe(s);
  });

  test("awkward names have no character that needs encoding, and no dot", () => {
    for (const s of AWKWARD) {
      const slug = slugSegment(s);
      expect(slug, s).toMatch(/^[a-z0-9_-]+$/);
      expect(encodeURIComponent(slug), s).toBe(slug);
    }
    expect(slugSegment("a>b")).toBe("a_3e_b");
    expect(slugSegment("a/b")).toBe("a_2f_b");
    expect(slugSegment("Zip")).toBe("_5a_ip");
    expect(slugSegment("")).toBe("_");
  });

  test("injective: every awkward name round-trips, so no two share a slug", () => {
    const slugs = new Map<string, string>();
    for (const s of AWKWARD) {
      const slug = slugSegment(s);
      expect(unslugSegment(slug), s).toBe(s);
      expect(slugs.has(slug), `${s} collides with ${slugs.get(slug)}`).toBe(false);
      slugs.set(slug, s);
    }
  });

  test("injective over all short strings of a small hostile alphabet", () => {
    const alphabet = ["a", "A", "-", "_", "5", "f", ">", "."];
    const seen = new Map<string, string>();
    let words = [""];
    for (let len = 0; len <= 4; len++) {
      for (const w of words) {
        const slug = slugSegment(w);
        expect(seen.get(slug) ?? w, slug).toBe(w);
        seen.set(slug, w);
      }
      words = words.flatMap((w) => alphabet.map((c) => w + c));
    }
  });

  test("unslug rejects what the rule never produces", () => {
    for (const bad of ["A", "a.b", "_zz_", "_61_", "a_", "__"])
      expect(unslugSegment(bad), bad).toBeNull();
  });
});

describe("op paths over the whole catalogue", () => {
  test("every op has a distinct, safe URL, and a real name is its own slug", () => {
    expect(catalogue.ops.length).toBeGreaterThan(400);
    assertUniquePaths(catalogue);
    const seen = new Set<string>();
    for (const op of catalogue.ops) {
      const path = opPath(op);
      expect(path, op.qname).toMatch(/^\/ops\/[a-z0-9_-]+\/[a-z0-9_-]+\/$/);
      expect(seen.has(path), op.qname).toBe(false);
      seen.add(path);
      expect(fileOfPath(path)).toBe(`${path.slice(1)}index.html`);
      expect(op.qname).toBe(`${op.vocab}:${op.name}`);
      // Today every real name is already in the safe set, so the URL is /ops/<vocab>/<name>/.
      expect(path).toBe(`/ops/${op.vocab}/${op.name}/`);
    }
  });

  test("assertUniquePaths names a clash", () => {
    const a = { qname: "x:y", name: "y", vocab: "x" };
    expect(() => assertUniquePaths({ ops: [a, a] } as unknown as Catalogue)).toThrow(/x:y/);
  });
});

describe("categoryId", () => {
  test("is a lower case anchor and is unique over the real categories", () => {
    expect(categoryId("Key derivation")).toBe("key-derivation");
    expect(categoryId("  !! ")).toBe("other");
    const cats = [...new Set(catalogue.ops.map((o) => o.category ?? "Other"))];
    expect(new Set(cats.map(categoryId)).size).toBe(cats.length);
  });
});
