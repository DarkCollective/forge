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
 * The help document (LANGUAGE-0.2.md section 7): `use-when`, links, the symmetric closure of
 * `inverse` and the examples chosen on test vectors (section 6), for every op that has any of them.
 * Pure: the caller reads the vector files. Content violations throw an `Error` that names the file
 * and the vector index (or the words).
 */
import { sha256 } from "@forge/lang";
import type { ForgeRuntime } from "@forge/lang";
import { buildCatalogue } from "./catalogue.js";
import { HELP_FORMAT } from "./types.js";
import type {
  BuildHelpFn,
  Catalogue,
  HelpDoc,
  HelpExample,
  HelpLink,
  HelpOp,
  VectorFile,
} from "./types.js";

/** At most this many examples for one op (section 6, rule 2). */
export const MAX_EXAMPLES_PER_OP = 3;
/** At most this many code points in an example's input, parameter or expected value. */
export const MAX_EXAMPLE_VALUE = 2048;

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function codePoints(s: string): number {
  return Array.from(s).length;
}

function readExamples(
  catalogue: Catalogue,
  vectorFiles: readonly VectorFile[],
): Map<string, HelpExample[]> {
  const canonical = new Map<string, string>();
  for (const op of catalogue.ops) {
    canonical.set(op.qname, op.qname);
    for (const alias of op.aliases) canonical.set(`${op.vocab}:${alias}`, op.qname);
  }
  const byOp = new Map<string, HelpExample[]>();
  for (const file of vectorFiles) {
    file.vectors.forEach((raw, index) => {
      if (!isObject(raw) || raw.example === undefined) return;
      const where = `${file.vocab}.test.json[${index}]`;
      const example = raw.example;
      if (!isObject(example) || typeof example.title !== "string" || example.title === "") {
        throw new Error(`${where}: an example needs a non-empty title`);
      }
      if (typeof raw.op !== "string") throw new Error(`${where}: a vector needs an op`);
      const qname = canonical.get(raw.op);
      if (qname === undefined) {
        throw new Error(
          `${where}: example on ${raw.op}, which is not an operation of the catalogue`,
        );
      }
      const input = raw.input;
      if (!isObject(input) || typeof input.value !== "string" || typeof input.enc !== "string") {
        throw new Error(`${where}: the vector has no input`);
      }
      const params = isObject(raw.params) ? raw.params : {};
      const big = (label: string, value: unknown): void => {
        if (typeof value === "string" && codePoints(value) > MAX_EXAMPLE_VALUE) {
          throw new Error(
            `${where}: example of ${qname}: ${label} is over ${MAX_EXAMPLE_VALUE} characters`,
          );
        }
      };
      big("input.value", input.value);
      for (const [name, p] of Object.entries(params)) {
        if (isObject(p)) big(`param ${name}`, p.value);
      }
      if (isObject(raw.expect)) big("expect.value", raw.expect.value);
      const list = byOp.get(qname) ?? [];
      if (list.some((e) => e.title === example.title)) {
        throw new Error(`${where}: example title "${example.title}" is used twice for ${qname}`);
      }
      if (list.length >= MAX_EXAMPLES_PER_OP) {
        throw new Error(`${where}: ${qname} has more than ${MAX_EXAMPLES_PER_OP} examples`);
      }
      list.push({
        title: example.title,
        note: typeof example.note === "string" ? example.note : null,
        ref: typeof raw.ref === "string" ? raw.ref : null,
        params,
        input: { value: input.value, enc: input.enc },
        expect: raw.expect,
      });
      byOp.set(qname, list);
    });
  }
  return byOp;
}

/** The symmetric closure of the declared `inverse` entries (section 2). Declarations win over implied entries. */
function closeInverses(declared: ReadonlyMap<string, string>, ops: ReadonlySet<string>) {
  for (const [a, b] of declared) {
    if (!ops.has(b)) throw new Error(`${a}: inverse ${b} is not an operation`);
  }
  const implied = new Map<string, string>();
  for (const [a, b] of declared) {
    if (a === b) continue;
    const back = declared.get(b);
    if (back !== undefined) {
      if (back !== a) {
        throw new Error(`inverse conflict: ${a} declares ${b}, but ${b} declares ${back}`);
      }
      continue;
    }
    const other = implied.get(b);
    if (other !== undefined && other !== a) {
      throw new Error(
        `inverse conflict: ${other} and ${a} both declare ${b}, which declares nothing`,
      );
    }
    implied.set(b, a);
  }
  return (qname: string): string | null => declared.get(qname) ?? implied.get(qname) ?? null;
}

export const buildHelp: BuildHelpFn = (
  runtime: ForgeRuntime,
  catalogue: Catalogue,
  vectorFiles: readonly VectorFile[],
): HelpDoc => {
  if (buildCatalogue(runtime, { warn: () => undefined }).version !== catalogue.version) {
    throw new Error("the catalogue was not built from this runtime");
  }
  const opNames = new Set(catalogue.ops.map((o) => o.qname));
  const declared = new Map<string, string>();
  for (const qname of opNames) {
    const inverse = runtime.meta(qname).discovery?.inverse;
    if (inverse !== undefined) declared.set(qname, inverse);
  }
  const inverseOf = closeInverses(declared, opNames);
  const examples = readExamples(catalogue, vectorFiles);

  const ops: HelpOp[] = [];
  for (const { qname } of catalogue.ops) {
    const discovery = runtime.meta(qname).discovery;
    const useWhen = discovery?.useWhen ?? null;
    const links: HelpLink[] = (discovery?.links ?? []).map((l) => ({ url: l.url, label: l.label }));
    const inverse = inverseOf(qname);
    const own = examples.get(qname) ?? [];
    const optionDocs = discovery?.optionDocs;
    if (
      useWhen === null &&
      links.length === 0 &&
      inverse === null &&
      optionDocs === undefined &&
      own.length === 0
    ) {
      continue;
    }
    ops.push({
      qname,
      useWhen,
      links,
      inverse,
      ...(optionDocs === undefined ? {} : { optionDocs }),
      examples: own,
    });
  }
  ops.sort((a, b) => compareCodePoints(a.qname, b.qname));
  return {
    format: HELP_FORMAT,
    catalogue: catalogue.version,
    version: sha256(JSON.stringify(ops)).slice(0, 16),
    ops,
  };
};
