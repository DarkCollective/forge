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
import schema from "./manifest.schema.json" with { type: "json" };
import { MANIFEST_FORMAT } from "./names.js";
import type { ManifestProblem } from "./types.js";

// This is a hand-written reading of manifest.schema.json that needs no Ajv (Ajv compiles with `new
// Function`, which the production CSP forbids, so it is a test dependency only). The patterns come
// from the schema file itself, and a test runs this and Ajv over the same corpus and over mutations.

const defs = schema.$defs;
const packIdRe = new RegExp(defs.packId.pattern, "u");
const kebabRe = new RegExp(defs.kebab.pattern, "u");
const semverRe = new RegExp(defs.semver.pattern, "u");
const pathRe = new RegExp(defs.path.pattern, "u");
const qnameRe = new RegExp(defs.qname.pattern, "u");
const licenceRe = new RegExp(schema.properties.licence.pattern, "u");
const sha256Re = new RegExp(schema.properties.externalCode.items.properties.sha256.pattern, "u");
const extVersionRe = new RegExp(
  schema.properties.externalCode.items.properties.version.pattern,
  "u",
);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

class Collector {
  readonly problems: ManifestProblem[] = [];
  add(path: string, message: string): void {
    this.problems.push({ code: "schema", path, message });
  }
}

type Check = (c: Collector, v: unknown, p: string) => void;

const str =
  (min: number, max: number): Check =>
  (c, v, p) => {
    if (typeof v !== "string") c.add(p, "must be a string");
    else {
      const n = [...v].length; // JSON Schema counts code points
      if (n < min || n > max) c.add(p, `must be ${min} to ${max} characters`);
    }
  };

const patterned =
  (re: RegExp, max: number, what: string): Check =>
  (c, v, p) => {
    if (typeof v !== "string") c.add(p, "must be a string");
    else if (v.length > max || !re.test(v)) c.add(p, `must be ${what}`);
  };

const packId = patterned(
  packIdRe,
  defs.packId.maxLength,
  "a lower-kebab-case id of at most 32 characters",
);
const kebab = patterned(
  kebabRe,
  defs.kebab.maxLength,
  "a lower-kebab-case name of at most 32 characters",
);
const semver = patterned(semverRe, Infinity, "a semantic version");
const relPathSchema = patterned(
  pathRe,
  Infinity,
  "a relative path with no '..' and no leading slash",
);
// Stricter than the schema's pattern, which lets "a//b", "./a" and "a/" through: a path with an empty or
// "." segment names no file the generator could read, so it is refused here too.
const relPath: Check = (c, v, p) => {
  relPathSchema(c, v, p);
  if (typeof v === "string" && pathRe.test(v) && v.split("/").some((s) => s === "" || s === ".")) {
    c.add(p, "must not have an empty or '.' segment");
  }
};
const qname = patterned(qnameRe, Infinity, "a qualified name 'vocab:word'");
const bool: Check = (c, v, p) => {
  if (typeof v !== "boolean") c.add(p, "must be a boolean");
};
const posInt: Check = (c, v, p) => {
  if (!isInt(v) || v < 1) c.add(p, "must be an integer of at least 1");
};
const enumOf =
  (values: readonly unknown[]): Check =>
  (c, v, p) => {
    if (!values.includes(v))
      c.add(p, `must be one of ${values.map((x) => JSON.stringify(x)).join(", ")}`);
  };

function array(item: Check, o: { min?: number; max?: number; unique?: boolean } = {}): Check {
  return (c, v, p) => {
    if (!Array.isArray(v)) {
      c.add(p, "must be an array");
      return;
    }
    if (o.min !== undefined && v.length < o.min) c.add(p, `must have at least ${o.min} items`);
    if (o.max !== undefined && v.length > o.max) c.add(p, `must have at most ${o.max} items`);
    if (o.unique && new Set(v.map((x) => JSON.stringify(x))).size !== v.length)
      c.add(p, "items must be unique");
    for (let i = 0; i < v.length; i++) item(c, v[i], `${p}/${i}`);
  };
}

