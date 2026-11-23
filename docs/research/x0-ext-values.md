# X0: extension values, a spike (result)

Status: result of spike X0, 2026-11-23. Throwaway prototype; the code is on branch `wp/x0` and is not to be merged. This document is the only thing meant to be kept. It answers [TOOLKIT.md](TOOLKIT.md) §13.2 (row X0) and de-risks the rows X1, X2, X3, D2 and D3 of §13.5.

Code commit: `0f6b9a7` on `wp/x0`. This document: the commit after it, which touches only this file.

## Contents

1. Verdict
2. What was built and proved
3. The `ext` value, the registry and the header syntax
4. The table kind: layout and measured size
5. Rendering: the output value and the viewer protocol
6. The parameter kind: design, JSON and URL encoding
7. Frozen-contract changes
8. CSP findings
9. Test results
10. Risks and open questions for the owner
11. Suggested refinement of X1, X2, X3, D2 and D3

---

## 1. Verdict

**The X0 shape is accepted for X1, X2, X3, D2 and D3, with the amendments in §11.** A recipe of Parse CSV over a pasted CSV input bakes, the output pane shows a table viewer, and a second step with an `ext{relix-expr}` parameter filters it. This ran in the built app served with the production headers (`node apps/web/scripts/serve-prod.mjs`), in the light, dark and high-contrast themes, with no CSP violation, no console message and no axe violation (§9).

Nothing in the spike contradicts the plan in TOOLKIT §6 and §7. Five things came out that the plan does not say, and they change the work packages (§10 and §11):

1. The registry cannot be per runtime without a bigger change to `@forge/lang` than X1 describes, because `equals`, `sizeOf` and `repr` are module functions with no runtime handle. The spike used a process-wide registry. A registration must be idempotent by name (last one wins), because one pack module is evaluated twice when two entry points load it.
2. A catalogue op's `input` and `output` are a bare `ParamType`, so `ext{table}` is just `ext`. The type badges of RELIX-LANES §6 and the fit rules need the kind.
3. `ext` parameter completion needs the **schema of the data entering that step**. The bake protocol reports only the final output (and the paused data), so the spike completes from the last bake output. A per-step schema in the bake result is a protocol change that X3 depends on.
4. A kind's `sizeOf` is called by the VM each time a value is produced, so it must be O(1). The spike caches it.
5. The csv reader that exists today builds a list of lists of `str` first. That transient is what limits a CSV to between 40,000 and 60,000 rows of 10 cells under the untrusted 16 MiB limit, not the table (§4). D1 should parse straight into columns.

## 2. What was built and proved

| Piece | Where | Proved by |
|---|---|---|
| `ext` value tag, kind registry, `ext{kind}` header | `packages/lang/src/{types,ext,values,meta,primitives,vm}.ts` | `packages/ops/src/table.test.ts`; the existing lang suite and conformance unchanged |
| `table` kind, `relix-expr` kind | `packages/ops/src/table/table.ts` | same |
| Words `table:from-csv`, `to-json`, `to-csv`, `filter`, `to-expr` | `packages/ops/vocab/table.fth`, `src/prims/table.ts` | unit tests and the e2e spec |
| `OutputValue` kind `ext` | `packages/worker/src/{types,render}.ts` | e2e |
| Viewer registry and table viewer | `apps/web/src/io/{viewers,table-view}.ts`, `forge-output.ts` | e2e, axe in three themes, screenshots |
| `ext` parameter field with live check and column names | `apps/web/src/params/{ext-widgets,forge-param-form}.ts` | e2e |
| Recipe layer accepts an `ext` parameter | `packages/recipe/src/validate.ts` | e2e (share URL round trip) |

The e2e spec is `apps/web/e2e/x0-ext.spec.ts`. `apps/web/playwright.x0.config.ts` only points it at the Chromium installed in the sandbox. Screenshots at deviceScaleFactor 1 are in `docs/research/x0-shots/` on the spike branch.

## 3. The `ext` value, the registry and the header syntax

### 3.1 The value

```ts
type Value = ... | { tag: "ext"; kind: string; v: unknown };
```

`kind` names a registered kind and `v` is the kind's payload. The brief and TOOLKIT §6.1 call the payload `payload`; the spike calls it `v` like every other tag, because several guards in `primitives.ts` and `vm.ts` test `"v" in x`. X1 can rename it, but then those guards change too. `Tag` gains `"ext"`.

