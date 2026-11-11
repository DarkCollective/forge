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
 * Tests for the `lorem` vocabulary (vocab/lorem.fth): the structure of the random text (counts, alphabet, sentence
 * shape, opening), the word list, and the limits. The deterministic vectors (the opening, errors) are in
 * vocab/lorem.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, int, str, bool } = valueHelpers;
const bundle = await loadBundleNode(["lorem"]);
const runtime = assembleRuntime(bundle);
runtime.load(`IN: lorem
: t-list ( -- list ) _list ;`);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);
const none = bytes(new Uint8Array(0));

const gen = (length: number, unit = "paragraphs", opening = true) =>
  runtime.call("lorem:generate", [none, int(length), str(unit), bool(opening)]);
const text = async (length: number, unit = "paragraphs", opening = true) =>
  top(await gen(length, unit, opening)) as string;

/** The 182 words of the list plus the three words of the opening that are not in it. */
const WORDS = new Set<string>(
  (top(await runtime.call("lorem:t-list", [])) as { v: string }[]).map((x) => x.v),
);
for (const w of ["lorem", "adipiscing", "elit"]) WORDS.add(w);

const OPENING = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalogue", () => {
  test("lorem:generate is a Generators op with the +random effect", () => {
    const cat = buildCatalogue(assembleRuntime(bundle));
    const op = cat.ops.find((o) => o.qname === "lorem:generate");
    expect(op?.category).toBe("Generators");
    expect(op?.effects).toContain("+random");
  });
});

describe("the word list", () => {
  test("is the distinct words of the two passages of Cicero, 182 of them, in order", async () => {
    const words = await (async () => {
      const r = await runtime.call("lorem:t-list", []);
      return (top(r) as { v: string }[]).map((x) => x.v);
    })();
    expect(words).toHaveLength(182);
    expect(new Set(words).size).toBe(182);
    expect([...words].sort()).toEqual(words);
    expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  });
});

describe("opening", () => {
  test("every unit starts with the traditional opening", async () => {
    expect((await text(1, "sentences")).startsWith(OPENING)).toBe(true);
    expect(await text(1, "sentences")).toBe(OPENING);
    expect((await text(2, "paragraphs")).startsWith(OPENING)).toBe(true);
    expect(await text(8, "words")).toBe("Lorem ipsum dolor sit amet consectetur adipiscing elit");
    expect(await text(5, "words")).toBe("Lorem ipsum dolor sit amet");
    expect(await text(11, "bytes")).toBe("Lorem ipsum");
    expect(await text(56, "bytes")).toBe(OPENING);
  });

  test("without it the text is random from the first word", async () => {
    let same = 0;
    for (let i = 0; i < 20; i++) if ((await text(1, "sentences", false)) === OPENING) same++;
    expect(same).toBe(0);
  });
});

describe("structure", () => {
  test("sentences: n of them, each a capital, 5 to 14 Latin words, at most one comma and a full stop", async () => {
    const s = await text(300, "sentences", false);
    const sentences = s.match(/[^.]+\./g) ?? [];
    expect(sentences).toHaveLength(300);
    expect(sentences.join("").replaceAll(" ", "")).toBe(s.replaceAll(" ", ""));
    for (const raw of sentences) {
      const sent = raw.trim();
      expect(sent).toMatch(/^[A-Z][a-z]*(,? [a-z]+)*\.$/);
      const words = sent.replace(/[.,]/g, "").toLowerCase().split(" ");
      expect(words.length).toBeGreaterThanOrEqual(5);
      expect(words.length).toBeLessThanOrEqual(14);
      expect(words.every((w) => WORDS.has(w))).toBe(true);
      expect((sent.match(/,/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  test("a comma never follows the first two words or comes at the end", async () => {
    const s = await text(1000, "sentences", false);
    for (const sent of s.match(/[^.]+\./g) ?? []) {
      const words = sent.trim().slice(0, -1).split(" ");
      const at = words.findIndex((w) => w.endsWith(","));
      if (at >= 0) {
        expect(at).toBeGreaterThanOrEqual(2);
        expect(at).toBeLessThanOrEqual(words.length - 3);
      }
    }
  });

  test("paragraphs: n of them separated by blank lines, 3 to 8 sentences each", async () => {
    const p = (await text(40, "paragraphs", false)).split("\n\n");
    expect(p).toHaveLength(40);
    const counts = new Set<number>();
    for (const para of p) {
      const n = (para.match(/\./g) ?? []).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(8);
      counts.add(n);
    }
    expect(counts.size).toBeGreaterThan(2);
  });

  test("words: n lower-case words with a capital first", async () => {
    const w = (await text(500, "words", false)).split(" ");
    expect(w).toHaveLength(500);
    expect(w[0]).toMatch(/^[A-Z][a-z]+$/);
    expect(w.slice(1).every((x) => WORDS.has(x))).toBe(true);
  });

  test.each([1, 2, 10, 100, 1000, 65536])("bytes: exactly %i ASCII bytes", async (n) => {
    const s = await text(n, "bytes", n % 2 === 0);
    expect(s).toHaveLength(n);
    expect(/^[\x20-\x7e]*$/.test(s)).toBe(true);
  });

  test("the words are spread over the list: a loose chi-squared check over 20,000 words", async () => {
    const counts = new Map<string, number>();
    for (const w of (await text(20000, "words", false)).toLowerCase().split(" "))
      counts.set(w, (counts.get(w) ?? 0) + 1);
    expect(counts.size).toBe(182);
    const e = 20000 / 182;
    const chi = [...counts.values()].reduce((a, o) => a + (o - e) ** 2 / e, 0);
    expect(chi).toBeLessThan(182 + 6 * Math.sqrt(2 * 181)); // mean 181, six standard deviations
  });

  test("two calls differ", async () => {
    expect(await text(2, "paragraphs", false)).not.toBe(await text(2, "paragraphs", false));
  });
});

describe("limits", () => {
  test("the largest paragraph count is within the limits, and so is the largest sentence count", async () => {
    expect(code(await gen(500, "paragraphs"))).toBe("ok");
    expect(code(await gen(5000, "sentences"))).toBe("ok");
    expect(code(await gen(65536, "words"))).toBe("ok");
  });

  test.each([
    [501, "paragraphs"],
    [5001, "sentences"],
  ])("%i %s is E_RANGE", async (n, unit) => {
    expect(code(await gen(n, unit))).toBe("E_RANGE");
  });

  test("a host without a random source is E_PRIMITIVE", async () => {
    vi.stubGlobal("crypto", {});
    expect(code(await gen(3, "words", false))).toBe("E_PRIMITIVE");
  });
});
