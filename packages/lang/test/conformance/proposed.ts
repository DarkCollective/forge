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
 * Which `fl-proposed` blocks (docs/LANGUAGE-0.3.md) are run. The default is none: the blocks are
 * parsed and validated on every run, but most of their features do not exist yet.
 *
 * Two ways to opt in, both using the same selection syntax (comma- or space-separated items):
 *
 *   C401        one case
 *   C401-C428   an inclusive range of ids
 *   all         every proposed case
 *
 * - `ENABLED_PROPOSED` below: the committed list. A work package adds its range here when its
 *   feature lands, in the same commit, and removes it when it flips the blocks to `fl-test`.
 * - The `FL_PROPOSED` environment variable: for a developer who wants to see how far a package is,
 *   for example `FL_PROPOSED=C401-C428 npm test -w @forge/lang`.
 */
import type { TestCase } from "./parse.js";

/**
 * Cases that are required to pass. X1 (the `ext` value) opts in C401 to C428 and C456 to C461 except
 * C456 and C457 (the word `json>value`, L3), whose `ext` rules are covered by `src/ext.test.ts` until
 * L3 lands. X4 (tagged literals) adds C427 and C446 to C455.
 */
export const ENABLED_PROPOSED: readonly string[] = [
  "C401-C428",
  "C446-C455",
  "C458-C461",
  "C471-C492",
];

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

/** Parses a selection into a predicate on case ids. Throws `SelectionError` on a bad item. */
export function parseSelection(text: string): (id: number) => boolean {
  const ranges: [number, number][] = [];
  let all = false;
  for (const item of text.split(/[\s,]+/).filter((t) => t !== "")) {
    if (item === "all") {
      all = true;
      continue;
    }
    const m = /^C(\d+)(?:-C(\d+))?$/.exec(item);
    if (m === null) throw new SelectionError(`bad proposed-case selection "${item}"`);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (hi < lo) throw new SelectionError(`empty range "${item}"`);
    ranges.push([lo, hi]);
  }
  return (id) => all || ranges.some(([lo, hi]) => id >= lo && id <= hi);
}

/** The value of `FL_PROPOSED`. `globals.d.ts` declares no `process.env`, so it is read untyped. */
export function envSelection(): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.["FL_PROPOSED"];
}

/**
 * The proposed cases to run: those selected by `enabled` or by `env` (the value of `FL_PROPOSED`).
 * A selected id that names no proposed case is an error, so that a typo cannot silently run nothing.
 */
export function selectProposed(
  cases: readonly TestCase[],
  env: string | undefined = envSelection(),
  enabled: readonly string[] = ENABLED_PROPOSED,
): TestCase[] {
  const wanted = [enabled.join(","), env ?? ""].join(",");
  const pick = parseSelection(wanted);
  for (const item of wanted.split(/[\s,]+/)) {
    const m = /^C(\d+)(?:-C\d+)?$/.exec(item);
    if (m !== null && !cases.some((c) => c.id === Number(m[1]))) {
      throw new SelectionError(`"${item}" starts at a case that is not in LANGUAGE-0.3.md`);
    }
  }
  return cases.filter((c) => pick(c.id));
}
