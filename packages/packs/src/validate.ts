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
import {
  CORE_KIND_NAMES,
  CORE_VOCAB_NAMES,
  LICENCE_ALLOW_LIST,
  PACK_API,
  RESERVED_PACK_IDS,
} from "./names.js";
import { structuralProblems } from "./structure.js";
import type {
  KnownPack,
  ManifestCheckCode,
  ManifestContext,
  ManifestProblem,
  ManifestResult,
  PackManifest,
} from "./types.js";

/**
 * Validate a manifest: the JSON Schema of PACKS section 2.2 (code `schema`), then the checks of
 * section 2.4 that need no runtime. The cross-checks run only when the schema passes, and a check whose
 * input is missing from `context` does not run. The checks that need the loaded runtime or the file
 * contents (`vocab-file`, `kind-unknown`, `kind-registered`, `viewer-missing`, `helper-missing`,
 * `parser-imports`, `dependency-undeclared`, `core-depends-on-pack`, `effect-undeclared`,
 * `effect-unused`, `csp-unsatisfied`, `conversion-op`, `external-sha`, `external-version`,
 * `budget-exceeded`, `channel-production`, `fragment-drift`) belong to the generator (P1b) and to P6.
 */
export function validateManifest(manifest: unknown, context: ManifestContext = {}): ManifestResult {
  const schema = structuralProblems(manifest);
  if (schema.length > 0) return { ok: false, problems: schema };
  const m = manifest as PackManifest;
  const problems: ManifestProblem[] = [];
  const add = (code: ManifestCheckCode, path: string, message: string): void => {
    problems.push({ code, path, message });
  };

  checkId(m, context, add);
  checkVocabularies(m, context, add);
  checkKinds(m, context, add);
  checkRequires(m, context, add);
  checkFiles(m, context, add);
  checkLicences(m, context, add);

  return problems.length === 0 ? { ok: true, manifest: m, problems: [] } : { ok: false, problems };
}

type Add = (code: ManifestCheckCode, path: string, message: string) => void;

function checkId(m: PackManifest, ctx: ManifestContext, add: Add): void {
  if (ctx.dirName !== undefined && ctx.dirName !== m.id) {
    add("id-dir", "/id", `id '${m.id}' differs from the directory name '${ctx.dirName}'`);
  }
  if (ctx.packageName !== undefined && ctx.packageName !== `@forge/pack-${m.id}`) {
    add("id-dir", "/id", `id '${m.id}' differs from the package name '${ctx.packageName}'`);
  }
  if (RESERVED_PACK_IDS.includes(m.id))
    add("id-reserved", "/id", `'${m.id}' is a reserved pack id`);
}

function checkVocabularies(m: PackManifest, ctx: ManifestContext, add: Add): void {
  const core = new Set<string>([...CORE_VOCAB_NAMES, ...(ctx.coreVocabs ?? [])]);
  const seen = new Set<string>();
  m.vocabularies.forEach((v, i) => {
    const path = `/vocabularies/${i}/name`;
    if (seen.has(v.name)) add("vocab-clash", path, `vocabulary '${v.name}' is listed twice`);
    seen.add(v.name);
    if (core.has(v.name)) add("vocab-clash", path, `vocabulary '${v.name}' is a core vocabulary`);
    const owner = ctx.packs?.find((p) => p.vocabularies.includes(v.name));
    if (owner) add("vocab-clash", path, `vocabulary '${v.name}' belongs to the pack '${owner.id}'`);
  });
}

function checkKinds(m: PackManifest, ctx: ManifestContext, add: Add): void {
  const seen = new Set<string>();
  (m.kinds ?? []).forEach((k, i) => {
    const path = `/kinds/${i}/name`;
    if (CORE_KIND_NAMES.includes(k.name)) {
      add("kind-reserved", path, `'${k.name}' is a reserved core kind name`);
      return;
    }
    if (seen.has(k.name)) add("kind-clash", path, `kind '${k.name}' is listed twice`);
    seen.add(k.name);
    const owner = ctx.packs?.find((p) => p.kinds.includes(k.name));
    if (owner) add("kind-clash", path, `kind '${k.name}' is owned by the pack '${owner.id}'`);
  });
}

function checkRequires(m: PackManifest, ctx: ManifestContext, add: Add): void {
  if (m.requires.packApi !== PACK_API) {
    add(
      "requires-api",
      "/requires/packApi",
      `packApi ${m.requires.packApi} is not the current PACK_API ${PACK_API}`,
    );
  }
  const packs = ctx.packs;
  if (packs === undefined) return;
  const byId = new Map<string, KnownPack>(packs.map((p) => [p.id, p]));
  (m.requires.packs ?? []).forEach((id, i) => {
    if (id !== m.id && !byId.has(id))
      add("requires-unknown", `/requires/packs/${i}`, `required pack '${id}' is not in the build`);
  });
  const cycle = findCycle(m, byId);
  if (cycle !== undefined)
    add("requires-cycle", "/requires/packs", `requires cycle: ${cycle.join(" -> ")}`);
}

/** A cycle through the pack, as a path of ids that starts and ends at the same id, or undefined. */
function findCycle(m: PackManifest, others: ReadonlyMap<string, KnownPack>): string[] | undefined {
  const edges = (id: string): readonly string[] =>
    id === m.id ? (m.requires.packs ?? []) : (others.get(id)?.requires ?? []);
  const done = new Set<string>();
  const walk = (id: string, trail: string[]): string[] | undefined => {
    const at = trail.indexOf(id);
    if (at >= 0) return [...trail.slice(at), id];
    if (done.has(id)) return undefined;
    for (const next of edges(id)) {
      const found = walk(next, [...trail, id]);
      if (found) return found;
    }
    done.add(id);
    return undefined;
  };
  return walk(m.id, []);
}

function checkFiles(m: PackManifest, ctx: ManifestContext, add: Add): void {
  const exists = ctx.fileExists;
  if (exists === undefined) return;
  const need = (path: string, at: string): void => {
    if (!exists(path)) add("entry-missing", at, `'${path}' does not exist`);
  };
  need(m.entries.worker, "/entries/worker");
  if (m.entries.page !== undefined) need(m.entries.page, "/entries/page");
  (m.kinds ?? []).forEach((k, i) => {
    if (k.parser !== undefined) need(k.parser, `/kinds/${i}/parser`);
  });
  if (m.notice !== undefined) need(m.notice, "/notice");
  (m.externalCode ?? []).forEach((e, i) => need(e.path, `/externalCode/${i}/path`));
}

function checkLicences(m: PackManifest, ctx: ManifestContext, add: Add): void {
  if (!LICENCE_ALLOW_LIST.includes(m.licence))
    add("licence-list", "/licence", `licence '${m.licence}' is not on the allow list`);
  (m.externalCode ?? []).forEach((e, i) => {
    if (!LICENCE_ALLOW_LIST.includes(e.licence)) {
      add(
        "licence-list",
        `/externalCode/${i}/licence`,
        `licence '${e.licence}' is not on the allow list`,
      );
    }
  });
  if (
    m.notice !== undefined &&
    ctx.fileSize !== undefined &&
    ctx.fileExists?.(m.notice) !== false &&
    ctx.fileSize(m.notice) === 0
  ) {
    add("licence-list", "/notice", "the NOTICE file is empty");
  }
}
