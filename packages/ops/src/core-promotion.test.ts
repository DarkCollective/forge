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
import { valueHelpers } from "@forge/lang";
import type { RunResult, Value } from "@forge/lang";

import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

/** The error a failed run carries, as the runtime types it. */
type RunFailure = Extract<RunResult, { ok: false }>["error"];

// docs/LANGUAGE-0.2.md section 13: twenty `util` words are copied into `core` by an FL prelude, and
// `fail-coerce` and `fail-range` raise the errors `raise:coerce` and `raise:range` raise. Each
// promoted word must give the same results, error codes, messages and details as its `util:` twin.
const { int, str, bytes, list, bool, num, repr } = valueHelpers;
const bundle = await loadBundleNode("all");
const runtime = assembleRuntime(bundle);

const I = (n: number | bigint): Value => int(n);
const S = (s: string): Value => str(s);
const B = (...xs: number[]): Value => bytes(new Uint8Array(xs));
const L = (...xs: Value[]): Value => list(xs);

/** What a call produced, reduced to what must be equal between the twins. */
interface Outcome {
  readonly ok: boolean;
  readonly stack?: string[];
  readonly code?: string;
  readonly message?: string;
  readonly detail?: unknown;
}

/**
 * The only text that may differ is the qualified name of the word itself (a stack underflow names
 * it), which is replaced by `@name`.
 */
