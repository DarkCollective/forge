# Recipes, operations and the bake host: Phase 2 specification, v1

Status: draft v1 (2026-11-09). Normative for Phase 2 (PLAN §7: WPs 2.1 to 2.5, Gate 2). It builds on
[LANGUAGE.md](LANGUAGE.md) (FL v0.1, frozen) and the principles in [PLAN.md](PLAN.md) §1, §3.6, §4, §5 and §10.
Type contracts: `packages/ops/src/types.ts`, `packages/recipe/src/types.ts`, `packages/worker/src/types.ts`.

> **Supersedes.** This document replaces LANGUAGE.md §14 ("Recipe compilation"), which is now a pointer here. Where the two
> differ (the header `( bytes -- any )`, the `recipe:as-bytes` normaliser, the compiled vocabulary), this document rules.

> **Project rule.** Forge is inspired by CyberChef but is **not compatible** with it. Every name, format and
> default in this document is Forge's own. Nothing here mirrors a CyberChef recipe format, operation name or URL.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## Contents

1. Overview and design decisions
2. Operations and the catalogue
3. Recipe JSON v1
4. The `regex` and `recipe` vocabularies
5. Recipe to FL compilation
6. The canonical text form
7. Share URL
8. The bake API (`@forge/worker`)
9. Op test vectors
10. Gate 2 and the seed operations
11. Work packages and file layout
12. Conformance examples

---

## 1. Overview and design decisions

Phase 2 turns the language into something a UI can drive:

```
 .fth + prims ──► runtime ──► catalogue.json ──► UI lists ops (no code loaded)
                     │
 recipe JSON ──► validate ──► compile ──► canonical FL text ──► load ──► run in a Worker ──► BakeResult
      ▲                                        │
      └──────── parse (restricted) ◄───────────┘          share URL = deflate(JSON)
```

Packages and who depends on whom (build order is also the root `build` script order):

| package | role | depends on |
|---|---|---|
| `@forge/lang` | FL runtime (Phase 1) | none |
| `@forge/ops` | vocabularies (`.fth` + TS primitives), catalogue, bundle loading | lang |
| `@forge/recipe` | recipe model, validation, compiler, text form, share URL. **Pure functions; it never creates an FL runtime** (it uses only `read` from `@forge/lang`, at run time, to tokenise literals) | lang |
| `@forge/worker` | `Baker`, the Worker protocol, client, watchdog, test-vector runner | lang, ops, recipe |
| `@forge/web` | the UI (Phase 3) | all |

`@forge/recipe` never creates a runtime. It works on the **catalogue** (JSON), which is how the UI can validate and
compile without loading any operation code.

### 1.1 Design decisions

| # | Decision | Why |
|---|---|---|
| R1 | A recipe is a **tree of steps discriminated by `kind`** (`op`, `fork`, `subsection`, `if`, `repeat`, `comment`). Objects are closed: unknown fields are errors. | Structural flow control (PLAN §3.6). A `kind` tag gives exhaustive TypeScript unions and a simple JSON Schema. Strictness makes hostile input easy to reject. |
| R2 | The seed encodings are **per-format vocabularies**: `base64:decode`, `base64:encode`, `hex:decode`, `hex:encode`. There is no `encoding` vocabulary. | `base64:decode` reads as a sentence and a recipe step reads like the FL it compiles to. A vocabulary is a namespace, not a UI category: the UI groups by `category` (`"Encodings"`), so a small vocabulary per format costs nothing. Names stay free of "from/to", which flips meaning with the point of view. |
| R3 | The compiled recipe word is `: main ( bytes -- any )`. Input is always `bytes`; the output is whatever the last step leaves. **Container steps (`fork`, `subsection`, `repeat`) work on and return `bytes`**; they begin with `recipe:as-bytes`. `if` returns what its branch returns. | Bytes are canonical (PLAN §1). Text is UTF-8 encoded exactly once, at the boundary, and the op's own declared input type (`str`, `bytes`) decides further coercion. |
| R4 | **One text, two roles.** The compiler's output *is* the canonical text form and the parser's input. Disabled steps are commented-out lines; breakpoints, notes and pins ride in `\ @…` trailing comments. The FL reader ignores comments, so the text still runs. | Round trip without a second format. |
| R5 | **FL text from a user is never loaded.** It is parsed by a restricted line parser into recipe JSON, validated, and recompiled. Only compiler output reaches `runtime.load`. | Pasted text and links cannot smuggle definitions or code (PLAN §5). |
| R6 | A `{value, enc}` renders as **a bare string (`utf8`), `#[ … ]` (`hex`), or a string followed by `recipe:latin1` / `recipe:base64`.** | The encoding survives the round trip, and the FL is explicit and runs without coercion records. |
| R7 | The compiler takes parameter **defaults from the catalogue** (`ParamSpec.default`). Two normal forms exist: `normalise` (catalogue-free, compact, used for URLs) and `canonical = normalise ∘ resolve` (all parameters explicit, used for text). | Defaults are metadata only (LANGUAGE §5.4). Links stay short; text is complete; identity is stated on the canonical form. |
| R8 | **Pinning**: an op step may carry the op's `hash`. A mismatch is a *warning* by default (`pins: "warn"`), an error under `"strict"`. | Meaning cannot drift silently (PLAN §3.3), but a rebuilt app must still open old links. |
| R9 | The **catalogue is derived from the loaded runtime's `WordMeta`**, with the op rule in §2.2. Its `version` is a content id (16 hex digits of SHA-256), never bumped by hand. | No hand-maintained registry. One metadata record per word (PLAN §1). |
| R10 | Vocabulary sources are **found by pattern** (`vocab/*.fth`, `src/prims/*.ts`), never listed. Node reads the file system; Vite uses `import.meta.glob`; both feed one scanner. **No Vite plugin is needed in v1.** A build script writes `dist/catalogue.json`. The Node loader is `loadBundleNode` (`@forge/ops/node`), the Vite loader `loadBundleVite` (`@forge/ops/vite`); the `@forge/ops` main entry has neither, so it stays free of `node:fs`. | Parallel WPs add files without touching a shared file. The same logic runs in Node tests, worker threads and the browser. |
| R11 | **Regexes use ECMAScript `RegExp` (always the `u` flag), with a hard time box: the Worker is killed by the watchdog.** There is no in-VM time-boxing in v1; untrusted recipes that use a regex run only on a baker with `hardKill`. Whether an op uses a regex is **computed from the loaded runtime** (`CatalogueOp.needsHardKill`), not listed by hand. All regex code goes through one seam (`regex-engine.ts`) so Phase 5 can swap in a bounded engine. | A synchronous `RegExp.test` cannot be interrupted (LANGUAGE §10.7). Linting for catastrophic patterns is unreliable and rejects legitimate ones. |
| R12 | Errors are attributed to recipe steps from **`ForgeError.frames`** and the step→ip map; coercions by VM step ordering. Progress, timing and breakpoints use `RunOptions.breakpoints` at each step's first instruction and the instruction after its last. | Negligible overhead (one hook call per step start/end, none per instruction); no instrumentation words in the compiled FL. |
| R13 | Share fragment: `#v=1&r=<m><payload>&i=<m><payload>&ie=<enc>`; `<m>` is `1` (deflate-raw) or `0` (stored); payload is base64url without padding. Limits on length and **inflated** size. | Short links stay short; a hostile fragment cannot expand without bound. |
| R14 | One bake at a time per `Baker`. Cancellation = `AbortController` (message) plus a per-bake `SharedArrayBuffer` flag when `crossOriginIsolated`; the **client watchdog terminates the Worker** after a grace period. | VM polling cannot stop a synchronous primitive (LANGUAGE §10.7); only termination can. |
| R15 | Bakes default to `trust: "untrusted"` with `UNTRUSTED_LIMITS`. Callers can only lower limits. | PLAN §5. Tests and the CLI opt into `"trusted"`. |
| R16 | Test vectors are JSON beside the vocabulary; the **runner lives in `@forge/worker`** (it needs the Baker, which depends on ops). The expectation form gains `{json}` for non-byte outputs (bool, list, record). | The Baker is downstream of ops in the build order. `regex:test` and `regex:find-all` cannot be expressed as bytes. |
| R17 | Bake errors reuse FL `ErrorCode`s. Four codes are added: `E_RECIPE_INVALID`, `E_NOT_READY`, `E_UNSAFE_HOST`, `E_PROTOCOL`. Cancellation is `E_ABORTED`; a watchdog kill is `E_ABORTED` or `E_LIMIT_TIME` with `terminated: true`. | Fewer concepts for the UI to render. |
| R18 | The `recipe` support vocabulary ships in **`@forge/ops`** (it needs the regex primitives) and is **internal**: it is never in the catalogue (`INTERNAL_VOCABS`). | `@forge/recipe` stays runtime-free. |
| R19 | `@forge/ops` gets a third type contract (`src/types.ts`) beyond the two the brief asked for. | Four WPs need `Catalogue` and `VocabBundle` on day one. |
| R20 | Gate 2's browser half is a Vite **harness page driven by Playwright** (added as a dev dependency by WP 2.4), plus a Node `worker_threads` run of the *same worker core*. | PLAN §6 introduces Playwright in Phase 3; Gate 2 needs a real Web Worker earlier. The harness is also usable by hand in the Browser pane. |
| R21 | Generic words (`disabled`, `breakpoint`, `fork`, `subsection`, `note`) and the four text encodings of `toggle`/`key` (`utf8 hex latin1 base64`) are kept: they are standard vocabulary, not CyberChef-specific names or formats. | Avoiding every shared English word would make Forge worse, not more original. |
| R22 | PLAN §3.6's "words hand-written outside the canonical subset appear as a single opaque step" is **deferred to Phase 3**. In Phase 2 text outside the canonical subset is a parse error. | The parser must never run arbitrary FL (R5); an opaque step needs a UI and a trust decision. |
| R23 | Compiled recipes are loaded into the internal vocabulary **`bake`** (word `bake:main`), never into `user`. User units cannot define into bundled or internal vocabularies (`E_READONLY`). | A user word can never collide with, shadow or replace the recipe word or an op. |
| R24 | `@forge/ops` exports no loader from its main entry. `createBakerCore` **requires** a `loadBundle`, so the same core runs in Node and in the browser. | No hidden `node:fs` in a browser bundle; no hidden default. |

---

## 2. Operations and the catalogue

### 2.1 Words, ops, vocabularies

A **vocabulary** is a wordlist (LANGUAGE §6). In `@forge/ops` each vocabulary is made of up to two files:

- `packages/ops/vocab/<vocab>.fth`, **one source unit**, optional. It starts with `IN: <vocab>`. It holds FL words
  (colon definitions) and `META:` blocks, including `META:` blocks that add parameter help to primitives.
- `packages/ops/src/prims/<vocab>.ts`, **TypeScript primitives**, optional. It exports `primitives: PrimitiveDef[]`.

A vocabulary needs at least one of the two. The vocabulary name is the file name without extension and MUST be a
`vocab-name` (LANGUAGE §2.11), not `core` and not `user`.

### 2.2 What makes an FL word an operation

`WordMeta.op` is true for a public colon word or primitive outside `core` with at least one input (LANGUAGE §5.7).
**A word is listed in the catalogue** (it is an *op* as far as recipes and the UI are concerned) iff all of these hold:

1. `meta.op` is true, and `meta.exported` is true (so it is public).
2. `meta.vocab` is not in `INTERNAL_VOCABS` (`["recipe", "bake"]`).
3. `meta.kind` is `"fl"` or `"primitive"`.
4. Every parameter has a type in `UI_PARAM_TYPES`: `bytes str int num number bool choice toggle regex charset key`.
   (No `any list quot record file` parameters.)
5. The effect is checked and has exactly one output: `outputs.length === 1`, `unchecked === false`,
   `variadicInput === false`.
6. It is the canonical entry: `meta.qname === vocab + ":" + meta.name`. Aliases (extra names for the same entry)
   are listed under `aliases` and never as ops of their own.

**Chainable** (defined once, used everywhere): an op is *chainable* iff it is a catalogue op. A recipe `op` step or op test may name only chainable ops.

A word that fails 2 to 5 is simply not an op; that is not an error (except the missing `doc`/`category` case of §2.4). The recipe words (`recipe:section`, which takes a
`quot`) fail rule 2 and rule 4.

The **data input** of an op is `effect.inputs[0]`; parameters are the remaining inputs (`meta.params`). A recipe step
supplies the data from the previous step and the parameters as literals.

### 2.3 The catalogue

`dist/catalogue.json` is generated at build time from the **loaded runtime**, so it cannot disagree with the code.
Types: `Catalogue` and `CatalogueOp` in `packages/ops/src/types.ts`.

```jsonc
{
  "format": 1,
  "version": "5b1c9e7f02a4d3c8",      // see below
  "vocabs": ["base64", "classical", "hex", "regex", "text"],
  "ops": [
    {
      "qname": "classical:rot",
      "name": "rot",
      "vocab": "classical",
      "category": "Classical ciphers",
      "doc": "Rotate each ASCII letter by a fixed amount; other bytes pass through.",
      "aliases": ["rot13"],
      "seeAlso": ["classical:atbash"],
      "input": "bytes",
      "output": "bytes",
      "effect": "( bytes amount:int[0..25]=13 -- bytes )",
      "params": [
        { "name": "amount", "type": "int", "index": 1, "required": false,
          "constraint": { "min": 0, "max": 25 }, "default": 13, "doc": "Shift (13 = ROT13)" }
      ],
      "effects": [],
      "version": "1",
      "hash": "<64 lowercase hex digits>",
      "needsHardKill": false
    }
  ]
}
```

Rules:

- `ops` is sorted by `qname` in code-point order, `vocabs` likewise. Key order inside an op is exactly the order of
  `CatalogueOp`. `params` is `WordMeta.params` unchanged. `input`/`output` are `inputs[0].type` / `outputs[0].type`.
- `vocabs` lists exactly the vocabularies that have at least one entry in `ops`.
- `needsHardKill` (R11) is computed by `buildCatalogue`: it is true iff the op, or any word reachable from it through
  `CompiledWord.deps` (transitively, FL words only), is a regex-engine primitive (`isRegexPrimitive(qname)`, §4.1).
- `version` is the first 16 hex digits of `sha256(JSON.stringify(ops))` (the `sha256` exported by `@forge/lang`, UTF-8).
  Changing any op's name, doc, signature or hash changes it. Recipes record it as `catalogue` (§3.1).
- The catalogue does **not** contain source text or `source`. It is a projection of `WordMeta`, not a copy.

`buildCatalogue(runtime, { bundleVocabs?, warn? }): Catalogue` algorithm: for each vocabulary in `runtime.dictionary.vocabs()` other
than `core` and `INTERNAL_VOCABS` (these are skipped outright, never inspected); for each name in `listWords(runtime.dictionary, vocab)`; let
`meta = runtime.meta(vocab + ":" + name)`; keep it iff §2.2 holds; if it lacks `doc` or `category`, **throw** when `vocab` is a
bundle vocabulary, otherwise (a user unit) skip it and call `warn`; compute `needsHardKill`; project; sort; hash. The function works on any
runtime, so Phase 3 can rebuild a catalogue after the user defines a word in `user` (a promoted recipe appears like
any other op).

