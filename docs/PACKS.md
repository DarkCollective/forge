# Packs: manifest, discovery, init protocol and capabilities (specification)

Status: draft v1 (2026-11-23), **approved at Gate T1 on 2026-11-24**. The owner accepted every recommended answer: decisions PK1 to PK24 and questions PQ1 to PQ15 (section 12). It is still a proposal in this sense: it is not normative until its work packages land (section 13) and TOOLKIT.md and PLAN.md take it in. It is work package SP4 of the toolkit programme ([TOOLKIT.md](TOOLKIT.md) §13.3). It builds on [TOOLKIT.md](TOOLKIT.md) (§1 goals, §3 decisions T1 to T34, §4 architecture, §5 the pack system, §6 extension values and viewers, §8 the Relix pack, §10 media and code packs, §12, §13.5 rows P1 to P8 and X1 to X5, §13.6 row R13, §14 risk 12), [PLAN.md](PLAN.md) (§1 principles, §3.3 vocabularies, §3.5 primitives, §3.6 recipes are words, §5 security, §10 hosting), [RECIPES.md](RECIPES.md) (§2 the catalogue, §8 the bake API), [RECIPES-1.2.md](RECIPES-1.2.md) (§6.9 conversions, §8 pack ops, §9 `previousHashes`, §12 protocol 2, §14 lists, §19.1 hard kill), [RELIX.md](RELIX.md) (§1.5 loading, §8 limits and cancellation, §11 security, §15 work packages), [UI.md](UI.md) (§4 the CSP rules) and [research/x0-ext-values.md](research/x0-ext-values.md) (§3.2 the registry, §10 R1, R2, R6 and R12, §11 P8). The ext tag and its text forms belong to the language proposal (SP1). Screens and dialogs belong to the UI proposal (SP3). This document owns the manifest and the pack mechanics.

> **Packages are frozen.** `packages/*` hold frozen Phase 1 to 2 contracts (CLAUDE.md). This proposal asks for changes to `@forge/ops` (the bundle loader, the catalogue build), `@forge/worker` (the `init` message, `deny`) and `@forge/lang` (one new effect label). It adds one new package, `@forge/packs`. The owner approved the contract changes at Gate T1 (2026-11-24), so the work packages of section 13 may start in the order given there. The changes that are not source-breaking are listed in section 13, work package by work package.

> **Estimates are marked.** A figure that comes from a file cites it. A figure that is a proposal or an estimate says so. Sizes of work packages are relative (S, M, L). There are no calendar dates.

> **Names shared with the other specifications.** `ext{kind}` is the header syntax for an extension kind. The kinds named here are `table` (core, T21), `relation` and `relix-expr` (the `relix` pack) and `rat` (the symbolic pack). The kind names `null` and `array` belong to the language (LANGUAGE-0.3.md §4.2, Q15) and are reserved with `table`: a pack may not claim them (section 2.4, `kind-reserved`). Pack ids are lower-kebab-case. `PackIndex`, `pack-not-enabled` and `packs-needed` are defined in RECIPES-1.2 §8 and used here without change. `input:tab` is core.

## Contents

1. What a pack is
2. The manifest
3. Build-time discovery and generation
4. The init protocol
5. The catalogue and packs
6. The capability model
7. Enabling and disabling
8. Security and limits
9. Versioning and compatibility
10. Testing
11. Decisions
12. Questions, decided
13. Work packages
14. Changes needed in other documents

---

## 1. What a pack is

### 1.1 Definition

A **pack** is an optional, first-party body of capability that Forge loads only when the user enables it. A pack is a workspace package at `packs/<id>` (npm name `@forge/pack-<id>`) with a manifest. It may hold:

1. **FL vocabularies** (`vocab/<name>.fth`) and their test vectors (`vocab/<name>.test.json`).
2. **TypeScript primitives** (`src/prims/<name>.ts`), under the FL-first rule of PLAN §3.5: a primitive is allowed only where FL cannot express the work, or is too slow at 64 KiB, or the work wraps an audited library or a host capability.
3. **Extension value kinds** (`ext{kind}`): the registration, `equals`, `sizeOf`, `toText`, `fromText` and `view` of each kind (X0 §3.2).
4. **Viewers**: one page component per kind that renders an output value of that kind.
5. **Parameter helpers**: for a kind that can be a recipe parameter, one dependency-free parser module that both the worker and the page import (X0 R6 and R12, T20), and the page widget that uses it.
6. **An engine chunk** (optional): code compiled elsewhere and loaded lazily, such as `relix-web` (RELIX.md §1.3, §1.5).
7. **Conversions** between kinds that the recipe compiler inserts (RECIPES-1.2 §6.9).
8. **Documentation inputs**: help text sources, a NOTICE file.

A pack does not change the language, the recipe format or the bake protocol. It uses them. It cannot define a word in `core`, in a core vocabulary or in another pack's vocabulary (`E_READONLY` at assembly, RECIPES §2.5). It cannot add an effect label, change the CSP, make a network request or load code that is not part of the build.

### 1.2 What may and may not be in a pack (T7)

T7 says first-party packs are separate workspace packages built and deployed with the site, because the CSP allows only same-origin script. Third parties may share FL-only vocabularies, which already run as untrusted code. This section turns that into rules.

**Allowed in a pack.**

- Code written in this repository, reviewed like core code.
- npm dependencies, on the rules core uses today: exact versions, a licence on the allow list (section 2.4, `licence-list`), no install scripts, and a line in the pack's NOTICE. The `@noble/*` wrappers of `@forge/ops` are the model.
- One compiled artefact from a repository of the same organisation, declared as `externalCode` with its version and SHA-256 (the `relix-web` artefact is the only one planned). The build checks the hash. The pack's primitives carry its version (section 5.5).
- A viewer that builds DOM with `createElement` and `textContent` (UI.md §4 rule 6).

**Not allowed in a pack.**

