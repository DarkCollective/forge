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

The shared internal vocabulary `util` holds FL helpers that more than one op vocabulary needs. Private (`_`) words cannot be called across vocabularies (LANGUAGE.md §5.7), so a helper used by two vocabularies would otherwise be copied. `util` is in `INTERNAL_VOCABS` (with `recipe` and `bake`): its public words are callable from every vocabulary (`util:space?`, or `USING: util`), are never listed in the catalogue, and a recipe that names one is refused as an unknown operation. Today it holds `space?`, `space-or-comma?`, `separator` and `decode-table` (the alphabet lookup shared by base32, base58 and base85). A test (`packages/ops/src/dupes.test.ts`) fails when two vocabularies define helpers with identical bodies, and `npm run dupes -w @forge/ops` lists exact and near duplicates.

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
- **Operation conformance tests**: each word has a test vectors table (`vocab/<name>.test.json`). A generic runner executes all of them through the VM. Vectors come from RFCs and standards, and published known-answer tests are preferred. The same vectors run in Chromium Web Workers with `npm run gate4:browser -w @forge/worker`, which covers every op in the browser. A data-driven UI smoke test (`apps/web/e2e/ops-smoke.spec.ts`) bakes up to two vectors per vocabulary through the UI. Multi-step recipes across vocabularies are covered by `packages/worker/test/phase4-recipes.test.ts`.
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
*Done 2026-11-10. 61 ops in 16 vocabularies, 49 of them new in Phase 4 and all written in FL. Gate 4 passes in Node and in Chromium Web Workers, with and without cross-origin isolation (`npm run gate4:browser -w @forge/worker`): all 759 op vectors in 16 files, plus the data-driven UI smoke test `apps/web/e2e/ops-smoke.spec.ts`. 2,793 unit tests and 86 e2e tests; core + UI shell is 96.7 kB gzip.*

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

The 61 ops: analysis 2, base32 2, base58 2, base64 2, base85 2, binary 2, bits 11, charcode 2, classical 16, decimal 2, hex 2, html 2, morse 2, regex 4, text 6, url 2. The internal vocabularies are `recipe`, `raise` and `util`.

**Gate 4:** All starter ops pass conformance in Node and in the browser e2e smoke test. *Met.*

### Phase 5 — Capability coverage waves
CyberChef has **506 operations** in 16 categories (see research §5 and the appendix). We use that list as a checklist of *capabilities*, not a set of names to reproduce. In Forge, several CyberChef ops may become one parameterised word (e.g. one `rot` instead of ROT13/ROT47/ROT8000 variants, one `xor`), some become vocabulary-qualified names (`base64:decode`), and some are dropped or redesigned. Work happens in waves ordered for a codes-and-ciphers audience. Each wave is a set of per-vocabulary WPs run as parallel agents, gated by conformance vectors:

1. Remaining encodings/data formats (Base45/62/92, Punycode, Quoted-Printable, Braille, BCD, …)
2. Historical cipher machines (Enigma, Bombe, Typex, Lorenz, SIGABA, …) and remaining classical ciphers
3. Hashing (WebCrypto where possible, small audited libraries elsewhere)
4. Modern symmetric crypto (AES/DES/Blowfish/ChaCha/…), KDFs
5. Utils, extractors, regex, date/time, arithmetic
6. Compression (done in wave 6 with pure-JavaScript codecs behind private primitives, not CompressionStream or WASM: fflate for DEFLATE, zlib, gzip and zip, lz-string, lzma1, and our own bzip2, LZ4, LZNT1 and XPRESS; Zstandard (fzstd) and Brotli (a vendored, output-capped copy of the pure decoder) are decompression only, which is what CyberChef users asked for)
7. Public key, networking parsers, forensics, multimedia, code tidy (lowest priority; wave 7 done, below: public key without PGP, networking, the non-image forensics ops, binary and text data formats and the stragglers of earlier waves; multimedia and code tidy remain)

Each WP also updates its `docs/coverage/<area>.json` mapping, from which `npm run coverage` generates `docs/COVERAGE.md`, a table of CyberChef capability → the Forge word(s) that cover it (or "dropped" / "redesigned", with a reason).

**Wave 1 ✅** *Done 2026-11-10 (wave 1: remaining encodings). 102 ops in 36 vocabularies; CyberChef coverage 90 covered, 14 redesigned, 402 not yet of 506. 1,472 op vectors in 36 files and 3,373 unit tests; `npm run gate4:browser -w @forge/worker` passes in Node and in Chromium Web Workers, with and without cross-origin isolation.*

| WP | Scope |
|---|---|
| 5.0 | Setup: util promotions, the CyberChef coverage table (`docs/coverage`, `docs/COVERAGE.md`), the browser gates in CI |
| 5.1 | radix encodings: base45, base62, base92, octal, modhex, bech32, `radix:convert` |
| 5.2 | text-level encodings: punycode, quoted-printable, unicode, braille, caret, hex-content |
| 5.3 | binary and number formats: hexdump, float, endian, bigint, bcd, cobs |
| 5.4 | charset (WHATWG labels, EBCDIC, brute force) and the full HTML named-entity decoding |
| 5.5 | Close-out: promoted every private copy into `util` (the `util-candidate` marker and the structural sweep in `dupes`), hyphenated vocabulary names (`quoted-printable`, `hex-content`), bech32 and base45 vectors checked against BIP-173, BIP-350 and RFC 9285, docs |

The structured data formats (CSV, JSON, YAML, CBOR, MessagePack, Avro, AMF, ASN.1, TLV, PEM, MIME, Rison, the IP formats, and Show Base64 offsets) are deferred to **wave 1b**.

Phase 5 notes (follow-ups from Phase 4 and wave 1):

- `html:decode` needs the full HTML named-entity table, and the windows-1252 remap of `&#128;`–`&#159;`.
- `bits:xor-brute` with 2-byte keys hits the total-allocation limit on inputs over a few KiB without a crib.
- `url:encode` and `morse:encode` use about half the 10M default step budget at 64 KiB.

Language gaps found in wave 1 (candidates for the core, or for a primitive):

- There is no efficient list builder or append. Growing a list or a string one element at a time is quadratic and hits `E_LIMIT_TOTAL` on large input (`cobs` needed a primitive for that reason). Words such as `cat` and `append` copy; `map` and `reduce` are the linear idioms, and `bjoin` and `join` collect.
- There is no way to memoise a computed constant per vocabulary. `html:decode` rebuilds its 2,231-entry named-entity record on every call, about 5 ms per call. A load-time `CONSTANT`, or a cached zero-input word, would remove it.
- The `charset` TextDecoder labels are tested in Chromium and Node only. Firefox and Safari are untested: their label lists and their handling of the legacy sets can differ.
- There is no early-exit loop over a list or a string. Scanning for a prefix (`util:count-leading`) is a fold over everything, or a `while` that is slower per element.

**Wave 2 ✅** *Done 2026-11-10 (wave 2: historical cipher machines and remaining classical ciphers). 143 ops in 46 vocabularies; CyberChef coverage 101 covered, 22 redesigned, 383 not yet of 506. 1,865 op vectors in 46 files and 3,721 unit tests; `npm run gate4:browser -w @forge/worker` passes in Node and in Chromium Web Workers, with and without cross-origin isolation.*

