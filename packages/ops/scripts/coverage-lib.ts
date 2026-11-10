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
 * The CyberChef coverage table (PLAN section 7, Phase 5): loads docs/coverage/*.json, validates it
 * and renders docs/COVERAGE.md. Shared by `npm run coverage` (scripts/coverage.ts) and
 * `src/coverage.test.ts`, so the build and the test apply the same rules. Pure apart from
 * `loadCoverage`, which only reads files; the caller supplies the set of catalogue words.
 */
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

export type Status = "covered" | "redesigned" | "dropped";

export interface RefEntry {
  readonly name: string;
  readonly category: string;
}

export interface Mapping {
  readonly cyberchef: string;
  readonly status: Status;
  readonly forge?: readonly string[];
  readonly note?: string;
}

export interface MappingFile {
  readonly file: string;
  readonly entries: unknown;
}

export interface CoverageData {
  readonly reference: unknown;
  readonly files: readonly MappingFile[];
  readonly schema: object;
}

const NOT_MAPPING = new Set(["cyberchef.json", "coverage.schema.json"]);
export const STATUSES: readonly Status[] = ["covered", "redesigned", "dropped"];

/** Reads the reference list, the schema and every mapping file (sorted by name) under `dir`. */
export function loadCoverage(dir: string): CoverageData {
  const json = (name: string): unknown => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !NOT_MAPPING.has(n))
    .sort();
  return {
    reference: json("cyberchef.json"),
    schema: json("coverage.schema.json") as object,
    files: names.map((file) => ({ file, entries: json(file) })),
  };
}

/** Every word a mapping may name: each op's canonical `vocab:word` and `vocab:alias`. */
export function catalogueWords(catalogue: {
  readonly ops: readonly {
    readonly qname: string;
    readonly vocab: string;
    readonly aliases: readonly string[];
  }[];
}): Set<string> {
  const words = new Set<string>();
  for (const op of catalogue.ops) {
    words.add(op.qname);
    for (const alias of op.aliases) words.add(`${op.vocab}:${alias}`);
  }
  return words;
}

const STEP_RE = /^step:(fork|subsection|if|repeat|comment)$/;

export interface Checked {
  readonly errors: string[];
  readonly reference: readonly RefEntry[];
  /** The valid mappings, in file order (files sorted by name). */
  readonly mappings: readonly Mapping[];
}

/** Validates everything and returns the problems (empty when clean) with the parsed data. */
export function checkCoverage(data: CoverageData, words: ReadonlySet<string>): Checked {
  const errors: string[] = [];
  const reference: RefEntry[] = [];
  if (!Array.isArray(data.reference)) {
    errors.push("cyberchef.json: must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, e] of (data.reference as unknown[]).entries()) {
      const r = e as Partial<RefEntry> | null;
      if (typeof r?.name !== "string" || typeof r.category !== "string") {
        errors.push(`cyberchef.json[${i}]: needs a string name and category`);
      } else if (seen.has(r.name)) {
        errors.push(`cyberchef.json: duplicate name "${r.name}"`);
      } else {
        seen.add(r.name);
        reference.push({ name: r.name, category: r.category });
      }
    }
  }
  const known = new Set(reference.map((r) => r.name));

  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(data.schema);
  const claimed = new Map<string, string>();
  const mappings: Mapping[] = [];
  for (const { file, entries } of data.files) {
    if (!validate(entries)) {
      errors.push(`${file}: ${ajv.errorsText(validate.errors, { dataVar: "entries" })}`);
      continue;
    }
    for (const m of entries as Mapping[]) {
      if (!known.has(m.cyberchef)) {
        errors.push(`${file}: "${m.cyberchef}" is not a name in cyberchef.json`);
      }
      const earlier = claimed.get(m.cyberchef);
      if (earlier !== undefined) {
        errors.push(`${file}: "${m.cyberchef}" is already mapped in ${earlier}`);
      } else {
        claimed.set(m.cyberchef, file);
      }
      for (const w of m.forge ?? []) {
        if (!STEP_RE.test(w) && !words.has(w)) {
          errors.push(`${file}: "${m.cyberchef}": ${w} is not a catalogue op or alias`);
        }
      }
      mappings.push(m);
    }
  }
  return { errors, reference, mappings };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The text of docs/COVERAGE.md. Deterministic: reference order, one table per category. */
export function renderCoverage(
  reference: readonly RefEntry[],
  mappings: readonly Mapping[],
): string {
  const byName = new Map(mappings.map((m) => [m.cyberchef, m]));
  const categories: string[] = [];
  for (const r of reference) if (!categories.includes(r.category)) categories.push(r.category);

  const label = (r: RefEntry): Status | "not yet" => byName.get(r.name)?.status ?? "not yet";
  const columns = [...STATUSES, "not yet"] as const;
  const lines: string[] = [
    "<!-- GENERATED by `npm run coverage` from docs/coverage/*.json. Do not edit: change the JSON and run it again. -->",
    "",
    "# CyberChef capability coverage",
    "",
    "Generated file: do not edit. Each row is one CyberChef operation (the capability checklist in",
    "`docs/coverage/cyberchef.json`) and the Forge words that cover it. The data lives in",
    "`docs/coverage/<area>.json` (schema: `docs/coverage/coverage.schema.json`); run `npm run coverage` to validate",
    "it and regenerate this file. An operation listed in several CyberChef categories appears once, under the first.",
    "",
    "## Summary",
    "",
    `| Category | ${["Covered", "Redesigned", "Dropped", "Not yet", "Total"].join(" | ")} |`,
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  const total = [0, 0, 0, 0];
  for (const cat of categories) {
    const counts = columns.map(
      (c) => reference.filter((r) => r.category === cat && label(r) === c).length,
    );
    counts.forEach((n, i) => (total[i] = (total[i] ?? 0) + n));
    lines.push(`| ${cat} | ${counts.join(" | ")} | ${counts.reduce((a, b) => a + b, 0)} |`);
  }
  lines.push(
    `| **Total** | ${total.map((n) => `**${n}**`).join(" | ")} | **${reference.length}** |`,
    "",
  );

  for (const cat of categories) {
    const rows = reference.filter((r) => r.category === cat);
    lines.push(
      `## ${cat} (${rows.length})`,
      "",
      "| CyberChef | Status | Forge | Note |",
      "| --- | --- | --- | --- |",
    );
    for (const r of rows) {
      const m = byName.get(r.name);
      const forge = (m?.forge ?? []).map((w) => `\`${w}\``).join(", ");
      lines.push(
        `| ${cell(r.name)} | ${m?.status ?? "not yet"} | ${forge} | ${cell(m?.note ?? "")} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** One line per status for the build log. */
export function summarize(reference: readonly RefEntry[], mappings: readonly Mapping[]): string {
  const count = (s: Status): number => mappings.filter((m) => m.status === s).length;
  const mapped = mappings.length;
  return `${reference.length} CyberChef operations: ${count("covered")} covered, ${count("redesigned")} redesigned, ${count("dropped")} dropped, ${reference.length - mapped} not yet`;
}
