# Forge toolkit: Relix, symbolic algebra and packs (programme plan)

Status: draft v1 (2026-11-11). A plan, not yet normative. It builds on [PLAN.md](PLAN.md) (§1 principles, §3.5 primitives, §5 security, §7 phases, §8 orchestration, §9 decisions), [SYMBOLIC.md](SYMBOLIC.md) (v1), [LANGUAGE.md](LANGUAGE.md) (FL v0.1), [RECIPES.md](RECIPES.md) and [UI.md](UI.md) (§4 CSP). Relix facts come from the `relix-core` source tree, `relix/docs/design/query-builder.md` and `relix/.claude/BACKLOG.md`.

> **Packages are frozen.** `packages/*` hold frozen Phase 1–2 contracts (CLAUDE.md). Most of this plan changes them. Nothing in it starts before the owner approves the version bump at the gate of Phase T1 (§13.3). The spikes of Phase T0 are throwaway code on branches and change no contract.

> **Estimates are marked.** Every number in this document comes from the research summarised in §2 or from a file cited next to it. Thresholds and sizes that are proposals or estimates say so. Sizes are relative (S, M, L). There are no calendar dates.

## Contents

1. Goals and scope
2. Where we are
3. Decisions T1 to T8
4. Architecture
5. The pack system
6. Extension values and viewers
7. The data pack: the table value
8. The Relix pack
9. The symbolic pack
10. Media and code packs
11. FL v0.2
12. One implementation per capability
13. Phases, gates and work packages
14. Risks and open questions
15. Relationship to other documents

---

## 1. Goals and scope

The owner set six goals.

1. **Relix in Forge.** Bring Relix (the relational algebra engine, Java 21, repositories `relix-core`, `relix`, `relix-cli`, `relix-mcp`) into Forge. Build Relix queries by drag and drop, like recipes, and run them in Forge. Let Relix use FL on data from queries, and let Forge use Relix on its data.
2. **Symbolic algebra.** Add an HP 48GX-style symbolic algebra system, and decide whether it is integral to Forge or a plugin.
3. **A smaller core.** Move operations that do not fit Forge's ethos (image manipulation, multimedia such as playing audio) out of the core into a separate system.
4. **A better language.** Fix FL's deficiencies, driven by an analysis of the existing FL corpus.
5. **More in FL.** Write as many operations as possible in FL.
6. **One implementation per capability.** No duplicated effort between Relix and Forge.

**In scope:** a pack system; extension value kinds with viewers; a table value; a Relix pack; FL callable from Relix in the browser and on the JVM; a symbolic pack; media and code packs; FL v0.2 and a mechanical migration of the in-repo corpus.

**Not in scope:** HTTP or database sources for Relix inside Forge (T3); third-party code that is not FL (T7); replacing Relix's built-in functions with FL (an open question, Q6); any addition to the Relix 1.0.0 scope before the owner pulls it in (Q1).

Goals 3 and 6 pull against goal 1. A Relix engine in the browser is a second place where hashing, regex and date logic exist (§12). The plan resolves this by holding the two sides together with shared vectors, not by rewriting either side.

---

## 2. Where we are

### 2.1 Forge today

From PLAN.md §7: **363 ops in 155 vocabularies**. CyberChef coverage: **198 covered, 140 redesigned, 5 dropped, 163 not yet, of 506**. 4,488 op vectors in 155 files. The tree has 161 `.fth` files in `packages/ops/vocab`: the 155 op vocabularies plus six internal ones.