| WP | Scope |
|---|---|
| 5.6 | enigma (I, M3, M4) and typex; 5.6u promoted the rotor, plugboard and letter helpers into util |
| 5.7 | lorenz (SZ40/42a/42b, KH/ZMUG/BREAM, P5) and colossus counting; 5.7u promoted cycle-bytes and the ITA2 words |
| 5.8 | sigaba |
| 5.9 | classical additions (caesar box, rot8000, rot brute force, cetacean, ctx1, ls47) and analysis (index of coincidence, chi-squared) |
| 5.10 | polyalphabetic, polygraphic, fractionating, transposition (beyond CyberChef); 5.10b finished them and 5.10u promoted their helpers |
| 5.11 | bombe (one word for Bombe and Multiple Bombe, with one search primitive) |
| 5.12 | close-out: the Enigma rotor, turnover and reflector data shared once (`enigma:rotor-wirings`, `rotor-turnovers`, `rotor-reflectors`, used by bombe), `util:check-symbols` in a constant number of VM steps, the remaining util-candidate markers promoted or made private, every dupes report resolved or justified (README, "Justified exceptions"), docs |
| 5.13 | typex and sigaba conventions aligned with CyberChef's for compatibility, verified by a local cross-check against CyberChef (Typex 440/440, SIGABA 800/800, Enigma 180/180 agree with the same wirings and settings) |

Typex and SIGABA ship Forge's own non-historical default wirings, drawn at random for this project, because the real wirings were never published. The real Typex conventions (notch timing, reversed rotors, entry wiring, stepping) are unpublished too, so Forge follows CyberChef's for compatibility, and none of them is historically attested.

Language gaps found in wave 2 (candidates for the core, or for a primitive):

- A `VARIABLE` cannot start as a list or record.
- A parameter regex cannot contain spaces or parentheses.
- There is no fast mutable array and no per-element state in `map`. The hot loops of sigaba, ls47 and bombe needed primitives for this reason.
- There is no sort word, and there is no `pick`.
- There is no bytes-wise AND.
- `/` raises an error on integers beyond ±2^53.
- Param help is limited to 200 code points.
- Two vocabularies cannot `see-also` each other, because that is a dependency cycle.
- A public word whose params are all UI types becomes a catalogue op, so shared data needs zero-input words (`lorenz:kh-patterns`, `enigma:rotor-wirings`).
- The dupes sweep never sees an exact copy when a helper calls a private helper of the same vocabulary, because the normalised bodies then differ (the Enigma and Typex stepping is such a pair; see the ops README, "Justified exceptions").

**Wave 3 ✅** *Done 2026-11-11 (wave 3: hashing). 182 ops in 80 vocabularies; CyberChef coverage 133 covered, 30 redesigned, 3 dropped, 340 not yet of 506. 2,407 op vectors in 80 files and 4,064 unit tests; `npm run gate4:browser -w @forge/worker` passes in Node and in Chromium Web Workers, with and without cross-origin isolation, and the data-driven UI smoke test now also checks the raw digests of the hashing vocabularies through the hex view.*

Hashes use the audited `@noble/hashes` library (pinned, synchronous, not WebCrypto) behind minimal private primitives. Digest words return raw bytes (the user chains `hex:encode`), one parameterised word per family, with Forge-native names (`sha2:digest`). Checksums are written in FL. The conventions are in the ops README ("Hashing conventions").

