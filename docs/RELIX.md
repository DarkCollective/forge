# The Relix pack: specification (pack, value mapping, operator table)

Status: draft v1 (2026-11-23). A proposal for the owner to approve at Gate T1, not normative. It builds on [TOOLKIT.md](TOOLKIT.md) (§1 goals, §2.6 Relix facts, §3 decisions T1 to T22, §4 to §8, §12 one implementation per capability, §13 work packages, §14 open questions), the Gate T0 results [r0-relix-in-browser.md](research/r0-relix-in-browser.md) and [x0-ext-values.md](research/x0-ext-values.md), [RELIX-LANES.md](RELIX-LANES.md) (binary operators in the recipe pane), [RECIPES.md](RECIPES.md) (§2 catalogue, §8 bake limits and cancellation, §9 op vectors) and [LANGUAGE.md](LANGUAGE.md) (`META:`, parameter types, errors). Relix facts come from the `relix-core` source tree at commit `1758be6` (1.0.0-rc13), read-only, and from the R0 spike code in `DarkCollective/relix-web`. This is work package SP6 of TOOLKIT §13.3.

> **Packages are frozen.** `packages/*` hold frozen Phase 1 to 2 contracts (CLAUDE.md). This document asks for changes to them (the `ext` tag, the worker protocol, the recipe format, the catalogue). None of those changes starts before the owner approves the version bump at Gate T1. Where a change belongs to another specification (SP1 to SP5), this document names it and does not define it. In particular, **the recipe JSON for slots is SP2's** (`docs/RECIPES-1.2.md` or `RECIPES-2.0.md`), and this document does not define it.

> **Estimates are marked.** Every figure that comes from a file is cited. A figure that is a proposal or an estimate says so. Work package sizes are relative (S, M, L). There are no calendar dates in the work package plan.

> **Notation.** In stack effects, `relation`, `table` and `expr` stand for `ext{relation}`, `ext{table}` and `ext{relix-expr}` (X0 §3.3). "The engine" is `relix-core` compiled as `relix-web` (§1.3). "The reference" is `docs/reference` in `relix-core`.

## Contents

1. Scope and architecture
2. Value kinds: `table`, `relation`, `relix-expr`
3. The `relix:` vocabulary
4. The operator table
5. The value mapping
6. FL from Relix: the `fl` function library
7. Errors
8. Limits and cancellation
9. "View as Relix" and import
10. Help text
11. Security
12. Testing
13. Decisions
14. Open questions
15. Work packages
16. Changes needed in other documents

---

## 1. Scope and architecture

### 1.1 What the pack is

The `relix` pack is a first-party Forge pack (TOOLKIT §5, T7). It adds:

- the extension value kinds `relation` and `relix-expr` (the kind `table` is core, T21);
- a vocabulary `relix` of FL words that build, inspect and run relational queries;
- the Relix engine, compiled to JavaScript and loaded lazily in the bake Worker;
- the `fl` function library, which lets Relix queries call Forge ops (§6);
- viewers and parameter helpers for its kinds.

It has three faces of one thing (TOOLKIT §8): value-level words (this document, §3), recipe steps and nested lanes (RELIX-LANES and SP2), and the engine (§1.3).

### 1.2 Architecture

```
  recipe steps / FL console
        |   relix: words build values (lazily, no engine work)
        v
  +--------------------+      +-----------------------------+
  | ext{relation}      |      | ext{relix-expr}             |
  | tree of nodes,     |<-----| text of one clause,         |
  | leaves are tables  |      | syntax-checked by the engine|
  +---------+----------+      +-----------------------------+
            | terminal word, or implicit run (§2.4)
            v
  +-----------------------------------------------------------+
  | session (TypeScript, in the bake Worker)                  |
  |  print Relix text -> register tables -> engine call       |
  |  FL batch loop: discover, batch, replay (§6.5)            |
  |  result -> ext{table}                                     |
  +-------------------------+---------------------------------+
                            | synchronous calls, no eval
  +-------------------------v---------------------------------+
  | relix-web chunk (TeaVM JavaScript, lazy ES module)        |
  |  parse -> analyse -> optimise -> plan -> execute          |
  |  in-memory sources, fl library (cache-backed), poll hook  |
  +-----------------------------------------------------------+
```

The engine and the FL VM never call each other while a query runs. The session calls the engine, reads what FL values are missing, runs one FL batch, and calls the engine again (§6.5). This is how a synchronous engine works with an asynchronous VM (T14).

### 1.3 The engine build (T9 to T15)

| Item | Fact | Source |
|---|---|---|
| Compiler | TeaVM 0.17.0, JavaScript backend. The Wasm GC backend is a later optimisation (T15) because TeaVM's Wasm runtime uses `new Function`, which Forge's CSP forbids. | T9, T15; R0 §8 |
| Assembly | Engine modules `ast value symbol function lang-ast events json provenance solver semantic cost plan optimizer processor parser lang function-builtin`. Left out: `relix-embed`, `relix-connectors-std`, `relix-solver-ojalgo`, `relix-mongo-connector`, `relix-dist`, `relix-docs`. | R0 §3 |
| Patch set | Five engine patches (0001 to 0005) and the optional cancellation patch 0006, kept as a series in `relix-web` and upstreamed after the Relix 1.0 freeze. Five class-library supplements (`StringJoiner`, `HexFormat`, `Spliterators.AbstractSpliterator`, `MessageDigest`, and a corrected `TSimpleStreamSpliterator`). | T10; R0 §4 |
| Size and speed | 6.15 MB raw, 1.33 MB gzip. Cold start 1.07 s (load 0.50 s, first query 0.57 s). A 10,000-row join 0.23 s. All measured on one machine with one browser (Chromium). | R0 §2, §7 |
| Thresholds | At least 95% of examples identical, at most 3 MB gzip, cold start at most 2 s, a 10,000-row join or group at most 1 s. | T12 |
| Browser limits | No locale collation (`COLLATE 'en-US'`). Seeded random draws differ in places (§1.4). `OPTIMIZE` and `COVER EXACT` are out. | T11, T13 |
| Callbacks | Synchronous only, with batching. The asynchronous build (+51% gzip) is rejected. | T14 |
| Repository | `relix-web` is its own repository, `DarkCollective/relix-web` (private). It consumes the published engine, so the 1.0 freeze is respected. | T16 |

### 1.4 What the browser build does not do

- **No connectors.** No HTTP, database, file or Mongo sources (TOOLKIT T3). The generated scripts contain only in-memory sources (§3.2).
- **No `OPTIMIZE`, no `COVER EXACT`.** Both need the ojAlgo solver (T13). `SOLVE`, `ROLL`, `SHUFFLE` and greedy `COVER` run.
- **No locale collation.** `COLLATE 'en-US'` is refused. `BINARY` and `NOCASE` stay (R0 §4, patch 0001).
- **Seeded random.** The engine seeds `java.util.Random` in `ROLL`, `SHUFFLE`, `SAMPLE p` and `SAMPLE n ROWS` (`SolverExecutor`, `executeBernoulli`, `executeReservoir`, `executeRoll`, shuffle). SP6 ran 20-row probes with fixed seeds on the spike's JVM reference and its TeaVM build. `SAMPLE 0.5 SEED 42`, `SAMPLE 5 ROWS SEED 42` and `ROLL BY id SEED 7` gave the same rows. **`SHUFFLE SEED 42` and uniform `ROLL SEED 42` gave different rows.** This is a smoke test, not coverage. T11 names `ROLL` and `SHUFFLE`; the probes support that, and show that the difference is in `nextInt(bound)` and `Collections.shuffle`, not in `nextDouble`. The conformance suite (§12) records the exact list.
- **Engine version string.** The version shows "unknown" unless the shim passes it (R0 §5). The shim passes it.

### 1.5 Loading

The chunk is a hashed, same-origin file loaded only when a bake needs a `relix:` word (dependency-closure loading, TOOLKIT P3). The app's bake Worker is an ES module Worker (`apps/web/vite.config.ts` sets `worker.format = "es"`), where `importScripts` does not exist. R0 loaded the chunk in a classic Worker. So the `relix-web` build wraps the TeaVM output as an ES module and the pack loads it with a dynamic `import()`. This needs `script-src 'self'` only. The size goes into the pack's manifest budget and `npm run size` (TOOLKIT §5.2).

---

## 2. Value kinds: `table`, `relation`, `relix-expr`

All three are `ext` kinds (TOOLKIT §6; X0 §3). `table` belongs to core (T21). `relation` and `relix-expr` belong to the pack. The kind registry is process-wide and idempotent (T18). The pack claims `relation` and `relix-expr`, and the manifest refuses a second pack that claims either (P1).

### 2.1 `ext{table}`

Defined by X0 §4 and D2 (T21). This document relies on:

- columnar storage, typed columns `str`, `num`, `int`, `bool`, and an explicit null mask;
- a faithful text form that tells null from empty (X0 R10);
- an honest, O(1), conservative `sizeOf` (X0 R8).

This document asks D2 for two additions (§16):

1. **`origin` annotation.** An optional opaque string on each column, set by the producer. The Relix pack writes the Relix scalar type name (`NUMBER`, `STRING`, `BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP`, `TIMESTAMPTZ`, `DURATION`, `STRUCT`, `ARRAY`, `ANY`). Core ignores it, copies it through table words that keep a column, and drops it when the column is recomputed. The text form carries it.
2. **A `json` column kind.** A column whose cells are canonical JSON text (a `str` column with a flag). The viewer shows compact JSON. `table:to-json` embeds the value, not a string. Relix struct and array cells land here (§5.3). The alternative is a nested column layout, which D2 does not have and this document does not want.

### 2.2 `ext{relation}`

A `relation` is a lazy relational expression. Building one does no engine work. (TOOLKIT §8.1; ADR-0027, "a Relation is a value".)

| Aspect | Specification |
|---|---|
| Payload | An immutable tree. A node is `{ id, op, params, children, origin }`. `op` is a row of the operator table (§4) or a leaf kind. `params` holds each parameter as typed values (`relix-expr` payloads, ints, strings). `origin` is the recipe step path (or FL source position) that built the node, used for error attribution (§7.3). |
| Leaf kinds | `table` (a `table` payload and a Relix name), `tab` (a named input tab, resolved at run, X5), `text` (a parsed Relix expression, §3.6), `inline` (inline table text), `generator`, `unit`, `empty`, `recur` (the FIX/ITERATE accumulator). |
| Sharing | A node object that appears more than once in a tree is a shared subexpression. It prints once as a view (`V1 := { ... };`) and is referenced by name. The engine's `SharedSubexpressions` planner shares it. |
| Text form (`toText`) | The Relix text of the expression, in keyword spelling, with table leaves shown by name and no data. Cut to the caller's `max` with `...`. |
| `fromText` | Parses a Relix expression. Free relation names become `tab` leaves. This is a syntax check by the engine, so it is available once the chunk is loaded; before that, `fromText` accepts any non-empty text and defers (§2.3 describes the same two tiers). |
| Equality | Structural: same `op`, equal `params`, equal children. Table leaves compare by identity of the payload, to keep the check cheap. |
| `sizeOf` | O(1), cached when a node is built: `16 + 2 * (total parameter text) + 48 * (node count) + sum of sizeOf(leaf tables)`. A table that appears in two leaves is charged twice. That is a conservative upper bound (X0 R8, T19). The 48 bytes a node are an estimate; R3 measures them. |
| Viewer | The text form, one line of `columns` when `relix:schema` has run, and the node count. It does not run the query. |
| Limits | At most 4,096 nodes and 1 MiB of parameter text in one relation (proposal). `E_LIMIT_VALUE` past that. |

### 2.3 `ext{relix-expr}`

A `relix-expr` holds the text of one clause of an operator: a condition, a projection list, sort keys, and so on. It is a parameter kind (X0 §6; TOOLKIT §8.2).

| Aspect | Specification |
|---|---|
| Payload | `{ text }`. The text is one clause, with no statement separator. |
| Shapes | The kind has no shape in its payload. The **shape** (condition, projection list, sort keys, ...) comes from the operator table: each parameter of each operator names its shape (§4.2). The helper looks it up by `(op, param)`. This needs no change to `ParamSpec`. |
| Recipe JSON, FL text, share URL | A string. The recipe validator accepts a string of at most 4,096 characters (X0 §6.1); SP2 owns the limit. |
| `fromText` (VM coercion `str` to `ext`) | Tier 1 only: not empty, at most the length limit, no NUL, quotes and brackets balanced. It is a small dependency-free module. It does **not** parse Relix. |
| Engine syntax check | Tier 2: when the node is built and the engine is loaded, the pack parses the clause with the engine's own parser (§2.3.1). A bad clause is `E_COERCE` at the building step, with the line and column inside the text (§7.1). |
| Semantic check | Unknown columns, wrong types and unknown functions need a schema. They are found by `relix:schema` or at run time and are attributed to the step and parameter (§7.3). |
| Helper contract (X0 R6) | `check(text, ctx) => { ok, message?, line?, column? } \| Promise<...>` and optional `complete(text, caret, ctx)`. `ctx` carries the operator, the parameter, and the input schema of the step (X5). Tier 1 runs on the page, sync. Tier 2 runs in the bake Worker through a generic `ext.check` request (§16, item X3/X5). `complete` offers columns from the schema and function names from the catalogue. |

Why two tiers. T20 asks that a kind's parser be one dependency-free module shared by the Worker and the page. The Relix parser is Java inside the 6 MB chunk. It cannot be that module, and writing a TypeScript parser would be a third parser (TOOLKIT §12, "Expression parsing"). So tier 1 is a small shape check that both sides share, and tier 2 asks the one real parser.

#### 2.3.1 How a clause is syntax-checked