**JSON Schema** (`packages/ops/src/catalogue.schema.json`, draft 2020-12). It references the `WordMeta` schema
(`WORD_META_SCHEMA` from `@forge/lang`, which MUST be added to the Ajv instance first):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:forge:schema:catalogue:1",
  "title": "Forge operation catalogue, format 1",
  "type": "object",
  "properties": {
    "format": { "const": 1 },
    "version": { "type": "string", "pattern": "^[0-9a-f]{16}$" },
    "vocabs": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$" },
      "uniqueItems": true
    },
    "ops": { "type": "array", "items": { "$ref": "#/$defs/op" } }
  },
  "required": ["format", "version", "vocabs", "ops"],
  "additionalProperties": false,
  "$defs": {
    "op": {
      "type": "object",
      "properties": {
        "qname": {
          "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/qname"
        },
        "name": {
          "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/wordName"
        },
        "vocab": {
          "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/vocabName"
        },
        "category": { "type": ["string", "null"], "maxLength": 200 },
        "doc": { "type": ["string", "null"], "maxLength": 2000 },
        "aliases": {
          "type": "array",
          "items": {
            "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/wordName"
          },
          "uniqueItems": true
        },
        "seeAlso": {
          "type": "array",
          "items": {
            "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/qname"
          },
          "uniqueItems": true
        },
        "input": {
          "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/paramType"
        },
        "output": {
          "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/paramType"
        },
        "effect": { "type": "string", "maxLength": 4000 },
        "params": {
          "type": "array",
          "items": {
            "$ref": "https://forge.darkcollective.com/schemas/word-meta.schema.json#/$defs/param"
          }
        },
        "effects": {
          "type": "array",
          "items": { "enum": ["+async", "+random", "+time"] },
          "uniqueItems": true
        },
        "version": { "type": "string", "maxLength": 200 },
        "hash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "needsHardKill": { "type": "boolean" }
      },
      "required": [
        "qname",
        "name",
        "vocab",
        "category",
        "doc",
        "aliases",
        "seeAlso",
        "input",
        "output",
        "effect",
        "params",
        "effects",
        "version",
        "hash",
        "needsHardKill"
      ],
      "additionalProperties": false
    }
  }
}
```

### 2.4 Vocabulary sources: layout, rules, scanner

**`.fth` rules.** Each unit:

1. contains exactly one `IN:` and it names the file's vocabulary; it contains no `VOCAB`;
2. does not use `PRIMITIVE` (all primitives of the bundle are already bound by `createRuntime`, LANGUAGE §5.11);
3. is definitions only (LANGUAGE §9);
4. reaches other vocabularies by `USING:` or `vocab:word` only, never by loading order assumptions;
5. gives every public word a header, and (outside internal vocabularies) a `doc` and a `category`; `buildCatalogue`
   throws for a bundle op that lacks either (and only warns for user vocabularies);
6. uses `META:` for `param` help, `alias` and `see-also`.

**Primitive modules.** `src/prims/<vocab>.ts` has `export const primitives: readonly PrimitiveDef[]`. Every def has
`vocab` equal to the file name. Rules:

- Follow LANGUAGE §10.5 (pure: never mutate an argument, never return an alias of one) and §4.4 (plain JS payloads).
  A primitive whose output slot is `list` returns an array of **tagged `Value`s** (build them with `valueHelpers` from
  `@forge/lang`: a record element is `{ tag: "record", v: Map }`), and a `record` output is a `Map<string, Value>`.
- Always give `doc` and `category`. Param help comes from `META:` in the `.fth` (a `PrimitiveDef` has no per-param doc).
- Bump `version` (default `"1"`) when behaviour changes. The hash of a primitive covers its header and `version` only,
  **not** its TypeScript body (LANGUAGE §12.4), so the version is what makes pins notice a behaviour change.
- Failures: a decoding failure is `ForgeError` `E_COERCE` (the precedent is `hex>bytes`, LANGUAGE §13.5); a bad
  argument value is `E_RANGE`; oversize results are checked by the VM.
- No imports of Node or DOM APIs. Heavy dependencies sit behind dynamic `import()` inside the module (PLAN §3.5).

**Scanner** (`scanVocab`, a pure function over `SourceFile[]` and the list of primitive-module names, in `src/scan.ts`):

1. For each `*.fth`: strip nothing; call `read(source)` from `@forge/lang` (a lexical error fails the scan with the
   file name). Check the rules above that are checkable from tokens (1, 2, and that every `qword`/`USING:` vocabulary
   exists).
2. `deps(unit)` = (names listed in `USING:` forms) ∪ (the `vocab` of every `qword` token), minus `core` and the unit's own
   vocabulary, sorted by code point. A dependency MUST be a vocabulary that has a `.fth` or a primitive module,
   else the scan fails (`unknown vocabulary 'x' used by y.fth`).
3. Order the units by dependency (Kahn's algorithm, ties broken by vocabulary name in code-point order). A cycle fails
   the scan and the message lists the cycle.
4. Vocabularies that have only a primitive module need no ordering: all primitives are bound before any unit loads.

**Providers.** `VocabSourceProvider` (types.ts) finds the files:

- `src/sources-node.ts` (entry `@forge/ops/node`; exports `createNodeProvider(root?)` and `loadBundleNode`): lists
  `vocab/*.fth` with `node:fs`, and loads primitive modules by dynamic `import()` of the files in the `prims/` directory next to
  the module. **Which extension:** the provider looks at the extension of its own `import.meta.url`: `.ts` (running from `src/`
  under Vitest) selects `prims/*.ts`; `.js` (running from `dist/`) selects `prims/*.js`. Files matching `*.d.ts` and
  `*.test.*` are always excluded. `root` defaults to the package root (`..` from `src/` or `dist/`).
- `src/sources-vite.ts` (entry `@forge/ops/vite`; exports `createViteProvider()` and `loadBundleVite`):
  `import.meta.glob("../vocab/*.fth", { query: "?raw", import: "default", eager: true })` and the lazy
  `import.meta.glob(["./prims/*.{ts,js}", "!./prims/*.d.ts", "!./prims/*.test.*"])`. Primitive modules therefore become lazy chunks
  (PLAN §4: op modules are lazy). The globs list both extensions so the same file works whether Vite reads `src/` or `dist/`;
  both vocab and prims paths are relative to the file, which sits next to `vocab/` (one level up) in both trees.
  **Making it work from the pre-built package:** `package.json` maps `"./vite"` to the **built** file `./dist/sources-vite.js`
  (types: `./dist/sources-vite.d.ts`) and `files` ships `src`, `dist` and `vocab`. Vite treats a workspace-linked package as source,
  so `import.meta.glob` (left intact by `tsc`) is transformed by Vite itself and the globs resolve against `dist/prims/*.js`. It must
  not map to `src/`: the primitive modules would then import `src/regex-engine.ts`, a second copy of the module whose registry
  of regex primitives (`needsHardKill`) `dist/catalogue.js` never sees, and the browser catalogue (and its `version`) would differ
  from the build-time one. The Gate 2 browser harness is the
  test that this works in a real Vite build (G2-5), and a unit test imports `@forge/ops/vite` under Vitest.

`createBundleLoader(provider)` returns `loadBundle(names?)`: it scans once, then returns, for the requested
vocabularies plus their transitive dependencies, a `VocabBundle`: names sorted, units in dependency order, and the
primitives of every included vocabulary (primitive modules are imported on demand, so asking for `["hex"]` never
loads the regex engine). Asking for the `recipe` vocabulary brings `regex` and `base64` with it, because `recipe.fth`
references them. **The Baker always requests `recipe`** in addition to what the caller asked for (§8.2), so
`InitInfo.vocabs` is the full closure.

### 2.5 Runtime assembly

`assembleRuntime(bundle, options?)`:

1. `rt = createRuntime({ primitives: bundle.primitives, limits: options.limits })`. This binds every primitive into
   its vocabulary (creating it) and `core`.
2. For each `unit` of `bundle.units`, in order: `rt.load(unit.source, { unit: unit.name, trusted: false })`. A
   `ForgeError` is rethrown with the unit name prefixed to the message; assembly is all-or-nothing from the caller's
   point of view.
3. For each extra unit (`options.units`, user vocabularies), the same, `trusted: false`, but **first** the unit's source is read
   with `read()` and every `IN:` form is checked: if it names a bundle vocabulary, an internal vocabulary or `core`, assembly
   fails with a `ForgeError` `E_READONLY` (`detail.vocab`) before the unit is loaded (R23). A unit may define into `user` or a
   new vocabulary. (A user unit cannot hide an `IN:` from this check: `IN:` is a reserved word token.)

**Load order and dependencies.** Primitives first, then units by dependency order. A unit may therefore call any
primitive of any bundled vocabulary and any word of a unit that precedes it.

`trusted: false` everywhere: bundled `.fth` units need no `PRIMITIVE` and no write to `core`, and the same code path
loads user units.

### 2.6 Build

`npm run build -w @forge/ops` = `tsc -p tsconfig.build.json`, then `tsc -p tsconfig.scripts.json`, then
`node dist-scripts/catalogue.js`, which: creates `createNodeProvider()`, calls `loadBundleNode("all")`, `assembleRuntime`,
`buildCatalogue`, validates the result against `catalogue.schema.json`, and writes `dist/catalogue.json` and a copy of the
schema. Failures (scan errors, a `.fth` that does not compile, schema violations) fail the build with a message that
names the file. `package.json` exports `.`, `./node`, `./vite`, `./catalogue.json` and `./catalogue.schema.json`; `files` is
`["dist", "src", "vocab"]`.

The UI imports the catalogue as an asset (`import url from "@forge/ops/catalogue.json?url"`, fetched lazily; allowed by
`connect-src 'self'`, PLAN §10) and lists ops from it without loading any vocabulary code.

---

## 3. Recipe JSON v1

Types: `packages/recipe/src/types.ts`. The accept/reject behaviour of the JSON Schema in §3.9 and of the reference
validator (§3.7) MUST agree on every structural question; the validator additionally knows the catalogue and
produces precise issues.

### 3.1 The document

```jsonc
{
  "forge": 1,                      // recipe format version. Required. Must be the integer 1.
  "name": "Decode blob",           // optional, at most 120 characters
  "description": "…",              // optional, at most 2000 characters
  "catalogue": "5b1c9e7f02a4d3c8", // optional: Catalogue.version the recipe was created with
  "steps": [ /* Step[] */ ]        // required
}
```

No other keys. `name`, `description` and `catalogue` are metadata and never affect baking. A recipe with a different
`catalogue` than the one in use is valid and produces a `catalogue-mismatch` warning; the real safeguard is per-step
pinning (§3.10).

### 3.2 Steps

Every step is an object with a string `kind`. Common optional fields on every kind except `comment`:
`disabled` (boolean), `breakpoint` (boolean), `note` (string, at most 500 characters).

**`op`** — run one operation.

```jsonc
{ "kind": "op", "op": "classical:rot", "params": { "amount": 13 }, "hash": "<64 hex>",
  "disabled": false, "breakpoint": false, "note": "…" }
```

`op` is the canonical qualified name (§2.3); an alias is accepted by the validator with an `alias-used` warning and
rewritten by `resolve`. `params` maps parameter names (`^[a-z][a-z0-9-]{0,63}$`) to values (§3.4); omitted parameters
take the catalogue default (§3.5). `hash` is the pin (§3.10).

**`fork`** — split the data, run the children on each piece, join the results.

```jsonc
{ "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "0a", "enc": "hex" },
  "steps": [ /* Step[] */ ] }
```

`split` and `join` are `{value, enc}` (no string shorthand). Semantics are exactly those of the core `fork`
combinator (LANGUAGE §8): `split` MUST decode to a non-empty byte string (else `bad-value`), empty data gives one empty
piece, a trailing separator gives a trailing empty piece. Each piece goes through the children in order and the result
(coerced to `bytes`) is joined with `join`.

**`subsection`** — run the children only on the regex matches; leave the rest of the data alone.

```jsonc
{ "kind": "subsection", "pattern": "[a-z]+", "flags": "i", "encoding": "utf8", "steps": [ /* Step[] */ ] }
```

`pattern` is an ECMAScript regex (§4.1), at most 1024 code points. `flags` is any of `i`, `m`, `s` (default none).
`encoding` is `utf8` (default; the data must be well-formed UTF-8, else `E_COERCE`) or `latin1` (each byte is one
character, never fails). Matches are found left to right and do not overlap. **Empty matches are skipped** (left
untouched, never passed to the children). Each non-empty match, as bytes, goes through the children and the result
(coerced to `bytes`) replaces it; the text between matches is copied unchanged. The step returns `bytes`.

**`if`** — branch on the current data.

```jsonc
{ "kind": "if", "test": { "kind": "regex", "pattern": "^o", "flags": "", "encoding": "utf8" },
  "then": [ /* Step[] */ ], "else": [ /* Step[] */ ] }
{ "kind": "if", "test": { "kind": "op", "op": "regex:test", "params": { "pattern": "^o" } }, "then": [ … ] }
```

The test sees a copy of the data and leaves it unchanged. A **regex test** is true iff the pattern matches anywhere in
the data (read as `encoding`). An **op test** runs a *predicate op*: an op whose `output` is `bool` (otherwise
`not-predicate`) and that is chainable (§2.2). `else` may be omitted (the data passes through unchanged). The step
returns whatever the chosen branch returns, which may be any type.

**`repeat`** — run the children several times, feeding each result to the next iteration.

```jsonc
{ "kind": "repeat", "times": 3, "steps": [ … ] }
{ "kind": "repeat", "until": "stable", "max": 50, "steps": [ … ] }
```

Exactly one of `times` (integer 1 to 1000) and `until` (`"stable"`) is present. `max` (1 to 1000, default 100) goes with
`until` only. `times: n` runs the children `n` times. `until: "stable"` runs the children, and stops when the result
equals its input (bytes equality) or after `max` iterations; the result of the last iteration is the output. The step
returns `bytes`. The caps are hard limits (`RECIPE_LIMITS.maxRepeat`).

**`comment`** — a note in the recipe. `{ "kind": "comment", "text": "…" }` (at most 2000 characters). No other fields.
It compiles to a comment line (§5) and has no effect.

Disabled steps: `disabled: true` on a container disables all its children too. A disabled step still has to be valid
(§3.7), and keeps its position in the tree so JSON-pointer paths do not move.

### 3.3 Data flow

The first step receives the input as `bytes`. Each step receives the value the previous step left (any tag) and the
runtime coerces it to the op's declared data-input type at the word boundary (LANGUAGE §4: `str`↔`bytes` only). So
`hex:encode` (returns `str`) can feed `classical:rot` (takes `bytes`). A tag with no coercion path is a runtime `E_TYPE`
at that step, not a validation error. Container steps convert their input with `recipe:as-bytes` (R3), so a `list` or
`record` entering a `fork` is an `E_TYPE` at the container.

An op used as a step MUST be chainable (§2.2: a catalogue op). The validator sees only the catalogue, so any other name
(an internal word, an unknown word, a word that fails a rule of §2.2) is `unknown-op`.

### 3.4 Parameter values

The JSON value of a parameter depends on its `ParamSpec.type`:

| type | JSON value | notes |
|---|---|---|
| `int` | a safe integer, or a canonical decimal string `^-?(0\|[1-9][0-9]*)$` for larger values (no leading zeros, no `-0`, no `+`) | normal form is the number whenever it is a safe integer; `"007"` is `bad-param` |
| `num` | a finite number | FL gets a float literal |
| `number` | a finite number | an integer-valued JSON number is an `int` in FL, any other a `num` |
| `str` | a string | well-formed UTF-16 (no lone surrogates) |
| `bool` | `true` / `false` | |
| `choice` | one of `ParamSpec.options` | case-sensitive |
| `regex` | a string | at most 1024 code points; MUST compile as `new RegExp(source, "u")`; a violation is **`bad-regex`** (not `bad-param`) |
| `charset` | a string | non-empty, no repeated code point |
| `bytes` | a hex string: pairs of hex digits, whitespace allowed | normal form: lowercase, no whitespace |
| `toggle`, `key` | `{ "value": string, "enc": "utf8" \| "hex" \| "latin1" \| "base64" }` | `enc` MUST be one of `ParamSpec.options` (bare `toggle`/`key` allow all four) |

**Encoded values** (`{value, enc}`; also `split`/`join` of a fork):

| `enc` | `value` is | normal form |
|---|---|---|
| `utf8` | any well-formed string | unchanged |
| `hex` | hex digit pairs; ASCII whitespace ignored | lowercase, no whitespace |
| `latin1` | a string of code points ≤ U+00FF | unchanged |
| `base64` | standard base64 (RFC 4648 §4), padding optional, whitespace ignored | padded, no whitespace |

An invalid `value` for its `enc` is `bad-encoding`, at the path of `value`. An encoded value decodes to bytes by the
obvious rule (`utf8` = UTF-8 encoding). Constraints (`min`, `max`, `oneOf`, the length forms) are checked
statically against the *decoded* value: byte length for `bytes`/`toggle`/`key`, code points for `str`/`charset`. A
violation is `bad-param` with `detail.constraint` the canonical constraint text (e.g. `"[0..25]"`). `pattern`
constraints are **not** checked statically (a regex on untrusted text could be slow on the main thread); the VM
checks them in the Worker.

Key parameters (`type: "key"`) hold secrets; **`toggle` is not secret**. The validator treats both alike; `encodeShare` warns about
`key` values (§7.4). **UI contract:** the input, `toggle` values and `key` literals are written in the clear into share links
(§7) and into the text form (§6); the UI must say so before creating either.

### 3.5 Omitted parameters and defaults

A parameter missing from `params` takes `ParamSpec.default` from the catalogue **at compile or resolve time**. If it
has no default (`required: true`) the issue is `missing-param`, at the path where the parameter would be
(`/steps/0/params/pattern`). A name in `params` that is not a parameter of the op is `unknown-param`. `null` is never
a valid value.

Defaults have exactly the JSON shape of §3.4 (`ParamDefault`): a `bytes` default is hex, a `toggle`/`key` default is
`{value, enc}`, a `choice` default is the option string.

### 3.6 Normal forms

Three functions, all total on valid recipes, pure, and idempotent:

**`normalise(recipe)`**, catalogue-free. Used before encoding a URL.

1. Keys are written in this order. Recipe: `forge name description catalogue steps`. Steps: `kind` first, then
   `op params hash` (op), `split join steps` (fork), `pattern flags encoding steps` (subsection),
   `test then else` (if), `times until max steps` (repeat), `text` (comment), then `disabled breakpoint note` on
   every kind but `comment`. Test objects: `kind op params hash` or `kind pattern flags encoding`. `params` keys are
   sorted by code point. Encoded objects: `value enc`.
2. These are omitted: `disabled: false`, `breakpoint: false`, empty `note`, `name` or `description`, `params: {}`,
   `flags: ""`, `encoding: "utf8"` (of a subsection or a regex test), `else: []`, and `max` equal to 100.
3. `flags` is rewritten as the unique characters of `ims` in that order (`"mi"` becomes `"im"`).
4. Every `{value, enc}` object (recognised by shape, so also inside `params`) gets its `value` normalised per §3.4.

It adds nothing: `params` stay as the author wrote them.

**`resolve(recipe, catalogue)`**:

1. `op` aliases are replaced by the canonical `qname` (also in `if` tests).
2. Every parameter of every op step and op test is made explicit: the given value, else the default. Values are
   normalised according to the **parameter's type** (a `bytes` hex string is normalised although it has no `enc`; an
   `int` given as a decimal string that fits a safe integer becomes a number). `params` keys end up in `ParamSpec`
   order, and `params` is present exactly when the op has parameters.
3. Nothing else changes. In particular `hash` pins are kept (see `pinRecipe`).

**`canonical(recipe, catalogue) = resolve(normalise(recipe), catalogue)`**: all parameters explicit, in `ParamSpec`
order, everything else in `normalise` form. This is the form the text parser returns, and the form the identity of
§6.5 is stated on. It is idempotent.

`pinRecipe(recipe, catalogue)` sets `hash` on every op step and op test from the catalogue (overwriting).

### 3.7 Issues and validation

`validateRecipe(input: unknown, catalogue?, { pins }) → { ok: true, recipe, issues } | { ok: false, issues }`. Never
throws, for any input. `ok` is true iff no issue has severity `error`; `recipe` is the input, typed.

**Traversal safety (untrusted input).** Every walk of the input is either iterative or bounded by an already-checked depth, and
limits are checked *before* any recursive walk:

1. An **iterative pre-walk** (explicit stack, no recursion) over the value counts nodes, string bytes and raw nesting depth with a
   budget. Exceeding `maxJsonBytes`, `maxSteps`-scale node counts, or `RECIPE_LIMITS.maxJsonDepth` (64) stops the pre-walk with one
   `limit` issue and nothing else is checked. Cycles and getters are handled by the same walk (an object seen twice on the
   current path is a `limit` issue; accessor properties are not invoked: only data properties are read, via
   `Object.getOwnPropertyDescriptor`).
2. Only then do the recursive checks run, bounded by `maxDepth` (8) container levels. (The raw depth cap 64 is above the 8 container
   levels × 3 JSON levels per level, plus params and tests.)
3. The same holds for `normalise`, `resolve`, `compile` and the text parser (the latter has an explicit stack, §6.3).

**Own-property rule.** Parameter, field and option lookups use `Object.hasOwn` (or copy into a `Map` first); never `in`, never
`obj[name]` on an unchecked name. `__proto__`, `constructor` and every key not matching the name patterns are rejected before use.

An **issue**: `{ code, severity, path, message, detail? }`. `path` is an RFC 6901 JSON pointer into the recipe
(`~` is `~0`, `/` is `~1`); `""` is the root. It points at the offending value, or at where a missing value would
be (`required`, `missing-param`). Messages are plain text and MUST NOT include more than 80 characters of any
user-supplied value.

| code | severity | when | `detail` |
|---|---|---|---|
| `type` | error | wrong JSON type | `expected` |
| `required` | error | a required field is missing | `field` |
| `unknown-field` | error | a key the object does not have | `field` |
| `bad-version` | error | `forge` is not `1` | `value` |
| `bad-kind` | error | `kind` is missing or not one of the six | `value` |
| `bad-value` | error | a structural constraint fails: enum, pattern, range, `maxLength`, an empty `split`, a lone surrogate | `constraint` |
| `exclusive` | error | a `repeat` without exactly one of `times`/`until`, or `max` without `until` | |
| `limit` | error | `RECIPE_LIMITS` exceeded: too many steps, too deep, too much JSON | `limit`, `max` |
| `unknown-op` | error | `op` is not in the catalogue (also not as an alias) | `op` |
| `not-predicate` | error | an `if` op test whose `output` is not `bool` | `op`, `output` |
| `unknown-param` | error | a `params` key that is no parameter | `param` |
| `missing-param` | error | a required parameter is absent | `param` |
| `bad-param` | error | wrong shape for the type, not an option, `enc` not allowed, or a constraint is violated | `param`, `reason`, `constraint?` |
| `bad-encoding` | error | an encoded `value` is invalid for its `enc` | `enc` |
| `bad-regex` | error | **any** regex: a `subsection`/`if` pattern or flags, or a parameter of type `regex`, that is too long (> 1024 code points), has bad flags, or does not compile | `reason` |
| `hash-mismatch` | warning (error if `pins: "strict"`) | a pin differs from the catalogue hash | `expected`, `actual` |
| `alias-used` | warning | `op` is an alias | `op`, `canonical` |
| `catalogue-mismatch` | warning | `recipe.catalogue` is set and differs from `catalogue.version` | `recipe`, `current` |
| `secret-in-url` | warning | emitted only by `encodeShare` (§7.4): a `key` parameter would be put in a link | `param` |

Limits are checked first, on the whole input, so a hostile document costs a bounded amount of work. Structural
checks run before catalogue checks, and catalogue checks only run on structurally valid steps. All issues of one
pass are reported (the validator does not stop at the first), up to 100; the 101st is a `limit` issue.

### 3.8 Limits (`RECIPE_LIMITS`)

| limit | value |
|---|---|
| steps in the whole tree | 500 |
| container nesting depth (defined below) | 8 |
| raw JSON nesting depth (pre-walk) | 64 |
| JSON size (UTF-8 bytes of `JSON.stringify`) | 262 144 |
| params per step | 32 |
| `name` / `description` / `note` / comment `text` | 120 / 2000 / 500 / 2000 characters |
| regex source | 1024 code points |
| `repeat.times` and `repeat.max` | 1000 (default `max` 100) |

### 3.9 JSON Schema

`packages/recipe/src/recipe.schema.json` (draft 2020-12). **Use Ajv as `import Ajv2020 from "ajv/dist/2020"`** (plain `ajv` is
draft-07), with `strict: true`. Ajv is **test-only**: it compiles schemas with `new Function`, which the production CSP
forbids (PLAN §10), so the runtime validator is hand-written and the schema is its executable specification (§11.3 item 5).

What is in the schema and what is validator-only:

| in the schema | validator-only |
|---|---|
| shape and types; `kind` discrimination; closed objects; required fields | lone surrogates in any string |
| `forge` const; `repeat` exactly-one-of `times`/`until` and `max` needs `until` | `{value, enc}` syntax per `enc` (hex digits, base64, latin1 range) |
| string `maxLength`s; the `flags` pattern `^[ims]*$`; `hash` pattern; name patterns; `params` key pattern | `split` decoding to non-empty bytes (the schema only requires `split.value` to have `minLength: 1`) |
| `steps` `maxItems` 500; `repeat` ranges 1 to 1000; `split.value` `minLength: 1` | total step count, container depth, JSON size, raw depth |
| | regexes compile (`bad-regex`); parameter checks against the catalogue; ops exist; pins; aliases |

A document the schema rejects, the validator rejects. The converse is not required (the validator is stricter).

**Depth, defined.** The *depth* of a step is the number of step lists it is inside: a step in the root `steps` list has depth 1; a child of
that step's `steps` (or `then`/`else`) has depth 2, and so on. `maxDepth` is the largest allowed depth of any step: 8. Example: in
`steps[0].steps[0].steps[0]` the innermost step has depth 3.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:forge:schema:recipe:1",
  "title": "Forge recipe, version 1",
  "type": "object",
  "properties": {
    "forge": { "const": 1 },
    "name": { "type": "string", "maxLength": 120 },
    "description": { "type": "string", "maxLength": 2000 },
    "catalogue": { "type": "string", "pattern": "^[0-9a-f]{16}$" },
    "steps": { "$ref": "#/$defs/steps" }
  },
  "required": ["forge", "steps"],
  "additionalProperties": false,
  "$defs": {
    "steps": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/step" } },
    "step": {
      "type": "object",
      "oneOf": [
        { "$ref": "#/$defs/opStep" },
        { "$ref": "#/$defs/forkStep" },
        { "$ref": "#/$defs/subsectionStep" },
        { "$ref": "#/$defs/ifStep" },
        { "$ref": "#/$defs/repeatStep" },
        { "$ref": "#/$defs/commentStep" }
      ]
    },
    "common": {
      "type": "object",
      "properties": {
        "disabled": { "type": "boolean" },
        "breakpoint": { "type": "boolean" },
        "note": { "type": "string", "maxLength": 500 }
      }
    },
    "qname": {
      "type": "string",
      "maxLength": 193,
      "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}:[^\\s:]{1,128}$"
    },
    "hash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "encoding": { "enum": ["utf8", "hex", "latin1", "base64"] },
    "encoded": {
      "type": "object",
      "properties": { "value": { "type": "string" }, "enc": { "$ref": "#/$defs/encoding" } },
      "required": ["value", "enc"],
      "additionalProperties": false
    },
    "paramValue": {
      "oneOf": [
        { "type": "number" },
        { "type": "string" },
        { "type": "boolean" },
        { "$ref": "#/$defs/encoded" }
      ]
    },
    "params": {
      "type": "object",
      "maxProperties": 32,
      "propertyNames": { "pattern": "^[a-z][a-z0-9-]{0,63}$" },
      "additionalProperties": { "$ref": "#/$defs/paramValue" }
    },
    "regexSource": { "type": "string", "maxLength": 1024 },
    "regexFlags": { "type": "string", "maxLength": 3, "pattern": "^[ims]*$" },
    "sectionEncoding": { "enum": ["utf8", "latin1"] },
    "opStep": {
      "type": "object",
      "allOf": [{ "$ref": "#/$defs/common" }],
      "properties": {
        "kind": { "const": "op" },
        "op": { "$ref": "#/$defs/qname" },
        "params": { "$ref": "#/$defs/params" },
        "hash": { "$ref": "#/$defs/hash" },
        "disabled": true,
        "breakpoint": true,
        "note": true
      },
      "required": ["kind", "op"],
      "additionalProperties": false
    },
    "forkStep": {
      "type": "object",
      "allOf": [{ "$ref": "#/$defs/common" }],
      "properties": {
        "kind": { "const": "fork" },
        "split": { "$ref": "#/$defs/encodedNonEmpty" },
        "join": { "$ref": "#/$defs/encoded" },
        "steps": { "$ref": "#/$defs/steps" },
        "disabled": true,
        "breakpoint": true,
        "note": true
      },
      "required": ["kind", "split", "join", "steps"],
      "additionalProperties": false
    },
    "subsectionStep": {
      "type": "object",
      "allOf": [{ "$ref": "#/$defs/common" }],
      "properties": {
        "kind": { "const": "subsection" },
        "pattern": { "$ref": "#/$defs/regexSource" },
        "flags": { "$ref": "#/$defs/regexFlags" },
        "encoding": { "$ref": "#/$defs/sectionEncoding" },
        "steps": { "$ref": "#/$defs/steps" },
        "disabled": true,
        "breakpoint": true,
        "note": true
      },
      "required": ["kind", "pattern", "steps"],
      "additionalProperties": false
    },
    "ifTest": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": { "const": "regex" },
            "pattern": { "$ref": "#/$defs/regexSource" },
            "flags": { "$ref": "#/$defs/regexFlags" },
            "encoding": { "$ref": "#/$defs/sectionEncoding" }
          },
          "required": ["kind", "pattern"],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": { "const": "op" },
            "op": { "$ref": "#/$defs/qname" },
            "params": { "$ref": "#/$defs/params" },
            "hash": { "$ref": "#/$defs/hash" }
          },
          "required": ["kind", "op"],
          "additionalProperties": false
        }
      ]
    },
    "ifStep": {
      "type": "object",
      "allOf": [{ "$ref": "#/$defs/common" }],
      "properties": {
        "kind": { "const": "if" },
        "test": { "$ref": "#/$defs/ifTest" },
        "then": { "$ref": "#/$defs/steps" },
        "else": { "$ref": "#/$defs/steps" },
        "disabled": true,
        "breakpoint": true,
        "note": true
      },
      "required": ["kind", "test", "then"],
      "additionalProperties": false
    },
    "repeatStep": {
      "type": "object",
      "allOf": [{ "$ref": "#/$defs/common" }],
      "properties": {
        "kind": { "const": "repeat" },
        "times": { "type": "integer", "minimum": 1, "maximum": 1000 },
        "until": { "const": "stable" },
        "max": { "type": "integer", "minimum": 1, "maximum": 1000 },
        "steps": { "$ref": "#/$defs/steps" },
        "disabled": true,
        "breakpoint": true,
        "note": true
      },
      "required": ["kind", "steps"],
      "oneOf": [
        { "type": "object", "properties": { "times": true }, "required": ["times"] },
        { "type": "object", "properties": { "until": true }, "required": ["until"] }
      ],
      "dependentSchemas": {
        "max": { "type": "object", "properties": { "until": true }, "required": ["until"] }
      },
      "additionalProperties": false
    },
    "commentStep": {
      "type": "object",
      "properties": {
        "kind": { "const": "comment" },
        "text": { "type": "string", "maxLength": 2000 }
      },
      "required": ["kind", "text"],
      "additionalProperties": false
    },
    "encodedNonEmpty": {
      "type": "object",
      "properties": {
        "value": { "type": "string", "minLength": 1 },
        "enc": { "$ref": "#/$defs/encoding" }
      },
      "required": ["value", "enc"],
      "additionalProperties": false
    }
  }
}
```

