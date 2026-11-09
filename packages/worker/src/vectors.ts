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
 * The op test vector runner (RECIPES.md section 9.3): every vector becomes a one-step recipe that is
 * baked, and the result is compared with the expectation.
 */
import { decodeEncoded } from "@forge/recipe";
import { outputToJson } from "./render.js";
import type {
  BakeResult,
  OpTestVector,
  RunOpVectorsFn,
  VectorFailure,
  VectorReport,
} from "./types.js";

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += (b < 16 ? "0" : "") + b.toString(16);
  return out;
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

/** JSON equality where object key order does not matter. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (typeof a === "object" && a !== null) {
    if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every(
        (k) =>
          Object.hasOwn(b, k) &&
          jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return Object.is(a, b);
}

/** A description of how `result` differs from the expectation, or null when it matches. */
function compare(vector: OpTestVector, result: BakeResult): string | null {
  const expect = vector.expect;
  if ("error" in expect) {
    if (result.ok) return `expected error ${expect.error}, got a result`;
    const path = expect.error === "E_RECIPE_INVALID" ? null : "/steps/0";
    if (result.error.code !== expect.error || result.error.path !== path) {
      return `expected error ${expect.error} at ${show(path)}, got ${result.error.code} at ${show(result.error.path)}: ${result.error.message}`;
    }
    return null;
  }
  if (!result.ok) {
    return `expected a result, got error ${result.error.code}: ${result.error.message}`;
  }
  const output = result.output;
  if ("json" in expect) {
    const actual = outputToJson(output);
    return jsonEqual(actual, expect.json)
      ? null
      : `expected json ${show(expect.json)}, got ${show(actual)}`;
  }
  const want = decodeEncoded(expect);
  let got: Uint8Array;
  if (output.kind === "bytes") got = output.bytes;
  else if (output.kind === "str") got = decodeEncoded({ value: output.text, enc: "utf8" });
  else return `expected bytes, got a ${output.kind} output`;
  return hex(want) === hex(got) ? null : `expected hex ${hex(want)}, got hex ${hex(got)}`;
}

export const runOpVectors: RunOpVectorsFn = async ({ baker, catalogue, files }) => {
  const names = new Map<string, string>();
  for (const op of catalogue.ops) {
    names.set(op.qname, op.qname);
    const vocab = op.qname.slice(0, op.qname.indexOf(":"));
    for (const alias of op.aliases) {
      if (!names.has(`${vocab}:${alias}`)) names.set(`${vocab}:${alias}`, op.qname);
    }
  }
  const covered = new Set<string>();
  const failures: VectorFailure[] = [];
  let total = 0;
  let passed = 0;

  for (const file of Object.keys(files).sort()) {
    const vectors = files[file] ?? [];
    for (const [index, vector] of vectors.entries()) {
      total++;
      const label = vector.name ?? vector.op;
      const fail = (message: string): void => {
        failures.push({
          file,
          index,
          name: label,
          message: `${file}#${index} ${label}: ${message}`,
        });
      };
      const canonical = names.get(vector.op);
      if (canonical === undefined) {
        fail(`'${vector.op}' is not an operation of the catalogue`);
        continue;
      }
      covered.add(canonical);
      let input: Uint8Array;
      try {
        input = decodeEncoded(vector.input);
      } catch (e) {
        fail(`bad input: ${(e as Error).message}`);
        continue;
      }
      const recipe = {
        forge: 1,
        steps: [{ kind: "op", op: vector.op, params: vector.params }],
      };
      const result = await baker.bake(recipe, input, { trust: "trusted", pins: "ignore" });
      let problem: string | null;
      try {
        problem = compare(vector, result);
      } catch (e) {
        problem = `bad expectation: ${(e as Error).message}`;
      }
      if (problem === null) passed++;
      else fail(problem);
    }
  }

  const uncovered = catalogue.ops.map((o) => o.qname).filter((q) => !covered.has(q));
  const report: VectorReport = { total, passed, failures, uncovered };
  return report;
};
