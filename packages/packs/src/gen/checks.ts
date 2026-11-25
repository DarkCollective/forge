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
 * The checks of PACKS.md section 2.4 that need the pack's files and nothing else: `vocab-file`, `parser-imports`,
 * `csp-unsatisfied` and `external-sha`. The checks that need the assembled runtime are in `fragments.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cpCompare } from "@forge/lang";
import { inPack } from "./discover.js";
import type { GenProblem, SelectedPack } from "./types.js";

/** The vocabulary names a pack's `vocab/*.fth` files and `src/prims/*.ts` modules provide. */
export function packSourceVocabs(root: string): { fth: string[]; prims: string[] } {
  const list = (dir: string, ext: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(ext) && !f.endsWith(".d.ts") && !f.includes(".test."))
          .map((f) => f.slice(0, -ext.length))
          .sort(cpCompare)
      : [];
  return { fth: list(`${root}/vocab`, ".fth"), prims: list(`${root}/src/prims`, ".ts") };
}

/**
 * `vocab-file`: a listed vocabulary has no `.fth` file and no primitive module, or a file under `vocab/` or `src/prims/`
 * is not listed.
 */
export function checkVocabFiles(pack: SelectedPack): GenProblem[] {
  const id = pack.manifest.id;
  const have = packSourceVocabs(pack.root);
  const present = new Set([...have.fth, ...have.prims]);
  const listed = new Set(pack.manifest.vocabularies.map((v) => v.name));
  const problems: GenProblem[] = [];
  pack.manifest.vocabularies.forEach((v, i) => {
    if (!present.has(v.name)) {
      problems.push({
        code: "vocab-file",
        pack: id,
        path: `/vocabularies/${i}/name`,
        message: `vocabulary '${v.name}' has neither vocab/${v.name}.fth nor src/prims/${v.name}.ts`,
      });
    }
  });
  for (const [dir, ext, names] of [
    ["vocab", ".fth", have.fth],
    ["src/prims", ".ts", have.prims],
  ] as const) {
    for (const name of names) {
      if (!listed.has(name)) {
        problems.push({
          code: "vocab-file",
          pack: id,
          path: `${dir}/${name}${ext}`,
          message: `${dir}/${name}${ext} is not a listed vocabulary`,
        });
      }
    }
  }
  return problems;
}

/** Comments and string-free text, so an import in a comment is not read. A coarse strip: pack sources are plain TypeScript. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\'"`])\/\/.*$/gm, "$1");
}

/** The module specifiers of a source text that import a value: `import type` and `export type` are not listed. */
export function valueImports(text: string): string[] {
  const code = withoutComments(text);
  const out: string[] = [];
  const from = /\b(?:import|export)\s+(type\s+)?(?:[\w$*{][^'"`;]*?)\s*from\s*(['"])([^'"\n]+)\2/g;
  for (const m of code.matchAll(from)) {
    if (m[1] === undefined) out.push(m[3] as string);
  }
  const bare = /\bimport\s*(['"])([^'"\n]+)\1/g;
  for (const m of code.matchAll(bare)) out.push(m[2] as string);
  const dynamic = /\bimport\s*\(\s*(?:(['"])([^'"\n]+)\1|[^)]*)\)/g;
  for (const m of code.matchAll(dynamic)) out.push(m[2] ?? "<dynamic>");
  return out;
}

/**
 * `parser-imports`: a parser module imports only files under its own directory, or `import type`. It must be
 * dependency-free so that the worker and the page can both import it (X0 R6). The check follows the relative imports it
 * allows, so a file the parser reaches obeys the same rule against the parser's directory.
 */
export function checkParserImports(pack: SelectedPack): GenProblem[] {
  const problems: GenProblem[] = [];
  (pack.manifest.kinds ?? []).forEach((k, i) => {
    if (k.parser === undefined) return;
    const dir = k.parser.slice(0, Math.max(0, k.parser.lastIndexOf("/")));
    const seen = new Set<string>();
    const visit = (rel: string): void => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const file = inPack(pack.root, rel);
      if (!existsSync(file)) return;
      for (const spec of valueImports(readFileSync(file, "utf8"))) {
        const target = spec.startsWith(".") ? resolveRel(rel, spec) : undefined;
        if (target === undefined || !(target === dir || target.startsWith(`${dir}/`))) {
          problems.push({
            code: "parser-imports",
            pack: pack.manifest.id,
            path: `/kinds/${i}/parser`,
            message: `${rel} imports '${spec}', which is outside ${dir}/ (a parser may import only its own directory, or types)`,
          });
        } else {
          visit(resolveSource(pack.root, target));
        }
      }
    };
    visit(k.parser);
  });
  return problems;
}

/** `from/dir/file.ts` and `./x.js` become `from/dir/x.js`; `..` segments are folded. `undefined` when it climbs out of the pack. */
function resolveRel(from: string, spec: string): string | undefined {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** A TypeScript import names `x.js` for `x.ts`; map it to the file that exists. */
function resolveSource(root: string, rel: string): string {
  for (const candidate of [rel, rel.replace(/\.js$/, ".ts"), `${rel}.ts`]) {
    if (existsSync(inPack(root, candidate))) return candidate;
  }
  return rel;
}

/**
 * `csp-unsatisfied`: `capabilities.csp` asks for a source that the deployed CSP does not allow. `texts` are the files that
 * state the policy (`infra/site.tf`, `apps/web/scripts/serve-prod.mjs`); a text without a `default-src` is not a policy.
 */
export function checkCsp(packs: readonly SelectedPack[], texts: readonly string[]): GenProblem[] {
  const policies = texts.filter((t) => t.includes("default-src"));
  const problems: GenProblem[] = [];
  for (const p of packs) {
    for (const [directive, sources] of Object.entries(p.manifest.capabilities.csp ?? {})) {
      for (const source of sources) {
        const allowedBy = (text: string): boolean => {
          const m = new RegExp(`${directive}\\s+([^;"\\n]*)`).exec(text);
          return m !== null && (m[1] as string).split(/\s+/).includes(source);
        };
        if (policies.length === 0 || !policies.every(allowedBy)) {
          problems.push({
            code: "csp-unsatisfied",
            pack: p.manifest.id,
            path: `/capabilities/csp/${directive}`,
            message:
              policies.length === 0
                ? `the pack asks for ${directive} ${source} and no file states the deployed CSP`
                : `the pack asks for ${directive} ${source}, which the deployed CSP does not allow`,
          });
        }
      }
    }
  }
  return problems;
}

/** `external-sha`: the file at `externalCode.path` hashes to `sha256`. */
export function checkExternalSha(pack: SelectedPack): GenProblem[] {
  const problems: GenProblem[] = [];
  (pack.manifest.externalCode ?? []).forEach((e, i) => {
    const file = inPack(pack.root, e.path);
    if (!existsSync(file)) return; // `entry-missing` has said so
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (digest !== e.sha256) {
      problems.push({
        code: "external-sha",
        pack: pack.manifest.id,
        path: `/externalCode/${i}/sha256`,
        message: `${e.path} hashes to ${digest}, not ${e.sha256}`,
      });
    }
  });
  return problems;
}
