# Forge — Project Plan

Status: draft v1 (2026-11-09). Supporting research: [research/cyberchef.md](research/cyberchef.md), [research/forth.md](research/forth.md).

## 1. What Forge is

Forge is a browser-only toolkit for working with codes, ciphers and data encodings, in the spirit of GCHQ's CyberChef. Users search a catalogue of **operations**, drag them into a **recipe**, set their parameters, and watch input turn into output. Nothing leaves the browser.

Two things set Forge apart:

1. **Everything is a word.** The core is a small Forth-like language, called *Forge* here and *FL* for short. Operations are FL words, often defined in FL itself and sometimes backed by TypeScript primitives. A recipe is also just a compiled FL word, so recipes can be nested, named, shared and reused as operations.
2. **Vocabularies.** Words are grouped into vocabularies such as `base64`, `classical`, `xor` or `hash`, so that names never collide and third-party word sets (later including Relix) can be plugged in.

### Guiding principles

- **Client-side only.** The backend serves static files. A later, optional recipe store is the only server-side state.
- **One metadata record per word** drives the UI form, validation, help, search, docs, URL encoding and tests. It is never duplicated by hand.
- **Bytes are the canonical data type.** Text always carries an explicit encoding, and bytes are never silently round-tripped through JS strings.
- **Validation is first-class.** Parameters reach a word only after schema validation.
- **Untrusted by default.** Shared recipes and vocabularies run with hard resource limits, have no ambient capabilities, and their metadata is treated as text.
- **Inspired by CyberChef, not compatible with it.** Forge takes CyberChef's feature set as a reference for *capability coverage*. It does not aim for compatibility: operation names, parameters, defaults, behaviours, recipe formats and URLs are Forge's own, and they change wherever a cleaner design is possible. Importing CyberChef recipes is not a goal; at most it could be an optional, best-effort converter later.
- **Independent implementation.** CyberChef is Apache-2.0 under Crown Copyright. No code, description strings, data tables or branding are copied. See research §6.

## 2. Repository

A single public monorepo, `forge` (npm workspaces, Node ≥ 20, TypeScript strict, Vite, Lit, Vitest, ESLint and Prettier). Licensing matches Relix: Apache License 2.0 (`LICENSE.txt`), a `NOTICE` file, and the standard header "Copyright 2026 Darkcollective, LLC" at the top of every source file. It is public at https://github.com/DarkCollective/forge. Commits and PRs carry **no AI/tool attribution trailers**.

```
packages/lang     @forge/lang   FL language: reader, compiler, VM, values, vocabularies, metadata
packages/ops      @forge/ops    Operation vocabularies (vocab/*.fth), TS primitives, internal `recipe` vocab, catalogue
packages/recipe   @forge/recipe Recipe model, JSON schema, URL codec, recipe→word compiler  (Phase 2)
packages/worker   @forge/worker Web Worker host: baking, cancellation, limits             (Phase 2)
apps/web          @forge/web    The Lit UI
apps/cli          @forge/cli    Node CLI running recipes                                   (Phase 6)
docs/                           PLAN, language spec, ADRs, research
```

Packages are added when their phase starts, not before.

## 3. The language (FL)

### 3.1 Values

Values on the stack are tagged:

| tag | JS repr | notes |
|---|---|---|
| `bytes` | `Uint8Array` | canonical interchange type |
| `str` | `string` | Unicode text |
| `int` | `number` (safe int) / `bigint` on overflow | |
| `num` | `number` | float |
| `bool` | `boolean` | |
| `list` | `Value[]` | |
| `quot` | compiled code ref | `[ ... ]` quotations |
| `record` | `Map<string, Value>` | structured results (parsed headers, JSON, …) |
| `file` | `{name, type, bytes}` | later |

A small **coercion table** (for example `str→bytes` as UTF-8 and `bytes→str` as UTF-8 strict) is applied only at word boundaries, when the declared input type differs. It is strict by default: invalid UTF-8 is an error, not U+FFFD. Every coercion is recorded in the trace so the UI can show it. Coercion applies to inputs only, and v0.1 has exactly two coercion pairs: `str↔bytes` (strict UTF-8) and `int↔num` (exact). `int` payloads are always normalised. Ops that make sense on arbitrary data (ROT, XOR, substitution) are declared over `bytes`, so binary input never hits a UTF-8 error. The authoritative definition is [LANGUAGE.md](LANGUAGE.md).