**Triage of the 184 "not yet" ops** (the orchestrator's classification, not yet in the coverage JSON):

| Class | Count | Contents |
|---|---|---|
| Core fit | 124 | Data format 20, Encryption/Encoding 2, Public Key 30, Networking 34, Compression 21, 4 extractors, 5 code-tidy serialisers, 5 forensics, 3 other |
| Media and rendering | 34 | All 27 Multimedia ops (Render Image, Play Media, Render PDF, Generate Image, OCR, 14 image transforms, Convert Image Format, Add Text To Image, 4 charts); forensics pixel ops (Extract RGBA, View Bit Plane, Randomize Colour Palette, Extract LSB); Generate and Parse QR Code; Render Markdown |
| Code tidy | 13 | Syntax highlighter, Generic Code Beautify, JavaScript Parser, Beautify and Minify, JSON, XML, SQL and CSS Beautify and Minify |
| Other | 13 | XPath, JPath, Jsonata, CSS selector, Template, Jq, Strip HTML tags, To Snake, Camel and Kebab case, Magic, Register, Return |

No media op is implemented today. Earlier waves replaced visual output with text (diff, fuzzy match, colour, to-table).

### 2.2 Seams that already exist

- `VocabSourceProvider` and `createBundleLoader(provider)` (`packages/ops/src/bundle.ts`, `types.ts`) separate where vocabulary sources come from from how they load.
- `createBakerCore({ loadBundle })` takes the loader by injection.
- User FL units load as untrusted and cannot bind primitives (PLAN §5).
- The catalogue rule restricts only parameter types (`UI_PARAM_TYPES`), not data or output types, so list and record data already flows between steps (RECIPES §2.2).
- `RunOptions.deny` (effect denial) exists, but the baker does not use it.
- The web app is feature-registered (`apps/web/src/modules.ts`).
- Output values with an unknown tag render as `other`.

### 2.3 Blockers

| Area | Blocker |
|---|---|
| Discovery | Vocabulary discovery is a compile-time glob. The baker `init` protocol carries only vocabulary names and FL units. |
| Start-up | The app calls `init` with `vocabs: "all"` (see `apps/web/src/bake/controller.ts`), so all 70 primitive chunks load at worker start. |
| Output | `OutputValue` has no table, image or audio kind. |
| CSP (UI.md §4) | Rule 6 forbids HTML or Markdown rendering of computed text. Rule 8 limits `fetch` to the catalogue. The CSP has no `media-src`, so audio and video are blocked (`default-src 'none'`). `img-src` allows `blob:`, and canvas works. |
| Recipe shape | Steps are single-input (`( bytes -- any )`). A recipe is a tree, not a DAG. Parameters cannot be trees. The bake takes one input (the active tab only). |
| Language | `EffectLabel` is a closed union (`+async`, `+random`, `+time`; `packages/lang/src/types.ts`). Value has nine tags with exhaustive switches. |
| Doc drift | RECIPES §2.2 and R18 name two internal vocabularies (`recipe`, `bake`). `INTERNAL_VOCABS` in `packages/ops/src/types.ts` holds six (`recipe`, `bake`, `util`, `blockmode`, `random`, `list`). Fixed in Phase T1. |

### 2.4 Table cost under the FL size meter

A table of 10,000 rows by 10 integer columns costs about **4.08 MB** as a list of records (408 B per row) and about **1.6 MB** columnar. Untrusted limits are 16 MiB per value and 256 MiB cumulative. With list-of-records that allows roughly 50 to 60 table-producing steps before `E_LIMIT_TOTAL`. This is why the table value is columnar (§7).

### 2.5 The FL corpus (measured)

| Measure | Value |
|---|---|
| Files, lines | 150 `.fth` files, 16,792 lines |
| Colon words | 1,853; 439 public, 1,414 private |
| Private words called exactly once | 984 |
| Primitives | 70 modules, 9,190 TypeScript lines, 119 primitives |
| Stack shuffling | 3.5 per 100 tokens |
| Single-use helpers that only bind a closure variable | 84 |
| Small single-use named helpers | 221 |
| Zero-input words used as constants | 101; 22 of them rebuild tables on every call (`html:decode` about 5 ms per call, the CRC table about 20,000 steps per call); only 3 `CONSTANT`s exist |
| `choice{}` headers | 237 with 116 distinct lists; 70% of occurrences are copies (`pkcs7\|none` 24 times, the delimiter list 23, block modes 20) |
| else-if chains | 234; 96 at depth 3 or more |
| `try` uses | 12, all for control flow (about 1 ms per caught error) |
| Qualified `raise:` calls | 253 |
| `VARIABLE`s | 106; 89 of them in five machine simulations |
| `util` | 82 public words; 37 used by three or more vocabularies (top: `between?` 59 calls, `cp>str` 58, `space?` 42, `delimiter` 33, `zero-pad` 26, `int>be-bytes` 24) |

**Why the 119 primitives exist:**

| Reason | Primitives | Notes |
|---|---|---|
| Wrappers of audited libraries (noble) | 24 in 18 files | Stay TypeScript |
| Host capability | 13 | Stay TypeScript |
| Missing core maths and IEEE | 7 | L-A |
| Sort and shuffle | 3 | L-A |
| Stateful loop or array | 9 (727 code lines) | L-C buffers |
| Own cipher and hash cores | 53 in 25 files (3,626 code lines, 57% of primitive code) | Written in TypeScript because FL is too slow at 64 KiB |
| Other | 10 | `cmac` and `lmhash` exist only because private words are not callable across vocabularies; base64 and hex were never ported |

*Dated note (2026-11-14):* the table above is the measure at the time of the survey and is kept as it was. Since then the analysis `log2`, the coords maths, the list `sort`, `sort-by` and `shuffle`, `cmac`, `lmhash` and the `hex` primitive have moved to FL. `base64` is now FL with two private helpers (`_sextets`, `_unsextets`).

**Measured FL cost:** TEA 478 VM steps per byte (about 31 M steps at 64 KiB, three times the 10 M budget); SHA-1 186 steps per byte (about 12.2 M); RC4 in today's FL 80 steps per byte (5.25 M, passes).

**Conclusion.** Syntax features alone would move about 8 to 12 of the 119 primitives (10 to 14% of primitive code). The cipher and hash cores need a performance mechanism, not syntax. The evidence for that mechanism is thin: two measured ciphers and one hash.

### 2.6 Relix (from source)

- About 122,000 lines of Java 21 on the engine path (processor 19.1k, semantic 17.3k, ast 15.6k, optimizer 12.3k, plan 11.0k, parser 8.4k, others smaller). Engine modules have no external runtime dependency (only `java.base`). The parser is hand-written. There are no threads, virtual threads or reflection on the core path. It uses records, sealed interfaces, pattern switches, `BigDecimal` for all numbers, `java.time`, `java.util.regex` and streams. `ServiceLoader` discovery is avoidable (`FunctionCatalog.of`).
- `relix-embed` hard-requires `java.sql` and the standard connectors (its `module-info.java`), so a browser assembly must wire the pipeline itself.
- About 50 `RelNode` kinds. Unary: π σ ρ γ τ λ δ ω μ ∀ TOP WINDOW ROLLING SESSIONIZE DOWNSAMPLE PIVOT UNPIVOT TREE CLOSURE CLUSTER PATH TRACE SAMPLE SHUFFLE ROLL SOLVE OPTIMIZE COVER. Binary: ⋈ (theta, outer, semi, anti), ASOF, IJOIN, LATERAL, × ÷ ∘, ∪ ⊎ ⊔ − ∩ ∆. FIX and ITERATE take a base and a step.
- Statements: `N := { relexpr }`, inline tables, `source … from csv/json/http/database/generator`, `def` (scalar and table-valued UDFs, pure Relix bodies), `query`.
- Value model: 11 sealed kinds. NUMBER is `BigDecimal`. There is no bytes type. NULL is SQL three-valued. Struct, array and date/time types exist. ADR-0026 says third parties add functions, not value types.
- Function SPI: `FunctionLibrary` with `StrictScalarFunction.invoke(ctx, List<Value>)`; aggregates via `Accumulator`. This is the seam for calling FL.
- Built-ins overlap Forge in hashing (md5, sha1, sha2), regex, string, date parse and format, JSON path and edit distance. Relix has no base64, hex, URL, HTML or crypto functions.
- The embedding API takes in-memory data (`table(name, columns, rows)`, `source(name, schema, supplier)`, `input(name, CSV/TSV/JSON/NDJSON stream)`). A `Relation` is a value, with non-executing terminals `render()`, `optimized()`, `explain()`, `schema()` and executing ones `stream()` and `toList()`.
- AST and text round-trip through `ScriptPrinter` (glyph or keyword spelling, tested). There is no AST to JSON serialiser, so Relix text is the interchange format.
- The `relix.*` catalog has `relix.functions` (name, category, arity, return type) but no parameter names and no `relix.operators`.
- Every worked example in the Relix reference is executed and diffed in its build. That is a ready-made conformance corpus.
- `relix/docs/design/query-builder.md` (a sketch) describes a drag-and-drop builder. It says "Not the engine in the browser… compiling the engine to WebAssembly is unproven for this codebase", and recommends a local server. It lists engine work a builder needs: span ends, an error-recovering parser, per-operator row counts.
- **Freeze.** `relix-core`, `relix-cli` and `relix-mcp` are in a 1.0.0 feature freeze (BACKLOG.md). Only SQL parity, gpt-oss issues, core bugs and the CLI `init`/`add` commands land. Additions to the published API must land before 1.0 or wait for a minor release. Everything else waits until after 1.0.

---

## 3. Decisions T1 to T8

Decisions T1 to T7 were taken with the owner on 2026-11-11. **T8 is the orchestrator's recommendation** and is not yet owner-approved. Ids use the prefix T to avoid collisions with LANGUAGE.md's D-numbers, PLAN §9 and SYMBOLIC.md's S-numbers.

| ID | Decision | Rationale |
|---|---|---|
| T1 | Relix in the browser: first a time-boxed spike (R0) compiling the real engine, in-memory path only, to JavaScript or WebAssembly. Fall back to a TypeScript subset engine only if the spike fails its criteria. | Goal 6. A second engine is the fallback, not the plan (§8.5). |
| T2 | FL must also be callable from standalone JVM Relix, by embedding the existing TypeScript FL VM in GraalJS as an optional Relix function library. FL is not ported. | One FL implementation (goal 6). |
| T3 | Relix queries in Forge read in-browser data only: input tabs, dropped files, recipe outputs. No HTTP or database sources. | PLAN §1 (client-side only); UI.md §4 rule 8. |
| T4 | Symbolic algebra is an optional pack: a small TypeScript kernel plus rules and words written in FL. This supersedes SYMBOLIC.md S6 (value vocabularies live in `packages/ops`) and S7 (all-TypeScript engine). SYMBOLIC.md needs a v2. | Goal 5; user-extensible rules; the answer to the 48 question in §9.1. |
| T5 | Media and rendering ops and code-tidy ops become optional packs in the same app: off by default, lazily loaded, with their own output viewers. | Goal 3. |
| T6 | FL v0.2 may include breaking fixes. The in-repo corpus is migrated in one mechanical sweep. | Goal 4; the fixes in §11.5 cannot be additive. |
| T7 | Plugin model: first-party packs are separate workspace packages built and deployed with the site, because the CSP allows only same-origin script. Third parties may share FL-only vocabularies, which already run as untrusted code. | UI.md §4 rules 4, 5 and 8. |
| T8 | **Recommendation.** A relation and a symbolic expression are both "expression values": built by words, carried on the stack, printed and parsed by a registered text form, and evaluated only by explicit terminal words. One mechanism (extension value kinds, tagged literals, budgets, viewers) serves both. | Two clients of one mechanism are cheaper than two mechanisms (§6.5). |

---

## 4. Architecture

Four layers.

1. **Core.** `@forge/lang` v0.2 and the core op vocabularies: codes, ciphers, encodings, data formats, parsing, hashing, crypto, compression, networking parsers, text and byte utilities.
2. **Pack system.** Manifest, discovery, enabling, lazy loading, capabilities.
3. **Extension values and viewers.** The `ext` value tag, its registry, and per-kind output viewers and parameter widgets.
4. **Packs.** `data` (tables), `relix`, `symbolic`, `media`, `code`.

```
 +---------------------------------------------------------------+
 | apps/web  (shell, recipe pane, console, input/output tabs)    |
 |   viewer registry     param-widget registry     pack manager  |
 +-------------------------------+-------------------------------+
                                 |  (3) extension values: ext{kind}
 +-------------------------------v-------------------------------+
 | (2) pack system: manifest, composite VocabSourceProvider,     |
 |     baker init(pack ids), capabilities (+media, ...), budgets |
 +--------+----------+-----------+-----------+-------------------+
          |          |           |           |
      +---v--+   +---v---+   +---v----+  +---v---+  +--------+
      | data |   | relix |   |symbolic|  | media |  |  code  |  (4) packs
      |table |   |engine |   | kernel |  |canvas |  |tidy,   |
      |      |   |+ FL   |   | + FL   |  |audio  |  |highlt. |
      |      |   |bridge |   | rules  |  |QR     |  |        |
      +---^--+   +---^---+   +---^----+  +-------+  +--------+
          |          |           |
 +--------+----------+-----------+-------------------------------+
 | (1) core: @forge/lang v0.2 + @forge/ops core vocabularies     |
 |     table, json, csv in core; generic arithmetic; ext tag     |
 +---------------------------------------------------------------+

 JVM side:  Relix engine --FunctionLibrary--> relix-fl --GraalJS--> @forge/embed (lang + ops)
```

The `table` kind, `csv` and `json` are small and needed by core data-format ops, so the recommendation (Q4) is that they sit in core. In that case the `data` pack of the diagram is core code with a viewer, not a separately enabled pack. If the owner prefers a pack, the same code moves to `packs/data` and the core data-format ops depend on it.

---

## 5. The pack system

### 5.1 What a pack is

A pack is a workspace package `packs/<name>` holding:

- `vocab/*.fth` and `prims/*.ts`;
- extension value kinds (§6);
- parameter widgets and output viewers;
- an optional UI feature (a pane), registered like `apps/web/src/modules.ts`;
- test vectors (`*.test.json`) and coverage JSON;
- a **manifest**: id, version, vocabularies, capabilities, size.

### 5.2 Discovery, loading, enabling

- Packs are discovered **at build time** into one manifest. A composite `VocabSourceProvider` merges core and enabled packs.
- The baker `init` message carries **pack ids**. They are validated against the build-time manifest. An id taken from a URL is never used verbatim without that check (UI.md §4 rule 6).
- `vocabs: "all"` is replaced by loading the **dependency closure** of what the recipe or console uses. This also stops core loading all 70 primitive chunks at start.
- Enabling is per browser, stored in IndexedDB (UI.md §4 rule 10).
- Opening a shared recipe that names a pack op **offers to enable the pack**. The pack is first-party code on the same origin, and the UI shows a visible notice saying so.
- Packs are outside the 250 kB gzip core-plus-shell budget (PLAN §6). Each pack declares its own budget in its manifest, and `npm run size` checks it.

### 5.3 Third-party sharing

Only FL-only vocabulary files are shared. They import as untrusted units, which exists today as the `user` unit. The extension is named vocabularies with export and import. They cannot bind primitives and run under the untrusted limits (PLAN §5).

### 5.4 Capabilities

- `EffectLabel` gains labels such as `+media` (and later `+net`). Wire `RunOptions.deny` into the baker so a pack's capabilities are granted explicitly rather than ambient.
- A word that needs a capability the run has not granted is refused with a structured error.

### 5.5 Required changes to UI.md, PLAN and the CSP

| Change | Where |
|---|---|
| Rule 8 amended: `fetch` may also read the pack manifest and same-origin pack chunks | UI.md §4 |
| Rule 6 unchanged: viewers build DOM with `createElement` and `textContent`, never `innerHTML` | UI.md §4 |
| `media-src blob:` added to the CSP (media pack only; owner-approved infra change in `infra/`) | PLAN §10, UI.md §4 |
| Nothing else in the CSP changes (`img-src` already allows `blob:`; canvas works; `wasm-unsafe-eval` is already present) | |
| Core coverage table gains a `pack` status (`pack:media`, `pack:code`, …) | COVERAGE.md generator |

---

## 6. Extension values and viewers

### 6.1 The `ext` tag

Adopt SYMBOLIC.md B1 as the single mechanism. The host registers an `ext` tag through `RuntimeOptions`. Each kind provides:

- `equals`, `display` and `repr`;
- `sizeOf`, so the size meter (§2.4) accounts for it;
- `toText` and `fromText`;
- limits.

### 6.2 Output values and viewers

`OutputValue` gains a kind `ext {kind, text, view?}`. A pack registers one **viewer** per kind. Viewers build DOM with `createElement` only. Planned kinds:

| Kind | Pack | Viewer |
|---|---|---|
| `table` | core / data | virtualised grid of the first N rows, with the total |
| `relation` | relix | Relix text (and, when run, a table) |
| `sym` | symbolic | expression text |
| `rat`, `cplx`, `qty`, `matrix` | symbolic | text |
| `image` | media | canvas |
| `audio` | media | audio player |

### 6.3 Parameters

`ext{kind}` parameters carry their text form in recipe JSON and share URLs. The recipe layer validates them with `fromText`. The UI supplies a text field first, and a structured widget later where one is worth building.

### 6.4 Literals, budgets and generic words

- **B3 tagged literals:** `relix" … "` and `sym" … "`, parsed at compile time. `sym"` is `E_LEX` today, so no valid program changes token kind.
- **B5 `charge(n)`:** primitives account their work in `maxSteps` and poll abort and deadline.
- **B2 generic words:** SYMBOLIC.md left these conditional (S16, open question 3). They are now justified by three clients: symbolic arithmetic, table and relational words, and matrices. Because T6 allows breaking changes, **core arithmetic becomes generic** instead of being shadowed by a vocabulary.

### 6.5 The unifying view (T8)

A `relation` and a `sym` share a life cycle: construct with words, hold on the stack as a value that can be compared and printed, and evaluate only through a terminal word (`relix:run`, `sym-num:>num`). Both have a text form that round-trips, a size and a budget. One registry therefore serves both. If the owner rejects T8, the `ext` mechanism is still needed for `table` and `image`, and the relation and expression kinds become two separate registrations.

---

## 7. The data pack: the table value

`table` is not Relix-specific. Wave 1b data formats (CSV to JSON, JSON to CSV, YAML, MessagePack, CBOR, Avro, BSON) and `lines:to-table` need it too.

- **Representation.** Columnar, typed columns, and an **explicit null mask**, because FL has no null. Columnar is about 1.6 MB against 4.08 MB for list-of-records at 10,000 rows by 10 integer columns (§2.4).
- **One parser each.** Core owns one CSV parser and one JSON parser and serialiser. This closes the wave 4 "no JSON" gap.
- **Words.** `csv:parse ( bytes … -- table )`, `json:parse`, `table:>csv`, `table:>json`, `table:columns`, `table:rows`.
- **Viewer.** A virtualised grid of the first N rows with the total.
- **Core or pack.** Recommendation: `table`, `json` and `csv` in **core** (small, and needed by core data-format ops); relational operations in the **relix** pack. Open question Q4.
- **Memory.** The size meter charges what a value costs once. A live-size meter or structural sharing for tables is a risk item (§14.1).

---

## 8. The Relix pack

The pack has three faces of one thing.

### 8.1 Value-level words (face a)

`relix:` words build `relation` values **lazily**.

| Kind | Shape |
|---|---|
| Sources | `relix:from ( table name:str -- relation )` |
| Unary operators | `( relation params… -- relation )` |
| Binary operators | `( relation right:relation … -- relation )` |
| Terminals | `relix:run ( relation -- table )`, `relix:explain`, `relix:optimized` (text), `relix:schema`, `relix:why`, `relix:>text`, `relix:parse` |

Nothing executes until a terminal. Then the whole tree goes parse-free, straight into analyse, optimise, plan and execute, so the optimiser sees the whole query. This mirrors ADR-0027 ("a Relation is a value"). A `relation` that reaches a non-Relix op, or the end of the recipe, is **run implicitly**; the trace records the coercion `relation → table`.

### 8.2 Recipes and drag and drop (face b)

- **Unary operators are ordinary recipe steps.** A recipe is already a linear pipeline.
- **Binary operators** are steps with a **relation-valued parameter**, shown as a nested lane. A relational expression is a tree, which matches the recipe tree; the nested lane reuses the fork and subsection block UI. The recipe format needs parameters that can be trees (RECIPES v2).
- **Shared sub-expressions** are named relations: saved recipes promoted to words (PLAN §3.6 "recipes are words"). They are the analogue of `N := { … }`.
- **Predicates, projections, aggregates and sort keys** are `ext{relix-expr}`-style parameters: Relix operand or predicate text, validated live by the Relix parser. First a text field with completion from the input schema; later a structured builder widget.
- **Multiple inputs.** The bake protocol gains **named inputs** (all input tabs, by name), so `relix:input name` can read another tab. This is a `@forge/worker` protocol change (X5).
- **Recipe and Relix text.** "View as Relix" prints the recipe as a `.relix` script through the engine's printer. Importing a `.relix` script produces a recipe. Each step shows its schema (from `schema()`) and row counts.
- **Generated steps.** Operator steps are generated, not hand-written. One operator table (name, glyph, keyword, arity, parameter shapes, doc key) generates the `.fth` wrappers and metadata. Proposal to Relix: publish this as a `relix.operators` catalog relation, and expose parameter names in `relix.functions`, so Relix is the single source. That is post-1.0 unless the owner pulls it into 1.0 (Q1).
- **Help text** comes from the Relix reference pages (the `relix-docs` artifact), not rewritten.

### 8.3 The engine (face c): spike R0 first

**Candidates.**

| Candidate | Notes |
|---|---|
| TeaVM | JS or WebAssembly-GC output, ahead of time, no `eval`, so CSP-compatible in principle. To verify: Java 21 language features, and `BigDecimal`, `java.time` and `java.util.regex` fidelity. |
| GraalVM web-image, J2CL | Alternates if TeaVM fails. |
| CheerpJ | **Excluded up front.** It interprets JVM bytecode and needs dynamic code, against the CSP. |

**Assembly.** The engine jars minus `relix-embed`, `relix-connectors-std` and the ojAlgo solver. A small Java shim wires the pipeline with `FunctionCatalog.of(...)` and in-memory sources. It lives in a new module or repository (`relix-web`) that consumes the **published** engine jar, so the 1.0 freeze is respected.

**R0 pass criteria.** These are proposed thresholds for the owner to confirm (Q7). Figures marked "estimate" are guesses to be replaced.

| # | Criterion |
|---|---|
| 1 | Compiles without source changes to the engine, or with changes small enough to upstream after 1.0 |
| 2 | At least 95% of the self-contained worked examples in the Relix reference produce identical rows (proposed) |
| 3 | All `BigDecimal`, date/time and regex cases in that corpus agree |
| 4 | No CSP violation under the production headers |
| 5 | Lazy chunk at most 3 MB gzip (estimate; owner to set) |
| 6 | Cold start at most 2 s and a 10,000-row group or join at most 1 s on a mid-range laptop (estimates) |
| 7 | Cancellation works (worker terminate or cooperative) |
| 8 | A JavaScript callback from a `StrictScalarFunction` works |

### 8.4 FL from Relix inside Forge

A `FunctionLibrary` named `fl` (naming open, Q2) exposes:

1. every catalogue op whose data input and output map to Relix scalars, as a Relix function;
2. user words and promoted recipes;
3. table-valued FL words, for `LATERAL` and table-valued function use.

**Value mapping (proposed):**

| Relix | FL | Note |
|---|---|---|
| NUMBER (`BigDecimal`) | `int` when integral, else `num` | and `rat` when the symbolic pack is on (open, Q5) |
| STRING | `str` | |
| BOOLEAN | `bool` | |
| struct | `record` | |
| array | `list` | |
| NULL | none | FL has no null. FL functions are **strict**: NULL in gives NULL out without calling FL. A table's null mask carries nulls. |
| bytes | `bytes` | Relix has no bytes type. Results cross as a tagged struct or as hex text (open, Q3). |
| dates | ISO `str` | until Forge has a date value |

**Sync against async.** The FL VM is async (async primitives are awaited, PLAN §3.4); the compiled engine is synchronous. Options: TeaVM's async transformation, or evaluating FL-function columns in batches outside the engine (the planner hoists them). R0 must test this.

**Batch first.** Per-row calls are slow, so the bridge maps a word over a column.

### 8.5 The fallback

If R0 fails: a TypeScript engine for the core operators (π σ ρ γ τ λ δ, joins, set operators, TOP, basic WINDOW), held to the same reference-example corpus. Exotic operators report "needs full Relix". This is a **second engine** and conflicts with goal 6. That is why it is the fallback and not the plan.

### 8.6 The solver

`OPTIMIZE` needs a solver. ojAlgo will not be in the browser. A browser `MathProgrammingSolver` provider could later come from the symbolic pack's exact simplex. This is a stretch item, not in the base scope (Q9).

### 8.7 FL from JVM Relix (T2)

Forge publishes a single-file, dependency-free runtime bundle, `@forge/embed` (lang, ops, and a small facade that looks synchronous), as an npm package and as a resource in a jar. An optional Relix module `relix-fl` (a `FunctionLibrary` found by `ServiceLoader`, GraalJS its only dependency) loads the bundle, pumps promises, and maps values as in §8.4.

- It ships **outside the frozen engine artifact**, after Relix 1.0.
- The same conformance vectors as Forge (the op `*.test.json` files) run through it in CI.
- **Risks:** GraalJS start-up and per-call cost; WebCrypto and `CompressionStream`-backed primitives are not present in GraalJS, so the work package must list which ops degrade; the licence of GraalJS must be checked.

---

## 9. The symbolic pack

### 9.1 Integral or plugin?

On the HP 48 algebraics are integral to the object system. Here the **mechanism** (ext values, generic arithmetic, tagged literals) is integral to FL v0.2, and the **content** (the CAS) is a pack. That is the answer to the owner's question: integral where it shapes the language, a plugin where it is a body of rules.

### 9.2 Structure

Keep SYMBOLIC.md's representation, canonical form C1, text grammar, limits table, testing approach and the Stage A and B word lists. Restructure it as follows.

| Layer | Contents | Language |
|---|---|---|
| Kernel | expression value `ext{sym}`, canonical form, exact numeric tower (`rat`, `cplx`), parser and printer, pattern matcher and rewriter with a budget | TypeScript (needs speed or exactness) |
| Rules and words | derivative table, integral table, simplification rules, solving strategies, units table and conversions | rewrite-rule files and FL words in the pack's vocabularies |

The rule set is therefore user-extensible in FL (the HP 48 spirit) and honours goal 5.

### 9.3 Effect on SYMBOLIC.md

With FL v0.2 (generic words, tagged literals, ext values) landing first, the pack starts at what SYMBOLIC.md called Stage B. Stage A's record encoding and shadowing are skipped. A SYMBOLIC.md v2 must be written (work package SP5).

| SYMBOLIC.md decision | Status |
|---|---|
| S2 (two stages) | Superseded: one stage on v0.2 |
| S3 (expression as `int`, `num` or `record`) | Superseded: `ext{sym}` |
| S5 (generic arithmetic by shadowing) | Superseded: generic core arithmetic |
| S6 (value vocabularies internal, in `packages/ops`) | Superseded: they live in the pack (T4) |
| S7 (all-TypeScript engine) | Superseded: small kernel plus FL (T4) |
| S8 to S14, S20, S21 | Stand |
| S4, S15 to S19 | Not decided here. S4 (canonical form C1) is kept; S15 to S19 become core v0.2 features (§6, §11). SP5 confirms each. |

---

## 10. Media and code packs

### 10.1 Media

| Area | Plan |
|---|---|
| Images | Decode, transform and encode on canvas or `OffscreenCanvas` in the worker; image viewer. |
| Audio and video | Player viewer; needs `media-src blob:` (CSP addition, owner-approved infra change). |
| Charts | Drawn to canvas. |
| QR | Generate and parse. |
| Render Markdown | Only as DOM-built output with a sanitising allow-list, or dropped (Q8). |
| OCR | Large WASM; probably dropped, or last (Q8). |
| Forensics pixel ops | Extract RGBA, View Bit Plane, Randomize Colour Palette, Extract LSB go here. |
| Stay in core | EXIF and ID3 metadata extraction and Detect File Type (bytes to text or record). |

### 10.2 Code

Beautify, minify and syntax highlighting. JSON beautify and minify fall out of the core JSON words and stay in core.

The coverage table marks these ops `pack:media` or `pack:code`. Lowest priority of the programme.

---

## 11. FL v0.2

**Principle.** Every proposal carries a corpus number. The measuring scripts are kept as `npm run corpus-stats -w @forge/ops`, so each change reports before and after (private single-use helpers, shuffle density, primitive count and TypeScript lines, zero-input table rebuilds).

**Status.** FL v0.2 has shipped part of this section. Items marked **(done)** are in [LANGUAGE.md](LANGUAGE.md) (see its [Appendix A](LANGUAGE.md#appendix-a-changes-in-v02)) and are no longer proposals; everything else is still future work.

### 11.1 Group L-A: prelude and core words (additive)

- Promote the generic `util` words: the trim family, `starts-with`/`ends-with`, `contains`, `repeat`, `zero-pad`, `cp>str`, `between?`, `index-of`, `sum`, `tdiv`, `ceil-div`, `int>be-bytes`, `count-leading`, character predicates. (**done** for twenty words, LANGUAGE.md A.4 and §13.8; `index-of`, `tdiv` and `zero-pad` of this list were not promoted, and the old `util:` forms stay valid.)
- Maths: `ln exp log2 sin cos tan atan2 …`, `str>num`, float bit packing. (**done** for the maths words and `str>num`, LANGUAGE.md A.4; float bit packing is not done.)
- Typed failure words in core, replacing 253 qualified `raise:` calls. (**done** for the words, `fail-coerce` and `fail-range`, LANGUAGE.md A.4; the 253 existing `raise:` calls were not rewritten and stay valid.)
- `sort`, `sort-by`, `has-key?`, `find`, `any?`, `all?`, `first`, `second`, `last`, `divmod`, a `case`/`cond` combinator. (**done** for `sort`, `sort-by`, `has-key?`, `find`, `any?`, `all?`, `case` and `cond`, LANGUAGE.md A.4; `first`, `second`, `last` and `divmod` are not in v0.2.)
- JSON parse and serialise.

### 11.2 Group L-B: defining forms

- Mid-body local binding (a new token, since `{ }` is the list literal). (**done**: `:>`, LANGUAGE.md §7.1 and A.2.)
- Computed load-time constants and memoised zero-input words, run under a load budget. (**done** for memoised zero-input words, `MEMO:` and `warm()`, LANGUAGE.md §5.13 and §10.13; computed load-time constants are not: a `MEMO:` word is evaluated on first use or by `warm()`.)
- Shared named `choice` types with an optional value mapping. (**done** for the shared types, `CHOICE:` and `choice<…>`, LANGUAGE.md §5.12; the value mapping is not.)
- A "public but not an op" marker, and friend visibility for private words. This removes the `cmac` and `lmhash` primitives and the internal-vocabulary workaround. (**done** for the marker, `helper` in `META:`, LANGUAGE.md §5.9; friend visibility is not, and the primitives and internal vocabularies are still there.)
- Forward declarations and mutual recursion.
- `exit` (early return). (**done**: LANGUAGE.md §8 and A.4.)
- `VARIABLE` with any initial value, and re-entrancy.
- A record literal.

### 11.3 Group L-C: data and performance

- An indexable mutable buffer (byte or int array) with defined aliasing rules.
- A linear list or bytes builder. (**done**: the collectors `collect`, `collect-bytes`, `collect-str`, `emit` and `emit-all`, LANGUAGE.md §8 and A.4.)
- 32-bit word intrinsics and bulk word operations.
- Cost-weighted step accounting (`charge`).
- **The main lever for goal 5: spike L0**, an ahead-of-time **kernel tier**. Compile a restricted, statically typed subset of FL words (fixed-width integers, buffers, loops, no escaping quotations) to JavaScript **at build time**, for trusted bundle vocabularies. The FL text stays the single source and the interpreter stays the reference: every kernel word is tested against the interpreted run. Never at run time, and never for user code (UI.md §4 rule 5: no `eval`).
- **L0 pass criteria (proposed):** TEA, SHA-1, MD4 and RC4 written in FL pass their vectors and run 64 KiB within 3 times the time of the current TypeScript primitive.
- If L0 passes, the 53 own cipher and hash cores (3,626 lines) become candidates to move to FL. If it fails, they stay TypeScript and this plan says so: goal 5 is then capped at roughly the current FL share for crypto.
- The evidence is thin (§2.5).

### 11.4 Group L-D: extension

The `ext` tag, generic words, tagged literals, `charge` and new effect labels (§5.4, §6).

### 11.5 Group L-E: breaking fixes (T6)

- `reduce` argument order.
- `/` on integers beyond 2^53.
- Header-constraint violations raise `E_RANGE`-class errors consistently, and `runtime.call` applies header defaults (both from the wave 5 language gap list in PLAN §7).
- The `raise`/`range` name clash.
- Regex parameters with spaces or parentheses.
- The `\f` escape.
- Help and ref length caps.
- Named inputs and their interplay with the stack, reviewed.
- Core arithmetic made generic.

**Migration.** A codemod work package rewrites all 161 `.fth` files in one sweep at a **wave boundary** (no op work packages in flight). All 4,488 vectors must pass unchanged. Word hashes all change, so the catalogue version bumps.

**Share URLs.** RECIPES R8 and §3.10: a recipe step may carry an op `hash` pin. A mismatch is a warning by default (`pins: "warn"`) and an error under `"strict"`; a pin never selects an old implementation. `encodeShare` pins when it is given a catalogue. So after the sweep, unpinned URLs keep working; pinned URLs run the current op and show a `hash-mismatch` warning (or refuse, under `strict`). Whether the UI should say more than that is Q10.

### 11.6 Proposal table

Sizes are relative. "Revisits" lists LANGUAGE.md decisions or sections touched (§17 decision ids D3, D4, D5, D6, D10, D11, D18, D31, D44; §5.7 public and private words; §13 core vocabulary; §17.1 items deliberately left out, as that list stands after v0.2).

| Proposal | Corpus evidence | Unlocks | Kind | Size | Revisits |
|---|---|---|---|---|---|
| Promote `util` words to core (**done** for 20 words, LANGUAGE.md A.4) | 37 words used by 3+ vocabularies; `between?` 59 calls | Fewer duplicate helpers | Additive | S | §13 |
| Maths, `str>num`, float bits (maths and `str>num` **done**, LANGUAGE.md A.4; float bits open) | 7 missing core maths and IEEE primitives | 7 primitives to FL | Additive | M | §13, §17.1 |
| Typed failure words (words **done**, LANGUAGE.md A.4; the `raise:` calls not rewritten) | 253 qualified `raise:` calls | Shorter error paths | Additive | S | §13 |
| `sort`, `has-key?`, `find`, `case` (**done**, LANGUAGE.md A.4) | 3 sort/shuffle primitives; 234 else-if chains (96 at depth 3+); 12 `try` for control flow | Flatter code; 3 primitives to FL | Additive | M | §13 |
| JSON parse and serialise | Wave 4 gap | Data words, Relix bridge | Additive | M | §13 |
| Mid-body local binding (**done**, LANGUAGE.md A.2) | 84 closure-binding helpers; 221 single-use helpers; 984 private words called once | Fewer helpers | Additive | M | D10, §5.7 |
| Load-time and memoised constants (memoised **done**, LANGUAGE.md §5.13; load-time open) | 101 zero-input constants; 22 rebuild tables per call; 3 `CONSTANT`s | Cheaper tables | Additive | M | D4 |
| Shared `choice` types (**done** without value mapping, LANGUAGE.md §5.12) | 237 headers, 116 distinct lists, 70% copies | Fewer copies | Additive | S | D3 |
| "Public not an op" (**done**, `helper`, LANGUAGE.md §5.9), friend visibility (open) | `cmac`, `lmhash`; six internal vocabularies in code | Cross-vocabulary reuse | Additive | M | §5.7 |
| Forward declarations, `exit` (**done**, LANGUAGE.md §8), any `VARIABLE` initial value, record literal | 106 `VARIABLE`s, 89 in five machine simulations | Simpler state machines | Additive | M | D6, D31, D10, §17.1 |
| Mutable buffer (open), linear builder (**done** as collectors, LANGUAGE.md §8) | 9 stateful-loop primitives (727 code lines) | Those primitives to FL | Additive | L | D44, D18 |
| 32-bit word intrinsics, `charge` | TEA 478 steps per byte; SHA-1 186 | Cost-weighted limits | Additive | M | D44 |
| Kernel tier (L0) | 53 cipher and hash cores, 3,626 lines (57% of primitive code) | Cores to FL, if L0 passes | Additive | L | D5, D44 |
| `ext` tag, tagged literals, generic words | Three clients (symbolic, tables, matrices) | Packs, T8 | Additive | L | D11, §17.1 |
| Breaking fixes (L-E) | Wave 5 gap list | Consistent errors, generic arithmetic | **Breaking** | M | D5 |

---

## 12. One implementation per capability

| Capability | Single owner | How the other side gets it |
|---|---|---|
| Encodings, hashes, ciphers, compression, text and byte utilities | FL / Forge | Relix gets them as the `fl` function library (browser bridge, §8.4; JVM `relix-fl`, §8.7). Relix gains base64, hex, URL and crypto without writing them. |
| Relational operators, optimiser, provenance, recursion, solver operators | Relix | Forge never writes table joins or grouping in FL; the relix pack delegates. Existing text-level list ops (`lines:sort`, `set:*`, `arith:*`) stay as they are (text in, text out). |
| Scalar functions present on both sides (md5/sha, regex, string, date, JSON path, edit distance) | Both, before Relix 1.0 | No rewrite on either side before Relix 1.0. Held together by shared vectors: run Forge's vectors against the Relix built-ins and the reverse in a throwaway cross-check, as PLAN §7 did with CyberChef. After 1.0, making Relix's non-pushdown built-ins delegate to FL is an open question (Q6). |
| CSV and JSON parsing in the browser | Forge core | Forge's parsers feed Relix through in-memory tables; the compiled engine's own file readers are not shipped. |
| Expression parsing | Relix (operands), symbolic kernel (algebra) | The Relix operand parser comes with the compiled engine; the symbolic parser is the kernel's. Align operator precedence and call syntax, document the differences, write no third parser. |
| Query builder UI | Forge recipe pane | Relix's own query-builder sketch (local server plus static page) is not built separately. It can host the Forge relix pack against a local engine later. |
| Reference documentation | Relix | The Relix reference pages are the help text. |
| Operator and function metadata | Relix catalog | Forge generates wrappers (§8.2). |
| Numeric tower | Defined once in the bridge | `BigDecimal` (Relix) to `int`/`num`/`rat` (FL and symbolic), §8.4. |
| Test corpora | Each side | Relix reference examples and Forge op vectors each run on both sides of the bridge. |
| CLIs | Shared | `@forge/cli` (PLAN Phase 6) and `relix` share via `relix-fl`. |

---

## 13. Phases, gates and work packages

### 13.1 Conventions

CLAUDE.md applies. The orchestrator breaks the work into work packages (WPs) and delegates each to an inexpensive sub-agent: Sonnet (**So**) for spec-critical work, Haiku (**Ha**) for well-specified or repetitive work. Independent WPs run in parallel, each in its own git worktree on a `wp/<id>` branch, with explicit file ownership. After each WP the orchestrator reads the diff, checks the file ownership, merges, and re-runs `npm run lint && npm run typecheck && npm test && npm run build`, plus `npm run e2e` and `npm run size`. At the end of a phase: `npm run gate2:browser -w @forge/worker` and a check of the built app served with `node apps/web/scripts/serve-prod.mjs`. Every new source file carries the Apache-2.0 header. No attribution trailers. No push, `terraform apply` or AWS change without the owner.

WP id prefixes: **L** FL v0.2; **P** pack system; **X** extension values; **D** data; **R** Relix pack; **J** JVM bridge; **S** symbolic; **M** media and code; **SP** specifications; **C** convergence. Spikes use their own ids (R0, L0, J0, X0). Decision ids use T. File paths in the "owns" column are proposals; the brief for each WP fixes them. Per-WP sizes are set when the briefs are written; sizes for FL proposals are in §11.6.

### 13.2 Phase T0: spikes

Parallel, time-boxed, throwaway code. Each ends in a written result and an owner gate.

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| R0 | Relix engine compiled to JS or Wasm, in-memory path; report against §8.3 criteria | scratch repo or branch (not `packages/*`) | none | So | Result document lists each criterion as pass or fail with measurements |
| L0 | Kernel-tier compiler prototype; TEA, SHA-1, MD4, RC4 in FL | scratch branch | none | So | Result document with vectors and timings against §11.3 |
| J0 | FL VM bundle run in GraalJS; one op called from a Java test | scratch repo | none | So | Result lists start-up, per-call cost and ops that degrade |
| X0 | `ext` value, registry, one viewer and one parameter kind prototype | scratch branch | none | So | A table kind renders in the UI under the production headers |

**Gate T0.** The owner reads the four results and decides: R0 go or fallback; L0 go or cap; whether J0 allows the JVM bridge; whether the X0 shape is accepted.

### 13.3 Phase T1: specifications

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| SP1 | LANGUAGE.md v0.2 (§11) | `docs/LANGUAGE.md` | Gate T0 | So | Every proposal in §11.6 has a normative section and a list of conformance blocks |
| SP2 | RECIPES.md v2: ext parameters, relation-valued parameters, named inputs, pack ops, pin behaviour | `docs/RECIPES.md` | SP1 | So | Schema changes listed; §2.2 internal-vocabulary drift fixed |
| SP3 | UI.md amendments: viewers, pack rules, CSP | `docs/UI.md` | SP1 | So | Rules 6 and 8 amendments and the `media-src` change written |
| SP4 | PACKS.md | `docs/PACKS.md` | SP1 | So | Manifest schema, discovery, init protocol, capability model |
| SP5 | SYMBOLIC.md v2 (§9.3) | `docs/SYMBOLIC.md` | SP1 | So | Decision table updated; WP table rewritten |
| SP6 | RELIX.md: pack spec, value mapping, operator table | `docs/RELIX.md` | SP1, R0 | So | Mapping table complete; naming (Q2) decided |

**Gate T1.** The owner approves the frozen-contract changes. CLAUDE.md says `packages/*` are frozen; this plan needs an explicit version bump of FL, the recipe schema and the worker protocol.

### 13.4 Phase T2: FL v0.2 and corpus migration

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| L1 | `npm run corpus-stats` scripts and a baseline report | `packages/ops/scripts/corpus-stats.*` | none (may start now) | Ha | Report reproduces the §2.5 numbers |
| L2 | Group L-A words (prelude, maths, failure, sort/find, `case`) | `packages/lang/src/core/*` | Gate T1 | So | Conformance blocks pass |
| L3 | JSON parse and serialise in core | `packages/lang`, `packages/ops/prims/json.ts` | L2 | So | Round-trip properties pass; one JSON implementation |
| L4 | Mid-body local binding | `packages/lang/src/reader.ts`, `compiler.ts` | Gate T1 | So | Existing programs compile identically |
| L5 | Load-time constants, memoised words, shared `choice` types | `packages/lang`, `meta*` | L4 | So | Load budget tested |
| L6 | Visibility marker, friend access, forward declarations, `exit`, `VARIABLE`, record literal | `packages/lang` | L4 | So | `cmac`/`lmhash` primitives can be removed |
| L7 | Mutable buffer, linear builder, 32-bit intrinsics | `packages/lang`, `values.ts` | L2 | So | Aliasing rules tested; D44 purity kept |
| L8 | `charge`, cost-weighted accounting, polling inside primitives | `packages/lang/src/vm.ts`, `primitives.ts` | L7 | So | A primitive hits `maxSteps` deterministically in Node and a Worker |
| L9 | Breaking fixes L-E (language part) | `packages/lang` | L2 | So | Each fix in §11.5 has a conformance block |
| L10 | Generic arithmetic and generic words | `packages/lang/src/compiler.ts`, `dictionary.ts`, `vm.ts` | X1, L9 | So | Plain numbers bit-identical to v0.1; step overhead measured |
| L11 | Kernel tier (only if L0 passes) | `packages/lang/src/kernel/*` | L7, L0 | So | Every kernel word equals the interpreted run |
| L12 | Codemod over the 161 `.fth` files | `packages/ops/vocab/*.fth` | L2 to L10 | So | All 4,488 vectors pass unchanged; catalogue version bumped; run at a wave boundary |
| L13 | Move primitives to FL (the 7 + 3 + 9 made possible by L2 and L7; the cipher and hash cores only if L11 passes) | `packages/ops/prims/*`, `vocab/*` | L12, L11 | Ha | Vectors unchanged; corpus-stats report shows the change in primitive count and lines. Dated note (2026-11-14): the analysis `log2`, the coords maths, the list `sort`, `sort-by` and `shuffle`, `cmac`, `lmhash` and the `hex` primitive are now FL, and `base64` is FL with two private helpers (`_sextets`, `_unsextets`). |

L10 needs the `ext` tag (X1), so X1 is built inside Phase T2 although it appears in the T3 table; the gate for T2 covers it.

**Gate T2.** Conformance tests, op vectors, `gate2:browser` and `gate4:browser` green; the corpus-stats before/after report is attached.

### 13.5 Phase T3: pack system, extension values, data

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| X1 | `ext` tag core: registry, equality, size, text form, header `ext{kind}` | `packages/lang/src/types.ts`, `values.ts`, `meta.ts` | Gate T1 | So | v0.1 conformance unchanged |
| X2 | `OutputValue` ext kind and viewer registry | `packages/worker/src/render.ts`, `apps/web/src/io/*` | X1 | So | Unknown kinds fall back to text; DOM built without `innerHTML` |
| X3 | `ext` parameters in recipe JSON, URL and UI | `packages/recipe`, `packages/ops/src/types.ts`, `apps/web/src/params/*` | X1, SP2 | So | An ext parameter round-trips JSON, FL and URL |
| X4 | Tagged literals | `packages/lang/src/reader.ts`, `compiler.ts` | X1 | So | Error offset points at the bad character |
| X5 | Named inputs in the bake protocol and UI | `packages/worker/src/protocol.ts`, `apps/web/src/bake/*` | SP2 | So | A step can read another input tab by name |
| P1 | Pack manifest and build-time discovery | `packs/*/manifest.*`, `packages/ops/src/bundle.ts` | SP4 | So | Manifest generated and validated |
| P2 | Composite provider and baker `init` with pack ids | `packages/worker`, `packages/ops/src/bundle.ts` | P1 | So | Ids not in the manifest are refused |
| P3 | Dependency-closure loading in place of `vocabs: "all"` | `apps/web/src/bake/controller.ts`, `packages/worker` | P2 | So | Core start-up no longer loads all primitive chunks |
| P4 | Pack manager UI and IndexedDB store | `apps/web/src/packs/*` | P2 | So | Enable and disable persist per browser |
| P5 | Shared-recipe enable offer and notice | `apps/web/src/*` | P4, X3 | So | Opening a recipe naming a pack op offers to enable |
| P6 | Effect labels and `RunOptions.deny` wired into the baker | `packages/lang/src/types.ts`, `packages/worker` | X1 | So | A denied capability produces a structured error |
| P7 | Per-pack size budgets in `npm run size`; `pack` coverage status | size script, coverage generator | P1 | Ha | Budget breach fails CI |
| P8 | Demo pack with one ext kind and one viewer | `packs/demo/*` | P2, X2 | Ha | Loads lazily under production headers |
| D1 | `csv` words and the one CSV parser in core | `packages/ops/vocab/csv.fth`, `prims/csv.ts` | L3 | So | RFC 4180 vectors pass |
| D2 | `table` kind: columnar, typed, null mask | `packages/ops/src/table/*` | X1 | So | Size cost near the §2.4 columnar figure |
| D3 | `table` words and table viewer (virtualised grid) | `packages/ops/vocab/table.fth`, `apps/web/src/io/table-view.ts` | D2, X2 | So | Grid shows first N rows with total |
| D4 | Wave 1b data-format ops on `table` | `packages/ops/vocab/*` | D1, D3 | Ha | Vectors pass |

**Gate T3.** A demo pack with one ext kind and one viewer loads lazily under production headers. Core start-up no longer loads all primitive chunks.

### 13.6 Phase T4: Relix pack, then the JVM bridge

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| R1 | `relix-web` shim and build (location per Q11) | `relix-web/*` | R0, Gate T1 | So | Reference-example corpus runs in a browser worker |
| R2 | Operator table and wrapper generator | `packs/relix/gen/*` | SP6 | So | Generated `.fth` and metadata for every operator in the table |
| R3 | `relation` ext kind and value-level words | `packs/relix/vocab/*` | R1, X1, D2 | So | Build, `relix:run`, `explain`, `schema`, `>text`, `parse` pass vectors |
| R4 | Table-to-engine and engine-to-table interchange; implicit run coercion | `packs/relix/prims/*` | R3 | So | Null mask and typed columns round-trip |
| R5 | `relix-expr` parameter with live validation and schema completion | `packs/relix/ui/*` | X3, R1 | So | A bad expression is reported at its position |
| R6 | Nested-lane UI for relation-valued parameters | `apps/web/src/recipe/*` | SP2, R3 | So | A binary operator step shows a lane; e2e passes |
| R7 | "View as Relix" and `.relix` import | `packs/relix/*`, `apps/web` | R3 | So | Recipe to text to recipe is the identity on supported steps |
| R8 | Per-step schema and row counts | `packs/relix/ui/*` | R3 | Ha | Counts shown on each step |
| R9 | `fl` function library in the browser (batch-first bridge) | `packs/relix/fl-bridge/*` | R1, R4 | So | A Relix query calls an FL op over a column |
| R10 | Help from `relix-docs` | `packs/relix/docs/*` | R2 | Ha | Help text comes from the reference pages |
| R11 | Conformance harness: reference examples against the browser engine | `packs/relix/test/*` | R1 | Ha | Pass rate reported against the §8.3 criteria |
| R12 | TypeScript fallback engine (only if R0 failed) | `packs/relix/engine-ts/*` | Gate T0 | So | Held to the same corpus; exotic operators report "needs full Relix" |
| J1 | `@forge/embed` single-file bundle | `packages/embed/*` | Gate T2, J0 | So | Runs under Node and GraalJS |
| J2 | `relix-fl` module (`FunctionLibrary`, GraalJS) | `relix-fl/*` (location per Q11) | J1; Relix 1.0 | So | Found by `ServiceLoader`; an FL op callable in a query |
| J3 | Value mapping and vector run in CI | `relix-fl/test/*` | J2, SP6 | Ha | Op `*.test.json` vectors pass through the bridge |
| J4 | List of degraded ops (WebCrypto, `CompressionStream`) and licence note | `relix-fl/README*` | J2 | Ha | List complete |

**Gate T4.** In the browser, under the production CSP: a recipe decodes Base64, parses CSV, filters, joins a second input tab, groups, shows a table, and round-trips through "view as Relix"; and a Relix query calls an FL op. The J packages complete after Relix 1.0.

### 13.7 Phase T5: symbolic pack

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| S1 | Kernel contract: types, limits, `Budget`; canonical form C1, parser, printer | `packs/symbolic/kernel/*` | SP5, X1 | So | Round-trip and idempotence properties on random trees |
| S2 | Numeric tower: `rat`, `cplx`, exact `eval`, `>num`, `where` | `packs/symbolic/kernel/numeric.ts` | S1 | So | Exact identities; eval against float |
| S3 | Pattern matcher and rewriter with budget and cycle detection | `packs/symbolic/kernel/rules.ts` | S1 | So | Match modulo commutativity vectors |
| S4 | Rule files and FL words: simplify, collect, expand, derivative, Taylor, sum | `packs/symbolic/vocab/*`, `rules/*` | S3 | So | Simplify idempotent; derivative against central difference |
| S5 | Integral rules (table, substitution, parts, partial fractions) | `packs/symbolic/rules/integrate*` | S4 | So | Derivative of the integral returns the integrand |
| S6 | Solving words | `packs/symbolic/vocab/solve.fth` | S4 | So | Every returned root checked by substitution |
| S7 | Units table and conversions in FL | `packs/symbolic/vocab/units.fth` | S2 | Ha | Conversion vectors against exact factors |
| S8 | Matrices (`ext{matrix}`) | `packs/symbolic/kernel/matrix.ts` | S2 | So | Exact `det` and `inverse` over rationals |
| S9 | Recipe ops, catalogue entries, viewer, bake tests | `packs/symbolic/ops/*` | S4 to S7 | Ha | `gate4:browser` passes with the new vectors |
| S10 | Independent-CAS cross-check (throwaway) | none retained | S9 | So | All disagreements explained; script deleted |

**Gate T5.** SYMBOLIC.md v2 vectors pass and the cross-check is closed.

### 13.8 Phase T6: media and code packs

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| M1 | Media pack skeleton and `media-src blob:` CSP change (owner-approved) | `packs/media/*`, `infra/` | Gate T3 | So | Pack loads; CSP test passes |
| M2 | Image kind, canvas decode and encode, image viewer | `packs/media/*` | M1 | So | Image round trip in a worker |
| M3 | 14 image transforms, format conversion, text overlay | `packs/media/vocab/*` | M2 | Ha | Vectors on small fixtures |
| M4 | Audio and video player viewer | `packs/media/*` | M1 | So | Plays under production headers |
| M5 | Charts to canvas | `packs/media/*` | M2 | Ha | Four chart types render |
| M6 | QR generate and parse | `packs/media/*` | M2 | Ha | Standard test vectors pass |
| M7 | Forensics pixel ops | `packs/media/vocab/*` | M2 | Ha | Vectors pass |
| M8 | Code pack: beautify, minify, highlight | `packs/code/*` | Gate T3 | Ha | Vectors pass |
| M9 | Decision work: Render Markdown and OCR | doc only | Q8 | So | Owner's decision recorded |

### 13.9 Phase T7: convergence

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| C1 | Shared-vector cross-check: Forge vectors against Relix built-ins and the reverse | throwaway script | Gate T4 | So | Differences listed and resolved or recorded |
| C2 | Catalog-driven generation from `relix.operators` (if it exists) | `packs/relix/gen/*` | Relix 1.0, Q1 | So | Generated output equals the hand-fed table |
| C3 | Link from the Relix site playground to the pack | Relix site content (owner-approved) | Gate T4 | Ha | Link works |
| C4 | User docs for packs, the Relix pack and the symbolic pack | `docs/*` | all | Ha | Docs build |

### 13.10 Dependency sketch

```
 T0 spikes:  R0   L0   J0   X0
              \    |    |    /
               v   v    v   v
 T1 specs:   SP1 -> SP2 SP3 SP4 SP5 SP6        [Gate T1: owner]
                         |
 T2 FL v0.2:  L2..L10 (+X1) -> L12 (wave boundary) -> L13
                         |  (L11 only if L0 passed)
 T3 packs:    X1 -> X2 X3 X4 X5 ; P1 -> P2 -> P3 P4 P5 ; D1 D2 -> D3 -> D4
                         |
 T4 Relix:    R1 -> R3 -> R4 -> R9 ; R5 R6 R7 R8 ; (R12 if R0 failed)
              J1 -> J2 -> J3   (after Relix 1.0)
 T5 symbolic: S1 -> S2 S3 -> S4 -> S5 S6 ; S7 S8 -> S9 -> S10
 T6 media:    M1 -> M2 -> M3 M5 M6 M7 ; M4 ; M8 ; M9
 T7:          C1 C2 C3 C4
 Parallel throughout: PLAN wave 1b (needs D), wave 6, wave 7
```

T5 and T6 depend on Gate T3 only, not on T4, so they can run in parallel with the Relix pack once packs and ext values exist.

### 13.11 What can start now

- The four spikes: R0, L0, J0, X0.
- Drafts of the six specifications SP1 to SP6 (SP6 waits for the R0 mapping results; none is merged before Gate T0).
- L1, the corpus-stats scripts, which change no contract.

**Scheduling rule.** The L12 sweep runs at a wave boundary. The remaining core waves from PLAN.md (wave 1b data formats, now depending on D; wave 6 compression; wave 7 public key, networking, forensics) run in parallel throughout, but no op work package may be in flight while L12 runs.

**Count.** The tables hold 69 work packages (13 + 17 + 16 + 10 + 9 + 4), plus 4 spikes and 6 specifications. Several are conditional (L11, L13 in part, R12, J2 to J4). The Phase T3 and T4 tables can be merged in pairs if coarser packages are preferred.

---

## 14. Risks and open questions

### 14.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | R0 fails, or the chunk is too large | Fallback engine (§8.5), reduced to core operators; or a local engine later |
| 2 | `BigDecimal`, time and regex behaviour diverge between the compiled engine and the JVM | The reference-example corpus is the gate (R0 criterion 3); R11 |
| 3 | Sync engine against async FL | Batch hoisting outside the engine; R0 tests it |
| 4 | L0 fails, so goal 5 is capped at roughly the current FL share for crypto | The plan says so (§11.3); the 53 cores stay TypeScript |
| 5 | The breaking v0.2 migration churns parallel op work | One sweep at a wave boundary (L12); no op WPs in flight |
| 6 | Frozen-contract changes in `packages/*` | Explicit version bump at Gate T1 |
| 7 | The Relix 1.0 freeze delays engine-side asks | Asks (Q1) are scheduled after 1.0 unless the owner pulls them in; the pack works from the published jar |
| 8 | CSP relaxation for media | Limited to `media-src blob:`; owner-approved; media pack only |
| 9 | Scope: this is several products | Phase gates; packs optional and independent after T3 |
| 10 | GraalJS constraints (start-up, missing browser APIs, licence) | J0 measures; J4 lists degraded ops |
| 11 | Table memory under the allocation meter | Columnar representation; propose a live-size meter or structural sharing for tables |

### 14.2 Open questions for the owner

| # | Question |
|---|---|
| Q1 | Which Relix API additions to pull into 1.0 versus after: a `relix.operators` catalog, parameter names in `relix.functions`, a public Value to JSON writer, span ends? |
| Q2 | Naming of FL ops as Relix functions: `fl.base64_decode` or another scheme? |
| Q3 | NULL and bytes mapping (§8.4): bytes as a tagged struct or as hex text? |
| Q4 | Are `table`, `json` and `csv` core (recommended) or a pack? |
| Q5 | Is the `rat` mapping for NUMBER wanted when the symbolic pack is on? |
| Q6 | Should Relix's non-pushdown built-ins later delegate to FL? (The owner chose "also in JVM Relix", not "FL replaces Relix built-ins".) |
| Q7 | R0 thresholds (§8.3): confirm or replace the proposed values and the estimates. |
| Q8 | Are Render Markdown and OCR dropped? |
| Q9 | Are exotic operators (SOLVE, OPTIMIZE, COVER) in scope for the browser? |
| Q10 | How should pinned share URLs behave across the v0.2 hash change, beyond the existing `hash-mismatch` warning? |
| Q11 | Where do `relix-web` and `relix-fl` live: new repositories or the relix umbrella? |
| Q12 | Are PLAN.md Phase 6 items (Magic, recipe store, PWA, CLI) re-sequenced behind this programme? |
| Q13 | Is T8 (relations and symbolic expressions as one kind of expression value) accepted? |

---

## 15. Relationship to other documents

- **PLAN.md.** The Phase 6 line "Relix vocabulary integration as an `relix:` vocab of primitives" is superseded by this plan. PLAN §9 gains the decisions T1 to T8 once approved. The coverage table gains the `pack` status.
- **SYMBOLIC.md.** Superseded in part: S2, S3, S5, S6 and S7 (§9.3). S8 to S14, S20 and S21 stand. A v2 is written in WP SP5.
- **LANGUAGE.md.** A v0.2 is written in WP SP1.
- **RECIPES.md.** A v2 is written in WP SP2. The §2.2 internal-vocabulary drift (two named, six in `INTERNAL_VOCABS`) is fixed there.
- **UI.md.** Amended in WP SP3 (rules 6 and 8, the CSP, viewers and pack rules).
- **New documents.** PACKS.md (SP4) and RELIX.md (SP6).