`relix-parser` exposes two public entry points: `RelAlgebraParser.parse(input, startLine, startColumn)` for an expression and `RelAlgebraParser.parseOperand(input, startLine, startColumn)` for one scalar operand. There is no public entry for a bare condition or projection list. So the shim wraps the clause in a template, parses the wrapper, and subtracts the template's length from every position it reports. The templates are in §4.2 and are proposals that R5a verifies against the grammar. A public fragment parser is on the list of asks to Relix (§14, RQ4).

### 2.4 Conversions between the kinds

| From | To | How | When | Recorded as |
|---|---|---|---|---|
| `bytes` | `table` | Core words (`csv:parse`, `json:parse`, D1) | explicit step | the step |
| `table` | `relation` | `relix:from name` (explicit, names the table) | explicit step | the step |
| `table` | `relation` | **lift**: an anonymous `from` with a generated name `T<n>` | implicit, when a `relix:` word takes `relation` and gets a `table` | `table -> relation` |
| `relation` | `table` | `relix:run` | explicit step | the step |
| `relation` | `table` | **implicit run** | implicit, when a non-Relix op takes `table`, and at the end of the recipe | `relation -> table` |
| `relation` | `str` | `relix:>text`, `relix:explain`, `relix:optimized` | explicit step | the step |
| `str` | `relation` | `relix:parse` | explicit step | the step |
| `str` | `relix-expr` | VM coercion through `fromText` (tier 1) | at a word boundary | `str -> ext` (X0 §3.4) |
| `relix-expr` | `str` | `toText` | printing, copy | none |
| `relation` | `bytes`, `str`-taking ops | none | | `E_TYPE`; the type badge is red (RELIX-LANES §6) |

**Where the implicit steps come from.** The implicit lift and the implicit run are **inserted by the recipe compiler**, not by a VM coercion. The compiler knows each op's input and output kind from the catalogue (`inputKind`, `outputKind`; X0 R5) and writes `relix:from` or `relix:run` between two steps. The inserted word is marked `implicit` in the step map, so the trace shows `relation -> table` (TOOLKIT §8.1). The reason: a VM coercion is synchronous, and a run may await an FL batch (§6.5). The bake also appends `relix:run` when the last step's output is a `relation`, so the output pane shows a table. In hand-written FL, a `relation` reaching a `table` slot is `E_TYPE` with a hint to write `relix:run`. This refines TOOLKIT §8.1, which says a relation "that reaches a non-Relix op" is run implicitly. Only an op that takes a `table` triggers it. An op that takes `bytes` or `str` does not, because a table has no byte form without an explicit `table:>csv` (decision RX5).

### 2.5 Size and limit accounting (X0 R8)

Every `ext` value is metered by the VM when it is produced (`maxValueBytes`, `maxTotalBytes`; RECIPES §8.6). The contract (T19) is O(1), conservative, cached, with a conformance test per kind.

| Kind | `sizeOf` | Test (X1 conformance) |
|---|---|---|
| `table` | D2: 16 + per column (16 + 2 * name length + cells + null mask) | stable across calls; at least the bytes held |
| `relation` | §2.2 formula, cached at construction | stable; at least `sizeOf` of every leaf table plus the text |
| `relix-expr` | `32 + 2 * text length` | stable; length bound |

The engine's own memory (the TeaVM heap that holds `BigDecimal` rows while a query runs) is outside the FL meter. It is bounded by pack limits on cells and rows (§8). A `table` of 10,000 rows by 10 numbers is charged about 0.8 MB (X0 §4.2). The engine holds the same data as `Row` objects, at an estimated 100 to 200 bytes a cell (not measured; R1 measures it). R0 did not measure memory.

---

## 3. The `relix:` vocabulary

One vocabulary, `relix`, so the qualified names are `relix:select`, `relix:from` and so on. (The recipe examples in RELIX-LANES already use `relix:input`, `relix:select` and `relix:join`.) The operator words are generated from the operator table (§4). The sources and terminals are hand-written FL over a small set of TypeScript primitives (`prims/relix.ts`).

### 3.1 Conventions

- Stack effects use the header grammar of LANGUAGE §5.4 and X0 §3.3. The data input is `inputs[0]`; the other inputs are parameters (RECIPES §2.2).
- Every word has `META:` clauses: `doc`, `category`, `use-when`, and `param` help for each parameter (LANGUAGE §5.9). §10 says where the text comes from.
- Categories: `Relix: sources`, `Relix: rows`, `Relix: columns`, `Relix: groups`, `Relix: joins`, `Relix: sets`, `Relix: graphs`, `Relix: windows`, `Relix: sampling and solving`, `Relix: recursion`, `Relix: results`. (The category of an operator is a column of the operator table.)
- Every word of the pack that runs the engine is marked as needing a killable Worker (`needsHardKill`, RECIPES §2.3) unless cooperative cancellation is available (§8.3). Building words never run the engine.

### 3.2 Sources

A source starts a lane. It reads nothing from above.

| Word | Stack effect | Parameters | Notes |
|---|---|---|---|
| `relix:input` | `( -- relation )` | `tab:str` (required, the name of an input tab, X5); `format:choice{csv\|tsv\|json\|ndjson}=csv`; `header:toggle=true` | Reads the named tab, parses it with the **core** table parsers (D1; there is no second parser, TOOLKIT §12), and lifts the result to a leaf named after the tab. See RQ1 for how this differs from RELIX-LANES §9.1. |
| `relix:from` | `( table name:str="" -- relation )` | `name`: the Relix name of the table. Empty means a generated name. | The explicit lift (§2.4). The name is written as a delimited identifier when it is not a plain identifier or is a reserved word (`Lexer.reservedWords()`). Two different tables with the same name in one relation is an error (§7.4). |
| `relix:inline` | `( -- relation )` | `table:expr` (shape `inline-table`) | An inline table in the Relix syntax (`ScriptParser`, `InlineTable`, `CsvInlineTable`, `MarkdownInlineTable`). Used for fixtures and for import (§9). Limited by the parameter text limit. |
| `relix:generate` | `( -- relation )` | `generator:choice{Range\|Naturals\|Primes}`; `lo:int`, `hi:int`, `step:int=1` (for `Range`) | The built-in generators (`source ... from generator`; reference `language/generator-source.md`). `Naturals` and `Primes` never end, so the engine refuses a blocking operator over them unless a bound sits above (§7.4). |
| `relix:unit` | `( -- relation )` | none | The nullary relation with one empty tuple (`UNIT`, alias `DEE`; `TruthRelationNode`). |
| `relix:empty` | `( -- relation )` | none | The nullary relation with no tuple (`EMPTY`, alias `DUM`; `TruthRelationNode`). |
| `relix:recur` | `( -- relation )` | `name:str` | The accumulator of the enclosing `FIX` or `ITERATE` (`RecursiveRefNode`). Valid only inside a `step` slot of §3.5; elsewhere `E_PARAM_INVALID` at build time. |

A source used in a slot lane is the first step of that lane (RELIX-LANES §2.1, Q5). A saved relation (a recipe promoted to a word, PLAN §3.6) is also a source: a user word with the effect `( -- relation )`. It prints as a view or inline (§9.1).

### 3.3 Unary operators

`( relation params... -- relation )`. One word per row of the unary table in §4.3. Each word builds a node and does nothing else.

### 3.4 Binary operators

`( left:relation right:relation params... -- relation )`. One word per row of the binary table in §4.5. `left` and `right` are the two **slots** of the step (RELIX-LANES §2.1). In a recipe the step's data from above feeds one slot (`pipe`) and the other slot holds a lane. **The recipe JSON for this (`pipe`, `left`, `right`) is SP2's, and so is how the catalogue marks a parameter as a slot and how the compiler orders the two relations on the stack.** The word itself always takes `left` below `right`.

### 3.5 Base-and-step operators

`FIX` and `ITERATE` take a base and a step that reads its own result. `( base:relation step:relation params... -- relation )`. In a recipe these are steps with two slots named `base` and `step`. The `step` lane starts with `relix:recur name`. SP2 defines the slot names and whether the data from above may feed `base` (recommended: yes, as `pipe: "base"`; the `step` lane is always explicit). See RQ5.

### 3.6 Terminals

A terminal turns a `relation` into something else. Terminals are the only words that call the engine.

| Word | Stack effect | Parameters | Result and notes |
|---|---|---|---|
| `relix:run` | `( relation -- table )` | `limit:int` (optional; at most the pack row limit, §8) | Executes the query (parse, analyse, optimise, plan, execute; FL batch loop §6.5). Result columns are typed as in §5.3. The trace records the step and, when implicit, `relation -> table`. |
| `relix:explain` | `( relation -- str )` | `format:choice{text\|json}=text`; `asWritten:toggle=false` | The physical plan with row estimates (`Relation.explain`, `explainJson`; `PhysicalPlanPrinter`, `PhysicalPlanJson`). By default it plans the rewritten tree, which is what runs. Reads no data. |
| `relix:optimized` | `( relation -- str )` | `rewrites:toggle=false` | The rewritten logical tree as Relix text (`Relation.optimized().render()`). With `rewrites`, a second section lists the rules that fired (`TransformationRecord`). |
| `relix:schema` | `( relation -- table )` | none | One row per output column: `name`, `type`, `ordinal` (the shape of `relix.schema`). Needs analysis only, no data. |
| `relix:>text` | `( relation -- str )` | `spelling:choice{keywords\|glyphs}=keywords` | The Relix text that would run, normalised through the engine's printer (§9.1). |
| `relix:parse` | `( text:str -- relation )` | none | Parses a Relix expression. Free relation names become `tab` leaves, bound to input tabs at run (X5); an unbound name is an error at schema or run time (§7.4). A script (statements) is not accepted; use import (§9.2). |

**`relix:why` is not a terminal.** TOOLKIT §8.1 lists it among the terminals. In the source `WHY` is a relational operator: `WhyNode` is a `RelNode`, `Relation.why()` returns a `Relation`, and the output is the input plus a nested `provenance` column (reference `operators/why.md`). It is a unary operator row in §4.3. TOOLKIT §8.1 needs the correction in §16.

**Not tested by R0.** R0 exercised `run` only. `explain`, `optimized`, `schema` and the JSON renderers use `relix-plan` and `relix-semantic` classes that are in the assembly, but nothing has run them in the browser yet. R1a and R3 prove them (§15).

---

## 4. The operator table

The table has **52 rows**: 29 unary, 2 base-and-step and 21 binary. It is built from the sealed `RelNode` hierarchy (`relix-ast`, 50 permitted kinds; `ConditionalJoinNode` stands for seven concrete join nodes), the parser (`Lexer.KEYWORDS`, glyph cases, `RelAlgebraParser.parseExpressionAtDepth`, the prefix switch in `parsePrefixAtStart`) and the reference "Syntax" blocks. Nothing is invented. Kinds that are not operators are accounted for in §4.7.

**In the browser: 51 rows available, 1 not.** `optimize` is out (T13). `cover` is available with `exact` refused. Four rows carry the seeded-random note (§1.4).

### 4.1 How to read the tables

- **Word** is the name in the `relix` vocabulary: `relix:<word>`.
- **Glyph** and **keyword**: the glyph and the ASCII spelling the printer writes (`Spelling.GLYPHS`, `Spelling.KEYWORDS`). A dash means the operator has no glyph (`Lexer` has no glyph case for it). Accepted aliases are listed in the notes.
- **AST class** is the `relix-ast` record that the parser builds.
- **Parameters** use `name:type`. A `?` after the name means optional. `expr(shape)` is `ext{relix-expr}` with the named shape (§4.2). Other types are FL parameter types (`int`, `num`, `str`, `toggle`, `choice{...}`).
- **Sides** (binary rows): `symmetric` means swapping the two relations gives the same rows; `ordered` means it does not; `mirror` names the operator that swapping turns it into.
- **Browser**: `yes`, `yes (seed)`, `partial`, `no` (§4.6).
- **Doc key** is the page under `docs/reference` in `relix-core`, and the key for help text (§10).

### 4.2 Parameter shapes

| Shape | What the text is | Syntax-check template (proposal; `{t}` is the text) | Reference |
|---|---|---|---|
| `cond` | a predicate (a condition over columns, with `∧ ∨ ¬`, comparisons, `IN`, `LIKE`, `EXISTS`, function calls) | `σ {t} (R)` | `operators/select.md`, `predicates/*` |
| `proj` | a projection list: columns or expressions, each with an optional `→ alias` | `π {t} (R)` | `operators/project.md` |
| `group` | grouping keys and aggregates with `→ alias` (also `ROLLUP`, `CUBE`, `GROUPING SETS`, `FILTER`) | `γ {t} (R)` | `operators/group.md` |
| `sort` | sort keys with `ASC`/`DESC` and `NULLS FIRST`/`NULLS LAST` | `τ {t} (R)` | `operators/sort.md` |
| `cols` | a comma list of column names | `π {t} (R)`, plus a check that every item is a name | |
| `operand` | one scalar expression | `RelAlgebraParser.parseOperand({t})` | `functions/*` |
| `rename` | the argument of `ρ`: `New`, `New(c1, c2)`, `New (old → new, ...)`, `(old → new, ...)` | `ρ {t} (R)` | `operators/rename.md` |
| `equations` | one or more `left = right` equations, or `{ ... }` | `SOLVE {t} (R)` | `advanced/solve.md` |
| `starts` | `column = expression, ...` (the `START` clause) | `SOLVE _y = _x START {t} (R)` | `advanced/solve.md` |
| `window-fn` | a window function call (`LAG(x, 1)`, `RANK()`, `NTILE(4)`, ...) | `WINDOW {t} SORT _k AS _o (R)` | `operators/window-*.md` |
| `agg-call` | an aggregate call (`AVG(price)`) | `ROLLING {t} OVER 1 ROWS SORT _k AS _o (R)` | `operators/rolling.md` |
| `frame` | a frame (`n ROWS`, `ALL ROWS`, `PARTITION`, `ROWS BETWEEN a AND b`) | `ROLLING SUM(_x) OVER {t} SORT _k AS _o (R)` | `operators/rolling.md` |
| `optimize` | the body of `OPTIMIZE` (objective, `SUBJECT TO`, `PER`, `ALLOCATE`) | `OPTIMIZE {t} (R)` | `advanced/optimize.md` |
| `inline-table` | rows of an inline table (Markdown or CSV flavour) | `_X := [ {t} ];` | `language/inline-table.md` |