### 3.2 Syntax

The syntax is classic Forth-style whitespace-delimited tokens, plus a few structured forms:

```forth
USING: core text ;           \ imports for this source unit
IN: classical                \ vocabulary new definitions go into

: rot ( str  amount:int[1..25]=13  -- str )
  "Rotate each Latin letter by a fixed amount." doc
  "Classical ciphers" category
  [ amount rotate-letter ] map-chars ;

META: rot
  param amount  "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;
```

- **Stack-effect header** `( inputs -- outputs )` is mandatory on exported words. Each *input* after the first (the data input) can be a **parameter**, written `name:type[constraint]=default`. Parameter types are `int`, `num`, `str`, `bool`, `bytes`, `choice{a|b|c}`, `toggle{hex|utf8|latin1|base64}` (CyberChef's toggleString), `regex`, `charset` and `key` (bytes with an encoding picker).
- **Parameters are passed on the stack** in declaration order, so a recipe step is simply `<literals> word`. Inside the body they are also **bound as named locals**, as in Factor's `::`, so a five-parameter cipher needs no stack juggling.
- The header and `META:` desugar to one **JSON metadata record** stored on the dictionary entry. Its fields are `name`, `vocab`, `effect`, `params[]`, `category`, `doc`, `aliases`, `seeAlso`, `effects` (`+random`, `+time`, `+async`) and `version`/`hash`. The TS registry and the UI read only this record. `"…" doc` and `"…" category` are allowed only straight after the header, and a `META:` block ends with an empty `;`. Parameters of type `toggle`, `key` and `charset` reach the word already decoded (`bytes`/`str`). In recipe JSON they are `{value, enc}`, and the recipe compiler decodes them.
- **Quotations** `[ ... ]` are first-class and support combinators: `map`, `each`, `if`, `times`, `fork`, `try`.
- **Defining words** are `:` and `;`, `CONSTANT`, `VARIABLE` (scoped per run) and `PRIMITIVE` (binds only to TS registry entries; it cannot be used from untrusted code).

### 3.3 Vocabularies and name resolution

- A vocabulary is a wordlist with a name. Word and vocabulary names are **case-sensitive**, written in lower-kebab-case by convention.
- Every source unit and console session has a **current vocabulary**. In a source unit it is set with `IN: classical`; at the console it is set with `VOCAB classical` and shown by `current-vocab`. The console also has a vocab picker, and the setting persists for the session. New definitions go into the current vocabulary, **and unqualified names resolve there first**, so with current vocab `classical`, `rot` means `classical:rot`.
- Resolution is **lexical per source unit**, not a mutable global search order. Lookup goes through the current vocabulary, then all `USING:` vocabularies together, then `core`. The current vocabulary shadows imports, and imports shadow `core`. Words named `_name` are private to their vocabulary.
- A qualified reference `vocab:word` always resolves through exactly that vocabulary, whatever the current vocabulary is.
- An unqualified name that is not in the current vocabulary but is found in two `USING:` vocabularies is a **compile error**, which is resolved by qualifying it.
- Recipes and saved words always store **fully qualified names**, plus a word version or content hash, so their meaning cannot drift.
- Classic `ALSO`/`ONLY`/`PREVIOUS` are left out on purpose.

### 3.4 Execution model

- A compiler turns the source into a **flat instruction array** per word (literal, call, primitive call, branch, quotation ref). Interpreting that array in a VM loop with explicit data and return stacks gives:
  - single-step and breakpoints at instruction or recipe-step granularity;
  - an execution trace (stack snapshots per step) for the debugger UI;
  - cooperative cancellation through `AbortSignal` (polled every N steps), plus an optional `SharedArrayBuffer` abort flag; the VM yields to the event loop periodically;
  - **resource limits**: max steps, stack depth, return depth, bytes per value and total, and a wall-clock deadline;
  - **async primitives** (WebCrypto, CompressionStream, lazily loaded WASM). A primitive may return a Promise, and the loop awaits it.
- The VM runs identically in Node (tests and CLI) and in a Web Worker (the UI). There is one async code path, never a sync/async split.
- Errors are structured `ForgeError` values: code, message, word/vocab, position, call frames, stack snapshot and detail (LANGUAGE.md §11). They are never smuggled into output text.

### 3.5 Primitives (the TypeScript FFI)

```ts
definePrimitive({
  vocab: "base64", name: "decode-raw",
  effect: "( str alphabet:str -- bytes )",
  fn: (input: string, alphabet: string): Uint8Array => { … },
});
```

The runtime pops values, coerces and validates them, calls `fn` with plain JS values, validates the result and pushes it. Primitives never touch the stack. That makes them pure, unit-testable functions, and a stack-discipline bug in a primitive cannot corrupt the VM. Heavy dependencies sit only behind primitives in lazily loaded modules, and a lint rule stops `@forge/lang` from importing them.

**FL first.** Ops are written in FL wherever feasible, including codecs and ciphers. A TypeScript primitive is allowed only when the core cannot express something (for example `analysis:_log2`, since the core has no logarithm) or when FL is too slow on realistic input, measured at 64 KiB. Even then the primitive is a minimal private `_helper`, and the op logic and metadata stay in FL. Hashes, compression and WebCrypto-backed work are the expected primitives of later phases.

The shared internal vocabulary `raise` gives FL ops typed errors, because FL's own `fail` gives only `E_USER`. `raise:coerce ( reason:str -- )` raises `E_COERCE` for data that cannot be decoded, and `raise:range ( reason:str -- )` raises `E_RANGE` for a bad argument. The `raise` words have no outputs, so they are not catalogue ops.

### 3.6 Recipes are words

The recipe model in `@forge/recipe` is a **tree**, not a flat list. Flow control is structural (step kinds `op`, `fork`, `subsection`, `if`, `repeat`, `comment`), which fixes CyberChef's Fork/Merge-by-name problem. **[RECIPES.md](RECIPES.md) is the authoritative Phase 2 spec**; this section is a summary.

- A recipe compiles deterministically to an FL word `( bytes -- any )`. Literals are pushed and then the qualified op is called; container steps compile to quotations passed to `fork` / `recipe:*` words.
- The compiled FL **is** the canonical human-readable text form. It is parsed back by a restricted line parser (never `runtime.load`), so JSON → text → JSON is the identity on canonical JSON. Disabled steps become `\ ~` comment lines.
- The UI edits only the JSON. Words hand-written outside the canonical subset appear as a single opaque step.
- **Named parameters**, defaults resolved from the catalogue and optional per-step op hashes (pinning) mean that adding a parameter to an op never breaks old links.
- **Share URL**: `#v=1&r=…&i=…&ie=…`, base64url of deflate-raw JSON, versioned, size-capped, and decoded under an output budget because fragments are untrusted.
- A saved recipe can be **promoted to a word** in the user's `user` vocabulary and then appears in the operations list like any other op.

## 4. The UI (`apps/web`)

It uses Lit web components and plain CSS grid with custom properties for themes (light, dark and high-contrast). The layout is responsive, and accessibility (keyboard drag-and-drop, ARIA) is part of the definition of done.

| Pane | Features |
|---|---|
| **Operations** | Categories, favourites, fuzzy search over names, aliases and docs, hover help from metadata, drag to recipe or double-click to append |
| **Recipe** | Drag-and-drop reorder; nested blocks for fork/subsection; per-step parameter form generated from metadata with inline validation errors; disable, breakpoint and step controls; save/load; "view as FL" |
| **Input** | Multiple tabs, file drop (bytes), encoding and EOL selectors, length and entropy readout |
| **Output** | Text/hex/rendered views, copy, download, "move to input", highlighting where ops support it, structured error panel with step index |
| **Console** *(Forge-specific, toggleable)* | FL REPL with stack display; define words in a `user` vocabulary; inspect any word's source and metadata |

- **Auto-bake** is debounced. Baking happens in a Worker (`@forge/worker`), cancelling the previous bake on change. A watchdog terminates the Worker as a last resort.
- **Persistence**: saved recipes, user words, favourites and options go to IndexedDB (via a small wrapper). URL sharing comes first. An optional backend recipe store comes in Phase 6, behind a `RecipeStore` interface so the UI does not change.
- **Pane layout** is user-resizable and collapsible, and remembered per browser.

## 5. Security model

- FL has **no ambient authority**: no DOM, fetch, storage or eval words. The capability set is the primitive registry. A network operation such as HTTP request, if ever added, would be a separately granted capability with a confirmation prompt.
- Recipes from URLs may reference only registered words and cannot define primitives. User vocabularies loaded from files can define FL words, which can never exceed what primitives allow.
- All baking happens in a Worker with hard limits (§3.4). The CloudFront response-headers policy (§10) enforces a strict CSP and cross-origin isolation.
- Metadata, help and errors are rendered as text or sanitised Markdown, never raw HTML. Regex parameters are bounded in length. In v1 a regex is time-boxed by hard kill: the client watchdog terminates the bake Worker. A bounded regex engine can replace it in Phase 5 behind one seam (`regex-engine.ts`).

## 6. Testing and quality

- **Unit tests** cover the reader, compiler, VM, coercion and every primitive (Vitest, run in Node).
- **Operation conformance tests**: each word has a test vectors table (`vocab/<name>.test.json`). A generic runner executes all of them through the VM. Vectors come from RFCs and standards, and published known-answer tests are preferred. The same vectors run in Chromium Web Workers with `npm run gate4:browser -w @forge/worker`, and a data-driven UI smoke test (`apps/web/e2e/ops-smoke.spec.ts`) exercises every op through the UI. Multi-step recipes across vocabularies are covered by `packages/worker/test/phase4-recipes.test.ts`.
- **Golden recipe tests** check the JSON ⇄ FL ⇄ URL round-trip, and that compiled output is identical.
- **Property tests** (fast-check) check `decode(encode(x)) == x` for every codec pair.
- **Browser end-to-end** (Playwright; used by `@forge/worker` for the Gate 2 harness from Phase 2, full UI suite from Phase 3) covers drag-and-drop, param validation, bake, share URL and keyboard-only use.
- **CI** runs lint, typecheck, tests, build and e2e on every PR. Bundle-size budget: the core plus UI shell must be under 250 kB gzip, and op modules are lazy.

## 7. Phases and work packages

Each work package (WP) is sized for one sub-agent and has a verifiable "done". The orchestrator reviews every WP's diff and re-runs the full CI locally before merging. **Gate** = what must be true before the next phase starts.

### Phase 0 — Foundations ✅
- Monorepo scaffold, CI, licence and research. *Done 2026-11-09.*

### Phase 1 — Language core (`@forge/lang`) ✅
*Done 2026-11-09. Spec: [LANGUAGE.md](LANGUAGE.md). All 171 conformance tests pass, and 1,342 tests in total. `npm run repl` starts a console.*

| WP | Scope | Done when |
|---|---|---|
| 1.1 | `docs/LANGUAGE.md` spec (grammar EBNF, value model, coercions, header and META syntax, resolution rules, error codes) | reviewed and frozen as v0.1 |
| 1.2 | Reader/tokenizer with source positions; string, number, char and byte-literal (`#[ de ad ]`) forms | 100% branch coverage of the grammar |
| 1.3 | Values, coercion table, `ForgeError` | unit tests per coercion pair |
| 1.4 | Dictionary, vocabularies, `IN:`/`USING:`, qualified lookup, ambiguity errors | resolution test matrix |
| 1.5 | Compiler to instruction arrays; quotations; locals for parameters; `:` `;` `CONSTANT` `VARIABLE` | compiles the spec examples |
| 1.6 | VM: run loop, async primitives, AbortSignal, limits, step/breakpoint hooks, trace | limit and cancel tests; 1e6 simple steps < 200 ms including event-loop yields |
| 1.7 | Primitive registry/FFI + `core` vocabulary (stack, arithmetic, control, combinators, bytes/str basics) | core words documented and tested |
| 1.8 | Metadata desugaring (header + META → JSON) with a JSON Schema; synchronous SHA-256 word hashes covering callees; `help`/`see`/`words`/`vocabs`/`current-vocab` are runtime-supplied | schema-validated for every word |
| 1.9 | Node REPL script for development | `npm run repl` works |

**Gate 1:** `classical:rot` is written in FL with a validated parameter, runs in Node, and its metadata JSON validates.

### Phase 2 — Operation runtime (`@forge/recipe`, `@forge/worker`, `@forge/ops` loader) ✅
*Done 2026-11-09. Spec: [RECIPES.md](RECIPES.md). Gate 2 passes in Node, in `worker_threads`, and in Chromium Web Workers with and without cross-origin isolation (`npm run gate2:browser -w @forge/worker`). All 151 seed op vectors pass; 2,366 tests in total.*

| WP | Scope |
|---|---|
| 2.1 | `.fth` vocabulary loading via a Node fs provider and Vite `import.meta.glob`, with no plugin; dependency order from `USING:`; catalogue JSON derived at build time, no hand-maintained registry |
| 2.2 | Recipe JSON schema + validator + recipe→FL compiler (incl. fork/subsection/conditional/label-free loops) |
| 2.3 | URL codec (versioned, deflate+base64url) + human-readable FL form; round-trip goldens |
| 2.4 | Worker host: bake API, cancellation, watchdog, lazy primitive module loading, progress events |
| 2.5 | Conformance test runner for `*.test.json` vectors |

**Gate 2:** A three-step recipe (from-base64 → rot13 → to-hex) built from JSON, encoded in a URL and decoded again bakes identically in Node and in a Worker.

### Phase 3 — UI (`apps/web`) ✅
*Done 2026-11-10. Spec: [UI.md](UI.md). Gate 3 passes in the committed Playwright suite (keyboard-only `gate3.spec.ts`) against the production build with the production headers. 71 e2e tests, including 40 axe audits with zero violations; 2,653 unit tests; site pages; infra applied, live at forge.darkcollective.com pending first deploy.*

| WP | Scope |
|---|---|
| 3.1 | App shell: resizable four-pane layout, themes, responsive breakpoints, design tokens |
| 3.2 | Operations pane: catalogue, categories, favourites, fuzzy search, help popovers |
| 3.3 | Recipe pane: drag-and-drop (pointer and keyboard), nested blocks, step controls |
| 3.4 | Parameter form generator from metadata + inline validation |
| 3.5 | Input/Output panes: tabs, files, encodings, hex view, download, error panel |
| 3.6 | Bake controller: auto-bake, step/breakpoint UI, timing, URL state sync |
| 3.7 | Persistence (IndexedDB): saved recipes, favourites, options; promote recipe → user word |
| 3.8 | FL console pane |
| 3.9 | Playwright e2e suite + a11y audit (axe) |
| 3.10 | `infra/` Terraform + deploy workflow for CloudFront hosting (§10). This WP is independent, so it can run at any time; deploying the placeholder shell early is worthwhile. `terraform apply` and the first deploy are run only with the owner's go-ahead. |

**Gate 3:** End to end in the browser, a user can search, drag, configure, bake, share a URL, reload it and get the same result, using the keyboard only.

### Phase 4 — Starter operation set (proves the model) ✅
*Done 2026-11-10. 61 ops in 16 vocabularies, 49 of them new in Phase 4 and all written in FL. Gate 4 passes in Node and in Chromium Web Workers, with and without cross-origin isolation (`npm run gate4:browser -w @forge/worker`): all 759 op vectors in 16 files, plus the data-driven UI smoke test `apps/web/e2e/ops-smoke.spec.ts`. 2,765 unit tests and 86 e2e tests; core + UI shell is 96.7 kB gzip.*

Names are Forge-native (`base64:decode`, not CyberChef names). The catalogue covers hex, Base32, Base64, Base58 and Base85, Binary, Decimal, Charcode, URL encoding and HTML entities, ROT13/ROT47, Caesar/rot, Atbash, Affine, Vigenère, Bacon, Bifid, Rail Fence, A1Z26, Morse, Substitute, XOR (+brute force), AND/OR/NOT/ADD/SUB, bit shift and rotate, Reverse, Upper/Lower case, Find/Replace, Split/Join, Entropy and Frequency distribution, and the regex ops. Every op ships with test vectors. Fork/Merge is covered by the structural `fork` step from Phase 2 (§3.6), so it needs no op.

| WP | Scope |
|---|---|
| 4.1 | base32, base58, base85, and the shared internal `raise` vocabulary |
| 4.2 | binary, decimal, charcode, url, html, morse |
| 4.3 | classical (16 ops) |
| 4.4 | bits (XOR, XOR brute force, AND/OR/NOT, ADD/SUB, shifts, rotates) |
| 4.5 | text and analysis |
| 4.6 | Gate 4 harness: `gate4:browser` and the UI smoke spec |
| 4.7 | Close-out: recipe-level test (`packages/worker/test/phase4-recipes.test.ts`), docs |

The 61 ops: analysis 2, base32 2, base58 2, base64 2, base85 2, binary 2, bits 11, charcode 2, classical 16, decimal 2, hex 2, html 2, morse 2, regex 4, text 6, url 2. The internal vocabularies are `recipe` and `raise`.

**Gate 4:** All starter ops pass conformance in Node and in the browser e2e smoke test. *Met.*

### Phase 5 — Capability coverage waves
CyberChef has **506 operations** in 16 categories (see research §5 and the appendix). We use that list as a checklist of *capabilities*, not a set of names to reproduce. In Forge, several CyberChef ops may become one parameterised word (e.g. one `rot` instead of ROT13/ROT47/ROT8000 variants, one `xor`), some become vocabulary-qualified names (`base64:decode`), and some are dropped or redesigned. Work happens in waves ordered for a codes-and-ciphers audience. Each wave is a set of per-vocabulary WPs run as parallel agents, gated by conformance vectors:

1. Remaining encodings/data formats (Base45/62/92, Punycode, Quoted-Printable, Braille, BCD, …)
2. Historical cipher machines (Enigma, Bombe, Typex, Lorenz, SIGABA, …) and remaining classical ciphers
3. Hashing (WebCrypto where possible, small audited libraries elsewhere)
4. Modern symmetric crypto (AES/DES/Blowfish/ChaCha/…), KDFs
5. Utils, extractors, regex, date/time, arithmetic
6. Compression (CompressionStream; WASM zstd/brotli, which CyberChef users have asked for)
7. Public key, networking parsers, forensics, multimedia, code tidy (lowest priority)

Each WP also updates `docs/COVERAGE.md`, a generated table of CyberChef capability → the Forge word(s) that cover it (or "dropped" / "redesigned", with a reason).

Phase 5 notes (follow-ups from Phase 4):

- `html:decode` needs the full HTML named-entity table, and the windows-1252 remap of `&#128;`–`&#159;`.
- `bits:xor-brute` with 2-byte keys hits the total-allocation limit on inputs over a few KiB without a crib.
- `url:encode` and `morse:encode` use about half the 10M default step budget at 64 KiB.
- `gate2:browser` and `gate4:browser` are not in CI yet.

### Phase 6 — Beyond CyberChef
Magic auto-detection (declarative `checks` in META, depth-limited search). An optional recipe store backend behind `RecipeStore`. A PWA/offline mode. The `@forge/cli`. Recipe diff/swap. **Relix vocabulary** integration as an `relix:` vocab of primitives.

## 8. How the orchestration will run

- **Agent mix**: Sonnet-class agents for spec-critical work (1.1, 1.5, 1.6, 2.2, 3.3). Haiku-class agents for well-specified, repetitive WPs (ops with test vectors, coverage-table generation, docs). Each agent gets the spec, the WP's "done" line, and the rule *no commits with attribution, no pushes*.
- **Isolation**: parallel WPs run in separate git worktrees on `wp/<id>` branches. The orchestrator merges after review.
- **Verification per WP**: read the diff, then re-run `npm run lint && npm run typecheck && npm test && npm run build` (+e2e from Phase 3) on the merged result, then spot-check behaviour by hand.
- **Order**: Phase 1 is mostly sequential (1.1 → 1.2/1.3 in parallel → 1.4 → 1.5 → 1.6/1.7/1.8 in parallel). Phase 3.1–3.2 can start once Gate 1 passes, against a mocked catalogue. Phases 4 and 5 are highly parallel.

## 9. Decisions

Decided 2026-11-09:

1. **Licence**: same as Relix. Apache-2.0 with `LICENSE.txt` and `NOTICE`, copyright Darkcollective, LLC, and a licence header in every source file.
2. **Qualified names**: `vocab:word`. A current vocabulary (`IN:` / `VOCAB`) makes qualification unnecessary for its own words (§3.3).
3. **Parameter binding**: parameters are stack inputs that are also bound as named locals.
4. **Case sensitivity**: names are case-sensitive, with a lower-kebab-case convention.
5. **Repository**: public at `DarkCollective/forge`.
6. **Hosting**: AWS S3 + CloudFront, in the same pattern as the Relix site (§10).

Decided 2026-11-10:

7. **Hostname**: `forge.darkcollective.com`.
8. **Deploy runner**: GitHub-hosted runner assuming an AWS role via GitHub OIDC (Terraform in `infra/`, applied 2026-11-10).

9. **FL-first ops, shared `raise` vocabulary**: ops are written in FL wherever feasible. A TypeScript primitive is allowed only when the core cannot express something or FL is too slow on realistic input (measured at 64 KiB), and then only as a minimal private `_helper` with the op logic and metadata in FL. Typed errors come from the internal `raise` vocabulary (`raise:coerce`, `raise:range`), since `fail` gives only `E_USER` (§3.5).

## 10. Hosting and deployment

Forge is a fully static site (`apps/web/dist`), hosted the same way as the Relix site, whose setup is in `relix/infra`.

- **Origin**: a private, versioned, SSE-S3 bucket (e.g. `forge-darkcollective-com`) with all public access blocked. CloudFront reads it through **Origin Access Control** (sigv4, signing always), and the bucket policy allows only this distribution.
- **Distribution**: `default_root_object = "index.html"`, `PriceClass_100`, HTTP/2+3, IPv6, TLS ≥ `TLSv1.2_2021` (SNI). Routing is hash-based (`#r=…`), so no SPA rewrite function is needed. 403 and 404 map to `/404.html`.
- **Caching**: `index.html` is short-TTL. Vite's content-hashed `assets/*` and lazy op modules get a long-lived `immutable` policy, as with Relix's `/static/*` split.
- **Response headers policy** (adapted from Relix's default):
  - HSTS (preload), `frame-options DENY`, `referrer-policy no-referrer`.
  - COOP `same-origin` + COEP `require-corp`. This makes the page `crossOriginIsolated`, which enables `SharedArrayBuffer` for fast cooperative cancellation between the UI and the bake Worker.
  - CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  - `connect-src 'self'` is needed only to fetch lazy WASM, `.fth` and catalogue files from our own origin. Forge never talks to any other host, and the optional recipe store (Phase 6) would add exactly one origin.
- **DNS/TLS**: reuse the existing `darkcollective.com` Route 53 zone and the `*.darkcollective.com` ACM certificate (us-east-1) via Terraform **data sources**. They stay owned by the Relix stack, and Forge adds only its own A/AAAA alias records.
- **Terraform**: `forge/infra/`, with the same backend bucket (`darkcollective-terraform-state`, us-east-1, `use_lockfile`) under its own key (`forge.darkcollective.com/terraform.tfstate`), so Forge and Relix can never clobber each other. Providers are `hashicorp/aws ~> 6.0` and Terraform ≥ 1.10. Access logs go to the existing `darkcollective-cloudfront-logs` bucket under a `forge/` prefix.
- **Deploy**: `.github/workflows/deploy.yml` runs on push to `main` after CI passes. It builds, runs `aws s3 sync --delete` (hashed assets first, `index.html` last), then `cloudfront create-invalidation` for `/index.html` and `/` only, then a smoke check.

## 11. Environment notes

- The local `~/.npmrc` pins `cafile` to the mkcert root only, which breaks registry access. The scaffold was installed with `NPM_CONFIG_CAFILE` pointing at an export of the macOS system roots. Either add the system roots to that bundle or remove the `cafile` line. CI is unaffected.
