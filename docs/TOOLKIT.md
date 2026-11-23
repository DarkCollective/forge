# Forge toolkit: Relix, symbolic algebra and packs (programme plan)

Status: draft v1 (2026-11-11), amended 2026-11-23 with the owner's Gate T0 decisions for R0 and X0 and, the same day, the Gate T1 decisions for SP2 and SP6 (§3). A plan, not yet normative. It builds on [PLAN.md](PLAN.md) (§1 principles, §3.5 primitives, §5 security, §7 phases, §8 orchestration, §9 decisions), [SYMBOLIC.md](SYMBOLIC.md) (v1), [LANGUAGE.md](LANGUAGE.md) (FL v0.1), [RECIPES.md](RECIPES.md) and [UI.md](UI.md) (§4 CSP). Relix facts come from the `relix-core` source tree, `relix/docs/design/query-builder.md` and `relix/.claude/BACKLOG.md`.

> **Packages are frozen.** `packages/*` hold frozen Phase 1–2 contracts (CLAUDE.md). Most of this plan changes them. Nothing in it starts before the owner approves the version bump at the gate of Phase T1 (§13.3). The spikes of Phase T0 are throwaway code on branches and change no contract.

> **Estimates are marked.** Every number in this document comes from the research summarised in §2 or from a file cited next to it. Thresholds and sizes that are proposals or estimates say so. Sizes are relative (S, M, L). There are no calendar dates.

## Contents

1. Goals and scope
2. Where we are
3. Decisions T1 to T8, Gate T0 (T9 to T22) and Gate T1 (T23 to T34)
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

From PLAN.md §7: **363 ops in 155 vocabularies**. 4,488 op vectors in 155 files. The tree has 161 `.fth` files in `packages/ops/vocab`: the 155 op vocabularies plus six internal ones.

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
| T7 | Plugin model: first-party packs are separate workspace packages built and deployed with the site, because the CSP allows only same-origin script. Third parties may share FL-only vocabularies, which already run as untrusted code. | UI.md §4 rules 4, 5 and 8. |
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

The owner decided Gate T1 for **SP2 ([RECIPES-1.2.md](RECIPES-1.2.md)) and SP6 ([RELIX.md](RELIX.md)) only.** SP1, SP3, SP4 and SP5 have not been written. Ids continue the T series. Each row names the answers of the spec that it takes; the spec holds the reasoning.

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

**Gate T1 status.** SP2: decided (T23 to T28). SP6: decided (T29 to T34). **Gate T1 stays open for the rest.** SP1 (LANGUAGE v0.2 remainder), SP3 (UI.md), SP4 (PACKS.md) and SP5 (SYMBOLIC v2) have not been written. The frozen-contract version bump for X1 and X2 (T19) is not yet approved, and no work package that changes `packages/*` starts before it. The two specs raise two new questions, Q14 and Q15 (§14.2).

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
- test vectors (`*.test.json`);
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
- **NULL.** FL has no null. The bridge does NULL in, NULL out: if any argument is NULL, it returns NULL and does not call FL. The bridge has to do this because the engine calls a function even when an argument is NULL (RELIX.md §5.4). This corrects the R0 note (criterion 8), which said the engine skips the call. A table's null mask carries nulls.
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

These ops belong to `pack:media` or `pack:code`. Lowest priority of the programme.

---

## 11. FL v0.2

**Principle.** Every proposal carries a corpus number. The measuring scripts are kept as `npm run corpus-stats -w @forge/ops`, so each change reports before and after (private single-use helpers, shuffle density, primitive count and TypeScript lines, zero-input table rebuilds).

