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
 * Check pairs (RECIPES.md section 9.1): entries `{ op, checks, data, expect }` in the vocabularies'
 * `.test.json` arrays. This harness evaluates every pair against the op's `checks` of that scope and
 * enforces the coverage rule (every op with `input` checks has a pass and a fail input pair; every op
 * with `output` checks a pass output pair). The pair logic is `verifyPairs`, run on the real
 * vocabularies and, with the same code, on an in-memory fixture. The op vector runners skip pairs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { buildChecks } from "./checks-doc.js";
import { dataView, evaluateChecks } from "./checks/index.js";
import type { CheckResult, CheckScope } from "./checks/index.js";
import { loadBundleNode } from "./sources-node.js";
import type { ChecksDoc } from "./types.js";

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

interface Pair {
  readonly name?: string;
  readonly op: string;
  readonly checks: CheckScope;
  readonly data: { readonly value: string; readonly enc: string };
  readonly expect: CheckResult;
}

interface CatalogueLike {
  readonly ops: readonly { readonly qname: string; readonly aliases: readonly string[] }[];
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The bytes of `{ value, enc }` (utf8, hex, latin1 or base64), as for a vector input. */
function decodeData(value: string, enc: string): Uint8Array {
  if (enc === "utf8") return new TextEncoder().encode(value);
  if (enc === "hex") {
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error("not hex");
    const out = new Uint8Array(value.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(2 * i, 2 * i + 2), 16);
    return out;
  }
  if (enc === "latin1") {
    return Uint8Array.from(Array.from(value), (c) => {
      const cp = c.codePointAt(0) ?? 0;
      if (cp > 255) throw new Error("not latin1");
      return cp;
    });
  }
  if (enc === "base64") {
    const text = value.replace(/=+$/, "");
    if (!/^[A-Za-z0-9+/]*$/.test(text) || text.length % 4 === 1) throw new Error("not base64");
    const out: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const c of text) {
      acc = ((acc << 6) | B64.indexOf(c)) & 0xffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 0xff);
      }
    }
    return Uint8Array.from(out);
  }
  throw new Error(`unknown enc "${enc}"`);
}

function isPair(x: unknown): x is Pair {
  return typeof x === "object" && x !== null && !Array.isArray(x) && "checks" in x;
}

/**
 * Every problem with the pairs of `files` (parsed `.test.json` arrays by vocabulary), as messages:
 * a pair whose op is not in the catalogue or has no checks of its scope, a pair whose result is not
 * its `expect`, and an op with checks that lacks the required pairs.
 */
function verifyPairs(
  doc: ChecksDoc,
  catalogue: CatalogueLike,
  files: Readonly<Record<string, readonly unknown[]>>,
): string[] {
  const canonical = new Map<string, string>();
  for (const op of catalogue.ops) {
    canonical.set(op.qname, op.qname);
    const vocab = op.qname.slice(0, op.qname.indexOf(":"));
    for (const alias of op.aliases) canonical.set(`${vocab}:${alias}`, op.qname);
  }
  const problems: string[] = [];
  const seen = new Map<string, Set<string>>(); // "qname scope" -> the expectations of its pairs
  for (const [vocab, entries] of Object.entries(files)) {
    entries.forEach((entry, index) => {
      if (!isPair(entry)) return;
      const label = entry.name === undefined ? "" : ` "${entry.name}"`;
      const where = `${vocab}.test.json[${index}]${label} (${entry.op}, ${entry.checks} pair, expects ${entry.expect})`;
      const qname = canonical.get(entry.op);
      if (qname === undefined) {
        problems.push(`${where}: ${entry.op} is not an operation of the catalogue`);
        return;
      }
      const checks = (doc.ops[qname]?.checks ?? []).filter((c) => c.scope === entry.checks);
      if (checks.length === 0) {
        problems.push(`${where}: ${qname} has no ${entry.checks} checks`);
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = decodeData(entry.data.value, entry.data.enc);
      } catch (e) {
        problems.push(`${where}: bad data: ${(e as Error).message}`);
        return;
      }
      const got = evaluateChecks(checks, dataView(bytes), entry.checks).result;
      if (got !== entry.expect) problems.push(`${where}: the checks gave ${got}`);
      const key = `${qname} ${entry.checks}`;
      seen.set(key, (seen.get(key) ?? new Set<string>()).add(entry.expect));
    });
  }
  for (const [qname, op] of Object.entries(doc.ops)) {
    const has = (scope: CheckScope): boolean => op.checks.some((c) => c.scope === scope);
    const got = (scope: CheckScope): Set<string> => seen.get(`${qname} ${scope}`) ?? new Set();
    if (has("input")) {
      for (const want of ["pass", "fail"]) {
        if (!got("input").has(want)) {
          problems.push(`${qname} has input checks but no ${want} input pair`);
        }
      }
    }
    if (has("output") && !got("output").has("pass")) {
      problems.push(`${qname} has output checks but no pass output pair`);
    }
  }
  return problems;
}

const empty = { vocabs: [], units: [], primitives: [] };
const FX = (name: string): string =>
  `: ${name} ( s:str -- str ) "${name}." doc "Fixture" category s ;\n`;