Payloads are opaque to the VM and must be immutable. They never cross to the main thread: only what a kind's `view` returns does (§5).

### 3.2 The kind and the registry

```ts
interface ExtKind<P> {
  kind: string;                                   // [a-z][a-z0-9-]*
  equals(a: P, b: P): boolean;
  sizeOf(p: P): number;                           // O(1)
  toText(p: P, max: number): string;
  fromText?(text: string): P;                     // throws ForgeError E_COERCE
  view?(p: P, o: { maxRows: number }): unknown;   // structured-clone-safe, for a viewer
}
registerExtKind(kind); getExtKind(name); listExtKinds(); ext(kind, payload); extText(kind, payload, max)
```

How the VM uses it:

- **Equality.** `equals` in `values.ts` compares `kind` first, then calls the kind's `equals`. An unregistered kind compares by identity.
- **Size.** `sizeOf` charges `16 + kind.sizeOf(payload)`. The VM's `meter` (`vm.ts`) reaches the registry through `sizeOf`, so `maxValueBytes` and `maxTotalBytes` apply with no VM change. By code reading, not by test: the unit test that a table over the limit fails goes through the primitive's own guard, not through the VM meter. X1 should test the meter with a primitive that does not guard.
- **Text form.** `repr` and `display` call `toText`. Inside a container the text is cut to the remaining budget. An unregistered kind prints `<ext kind>`.
- **Registry scope.** Process-wide, module level. `equals`, `sizeOf` and `repr` are free functions exported from `@forge/lang` and used by the VM, the worker renderer and tests. A per-runtime registry (`RuntimeOptions.extKinds`, as TOOLKIT §6.1 says) would need a runtime handle in all three. That is a larger change than X1 lists. See §10, R1.
- **Registration is last-wins.** The first version threw `E_REDEFINED` on a second registration of a name. `packages/ops/src/sources.test.ts` failed, because `@forge/ops` (dist) and `@forge/ops/vite` or `/node` (src) each evaluate the pack module. The spike now replaces the earlier registration silently. X1 must decide this on purpose (§10, R2).

### 3.3 The header syntax

`ext{kind}` is a parameter type, in the same style as `choice{a|b}`:

```
: filter ( t:ext{table} expr:ext{relix-expr} -- ext{table} ) ... ;
```

- Allowed on inputs, on outputs (`name:ext{kind}` or bare `ext{kind}`), and on the data input. A bare `ext` is `E_HEADER` ("'ext' needs a kind"). A kind that is not `[a-z][a-z0-9-]*` is `E_HEADER`. Defaults and constraints on an `ext` slot are `E_HEADER`.
- `ParamType` gains `"ext"`. The kind is carried in `StackSlot.options[0]`. That is a shortcut: it reuses the field that `choice`, `toggle` and `key` use, and it made `slotText` and the JSON schema work for free. X1 should add a dedicated `kind` field instead (R3).
- The canonical text round-trips: `( t:ext{table} expr:ext{relix-expr} -- ext{table} )` parses and prints identically (tested, strict mode).
- The metadata JSON Schema (`meta.schema.json`) lists `"ext"` in `paramType`.

### 3.4 Coercion and the primitive boundary

- A value of the right kind passes. A value of another kind is `E_TYPE` ("expected ext{table}, got ext{relix-expr}"). Any other tag is `E_TYPE`.
- A `str` given to an `ext{kind}` slot is parsed with the kind's `fromText`. A bad text is `E_COERCE` with the kind's own message and column. The coercion is recorded in `RunResult.coercions` as `str -> ext`. This is the whole recipe-to-VM path for an `ext` parameter (§6).
- A primitive whose slot is `ext{kind}` receives the bare payload and returns the bare payload. The call boundary tags it with the slot's kind. A primitive typed `any` sees and returns whole values.

## 4. The table kind: layout and measured size

### 4.1 Layout

```ts
interface TablePayload { rows: number; columns: Column[] }
interface Column {
  name: string;
  type: "str" | "num" | "bool";
  data: string[] | Float64Array | Uint8Array;   // by type
  nulls: Uint8Array | null;                     // bit i set = row i is null; null when there are none
}
```

