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
- **Independent implementation.** CyberChef is Apache-2.0 under Crown Copyright. Forge mirrors its *feature set* only. No code, description strings, data tables or branding are copied. See research §6.

## 2. Repository

A single public monorepo, `forge` (npm workspaces, Node ≥ 20, TypeScript strict, Vite, Lit, Vitest, ESLint and Prettier, Apache-2.0). It currently exists locally at `~/workspace/forge`. The GitHub repo will be created when we're ready to publish. Commits and PRs carry **no AI/tool attribution trailers**.

```
packages/lang     @forge/lang   FL language: reader, compiler, VM, values, vocabularies, metadata
packages/ops      @forge/ops    Operation vocabularies (vocab/*.fth) + TS primitives they need
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

A small **coercion table** (for example `str→bytes` as UTF-8 and `bytes→str` as UTF-8 strict) is applied only at word boundaries, when the declared input type differs. It is strict by default: invalid UTF-8 is an error, not U+FFFD. Every coercion is recorded in the trace so the UI can show it.

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
- The header and `META:` desugar to one **JSON metadata record** stored on the dictionary entry. Its fields are `name`, `vocab`, `effect`, `params[]`, `category`, `doc`, `aliases`, `seeAlso`, `effects` (`+random`, `+time`, `+async`) and `version`/`hash`. The TS registry and the UI read only this record.
- **Quotations** `[ ... ]` are first-class and support combinators: `map`, `each`, `if`, `times`, `fork`, `try`.
- **Defining words** are `:` and `;`, `CONSTANT`, `VARIABLE` (scoped per run) and `PRIMITIVE` (binds only to TS registry entries; it cannot be used from untrusted code).

### 3.3 Vocabularies and name resolution

- A vocabulary is a wordlist with a name.
- Resolution is **lexical per source unit**, not a mutable global search order. Lookup goes through the current `IN:` vocabulary, then the `USING:` list in order, then `core`.
- A qualified reference `vocab:word` always resolves through exactly that vocabulary.
- An unqualified name that is found in two `USING:` vocabularies is a **compile error**, which is resolved by qualifying it.
- Recipes and saved words always store **fully qualified names**, plus a word version or content hash, so their meaning cannot drift.
- Classic `ALSO`/`ONLY`/`PREVIOUS` are left out on purpose.

### 3.4 Execution model

- A compiler turns the source into a **flat instruction array** per word (literal, call, primitive call, branch, quotation ref). Interpreting that array in a VM loop with explicit data and return stacks gives:
  - single-step and breakpoints at instruction or recipe-step granularity;
  - an execution trace (stack snapshots per step) for the debugger UI;
  - cooperative cancellation through `AbortSignal`, checked every N instructions;
  - **resource limits**: max steps, stack depth, return depth, bytes per value and total, and a wall-clock deadline;
  - **async primitives** (WebCrypto, CompressionStream, lazily loaded WASM). A primitive may return a Promise, and the loop awaits it.
- The VM runs identically in Node (tests and CLI) and in a Web Worker (the UI). There is one async code path, never a sync/async split.
- Errors are structured `ForgeError {code, message, word, vocab, step, ip, stackSnapshot}`. They are never smuggled into output text.

### 3.5 Primitives (the TypeScript FFI)

```ts
definePrimitive({
  vocab: "base64", name: "decode-raw",
  effect: "( str alphabet:str -- bytes )",
  fn: (input: string, alphabet: string): Uint8Array => { … },
});
```

The runtime pops values, coerces and validates them, calls `fn` with plain JS values, validates the result and pushes it. Primitives never touch the stack. That makes them pure, unit-testable functions, and a stack-discipline bug in a primitive cannot corrupt the VM. Heavy dependencies sit only behind primitives in lazily loaded modules, and a lint rule stops `@forge/lang` from importing them.

Rule of thumb: codecs, ciphers with real arithmetic, hashes and compression are primitives. Classical ciphers, wrappers, aliases, composition and recipes are FL.

### 3.6 Recipes are words

The recipe model in `@forge/recipe` is a **tree**, not a flat list. Flow control is structural, which fixes CyberChef's Fork/Merge-by-name problem:

```jsonc
{ "forge": 1, "name": "decode-blob",
  "steps": [
    { "op": "base64:decode", "params": { "alphabet": "standard" } },
    { "fork": { "split": "\\n", "join": "\\n" }, "steps": [
        { "op": "classical:rot", "params": { "amount": 13 } } ] },
    { "op": "hash:sha256", "disabled": true, "breakpoint": false } ] }