| WP | Scope |
|---|---|
| 5.15 | Setup: `@noble/hashes`, the hashing conventions, the `sha2` exemplar, the hashing coverage table |
| 5.16 | Mainstream hashes via noble: md5, sha1, sha3, keccak, shake, ripemd-160, blake2b/s, blake3, hmac |
| 5.17 | Checksums in FL: crc (parameterised, with CyberChef's presets), adler-32, fletcher 8/16/32/64, luhn, tcp/ip, xor, parity bit; 5.17u promoted `sum` and `ceil-div` into util |
| 5.18a | Legacy hashes as own primitives from the published specs: md2, md4 (+ NT hash), md6, sha0, ripemd 128/256/320 |
| 5.18b | National hashes: sm3, has-160, whirlpool, snefru, gost, streebog |
| 5.18c | RIPEMD unified: one `ripemd:digest` with a size choice of 128, 160, 256 and 320 (`ripemd160:digest` stays for HMAC) |
| 5.19 | Non-cryptographic and fuzzy: murmurhash3, ssdeep/ctph and their compare ops, analyse hash |
| 5.20 | Close-out: the throwaway cross-check against CyberChef (defaults aligned, Analyse hash table completed), Generate all hashes and Generate all checksums (`generate-all`), `hash-util` merged, licence headers on every `.fth`, the UI smoke test through the hex view, NOTICE for Snefru, docs |

CMAC, LM hash, bcrypt (compare and parse), Argon2 (and compare) and Ascon (hash and MAC) move to wave 4, because they need AES/DES or are key derivation functions.

CyberChef's SHA2 "Rounds" parameter (a non-standard round count) is not supported: `sha2:digest` implements the FIPS 180-4 round counts only.

Wave 3 close-out (WP 5.20), from a local cross-check against CyberChef that was then deleted: the CRC presets (171 names, 5,310 random-input cases), custom CRCs, Fletcher-8/16/32/64, Adler-32, XOR checksum, Luhn, parity, MurmurHash3, BLAKE3 and Streebog all agree. MD2, MD4, MD5, MD6, SHA-0 to SHA-3, Keccak, SHAKE, RIPEMD, HAS-160, Whirlpool, Snefru, SM3, BLAKE2, the GOST hash and the NT hash agree with the expected outputs of CyberChef's own test suite. The cross-check found defaults to align (SHA-2, SHA-3 and Keccak now default to 512, SHAKE to 256, RIPEMD to 320), the Analyse hash table to complete, and that CyberChef's CTPH is not the same text as its SSDEEP: Forge has the one reference ssdeep algorithm and `ctph` is its alias. The TCP/IP checksum follows RFC 1071 where CyberChef folds the carry once. `generate-all:hashes` and `generate-all:checksums` report many digests at once; the 171 CRCs come from one private primitive, held equal to the FL `crc` by its tests, because 171 CRCs of 64 KiB in FL would be about 200 million VM steps. Sizes stay in bytes (SHAKE length, BLAKE2 size), so those coverage rows remain "redesigned". Snefru stays, with its Xerox notice in `NOTICE`.

Language gaps found in wave 3 (candidates for the core, or for a primitive):

- There is no early exit, and no "any" over a list: testing whether some element satisfies a predicate is a fold over everything (`ssdeep:_common7?` maps every window and ors the results).
- `reduce`'s argument order is a trap: it is `seq init quot` (the sequence first, then the start value), and the quotation sees the accumulator below the element, the opposite of `foldl` in most languages.
- `see-also` cannot name a word defined later in the same file, so related words are linked from `META:` blocks placed at the end of the file.
- A vector `ref` is limited to 200 characters, which is short for a citation that names a document, a section and a table.
- There are no per-vocabulary constants: the CRC preset table (171 lines of text) is parsed on every call, and every call rebuilds its 256-entry table (about 20,000 steps).
- `see-also` cycles across vocabularies are a dependency error, so hash vocabularies cannot point to `hash-analysis` if it depends on them, which is why `generate-all` is its own vocabulary.
- Arbitrary-precision integers made CRC-64 and CRC-82 easy (the whole Rocksoft model is a few dozen lines of FL with no special case for the width); worth keeping in the core.
- A 64 KiB checksum in FL costs about a million VM steps, so any report over many of them needs a primitive.

**Wave 4 ✅** *Done 2026-11-11 (wave 4: modern symmetric crypto and key derivation). 244 ops in 113 vocabularies; CyberChef coverage 136 covered, 89 redesigned, 3 dropped, 278 not yet of 506. 3,083 op vectors in 113 files and 4,637 unit tests; `npm run gate4:browser -w @forge/worker` passes in Node and in Chromium Web Workers, with and without cross-origin isolation, `npm run gate2:browser -w @forge/worker` passes in all four combinations, and the e2e suite has 162 tests passing.*

Block ciphers that an audited library covers (AES) use `@noble/ciphers` behind minimal private primitives. The block ciphers that have no audited library (DES, Triple DES, Blowfish, RC2, RC6, Twofish, SM4, TEA, XTEA, PRESENT, GOST 28147-89) are Forge's own primitives, each a private single-block pair `_encrypt-block` and `_decrypt-block` with a key schedule; all of their modes (ECB, CBC, CFB, OFB, CTR) and PKCS#7 padding come from one shared FL vocabulary, `blockmode`, driven by a block-function quotation, so the modes are never written twice. The conventions (bytes in and out, `key` parameters for key and IV, a separate padding parameter, `E_RANGE` for a bad key or IV, `E_COERCE` for bad padding or a failed GCM tag, the GCM tag appended to the ciphertext) are in the ops README ("Cipher conventions").

| WP | Scope |
|---|---|
| 5.23 | Setup: `@noble/ciphers`, cipher conventions, the shared block-mode layer, the `aes` exemplar, the e2e flake fix |
| 5.24 | Stream ciphers and key wrap via noble: ChaCha, Salsa20, XSalsa20, AES Key Wrap/Unwrap; 5.24d made the dupes sweep keep calls to a private primitive vocabulary-qualified (two vocabularies each calling its own `_hash` are not the same call) |
| 5.25 | KDFs: Derive PBKDF2 key, Derive HKDF key, Scrypt, Argon2 and Argon2 compare (via `@noble/hashes`), Derive EVP key (FL over md5/sha) |
| 5.26 | Block ciphers as own primitives on the shared mode layer: DES, Triple DES, Blowfish, RC2, RC6, Twofish, SM4 |
| 5.27 | Lightweight and legacy: RC4, RC4 Drop, CipherSaber2, Rabbit, TEA, XTEA, XXTEA, PRESENT, GOST Encrypt/Decrypt and GOST Key Wrap/Unwrap (28147-89), ROR13 |
| 5.28a | Constructions on the block ciphers: CMAC, LM Hash, Bcrypt, Bcrypt compare, Bcrypt parse, Ascon Hash, Ascon MAC, Ascon Encrypt/Decrypt |
| 5.28b | Tokens: Fernet Encrypt/Decrypt, JWT Sign/Verify/Decode, Flask Session Decode/Sign/Verify |
| 5.29 | Close-out: the throwaway cross-check against CyberChef (every cipher, mode, KDF and construction; the CTR counter conventions aligned), `util` promotions (`iv-or-zeros`, `b64url-encode`, `b64url-decode`; the two cipher helper files of 5.26 and 5.27 merged), the LM hash line in Generate all hashes, every dupes report resolved, docs |

Each CyberChef row belongs to exactly one WP. GOST Sign/Verify (public key) belongs to wave 7, and the Pseudo-Random Number and Prime Generators move to wave 5 (utils, `+random`).

Dependency order: 5.26 needs the 5.23 mode layer; 5.28 needs 5.26 (bcrypt needs Blowfish, LM hash needs DES) and the `aes` vocabulary (CMAC, Fernet); 5.24, 5.25 and 5.27 are independent of each other and of 5.26, and need only 5.23 (5.27's block ciphers, such as GOST 28147-89, TEA and PRESENT, call the same `blockmode` layer).

Wave 4 close-out (WP 5.29), from a local cross-check against CyberChef that was then deleted (CyberChef's own operation modules, with its npm libraries, driven with random keys, IVs and data beside the Forge runtime). These agree byte for byte: AES in every mode and key size (1,430 cases, including CBC/NoPadding, ECB/NoPadding, GCM with the tag split off, and IV lengths 8 to 64), ChaCha with a 16- or 32-byte key and an 8- or 12-byte nonce, the reduced-round ChaCha (12 and 8), Salsa20 and XSalsa20 (136 cases), AES key wrap and unwrap, PBKDF2, EVP, HKDF with all 18 hashes, scrypt and Argon2 i, d and id (the phc-winner-argon2 library CyberChef ships), DES, Triple DES (16- and 24-byte keys), Blowfish (keys of 4 to 56 bytes), SM4, Twofish (420 cases, all key sizes), RC6 at every word size from 8 to 256 and rounds from 1 to 40, RC2 (and, against node-forge directly, effective bits of 8 to 128 in steps of 8), RC4 and RC4 Drop (CyberChef's dwords are Forge's bytes divided by four), CipherSaber2, Rabbit in both byte orders with a short last block, TEA and XTEA at 1 to 100 rounds, XXTEA, PRESENT-80 and PRESENT-128, ROR13, GOST 28147-89 in every mode, S-box and meshing choice and the key wrap with and without CP (1,583 cases), CMAC (AES and Triple DES), the LM hash, bcrypt (hashes with a given salt equal bcryptjs's for versions 2a, 2b and 2y; compare and parse), Ascon hash, MAC and AEAD, Fernet tokens in both directions, JWT HS256/384/512 and Flask cookies (identical tokens for ASCII, compact JSON). Every recalled vector the earlier waves leaned on (the RC6 paper vectors at other word sizes, Twofish's three, the eSTREAM Salsa20 values, the XSalsa20 key stream, the phc-winner-argon2 values, the bcrypt hashes, PRESENT-128, the XXTEA words) therefore also agrees with CyberChef's independent code. What the cross-check changed: the CTR counter. SP 800-38A leaves the incrementing function to the application and CyberChef's ciphers use three: AES, DES, Triple DES, Blowfish and SM4 add one to the last four bytes of the counter block only (node-forge's inc32, no carry), Twofish and RC6 read the block as a little-endian integer, and TEA and XTEA add one to the whole block, big-endian. Forge followed the whole-block form everywhere, so it differed from CyberChef after the low word wrapped (Twofish and RC6 differed from the second block). `blockmode` now has the modes `CTR32` and `CTRLE` and `blockmode:ctr-as` maps a cipher's `CTR` onto them; AES does the same in its primitive, and the new vectors have the counter blocks encrypted by OpenSSL. Differences that stay, all in the coverage notes: an empty input encrypts to one padding block in SM4, Twofish, RC6, PRESENT and GOST CBC/ECB where CyberChef returns nothing; GCM needs an IV of at least 8 bytes; the ChaCha, Salsa20 and XSalsa20 counters are limited to 32 bits (CyberChef's are 64-bit), and the key, nonce and round combinations noble lacks are E_RANGE; CyberChef's GOST padding setting does nothing, so Forge's pkcs7 or none stands; the LM hash refuses a character above U+00FF where CyberChef keeps its low byte; JWT Sign here signs the text as given (CyberChef adds an iat claim and re-serialises) and Flask cookies with non-ASCII text are UTF-8 here where CyberChef writes Latin-1 low bytes; CyberChef's JWT Verify checks exp and nbf, Forge's does not; node-forge masks RC2 effective bits that are not a multiple of 8 wrongly, and Forge follows RFC 2268. The Bcrypt coverage note was wrong that CyberChef writes the 2a prefix: its bcryptjs writes 2b, the Forge default. Generate all hashes now has the LM hash line, where CyberChef has it (just before the NT hash); the wave 4 words add no other line CyberChef has. The `util` words `iv-or-zeros` (the empty-IV default of TEA, XTEA, RC6 and GOST, which 5.27 had inlined to avoid the sweep) and `b64url-encode` and `b64url-decode` (JWT, Flask cookies, Fernet) were promoted, and the two TypeScript helper files for the ciphers (`cipher-util.ts` of 5.26 and `cipher-util-b.ts` of 5.27) were merged into one with one key-schedule cache. `npm run dupes` reports 0 exact duplicates, 0 pending promotions, 0 near duplicates and the same 6 justified likely re-implementations as before.

WP 5.23 measured the mode layer in FL: a 64 KiB CBC encryption through `blockmode:encrypt`, driving a raw AES block function, takes about 98,500 VM steps (the default limit is 10,000,000), CBC decryption 103 thousand, ECB 70 thousand, CFB and OFB 98 thousand, and CTR 1.07 million (the counter is an integer sum per block). So the mode layer is FL, and only the block primitives are TypeScript. AES itself uses noble's own modes for speed (only OFB, which noble lacks, runs on the layer), and the tests hold the layer byte-identical to noble's modes and to `aes:encrypt`.

Language gaps found in wave 4 (candidates for the core, or for a primitive):

- There is no JSON parse or serialise. It blocks the JWT `exp` and `nbf` checks and parsed outputs (JWT Verify, Flask Session Decode return the JSON text as written, not a parsed object), and CyberChef's JWT Sign re-serialisation cannot be reproduced.
- There are no shared random or time words, so each vocabulary that needs one has its own private primitive (`fernet:_now`, `fernet:_random-iv`, `flask-session:_now`, `ciphersaber2:_random-iv`, `bcrypt:_random-salt`).
- There was no inflate, so a Flask cookie whose payload is zlib-compressed could not be read (fixed in wave 6: `deflate:zlib-inflate` and the Flask zlib cookie in WP 5.46a).
- A `blockmode` chaining `VARIABLE` is not reentrant: a quotation passed to `blockmode:encrypt` must not itself call `blockmode:encrypt`.
- A header constraint (`int[0..]`, a `choice`) raises `E_PARAM_INVALID` or `E_RECIPE_INVALID`, not `E_RANGE`, so a key or size that should be `E_RANGE` is checked in the word body instead of the header.
- `USING: raise` shadows the core word `range`, so the raise words are called qualified (`raise:range`).
- There is no fast mutable array, so the RC4, Rabbit and GOST meshing state loops are primitives (as the SIGABA, LS47 and Bombe loops were).
- A named input is bound as a local and is not left on the stack, which makes some stack shuffling that would be natural in Forth impossible to write directly.
- A private word cannot be called from `runtime.call`, so a test of a private construction (`fernet:_seal`, `flask-session:_sign`) loads a small FL unit that calls it.
- CTR in FL costs about ten times the other modes (the counter block is an integer sum turned back into bytes with `int>be-bytes` for every block).
- There are no forward references: a word must be defined above its first use (and `see-also` can name only an earlier word).
- There is no constant-time compare in FL (`argon2:compare` and `bcrypt:compare` are primitives for that reason; the HMAC compares in `fernet`, `jwt` and `flask-session` are plain `=`).

**Wave 5 ✅** *Done 2026-11-11 (wave 5: utils, extractors, date and time, arithmetic, generators, language). 338 ops in 144 vocabularies; CyberChef coverage 193 covered, 124 redesigned, 5 dropped, 184 not yet of 506. 4,157 op vectors in 144 files and 5,458 unit tests; `npm run gate4:browser -w @forge/worker` passes in Node and in Chromium Web Workers, with and without cross-origin isolation, and the e2e suite has 189 tests passing.*

The long tail of CyberChef's operations that need no new codec: text and line utilities, arithmetic and sets, extractors, date and time, unit conversions and generators. They are written in FL, on a few shared words that WP 5.30 builds first: `random` (the host CSPRNG, `+random`), `clock` (the host clock, `+time`), `list` (a stable sort, a sort by parallel keys and a shuffle, which FL lacks) and `util:delimiter` (the text of the common delimiter choices). The conventions (line and list ops are `str` in and out with a `delimiter` choice, numbers in text, how nondeterministic ops are tested, the category names) are in the ops README ("Wave 5 conventions"). XPath, JPath, Jsonata, CSS selector and Template are deferred to wave 1b (they need JSON and XML parsing); Extract EXIF, ID3, Audio Metadata and Extract Files go to wave 7.

| WP | Scope |
|---|---|
| 5.30 | Setup: the shared `random`, `clock` and `list` vocabularies (Pseudo-Random Number and Integer Generators, Get Time), `util:delimiter`, the wave 5 conventions; Show on map and Sleep dropped |
| 5.31 | Arithmetic and sets: Sum, Subtract, Multiply, Divide, MOD, Mean, Median, Standard Deviation, Extended GCD, Modular Exponentiation, Modular Inverse, Set Union/Intersection/Difference, Symmetric Difference, Cartesian Product, Power Set |
| 5.32 | Lines: Sort, Shuffle, Unique, Filter, Head, Tail, Add/Remove line numbers, Pad lines, Wrap, To Table, File Tree (vocabulary `lines`) and Diff (its own vocabulary `diff`) |
| 5.33 | Strings and bytes: Remove whitespace/null bytes/ANSI escape codes, Swap case, Alternating Caps, Get All Casings, To/From Case Insensitive Regex, Expand alphabet range, Take/Drop bytes, Take/Drop nth bytes, Escape/Unescape string, Count occurrences, Hamming and Levenshtein distance, Fuzzy Match, Offset checker |
| 5.34 | Conversions and parsers: Convert distance/area/mass/speed/data units/co-ordinate format, Haversine distance, Parse UNIX file permissions, Parse ObjectID timestamp, Parse colour code |
| 5.35 | Date and time: Parse DateTime, Translate DateTime Format, From/To UNIX Timestamp, Windows Filetime to/from UNIX Timestamp, DateTime Delta, Extract dates (own token formatter, time zones from the host's Intl data) |
| 5.36 | Extractors: Strings, Extract IP addresses/email addresses/MAC addresses/URLs/domains/file paths/hashes, RAKE |
| 5.37 | Generators and language: Pseudo-Random Prime Generator, Generate UUID, Generate TOTP/HOTP, Generate De Bruijn Sequence, Generate Lorem Ipsum, Analyse UUID (vocabulary `uuid`, with Generate UUID), Remove Diacritics, Convert to NATO alphabet, Convert Leet Speak, Unicode Text Format, HTML To Text |
| 5.38a | Close-out, part 1: code hygiene. The util promotions of the dupes sweep (`util:contains?`, `util:total-text`, `util:round-div`, `util:match-texts` and the others), `list:unique`, the five private clock and random primitives moved onto the shared `random` and `clock` words, `util:str-chunks` made linear, the vectors test timeout raised to 240 s, and `FORGE_E2E_PORT` so parallel worktrees do not serve each other's builds |
| 5.38b | Close-out, part 2: the throwaway cross-check against CyberChef 11.5.0 (defaults, orders and layouts aligned, coverage notes corrected), docs |

Wave 5 close-out (WP 5.38b), from a local cross-check against CyberChef 11.5.0 that was then deleted (CyberChef's operation modules from its npm package, driven beside the Forge runtime with fixed and random inputs, several thousand cases over every wave 5 op, with the clock fixed for TOTP). These agree with CyberChef: the arithmetic on every valid list (Sum, Subtract, Multiply, Divide, Mean, Median, Standard Deviation, in all six delimiters), Modular Inverse and Exponentiation for positive arguments, Union, Intersection and Difference, Sort (alphabetical, length, and the other orders for ASCII text), Unique, Head and Tail (including 0 and negative numbers), Filter, Swap case, Alternating Caps, Remove whitespace, Remove null bytes, the unit tables for distance, area, mass and data (except where CyberChef's constants are wrong), Parse ObjectID timestamp, the hexadecimal, decimal and nanosecond Windows file times, DateTime Delta, Translate, Parse DateTime with a stated format, the extractors for e-mail, URL, IPv4 and hash lengths, TOTP and HOTP codes (every secret, digit count and interval), UUID v3 and v5, and the De Bruijn sequences. The cross-check changed Forge where the choice was arbitrary: Get Time counts seconds by default; the integer generator separates with a space; MOD is CyberChef's (every number modulo a modulus, joined by a space); Extended GCD, Power Set (binary counting order, sorted by length, each subset followed by the delimiter), File Tree, To Table (ASCII and Markdown) and Parse UNIX file permissions write CyberChef's layouts; Pad lines adds a number of characters instead of padding to a length; Wrap cuts at 64; Add line numbers sizes by the line count; Remove line numbers takes one separator; Expand alphabet range joins without a delimiter; To Case Insensitive Regex writes the lower case first; Escape string follows the rules of CyberChef's escaper in every level (13,000 combinations compared; the quote around the text with JSON, `\0`, the short escapes, the quotes at the everything level, the Unicode spaces at the minimal level); Unescape reads `\a`; Count occurrences has the Extended mode (the old note told users to unescape the pattern, which cannot be chained); the unit conversions round to 20 decimal places instead of 20 significant digits; Haversine reads the one-line form; Colour labels are padded to six; Leet Speak basic is a, e, i, o, s, t; Unicode Text Format has both marks off and writes the strikethrough first; Remove Diacritics leaves strokes alone; Diff compares characters; TOTP and HOTP use the name Account and a 20-byte random secret; UUID takes the name from the input and has CyberChef's default namespace; the prime generator defaults to 512 bits and writes hex with 0x; From UNIX Timestamp shows milliseconds for the finer units; the Windows file time is exact in decimals and the big-endian hex has no leading zeros; Strings defaults to alphanumeric with CyberChef's punctuation; Extract hashes "all" finds 80 digits and groups by length; remove-local keeps 169.254/16; Extract domains has the Underscore option. 34 coverage rows moved from "redesigned" to "covered". Differences that stay, each in its coverage note: an error instead of silent ignoring (a piece that is not a number, an empty set of numbers, a backwards range, a lone surrogate, a negative start), exact decimals (BigNumber rounds the conversion factors of the large data units), text instead of HTML (Diff, Fuzzy Match, Offset checker, To Table, Colour, HTML To Text), code point order instead of the host's locale (Sort, sort and unique options of the extractors), sets that hold each item once (Symmetric Difference and Cartesian Product repeat items in CyberChef), no tabs in report output (the web smoke test treats text with a tab as binary), and the places where CyberChef's own result is wrong, which Forge does not reproduce: the fathom (1.853184 m) and nautical mile (1,853.184 m), the rounded speed factors, the Bezout coefficients for a negative b, the TOTP epoch (ignored), the line merging of Remove line numbers, a three-digit hex colour, one-cell and ragged tables, and the doubled lines of Get All Casings. Not copied by design: the Forge-native unit names and lists (no parsec, comparison units or Mach), the Ordnance Survey grid, CyberChef's Unicode Strings classes, its RAKE tokenizer (punctuation stays on words), its Lorem Ipsum word list, the NATO word separators and the Analyse UUID report. The cross-check also found two wrong notes (Extract domains named an option CyberChef does not have, Count occurrences gave an impossible remedy).

Language gaps found in wave 5 (candidates for the core, or for a primitive):

- No way to mark a public word with inputs as "not an op", so shared helpers with inputs need an internal vocabulary (`random` and `list` were made internal). A public util word needs every parameter typed.
- `runtime.call` does not apply header defaults; header-constraint violations surface as E_RECIPE_INVALID through the recipe layer (E_PARAM_INVALID at direct calls), not E_RANGE; invalid choice and int params cannot be vector expectations. A default that depends on another parameter (the From UNIX Timestamp format by unit) needs an empty-string sentinel.
- No mid-body local binding (`{ x }` is a list literal); locals come only from headers, so code splits into many small helpers; a named local shadows a word of the same name; a vocabulary word named like a core word (`drop`, `swap`, `filter`) shadows it inside the vocabulary; `USING: regex` made `split` resolve to `regex:split`.
- No stack-to-list word, and no truncating division (`util:tdiv` is a helper); there is no `pick`, case or dispatch, early exit, `bool>str`, trim, or index-of-substring.
- No mutable array or per-element state: Levenshtein (`distance:_levenshtein`) and Myers diff (`diff:_edits`) are primitives (FL Levenshtein is about 39 steps per cell).
- No trigonometric or hyperbolic functions (`coords:_math`, `coords:_atan2` are primitives); no str>num parse; `num` cannot hold NaN.
- No unique, set or hash lookup, and no has-key on records (`get` raises; `try` costs about 1 ms per caught error); self-recursion needs `recurse`.
- `append` in a loop and `util:list-flatten` are quadratic in time and in the total-bytes meter; `util:str-chunks` was quadratic (fixed in 5.38a).
- A `choice{...}` list cannot be shared between headers (datetime repeats a 14-option preset list in five ops); there is no way to offer about 400 IANA zones as a choice.
- JSON vectors cannot carry integers above 2^53.
- Regexes are capped at 1024 characters; the regex engine has no lazy or possessive quantifiers (hostile inputs were checked under 5 ms).
- `\f` is not a valid FL string escape.
- One `getRandomValues` call per shuffle swap (about 0.3 s for 65,536); pooled draws would be faster.
- The web smoke test treats text containing a tab as non-showable (hex view), so several ops use spaces instead of tabs in reports.
- The e2e port 4783 was fixed with `reuseExistingServer`, so parallel worktrees served each other's builds (fixed in 5.38a with `FORGE_E2E_PORT`); the worker vectors test needed a longer timeout (5.38a).

**Wave 6 ✅** *Done 2026-11-11 (wave 6: compression and archives). 363 ops in 155 vocabularies; CyberChef coverage 198 covered, 140 redesigned, 5 dropped, 163 not yet of 506. 4,488 op vectors in 155 files and 5,977 unit tests; `npm run gate4:browser -w @forge/worker` passes in Node and in Chromium Web Workers, with and without cross-origin isolation, `npm run gate2:browser -w @forge/worker` passes in all four combinations, and the e2e suite has 193 tests passing.*

The codecs are pure JavaScript libraries behind minimal private primitives, pinned to exact versions and attributed in `NOTICE`: `fflate` 0.8.3 (DEFLATE, zlib, gzip, zip), `lz-string` 1.5.0, `fzstd` 0.1.1 (Zstandard decompression), the pure-JS decoder of `brotli` 2.1.0 (`brotli/decompress`; its emscripten compressor is never imported) and `lzma1` 0.6.1 for LZMA. `lzma` 2.3.2 (lzma-js, the library CyberChef uses) was rejected: it installs a global `onmessage` handler in a worker scope, which would replace the bake worker's own handler, and it does not load as an ES module; `lzma1` is synchronous, imports cleanly and offers levels 1 to 9, at the price that its compressed bytes differ from CyberChef's (the decoders interoperate). The containers (headers, trailers, checksums) are FL; the entropy coders are primitives. **The output limit:** every decompressor stops at the run's `maxValueBytes` and raises `E_LIMIT_VALUE` while it decompresses, never trusting a size field (`BoundedOutput` in `prim-util.ts`; a 1 GiB bomb stops in under 0.2 s). **Archives:** Unzip and Untar return a `list` of `record`s (`name`, `size`, `dir`, `mtime`, `mode`, `data`), which the output pane renders as a tree, plus a bytes-returning entry op so a recipe can continue; Zip and Tar take one file and a `filename` parameter. The conventions (levels, errors, determinism, vectors, archives) are in the ops README ("Wave 6 conventions"). Shared dependencies were added once in 5.39, so the later WPs do not touch the lockfile.

| WP | Scope |
|---|---|
| 5.39u | `util:check-int-range`, the promoted `_check-range` helper that every compressor repeated |
| 5.39 | Setup: the wave 6 dependencies (fflate, lz-string, fzstd, brotli decoder, the LZMA library), the wave 6 conventions (errors, the output limit, levels, archives), the `deflate` exemplar (Raw Deflate/Inflate, Zlib Deflate/Inflate, Gzip, Gunzip) |
| 5.40 | Archives: Zip, Unzip, Tar, Untar |
| 5.41 | Bzip2 Compress and Decompress (own primitives from the format) |
| 5.42 | LZString Compress/Decompress and LZ4 Compress/Decompress |
| 5.43 | LZMA Compress and Decompress |
| 5.44 | Windows formats: LZNT1 Decompress, XPRESS Decompress, XPRESS LZ77+Huffman Decompress |
| 5.45 | Beyond CyberChef: Zstandard and Brotli decompression |
| 5.45b | The vendored, output-capped Brotli decoder (the npm package's decoder allocated before it could be capped) |
| 5.46a | Hygiene: util promotions, the shared CRC and Adler-32 primitives (a checksum is a few hundred VM steps at any length), Flask zlib cookies, NOTICE |
| 5.46b | Close-out: the throwaway cross-check against CyberChef, the stored-block fix, coverage notes, docs |

Wave 6 close-out (WP 5.46b), from a local cross-check against CyberChef 11.5.0 that was then deleted (CyberChef's own operation modules from its npm package, with its libraries (zlib.js, libbzip2 as WebAssembly, lz4js, lz-string, lzma-js), driven beside the Forge runtime with fixed and random inputs of 0 to 256 KiB in six shapes: random, prose, runs, a four-letter alphabet, zeros and a repeated chunk with noise). These agree: everything CyberChef's Raw Deflate, Zlib Deflate and Gzip write in all three compression types (with a name, a comment and the header CRC-16) reads here, and everything written here at levels 0 to 9 reads in CyberChef's Raw Inflate, Zlib Inflate and Gunzip with the checksums verified (about 4,000 streams); the zlib header bytes and the whole gzip header, including the header CRC-16 at the same mtime, equal CyberChef's, and so do stored streams up to 65,531 bytes. CyberChef's Zip (both methods, three operating systems, three compression types, names with directories, a comment) reads here, its Unzip reads every archive written here, and a short archive for Macintosh is equal byte for byte; CyberChef's Tar and Untar read each other's archives with Forge's. Bzip2 interoperates in both directions with libbzip2 (block sizes 1 to 9, work factors 0 to 250, and its `small` option), and 10 of 35 outputs are equal to libbzip2's byte for byte. LZMA interoperates at modes and levels 1 to 9 in both directions. LZString gives the same 16-bit code units in all three of CyberChef's formats (the same library) and decodes CyberChef's output (128 texts of 0 to 3,000 characters). LZ4 frames written here at every level, block size, independent or linked setting, content checksum and content size (about 12,300) are read by lz4js, and Forge reads lz4js's frames. LZNT1, XPRESS and XPRESS Huffman have no CyberChef encoder, so the test encoders of `lznt1.test.ts` and `xpress.test.ts` fed both decoders (70 inputs each, with and without the end marker, stored chunks, 32-bit match lengths) along with 400 damaged streams per format; LZNT1 and Plain LZ77 agree on every stream, damaged ones included. **What the cross-check changed:** one bug in Forge. fflate 0.8.3 marks the last stored block final and then writes a second, empty, final block when a level-0 input is a nonzero multiple of 65,535 bytes long, so the five stray bytes stood in front of the zlib and gzip trailers and zlib and CyberChef refused the stream (checksum errors). `deflate:_deflate` now writes the stored blocks itself (a regression test with lengths 0, 1, 65,534 to 65,536, 131,069 to 131,071 and 196,605 against Node's zlib). Alignment: the defaults, option names and menu orders already followed CyberChef (Zip's file.txt and MSDOS, Tar's 0000664, Bzip2's block size 9 and work factor 30, LZMA's mode 7, Dynamic Huffman as level 6), so no default changed; the coverage notes of all six files gained the cross-check results and the note that stored blocks equal zlib's only up to 65,531 bytes. **Differences that stay,** each in its coverage note: bytes of compressed output differ (a different encoder) while every decoder reads them; mtime 0 and `verify` on (CyberChef writes the clock and does not verify); the XFL byte follows the level; Tar writes seven-digit uid and gid fields and the checksum as GNU tar does (CyberChef writes "0" and seven digits); ZIP's version needed is 10 for a stored entry, the Unix attributes are written, names are UTF-8 (CyberChef's are Latin-1); lz4js does not read block checksums, so that option is for the lz4 command; the work factor of Bzip2 is accepted and ignored; the buffer options of Raw and Zlib Inflate, ZIP passwords and the Fixed Huffman type are not offered. **Where CyberChef is wrong and Forge does not follow:** its Fixed Huffman and None types write an unterminated or empty stream for an empty input (Raw Deflate, Zlib Deflate, Gzip and Zip); LZMA Decompress returns Latin-1 for text whose characters are all at most U+00FF (an accented Latin text loses its UTF-8 sequences); LZNT1 Decompress takes a chunk whose size field is 0 (a one-byte chunk, such as the end of a 4097-byte input) for the end marker and drops it; XPRESS Huffman reads one block only, takes the size as a parameter, and refills its bit buffer one bit earlier than the specification's pseudo-code and Samba's lzxpress_huffman.c, so six of 57 single-block streams of the test encoder, and every stream of more than one 64 KiB block, fail in CyberChef while Forge reads them. Forge's remaining strictness is by design: bytes after the final XPRESS Huffman block are E_COERCE (there is no size to stop at), and the symbol 256 ends the data when all input has been read, where CyberChef ends at the declared size; a real match of length 3 at distance 1 within the last 32 bits would be read short here (the test encoder avoids it and no Windows encoder is known to emit it). Not cross-checked: the Zstandard and Brotli decoders (beyond CyberChef; their vectors come from the `zstd` and `brotli` commands), the `uri` format of LZString (CyberChef has none), the LZ4 block checksum option (lz4js cannot read it), ZIP passwords (not supported), and the bytes of `lzma:compress` (lzma1 against lzma-js differ by construction).

Language gaps found in wave 6 (candidates for the core, or for a primitive):

- A per-byte loop in FL costs about 13 VM steps, which caps a payload near 750 KB under the default limit and near 380 KB for an untrusted recipe, so every whole-payload loop became a primitive (the entropy coders, the match loops of LZNT1 and XPRESS, and the CRC-32 and Adler-32 loops, which were later made shared primitives so a 16 MiB gzip costs a few hundred steps). A fold over `bytes` without a list of integers (a list costs 16 bytes per byte under the value limit) would have kept more of this in FL.
- No streaming: a value is complete before the next word runs, so a decompressor has to cap its own output (`BoundedOutput`, `E_LIMIT_VALUE`) instead of the VM refusing growth as it happens, and no op can read a gzip member by member.
- An op returns one value, so Unzip and Untar return a list of records (an inspection result that cannot be chained) and a second, bytes-returning entry op (`zip:entry`, `tar:entry`) exists to continue a recipe. The `file` value type of section 3.1 is still missing; Zip and Tar take one file with a `filename` parameter.
- Private words cannot be shared across vocabularies, so `zip` could not call `deflate:_deflate` and goes through a public word, and the checksum words had to be made public to be shared; there is no friend visibility.
- No vocabulary cycles: `lznt1` cannot see-also `xpress` as well as the reverse, so the see-also links are one-way where two formats belong together.
- A private helper that looks general (`_check-range`) had to be copied into every vocabulary until the close-out promoted it to `util:check-int-range`; a way to declare a util word before its promotion would save the marker and the sweep.
- Header constraints on parameters raise E_RECIPE_INVALID or E_PARAM_INVALID, not E_RANGE, so every range check of a compressor (levels, block sizes, work factors) is written in the word body to give the typed error.
- A `choice{...}` list cannot be shared between headers (Zip's and Tar's operating system, LZ4's block sizes are written once each); JSON vectors cannot carry a binary input except as hex, which makes the 64 KiB cases tests, not vectors.
- A library's behaviour is part of the contract: fflate wrote an extra final block at multiples of 65,535 bytes and lz4js does not read block checksums. A pinned version and a cross-check with an independent decoder (zlib, the lz4 command, libbzip2) are the only guard.

**Wave 7 ✅** *Done 2026-11-12 (wave 7: public key, networking, forensics, binary and text data formats, and the stragglers of earlier waves). 458 ops in 200 vocabularies; CyberChef coverage 241 covered, 187 redesigned, 7 dropped, 71 not yet of 506. 7,302 op vectors in 200 files and 7,786 unit tests; `npm run gate4:browser -w @forge/worker` passes in Chromium Web Workers, with and without cross-origin isolation (7,302 of 7,302 vectors each).*

Scope agreed with the owner on 2026-11-11. **In:** Public Key without PGP, Networking, the four non-image Forensics ops, and the stragglers of earlier waves (the wave 1b data formats, Extractors, Other, GOST Sign/Verify). **Deferred (stay "not yet"):** Multimedia (27 ops) and Code tidy (24), which are the last piece of Phase 5; the five image-based Forensics ops (Extract LSB, View Bit Plane, Extract RGBA, Randomize Colour Palette, Remove EXIF, which need image decoding and go with Multimedia); Parse QR Code (image decoding); Disassemble x86 and Disassemble ARM (not wanted); the seven PGP ops and Parse PGP Key (openpgp.js is large and asynchronous); Protobuf Encode (it needs `.proto` schema parsing; Protobuf Decode is done without a schema); Magic (Phase 6, already planned); Register and Return (they need recipe-engine changes and `packages/recipe` is frozen; Phase 6). **Dropped (in `dropped.json`, with the reason):** HTTP request and DNS over HTTPS: the bake Worker's CSP is `connect-src 'self'` and Forge never talks to another host, as for Show on map. **Libraries:** `@noble/curves` 2.4.0 for ECDSA, SM2 and GOST R 34.10 on custom curve parameters (WP 5.51); RSA is written on bigints in a small private primitive, with no RSA library; no openpgp.

The shared ASN.1 layer comes first (WP 5.47), because X.509, CSR, CRL, SSH keys, RSA, ECDSA and JWK all read and write DER. It is the internal vocabulary `asn1`: one primitive reader that turns DER into a tree of records (class, constructed, tag, offset, header length, length, value, children), bounded by depth 64, by the input and by the value limit; FL words to walk it, to read INTEGER, OID, BIT STRING and the string types, and to write DER (lengths, TLV, INTEGER from a bigint, OID, SEQUENCE); an object identifier codec with arcs of any size and a table of about 250 OpenSSL names (a primitive, because FL has no per-vocabulary constants); and PEM decode and encode. Its first five users are the ops Parse ASN.1 hex string (text, an outline in the shape of the jsrsasign dump), Hex to Object Identifier, Object Identifier to Hex, PEM to Hex and Hex to PEM. The conventions (how a parser reports, errors and bounds, the shared-words table, the `@noble/curves` import rules, vector sources and cross-check expectations) are in the ops README ("Wave 7 conventions").

| WP | Scope | Depends on |
|---|---|---|
| 5.47 ✅ | Setup A: `@noble/curves` pinned (and NOTICE), "Wave 7 conventions" in the ops README, this section, the dropped rows, the shared DER/ASN.1 reader, OIDs and PEM: Parse ASN.1 hex string, Hex to Object Identifier, Object Identifier to Hex, PEM to Hex, Hex to PEM | - |
| 5.48 ✅ | Setup B: the shared `json` vocabulary (JSON text to and from FL values, a `json:null` sentinel), CSV to JSON, JSON to CSV | - |
| 5.49 ✅ | X.509 and friends: Parse X.509 certificate, bundles, CRL, CSR, Public Key from Certificate, Parse SSH Host Key, PEM to JWK, JWK to PEM (RSA, EC and OKP keys) | 5.47, 5.48 |
| 5.50 ✅ | RSA on core bigints, no library: Generate RSA Key Pair, RSA Sign/Verify/Encrypt/Decrypt (OAEP, v1.5, PSS, encrypted keys), Public Key from Private Key | 5.47 |
| 5.51 ✅ | Elliptic curves: Generate ECDSA Key Pair, ECDSA Sign (RFC 6979)/Verify, ECDSA Signature Conversion, SM2 Encrypt/Decrypt, GOST R 34.10-2012 sign and verify (beyond CyberChef), GOST MAC (CyberChef's "GOST Sign/Verify") | 5.47 |
| 5.52 ✅ | Packet layers: Ethernet, IPv4 (and strip), TCP (and strip), UDP (and strip), TLS record, Strip HTTP headers, Dechunk HTTP response | 5.47 conventions |
| 5.53 ✅ | Addresses and names: Parse IP range, Parse IPv6, IPv6 Transition Addresses, Change IP format, Group IP addresses, Format MAC addresses, NetBIOS encode/decode, Defang/Fang URL, Defang IP, Parse URI, Parse User Agent (own rule table) | 5.47 conventions |
| 5.54 ✅ | Fingerprints and wire formats: JA3, JA3S, JA4, JA4Server, HASSH client/server, Protobuf Decode (schemaless), VarInt Encode/Decode | 5.48, 5.52 |
| 5.55 ✅ | Binary data formats: CBOR, MessagePack, AMF, Avro, Parse TLV, Show Base64 offsets, Rison, P-list Viewer, Generate QR Code (own encoder) | 5.48 |
| 5.56 ✅ | Text data formats and queries: YAML to and from JSON, MIME Decoding, JPath, Jsonata, XPath, CSS selector, Template (own Handlebars subset) | 5.48 |
| 5.57 ✅ | Forensics and metadata: Detect File Type, Scan for Embedded Files, Extract Files, ELF Info, Extract EXIF, Extract ID3, Extract Audio Metadata | 5.47 conventions |
| 5.57u ✅ | Hygiene: `util` promotions (`be-int`, `starts-with-bytes?`, `printable-bytes?`, `name-in-table`, `pad-left`, `pad-right`, `bit-length`, `int>b64url`) and `asn1:tlv-ec-private` | 5.57 |
| 5.58 ✅ | YARA Rules (a documented subset, its own engine over the regex seam; 473 cases checked against libyara 4.5.4) | 5.57 |
| 5.59a ✅ | Cross-check against CyberChef 11.5.0, public key: ASN.1, X.509, CRL, CSR, SSH, JWK, RSA, ECDSA, GOST (nothing committed but fixes, alignment and coverage notes) | 5.47 to 5.51 |
| 5.59b ✅ | Cross-check, networking: packets, addresses, user agents, fingerprints, VarInt, Protobuf; one Forge bug fixed (Defang URL) | 5.52 to 5.54 |
| 5.59c ✅ | Cross-check, data formats and forensics: CSV, CBOR, MessagePack, AMF, Avro, TLV, Rison, P-list, Base64 offsets, QR, MIME, ELF, file types, YARA | 5.55 to 5.58 |
| 5.59d ✅ | Close-out: these docs (this section, the ops README, the coverage table) | all |


What WP 5.47 found, for the WPs that follow:

- `see-also` is a load dependency, so two vocabularies cannot see-also each other; the ops of a family point one way (`oid` and `pem` point to `asn1-dump`, never back).
- Inside a `try` quotation the values under the snapshot are below the floor (`E_STACK_UNDERFLOW`), so a body that must read a stack value reads it from a local, and the handler leaves the stack as the body would.
- A primitive returns a JS array for a `list` result and builds its records with `valueHelpers.record`; a `list(...)` value as the whole result is `E_TYPE`.
- An FL table is rebuilt on every call (about 1,800 VM steps for 200 pairs), so a lookup table is a primitive that builds its maps once (2 steps a lookup).
- A shared word with a `record` or `list` parameter or a UI-typed input cannot sit in a public vocabulary without becoming a catalogue op that needs a `doc` and a `category`; shared words go in an internal vocabulary (`INTERNAL_VOCABS`).

Wave 7 close-out (WPs 5.59a to 5.59c), from local cross-checks against CyberChef 11.5.0 that were then deleted (its operation modules, or the libraries behind them, read and run in scratch directories beside the Forge runtime; nothing from them is committed). **Public key (5.59a):** Public Key from Private Key reads EC keys (it now uses the `ecdsa` code as well as `rsa`); RSA Verify reports "Verification Failure" as CyberChef does; `gost-mac` shares the GOST 28147-89 tables with `gost28147`; Parse ASN.1 hex string follows CyberChef for a hex-character start, truncation and layout; PEM to JWK has compact output and the RFC 7638 `kid`; X.509 fingerprints, the CRL report in CyberChef's openssl-style shape, the SSH host key lines and the DER output of Generate RSA Key Pair were aligned. Wrong earlier claims were corrected (the PEM to JWK indent, the CRL output format). **Where CyberChef or jsrsasign is wrong and Forge does not follow:** a wrong ECDSA `s` in Parse X.509, ENUMERATED values of 0x0a and above, a nested-DER guess on primitive context tags, a leading 00 in the CSR modulus, the CRL Number printed in hex, and RSA Sign output coerced to text. **Networking (5.59b):** one Forge bug, fixed: the Defang URL lookbehind skipped names that follow a `.` or a `-`. Aligned: raw defaults, the Source MAC order, IPv4 and TCP field formats, user-agent names (70 of 81 equal to ua-parser-js 2.0.10 on the cross-check set) and VarInt `0x`, `0o` and `0b` input; the shared words `util:wire-input` and `util:md5-hex` came out of it. **Where CyberChef is wrong and Forge does not follow:** Parse IPv6 with a dotted tail and the 6to4 interface ID, TCP window scaling on a SYN, the JA4 hash of an empty list, Protobuf float rounding, and VarInt Decode accepting truncated input. **Data formats and forensics (5.59c):** aligned CSV indent 4 and the trailing row delimiter, the AMF3 default, Avro defaults, the CBOR tag shape, MessagePack float64, the TLV layout and little-endian fixed lengths, the Rison URI mode, the P-list layout, the Base64 offsets text, the QR parameter order, the Detect, Scan and Extract Files options and the YARA report layout. The CBOR and MessagePack encoders are byte-identical to `cbor2` and `notepack` on 300 random values. MIME decodes per charset, which fixed an `E_LIMIT_TOTAL` on long input (and `util:u16` was added). ELF Info keeps the `readelf` layout (owner decision). **Where CyberChef is wrong and Forge does not follow:** CSV drops a last row that has no delimiter, P-list puts a dict in an array wrongly, AMF keeps library state between runs, and the quoting of `rison.js` is not followed. **Differences that stay,** each in a coverage note: Parse User Agent uses Forge's own rule table (about 74 rules; ua-parser-js 2.x is AGPL and 1.x runs its regexes outside the regex seam); Template is a Handlebars subset (Handlebars needs `new Function`); YARA is a subset whose one known difference from libyara is hex alternatives of different lengths with a common start; Protobuf Decode is schemaless. **Not done:** the wave deferred Multimedia, Code tidy, the five image-based Forensics ops, Parse QR Code, Disassemble x86 and ARM, the seven PGP ops and Parse PGP Key, Magic, Register and Return, and Protobuf Encode (all "not yet"), and dropped HTTP request and DNS over HTTPS.

Language gaps found in wave 7 (candidates for the core, or for a primitive; those already listed for earlier waves are not repeated):

- `ForgeError` keeps only the 16 innermost frames, so an error raised deep in nested words loses its recipe-step attribution (`attributeError` needs the `bake:main` frame); the packet and fingerprint words validate in a shallow pass first to avoid this. The fix belongs in the frozen core (`packages/lang` or `packages/recipe`) and is a candidate for a bug fix.
- There is no null value; `json` uses a sentinel record (key U+DFFF followed by `null`) and refuses lone surrogates.
- A word's parameter name shadows the core word of the same name (for example `len`).
- `and` and `or` do not short-circuit, `while` loops are unbounded (a bounded loop is a `reduce` over a range), and a `case` or multi-way branch is missing.
- There is no float-to-string; decimals are written by long division on rationals.
- Every `get` of a large value counts its size against `maxTotalBytes`; a record built with one `put` per item copies itself each time, and `util:list-flatten` exhausts the total-allocation budget at about 3,800 small lists.
- A primitive that returns a list returns a JS array, one that returns a record returns a `Map`, and `valueHelpers.int` has no `maxIntBits`.
- RECIPES §2.2 checks the parameters after the first input only, so a shared word with a `record` or `list` parameter and a UI-typed input becomes an op unless it has a `list` parameter or lives in an internal vocabulary.
- Doc strings are capped at 2000 code points.
- A library prim such as XPath, CSS or Jsonata cannot be interrupted inside the VM; it relies on the hard kill, and is marked as a regex primitive for that reason.
- `charset:decode` rebuilds its tables on every call (`mime` works around it); the lack of per-vocabulary constants (waves 1 and 3) shows again.
- The ops package has no Node typings (no `Buffer`, `process` or `URL` in tests), and `ambient.d.ts` lacks `TextDecoder` and `btoa` typings in places; several WPs broke the typecheck on this.
- Tooling in this sandbox: Playwright expects Chromium build 1254 while `/opt/pw-browsers` has 1243, so the browser gates ran with `PLAYWRIGHT_BROWSERS_PATH` pointing at symlinks (no repository change); `npm test` needs `lang` and `recipe` built first; time-sensitive tests (the ASN.1 depth test, the LZString bomb) time out under heavy parallel load and pass alone.

### Phase 6 — Beyond CyberChef
Magic auto-detection (declarative `checks` in META, depth-limited search). An optional recipe store backend behind `RecipeStore`. A PWA/offline mode. The `@forge/cli`. Recipe diff/swap. **Relix vocabulary** integration as an `relix:` vocab of primitives.

## 8. How the orchestration will run

- **Agent mix**: Sonnet-class agents for spec-critical work (1.1, 1.5, 1.6, 2.2, 3.3). Haiku-class agents for well-specified, repetitive WPs (ops with test vectors, coverage-table generation, docs). Each agent gets the spec, the WP's "done" line, and the rule *no commits with attribution, no pushes*.
- **Isolation**: parallel WPs run in separate git worktrees on `wp/<id>` branches. The orchestrator merges after review.
- **Verification per WP**: read the diff, then re-run `npm run lint && npm run typecheck && npm test && npm run build` (+e2e from Phase 3) on the merged result, then spot-check behaviour by hand.
- **Shared utilities**: op agents check `packages/ops/vocab/util.fth` (§3.5) before writing a helper. In their report they list **utility candidates**: helpers they wrote that look generally useful, each with its name, stack effect and why. The orchestrator reviews these, and `npm run dupes -w @forge/ops`, on every WP, and promotes accepted ones into `util` through a small follow-up WP. The dupes test blocks exact copies across vocabularies. **Parallel agents cannot edit `util.fth`**, so an agent that needs a helper keeps a **straight private copy** with the comment line `\ util-candidate: <proposed util name>` right before it, and lists it in the report. It must never vary the body to avoid the sweep (a reordered or re-spelled copy is a defect; `npm run dupes` also reports "likely re-implementations": private helpers with the same effect signature and the same set of core words). Exact copies that all carry the marker are reported as "pending util promotion" and do not fail the test; the orchestrator promotes them into `util` at the wave close-out, removes the copies and the markers, and the dupes test fails if any marker is left. Near duplicates and likely re-implementations are resolved or justified at the close-out.
- **Coverage table**: every op WP adds or updates its own `docs/coverage/<area>.json` (never another WP's) and runs `npm run coverage`, committing the regenerated `docs/COVERAGE.md`. A test fails when it is out of date.
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