Numbers are `Float64Array`, so integers beyond 2^53 are not representable. A prototype limit; D2 needs an `int` column (BigInt64 or a decimal-string fallback). Booleans use one byte a row (bit packing would be a D2 choice). Strings are a JS array. The size charge assumes an offsets-and-bytes layout (`4 * rows + 2 * chars`), which is what D2 should build if it wants the charge to be true.

`sizeOf = 16 + sum over columns(16 + 2 * name.length + cells + null mask)`, cached per payload, because the VM meters a value every time it is produced.

### 4.2 Measured size (10,000 rows by 10 columns)

Measured with the real `sizeOf` of `@forge/lang` and `tableSize`:

| Representation | Bytes | Per cell |
|---|---|---|
| list of records, 10 integer keys `c0..c9` | 2,880,000 | 28.8 |
| ten FL lists, one per column (the "columnar" figure of §2.4) | 1,600,080 | 16.0 |
| **`table` ext, 10 `num` columns** | **800,216** | **8.0** |
| `table` ext, same, one column with nulls (+ mask) | 801,466 | 8.0 (+1,250 per nullable column) |
| `table` ext, 10 `bool` columns | 100,216 | 1.0 |
| `table` ext, 10 `str` columns of 8 characters | 2,000,216 | 20.0 |
| list of records, 10 `str` keys, 8 characters | 3,680,000 | 36.8 |

- The columnar figure of TOOLKIT §2.4 (1.6 MB) is matched exactly by "ten FL lists", and the typed table is **half of it**. Done when D2 says "near the §2.4 columnar figure": it is at or below it for numbers and booleans, and 1.25 times it for 8-character strings (2.0 MB against 1.6 MB; strings are the expensive column in any layout).
- The list-of-records figure measured here is 2.88 MB, not the 4.08 MB of §2.4. I used two-character key names; §2.4 evidently used longer ones (408 B a row means about 8 characters a key). The ratio to columnar holds either way.
- The null mask costs `ceil(rows / 8)` bytes, and only on a column that has a null.

### 4.3 CSV in and JSON out

`table:from-csv` reuses the RFC 4180 reader of the `csv` vocabulary (`csv:_parse`), so quoted cells, doubled quotes and embedded line breaks are right. It is naive in these ways, all for D1 to replace:

- An empty cell is null. An empty string and null cannot be told apart from CSV (the existing reader does not report whether a cell was quoted).
- Type inference is all or nothing per column: every non-null cell a number, or every one `true` or `false`, else `str`. No dates, no integers, no locale.
- A header that repeats a name, or a row longer than the header, is `E_COERCE`. A shorter row is padded with nulls.
- Comma and CRLF, LF or CR only. No delimiter parameter, no header-less mode.
- Numbers go through `Number()`, so `007` is 7 and the text is lost.

Output: `table:to-json` (an array of objects: numbers are numbers, booleans are booleans, nulls are null) and `table:to-csv` (plain header, null as an empty cell). The text form used for `repr` and the viewer fallback is CSV with a typed header (`name:str,age:num`) and is lossy for null against empty string, so the table kind has no `fromText`.

Timings in Node, warm: `from-csv` of 10,000 rows by 10 numeric columns (599 KB) 50 to 116 ms, `to-json` of the result (1.1 MB) 13 ms.

**The transient limit.** `csv:_parse` returns a list of lists of `str`, charged at about 24 bytes plus 2 per character a cell. Under the untrusted `maxValueBytes` of 16 MiB, `table:from-csv` succeeded at 40,000 rows by 10 short cells (2.7 MB of CSV) and failed with `E_LIMIT_VALUE` at 60,000 rows, although the finished table would be 4.8 MB. The table is not the limit; the intermediate list is. D1 should parse into column buffers directly. The CSV text itself also counts: a `str` is 2 bytes a character, so a 4 MB CSV is an 8 MB value before parsing starts.

## 5. Rendering: the output value and the viewer protocol

### 5.1 Worker side

```ts
OutputValue = ... | { kind: "ext"; extKind: string; text: string; view?: unknown }
```

`render.ts` handles an `ext` value like this: `text` is `extText(kind, payload, 4000)` (cut, with `...`), and `view` is `kind.view(payload, { maxRows: 100 })` when the kind has a `view`. The `table` view is