function outcome(r: RunResult, twins = false): Outcome {
  if (r.ok) return { ok: true, stack: r.stack.map((v) => repr(v)) };
  const e = r.error;
  const norm = (t: string): string =>
    twins ? t.replace(/\b(?:util|core|raise):[^\s"]+/g, "@") : t;
  return {
    ok: false,
    code: e.code,
    message: norm(e.message),
    detail: JSON.parse(norm(JSON.stringify(e.detail ?? null))) as unknown,
  };
}

async function callBoth(name: string, args: Value[]): Promise<[Outcome, Outcome]> {
  const u = outcome(await runtime.call(`util:${name}`, args), true);
  const c = outcome(await runtime.call(`core:${name}`, args), true);
  return [u, c];
}

type Case = Value[];

/** Argument tables per word: normal values, edges, wrong types and too few arguments. */
const ints = [
  0, 1, 2, 5, 9, 10, 15, 16, 17, -1, -7, 48, 57, 58, 64, 65, 70, 71, 96, 97, 102, 103, 255, 256,
];
const wrong: Value[] = [S("x"), num(1.5), bool(true), L(), B(1)];

function product(...axes: Value[][]): Case[] {
  return axes.reduce<Case[]>((acc, axis) => acc.flatMap((c) => axis.map((v) => [...c, v])), [[]]);
}

const BIG = 2n ** 70n;

const tables: Record<string, Case[]> = {
  "between?": [
    ...product(ints.map(I).slice(0, 12), [I(0), I(5)], [I(5), I(10)]),
    [I(BIG), I(0), I(10)],
    [I(5), I(-BIG), I(BIG)],
    [I(3), I(5), I(1)],
    ...wrong.flatMap((w) => [
      [w, I(0), I(1)],
      [I(0), w, I(1)],
      [I(0), I(0), w],
    ]),
    [],
    [I(1)],
    [I(1), I(2)],
  ],
  "cp>str": [
    ...[
      0, 1, 65, 0x7f, 0xff, 0x7ff, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10000, 0x1f600,
      0x10ffff, 0x110000, -1, 55296, 57343,
    ].map((n) => [I(n)]),
    [I(BIG)],
    ...wrong.map((w) => [w]),
    [],
  ],
  "int>be-bytes": [
    ...product([0, 1, 255, 256, 65535, 65536, 0x12345678, -1, -256].map(I), [0, 1, 2, 4, 8].map(I)),
    [I(BIG), I(8)],
    [I(BIG), I(9)],
    [I(5), I(-1)],
    [I(5), I(20000)],
    ...wrong.flatMap((w) => [
      [w, I(1)],
      [I(1), w],
    ]),
    [I(1)],
    [],
  ],
  "space?": [...ints.map((n) => [I(n)]), [I(32)], [I(BIG)], ...wrong.map((w) => [w]), []],
  "starts-with?": [
    ...product(
      ["", "a", "abc", "ab", "é", "😀x", "ABC"].map(S),
      ["", "a", "ab", "abc", "abcd", "é", "😀", "bc"].map(S),
    ),
    ...wrong.flatMap((w) => [
      [w, S("a")],
      [S("a"), w],
    ]),
    [S("a")],
    [],
  ],
  "ends-with?": [
    ...product(
      ["", "a", "abc", "bc", "é", "x😀", "ABC"].map(S),
      ["", "c", "bc", "abc", "abcd", "é", "😀", "ab"].map(S),
    ),
    ...wrong.flatMap((w) => [
      [w, S("a")],
      [S("a"), w],
    ]),
    [S("a")],
    [],
  ],
  "repeat-str": [
    ...product(["", "a", "ab", "😀"].map(S), [0, 1, 2, 5, 40].map(I)),
    [S("a"), I(-1)],
    [S("a"), I(BIG)],
    ...wrong.flatMap((w) => [
      [w, I(1)],
      [S("a"), w],
    ]),
    [S("a")],
    [],
  ],
  "pad-hex": [
    ...product(
      [0, 1, 15, 16, 255, 4096, 0xdeadbeef, -1, -255].map(I),
      [0, 1, 2, 4, 8, 16, 17, 40].map(I),
    ),
    [I(BIG), I(4)],
    [I(BIG), I(30)],
    ...wrong.flatMap((w) => [
      [w, I(1)],
      [I(1), w],
    ]),
    [I(1)],
    [],
  ],
  "check-int-range": [
    ...product([-1, 0, 5, 9, 10, 12].map(I), [I(0)], [I(9)], ["the level", ""].map(S)),
    [I(BIG), I(0), I(9), S("big")],
    [I(5), I(-BIG), I(BIG), S("ok")],
    [I(1), I(5), I(0), S("empty range")],
    ...wrong.flatMap((w) => [
      [w, I(0), I(9), S("w")],
      [I(1), w, I(9), S("w")],
      [I(1), I(0), w, S("w")],
      [I(1), I(0), I(9), w],
    ]),
    [I(1), I(0), I(9)],
    [],
  ],
  "digits>int": [
    ...product([B(), B(1), B(1, 2, 3), B(255, 255), B(0, 0, 7)], [2, 8, 10, 16, 36, 256].map(I)),
    [B(...Array(40).fill(255)), I(256)],
    [B(1), I(0)],
    [B(1, 1), I(-2)],
    ...wrong.flatMap((w) => [
      [w, I(10)],
      [B(1), w],
    ]),
    [B(1)],
    [],
  ],
  "contains?": [
    ...product(
      [L(), L(I(1), I(2), I(3)), L(S("a"), S("b")), L(I(1), num(2)), L(L(I(1)), L(I(2)))],
      [I(1), I(2), num(2), S("a"), S("z"), L(I(2)), bool(true)],
    ),
    [L(I(BIG)), I(BIG)],
    [S("abc"), S("a")],
    [I(1), I(1)],
    [L(I(1))],
    [],
  ],
  "strip-space": [
    ...["", "abc", " a b\tc\n", "\t\n\v\f\r ", "a b", "é x😀", "  x", "x  "].map((s) => [S(s)]),
    ...wrong.map((w) => [w]),
    [],
  ],
  "trim-end": [],
  "trim-start": [],
  "zero-bytes": [
    ...[0, 1, 2, 16, 300].map((n) => [I(n)]),
    [I(-1)],
    [I(BIG)],
    ...wrong.map((w) => [w]),
    [],
  ],
  "count-leading": [],
  "dec-digit?": [...ints.map((n) => [I(n)]), [I(BIG)], ...wrong.map((w) => [w]), []],
  "hex-digit?": [...ints.map((n) => [I(n)]), [I(BIG)], ...wrong.map((w) => [w]), []],
  sum: [
    [L()],
    [L(I(1))],
    [L(I(1), I(2), I(3))],
    [L(I(-5), I(5))],
    [L(I(2n ** 60n), I(2n ** 60n))],
    [L(I(1), num(2.5))],
    [L(num(1.5), num(2.5))],
    [L(I(1), S("a"))],
    [L(S("a"))],
    ...wrong.map((w) => [w]),
    [],
  ],
  "ceil-div": [
    ...product([0, 1, 6, 7, 8, 100, -1, -7].map(I), [1, 2, 3, 7, 0, -2].map(I)),
    [I(BIG), I(3)],
    [I(5), I(BIG)],
    ...wrong.flatMap((w) => [
      [w, I(1)],
      [I(1), w],
    ]),
    [I(1)],
    [],
  ],
};

// The quotation-taking words are called from FL source, so that a quotation can be the argument.
// Each snippet is run with `util:` and with `core:` substituted for @.
const quotSnippets: Record<string, string[]> = {
  "trim-start": [
    `"xxab" [ 'x' = ] @trim-start`,
    `"" [ 'x' = ] @trim-start`,
    `"xxxx" [ 'x' = ] @trim-start`,
    `"abxx" [ 'x' = ] @trim-start`,
    `"  \\t a b " [ @space? ] @trim-start`,
    `"😀😀a" [ 128512 = ] @trim-start`,
    `"abc" [ drop false ] @trim-start`,
    `"abc" [ drop true ] @trim-start`,
    `"abc" [ drop 1 ] @trim-start`,
    `"abc" [ drop ] @trim-start`,
    `1 [ drop true ] @trim-start`,
    `"abc" 1 @trim-start`,
    `"abc" @trim-start`,
    `@trim-start`,
  ],
  "trim-end": [
    `"abxx" [ 'x' = ] @trim-end`,
    `"" [ 'x' = ] @trim-end`,
    `"xxxx" [ 'x' = ] @trim-end`,
    `"xxab" [ 'x' = ] @trim-end`,
    `"a b \\t  " [ @space? ] @trim-end`,
    `"a😀😀" [ 128512 = ] @trim-end`,
    `"abc" [ drop false ] @trim-end`,
    `"abc" [ drop true ] @trim-end`,
    `"abc" [ drop 1 ] @trim-end`,
    `1 [ drop true ] @trim-end`,
    `"abc" 1 @trim-end`,
    `"abc" @trim-end`,
    `@trim-end`,
  ],
  "count-leading": [
    `{ 1 1 2 1 } [ 1 = ] @count-leading`,
    `{ } [ 1 = ] @count-leading`,
    `{ 2 1 } [ 1 = ] @count-leading`,
    `{ 1 1 1 } [ 1 = ] @count-leading`,
    `#[ 00 00 07 00 ] [ 0 = ] @count-leading`,
    `#[ ] [ 0 = ] @count-leading`,
    `"aab" [ 97 = ] @count-leading`,
    `{ 1 2 } [ drop 1 ] @count-leading`,
    `{ 1 2 } [ drop ] @count-leading`,
    `{ 1 2 } 1 @count-leading`,
    `{ 1 2 } [ "a" = ] @count-leading`,
    `1 [ drop true ] @count-leading`,
    `{ 1 } @count-leading`,
    `@count-leading`,
  ],
};

describe("promoted util words: core twins give the same results, errors, messages and details", () => {
  for (const [name, cases] of Object.entries(tables)) {
    if (cases.length === 0) continue;
    test(`${name} (${cases.length} argument lists)`, async () => {
      let errors = 0;
      for (const args of cases) {
        const [u, c] = await callBoth(name, args);
        expect(c, `${name} ${args.map((a) => repr(a)).join(" ")}`).toEqual(u);
        if (!u.ok) errors += 1;
      }
      // every table exercises at least one failure and one success
      expect(errors).toBeGreaterThan(0);
      expect(errors).toBeLessThan(cases.length);
    });
  }

  for (const [name, snippets] of Object.entries(quotSnippets)) {
    test(`${name} (${snippets.length} programs with quotations)`, async () => {
      let errors = 0;
      for (const src of snippets) {
        const u = outcome(await runtime.run(src.replaceAll("@", "util:")), true);
        const c = outcome(await runtime.run(src.replaceAll("@", "core:")), true);
        expect(c, src).toEqual(u);
        if (!u.ok) errors += 1;
      }
      expect(errors).toBeGreaterThan(0);
      expect(errors).toBeLessThan(snippets.length);
    });
  }

  test("the twenty words are all covered", () => {
    const covered = new Set([...Object.keys(tables), ...Object.keys(quotSnippets)]);
    expect(covered.size).toBe(20);
    for (const w of covered) {
      expect(runtime.lookup(`core:${w}`).kind, w).toBe("fl");
      expect(runtime.lookup(`util:${w}`).kind, w).toBe("fl");
    }
  });

  test("the unqualified name resolves to core outside util, to util inside it or with USING", async () => {
    expect(runtime.lookup("between?").qname).toBe("core:between?");
    expect(runtime.lookup("between?", { current: "util", using: [] }).qname).toBe("util:between?");
    expect(runtime.lookup("between?", { current: "user", using: ["util"] }).qname).toBe(
      "util:between?",
    );
  });

  test("each core copy is a word with a hash of its own; check-int-range differs in text", () => {
    for (const w of Object.keys(tables)) {
      const a = runtime.lookup(`util:${w}`).meta.hash;
      const b = runtime.lookup(`core:${w}`).meta.hash;
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(b).toMatch(/^[0-9a-f]{64}$/);
      // check-int-range differs in text (raise:range became fail-range); the others may share a
      // hash with their twin (same text) or not (callees are other words), which is not specified
      if (w === "check-int-range") expect(a).not.toBe(b);
    }
  });

  test("the effect headers and docs are identical", () => {
    for (const w of Object.keys(tables)) {
      const u = runtime.lookup(`util:${w}`).meta;
      const c = runtime.lookup(`core:${w}`).meta;
      expect(c.effect, w).toEqual(u.effect);
      expect(c.doc, w).toBe(u.doc);
    }
  });
});

describe("fail-range and fail-coerce raise the errors of raise:range and raise:coerce", () => {
  const reasons = ["bad", "", 'a longer reason: with "quotes" and é 😀', "x".repeat(300)];

  async function errorOf(word: string, reason: string): Promise<RunFailure> {
    const r = await runtime.call(word, [S(reason)]);
    expect(r.ok, word).toBe(false);
    if (r.ok) throw new Error("unreachable");
    return r.error;
  }

  test.each([
    ["fail-range", "raise:range", "E_RANGE"],
    ["fail-coerce", "raise:coerce", "E_COERCE"],
  ])("%s equals %s in code, message and detail", async (core, raise, code) => {
    for (const reason of reasons) {
      const a = await errorOf(core, reason);
      const b = await errorOf(raise, reason);
      expect(a.code).toBe(code);
      expect(a.code).toBe(b.code);
      expect(a.message).toBe(b.message);
      expect(a.detail).toEqual(b.detail);
      expect(a.toJSON().detail).toEqual(b.toJSON().detail);
    }
  });

  test("only the word differs", async () => {
    expect((await errorOf("fail-range", "r")).word).toBe("core:fail-range");
    expect((await errorOf("raise:range", "r")).word).toBe("raise:range");
  });

  test("a non-string reason and a missing reason are the same errors", async () => {
    for (const [a, b] of [
      ["fail-range", "raise:range"],
      ["fail-coerce", "raise:coerce"],
    ] as const) {
      for (const args of [[I(1)], [L()], []]) {
        const x = outcome(await runtime.call(a, args), true);
        const y = outcome(await runtime.call(b, args), true);
        expect(x).toEqual(y);
        expect(x.ok).toBe(false);
      }
    }
  });

  test("they can be caught like the originals and carry no other code", async () => {
    const r = await runtime.run(
      '[ "bad" fail-range ] [ "code" get ] try . [ "bad" fail-coerce ] [ "code" get ] try .',
    );
    expect(r.ok && r.output).toBe("E_RANGE\nE_COERCE\n");
  });
});