### 3.10 Pinning

An op step (or op test) MAY carry `hash`, the op's `hash` from the catalogue at authoring time. It identifies the op's
definition and everything it calls (LANGUAGE §12.4), and for a primitive its header and `version`.

When the step's `hash` differs from the catalogue's hash for that op:

| policy | result |
|---|---|
| `"ignore"` | nothing |
| `"warn"` (default) | `hash-mismatch` warning; the recipe still compiles and runs with the *current* op |
| `"strict"` | `hash-mismatch` error; nothing runs |

A step without `hash` is never a mismatch. `encodeShare` pins when it is given a catalogue (§7.4); the UI offers "update
pins" (`pinRecipe`) after the user has looked at a warning. A pin never selects an old implementation: Forge ships one
version of each op.

---

## 4. The `regex` and `recipe` vocabularies

Both ship in `@forge/ops`. `regex` is a normal vocabulary (its words are catalogue ops, category
`"Regular expressions"`). `recipe` is internal (R18).

### 4.1 Regex semantics (shared)

- Engine: JavaScript `RegExp`, **always with the `u` flag** (code-point matching, no legacy quirks). User flags are a subset
  of `ims` (the primitives add `g` or `y` themselves). Syntax is ECMAScript with the `u` flag; named groups are allowed.
- **Offsets and lengths are in code points**, to agree with FL (`len`, `slice`). A match never splits a surrogate pair.
- Matches are found left to right and do not overlap. After an **empty** match the search position advances by one
  code point.
- Limits, applied by every regex primitive before and during the search (`REGEX_LIMITS` in `src/regex-engine.ts`):
  at most 4 194 304 UTF-16 code units of input and 100 000 matches; beyond that the primitive raises
  `E_LIMIT_VALUE` with `detail.limit` `"regexInput"` or `"regexMatches"`. The pattern is already validated by the VM as a
  `regex` parameter (length ≤ `limits.maxRegexLength`, compiles).
- **Result size.** A primitive that builds a result larger than its input (`find-all`, `replace`, `split`) checks
  `ctx.limits.maxValueBytes` (LANGUAGE §10.8 sizes) **before** allocating and while accumulating: it adds up the size of the
  result as it goes and raises `E_LIMIT_VALUE` (`detail.limit: "maxValueBytes"`) the moment the sum would exceed it, instead of building
  the value for the VM to reject afterwards. `find-all` computes all code-point offsets in **one pass** (a running code-point
  counter advanced between matches), never by re-counting from the start of the text per match.
- **Time-boxing (R11).** A synchronous `RegExp` call cannot be interrupted by the VM (LANGUAGE §10.7). The box is
  the **hard kill**: bakes run in a terminable Worker and the client watchdog terminates it (§8.5). Consequently:
  a recipe that contains an enabled regex-using step *needs a hard kill*: a `subsection`, an `if` with a regex test, or an op (or op
  test) whose catalogue entry has `needsHardKill: true`. That flag is **computed from the loaded runtime** (§2.3): `buildCatalogue`
  walks `CompiledWord.deps` transitively from each op, and the flag is true if it reaches a regex-engine primitive. A primitive is a
  regex-engine primitive iff its module wrapped its definition in `markRegexPrimitive(def)` (exported from `src/regex-engine.ts` with
  `isRegexPrimitive(qname)`); every primitive that calls `execAll` MUST be wrapped. So an FL op written in a user unit that
  calls `regex:replace` is flagged automatically.
  `recipeNeedsHardKill(recipe, catalogue)` (one signature, in `@forge/recipe`) applies these rules to enabled steps only. The
  Baker evaluates it against the catalogue **it built from its own runtime** at `init` (never the build-time JSON), so user
  units are covered. An *untrusted* bake of such a recipe on a baker whose `hardKill` is false fails with `E_UNSAFE_HOST` before anything
  runs (§8.6). There is no static "catastrophic pattern" check.
- **The seam.** Every regex primitive calls one module, `src/regex-engine.ts`:
  `execAll(pattern: string, flags: string, text: string): RegexMatch[]` where `RegexMatch = { index: number /* UTF-16 */, end: number, text: string, groups: (string | undefined)[] }`,
  enforcing the limits above, plus `markRegexPrimitive` / `isRegexPrimitive` and `REGEX_LIMITS`. Phase 5 can replace the engine with a bounded one
  (step budget, linear-time) without touching any caller.

### 4.2 The `regex` vocabulary (primitives, `src/prims/regex.ts`)

`flags` is declared `flags:str[0..3,/[ims]*/]=""`. Duplicate flag characters are ignored. Help text is added in
`vocab/regex.fth`.
The test is called `test`, not `match?`, to read like the JavaScript method and keep names free of punctuation.

| word | effect | behaviour |
|---|---|---|
| `regex:test` | `( str pattern:regex flags:str[0..3,/[ims]*/]="" -- bool )` | true iff the pattern matches anywhere (an unanchored search) |
| `regex:find-all` | `( str pattern:regex flags:str[0..3,/[ims]*/]="" -- list )` | one `record` per match, with keys in this order: `start` (`int`, code points), `end` (`int`, exclusive), `text` (`str`), `groups` (`list` of `str`; a group that did not take part is `""`). Empty matches are included. |
| `regex:replace` | `( str pattern:regex replacement:str flags:str[0..3,/[ims]*/]="" -- str )` | replaces **every** match. `replacement` follows ECMAScript's substitution rules: `$$`, `$&`, `` $` ``, `$'`, `$1` to `$99`, `$<name>`. |
| `regex:split` | `( str pattern:regex flags:str[0..3,/[ims]*/]="" -- list )` | the pieces between **non-empty** matches, as `str`s; empty matches never split; capture groups are not included. Like `split`: `""` gives `{ "" }`, a match at the end gives a trailing `""`. |

Examples (these are conformance vectors, §12.4):

| call (input; pattern; flags) | result |
|---|---|
| `"Hello"; "^h"; ""` `regex:test` | `false`; with flags `"i"`: `true` |
| `"a1b22"; "\\d+"` `regex:find-all` | `{ {start 1 end 2 text "1" groups {}} {start 3 end 5 text "22" groups {}} }` |
| `"😀a1"; "\\d"` `regex:find-all` | one match, `start` 2, `end` 3 (code points; UTF-16 would say 3 and 4) |
| `"John Smith"; "(\\w+) (\\w+)"; "$2, $1"` `regex:replace` | `"Smith, John"` |
| `"a-b"; "(?<x>-)"; "[$<x>$&$$]"` `regex:replace` | `"a[--$]b"` |
| `"a1b22c"; "\\d+"` `regex:split` | `{ "a" "b" "c" }` |
| `"a,b,,c"; ","` `regex:split` | `{ "a" "b" "" "c" }` |
| `"abc"; "x*"` `regex:split` | `{ "abc" }` |

### 4.3 The `recipe` vocabulary

The words below are what the compiler emits (§5). Source: `packages/ops/vocab/recipe.fth`, verbatim. **Why these are FL words:** a TypeScript primitive receives plain values and
cannot call a quotation (the VM runs quotations; LANGUAGE §4.4, §10.5), so everything that runs child steps (`section`, `branch`,
`repeat`, `settle`) is FL, built from `mapi`, `if`, `times` and recursion. Only the regex work itself is a primitive. The one
primitive it needs, `recipe:_split-matches`, is private (a leading `_`, LANGUAGE §5.7) and is in `src/prims/recipe.ts`.

```forth
\ recipe: the words that compiled recipes call. Internal: never listed in the catalogue.
\ Container steps work on bytes; every word here that takes data takes bytes, so a str is
\ UTF-8 encoded at the boundary.
IN: recipe

: as-bytes ( bytes -- bytes )
  "Normalise the data to bytes. A str becomes its UTF-8 bytes; other types are a type error." doc ;

: latin1 ( str -- bytes )
  "Literal helper: a string whose code points are byte values 0 to 255." doc
  latin1>bytes ;

: base64 ( str -- bytes )
  "Literal helper: a string in standard base64." doc
  str>bytes "standard" base64:decode ;

: matches ( bytes pattern:regex flags:str encoding:choice{utf8|latin1}="utf8" -- bool )
  "True when the pattern matches somewhere in the data, which is read as utf8 or latin1." doc
  encoding "latin1" = [ bytes>latin1 ] [ bytes>str ] if
  pattern flags regex:test ;

: section ( bytes pattern:regex flags:str encoding:choice{utf8|latin1}="utf8" body:quot -- bytes )
  "Run body on every non-empty match; the bytes between matches are untouched." doc
  pattern flags encoding _split-matches
  [ 2 mod 1 = [ body call as-bytes ] when ] mapi
  #[ ] bjoin ;

: branch ( bytes test:quot then:quot else:quot -- any )
  "Run test on a copy of the data; then run then or else on the data." doc
  dup test call [ then call ] [ else call ] if ;

: repeat ( bytes n:int[1..1000] body:quot -- bytes )
  "Run body n times, feeding each result to the next." doc
  n [ body call as-bytes ] times ;

: settle ( bytes cap:int[1..1000] body:quot -- bytes )
  "Run body until its result equals its input, at most cap times." doc
  dup body call as-bytes
  dup2 = cap 1 = or
  [ nip ] [ nip cap 1 - body recurse ] if ;
