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
 * Tests for `rake:keywords` beyond its vectors (vocab/rake.test.json): the scores against an independent
 * JavaScript implementation of the RAKE definition on random text, words that are also property names, the
 * built-in stop list, and 64 KiB of text with the default limits.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["rake"]));

let seed = 0x9e3779b9;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const below = (n: number) => Math.floor(rand() * n);

type Result = Awaited<ReturnType<typeof runtime.call>>;
const out = (r: Result): string => {
  if (!r.ok) throw new Error(r.error.code + ": " + r.error.message);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const keywords = (text: string, maxWords = 3, stops = "", limit = 0) =>
  runtime.call("rake:keywords", [str(text), int(maxWords), str(stops), int(limit)]);

/** RAKE from its definition, over text made only of lower-case words, commas and full stops. */
function reference(text: string, stops: Set<string>, maxWords: number): string[] {
  const candidates: string[][] = [];
  for (const piece of text.split(/[.,]/)) {
    let run: string[] = [];
    for (const w of piece.split(/\s+/).filter(Boolean)) {
      if (stops.has(w)) {
        if (run.length) candidates.push(run);
        run = [];
      } else run.push(w);
    }
    if (run.length) candidates.push(run);
  }
  const kept = candidates.filter((c) => c.length <= maxWords);
  const freq = new Map<string, number>();
  const deg = new Map<string, number>();
  for (const c of kept)
    for (const w of c) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
      deg.set(w, (deg.get(w) ?? 0) + c.length);
    }
  const scores = new Map<string, number>();
  for (const c of kept) {
    const phrase = c.join(" ");
    scores.set(
      phrase,
      c.reduce((a, w) => a + (deg.get(w) as number) / (freq.get(w) as number), 0),
    );
  }
  const rows = [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return rows.map(([p, sc]) => `${(Math.round(sc * 100) / 100).toFixed(2)}: ${p}`);
}

describe("rake:keywords against the definition", () => {
  const vocabulary = Array.from({ length: 40 }, (_, i) => "w" + i.toString(36) + "x");
  const stopList = ["the", "of", "and", "in"];
  for (const maxWords of [1, 2, 3, 5]) {
    test(`random text, max-words ${maxWords}`, async () => {
      const parts: string[] = [];
      for (let i = 0; i < 400; i++) {
        const r = below(10);
        parts.push(
          r < 2
            ? (stopList[below(4)] as string)
            : r === 2
              ? ","
              : r === 3
                ? "."
                : (vocabulary[below(vocabulary.length)] as string),
        );
      }
      const text = parts.join(" ");
      const got = out(await keywords(text, maxWords, stopList.join(" ")));
      const want = reference(text, new Set(stopList), maxWords);
      expect(got.split("\n").filter(Boolean).length).toBe(want.length);
      // Scores are compared as numbers: a sum of floats may round the second decimal either way.
      const g = got
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(": "));
      const w = want.map((l) => l.split(": "));
      for (let i = 0; i < w.length; i++) {
        expect(Math.abs(Number(g[i]?.[0]) - Number(w[i]?.[0]))).toBeLessThanOrEqual(0.011);
      }
      expect(new Set(g.map((x) => x[1]))).toEqual(new Set(w.map((x) => x[1])));
    });
  }
});

describe("rake:keywords, other points", () => {
  test("words that are property names of an object are plain words", async () => {
    const r = out(
      await keywords("constructor prototype. __proto__ toString, hasOwnProperty is valueOf"),
    );
    expect(r).toContain("constructor prototype");
    expect(r).toContain("proto");
    expect(r).toContain("tostring");
    expect(r).toContain("hasownproperty");
    expect(r).toContain("valueof");
  });

  test("the built-in stop words end phrases and the list is lower-cased text", async () => {
    const r = out(await keywords("Neural networks and deep learning for the analysis of data"));
    expect(
      r
        .split("\n")
        .map((l) => l.split(": ")[1])
        .sort(),
    ).toEqual(["analysis", "data", "deep learning", "neural networks"]);
  });

  test("a hyphen between spaces is a break, a hyphen inside a word is not", async () => {
    const r = out(await keywords("alpha - beta well-known gamma"));
    expect(
      r
        .split("\n")
        .map((l) => l.split(": ")[1])
        .sort(),
    ).toEqual(["alpha", "beta well-known gamma"]);
  });

  test("upper case is folded and the same phrase is output once", async () => {
    expect(out(await keywords("Fast cars. FAST CARS. fast cars!"))).toBe("4.00: fast cars");
  });

  test("white space only in stop-words falls back to the built-in list", async () => {
    expect(out(await keywords("rain and snow", 3, "  \n "))).toBe(
      out(await keywords("rain and snow")),
    );
  });

  test("limit larger than the number of phrases gives all of them", async () => {
    expect(out(await keywords("rain and snow", 3, "", 50))).toBe("1.00: rain\n1.00: snow");
  });

  test("a line break inside a phrase is one space", async () => {
    expect(out(await keywords("machine\n\nlearning"))).toBe("4.00: machine learning");
  });

  test("a text without a candidate gives an empty output", async () => {
    expect(out(await keywords("... !!! the of and"))).toBe("");
  });

  test("64 KiB of text within the default limits", async () => {
    const words = Array.from({ length: 500 }, (_, i) => "term" + i);
    const stops = ["the", "of", "and"];
    let text = "";
    while (text.length < 65536) {
      const r = below(8);
      text +=
        (r < 2 ? stops[below(3)] : words[below(words.length)]) + (below(12) === 0 ? ". " : " ");
    }
    const t = Date.now();
    const r = await keywords(text);
    expect(code(r)).toBe("ok");
    expect(out(r).split("\n").length).toBeGreaterThan(100);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  test("a text with no break at all and the longest max-words", async () => {
    const text = Array.from({ length: 6000 }, (_, i) => "k" + (i % 97)).join(" ");
    const t = Date.now();
    const r = await keywords(text, 30);
    expect(code(r)).toBe("ok");
    expect(out(r)).toBe("");
    expect(Date.now() - t).toBeLessThan(5000);
  });
});
