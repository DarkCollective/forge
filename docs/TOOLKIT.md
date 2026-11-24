# Forge toolkit: Relix, symbolic algebra and packs (programme plan)

Status: draft v1 (2026-11-11), amended 2026-11-23 with the owner's Gate T0 decisions for R0 and X0 and, the same day, the Gate T1 decisions for SP2 and SP6, and on 2026-11-24 with the rest of the Gate T1 decisions, for SP1, SP3 and SP4 (§3, T35 to T52). A plan, not yet normative. It builds on [PLAN.md](PLAN.md) (§1 principles, §3.5 primitives, §5 security, §7 phases, §8 orchestration, §9 decisions), [SYMBOLIC.md](SYMBOLIC.md) (v1), [LANGUAGE.md](LANGUAGE.md) (FL v0.1), [RECIPES.md](RECIPES.md) and [UI.md](UI.md) (§4 CSP). Relix facts come from the `relix-core` source tree, `relix/docs/design/query-builder.md` and `relix/.claude/BACKLOG.md`.

> **Packages are frozen.** `packages/*` hold frozen Phase 1–2 contracts (CLAUDE.md). Most of this plan changes them. Nothing in it starts before the owner approves the version bump at the gate of Phase T1 (§13.3). The spikes of Phase T0 are throwaway code on branches and change no contract.

> **Estimates are marked.** Every number in this document comes from the research summarised in §2 or from a file cited next to it. Thresholds and sizes that are proposals or estimates say so. Sizes are relative (S, M, L). There are no calendar dates.

## Contents

1. Goals and scope
2. Where we are
3. Decisions T1 to T8, Gate T0 (T9 to T22) and Gate T1 (T23 to T52)
4. Architecture
5. The pack system
6. Extension values and viewers
7. The data pack: the table value
8. The Relix pack
9. The symbolic pack
10. Media and code packs
11. FL v0.3
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

**In scope:** a pack system; extension value kinds with viewers; a table value; a Relix pack; FL callable from Relix in the browser and on the JVM; a symbolic pack; media and code packs; FL v0.3 and a mechanical migration of the in-repo corpus.

**Not in scope:** HTTP or database sources for Relix inside Forge (T3); third-party code that is not FL (T7); replacing Relix's built-in functions with FL (an open question, Q6); any addition to the Relix 1.0.0 scope before the owner pulls it in (Q1).

Goals 3 and 6 pull against goal 1. A Relix engine in the browser is a second place where hashing, regex and date logic exist (§12). The plan resolves this by holding the two sides together with shared vectors, not by rewriting either side.

---

## 2. Where we are

### 2.1 Forge today

**461 ops in 201 vocabularies** (measured 2026-11-24, L1, from the catalogue of the built package). The tree has **208** `.fth` files in `packages/ops/vocab` (28,759 lines) and 201 `.test.json` files holding **7,589** vectors (measured 2026-11-24, L1). The 363 ops in 155 vocabularies and the 4,488 vectors of PLAN §7 are the wave 6 counts of 2026-11-11 and are superseded. The 161 `.fth` files of that time were the 155 op vocabularies plus six internal ones; today there are 201 op vocabularies and seven internal ones (measured 2026-11-24, L1). The full report is in [research/corpus-baseline-2026-11-24.md](research/corpus-baseline-2026-11-24.md).