- Loading any script, worker, WASM module or style from a URL, from storage or from data. Everything a pack loads is a same-origin file of the build (UI.md §4 rules 4, 5 and 8).
- `eval`, `new Function`, `importScripts`, string timers, `innerHTML` and its relatives. The lint rules of section 8.5 enforce this.
- Network code of any kind (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`), except the one loader the host provides for catalogue fragments. Relix queries read in-browser data only (T3).
- Writing to `localStorage`, `IndexedDB` or cookies. A pack keeps no state of its own in v1 (question PQ12).
- Code by authors outside the repository, and any pack the user supplies at run time.

**What is not a pack.** Third-party sharing of FL-only vocabularies (TOOLKIT §5.3) stays as it is. A shared vocabulary is an untrusted `user` unit. It cannot bind primitives, register kinds, declare capabilities or ship chunks, and it needs no manifest. This document does not change it. A pack is never untrusted code. This is the line the whole document keeps: **recipes and shared FL are untrusted; packs are first-party code that the user chooses to load.**

### 1.3 Core against pack

`table` is core (Q4, T21). So are `csv`, `json` and `input:tab`. The test for a new body of work is:

| Question | If yes |
|---|---|
| Do core ops call it, or does a core kind need it? | Core. A core word never depends on a pack, and the build checks it (`core-depends-on-pack`). |
| Does it need an effect label beyond the three base labels, a CSP source, or an engine chunk? | Pack. |
| Does it bring a kind with its own viewer or parameter helper that core does not ship? | Pack. |
| Is it a distinct product that many users never open (Relix, symbolic algebra, media)? | Pack. |
| Otherwise (a few small FL vocabularies, no new kind) | Core. A pack costs the user an enable step and costs us a manifest, a budget and a registry entry. |

The thresholds are proposals. T5 puts media and code-tidy ops in packs, and none of those ops exists yet (TOOLKIT §2.1), so no existing op moves.

### 1.4 The first packs

| Id | Vocabularies | Kinds it owns | Effects requested | Engine chunk | Channel | Specified by |
|---|---|---|---|---|---|---|
| `relix` | `relix` | `relation`, `relix-expr` | none (T3) | `relix-web`, at most 3 MB gzip (T12) | stable | RELIX.md (SP6), WPs R1 to R14 |
| `demo` | `demo` | `demo-tally` | none | none | internal | this document, P8 |
| `symbolic` | planned: `sym` and others | `sym`, `rat`, `cplx`, `qty`, `matrix` | none | none (a TypeScript kernel in primitives) | stable | SYMBOLIC.md v2 (SP5), WPs S1 to S10 |
| `media` | planned: `image`, `audio`, `qr`, `chart` and others | `image`, `audio` | `+async`, `+media`; CSP `media-src blob:` | none | stable | WPs M1 to M7 |
| `code` | planned: beautify, minify, highlight | none planned | none | none | stable | WP M8 |

The vocabulary names of `symbolic`, `media` and `code` are the owners' to settle. This table shows the shape, not the names. `channel` is explained in section 2.3. The demo pack exists to prove the mechanism (Gate T3). It is not shipped to users.

---

## 2. The manifest

### 2.1 Where it lives and what it is

Each pack has one file, `packs/<id>/manifest.json`. It is **data**. No tool imports pack code to read it. The generator (section 3) validates it with the JSON Schema below and with the cross-checks of section 2.4. TOOLKIT §13.5 says `packs/*/manifest.*`. This document narrows that to JSON (decision PK2, question PQ3): a manifest that is code can do work at build time that nobody reviews as data.

The manifest is the single source for: the pack manager, the generated registries of the page and the worker (section 3.3), the catalogue fragment, the size budget, the capability prompt and the CI checks. Nothing in it is written twice by hand. Facts that the code can derive are not in it (op names, parameters, effect labels per word, hashes).

### 2.2 JSON Schema

The schema is `$id` `urn:forge:schema:pack-manifest:1`, draft 2020-12, in the style of `catalogue.schema.json`. Work package P1a ships it as `packages/packs/src/manifest.schema.json` and validates with Ajv in strict mode, as the catalogue build does. Ajv is a build and test dependency only (UI.md §4 rule 5).

```json schema
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:forge:schema:pack-manifest:1",
  "title": "Forge pack manifest, format 1",
  "type": "object",
  "properties": {
    "$schema": { "type": "string", "maxLength": 200 },
    "format": { "const": 1 },
    "id": { "$ref": "#/$defs/packId" },
    "name": { "type": "string", "minLength": 1, "maxLength": 40 },
    "summary": { "type": "string", "minLength": 1, "maxLength": 120 },
    "description": { "type": "string", "minLength": 1, "maxLength": 600 },
    "version": { "$ref": "#/$defs/semver" },
    "channel": { "enum": ["stable", "internal"] },
    "licence": { "type": "string", "pattern": "^[A-Za-z0-9.+-]{1,40}$" },
    "notice": { "$ref": "#/$defs/path" },
    "requires": {
      "type": "object",
      "properties": {
        "packApi": { "type": "integer", "minimum": 1 },
        "packs": {
          "type": "array",
          "items": { "$ref": "#/$defs/packId" },
          "uniqueItems": true,
          "maxItems": 16
        }
      },
      "required": ["packApi"],
      "additionalProperties": false
    },
    "vocabularies": {
      "type": "array",
      "minItems": 1,
      "maxItems": 64,
      "items": {
        "type": "object",
        "properties": {
          "name": { "$ref": "#/$defs/kebab" },
          "internal": { "type": "boolean" }
        },
        "required": ["name"],
        "additionalProperties": false
      }
    },
    "kinds": {
      "type": "array",
      "maxItems": 32,
      "items": {
        "type": "object",
        "properties": {
          "name": { "$ref": "#/$defs/kebab" },
          "label": { "type": "string", "minLength": 1, "maxLength": 40 },
          "viewer": { "type": "boolean" },
          "paramHelper": { "type": "boolean" },
          "parser": { "$ref": "#/$defs/path" }
        },
        "required": ["name", "label", "viewer", "paramHelper"],
        "additionalProperties": false,
        "if": { "properties": { "paramHelper": { "const": true } }, "required": ["paramHelper"] },
        "then": { "type": "object", "properties": { "parser": true }, "required": ["parser"] }
      }
    },
    "conversions": {
      "type": "array",
      "maxItems": 16,
      "items": {
        "type": "object",
        "properties": {
          "from": { "$ref": "#/$defs/kebab" },
          "to": { "$ref": "#/$defs/kebab" },
          "op": { "$ref": "#/$defs/qname" },
          "atEnd": { "const": true }
        },
        "required": ["from", "to", "op"],
        "additionalProperties": false
      }
    },
    "entries": {
      "type": "object",
      "properties": {
        "worker": { "$ref": "#/$defs/path" },
        "page": { "$ref": "#/$defs/path" }
      },
      "required": ["worker"],
      "additionalProperties": false
    },
    "capabilities": {
      "type": "object",
      "properties": {
        "effects": {
          "type": "array",
          "items": { "enum": ["+async", "+random", "+time", "+media"] },
          "uniqueItems": true
        },
        "csp": {
          "type": "object",
          "properties": {
            "img-src": { "$ref": "#/$defs/cspSources" },
            "media-src": { "$ref": "#/$defs/cspSources" },
            "font-src": { "$ref": "#/$defs/cspSources" }
          },
          "additionalProperties": false
        }
      },
      "required": ["effects"],
      "additionalProperties": false
    },
    "externalCode": {
      "type": "array",
      "maxItems": 4,
      "items": {
        "type": "object",
        "properties": {
          "id": { "$ref": "#/$defs/kebab" },
          "version": { "type": "string", "pattern": "^[0-9A-Za-z.+_-]{1,64}$" },
          "path": { "$ref": "#/$defs/path" },
          "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "licence": { "type": "string", "pattern": "^[A-Za-z0-9.+-]{1,40}$" },
          "maxGzip": { "type": "integer", "minimum": 1 },
          "primitives": {
            "oneOf": [
              { "const": "*" },
              {
                "type": "array",
                "minItems": 1,
                "items": { "$ref": "#/$defs/qname" },
                "uniqueItems": true
              }
            ]
          }
        },
        "required": ["id", "version", "path", "sha256", "licence", "maxGzip", "primitives"],
        "additionalProperties": false
      }
    },
    "budget": {
      "type": "object",
      "properties": {
        "total": { "type": "integer", "minimum": 1 },
        "worker": { "type": "integer", "minimum": 1 },
        "page": { "type": "integer", "minimum": 1 }
      },
      "required": ["total"],
      "additionalProperties": false
    }
  },
  "required": [
    "format",
    "id",
    "name",
    "summary",
    "description",
    "version",
    "channel",
    "licence",
    "requires",
    "vocabularies",
    "entries",
    "capabilities",
    "budget"
  ],
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "kinds": {
            "type": "array",
            "contains": {
              "type": "object",
              "anyOf": [
                { "properties": { "viewer": { "const": true } }, "required": ["viewer"] },
                { "properties": { "paramHelper": { "const": true } }, "required": ["paramHelper"] }
              ]
            }
          }
        },
        "required": ["kinds"]
      },
      "then": { "properties": { "entries": { "type": "object", "properties": { "page": true }, "required": ["page"] } } }
    },
    {
      "if": {
        "properties": { "externalCode": { "type": "array", "minItems": 1 } },
        "required": ["externalCode"]
      },
      "then": { "type": "object", "properties": { "notice": true }, "required": ["notice"] }
    }
  ],
  "$defs": {
    "packId": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "maxLength": 32 },
    "kebab": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "maxLength": 32 },
    "semver": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
    },
    "path": {
      "type": "string",
      "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,120}$"
    },
    "qname": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*:[^\\s:]{1,64}$"
    },
    "cspSources": {
      "type": "array",
      "items": { "enum": ["blob:", "data:"] },
      "uniqueItems": true,
      "minItems": 1
    }
  }
}
```

Two properties of this schema are deliberate. **No manifest that validates can ask for a script, worker, connect or style source**: `capabilities.csp` allows only `img-src`, `media-src` and `font-src`, and only `blob:` and `data:`. **Every field that names a file is a relative path** with no `..` and no leading slash.

### 2.3 Field notes

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Manifest format. 1. |
| `id` | yes | The pack id. Lower-kebab-case, at most 32 characters. It equals the directory name and the package name `@forge/pack-<id>`. The ids `core`, `user`, `recipe`, `all`, `none` and `packs` are reserved. |
| `name`, `summary`, `description` | yes | Plain text for the pack manager and the enable offer. `summary` is one line of at most 120 characters (UI-TOOLKIT §6.7); `description` is longer. They are **text**: nothing renders them as markup (UI.md §4 rule 6). |
| `version` | yes | Semantic version of the pack. Informational: it is shown in the pack manager, stored when the user enables the pack, and used to detect a change since then (section 7.3). It is not a compatibility range (section 9). |
| `channel` | yes | `stable` packs ship in the production build. `internal` packs (the demo pack, and a pack in development) ship only in builds that set `FORGE_PACKS_INTERNAL=1` (section 3.6, decision PK14). |
| `licence`, `notice` | yes, no | An SPDX identifier from the allow list, and the path of the pack's NOTICE file. `notice` is required when the pack has `externalCode` (the schema says so). |
| `requires.packApi` | yes | The pack API level (`PACK_API`, section 9) the pack was written for. A mismatch fails the build. |
| `requires.packs` | no | Ids of packs that must be enabled for this one to work. Ids only, no version ranges (decision PK4). The graph must be acyclic. Core is always present and is not listed. |
| `vocabularies` | yes | The vocabularies the pack provides. Each is one file, `vocab/<name>.fth`, or a primitives-only module `src/prims/<name>.ts`, or both (the rule of RECIPES §2.1). `internal: true` means the vocabulary is a helper space: it is never in the catalogue and a recipe that names it is `unknown-op`, as for the core `INTERNAL_VOCABS`. |
| `kinds` | no | The extension kinds the pack **owns**. A kind name is owned by exactly one pack, and the names `table`, `null` and `array` are owned by core and reserved (T18; LANGUAGE-0.3.md Q15). A pack may not claim them (`kind-reserved`). `label` is the noun the UI shows ("table", "rational number"; UI-TOOLKIT §6.7 calls it `noun`). `viewer` says the page entry registers a viewer. `paramHelper` says the kind can be a recipe parameter, and then `parser` names the one module the worker and the page share. |
| `conversions` | no | The conversions of RECIPES-1.2 §6.9. `buildCatalogue` copies them into the pack's catalogue fragment. |
| `entries` | yes | `worker`: the module that provides the vocabulary sources and registers the kinds (section 4.5). `page`: the module that registers viewers and helpers. A pack with a viewer or a helper must have a page entry (the schema says so). |
| `capabilities.effects` | yes | The effect labels the pack's primitives use beyond what core grants (section 6). An explicit `[]` states that the pack asks for nothing. |
| `capabilities.csp` | no | CSP sources the pack's page code needs. The deployed CSP in `infra/site.tf` must already allow them (check `csp-unsatisfied`). |
| `externalCode` | no | Code compiled elsewhere and loaded by the pack: id, version, path, SHA-256, licence, a gzip ceiling and the primitives that call it (`"*"` or a list of qualified names). The version rule of section 5.5 applies to those primitives. |
| `budget` | yes | Gzip byte budgets (section 3.5). `total` covers every file the pack adds. `worker` and `page` cover the files reachable from each entry. |

**What is deliberately not in the manifest.** Chunk file names and sizes are known only after the bundle is built, so they are generated (section 3.5), not written. The list of ops, their parameters and their effects come from the loaded runtime (RECIPES §2.3). Test vectors are found by convention (`vocab/*.test.json`). Slots are derived from headers (RECIPES-1.2 §4.5). Hard kill is a primitive flag (RECIPES-1.2 §19.1 a).

### 2.4 Checks the schema cannot make

The generator (`packs:gen`) and the build run these. Each has a stable code, which the tests of section 10 name.

| Code | The check |
|---|---|
| `schema` | The manifest does not validate. |
| `id-dir` | `id` differs from the directory name or the package name. |
| `id-reserved` | The id is one of the reserved ids. |
| `vocab-clash` | A vocabulary name is also a core vocabulary (a file in `packages/ops/vocab`, a module in `packages/ops/src/prims`, a name in `INTERNAL_VOCABS`, `core` or `user`) or another pack's vocabulary. |
| `vocab-file` | A listed vocabulary has no `.fth` file and no primitive module, or a file under `vocab/` or `src/prims/` is not listed. One `.fth` file belongs to one vocabulary, and its `IN:` names it (RECIPES §2.4 rule 1). |
| `kind-clash` | A kind name is owned by another pack. This is the T18 refusal "at the manifest". |
| `kind-reserved` | A kind name is one of the **reserved core kind names**: `table` (`@forge/ops`, T21), `null` and `array` (`@forge/lang`, LANGUAGE-0.3.md §4.2, §7 and §10). A pack never owns them. The set is the constant `CORE_KIND_NAMES` in `@forge/packs`, and a test compares it with the kinds that `@forge/lang` and `@forge/ops` register when they load, so a new core kind cannot be missed. |
| `kind-unknown` | An `ext{kind}` header in the pack's FL names a kind that the pack does not own, core does not own and a required pack does not own. |
| `kind-registered` | The pack's worker entry registers a set of kinds that differs from `kinds`. (A test, section 10.) |
| `viewer-missing`, `helper-missing` | A kind says `viewer` or `paramHelper` and the page entry does not export one. (A test.) |
| `parser-imports` | A parser module imports anything but files under its own directory, or `import type`. It must be dependency-free so that both sides can import it (X0 R6). |
| `entry-missing` | A path in `entries`, `parser`, `notice` or `externalCode` does not exist. |
| `requires-unknown`, `requires-cycle`, `requires-api` | A required pack is not in the build, the graph has a cycle, or `packApi` is not the current `PACK_API`. |
| `dependency-undeclared` | The pack's FL names a vocabulary of another pack (`scanVocab` `deps`) that is not in `requires.packs`, directly or through a required pack. |
| `core-depends-on-pack` | Core, built alone, names a pack vocabulary. The generator builds core with no pack first. |
| `effect-undeclared` | A primitive or an op of the pack carries an effect label that is neither declared in `capabilities.effects` nor one of the three base labels `+async`, `+random`, `+time` (section 6.3). |
| `effect-unused` | `capabilities.effects` lists a label that no primitive of the pack carries. Least privilege: ask for what is used. |
| `csp-unsatisfied` | `capabilities.csp` asks for a source that `infra/site.tf` or `apps/web/scripts/serve-prod.mjs` does not allow. |
| `conversion-op` | A conversion's op is not an op of the pack, does not take the `from` kind or return the `to` kind, or has a parameter without a default. |
| `external-sha` | The file at `externalCode.path` does not hash to `sha256`. |
| `external-version` | A primitive named by `externalCode.primitives` has a `version` that does not contain `externalCode.version` (section 5.5), or a named primitive does not exist. |
| `licence-list` | `licence` or an `externalCode.licence` is not on the allow list (`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`; a proposal), or the NOTICE file is empty. |
| `budget-exceeded` | After the bundle: a chunk set is over its budget (section 3.5). |
| `channel-production` | A production build contains an `internal` pack. |
| `fragment-drift` | The merged catalogue of core and the fragments differs from the catalogue built from one runtime (section 5.2). |

### 2.5 Example: the `relix` manifest

This is the manifest that work package R13 delivers (TOOLKIT §13.6). The numbers in `budget` and the SHA-256 are illustrative: R1b produces the real artefact, and the budget is set from the measured build (the engine was 1.33 MB gzip in R0, and T12 caps it at 3 MB).

```json manifest relix
{
  "$schema": "../../packages/packs/src/manifest.schema.json",
  "format": 1,
  "id": "relix",
  "name": "Relix",
  "summary": "Build and run relational queries on your tables.",
  "description": "Relational algebra on tables: build queries as recipe steps and run them in the browser.",
  "version": "0.1.0",
  "channel": "stable",
  "licence": "Apache-2.0",
  "notice": "NOTICE",
  "requires": { "packApi": 1 },
  "vocabularies": [{ "name": "relix" }],
  "kinds": [
    { "name": "relation", "label": "relation", "viewer": true, "paramHelper": false },
    {
      "name": "relix-expr",
      "label": "Relix expression",
      "viewer": false,
      "paramHelper": true,
      "parser": "src/kinds/relix-expr/shape.ts"
    }
  ],
  "conversions": [
    { "from": "table", "to": "relation", "op": "relix:from" },
    { "from": "relation", "to": "table", "op": "relix:run", "atEnd": true }
  ],
  "entries": { "worker": "src/worker.ts", "page": "src/page.ts" },
  "capabilities": { "effects": [] },
  "externalCode": [
    {
      "id": "relix-web",
      "version": "1.0.0-rc13+web.1",
      "path": "engine/relix-web.mjs",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "licence": "Apache-2.0",
      "maxGzip": 3000000,
      "primitives": "*"
    }
  ],
  "budget": { "total": 3300000, "worker": 3200000, "page": 60000 }
}
```

Reading it against RELIX.md:

- One vocabulary `relix`, and the kinds `relation` and `relix-expr`, owned by the pack (RX1). `table` is core and is not listed.
- `relation` has a viewer and is never a parameter. The sources and terminals are words. A slot parameter has the kind `relation` but is not a text parameter (RECIPES-1.2 §4). Its `fromText` is registered by the worker entry and defers its parse to the engine (RELIX.md §2.2).
- `relix-expr` is a parameter kind with a tier-1 shape check, so it has a `parser`. It has no viewer: it is never an output (RELIX.md §2.3).
- The two conversions are those of RECIPES-1.2 §6.9, with `atEnd` on the run.
- `capabilities.effects` is empty: the pack needs no network and declares no label of its own (RELIX.md §11.1, T3).
- `externalCode` declares the engine. Every primitive of the pack must carry its version (section 5.5). The engine runs in the bake Worker, outside the FL meter, so the pack's limits are RELIX.md §8.1.
- The generated wrappers in `vocab/relix.fth` are one file, because one `.fth` file belongs to one vocabulary. RELIX.md §4.8 names `vocab/relix-ops.fth`. That name needs to change (section 14).

### 2.6 Example: the `demo` manifest

The demo pack proves the mechanism with the three registration points that X0 §11 (P8) names: a kind, a viewer and a parameter helper.

```json manifest demo
{
  "$schema": "../../packages/packs/src/manifest.schema.json",
  "format": 1,
  "id": "demo",
  "name": "Demo",
  "summary": "A test pack with one kind, one viewer and one helper.",
  "description": "A tiny pack for tests: one extension kind, one viewer and one parameter helper.",
  "version": "0.1.0",
  "channel": "internal",
  "licence": "Apache-2.0",
  "requires": { "packApi": 1 },
  "vocabularies": [{ "name": "demo" }],
  "kinds": [
    {
      "name": "demo-tally",
      "label": "byte tally",
      "viewer": true,
      "paramHelper": true,
      "parser": "src/kinds/demo-tally/parse.ts"
    }
  ],
  "entries": { "worker": "src/worker.ts", "page": "src/page.ts" },
  "capabilities": { "effects": [] },
  "budget": { "total": 40000, "worker": 30000, "page": 15000 }
}
```

The vocabulary `demo` has two ops (a proposal for P8a):

- `demo:tally ( bytes -- ext{demo-tally} )` counts byte values. Its output has a viewer: a list of bars built with `createElement`.
- `demo:merge ( bytes extra:ext{demo-tally}="" -- ext{demo-tally} )` counts the bytes and adds the counts in the parameter. The parameter has a text form, `41=3,42=1` (byte in hex, equals sign, count). It exercises `fromText`, the shared parser module and the parameter helper (`check`).

The pack has no engine chunk and no capability.

### 2.7 Example: the `media` manifest (sketch)

A sketch only. WP M1 owns the real one. It shows the two capability fields: an effect label and a CSP source. The vocabulary names are illustrative.

```json manifest media
{
  "$schema": "../../packages/packs/src/manifest.schema.json",
  "format": 1,
  "id": "media",
  "name": "Media",
  "summary": "Work with images, audio, charts and QR codes.",
  "description": "Images, audio, charts and QR codes.",
  "version": "0.1.0",
  "channel": "internal",
  "licence": "Apache-2.0",
  "requires": { "packApi": 1 },
  "vocabularies": [{ "name": "image" }, { "name": "audio" }, { "name": "qr" }],
  "kinds": [
    { "name": "image", "label": "image", "viewer": true, "paramHelper": false },
    { "name": "audio", "label": "audio", "viewer": true, "paramHelper": false }
  ],
  "entries": { "worker": "src/worker.ts", "page": "src/page.ts" },
  "capabilities": { "effects": ["+async", "+media"], "csp": { "media-src": ["blob:"] } },
  "budget": { "total": 400000 }
}
```

This pack stays `internal` until the owner approves `media-src blob:` in `infra/site.tf` (TOOLKIT §5.5, WP M1). The check `csp-unsatisfied` fails a `stable` pack that asks for a source the deployed CSP lacks.

### 2.8 What the UI needs of the manifest (UI-TOOLKIT §6.7)

SP3 lists the fields that the pack manager, `PackIndex` and the operations pane read. Each is covered:

| UI needs | In this document |
|---|---|
| id, display name, one-line summary (at most 120), description, version | `id`, `name`, `summary`, `description`, `version` |
| size budget (gzip bytes) | `budget.total` |
| vocabularies | `vocabularies` (internal ones are not shown) |
| kinds with a noun | `kinds[].name` and `kinds[].label` |
| conversions | `conversions` |
| dependencies on other packs | `requires.packs` |
| UI entry (the chunk with viewers and widgets) | `entries.page`, compiled into `PackInfo.loadPage` |
| plain-words list of what the pack can do | **Not a manifest field.** It is derived from `capabilities` by one fixed table in the app (an effect label or CSP source maps to one sentence). A free-text field would be a second statement of the capability that could disagree with it, and text written by a pack author would reach the enable prompt. An empty list shows "no extra capabilities". |
| chunk and catalogue file names | Generated, not written: `PackInfo` holds the fragment URLs and the `loadPage` import (section 3.3). |
| a bundled JSON summary, no request | The generated `registry.generated.ts` is that summary. It is a TypeScript module rather than JSON so that `loadPage` is a real `import()` that Rollup can chunk. It holds no pack code and costs no request (PK5). |

UI-TOOLKIT §6.7 also says the page fetches the manifest summary; here it is compiled in, so only fragments are fetched.

---

## 3. Build-time discovery and generation

### 3.1 Layout

```text
packs/
  relix/
    manifest.json            the source of truth for the pack
    package.json             name @forge/pack-relix; exports ./worker and ./page (built files)
    NOTICE
    vocab/relix.fth          one .fth file per vocabulary
    vocab/relix.test.json    vectors (RECIPES §9; RECIPES-1.2 §8.6)
    src/prims/relix.ts       primitives (lazy chunk)
    src/kinds/...            kinds; the shared parser modules
    src/worker.ts            worker entry (section 4.5)
    src/page.ts              page entry
    engine/relix-web.mjs     externalCode, hashed by the manifest
    test/                    pack tests, including test/security for engine packs
    dist/                    build output, ignored by git: compiled JS,
                             catalogue.json, help.json, checks.json (section 5.1)
packages/packs/              @forge/packs: manifest types, schema, validator, generator,
                             pack loader, PackIndex builder (new package)
apps/web/src/packs/registry.generated.ts       page registry (generated, committed)
apps/web/src/bake/worker-packs.generated.ts    worker registry (generated, committed)
```

The root `package.json` workspaces gain `packs/*`. A pack is built like `@forge/ops`: `tsc` compiles `src` to `dist`, and the package exports the built files. Calls to `import.meta.glob` stay in the output for Vite to transform, with the same trap that RECIPES §2.4 records: the export must not point at `src`, or a primitive module would be evaluated twice and its registries would diverge.

### 3.2 What `packs:gen` does

`npm run packs:gen -w @forge/packs` runs in this order. Each step stops the build with the code of section 2.4 and the pack id.

1. **Discover.** List the directories `packs/*` that hold a `manifest.json`. A directory that starts with `_` or `.` is skipped.
2. **Validate.** Check each manifest against the schema, then the checks that need only the manifests (ids, clashes, `requires`, kinds, conversions, CSP).
3. **Select.** Drop `internal` packs unless `FORGE_PACKS_INTERNAL=1` is set. The rest of the steps see only the selected packs.
4. **Build core alone.** Assemble core with no pack (`core-depends-on-pack`). This is the build that `@forge/ops` runs today.
5. **Build each pack on core.** For each pack, assemble core plus the pack plus its `requires` closure, and nothing else (`dependency-undeclared`). Run the runtime checks (effects, conversions, `externalCode`, `viewer-missing`, `kind-registered`).
6. **Write the fragment.** The pack's catalogue fragment, help fragment and checks fragment go to `packs/<id>/dist/` (section 5.1).
7. **Write the registries.** The two generated TypeScript files (section 3.3).
8. **Write the notices.** One `THIRD-PARTY-NOTICES.txt` from the NOTICE files and `externalCode` licences (decision PK24).

`npm run packs:gen -- --check` runs steps 1 to 7 in memory and fails when a generated file differs from what is committed (`fragment-drift` also runs here, section 5.2). CI runs it. This follows the pattern of R2b (`gen:relix --check`).

### 3.3 What is generated

| File | Holds | Read by |
|---|---|---|
| `apps/web/src/packs/registry.generated.ts` | `PACKS: readonly PackInfo[]`, one literal per selected pack: id, name, description, version, channel, licence, `requires.packs`, vocabularies, kinds (name, label, viewer, paramHelper), conversions, `capabilities`, the URLs of the pack's fragments (Vite `?url` imports) and `loadPage: () => import("@forge/pack-<id>/page")`. | The page: the pack manager, the lazy viewer stubs, `PackIndex`, `fit.ts` labels, the catalogue merge. |
| `apps/web/src/bake/worker-packs.generated.ts` | `WORKER_PACKS: Readonly<Record<string, WorkerPackEntry>>`: id, `requires`, vocabularies, kinds, effects and `load: () => import("@forge/pack-<id>/worker")`. | The bake worker entry and the console worker entry. |
| `packs/<id>/dist/catalogue.json` | The pack's ops as an ordinary catalogue (section 5.1). | The page (fetched), the CI. |
| `packs/<id>/dist/help.json`, `checks.json` | The pack's help and content-check fragments, in the formats of RECIPES §2.7 and the checks document. | The page (lazy). |

Both registries come from the same manifests, so the page and the worker cannot disagree about what a pack is. They are committed, so that `npm run typecheck` needs no generation step, and `--check` keeps them true (question PQ6). The page does **not** fetch a manifest at run time. The manifest facts are compiled into its entry chunk, a few hundred bytes a pack (an estimate; P7 measures it). This refines TOOLKIT §5.5, which said that `fetch` may read the pack manifest: only the fragments are fetched (decision PK5).

### 3.4 Emitting chunks under the CSP

Every file that a pack adds is an ordinary output of the Vite build, served from `assets/` with the long-lived `immutable` policy of PLAN §10.

- **Entries and primitive modules** are reached only through dynamic `import()` of a workspace package: the generated registries and the pack's own `import.meta.glob` calls. Rollup emits each as a hashed same-origin ES module chunk. `script-src 'self'` allows it. The bake and console workers are already ES module workers (`worker: { format: "es" }`), so `import()` works in them (RELIX.md §1.5).
- **The engine chunk** is a dependency of a primitive module: `import("../engine/relix-web.mjs")` inside `src/prims/relix.ts`, called on the first engine call. Rollup emits it as one chunk. The pack does not use `eval` or `new Function`. R0 measured no CSP violation for the TeaVM JavaScript output (RELIX.md §11.4). The Wasm GC build stays out (T15).
- **Styles.** A viewer styles itself with an adopted stylesheet in a shadow root, or with Lit `static styles` (X0 §8, UI.md §4 rule 2). A pack that imports a `.css` file gets a same-origin stylesheet link, which `style-src 'self'` allows. No inline `<style>` and no `style` attribute.
- **Other files.** A pack that needs a non-JS file (a WASM module, a table) reads it with `new URL("…", import.meta.url)` and `fetch` of that URL, from its worker entry. `connect-src 'self'` allows it. This extends UI.md §4 rule 8, which said that `fetch` is for the catalogue only (section 14).
- **`wasm-unsafe-eval`** is already in the CSP. A pack that ships WASM follows the same rules: same origin, hashed, in the manifest's `externalCode`.
- **The CSP does not change** for any pack except one whose manifest has `capabilities.csp`. That change is an owner-approved edit of `infra/site.tf` and `serve-prod.mjs` (T5, M1), checked by `csp-unsatisfied`.

### 3.5 After the bundle: attribution, budgets and the report

A Vite plugin, `forgePacks()` in `apps/web/vite.config.ts` (WP P1b), reads the output bundle in `generateBundle`. It does three things.

1. **Attribute chunks.** A chunk belongs to a pack when its modules are under `packs/<id>/`. The set of a pack is every chunk reachable from the pack's entry chunks by static and dynamic imports, minus the chunks that the core graph also reaches. A chunk that two packs reach counts for both (conservative). It fails the build (`channel-production` and a new code, `core-imports-pack`) if a **static** import edge leads from the core entry graph into `packs/`. The only edges are the dynamic imports of the two generated registries.
2. **Measure.** The gzip size of each chunk at level 9, as `apps/web/scripts/check-size.mjs` measures. The sums are `total` (all chunks of the pack), `worker` (reachable from the worker entry, engine chunk included) and `page`.
3. **Report.** It writes `apps/web/reports/packs.json`, not deployed and ignored by git:

   ```text
   { format: 1, packs: [ { id, chunks: [ { file, role: "worker" | "page" | "prims" | "engine" | "shared",
       raw, gzip } ], total, worker, page, budget: { total, worker?, page? } } ] }
   ```

`npm run size` (WP P7) reads the report. It prints one table per pack, fails when a size is over its budget, and still enforces the 250 kB core budget (PLAN §6). The core count includes the generated registries and the pack-manager code, which are in the entry graph. The packs themselves are not in it. The `externalCode.maxGzip` ceiling is checked against the engine chunk alone.

### 3.6 CI checks

| Check | Where | Fails when |
|---|---|---|
| `packs:gen --check` | CI, after `npm ci` | a manifest check of section 2.4 fails, or a generated file is stale |
| Manifest corpus | `npm test` (`@forge/packs`) | a valid manifest is refused, or an invalid one passes (section 10.1) |
| Core builds alone, pack closure builds | `packs:gen` steps 4 and 5 | `core-depends-on-pack`, `dependency-undeclared` |
| Merge equality | `npm test` (`@forge/packs`) | `fragment-drift` (section 5.2) |
| Forbidden APIs | `npm run lint` | a pack uses a banned API (section 8.5) |
| Budgets | `npm run size` | `budget-exceeded`, `externalCode.maxGzip`, or the 250 kB core budget |
| CSP needs | `packs:gen` | `csp-unsatisfied` |
| Production selection | the deploy job, after `npm run build` | `channel-production`: `dist` mentions an internal pack |
| Pack vectors | `npm test`, `gate4:browser` | a vector of a pack op fails (section 10.3) |
| Gate T3 e2e | `npm run e2e` | the demo pack test of section 10.4 fails |

CI builds twice: once as production (no internal pack) for `size` and the deploy job's check, and once with `FORGE_PACKS_INTERNAL=1` into a second output directory for the pack end-to-end test (WP P8b). The deploy workflow keeps running `npm run build`, which excludes internal packs by default.

---

## 4. The init protocol

### 4.1 How the page and the workers learn the enabled set

The enabled set is a list of pack ids, closed under `requires.packs`. The sequence at start-up:

1. The `persist` feature opens IndexedDB (UI.md §3.4 starts it first).
2. The new `packs` feature (WP P4) starts right after it. It reads the store (section 7.1), intersects the stored ids with `PACKS` from the generated registry (an id that the build no longer has is ignored and kept in the store), closes the set under `requires`, drops packs in state `needs-review` or `failed` (section 7.3) and publishes `state.packs`.
3. The catalogue loader fetches the fragments of the enabled packs and merges them with the core catalogue (section 5).
4. The bake controller reads `state.packs.enabled` and passes it in `init`. It subscribes to the slice and acts on a change (section 4.7).
5. The console client does the same in its `init` message (section 4.6).
6. The page registers a lazy viewer stub and a lazy helper stub for every kind of every enabled pack (section 4.5).

No code of a pack runs in steps 1 to 6 except what a feature of the pack declares (question PQ10).

### 4.2 Messages

`BakerInit` gains `packs`. `InitInfo` gains `packs`. Both ride protocol 2 (RECIPES-1.2 §12), so a `protocol: 1` client is refused at `init` with `E_PROTOCOL`.

```ts
interface BakerInit {
  readonly vocabs?: readonly string[] | "all"; // "all" now means core plus the enabled packs
  readonly units?: readonly UnitSource[];
  readonly packs?: readonly string[]; // NEW. Enabled pack ids, closed under requires. Default [].
}
interface InitInfo {
  readonly protocol: typeof PROTOCOL_VERSION; // 2
  readonly catalogueVersion: string; // of the baker's own catalogue (section 5.4)
  readonly vocabs: readonly string[]; // the full set loaded
  readonly packs: readonly string[]; // NEW. The packs whose worker entry was loaded
}
```

**The guard** in `packages/worker/src/protocol.ts` (`isInit`) checks the shape: `packs` is an array of at most `MAX_PACKS` (64) strings, each at most 32 characters and matching the id pattern, with no duplicates. The guard does not know which ids exist. That is the worker's check, below.

**The worker's checks** run in `core.init`, before it loads anything. A failure rejects `init`, and the port answers `init-error` with a `BakeError` that has `code: "E_PROTOCOL"` and a `detail.reason`:

| `detail.reason` | When | Other detail |
|---|---|---|
| `unknown-pack` | an id is not in the worker's generated registry | `pack` |
| `pack-closure` | a pack's `requires` is not in the list | `pack`, `missing` |
| `unknown-vocab` | `vocabs` names a vocabulary that is neither core nor in an enabled pack | `vocab` |
| `pack-load` | the pack's worker module failed to load or to register | `pack`, `message` |
| `pack-kinds` | the pack registered kinds other than the manifest's | `pack`, `kinds` |
| `pack-conflict` | two providers claim one vocabulary or primitive module (should not happen: the build checks it) | `vocab` |

`port.ts` today maps every init failure to `E_INTERNAL` with an empty `detail`. P2b changes `core.init` to throw an `InitError` that carries `code` and `detail`, and `runInit` to pass them on. The client's rejected promise carries the same two properties.

**No silent repair.** The worker refuses a pack list that is not closed. It does not add the missing pack. The page owns the enabled set. A page and a worker that disagree about what a pack requires are two builds that should not be talking (the protocol check catches most of that).

**Init deadline.** The client gains `initTimeoutMs` (proposal: 20,000). On expiry it terminates the worker and rejects. An `init` is fast by design: a pack's `activate` must not load an engine chunk (section 4.5). The deadline is the backstop (section 8.4).

### 4.3 The composite provider and the loader

`createBundleLoader(provider)` and the scanner already take their sources from a `VocabSourceProvider` (RECIPES §2.4). Packs use that seam and add three pieces.

```ts
// @forge/ops  (packages/ops/src/bundle.ts, WP P2a)
function createCompositeProvider(parts: readonly VocabSourceProvider[]): VocabSourceProvider;
// Merges fthFiles() and primitiveLoaders(). A repeated file name or primitive module name
// throws PackConflictError (section 4.2, pack-conflict).

function createPackProvider(globs: {
  readonly fth: Readonly<Record<string, string>>; // import.meta.glob("../vocab/*.fth", { query: "?raw", eager: true })
  readonly prims: Readonly<Record<string, () => Promise<PrimitiveModule>>>;
}): VocabSourceProvider;
// A pack's worker entry calls it with its own glob results, so the globs live in the pack.

function createNodePackProvider(root: string): VocabSourceProvider;
// For Node: reads the pack directory with node:fs, as createNodeProvider does for core.
```

```ts
// @forge/packs  (WP P2a)
interface WorkerPackEntry {
  readonly requires: readonly string[];
  readonly vocabularies: readonly string[];
  readonly kinds: readonly string[];
  readonly effects: readonly EffectLabel[];
  readonly load: () => Promise<WorkerPack>; // the pack's worker entry
}
function createPackLoader(options: {
  core: VocabSourceProvider;
  packs: Readonly<Record<string, WorkerPackEntry>>;
}): PackLoader;
interface PackLoader {
  loadBundle(names: readonly string[] | "all" | undefined, packs: readonly string[]): Promise<PackBundle>;
}
interface PackBundle extends VocabBundle {
  readonly packs: readonly string[]; // the packs whose entry was loaded, in dependency order
  activate(host: WorkerPackHost): Promise<void>; // runs each pack's activate, in order
}
```

`createPackLoader` does this for a request `(names, packs)`:

1. Check the ids (section 4.2). Order the packs so that dependencies come first.
2. Decide which packs to load. With `names === "all"`, every enabled pack. Otherwise only the packs that own at least one vocabulary of the closure of `names` (section 4.4). This is a decision about code loading. The registry knows each pack's vocabulary names without loading the pack.
3. Load each chosen pack's worker module, call its `registerKinds` (section 4.5), and compare the kinds it registered with the manifest's (`pack-kinds`).
4. Build `createBundleLoader(createCompositeProvider([core, ...providers]))`. The scan is cached per sorted pack list, in a small map.
5. Return the bundle for `names`.

`BakerCoreOptions` gains an optional `packLoader`. When it is absent and `init.packs` is not empty, `init` fails with `unknown-pack`. The existing `loadBundle` option stays for core-only callers (Node tests and the harness), so no existing caller changes. The web app's workers pass a pack loader.

**`vocabs: "all"`** means core plus the enabled packs. It never means every pack in the build. A disabled pack's `.fth` text and primitives are not scanned or loaded, so a core vocabulary cannot depend on one by accident (the scan would fail with `unknown vocabulary`).

**Two worker entries, one loader.** The app owns both worker entry files (`apps/web/src/bake/worker.ts` and the console worker). They import the generated `WORKER_PACKS`, the core `createViteProvider()` and `createPackLoader`. `@forge/worker` stays free of pack knowledge: it takes the loader by injection, as it does today (RECIPES §8.1 rule R24). `apps/web/src/bake/web-baker.ts` imports the app's entry instead of `@forge/worker/worker-web?worker`. The Node and harness entries (`worker-node.ts`, `worker-web.ts`) stay for core-only runs (`gate2:browser`).

### 4.4 Dependency-closure loading

Today the controller calls `init({ vocabs: "all" })`, so all 70 primitive modules load at worker start (TOOLKIT §2.3). P3 replaces that with the closure of what the recipe needs.

**What the page sends.** `vocabs` is the set `S`, computed on the page:

```text
S0 = opVocabs(recipe)                       RECIPES-1.2 §8.2, pure and catalogue-free
   ∪ sourceVocabs(userSource)               vocabularies a user unit names (section below)
   ∪ conversionVocabs(enabledPacks, S0)     the vocabulary of each conversion op of any
                                            enabled pack that owns a vocabulary in S0
S  = S0, plus every vocabulary of core if S0 contains a catalogue-wide vocabulary
```

The loader adds the transitive dependencies of `S` and the vocabulary `recipe` (RECIPES §8.2). The result is `InitInfo.vocabs`.

- **`sourceVocabs(source)`** is a new pure function in `@forge/ops`. It returns the vocabularies that a unit's text names (`USING:` forms and qualified words), by the same extraction that `scanVocab` uses for rule 2 of RECIPES §2.4. A user word may call any op, so the user unit's closure belongs in `S`.
- **`conversionVocabs`.** A recipe that has `relix:` steps and a `csv:parse` step gets `relix:from` inserted by the compiler. If the recipe's only Relix words were in another vocabulary of the same pack, the conversion's vocabulary might not be in `opVocabs`. Adding the conversion vocabularies of the packs that the recipe touches closes that gap (RECIPES-1.2 §6.9).
- **The catalogue-wide exception.** The vocabulary `magic` searches the catalogue with a nested baker that has "the same vocabularies" (RECIPES §8.6). A recipe that names a `magic:` op therefore loads all of core. The list of such vocabularies is a core constant, `CATALOGUE_WIDE_VOCABS`, which holds `magic` (decision PK8). Magic does not search packs in v1 (question PQ5).
- **Grow only.** The controller keeps the set `loaded` that the baker has. Before a bake it computes `S` for the recipe. If `S ⊆ loaded` it bakes. Otherwise it re-inits with `loaded ∪ S` and then bakes. A re-init rebuilds the runtime, so the set only grows within a session. A change of the enabled packs or of the user source resets it (section 4.7).
- **The console** is a REPL where the user may type any word. When it first opens it loads core plus every enabled pack (`vocabs: "all"`). It does not load at start-up unless the user words are non-empty, as UI.md §5.2 says today. Then it needs `sourceVocabs` only to decide that it must start.

**What the page needs to know about the catalogue.** The ops pane, the validator and the parameter forms use the catalogue the page loaded (core JSON plus fragments). They do not depend on what the baker loaded. Section 5.4 says what the baker's own catalogue version means.

**Cost.** A re-init assembles every loaded unit again and imports the primitive modules that are not cached. For a typical closure this is tens of milliseconds (estimate; P3 measures it). The end-to-end smoke test `ops-smoke.spec.ts` bakes two vectors from each of 155 vocabularies, which would re-init up to 155 times with a growing set. P3 measures this, and if it is slow the test passes a test-only hook that loads the whole set once. A later optimisation is incremental extension of a loaded runtime (question PQ9).

### 4.5 Registering kinds in the worker and the page

The registry of kinds is process-wide and idempotent: the last registration wins (T18, X0 R1 and R2). A pack that claims a kind that another pack owns is refused at the manifest, not at run time.

**Pack worker entry.** `src/worker.ts` default-exports a `WorkerPack`:

```ts
const PACK_API = 1;

interface WorkerPack {
  readonly packApi: typeof PACK_API;
  /** The pack's vocabulary sources: createPackProvider({ fth: import.meta.glob(...), prims: import.meta.glob(...) }). */
  readonly provider: VocabSourceProvider;
  /** Register every kind in the manifest, once, with registerExtKind. Idempotent. */
  registerKinds(register: (kind: ExtKind<unknown>) => void): void;
  /** Optional. Runs after the runtime is assembled and the catalogue is built. */
  activate?(host: WorkerPackHost): void | Promise<void>;
}