```

Stack effects, for reference (all consume and produce exactly one value besides what they name):

| word | effect | meaning |
|---|---|---|
| `recipe:as-bytes` | `( bytes -- bytes )` | normalise to bytes. The empty body is deliberate: the word boundary coerces `str` to `bytes` (UTF-8, strict) and rejects other tags with `E_TYPE`. |
| `recipe:latin1` | `( str -- bytes )` | literal helper for `{enc: "latin1"}` |
| `recipe:base64` | `( str -- bytes )` | literal helper for `{enc: "base64"}` (standard alphabet) |
| `recipe:matches` | `( bytes pattern:regex flags:str encoding:choice{utf8\|latin1}="utf8" -- bool )` | regex test for `if` |
| `recipe:section` | `( bytes pattern:regex flags:str encoding:choice{utf8\|latin1}="utf8" body:quot -- bytes )` | `subsection` |
| `recipe:branch` | `( bytes test:quot then:quot else:quot -- any )` | `if`. `test` is `( bytes -- bool )`; `then` and `else` are `( bytes -- any )`. |
| `recipe:repeat` | `( bytes n:int[1..1000] body:quot -- bytes )` | `repeat` with `times` |
| `recipe:settle` | `( bytes cap:int[1..1000] body:quot -- bytes )` | `repeat` with `until: "stable"` (`cap` is `max`) |

A quotation argument (`body`, `test`, `then`, `else`) MUST consume exactly the data value and leave exactly one value;
the combinators check this (`E_EFFECT`). The compiler guarantees it because every op step is `( x -- y )` (§3.3).

**`recipe:_split-matches`** — `( bytes pattern:regex flags:str encoding:choice{utf8|latin1} -- list )`. Decodes the
data as `encoding` (`utf8`: strict, `E_COERCE` if invalid; `latin1`: one character per byte), finds the **non-empty**
matches (§4.1), and returns a list of `2k + 1` `bytes` values: `gap₀ match₁ gap₁ … matchₖ gapₖ`, where the gaps (possibly
empty) are the text between matches, re-encoded in the same encoding. Concatenating the whole list gives back the
input exactly. Limits: §4.1.

---

## 5. Recipe to FL compilation

`compileRecipe(recipe, catalogue, { word?, pins? })` validates (§3.7), then emits the canonical text (§6) for the
**canonical** recipe (§3.6). It is a pure, deterministic function: the same `(recipe, catalogue)` always gives the
same text, byte for byte, and the text contains no timestamps, ids or randomness.

### 5.1 The compiled unit

```forth
\ forge-recipe 1
: main ( bytes -- any )
  <step lines>
;
```

The word is `bake:main`: the `word` option (any unreserved word name, default `main`) names the word and the `vocab` option
(default `bake`, an internal vocabulary, R23) only builds `CompileOutcome.word`. The Baker creates the vocabulary
(`runtime.setCurrentVocab("bake")`, then restores `user`) and loads the text with `scope: { current: "bake", using: [] }`, so the
word cannot collide with a user word. It is one colon definition and nothing else: no `IN:`, no `USING:`; **every word is written qualified**
(`base64:decode`, `recipe:section`, and core words such as `fork` unqualified, as they are `core`). The header is
`( bytes -- any )` (R3): input is the bytes of the input pane, output is whatever the last step leaves. An empty
recipe compiles to a word with an empty body, which returns its input unchanged.

The text ends with a newline. Lines end with `\n` (LF only). The unit is a valid FL source unit: it loads with
`runtime.load(text, { unit: "recipe", scope: { current: "bake", using: [] } })` and never needs `trusted`.

### 5.2 Literals

Each parameter, in `ParamSpec` order, becomes one **literal group**, pushed before the word is called:

| type | literal |
|---|---|
| `int` | decimal digits, `-` for negatives, no separators (a decimal string beyond the safe range prints as is) |
| `num` | a float literal: `String(x)` of the JS number, with `.0` appended when it has neither `.` nor `e` (so `2` is `2.0`, `1e21` is `1e+21`, `0.5` is `0.5`; negative zero is special-cased and written `-0.0`) |
| `number` | an `int` literal if the value is integral, else as `num` |
| `bool` | `true` / `false` |
| `str`, `choice`, `regex`, `charset` | a string literal (below) |
| `bytes` | `#[` + bytes as lowercase hex pairs, each preceded by a space, + ` ]`; empty is `#[ ]` |
| `toggle`, `key`, and `split`/`join` of a fork (an `Encoded`) | by `enc`: `utf8` a string literal; `hex` the `#[ … ]` literal; `latin1` a string literal followed by ` recipe:latin1`; `base64` a string literal followed by ` recipe:base64` (value in normal form) |

**String literals.** `"` + the characters + `"`, where `\` is written `\\`, `"` is `\"`, U+0000 is `\0`, LF `\n`, CR `\r`,
tab `\t`, any other C0 or C1 control character (U+0001 to U+001F except those, and U+007F to U+009F) as `\xHH` with
two lowercase hex digits, and every other character as itself (U+2028 included: FL treats only LF, CRLF and CR as
line breaks, and none can appear raw). The result never contains a raw line break.

An op step's literal group is the groups of its parameters joined by one space, then one space, then the qualified
name: `13 classical:rot`, `"standard" base64:decode`, `"" "x" "i" regex:replace`. An op with no parameters is just its
name.

### 5.3 Steps

Indentation: two spaces for the word body, plus two more per container nesting level. `⟨anns⟩` is the optional annotation
comment of §6.2. `⟨lits⟩` is a literal group.

| step | lines |
|---|---|
| `op` | `⟨lits⟩ qname⟨anns⟩` |
| `fork` | open: `recipe:as-bytes ⟨split⟩ ⟨join⟩ [⟨anns⟩`; the children, indented; close: `] fork` |
| `subsection` | open: `recipe:as-bytes ⟨pattern⟩ ⟨flags⟩ ⟨encoding⟩ [⟨anns⟩`; the children; close: `] recipe:section`. Flags and encoding are always written (`""`, `"utf8"` by default). |
| `if`, regex test | open: `recipe:as-bytes [ ⟨pattern⟩ ⟨flags⟩ ⟨encoding⟩ recipe:matches ] [⟨anns⟩`; the `then` children; `] [`; the `else` children; close: `] recipe:branch` |
| `if`, op test | open: `recipe:as-bytes [ ⟨lits⟩ qname ] [⟨anns⟩`; then as above. The `if` step has no pin of its own: a pin written on this line (`@pin=`) is the **predicate op's** `test.hash`. |
| `repeat`, `times` | open: `recipe:as-bytes ⟨n⟩ [⟨anns⟩`; the children; close: `] recipe:repeat` |
| `repeat`, `until` | open: `recipe:as-bytes ⟨max⟩ [⟨anns⟩` (`100` if omitted); the children; close: `] recipe:settle` |
| `comment` | `\ # ⟨json-string⟩` |

The `else` part is always written (`] [` then `] recipe:branch`), empty if there are no `else` steps. In the `if`
lines the test is a quotation `( bytes -- bool )` on the first line; the `then` and `else` quotations span lines. A
container with no children has its open line immediately followed by its close line. `⟨json-string⟩` is a JSON string
literal (RFC 8259) in which only `"`, `\` and C0 controls are escaped (`\n`, `\r`, `\t`, `\b`, `\f`, `\u00XX`).

`fork` uses the **core combinator**: `⟨split⟩ ⟨join⟩ [ … ] fork` is `( data sep join quot -- data )` (LANGUAGE §8), and
`recipe:as-bytes` guarantees `data` is `bytes`, so the separators (strings are coerced to the tag of the data) are
bytes and the result is `bytes`.

### 5.4 Disabled steps, comments, breakpoints

- A **disabled step** (or a step inside a disabled container) is written as comment lines: every line of its block
  (open line, children, close line) is prefixed, after the indentation, by `\ ~ ` once per disabled level (§6.2).
  The FL reader drops comments, so the step **vanishes** from the instruction array. Disabled steps still occupy lines
  and keep their entry in `StepLine[]` (with `disabled: true`), but have no instruction range.
- **Comment steps** are `\ # "…"` lines; also invisible to the compiler.
- A step's `breakpoint`, `note` and `hash` go in its trailing annotation comment (§6.2). They do not change the
  instruction array.

### 5.5 The step→line→ip map

`compileRecipe` returns `lines: StepLine[]`, one per step (all kinds, disabled included), in document order, parents
before children, each with `path` (JSON pointer), `kind`, `startLine`, `endLine` (1-based, inclusive, in the
returned `text`), `disabled`, `breakpoint`. Lines are determined by the layout rules above: the `startLine` of a
step is its first line, the `endLine` the line of its close (or its only line).

The map to instruction indices needs the loaded word. `resolveStepIps(word, lines, positions)` is pure, with
`positions` = `CompiledWord.positions` of `runtime.lookup(word).code` (`positions[ip].line` is the source line of
instruction `ip`, 1-based, in the loaded text, the same numbering because the text is loaded as a whole). Since
code is emitted in source order, `positions[·].line` is non-decreasing, and for each **enabled** step:

- `startIp` = the smallest `ip` with `positions[ip].line >= startLine`;
- `endIp` = the smallest `ip` with `positions[ip].line > endLine` (the length of `code` if none).

The result is `StepIpMap`:

- `steps: StepIp[]` for enabled steps (`path`, `kind`, `startIp`, `endIp`, `breakpoint`);
- `events: IpEvent[]` sorted by `ip`: for each `ip`, the `ends` (steps with that `endIp`, innermost first) and `starts`
  (steps with that `startIp`, outermost first);
- `breakpoints: Breakpoint[]` = `{ word, ip: startIp }` for every enabled step with `breakpoint: true`.

Because a step's last instruction is on its last line, its `endIp` is the first instruction of the next line that has
code, which for a last child is the `ret` of the quotation, and for the last top-level step the `ret` of the word.
Both exist. Worked example: §12.2.

### 5.6 Using the map (the Baker's job, §8)

- **User breakpoints and stepping.** `RunOptions.breakpoints` contains `{ word, ip }` for every `ip` that appears in
  `events` (not only the user's breakpoints; see below). The `onStep` hook receives `StepEvent` with `ip`; the Baker looks
  the ip up in `events`.
- **Step log.** At each hit the hook also appends `(event.step, path of the innermost open step)` to a log bounded by `limits.maxTraceEntries`;
  §8.2 uses it to attribute coercions to steps.
- **Progress and per-step timing** use the same hits: at an `ip` with `ends`, close those steps' timers, at `starts`
  open them. A step that runs many times (a fork child, once per piece) accumulates `ms` and counts `runs`.
- A breakpoint hit when the hook is entered for an ip whose `starts` include a step with `breakpoint: true`
  (debug mode), or in single-step mode (`step()` was called) for any start, pauses: the hook returns a promise that
  resolves on `step()`/`continue()`/`cancel()`.

### 5.7 Attributing an error to a step

`attributeError(word, frames, map)`: the Baker calls it with `ForgeError.frames` (innermost first). It takes the
**first frame whose `word` equals the recipe word**; that frame's `ip` is the instruction that was executing in the
recipe word (for an error raised inside a callee, the instruction that called it; quotation frames are reported as
frames of their lexical word, with their own `ip`). It returns the `path` of the **deepest** enabled step whose
`[startIp, endIp)` contains that `ip` (the last in document order among those that contain it), or `null` if none.

If `null` (the frame list is capped at 16 entries, or the `ip` is in the prologue/epilogue), the Baker falls back to the
path of the most recently *started* step. Observed behaviour this relies on (verified against `@forge/lang`):
an entry error such as `E_PARAM_INVALID` reports `word` = the callee but `frames[0]` = the recipe word at the calling
`ip`; an error inside a callee has `frames[0]` = the callee and the recipe frame next.

### 5.8 Pins during compilation

With `pins: "warn"` (the default) a mismatch becomes a `hash-mismatch` warning in `CompileOutcome.issues` and the text
is produced; `"strict"` fails the compile; `"ignore"` skips the comparison. Pins are written into the text as `@pin=` (§6.2) whatever
the policy.

---

## 6. The canonical text form

### 6.1 One text, two roles

`compileRecipe(…).text` is both the FL that is loaded and run, and the human-readable, copy-pasteable form of the
recipe (R4). `parseRecipeText(text, catalogue)` is the inverse. The text is a valid FL unit, but it is **never loaded
from user input** (R5): the parser is a restricted line parser that returns recipe JSON, which is validated and then
recompiled.

### 6.2 Grammar

The text is a sequence of **lines** separated by LF (the parser also accepts CRLF). Leading spaces of a line are
insignificant to the parser (the compiler writes the indentation of §5.3). `FL-string`, `FL-int`, `FL-float`,
`FL-bytes` and `FL-bool` are the literal tokens of LANGUAGE §2.4 to §2.10; `json-string` is a JSON string literal
(RFC 8259); `hex64` is 64 lowercase hex digits.

```ebnf
text        = header , { meta } , word-open , { line } , word-close , { blank-line } ;
header      = "\ forge-recipe 1" , EOL ;
meta        = "\ " , ( "name" | "description" | "catalogue" ) , " " , json-string , EOL ;
word-open   = ": " , word-name , " ( bytes -- any )" , EOL ;
word-close  = ";" , EOL ;

line        = indent , { "\ ~ " } , body , EOL ;
indent      = { " " } ;
body        = comment
            | op-line , [ anns ]
            | container-open , [ anns ]
            | "] [" 
            | "] " , closer ;
comment     = "\ # " , json-string ;
op-line     = { group , " " } , qname ;
container-open = "recipe:as-bytes" , { " " , atom } , " [" ;
atom        = group | qname | "[" | "]" ;        (* interpreted by the closer, 6.3 *)
group       = FL-int | FL-float | FL-bool | FL-bytes | FL-string | FL-string , " " , helper ;
helper      = "recipe:latin1" | "recipe:base64" ;
closer      = "fork" | "recipe:section" | "recipe:branch" | "recipe:repeat" | "recipe:settle" ;
anns        = "  \ " , ann , { " " , ann } ;
ann         = "@pin=" , hex64 | "@break" | "@note=" , json-string ;
```

- `name`, `description` and `catalogue` set the recipe fields of the same name (values are JSON strings); a missing line
  is a missing field. The header MUST be the first line and its version MUST be `1`.
- A **disabled prefix** `\ ~ ` is repeated once per disabled level. The number of prefixes on a line is its **level**.
- The annotations are one trailing comment that starts with two spaces and `\ @`. They appear at most once per line,
  in the fixed order `@pin`, `@break`, `@note`. They sit on op lines and on the **open line** of a container; else,
  close and comment lines have none.
- On an op line the annotation is a plain trailing FL line comment, so it has no effect when the text is run.

**Levels.** Let `d(S)` be the number of disabled steps among a step `S` and all its ancestors. Every line that belongs
to `S` itself (its op or comment line, or the open, else and close lines of a container) has level `d(S)`. So a child
`T` of a container `C` has level `d(C)` or `d(C) + 1`, and `T.disabled` is true exactly in the second case. A comment
step is never disabled itself, so its level equals its container's.

### 6.3 Parsing

`parseRecipeText` is a line parser with an explicit stack. It never calls the FL compiler. It uses `read()` from
`@forge/lang` on one line at a time, only to get literal tokens and their positions. A lexical error becomes a
`bad-value` issue at that line.

1. **Frame.** Split into lines. Line 1 must be the header; then `meta` lines; then the `word-open` line (its word name
   is ignored); the last non-blank line must be `;` and nothing but blank lines may follow it.
2. **Strip.** For each line between `word-open` and `word-close`: remove leading spaces, then count and remove `\ ~ `
   prefixes (the level `p`). The rest is `R`.
3. **Classify `R`** (first match wins):
   1. `R` starts with `\ # `: a **comment** step; the rest MUST be exactly one JSON string. Its level MUST equal the
      level of the enclosing container (0 at top level).
   2. Otherwise tokenise `R` with `read()`. The text after the end of the last token is the **tail**: empty, or a
      comment that MUST match `anns` (parsed by a small hand-written scanner, not by `read()`).
   3. Tokens `]` `[` only: an **else** line.
   4. Tokens `]` and then one `word`/`qword` token: a **close** line. The word MUST be a `closer`.
   5. First token is the qword `recipe:as-bytes` and the last token is `[`: a **container open** line. The tokens between
      are its atoms.
   6. Otherwise an **op line**: the last token MUST be a qualified name; everything before it is literal groups.
4. **Stack.** An open line pushes a frame `{ level p, atoms, annotations, then: [], else: [] , inElse: false }`. A step
   (comment, op line, or a completed container) is appended to the current list of the frame on top (`else` after an
   else line, otherwise `then`/`steps`), or to the top-level list. Checks: a step's level `p` MUST be the frame's
   level or one more; an else line MUST have the frame's level, may appear at most once and only in a frame whose atoms
   begin with `[`; a close line MUST have the frame's level. `T.disabled = p > frame level` (at top level, the frame
   level is 0).
5. **Completing a container** at its close line, by the `closer`:
   - `fork`: atoms are exactly two **Encoded groups** `⟨split⟩ ⟨join⟩`. An Encoded group is `FL-string` (`utf8`),
     `FL-bytes` (`hex`, the bytes as compact lowercase hex), or `FL-string` + `recipe:latin1` (`latin1`) / `recipe:base64`
     (`base64`). Children are the `steps`.
   - `recipe:section`: atoms are `FL-string FL-string FL-string`: `pattern`, `flags`, `encoding` (`utf8` or `latin1`).
   - `recipe:branch`: a `@pin=` annotation on the open line sets `test.hash` of an op test (it is `bad-value` on a regex test). Atoms are one quotation `[ … ]`: either `FL-string FL-string FL-string recipe:matches` (a
     regex test: pattern, flags, encoding) or literal groups followed by one qualified name (an op test, read like an
     op line). A frame without exactly one else line is an error; the `then` list is the part before it.
   - `recipe:repeat`: atoms are one `FL-int`: `times`. `recipe:settle`: one `FL-int`: `max`, with `until: "stable"`.
   - Any other shape is a `bad-value` issue at that step.
6. **Op lines and op tests.** The final qualified name is `op`; it MUST be in the catalogue (`unknown-op`). The literal groups
   before it are matched to the op's `params` in order. For each parameter exactly one group is consumed and converted
   back to JSON by type: `int` from `FL-int` (a number, or a decimal string beyond the safe range); `num` from
   `FL-float`; `number` from either; `bool` from `FL-bool`; `str`, `choice`, `regex`, `charset` from `FL-string`; `bytes`
   from `FL-bytes` as hex; `toggle`/`key` from an Encoded group. Leftover or missing groups, or a group of the wrong
   kind, is `bad-param` at the step's path.
7. **Result.** The assembled recipe goes through `validateRecipe` (with the catalogue) and then `canonical`. The output
   is that value: parameters explicit; `flags: ""`, `encoding: "utf8"`, `max: 100`, empty `else` omitted.

### 6.4 Parser errors

Issues use the codes of §3.7 with `path` = the JSON pointer of the step being built, or `""` for header problems.
Because the text has lines, every parser issue also carries `detail.line` (1-based) and `detail.col`. Additional
checks: a missing header or `;` is `required`; text after `;` is `unknown-field`; an unterminated block, a close
without an open, a mismatched close word or wrong level is `bad-value` with `detail.constraint: "block structure"`; more than
`RECIPE_LIMITS.maxJsonBytes` of text is `limit`. The parser has the same limits as the validator and MUST NOT recurse
(the container stack is explicit), so nesting depth 8 is also its bound.