**Status.** FL v0.2 has shipped part of this section. Items marked **(done)** are in [LANGUAGE.md](LANGUAGE.md) (see its [Appendix A](LANGUAGE.md#appendix-a-changes-in-v02)) and are no longer proposals; everything else is still future work.

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
| Breaking fixes (L-E) | Wave 5 gap list | Consistent errors, generic arithmetic | **Breaking** | M | D5 |

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

WP id prefixes: **L** FL v0.2; **P** pack system; **X** extension values; **D** data; **R** Relix pack; **J** JVM bridge; **S** symbolic; **M** media and code; **SP** specifications; **C** convergence. Spikes use their own ids (R0, L0, J0, X0). Decision ids use T. File paths in the "owns" column are proposals; the brief for each WP fixes them. Per-WP sizes are set when the briefs are written; sizes for FL proposals are in §11.6.

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
| SP1 | LANGUAGE.md v0.2 (§11) | `docs/LANGUAGE.md` | Gate T0 | So | Every proposal in §11.6 has a normative section and a list of conformance blocks |
| SP2 ✅ | The recipe wave v1.2: ext parameters, slots for binary operators, named inputs, pack ops, pin behaviour, and `setup` and `finish` fields in the op vector format (T22). **Deliverable: a proposal file**; RECIPES.md changes at the fold-in (RW9) | `docs/RECIPES-1.2.md` | none (it did not in fact depend on SP1) | So | Schema changes listed; §2.2 internal-vocabulary drift fixed. Done 2026-11-23: [RECIPES-1.2.md](RECIPES-1.2.md); decided T23 to T28 |
| SP3 | UI.md amendments: viewers, pack rules, CSP | `docs/UI.md` | SP1 | So | Rules 6 and 8 amendments and the `media-src` change written |
| SP4 | PACKS.md | `docs/PACKS.md` | SP1 | So | Manifest schema, discovery, init protocol, capability model |
| SP5 | SYMBOLIC.md v2 (§9.3) | `docs/SYMBOLIC.md` | SP1 | So | Decision table updated; WP table rewritten |
| SP6 ✅ | RELIX.md: pack spec, value mapping, operator table | `docs/RELIX.md` | SP1, R0 | So | Mapping table complete; naming (Q2) decided. Done 2026-11-23: [RELIX.md](RELIX.md); decided T29 to T34. Its one question for SP1 is how FL holds JSON `null` (Q14) |

**Gate T1.** The owner approves the frozen-contract changes. CLAUDE.md says `packages/*` are frozen; this plan needs an explicit version bump of FL, the recipe schema and the worker protocol.

**Gate T1 outcome (owner, 2026-11-23), for SP2 and SP6 only.** SP2: every recommended answer accepted, with FIX and ITERATE added to the format (T23 to T28). SP6: every recommended answer accepted (T29 to T34). The two conflicts between the specs are resolved for SP6 (T25, T30). **SP1, SP3, SP4 and SP5 have not been written**, so Gate T1 stays open, and so does the frozen-contract version bump for X1 and X2 (T19). The recipe format itself needs no bump (T23). Work that depends only on SP2 or SP6 may be briefed now, but nothing that changes `packages/*` starts.

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
| L12 | Codemod over the 161 `.fth` files | `packages/ops/vocab/*.fth` | L2 to L10 | So | All 4,488 vectors pass unchanged; catalogue version bumped; run at a wave boundary. Dated note (2026-11-15): the v0.2 subset of the migration is done, that is the forms available in v0.2 (typed `fail-*` words, promoted core words, shared `CHOICE:` types, `cond`/`case`, `:>`, collectors, `MEMO:`) over all 207 vocabularies. The L-E breaking fixes, generic arithmetic and the kernel tier were not part of it. |
| L13 | Move primitives to FL (the 7 + 3 + 9 made possible by L2 and L7; the cipher and hash cores only if L11 passes) | `packages/ops/prims/*`, `vocab/*` | L12, L11 | Ha | Vectors unchanged; corpus-stats report shows the change in primitive count and lines. Dated note (2026-11-14): the analysis `log2`, the coords maths, the list `sort`, `sort-by` and `shuffle`, `cmac`, `lmhash` and the `hex` primitive are now FL, and `base64` is FL with two private helpers (`_sextets`, `_unsextets`). |

L10 needs the `ext` tag (X1), so X1 is built inside Phase T2 although it appears in the T3 table; the gate for T2 covers it.

**Gate T2.** Conformance tests, op vectors, `gate2:browser` and `gate4:browser` green; the corpus-stats before/after report is attached.

### 13.5 Phase T3: pack system, extension values, data

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| X1 | `ext` tag core: registry, equality, size, text form, header `ext{kind}`. Amended 2026-11-23 ([X0 §11](research/x0-ext-values.md)): `StackSlot.kind` and `ParamSpec.kind`; process-wide idempotent registry; O(1) `sizeOf` with a per-kind test; `str` to `ext` coercion | `packages/lang/src/types.ts`, `values.ts`, `meta.ts`, plus `ext.ts` (new), `primitives.ts`, `vm.ts`, `errors.ts`, `meta.schema.json` | Gate T1 | So | v0.1 conformance unchanged; header round-trips; an `ext` value passes through `list`, `record` and `fork`; size limits apply; a module evaluated twice registers cleanly |
| X2 | `OutputValue` ext kind and viewer registry. Amended: kind-aware `fit.ts`, badges and "Data here" line; viewer contract; shadow-root rule in UI.md §4; Copy and Download per kind; contract bump with X1 | `packages/worker/src/render.ts`, `apps/web/src/io/*` | X1 | So | Unknown kinds fall back to text; DOM built without `innerHTML`; a viewer that throws does not hide the value; axe passes in three themes |
| X3 | `ext` parameters in recipe JSON, URL and UI. Amended: needs the per-step schema from X5 (`StepReport.out`, `dataInfo`); the kind parser is one module shared by worker and page (decide with P1); helper contract `check`, optional `complete`. The recipe half is RW2 (RECIPES-1.2 §18) | `packages/recipe`, `packages/ops/src/types.ts`, `apps/web/src/params/*` | X1, SP2 (done), X5, RW2 | So | An ext parameter round-trips JSON, FL and URL |
| X4 | Tagged literals | `packages/lang/src/reader.ts`, `compiler.ts` | X1 | So | Error offset points at the bad character |
| X5 | Named inputs in the bake protocol and UI: `BakeOptions.inputs`, `PROTOCOL_VERSION` 2 (T23). Amended: also a per-step schema in the bake result (`StepReport.out`, `dataInfo`; RECIPES-1.2 §7.5), which X3 needs. The worker half is RW5 | `packages/worker/src/protocol.ts`, `apps/web/src/bake/*` | SP2 (done), RW5 | So | A step can read another input tab by name; a `protocol: 1` client gets `E_PROTOCOL` |
| P1 | Pack manifest and build-time discovery | `packs/*/manifest.*`, `packages/ops/src/bundle.ts` | SP4 | So | Manifest generated and validated |
| P2 | Composite provider and baker `init` with pack ids | `packages/worker`, `packages/ops/src/bundle.ts` | P1 | So | Ids not in the manifest are refused |
| P3 | Dependency-closure loading in place of `vocabs: "all"`. Uses `opVocabs` (RW6) | `apps/web/src/bake/controller.ts`, `packages/worker` | P2, RW6 | So | Core start-up no longer loads all primitive chunks |
| P4 | Pack manager UI and IndexedDB store | `apps/web/src/packs/*` | P2 | So | Enable and disable persist per browser |
| P5 | Shared-recipe enable offer and notice. Needs `packs-needed` and `PackIndex` (RW6, T26) | `apps/web/src/*` | P4, X3, RW6 | So | Opening a recipe naming a pack op offers to enable |
| P6 | Effect labels and `RunOptions.deny` wired into the baker | `packages/lang/src/types.ts`, `packages/worker` | X1 | So | A denied capability produces a structured error |
| P7 | Per-pack size budgets in `npm run size` | size script | P1 | Ha | Budget breach fails CI |
| P8 | Demo pack with one ext kind and one viewer | `packs/demo/*` | P2, X2 | Ha | Loads lazily under production headers |
| D1 | `csv` words and the one CSV parser in core. Amended: parses straight into columns, not via a list of lists | `packages/ops/vocab/csv.fth`, `prims/csv.ts` | L3 | So | RFC 4180 vectors pass |
| D2 | `table` kind: columnar, typed, null mask. Amended: `int` column, faithful text form (null distinct from empty), honest size charge; `table` is core (Q4) | `packages/ops/src/table/*` | X1 | So | Size cost near the §2.4 columnar figure (at most 0.8 MB for numbers and 2.0 MB for 8-character strings at 10,000 by 10); equality, size, text and view tested; `table:to-json` and `table:to-csv` round-trip nulls |
| D3 | `table` words and table viewer (virtualised grid). Amended: first N rows with the total and a stated limit for 1.0; rows on demand deferred (R9) | `packages/ops/vocab/table.fth`, `apps/web/src/io/table-view.ts` | D2, X2 | So | Grid shows first N rows with total |
| D4 | Wave 1b data-format ops on `table` | `packages/ops/vocab/*` | D1, D3 | Ha | Vectors pass |

RECIPES-1.2 §18 holds ten work packages for the recipe wave, RW1 to RW10, each with a "Maps to" column naming the row here that it is part of or overlaps (RW1 and RW3 to RW8 sit under X3, X5, P3, P5 and R6; RW9 is the fold-in into RECIPES.md; RW10 is the web app's format-facing work). They are not counted again in §13.11.

**Gate T3.** A demo pack with one ext kind and one viewer loads lazily under production headers. Core start-up no longer loads all primitive chunks.

### 13.6 Phase T4: Relix pack, then the JVM bridge

| WP | Deliverable | Owns | Depends on | Agent | Done when |
|---|---|---|---|---|---|
| R1a | `relix-web` session shim: tables, limits and poll, terminals, structured diagnostics, print and normalise, `decompose`, the `fl` cache library, version string | `relix-web/shim/*` | R0, Gate T1 | So | Every entry point has JVM and browser tests; limits fire with their codes |
| R1b | `relix-web` build: patch-series check per Relix release, supplements module (the T34 random fix), ES-module wrapper, hashed artifact, size gate, NOTICE | `relix-web/scripts/*`, `patches/*`, `classlib/*` | R0 | So | A clean build from a published engine gives the module at most 3 MB gzip (T12) |
| R2a | `operators.json` and its schema (52 rows), drafted by script from `RelNode` and the reference, then completed by hand | `packs/relix/gen/operators.json` | SP6 (done) | So | All 52 rows; coverage, spelling and reference tests pass |
| R2b | Generator: `.fth` with `META:`, printer table, help source; `--check` mode | `packs/relix/gen/*.ts`, `vocab/relix-ops.fth` | R2a | Ha | Generated output committed; `gen:relix --check` in CI |
| R3 | `relation` and `relix-expr` kinds, sources (including `relix:input`, T30) and terminals | `packs/relix/vocab/*`, `src/kinds/*`, `prims/*` | R1a, R2b, X1, D2 | So | Build, `relix:run`, `explain`, `schema`, `>text`, `parse` pass vectors |
| R4 | Table-to-engine and engine-to-table interchange; implicit lift and run inserted by the compiler (T29) | `packs/relix/src/interchange/*`, compiler hook | R3, D2, SP2 (done) | So | Null mask and typed columns round-trip; the trace shows `relation -> table` |
| R5a | Tier-1 shape check module and the wrapper templates for fragments (T34) | `packs/relix/src/expr-check/*` | R1a | So | Each shape: valid samples pass, invalid ones report the right column |
| R5b | Tier-2 check through the Worker, completion from schema and catalogue, the field UI | `packs/relix/ui/*` | R5a, X3, X5 | So | A bad expression is reported at its position before the bake |
| R6 | Nested-lane UI for slots (as RELIX-LANES §11, with RW3 and RW10) | `apps/web/src/recipe/*` | SP2 (done), R3 | So | A binary operator step shows lanes; `FIX` and `ITERATE` show `base` and `step`; e2e passes |
| R7a | "View as Relix", both spellings, include-data option with a 200-row cap (T34) | `packs/relix/src/view/*` | R1a, R3 | So | Golden texts; the lost-content list is shown |
| R7b | `.relix` import with the statement check and binding dialog | `packs/relix/src/import/*` | R7a | So | Recipe to text to recipe is the identity on supported steps |
| R8 | Per-step schema and on-demand row counts (T34) | `packs/relix/ui/*` | R3, X5 | Ha | Schema on every Relix step; a count on request |
| R9a | `fl` exposure rules, names (T32), value mapping both ways | `packs/relix/src/fl-bridge/map.ts`, `exposure.ts` | R1a, R4 | So | Property tests pass; the exposure report lists every excluded op and why |
| R9b | Discover, batch, replay loop; FL errors; limits | `packs/relix/src/fl-bridge/batch.ts` | R9a | So | A query over 10,000 rows calls an FL op once per distinct value |
| R10 | Help from `relix-docs` | `relix-web/scripts/reference.*`, `packs/relix/gen/help-*.ts` | R2b | Ha | Help text comes from the reference pages |
| R11 | Conformance harness: reference examples against the browser engine, with an expected-differences gate | `relix-web/harness/*`, `packs/relix/test/*` | R1a, R1b, SP2 (done) | Ha | Pass rate reported against T12; a change in the differences list fails the job |
| R13 | Pack manifest and budget, lazy load in the bake Worker, cancellation wiring (shared flag, poll, deadline), `needsHardKill` for engine-running words | `packs/relix/manifest.*`, `packages/worker` hook | R1a, P2 | So | Cancellation tests pass; the pack loads lazily under the production headers |
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
 T1 specs:   SP1 -> SP3 SP4 SP5 ; SP2 SP6 done  [Gate T1: owner]
                         |
 T2 FL v0.2:  L2..L10 (+X1) -> L12 (wave boundary) -> L13
                         |  (L11 only if L0 passed)
 T3 packs:    X1 -> X2 X3 X4 X5 ; P1 -> P2 -> P3 P4 P5 ; D1 D2 -> D3 -> D4
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

- The four spikes: R0, L0, J0, X0.
- Drafts of the specifications SP1, SP3, SP4 and SP5. SP2 and SP6 are written and decided at Gate T1 (T23 to T34).
- L1, the corpus-stats scripts, which change no contract.

**Scheduling rule.** The L12 sweep runs at a wave boundary. The remaining core waves from PLAN.md (wave 1b data formats, now depending on D; wave 6 compression; wave 7 public key, networking, forensics) run in parallel throughout, but no op work package may be in flight while L12 runs.

**Count.** The tables hold 75 work packages (13 + 17 + 22 + 10 + 9 + 4), plus 4 spikes and 6 specifications. The Phase T4 count went from 16 to 22: R12 is dropped, five rows split and R13 and R14 are new (18 R-rows and 4 J-rows). The RW packages of RECIPES-1.2 §18 overlap rows of Phase T3 and T4 and are not counted again. Several are conditional (L11, L13 in part, J2 to J4). The Phase T3 and T4 tables can be merged in pairs if coarser packages are preferred.

---

## 14. Risks and open questions

### 14.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | R0 fails, or the chunk is too large | Fallback engine (§8.5), reduced to core operators; or a local engine later. **Retired 2026-11-23:** R0 passed at 1.33 MB gzip (T9). What remains is the patch fork and TeaVM stability ([R0](research/r0-relix-in-browser.md) §11) |
| 2 | `BigDecimal`, time and regex behaviour diverge between the compiled engine and the JVM | The reference-example corpus is the gate (R0 criterion 3); R11. **Reduced 2026-11-23:** all 63 decimal, 38 date/time and 10 regex examples agree. Collation and seeded random differ (T11) |
| 3 | Sync engine against async FL | Batch hoisting outside the engine; R0 tests it. **Resolved 2026-11-23:** synchronous callbacks with batching (T14) |
| 4 | L0 fails, so goal 5 is capped at roughly the current FL share for crypto | The plan says so (§11.3); the 53 cores stay TypeScript |
| 5 | The breaking v0.2 migration churns parallel op work | One sweep at a wave boundary (L12); no op WPs in flight |
| 6 | Frozen-contract changes in `packages/*` | Explicit version bump at Gate T1. X0 confirmed that X1 and X2 are source-breaking and belong in that bump (T19) |
| 7 | The Relix 1.0 freeze delays engine-side asks | Asks (Q1) are scheduled after 1.0 unless the owner pulls them in; the pack works from the published jar |
| 8 | CSP relaxation for media | Limited to `media-src blob:`; owner-approved; media pack only |
| 9 | Scope: this is several products | Phase gates; packs optional and independent after T3 |
| 10 | GraalJS constraints (start-up, missing browser APIs, licence) | J0 measures; J4 lists degraded ops |
| 11 | Table memory under the allocation meter | Columnar representation; propose a live-size meter or structural sharing for tables |
| 12 | A catalogue that depends on which packs are enabled: `catalogue-mismatch` would fire for every reader with a different set of packs on, and a recipe could name an op the reader's catalogue lacks | The validator skips `catalogue-mismatch` for a recipe with a pack op and `encodeShare` omits `catalogue` for it; `pack-not-enabled` and `packs-needed` say what is missing (T26; RECIPES-1.2 §8.5) |

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
| Q14 | How does FL hold JSON `null`? It decides how nested NULLs (a struct field or array element) cross the Relix bridge; until SP1 decides, the bridge refuses them with `E_COERCE` ([RELIX.md](RELIX.md) §5.4, §16 item 13). Raised by SP6; for SP1. |
| Q15 | Which version bump covers the frozen contracts at Gate T1: FL, the worker protocol and the X1 and X2 contract (T19)? The recipe format needs none (T23); the worker protocol goes to 2 (T23). Open until SP1, SP3, SP4 and SP5 are written. |

---

## 15. Relationship to other documents

- **PLAN.md.** The Phase 6 line "Relix vocabulary integration as an `relix:` vocab of primitives" is superseded by this plan. PLAN §9 gains the decisions T1 to T8 once approved; items 14 and 15 of PLAN §9 point to T9 to T22 and T23 onwards.
- **SYMBOLIC.md.** Superseded in part: S2, S3, S5, S6 and S7 (§9.3). S8 to S14, S20 and S21 stand. A v2 is written in WP SP5.
- **LANGUAGE.md.** A v0.2 is written in WP SP1.
- **RECIPES.md.** The recipe wave is specified in [RECIPES-1.2.md](RECIPES-1.2.md) (WP SP2, decided T23 to T28). RECIPES.md changes at the fold-in (RW9). The §2.2 internal-vocabulary drift (two named, eight in `INTERNAL_VOCABS`) is fixed.
- **RECIPES-1.2.md.** The proposal for v1.2 of the recipe format: ext parameters, slots, named inputs, pack ops, pins, vectors, share links and the bake protocol. Its work packages are RW1 to RW10 (§18).
- **UI.md.** Amended in WP SP3 (rules 6 and 8, the CSP, viewers and pack rules).
- **RELIX.md.** The Relix pack specification (WP SP6, decided T29 to T34): value kinds, the `relix:` vocabulary, the operator table, the value mapping, the `fl` library, errors, limits, help and tests. Its work packages refine §13.6.
- **New documents.** PACKS.md (SP4), not yet written.
- **RELIX-LANES.md.** Design proposal for binary Relix operators in the recipe pane (lanes, slots, Tree view, recipe JSON for slots). It elaborates §8.2 and refines WP R6.