```

- It compiles deterministically to FL. Literals are pushed and then the word is called, and a fork becomes a quotation plus `fork`:
  `: decode-blob ( bytes -- bytes ) "standard" base64:decode "\n" "\n" [ 13 classical:rot ] fork ;`
- The UI edits only the JSON. The FL is derived from it, and words hand-written outside the canonical subset appear as a single opaque step.
- **Named parameters** with a recipe schema version mean that adding a parameter to an op never breaks old links.
- **URL encoding**: `#r=<base64url(deflate(JSON))>&i=<…>` plus a human-readable FL form for copy and paste. The format is versioned from day one.
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
- All baking happens in a Worker with hard limits (§3.4). We deploy with a strict CSP, `connect-src 'none'` for the worker origin where hosting allows.
- Metadata, help and errors are rendered as text or sanitised Markdown, never raw HTML. Regex parameters are bounded in length and time-boxed.

## 6. Testing and quality

- **Unit tests** cover the reader, compiler, VM, coercion and every primitive (Vitest, run in Node).
- **Operation conformance tests**: each word has a test vectors table (`vocab/<name>.test.json`). A generic runner executes all of them through the VM. Vectors come from RFCs and standards, and published known-answer tests are preferred.
- **Golden recipe tests** check the JSON ⇄ FL ⇄ URL round-trip, and that compiled output is identical.
- **Property tests** (fast-check) check `decode(encode(x)) == x` for every codec pair.
- **Browser end-to-end** (Playwright, from Phase 3) covers drag-and-drop, param validation, bake, share URL and keyboard-only use.
- **CI** runs lint, typecheck, tests, build and e2e on every PR. Bundle-size budget: the core plus UI shell must be under 250 kB gzip, and op modules are lazy.

## 7. Phases and work packages

Each work package (WP) is sized for one sub-agent and has a verifiable "done". The orchestrator reviews every WP's diff and re-runs the full CI locally before merging. **Gate** = what must be true before the next phase starts.

### Phase 0 — Foundations ✅
- Monorepo scaffold, CI, licence and research. *Done 2026-11-09.*

### Phase 1 — Language core (`@forge/lang`)
| WP | Scope | Done when |
|---|---|---|
| 1.1 | `docs/LANGUAGE.md` spec (grammar EBNF, value model, coercions, header and META syntax, resolution rules, error codes) | reviewed and frozen as v0.1 |
| 1.2 | Reader/tokenizer with source positions; string, number, char and byte-literal (`#[ de ad ]`) forms | 100% branch coverage of the grammar |
| 1.3 | Values, coercion table, `ForgeError` | unit tests per coercion pair |
| 1.4 | Dictionary, vocabularies, `IN:`/`USING:`, qualified lookup, ambiguity errors | resolution test matrix |
| 1.5 | Compiler to instruction arrays; quotations; locals for parameters; `:` `;` `CONSTANT` `VARIABLE` | compiles the spec examples |
| 1.6 | VM: run loop, async primitives, AbortSignal, limits, step/breakpoint hooks, trace | limit and cancel tests; 1e6 simple steps < 200 ms |
| 1.7 | Primitive registry/FFI + `core` vocabulary (stack, arithmetic, control, combinators, bytes/str basics) | core words documented and tested |
| 1.8 | Metadata desugaring (header + META → JSON) with a JSON Schema; `help`/`see` words | schema-validated for every word |
| 1.9 | Node REPL script for development | `npm run repl` works |

**Gate 1:** `classical:rot` is written in FL with a validated parameter, runs in Node, and its metadata JSON validates.

### Phase 2 — Operation runtime (`@forge/recipe`, `@forge/worker`, `@forge/ops` loader)
| WP | Scope |
|---|---|
| 2.1 | `.fth` vocabulary loading (Vite plugin that bundles `vocab/*.fth`; catalogue JSON derived at build time, no hand-maintained registry) |
| 2.2 | Recipe JSON schema + validator + recipe→FL compiler (incl. fork/subsection/conditional/label-free loops) |
| 2.3 | URL codec (versioned, deflate+base64url) + human-readable FL form; round-trip goldens |
| 2.4 | Worker host: bake API, cancellation, watchdog, lazy primitive module loading, progress events |
| 2.5 | Conformance test runner for `*.test.json` vectors |