### 6.5 Round trip

For every valid recipe `r` and its catalogue `c`:

> `parseRecipeText(compileRecipe(r, c).text, c)` returns `{ ok: true, recipe }` where `recipe` deep-equals `canonical(r, c)`
> (including key order, compared as `JSON.stringify` text).

and `compileRecipe(canonical(r, c), c).text === compileRecipe(r, c).text`. The text cannot represent: a `name` with a
line break (it is a JSON string, so it can), nothing is lost. Disabled steps, comments, notes, breakpoints, pins, and
`name`/`description`/`catalogue` all survive. Goldens: §12.3.

---

## 7. Share URL

Module `packages/recipe/src/share.ts`. It uses `CompressionStream` / `DecompressionStream` (`"deflate-raw"`), available in
browsers, Web Workers and Node 20. Functions: `encodeShare(state, { catalogue? })` and `decodeShare(fragment, { catalogue?, pins? })`,
both async, neither throws (types: `EncodeShareFn`, `DecodeShareFn`).

### 7.1 Format and limits

```ebnf
fragment = [ "#" ] , pair , { "&" , pair } ;
pair     = key , "=" , value ;
key      = "v" | "r" | "i" | "ie" | other ;       (* other: [a-z][a-z0-9]{0,7}, ignored *)
value    = { "A".."Z" | "a".."z" | "0".."9" | "-" | "_" } ;
payload  = method , base64url ;                   (* the value of r and i *)
method   = "0" | "1" ;                            (* 0 = stored, 1 = deflate-raw *)
```

| key | meaning | rules |
|---|---|---|
| `v` | format version | required, MUST be the first pair, value `1` (`SHARE_FORMAT_VERSION`) |
| `r` | recipe | required; payload of the UTF-8 bytes of `JSON.stringify(normalise(recipe))` (no whitespace) |
| `i` | input | optional; payload of the raw input bytes |
| `ie` | how the UI shows the input | written whenever `i` is; one of `utf8 hex latin1 base64`; default `utf8`; **`ie` without `i` is `malformed`**. A hint only: the bytes are canonical |

`base64url` is RFC 4648 §5 **without padding**: characters `A-Za-z0-9-_` only; a length of the form `4n + 1` is invalid; and the
encoding must be **canonical**: the unused low bits of the last character are zero (the last character of a payload of length `4n + 2`
has its low 4 bits zero, of `4n + 3` its low 2 bits zero). A non-zero trailing bit is `bad-base64`, so each byte string has exactly one
accepted spelling.
The encoder picks method `1` only when the deflated payload is strictly shorter than the stored one.

`SHARE_LIMITS`: fragment ≤ 65 536 characters (without `#`); inflated recipe ≤ 262 144 bytes; inflated input ≤ 1 048 576
bytes; at most 8 pairs. Encoding fails with `fragment-too-long` / `input-too-large` rather than truncating.

Encoders need not produce identical bytes on different platforms (the deflate stream is implementation-defined);
decoders MUST accept any valid deflate-raw stream. Goldens therefore test *decoding* of fixed fragments and *round trips*,
never the encoder's exact output (§12.5).

### 7.2 Encoding

1. Validate the recipe (§3.7, pins `ignore`); invalid → `invalid-recipe`.
2. If a catalogue is given: `pinRecipe` (op steps and op tests without `hash` get one) and add `secret-in-url` warnings (§7.4).
3. `normalise`, `JSON.stringify`, UTF-8. More than `maxRecipeBytes` → `too-large`.
4. Payload as above. Same for the input (`input-too-large` over the limit).
5. Assemble `v=1&r=<payload>[&i=<payload>&ie=<enc>]` and check the length.

### 7.3 Decoding

Untrusted input (PLAN §5). Order of checks, cheapest first; the first failure wins:

1. Strip one leading `#`. Longer than `maxFragmentChars` → `fragment-too-long`.
2. Split on `&` (more than `maxPairs` pairs → `malformed`); each pair is `key=value` with exactly one `=`; characters
   outside the value alphabet, an empty key, an **empty value** (`r=`), or a repeated known key → `malformed`.
3. `v` missing or not first → `malformed`; `v` other than `1` → `unsupported-version`. `r` missing → `malformed`.
   `ie` present but not one of the four names, or present without `i` → `malformed`. Unknown keys are ignored.
4. Decode each payload: unknown method digit → `malformed`; invalid or non-canonical base64url → `bad-base64`.
5. Method `1`: inflate with an **output budget** (recipe, input limits above). Read the stream in chunks, count output,
   and cancel the stream as soon as the budget is exceeded (`too-large`); never allocate more than the budget plus one
   chunk. Any stream error → `bad-compression`; **data after the end of the deflate stream is an error** (`bad-compression`;
   the Compression Streams standard makes the decompressor reject it, and the trailing-byte test of §7.5 pins this down).
   Method `0`: the decoded length must itself be within the budget.
   **Do not deadlock the stream.** A `DecompressionStream` (and a `CompressionStream`) applies back-pressure: if the code
   `await`s `writer.write(...)`/`close()` before it starts reading, a large output fills the internal queue and the write never settles.
   Always start the read loop first (or concurrently, e.g. `Promise.all([write, readAll])`) and never await the write alone.
   The same holds when encoding.
6. The recipe bytes: strict UTF-8 (`TextDecoder` with `fatal: true`) and `JSON.parse` inside `try`; any failure (including a
   `RangeError` from very deep nesting) → `bad-json`.
7. `validateRecipe(parsed, catalogue, { pins })` (its iterative pre-walk and depth cap, §3.7, make a *balanced* hostile nesting such as
   a 100 000 deep `{"a":{"a":…}}` that did parse a `limit` issue, never a stack overflow): errors → `invalid-recipe` with `issues`. On success the result's
   `recipe` is `normalise(parsed)`: **fresh objects built from a whitelist of keys**, so no property of the parsed
   value (such as `__proto__`) is ever copied through.

A successful decode returns warnings (pins, catalogue mismatch, aliases). **A decoded recipe is data**: decoding never
loads, runs or auto-executes anything. Callers bake it with `trust: "untrusted"` (the default, §8.6).

### 7.4 Secrets in links

A `key` parameter may hold secret key material. (`toggle` parameters, the input and fork separators are *not* treated as secret; all of
them, and `key` values, are in the clear in the link and in the text form, which the UI must tell the user, §3.4.) `encodeShare` with a catalogue adds one warning `secret-in-url`
(path of the parameter) for every op step whose `key` parameter is present and differs from its default. The UI is
expected to ask before creating such a link. The input bytes are never inspected.

### 7.5 Hostile fragments

Every row is a required test (`packages/recipe/test/share.test.ts`); §12.5 gives concrete fragments.

| case | result |
|---|---|
| 70 000 characters | `fragment-too-long` |
| `#r=` (empty value), `#v=1&r=`, `#v=1&r=0e30&ie=hex` (`ie` without `i`) | `malformed` |
| `#v=1&i=0e30` (no `r`) | `malformed` |
| a payload with a non-zero trailing bit (`0e31`: the bytes of `0e30` with a stray low bit set) | `bad-base64` |
| a valid deflate stream followed by one extra byte | `bad-compression` |
| a stored payload that decodes to a 100 000-deep balanced `{"a":{"a":…}}` | `bad-json` or `invalid-recipe` with a `limit` issue (either, never a throw) |
| `v=2&r=…` | `unsupported-version` |
| no `v`, or `v` not first | `malformed` |
| `r` twice; 9 pairs; `ie=ebcdic`; value with `%`, `+`, `=`, space | `malformed` |
| `r=1!!!` (a character outside the alphabet) | `malformed` |
| `r=0A` (one base64 character: length ≡ 1 mod 4) | `bad-base64` |
| `r=2AAAA` (unknown method) | `malformed` |
| a 1 KiB deflate stream that inflates to 100 MiB | `too-large`, and memory stays bounded |
| `r=1` + garbage | `bad-compression` |
| inflated bytes that are not UTF-8, or not JSON, or 200 000 nested `[` | `bad-json` |
| JSON `[]`, `{"forge":2,"steps":[]}`, `{"forge":1,"steps":[{"kind":"op","op":"nope:x"}]}` with a catalogue | `invalid-recipe` with the issues of §3.7 |
| a recipe object containing `"__proto__"` as a `params` key | `invalid-recipe` (`bad-value`), and `Object.prototype` is unchanged |

---

## 8. The bake API (`@forge/worker`)

Types: `packages/worker/src/types.ts`. Everything in this section is the same code on every host: a `Baker` engine
(the *core*) does the work; the host decides where it runs.

### 8.1 Layers

```
 UI / tests ──► Baker interface ◄── BakerClient (main thread: promises, watchdog) ── WorkerHost ── messages ──┐
        │                                                                                                      ▼
        └──────► in-process Baker (Node tests, hardKill = false)                   worker entry ──► attachBakerCore ──► core
                                                                                    (Web Worker | worker_threads)
```

- **Core** (`createBakerCore(options: BakerCoreOptions)`, `src/core.ts`): implements `Baker` in the current thread. `hardKill` is
  `false`. `options.loadBundle` is **required**.
- **In-process baker** (`createInProcessBaker(options: BakerCoreOptions)`, `src/inprocess.ts`): the core itself, under another name. For
  tests, the CLI and trusted use. Node tests pass `loadBundleNode`.
- **Worker side** (`attachBakerCore(port, core)`, `src/port.ts`): the message loop of §8.4 on a `WorkerPort`.
  Entries: `src/worker-web.ts` (a module Web Worker; it calls `createBakerCore({ loadBundle: loadBundleVite })` with the loader of
  `@forge/ops/vite`) and `src/worker-node.ts` (a `worker_threads` entry; `loadBundleNode` of `@forge/ops/node`). Each is a few lines,
  and the core itself never imports a loader (R24).
- **Client** (`createBakerClient`, `src/client.ts`): implements `Baker` over a `WorkerHost`; `hardKill` is `true`.
  Hosts: `createWebWorkerHost(create)` where `create` returns a `Worker` (`src/host-web.ts`) and `createNodeWorkerHost()` (`src/host-node.ts`, export `@forge/worker/node`).

### 8.2 The `Baker` interface and `BakeResult`

```ts
interface Baker {
  readonly hardKill: boolean;
  init(init?: BakerInit): Promise<InitInfo>;
  bake(recipe: unknown, input: Uint8Array, options?: BakeOptions): Promise<BakeResult>;
  step(): Promise<void>;       // while paused: run to the start of the next step
  continue(): Promise<void>;   // while paused: run to the next breakpoint or the end
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
```