Column names that are not plain identifiers are written between backticks (reference `language/delimited-identifier.md`). `str` parameters that name a column are printed as delimited identifiers when needed.

### 4.3 Unary operators (29 rows)

All have the stack effect `( relation params... -- relation )`. Category in brackets.

| # | Word | Glyph | Keyword | AST class | Parameters | Browser | Doc key |
|---|---|---|---|---|---|---|---|
| 1 | `select` [rows] | σ | `SELECT` | `SelectionNode` | `cond:expr(cond)` | yes | `operators/select.md` |
| 2 | `project` [columns] | π | `PROJECT` | `ProjectionNode` | `columns:expr(proj)` | yes | `operators/project.md` |
| 3 | `rename` [columns] | ρ | `RENAME` | `RenameNode` | `spec:expr(rename)` | yes | `operators/rename.md` |
| 4 | `group` [groups] | γ | `GROUP` (`GROUP BY`) | `AggregationNode` | `spec:expr(group)` | yes | `operators/group.md` |
| 5 | `sort` [rows] | τ | `SORT` (`ORDER`, `ORDER BY`) | `SortNode` | `keys:expr(sort)` | yes | `operators/sort.md` |
| 6 | `limit` [rows] | λ | `LIMIT` | `LimitNode` | `count:int[0..]`; `offset:int[0..]=0`; `ties:toggle=false` | yes | `operators/limit.md` |
| 7 | `distinct` [rows] | δ | `DISTINCT` | `DistinctNode` | none | yes | `operators/distinct.md` |
| 8 | `unnest` [columns] | μ | `UNNEST` | `UnnestNode` | `column:str`; `ordinality:str=""` | yes | `operators/unnest.md` |
| 9 | `why` [results] | ω | `WHY` | `WhyNode` | none | yes | `operators/why.md` |
| 10 | `forall` [groups] | ∀ | `FORALL` | `UniversalNode` | `keys:expr(cols)` (may be empty); `cond:expr(cond)` | yes | `operators/forall.md` |
| 11 | `closure` [graphs] | ⁺ (postfix) | `CLOSURE`, `RCLOSURE` | `ClosureNode` | `from:str`; `to:str`; `reflexive:toggle=false`; `undirected:toggle=false` | yes | `advanced/closure.md` |
| 12 | `cluster` [graphs] | none | `CLUSTER` | `ClusterNode` | `from:str`; `to:str`; `label:str` | yes | `advanced/cluster.md` |
| 13 | `path` [graphs] | none | `PATH` | `PathNode` | `from:str`; `to:str`; `undirected:toggle=false`; `minHops:int[0..]=1`; `maxHops:int[1..]`; `depth:str` | yes | `advanced/path.md` |
| 14 | `trace` [graphs] | none | `TRACE` | `TraceNode` | `from:str`; `to:str`; `undirected:toggle=false`; `weight:str`; `sense:choice{minimize\|maximize}`; `path:str` | yes | `advanced/trace.md` |
| 15 | `sample` [sampling] | none | `SAMPLE p` | `SampleNode` | `probability:num[0..1]`; `seed:int` (optional) | yes (seed) | `advanced/sample-bernoulli.md` |
| 16 | `sample-rows` [sampling] | none | `SAMPLE n ROWS` | `ReservoirSampleNode` | `count:int[0..]`; `seed:int` (optional) | yes (seed) | `advanced/sample-reservoir.md` |
| 17 | `shuffle` [sampling] | none | `SHUFFLE` | `ShuffleNode` | `seed:int` (optional) | yes (seed) | `operators/shuffle.md` |
| 18 | `roll` [sampling] | none | `ROLL` | `RollNode` | `weight:expr(operand)` (optional, the `BY` clause); `seed:int` (optional) | yes (seed) | `operators/roll.md` |
| 19 | `solve` [solving] | none | `SOLVE` | `SolveNode` | `equations:expr(equations)`; `per:expr(cols)` (optional); `within:num` (optional); `maxRounds:int` (optional); `start:expr(starts)` (optional) | yes | `advanced/solve.md` |
| 20 | `optimize` [solving] | none | `OPTIMIZE` | `OptimizeNode` | `spec:expr(optimize)` | **no** | `advanced/optimize.md` |
| 21 | `top` [groups] | none | `TOP` | `TopKNode` | `count:int[0..]`; `offset:int[0..]=0`; `ties:toggle=false`; `keys:expr(sort)`; `per:expr(cols)` (optional) | yes | `advanced/top.md` |
| 22 | `cover` [sampling] | none | `COVER` | `CoverNode` | `strength:int[1..]`; `exact:toggle=false` | partial | `advanced/cover.md` |
| 23 | `downsample` [windows] | none | `DOWNSAMPLE` | `DownsampleNode` | `timestamp:str`; `interval:str`; `function:choice{avg\|sum\|min\|max\|count}`; `per:expr(cols)` (optional); `rows:int[1..]` (optional, `FOR n ROWS`) | yes | `advanced/downsample.md` |
| 24 | `rolling` [windows] | none | `ROLLING` | `WindowNode` | `aggregate:expr(agg-call)`; `frame:expr(frame)`; `sort:expr(sort)`; `per:expr(cols)` (optional); `as:str` | yes | `operators/rolling.md` |
| 25 | `window` [windows] | none | `WINDOW` | `WindowNode` | `function:expr(window-fn)`; `frame:expr(frame)` (optional); `sort:expr(sort)`; `per:expr(cols)` (optional); `as:str` | yes | `operators/window-offset.md`, `operators/window-ranking.md` |
| 26 | `sessionize` [windows] | none | `SESSIONIZE` | `SessionizeNode` | `order:str`; `gap:expr(operand)`; `per:expr(cols)` (optional); `as:str` | yes | `advanced/sessionize.md` |
| 27 | `pivot` [columns] | none | `PIVOT` | `PivotNode` | `value:str`; `by:str`; `per:expr(cols)` (optional) | yes | `operators/pivot.md` |
| 28 | `unpivot` [columns] | none | `UNPIVOT` | `UnpivotNode` | `columns:expr(cols)`; `name:str`; `value:str` | yes | `operators/unpivot.md` |
| 29 | `tree` [groups] | none | `TREE` | `TreeNode` | `key:str`; `parent:str`; `order:expr(sort)` (optional); `children:str` | yes | `operators/tree.md` |

Notes on rows (each cites the source it was checked against):

- **1, 2, 3, 4, 5, 6, 7, 8, 9, 10**: glyph cases in `Lexer` (`σ π ρ γ τ λ δ μ ω ∀`) and keywords in `Lexer.KEYWORDS`; ASCII table in `Spelling`; forms in the reference pages.
- **4 `group`**: the lexer maps `group` to the `AGGREGATION` token; `BY` is a noise word. Aggregate calls (`SUM`, `AVG`, `COUNT`, `MIN`, `MAX`, `COLLECT`, `ARGMAX`, `ARGMIN`, and the function-library aggregates) belong to the `group` text, not to separate words.
- **5 `sort`**: `ORDER` is the `SORT` token (`Lexer.KEYWORDS`).
- **6 `limit`**: the text forms are `λ n`, `λ offset, n`, `λ n WITH TIES`, and SQL's `LIMIT n OFFSET m` and `OFFSET ... FETCH`, which the parser reads into one `LimitNode` (`parseLimit`, `parseSqlPaging`). `ties` needs a sorted input.
- **8 `unnest`**: `UnnestNode` also has an `outer` flag. The reference says the outer form is programmatic only, so the word does not expose it.
- **11 `closure`**: one node, `ClosureNode`, with `reflexive` for `RCLOSURE` and `R*`, and `undirected` for the `↔` form. Its `boundSource` and `boundTarget` are set by the optimiser, not written, so they are not parameters. The postfix forms `R⁺ OVER (a, b)` and `R* OVER (a, b)` parse to the same node (`parseKleenePostfix`).
- **13 `path`, 14 `trace`**: `PathNode` and `TraceNode` have the same bound fields, set by the optimiser.
- **15 and 16 `sample`**: two nodes behind one keyword, told apart by the `ROWS` word (`parseSample`).
- **18 `roll`**: the stream never ends. A `limit` must sit above it; the engine refuses an unbounded blocking use (§7.4).
- **19 `solve`**: runs in the browser. R0's probe set did not include it; SP6's probe (`SOLVE id = 2 * x` over a derived column) returned rows on both the JVM and the TeaVM build.
- **20 `optimize`**: `OptimizeNode`. The planner needs a `MathProgrammingSolver` (`relix-solver`, `NoSolverInstalledException`); the browser assembly has none (T13). The word exists so a shared recipe still loads, and it fails at build time with `E_USER` and a message that names T13 (RX12).
- **22 `cover`**: `CoverNode` with `exact`. `exact = true` uses the MIP formulation (the class comment says "via ojAlgo"), so it is refused in the browser with `E_PARAM_INVALID` (`param: exact`). Greedy `COVER` runs: SP6's probe (`COVER 2` over a product) returned rows on both builds.
- **24 and 25 `rolling`, `window`**: both build a `WindowNode` with a different `WindowFunction` and share the keyword family `WINDOW`/`ROLLING` (`parseRolling`, `parseWindow`). They are two words because their parameters differ.
- **15 to 18 (seed)**: §1.4.

### 4.4 Base-and-step operators (2 rows)

Effect `( base:relation step:relation params... -- relation )`. Slots `base` and `step`.

| # | Word | Glyph | Keyword | AST class | Parameters | Browser | Doc key |
|---|---|---|---|---|---|---|---|
| 30 | `fix` [recursion] | none | `FIX` | `FixpointNode` | `name:str` | yes | `advanced/fix.md` |
| 31 | `iterate` [recursion] | none | `ITERATE` | `IterateNode` | `name:str`; `rounds:int[1..]` (optional); `until:choice{rounds\|stable\|converged}=rounds`; `max:int[1..]` (optional); `within:num` (optional); `columns:expr(cols)` (optional); `per:expr(cols)` (optional) | yes | `advanced/iterate.md` |

`FIX name (base, step)` and `ITERATE name (base, step) ROUNDS n | UNTIL STABLE MAX n ROUNDS | UNTIL cols WITHIN tol PER keys MAX n ROUNDS` (`parseFixpoint`, `parseIterate`, `IterateStop`: `Rounds`, `Stable`, `Converged`). The accumulator inside `step` is `relix:recur name` (`RecursiveRefNode`). The engine bounds rounds with `maxFixpointRounds` (§8).

### 4.5 Binary operators (21 rows)

Effect `( left:relation right:relation params... -- relation )`. Slots `left` and `right`.

| # | Word | Glyph | Keyword | AST class | Parameters | Sides | Browser | Doc key |
|---|---|---|---|---|---|---|---|---|
| 32 | `join` [joins] | ⋈ | `JOIN` | `NaturalJoinNode` | none | symmetric | yes | `joins/natural-join.md` |
| 33 | `join-using` [joins] | ⋈ with `USING` | `JOIN ... USING` | `UsingJoinNode` | `kind:choice{inner\|left\|right\|full}=inner`; `columns:expr(cols)` | inner, full symmetric; left and right mirror | yes | `joins/using-join.md` |
| 34 | `theta-join` [joins] | ⨝ | `><` | `ThetaJoinNode` | `on:expr(cond)` | symmetric | yes | `joins/theta-join.md` |
| 35 | `left-join` [joins] | ⟕ | `\|><` (`LJOIN`) | `LeftOuterJoinNode` | `on:expr(cond)` | mirror `right-join` | yes | `joins/left-outer-join.md` |
| 36 | `right-join` [joins] | ⟖ | `><\|` (`RJOIN`) | `RightOuterJoinNode` | `on:expr(cond)` | mirror `left-join` | yes | `joins/right-outer-join.md` |
| 37 | `full-join` [joins] | ⟗ | `\|><\|` (`FJOIN`) | `FullOuterJoinNode` | `on:expr(cond)` | symmetric | yes | `joins/full-outer-join.md` |
| 38 | `semi-join` [joins] | ⋉ | `SEMI` | `SemiJoinNode` | `on:expr(cond)` | ordered | yes | `joins/semi-join.md` |
| 39 | `anti-join` [joins] | ▷ | `ANTI` | `AntiJoinNode` | `on:expr(cond)` | ordered | yes | `joins/anti-join.md` |
| 40 | `universal-semi-join` [joins] | none | `USEMI` | `PairwiseUniversalNode` | `on:expr(cond)` | ordered | yes | `joins/universal-semi-join.md` |
| 41 | `asof-join` [joins] | none | `ASOF` | `AsOfJoinNode` | `on:expr(cond)`; `inner:toggle=false`; `within:expr(operand)` (optional); `ties:choice{first\|last}=last` | ordered | yes | `joins/asof-join.md` |
| 42 | `interval-join` [joins] | none | `IJOIN` | `IntervalJoinNode` | `relation:choice{precedes\|preceded_by\|meets\|met_by\|overlaps\|overlapped_by\|starts\|started_by\|during\|contains\|finishes\|finished_by\|equals\|intersects}`; `leftStart:str`; `leftEnd:str`; `rightStart:str`; `rightEnd:str` | ordered | yes | `joins/interval-join.md` |
| 43 | `lateral` [joins] | none | `LATERAL`, `OUTER LATERAL` | `LateralJoinNode` | `outer:toggle=false` | ordered | yes | `joins/lateral-join.md` |
| 44 | `cross` [sets] | × | `CROSS` | `ProductNode` | none | symmetric | yes | `set-operations/cross.md` |
| 45 | `union` [sets] | ∪ | `UNION` | `UnionNode` | none | symmetric | yes | `set-operations/union.md` |
| 46 | `union-all` [sets] | ⊎ | `UALL` (`UNION ALL`) | `UnionAllNode` | none | symmetric | yes | `set-operations/union-all.md` |
| 47 | `outer-union` [sets] | ⊔ | `OUNION` | `OuterUnionNode` | none | symmetric | yes | `set-operations/outer-union.md` |
| 48 | `difference` [sets] | − | `DIFF` (`MINUS`, `EXCEPT`) | `DifferenceNode` | none | ordered | yes | `set-operations/difference.md` |
| 49 | `intersect` [sets] | ∩ | `INTER` (`INTERSECT`) | `IntersectionNode` | none | symmetric | yes | `set-operations/intersection.md` |
| 50 | `divide` [sets] | ÷ | `DIV` | `DivisionNode` | none | ordered | yes | `set-operations/division.md` |
| 51 | `symmetric-difference` [sets] | ∆ | `SYMDIFF` | `SymmetricDifferenceNode` | none | symmetric | yes | `set-operations/symmetric-difference.md` |
| 52 | `compose` [sets] | ∘ | `COMPOSE` | `CompositionNode` | none | ordered | yes | `set-operations/composition.md` |