interface WorkerPackHost {
  readonly runtime: ForgeRuntime;
  readonly catalogue: Catalogue; // the baker's catalogue: loaded core plus enabled packs
  readonly enabledPacks: readonly string[];
  /** Called at the start of every bake. Returns a function that runs at its end. */
  onBake(start: (bake: BakeContext) => (() => void) | void): void;
}
interface BakeContext {
  readonly signal: AbortSignal;
  readonly abortFlag: Int32Array | null; // the per-bake shared flag of RECIPES §8.5 layer 2
  readonly limits: Limits; // the effective limits (RECIPES §8.6)
  readonly deadlineAt: number | null; // epoch ms
}
```

`registerKinds` runs before any unit of the bundle loads, so a header that names `ext{kind}` finds its kind. `activate` is where `relix` installs its cancellation poll (RELIX.md §8.2) and its `fl` function library (RELIX.md §6.1) over `host.catalogue`. It must not load an engine chunk or do work proportional to data. The engine loads on the first primitive that needs it. The names `BakeContext` and `onBake` are a proposal that R13 refines.

The `fl` library reads the catalogue of **all enabled packs**, so the ops it exposes depend on which packs are on (RELIX.md §6.3). That is a read of the effective catalogue, not a dependency, so the manifest declares nothing for it (question PQ13).

**Pack page entry.** `src/page.ts` default-exports a `PagePack`:

```ts
interface PagePack {
  readonly packApi: typeof PACK_API;
  /** Key = a kind name with "viewer": true. The factory type is the viewer contract of the UI proposal (SP3, from X2). */
  readonly viewers: Readonly<Record<string, ViewerFactory>>;
  /** Key = a kind name with "paramHelper": true. check(text, ctx) and an optional complete(...) (X3). */
  readonly helpers: Readonly<Record<string, ParamHelperFactory>>;
  /** Optional UI features, as apps/web/src/modules.ts registers them. Section 4.1: a pack with features pays its page-entry load at start-up. */
  readonly features?: readonly Feature[];
}
```

**Lazy stubs.** For every enabled pack, the page registers one stub per kind from the generated registry. A stub knows only the kind's name and label, which are in the entry chunk. The first time the page needs the real viewer or helper, the stub calls `PackInfo.loadPage()`, replaces itself with the real registration and renders. Until then the page shows the value as text (the fallback of X0 §5.2). If the import fails, the stub keeps the text fallback and the pack manager shows the pack as `failed` for this session. The kind labels feed `fit.ts` and the "Data here" line without loading anything.

**One parser module, both sides.** A kind that is a parameter has one `parser` module (X0 R6, T20). The worker entry imports it for `fromText`. The page entry imports it for `check`. Rollup puts it in a chunk both entries share. The module has no imports except files in its own directory and `import type` (`parser-imports`). It exports the pure functions that both need, such as `parseTier1(text)`.

### 4.6 The console worker

`apps/web/src/fl/protocol.ts` today has `init { units }`. It gains `packs`, with the same meaning and the same guard as the baker's `init`, and `ready` gains `packs`. The console worker builds the runtime from `loadBundle("all", packs)` and publishes the catalogue it built, which already includes the enabled packs' ops. Under the ordering rule of UI.md §3.4 that catalogue wins over the page's merged one. They are equal (section 5.2).

### 4.7 Enabling and disabling at run time

| Change | What the page does |
|---|---|
| A pack is **enabled** | It fetches the fragment, merges it into the catalogue, registers the lazy stubs and re-inits the baker with the new `packs` list and the grown vocabulary set. The console is re-inited when it is running. Nothing needs a restart. |
| A pack is **disabled** | It disposes the baker client and the console worker and creates new ones without the pack. The kind registry is process-wide and has no unregister, so a clean worker is the way to a clean registry. It drops the fragment from the catalogue and removes the stubs. Output values of the pack's kinds that are on screen fall back to text. |
| The user source changes | As today: re-init, now with `sourceVocabs` in the set. |

A recipe that names ops of a disabled pack stays in the editor. The validator, given `PackIndex`, reports `pack-not-enabled` on those steps (RECIPES-1.2 §8.2), and the page offers to enable the pack (section 7.4).

---

## 5. The catalogue and packs

### 5.1 Fragments

The core catalogue, `dist/catalogue.json`, holds the ops of core only. Each pack has a **fragment**: an ordinary catalogue (the same schema, `format` 1) that holds the ops of the pack's non-internal vocabularies, plus the pack's `conversions` (RECIPES-1.2 §14.4). Its `version` is a content id over its own ops. The page fetches the fragments of the enabled packs, merges them, and so knows every op and parameter without loading any pack code.

A fragment is built by `packs:gen` step 6 from one runtime: core plus the pack plus its required packs. `buildCatalogue` gains options for this (WP P1c): `internalVocabs` (the pack's internal vocabularies, to skip as it skips `INTERNAL_VOCABS`) and `onlyVocabs` (to keep the pack's ops out of the core part). P1c edits `catalogue.ts` beside RW4 (`slot`, `previousHashes`, `conversions`), and the two WPs are sequenced or given to one agent.

**The invariant that makes fragments sound:** an op's catalogue entry, including its `hash`, depends only on core and on the packs it requires. It does not depend on which other packs are enabled. Core never depends on a pack (`core-depends-on-pack`), and a pack depends only on core and on `requires.packs` (`dependency-undeclared`). So the entry for `relix:select` is the same whether or not `media` is on.

### 5.2 The merged catalogue and its version

`mergeCatalogues(core, fragments)` in `@forge/packs` returns a `Catalogue`: the ops of all inputs sorted by `qname` in code-point order, the vocabularies sorted, the `conversions` concatenated in pack order, and `version = first16(sha256(JSON.stringify(ops)))`, the function `buildCatalogue` uses. On the page it uses WebCrypto (asynchronous, which is fine in the loader). In Node it uses `node:crypto`. A test checks that both agree with `sha256` of `@forge/lang`.

The test of **merge equality** (`fragment-drift`) runs in CI. For core alone and for each pack on its own with its required closure, and for all stable packs together, it checks:

```text
mergeCatalogues(core, fragments(S))  ===  buildCatalogue(assemble(core + S))      (ops, vocabs, conversions, version)
```

This is also what the console worker's catalogue must equal when it loads `S`. The invariant of section 5.1 is why it holds.

The merged version is different for each enabled set. It is the version of **the catalogue in use** (RECIPES §2.3). Core alone gives the core version, the same value as today.

### 5.3 `PackIndex`

The page builds `PackIndex` (RECIPES-1.2 §8.2) from the registry and the enabled set:

```ts
// @forge/packs
function createPackIndex(packs: readonly PackInfo[], enabled: ReadonlySet<string>): PackIndex;
// vocabs:  vocabulary name -> pack id, for every NON-internal vocabulary of every pack in this build
// enabled: the enabled pack ids, closed under requires, excluding packs in state needs-review or failed
```

It passes the index to `validateRecipe`, `decodeShare` and `packsUsed`. Three consequences:

- A pack that is not in this build (an internal pack in production, or a pack removed later) is not in `vocabs`. Its ops are `unknown-op`, not `pack-not-enabled`. That is honest: there is nothing to enable.
- A pack in `needs-review` or `failed` is in `vocabs` and not in `enabled`. Its ops are `pack-not-enabled`, and the offer says "review and enable".
- `PackIndex` is rebuilt whenever the enabled set changes.

### 5.4 The recipe stamp, `catalogue-mismatch` and the baker's catalogue

`recipe.catalogue` records "the catalogue version the recipe was made with". With packs there is no single such version (risk 12, T26). RECIPES-1.2 §8.5 decided two rules: the validator skips `catalogue-mismatch` for a recipe that has a pack op, and `encodeShare` omits `catalogue` for it. This document closes the gap those two rules leave, for a recipe that has **no** pack op but is made or read with packs on. The merged version would differ between two users who differ only in their packs, and every pack-free recipe would warn.

**Rule (decision PK9): `recipe.catalogue`, when present, is the core catalogue version.** The page keeps two catalogues:

- the **merged** catalogue, for the ops pane, the forms and `fit`;
- the **recipe view** of it: the merged catalogue with `version` replaced by the core version. The page passes this view to `validateRecipe`, `encodeShare`, `compileRecipe` and every stamp. The page never stamps a recipe that has a pack op (`packsUsed` is non-empty), and the two rules of RECIPES-1.2 §8.5 cover reading one.

So a pack-free recipe compares against the core version whatever packs are on, and a recipe with a pack op is never compared. The per-step pins stay the safeguard (RECIPES §3.1).

**The baker's catalogue is partial by design** under closure loading (section 4.4), so its `version` is neither the core version nor the merged version. Therefore:

- The baker removes `catalogue-mismatch` from the warnings it returns. The page validated the recipe against the full catalogue already and owns that warning.
- `InitInfo.catalogueVersion` stays, as the version of the baker's own catalogue. The controller no longer compares it to the page's catalogue. It compares per op instead, when it needs a skew check: `catalogueVersionOf(pageCatalogue.ops.filter(op => info.vocabs.includes(op.vocab)))` must equal it. `catalogueVersionOf` is the function of section 5.2. P3 owns the change.
- Pins (RECIPES §3.10) are checked against the baker's ops, which are identical to the page's for the vocabularies that are loaded.

### 5.5 Pins, hashes and the engine version

**Pack ops and `previousHashes`.** An op's hash covers its source and everything it calls (RECIPES §3.10). A pack op calls core words, so a change to core (the FL v0.2 sweep, L12) changes the hash of pack ops too. `pins:compat` (RECIPES-1.2 §9.2) therefore runs over the whole catalogue including packs, per fragment: for each op present in both the old and the new catalogue, the old hash becomes a previous hash if the op's vectors are identical. A pack added since the old tag has no old hashes and gets none. Its ops are new, so no old pin names them.

**The version rule for engine code** (RECIPES-1.2 §8.4, which asked this document to state it and P1 to test it). A primitive's hash covers its header and its `version`, not its TypeScript body (RECIPES §2.4). A primitive that calls compiled code that FL does not hash would keep its hash when that code changes. The rule:

> Every primitive named by an `externalCode` entry (`primitives: "*"` means every primitive of the pack) has a `version` that contains the entry's `version` string.

The build checks it (`external-version`). It checks the manifest's SHA-256 against the file (`external-sha`), so the `version` string cannot be left unchanged while the file changes. Together they make the op hashes of the pack move whenever the engine changes. The test of section 10.2 proves it by bumping the version in a fixture manifest and comparing hashes.

**Removing a vocabulary or moving it between core and a pack** does not change its qualified names, so recipes keep their meaning. Moving a vocabulary **out of core** into a pack turns working recipes into `pack-not-enabled` for users who have not enabled it. The release that moves it carries a notice (section 9).

---

## 6. The capability model

PLAN §1 says shared recipes and vocabularies run "with no ambient capabilities", and PLAN §5 says the capability set is the primitive registry. This section says how a pack gets a capability, how Forge limits it and what happens when a run is denied.

### 6.1 Terms

- An **effect label** is a tag on a primitive that says what it uses beyond pure computation. It is the existing `EffectLabel` of `@forge/lang` (`WordMeta.effects`, `PrimitiveDef.effects`). Labels propagate through the words that call the primitive.
- A **capability** is an effect label that Forge denies unless the enabled set grants it. The three base labels are not capabilities in this sense. A new label added by this document, `+media`, is.
- A **grant** is the permission the user gives by enabling a pack. It names the capabilities the pack's manifest requests.
- `RunOptions.deny` (LANGUAGE §10, `packages/lang`) is the enforcement. The VM refuses to call a primitive that carries a denied label.

### 6.2 The labels

| Label | Meaning | Defined | Denied unless granted? | Who may request it |
|---|---|---|---|---|
| `+async` | The primitive awaits a Promise (WebCrypto, streams, a decoder). | FL v0.1 | no | any pack |
| `+random` | The primitive draws from the CSPRNG. | FL v0.1 | no | any pack |
| `+time` | The primitive reads the clock. | FL v0.1 | no | any pack |
| `+media` | The primitive uses canvas or `OffscreenCanvas`, an audio or video decoder or encoder, or other media host facilities. | P6, new | **yes** | `media` and any pack that lists it |
| `+net` | Not defined. T3 rules out network sources, and the CSP has no outbound `connect-src`. | none | none | none |

The list is **closed and defined in core** (`EffectLabel` in `packages/lang/src/types.ts`). A pack cannot invent a label (decision PK11). A reviewer sees the whole list in one file, and a new label is a decision with a CSP and a UI consequence, not a manifest entry. Adding `+net` later needs a T-decision and an owner-approved CSP change. The manifest schema's `effects` enum equals the type, and a test keeps the two equal (section 10).

The base labels exist to describe determinism and asynchronicity. A caller may still deny them for one run (for example, Magic's nested bakes may deny `+random`). They are not part of the grant.

### 6.3 Declaring

A pack declares what it needs in two places that must agree:

- each primitive that uses a host facility carries the label in its `PrimitiveDef.effects`;
- the manifest lists, in `capabilities.effects`, every label that the pack's primitives carry beyond the three base labels, **and the base labels it uses**.

The generator checks both directions. `effect-undeclared` fires when an op of the pack carries a label (through any callee) that the manifest does not list and that is not a base label. `effect-unused` fires when the manifest lists a label that no primitive carries. A pack that calls another pack's word that carries `+media` gets the label on its own ops, so it must list `+media` too. The check works on the transitive `WordMeta.effects`, so the dependency cannot hide.

### 6.4 Granting

Enabling a pack grants every capability its manifest requests. There is no per-capability switch in v1 (question PQ4: the pack manager shows what is requested, and the user takes it or leaves the pack).

The store records the grant with the pack (section 7.1): the labels and CSP sources the manifest requested at the time. At start-up the page compares the manifest of this build with the stored grant. If the build requests **more** than was granted, the pack's state is `needs-review`. It is off until the user reviews and confirms again. A pack update therefore cannot widen its own permissions silently (decision PK12).

### 6.5 Enforcing

The baker computes `deny` for every run from the enabled set (WP P6):

```text
GRANTABLE = every label that is a capability                 // today: ["+media"]
granted   = union of capabilities.effects of the enabled packs
deny      = (GRANTABLE minus granted) union BakeOptions.deny
```

`BakeOptions` gains `deny?: readonly EffectLabel[]` (additive, protocol 2). The in-process baker, the client, the console and the CLI use the same function. The VM already checks `deny` at every primitive call (`primCall`) and throws `E_FORBIDDEN`, which a `try` cannot catch (LANGUAGE §10.1). The base labels are denied only when a caller asks.

The worker derives `granted` from its own generated registry, not from the page. The page decides which packs are in the list. The registry says what each one requests. They come from the same manifests.

Two things limit what `deny` buys, so the document states them:

- With the enabled set granting `+media`, every recipe that reaches a `+media` op may use it. The grant is per user and per enabled set, not per recipe. The protection against a shared recipe is the enable step (section 7.4), and `deny` is the second layer for callers that narrow a run: the nested searches of Magic, a future safe mode, the CLI.
- A pack without `+media` in its manifest cannot reach a `+media` primitive. The build refuses (`effect-undeclared`). `deny` is therefore defence in depth for that case.

### 6.6 The structured error

A denied word raises the existing `ForgeError`: `code: "E_FORBIDDEN"`, `word`, `vocab`, `detail.effect` (the label). The baker adds `detail.pack` (the owning pack's id) when the word's vocabulary belongs to a pack, from its registry. The `BakeError` carries the step `path` as for any error. The page shows a sentence built from a fixed table (the label's meaning and "this run does not allow it"), never from text in the error. `E_FORBIDDEN` is already in the set of codes that stop a run and cannot be caught (`E_ABORTED`, `E_LIMIT_*`, `E_INTERNAL`, `E_FORBIDDEN`), so untrusted FL cannot swallow it.

### 6.7 Page capabilities and the CSP

Effect labels cover worker code. A page entry has other needs: a viewer that plays audio needs `media-src blob:` (TOOLKIT §5.5). The manifest declares them in `capabilities.csp`. Three properties:

- The CSP is **global**. It is a header on the whole site, not a per-pack permission. Once `media-src blob:` is deployed, every page code, enabled pack or not, may create a media element from a blob. The enable step gates what **we** load, not what the browser permits. That is why the schema allows only `img-src`, `media-src` and `font-src` with `blob:` or `data:`, and why each addition needs the owner's approval (TOOLKIT §5.5, risk 8).
- The manifest still states the need, so that `csp-unsatisfied` fails a pack that would not work, and so that the enable dialog can say "plays audio you produce".
- A viewer builds DOM with `createElement` and `textContent` and brings its styles as adopted stylesheets (UI.md §4 rules 2 and 6).

### 6.8 What the Relix pack asks for

Nothing. Its `capabilities.effects` is `[]` and it has no `csp`. The engine has no I/O. It runs only on in-browser data (T3, RELIX.md §11.1). If `deny` denies a base label for a run, an FL op that needs it fails inside a `fl.*` call as it would in a step (RELIX.md §11.1).

---

## 7. Enabling and disabling

### 7.1 The store

The enabled set is per browser, kept in IndexedDB (UI.md §4 rule 10). It is one document in the existing `kv` store, under the key `packs`. This needs no schema migration (`DB_VERSION` stays 1) and one `put` is atomic.

```json
{
  "v": 1,
  "packs": {
    "relix": {
      "enabled": true,
      "version": "0.1.0",
      "granted": { "effects": [], "csp": {} },
      "at": 1763900000000
    }
  },
  "pending": null
}
```

`version` and `granted` are what the build offered when the user enabled. `at` is a timestamp for display. `pending` is the id of a pack whose load was in progress (section 8.4). The store keeps a record for a pack that is `enabled: false`, so that disabling and enabling again does not lose nothing important, and it keeps records of packs the build no longer has. A record that fails validation is dropped. If IndexedDB is unavailable, the in-memory fallback of `persist/db.ts` applies, and the enabled set lasts for the session (section 7.3 shows the message).

By default every pack is off (decision PK14, question PQ1). The store holds nothing that is sent anywhere. The privacy page states that the list of enabled packs is stored locally (section 14).

### 7.2 The pack manager

The pack manager is a dialog in the app (SP3 owns its design). It lists every pack of the build whose channel is selected, with name, description, version, an upper bound of the download (the manifest's `budget.total`; the report has the real figure), the capabilities requested in plain words, its dependencies and its state. It offers Enable and Disable, with the closure shown before the user confirms: enabling a pack lists the packs it requires, and disabling a pack lists the enabled packs that require it. Enabling is keyboard-operable, and the dialog passes axe in the three themes.

### 7.3 Pack states

| State | Meaning | In the enabled set? |
|---|---|---|
| `off` | No record, or `enabled: false`. | no |
| `on` | Enabled, grant covers the manifest, loaded or loadable. | yes |
| `needs-review` | Enabled earlier, but this build requests more than was granted (a new capability or CSP source). | no |
| `failed` | The load failed this session (section 8.4), or the previous load never finished (`pending`). | no |
| `unavailable` | The store has a record, and this build does not have the pack. | no |
| `blocked` | Enabled, but a required pack is not `on`. | no |

`needs-review` and `failed` turn into `on` only by an explicit Enable. A change of `version` alone, with the same grant, does not need review: the pack manager shows "updated from 0.1.0 to 0.2.0". Nothing else about a pack persists.

### 7.4 The enable offer

Two things trigger the offer: opening a shared link and opening a saved recipe.

1. **A shared link.** `decodeShare` is called with `packs: PackIndex`. When every error of the recipe is `pack-not-enabled`, it fails with `packs-needed` and carries the recipe, the pack ids and what the link carried (RECIPES-1.2 §8.3).
2. **A saved recipe, or a recipe that the user edits.** `validateRecipe` with `PackIndex` reports `pack-not-enabled` on the steps. The page shows the same offer.

The offer is a dialog (SP3 owns it) with fixed wording that uses only values from the **build**: the pack's `name` and `description`, the closure, the capabilities and the notice "first-party code from this site, running in your browser; nothing is sent". Nothing in it is taken from the link. The pack ids come from `packsUsed`, which maps the recipe's vocabularies through the build's registry, so an id that the build does not know cannot appear. The capability sentences come from one fixed table in the app (an effect label or a CSP source maps to one sentence, section 2.8), never from the manifest or the link. The decisions are Enable and Not now. UI-TOOLKIT.md §6.5 words them "Turn on and open" and "Open without the pack", and adds Cancel, which discards the link and changes nothing. On Enable the page:

1. writes the store (section 7.1) with the grant;
2. runs the fan-out of section 4.7;
3. validates the recipe again with the new `PackIndex`, and loads it when it is valid.

On Not now the recipe opens read-only in the editor with the `pack-not-enabled` issues shown, so the user can still read it. There is **no** automatic enabling: no URL parameter, no `packs-needed` handler and no recipe content enables a pack. The rule is stated as a test (section 10.4).

### 7.5 What a share link carries

A link carries the recipe, the main input, the tabs that `input:tab` or `relix:input` steps name, and nothing about packs (T26, RECIPES-1.2 §11). The pack ids come from the op names. The share dialog says "This recipe needs Forge 1.2 or later" when `recipeUsesV12` is true and, with `packs` given, names the packs it needs (RECIPES-1.2 §11.5). Opening a link that uses pack ops works only after the offer above. A link made with an op of an `internal` pack opens in production as `unknown-op`.

### 7.6 Trust for shared recipes

A recipe from a link is **untrusted**, as before (PLAN §1, RECIPES §8.6): it bakes with `trust: "untrusted"`, with the untrusted limits, and a recipe that needs a hard kill needs a killable host. Enabling a pack does not trust the recipe. It only makes the pack's ops available to every recipe. The recipe's name, description and notes are text. The offer, the issue texts and the error panel render text only. A shared recipe cannot define a primitive, a kind or a capability, because it contains only references to catalogue ops (PLAN §5).

---

## 8. Security and limits

### 8.1 What is protected, and from whom

| Threat | Defence |
|---|---|
| A hostile **recipe** or share link (untrusted data) | Untrusted bake limits, no ambient capabilities, hard kill, text-only metadata, the enable step, and a link that cannot enable anything (sections 6 and 7). |
| A hostile **shared FL vocabulary** (untrusted code) | It runs as an untrusted `user` unit: no primitive binding, no write into packs or core (RECIPES §2.5). Out of scope here. |
| A **broken pack** (a bug) | Limits, the watchdog, failure containment (section 8.4), budgets, tests. |
| A **malicious pack** (a compromised repository, dependency or build input) | Review, pinned dependencies, the `externalCode` hash, the lint guard rails and the CSP. This is **not** a sandbox, and section 8.3 says what it does not stop. |

A pack is first-party code. T7 chose this. The model protects the user from recipes and shared FL. It protects them from a pack only to the extent of the review and the guard rails below.

### 8.2 Limits that apply to pack code

- **In the bake Worker.** A pack's primitives run in the bake Worker under the same limits as any word: `maxSteps`, `maxValueBytes`, `maxTotalBytes`, `maxMillis` and the untrusted limits of RECIPES §8.6. A primitive that runs long in one synchronous call is stopped by the watchdog, which terminates the Worker. An untrusted bake of a recipe that reaches a primitive flagged `hardKill` is refused when the host cannot kill (`E_UNSAFE_HOST`). The next bake pays for a cold start (RELIX.md §8.2: about 1 s for the engine, an R0 measurement).
- **Memory outside the FL meter.** The engine's heap is not metered by the VM. A pack that holds memory outside the meter must bound it with its own limits and test them (RELIX.md §8.1 does it with cells, rows and rounds).
- **Output size.** Every `ext` value is metered when produced, through the kind's `sizeOf`: O(1), a conservative upper bound, cached, with a conformance test per kind (T19).
- **On the page.** The page entry runs on the main thread, where nothing can interrupt it. A viewer renders only the first N rows that the kind's `view` returns (X0 §5.1), and does no heavy work on load. A pack keeps its page entry small (`budget.page`) and puts compute in the worker. This is a rule for reviewers: no tool measures main-thread time, and PQ10 notes the cost of a pack that declares features.

### 8.3 What a malicious or broken pack can and cannot do

**A broken pack can:** throw or hang while loading (contained by section 8.4); return wrong results (caught by vectors); use memory up to the worker's limits; produce a viewer that throws (the host falls back to the text of the value, and a viewer that throws does not hide the value, X0 §11); fail the build by exceeding its budget.

**A malicious pack can** (the capabilities of code that the page or the Worker runs):

- read the user's input, recipes and outputs that reach its words or its page code, and keep or alter them;
- run any code in the bake Worker or, for a page entry, on the main thread, under the page's privileges;
- navigate the page. **CSP does not stop navigation.** A page entry could set `location` to an address of its choice with data in the query string. The lint rules of section 8.5 ban the obvious spellings, and review has to catch the rest. A worker cannot navigate;
- use any CSP source that the deployed CSP allows (for example `blob:` media, once `media-src` is deployed);
- write to IndexedDB or `localStorage` (the lint rule bans it; the browser does not).

**A malicious pack cannot** (the CSP and the build bound these):

- send data to another origin by `fetch`, XHR, WebSocket, `sendBeacon`, an image, a font or a form, because `connect-src 'self'`, `img-src` without a remote origin and `form-action 'none'` refuse them;
- load a script, worker or style from another origin, from `blob:` or from `data:`, or run `eval` or `new Function`, because the CSP refuses them;
- add a capability that the manifest did not declare, at build time (`effect-undeclared`), or add one to an update without the user's review (`needs-review`, section 6.4);
- enable itself, enable another pack or reach another pack's private words (`E_READONLY`);
- change the CSP, which is a response header.

The honest summary: **a compromised pack is as dangerous as a compromised page.** The CSP removes the easy exfiltration routes. It does not remove the hard ones. The defences are that packs are first-party, reviewed, built from pinned inputs and kept small, and that a pack's page entry is small and does little.

### 8.4 Failure containment

- **A load failure** (a rejected `import()`, a pack module that throws, `pack-kinds`, `pack-load`) marks the pack `failed` for the session. The page keeps working without it, shows the reason as text, and offers Retry and Disable.
- **A hang or a crash while loading.** Before the first load of a pack in a page session, the pack manager writes the pack id to `pending` in the store. It clears `pending` when the worker's `init` has succeeded and the page entry, if one was needed, has loaded. If the page starts and finds `pending` set, the previous load did not finish. It marks the pack `failed` without loading it and says so. The cost is one small write per pack per session. It stops a pack that crashes the tab from crashing it on every start (decision PK21).
- **The init deadline** (section 4.2) terminates a worker that does not answer `init`.
- **A pack that fails while a recipe runs** fails that bake with the usual error and does not mark the pack failed. A worker that dies is replaced, as today (RECIPES §8.5 layer 4).

### 8.5 Guard rails

ESLint rules for `packs/**`, in `eslint.config.js` (WP P1b), fail the lint run on:

- `eval`, `new Function`, `setTimeout` or `setInterval` with a string, `importScripts`, `document.write`;
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, except in the one module that the host marks for non-JS pack files (section 3.4);
- `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `Range.createContextualFragment`, `DOMParser` on pack input;
- `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches`;
- writing `location` (or its parts), `window.open`, `history` methods, `<a>` or `<form>` creation with a non-same-origin target;
- dynamic `import()` with a non-literal argument.

These rules are guard rails against mistakes and against the careless attacker. They are not a security boundary (section 8.3). They run on pack sources, not on dependencies.

---

## 9. Versioning and compatibility

There are five numbers. Each has one job.

| Number | Where | Job |
|---|---|---|
| `format` | manifest | The shape of the manifest. 1. |
| `PACK_API` | `@forge/packs`, `requires.packApi` | The contract between core and packs: the two entry interfaces of section 4.5, the viewer and helper contracts (SP3, X3), the `ExtKind` interface, `PackIndex` and the registry shapes. An incompatible change to any bumps it. A pack built for another value fails the build (`requires-api`). |
| `version` | manifest | The pack's own release, for the pack manager and the review check. Informational. |
| `Catalogue.version` | catalogue and fragments | A content id (RECIPES §2.3). Never written by hand. |
| `PROTOCOL_VERSION` | `@forge/worker` | The bake protocol. The `packs` field of `init` rides protocol 2 (decision PK7). |

**Pack against core.** All packs are built from the same commit as the site, so a pack is never run against a core other than its own. There are no version ranges between packs and core, or between packs (decision PK4). `PACK_API` makes the build fail when someone changes the contract and forgets a pack. Behaviour compatibility is tested by the pack's vectors, which run against the core in the build.

**Pack against catalogue.** A pack op's hash covers the core words it calls (section 5.5). A change to core that changes those words changes the hash. `previousHashes` keeps old pins quiet when the vectors did not change. The recipe's `catalogue` stamp is the core version (section 5.4), so a pack never makes a recipe look stale.

**Names are permanent.** A vocabulary name, a kind name and a pack id are part of the public contract, because recipes, links and the store hold them. A rename is a breaking change and there are no aliases in v1 (decision PK22). A vocabulary may move between core and a pack and between packs without changing its qualified names. Moving out of core into a pack makes old recipes `pack-not-enabled` for users who have not enabled the pack, so the release that does it carries a notice in the pack manager. No such move is planned: no media op exists in core today (TOOLKIT §2.1).

**A pack that changes its requests.** Section 6.4: more capabilities or a new CSP source means `needs-review`. Fewer is silent.

**A pack that the build drops.** The store keeps its record (`unavailable`). Recipes that name its ops become `unknown-op`.

**The enabled set and `PROTOCOL_VERSION`.** `packs` is in the `init` message, which the strict guard of `protocol.ts` refuses when it has an unknown key. So the field cannot be added after protocol 2 has shipped without a new bump. P2b must land in the same release as RW5 (question PQ7).

---

## 10. Testing

### 10.1 The manifest validator

`@forge/packs` holds a corpus under `packages/packs/test/manifests/`: `valid/*.json` and `invalid/<code>.json`, one file per code of section 2.4, plus fixtures that give a fake core (a small `packs-fixture` tree) so the cross-checks run without the real repository. Every `valid` manifest passes. Every `invalid` file fails with exactly its code. The three example manifests of this document are `valid` fixtures, and the Relix and demo manifests of the repository are validated by the same function in `npm test`.

Cases that the schema alone decides (the first draft of the corpus):

| Case | Change to the `relix` example | Result |
|---|---|---|
| PC01 | `"id": "Relix"` | `schema` (id pattern) |
| PC02 | `"id": "re_lix"` | `schema` |
| PC03 | remove `capabilities` | `schema` (required) |
| PC04 | `"capabilities": { "effects": ["+net"] }` | `schema` (unknown label) |
| PC05 | `"capabilities": { "effects": [], "csp": { "connect-src": ["blob:"] } }` | `schema` (no connect-src) |
| PC06 | `"capabilities": { "effects": [], "csp": { "media-src": ["https:"] } }` | `schema` |
| PC07 | remove `parser` from `relix-expr` | `schema` (`paramHelper` needs `parser`) |
| PC08 | remove `entries.page` | `schema` (a viewer needs a page entry) |
| PC09 | `"entries": { "worker": "../x.ts" }` | `schema` (path) |
| PC10 | remove `notice` | `schema` (`externalCode` needs it) |
| PC11 | `"externalCode"` with a 63-character `sha256` | `schema` |
| PC12 | `"vocabularies": []` | `schema` |
| PC13 | `"channel": "beta"` | `schema` |
| PC14 | an unknown top-level key | `schema` |

Cases for the other codes (`vocab-clash` with a vocabulary named `base64`, `kind-clash` with a kind that another fixture pack owns, `kind-reserved` with a kind named `table`, `null` or `array` (three files, one per name), `requires-cycle`, `core-depends-on-pack`, `effect-unused`, `conversion-op` with an op that needs a parameter without a default, `external-version` with a primitive whose `version` lacks the engine's) belong to the same corpus and use the fixture tree.

### 10.2 Mechanics

- **Registry and loader** (`@forge/ops`, `@forge/packs`): `createCompositeProvider` throws on a clash and keeps order; `createPackLoader` refuses unknown, unclosed and conflicting lists with the reasons of section 4.2; a module evaluated twice registers cleanly; a pack whose entry registers the wrong kinds fails with `pack-kinds`.
- **`init` and the protocol**: the guard accepts and refuses the shapes of section 4.2; `InitInfo.packs` lists what loaded; `vocabs: "all"` loads core and the enabled packs only; a disabled pack's vocabulary is `unknown vocabulary`; an `init` with `protocol: 1` fails with `E_PROTOCOL`.
- **Closure loading**: with an empty recipe and no user words, the loaded vocabularies are exactly the closure of `recipe`; a recipe with a `magic:` op loads all of core; `conversionVocabs` is applied; `sourceVocabs` agrees with `scanVocab`'s extraction on every core `.fth` file; grow-only re-init works and a change of the enabled set resets it.
- **Catalogue**: merge equality for every closed subset of the fixture packs (`fragment-drift`); `createPackIndex`; `pack-not-enabled` and `packs-needed` through `decodeShare` with an index (RECIPES-1.2 cases CR226 to CR228 and CR239 to CR241 hold); the recipe view carries the core version, and a pack-free recipe stamped with packs on does not warn when opened with packs off.
- **Hashes**: a fixture pack with `externalCode`: bump the version string, assert that the hashes of its primitives' ops change; leave the version and change the file, assert `external-sha`.
- **Capabilities**: a fixture primitive with `+media`; with the pack off the word is not in the runtime; with a caller's `deny: ["+media"]` the run fails with `E_FORBIDDEN`, `detail.effect` and `detail.pack`, and a `try` does not catch it; with the pack on and granted the run passes; the manifest enum equals `EffectLabel`; `effect-undeclared` and `effect-unused` fire.
- **The store**: against the fake IndexedDB of `persist`: round trip, drop of an invalid record, `needs-review` when the build requests more, `unavailable`, the closure on write, `pending` handling, the in-memory fallback.
- **Kind conformance**: each kind passes X1's conformance (`sizeOf` stable and at least the payload, `equals`, text round trip, a module evaluated twice).
- **Lint guard rails**: a fixture file for each banned API fails the pack lint config.

### 10.3 Vectors per pack

Every op of a pack has test vectors in `packs/<id>/vocab/*.test.json`, under the authoring rules of RECIPES §9.2. The runner finds them through the pack's directory, loads the pack's vocabularies before it runs them and includes the pack's ops in `uncovered` (RECIPES-1.2 §8.6, RW8). `gate4:browser` runs the vectors in Chromium Workers, with a `--packs` option that loads the enabled packs through the app's worker entry. Vectors that need a table use `setup` and `finish` (T22, T28). The conformance corpora of a pack (the Relix reference examples, RELIX.md §12) are the pack's own work packages.

A pack with `externalCode` ships `test/security/*`, and the generator checks that the directory exists. A pack whose ops take text that an engine interprets is the case that needs it (RELIX.md §11.2).

### 10.4 Gate T3: the demo pack under production headers

The end-to-end test `apps/web/e2e/packs.spec.ts` (WP P8b) runs against the build with `FORGE_PACKS_INTERNAL=1`, served by `serve-prod.mjs` with exactly the production headers. As everywhere in the suite, it fails on any console error, failed request or `securitypolicyviolation`. It checks:

1. **Laziness.** At start-up, with a fresh profile, no request names a chunk of the demo pack (the names come from `reports/packs.json`). The primitive chunks requested are only those of the closure of `recipe`. This is TOOLKIT §13.5 P3's "core start-up no longer loads all primitive chunks", with the threshold set when P3 measures it.
2. **Enable.** Through the pack manager, by keyboard: the capability text says "no extra capabilities"; after Enable, the demo ops appear in the operations pane, and the demo chunks are requested only when the first op is baked.
3. **Run.** A recipe with `demo:tally` produces an output that the demo viewer renders (no `innerHTML`); `demo:merge` has an ext parameter whose field shows the helper's live check, and a bad text is `E_COERCE` at the step.
4. **Persistence.** After a reload the pack is still on. After Disable, the workers are new, the ops are `pack-not-enabled`, and the output of an earlier bake shows as text.
5. **The offer.** A share link that uses `demo:tally` opens in a clean profile with the `packs-needed` offer, whose text comes from the manifest. Not now keeps the recipe read-only. A link cannot enable the pack: opening it, in any form, does not change the store until the user clicks.
6. **Production selection.** The production build contains no demo pack and treats a link with a demo op as `unknown-op`.
7. **Headers.** `crossOriginIsolated` is true, and axe passes on the pack manager and the offer in three themes.

---

## 11. Decisions

Ids use the prefix PK. **All of them were approved at Gate T1 on 2026-11-24.** TOOLKIT's T-numbers continue the series (T35 onward).

| ID | Decision | Reason |
|---|---|---|
| PK1 | A pack is a first-party workspace package `packs/<id>` (`@forge/pack-<id>`) with a manifest. Third parties share FL-only vocabularies, which are not packs. | T7; PLAN §5. |
| PK2 | The manifest is `manifest.json`, data validated by a JSON Schema and cross-checks. No tool imports pack code to read it. | A manifest that is code can do unreviewed work at build time (section 2.1). |
| PK3 | Pack ids, vocabulary names and kind names are lower-kebab-case. A vocabulary name is unique across core and packs, and a kind name is owned by exactly one pack or by core. Core owns `table`, `null` and `array`, and a pack may not claim them (`kind-reserved`). A clash fails the build. | T18; RECIPES-1.2 §8.1. |
| PK4 | Core never depends on a pack. A pack depends on core and on `requires.packs`, by id only, with no version ranges. The graph is acyclic. | Packs are built from one commit (section 9); ranges would assert nothing. |
| PK5 | The manifest facts are compiled into the page and the worker (generated, committed registries). The page does not fetch a manifest. It fetches catalogue and help fragments. | Fewer runtime requests and one less file to keep in step; refines TOOLKIT §5.5. |
| PK6 | A pack loads in three lazy levels: its entries, its primitive modules, its engine chunk. All are same-origin hashed ES modules reached by `import()`. | UI.md §4 rules 4, 5 and 8; RELIX.md §1.5. |
| PK7 | `init` carries `packs`, closed under `requires`. The worker refuses unknown and unclosed lists with `E_PROTOCOL`. `vocabs: "all"` means core plus the enabled packs. The field rides protocol 2. | T23; RECIPES-1.2 §12. |
| PK8 | Loading is by closure of the recipe's vocabularies, the user unit's, and the conversions of the packs the recipe touches. Re-init grows the set. `magic` loads all of core. | TOOLKIT P3; RECIPES §8.6 (Magic searches the catalogue). |
| PK9 | `recipe.catalogue` is the core catalogue version, or absent. The page passes a recipe view with the core version to the recipe layer. The baker drops `catalogue-mismatch`. | Risk 12; closes the gap left by RECIPES-1.2 §8.5 (section 5.4). |
| PK10 | Packs ship catalogue fragments, and merging core with fragments must equal one runtime's catalogue, for every closed subset. An op's entry depends only on core and its required packs. | The page needs the ops of enabled packs without loading their code (section 5.1). |
| PK11 | Effect labels are a closed list defined in core. Packs request labels, and cannot define them. `+media` is added. `+net` is not defined. | PLAN §5; T3. |
| PK12 | Enabling a pack grants what its manifest requests. The store records the grant. A build that requests more puts the pack in `needs-review`, and it stays off until the user confirms. | A pack update cannot widen its permissions silently. |
| PK13 | The baker's `deny` is the grantable labels that no enabled pack requests, plus the caller's `BakeOptions.deny`. The VM enforces it with `E_FORBIDDEN`, which `try` cannot catch. | TOOLKIT P6; existing `RunOptions.deny`. |
| PK14 | The enabled set is one document under the key `packs` of the `kv` store. Every pack is off by default. `internal` packs are built only with `FORGE_PACKS_INTERNAL=1`. | UI.md §4 rule 10; T5. |
| PK15 | The enable offer needs a click and uses only text from the build. No link, URL parameter or recipe can enable a pack. | PLAN §1 "untrusted by default"; UI.md §4 rule 6. |
| PK16 | Enabling re-inits the workers. Disabling replaces them. | The kind registry has no unregister (section 4.7). |
| PK17 | `externalCode` declares compiled code with a version, a hash and a ceiling. The primitives that use it carry its version. | RECIPES-1.2 §8.4. |
| PK18 | Pack code gets lint guard rails, and this document states that they are not a sandbox. A compromised pack is as dangerous as a compromised page. | Honesty about T7 (section 8.3). |
| PK19 | A manifest can ask only for `blob:` and `data:` in `img-src`, `media-src` and `font-src`. The deployed CSP must already allow them. | The CSP is global (section 6.7). |
| PK20 | `PACK_API` is an integer bumped on an incompatible contract change. A pack's `version` is informational. | Section 9. |
| PK21 | A `pending` mark in the store contains a pack that did not finish loading, and the client has an init deadline. | A crash loop must not lock the user out of the app. |
| PK22 | Vocabulary names, kind names and pack ids are permanent. There are no aliases in v1. | Recipes, links and the store hold them. |
| PK23 | One `.fth` file per vocabulary, named after it. A generated file is committed whole. | RECIPES §2.1 and §2.4 (`units.find(vocab)`); a loader that took several units per vocabulary would be a larger change. |
| PK24 | Each pack's NOTICE and `externalCode` licences are gathered by the build into one `THIRD-PARTY-NOTICES.txt`. Pack vectors and budgets sit beside the pack, and the 250 kB core budget excludes packs but includes the registry glue. | Apache-2.0 obligations (PLAN §2); TOOLKIT §5.2. |

---

## 12. Questions, decided

**All of them were decided at Gate T1 on 2026-11-24: the owner accepted every recommended answer.** The last column is the decision. None blocks writing the work packages.

| ID | Question | Decision (the recommended answer, accepted) |
|---|---|---|
| PQ1 | Is any pack on by default? | Decided: **No**, every pack off in v1. Revisit `relix` after Gate T4, when the owner can see how often users enable it. |
| PQ2 | Should "enable for this session only" exist, for opening one link? | Decided: **No** in v1. One click enables, the pack manager disables. A session-only mode needs a second state and a second message for little gain. |
| PQ3 | `manifest.json` only, or also `manifest.ts`? | Decided: **JSON only** (PK2). |
| PQ4 | May the user grant some of a pack's capabilities and not others? | Decided: **No** in v1. A pack that wants `+media` for some ops and not others should be two packs. |
| PQ5 | Does Magic search pack ops? | Decided: **No** in v1. Magic searches core (`CATALOGUE_WIDE_VOCABS`). A manifest flag `magic` can come later, if an owner wants a pack's decoders in the search. |
| PQ6 | Are the generated registries committed or generated on every build? | Decided: **Committed**, with `packs:gen --check` in CI, as R2b does. It keeps `npm run typecheck` free of a generation step. |
| PQ7 | Does `packs` ride protocol 2 or force protocol 3? | Decided: **Protocol 2.** P2b lands with RW5 so that one bump covers both. If protocol 2 has already shipped when P2b starts, `packs` needs 3, because the strict guard refuses an unknown key, so P2b must not be scheduled after RW5 has merged without it. |
| PQ8 | Does the console load everything it may need at first open, or the closure of what the user types? | Decided: **Everything enabled, at first open.** It is a REPL. |
| PQ9 | Should a loaded runtime be extendable without a full re-init? | Decided: **Not in v1.** Measure the cost in P3. If the smoke test or real use shows a problem, add `init` with `extend: true` later. |
| PQ10 | May a pack contribute UI features (panes, menu items) that load at start-up? | Decided: **Yes, if declared** (`features` in the page entry), with `budget.page` as the limit. SP3 decides how a pack places a feature. A pack with no feature pays nothing at start-up. |
| PQ11 | Is `THIRD-PARTY-NOTICES.txt` deployed at a public path? | Decided: **Yes**, as a static file linked from the About page, as the licences require. |
| PQ12 | May a pack keep its own state (for example a saved Relix query library)? | Decided: **No** in v1. A pack with a need proposes an API (a namespaced `kv` handle) as a separate decision. |
| PQ13 | Does a pack declare that it reads the catalogue of other packs (the Relix `fl` bridge)? | Decided: **No.** It reads the effective catalogue, which is not a dependency. The exposure report of the bridge lists what was exposed (RELIX.md §6.3). |
| PQ14 | The eager `.fth` text of every core vocabulary is in the worker chunk. Make it lazy per vocabulary? | Decided: **Defer.** It is not in the core budget (the worker is a lazy asset). Measure after P3. A lazy glob needs a scan that does not need the sources. |
| PQ15 | RELIX.md §4.8 names `vocab/relix-ops.fth`. Allow several files per vocabulary instead of renaming? | Decided: **Rename**: the generator writes `vocab/relix.fth` whole (PK23). Several files per vocabulary would change `createBundleLoader`. |

---

## 13. Work packages

These refine TOOLKIT §13.5 rows P1 to P8. Ids keep the TOOLKIT number and add a letter where a row splits. P1c, P9 and P8b are new. Files are proposals: the brief of each WP fixes them. Sizes are relative estimates. Agents: **So** (Sonnet) for spec-critical work, **Ha** (Haiku) for well-specified work. All of them wait for Gate T1 and for the owner's approval of this document. Every new file carries the Apache-2.0 header. A pack owns its own directory, and the pack manifests of the Relix and media packs belong to R13 and M1.

| WP | Scope | Files (proposal) | Depends on | Size | Agent | Done when |
|---|---|---|---|---|---|---|
| P1a | The `@forge/packs` package: manifest types, the schema of section 2.2, `validateManifest`, the cross-checks of section 2.4 that need no runtime, the core name sets (core vocabularies, and the reserved kind names `table`, `null` and `array`), `PACK_API`, the corpus of section 10.1 | `packages/packs/*` | SP4 approved, Gate T1 | M | So | Every `valid` manifest passes and every `invalid` fails with its code; the manifests of this document validate; the schema is strict under Ajv |
| P1b | Discovery and generation: `packs:gen` and `--check`, the two generated registries, the fragment build driver, the `forgePacks()` Vite plugin and report, root workspace and script wiring, the ESLint guard rails, `.gitignore` entries | `packages/packs/src/gen/*`, `apps/web/vite.config.ts`, `apps/web/src/packs/registry.generated.ts`, `apps/web/src/bake/worker-packs.generated.ts`, root `package.json`, `eslint.config.js` | P1a, P1c | M | So | The generator runs on a fixture tree and on the demo pack; `--check` fails on a stale file; a static import from core into `packs/` fails the build; the forbidden-API fixtures fail lint |
| P1c | Catalogue support: `buildCatalogue` options `internalVocabs` and `onlyVocabs`, `mergeCatalogues`, `catalogueVersionOf`, the merge-equality test | `packages/ops/src/catalogue.ts`, `packages/ops/src/types.ts`, `packages/packs/src/merge.ts` | RW4 (RECIPES-1.2), P1a | S | So | Merge equality holds for every closed subset of the fixture packs; core-only output is byte-identical to today's |
| P2a | The composite provider, `createPackProvider`, `createNodePackProvider`, and `createPackLoader` | `packages/ops/src/bundle.ts`, `packages/ops/src/packs.ts`, `packages/packs/src/loader.ts` | P1a | M | So | A clash throws; unknown, unclosed and conflicting lists are refused with the reasons of section 4.2; a module evaluated twice registers cleanly |
| P2b | Baker `init` with pack ids: `BakerInit.packs`, `InitInfo.packs`, the guard, `InitError`, `init-error` mapping, `initTimeoutMs`; the console `init` and `ready`; the app's two worker entries; the `web-baker.ts` switch | `packages/worker/src/{types,protocol,core,port,client}.ts`, `apps/web/src/bake/worker.ts`, `apps/web/src/fl/*` | P1b, P2a, RW5 | M | So | Ids not in the manifest are refused; a `protocol: 1` client gets `E_PROTOCOL`; `gate2:browser` still passes; the pack list is echoed in `InitInfo` |
| P3 | Closure loading: `sourceVocabs`, `CATALOGUE_WIDE_VOCABS`, the controller's grow-only loading, the baker's `catalogue-mismatch` drop, the console's load-all-on-open, the recipe view of section 5.4 | `apps/web/src/bake/controller.ts`, `packages/ops/src/*`, `packages/worker/src/core.ts` | P2b, RW6 (`opVocabs`) | M | So | Core start-up no longer loads all primitive chunks (threshold set from the measurement); the re-init cost is reported; `ops-smoke.spec.ts` passes |
| P4 | The store, `state.packs`, the `packs` feature, the lazy viewer and helper stubs, the catalogue merge on the page, the pack manager (design from SP3) | `apps/web/src/packs/*` | P2b, SP3 | M | So | Enable and disable persist per browser; `needs-review`, `unavailable`, `blocked` and `failed` work; fake-IndexedDB tests pass; axe passes in three themes |
| P5 | The enable offer and notice for `packs-needed` and for saved recipes, the share-dialog pack lines | `apps/web/src/packs/offer/*`, `apps/web/src/bake/forge-share-dialog.ts` | P4, X3, RW6 | M | So | Opening a recipe that names a pack op offers to enable; no URL or recipe enables a pack; the text comes from the build |
| P6 | `+media` in `EffectLabel`, the baker's `deny` computation, `BakeOptions.deny`, the `detail.pack` field, the `effect-undeclared` and `effect-unused` checks, the manifest enum test | `packages/lang/src/types.ts`, `packages/worker/src/{types,protocol,core}.ts`, `packages/packs/src/checks/effects.ts` | X1, P1a | S | So | A denied capability produces `E_FORBIDDEN` with `detail.effect` and `detail.pack`; `try` does not catch it; the enum equals the type |
| P7 | Per-pack size budgets in `npm run size`, from the report; the `externalCode` ceiling | `apps/web/scripts/check-size.mjs` | P1b | S | Ha | A budget breach fails CI; the 250 kB core budget still applies and counts the registry glue |
| P8a | The demo pack: manifest, vocabulary, kind, viewer, parser, helper, vectors, unit tests | `packs/demo/*` | P2b, X2 | S | Ha | The pack loads and bakes in Node; vectors pass; the checks of section 2.4 pass |
| P8b | The Gate T3 end-to-end test, the second build with internal packs, the `gate4:browser --packs` option | `apps/web/e2e/packs.spec.ts`, `apps/web/scripts/serve-prod.mjs` (output directory option), `.github/workflows/ci.yml` | P4, P5, P8a | M | So | Every check of section 10.4 passes under the production headers |
| P9 | `THIRD-PARTY-NOTICES.txt` generation and the link from the About page | `packages/packs/src/gen/notices.ts`, `apps/web/pages/*` | P1b | S | Ha | The file lists every pack's NOTICE and `externalCode` licence; the link works |

Dependency sketch:

```text
 P1a -> P1c -> P1b -> P2b (needs P2a, RW5) -> P3 (needs RW6)
 P1a -> P2a -> P2b
 P2b -> P4 (needs SP3) -> P5 (needs X3, RW6) -> P8b
 P2b + X2 -> P8a -> P8b
 X1 + P1a -> P6 ;  P1b -> P7 ;  P1b -> P9
```

**Gate T3** (TOOLKIT §13.5) is met when P8b passes and P3's start-up check passes.

**How the WPs meet other rows.** R13 (the Relix manifest, lazy load, cancellation wiring) delivers `packs/relix/manifest.json` as in section 2.5 and uses `WorkerPackHost.onBake`. RW4 owns `catalogue.ts` with P1c. RW5 owns the protocol 2 bump that P2b rides. RW6 delivers `PackIndex`, `packsUsed` and `opVocabs`, which P3 and P5 use. X1 owns the `Value`, `ExtKind` and `registerExtKind` contracts that section 4.5 uses. M1 delivers the media manifest and the CSP change.

---

## 14. Changes needed in other documents

This document edits none of them. The orchestrator applies or briefs these. **Applied at Gate T1 (2026-11-24)** in the files that the specification work owns: items 10 and 11 in RECIPES-1.2.md (§8.4, §8.5, §12, §14.3, Q11), items 12 to 14 in RELIX.md, and the pack parts of item 15 to 17 in UI-TOOLKIT.md (rule 8, §6). Items for TOOLKIT.md, PLAN.md and UI.md are left to the orchestrator and to the work packages.

**TOOLKIT.md**

1. §5.1: the manifest facts point to this document: id, version, vocabularies, kinds, viewers, helpers, entries, budget, capabilities, `requires`, licence and NOTICE. A pack is `packs/<id>` (`@forge/pack-<id>`). Add the list of what may and may not be in a pack (section 1.2).
2. §5.2: the `init` message carries pack ids and the worker refuses unknown and unclosed lists (section 4.2). `vocabs: "all"` means core plus the enabled packs. Dependency-closure loading is defined in section 4.4. Enabling is stored under the `kv` key `packs` (section 7.1). The manifest is compiled into the page: only fragments are fetched (PK5). Packs are outside the 250 kB budget, and the registry glue is inside it.
3. §5.4: `EffectLabel` gains `+media` only. `+net` is not defined. The baker's `deny` is computed from the enabled set (section 6.5), and the structured error is `E_FORBIDDEN` with `detail.effect` and `detail.pack`.
4. §5.5: rule 8 becomes "fetch may also read pack catalogue, help and checks fragments and a pack's own hashed non-JS files; pack code loads by `import()` of same-origin hashed modules". The words "the pack manifest" go. The `media-src blob:` row stands and is checked by `csp-unsatisfied`.
5. §13.5, rows P1 to P8: replace with section 13 (P1a, P1b, P1c, P2a, P2b, P3, P4, P5, P6, P7, P8a, P8b, P9). P2b depends on RW5, P3 on RW6, P5 on RW6, P8b on P4. Row R13 (§13.6) uses section 2.5.
6. §13.3, row SP4: mark done with the date and link. Add the decisions PK1 to PK24 as T35 onward once the owner accepts them. Q15 (the frozen-contract version bump) gains `PACK_API` and the protocol 2 note of PQ7.
7. §14.1, risk 12: add the pointer to PACKS.md §5.4. Add two risks: a pack that fails to load or crashes the tab (section 8.4), and fragment drift (`fragment-drift`, section 5.2).
8. §15: replace "PACKS.md (SP4), not yet written" with a description of this document.
9. §3, T7: add that third-party FL-only vocabularies are not packs.

**RECIPES-1.2.md**

10. §8.4 and §12: "SP4 states it in PACKS.md" is now section 5.5. The `init` row of §12 becomes `packs?: readonly string[]` on `BakerInit` and `packs` on `InitInfo`, in the same protocol 2 bump. §14.3 gains `BakerInit.packs`, `InitInfo.packs`, `BakeOptions.deny`.
11. §8.5: add that `recipe.catalogue` is the core catalogue version, or absent (PK9), and that the baker drops `catalogue-mismatch`. *Applied.*

**RELIX.md**

12. §4.8, §4.9 and §15 (R2b): the generated file is `vocab/relix.fth`, not `vocab/relix-ops.fth` (PK23, PQ15).
13. §15, row R13: the manifest is section 2.5 of this document, and the worker hook is `WorkerPackHost.onBake` (section 4.5). `needsHardKill` and the version rule are as RECIPES-1.2 §19.1 (a) and section 5.5 here.
14. §16, item 12 ("SP4 / PACKS.md"): answered by sections 3.4, 4.5 and 2.3 (`notice`).

**UI.md (SP3)**

15. §4, rule 8: as item 4 above. Add a rule that pack viewers and helpers are lazy stubs until first use, and the `style-src` rule for pack chunks (section 3.4).
16. §3.4: the `packs` feature starts after `persist` and before `bake`. §3.7: the store gains the `packs` key. The privacy page says that the list of enabled packs is stored locally and never sent.
17. The pack manager dialog (section 7.2), the enable offer (section 7.4), the states of section 7.3, the capability sentences, and the share-dialog lines of section 7.5.

**PLAN.md**

18. §9: add the decisions of section 11 once approved. §7 gains the P rows of section 13.

**CLAUDE.md**

19. No change. `packs/*` is a new top-level directory. CLAUDE.md names `packages/*` as frozen and does not mention `packs/*`, which are new and not frozen once the owner approves this document.