function object(
  props: Record<string, Check>,
  required: readonly string[],
  extra?: (c: Collector, v: Obj, p: string) => void,
): Check {
  return (c, v, p) => {
    if (!isObj(v)) {
      c.add(p, "must be an object");
      return;
    }
    for (const r of required) if (!(r in v)) c.add(p, `must have the property '${r}'`);
    for (const k of Object.keys(v)) {
      const check = props[k];
      if (check === undefined) c.add(`${p}/${k}`, "is not a known property");
      else check(c, v[k], `${p}/${k}`);
    }
    extra?.(c, v, p);
  };
}

const cspSources = array(enumOf(["blob:", "data:"]), { min: 1, unique: true });

const vocabulary = object({ name: kebab, internal: bool }, ["name"]);

const kind = object(
  { name: kebab, label: str(1, 40), viewer: bool, paramHelper: bool, parser: relPath },
  ["name", "label", "viewer", "paramHelper"],
  (c, v, p) => {
    if (v.paramHelper === true && !("parser" in v))
      c.add(p, "a kind with paramHelper needs a 'parser'");
  },
);

const conversion = object({ from: kebab, to: kebab, op: qname, atEnd: enumOf([true]) }, [
  "from",
  "to",
  "op",
]);

const primitives: Check = (c, v, p) => {
  if (v === "*") return;
  if (!Array.isArray(v)) {
    c.add(p, 'must be "*" or an array of qualified names');
    return;
  }
  array(qname, { min: 1, unique: true })(c, v, p);
};

const externalCode = object(
  {
    id: kebab,
    version: patterned(extVersionRe, 64, "a version of letters, digits and . + _ -"),
    path: relPath,
    sha256: patterned(sha256Re, 64, "64 lower-case hex digits"),
    licence: patterned(licenceRe, 40, "an SPDX identifier"),
    maxGzip: posInt,
    primitives,
  },
  ["id", "version", "path", "sha256", "licence", "maxGzip", "primitives"],
);

const properties: Record<string, Check> = {
  $schema: str(0, 200),
  format: enumOf([MANIFEST_FORMAT]),
  id: packId,
  name: str(1, 40),
  summary: str(1, 120),
  description: str(1, 600),
  version: semver,
  channel: enumOf(["stable", "internal"]),
  licence: patterned(licenceRe, 40, "an SPDX identifier"),
  notice: relPath,
  requires: object({ packApi: posInt, packs: array(packId, { unique: true, max: 16 }) }, [
    "packApi",
  ]),
  vocabularies: array(vocabulary, { min: 1, max: 64 }),
  kinds: array(kind, { max: 32 }),
  conversions: array(conversion, { max: 16 }),
  entries: object({ worker: relPath, page: relPath }, ["worker"]),
  capabilities: object(
    {
      effects: array(enumOf(schema.properties.capabilities.properties.effects.items.enum), {
        unique: true,
      }),
      csp: object({ "img-src": cspSources, "media-src": cspSources, "font-src": cspSources }, []),
    },
    ["effects"],
  ),
  externalCode: array(externalCode, { max: 4 }),
  budget: object({ total: posInt, worker: posInt, page: posInt }, ["total"]),
};

const manifestShape = object(properties, schema.required, (c, v, p) => {
  const kinds = v.kinds;
  if (
    Array.isArray(kinds) &&
    kinds.some((k) => isObj(k) && (k.viewer === true || k.paramHelper === true)) &&
    isObj(v.entries) &&
    !("page" in v.entries)
  ) {
    c.add(`${p}/entries`, "a pack with a viewer or a parameter helper needs a page entry");
  }
  if (Array.isArray(v.externalCode) && v.externalCode.length >= 1 && !("notice" in v)) {
    c.add(p, "a pack with externalCode needs a 'notice'");
  }
});

/** The structural problems of a manifest, as `schema` problems. Empty when the manifest validates. */
export function structuralProblems(manifest: unknown): ManifestProblem[] {
  const c = new Collector();
  manifestShape(c, manifest, "");
  return c.problems;
}