**Gate 2:** A three-step recipe (from-base64 → rot13 → to-hex) built from JSON, encoded in a URL and decoded again bakes identically in Node and in a Worker.

### Phase 3 — UI (`apps/web`)
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

**Gate 3:** End to end in the browser, a user can search, drag, configure, bake, share a URL, reload it and get the same result, using the keyboard only.

### Phase 4 — Starter operation set (proves the model)
About 40 ops in the `encoding`, `classical`, `bits` and `text` vocabularies. They include To/From Hex, Base32, Base64, Base58 and Base85, Binary, Decimal, Charcode, URL encoding and HTML entities, ROT13/ROT47, Caesar/rot, Atbash, Affine, Vigenère, Bacon, Bifid, Rail Fence, A1Z26, Morse, Substitute, XOR (+brute force), AND/OR/NOT/ADD/SUB, bit shift and rotate, Reverse, Upper/Lower case, Find/Replace, Split/Join, Fork/Merge (structural), Entropy and Frequency distribution.
These are split across about four parallel agents by vocabulary. Every op ships with test vectors.

**Gate 4:** All starter ops pass conformance in Node and in the browser e2e smoke test.

### Phase 5 — CyberChef parity waves
CyberChef has **506 operations** in 16 categories (see research §5 and the appendix). Ports happen in waves ordered for a codes-and-ciphers audience. Each wave is a set of per-vocabulary WPs run as parallel agents, gated by conformance vectors:

1. Remaining encodings/data formats (Base45/62/92, Punycode, Quoted-Printable, Braille, BCD, …)
2. Historical cipher machines (Enigma, Bombe, Typex, Lorenz, SIGABA, …) and remaining classical ciphers
3. Hashing (WebCrypto where possible, small audited libraries elsewhere)
4. Modern symmetric crypto (AES/DES/Blowfish/ChaCha/…), KDFs
5. Utils, extractors, regex, date/time, arithmetic
6. Compression (CompressionStream; WASM zstd/brotli, which CyberChef users have asked for)
7. Public key, networking parsers, forensics, multimedia, code tidy (lowest priority)

Each WP also records parity in `docs/PARITY.md`, a generated table of CyberChef op → Forge word → status.

### Phase 6 — Beyond parity
Magic auto-detection (declarative `checks` in META, depth-limited search). An optional recipe store backend behind `RecipeStore`. A PWA/offline mode. The `@forge/cli`. Recipe diff/swap. **Relix vocabulary** integration as an `relix:` vocab of primitives.

## 8. How the orchestration will run

- **Agent mix**: Sonnet-class agents for spec-critical work (1.1, 1.5, 1.6, 2.2, 3.3). Haiku-class agents for well-specified, repetitive WPs (ops with test vectors, parity-table generation, docs). Each agent gets the spec, the WP's "done" line, and the rule *no commits with attribution, no pushes*.
- **Isolation**: parallel WPs run in separate git worktrees on `wp/<id>` branches. The orchestrator merges after review.
- **Verification per WP**: read the diff, then re-run `npm run lint && npm run typecheck && npm test && npm run build` (+e2e from Phase 3) on the merged result, then spot-check behaviour by hand.
- **Order**: Phase 1 is mostly sequential (1.1 → 1.2/1.3 in parallel → 1.4 → 1.5 → 1.6/1.7/1.8 in parallel). Phase 3.1–3.2 can start once Gate 1 passes, against a mocked catalogue. Phases 4 and 5 are highly parallel.

## 9. Decisions to confirm

1. **Licence**: Apache-2.0 (matches the ecosystem; scaffolded). Change now if you prefer MIT or GPL.
2. **Qualified-name syntax**: `vocab:word` (proposed) vs `vocab::word` vs `vocab.word`.
3. **Parameter binding**: stack inputs that are *also* named locals (proposed) vs stack-only, which is purer Forth but painful for multi-parameter ciphers.
4. **Case sensitivity**: word names case-insensitive (traditional Forth) or case-sensitive (proposed: case-sensitive, lower-kebab convention).
5. **Repo name/owner** on GitHub (`david-Darkcollective/forge`?) and when to make it public.
6. **Hosting**: GitHub Pages from CI (proposed) vs elsewhere.

## 10. Environment notes

- The local `~/.npmrc` pins `cafile` to the mkcert root only, which breaks registry access. The scaffold was installed with `NPM_CONFIG_CAFILE` pointing at an export of the macOS system roots. Either add the system roots to that bundle or remove the `cafile` line. CI is unaffected.