```ts
{ columns: { name, type }[], rows: (string | null)[][], total: number }
```

with the first 100 rows as text cells (`null` for a null). That is structured-clone-safe, so the worker protocol, `port.ts` buffer transfer and the vector JSON need no change. `outputToJson` gives `{ $ext: kind, text }`. A kind with no `view` still renders: the UI shows `text`. An unregistered kind (a pack that is not loaded) renders `<ext kind>`.

100 rows by 10 columns is about 1,000 short strings to clone, negligible. A virtualised grid (D3) will need a way to ask for more rows; see §11.

### 5.2 Page side

`apps/web/src/io/viewers.ts` is a registry: `registerViewer({ kind, render(output) => HTMLElement })`. `renderExt(output)` picks the viewer for `output.extKind`. It falls back to a `<pre class="text scalar" tabindex="0">` of `output.text` when there is no viewer, no `view`, or the viewer throws. `forge-output.ts` calls it with one added line and Lit renders the node.

The table viewer (`table-view.ts`) is a custom element `forge-table-view` with an open shadow root:

- DOM built with `createElement` and `textContent`; no `innerHTML`, no template parsing, no `style` attribute.
- One constructable stylesheet (`adoptedStyleSheets`) built from a string, using only the tokens of `tokens.css` (`--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--focus`, `--space-*`, `--font-mono` and so on). Custom properties pass into the shadow root, so the three themes work with no per-theme code.
- A summary line ("4 rows, 3 columns", plus "showing the first 100" when cut), a scrolling region (`role="region"`, `tabindex="0"`, labelled), a sticky header row and a sticky row-number column. Column types are shown under the names. Numbers are right-aligned. Nulls are shown as italic muted `null`.
- A cell is cut with an ellipsis after 24rem, so a long string cannot widen the grid without bound.

Screenshots (deviceScaleFactor 1): `docs/research/x0-shots/table-light.png`, `table-dark.png`, `table-contrast.png`, and `filter-params.png`.

### 5.3 What the spike left alone

The pane's footer still says "Type: ext" and the left pane says "Data here: extension value". With kinds it should say `ext{table}` and "table". "Move to input" is disabled for an ext output (it has no bytes). Copy and Download use the text form (typed CSV for a table). A proper table download (JSON or CSV) is a D3 item.

## 6. The parameter kind: design, JSON and URL encoding

### 6.1 Design

`ext{relix-expr}` is a parameter type whose value is the kind's **text form**. In the catalogue, the `expr` parameter of `table:filter` is `{ name: "expr", type: "ext", options: ["relix-expr"], required: true }`.

- **Recipe JSON.** The value is a string: `{ "kind": "op", "op": "table:filter", "params": { "expr": "age > 30 and name <> \"Bob\"" } }`. The recipe validator (`checkParamValue`) accepts a string of at most 4096 characters for an `ext` parameter. It cannot run `fromText`, because `@forge/recipe` has no kind registry; the text is checked when the recipe bakes and live in the field.
- **FL text.** `compileRecipe` needed no change. Its default branch writes the string literal: `"age > 30 and name <> \"Bob\"" table:filter`. The VM coerces the `str` to `ext{relix-expr}` with `fromText` (§3.4).
- **Share URL.** Nothing new: the recipe JSON is the payload. A recipe with the filter step encoded to a 317-character fragment, decoded to the same JSON (with the usual per-op `hash` pins), and opened in the app showed `age > 30` in the field and the filtered table in the output. The e2e spec does this.
- **Errors.** A bad text is `E_COERCE` from `fromText` ("cannot convert str to relix-expr: expected a value at column 6"). An unknown column is `E_PARAM_INVALID` from the word ("no column 'height' (columns: name, age, active)"). Both are normal bake errors with the step path.

### 6.2 The field

`forge-param-form` renders an `ext` parameter as the existing text input plus two things from a per-kind helper registry (`params/ext-widgets.ts`):

- a **live check**: "Valid.", or the problem ("No column "height". Columns: name, age, active.", "Expected a value.");
- **column buttons** fed from the schema of the table, one per column with its type, which append the name to the text.

