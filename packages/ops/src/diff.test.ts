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
 * Tests for the `diff` vocabulary (vocab/diff.fth, src/prims/diff.ts): the text it writes is checked by reading it
 * back (applying a unified diff to the first sample gives the second; the marked text of a word or character diff
 * gives both samples), and its cost at 64 KiB with the default limits. The fixed examples are in vocab/diff.test.json.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { int, str, bool } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["diff"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const text = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};

const SEP = "\u0001";
const compare = (a: string, b: string, by: string, ignore = false, context = 3) =>
  runtime
    .call("diff:compare", [str(a + SEP + b), str(SEP), str(by), bool(ignore), int(context)])
    .then(text);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A sample's lines: a final line feed ends the last line, and the empty text has none. */
const linesOf = (s: string): string[] =>
  s === "" ? [] : (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");

/** Applies a unified diff (as written by diff:compare) to the lines of the first sample. */
function applyUnified(a: string[], diff: string): string[] {
  if (diff === "") return a;
  const rows = diff.split("\n");
  expect(rows.slice(0, 2)).toEqual(["--- sample 1", "+++ sample 2"]);
  const out: string[] = [];
  let ai = 0;
  let k = 2;
  while (k < rows.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(rows[k] as string);
    expect(m).not.toBeNull();
    const aCount = m![2] === undefined ? 1 : Number(m![2]);
    const aStart = aCount === 0 ? Number(m![1]) : Number(m![1]) - 1;
    expect(aStart).toBeGreaterThanOrEqual(ai);
    while (ai < aStart) out.push(a[ai++] as string);
    k++;
    let seenA = 0;
    let seenB = 0;
    while (k < rows.length && !(rows[k] as string).startsWith("@@ ")) {
      const row = rows[k++] as string;
      const rest = row.slice(1);
      if (row[0] === " ") {
        expect(a[ai]).toBe(rest);
        out.push(rest);
        ai++;
        seenA++;
        seenB++;
      } else if (row[0] === "-") {
        expect(a[ai]).toBe(rest);
        ai++;
        seenA++;
      } else {
        expect(row[0]).toBe("+");
        out.push(rest);
        seenB++;
      }
    }
    expect(seenA).toBe(aCount);
    expect(seenB).toBe(m![4] === undefined ? 1 : Number(m![4]));
  }
  while (ai < a.length) out.push(a[ai++] as string);
  return out;
}

describe("catalogue", () => {
  test("diff:compare is the one op, in the Utils category", () => {
    const cat = buildCatalogue(runtime);
    const mine = cat.ops.filter((o) => o.vocab === "diff");
    expect(mine.map((o) => o.qname)).toEqual(["diff:compare"]);
    expect(mine[0]?.category).toBe("Utils");
    expect(mine[0]?.needsHardKill).toBe(true);
  });
});

describe("line diffs read back", () => {
  test("applying the unified diff to the first sample gives the second, for any context", async () => {
    const next = rng(21);
    for (let round = 0; round < 60; round++) {
      const base = Array.from({ length: Math.floor(next() * 40) }, () =>
        String(Math.floor(next() * 6)),
      );
      const other = base.filter(() => next() > 0.15);
      for (let i = 0; i < 4; i++) {
        other.splice(Math.floor(next() * (other.length + 1)), 0, "n" + Math.floor(next() * 3));
      }
      const a = base.join("\n") + (next() < 0.5 ? "\n" : "");
      const b = other.join("\n") + (next() < 0.5 ? "\n" : "");
      for (const context of [0, 1, 3]) {
        const diff = await compare(a, b, "line", false, context);
        expect(applyUnified(linesOf(a), diff)).toEqual(linesOf(b));
      }
    }
  });

  test("the diff is empty exactly when the lines are the same", async () => {
    expect(await compare("a\nb\n", "a\nb", "line")).toBe("");
    expect(await compare("a\nb", "a\nB", "line")).not.toBe("");
    expect(await compare("", "", "line")).toBe("");
  });

  test("the number of - and + lines is the edit distance", async () => {
    const diff = await compare("a\nb\nc\nd\ne", "b\nc\nX\ne\nf", "line", false, 0);
    const rows = diff.split("\n");
    expect(rows.filter((r) => r.startsWith("-") && !r.startsWith("---")).length).toBe(2);
    expect(rows.filter((r) => r.startsWith("+") && !r.startsWith("+++")).length).toBe(2);
  });
});

describe("word and character diffs read back", () => {
  const strip = (s: string, drop: RegExp, keep: RegExp) =>
    s.replace(drop, "").replace(keep, (_m, x: string) => x);

  test.each(["word", "character"])("by %s: the marked text holds both samples", async (by) => {
    const next = rng(22);
    const pieces = by === "word" ? ["a", "bb", "c", " ", "  ", "d"] : ["a", "b", "c", " ", "d"];
    const make = () =>
      Array.from(
        { length: Math.floor(next() * 30) },
        () => pieces[Math.floor(next() * pieces.length)],
      ).join(by === "word" ? " " : "");
    for (let round = 0; round < 80; round++) {
      const a = make().replace(/[[\]{}+-]/g, "");
      const b = make().replace(/[[\]{}+-]/g, "");
      const out = await compare(a, b, by);
      // the text with the insertions removed and the deletions kept is a, and the other way round is b
      expect(strip(out, /\{\+[^]*?\+\}/g, /\[-([^]*?)-\]/g)).toBe(a);
      expect(strip(out, /\[-[^]*?-\]/g, /\{\+([^]*?)\+\}/g)).toBe(b);
    }
  });

  test("equal samples are shown unmarked", async () => {
    expect(await compare("same text", "same text", "word")).toBe("same text");
    expect(await compare("same text", "same text", "character")).toBe("same text");
  });
});

describe("the cost at 64 KiB with the default limits", () => {
  const next = rng(23);
  const mk = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

  test("lines, 9,000 of them with every 37th changed", async () => {
    const a = mk(9000, (i) => "line " + i).join("\n");
    const b = a
      .split("\n")
      .map((l, i) => (i % 37 === 0 ? l + " changed" : l))
      .join("\n");
    expect(
      code(
        await runtime.call("diff:compare", [
          str(a + SEP + b),
          str(SEP),
          str("line"),
          bool(false),
          int(3),
        ]),
      ),
    ).toBe("ok");
  });

  test("lines that are all different", async () => {
    const a = mk(15000, (i) => "a" + i).join("\n");
    const b = mk(15000, (i) => "b" + i).join("\n");
    expect(
      code(
        await runtime.call("diff:compare", [
          str(a + SEP + b),
          str(SEP),
          str("line"),
          bool(false),
          int(3),
        ]),
      ),
    ).toBe("ok");
  });

  test("30,000 unrelated characters on each side", async () => {
    const a = mk(30000, () => "abcdefghij"[Math.floor(next() * 10)] as string).join("");
    const b = mk(30000, () => "abcdefghij"[Math.floor(next() * 10)] as string).join("");
    expect(
      code(
        await runtime.call("diff:compare", [
          str(a + SEP + b),
          str(SEP),
          str("character"),
          bool(false),
          int(3),
        ]),
      ),
    ).toBe("ok");
  });

  test("10,000 words with white space ignored", async () => {
    const a = mk(10000, () => "w" + Math.floor(next() * 500)).join(" ");
    const b = a
      .split(" ")
      .map((w) => (next() < 0.05 ? "q" : w))
      .join("  ");
    expect(
      code(
        await runtime.call("diff:compare", [
          str(a + SEP + b),
          str(SEP),
          str("word"),
          bool(true),
          int(3),
        ]),
      ),
    ).toBe("ok");
  });
});