**`init(init?)`** — `BakerInit { vocabs?: string[] | "all" (default "all"); units?: {name, source}[] }`. Calls the injected
`loadBundle` (S2: `BakerCoreOptions.loadBundle` is **required**; `worker-web.ts` injects `loadBundleVite`, `worker-node.ts` and Node
tests inject `loadBundleNode`, tests may wrap either to add a fixture vocabulary) for `vocabs` **plus `recipe`** (the baker always adds it,
and with it `regex` and `base64`), `assembleRuntime` with the user `units` (untrusted; they cannot define into bundled or internal
vocabularies, §2.5), creates the `bake` vocabulary, builds the catalogue (`buildCatalogue` with `bundleVocabs` = the bundle's)
and keeps it for validation, compilation and the hard-kill check. Returns `InitInfo { protocol: 1, catalogueVersion, vocabs }`
where `vocabs` is the **full set loaded** (the requested ones, `recipe`, and every dependency).
Rejects (the only rejecting call) with an `Error` whose `message` is the `ForgeError` text if a vocabulary fails
to assemble. May be called again to reload. If the build-time `dist/catalogue.json` and the runtime's catalogue have
different `version`s the caller can tell by comparing `catalogueVersion`.

**`bake(recipe, input, options?)`** — never rejects for recipe, language or limit errors. One bake at a time: if one is
active, `bake` first cancels it (it ends `E_ABORTED`) and waits for it to finish. Steps:

1. Not initialised → result with `E_NOT_READY`.
2. `validateRecipe(recipe, catalogue, { pins })`. Errors → `E_RECIPE_INVALID` with `issues`. Warnings are kept in `warnings`.
3. If `trust` is `"untrusted"`, the recipe needs a hard kill (§4.1) and `!hardKill` → `E_UNSAFE_HOST` (detail `{ reason: "regex" }`).
4. `compileRecipe` → text, `lines`. A compile failure after a successful validation is `E_INTERNAL`.
5. `runtime.load(text, { unit: "recipe", scope: { current: "bake", using: [] } })`; `resolveStepIps(word, lines, entry.code.positions)`
   with `word` = `bake:main`.
6. Run `runtime.call(word, [bytes(input)], runOptions)` where `runOptions` has: the effective limits (§8.6), `signal`, `abortFlag` (when
   given), `breakpoints` (§5.6), and the `onStep` hook. `trace` is off.
7. Map the `RunResult` (below) and return.

`BakeResult` (`ok` discriminates):

| field | meaning |
|---|---|
| `id` | the bake's id |
| `ok: true`, `output: OutputValue` | the single value left on the stack, rendered (§8.3) |
| `ok: false`, `error: BakeError`, `partial?` | the failure; `partial` is the top of the stack at the failure, rendered, if any |
| `steps: StepReport[]` | `{ path, ms, runs }` for every step that started (also on failure; steps still open at the end are closed at the failure time) |
| `coercions: BakeCoercion[]` | the data-input conversions of op steps: see below |
| `coercionsTruncated: boolean` | true if the VM's coercion record was cut at `maxTraceEntries` |
| `warnings: RecipeIssue[]` | warnings of validation |
| `stats` | `elapsedMs` (whole call including validation and compile), `vmSteps`, `effects` |

`BakeError`: `code` (`ErrorCode` or the four of R17), `message`, `path` (the step, §5.7; `null` when none applies),
`word`, `detail` (the `ForgeError`'s `toJSON().detail`: JSON-safe, values already rendered as text and **secrets redacted**),
`issues?` (for `E_RECIPE_INVALID`), `terminated?`. The stack snapshot of the `ForgeError` is **not** forwarded.

**Coercions.** `RunResult.coercions` is filtered to entries with `slot === 0` whose `word` is the `op` of an enabled op step
of this recipe; each becomes `{ path, op, from, to }`. **The path comes from VM step ordering**: the hook (§5.6) appends `(event.step, innermost open
step path)` to a *step log* every time a step starts or ends, and a coercion with VM step `n` belongs to the log entry with the greatest
`step <= n`, so repeated uses of the same op in different steps, or in a fork, are attributed exactly. The step log is bounded by
`limits.maxTraceEntries`; once full, later coercions get `path: null`. The VM's own coercion record is also bounded by
`maxTraceEntries` (LANGUAGE §4.1), and `coercionsTruncated` reports that. Parameter coercions and coercions inside ops' own bodies
are dropped, so `{ "value": "x", "enc": "utf8" }` parameters never show as noise.

### 8.3 Rendering values

`renderValue(value: Value): OutputValue` (`src/render.ts`), bounded by `RENDER_LIMITS`:

| tag | `OutputValue` |
|---|---|
| `bytes` | `{ kind: "bytes", bytes: <copy>, text }` where `text` is the strict UTF-8 decoding or `null` (not UTF-8, or longer than `maxTextBytes`) |
| `str` | `{ kind: "str", text }` |
| `int` | `{ kind: "int", text }` decimal, exact for bigints |
| `num` | `{ kind: "num", value }` (non-finite values do not occur in FL) |
| `bool` | `{ kind: "bool", value }` |
| `list` | `{ kind: "list", items: first 1000 rendered, total }` |
| `record` | `{ kind: "record", entries: first 1000 in insertion order, total }` |
| `quot`, `file`, anything deeper than `maxDepth` | `{ kind: "other", tag, repr }`, repr cut to 200 characters |

The bytes are copied into a buffer the result owns exclusively, so the worker can transfer it (§8.4). A `secret` value renders as
`other` with repr `<redacted>`.

### 8.4 Messages

Structured clone only; no functions, no class instances. Types: `ClientMessage`, `WorkerMessage`.

Client → worker:

| message | fields | meaning |
|---|---|---|
| `init` | `reqId`, `protocol: 1`, `init: BakerInit` | create/replace the core's runtime |
| `bake` | `id`, `recipe`, `input: ArrayBuffer` (**transferred**), `options: SerialBakeOptions`, `abort?: SharedArrayBuffer` | start a bake |
| `step`, `continue`, `cancel` | `id` | control the bake with this `id` |
| `dispose` | | release the runtime; the worker may exit |

Worker → client:

| message | fields | meaning |
|---|---|---|
| `ready` | `reqId`, `info: InitInfo` | init done |
| `init-error` | `reqId`, `error: BakeError` | init failed |
| `event` | `id`, `event: BakeEvent` | `progress`, `paused`, `resumed` |
| `result` | `id`, `result: BakeResult` | the bake ended; output (and `partial`) bytes buffers are in the transfer list |
| `fatal` | `message` | the worker cannot continue |

Rules:

- **Ids.** The client allocates `reqId` and bake `id` as increasing integers. The worker ignores `step`/`continue`/`cancel`
  for an `id` that is not the active one, and discards nothing silently that matters: a `bake` whose `id` is not larger than the
  last one gets a `result` with `E_PROTOCOL`.
- **Validation.** The worker validates every message shape (`protocol.ts`); a malformed message yields `fatal` and the
  client treats the worker as failed. `protocol` mismatch → `init-error` with `E_PROTOCOL`.
- **Single flight.** A `bake` message while a bake is active cancels it, waits until its `result` has been posted, then
  starts the new one. Messages are handled in order.
- **Transfers.** The client copies the caller's `Uint8Array` into a fresh `ArrayBuffer` (so the caller keeps its data) and
  transfers that. The worker collects every `ArrayBuffer` of bytes outputs for the transfer list. `SharedArrayBuffer`s
  are shared, not transferred.
- **Events.** `progress` is sent at most once per `PROGRESS_INTERVAL_MS` (50 ms) per bake, plus a final one before
  `result`; it carries the latest started `path`, `done`/`total` top-level steps, `vmSteps`, `elapsedMs`. `paused`
  is sent at every pause (`reason`: `start` for `startPaused`, `breakpoint`, or `step`) with `data` the value about to enter the step; `resumed` when the
  bake continues. Events are only sent for the active bake.

### 8.5 Cancellation, the watchdog, termination

**Layers, cheapest first:**

1. **Message.** `cancel(id)` makes the worker call `abort()` on the bake's `AbortController`; the VM sees `signal.aborted`
   within one yield interval (≤ 131 072 steps, LANGUAGE §10.7).
2. **Shared flag.** When the page is `crossOriginIsolated` (`typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated`)
   and `sharedAbort` is not disabled, the client allocates a **new `SharedArrayBuffer(4)` per bake**, sends it in `bake.abort`
   and sets `Atomics.store(new Int32Array(sab), 0, 1)` on `cancel()`. The worker passes the `Int32Array` as
   `RunOptions.abortFlag`, which the VM polls every 1024 steps, so a tight FL loop stops in microseconds even if the worker's
   message queue is busy. A new buffer per bake means a late flag can never cancel the next bake.
3. **Watchdog (hard kill).** A synchronous primitive (a long regex, a hash) can be stopped by neither. The **client** runs two timers:
   - **cancel timer**: started by `cancel()`; fires after `cancelGraceMs` (default 1000) if no `result` arrived;
   - **deadline timer**: started with the bake; fires `deadlineGraceMs` (default 1000) after the bake's time limit (`limits.maxMillis`,
     §8.6) if no `result` arrived. During a debug pause (§8.8) the timer is stopped and its remaining time is restored on resume,
     so a paused bake never times out.

   When a timer fires the client calls `host.terminate()` and **synthesises** the result for the active bake:
   `ok: false`, `error.code` `E_ABORTED` (cancel timer) or `E_LIMIT_TIME` (deadline timer), `terminated: true`, `path` = the
   last `progress` path (the step that was running), empty `steps` and `coercions`, `stats.elapsedMs` measured by the client.
   Then it creates a fresh host (`HostFactory`) and re-sends the last `init`, lazily on the next call. The next `bake` waits for
   `ready`.
4. **Worker failure.** An `onError`, an unexpected exit or a `fatal` message fails the active bake with `E_INTERNAL`
   (`terminated: true`) and recreates the host the same way.

`cancel()` resolves when the active bake has produced its result (real or synthesised); with no active bake it resolves
immediately. `dispose()` cancels, sends `dispose` and terminates.

The in-process baker implements layers 1 and 2 only (an `AbortController`, no shared flag), which is why it reports `hardKill: false`.

### 8.6 Limits and trust

- **One merge function.** `effectiveLimits(trust, limits?) → Limits` in `packages/worker/src/limits.ts` is the only place limits are merged;
  the core uses it for the VM and the client uses it (its `maxMillis`) for the deadline timer.
- `trust: "untrusted"` (default): effective limits = `DEFAULT_LIMITS` ⊕ `UNTRUSTED_LIMITS` ⊕ the caller's `limits`, where for each field the
  **smaller** of the second and third wins (a caller can only tighten). `UNTRUSTED_LIMITS` (in `types.ts`): `maxSteps` 5 000 000,
  `maxDataDepth` 10 000, `maxValueBytes` 16 MiB, `maxTotalBytes` 256 MiB, `maxIntBits` 16 384, `maxMillis` 10 000.
  An untrusted bake of a recipe that needs a hard kill requires `hardKill` (§4.1).
- `trust: "trusted"`: `DEFAULT_LIMITS` ⊕ the caller's `limits`, any direction. For tests, the CLI and the user's own console.
- Always: the recipe limits of §3.8 (the validator), the share limits of §7.1, the regex limits of §4.1, `maxSourceChars` on the compiled
  text (the validator's JSON cap keeps compiled text far below it), and the FL capability model (PLAN §5): a recipe can only
  call the catalogue's ops, and `PRIMITIVE` is unavailable to untrusted code.
- `maxOutputBytes` bounds `.` output and is irrelevant to recipes (they print nothing).

### 8.7 The main-thread client

```ts
import WebWorker from "@forge/worker/worker-web?worker";   // Vite's worker import: always `?worker`, never `?worker&inline`
                                                           // (inline workers are blob: URLs, which `worker-src 'self'` forbids)
const baker = createBakerClient({
  host: () => createWebWorkerHost(() => new WebWorker()),
  cancelGraceMs: 1000, deadlineGraceMs: 1000, sharedAbort: true,
});
await baker.init({ vocabs: "all" });
const result = await baker.bake(recipe, inputBytes, {
  trust: "untrusted",
  onEvent: (e) => { if (e.type === "progress") highlight(e.path); },
});
await baker.cancel();   // for example when the user types again
```

`createBakerClient(options)` returns a `BakerClient` (a `Baker` with `hardKill: true`). The Phase 3 auto-bake controller
simply calls `bake` on every debounced change: the previous bake is cancelled by the baker. `bake` before `init`
resolves with `E_NOT_READY`; `init` on a client whose worker is being restarted waits for the restart.

### 8.8 Debugging: breakpoints and stepping

`bake(…, { debug: {} })` honours `breakpoint: true` on enabled steps; `debug: { startPaused: true }` also pauses before the first
step (that pause has `reason: "start"`). Without `debug`, breakpoints are ignored (they are only recorded in the compiled text).

At a pause the core emits `{ type: "paused", id, path, reason, data }` and awaits. `step()` resumes and pauses again at the **next
step start** in execution order (a container's first child counts; so does the next sibling); `continue()` resumes until the next
breakpoint. `cancel()` ends the bake with `E_ABORTED`. `data` is the rendered top of the stack, the value that step is about to
receive. Reaching the end ends the bake normally. `step`/`continue` when not paused are ignored.

The VM does not charge the time spent awaiting an `onStep` hook to its wall-clock deadline (`vm.ts` extends the deadline by the pause), so
nothing special is done for `maxMillis`. Only the **client's** deadline timer must stop while paused (§8.5), because it runs outside the VM.

---

## 9. Op test vectors

### 9.1 Files

`packages/ops/vocab/<vocab>.test.json` holds the vectors of one vocabulary: a JSON array (schema below). The file name
matches `.fth`/`prims`, so adding a vocabulary adds its vectors beside it, and a vocabulary without a `.test.json` is a
test failure once it has an op.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:forge:schema:op-vectors:1",
  "title": "Forge operation test vectors, one file per vocabulary",
  "type": "array",
  "items": { "$ref": "#/$defs/vector" },
  "$defs": {
    "encoded": {
      "type": "object",
      "properties": {
        "value": { "type": "string" },
        "enc": { "enum": ["utf8", "hex", "latin1", "base64"] }
      },
      "required": ["value", "enc"],
      "additionalProperties": false
    },
    "vector": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "maxLength": 200 },
        "ref": { "type": "string", "maxLength": 200 },
        "op": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}:[^\\s:]{1,128}$" },
        "params": {
          "type": "object",
          "additionalProperties": {
            "oneOf": [
              { "type": "number" },
              { "type": "string" },
              { "type": "boolean" },
              { "$ref": "#/$defs/encoded" }
            ]
          }
        },
        "input": { "$ref": "#/$defs/encoded" },
        "expect": {
          "oneOf": [
            { "$ref": "#/$defs/encoded" },
            {
              "type": "object",
              "properties": { "error": { "type": "string", "pattern": "^E_[A-Z_]+$" } },
              "required": ["error"],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": { "json": {} },
              "required": ["json"],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": ["op", "params", "input", "expect"],
      "additionalProperties": false
    }
  }
}
```

A vector is `{ name?, ref?, op, params, input, expect }`:

- `op`: canonical qualified name. `params`: the recipe `params` object (§3.4): omitted parameters take the defaults.
- `input`: `{ value, enc }` decoded to the bytes given to the recipe.
- `expect`, one of:
  - `{ value, enc }`: the output, as bytes, equals these bytes. A `str` output is compared as its UTF-8 bytes, a `bytes` output as is; any other output kind fails.
  - `{ error }`: the bake fails with this code; the runner also checks `error.path`, which is `/steps/0` for run-time errors and `null` for `E_RECIPE_INVALID`.
    - A **static** violation (caught by `validateRecipe` before anything runs) expects **`{"error": "E_RECIPE_INVALID"}`**. Static checks are: parameter type and shape,
      `choice` options, `enc` allowed and valid, `min`/`max`/`oneOf`, the length forms (`minLength`/`maxLength`/`lengthOneOf`) on the decoded parameter value, `regex`
      compilation and length, `charset` rules. `amount: 26` for `classical:rot` is static.
    - A **run-time** violation expects the VM's code, typically **`{"error": "E_PARAM_INVALID"}`**. These are the `pattern` constraints (never checked statically, §3.4) and every
      constraint on the *data input* (slot 0), which the recipe does not contain. Decoding and conversion failures expect `E_COERCE`, a bad argument `E_RANGE`, and so on.
  - `{ json }`: the rendered output equals this JSON (R16), produced by `outputToJson(output: OutputValue)`:
    `str` as a string; `bool`; `num` as a JSON number (negative zero as `{"$num": "-0"}`); `int` as a number when it is a safe integer, otherwise `{"$int": "<decimal>"}` (never a bare string, which would
    be a `str`); `bytes` as `{"$bytes": "<lowercase hex>"}`; `list` as an array of the rendered items and, **when truncated** (`items.length < total`), one final element `{"$truncated": <total - items.length>}`;
    `record` as an object of the rendered values and, when truncated, an extra key `"$truncated"` with the same count; `other` as `{"$other": "<repr>"}`. Record key order does not matter when comparing, and
    a JSON `1` matches both `int 1` and `num 1.0` (the vector cannot tell them apart; give the op a distinguishing vector if it matters).
- `ref`: where the value comes from (a standard, an RFC section, a published test vector, or `"hand-computed"`).

### 9.2 Authoring rules

1. **Never obtain an expected value by running the op under test.** Use published known-answer tests (RFCs, standards,
   NIST) where they exist; otherwise compute by hand or with an independent implementation, and say so in `ref`.
2. Every op in the catalogue has at least one vector. An op that can fail has at least one error vector for each way it fails.
3. Include the empty input, a non-ASCII input (UTF-8 multi-byte), and binary input (bytes that are not valid UTF-8) wherever the op's input type allows.
4. The names `name` and `ref` are for humans and reports; they do not affect the result.

### 9.3 The runner

`runOpVectors({ baker, catalogue, files }) → VectorReport` in `packages/worker/src/vectors.ts` (WP 2.5), with a Vitest suite
`packages/worker/test/vectors.test.ts` that:

1. Finds `packages/ops/vocab/*.test.json` (Node, `node:fs`), and validates each file against `vectors.schema.json` with Ajv (a test-time dependency; `ajv` is already a root dev dependency).
2. Creates `createInProcessBaker()`, `init({ vocabs: "all" })`, and builds the catalogue with `@forge/ops`; it asserts that `catalogue.version` equals `InitInfo.catalogueVersion`.
3. For each vector: checks that `op` is a catalogue op (or alias) and that `params` names are parameters of it; builds the recipe
   `{ "forge": 1, "steps": [ { "kind": "op", "op": …, "params": … } ] }`; decodes `input`; calls
   `baker.bake(recipe, bytes, { trust: "trusted", pins: "ignore" })`; compares as in §9.1.
4. Reports `{ total, passed, failures[], uncovered[] }`; `uncovered` lists catalogue ops without a vector.
5. The suite fails if `failures` or `uncovered` is non-empty, and if a `.test.json` exists for a vocabulary that does not exist.

Failure messages show the vector (`file#index name`), the expectation and the actual result (hex for bytes).

The same runner is the Gate 4 harness in Phase 4 (browser variant: Playwright runs the runner against the client baker).

---

## 10. Gate 2 and the seed operations

### 10.1 Seed operations

Twelve ops in five vocabularies, plus the internal `recipe` vocabulary (§4.3). Their purpose is to prove every mechanism:
primitives with defaults, `choice`/`bool` parameters, an FL op with an integer constraint and an alias, FL ops that coerce `bytes`→`str`,
regex ops with `list`/`bool`/`record` outputs. Names follow R2.

| op | effect | kind | category |
|---|---|---|---|
| `base64:decode` | `( bytes alphabet:choice{standard\|url}=standard -- bytes )` | primitive | Encodings |
| `base64:encode` | `( bytes alphabet:choice{standard\|url}=standard padding:bool=true -- str )` | primitive | Encodings |
| `hex:decode` | `( bytes -- bytes )` | primitive | Encodings |
| `hex:encode` | `( bytes delimiter:choice{none\|space\|colon}=none case:choice{lower\|upper}=lower -- str )` | primitive | Encodings |
| `classical:rot` (alias `rot13`) | `( bytes amount:int[0..25]=13 -- bytes )` | FL | Classical ciphers |
| `text:upper` | `( str -- str )` | FL | Text |
| `text:lower` | `( str -- str )` | FL | Text |
| `text:reverse` | `( str -- str )` | FL | Text |
| `regex:test` | `( str pattern:regex flags:str[0..3,/[ims]*/]="" -- bool )` | primitive | Regular expressions |
| `regex:find-all` | `( str pattern:regex flags:str[0..3,/[ims]*/]="" -- list )` | primitive | Regular expressions |
| `regex:replace` | `( str pattern:regex replacement:str flags:str[0..3,/[ims]*/]="" -- str )` | primitive | Regular expressions |
| `regex:split` | `( str pattern:regex flags:str[0..3,/[ims]*/]="" -- list )` | primitive | Regular expressions |

Internal (`recipe` vocabulary, never in the catalogue): `recipe:as-bytes`, `recipe:latin1`, `recipe:base64`, `recipe:matches`,
`recipe:section`, `recipe:branch`, `recipe:repeat`, `recipe:settle` (§4.3), and the private primitive `recipe:_split-matches`.

**Semantics.**

- `base64:decode`: the data is the ASCII text (bytes). ASCII whitespace is ignored. Characters outside the chosen alphabet are an error.
  Padding is optional; if present it must be correct (the unpadded length is 0, 2 or 3 mod 4 and `=` pads to a multiple of four, only at the end).
  A length ≡ 1 (mod 4) and non-zero unused trailing bits are errors. Errors are `E_COERCE` (`from: "str"`, `to: "bytes"`, `detail.reason`).
  `standard` is `A-Za-z0-9+/`, `url` is `A-Za-z0-9-_`.
- `base64:encode`: RFC 4648; `padding: false` omits the `=`s. Returns `str`.
- `hex:decode`: pairs of hex digits (either case); ASCII whitespace (space, tab, LF, CR, VT, FF) between digits is ignored; anything else, or an odd number of digits, is `E_COERCE`.
- `hex:encode`: two digits per byte; `delimiter` is placed between bytes (`none`: nothing, `space`: one space, `colon`: `:`); `case: upper` uses `A-F`.
- `classical:rot`, `text:*`: the FL sources are `vocab/classical.fth` and `vocab/text.fth` below. `rot` is §15.1 of LANGUAGE.md.
  `text:upper` and `lower` are `String.prototype.toUpperCase`/`toLowerCase` (full Unicode mapping: `"straße"` upper is `"STRASSE"`).
  `text:reverse` reverses by code point (not by grapheme).
- `regex:*`: §4.2.

`vocab/classical.fth`:

```forth
\ classical: classical ciphers. They work on bytes and touch ASCII letters only.
IN: classical