**Triage of the 184 "not yet" ops** (the orchestrator's classification):

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
| Recipe shape | Steps are single-input (`( bytes -- any )`). A recipe is a tree, not a DAG. **Slots** replace "parameters cannot be trees": a binary operator step carries lanes (`pipe`, `left`, `right`) beside `params` ([RECIPES-1.2](RECIPES-1.2.md) §4, T24). The bake takes one input (the active tab only) until X5. |
| Language | `EffectLabel` is a closed union (`+async`, `+random`, `+time`; `packages/lang/src/types.ts`). Value has nine tags with exhaustive switches. |
| Doc drift | RECIPES §2.2 and R18 name two internal vocabularies (`recipe`, `bake`). `INTERNAL_VOCABS` in `packages/ops/src/types.ts` holds **eight** (`recipe`, `bake`, `util`, `blockmode`, `random`, `list`, `json`, `asn1`), not six. The §2.2 correction is done: it is written in [RECIPES-1.2](RECIPES-1.2.md) §13 and in rule 2 of RECIPES.md §2.2. |

### 2.4 Table cost under the FL size meter

A table of 10,000 rows by 10 integer columns costs about **4.08 MB** as a list of records (408 B per row) and about **1.6 MB** columnar. Untrusted limits are 16 MiB per value and 256 MiB cumulative. With list-of-records that allows roughly 50 to 60 table-producing steps before `E_LIMIT_TOTAL`. This is why the table value is columnar (§7).

### 2.5 The FL corpus (measured)

*Dated note (2026-11-24):* the figures below were re-measured by `npm run corpus-stats -w @forge/ops` on the tree of 2026-11-24 (measured 2026-11-24, L1; T52). The report, with the definition of each measure, is [research/corpus-baseline-2026-11-24.md](research/corpus-baseline-2026-11-24.md). The survey figures of 2026-11-14 are given in brackets. Where the survey gave no definition, the script's definition is L1's choice, and the report says so.

| Measure | Value |
|---|---|
| Files, lines | 208 `.fth` files, 28,759 lines (measured 2026-11-24, L1) [survey: 150 files, 16,792 lines] |
| Colon words | 3,254; 609 public, 2,645 private (measured 2026-11-24, L1) [survey: 1,853; 439 public, 1,414 private] |
| Private words called exactly once | 1,816 (measured 2026-11-24, L1) [survey: 984] |
| Single-use helpers that only bind a closure variable | 0 (measured 2026-11-24, L1) [survey: 84]. Definition: a private single-use word whose whole body is one quotation that uses a named input |
| Small single-use named helpers | 98 (measured 2026-11-24, L1) [survey: 221]. Definition: a private single-use word, not a closure helper, with a body of at most 5 tokens |
| Stack shuffling | 1.95 per 100 tokens (measured 2026-11-24, L1) [survey: 3.5]. Tokens: 100,410 reader tokens |
| Zero-input words used as constants | 67 words with an output (not `MEMO:`), of which 10 build a literal on each call; 119 `MEMO:` words; 7 `CONSTANT`s (measured 2026-11-24, L1) [survey: 101 words, 22 rebuilding, 3 `CONSTANT`s] |
| `choice{}` headers | 94 occurrences with 92 distinct lists; 4 occurrences whose list recurs (measured 2026-11-24, L1) [survey: 237 with 116 distinct lists, 70% copies; the survey's definition of a copy is not in the text] |
| Else-if chains | 9 chains of 12 links; 1 of depth 3 or more, the deepest of depth 5 (measured 2026-11-24, L1) [survey: 234 chains, 96 at depth 3 or more]. The script counts an `if` whose else quotation ends with another `if`; the survey's definition is not in the text, so the two are not comparable |
| `try` uses | 31 (measured 2026-11-24, L1) [survey: 12] |
| Qualified `raise:` calls | 0 (measured 2026-11-24, L1) [survey: 253; the `raise` vocabulary was removed on 2026-11-15] |
| `VARIABLE`s | 106; 87 in the five busiest files, `bombe`, `typex`, `enigma`, `lorenz` and `punycode` (measured 2026-11-24, L1) [survey: 106; 89 in five machine simulations] |
| `util` | 80 public words; 32 used by three or more vocabularies (measured 2026-11-24, L1) [survey: 82 and 37]. Top calls: `be-int` 52, `delimiter` 34, `zero-pad` 22, `letter?` 20, `match-texts` 16, `decode-table` 15. The survey's leaders (`between?`, `cp>str`, `space?`) are core words now |

*Measured 2026-11-24, L1:* the tree has **193** `definePrimitive(` calls in **101** primitive modules, with **21,723** TypeScript lines (16,741 code lines). 22 modules import `@noble`, with 43 primitives between them (survey: 119 primitives in 70 modules, 9,190 lines). The table below is the survey's own classification by reason, which the script does not repeat (see the report's *Not measured*).

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

## 3. Decisions T1 to T8, Gate T0 and Gate T1

Decisions T1 to T7 were taken with the owner on 2026-11-11. **T8 is the orchestrator's recommendation** and is not yet owner-approved. Ids use the prefix T to avoid collisions with LANGUAGE.md's D-numbers, PLAN §9 and SYMBOLIC.md's S-numbers.

| ID | Decision | Rationale |
|---|---|---|
| T1 | Relix in the browser: first a time-boxed spike (R0) compiling the real engine, in-memory path only, to JavaScript or WebAssembly. Fall back to a TypeScript subset engine only if the spike fails its criteria. | Goal 6. A second engine is the fallback, not the plan (§8.5). |
| T2 | FL must also be callable from standalone JVM Relix, by embedding the existing TypeScript FL VM in GraalJS as an optional Relix function library. FL is not ported. | One FL implementation (goal 6). |
| T3 | Relix queries in Forge read in-browser data only: input tabs, dropped files, recipe outputs. No HTTP or database sources. | PLAN §1 (client-side only); UI.md §4 rule 8. |
| T4 | Symbolic algebra is an optional pack: a small TypeScript kernel plus rules and words written in FL. This supersedes SYMBOLIC.md S6 (value vocabularies live in `packages/ops`) and S7 (all-TypeScript engine). SYMBOLIC.md needs a v2. | Goal 5; user-extensible rules; the answer to the 48 question in §9.1. |
| T5 | Media and rendering ops and code-tidy ops become optional packs in the same app: off by default, lazily loaded, with their own output viewers. | Goal 3. |
| T6 | FL v0.2 may include breaking fixes. The in-repo corpus is migrated in one mechanical sweep. | Goal 4; the fixes in §11.5 cannot be additive. |
| T7 | Plugin model: first-party packs are separate workspace packages built and deployed with the site, because the CSP allows only same-origin script. Third parties may share FL-only vocabularies, which already run as untrusted code. **Those vocabularies are not packs** (PACKS.md §1.2, PK1). | UI.md §4 rules 4, 5 and 8. |
| T8 | **Recommendation.** A relation and a symbolic expression are both "expression values": built by words, carried on the stack, printed and parsed by a registered text form, and evaluated only by explicit terminal words. One mechanism (extension value kinds, tagged literals, budgets, viewers) serves both. | Two clients of one mechanism are cheaper than two mechanisms (§6.5). |

### Gate T0 decisions (owner, 2026-11-23)

The owner decided Gate T0 for **R0 and X0 only**. **L0 and J0 have not run.** The L0 decision (go or cap) and the J0 decision (whether the JVM bridge goes ahead) stay open, and Gate T0 is not closed until they are decided. Ids continue the T series. Detail is in the result documents.

| ID | Decision | Source |
|---|---|---|
| T9 | **R0: go, on TeaVM's JavaScript backend.** The TypeScript fallback (§8.5) is not needed for the core. | [R0](research/r0-relix-in-browser.md) §1, §12 |
| T10 | **Accept the R0 patch set:** five engine patches plus the optional cancellation patch 0006. Upstream them after the Relix 1.0 freeze. 0002 and 0005 change no behaviour. 0003 needs a numerics review. 0004 upstreams as a guarded call. 0001 goes with T11. | [R0](research/r0-relix-in-browser.md) §12 item 1 |
| T11 | **Browser-build limits accepted.** Locale collation and seeded `java.util.Random` differ from the JVM and are documented limits. The seeded forms that differ are `SHUFFLE SEED` and uniform `ROLL SEED`; `SAMPLE … SEED` and `ROLL BY … SEED` match ([RELIX.md](RELIX.md) §1.4; refined by T34). The fixes (an `Intl.Collator` bridge, size M; a JDK-compatible `Random`, size S to M) are deferred. | [R0](research/r0-relix-in-browser.md) §12 item 2 |
| T12 | **Q7 closed.** The provisional R0 thresholds are the standing thresholds: at least 95% of examples identical, at most 3 MB gzip, cold start at most 2 s, a 10,000-row join or group at most 1 s. | [R0](research/r0-relix-in-browser.md) §2, §12 item 3 |
| T13 | **Q9 closed.** `OPTIMIZE` and `COVER EXACT` need the solver and are out of the browser. `SOLVE`, `ROLL` and `SHUFFLE` are in, with the seeded-random limit of T11. | [R0](research/r0-relix-in-browser.md) §12 item 4 |
| T14 | **Host callbacks (FL called from Relix) are synchronous only, with batching** in the FL bridge. The async build (+51% gzip) is rejected. | [R0](research/r0-relix-in-browser.md) §9, §12 item 5 |
| T15 | **Wasm GC is a later optimisation.** Re-test it when TeaVM's Wasm runtime no longer uses `new Function`, which Forge's CSP forbids. | [R0](research/r0-relix-in-browser.md) §8, §12 item 6 |
| T16 | **Spike code location (partial answer to Q11).** The R0 spike code lives in the private repository `DarkCollective/relix-web`, so `relix-web` is its own repository. Where `relix-fl` lives stays open. | [R0](research/r0-relix-in-browser.md) §13 item 1 |
| T17 | **X0: the shape is accepted** for X1, X2, X3, D2 and D3, with the amendments of [X0](research/x0-ext-values.md) §11 (see §13.5). | [X0](research/x0-ext-values.md) §1, §11 |
| T18 | **Extension kind registry (R1, R2, R3).** A process-wide registry, keyed by kind name. Registration is idempotent and the last one wins. A pack that claims a kind another pack owns is refused at the manifest (P1). `StackSlot.kind` and `ParamSpec.kind` are added. | [X0](research/x0-ext-values.md) §10 R1 to R3 |
| T19 | **Contract and checks (R4, R5, R8).** X1 and X2 are a contract version bump at Gate T1. Kind-aware fit checks and badges go in X2. `sizeOf` is O(1), a conservative upper bound and cached, with a conformance test per kind. | [X0](research/x0-ext-values.md) §10 R4, R5, R8 |
| T20 | **Kind parsers and schema (R6, R12, R7).** A kind's parser is one dependency-free module imported by both the worker and the page. Decide it with P1. A per-step schema in the bake result goes with X5, and X3 depends on it. | [X0](research/x0-ext-values.md) §10 R6, R7, R12 |
| T21 | **Table decisions (R9, R10, R11, Q4).** D3 ships first-N rows with the total and a stated limit for 1.0. Rows on demand are deferred. D2 gets a faithful text form and an `int` column. **Q4 closed:** `table` is core, not a pack. D1 parses straight into columns. | [X0](research/x0-ext-values.md) §10 R9 to R11, Q-A, §1 item 5 |
| T22 | **Vector format.** Op vectors need a setup-steps field, so that ops taking a table can have real vectors. This is an amendment to the spec WP that owns the vector format (SP2). | [X0](research/x0-ext-values.md) §11 |

**Gate T0 status.** R0: decided (T9 to T16). X0: decided (T17 to T22). L0: pending. J0: pending.

### Gate T1 decisions (owner, 2026-11-23)

The owner decided Gate T1 for **SP2 ([RECIPES-1.2.md](RECIPES-1.2.md)) and SP6 ([RELIX.md](RELIX.md)) only.** SP1, SP3, SP4 and SP5 had not been written then; SP1, SP3 and SP4 are decided in part 2 below. Ids continue the T series. Each row names the answers of the spec that it takes; the spec holds the reasoning.

**SP2: every recommended answer is accepted, Q1 to Q15, except Q5.** T25 changes Q5.

| ID | Decision | Source |
|---|---|---|
| T23 | **Format version and bake protocol.** The recipe wave is **v1.2 and keeps `"forge": 1`**: every item is additive and a new construct fails closed for an older reader. Bake `PROTOCOL_VERSION` becomes **2** (a `protocol: 1` client gets `E_PROTOCOL` at `init`). | [RECIPES-1.2](RECIPES-1.2.md) §17 Q1, Q8; §2, §12 |
| T24 | **Slot model.** The catalogue marks a binary operator by derivation: `CatalogueOp.slot` is set when the data input and the first parameter are both `ext{relation}`, with no `META:` clause. A slot lane may start with something other than a source. `pipe` on a first step is valid. A register is not a slot's source. The validator reports no `slot-type`; `fit.ts` and the run-time `E_TYPE` cover it. There are two slots, `left` and `right`; an N-ary union is a chain of `relix:union` steps. | RECIPES-1.2 §17 Q2, Q3, Q4, Q5 (first part), Q6, Q14; §4, §5 |
| T25 | **`FIX` and `ITERATE` are in the format.** This is the exception to SP2 Q5, which had left them out. They are steps with the slots **`base` and `step`**. The data from above feeds `base` only. The `step` lane is always explicit and starts with `relix:recur`. This is **conflict 1 between the two specs; RELIX.md's answer wins** (RQ5). | [RELIX.md](RELIX.md) §14 RQ5, §3.5; RECIPES-1.2 §17 Q5 |
| T26 | **Packs in recipes and share links.** There is no `packs` field. Pack ops are named by their qualified names, and `PackIndex` tells the validator which vocabularies belong to a pack that is off. The failures are `pack-not-enabled` and `packs-needed` (the second carries the recipe). The validator skips `catalogue-mismatch` for a recipe with a pack op, and `encodeShare` omits `catalogue` for it. A share link carries only the input tabs that a `relix:input` step names; the dialog offers them, selected by default. | RECIPES-1.2 §17 Q9, Q11, Q7; §8, §11 |
| T27 | **Pins across hash changes (Q10).** Ops carry `previousHashes`. Only ops whose vectors are identical in both releases get one, and an old pin to such an op is silent. The `pins:compat` script has to run on the pre-sweep tag, so it runs before the v0.2 sweep (L12). | RECIPES-1.2 §17 Q10; §9 |
| T28 | **Vectors, per-step schema, ext strings.** Vectors gain `finish` beside `setup` (T22), so an op that returns a table can have a vector. The per-step schema travels in `StepReport.out` of the final result and in `dataInfo` of the `paused` event. Ext strings are not normalised; a page action can tidy one through the kind. | RECIPES-1.2 §17 Q12, Q13, Q15; §3.4, §7.5, §10 |

**SP6: every recommended answer is accepted, RX1 to RX17 and RQ1 to RQ8, together with the answers to TOOLKIT Q1, Q2, Q3, Q5, Q6 and Q11.**

| ID | Decision | Source |
|---|---|---|
| T29 | **The Relix pack as specified.** RX1 to RX17 stand: one pack and one vocabulary (`relix`); a relation is a tree that terminals print as Relix text, and "parse-free" is a later optimisation; 52 operators, one word each, 51 usable in the browser; implicit lift and run inserted by the recipe compiler and marked `implicit`; no new error codes; engine limits through `ExecutionContext`. **The operator table stays in Forge** (`packs/relix/gen/operators.json`) until Relix publishes `relix.operators`. | [RELIX.md](RELIX.md) §13 RX1 to RX17 |
| T30 | **`relix:input`.** This is **conflict 2 between the two specs; RELIX.md's answer wins** (RQ1). `relix:input ( -- relation )` parses a tab itself, with the parameters `format` and `header`. A new core op, **`input:tab ( -- bytes )`**, reads a tab as raw bytes for byte steps. The first step of a bytes-first lane in RELIX-LANES becomes `input:tab`. | RELIX.md §14 RQ1, §3.2; RECIPES-1.2 §18 (requirement 2 on SP6) |
| T31 | **Asks of Relix (Q1): nothing into 1.0.** After 1.0, in this order: (1) `relix.operators`; (2) public fragment parsers; (3) span ends and structured diagnostics with a reason code; (4) a public execution entry with limits and a cancellation poll; (5) a Value-to-JSON or columnar result writer; (6) per-operator row counts in the event feed; (7) parameter names in `relix.functions`. Forge works without any of them. | RELIX.md §14 (TOOLKIT Q1) |
| T32 | **FL from Relix.** Names are **`fl.<vocab>.<word>`**, hyphens as underscores (Q2). Bytes cross as the struct **`{ bytes_hex }`** (Q3). `rat` is used **only where the parameter is declared `ext{rat}`** (Q5). There is no `try` form in v1 (RQ8). FL is called by **discover, batch, replay** (RX6). | RELIX.md §14 Q2, Q3, Q5, RQ8; §5, §6 |
| T33 | **No delegation, and where `relix-fl` lives.** Relix's built-ins do not delegate to FL (Q6): both keep their implementations, held together by shared vectors (C1). **`relix-fl` gets its own repository**, `DarkCollective/relix-fl`, like `relix-web` (Q11, with T16). | RELIX.md §14 (TOOLKIT Q6, Q11) |
| T34 | **Smaller Relix answers.** RQ2: per-step counts come from on-demand count queries. RQ3: decimals that do not fit a double are a text column with `origin` in v1. RQ4: fragment checks use wrapper templates until Relix has fragment parsers. RQ6: View as Relix can include data, with a 200-row cap per table. RQ7: fix the seeded `nextInt(bound)` and `Collections.shuffle` differences in the supplement when R1b next touches it (T11 allows deferring them; this brings the fix forward). | RELIX.md §14 RQ2, RQ3, RQ4, RQ6, RQ7 |

**Gate T1 status after part 1.** SP2 and SP6 are decided (T23 to T34). The status after part 2 is at the end of part 2.

### Gate T1 decisions, part 2 (owner, 2026-11-24)

The owner decided the rest of Gate T1 that exists: **SP1 ([LANGUAGE-0.3.md](LANGUAGE-0.3.md)), SP3 ([UI-TOOLKIT.md](UI-TOOLKIT.md)) and SP4 ([PACKS.md](PACKS.md)). Every recommended answer in the three is accepted.** Ids continue the T series. This part groups the answers by topic, one id per topic; the specs hold the question numbers and the reasoning, and this table points to them instead of repeating them. Four conflicts between documents are resolved in it (below the table).

| ID | Decision | Source |
|---|---|---|
| T35 | **FL version and staging.** The wave is **FL v0.3**, not 1.0 and not two waves. There is one number: `FORGE_LANG_VERSION` and `@forge/lang` become `0.3.0` at the wave-boundary merge (L12). The bump is staged: **G1** X1 with its forced one-line `ext` cases, together with X2; **G2** the additive words and forms as each package finishes; **G3** L9b, L10 (if not already in) and L12 in one merge group; **G4** L13 and, if L0 passes, L11. The worker protocol is 2 (T23), the recipe format stays `"forge": 1` (T23) and the catalogue version is computed. This answers Q15 (§14.2). | [LANGUAGE-0.3](LANGUAGE-0.3.md) §2.3, §2.4, §19 Q1, Q2 |
| T36 | **The `ext` value in the language.** FL gets a tenth tag, `ext`. The kind registry is process-wide, keyed by name, idempotent, last registration wins, and FL code cannot register (T18 stands). `ext{kind}` is a header type and `StackSlot.kind` holds the kind. `str` coerces to it through `fromText`. **A string default is allowed on an `ext` parameter; a constraint is not** (refines X0 §3.3). Two words, `ext-kind` and `ext>text`. `sizeOf` is O(1) and tested per kind. **Conflict 3: `null` and `array` are reserved core kind names**, like `table`, `relation`, `relix-expr` and `rat`; the pack manifest refuses a pack that claims one (T47). | LANGUAGE-0.3 §4, §19 Q14, Q15, Q17; D69 to D74 |
| T37 | **Generic words and tagged literals.** Generic words are a **closed list dispatched through kind methods**; there is no user-written `GENERIC:` or `METHOD:`. Core arithmetic is generic and **additive**: plain numbers stay bit-identical and the header text and hashes of the words do not change. Tagged literals `tag"…"` are read only for registered tags and evaluated at compile time; an unregistered tag stays `E_LEX`. | LANGUAGE-0.3 §5, §6, §19 Q4; D75 to D78 |
| T38 | **JSON, `null` and the table words (answers Q14).** JSON `null` is **`ext{null}`**, with the words `null` and `null?`. `json>value` and `value>json` are `core` primitives and the one JSON implementation. A nested NULL in a struct or array crosses the Relix bridge as `ext{null}` and back (RELIX.md §5.4, §16 item 13). The table export words are **`table:to-csv` and `table:to-json`**, and `json:parse` is `json>value` (§7 corrected). | LANGUAGE-0.3 §7, §19 Q3, Q18; D79, D80 |
| T39 | **Defining forms.** Computed constants are **constant expressions** of foldable words, run by the compiler with no VM; `CONSTANT` takes a scalar; `warm()` stays the load budget for `MEMO:`. Choice values are specified now and built last (L5b), and dropped if L1's count of `choice … case` tables is small. `DEFER:` declares a word, with a group hash for cycles. `friend` lets named vocabularies reach a private word. `VARIABLE` takes any storable value, with no re-entrancy form. `record{ … }` is the record literal. | LANGUAGE-0.3 §9, §19 Q8 to Q12; D81 to D86 |
| T40 | **Mutable array, 32-bit words, `charge`.** `array` is an **`ext` kind** with five in-place intrinsics, and cannot be stored; a write to a sealed array is `E_EFFECT`. The 32-bit words are specified now and **built only after L0** (dropped if L11 makes them unnecessary). `PrimitiveContext.charge(n)` is deterministic. `+media` is an effect label; `+net` is not added. | LANGUAGE-0.3 §10, §11, §19 Q5, Q13; D87 to D91 |
| T41 | **The fixes of §11.5.** `reduce` is **unchanged**. `/` of two integers is the correctly rounded quotient at any size. **A violated interval, set or length constraint raises `E_RANGE`**; the other four constraint kinds stay `E_PARAM_INVALID`. This is the one breaking item: at most 20 vector expectations in 10 files change. `runtime.call` applies header defaults. The `raise`/`range` clash is closed (the `raise` vocabulary was removed on 2026-11-15). Pattern strings, `\f`, a `doc` cap of 8000 and a vector `ref` cap of 1000 are added. Named inputs are reviewed with no change. | LANGUAGE-0.3 §12, §19 Q6, Q7, Q16; D92 to D96 |
| T42 | **Viewers.** The table viewer shows the first 100 rows, drawn whole up to 5,000 cells and windowed beyond that, with no sorting in 1.0. X2 adds a **`truncated` flag** to the `ext` output. A **Convert to bytes** menu adds `table:to-csv` or `table:to-json`. The lift `table` to `relation` is green with a badge; the run `relation` to `table` is amber, "runs the query first". | [UI-TOOLKIT](UI-TOOLKIT.md) §11 Q1 to Q4; §1, §2 |
| T43 | **Lanes, Tree and the Relix field.** The Tree view is **read-only** in v1. "Join it in" puts the data above on the **left**. **Make main line is disabled** when the other lane has no enabled step. **As text is a dialog** beside the Lanes and Tree tabs. The async `relix-expr` check runs in the bake Worker only when it is idle, one request queued, and never cancels a bake. | UI-TOOLKIT §11 Q5 to Q9; §3.5, §4 |
| T44 | **Named inputs and share links.** A bake sends only the tabs that `inputNames(recipe)` lists plus the active tab (all tabs if a tab name comes from a register). Renaming or closing a tab that a step reads offers an update in one undo step. In a link that carries tabs, the carried names win and a confirm step lists what is replaced. | UI-TOOLKIT §11 Q10 to Q12; §5 |
| T45 | **Packs in the UI.** All packs are **off** in a fresh browser (T5), kept per browser in IndexedDB, with no "always trust" setting and no search into packs that are off in 1.0. Reference pages for pack operations are generated from pack metadata, marked as part of an optional pack, with an Open in Forge link that goes through the enable offer. | UI-TOOLKIT §11 Q13, Q14; §6 |
| T46 | **The CSP and UI.md §4.** **`media-src blob:` is applied at T6**, with the media pack (M1), not before. The UI.md text and a **CSP golden test** land earlier, against today's string; the expected string changes in M1's pull request. The owner approves the `site.tf` line and runs `terraform apply`. A Firefox and WebKit smoke of the table viewer and the CSP test runs if CI can. Rules 5, 6, 7, 10 and 12 are amended and rule 13 (packs) is added, as UI-TOOLKIT §7.3 writes them. **Conflict 1: rule 8 follows PACKS.md.** The pack manifest is compiled into the page and the worker. `fetch` reads catalogue, help and checks fragments and a pack's own hashed non-JS files. Pack code loads by `import()` of same-origin hashed modules. The words "the pack manifest" leave rule 8, which replaces the rule 8 text of UI-TOOLKIT §7.3. | UI-TOOLKIT §11 Q15, Q16; §7; [PACKS](PACKS.md) §14 item 4, PK5 |
| T47 | **Packs: definition, manifest, discovery.** A pack is a first-party workspace package `packs/<id>` (`@forge/pack-<id>`) with a `manifest.json`, validated by a schema and cross-checks; no tool imports pack code to read it. Pack ids, vocabulary names and kind names are lower-kebab-case and permanent (no aliases); a kind has one owner; core never depends on a pack; `requires.packs` names ids only. **The manifest facts are compiled into the page and the worker** as committed, generated registries (`packs:gen --check` in CI), so the page fetches no manifest. A pack loads in three lazy levels. One `.fth` file per vocabulary, named after it, so the generator writes `vocab/relix.fth`. `PACK_API` is an integer bumped on an incompatible contract change. Pack notices are gathered into a public `THIRD-PARTY-NOTICES.txt`. A pack may declare UI features within `budget.page`; a pack keeps no state of its own in v1. A new package `@forge/packs` holds the validator and generator. | PACKS §11 PK1 to PK6, PK20, PK22 to PK24; §12 PQ3, PQ6, PQ10 to PQ12, PQ15 |
| T48 | **Init protocol and loading.** `init` carries `packs`, closed under `requires`; the worker refuses unknown and unclosed lists with `E_PROTOCOL`; `vocabs: "all"` means core plus the enabled packs. Loading is by the closure of what a recipe, the user unit and the touched conversions use; re-init grows the set. `magic` loads all of core and does not search packs. The console loads everything enabled at first open. A loaded runtime is not extended without a re-init in v1. **`init.packs` rides protocol 2, and P2b lands with RW5**, so one bump covers both. If protocol 2 had shipped first, `packs` would need protocol 3, because the guard refuses an unknown key; the schedule rules that out. | PACKS §11 PK7, PK8; §12 PQ5, PQ7 to PQ9, PQ14 |
| T49 | **The catalogue and the recipe stamp.** Pack catalogue fragments merge to equal one runtime's catalogue for every closed subset. **Conflict 2: PACKS PK9 amends the approved RECIPES-1.2 §8.5.** `recipe.catalogue` is the **core catalogue version**, or absent. The page passes the recipe layer a view of its merged catalogue with the core version, and the baker drops `catalogue-mismatch`. The two rules of T26 stand for a recipe with a pack op: the validator skips `catalogue-mismatch` and `encodeShare` omits `catalogue`. A pack does not declare that it reads other packs' catalogues. | PACKS §11 PK9, PK10; §5.4; §12 PQ13 |
| T50 | **Capabilities.** Effect labels are a closed list defined in core; packs request labels and cannot define them. Enabling a pack grants what its manifest requests, and a build that requests more puts the pack in `needs-review`, off until the user confirms. The baker's `deny` is the grantable labels that no enabled pack requests, plus the caller's `BakeOptions.deny`; the VM enforces it with `E_FORBIDDEN`, which `try` cannot catch. `externalCode` declares compiled code with a version, a hash and a ceiling. Lint guard rails are not a sandbox. A manifest may ask only for `blob:` and `data:` in `img-src`, `media-src` and `font-src`, and the deployed CSP must already allow them. The user does not grant some capabilities and refuse others. | PACKS §11 PK11 to PK13, PK17 to PK19; §12 PQ4 |
| T51 | **Enabling and failure.** **No pack is on by default** (PQ1; revisit `relix` after Gate T4). The enabled set is one document under the `kv` key `packs`. Internal packs are built only with `FORGE_PACKS_INTERNAL=1`. The enable offer needs a click and shows only text from the build; no link, URL parameter or recipe enables a pack. Enabling re-inits the workers and disabling replaces them. A `pending` mark and an init deadline keep a pack that did not finish loading from locking the user out. There is no "enable for this session only". | PACKS §11 PK14 to PK16, PK21; §12 PQ1, PQ2 |
| T52 | **Stale corpus counts.** **Conflict 4:** TOOLKIT's corpus counts are older than the tree. Verified on 2026-11-24: **208** `.fth` files in `packages/ops/vocab` (28,759 lines), and **201** `.test.json` files with **7,589** vectors (the top-level arrays, counted by script). LANGUAGE-0.3 took 7,302 vectors in 200 files from `packages/ops/README.md`; the tree now has more. No other new number is stated. Where this document gave a count as current it was marked stale. **L1 measured all of them on 2026-11-24** (§2.1, §2.5, §11.5; §13.4). | LANGUAGE-0.3 §21 item 4 |
| T53 | **Staging of packages work.** Work on `packages/*` may start now, staged per T35 with G1 first. Gate T1 stays open only for SP5 (SYMBOLIC v2), which gates only the symbolic pack (Phase T5). | T35; §13.3 status note |
| T54 | **Where the hand-written `relix:` words live.** They sit in `packs/relix/gen/words.fth`, and the generator copies them into `vocab/relix.fth`, so that PK23 (one file per vocabulary) holds. | [RELIX](RELIX.md) R2b and R3; PACKS PK23 |
| T55 | **Two owner decisions owed to D1 and P4.** D1 names the JSON-to-table parser, which no document had fixed. P4 decides where the fixed table of capability sentences lives (PACKS PK15, [UI-TOOLKIT](UI-TOOLKIT.md) §6). Both are recorded in §13.5. | §13.5 D1 and P4 rows; PACKS PK15; UI-TOOLKIT §6 |

**The four conflicts, as resolved.**

1. **CSP rule 8 (T46).** PACKS.md wins over UI-TOOLKIT §7.3: the manifest is compiled in, `fetch` is for catalogue fragments and non-JS pack files, and pack code loads by `import()`.
2. **`recipe.catalogue` (T49).** PACKS PK9 amends the approved RECIPES-1.2 §8.5: the field is the core catalogue version or absent.
3. **Kind names (T36).** `null` and `array` are reserved core kind names, which the pack manifest refuses.
4. **Corpus counts (T52).** The counts here were stale; L1 has measured them on 2026-11-24.

**Gate T1 status.** SP1, SP2, SP3, SP4 and SP6 are decided (T23 to T52). **SP5 (SYMBOLIC v2) is not written**, so Gate T1 stays open for it; it gates the symbolic pack (S rows) only. The frozen-contract version bump is **staged per T35** (G1 to G4), and Q15 is answered. `media-src blob:` waits for T6 (T46). Q14 and Q15 are answered (§14.2). Work packages that change `packages/*` follow the staging of T35.

---

## 4. Architecture

Four layers.

1. **Core.** `@forge/lang` v0.3 and the core op vocabularies: codes, ciphers, encodings, data formats, parsing, hashing, crypto, compression, networking parsers, text and byte utilities.
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
 | (1) core: @forge/lang v0.3 + @forge/ops core vocabularies     |
 |     table, json, csv in core; generic arithmetic; ext tag     |
 +---------------------------------------------------------------+

 JVM side:  Relix engine --FunctionLibrary--> relix-fl --GraalJS--> @forge/embed (lang + ops)
```

The `table` kind, `csv` and `json` are small and needed by core data-format ops, so the recommendation (Q4) is that they sit in core. In that case the `data` pack of the diagram is core code with a viewer, not a separately enabled pack. If the owner prefers a pack, the same code moves to `packs/data` and the core data-format ops depend on it.

---

## 5. The pack system

### 5.1 What a pack is

A pack is a workspace package `packs/<id>` (`@forge/pack-<id>`) holding:

- `vocab/*.fth` and `prims/*.ts`;
- extension value kinds (§6);
- parameter widgets and output viewers;
- an optional UI feature (a pane), registered like `apps/web/src/modules.ts`;
- test vectors (`*.test.json`);
- a **manifest** (`manifest.json`, data checked by a schema, [PACKS.md](PACKS.md) §2): id, version, vocabularies, kinds, viewers, helpers, entries, capabilities, `requires`, budget, licence and NOTICE.

What may and may not be in a pack is PACKS.md §1.2. Third-party FL-only vocabularies are not packs (T7, PK1).

### 5.2 Discovery, loading, enabling

- Packs are discovered **at build time** (PACKS §3). `packs:gen` writes two committed registries, so **the manifest facts are compiled into the page and the worker, and the page does not fetch a manifest** (PK5). A composite `VocabSourceProvider` merges core and enabled packs.
- The baker `init` message carries **pack ids**, closed under `requires`. The worker refuses unknown and unclosed lists with `E_PROTOCOL` (PACKS §4.2). An id taken from a URL is never used verbatim without that check (UI.md §4 rule 6).
- `vocabs: "all"` is replaced by loading the **dependency closure** of what the recipe or console uses (PACKS §4.4); with packs it means core plus the enabled packs. This also stops core loading all 70 primitive chunks at start.
- Enabling is per browser and stored as one document under the `kv` key `packs` in IndexedDB (UI.md §4 rule 10; PACKS §7.1). Every pack is off by default (T5, T51).
- Opening a shared recipe that names a pack op **offers to enable the pack**. The offer needs a click and shows only text from the build, with a visible notice that the pack is first-party code on the same origin (UI-TOOLKIT §6.5). No link or recipe enables a pack.
- Packs are outside the 250 kB gzip core-plus-shell budget (PLAN §6); the registry glue is inside it. Each pack declares its own budget in its manifest, and `npm run size` checks it.

### 5.3 Third-party sharing

Only FL-only vocabulary files are shared. They import as untrusted units, which exists today as the `user` unit. The extension is named vocabularies with export and import. They cannot bind primitives and run under the untrusted limits (PLAN §5). They are not packs (T7, PK1).

### 5.4 Capabilities

- `EffectLabel` gains **`+media`** only. `+net` is not defined (T3, PK11).
- The baker's `deny` is computed from the enabled set (PACKS §6.5), so a pack's capabilities are granted explicitly rather than ambient. `RunOptions.deny` is wired in by P6.
- A word that needs a capability the run has not granted is refused with `E_FORBIDDEN`, carrying `detail.effect` and `detail.pack`. `try` does not catch it.

### 5.5 Required changes to UI.md, PLAN and the CSP

| Change | Where |
|---|---|
| Rule 5 amended: a dynamic `import()` takes a literal specifier or an entry of the build's chunk table, never a string made from data | UI.md §4; UI-TOOLKIT §7.3 |
| Rule 6 **amended, not unchanged**: it gains the viewer and shadow-root rules. Viewers still build DOM with `createElement` and `textContent`, never `innerHTML` | UI.md §4; UI-TOOLKIT §7.3 |
| Rule 7 amended: media never starts by itself | UI.md §4 |
| Rule 8 amended (T46): the manifest is compiled in; `fetch` reads catalogue, help and checks fragments and a pack's own hashed non-JS files; pack code loads by `import()` of same-origin hashed modules | UI.md §4; PACKS §14 item 4 |
| Rules 10 and 12 amended; rule 13 (packs) added | UI.md §4; UI-TOOLKIT §7.3 |
| `media-src blob:` added to the CSP **at T6** (media pack, M1; owner-approved infra change in `infra/`), checked by the manifest check `csp-unsatisfied` | PLAN §10, UI.md §4 |
| A CSP golden test (`csp.spec.ts`) lands with X2, against today's string | UI-TOOLKIT §7.5 |
| Nothing else in the CSP changes (`img-src` already allows `blob:`; canvas works; `wasm-unsafe-eval` is already present) | UI-TOOLKIT §7.1, §7.2 |

---

## 6. Extension values and viewers

### 6.1 The `ext` tag

Adopt SYMBOLIC.md B1 as the single mechanism. Kinds are registered in a **process-wide registry keyed by kind name**, not through a `RuntimeOptions` field (T18, T36; LANGUAGE-0.3 §4.2). Registration is idempotent, the last one wins, and FL code cannot register. Each kind provides:

- `equals`, `display` and `repr`;
- `sizeOf`, so the size meter (§2.4) accounts for it (O(1), conservative, cached);
- `toText` and `fromText`;
- limits;
- `methods`, for the generic words (§6.4).

`ext{kind}` is a header type. A string default is allowed on an `ext` parameter; a constraint is not (T36). The kind names `table`, `relation`, `relix-expr`, `rat`, `null` and `array` are owned by core or by a named pack, and the manifest refuses a pack that claims one.

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

- **B3 tagged literals:** `relix" … "` and `sym" … "`, parsed at compile time and read only for registered tags (LANGUAGE-0.3 §6). `sym"` is `E_LEX` today, so no valid program changes token kind.
- **B5 `charge(n)`:** primitives account their work in `maxSteps` and poll abort and deadline.
- **B2 generic words:** SYMBOLIC.md left these conditional (S16, open question 3). They are now justified by three clients: symbolic arithmetic, table and relational words, and matrices. **Core arithmetic becomes generic** through kind methods instead of being shadowed by a vocabulary, and this is **additive**: plain numbers are bit-identical and no header text or hash changes (T37).

### 6.5 The unifying view (T8)

A `relation` and a `sym` share a life cycle: construct with words, hold on the stack as a value that can be compared and printed, and evaluate only through a terminal word (`relix:run`, `sym-num:>num`). Both have a text form that round-trips, a size and a budget. One registry therefore serves both. If the owner rejects T8, the `ext` mechanism is still needed for `table` and `image`, and the relation and expression kinds become two separate registrations.

---

## 7. The data pack: the table value

`table` is not Relix-specific. Wave 1b data formats (CSV to JSON, JSON to CSV, YAML, MessagePack, CBOR, Avro, BSON) and `lines:to-table` need it too.

- **Representation.** Columnar, typed columns, and an **explicit null mask**, because FL has no null. Columnar is about 1.6 MB against 4.08 MB for list-of-records at 10,000 rows by 10 integer columns (§2.4).
- **One parser each.** Core owns one CSV parser and one JSON parser and serialiser. This closes the wave 4 "no JSON" gap.
- **Words.** `csv:parse ( bytes … -- table )`, `json>value` (core, LANGUAGE-0.3 §7; it replaces `json:parse`), `table:to-csv`, `table:to-json`, `table:columns`, `table:rows`. The export words use `to-`, not `>` (T38).
- **Viewer.** A virtualised grid of the first N rows with the total.
- **Core or pack.** Recommendation: `table`, `json` and `csv` in **core** (small, and needed by core data-format ops); relational operations in the **relix** pack. Q4 is closed (2026-11-23, T21): `table` is core, not a pack.
- **Memory.** The size meter charges what a value costs once. A live-size meter or structural sharing for tables is a risk item (§14.1).

---

## 8. The Relix pack

The pack has three faces of one thing.

### 8.1 Value-level words (face a)

`relix:` words build `relation` values **lazily**.

| Kind | Shape |
|---|---|
| Sources | `relix:input ( -- relation )` (reads and parses an input tab, T30), `relix:from ( table name:str -- relation )`, `relix:inline`, `relix:generate`, `relix:unit`, `relix:empty`, `relix:recur` (the accumulator inside a `step` slot) |
| Unary operators | `( relation params… -- relation )`, including `relix:why` (`WhyNode`: a relational operator that adds a nested `provenance` column, not a terminal) |
| Binary operators | `( relation right:relation … -- relation )` |
| Terminals | `relix:run ( relation -- table )`, `relix:explain`, `relix:optimized` (text), `relix:schema`, `relix:>text`, `relix:parse` |

Nothing executes until a terminal. Then the tree is printed as Relix text and the engine parses, analyses, optimises, plans and executes it, so the optimiser sees the whole query. This mirrors ADR-0027 ("a Relation is a value"). Going from the tree to the analyser without the text ("parse-free") is a later optimisation (RELIX.md RX2). A `relation` that reaches an op that takes a table, or the end of the recipe, is **run implicitly**. The recipe compiler inserts the implicit run and the implicit lift (`table → relation`), marks them `implicit`, and the trace records the coercion `relation → table`. Only an op that takes a table triggers a run (RX5). The words are specified in [RELIX.md](RELIX.md) §3.

### 8.2 Recipes and drag and drop (face b)

- **Unary operators are ordinary recipe steps.** A recipe is already a linear pipeline.
- **Binary operators** are steps with two **slots**, `left` and `right`, shown as nested lanes; `pipe` says which slot the data from above feeds. The slot is not in `params`. A relational expression is a tree, which matches the recipe tree, and the lane reuses the fork and subsection block UI. Slots are the next wave of the recipe format, v1.2, which keeps `"forge": 1` (T23, T24; [RECIPES-1.2](RECIPES-1.2.md) §4). `FIX` and `ITERATE` are steps with the slots `base` and `step` (T25).
- **Shared sub-expressions** are named relations: saved recipes promoted to words (PLAN §3.6 "recipes are words"). They are the analogue of `N := { … }`.
- **Predicates, projections, aggregates and sort keys** are `ext{relix-expr}`-style parameters: Relix operand or predicate text, validated live by the Relix parser. First a text field with completion from the input schema; later a structured builder widget.
- **Multiple inputs.** The bake protocol gains **named inputs** (all input tabs, by name), so `relix:input name` can read another tab. This is a `@forge/worker` protocol change (X5; protocol 2, T23). `input:tab` reads a tab as bytes (T30).
- **Recipe and Relix text.** "View as Relix" prints the recipe as a `.relix` script through the engine's printer. Importing a `.relix` script produces a recipe. Each step shows its schema (from `schema()`) and row counts.
- **Generated steps.** Operator steps are generated, not hand-written. One operator table of **52 operators** (29 unary, 21 binary, 2 base-and-step; [RELIX.md](RELIX.md) §4) holds name, glyph, keyword, arity, parameter shapes and doc key, and generates the `.fth` wrappers and metadata. The table stays in Forge until Relix publishes `relix.operators` (T29). Proposal to Relix: publish this as a `relix.operators` catalog relation, and expose parameter names in `relix.functions`, so Relix is the single source. That is post-1.0 unless the owner pulls it into 1.0 (Q1).
- **Help text** comes from the Relix reference pages (the `relix-docs` artifact), not rewritten.

The lane and slot design for binary operators (the pipe rule, swap sides, the Tree view, recipe JSON for slots) is in [RELIX-LANES.md](RELIX-LANES.md).

### 8.3 The engine (face c): spike R0 first

**R0 done 2026-11-23: go on TeaVM's JavaScript backend.** All eight criteria pass at the thresholds below. Result: [r0-relix-in-browser.md](research/r0-relix-in-browser.md). Decisions T9 to T16 (§3).

**Candidates.**

| Candidate | Notes |
|---|---|
| TeaVM | JS or WebAssembly-GC output, ahead of time, no `eval`, so CSP-compatible in principle. To verify: Java 21 language features, and `BigDecimal`, `java.time` and `java.util.regex` fidelity. |
| GraalVM web-image, J2CL | Alternates if TeaVM fails. |
| CheerpJ | **Excluded up front.** It interprets JVM bytecode and needs dynamic code, against the CSP. |

**Assembly.** The engine jars minus `relix-embed`, `relix-connectors-std` and the ojAlgo solver. A small Java shim wires the pipeline with `FunctionCatalog.of(...)` and in-memory sources. It lives in a new module or repository (`relix-web`) that consumes the **published** engine jar, so the 1.0 freeze is respected.

**R0 pass criteria.** These were proposed thresholds. The owner confirmed them on 2026-11-23 as the standing thresholds (Q7 closed, T12). Figures marked "estimate" were guesses; they are now the limits.

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

Measured results (2026-11-23): 241 of 248 examples identical (97.2%); 1.33 MB gzip; cold start 1.07 s; a 10,000-row join 0.23 s; no CSP violation on the JavaScript backend. Limits of the browser build (T11): locale collation (`COLLATE 'en-US'`) is not available, and two seeded forms draw a different sequence from the JVM: `SHUFFLE SEED` and uniform `ROLL SEED`. `SAMPLE … SEED` and `ROLL BY … SEED` match (SP6 probes, [RELIX.md](RELIX.md) §1.4; T34). `OPTIMIZE` and `COVER EXACT` are out (T13). Wasm GC is two to three times faster, but its runtime uses `new Function`, which the CSP forbids. It is a later optimisation, to be re-tested when TeaVM drops that (T15).

### 8.4 FL from Relix inside Forge

A `FunctionLibrary` named `fl` exposes functions named `fl.<vocab>.<word>`, with hyphens as underscores (Q2, T32):

1. every catalogue op whose data input and output map to Relix scalars, as a Relix function;
2. user words and promoted recipes;
3. table-valued FL words, as a function that returns an ARRAY of STRUCT, which `μ` turns into rows (the function SPI has no table-valued functions; RELIX.md §6.7).

**Value mapping.** The mapping table is in [RELIX.md](RELIX.md) §5 and is not repeated here. The decisions that shape it:

- NUMBER maps to `int` when integral, else `num`, and to `rat` only where the parameter is declared `ext{rat}` (Q5, T32).
- **NULL.** FL has no null. The bridge does NULL in, NULL out: if any argument is NULL, it returns NULL and does not call FL. The bridge has to do this because the engine calls a function even when an argument is NULL (RELIX.md §5.4). This corrects the R0 note (criterion 8), which said the engine skips the call. A table's null mask carries nulls. A NULL nested in a struct or array maps to `ext{null}` and back (T38).
- **Bytes.** Relix has no bytes type. Bytes cross as the struct `{ bytes_hex }` (Q3, T32).
- Dates cross as ISO `str` until Forge has a date value.

**Sync against async.** The FL VM is async (async primitives are awaited, PLAN §3.4); the compiled engine is synchronous. Options: TeaVM's async transformation, or evaluating FL-function calls in batches outside the engine. R0 tested this.

*Decided 2026-11-23 (T14, [R0](research/r0-relix-in-browser.md) §9):* host callbacks are synchronous only. The bridge uses **discover, batch, replay** (RELIX.md §6.5, RX6): a run discovers the calls the query makes, FL is called in batches over the distinct arguments, and the query runs again against a cache of the results. Hoisting columns into a plan would fail for a call over a join result, an aggregate or another call. TeaVM's async build works but is 51% larger (2.0 MB against 1.33 MB gzip) and slower, so it is rejected.

**Batch first.** Per-row calls are slow, so the bridge maps a word over a column.

### 8.5 The fallback

If R0 fails: a TypeScript engine for the core operators (π σ ρ γ τ λ δ, joins, set operators, TOP, basic WINDOW), held to the same reference-example corpus. Exotic operators report "needs full Relix". This is a **second engine** and conflicts with goal 6. That is why it is the fallback and not the plan.

*2026-11-23:* R0 passed (T9), so the fallback is not needed for the core. It stays here as the record of the alternative.

### 8.6 The solver

`OPTIMIZE` needs a solver. ojAlgo will not be in the browser. A browser `MathProgrammingSolver` provider could later come from the symbolic pack's exact simplex. This is a stretch item, not in the base scope. *Decided 2026-11-23 (Q9, T13):* `OPTIMIZE` and `COVER EXACT` are out of the browser; `SOLVE`, `ROLL` and `SHUFFLE` are in.

### 8.7 FL from JVM Relix (T2)

Forge publishes a single-file, dependency-free runtime bundle, `@forge/embed` (lang, ops, and a small facade that looks synchronous), as an npm package and as a resource in a jar. An optional Relix module `relix-fl` (a `FunctionLibrary` found by `ServiceLoader`, GraalJS its only dependency) loads the bundle, pumps promises, and maps values as in §8.4.

- It ships **outside the frozen engine artifact**, after Relix 1.0.
- The same conformance vectors as Forge (the op `*.test.json` files) run through it in CI.
- **Risks:** GraalJS start-up and per-call cost; WebCrypto and `CompressionStream`-backed primitives are not present in GraalJS, so the work package must list which ops degrade; the licence of GraalJS must be checked.

---

## 9. The symbolic pack

### 9.1 Integral or plugin?

On the HP 48 algebraics are integral to the object system. Here the **mechanism** (ext values, generic arithmetic, tagged literals) is integral to FL v0.3, and the **content** (the CAS) is a pack. That is the answer to the owner's question: integral where it shapes the language, a plugin where it is a body of rules.

### 9.2 Structure

Keep SYMBOLIC.md's representation, canonical form C1, text grammar, limits table, testing approach and the Stage A and B word lists. Restructure it as follows.

| Layer | Contents | Language |
|---|---|---|
| Kernel | expression value `ext{sym}`, canonical form, exact numeric tower (`rat`, `cplx`), parser and printer, pattern matcher and rewriter with a budget | TypeScript (needs speed or exactness) |
| Rules and words | derivative table, integral table, simplification rules, solving strategies, units table and conversions | rewrite-rule files and FL words in the pack's vocabularies |

The rule set is therefore user-extensible in FL (the HP 48 spirit) and honours goal 5.

### 9.3 Effect on SYMBOLIC.md

With FL v0.3 (generic words, tagged literals, ext values) landing first, the pack starts at what SYMBOLIC.md called Stage B. Stage A's record encoding and shadowing are skipped. A SYMBOLIC.md v2 must be written (work package SP5).

| SYMBOLIC.md decision | Status |
|---|---|
| S2 (two stages) | Superseded: one stage on v0.3 |
| S3 (expression as `int`, `num` or `record`) | Superseded: `ext{sym}` |
| S5 (generic arithmetic by shadowing) | Superseded: generic core arithmetic |
| S6 (value vocabularies internal, in `packages/ops`) | Superseded: they live in the pack (T4) |
| S7 (all-TypeScript engine) | Superseded: small kernel plus FL (T4) |
| S8 to S14, S20, S21 | Stand |
| S4, S15 to S19 | Not decided here. S4 (canonical form C1) is kept; S15 to S19 become FL v0.3 features (LANGUAGE-0.3 §4, §5, §6 and §11; decided T35 to T41). SP5 confirms each. |

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

These ops belong to `pack:media` or `pack:code`. Lowest priority of the programme.

---

## 11. FL v0.3

**Principle.** Every proposal carries a corpus number. The measuring scripts are kept as `npm run corpus-stats -w @forge/ops`, so each change reports before and after (private single-use helpers, shuffle density, primitive count and TypeScript lines, zero-input table rebuilds).

**Status.** FL v0.2 shipped part of this section. Items marked **(done)** are in [LANGUAGE.md](LANGUAGE.md) (see its [Appendix A](LANGUAGE.md#appendix-a-changes-in-v02)) and are no longer proposals. **Everything else is specified in [LANGUAGE-0.3.md](LANGUAGE-0.3.md) (WP SP1) and decided at Gate T1 (T35 to T41):** the wave is FL v0.3, and LANGUAGE-0.3 §1 lists each open item with its section. LANGUAGE.md changes at the fold-in (L14). The corpus figures of §2.5 were re-measured on 2026-11-24 by L1 (T52), and the survey figures are kept beside them there.

### 11.1 Group L-A: prelude and core words (additive)

- Promote the generic `util` words: the trim family, `starts-with`/`ends-with`, `contains`, `repeat`, `zero-pad`, `cp>str`, `between?`, `index-of`, `sum`, `tdiv`, `ceil-div`, `int>be-bytes`, `count-leading`, character predicates. (**done** for twenty words, LANGUAGE.md A.4 and §13.8; `index-of`, `tdiv` and `zero-pad` of this list were not promoted. 2026-11-15: the vocabularies now call the core words and the `util` copies are removed, except `util:int>be-bytes` and `util:pad-hex`, which `zip`, `fingerprint` and `hexdump` still call.)
- Maths: `ln exp log2 sin cos tan atan2 …`, `str>num`, float bit packing. (**done** for the maths words and `str>num`, LANGUAGE.md A.4; float bit packing is not done.)
- Typed failure words in core, replacing 253 qualified `raise:` calls. (**done**, `fail-coerce` and `fail-range`, LANGUAGE.md A.4; 2026-11-15: the existing `raise:` calls were rewritten and the `raise` vocabulary removed.)
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

The `ext` tag, generic words, tagged literals, `charge` and new effect labels (§5.4, §6). Specified in LANGUAGE-0.3 §4 to §6 and §11; decided T36, T37 and T40.

### 11.5 Group L-E: the fixes (T6; classified again by SP1)

T6 allowed breaking fixes. LANGUAGE-0.3 §12 classified the nine items again and decided them (T41). **Only one breaks a v0.2 program.**

- `reduce` argument order: **unchanged** (D92). It matches Factor, JavaScript and Python, and a swap costs steps and changes 88 callers' hashes.
- `/` on integers beyond 2^53: additive in effect (an error becomes a value).
- Header-constraint violations: an interval, set or length violation raises `E_RANGE`; the other four constraint kinds keep `E_PARAM_INVALID`. **This is the one breaking item.** `runtime.call` applies header defaults (additive).
- The `raise`/`range` name clash: **closed**. The `raise` vocabulary was removed on 2026-11-15, so no language change is needed.
- Regex parameters with spaces or parentheses, the `\f` escape and the `doc` length cap (8000): additive.
- Named inputs and their interplay with the stack: reviewed, no change.
- Core arithmetic made generic: **additive** (T37). Plain numbers are bit-identical and the header text and hash of each word do not change. This item was listed here as breaking before SP1.

**Migration.** The sweep is smaller than first planned. It rewrites no word source except the callers of the `json` vocabulary (LANGUAGE-0.3 §14: callers in 16 files, 8 `json:null` lines in 4 files), and it rewrites at most 20 vector expectations in 10 files for the `E_RANGE` change. L9b and L12 merge in one group at a **wave boundary** (no op work packages in flight; G3 of T35). All vectors pass except the listed expectation codes. The catalogue version bumps, and `previousHashes` are generated first, on the pre-sweep tag (T27). The earlier plan, a codemod over all `.fth` files with "all 4,488 vectors unchanged", assumed the `reduce` swap and a new arithmetic header; both are gone (measured 2026-11-24, L1: the sweep touches 20 vector expectations in 10 files, as §14.1 says; 15 files call `json:` and 4 lines hold `json:null` or `json:null?` in 2 files, against 16 files and 8 lines in 4 files of LANGUAGE-0.3 §14.1; 83 definitions call `reduce`, against 88 callers in the plan. The tree now has 208 `.fth` files, not 161.).

**Share URLs.** RECIPES R8 and §3.10: a recipe step may carry an op `hash` pin. A mismatch is a warning by default (`pins: "warn"`) and an error under `"strict"`; a pin never selects an old implementation. `encodeShare` pins when it is given a catalogue. So after the sweep, unpinned URLs keep working; pinned URLs run the current op and show a `hash-mismatch` warning (or refuse, under `strict`), except for ops with a `previousHashes` entry (T27).

### 11.6 Proposal table

The rows that are not marked done are specified in LANGUAGE-0.3 (§1 maps each to a section). The corpus evidence column is the 2026-11-14 survey; the figures measured on 2026-11-24 are in §2.5. Sizes are relative. "Revisits" lists LANGUAGE.md decisions or sections touched (§17 decision ids D3, D4, D5, D6, D10, D11, D18, D31, D44; §5.7 public and private words; §13 core vocabulary; §17.1 items deliberately left out, as that list stands after v0.2).

| Proposal | Corpus evidence | Unlocks | Kind | Size | Revisits |
|---|---|---|---|---|---|
| Promote `util` words to core (**done** for 20 words, LANGUAGE.md A.4; callers moved and 18 `util` copies removed 2026-11-15) | 37 words used by 3+ vocabularies; `between?` 59 calls | Fewer duplicate helpers | Additive | S | §13 |
| Maths, `str>num`, float bits (maths and `str>num` **done**, LANGUAGE.md A.4; float bits open) | 7 missing core maths and IEEE primitives | 7 primitives to FL | Additive | M | §13, §17.1 |
| Typed failure words (**done**, LANGUAGE.md A.4; the `raise:` calls rewritten and the `raise` vocabulary removed 2026-11-15) | 253 qualified `raise:` calls | Shorter error paths | Additive | S | §13 |
| `sort`, `has-key?`, `find`, `case` (**done**, LANGUAGE.md A.4) | 3 sort/shuffle primitives; 234 else-if chains (96 at depth 3+); 12 `try` for control flow | Flatter code; 3 primitives to FL | Additive | M | §13 |
| JSON parse and serialise | Wave 4 gap | Data words, Relix bridge | Additive | M | §13 |
| Mid-body local binding (**done**, LANGUAGE.md A.2) | 84 closure-binding helpers; 221 single-use helpers; 984 private words called once | Fewer helpers | Additive | M | D10, §5.7 |
| Load-time and memoised constants (memoised **done**, LANGUAGE.md §5.13; load-time open) | 101 zero-input constants; 22 rebuild tables per call; 3 `CONSTANT`s | Cheaper tables | Additive | M | D4 |
| Shared `choice` types (**done** without value mapping, LANGUAGE.md §5.12) | 237 headers, 116 distinct lists, 70% copies | Fewer copies | Additive | S | D3 |
| "Public not an op" (**done**, `helper`, LANGUAGE.md §5.9), friend visibility (open) | `cmac`, `lmhash`; eight internal vocabularies in code | Cross-vocabulary reuse | Additive | M | §5.7 |
| Forward declarations, `exit` (**done**, LANGUAGE.md §8), any `VARIABLE` initial value, record literal | 106 `VARIABLE`s, 89 in five machine simulations | Simpler state machines | Additive | M | D6, D31, D10, §17.1 |
| Mutable buffer (open), linear builder (**done** as collectors, LANGUAGE.md §8) | 9 stateful-loop primitives (727 code lines) | Those primitives to FL | Additive | L | D44, D18 |
| 32-bit word intrinsics, `charge` | TEA 478 steps per byte; SHA-1 186 | Cost-weighted limits | Additive | M | D44 |
| Kernel tier (L0) | 53 cipher and hash cores, 3,626 lines (57% of primitive code) | Cores to FL, if L0 passes | Additive | L | D5, D44 |
| `ext` tag, tagged literals, generic words | Three clients (symbolic, tables, matrices) | Packs, T8 | Additive | L | D11, §17.1 |
| The fixes of L-E (decided T41; generic arithmetic is additive, T37) | Wave 5 gap list | Consistent errors | One breaking item (`E_RANGE`); the rest additive or no change | M | D5 |

---

## 12. One implementation per capability

| Capability | Single owner | How the other side gets it |
|---|---|---|
| Encodings, hashes, ciphers, compression, text and byte utilities | FL / Forge | Relix gets them as the `fl` function library (browser bridge, §8.4; JVM `relix-fl`, §8.7). Relix gains base64, hex, URL and crypto without writing them. |
| Relational operators, optimiser, provenance, recursion, solver operators | Relix | Forge never writes table joins or grouping in FL; the relix pack delegates. Existing text-level list ops (`lines:sort`, `set:*`, `arith:*`) stay as they are (text in, text out). |
| Scalar functions present on both sides (md5/sha, regex, string, date, JSON path, edit distance) | Both, before Relix 1.0 | No rewrite on either side before Relix 1.0. Held together by shared vectors: run Forge's vectors against the Relix built-ins and the reverse in a throwaway cross-check, as PLAN §7 did for earlier waves. After 1.0, making Relix's non-pushdown built-ins delegate to FL is an open question (Q6). |
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

WP id prefixes: **L** FL v0.3 (and **H** its test harness); **P** pack system; **RW** the recipe wave of RECIPES-1.2 §18; **RL** the lane editor of RELIX-LANES §11.2; **X** extension values; **D** data; **R** Relix pack; **J** JVM bridge; **S** symbolic; **M** media and code; **SP** specifications; **C** convergence. Spikes use their own ids (R0, L0, J0, X0). Decision ids use T. File paths in the "owns" column are proposals; the brief for each WP fixes them. Per-WP sizes are set when the briefs are written; sizes for FL proposals are in §11.6.

### 13.2 Phase T0: spikes

Parallel, time-boxed, throwaway code. Each ends in a written result and an owner gate.

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| R0 ✅ | Relix engine compiled to JS or Wasm, in-memory path; report against §8.3 criteria | scratch repo or branch (not `packages/*`) | none | So | Result document lists each criterion as pass or fail with measurements. Done 2026-11-23: [r0-relix-in-browser.md](research/r0-relix-in-browser.md) |
| L0 | Kernel-tier compiler prototype; TEA, SHA-1, MD4, RC4 in FL | scratch branch | none | So | Result document with vectors and timings against §11.3 |
| J0 | FL VM bundle run in GraalJS; one op called from a Java test | scratch repo | none | So | Result lists start-up, per-call cost and ops that degrade |
| X0 ✅ | `ext` value, registry, one viewer and one parameter kind prototype | scratch branch | none | So | A table kind renders in the UI under the production headers. Done 2026-11-23: [x0-ext-values.md](research/x0-ext-values.md) |

**Gate T0.** The owner reads the four results and decides: R0 go or fallback; L0 go or cap; whether J0 allows the JVM bridge; whether the X0 shape is accepted.

**Gate T0 outcome (owner, 2026-11-23), for R0 and X0 only.** R0: go on TeaVM's JavaScript backend (T9 to T16). X0: shape accepted with the amendments of [X0 §11](research/x0-ext-values.md) (T17 to T22). **L0 and J0 have not run.** Their decisions (L0 go or cap; whether J0 allows the JVM bridge) are pending, so Gate T0 is not fully closed. Work that depends only on R0 or X0 may be briefed now.

### 13.3 Phase T1: specifications

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| SP1 ✅ | FL v0.3: the open items of §11. **Deliverable: a proposal file**; LANGUAGE.md changes at the fold-in (L14) | `docs/LANGUAGE-0.3.md` | Gate T0 | So | Every open proposal in §11.6 has a section and conformance cases (C401 to C594). Written 2026-11-23: [LANGUAGE-0.3.md](LANGUAGE-0.3.md); decided 2026-11-24 (T35 to T41) |
| SP2 ✅ | The recipe wave v1.2: ext parameters, slots for binary operators, named inputs, pack ops, pin behaviour, and `setup` and `finish` fields in the op vector format (T22). **Deliverable: a proposal file**; RECIPES.md changes at the fold-in (RW9) | `docs/RECIPES-1.2.md` | none (it did not in fact depend on SP1) | So | Schema changes listed; §2.2 internal-vocabulary drift fixed. Done 2026-11-23: [RECIPES-1.2.md](RECIPES-1.2.md); decided T23 to T28 |
| SP3 ✅ | The UI proposal: viewers, kind-aware fit, ext fields, lanes and slots, named inputs, packs, the CSP. **Deliverable: a proposal file**; UI.md changes as work packages land (as for SP2) | `docs/UI-TOOLKIT.md` | none (it did not in fact depend on SP1) | So | Rules 5 to 8, 10, 12 and 13 written in full, and the `media-src` change. Written 2026-11-23: [UI-TOOLKIT.md](UI-TOOLKIT.md); decided 2026-11-24 (T42 to T46) |
| SP4 ✅ | PACKS.md | `docs/PACKS.md` | SP1 | So | Manifest schema, discovery, init protocol, capability model. Written 2026-11-23: [PACKS.md](PACKS.md); decided 2026-11-24 (T47 to T51) |
| SP5 | SYMBOLIC.md v2 (§9.3). **Not written** | `docs/SYMBOLIC.md` | SP1 (done) | So | Decision table updated; WP table rewritten |
| SP6 ✅ | RELIX.md: pack spec, value mapping, operator table | `docs/RELIX.md` | SP1, R0 | So | Mapping table complete; naming (Q2) decided. Done 2026-11-23: [RELIX.md](RELIX.md); decided T29 to T34. Its one question for SP1 is how FL holds JSON `null` (Q14) |

**Gate T1.** The owner approves the frozen-contract changes. CLAUDE.md says `packages/*` are frozen; this plan needs an explicit version bump of FL, the recipe schema and the worker protocol.

**Gate T1 outcome (owner, 2026-11-23), for SP2 and SP6.** SP2: every recommended answer accepted, with FIX and ITERATE added to the format (T23 to T28). SP6: every recommended answer accepted (T29 to T34). The two conflicts between those specs are resolved (T25, T30). The recipe format itself needs no bump (T23).

**Gate T1 outcome (owner, 2026-11-24), for SP1, SP3 and SP4.** Every recommended answer is accepted (T35 to T52), and four conflicts between documents are resolved (T36, T46, T49, T52). The frozen-contract version bump is staged per T35 (G1 to G4). **SP5 is not written**, so Gate T1 stays open for it only. `media-src blob:` waits for T6 (T46).

**Status (2026-11-24, L1):** Gate T1 is decided for every spec except SP5. SP5 (SYMBOLIC v2) is not written, and it gates only the symbolic pack (Phase T5). The owner's decisions of the same day are T53 to T55.

### 13.4 Phase T2: FL v0.3 and corpus migration

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| L1 | `npm run corpus-stats` scripts and a baseline report. **Also refreshes every stale count of this document** (§2.1, §2.5, §11.5, §13.4; T52) and counts the `W_SHADOW` names that LANGUAGE-0.3 §14.1 leaves to it | `packages/ops/scripts/corpus-stats.*` | none (may start now) | Ha | Report reproduces the §2.5 figures on today's tree; the stale marks are replaced by measured numbers. Dated note (2026-11-24): done. The report is [research/corpus-baseline-2026-11-24.md](research/corpus-baseline-2026-11-24.md). Its figures differ from the survey's where the survey's definitions are not in the text, and the survey figures are kept beside the measured ones. W_SHADOW: 10 locals of two of the 35 new core names (`first` 6, `last` 4) in 9 files; neither name is already an own word there. The `} case` tables of choice-headed words, the count that L5b's drop rule uses: 3 |
| H0 | The test-harness additions of LANGUAGE-0.3 §3: fixtures, `@call`, `@meta` paths | `packages/lang/test/conformance/*` | Gate T1 | So | The 317 existing blocks pass; the fixtures exist; a fixture block runs |
| L2 | Group L-A words (LANGUAGE-0.3 §8, T39): `first second last divmod tdiv zero-pad index-of set-nth`, float bytes | `packages/lang/src/vocab/*` | H0 | Ha | C471 to C492 pass; the `core` table test passes |
| L3 | JSON in core and one JSON implementation (LANGUAGE-0.3 §7, T38): `json>value`, `value>json`, `null`, `null?`; the `json` vocabulary of `@forge/ops` becomes wrappers | `packages/lang/src/vocab/json.ts`, `packages/ops/src/prims/json.ts` | X1, L2 | So | C456 to C470 pass; round-trip properties pass; one JSON implementation |
| L4 | Mid-body local binding. **Done in v0.2** (`:>`, LANGUAGE.md §7.1) | n/a | n/a | n/a | n/a |
| L5a | Constant expressions (LANGUAGE-0.3 §9.1) | `compiler.ts`, `compiler-const.ts` | X4, L2 | So | C493 to C500 pass; no VM code runs at load |
| L5b | Choice values (§9.2). Last of the group; dropped if the L1 count of `choice … case` tables is small | `compiler-choice.ts`, `meta.ts` | L5a | So | C501 to C506 pass; no existing `effect.text` or hash changes |
| L6 | `friend`, `DEFER:` with the group hash, `VARIABLE` of any value, `record{` (§9.3 to §9.6). Visibility marker and `exit` are done | `packages/lang` (`compiler.ts`, `dictionary.ts`, `meta.ts`, `reader.ts`, `vm.ts`) | L5a, X1 | So | C507 to C536 pass; a vocabulary can call another's private word by `friend`, so `cmac` and `lmhash` need no primitive |
| L7a | `ext{array}`, its five intrinsics, `thaw`, `anew`, `anew-bytes` (§10.1 to §10.3) | `vm.ts`, `values.ts`, `vocab/array.ts` | X1, L2 | So | C537 to C556 pass; aliasing rules tested; D44 holds for primitives |
| L7b | 32-bit words and bulk word conversion (§10.4). **Gated on L0** | `vocab/word32.ts` | L7a, L0 | Ha | C557 to C566 pass |
| L8 | `charge`, cost-weighted accounting, `+media` (§11) | `vm.ts`, `primitives.ts`, `types.ts` | X1 | So | C567 to C572 pass; a primitive hits `maxSteps` at the same step in Node and a Worker |
| L9a | The additive fixes (§12.2, §12.4, §12.6 to §12.8): `/`, `runtime.call` defaults, pattern strings, `\f`, the `doc` cap | `vocab/core.ts`, `runtime.ts`, `meta.ts`, `reader.ts`, `meta.schema.json` | L2 | So | C576 to C579 and C585 to C592 pass; the search for `E_COERCE` from `/` finds nothing |
| L9b | The `E_RANGE` constraint code (§12.3). **Merges only in G3** | `values.ts`, `vm.ts` | L9a | So | C580 to C584 pass; the vectors fail until L12 rewrites the listed expectations |
| L10 | Generic arithmetic and generic words (§5): the `generic` flag, dispatch, kind `methods`, `sort` by `compare` | `primitives.ts`, `vm.ts`, `values.ts`, `types.ts` | X1 | So | C431 to C445 pass; plain numbers bit-identical; overhead within 2% on the 10^6-step benchmark |
| L11 | Kernel tier (§13). **Only if L0 passes** | `packages/lang/src/kernel/*` | L7a, L0 | So | C593 and C594 pass; every kernel word equals the interpreted run |
| L12 | The sweep (§14): the `json` callers, the expectation codes of §12.3, `previousHashes` first (T27), `FORGE_LANG_VERSION` `0.3.0`. Run at a wave boundary, in the group G3 of T35 | `packages/ops/vocab/*.fth`, `*.test.json`, `src/prims/*` | L2, L3, L9b, L10 | So | All vectors pass except the listed expectation codes; catalogue version bumped. Dated note (2026-11-15): the v0.2 subset of the migration is done, that is the forms available in v0.2 (typed `fail-*` words, promoted core words, shared `CHOICE:` types, `cond`/`case`, `:>`, collectors, `MEMO:`) over all 207 vocabularies. The L-E fixes, generic arithmetic and the kernel tier were not part of it. |
| L13 | Move primitives to FL (the 7 + 3 + 9 made possible by L2 and L7a; the cipher and hash cores only if L11 passes) | `packages/ops/prims/*`, `vocab/*` | L12, L7a, L11 | Ha | Vectors unchanged; corpus-stats report shows the change in primitive count and lines. Dated note (2026-11-14): the analysis `log2`, the coords maths, the list `sort`, `sort-by` and `shuffle`, `cmac`, `lmhash` and the `hex` primitive are now FL, and `base64` is FL with two private helpers (`_sextets`, `_unsextets`). |
| L14 | The fold-in: LANGUAGE.md becomes v0.3 with an Appendix B, takes the cases of LANGUAGE-0.3 §17 under their numbers, and LANGUAGE-0.3.md becomes a historical note | `docs/LANGUAGE.md`, `docs/LANGUAGE-0.3.md` | all of the above | So | The harness reads LANGUAGE.md only |

The files and "done when" checks of the L rows are those of LANGUAGE-0.3 §20, which wins if they differ. X1 and X4 of that section are the rows X1 and X4 of §13.5.

L3 and L10 need the `ext` tag (X1), so X1 is built inside Phase T2 although it appears in the T3 table; the gate for T2 covers it. The staging of the version bump (G1 to G4) is T35.

**Gate T2.** Conformance tests, op vectors, `gate2:browser` and `gate4:browser` green; the corpus-stats before/after report is attached.

### 13.5 Phase T3: pack system, extension values, data

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| X1 | `ext` tag core (LANGUAGE-0.3 §4, T36): process-wide idempotent registry, equality, O(1) `sizeOf` with a per-kind test, text form, header `ext{kind}`, `StackSlot.kind` and `ParamSpec.kind`, `str` to `ext` coercion, `ext-kind` and `ext>text`, the reserved `null` kind and words, and `kindConformance`. **Owns the forced one-line `ext` cases** in `packages/{ops,recipe,worker}` and `apps/web` (G1 of T35) | `packages/lang/src/{types,values,meta,primitives,vm,errors}.ts`, `ext.ts` (new), `meta.schema.json`, `vocab/core.ts`; the forced cases | H0, Gate T1 | So | C401 to C428 and C456 to C461 pass; v0.2 conformance unchanged; header round-trips; an `ext` value passes through `list`, `record` and `fork`; size limits apply; a module evaluated twice registers cleanly; main still typechecks **Done 2026-11-24 (G1, with X2).** C427, C456 and C457 wait for X4 and L3. |
| X2 | `OutputValue` ext kind with the `truncated` flag, the viewer registry and contract (UI-TOOLKIT §1), kind-aware `fit.ts`, badges and the "Data here" line (§2), Copy, Download and Convert to bytes (`bytesOps`), **the CSP golden test against today's string** (§7.5). Contract bump with X1 | `packages/worker/src/render.ts`, `apps/web/src/io/*`, `apps/web/e2e/csp.spec.ts` | X1 | So | Unknown kinds fall back to text; DOM built without `innerHTML`; a viewer that throws does not hide the value; axe passes in three themes; the golden test passes **Done 2026-11-24 (G1, with X1).** The card badges read the catalogue's `inputKind` and `outputKind`, which X3 and D2 add. |
| X3 | `ext` parameters in recipe JSON, URL and UI (UI-TOOLKIT §3): the helper contract with a position in the result and an async `checkAsync`. Needs the per-step schema from X5 (`StepReport.out`, `dataInfo`). The kind parser is one module shared by worker and page (decide with P1a). The recipe half is RW2 | `packages/recipe`, `packages/ops/src/types.ts`, `apps/web/src/params/*` | X1, SP2 (done), X5, RW2 | So | An ext parameter round-trips JSON, FL and URL |
| X4 | Tagged literals (LANGUAGE-0.3 §6): the `tstr` token, `registerLiteralTag`, compile-time evaluation | `packages/lang/src/reader.ts`, `compiler.ts`, `ext.ts` | X1 | So | C446 to C455 pass; the error offset points at the bad character |
| X5 | Named inputs in the bake protocol and UI: `BakeOptions.inputs`, `PROTOCOL_VERSION` 2 (T23), the per-step schema in the bake result (RECIPES-1.2 §7.5), only the named tabs sent (T44), unique tab names. The worker half is RW5 | `packages/worker/src/protocol.ts`, `apps/web/src/bake/*` | SP2 (done), RW5 | So | A step can read another input tab by name; a `protocol: 1` client gets `E_PROTOCOL` |
| P1a | `@forge/packs`: manifest types, the schema, `validateManifest`, the cross-checks that need no runtime, core name sets, `PACK_API`, the corpus of PACKS §10.1 | `packages/packs/*` | Gate T1 | So | Every valid manifest passes and every invalid one fails with its code; the strict schema runs under Ajv **Done 2026-11-24.** `packages/packs` holds the types, the schema, `validateManifest`, 11 of the 28 section 2.4 codes (the rest need a runtime and belong to P1b and P6), the core name sets and `PACK_API`. |
| P1c | Catalogue support: `buildCatalogue` options, `mergeCatalogues`, `catalogueVersionOf`, the merge-equality test | `packages/ops/src/catalogue.ts`, `types.ts`, `packages/packs/src/merge.ts` | RW4, P1a | So | Merge equality holds for every closed subset of the fixture packs; core-only output is byte-identical to today's |
| P1b | Discovery and generation: `packs:gen` and `--check`, the two generated registries, the `forgePacks()` Vite plugin, ESLint guard rails | `packages/packs/src/gen/*`, `apps/web/vite.config.ts`, the generated registries, `eslint.config.js` | P1a, P1c | So | The generator runs on a fixture tree and the demo pack; `--check` fails on a stale file; a static import from core into `packs/` fails the build |
| P2a | The composite provider and the pack loaders | `packages/ops/src/bundle.ts`, `packs.ts`, `packages/packs/src/loader.ts` | P1a | So | A clash throws; unknown, unclosed and conflicting lists are refused with their reasons; a module evaluated twice registers cleanly |
| P2b | Baker `init` with pack ids (`BakerInit.packs`, `InitInfo.packs`, the guard, the `init-error` mapping, the init deadline); the console `init`; the app's worker entries. **Rides protocol 2** (T48) | `packages/worker/src/*`, `apps/web/src/bake/worker.ts`, `apps/web/src/fl/*` | P1b, P2a, **RW5** | So | Ids not in the manifest are refused; a `protocol: 1` client gets `E_PROTOCOL`; `gate2:browser` passes |
| P3 | Dependency-closure loading in place of `vocabs: "all"`, the baker's `catalogue-mismatch` drop (T49), the recipe view of the catalogue. Uses `opVocabs` | `apps/web/src/bake/controller.ts`, `packages/ops/src/*`, `packages/worker/src/core.ts` | P2b, **RW6** | So | Core start-up no longer loads all primitive chunks; the re-init cost is reported |
| P4 | The pack manager UI, the IndexedDB store (key `packs`), `state.packs`, lazy viewer stubs (UI-TOOLKIT §6). Also decides where the fixed table of capability sentences lives (T55; PACKS PK15, UI-TOOLKIT §6) | `apps/web/src/packs/*` | P2b, SP3 (done) | So | Enable and disable persist per browser; `needs-review`, `unavailable`, `blocked` and `failed` work; axe passes in three themes |
| P5 | The enable offer and notice for `packs-needed` and saved recipes, the share-dialog pack lines. Needs `PackIndex` | `apps/web/src/packs/offer/*`, `apps/web/src/bake/forge-share-dialog.ts` | P4, X3, **RW6** | So | Opening a recipe that names a pack op offers to enable; no URL or recipe enables a pack |
| P6 | `+media` in `EffectLabel`, the baker's `deny`, `BakeOptions.deny`, `E_FORBIDDEN` with `detail.pack`, the effect checks | `packages/lang/src/types.ts`, `packages/worker/src/*`, `packages/packs/src/checks/effects.ts` | X1, P1a | So | A denied capability produces a structured error that `try` does not catch |
| P7 | Per-pack size budgets in `npm run size`, from the report | `apps/web/scripts/check-size.mjs` | P1b | Ha | A budget breach fails CI; the 250 kB core budget still applies |
| P8a | The demo pack: manifest, vocabulary, kind, viewer, parser, helper, vectors | `packs/demo/*` | P2b, X2 | Ha | The pack loads and bakes in Node; vectors pass |
| P8b | The Gate T3 end-to-end test, the second build with internal packs, `gate4:browser --packs` | `apps/web/e2e/packs.spec.ts`, `apps/web/scripts/serve-prod.mjs`, `.github/workflows/ci.yml` | P4, P5, P8a | So | Every check of PACKS §10.4 passes under the production headers |
| P9 | `THIRD-PARTY-NOTICES.txt` generation and the link from the About page | `packages/packs/src/gen/notices.ts`, `apps/web/pages/*` | P1b | Ha | The file lists every pack's NOTICE and `externalCode` licence |
| D1 | `csv` words and the one CSV parser in core. Amended: parses straight into columns, not via a list of lists. Names the JSON-to-table parser (T55; no document fixed it before 2026-11-24) | `packages/ops/vocab/csv.fth`, `prims/csv.ts` | L3 | So | RFC 4180 vectors pass |
| D2 | `table` kind: columnar, typed, null mask. Amended: `int` column, faithful text form (null distinct from empty), honest size charge; `table` is core (Q4). Export words `table:to-csv` and `table:to-json` (T38) | `packages/ops/src/table/*` | X1 | So | Size cost near the §2.4 columnar figure (at most 0.8 MB for numbers and 2.0 MB for 8-character strings at 10,000 by 10); equality, size, text and view tested; `table:to-json` and `table:to-csv` round-trip nulls **Done 2026-11-24.** `int` is a BigInt64 column (64 bits; wider digits go in a `str` column), strings are one buffer plus end offsets, bools are bit-packed; measured 800,216 bytes (numbers) and 2,000,216 bytes (8-character strings) at 10,000 by 10. The text form is JSON `{columns, rows}`. The catalogue now carries `inputKind` and `outputKind`. A recipe input is bytes and bytes do not coerce to `ext{table}`, so the single-step vectors of `to-json` and `to-csv` expect `E_TYPE`; their round trips are tested in `packages/ops/src/table/`. |
| D3 | `table` words and table viewer (virtualised grid). Amended: first 100 rows with the total and a stated limit for 1.0, whole up to 5,000 cells then windowed, the null and empty rules of UI-TOOLKIT §1.7; rows on demand deferred (R9, T42) | `packages/ops/vocab/table.fth`, `apps/web/src/io/table-view.ts` | D2, X2 | So | Grid shows first N rows with total |
| D4 | Wave 1b data-format ops on `table` | `packages/ops/vocab/*` | D1, D3 | Ha | Vectors pass |

The P rows are PACKS §13, which holds their files and checks and wins if they differ; P1c, P9 and P8b are new, and P1, P2 and P8 split. RECIPES-1.2 §18 holds ten work packages for the recipe wave, RW1 to RW10, each with a "Maps to" column naming the row here that it is part of or overlaps (RW1 and RW3 to RW8 sit under X3, X5, P3, P5 and R6; RW9 is the fold-in into RECIPES.md; RW10 is the web app's format-facing work). They are not counted again in §13.11.

**Gate T3.** A demo pack with one ext kind and one viewer loads lazily under production headers. Core start-up no longer loads all primitive chunks.

### 13.6 Phase T4: Relix pack, then the JVM bridge

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| R1a | `relix-web` session shim: tables, limits and poll, terminals, structured diagnostics, print and normalise, `decompose`, the `fl` cache library, version string | `relix-web/shim/*` | R0, Gate T1 | So | Every entry point has JVM and browser tests; limits fire with their codes |
| R1b | `relix-web` build: patch-series check per Relix release, supplements module (the T34 random fix), ES-module wrapper, hashed artifact, size gate, NOTICE | `relix-web/scripts/*`, `patches/*`, `classlib/*` | R0 | So | A clean build from a published engine gives the module at most 3 MB gzip (T12) |
| R2a | `operators.json` and its schema (52 rows), drafted by script from `RelNode` and the reference, then completed by hand | `packs/relix/gen/operators.json` | SP6 (done) | So | All 52 rows; coverage, spelling and reference tests pass |
| R2b | Generator: `.fth` with `META:`, printer table, help source; `--check` mode | `packs/relix/gen/*.ts`, `vocab/relix.fth` (one `.fth` per vocabulary, PK23) | R2a | Ha | Generated output committed; `gen:relix --check` in CI |
| R3 | `relation` and `relix-expr` kinds, sources (including `relix:input`, T30) and terminals | `packs/relix/vocab/*`, `src/kinds/*`, `prims/*` | R1a, R2b, X1, D2 | So | Build, `relix:run`, `explain`, `schema`, `>text`, `parse` pass vectors |
| R4 | Table-to-engine and engine-to-table interchange; implicit lift and run inserted by the compiler (T29) | `packs/relix/src/interchange/*`, compiler hook | R3, D2, SP2 (done) | So | Null mask and typed columns round-trip; the trace shows `relation -> table` |
| R5a | Tier-1 shape check module and the wrapper templates for fragments (T34) | `packs/relix/src/expr-check/*` | R1a | So | Each shape: valid samples pass, invalid ones report the right column |
| R5b | Tier-2 check through the Worker, completion from schema and catalogue, the field UI | `packs/relix/ui/*` | R5a, X3, X5 | So | A bad expression is reported at its position before the bake |
| R6 | Nested-lane UI for slots (as RELIX-LANES §11, whose RL2 to RL7 carry its parts, with RW3 and RW10; the Tree view is read-only, T43) | `apps/web/src/recipe/*` | SP2 (done), R3 | So | A binary operator step shows lanes; `FIX` and `ITERATE` show `base` and `step`; e2e passes |
| R7a | "View as Relix", both spellings, include-data option with a 200-row cap (T34) | `packs/relix/src/view/*` | R1a, R3 | So | Golden texts; the lost-content list is shown |
| R7b | `.relix` import with the statement check and binding dialog | `packs/relix/src/import/*` | R7a | So | Recipe to text to recipe is the identity on supported steps |
| R8 | Per-step schema and on-demand row counts (T34) | `packs/relix/ui/*` | R3, X5 | Ha | Schema on every Relix step; a count on request |
| R9a | `fl` exposure rules, names (T32), value mapping both ways | `packs/relix/src/fl-bridge/map.ts`, `exposure.ts` | R1a, R4 | So | Property tests pass; the exposure report lists every excluded op and why |
| R9b | Discover, batch, replay loop; FL errors; limits | `packs/relix/src/fl-bridge/batch.ts` | R9a | So | A query over 10,000 rows calls an FL op once per distinct value |
| R10 | Help from `relix-docs` | `relix-web/scripts/reference.*`, `packs/relix/gen/help-*.ts` | R2b | Ha | Help text comes from the reference pages |
| R11 | Conformance harness: reference examples against the browser engine, with an expected-differences gate | `relix-web/harness/*`, `packs/relix/test/*` | R1a, R1b, SP2 (done) | Ha | Pass rate reported against T12; a change in the differences list fails the job |
| R13 | Pack manifest and budget, lazy load in the bake Worker, cancellation wiring (shared flag, poll, deadline), `needsHardKill` for engine-running words | `packs/relix/manifest.json` (PACKS §2.5), `packages/worker` hook (`WorkerPackHost.onBake`) | R1a, P2b | So | Cancellation tests pass; the pack loads lazily under the production headers |
| R14 | Security tests: injection, text rendering, refused statements | `packs/relix/test/security/*` | R3, R7b | Ha | Every case of RELIX.md §11.2 has a test |
| J1 | `@forge/embed` single-file bundle | `packages/embed/*` | Gate T2, J0 | So | Runs under Node and GraalJS |
| J2 | `relix-fl` module (`FunctionLibrary`, GraalJS) | `relix-fl/*` (location per Q11) | J1; Relix 1.0 | So | Found by `ServiceLoader`; an FL op callable in a query |
| J3 | Value mapping and vector run in CI | `relix-fl/test/*` | J2, SP6 | Ha | Op `*.test.json` vectors pass through the bridge |
| J4 | List of degraded ops (WebCrypto, `CompressionStream`) and licence note | `relix-fl/README*` | J2 | Ha | List complete |

The R-rows are refined in RELIX.md §15, which holds the files, sizes and "done when" checks. R1, R2, R5, R7 and R9 split into a and b; R13 (manifest and cancellation) and R14 (security tests) are new; **R12 (the TypeScript fallback engine) is dropped**, because R0 passed (T9).

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
| M1 | Media pack skeleton and `media-src blob:` CSP change (owner-approved, `terraform apply`; T46). The CSP golden test's expected string changes in the same pull request | `packs/media/*`, `infra/` | Gate T3 | So | Pack loads; the golden test passes with the new string |
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
 T0 spikes:  R0 (done)   L0   J0   X0 (done)
              \    |    |    /
               v   v    v   v
 T1 specs:   SP1 SP2 SP3 SP4 SP6 done ; SP5 not written  [Gate T1: owner]
                         |
 T2 FL v0.3:  H0 -> X1 (G1) -> L2..L10 -> L9b + L12 (G3, wave boundary) -> L13 -> L14
                         |  (L11 only if L0 passed)
 T3 packs:    X1 -> X2 X3 X4 X5 ; P1a -> P1c -> P1b -> P2b (RW5) -> P3 (RW6), P4 -> P5 (RW6) -> P8b ; D1 D2 -> D3 -> D4
                         |
 T4 Relix:    R1a R1b -> R2a -> R2b -> R3 -> R4 -> R9a -> R9b ; R1a -> R5a -> R5b ;
              R3 -> R6 R7a -> R7b R8 ; R2b -> R10 ; R1a R1b -> R11 ; R1a -> R13 ; R7b -> R14
              J1 -> J2 -> J3   (after Relix 1.0)
 T5 symbolic: S1 -> S2 S3 -> S4 -> S5 S6 ; S7 S8 -> S9 -> S10
 T6 media:    M1 -> M2 -> M3 M5 M6 M7 ; M4 ; M8 ; M9
 T7:          C1 C2 C3 C4
 Parallel throughout: PLAN wave 1b (needs D), wave 6, wave 7
```

T5 and T6 depend on Gate T3 only, not on T4, so they can run in parallel with the Relix pack once packs and ext values exist.

### 13.11 What can start now

- Spikes: R0 and X0 are done (T9 to T22). L0 and J0 are still open.
- In progress: H0 and L1. L1 is the corpus-stats scripts, which change no contract, and it has refreshed the counts (T52).
- Next: X1 with X2 (G1 of T35).
- A draft of SP5 (SYMBOLIC.md v2). SP1 to SP4 and SP6 are written and decided at Gate T1 (T23 to T55).
- Packages that change `packages/*` follow the staging of T35 (G1 first).

**Scheduling rule.** The L12 sweep runs at a wave boundary. The remaining core waves from PLAN.md (wave 1b data formats, now depending on D; wave 6 compression; wave 7 public key, networking, forensics) run in parallel throughout, but no op work package may be in flight while L12 runs.

**Count.** The tables hold 85 work packages (18 + 22 + 22 + 10 + 9 + 4), plus 4 spikes and 6 specifications. Phase T2 went from 13 to 18: H0 and L14 are new, and L5, L7 and L9 split in two (SP1; L4 is done). Phase T3 went from 17 to 22: P1 to P8 became the 13 rows P1a to P9 (SP4). The Phase T4 count went from 16 to 22: R12 is dropped, five rows split and R13 and R14 are new (18 R-rows and 4 J-rows). The RW packages of RECIPES-1.2 §18 and the RL packages of RELIX-LANES §11.2 overlap rows of Phase T3 and T4 and are not counted again. Several are conditional (L7b, L11, L13 in part, J2 to J4). The Phase T3 and T4 tables can be merged in pairs if coarser packages are preferred.

---

## 14. Risks and open questions

### 14.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | R0 fails, or the chunk is too large | Fallback engine (§8.5), reduced to core operators; or a local engine later. **Retired 2026-11-23:** R0 passed at 1.33 MB gzip (T9). What remains is the patch fork and TeaVM stability ([R0](research/r0-relix-in-browser.md) §11) |
| 2 | `BigDecimal`, time and regex behaviour diverge between the compiled engine and the JVM | The reference-example corpus is the gate (R0 criterion 3); R11. **Reduced 2026-11-23:** all 63 decimal, 38 date/time and 10 regex examples agree. Collation and seeded random differ (T11) |
| 3 | Sync engine against async FL | Batch hoisting outside the engine; R0 tests it. **Resolved 2026-11-23:** synchronous callbacks with batching (T14) |
| 4 | L0 fails, so goal 5 is capped at roughly the current FL share for crypto | The plan says so (§11.3); the 53 cores stay TypeScript |
| 5 | The v0.3 migration churns parallel op work | One sweep at a wave boundary (L12, group G3 of T35); no op WPs in flight. The sweep is small: one breaking item (`E_RANGE`) and the `json` callers (T41) |
| 6 | Frozen-contract changes in `packages/*` | Explicit version bump at Gate T1. X0 confirmed that X1 and X2 are source-breaking and belong in that bump (T19). **Decided 2026-11-24:** the bump is staged G1 to G4 (T35) |
| 7 | The Relix 1.0 freeze delays engine-side asks | Asks (Q1) are scheduled after 1.0 unless the owner pulls them in; the pack works from the published jar |
| 8 | CSP relaxation for media | Limited to `media-src blob:`; owner-approved; media pack only. **Applied at T6** (M1), not before, and guarded by the CSP golden test (T46; UI-TOOLKIT §7.1, §7.5) |
| 9 | Scope: this is several products | Phase gates; packs optional and independent after T3 |
| 10 | GraalJS constraints (start-up, missing browser APIs, licence) | J0 measures; J4 lists degraded ops |
| 11 | Table memory under the allocation meter | Columnar representation; propose a live-size meter or structural sharing for tables |
| 12 | A catalogue that depends on which packs are enabled: `catalogue-mismatch` would fire for every reader with a different set of packs on, and a recipe could name an op the reader's catalogue lacks | The validator skips `catalogue-mismatch` for a recipe with a pack op and `encodeShare` omits `catalogue` for it; `pack-not-enabled` and `packs-needed` say what is missing (T26; RECIPES-1.2 §8.5). PACKS §5.4 closes the rest: `recipe.catalogue` is the core version (T49) |
| 13 | A pack that fails to load or crashes the tab | A `pending` mark in the store, an init deadline, and the `failed` and `unavailable` states, so a crash loop cannot lock the user out; disabling replaces the workers (PACKS §8.4, PK16, PK21; T51) |
| 14 | Fragment drift: the merged catalogue of core and pack fragments differs from the one built from a single runtime | The `fragment-drift` check in `packs:gen --check` and CI; merge equality for every closed subset (PACKS §5.2, PK10; T49) |

**Note, not a risk.** `apps/web/scripts/serve-prod.mjs`, the server that the e2e suite runs against, omits `Permissions-Policy`, HSTS and `X-Frame-Options`, which `infra/site.tf` sets, so the e2e suite does not test those headers. It is not a blocker and not part of the CSP. A separate task is queued for it.

### 14.2 Open questions for the owner

| # | Question |
|---|---|
| Q1 | Which Relix API additions to pull into 1.0 versus after: a `relix.operators` catalog, parameter names in `relix.functions`, a public Value to JSON writer, span ends? **Decided 2026-11-23 (T31): none into 1.0; an ordered list of asks after it.** |
| Q2 | Naming of FL ops as Relix functions: `fl.base64_decode` or another scheme? **Decided 2026-11-23 (T32): `fl.<vocab>.<word>`, hyphens as underscores.** |
| Q3 | NULL and bytes mapping (§8.4): bytes as a tagged struct or as hex text? **Decided 2026-11-23 (T32): bytes as the struct `{ bytes_hex }`; the bridge does NULL in, NULL out.** |
| Q4 | Are `table`, `json` and `csv` core (recommended) or a pack? **Decided 2026-11-23 (T21): `table` is core, not a pack.** `json` and `csv` stay core, as recommended. |
| Q5 | Is the `rat` mapping for NUMBER wanted when the symbolic pack is on? **Decided 2026-11-23 (T32): yes, only where the parameter is declared `ext{rat}`.** |
| Q6 | Should Relix's non-pushdown built-ins later delegate to FL? (The owner chose "also in JVM Relix", not "FL replaces Relix built-ins".) **Decided 2026-11-23 (T33): no. Both keep their implementations, held together by shared vectors.** |
| Q7 | R0 thresholds (§8.3): confirm or replace the proposed values and the estimates. **Decided 2026-11-23 (T12): the provisional thresholds are confirmed as the standing thresholds.** |
| Q8 | Are Render Markdown and OCR dropped? |
| Q9 | Are exotic operators (SOLVE, OPTIMIZE, COVER) in scope for the browser? **Decided 2026-11-23 (T13): `OPTIMIZE` and `COVER EXACT` are out of the browser; `SOLVE`, `ROLL` and `SHUFFLE` are in.** |
| Q10 | How should pinned share URLs behave across the v0.2 hash change, beyond the existing `hash-mismatch` warning? **Decided 2026-11-23 (T27): `previousHashes` on ops whose vectors are identical in both releases; an old pin to such an op is silent.** |
| Q11 | Where do `relix-web` and `relix-fl` live: new repositories or the relix umbrella? **Partly decided 2026-11-23 (T16): `relix-web` is its own repository (`DarkCollective/relix-web`, private). Where `relix-fl` lives is open.** **Decided in full 2026-11-23 (T33): `relix-fl` is its own repository, `DarkCollective/relix-fl`.** |
| Q12 | Are PLAN.md Phase 6 items (Magic, recipe store, PWA, CLI) re-sequenced behind this programme? |
| Q13 | Is T8 (relations and symbolic expressions as one kind of expression value) accepted? |
| Q14 | How does FL hold JSON `null`? It decides how nested NULLs (a struct field or array element) cross the Relix bridge. Raised by SP6; for SP1. **Decided 2026-11-24 (T38): `ext{null}`, with the words `null` and `null?`.** A nested NULL maps to `ext{null}` and back ([RELIX.md](RELIX.md) §5.4, §16 item 13), and the bridge no longer refuses it with `E_COERCE`. `null` is a reserved core kind name (T36). |
| Q15 | Which version bump covers the frozen contracts at Gate T1: FL, the worker protocol and the X1 and X2 contract (T19)? **Decided 2026-11-24 (T35, T48): FL v0.3, `0.3.0` set at L12; the worker protocol 2 (T23), which also carries `init.packs` (PQ7) and the `ext` output of X2; the recipe format stays `"forge": 1`; `PACK_API` is an integer in the pack manifest contract. The bump is staged G1 to G4.** |

The open questions of UI-TOOLKIT §11 (Q1 to Q16) and PACKS §12 (PQ1 to PQ15) are all decided with their recommended answers (T42 to T51). They are not repeated here.

---

## 15. Relationship to other documents

- **PLAN.md.** The Phase 6 line "Relix vocabulary integration as an `relix:` vocab of primitives" is superseded by this plan. PLAN §9 gains the decisions T1 to T8 once approved; items 14, 15 and 16 of PLAN §9 point to T9 to T22, T23 to T34 and T35 onwards.
- **SYMBOLIC.md.** Superseded in part: S2, S3, S5, S6 and S7 (§9.3). S8 to S14, S20 and S21 stand. A v2 is written in WP SP5.
- **LANGUAGE.md.** v0.2 is the current specification. The next wave is [LANGUAGE-0.3.md](LANGUAGE-0.3.md) (WP SP1, decided T35 to T41): the `ext` value, generic words, tagged literals, JSON and `null`, defining forms, the array, `charge`, and the fixes of §11.5. LANGUAGE.md becomes v0.3 at the fold-in (L14).
- **LANGUAGE-0.3.md.** The proposal for FL v0.3 (WP SP1). Its work packages are H0 and the L rows of §13.4, and it wins over §11 where they differ.
- **RECIPES.md.** The recipe wave is specified in [RECIPES-1.2.md](RECIPES-1.2.md) (WP SP2, decided T23 to T28). RECIPES.md changes at the fold-in (RW9). The §2.2 internal-vocabulary drift (two named, eight in `INTERNAL_VOCABS`) is fixed.
- **RECIPES-1.2.md.** The proposal for v1.2 of the recipe format: ext parameters, slots, named inputs, pack ops, pins, vectors, share links and the bake protocol. Its work packages are RW1 to RW10 (§18).
- **UI.md.** Amended as work packages land, from the proposal [UI-TOOLKIT.md](UI-TOOLKIT.md) (WP SP3, decided T42 to T46): rules 5 to 8, 10, 12 and 13, viewers, ext fields, lanes, named inputs, the pack manager and the CSP.
- **UI-TOOLKIT.md.** The UI proposal (WP SP3). Its work packages are carried by the X, D, P and R rows (UI-TOOLKIT §12) and by RL2 to RL7 of RELIX-LANES.
- **RELIX.md.** The Relix pack specification (WP SP6, decided T29 to T34): value kinds, the `relix:` vocabulary, the operator table, the value mapping, the `fl` library, errors, limits, help and tests. Its work packages refine §13.6.
- **PACKS.md.** The pack specification (WP SP4, decided T47 to T51): the manifest, discovery, the init protocol, the catalogue and packs, the capability model, enabling, security, versioning and testing. Its work packages P1a to P9 replace the P rows of §13.5.
- **New documents.** SYMBOLIC.md v2 (SP5), not yet written.
- **RELIX-LANES.md.** Design proposal for binary Relix operators in the recipe pane (lanes, slots, Tree view, recipe JSON for slots). It elaborates §8.2 and refines WP R6.