The check is a stub (about 50 lines) written for the spike. It repeats the grammar of the worker-side `parseExpr` in a smaller form, on purpose: the web app imports only types from `@forge/ops`, and importing the main entry would blow the 250 kB budget. The real design must ship **one** validator that the worker kind and the page widget both load (§10, R6).

### 6.3 Where the schema comes from

The spike uses the final output of the last bake when it is a table. That works for "Parse CSV, then Filter" because Filter keeps the schema, and it fails for a step in the middle of a pipeline, or before the first bake. The data entering a step is available only while the bake is paused (`BakeState.paused.data`). X3 needs the bake result to carry a per-step output schema (a small `schema?: {name, type}[]` on `StepReport`, filled by the kind's `view`). This is a `@forge/worker` protocol change and is the main new dependency of X3 (§11).

### 6.4 Not tried

Nested or tree-valued parameters (RELIX-LANES §9), a register-fed `ext` parameter, and a structured builder widget. A register can already feed an `ext` parameter as a string through the existing reference mechanism, but it was not tested.

## 7. Frozen-contract changes

Every edit under `packages/*`. "Additive" means no existing export, type member or behaviour changes for code that does not use `ext`. "Source-breaking" means code that switches exhaustively over the type no longer compiles until it handles the new member.

| File | Export or type | Change | Kind |
|---|---|---|---|
| `packages/lang/src/types.ts` | `Tag` | adds `"ext"` | source-breaking (exhaustive `Record<Tag, ...>` and switches) |
| `packages/lang/src/types.ts` | `Value` | adds the variant `{ tag: "ext"; kind: string; v: unknown }` | source-breaking |
| `packages/lang/src/types.ts` | `ParamType` | adds `"ext"` | source-breaking |
| `packages/lang/src/types.ts` | `StackSlot.options` | doc comment only (also holds the ext kind) | additive |
| `packages/lang/src/ext.ts` | new file: `ExtKind`, `registerExtKind`, `getExtKind`, `listExtKinds`, `ext`, `extText` | new exports | additive |
| `packages/lang/src/index.ts` | the six exports above | added | additive |
| `packages/lang/src/values.ts` | `coerceTracked` | new optional 4th parameter `extKind`; handles `ext` targets | additive |
| `packages/lang/src/values.ts` | `equals`, `repr`, `display`, `sizeOf`, `validate` | an `ext` branch each | additive |
| `packages/lang/src/meta.ts` | `parseHeader`, `slotText` | parse and print `ext{kind}` | additive |
| `packages/lang/src/meta.schema.json` | `paramType` enum | adds `"ext"` | additive |
| `packages/lang/src/primitives.ts`, `vm.ts`, `errors.ts` | internal tag sets | add `"ext"`; `callPrimitive` result conversion for `ext` slots; the VM passes the kind to `coerceTracked` | additive |
| `packages/lang/test/conformance/parse.ts` | `TAG_TABLE: Record<Tag, true>` | add `ext: true` | test-only, forced by the `Tag` change |
| `packages/ops/src/types.ts` | `UI_PARAM_TYPES` | adds `"ext"` | additive (the list is asserted in `catalogue.test.ts`, which changed) |
| `packages/ops/src/types.ts` | `CatalogueOp` | new optional `inputKind`, `outputKind` | additive (present only for ext slots) |
| `packages/ops/src/catalogue.ts`, `catalogue.schema.json` | `buildCatalogue` output | writes and allows the two fields | additive; changes `catalogue.version` as any new op does |
| `packages/ops/src/catalogue.test.ts` | `constants` test | expects `"ext"` in `UI_PARAM_TYPES` | test-only |
| `packages/recipe/src/validate.ts` | `checkParamValue` | `case "ext"` | additive |
| `packages/worker/src/types.ts` | `OutputValue` | adds the `ext` variant | source-breaking (four exhaustive switches in `apps/web` had to change) |
| `packages/worker/src/render.ts` | `renderValue`, `outputToJson` | `ext` branches | additive |

New non-frozen files (vocabulary and kinds): `packages/ops/src/table/table.ts`, `packages/ops/src/prims/table.ts`, `packages/ops/vocab/table.fth`, `packages/ops/src/table.test.ts`.

App edits outside `packages/*` that the changes forced: `apps/web/src/ops/fit.ts` (adds `ext` to the value types and a noun), `apps/web/src/bake/format.ts` and `apps/web/src/io/output-model.ts` (an `ext` case in three exhaustive switches).

No change was needed in `packages/recipe/src/{compile,literals,normalise,share}.ts` or in `packages/worker/src/{protocol,port,core}.ts`.

## 8. CSP findings

The production CSP is the one in `infra/site.tf`: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; ...`. The shared Playwright fixture fails a test on any console message, page error, failed request or `securitypolicyviolation` event. All seven spike tests passed under it.

- **Constructable stylesheets are allowed.** `new CSSStyleSheet()` with `replaceSync(text)` and `shadowRoot.adoptedStyleSheets` raised no violation under `style-src 'self'`. This is the route for a viewer that lives in a shadow root and must bring its own styles. A `<style>` element or a `style=` attribute would be blocked, as UI.md §4 says.
- **Custom elements and open shadow roots** are not restricted. Axe reported nothing for the page including the grid.
- **DOM built by script** with `createElement` and `textContent` is fine, and it is also the safe way for untrusted cell text: cell text is never parsed as markup. I did not add a hostile-cell test; it should be in X2's tests.
- **Dynamic styling.** The viewer needs no per-element dynamic style. A virtualised grid (D3) positions rows, which needs the CSSOM route of `forge-hex-view.ts` (`el.style.setProperty`), not a `style` attribute.
- **Fallback if `CSSStyleSheet` is missing** (Safari before 16.4): the sheet is skipped and the grid is unstyled but readable. A real viewer should degrade deliberately, for example by exposing the same rules as a static `css` template in a Lit element.
- **Kinds and viewers come from our origin.** Nothing in the spike loads code from data. A pack viewer must be a same-origin module (`script-src 'self'`). A viewer loaded lazily by a pack (P8) is an ordinary dynamic `import()` of a same-origin chunk and passes.
- **Worker.** The worker already loads its kinds through the lazy primitive chunks. `table.ts` is bundled into the `table` vocabulary chunk, so the kind exists in the worker exactly when the vocabulary is loaded. No new worker file, no `blob:` worker.

I did not test: a viewer that draws on a `<canvas>` (media pack), `blob:` image or audio URLs (needs `media-src blob:`, TOOLKIT §5.5), or Trusted Types (not enabled in the CSP).

## 9. Test results

Run on the spike branch at the code commit, in the sandbox (Node 22, Chromium from `/opt/pw-browsers`).

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass: 373 files, 9,273 tests (the 11 new tests are in `packages/ops/src/table.test.ts`, plus 8 vectors in `packages/ops/vocab/table.test.json`) |
| `npm run build` | pass |
| `npm run size` | pass: core and UI shell 122.39 kB gzip of the 250 kB budget |
| `x0-ext.spec.ts` (7 tests) against the production build served by `scripts/serve-prod.mjs` | pass, no console message, no CSP violation, axe clean in light, dark and high contrast |
| `npm run e2e` (whole suite, sandbox Chromium) | 283 passed, 44 skipped, 36 failed: see below |

**What the unit run caught on the way** (three failures on the first full run, all fixed on the branch):

1. `catalogue.test.ts` "constants" asserts the exact list `UI_PARAM_TYPES`. It now lists `"ext"`. (A contract list, so it is a frozen-contract change, §7.)
2. `sources.test.ts` "the package entries share one module graph" failed with `ext kind 'table' is already registered`: the registry threw on a repeated name. Registration is now last-wins (§3.2, R2).
3. `vectors.test.ts` "every op is covered" requires a vector for every catalogue op. Vectors bake one step on bytes, so an op whose data input is a table (`to-json`, `to-csv`, `filter`) can only be given an `E_TYPE` vector; the real tests are in `table.test.ts`. A vector with setup steps would fix that (§11, X1 or a test-format item).

The vector JSON form of an ext output, `{ "$ext": kind, "text": ... }`, worked as the way to state an expected table: it compares the kind's text form.

**The 36 failing e2e tests.** 35 of them fail only on `requestfailed: .../favicon.svg net::ERR_ABORTED` raised by the shared fixture (34 in `ops-smoke.spec.ts` and one in `persist.spec.ts`). Re-running three of them alone, two passed and one failed the same way, so they are flaky here and not caused by the spike. The fixture excuses an aborted `/assets/*.js` chunk but not an aborted favicon; the sandbox Chromium is the full browser and not the headless shell the project's Playwright expects. I did not run the suite on the base commit, so "not caused by the spike" rests on that sample and on the message. The 36th, `reference.spec.ts` "the index lists every operation", asserted 461 operations and the table vocabulary adds 5. The constant is changed to 466 in the code commit; that file was not run again.

Not run: `npm run gate2:browser -w @forge/worker`, and the per-theme screenshots of the parameter form.


## 10. Risks and open questions for the owner

| # | Risk or question | Why it matters | Suggested answer |
|---|---|---|---|
| R1 | Process-wide registry against a per-runtime registry | `equals`, `sizeOf` and `repr` are free functions. A per-runtime registry means passing a handle through `ValueHelpers`, the VM, the renderer and every helper user. It also gives two runtimes in one page (baker and console worker) separate kinds, which is correct but means each must register. | Accept a process-wide registry for X1, keyed by name. Revisit only if two packs want different definitions of one kind name. Owner decision. |
| R2 | Duplicate registration | The same pack module is evaluated twice when two entries load it (dist and src in the tests). A throwing registry breaks `sources.test.ts`. | Last wins, silently, for the same name. A pack that registers a kind another pack already owns should be refused at the manifest level (P1), not at run time. |
| R3 | The kind is stored in `StackSlot.options[0]` | It works and it reuses the printer, but `options` also means choice options. Code that treats `options` as a list of choices (the param form for `choice`, `catalogue`) must remember `ext`. | X1 adds `StackSlot.kind` and `ParamSpec.kind`. |
| R4 | Source-breaking union changes | `Tag`, `Value`, `ParamType` and `OutputValue` each gained a member. Exhaustive switches in `apps/web` (4 sites) and one conformance table stopped compiling. Any other consumer of the frozen types, such as a JVM bridge or the CLI of J0, hits the same. | Treat X1 and X2 as a contract version bump at Gate T1 (TOOLKIT §14.1, risk 6), as already planned. |
| R5 | Kind-blind type checks | `fit.ts` and the type badges compare tags, so every `ext` fits every `ext` slot (a `relix-expr` output would look valid input for a table step). RELIX-LANES §6 needs `table` against `relation` against `bytes`. | The catalogue carries `inputKind` and `outputKind` (done). `fit.ts` and the badges must compare kinds. Put that in X2. |
| R6 | Two validators for one grammar | The worker-side `fromText` and the page-side live check are separate code. They will drift. The web app cannot import `@forge/ops` at run time (size budget). | A kind ships its parser as a small, dependency-free module in the pack. Worker and page both import that one file (a second entry of the pack chunk). Decide with P1 (manifest) what a pack exports to the page. |
| R7 | Per-step schema | See §6.3. | Add `schema` to `StepReport` or to a new per-step result in the bake protocol. It belongs with X5 (named inputs), which already changes `protocol.ts`. |
| R8 | `sizeOf` cost and honesty | The VM meters every produced value. A kind that is slow or under-reports breaks the limit guarantee. | Contract: O(1), a conservative upper bound, cached. Add a conformance test per kind (X1): size is stable across calls and at least the bytes the payload holds. |
| R9 | Memory of a viewed table | The worker keeps the table alive only for the bake. The page receives 100 rows. A virtualised grid that scrolls needs rows after the bake. | Either keep the last output table in the worker (a second message type, `rows(from, count)`) or accept first N only for 1.0. Owner decision for D3. |
| R10 | Table text form is lossy | Typed CSV cannot distinguish null from an empty string, so `table` has no `fromText` and cannot be a parameter. A saved or shared table input needs a faithful form. | D2 defines a faithful text form (JSON with a column header and null) before a table can be an input tab or a `relation` literal. |
| R11 | No integer column | `num` is a double. CSV ids above 2^53 lose digits (the existing `csv` ops keep text). | D2: add `int` (BigInt64 or text-backed) and a `str` fallback rule when a column does not fit. |
| R12 | Parameter helpers run on the page, kinds run in the worker | An `ext` parameter that needs the kind's code on the page (completion) needs that code shipped to the main thread, which the pack system treats as a lazy chunk. | Part of R6. |
| Q-A | Is the table in core or a pack (TOOLKIT Q4)? | The spike put the kind in `@forge/ops` as an ordinary vocabulary and it needed no pack machinery. The viewer is in `apps/web`. | The spike supports "core": the cost is one vocabulary chunk plus a small viewer. |

## 11. Suggested refinement of X1, X2, X3, D2 and D3

Dependencies stay as in TOOLKIT §13.5. Each item below is an amendment to the "Deliverable" or "Done when" column.

**X1 (`ext` tag core).**
- Own also `packages/lang/src/ext.ts` (new), `primitives.ts`, `vm.ts`, `errors.ts`, `meta.schema.json` and the conformance table. The brief says `types.ts`, `values.ts`, `meta.ts` only.
- Add `StackSlot.kind` and `ParamSpec.kind` in place of `options[0]` (R3).
- Decide registration semantics (R2) and registry scope (R1) in the brief, with a test that a module evaluated twice registers cleanly.
- Add the kind conformance test of R8 and make `ExtKind.sizeOf` contract O(1).
- Add `ext` coercion: `str` to `ext{kind}` through `fromText`, and the `E_TYPE` rules of §3.4.
- Done when: v0.1 conformance unchanged (it was, after the one-line table change), header round-trips, an `ext` value passes through `list`, `record` and `fork` (**not tested in the spike**, add it), and `maxValueBytes` and `maxTotalBytes` apply.

**X2 (`OutputValue` ext and viewer registry).**
- Add `kind` awareness to `fit.ts`, the card badges and the operations-pane "Data here" line (R5).
- Define the viewer contract as in §5.2 (`render(output) => HTMLElement`, fallback to `text`), and write down the shadow-root and adopted-stylesheet rule (§8) in UI.md §4.
- Fix the footer and "Move to input" for ext outputs; define Copy and Download per kind (an optional `download(output)` on the viewer or `view`).
- Done when: unknown kinds fall back to text (spike: tested), DOM without `innerHTML` (spike: yes), the viewer passes axe in three themes (spike: yes), and a viewer that throws does not hide the value (spike: yes by design, not tested).

**X3 (`ext` parameters).**
- Depends on a per-step schema in the bake result (R7). Either add it to X3 or make X5 provide it first.
- `@forge/recipe` stays kind-blind: a string, length-limited (done). Validation is the kind's `fromText` at bake plus the widget.
- Define the helper contract (`check(text, schema) => {ok, message}`, optional `complete`) and where the helper code lives (R6, R12).
- Done when: an `ext` parameter round-trips recipe JSON, FL text and the share URL (spike: yes, all three), and the field reports a bad text before the bake.

**D2 (`table` kind).**
- Replace the prototype: an `int` column, a faithful text form, bit-packed booleans, a `date` or `time` column later (R10, R11).
- Keep the size charge honest: the spike's `4 * rows + 2 * chars` for strings assumes an offsets-and-bytes buffer that the spike did not build.
- Measure the target at 10,000 rows by 10 columns: at or below 0.8 MB for numbers (spike), 2.0 MB for 8-character strings.
- Done when: equality, size, text and view are tested, and `table:to-json` and `table:to-csv` round-trip a table with nulls.

**D3 (table words and viewer).**
- Start from the spike's `forge-table-view` (about 200 lines). Add: virtualised rows through the `forge-hex-view` CSSOM route, a rows-on-demand message or a stated first-N limit (R9), column resizing and keyboard cell navigation (`role="grid"`), sort for display only.
- Move the type badge and the "Parse CSV above" hint of RELIX-LANES §6 here or to X2.
- Done when: the grid shows the first N rows with the total (spike: yes), contrast passes in three themes (spike: yes), and a 100,000 row table scrolls without freezing.

**D1 (not in the brief, but affected).** Parse straight into column buffers, report whether a cell was quoted (so null and empty string differ), and do not build the list of lists of `str` (the 40,000 to 60,000-row ceiling of §4.3). The spike's `table:from-csv` works only up to that ceiling.

**P8 (demo pack).** The spike is a usable demo: `table.ts` is a kind, `table-view.ts` is a viewer, `ext-widgets.ts` is a parameter helper, and the three register by import. P8 should take exactly those three registration points as its manifest.
