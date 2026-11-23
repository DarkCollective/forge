# R0: the Relix engine in a browser Worker (TeaVM)

Status: result of spike R0 (TOOLKIT section 13.2) for the owner's Gate T0 decision. The spike code is throwaway and lives outside this repository (section 12). Nothing here changes Forge. The thresholds are the provisional ones of TOOLKIT section 8.3 (Q7 is not yet answered), and every raw measurement is next to its verdict so you can judge with other thresholds.

## 1. Summary

**Verdict: go with conditions.** The Relix engine (Java 21, 590 source files, 17 modules) compiles to JavaScript with TeaVM 0.17.0 and runs in a Web Worker under Forge's production headers. 241 of the 248 self-contained reference examples (97.2%) return exactly the rows the JVM returns. All 63 decimal, 38 date/time and 10 regex examples agree. There was no CSP violation. The lazy chunk is 1.33 MB gzip. Cold start is about 1.1 s. A 10,000-row join takes 0.23 s and a 10,000-row group-by 0.23 to 0.33 s. Terminating the Worker cancels, and a small engine hook makes cooperative cancellation work. A JavaScript function called from a query works.

The conditions:

1. **Five small engine patches** (52 lines added, 38 removed, six files) are needed before TeaVM accepts the code, and TeaVM's own class library needs five supplements or fixes (section 5). None of this is blocked, but it is a maintained fork of build glue until the changes are upstreamed. The Relix 1.0 freeze (TOOLKIT section 2.6) means they wait for a minor release.
2. **Use the JavaScript backend, not WebAssembly.** The Wasm GC backend compiles the same engine and is two to three times faster (cold start 0.39 s, 10,000-row join 0.09 s), but TeaVM 0.17.0's Wasm runtime builds functions with `new Function`. That is refused by Forge's CSP (`script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-eval'`). The JavaScript backend uses no `eval` at all.
3. **Four behaviours differ from the JVM** and need an owner decision or a follow-up fix: locale collations (`COLLATE 'en-US'`) are not available, seeded `ROLL` and `SHUFFLE` draw a different sequence, hashing and `sqrt` are our own code, and the engine version string is missing (section 6).
4. **A JavaScript callback must be synchronous** unless the owner accepts a 51% larger build. The FL VM is async; the bridge should batch (section 8.4 of TOOLKIT, answered in section 9 below).

## 2. The eight criteria

Machine: a container with 4 vCPU (Intel Xeon at 2.10 GHz, 15 GB), Linux, headless Chromium 157 through Playwright 1.63, Node 22.23. Timings are medians of five runs in one Worker unless noted; cold start is the median of seven fresh browser contexts. The browser loads from loopback, so network time is not in any figure.

| # | Criterion | Result | Measurement and notes |
|---|---|---|---|
| 1 | Compiles without engine source changes, or with changes small enough to upstream | **Pass, with conditions** | The unmodified engine compiles with `javac` (Java 21) and runs on the JVM. TeaVM needs 5 patches: 6 files, 52 lines added, 38 removed. Four of them are mechanical; one (0001) removes locale collations and needs a design choice before it can go upstream. One optional sixth patch (7 lines) adds the cancellation hook. Details in section 5. |
| 2 | At least 95% of self-contained reference examples give identical rows | **Pass** | 241 of 248 = **97.2%** (threshold 95%). Counting the 49 documented-error examples too: 290 of 297 = 97.6%. The reference is the JVM running the unpatched engine through the same shim. |
| 3 | All `BigDecimal`, date/time and regex cases agree | **Pass** | Decimal 63 of 63, date/time 38 of 38, regex 10 of 10 (classes picked by keyword, section 6). The seven differences are in other areas: one locale collation, two seeded random draws, four version strings. |
| 4 | No CSP violation under the production headers | **Pass (JS backend)** | 0 violations and 0 console errors over the 380-example run and the benchmarks, with the CSP from `infra/site.tf` and COOP and COEP as in `serve-prod.mjs`. A control (`new Function` in the Worker) is blocked and reported, so the detector works. **Fails for the Wasm GC backend** (section 8). |
| 5 | Lazy chunk at most 3 MB gzip | **Pass** | `relix.js`: 6.15 MB raw, **1.33 MB gzip** (level 9), 0.84 MB brotli. The 3 MB limit leaves 2.2x headroom. |
| 6 | Cold start at most 2 s; 10,000-row group or join at most 1 s | **Pass** | Cold start (new Worker, load and first query): **1.07 s** median (load 0.50 s, first query 0.57 s), range 1.03 to 1.15 s. 10,000-row join returning 10,000 rows: **0.23 s**; join then count and sum: 0.38 s; group-by with 1,000 groups: 0.23 s; group-by with 10,000 groups: 0.33 s. These times include building the table from JSON on every call (a bare count over the table takes 0.11 s). For scale, the JVM on the same machine, warm: 0.03 to 0.12 s. |
| 7 | Cancellation works (terminate or cooperative) | **Pass** | Terminating the Worker returns at once (0.07 ms) and a new Worker answers its first query after 0.6 s. Cooperative cancellation through a `SharedArrayBuffer` flag stops a running 10-million-pair query **1 to 5 ms** after the flag is set, and the Worker stays usable. It needs the optional patch 0006; without it the poll sees the flag only when a source is read (about 2 s late on that query). The page is `crossOriginIsolated`, so `SharedArrayBuffer` is available. |
| 8 | A JavaScript callback from a `StrictScalarFunction` works | **Pass** | A shim function registered by name calls `self.relixHost` in the Worker. A query that calls it on 10,000 rows takes 0.24 s, against 0.19 s for the same query with a built-in expression (about 5 microseconds a call). NULL in gives NULL out without a call (strict). A JavaScript exception comes back as a query error and the Worker stays usable. |