: _rot-code ( code:int amount:int -- int )
  code 65 >= code 90 <= and
  [ code 65 - amount + 26 mod 65 + ]
  [ code 97 >= code 122 <= and
    [ code 97 - amount + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: rot ( bytes amount:int[0..25]=13 -- bytes )
  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc
  "Classical ciphers" category
  [ amount _rot-code ] map ;

META: rot
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;
```

`vocab/text.fth`:

```forth
\ text: operations on text. They take str, so bytes are decoded as strict UTF-8 first.
IN: text

: upper ( str -- str )
  "Convert to upper case." doc
  "Text" category
  core:upper ;

: lower ( str -- str )
  "Convert to lower case." doc
  "Text" category
  core:lower ;

: reverse ( str -- str )
  "Reverse the order of the characters (code points)." doc
  "Text" category
  core:rev ;
```

`vocab/base64.fth`, `vocab/hex.fth` and `vocab/regex.fth` only add parameter help to their primitives, as in
```forth
\ base64: Base64 as in RFC 4648. The words are TypeScript primitives (src/prims/base64.ts);
\ this unit only adds the parameter help.
IN: base64

META: decode
  param alphabet "The alphabet of the text: standard (+ /) or url (- _)." ;
;

META: encode
  param alphabet "The alphabet to use: standard (+ /) or url (- _)." ;
  param padding "Append = padding to a multiple of four characters." ;
;
```

### 10.2 The Gate 2 recipe

PLAN Gate 2 asks for a three-step recipe (decode base64, rotate by 13, encode as hex) built from JSON, encoded in a URL and decoded again,
that bakes identically in Node and in a Worker. With R2's names:

```json
{
  "forge": 1,
  "steps": [
    { "kind": "op", "op": "base64:decode", "params": { "alphabet": "standard" } },
    { "kind": "op", "op": "classical:rot", "params": { "amount": 13 } },
    { "kind": "op", "op": "hex:encode", "params": { "case": "lower", "delimiter": "none" } }
  ]
}
```

(This is the `normalise` form: `params` keys sorted.) Input (UTF-8 text) `VXJ5eWIsIEpiZXlxIQ==`, which is base64 of `Uryyb, Jbeyq!`.
Expected result: `base64:decode` gives the bytes of `Uryyb, Jbeyq!`; `rot` 13 gives `Hello, World!`; `hex:encode` gives the `str`
**`48656c6c6f2c20576f726c6421`**. The compiled text is §12.1.

### 10.3 The test

Test file `packages/worker/test/gate2.test.ts` (Node, Vitest), parts G2-1 to G2-3; cancellation tests G2-4 are in `packages/worker/test/cancel.test.ts`; part G2-5 is the browser run.

**G2-1 (build, encode, decode).** In Node, with the **real** catalogue (`dist/catalogue.json`, never the recipe package's fixture, so pins are real hashes):
1. Build the recipe above as a JS object; `validateRecipe` is `ok` with no issues.
2. `encodeShare({ recipe, input: bytes("VXJ5eWIsIEpiZXlxIQ=="), inputEncoding: "utf8" }, { catalogue })` is `ok` (pins added, no `secret-in-url`).
3. `decodeShare(fragment, { catalogue })` is `ok`; `decoded.recipe` deep-equals `pinRecipe(normalise(recipe), catalogue)`; `decoded.input` equals the input bytes;
   `decoded.warnings` is `[]`.
4. Also, the golden fragment of §12.5 decodes to `normalise(recipe)` (no pins).

**G2-2 (Node, in process).** `createInProcessBaker()`; `init()`; `bake(decoded.recipe, decoded.input, { trust: "trusted" })` is
`{ ok: true, output: { kind: "str", text: "48656c6c6f2c20576f726c6421" }, coercions: [], warnings: [] }`, `steps` has the three paths
`/steps/0`, `/steps/1`, `/steps/2`, each with `runs: 1`.

**G2-3 (Node, worker_threads).** The same through `createBakerClient({ host: () => createNodeWorkerHost() })`, which runs the compiled
`dist/worker-node.js`: `hardKill` is true, `init` returns the same `catalogueVersion`, and `bake(…, { trust: "untrusted" })` gives an
identical result (see **Identity**).

**G2-4 (cancellation and the watchdog).** Test-only fixture primitives live in `packages/worker/test/fixtures/fx.mjs` (plain JS, so a
worker thread can import it). They are **catalogue ops**, so recipes can call them: `fx:sleep ( bytes ms:int[0..3600000] -- bytes )` (async: resolves
after `ms`, honouring `ctx.signal`) and `fx:busy ( bytes ms:int[0..3600000] -- bytes )` (a synchronous busy-wait), both returning a **fresh copy** of the data
(LANGUAGE §10.5), both with `doc` and `category: "Test"`. The recipe step is `{ "kind": "op", "op": "fx:sleep", "params": { "ms": 60000 } }`.
`createNodeWorkerHost({ extraPrimitiveModules: [url] })` passes the module URLs in `workerData` and the worker entry appends their
`primitives` to the bundle (so `fx` is a bundle vocabulary and its docs are checked); `createInProcessBaker({ loadBundle })` does the same in process
with a `loadBundle` that wraps `loadBundleNode`. Tests:
(a) client with the real Node worker: bake a recipe with an `fx:sleep 60000` step, `cancel()` resolves within `cancelGraceMs + 500` ms
with `error.code === "E_ABORTED"` and `terminated` unset (the VM raced the cancel);
(b) same with `fx:busy 60000`: `cancel()` resolves within `cancelGraceMs + 500` ms with `E_ABORTED`, `terminated: true`, and the next
`bake` succeeds on the fresh worker (the hook count of `host()` calls is 2);
(c) deadline: `{ limits: { maxMillis: 200 } }` with `fx:busy 60000` ends with `E_LIMIT_TIME`, `terminated: true`, within `200 + deadlineGraceMs + 500` ms;
(d) unit tests of the client with a fake `WorkerHost` that never answers, covering the timers, the synthesised result, the restart, `fatal`,
`onError`, id handling, and that a late `result` of a terminated worker is ignored.

**Identity.** `stripTimings(result)` (exported by `@forge/worker`): set `stats.elapsedMs = 0` and each `steps[i].ms = 0` and `id = 1`. G2-2 and G2-3 (and G2-5) results are
**identical** iff `JSON.stringify(stripTimings(r))` is equal (bytes outputs are serialised as hex for this purpose).

**G2-5 (browser).** `packages/worker/harness/` is a Vite app (`index.html`, `main.ts`) that:
1. reads the fragment from `location.hash` (default: the golden fragment of §12.5),
2. `decodeShare`s it with the catalogue (`import url from "@forge/ops/catalogue.json?url"`),
3. creates `createBakerClient({ host: () => createWebWorkerHost(() => new WebWorker()) })` where `WebWorker` is `@forge/worker/worker-web?worker` (never `?worker&inline`),
4. `init`s, bakes, and sets `window.__gate2 = { done: true, crossOriginIsolated, sharedAbort, result: stripTimings(result) }`.

The server (a Vite config in the harness) is run twice: with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
(then `crossOriginIsolated` is true and the `SharedArrayBuffer` flag is used) and without. `packages/worker/scripts/gate2-browser.mjs` starts it, drives headless
Chromium with Playwright (a dev dependency added by WP 2.4; browsers are installed by `npx playwright install chromium`), reads `window.__gate2`
and asserts that `JSON.stringify(result)` equals the Node result of G2-2, in both modes. The script exits non-zero on any difference. `npm run gate2:browser -w @forge/worker`.
Until Playwright is part of CI (PLAN §6, Phase 3), the owner or the orchestrator MAY instead open the harness URL in the Browser pane and read
`window.__gate2`. Gate 2 passes only when G2-1 to G2-4 pass in CI and G2-5 has been run, in both modes, on the merge commit.

### 10.4 Definition of done for Phase 2

Gate 2 above, and: `npm run lint`, `typecheck`, `test` and `build` pass; the op test vectors pass (§9.3); the golden tests of §12 pass;
the three schemas validate their examples with Ajv `strict: true`; the catalogue builds with all twelve ops; no CyberChef name, format or text was copied.

---

## 11. Work packages and file layout

### 11.1 Work packages

| WP | package | scope | needs | done when |
|---|---|---|---|---|
| 2.1 | `@forge/ops` | scanner, providers, `loadBundle`, `assembleRuntime`, `buildCatalogue`, catalogue script and schema, regex engine seam, the seed vocabularies and their primitives, the `recipe` vocabulary | `types.ts` | the catalogue builds with the twelve ops and validates; `assembleRuntime` loads everything; the examples of §12.1 run on a real runtime; primitive unit tests pass |
| 2.2 | `@forge/recipe` | limits, pointer, encoding, `normalise`/`resolve`/`canonical`/`pinRecipe`, `validateRecipe`, literals, `compileRecipe`, `resolveStepIps`, `attributeError`, `recipe.schema.json` | `types.ts`; a **fixture catalogue** `test/fixtures/catalogue.json` that the WP writes by hand from §10.1 (its `hash` values are arbitrary 64-digit strings, its `version` any 16 digits; nothing in a test may depend on a fixture hash being real) | goldens of §12.1 to §12.4 pass; schema and validator agree on a corpus of valid and invalid documents (§11.3) |
| 2.3 | `@forge/recipe` | `parseRecipeText`, the share codec | 2.2's compiler (for round trips) | round-trip property of §6.5 on a corpus; share goldens and hostile cases of §7.5 and §12.5 |
| 2.4 | `@forge/worker` | `render`, core, in-process baker, `protocol`, `port`, `client`, hosts, entries, the browser harness, `gate2-browser.mjs` | 2.1 (bundle, catalogue), 2.2 (validate, compile, map); develops first against fakes | Gate 2 parts G2-1 to G2-5 (§10.3) |
| 2.5 | `@forge/worker`, `@forge/ops` | `vectors.ts` runner, its Vitest suite, `vectors.schema.json`, **the vector files of all seed vocabularies** | 2.4's in-process baker (for the runner); vector files need no code | §9.3 passes with no `failures` and no `uncovered` |

Recommended allocation to four parallel agents: **A** = 2.1; **B** = 2.2 then 2.3; **C** = 2.4; **D** = 2.5 (vector files first, runner once C's
in-process baker exists). Vector files are written by D, not A: expected values must not come from the implementation (§9.2).
Integration order: 2.1 and 2.2 first, then 2.3, then 2.4, then 2.5, then Gate 2.

### 11.2 File layout

```
packages/ops
  package.json            exports: ".", "./node", "./vite", "./catalogue.json", "./catalogue.schema.json"; files: dist, src, vocab
  tsconfig.json  tsconfig.build.json  tsconfig.scripts.json
  vocab/
    base64.fth  base64.test.json
    hex.fth     hex.test.json
    classical.fth  classical.test.json
    text.fth    text.test.json
    regex.fth   regex.test.json
    recipe.fth                           (internal: no vectors, covered by §12.1)
    vectors.schema.json                  (§9.1; the runner reads it from here)
  src/
    index.ts  types.ts                   (types.ts exists)
    scan.ts  bundle.ts  catalogue.ts  regex-engine.ts
    sources-node.ts  sources-vite.ts  ambient.d.ts
    catalogue.schema.json
    prims/ base64.ts  hex.ts  regex.ts  recipe.ts   (+ base64.test.ts … beside the sources)
  scripts/catalogue.ts                   (compiled to dist-scripts/catalogue.js)

packages/recipe
  package.json            depends on @forge/lang only
  src/
    index.ts  types.ts                   (exist)
    limits.ts  pointer.ts  encoding.ts  ambient.d.ts   (pointer escape/unescape; base64/hex/utf8/latin1 helpers)
    normalise.ts  validate.ts  literals.ts  compile.ts  stepmap.ts
    text.ts  share.ts
    recipe.schema.json
    *.test.ts
  test/ fixtures/catalogue.json  goldens/*.json|*.txt   (§12 as files)

packages/worker
  package.json            exports: ".", "./node", "./worker-web"; depends on lang, ops, recipe; dev: ajv, playwright
  src/
    index.ts  types.ts                   (exist)
    limits.ts  render.ts  core.ts  inprocess.ts  protocol.ts  port.ts  client.ts
    ambient.d.ts
    host-web.ts  host-node.ts  worker-web.ts  worker-node.ts
    vectors.ts
    *.test.ts
  test/ gate2.test.ts  cancel.test.ts  vectors.test.ts  fixtures/fx.mjs
  harness/ index.html  main.ts  vite.config.ts
  scripts/ gate2-browser.mjs
```

### 11.3 Cross-package contracts that MUST NOT drift

1. The text layout of §5.3 and `StepLine` numbering (1-based lines of the **returned text**) against `CompiledWord.positions` of the loaded text. The Baker loads exactly
   the returned `text`, never a modified copy.
2. `recipeNeedsHardKill` (§4.1) is defined once, in `@forge/recipe` (`recipeNeedsHardKill(recipe, catalogue)`), and used by the Baker.
3. The catalogue rule (§2.2) is implemented once, in `@forge/ops`; `@forge/recipe` only reads the result.
4. `OutputValue` and the vector JSON rendering (§9.1) are produced by one function, `renderValue`, plus a pure `outputToJson`.
5. Schema and validator are tested against each other: a shared corpus `packages/recipe/test/corpus/{valid,invalid}/*.json` is checked
   with Ajv and with `validateRecipe`; both MUST agree on accept/reject for structural cases.

### 11.4 Tests per package (minimum)

- **ops**: scanner (dependency order, cycle, unknown dependency, wrong `IN:`, `PRIMITIVE` rejected); each primitive's header and behaviour; regex limits and code-point offsets;
  `buildCatalogue` on a fixture runtime (rules 1 to 6 of §2.2, alias, internal vocabulary, `quot` parameter); catalogue validates against its schema; `version` is stable and changes with a doc edit; both providers
  (`sources-vite` under Vitest) produce the same bundle; `recipe.fth` examples of §12.1.
- **recipe**: every table of §3 and §5.2 (literals), normal forms, validator codes and paths, schema agreement, compile goldens, step map, attribution, text parse errors, round-trip property,
  share goldens and §7.5.
- **worker**: render (every tag, truncation, secrets), core (all `E_*` paths, pins, hard-kill refusal, coercion filter, timing, progress throttle, debug stepping), protocol validation,
  client (timers with a fake host), Gate 2, vectors.

### 11.5 Exports per package

Every function, factory and constant a package exports, with its full signature. The matching TypeScript declarations are the `*Fn` type
aliases in each `types.ts` (a WP implements a function with exactly that type). Names in `code` are the export names.

**`@forge/ops`** (main entry; no `node:fs`, no `import.meta.glob`)

| export | signature |
|---|---|
| `CATALOGUE_FORMAT`, `INTERNAL_VOCABS`, `UI_PARAM_TYPES` | consts (`types.ts`) |
| `scanVocab` | `(files: readonly SourceFile[], primitiveVocabs: readonly string[]) => ScanResult` (throws `Error` naming the file) |
| `createBundleLoader` | `(provider: VocabSourceProvider) => LoadBundleFn`, where `LoadBundleFn = (names?: readonly string[] \| "all") => Promise<VocabBundle>` |
| `assembleRuntime` | `(bundle: VocabBundle, options?: AssembleOptions) => ForgeRuntime` (throws `ForgeError`; `E_READONLY` for a unit defining into a bundle/internal vocabulary) |
| `buildCatalogue` | `(runtime: ForgeRuntime, options?: BuildCatalogueOptions) => Catalogue` |
| `isCatalogueOp` | `(meta: WordMeta) => boolean` |
| `markRegexPrimitive`, `isRegexPrimitive` | `(def: PrimitiveDef) => PrimitiveDef`, `(qname: string) => boolean` |
| `execAll`, `REGEX_LIMITS` | `(pattern: string, flags: string, text: string) => RegexMatch[]`, `RegexLimits` |

`@forge/ops/node`: `createNodeProvider(root?: string): VocabSourceProvider`, `loadBundleNode: LoadBundleFn`.
`@forge/ops/vite`: `createViteProvider(): VocabSourceProvider`, `loadBundleVite: LoadBundleFn`.
`@forge/ops/catalogue.json`, `@forge/ops/catalogue.schema.json`: data files.

**`@forge/recipe`**

| export | signature |
|---|---|
| consts | `RECIPE_FORMAT_VERSION`, `SHARE_FORMAT_VERSION`, `STEP_KINDS`, `RECIPE_LIMITS`, `SHARE_LIMITS`, `RECIPE_VOCAB`, `DEFAULT_RECIPE_WORD`, `DEFAULT_RECIPE_VOCAB`, `RECIPE_ISSUE_CODES`, `SHARE_ERROR_CODES` |
| `validateRecipe` | `(input: unknown, catalogue?: CatalogueView, options?: ValidateOptions) => ValidationResult` |
| `normaliseRecipe` | `(recipe: Recipe) => Recipe` |
| `resolveRecipe` | `(recipe: Recipe, catalogue: CatalogueView) => Recipe` |
| `canonicalRecipe` | `(recipe: Recipe, catalogue: CatalogueView) => Recipe` (`= resolveRecipe(normaliseRecipe(r), c)`) |
| `pinRecipe` | `(recipe: Recipe, catalogue: CatalogueView) => Recipe` |
| `recipeNeedsHardKill` | `(recipe: Recipe, catalogue: CatalogueView) => boolean` |
| `compileRecipe` | `(recipe: unknown, catalogue: CatalogueView, options?: CompileOptions) => CompileOutcome` |
| `resolveStepIps` | `(word: string, lines: readonly StepLine[], positions: readonly SourcePos[]) => StepIpMap` |
| `attributeError` | `(word: string, frames: readonly { word: string; ip: number }[], map: StepIpMap) => string \| null` |
| `parseRecipeText` | `(text: string, catalogue: CatalogueView) => ValidationResult` |
| `encodeShare` | `(state: ShareState, options?: EncodeShareOptions) => Promise<EncodeShareResult>` |
| `decodeShare` | `(fragment: string, options?: DecodeShareOptions) => Promise<DecodeShareResult>` |
| `escapePointer`, `unescapePointer` | `(token: string) => string` |
| `decodeEncoded`, `encodeBytes` | `(encoded: Encoded) => Uint8Array`, `(bytes: Uint8Array, enc: EncodingName) => string` |

**`@forge/worker`**

| export | signature |
|---|---|
| consts | `PROTOCOL_VERSION`, `UNTRUSTED_LIMITS`, `WATCHDOG_DEFAULTS`, `RENDER_LIMITS`, `PROGRESS_INTERVAL_MS` |
| `effectiveLimits` | `(trust: Trust, limits?: Partial<Limits>) => Limits` (`src/limits.ts`; the only limits merge, §8.6) |
| `createBakerCore` | `(options: BakerCoreOptions) => Baker` (`loadBundle` required) |
| `createInProcessBaker` | `(options: BakerCoreOptions) => Baker` |
| `attachBakerCore` | `(port: WorkerPort, core: Baker) => void` |
| `createBakerClient` | `(options: BakerClientOptions) => BakerClient` |
| `createWebWorkerHost` | `(create: () => WebWorkerLike) => WorkerHost` |
| `renderValue` | `(value: Value) => OutputValue` |
| `outputToJson` | `(output: OutputValue) => unknown` (§9.1) |
| `stripTimings` | `(result: BakeResult) => BakeResult` |
| `isClientMessage`, `isWorkerMessage` | `(value: unknown) => value is ClientMessage`, `(value: unknown) => value is WorkerMessage` |
| `runOpVectors` | `(options: RunOpVectorsOptions) => Promise<VectorReport>` |

`@forge/worker/node`: `createNodeWorkerHost(options?: NodeWorkerHostOptions): WorkerHost`. `@forge/worker/worker-web`: the Web Worker entry module (no exports; import with
`?worker`). `dist/worker-node.js`: the `worker_threads` entry.

### 11.6 Type environment and tsconfig per package

The packages build against `lib: ES2022` only, with no `@types/node` and no DOM types, like `@forge/lang` (which declares what it needs in
`node-crypto.d.ts` and `node-fs.d.ts`). The same approach everywhere: **minimal ambient declarations in a package-local `src/ambient.d.ts`**
(or `node-*.d.ts`), declaring only what the package uses.

| package | ambient declarations |
|---|---|
| `@forge/ops` | `node:fs` (`readdirSync`, `readFileSync`, `existsSync`), `node:url` (`fileURLToPath`, `pathToFileURL`), `process` if used by scripts; `performance` not needed. `import.meta.glob` types: `src/sources-vite.ts` declares the one overload it uses locally (no `vite/client` in the build) |
| `@forge/recipe` | `CompressionStream`, `DecompressionStream`, `ReadableStream`/`WritableStream` reader/writer subset, `TextEncoder`, `TextDecoder` (with `fatal`) |
| `@forge/worker` | `AbortController`/`AbortSignal` (as `AbortSignalLike` from lang plus `abort()`), `performance.now`, `setTimeout`/`clearTimeout`, `MessagePort` subset, `node:worker_threads` (`Worker`, `parentPort`, `workerData`), `Atomics`/`SharedArrayBuffer` come from ES2022; the harness has its own DOM-enabled `tsconfig` |

Each package has:

- `tsconfig.json`: `include: ["src", "test", "scripts"]` (type-checks sources, tests and scripts together; `noEmit`; the `rootDir` of the
  current ops file is dropped);
- `tsconfig.build.json`: emits `dist` from `src` only (`rootDir: src`, tests excluded, as today);
- `tsconfig.scripts.json` (`ops`: `scripts/catalogue.ts`; `worker`: `scripts/*.ts` if any are TypeScript) compiled to `dist-scripts`, as `@forge/lang` does;
- `@forge/worker/harness/tsconfig.json`: `lib` with `DOM`, `types: ["vite/client"]`.

`@forge/ops` `package.json` `files` is `["dist", "src", "vocab"]` (already applied); `@forge/recipe` and `@forge/worker` ship `["dist"]`.

---

## 12. Conformance examples

Everything in this section is a required test. Values were checked against a reference run of the FL words of §4.3 on `@forge/lang`;
`⏎` is not used: LF is written `\n` inside FL strings.

### 12.1 The Gate recipe and container semantics

The Gate 2 recipe of §10.2 compiles to (`compileRecipe`, no name, `lines` below):

```
\ forge-recipe 1
: main ( bytes -- any )
  "standard" base64:decode
  13 classical:rot
  "none" "lower" hex:encode
;
```

| path | lines | `[startIp, endIp)` | instructions |
|---|---|---|---|
| `/steps/0` | 3-3 | `[0, 2)` | `lit`, `prim base64:decode` |
| `/steps/1` | 4-4 | `[2, 4)` | `lit`, `call classical:rot` |
| `/steps/2` | 5-5 | `[4, 7)` | `lit`, `lit`, `prim hex:encode` (then `ret` at 7) |

Input `VXJ5eWIsIEpiZXlxIQ==` gives the `str` `48656c6c6f2c20576f726c6421`.

Container words (the unit `\ forge-recipe 1 / : main ( bytes -- any ) … ;` with the given body, run on the input; `regex:replace` takes `pattern replacement flags`):

| body | input | result |
|---|---|---|
| `recipe:as-bytes "[a-c]+" "" "utf8" [ "b" "X" "" regex:replace ] recipe:section` | `abc-def-cab` | `bytes` `aXc-def-caX` |
| `recipe:as-bytes 10 [ "aa" "a" "" regex:replace ] recipe:settle` | `aaaaaaaa` | `bytes` `a` |
| `recipe:as-bytes 2 [ "aa" "a" "" regex:replace ] recipe:settle` | `aaaaaaaa` | `bytes` `aa` |
| `recipe:as-bytes 3 [ "aa" "a" "" regex:replace ] recipe:repeat` | `aaaaaaaa` | `bytes` `a` |
| `recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [ "b" "B" "" regex:replace ] [ ] recipe:branch` | `abc` | `str` `aBc` |
| same | `xbc` | `bytes` `xbc` |
| `hex:decode` then `recipe:as-bytes "\n" "\n" [ text:upper ] fork` | `610a62ff0a63` | `E_COERCE` from `text:upper` (second piece is not UTF-8), see §12.6 |

`settle` with `max` 1: runs the body once and returns its result whether or not it changed.

### 12.2 A recipe that uses every step kind

Input to the recipe is the base64 text `VXJ5eWIKSmJleXE=` (`Uryyb\nJbeyq`).

```json
{
  "forge": 1,
  "name": "Demo",
  "steps": [
    { "kind": "op", "op": "base64:decode", "params": { "alphabet": "standard" } },
    { "kind": "comment", "text": "split into lines" },
    { "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "0a", "enc": "hex" },
      "steps": [
        { "kind": "op", "op": "classical:rot", "params": { "amount": 13 }, "breakpoint": true },
        { "kind": "op", "op": "text:upper", "disabled": true, "note": "off for now" }
      ] },
    { "kind": "subsection", "pattern": "[a-z]+", "flags": "i", "steps": [ { "kind": "op", "op": "text:reverse" } ] },
    { "kind": "if", "test": { "kind": "regex", "pattern": "^o" },
      "then": [ { "kind": "op", "op": "text:lower" } ], "else": [] },
    { "kind": "repeat", "until": "stable",
      "steps": [ { "kind": "op", "op": "regex:replace", "params": { "pattern": "aa", "replacement": "a" } } ] },
    { "kind": "op", "op": "hex:encode", "params": { "delimiter": "space" } }
  ]
}
```

Compiled text (line numbers on the left are not part of the text):

```
 1  \ forge-recipe 1
 2  \ name "Demo"
 3  : main ( bytes -- any )
 4    "standard" base64:decode
 5    \ # "split into lines"
 6    recipe:as-bytes "\n" #[ 0a ] [
 7      13 classical:rot  \ @break
 8      \ ~ text:upper  \ @note="off for now"
 9    ] fork
10    recipe:as-bytes "[a-z]+" "i" "utf8" [
11      text:reverse
12    ] recipe:section
13    recipe:as-bytes [ "^o" "" "utf8" recipe:matches ] [
14      text:lower
15    ] [
16    ] recipe:branch
17    recipe:as-bytes 100 [
18      "aa" "a" "" regex:replace
19    ] recipe:settle
20    "space" "lower" hex:encode
21  ;
```

`StepLine[]` (document order):

| path | kind | lines | disabled |
|---|---|---|---|
| `/steps/0` | op | 4-4 | no |
| `/steps/1` | comment | 5-5 | no |
| `/steps/2` | fork | 6-9 | no |
| `/steps/2/steps/0` | op | 7-7 | no (`breakpoint: true`) |
| `/steps/2/steps/1` | op | 8-8 | **yes** |
| `/steps/3` | subsection | 10-12 | no |
| `/steps/3/steps/0` | op | 11-11 | no |
| `/steps/4` | if | 13-16 | no |
| `/steps/4/then/0` | op | 14-14 | no |
| `/steps/5` | repeat | 17-19 | no |
| `/steps/5/steps/0` | op | 18-18 | no |
| `/steps/6` | op | 20-20 | no |

The loaded word has 44 instructions (`ret` at 43). `resolveStepIps` gives (the comment and the disabled step have no entry):

| path | `[startIp, endIp)` |
|---|---|
| `/steps/0` | `[0, 2)` |
| `/steps/2` | `[2, 10)` |
| `/steps/2/steps/0` | `[6, 8)` |
| `/steps/3` | `[10, 18)` |
| `/steps/3/steps/0` | `[15, 16)` |
| `/steps/4` | `[18, 31)` |
| `/steps/4/then/0` | `[26, 27)` |
| `/steps/5` | `[31, 40)` |
| `/steps/5/steps/0` | `[34, 38)` |
| `/steps/6` | `[40, 43)` |

`events` (ip: ends | starts): `0: - | /steps/0`; `2: /steps/0 | /steps/2`; `6: - | /steps/2/steps/0`; `8: /steps/2/steps/0 | -`;
`10: /steps/2 | /steps/3`; `15: - | /steps/3/steps/0`; `16: /steps/3/steps/0 | -`; `18: /steps/3 | /steps/4`; `26: - | /steps/4/then/0`;
`27: /steps/4/then/0 | -`; `31: /steps/4 | /steps/5`; `34: - | /steps/5/steps/0`; `38: /steps/5/steps/0 | -`; `40: /steps/5 | /steps/6`; `43: /steps/6 | -`.
`breakpoints`: `[ { "word": "bake:main", "ip": 6 } ]`.

Result of baking: `{ kind: "str", text: "6f 6c 6c 65 68 0a 64 6c 72 6f 77" }`. The path `/steps/2/steps/0` has `runs: 2` (once per piece); with
`debug: {}` the bake pauses (reason `breakpoint`) before the first piece with `data` = the bytes `Uryyb`, and again before the second.

### 12.3 Text and canonical JSON

`parseRecipeText` of the text in §12.2 returns this recipe (canonical: every parameter explicit, `else` and `flags` etc. omitted; shown wrapped):

```json
{"forge":1,"name":"Demo","steps":[{"kind":"op","op":"base64:decode","params":{"alphabet":"standard"}},{"kind":"comment","text":"split into lines"},{"kind":"fork","split":{"value":"\n","enc":"utf8"},"join":{"value":"0a","enc":"hex"},"steps":[{"kind":"op","op":"classical:rot","params":{"amount":13},"breakpoint":true},{"kind":"op","op":"text:upper","disabled":true,"note":"off for now"}]},{"kind":"subsection","pattern":"[a-z]+","flags":"i","steps":[{"kind":"op","op":"text:reverse"}]},{"kind":"if","test":{"kind":"regex","pattern":"^o"},"then":[{"kind":"op","op":"text:lower"}]},{"kind":"repeat","until":"stable","steps":[{"kind":"op","op":"regex:replace","params":{"pattern":"aa","replacement":"a","flags":""}}]},{"kind":"op","op":"hex:encode","params":{"delimiter":"space","case":"lower"}}]}
```

and `compileRecipe` of that JSON returns the text of §12.2 again. Further literal and annotation examples (each line is an op step; the hash is illustrative):

| JSON step | text line |
|---|---|
| `{"kind":"op","op":"classical:rot","params":{"amount":13},"hash":"0000…0000 (64 digits)","breakpoint":true,"note":"a \"b\""}` | `13 classical:rot  \ @pin=000…000 @break @note="a \"b\""` |
| a `toggle` parameter `{"value":"héllo","enc":"latin1"}` (`é` is U+00E9, not a control character, so it is written raw) | `"héllo" recipe:latin1` |
| `{"value":"3q2+7w","enc":"base64"}` | `"3q2+7w==" recipe:base64` |
| `{"value":"DE AD","enc":"hex"}` | `#[ de ad ]` |
| `{"value":"tab\there","enc":"utf8"}` | `"tab\there"` |
| a `num` parameter `2` | `2.0`; `0.5` → `0.5`; `1e21` → `1e+21` |
| a `str` parameter `a"b\c` | `"a\"b\\c"` |

### 12.4 Normal forms and validation

`normalise`:

| input | output |
|---|---|
| `{"steps":[],"forge":1}` | `{"forge":1,"steps":[]}` |
| `{"forge":1,"name":"","steps":[{"kind":"op","op":"text:upper","params":{},"disabled":false,"note":""},{"kind":"subsection","pattern":"a","flags":"mi","encoding":"utf8","steps":[]},{"kind":"repeat","until":"stable","max":100,"steps":[]}]}` | `{"forge":1,"steps":[{"kind":"op","op":"text:upper"},{"kind":"subsection","pattern":"a","flags":"im","steps":[]},{"kind":"repeat","until":"stable","steps":[]}]}` |
| `{"value":"DE AD","enc":"hex"}` as a fork `split` | `{"value":"dead","enc":"hex"}` |
| `{"value":"3q2+7w","enc":"base64"}` | `{"value":"3q2+7w==","enc":"base64"}` |

`resolve`: `{"kind":"op","op":"classical:rot13"}` becomes `{"kind":"op","op":"classical:rot","params":{"amount":13}}`;
`{"op":"classical:rot","params":{"amount":"13"}}` becomes `{"amount":13}` (a decimal `int` string that fits a safe integer becomes a number); an `int`
parameter `"9007199254740993"` stays that string; `"007"` and `"-0"` are `bad-param` (leading zero). A `bytes` parameter `"DE AD"` becomes `"dead"`.

`validateRecipe` (with the seed catalogue). Each row is a recipe fragment `{"forge":1,"steps":[ … ]}` unless stated:

| step or document | issues (code, severity, path, detail) |
|---|---|
| `{"forge":2,"steps":[]}` | `bad-version` error `/forge` |
| `{"forge":1}` | `required` error `/steps` (`field: "steps"`) |
| `{"kind":"wat"}` | `bad-kind` error `/steps/0/kind` |
| `{"kind":"op","op":"nope:x"}` | `unknown-op` error `/steps/0/op` |
| `{"kind":"op","op":"text:upper","extra":1}` | `unknown-field` error `/steps/0/extra` |
| `{"kind":"op","op":"classical:rot","params":{"amount":26}}` | `bad-param` error `/steps/0/params/amount` (`constraint: "[0..25]"`) |
| `{"kind":"op","op":"classical:rot","params":{"amount":13,"shift":1}}` | `unknown-param` error `/steps/0/params/shift` |
| `{"kind":"op","op":"regex:replace","params":{"pattern":"a"}}` | `missing-param` error `/steps/0/params/replacement` |
| `{"kind":"op","op":"base64:decode","params":{"alphabet":"nope"}}` | `bad-param` error `/steps/0/params/alphabet` (`reason`: not an option) |
| `{"kind":"fork","split":{"value":"zz","enc":"hex"},"join":{"value":"0a","enc":"hex"},"steps":[]}` | `bad-encoding` error `/steps/0/split/value` |
| `{"kind":"fork","split":{"value":"","enc":"utf8"},"join":{"value":"","enc":"utf8"},"steps":[]}` | `bad-value` error `/steps/0/split/value` (`constraint: "minLength 1"`); the empty `join` is fine |
| `{"kind":"fork","split":{"value":" ","enc":"hex"},"join":{"value":"","enc":"utf8"},"steps":[]}` | `bad-value` error `/steps/0/split/value` (`constraint: "non-empty separator"`: it decodes to no bytes; validator-only) |
| `{"kind":"op","op":"classical:rot","params":{"amount":"007"}}` | `bad-param` error `/steps/0/params/amount` (leading zero) |
| `{"kind":"op","op":"regex:test","params":{"pattern":"("}}` | `bad-regex` error `/steps/0/params/pattern` |
| an op step whose `params` object has the own key `__proto__` (made with `JSON.parse`) | `unknown-param` error `/steps/0/params/__proto__`; `Object.prototype` untouched |
| `{"kind":"subsection","pattern":"(","steps":[]}` | `bad-regex` error `/steps/0/pattern` |
| `{"kind":"subsection","pattern":"a","flags":"g","steps":[]}` | `bad-value` error `/steps/0/flags` |
| `{"kind":"repeat","steps":[]}` | `exclusive` error `/steps/0` |
| `{"kind":"repeat","times":0,"steps":[]}` | `bad-value` error `/steps/0/times` |
| `{"kind":"if","test":{"kind":"op","op":"hex:encode"},"then":[]}` | `not-predicate` error `/steps/0/test/op` (`output: "str"`) |
| `{"kind":"op","op":"classical:rot13"}` | `alias-used` warning `/steps/0/op` (`canonical: "classical:rot"`); `ok` is true |
| `{"kind":"op","op":"text:upper","hash":"<64 hex ≠ catalogue>"}` | `hash-mismatch` warning `/steps/0/hash` (error with `pins: "strict"`; nothing with `"ignore"`) |
| nine nested `fork`s | `limit` error (`limit: "maxDepth"`) at the path of the ninth |
| 501 `comment` steps | `limit` error (`limit: "maxSteps"`) |

### 12.5 Share fragments

The Gate 2 recipe (no `name`, no pins) with input `VXJ5eWIsIEpiZXlxIQ==` and `ie` `utf8`. This is a **decode golden** (an encoder may produce different bytes):

```
#v=1&r=1bY2xDgIhEAX_5dU0F43F_oqx2IP1jggsYTGaEP7dWBqvmW5mBu7aNgEtDtalGug68IglgKAV7gvCyiaXMwXxGgQOlRtnAw1wqjuv0kGwziVwC5jTHTR8YrPoOVHT_tvI-iwdtJyOzV3eJOVv7dkEhKQvaXAIkmKOXRoIRYtgztv8AA&i=0VlhKNWVXSXNJRXBpWlhseElRPT0&ie=utf8
```

It decodes to the recipe `{"forge":1,"steps":[{"kind":"op","op":"base64:decode","params":{"alphabet":"standard"}},{"kind":"op","op":"classical:rot","params":{"amount":13}},{"kind":"op","op":"hex:encode","params":{"case":"lower","delimiter":"none"}}]}`
(224 bytes of JSON; the `r` payload is method `1`), to the input bytes of `VXJ5eWIsIEpiZXlxIQ==` (method `0`: `VlhKNWVXSXNJRXBpWlhseElRPT0` is that text in base64url) and `inputEncoding` `utf8`.

Hostile (§7.5): `#v=2&r=0e30` is `unsupported-version`; `#r=0e30` and `#v=1&r=0e30&r=0e30` are `malformed`; `#v=1&r=0e30` (the payload is `{}`) is `invalid-recipe`
with `required` at `/forge` and at `/steps`; `#v=1&r=0A` is `bad-base64`; `#v=1&r=1!!!!` is `malformed`. The bomb and deep-nesting cases are built by the test.

### 12.6 Attributing errors, coercions

Recipe `[ hex:decode, fork "\n"/"\n" [ text:upper ] ]` (text of §5.3 form):

```
\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes "\n" "\n" [
    text:upper
  ] fork
;
```

Ranges: `/steps/0` `[0, 1)`, `/steps/1` `[1, 8)`, `/steps/1/steps/0` `[5, 6)`. Input `610a62ff0a63` (the text of a hex string): the second piece is `62 ff`, not UTF-8, so
`text:upper` fails: `error.code` `E_COERCE`, `error.word` `text:upper`, VM frames `[ bake:main@5, bake:main@7, <console>@0 ]`; `attributeError` takes the first
`bake:main` frame (ip 5) and returns `/steps/1/steps/0`, which is `BakeError.path`. With the one-step recipe `[ hex:decode, text:upper ]` and input `ff`: `E_COERCE` at `/steps/1`.
With input `6162` the second recipe succeeds: output `{ kind: "str", text: "AB" }` and `coercions` is `[ { path: "/steps/1", op: "text:upper", from: "bytes", to: "str" } ]`.

### 12.7 Seed vectors (minimum set)

Required entries of the vector files (more are welcome). `enc` is `utf8` unless shown. Errors are the `expect.error`.

| op | params | input | expect |
|---|---|---|---|
| `base64:encode` | | `""` | `""` |
| `base64:encode` | | `f`, `fo`, `foo`, `foob`, `fooba`, `foobar` (RFC 4648 §10) | `Zg==`, `Zm8=`, `Zm9v`, `Zm9vYg==`, `Zm9vYmE=`, `Zm9vYmFy` |
| `base64:encode` | `padding: false` | `f` | `Zg` |
| `base64:encode` | `alphabet: "url"` | hex `fbff` | `-_8=` |
| `base64:encode` | | hex `fbff` | `+/8=` |
| `base64:decode` | | the seven RFC 4648 encodings above | the seven inputs |
| `base64:decode` | | `Zg` (no padding) | `f` |
| `base64:decode` | | `Zm9v\nYmFy` | `foobar` |
| `base64:decode` | `alphabet: "url"` | `-_8` | hex `fbff` |
| `base64:decode` | | `-_8` (url characters, standard alphabet) | error `E_COERCE` |
| `base64:decode` | | `Zg=`, `Zh==`, `Z`, `Zm9v!` | error `E_COERCE` |
| `hex:encode` | | `foobar` | `666f6f626172` |
| `hex:encode` | | `""` | `""` |
| `hex:encode` | `delimiter: "space"` | `foo` | `66 6f 6f` |
| `hex:encode` | `delimiter: "colon"`, `case: "upper"` | hex `ff0a` | `FF:0A` |
| `hex:decode` | | `666f6f` | `foo` |
| `hex:decode` | | `66 6F\n6f` | `foo` |
| `hex:decode` | | `6`, `zz` | error `E_COERCE` |
| `classical:rot` | | `Hello` | `Uryyb` |
| `classical:rot` | `amount: 25` | `abc XYZ` | `zab WXY` |
| `classical:rot` | `amount: 0` | `Hello` | `Hello` |
| `classical:rot` | `amount: 1` | hex `ff41` | hex `ff42` |
| `classical:rot` | | `Grüße, Welt!` | `Teüßr, Jryg!` |
| `classical:rot` | `amount: 26` | `a` | error `E_RECIPE_INVALID` |
| `text:upper` | | `straße` | `STRASSE` |
| `text:lower` | | `ÀB` | `àb` |
| `text:reverse` | | `a😀b` | `b😀a` |
| `text:upper` | | hex `ff` | error `E_COERCE` |
| `regex:test` | `pattern: "^h"` | `Hello` | `{json: false}`; with `flags: "i"`: `{json: true}` |
| `regex:find-all` | `pattern: "\\d+"` | `a1b22` | `{json: [{"start":1,"end":2,"text":"1","groups":[]},{"start":3,"end":5,"text":"22","groups":[]}]}` |
| `regex:find-all` | `pattern: "\\d"` | `😀a1` | `{json: [{"start":2,"end":3,"text":"1","groups":[]}]}` |
| `regex:replace` | `pattern: "(\\w+) (\\w+)"`, `replacement: "$2, $1"` | `John Smith` | `Smith, John` |
| `regex:split` | `pattern: "\\d+"` | `a1b22c` | `{json: ["a","b","c"]}` |
| `regex:split` | `pattern: ","` | `a,b,,c` | `{json: ["a","b","","c"]}` |