Notes:

- **32 to 39**: the seven condition joins are the permitted subtypes of the sealed `ConditionalJoinNode`; `NaturalJoinNode` and `UsingJoinNode` are separate permitted kinds (`RelNode`). Keywords and glyphs: `Lexer.KEYWORDS`, glyph cases, `Spelling`.
- **33 `join-using`**: one word for the four `UsingJoinNode.Kind` values. The text can be written `A ⋈ USING (c) B` or `A JOIN B USING (c)` (`parseExpressionAtDepth`, `usingKind`).
- **40 `universal-semi-join`**: the parser maps `USEMI` to `PairwiseUniversalNode`. The word is `universal-semi-join` after the reference title.
- **41 `asof-join`**: `ASOF`, an optional `INNER`, `WITHIN <duration>`, `TIES(FIRST|LAST)` (`parseExpressionAtDepth`). The condition has equality keys and exactly one ordering comparison.
- **42 `interval-join`**: the Allen relation names are the 13 in the reference plus `INTERSECTS` (the parser's error text lists 14). The four column names are positional, written `(lStart, lEnd, rStart, rEnd)`.
- **43 `lateral`**: the parser accepts `left LATERAL fn(args)` and `left LATERAL ( relation )`. The word exposes only the relation form: the right slot is a lane. The function form needs a table-valued function from a script `def`, and a Forge-generated script has none (§6.7). `outer` writes `OUTER LATERAL`. The right lane may read columns of the left row.
- **44 `cross`**: `CROSS` and `CROSS JOIN` (`isWord(operator, "CROSS") && isWord(current, "JOIN")`).
- **Sides.** The `mirror` entries let the editor turn "swap sides" into the mirror operator where that keeps the rows (RELIX-LANES §3). Whether it does is SP2's and the lanes design's; this column only states the algebra. `symmetric` means the same rows; the column order of the result may differ.

### 4.6 Browser availability

| State | Rows | Meaning |
|---|---|---|
| yes | 46 | Runs in the browser build with no known difference. The R0 corpus passes (241 of 248, §12). |
| yes (seed) | 4 (`sample`, `sample-rows`, `shuffle`, `roll`) | Runs. The seeded forms use `java.util.Random`. SP6 probes: `shuffle` and uniform `roll` differ from the JVM, `sample` (both forms) and `roll` with `BY` matched. Without a seed the output is random on both sides. The T11 limit applies and the conformance list records the cases. |
| partial | 1 (`cover`) | Greedy `COVER` runs. `exact = true` is refused at build time (`E_PARAM_INVALID`). |
| no | 1 (`optimize`) | Needs the solver (T13). The word fails at build time with `E_USER`. |

**Counts: 52 rows; 51 usable in the browser (46 plain, 4 with the seed note, 1 partial); 1 not available.** Plus one parameter value (`cover` with `exact`) that is refused.

The two fixes named in T11 (an `Intl.Collator` bridge, size M; a JDK-compatible `Random`, size S to M) are deferred. From the probes the `Random` fix needs only a JDK-exact `nextInt(bound)` and `Collections.shuffle` in the supplement module.

### 4.7 What is not in the table

| `RelNode` kind | Why |
|---|---|
| `RelationNode` | A source (§3.2). |
| `RelationFunctionCall` | A call to a table-valued function. The engine's function SPI has scalar and aggregate functions only (`FunctionLibrary.scalarFunctions`, `aggregateFunctions`). Table-valued functions come only from script `def` statements. Forge writes none (§6.7). |
| `TruthRelationNode` | Sources `relix:unit` and `relix:empty`. |
| `EmptyRelationNode` | Produced by the optimiser. It cannot be written. |
| `RecursiveRefNode` | The source `relix:recur`. |

Statements (`source`, `connection`, `def`, `import`, `env`, `relate`, `namespace`, named relations `N := { }`, `query`) are not operators. The pack generates `source ... from generator`, named relations for shared subexpressions, and one `query`. Everything else is refused on import (§9.2) and cannot be produced by the pack's words.

**Predicates and functions are text.** Predicates (`predicates/*`), scalar functions (`functions/*`) and aggregates (`aggregates/*`) are part of `relix-expr` text. They are not words and not table rows. The built-in function list is in the engine's `relix.functions` relation.

### 4.8 How wrappers and metadata are generated

One file, `packs/relix/gen/operators.json`, holds the table: for each row the word, glyph, keyword, aliases, AST class, arity, slots, parameter list (name, type, constraint, default, shape, help line), sides, mirror, category, browser state, doc key and `see-also` words. `packs/relix/gen/operators.schema.json` validates it.

`npm run gen:relix` (R2b) reads it and writes:

- `packs/relix/vocab/relix-ops.fth`: one FL word per row, each with `META:` clauses. The words call one private primitive, `_node`, which builds a tree node. The file starts with the Apache-2.0 header and a "generated, do not edit" line.
- `packs/relix/gen/printer-table.json`: for the session, the spelling and the parameter order of each row, so that printing a node needs no FL.
- `packs/relix/gen/help-source.json`: the doc key, the `use-when` text and the parameter help of each row, for §10.

The generated `.fth` is **committed**. The vocabulary scanner (RECIPES §2.4) and the catalogue build read plain files, and a reviewer sees every change as a diff. CI runs `npm run gen:relix -- --check` and fails if regenerating changes a file.

A generated word looks like this (shape only; the real text is the generator's):

```forth
\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ GENERATED from packs/relix/gen/operators.json. Do not edit.
IN: relix

: select ( r:ext{relation} cond:ext{relix-expr} -- ext{relation} )
  "Keep the rows for which a condition holds." doc
  "Relix: rows" category
  "select" _node ;

META: select
  use-when "You want only the rows that meet a condition." ;
  param cond "A condition on each row, such as amount > 100." ;
  see-also relix:project relix:top ;
;
```

### 4.9 Where the table lives

**Recommendation: in Forge, until Relix publishes it** (RX11).

- The table is checked against the engine, so a stale table is caught by tests, not by users (§12.2): every concrete `RelNode` kind has a row or an entry in §4.7, every keyword is in `Lexer.reservedWords()`, and every row's reference "Syntax" example parses and prints.
- `relix-web` contains an exhaustive pattern switch over the sealed `RelNode` hierarchy (the import helper, §9.2). A new node kind in a Relix release is then a compile error in `relix-web`, which is the earliest possible signal.
- The ask to Relix is a `relix.operators` catalog relation (TOOLKIT §8.2, Q1): `name`, `glyph`, `keyword`, `aliases`, `node_kind`, `arity`, `slots`, `parameters` (names, types, shapes), `doc_key`. It is useful to every tool that builds queries, not only Forge. It lands after 1.0 (the freeze, TOOLKIT §2.6). When it exists, WP C2 generates the same `.fth` from it and a test requires that the output equals the hand-fed table.
- Until then, the first draft of `operators.json` is produced by a one-off script from the `RelNode` kinds and the reference Syntax blocks, then edited by hand. The hand edits (help lines, categories, shapes) stay in Forge in any case, because they are Forge's UI words; the Relix catalog would supply only the structural columns.

---
## 5. The value mapping

This section completes TOOLKIT §8.4. There are two places where values cross: **table cells** (a `table` registered as a Relix source, and a query result turned back into a `table`), and **scalar arguments and results** of `fl.*` functions (§6). The rules are the same where they can be. Where they differ, the table says so.

The engine has 11 value kinds (`relix-value`, the sealed `Value`): `NumberValue` (`BigDecimal`), `StringValue`, `BooleanValue`, `NullValue`, `StructValue`, `ArrayValue`, `DateValue`, `TimeValue`, `TimestampValue`, `ZonedTimestampValue`, `DurationValue`. Column types are `ScalarType`: `ANY`, `STRING`, `NUMBER`, `BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP`, `DURATION`, `TIMESTAMPTZ`. There is no bytes type, and Relix adds functions, not value types (ADR-0026).

FL has nine tags (`bytes str int num bool list quot record file`, LANGUAGE §3.1) and no null. Its coercions are fixed (LANGUAGE §4.2): `str` to `bytes` is UTF-8, `bytes` to `str` is strict UTF-8, `int` to `num` is exact, `num` to `int` is exact.

### 5.1 Relix to FL

| Relix value | `fl.*` argument (FL value) | `table` cell after `relix:run` | Notes |
|---|---|---|---|
| NUMBER, integral (`stripTrailingZeros().scale() <= 0`) | `int` (a `bigint` beyond 2^53 - 1) | `int` column | Scale is not kept: `5.00` arrives as `5`. Relix itself does not use scale for identity or order (`NumberValue.equals`), only for display. |
| NUMBER, not integral | `num`, the nearest double; `rat` when the slot is declared `ext{rat}` and the symbolic pack is on (§5.5) | `num` column when every value of the column round-trips through the shortest decimal form of its double; otherwise a `str` column holding the decimal text, `origin` `NUMBER`, and a bake warning "decimal precision kept as text" | The bridge hands FL a tagged value (`int` or `num`) and FL's own coercions do the rest: a non-integral NUMBER given to an `int` slot is `E_COERCE` (LANGUAGE §4.2). |
| STRING | `str` | `str` column | Lossless. Relix strings are Java strings (UTF-16), so are FL strings. A lone surrogate is kept; FL refuses it only when it encodes it to bytes. |
| BOOLEAN | `bool` | `bool` column | |
| NULL, top-level argument | no FL call; the result is NULL (§5.4) | null mask bit | |
| NULL, inside a struct or array | refused: `E_COERCE`, `reason: "null inside a nested value"` (§5.4) | inside the JSON text as `null` | |
| STRUCT (`StructValue`, ordered map) | `record` (same keys, values mapped recursively) | `json` column (D2 ask), canonical JSON, keys in the struct's order | A struct with two keys that differ only in case crosses (FL keys are case-sensitive). |
| ARRAY (`ArrayValue`) | `list` (elements mapped recursively) | `json` column | |
| DATE | `str`, ISO `2026-11-23` (`LocalDate.toString`) | `str` column, `origin` `DATE` | Until Forge has a date value (TOOLKIT §8.4). |
| TIME | `str`, ISO `13:40:00` | `str`, `origin` `TIME` | |
| TIMESTAMP | `str`, ISO instant `2026-11-23T10:00:00Z` (`Instant.toString`) | `str`, `origin` `TIMESTAMP` | |
| TIMESTAMPTZ | `str`, ISO with offset (`ISO_OFFSET_DATE_TIME`) | `str`, `origin` `TIMESTAMPTZ` | |
| DURATION | `str`, ISO-8601 duration as `DurationValue.asDisplayString` writes it (`P1Y2MT12H`) | `str`, `origin` `DURATION` | The R0 shim's `U:months/duration` cell code is a stand-in and is not used. |
| A bytes carrier (§5.6) | `bytes` | `str` column of lowercase hex, `origin` `BYTES` | Recognised only where an FL slot is `bytes`, or in a result column whose cells are all carriers. |

A result column whose declared type is `ANY` (an open schema, a `WHY` provenance column, `COLLECT`, `TREE`) is typed by its cells: if every non-null cell is one kind, that kind's column; otherwise a `json` column with `origin` `ANY`.

### 5.2 FL to Relix

| FL value | `fl.*` result (Relix value) | `table` cell registered as a source | Notes |
|---|---|---|---|
| `int` | NUMBER, scale 0 | column type NUMBER | `bigint` values are exact. |
| `num` | NUMBER from the shortest decimal text of the double (`0.1` stays `0.1`) | NUMBER | FL raises `E_RANGE` for non-finite results, so NaN and infinity never cross. `-0` becomes `0`. |
| `rat` (symbolic pack) | NUMBER when the denominator divides a power of ten; otherwise `E_COERCE`, `reason: "not a terminating decimal"` | not a column type | §5.5. |
| `bool` | BOOLEAN | BOOLEAN | |
| `str` | STRING | STRING, or the type in the column's `origin` (DATE, TIME, TIMESTAMP, TIMESTAMPTZ, DURATION), parsed as ISO text | A cell that does not parse under its `origin` type is a registration error (`E_COERCE`, with the column and row). |
| `bytes` | the bytes carrier (§5.6) | a column with `origin` `BYTES` registers as the carrier; any other `bytes` data is not a table cell | |
| `list` | ARRAY, recursively | from a `json` column: parsed JSON | |
| `record` | STRUCT, keys in insertion order, recursively | from a `json` column | Two keys that differ only in case are refused (`E_COERCE`), because Relix field lookup is case-insensitive (`StructValue.field`) and would pick one silently. |
| `quot`, `file` | not mappable | not mappable | An op that returns one is not exposed (§6.3). |
| `ext{table}` | ARRAY of STRUCT, one struct per row (§6.7) | not a cell | Table-valued words only. |
| other `ext` kinds | not mappable | not mappable | |

**Numbers in transfer.** In v1, NUMBER cells cross the TeaVM boundary as decimal text, both ways. That is exact by construction and is what R0 did. Shipping `Float64Array` columns would be faster, but it needs TeaVM's `Double.toString` to give the same shortest form as JavaScript's, which nothing has tested. R1a measures both and may switch only after the conformance suite (§12) passes with typed arrays.

### 5.3 Tables in both directions

A `table` becomes a Relix source with a declared schema: column type NUMBER for `int` and `num`, STRING for `str`, BOOLEAN for `bool`, the `origin` type where one is set, and ANY for a `json` column (each cell parsed into a struct or array). The registry is the engine's `GeneratorRegistry`, as in R0's shim (`source T from generator { name: "T" }`); R1a replaces per-call JSON with registering a table once per bake.

A result becomes a `table` by §5.1. The null mask comes from NULL cells. The result keeps the column order and names of the engine's result schema.

### 5.4 NULL

- **FL has no null** (LANGUAGE §3.1).
- **The engine does not skip NULL arguments.** `OperandEvaluator.invoke` evaluates every argument of a `StrictScalarFunction` and calls it, NULLs included; "strict" there means "arguments evaluated first", not "NULL in, NULL out". Built-in functions check for NULL themselves (for example `UCase`: "NULL in → NULL out"). SP6 confirmed this on the spike: a host function was called with a NULL argument. R0 §2 (criterion 8) says "NULL in gives NULL out without a call"; that was the behaviour of its JavaScript test function, not of the engine.
- **So the bridge implements strictness.** If any argument of an `fl.*` call is NULL, the bridge returns NULL and does not call FL. This is TOOLKIT §8.4's rule, enforced in the Java library (§6.5), so a NULL never reaches FL.
- **Nested NULLs** (a struct field or array element that is NULL) have no FL form. The FL JSON words (TOOLKIT L3, SP1) will choose how JSON `null` is held in FL. Until they do, the bridge refuses a nested NULL with `E_COERCE`. When SP1 decides, the bridge uses the same representation.
- **Tables carry nulls** in the null mask, in both directions.

### 5.5 `rat` when the symbolic pack is on (TOOLKIT Q5)

**Recommendation: yes, narrowly** (RX9). A finite decimal is a rational, so the mapping is exact in one direction and partial in the other.

- NUMBER to `rat` (unscaled value over 10^scale, reduced) happens **only where the FL slot is declared `ext{rat}`**. It is chosen by the declared type, never by the value. Without the symbolic pack nothing changes.
- `rat` to NUMBER is exact when the reduced denominator has no prime factor other than 2 and 5. Otherwise `E_COERCE` with a hint to approximate first (the symbolic pack's `>num`).
- Table columns do not get `rat`. A table column of rationals is not planned in D2.

Why: it gives the symbolic pack exact arithmetic on Relix decimals without a lossy double in between, and it costs nothing when the pack is off.

### 5.6 Bytes (TOOLKIT Q3)

**Recommendation: a tagged struct, `{ bytes_hex: "<lowercase hex>" }`** (RX8). Not plain hex text.

- **Inputs.** An FL `bytes` slot accepts a Relix STRING (FL's own `str` to `bytes` coercion, UTF-8) or the carrier struct (decoded from hex). So `fl.base64.encode('hello')` works on text.
- **Outputs.** An FL op that returns `bytes` returns the carrier. `fl.hex.encode(fl.sha2.sha256(x))` composes: the digest travels as the carrier and `hex.encode` receives exact bytes.
- **Why not hex text.** With hex text as the carrier, an FL `bytes` slot that receives a STRING cannot tell text from hex. `fl.hex.encode(fl.sha2.sha256(x))` would hex-encode the hex text, silently. A struct is a different value kind, so the bridge always knows.
- **Why this field name.** It must be writable in Relix, so a user can read it: `fl.base64.decode(x).bytes_hex`. A `$` field (the vector format's `{"$bytes": ...}`) cannot be written in Relix, because `$` starts a parameter token (`Lexer.parameterToken`).
- **Text.** A user who wants text writes `fl.text.from_utf8(...)` or any FL op whose output is `str`. The bridge never guesses text from bytes.
- **In tables.** A result column whose cells are all carriers becomes a `str` column of hex with `origin` `BYTES`, so a later `relix:from` restores the carrier.

### 5.7 What is kept and what is lost

| Crossing | Lost |
|---|---|
| NUMBER to `int` | scale (display only) |
| NUMBER to `num` | digits beyond a double's precision; the table path keeps them as text instead |
| dates and times to `str` | the type, unless `origin` carries it back |
| STRUCT to `record` | nothing (order is kept by insertion) |
| `num` to NUMBER | nothing (shortest decimal) |
| `record` to STRUCT | refused when keys collide case-insensitively |

---

## 6. FL from Relix: the `fl` function library

### 6.1 What it is

A `FunctionLibrary` (`relix-function`) named `fl`, built per run by the session and passed to the engine with `FunctionCatalog.of(builtins, fl)`, as R0's shim does. Priority 0: its names never collide with built-ins, because no built-in has a dot in its name (`relix-function-builtin`). It offers scalar functions only; the SPI has no table-valued functions (§6.7).

The same library is offered on the JVM by `relix-fl` (TOOLKIT §8.7, J2), with the same names and the same mapping, so a script that runs in Forge runs in JVM Relix with `relix-fl` installed.

### 6.2 Naming (TOOLKIT Q2): decided

**Decision (RX7): an FL op `vocab:word` is the Relix function `fl.<vocab>.<word>`, with every `-` in either part written `_`.**

| Forge op | Relix call |
|---|---|
| `base64:decode` | `fl.base64.decode(payload)` |
| `hex:encode` (parameters `delimiter`, `case`) | `fl.hex.encode(x)`, `fl.hex.encode(x, 'colon', 'upper')` |
| `url:decode` | `fl.url.decode(q, true)` |
| `aes-kw:unwrap` | not exposed: it has a `key` parameter (§6.3) |
| `asn1-dump:...` (a vocabulary with a hyphen) | `fl.asn1_dump.<word>(...)` |
| a user word `user:tidy` | `fl.user.tidy(x)` |

Reasons:

1. **It parses, today, with no engine change.** SP6 ran it on the spike's JVM build: the parser reads a dotted name followed directly by `(` as one function name (`RelAlgebraParser.parseOperandFromNameToken` loops over `.`), and `FunctionCatalog` looks it up by the whole lower-cased name. `fl.base64.decode(x)`, `fl.hex.to_bytes(x)` and three-part names with reserved words as later parts (`fl.lines.sort`, `fl.set.union`, `fl.text.top`) all resolved and ran.
2. **It does not clash with columns.** With a relation named `fl` that has a column `base64`, `π fl.base64 (fl)` read the column and `π fl.base64.decode(fl.base64) (fl)` called the function. The call needs `(` immediately after the name; with a space the parser refuses it ("Expected end of input"). The completion helper writes it without a space.
3. **It is reversible without a table.** Split on the dots, turn `_` back into `-` where the catalogue has the hyphen. The flat form `fl.base64_decode` (TOOLKIT §8.4's example) is ambiguous: vocabulary names may contain hyphens (`[A-Za-z][A-Za-z0-9_-]{0,63}`, RECIPES §2.3), so `a-b:c` and `a:b-c` both flatten to `fl.a_b_c`.
4. **It keeps FL's own structure.** `base64:decode` and `fl.base64.decode` are visibly the same thing. The prefix `fl.` keeps the whole library out of the way of future Relix built-ins (a Relix `BASE64` would not collide) and is easy to search for.
5. **The alternatives fail.** `fl:base64:decode` does not lex: SP6's probe got "a column is named with expr -> name, not name: expr". `fl::x` fails the same way. Backticks are not accepted inside a dotted call. UpperCamel names (`FlBase64Decode`) lose the structure and collide case-insensitively.

Rules: lookup is case-insensitive (`FunctionSignature.canonicalName`), so `FL.Base64.Decode` works; the canonical spelling is lower case. A Forge name with a character outside `[A-Za-z0-9_-]` is not exposed and is listed in the generation report. Two ops that map to one name after lower-casing fail the build that generates the library list. Aliases are not exposed: one name per op.

### 6.3 Which ops are exposed

An op is exposed when all of these hold:

1. It is a catalogue op (RECIPES §2.2) in the current runtime: core, an enabled pack, or a user unit.
2. Its data input is `bytes`, `str`, `int`, `num`, `bool`, or `ext{rat}` with the symbolic pack on.
3. Every other parameter is `str`, `int`, `num`, `number`, `bool`, `choice`, `toggle`, `regex` or `charset`. **An op with a `key` parameter is not exposed**: a Relix expression is plain text in a recipe, and a key written there would travel in share links (RECIPES §7.4, LANGUAGE §10.14).
4. Its output is `bytes`, `str`, `int`, `num`, `bool`, `list`, `record`, or `ext{table}` (table-valued, §6.7).
5. It has no `+random` or `+time` effect. A Relix optimiser may deduplicate or hoist a call it believes deterministic; exposing a non-deterministic op would need the `STABLE` or volatile property and a test of what the optimiser does with it. Excluded in v1. `+async` ops are fine, because FL runs outside the engine (§6.5).

Each exposed op becomes a `StrictScalarFunction` with:

- `name` as in §6.2;
- parameters: the data input first, then the op's parameters in order, with the FL parameter names (`ParameterDefinition`);
- `Arity.between(required, total)`: parameters with a default may be left off from the right;
- return type from §5.2 (`ANY` for `list`, `record`, carriers and tables);
- properties `PURE` and `DETERMINISTIC` for ops with no effects;
- category `fl`, so `relix.funcs("fl")` lists them;
- doc key `fl/<vocab>/<word>`, answered by `FunctionLibrary.documentation` from the op's `doc` text (plain text, §10).

Choice and toggle parameters are passed as STRING and BOOLEAN literals and checked by FL at the call (`E_PARAM_INVALID`).

**Registration is lazy.** The session scans the printed script for `fl.` names and registers only those. A run does not build hundreds of signatures, and the engine's `relix.functions` shows only the ones in use. An `fl.*` name that is not an exposed op is the engine's "Unknown function" error, at its position (§7). The completion helper lists all exposed ops from the catalogue.

### 6.4 User words and promoted recipes

User words (vocabulary `user`, untrusted, PLAN §5) and recipes promoted to words (PLAN §3.6) are catalogue ops once they have a `doc` and a `category` (RECIPES §2.3), and the rules of §6.3 apply to them unchanged: `fl.user.<word>`. They run under the bake's limits like every other op. A shared recipe that calls `fl.user.x` works only where `user:x` exists, exactly like an op step that names `user:x` (`unknown-op` otherwise).

### 6.5 Calling FL from a synchronous engine: discover, batch, replay

T14 decided: synchronous callbacks only, with batching. TOOLKIT §8.4 sketched "the planner hoists FL-function columns". Hoisting works only for calls whose arguments are source columns or constants; it does not work for a call over a join result, an aggregate or another call. This section specifies a protocol that needs no hoisting and no engine change (RX6).

**The Java side.** Each `fl.*` function is a `StrictScalarFunction` backed by a cache in the shim:

1. If any argument is NULL: return NULL (§5.4).
2. Encode the arguments as a key (function name, then each argument's tagged text, length-prefixed).
3. On a hit: return the cached value, or, for a cached FL error, record the error as **read** and return NULL.
4. On a miss: record the key in the run's **miss set** and return NULL as a placeholder.

**The TypeScript side** (the session, in the bake Worker):

```
round = 0
loop:
  result = engine.run(script, tables)           // synchronous
  if result.misses is empty:
     if result.errorsRead is not empty: fail with the first error read (§7.5)
     else: return result
  if ++round > maxRounds: fail E_LIMIT_STEPS (detail: "fl rounds")
  for each function in result.misses:           // one FL run per function
     values = await fl.mapColumn(op, argument columns)
     engine.fill(function, keys, values)        // results or errors, per key
```

**Why it is correct.** A placeholder is substituted only on a miss. A round with no misses therefore saw no placeholder: every value it computed is the value the query defines, and an FL error it read is a real error. A round with misses may compute wrong values, take wrong branches or raise engine errors; all of that is discarded, and its engine errors are ignored. Each round adds at least one cache entry, and a call whose arguments depend on other calls is resolved one level per round. A query with no nesting finishes in two rounds (discover, then run). FL ops are deterministic (§6.3 rule 5), so a cached value is the value a direct call would give.

**The batch.** One FL run per function per round. The bridge calls the op's word once per distinct argument tuple, inside one VM run (`map` over the column), deduplicated, so 10,000 rows with 300 distinct values cost 300 FL calls. The run uses the bake's runtime, trust level and limits; its VM steps count towards the bake's `maxSteps`, and it polls the bake's abort flag like any FL code.

**Costs (estimates, to be measured in R9).** Each round runs the engine once: about 0.1 to 0.4 s for 10,000 rows (R0 §7). A one-level query pays about two engine runs plus the FL batch. R0 measured a synchronous host call at about 5 microseconds per row (criterion 8), and the cache lookup is of that order.

**Limits.** `maxRounds` 8, `maxFlCalls` 200,000 distinct tuples per run (both proposals). Past either, the run fails (§8).

**Later optimisation.** Calls whose arguments are only source columns and constants can be computed before round one, which saves the discovery round. That is the hoisting TOOLKIT §8.4 describes, kept as an optimisation, not a requirement.

### 6.6 Errors from FL inside a query

See §7.5.

### 6.7 Table-valued FL words

The engine's function SPI has no table-valued functions: `FunctionLibrary` offers `scalarFunctions` and `aggregateFunctions` only, and a table-valued function comes only from a script `def ... : RELATION` (reference `language/def-relation.md`). Forge does not generate `def`s.

So a word whose output is `ext{table}` (for example a parser `( bytes -- table )`) is exposed as a scalar function that returns an ARRAY of STRUCT, one struct per row with the columns as fields. Relix's `μ` turns it into rows:

```
μ rows (π id, fl.csv.parse(payload) → rows (Uploads))
```

The fields are then read with the dotted form (`rows.amount`, reference `literals/struct-construction.md`). For `LATERAL`, the same works by putting the call in the right lane's projection. Each call's table is limited to `maxRowsPerCall` 10,000 rows (proposal).

Words that take a `table` as input are not exposed: Relix has the algebra for tables, and the result can be run and passed to Forge words instead.

---

## 7. Errors

All errors are `ForgeError`s with existing codes (LANGUAGE §11.1). **No new error code is added** (RX13): `ErrorCode` is a closed, frozen union of 34 codes, and the existing ones cover every case. Every Relix error carries `detail.source = "relix"` and `detail.relix = { kind, message, line?, column? }`, where `message` is the engine's text (plain text, shown with `textContent`).

### 7.1 Where Relix errors come from

| Source in the engine | Type | Position | Forge code | Path |
|---|---|---|---|---|
| Clause syntax check at build (§2.3.1) | `ParseException` (`line`, `column`, `found`) | start only | `E_COERCE` (`from: "str"`, `to: "relix-expr"`, `reason`) | the building step, `.../params/<name>` |
| Script parse at a terminal | `LangParseException` (`line`, `column`) | start only | `E_COERCE` (for `relix:parse` text) or `E_INTERNAL` (generated text failed to parse: a pack bug) | the node's step (§7.3) |
| Analysis | `SemanticError` list (`line`, `column`, `message`, `severity`) | start only, 0 when none | `E_PARAM_INVALID` (`param`, `constraint: "relix"`, `value`) when the position maps to a parameter; otherwise `E_USER` | the node's step and parameter |
| Analysis warnings | `SemanticError` with `Severity.WARNING` | start | not an error: a bake warning on the step | the node's step |
| Boundedness | refusal at plan time (an unbounded input under a blocking operator) | none | `E_USER` (`reason: "unbounded"`) | the node's step |
| Solver missing | `NoSolverInstalledException` | none | never reached: `optimize` and `cover exact` are refused at build (§4.6) | |
| Execution | `EvaluationException` (message, no position) | none | `E_USER`, or the limit codes of §8 when the message is a budget refusal | the terminal step; the node's step when the message names an operator |
| Cancellation | `EvaluationException("query cancelled")` (patch 0006) | none | `E_ABORTED`, or `E_LIMIT_TIME` when the deadline caused it | the terminal step |
| An FL error in an `fl.*` call | an FL `ForgeError` from the batch | | the FL error's own code (§7.5) | the step whose clause calls the function |

### 7.2 Spans

Relix gives the start of a construct only (`SourceLocation` is file, line, column; `ParseException` and `SemanticError` likewise). The pack reports `detail.span = { start, end }` in code points inside the parameter text. `start` is from Relix. `end` is the end of the token at `start`, found with the engine's lexer, and is marked `approximate`. Span ends are on the list of asks to Relix (§14, RQ4).

### 7.3 Mapping a position to a step and parameter

The pack writes the script itself, so it knows where every node and every parameter text sits. While printing (§9.1), the printer records a **script map**: for each node, its range in the script and its `origin` (the recipe step path); for each `relix-expr` parameter, its range. An engine position (line, column) becomes a script offset, then the innermost range that contains it, then `path = <origin>/params/<name>` and the offset inside the text. A position in generated text outside any parameter (a keyword, a source declaration) maps to the node's step without a parameter.

For a binary step, the path follows SP2's slot paths (`/steps/4/right/steps/2`; RELIX-LANES §8).

### 7.4 Pack-level errors

| Case | Code |
|---|---|
| Two different tables with the same Relix name in one relation | `E_PARAM_INVALID` (`param: "name"`) at the second `relix:from` |
| A `tab` leaf names no input tab | `E_PARAM_INVALID` (`param: "tab"`) at the step that built the leaf |
| `relix:recur` outside a `step` slot | `E_PARAM_INVALID` at build |
| `cover` with `exact` | `E_PARAM_INVALID` (`param: "exact"`, `constraint: "not in the browser (T13)"`) |
| `optimize` | `E_USER` at build, message naming T13 |
| A relation over the node or text limit | `E_LIMIT_VALUE` |
| The engine chunk failed to load | `E_INTERNAL`, with the load error; the bake can be retried |

### 7.5 An FL error inside a Relix function

When the batch runs an op on one argument tuple and FL raises (for example `E_COERCE` from `fl.base64.decode` on text that is not Base64), the bridge stores the error for that key. The protocol of §6.5 fails the run only if a round with no misses **reads** that entry, so an error on a row that the final query never reaches does not fail the query. The bake then fails with:

- `code`: the FL error's code (`E_COERCE` here), unchanged;
- `path`: the step whose clause contains the call (the first in printing order, from the script map);
- `detail`: the FL error's detail, plus `via: "relix"`, `function: "fl.base64.decode"`, and `arguments` (each cut to 80 code points; secrets cannot appear, because no `key` parameter is exposed).

An error is not turned into NULL. A row-level "try" form (NULL on failure) would be a separate function family; it is not in v1 (RQ8).

---

## 8. Limits and cancellation

### 8.1 Limits

The bake's limits (RECIPES §8.6) still apply to everything FL does. The engine's own work is bounded by the engine's own knobs, which already exist in `ExecutionContext` (`relix-processor`): `maxFixpointRounds`, `maxMaterializedRows`, `maxProcessedRows`, `timeout`, `cancellation`. `relix-embed`'s `Relation.context` sets all of them from its session; R0's shim used `QueryExecutor.executeOptimized`, which builds its own context and sets none of them except the 10-million-row materialisation default. **R1a must build the execution context itself** (as `Relation.context` does) so that these limits apply.

| Limit | Forge side | Engine knob | Default (proposal, estimate) |
|---|---|---|---|
| Input cells | sum of rows times columns of all leaf tables | checked by the session before registering | 2,000,000 cells untrusted (estimated 100 to 200 bytes a cell in the engine heap, so 200 to 400 MB; R1a measures it and sets the number) |
| Rows one blocking operator may buffer | | `maxMaterializedRows` | 1,000,000 untrusted (the engine's own default is 10,000,000, sized for a JVM) |
| Rows passed between operators | | `maxProcessedRows` (`WorkBudget`) | 50,000,000 untrusted. Deterministic: the same query on the same data charges the same count. |
| Fixpoint rounds | | `maxFixpointRounds` | 10,000 untrusted (the engine's default is unlimited) |
| Time | the bake's `maxMillis` (10,000 ms untrusted) | `timeout`, set to the time left in the bake | time left |
| Result rows | `relix:run limit` | the session stops pulling | 100,000 untrusted |
| Result size | `maxValueBytes`, `maxTotalBytes` | | the `table` is metered when produced |
| FL batch | the bake's `maxSteps` | | shared with the bake |
| FL rounds and calls | | | `maxRounds` 8, `maxFlCalls` 200,000 |

Trusted bakes use the larger of each pair, as RECIPES §8.6 merges limits (`effectiveLimits`). A caller can only tighten.

Engine refusals map to codes: a materialisation or processed-rows refusal is `E_LIMIT_TOTAL`, a timeout is `E_LIMIT_TIME`, too many fixpoint rounds is `E_LIMIT_STEPS`, too many input cells is `E_LIMIT_TOTAL`, too many result rows is `E_LIMIT_VALUE`. The session tells them apart by the exception's message, which is fragile; a structured reason on `EvaluationException` is on the ask list (RQ4).

### 8.2 Cancellation

The bake already has three layers (RECIPES §8.5): a cancel message that aborts the VM, a per-bake `SharedArrayBuffer(4)` flag (`Atomics.store(flag, 0, 1)`) polled by the VM, and a watchdog that terminates the Worker. The pack uses all three and adds nothing on the page.

1. **During an FL batch** the VM is running, so the existing flag and message stop it.
2. **During an engine run** the VM is blocked in one synchronous call. The session sets the engine's poll to read **the same per-bake `Int32Array`** (R0's `self.relixCancelFlag` read `Atomics.load(flag, 0) === 1`, the same encoding). With patch 0006 the engine's own `QueryCancellation.check()` consults the poll (every 512th check in R0's shim); without it the poll is read only while sources are read. R0 measured a stop 1 to 5 ms after the flag was set, with the Worker still usable (criterion 7). The session maps the stop to `E_ABORTED`.
3. **The deadline.** The engine's `timeout` stops it at the bake's deadline, checked as rows pass between operators (`WorkBudget`). `E_LIMIT_TIME`.
4. **The watchdog** still terminates the Worker if neither works (a page that is not cross-origin isolated has no flag). The next bake loads the engine again: about 1 s of cold start (R0). This is why every engine-running word is marked as needing a killable Worker (§3.1); an untrusted bake without one refuses them, as for regex primitives (RECIPES §4.1, §8.6). The catalogue's `needsHardKill` is computed from regex primitives today; SP2 or P2 extends the rule (§16).

### 8.3 Laziness and timing

Building words cost nothing measurable, so step timings of `relix:` steps are near zero and the terminal (or implicit run) carries the cost. The trace shows this as one `run` step. Per-step row counts (R8) are therefore not a by-product (RQ2).

---

## 9. "View as Relix" and import

### 9.1 View as Relix

"View as Relix" shows the recipe's relational part as a `.relix` script (RELIX-LANES §5.3; TOOLKIT §8.2, R7). It is printed by the engine.

1. The pack walks the recipe statically: no bake, no data. Each `relix:` step becomes a node; slots become children; table leaves become names.
2. It prints a script: `source <name> from generator { name: "<name>" };` for each leaf, `V<n> := { ... };` for each shared subexpression, and `query { ... };`.
3. It hands the text to the engine, which parses it and prints it again with `ScriptPrinter` in the chosen `Spelling` (keywords by default, as `language/spellings.md` recommends for generated code; glyphs on request). Printing is normalised: one statement per line, one spelling (reference behaviour of `ScriptPrinter`).

The view loads the engine chunk on first use. A parse failure here means the pack generated bad text and is a pack bug (`E_INTERNAL` in tests).

**What the text loses.** The engine's printer is faithful to the relational tree (`parse(print(s))` equals `s`, `ScriptPrinter`). The recipe holds more than that:

| Recipe content | In the text |
|---|---|
| Byte and text steps before a source (`base64` decode, CSV parse) | Left out. The view lists them: "3 steps before `orders` are not Relix". The leaf is named after the tab or the `relix:from` name. |
| Table data | Not included. Leaves are names. An option "include data" writes leaves of at most 200 rows as inline tables (proposal), so the script runs on its own. |
| Layout: `pipe`, swap state, lanes, Tree positions | Lost. Text has no layout. |
| Step comments, disabled steps, breakpoints, `hash` pins | Lost. (Comments could become Relix comments later; not in v1.) |
| Registers and `return` (RECIPES 1.1) | A register that holds a relation prints as a view; other registers are left out and listed. |
| Parameter spelling | Normalised by the printer (operator spelling, literal forms such as `5.0`). |
| `fl.*` calls | Kept. A header comment lists them: the script runs in JVM Relix only with `relix-fl` installed. |
| Generated names (`T<n>`) | Kept as written. |

### 9.2 Import of a `.relix` script

Import turns a script into a recipe. It needs the engine to parse.

1. **Parse** with `ScriptParser`. A syntax error is shown with its position and nothing is imported.
2. **Decompose.** A helper in `relix-web` walks the parsed `Script` and returns JSON: statements, and for each relational expression a tree of `{ kind, params, children }` with each parameter printed by the engine's own printer in keyword spelling. The helper is an exhaustive pattern switch over the sealed `RelNode` hierarchy, so a new node kind in a Relix release does not compile in `relix-web` until it is handled (§4.9). `LogicalPlanJson` is not enough for this: it gives each node's `op`, a display `label`, its schema and its children, but not its parameters as separate texts.
3. **Check the statements.** Accepted: `query`; named relations `N := { }`; `source ... from generator`; inline tables. Refused, each listed with its position: `connection`, `source` from database, CSV, JSON, HTTP, Mongo, GEDCOM or log (TOOLKIT T3), `import` (no files), `def` (user functions; v1 does not import them), `env`, `relate`, `namespace`. A refused source is offered as "bind `Orders` to an input tab", never done automatically.
4. **Build the recipe.** The chosen `query` (the last one by default, or the one picked in the import dialog) becomes the main line. At each binary node the left child continues the main line (`pipe: "left"`) and the right child becomes a slot lane. `FIX` and `ITERATE` get `base` and `step` lanes. A named relation used once is inlined; one used twice is offered as a saved relation, or duplicated. A relation name that the script does not define becomes `relix:input tab=<name>`, and the dialog asks which tab it is.
5. **Unsupported nodes.** `optimize` and `cover exact` import as steps that fail at build, with their text kept.

**The round trip (R7's done-when, made precise).** For a recipe of `relix:` steps and sources only, `import(view(r))` equals `r` after normalising every parameter text through the engine printer and every binary step to `pipe: "left"` (mirror operators swapped back where the original had `pipe: "right"`). Byte steps, layout and the lost items of §9.1 are outside the identity. A golden list of such recipes is the test.

---
## 10. Help text

The Relix reference pages are the help text (TOOLKIT §8.2, §12). The pack does not rewrite them.

### 10.1 Source

- The pages live in `relix-core`'s `docs/reference` and ship in the `relix-docs` artifact (`relix-docs/build.gradle`: every `**/*.md` except `functions/**` and `README.md`, read through `ReferenceLookup`). Function pages are served by their libraries (`FunctionLibrary.documentation`).
- Forge does not run Gradle. The `relix-web` build reads the pages from the pinned `relix-core` version and writes one file, `relix-reference.json`: for each doc key, the page as plain text, split into its `#` sections (`Name`, `Syntax`, `Description`, `Technical Description`, `Examples`, `See Also`, and so on). It records the `relix-core` version and commit.
- The page format is the reference's own (`# Name:`, `# Syntax:`, ...), so splitting needs no heuristics.

### 10.2 Into `help.json` and the catalogue

The generator (§4.8) reads `relix-reference.json` and the operator table and writes the `META:` clauses of each generated word. RECIPES §2.7's `buildHelp` then puts them into `help.json` with no change to it.

| Field | From |
|---|---|
| `doc` (catalogue) | The first paragraph of `# Description:`, as plain text, cut at a sentence end to at most 2,000 code points (LANGUAGE §5.9). |
| `use-when` (help) | The operator's line in `operators-by-task.md`, which is already written "in a question's words". At most 160 code points, one line. Where the page has none, a short Forge-written line in the operator table. |
| `param` help | Short Forge-written labels in the operator table. The reference has no per-parameter text to copy. |
| `see-also` | The `# See Also:` links of the page, mapped to `relix:` words where a page is an operator page. |
| `link` | None in v1. `link` needs an `https` URL (LANGUAGE §5.9). When the owner names a public URL for the reference, the generator adds one link per page. |
| `examples` (help) | Op vectors with the `example` key (RECIPES §9.1). The generated vectors of §12.3 mark the first worked example of each page as an example. This needs the help format to carry the vector's setup steps (T22), which SP2 owns. |
| The full page | Shown by the help dialog from `relix-reference.json`, loaded lazily with the pack, as plain text with `textContent`. Markdown is not rendered (UI.md §4, rule 6): headings and code blocks are shown as plain blocks. |

`fl.*` functions get their documentation from the FL op's own `doc` (§6.3), so Relix tools that read `FunctionLibrary.documentation` see Forge's text.

### 10.3 Licence

`relix-core` is Apache-2.0, "Copyright 2026 Darkcollective, LLC" (`LICENSE.txt`, `NOTICE`). The reference pages are in that repository under that licence. Forge is Apache-2.0 under the same owner. Copying the pages' text into Forge's build output is allowed. The pack's `NOTICE` names Relix and the `relix-core` version the text came from. The TeaVM supplement file in `relix-web` keeps its own Apache-2.0 header and attribution (R0 §4).

---

## 11. Security

### 11.1 No ambient capabilities

- **The engine has no I/O.** The browser assembly leaves out `relix-embed` and every connector (§1.3). There is no HTTP, file or database code in the chunk. A generated script that named such a source would fail with "no connector".
- **The chunk talks to the page through a fixed interface.** It exports run, check, print, decompose and fill entry points, and calls back only the poll and nothing else. There is no general host callback and no `eval`. R0's `relixHost(name, args)` callback is replaced by the cache of §6.5: the engine never calls FL.
- **The `fl` library reaches only catalogue ops**, under the bake's trust level and limits, the same capability model as op steps (PLAN §5). No op with a `key` parameter is exposed, and no op with a `+random` or `+time` effect. The pack declares no capability label of its own; if `RunOptions.deny` (TOOLKIT P6) denies an effect, an FL op that needs it fails as it would in a step.

### 11.2 Untrusted shared recipes

A shared recipe is untrusted. Its Relix content is text in parameters, compiled by the engine's parser, not code. The risks and the defences:

| Risk | Defence |
|---|---|
| A clause that breaks out of its place (`1=1 (T) }; source X from http {...}; query { π x (T`) | The clause is syntax-checked on its own (§2.3.1): the wrapper parse must end where the clause ends (`expectEnd`). After the full script is printed, `decompose` checks that it holds only the statement kinds the pack writes (§9.2 step 3). And the build has no connectors. Three layers. |
| A query that runs too long or uses too much memory | §8 limits, cancellation and the watchdog. |
| A recipe that calls a user word that is not there | `unknown-op` or "Unknown function", as for any op. |
| Text shown to the user (engine messages, help, schemas, column names) | Plain text with `textContent` (UI.md §4 rule 6). Column names from data are never markup. |
| A recipe that names `relix:` ops when the pack is off | The pack-enable offer and notice (TOOLKIT §5.2, P5). |

### 11.3 Metadata as text

All metadata the pack produces (`doc`, `use-when`, `param`, reference pages, engine messages) is plain text. The generator strips Markdown to text; nothing is rendered as HTML or Markdown.

### 11.4 The CSP

- The JavaScript backend uses no `eval` and no `new Function`. R0 ran 380 examples and the benchmarks under the production CSP (`infra/site.tf`, COOP and COEP as in `serve-prod.mjs`) with no violation, and a positive control showed the detector works (R0 §6).
- The chunk is a same-origin, hashed ES module loaded with `import()` inside the existing bake Worker: `script-src 'self'` and `worker-src 'self'` cover it. Nothing in the CSP changes.
- Wasm GC stays out until TeaVM's Wasm runtime no longer builds functions with `new Function` (T15). `'wasm-unsafe-eval'` does not cover that.

### 11.5 Own crypto code

`MD5`, `SHA1`, `SHA2` and `HASHBYTES` run on a pure-Java digest supplement in the browser (R0 §4, risk 3). Forge has hashing in FL. This document keeps the supplement (routing every built-in hash through the bridge would cost a batch round) and holds it to Forge's vectors in the cross-check of §12.5.

---

## 12. Testing

### 12.1 The reference corpus as a conformance suite

From R0 (§5), made permanent in `relix-web` CI (R11):

- **Extract** every `relix` and `relix-invalid` block of the reference, with the page's earlier blocks as context (R0's `extract_corpus.py`).
- **Run** each example on the JVM (the unpatched engine, through the same shim) and in a headless browser (the TeaVM build), and compare the result JSON exactly: rows, order, column names, types, decimal scale. Documented-error examples must be refused with the same message.
- **Thresholds (T12).** At least 95% of the self-contained examples identical. All decimal, date and time, and regex examples identical (R0 criterion 3). The build fails below either.
- **Expected differences.** A checked-in list, `expected-differences.json`. The build fails when a difference appears that is not on the list, **and when one on the list disappears** (so a fix is recorded). The starting list, from R0 §5 and T11:

| Example | Cause | Status |
|---|---|---|
| `language/collate.md#2` | `COLLATE 'en-US'` refused (patch 0001) | accepted limit (T11) |
| `operators/roll.md#1` | seeded `Random.nextInt(bound)` differs | accepted limit (T11) |
| `operators/shuffle.md#1` | seeded `Collections.shuffle` differs | accepted limit (T11) |
| `language/introspection-version.md#1` to `#4` | version string "unknown" | removed when the shim passes the version (R1a) |

- **Probes.** R0's eight extra probes (variance, hashes, wide decimals) and SP6's seeded-random probes (§1.4) join the suite, because the corpus covers those areas thinly.
- **Run in the pack's CI too.** The pack's CI runs a fixed subset in Node against the built chunk on every change, and the full browser run nightly.

### 12.2 The operator table

- **Coverage.** Every concrete `RelNode` kind has a row or an entry in §4.7. The exhaustive switch in `relix-web` enforces it at compile time; a test in Forge checks `operators.json` against a kind list that `relix-web` exports.
- **Spelling.** Every keyword is in `Lexer.reservedWords()`, every glyph is the one `Spelling` prints.
- **Round trip.** For each row, the generator prints a sample node from the row's parameters; the engine parses it, and printing it again gives the same text.
- **Reference.** Each row's doc key exists in `relix-reference.json`, and the first example of its `# Syntax:` block parses.
- **Generation.** `gen:relix --check` (§4.8).

### 12.3 Op vectors for `relix:` words

Every `relix:` word needs vectors (RECIPES §9). A word that takes a relation needs a relation to run on, and the vector format has only a byte input. T22 adds a **setup-steps** field; its name and shape are SP2's. This document writes it as `setup`:

```json
{
  "name": "select keeps the rows that match",
  "ref": "relix-core docs/reference/operators/select.md#1",
  "op": "relix:select",
  "params": { "cond": "age > 18" },
  "setup": [
    { "op": "relix:inline", "params": { "table": "| name | age |\n|---|---|\n| Ann | 30 |\n| Bob | 12 |" } }
  ],
  "input": { "value": "", "enc": "utf8" },
  "expect": { "json": { "$ext": "table", "text": "<the table's faithful text form>" } }
}
```

(Illustrative. The field names, how `setup` composes with `input`, and how a table output is compared are SP2's and D2's.)

**Generated from the reference.** A script turns the reference examples into vectors: for each operator page, each example whose expression is one operator over inline tables becomes a vector for that operator's word, with `ref` set to the page and example. The JVM result is the expected value. Each row except `optimize` gets at least one vector this way; the rest are hand-written (bounds, nulls, empty inputs, errors).

**Terminals and sources** get hand-written vectors: `relix:run` with nulls and every column type of §5; `relix:explain` and `relix:optimized` compared after removing estimates; `relix:schema`; `relix:>text` in both spellings; `relix:parse` with a free name; `relix:input` with each format.

### 12.4 The bridge and the session

- **Value mapping.** Property tests over §5: integers at and beyond 2^53, decimals with long fractions and with trailing zeros, strings with astral characters and lone surrogates, nested structs and arrays, every date and time type, carriers, case-colliding keys.
- **NULL.** A NULL argument returns NULL with no FL call (a call counter proves it). A nested NULL is refused.
- **Batching.** Depth 1, 2 and 3 calls; the number of rounds; deduplication (FL calls equal distinct tuples); an FL error on a row the final query filters out does not fail the query; an error it reaches fails it with the FL code and the right path; `maxRounds` and `maxFlCalls`.
- **Cancellation.** Set the flag during an engine run and during a batch: `E_ABORTED` within 50 ms (proposal) and the Worker answers the next bake. Deadline: `E_LIMIT_TIME`.
- **Limits.** Each engine knob of §8.1 fires and maps to its code.
- **Security.** The injection cases of §11.2.

### 12.5 Cross-checks and gates

- **Forge against Relix built-ins** (TOOLKIT C1): Forge's hash, regex, string and date vectors run through the matching Relix built-ins, and the reverse. A throwaway script; differences are listed and resolved or recorded.
- **JVM bridge** (TOOLKIT J3): the same `fl.*` names and mapping through `relix-fl`.
- **CSP and size.** The e2e suite loads the pack under the production headers (`serve-prod.mjs`) and checks for no CSP violation; `npm run size` checks the chunk against the pack budget (3 MB gzip, T12).
- **Speed.** Cold start and the 10,000-row join (T12) are measured in the nightly browser run, not in CI, because timings vary.

---

## 13. Decisions

| ID | Decision | Reason |
|---|---|---|
| RX1 | One pack `relix`, one vocabulary `relix`, kinds `relation` and `relix-expr` owned by the pack; `table` is core. The engine is a lazy ES-module chunk loaded inside the existing bake Worker. | T7, T21; the app's Worker is an ES module Worker (§1.5). |
| RX2 | A `relation` is a tree built by words; terminals print it as Relix text (keyword spelling) and the engine parses it. No AST JSON is exchanged. "Parse-free" (TOOLKIT §8.1) is a later optimisation. | The engine has no AST-from-JSON entry and Relix text is its interchange format (TOOLKIT §2.6). Parsing is small next to the 0.57 s first-query cost. |
| RX3 | `relix-expr` is checked in two tiers: a small shared shape check, and the engine's parser in the Worker. | T20 asks for one shared module; the real parser is Java (§2.3); no third parser (TOOLKIT §12). |
| RX4 | The operator table has 52 rows (29 unary, 2 base-and-step, 21 binary), one word each; 51 usable in the browser. | §4, from the source. |
| RX5 | Implicit lift and implicit run are inserted by the recipe compiler and marked `implicit`; only an op that takes `table` triggers a run. | A VM coercion is synchronous; a run may await FL. |
| RX6 | FL is called by discover, batch, replay, with a cache in the engine and NULL handled by the bridge. | T14; works for nested and computed arguments; no engine change (§6.5). |
| RX7 | **Q2: `fl.<vocab>.<word>`, hyphens as underscores.** | Parses today, reversible, no clash (§6.2, probes). |
| RX8 | **Q3: bytes cross as the struct `{ bytes_hex }`;** STRING is accepted for a `bytes` input as UTF-8. | Type-safe composition; hex text is ambiguous (§5.6). |
| RX9 | **Q5: `rat` yes, chosen by the declared slot type only;** NUMBER from `rat` only for terminating decimals; no `rat` columns. | Exact, and costs nothing with the pack off (§5.5). |
| RX10 | Tables cross as decimal text in v1; the `table` kind gains `origin` and a `json` column (D2 asks). | Exactness first; types survive a round trip (§2.1, §5). |
| RX11 | The operator table lives in Forge (`packs/relix/gen/operators.json`) until Relix publishes `relix.operators`; generated `.fth` is committed and checked. | 1.0 freeze; tests tie the table to the engine (§4.9). |
| RX12 | `optimize` and `cover exact` exist as words and fail at build in the browser. | Shared recipes still load and say why (T13). |
| RX13 | No new error codes. Relix errors map to existing codes with `detail.source = "relix"`, spans inside parameter text, and the step path from the script map. | `ErrorCode` is a closed frozen union; the codes fit (§7). |
| RX14 | Engine limits are set through `ExecutionContext` (as `relix-embed` does); cancellation reuses the bake's per-bake shared flag. | No new page mechanism; deterministic row budgets (§8). |
| RX15 | View as Relix is printed by the engine (`ScriptPrinter`); import uses a `decompose` helper with an exhaustive switch over `RelNode`. | One printer; new node kinds are caught at compile time (§9). |
| RX16 | Help text is generated from `relix-docs` pages into `META:` clauses and a lazily loaded plain-text reference file; nothing is rewritten. | TOOLKIT §8.2; UI.md rule 6 (§10). |
| RX17 | The conformance suite gates on 95% overall, 100% for decimal, date and regex examples, and on an exact expected-differences list. | T12, T11 (§12). |

---

## 14. Open questions

Each has a recommended answer. TOOLKIT's own questions come first.

| ID | Question | Recommended answer |
|---|---|---|
| TOOLKIT Q1 | Which Relix API additions come into 1.0? | **None into 1.0**; all after, in this order: (1) `relix.operators` (§4.9); (2) public fragment parsers (condition, projection list, sort keys, group list; RQ4); (3) span ends and structured diagnostics with a reason code; (4) a public execution entry that takes limits and a cancellation poll without `relix-embed` (makes patch 0006 a documented host poll); (5) a Value-to-JSON or columnar result writer; (6) per-operator actual row counts in the event feed; (7) parameter names in `relix.functions`. Forge works without any of them. |
| TOOLKIT Q2 | Naming of FL ops in Relix | **Decided: `fl.<vocab>.<word>`** (RX7). |
| TOOLKIT Q3 | Bytes: tagged struct or hex text? | **Tagged struct `{ bytes_hex }`** (RX8). |
| TOOLKIT Q5 | `rat` for NUMBER with the symbolic pack? | **Yes, by declared slot type only** (RX9). |
| TOOLKIT Q6 | Should Relix's non-pushdown built-ins later delegate to FL? | **No.** Both keep their implementations, held together by shared vectors (C1). Delegation would make JVM Relix depend on GraalJS for core functions, against T2's "optional". Revisit only if C1 finds differences that cannot be closed. |
| TOOLKIT Q9 | Exotic operators in the browser | **Decided (T13).** Confirmed by this document: `optimize` out, `cover` partial, `solve` in (SP6 probe), seeded forms as §1.4. |
| TOOLKIT Q11 | Where does `relix-fl` live? | **Its own repository, `DarkCollective/relix-fl`**, like `relix-web`. It keeps GraalJS and its licence out of every engine build, and it consumes the published engine like any third-party library. |
| RQ1 | `relix:input` is `( -- relation )` here (as briefed), with a `format` parameter and the core parsers. RELIX-LANES §2.1, §6 and §9.1 treat an input tab as `bytes` and follow it with byte steps and Parse CSV. Which? | **Keep `( -- relation )` for `relix:input`** and give bytes-first lanes a core op that reads a tab as bytes (X5's to name, for example `input:tab ( -- bytes )`). RELIX-LANES §9.1's first step then becomes that op. SP2 and the orchestrator settle the name with this document. |
| RQ2 | Per-step row counts (R8): from the engine's events or by count queries? | **Start with count queries on demand** (`γ COUNT(*)` over the step's prefix, run when the user asks for a step's count), and use the event feed's row metrics where they exist. Ask Relix for per-operator counts (Q1 item 6). |
| RQ3 | Decimals that do not fit a double in a result: text column (this document) or a decimal column in D2? | **Text column with `origin` in v1**; a `dec` column only if users hit it. |
| RQ4 | Fragment parsing uses wrapper templates (§4.2). Acceptable until Relix has public fragment parsers? | **Yes.** The templates are tested per shape (R5a); the ask is Q1 item 2. |
| RQ5 | Slots for `FIX` and `ITERATE`: names and the pipe rule | **Slots `base` and `step`; the data above may feed `base` only; the `step` lane is always explicit and starts with `relix:recur`.** SP2 decides. |
| RQ6 | Does "include data" in View as Relix belong in v1? | **Yes, with a 200-row cap per table** (proposal): it makes the text runnable in JVM Relix for small examples. |
| RQ7 | The seeded-random limit (T11): fix now? | **Fix `nextInt(bound)` and `Collections.shuffle` in the supplement** when R1b next touches it; SP6's probes suggest it is small (size S, estimate). T11 allows deferring it. |
| RQ8 | A "try" form that turns an FL error into NULL? | **Not in v1.** If wanted, a parallel family `fl.try.<vocab>.<word>` generated from the same list. |

---

## 15. Work packages

These refine TOOLKIT §13.6's R-rows. Ids keep the TOOLKIT number and add a letter where a row splits. Files are proposals; the brief of each WP fixes them. Sizes are relative estimates. Agents: **So** (Sonnet) for spec-critical work, **Ha** (Haiku) for well-specified work. All of Phase T4 waits for Gate T1 (and X1, D2, X5 where listed). `relix-web/*` paths are in the `DarkCollective/relix-web` repository (T16).

| WP | Scope | Files (proposal) | Depends on | Size | Agent | Done when |
|---|---|---|---|---|---|---|
| R1a | Session shim: register tables once, run with an `ExecutionContext` carrying the §8 limits and poll, terminals (`explain`, `optimized`, `schema`, JSON forms), structured diagnostics, fragment check (§2.3.1), print and normalise (§9.1), `decompose` (§9.2), the `fl` cache library (§6.5), version string | `relix-web/shim/*` | R0, Gate T1 | L | So | Every entry point has JVM and browser tests; the version examples leave the expected-differences list; limits fire with their codes |
| R1b | Build: patch series check per Relix release, supplements module, ES-module wrapper, hashed artifact, size gate, NOTICE | `relix-web/scripts/*`, `relix-web/patches/*`, `relix-web/classlib/*` | R0 | M | So | A clean build from a published engine produces the module; patches apply or the job fails; size at most 3 MB gzip |
| R2a | `operators.json` and its schema, first drafted by script from `RelNode` and the reference, then completed by hand (help lines, shapes, categories) | `packs/relix/gen/operators.json`, `operators.schema.json` | SP6 | M | So | All 52 rows of §4; the coverage, spelling and reference tests of §12.2 pass |
| R2b | Generator: `.fth` with `META:`, printer table, help source; `--check` mode | `packs/relix/gen/*.ts`, `packs/relix/vocab/relix-ops.fth` | R2a | M | Ha | Generated output committed; `gen:relix --check` in CI; the round-trip test of §12.2 passes |
| R3 | `relation` and `relix-expr` kinds (payload, text, equality, `sizeOf` with conformance tests, viewer data); sources and terminals; `_node` primitive | `packs/relix/src/kinds/*`, `packs/relix/vocab/relix.fth`, `packs/relix/prims/relix.ts` | R1a, R2b, X1, D2 | L | So | Vectors of §12.3 for every source and terminal pass; X1's kind conformance passes for both kinds |
| R4 | Table interchange (§5.3) with `origin` and `json` columns; implicit lift and run inserted by the compiler (§2.4); end-of-recipe run | `packs/relix/src/interchange/*`, compiler hook per SP2 | R3, D2, SP2 | M | So | Every column type and nulls round-trip; the trace shows `relation -> table` |
| R5a | Tier-1 shape check module; the wrapper templates of §4.2, tested per shape | `packs/relix/src/expr-check/*` | R1a | S | So | Each shape: valid samples pass, invalid ones report the right column |
| R5b | Tier-2 check through the Worker (`ext.check`), completion from schema and catalogue, the field UI | `packs/relix/ui/*` | R5a, X3, X5 | M | So | A bad expression shows its position before the bake; completion offers columns and `fl.*` names |
| R6 | Nested-lane UI | as RELIX-LANES §11 | SP2, R3 | as RELIX-LANES | So | as TOOLKIT |
| R7a | View as Relix (§9.1), both spellings, lost-content list, include-data option | `packs/relix/src/view/*`, `apps/web` view hook | R1a, R3 | M | So | Golden texts for the example recipes; the lost-content list is shown |
| R7b | Import (§9.2) with the statement check and binding dialog | `packs/relix/src/import/*`, `apps/web` dialog | R7a | M | So | The round-trip identity of §9.2 holds on the golden list; refused statements are listed with positions |
| R8 | Per-step schema (from analysis) and on-demand counts (RQ2) | `packs/relix/ui/*` | R3, X5 | S | Ha | Schema on every Relix step; a count on request |
| R9a | `fl` exposure rules (§6.3), names (§6.2), value mapping both ways (§5) | `packs/relix/src/fl-bridge/map.ts`, `exposure.ts` | R1a, R4 | M | So | The property tests of §12.4 pass; the exposure report lists every excluded op and why |
| R9b | Discover, batch, replay loop (§6.5), errors (§7.5), limits | `packs/relix/src/fl-bridge/batch.ts` | R9a | M | So | The batching tests of §12.4 pass; a query over 10,000 rows calls an FL op once per distinct value |
| R10 | `relix-reference.json` and help generation (§10) | `relix-web/scripts/reference.*`, `packs/relix/gen/help-*.ts` | R2b | S | Ha | Every row has `doc` and `use-when` from the reference; the help dialog shows the page as plain text |
| R11 | Conformance harness and expected-differences gate (§12.1); vectors generated from the reference (§12.3) | `relix-web/harness/*`, `packs/relix/test/*` | R1a, R1b, SP2 (vector format) | M | Ha | The pass rate is reported against T12; a change in the differences list fails the job |
| R13 | Pack manifest and budget, lazy load in the bake Worker, cancellation wiring (shared flag, poll, deadline), `needsHardKill` for engine-running words | `packs/relix/manifest.*`, `packages/worker` hook per P2 | R1a, P2 | M | So | Cancellation tests of §12.4 pass; the pack loads lazily under the production headers |
| R14 | Security tests (§11.2): injection, text rendering, refused statements | `packs/relix/test/security/*` | R3, R7b | S | Ha | Every case of §11.2 has a test |

TOOLKIT's R12 (the TypeScript fallback engine) is dropped: R0 passed (T9).

Dependency sketch:

```
 R0 -> R1a, R1b
 R1a -> R2a -> R2b -> R3 -> R4 -> R9a -> R9b
 R1a -> R5a -> R5b (needs X3, X5)
 R3 -> R6, R7a -> R7b ; R3 -> R8 ; R2b -> R10 ; R1a, R1b -> R11 ; R1a -> R13 ; R3, R7b -> R14
```

---

## 16. Changes needed in other documents

This document does not edit them. The orchestrator applies or briefs these.

**TOOLKIT.md**

1. §8.1: `relix:why` is an operator (`WhyNode`, `Relation.why()`), not a terminal; the terminals are `run`, `explain`, `optimized`, `schema`, `>text`, `parse`. Add the sources `relix:input`, `relix:inline`, `relix:generate`, `relix:unit`, `relix:empty`, `relix:recur`. Implicit run is inserted by the compiler and triggered only by ops that take a table (RX5). "Parse-free" becomes a later optimisation (RX2).
2. §8.2: 52 operators: 29 unary, 21 binary, 2 base-and-step with slots `base` and `step`. Point to RELIX.md §4.
3. §8.3 and T11: the seeded forms are `ROLL`, `SHUFFLE`, `SAMPLE p` and `SAMPLE n ROWS`; SP6 probes show `ROLL` (uniform) and `SHUFFLE` differ, the others matched.
4. §8.4: library `fl`, naming decided (RX7); mapping table replaced by RELIX.md §5; the NULL rule is the bridge's (the engine passes NULL to functions); "planner hoists" replaced by discover, batch, replay (RX6); table-valued words through ARRAY and `μ`, because the SPI has no table-valued functions.
5. §14.2: Q2, Q3, Q5 decided; recommendations for Q1, Q6, Q11 as in §14.
6. §13.3: SP6 done. §13.6: R-rows replaced by §15 (R1 split into R1a and R1b, R2 into R2a and R2b, R5, R7 and R9 split, R12 dropped, R13 and R14 added). §13.11's count changes accordingly.

**Other specifications**

7. **D2** (`table`): an optional `origin` annotation per column, and a `json` column kind (§2.1).
8. **X1**: nothing beyond T18 and T19. (The kind-to-kind lift is done by the compiler, not the VM.)
9. **X3 / X5**: the helper contract may return a promise; a generic `ext.check` request from the page to the bake Worker; per-step input schema in the bake result (already T20).
10. **SP2**: `ParamSpec` marking of slot parameters; slots `base`/`step` for `FIX`/`ITERATE` (RQ5); compiler insertion of `relix:from` and `relix:run` marked `implicit`; the `setup` field of op vectors and help examples (T22); `needsHardKill` for engine-running words; the 4,096-character limit for `relix-expr` text.
11. **SP3 / UI.md**: the relation viewer (text, schema line), the help dialog's plain-text reference view, the "unavailable in the browser" badge for `optimize`.
12. **SP4 / PACKS.md**: a pack whose chunk is an ES module loaded inside the bake Worker; the pack's `NOTICE`.
13. **SP1**: how FL holds JSON `null` (decides nested NULLs, §5.4).

**RELIX-LANES.md**

14. §2.1, §6, §9.1: the type of `relix:input` (RQ1). §2.1's v1 binary list stays a subset of §4.5. `lateral` has only the relation form.

**R0 result (a record, not to be edited)**: its criterion-8 note on NULL (§5.4) and its seeded-random list (§1.4) are superseded by this document.