## 3. Toolchain and versions

| Item | Version |
|---|---|
| Engine | `relix-core` at commit `1758be6` (1.0.0-rc13), read-only, copied before building. The original was not touched. |
| Java | OpenJDK 21.0.13 |
| TeaVM | 0.17.0 (`org.teavm` Gradle plugin, `teavm-classlib`, `teavm-jso`, `teavm-jso-apis`), the latest release on Maven Central |
| Gradle | 8.14.3 (the spike's own project, heap 6 GB; TeaVM needs more than the 512 MB default) |
| Browser | Headless Chromium 157.0.8103.78, Playwright 1.63.0, Node 22.23.5 |

Engine assembly: modules `ast`, `value`, `symbol`, `function`, `lang-ast`, `events`, `json`, `provenance`, `solver`, `semantic`, `cost`, `plan`, `optimizer`, `processor`, `parser`, `lang`, `function-builtin`. Left out: `relix-embed`, `relix-connectors-std`, `relix-solver-ojalgo`, `relix-mongo-connector`, `relix-dist` and `relix-docs`. The engine was compiled with `javac --module-source-path`, not with the engine's Gradle build, because Gradle answered HTTP 429 on a build plugin from Maven Central through the proxy. This took the engine's own build and publish task out of the test. The shim consumes class directories, not the published jar, so the "consume the published jar" rule of TOOLKIT 8.3 is not yet tested.

The shim (`RelixCore`, 307 lines of plain Java, no JSO) wires the pipeline itself: `ScriptParser.parse`, then `SemanticAnalyzer` with `FunctionCatalog.of(BuiltinFunctionLibrary, host library)`, then `QueryOptimizer`, then `QueryExecutor.executeOptimized` over a `GeneratorRegistry` that holds the in-memory tables. The entry point is `run(queryText, tablesJson, hostFnsJson) -> resultJson`, with `{"ok":true,"results":[...]}` or `{"ok":false,"error":"..."}`. Each cell is encoded as a tagged string (`N:200`, `S:east`, `D:2024-01-31`, `null`), so exact scale and type are compared. A 54-line TeaVM class (`Main`) puts it on the Worker scope. The same `RelixCore` runs on the JVM for the reference.

## 4. What failed in TeaVM, and what fixed it

Language features were not a problem. Records, sealed interfaces, pattern switches, nested generics and lambdas in 590 files all compiled, with no warnings about unsupported bytecode. `ServiceLoader` is not used (`FunctionCatalog.of`). There is no reflection on the path. What failed was the Java class library, in three kinds.

**Compile-time: a class or method is missing** (TeaVM reports each reachable use, even when it is never called at run time):

| Missing | Used for | Fix | Size |
|---|---|---|---|
| `java.util.StringJoiner` | SQL and Mongo pushdown text | Supplement class (45 lines) | S |
| `java.util.Spliterators.AbstractSpliterator` | row-stream wrappers (cancellation, budgets) | Supplement class | S |
| `java.util.HexFormat` | hash output, collation key | Supplement class (lowercase subset) | S |
| `java.security.MessageDigest` | `MD5`, `SHA1`, `SHA2`, `HASHBYTES` | Supplement class: pure-Java MD5, SHA-1, SHA-224/256/384/512 (170 lines). Agrees with the JVM on the probes (below). | S, but it is crypto code we now own |
| `BigDecimal.sqrt(MathContext)` | `STDDEV`, `VARIANCE` family | Engine patch 0003: Newton's method at 10 guard digits, one rounding. Agrees with the JVM on the probes (below); it is not proven identical to the JDK in the last digit for all inputs. | S |
| `LocalDate.ofInstant`, `LocalTime.ofInstant` | date and time functions | Engine patch 0002: `LocalDateTime.ofInstant(...).toLocalDate()` and `.toLocalTime()`. Same result. | S |
| `Class.getModule`, `Package.getImplementationVersion` | component version listing | Engine patch 0004: version is "unknown" | S |
| `Locale.forLanguageTag`, `java.text.Collator` | `COLLATE 'en-US'` | Engine patch 0001: locale collations are dropped; `BINARY` and `NOCASE` stay. `Intl.Collator` through the host callback would restore them. | M |
| `Arrays.compare(int[], int[])` | `BINARY` collation | Engine patch 0001 (a loop) | S |

**Run-time: the class exists but behaves differently:**

| Behaviour | Effect | Fix | Size |
|---|---|---|---|
| Regex `\R` (linebreak) is not supported in TeaVM's `Pattern` | Every inline table failed to parse | Engine patch 0005: three `split("\\R")` calls become an explicit alternation | S |
| **`TSimpleStreamSpliterator.tryAdvance` returns true when the stream is exhausted** (a TeaVM 0.17.0 bug) | A caller that loops on `Stream.spliterator()` sees an extra null element. Every blocking operator (group, sort, join) failed with a null row. | Replaced the class on the TeaVM classpath with a corrected copy (60 lines). The file is a modified copy of TeaVM code under Apache-2.0: its header (Copyright 2017 Alexey Andreev) is kept, with a modification notice, and the attribution is in `relix-web`'s `NOTICE`. The fix should still be reported upstream to TeaVM. | S |
| `java.util.Random(seed)` is not the JDK's generator | Seeded `ROLL` and `SHUFFLE` give different values (2 corpus examples) | Not fixed. A supplement with the JDK's 48-bit LCG and its bounded-draw methods would do it. | S to M |
| Resources are not packaged | `version.properties` is absent, so the engine version shows "unknown" (4 corpus examples differ, harmless) | Pass the version through the shim | S |

**Optional, for behaviour rather than compilation:** patch 0006 adds a `pollHook` to `QueryCancellation.check()` (see criterion 7).

The patches are in `patches/` in `relix-web`. They apply to the 1.0.0-rc13 tree. Totals: 0001 Collations (16 added, 21 removed), 0002 DateTimeFunctions (7, 7), 0003 StatisticalAggregates (24, 1), 0004 ComponentInventory (2, 6), 0005 ScriptParser and ParseException (3, 3), 0006 QueryCancellation (7, 1).

**The corpus hardly touches the supplements.** It holds one hash example and no variance or standard-deviation example. So I added eight probe scripts (`harness/extra_probes.js`): `STDDEV`, `VARIANCE`, the `_POP` and `_SAMP` forms (including a 9-digit fraction and a zero spread), `MD5`, `SHA1`, `SHA256` and `SHA2` with 224, 384 and 512 bits over empty, ASCII and non-ASCII text, and decimal division, multiplication, `ROUND` and `%` with a 30-digit operand. All 8 gave the same result string as the unpatched JVM. Eight scripts is a smoke test, not coverage.

The unpatched engine on the JVM and the patched engine on the JVM give the same rows on all but one example (`language/collate.md#2`, the locale collation). So the patches themselves do not change behaviour except patch 0001.

## 5. The corpus: method and results

**Source.** `docs/reference` in the engine: 265 Markdown pages. A script reads each page's fenced blocks in order. A `relix` block that holds a `query` is a candidate example; a `relix-invalid` block is an example the engine must refuse. The block after a `relix` block, if it is plain, is the documented output (kept in the data, not used in the comparison).

**Context.** Pages build up tables across blocks, so a block runs as the earlier blocks of the page that ran cleanly plus the block. If that fails, the block runs alone. The JVM decides which form is used, and the browser receives the same script text.

**Reference.** The JVM, with the unpatched engine, through the same `RelixCore`. Each example ran twice on the JVM; none was non-deterministic.

**Comparison.** The result JSON string must be identical (same rows in the same order, same column names, same types, same decimal scale). For documented-error examples, both sides must refuse with the same message.

**Counts.**

| Class | Count |
|---|---|
| Blocks read | 483 (136 pages) |
| Examples (a query, or an invalid block) | 380 |
| Excluded: the reference itself cannot run them | 83 |
| Valid, self-contained, run in the browser | **248** |
| Identical | **241 (97.2%)** |
| Documented-error examples | 49, all refused with the same message |

The 83 exclusions are not engine failures. The JVM shim cannot run them either: 57 need a database, file, HTTP or other connector (outside the assembly by design), 21 are fragments whose tables or syntax come from text outside the page's blocks, 3 are refused by the engine on the JVM too (unbounded relation, runaway fixpoint), and 2 need the ojAlgo solver. If the owner wants the connector examples back, the answer is the in-memory sources, not the engine.

**Criterion 3, the three classes** (a valid example is in a class when its script holds one of the listed keywords; one script can be in several):

| Class | Keywords (examples) | Identical |
|---|---|---|
| Decimal | `SUM`, `AVG`, `ROUND`, `STDDEV`, `VARIANCE`, `MEDIAN`, `CAST`, decimal literals, `/` | 63 of 63 |
| Date and time | `DATE`, `TIMESTAMP`, `INTERVAL`, `YEAR`, `EXTRACT`, ISO dates | 38 of 38 |
| Regex | `REGEXP`, `MATCHES`, `LIKE`, `REPLACE`, `SPLIT` | 10 of 10 |

**The seven differences:**

| Examples | Cause |
|---|---|
| `language/collate.md#2` | `COLLATE 'en-US'` refused in the browser (patch 0001; no `Collator`). Real feature gap. |
| `operators/roll.md#1`, `operators/shuffle.md#1` | Seeded random draws differ (TeaVM `Random`). Real gap, deterministic by design in Relix. |
| `language/introspection-version.md#1` to `#4` | The engine version shows "unknown" (resource not packaged). Harmless. |

## 6. CSP

The page and the Worker are served by a small server that sends the headers of `apps/web/scripts/serve-prod.mjs`: the CSP of `infra/site.tf` (`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; ... connect-src 'self'`), COOP `same-origin`, COEP `require-corp`, CORP `same-origin`. The Worker is a classic Worker that calls `importScripts('/relix.js')`. The page has no inline script. The generated JavaScript has no `eval`, no `new Function`, and loads nothing else. Violations are listened for in both the page and the Worker (`securitypolicyviolation`) and through the console.

Result for the JavaScript backend: none, over the 380 examples, the benchmarks, the host callbacks and the cancellation tests. The positive control (`new Function('return 1')` in the Worker) throws `EvalError` and raises one `script-src` violation.

## 7. Measurements

**Size.** JavaScript backend: 6.15 MB raw, 1.33 MB gzip, 0.84 MB brotli (obfuscated, aggressive optimisation). Wasm GC: 6.73 MB raw, 1.68 MB gzip, 0.99 MB brotli. The async JavaScript build: 19.2 MB raw, 2.0 MB gzip, 1.26 MB brotli (section 9). The compile takes about one minute.

**Cold start** (JavaScript): `importScripts` and parse 0.50 s, engine start 0.01 s, first query 0.57 s (class initialisation inside the engine). The second query of the same Worker takes 0.02 to 0.03 s. Browsers cache compiled code for repeat visits, so a warm start will be shorter; that was not measured.

**10,000 rows** (JavaScript backend, per call, medians): the Orders table has 10,000 rows and Customers 10,000 or 1,000.

| Query | JavaScript | Wasm GC (relaxed CSP) | JVM, warm |
|---|---|---|---|
| Join, 10,000 result rows | 229 ms | 88 ms | 52 ms |
| Join then count and sum | 376 ms | 130 ms | 121 ms |
| Group by, 1,000 groups | 226 ms | 58 ms | 25 ms |
| Group by, 10,000 groups | 329 ms | 144 ms | 38 ms |
| Bare count over the table | 108 ms | 42 ms | 16 ms |

Each call includes parsing the table JSON and building the rows. A real integration would register tables once and query many times, which removes most of the bare-count time.

**Memory** was not measured.

## 8. WebAssembly

TeaVM's Wasm GC backend compiled the same engine with the same patches and supplements, with no new missing classes. In Chromium, with `'unsafe-eval'` added to the CSP for the experiment only, it passed the same 241 of 248 examples (and one documented-error message differs: `language/inline-table.md#4`, a different error text for a malformed header, which the JavaScript build matches). Cold start was 0.39 s and the join 0.09 s.

Under the production CSP it does not start. `wasm-gc-runtime.js` builds functions with `new Function` at about ten places (global lookup, the JSO function wrappers, constructor naming, `createFunction` and `callFunction`). A build with no JSO in our code fails the same way, because the runtime itself needs them. Fixing it means forking the 40 KB runtime to use closures instead (estimate M), or waiting for TeaVM. `'wasm-unsafe-eval'` in the CSP is for `WebAssembly.compile` and does not cover this. We should not relax the CSP for the sake of this. Recommendation: ship JavaScript, re-test Wasm GC when a TeaVM release fixes the runtime, and treat it as a speed-up of about 2.5x, not a requirement.

## 9. Sync against async (TOOLKIT section 8.4)

TeaVM supports it, at a price. With `asyncEnabled` and an `@Async` native method, a JavaScript function that answers later (through a callback) can be awaited from inside a Relix scalar function. The engine runs in a TeaVM green thread, and TeaVM transforms every method between the thread and the async call into a state machine. I built this variant (`MainAsync`) and ran it:

| | Sync build | Async build |
|---|---|---|
| Size | 6.15 MB, 1.33 MB gzip | 19.2 MB, 2.0 MB gzip (+51%) |
| Count and sum over 10,000 rows (Node) | 169 ms | 240 ms |
| Group by 1,000 groups (Node) | 310 ms | 322 ms |
| 10,000 async host calls answered on a microtask | | 361 ms |
| 10,000 async host calls answered with `setTimeout(0)` | | 11.9 s |

The async call works (tested in Node, not in a Worker), and the event loop runs between calls. The cost is the larger chunk, slower code (up to 40% on the queries I compared), and per-call round trips: a call that waits for a timer or a message costs one event-loop turn, so 10,000 rows cannot take one call each. The FL VM must therefore batch regardless: a word mapped over a column should be one call, as TOOLKIT section 8.4 already says ("Batch first"). With batching, a synchronous callback is enough if the batch is computed before the engine runs (the planner hoists the FL-function columns), and the async build is not needed. The synchronous callback used in criterion 8 works with no TeaVM async support.

## 10. Alternates

GraalVM web-image and J2CL were not assessed, because TeaVM worked. CheerpJ stays excluded.

## 11. Risks

1. **A fork of build glue.** Five engine patches and five class-library supplements must follow every Relix and TeaVM release. Mitigation: upstream the patches after 1.0; report the `tryAdvance` bug to TeaVM; keep the corpus gate in CI so a regression shows at once.
2. **Silent behaviour drift.** The TeaVM class library is not the JDK. Two real differences (the `tryAdvance` bug, the seeded generator) were found only because the corpus compares rows exactly. Areas the corpus covers thinly (hashing, variance, locale-sensitive formatting, similarity functions) can drift without a test. The corpus is 248 examples; it covers the documented operators, not every function argument.
3. **Own crypto code.** The pure-Java digests are ours. Forge already has hashing in FL (the owner may prefer to route `MD5` and `SHA*` to it through the host callback and drop the supplement).
4. **TeaVM stability.** The engine hit a library bug that broke all blocking operators until it was found. Other latent bugs are possible. TeaVM is maintained mainly by one person.
5. **Single-threaded cancellation.** Cooperative cancellation needs patch 0006, or it only triggers while sources are read. Terminate works without any patch.
6. **Chunk growth.** The engine is 1.33 MB gzip now. A query builder, the FL bridge and a tokenised error layer will add to it. The 3 MB threshold has room, but not unlimited room.
7. **One browser tested.** Chromium only. TeaVM JavaScript is plain ES2015, so Firefox and Safari should work, but they were not run. Wasm GC support differs across browsers.
8. **Published jar.** The spike builds from sources. Whether the published `relix` jar (assembled by `relix-dist`, with its own `module-info`) feeds TeaVM the same way was not tested.

## 12. Recommendation for Gate T0

**Go on the JavaScript backend, with the conditions of section 1.** The result clears all eight criteria at the provisional thresholds, and most with wide margins (size 44% of the limit, cold start 54%, a 10,000-row join 23% to 38%). The fallback of TOOLKIT section 8.5, a second TypeScript engine, is not needed for the core, and it would conflict with goal 6. The decisions for the owner:

1. **Accept the patch set** (five engine patches, one optional) and the plan to upstream it after the 1.0 freeze, or ask Relix to take the small ones now (0002 and 0005 change no behaviour; 0003 needs a numerics review; 0001 needs a choice between dropping locale collations in the browser or restoring them through `Intl.Collator`; 0004 as written drops version detection on the JVM too, so upstream it as a guarded call).
2. **Decide on locale collation and seeded random.** Either accept the two differences and document them as "browser build" limits, or fund the fixes (an `Intl.Collator` bridge: M; a JDK-compatible `Random`: S to M).
3. **Q7: confirm or change the thresholds.** The figures above leave room for tighter ones: cold start 1.07 s, 10,000-row join 0.23 s, 1.33 MB.
4. **Q9: exotic operators.** `OPTIMIZE` and `COVER EXACT` need the ojAlgo solver and are out. `SOLVE`, `ROLL` and `SHUFFLE` run, with the seeded-random caveat.
5. **Synchronous host callbacks only,** with batching in the FL bridge, or accept the +51% async build. I recommend synchronous.
6. **Wasm GC is a later optimisation,** not part of this decision.

## 13. What the follow-up work packages need

1. **`relix-web` repository (Q11).** Move the shim out of the spike, consume the published `relix` jar (re-test it with TeaVM), and keep the engine patches as a patch series with a CI check that they apply to each Relix release. Own the supplements in one small module.
2. **A permanent corpus gate.** The extractor, the JVM reference run and the browser run as a CI job. Fail under 95% identical, and fail on any change in the list of differences.
3. **Engine upstream work (after 1.0).** Patches 0002, 0004 and 0005 as they are; 0003 with a numerics test; 0001 with a feature switch; 0006 as a documented host poll. Ask for two engine facilities the builder needs anyway (`query-builder.md`): a Value to JSON writer, and span ends.
4. **Session API.** The spike runs a whole script and builds its tables on every call. The product needs a session: register tables once (columns as typed arrays, not JSON), prepare, run, page results, and return structured values (the tagged-string cells are a stand-in for the Q3 decision on NULL and bytes).
5. **Host function bridge.** Register FL words as scalar functions from a name and type list (done in the spike for scalars), map a word over a column in one call, and decide NULL and bytes handling.
6. **Cancellation.** A `SharedArrayBuffer` flag plus patch 0006, with terminate as the fallback when the page is not cross-origin isolated.
7. **Packaging for Forge.** A hashed lazy chunk under `/assets/`, loaded by a classic Worker through `importScripts`, or a module Worker after wrapping the UMD output. Add the size to the `npm run size` budget. Check the CSP and COEP headers through `serve-prod.mjs` in the e2e suite.
8. **Fix list.** `Collator` through `Intl.Collator`, a JDK-compatible `Random`, the version string, hash functions routed through FL or kept as supplements, and a report to TeaVM for `TSimpleStreamSpliterator`.
9. **Wasm GC re-test** when TeaVM drops `new Function` from its runtime.

## 14. Where the spike code is, and how to rebuild it

The spike code is in the private repository `DarkCollective/relix-web` (https://github.com/DarkCollective/relix-web), branch `main`, commit `375a2ec`. Clone it and run the commands below from its root. The README lists the layout. The engine is read from a `relix-core` checkout (see the README for the path). The short form:

    scripts/build-all.sh                  # patched engine, supplements, TeaVM JavaScript
    node harness/browser_corpus.js        # 380 examples in headless Chromium
    python3 -I harness/compare.py         # criteria 2 and 3
    node harness/browser_bench.js         # criteria 4 to 8

Generated directories (`engine-build/`, `out/`, `shim/build/`) are not committed. Corpus data and results (`corpus/*.json`) are.