function fixture(source: string) {
  const runtime = assembleRuntime(empty, {
    units: [{ name: "t.fth", source: `IN: t\n${source}` }],
  });
  const catalogue = buildCatalogue(runtime);
  return { catalogue, doc: buildChecks(runtime, catalogue) };
}

const hex = (value: string) => ({ value, enc: "hex" });
const pair = (over: Record<string, unknown>) => ({
  op: "t:gunzip",
  checks: "input",
  data: hex("1f8b0800"),
  expect: "pass",
  ...over,
});

describe("check pairs on a fixture word", () => {
  const fx = fixture(
    FX("gunzip") +
      FX("plain") +
      'META: gunzip checks input magic-bytes "1f8b" ; checks output utf8 ; ;\n',
  );
  const good = [
    pair({ name: "gzip header" }),
    pair({ data: { value: "hello", enc: "utf8" }, expect: "fail" }),
    pair({ checks: "output", data: { value: "hello", enc: "utf8" }, expect: "pass" }),
  ];
  const run = (...entries: unknown[]) => verifyPairs(fx.doc, fx.catalogue, { t: entries });

  test("complete, correct pairs give no problem; other entries are ignored", () => {
    expect(run(...good)).toEqual([]);
    const vector = { op: "t:gunzip", params: {}, input: hex("00"), expect: hex("00") };
    expect(run(...good, vector)).toEqual([]);
  });

  test("the encodings decode, and bad data is a problem", () => {
    const withData = (data: unknown) => run(...good, pair({ data, name: "e" }));
    expect(withData({ value: "H4sI", enc: "base64" })).toEqual([]);
    expect(withData({ value: "\u001f\u008b", enc: "latin1" })).toEqual([]);
    expect(withData({ value: "zz", enc: "hex" })[0]).toContain("bad data");
  });

  test("a wrong expectation names the pair and the result", () => {
    const [msg, ...rest] = run(...good, pair({ name: "liar", expect: "fail" }));
    expect(rest).toEqual([]);
    expect(msg).toBe(
      't.test.json[3] "liar" (t:gunzip, input pair, expects fail): the checks gave pass',
    );
  });

  test("a pair for an op with no checks of its scope, or no such op, is a problem", () => {
    expect(run(...good, pair({ op: "t:plain" }))[0]).toContain("t:plain has no input checks");
    expect(run(...good, pair({ op: "t:nope" }))[0]).toContain("not an operation of the catalogue");
    const outOnly = fixture(FX("g") + "META: g checks output utf8 ; ;\n");
    const out = verifyPairs(outOnly.doc, outOnly.catalogue, {
      t: [
        pair({ op: "t:g" }),
        pair({ op: "t:g", checks: "output", data: { value: "hi", enc: "utf8" } }),
      ],
    });
    expect(out).toEqual([
      "t.test.json[0] (t:g, input pair, expects pass): t:g has no input checks",
    ]);
  });

  test("coverage: input checks need a pass and a fail pair, output checks a pass pair", () => {
    expect(run()).toEqual([
      "t:gunzip has input checks but no pass input pair",
      "t:gunzip has input checks but no fail input pair",
      "t:gunzip has output checks but no pass output pair",
    ]);
    expect(run(good[0], good[2])).toEqual(["t:gunzip has input checks but no fail input pair"]);
    expect(run(good[0], good[1])).toEqual(["t:gunzip has output checks but no pass output pair"]);
  });

  test("an op with no checks needs no pairs", () => {
    const none = fixture(FX("plain"));
    expect(verifyPairs(none.doc, none.catalogue, { t: [] })).toEqual([]);
  });
});

const bundle = await loadBundleNode("all");

describe("check pairs in the vocabulary test files", () => {
  const vocabDir = fileURLToPath(new URL("../vocab", import.meta.url).href);
  const names = readdirSync(vocabDir)
    .filter((f) => f.endsWith(".test.json"))
    .sort();
  const files: Record<string, unknown[]> = {};
  for (const name of names) {
    files[name.slice(0, -".test.json".length)] = JSON.parse(
      readFileSync(`${vocabDir}/${name}`, "utf8"),
    ) as unknown[];
  }

  test("every pair gives its expected result and the coverage rule holds", () => {
    const runtime = assembleRuntime(bundle);
    const catalogue = buildCatalogue(runtime);
    expect(verifyPairs(buildChecks(runtime, catalogue), catalogue, files)).toEqual([]);
  });

  test("vectors.schema.json accepts pairs and refuses malformed ones", () => {
    const schema = JSON.parse(readFileSync(`${vocabDir}/vectors.schema.json`, "utf8")) as object;
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    const vector = {
      op: "base64:encode",
      params: {},
      input: { value: "a", enc: "utf8" },
      expect: { value: "YQ==", enc: "utf8" },
    };
    const ok = pair({ op: "gzip:gunzip", name: "n", ref: "r" });
    expect(validate([vector, ok, pair({ checks: "output", expect: "unknown" })])).toBe(true);
    expect(validate([pair({ checks: "both" })])).toBe(false);
    expect(validate([pair({ expect: "maybe" })])).toBe(false);
    expect(validate([pair({ data: "00" })])).toBe(false);
    expect(validate([pair({ params: {} })])).toBe(false);
    expect(validate([pair({ example: { title: "T" } })])).toBe(false);
    expect(validate([{ ...vector, checks: "input" }])).toBe(false);
  });
});
