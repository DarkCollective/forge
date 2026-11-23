# UI amendments for the toolkit programme (SP3)

Status: **proposal, 2026-11-23, not normative.** This is work package SP3 of the toolkit programme ([TOOLKIT.md](TOOLKIT.md) §13.3). It is for the owner to approve at Gate T1. Until it is approved and its work packages have landed, [UI.md](UI.md) describes the shipped app and wins on every point. This file does **not** edit UI.md. It follows the precedent of [RECIPES-1.1.md](RECIPES-1.1.md) and [RECIPES-1.2.md](RECIPES-1.2.md): a separate proposal first, approval by the owner, implementation by work packages, and only then a fold-in. Each work package that lands updates UI.md for what it shipped, as the earlier packages did, and the last one turns this file into a historical note.

It says, section by section, what each later work package will change in UI.md. The one exception to "later" is §7, the CSP text, which is written out in full so that the owner can approve it now.

## What it builds on

- [UI.md](UI.md): §1 layout and tokens; §2.3 the panes (operations pane type fit and content tier, recipe pane drag and drop, parameter form, input and output panes, bake controller and share dialog, registers and return); §3 contracts (state, tree paths, the pointer drag service); **§4 the CSP rules**; §6 testing (the e2e fixture and the axe audit).
- [TOOLKIT.md](TOOLKIT.md): §3 decisions T9 to T34; §4 architecture; §5 packs; §6 extension values and viewers; §7 the table; §8 the Relix pack; §10 media and code packs; §13.3 to §13.6 the work packages; §14 risks and questions.
- [RELIX-LANES.md](RELIX-LANES.md): the lane and slot design, and its open editor questions (Q1, Q4 and the second point of Q5).
- [RECIPES-1.2.md](RECIPES-1.2.md): ext parameters (§3), slots (§4, §5), named inputs and the per-step schema (§7), pack ops (§8), the share URL (§11), and §19.2, the list of UI.md edits that file asks for.
- [RELIX.md](RELIX.md): the kinds (§2), `input:tab` and `relix:input` (§3), errors and spans (§7), View as Relix and import (§9), help text (§10), and the asks of SP3 (§16, item 11).
- [research/x0-ext-values.md](research/x0-ext-values.md) (§5 the viewer contract, §6 the parameter field, §8 the CSP findings, §10, §11) and [research/r0-relix-in-browser.md](research/r0-relix-in-browser.md) §8 (the CSP and Wasm GC).

## Shared names

These names are fixed across SP1 (language), SP3 (this file) and SP4 (packs). This file uses them as given and does not define them.

- The value tag `ext{kind}`, and the kinds `table`, `relation`, `relix-expr` and `rat`.
- Pack ids are lower-kebab-case (`relix`, `symbolic`, `media`, `code`).
- The issue codes `pack-not-enabled` and `packs-needed`, and the type `PackIndex` (RECIPES-1.2 §8).
- The ops `input:tab` and `relix:input`, and the parameter name `tab`.
- The pack **manifest** is defined by PACKS.md (SP4). This file uses only what a person sees: a pack has an id, a name, a one-line summary, a size, a state (off or on) and a list of the kinds and vocabularies it adds. Where the UI needs a field from the manifest, §6.7 lists it as an ask of SP4.
- The language (FL v0.2) is SP1's. This file never depends on a word of it.

## Contents

1. Viewers
2. Kind-aware type fit, badges and the "Data here" line
3. Ext parameter fields
4. The lanes and slots UI
5. Named inputs and the share dialog
6. Packs in the UI
7. The CSP amendments
8. Errors from Relix
9. Smaller items and a list of UI.md edits by section
10. Accessibility and test list
11. Open questions, with recommendations
12. Work package mapping
13. Edits needed in other documents

## How to read the sections

Each of §1 to §8 starts with a short box, **UI.md changes**, that lists the UI.md sections the change touches. The rest of the section holds the proposed rules. Sketches are ASCII. A sentence with "must" is a proposed rule for the work package. A sentence with "recommend" is a choice for the owner. File names are proposals, as in the earlier proposal files, and each work package brief fixes them.

---

## 1. Viewers

**UI.md changes.** §1.1 (the Output pane line of the region table); §2.2 (new files under `src/io/`); §2.3 WP 3.5 (Output: a new `ext` branch, the toolbar and the footer); §4 rule 6 (§7.3); §6 (tests).

An output value of tag `ext` has no built-in look. A **viewer** draws it. The contract is X0 §5.2, made precise here. The worker side is X2 (`OutputValue` gains the `ext` variant, `{ kind: "ext", extKind, text, view? }`). This section is the page side.

### 1.1 Where a value is shown

The output pane draws an `OutputValue` in four places today, and a viewer must work in all four:

| Place | What it is | `ViewerContext.place` |
|---|---|---|
| The output | The final value of a successful bake | `"output"` |
| The error panel's partial output | `result.partial` of a failed bake | `"partial"` |
| The paused data | `bake.paused.data`, the value that enters the next step | `"paused"` |
| The register list | A register's value in the paused view (UI.md, "Registers and return") | `"register"` |

A register value that is `ext` is drawn inside a collapsed `<details>` whose summary reads, for example, "table, 3 columns", so a long list of registers stays short.

### 1.2 The contract

```ts
// apps/web/src/io/viewers.ts (proposed)
type ExtOutput = Extract<OutputValue, { kind: "ext" }>; // { kind: "ext"; extKind: string; text: string; view?: unknown }

interface ViewerContext {
  readonly place: "output" | "partial" | "paused" | "register";
  readonly compact: boolean; // ui.compact
  readonly signal: AbortSignal; // aborted when the node is removed: revoke URLs, stop timers
}

interface Viewer {
  readonly kind: string; // the extension kind this viewer draws
  readonly noun: string; // what people call it: "table", "relation", "rational number"
  render(output: ExtOutput, ctx: ViewerContext): HTMLElement; // may throw
  copyText?(output: ExtOutput): string; // default: output.text
  download?(output: ExtOutput): { filename: string; mime: string; bytes: Uint8Array } | null; // default: output.text as UTF-8
  /** Ops that turn this kind into bytes. They offer "Convert to bytes" in the toolbar (§1.5). */
  bytesOps?: readonly { op: string; label: string }[];
}

registerViewer(viewer: Viewer): void; // idempotent, last one wins (as the kind registry, T18)
renderExt(output: ExtOutput, ctx: ViewerContext): HTMLElement; // never throws
```

Rules for the contract:

1. **One viewer per kind.** The registry is keyed by kind name. Registering twice is allowed and the last one wins, because a module can be evaluated twice (X0 R2). A viewer for a kind that another pack owns is refused where the manifest refuses it (P1), not here.
2. **`render` returns one `HTMLElement`.** The host appends it to the output body. The host owns the toolbar, the footer and the error panel. A viewer never draws those.
3. **`output.text` is always there.** It is the kind's text form, cut at 4,000 characters with `...` (X0 §5.1). A viewer may ignore `view`, and a kind with no `view` is drawn by the text fallback (§1.3).
4. **A viewer is pure with respect to the page.** It reads `output` and `ctx`. It does not fetch, read the store or call actions. Anything it needs from the app comes in through `ctx`. This keeps a viewer testable and keeps a pack's UI code inside rule 13 of §7.3.
5. **Where viewers come from.** The `table` viewer is core. It lives in `src/io/table-view.ts` and loads on the first table output with a dynamic `import()`, so it is outside the start-up bundle (UI.md §7). A pack registers its viewers when its UI chunk loads (§6.3). Until a viewer is registered, the kind is "unknown" (§1.3).

### 1.3 The text fallback, and a viewer that fails

`renderExt` picks the viewer for `output.extKind`. It falls back to the **text fallback** in four cases, and each says why in one plain sentence above the text:

| Case | Sentence |
|---|---|
| No viewer is registered for the kind (its pack is off or its chunk has not loaded) | "No viewer for `<kind>` is loaded. Showing the text form." |
| The kind has a viewer but the output has no `view` | none: the text form is the normal look |
| The viewer module is still loading | "Loading the viewer for `<kind>`. Showing the text form." (replaced when it arrives) |
| The viewer threw, or returned something that is not an `HTMLElement` | "The viewer for `<kind>` failed. Showing the text form." |

The fallback is `<pre class="scalar" tabindex="0">` with `output.text` as a text node. It is the same element the X0 spike used. When `text` was cut, the sentence "Showing the first 4,000 characters." is added (see Q2 in §11 for the flag that tells the page).

A viewer that throws **never hides the value.** `renderExt` calls `render` in a `try`. It does not log to the console (the e2e fixture fails on any console message, UI.md §6), and instead it calls `actions.announce("The viewer for <kind> failed. Showing the text form.")` once per output. A viewer that fails later, in an event handler, is its own bug: viewers catch their own handler errors and say so in their own node.

An unknown kind is not an error. A recipe opened while its pack is off can still hold a value of that kind only if the pack was on when the bake ran, so the case is rare. It still has to be tidy.

### 1.4 Text only, built by script

Viewers follow rule 6 of §4, as amended in §7.3: DOM from `createElement`, `createTextNode` and `textContent`; no `innerHTML`; one adopted stylesheet from a string literal; per-element dynamic values through the CSSOM; the colour, size and font tokens of `tokens.css` only. The hostile-input tests of §10 run every viewer with `<img src=x onerror=alert(1)>`, `</script>`, a very long unbroken word, a right-to-left override character and a lone surrogate in every text field the viewer shows (cell, column name, kind text).

### 1.5 Copy, Download and Move to input, per kind

The toolbar keeps the three buttons of WP 3.5. What they do for each kind of value:

| Kind | Copy | Download | Move to input |
|---|---|---|---|
| `bytes` | the text or the hex (as now) | the bytes (as now) | as now |
| `str`, `int`, `num`, `bool` | the text | `forge-output.txt` | as now |
| `list`, `record`, `other` | the described text | `forge-output.txt` | disabled (as now) |
| `ext` | `viewer.copyText`, else `output.text` | `viewer.download`, else `output.text` as `forge-output.txt` | **replaced** by **Convert to bytes** (below) |

**Copy and Download never silently give less than the value.** For an `ext` value the page only holds `output.text`, which is cut at 4,000 characters. When the text was cut, the Copy and Download buttons say so in their accessible name ("Copy the first 4,000 characters", "Download the first 4,000 characters") and the live region repeats it when they act. The complete data is reached by turning the value into bytes.

**Convert to bytes.** An `ext` value has no bytes, so "Move to input" cannot work (X0 §5.3 left it disabled). Rather than a dead button, the toolbar shows a **Convert to bytes** menu (`forge-menu`, as the More menu) when the viewer declares `bytesOps`. Each item adds that op at the end of the main line with `actions.addOp` and announces it: "Added Table to CSV at the end of the recipe. The output is now bytes." After the next bake the output is `bytes`, and Copy, Download and Move to input work in full. For `table` the items are **Table to CSV** (`table:to-csv`) and **Table to JSON** (`table:to-json`). For `relation` the recipe compiler already ends a recipe with `relix:run` (RECIPES-1.2 §6.9), so a relation reaches the output pane only in a paused view or a register, and there is no menu. Kinds with no `bytesOps` (`relix-expr`, `rat`) show Copy and Download of the text form, and no menu.

### 1.6 The footer and the "Type" readout

The footer shows `Type: ${value.kind}` today, which for an `ext` value would read "ext". It becomes `Type: ext{table}` (the kind in braces, as the header syntax writes it), with the viewer's `noun` for the aria text: "Type: table". The length readout stays "Length: N bytes" for bytes only. For a table the footer adds the shape that the viewer states in its own summary line (§1.7), not a second copy of it.

### 1.7 The table viewer (D3)

D3 ships **the first N rows with the total and a stated limit** (T21). Rows on demand are deferred (R9). The worker sends `view = { columns: { name, type }[], rows: (string | null)[][], total }` with the first 100 rows as text cells, and `null` for a null (X0 §5.1). So N is 100 for 1.0.

```
 Output                                    [Copy] [Download] [Convert to bytes v]
 ---------------------------------------------------------------------------------
 12,408 rows, 4 columns. Showing the first 100 rows.          <- summary, always visible
 +---+----------+-----------+-----------+---------+
 |   | id       | name      | country   | total   |           <- sticky header
 |   | int      | str       | str       | num     |           <- the type under each name
 +---+----------+-----------+-----------+---------+
 | 1 |        1 | Aroha     | NZ        |  120.50 |
 | 2 |        2 | Ben       | null      |   87.00 |           <- null: italic, muted, the word "null"
 | 3 |        3 | ""        | AU        |    0.00 |           <- empty text: muted, two quote marks
 | . |      ... |           |           |         |
 +---+----------+-----------+-----------+---------+
 To see the rest, add a step that selects fewer rows.         <- only when total > shown
```

**The summary line** is part of the viewer and always visible. It states the shape and, when the table is cut, the limit: "12,408 rows, 4 columns. Showing the first 100 rows." When nothing is cut: "4 rows, 3 columns." For zero rows: "No rows, 3 columns." The numbers use `toLocaleString("en-US")` as the rest of the pane does. The hint under the grid appears only when the table is cut.

**The grid.** The table is `role="grid"` with:

- `aria-label="Table, 12,408 rows, 4 columns"` and `aria-describedby` pointing at the summary line, so the limit is read with the grid.
- `aria-rowcount` and `aria-colcount` set to what is **in the DOM and reachable**: the shown rows plus the header, and the shown columns plus the row-number column. Not the total. A screen reader that said "row 3 of 12,408" would imply that row 5,000 is reachable, and it is not. The limit sentence carries the total.
- `aria-rowindex` and `aria-colindex` on every row and cell, so that windowing (below) keeps positions right.
- A header row of `role="columnheader"` cells. Each cell's text is the column name, and the type is a second line inside the same cell, so the accessible name reads "price, num".
- A first column of row numbers, each `role="rowheader"`, counting from 1.
- Cells are `role="gridcell"`. Numbers (`int`, `num`) are right-aligned. Nothing else is aligned by type.

**Keyboard.** The ARIA grid pattern with a roving tabindex: one cell is in the tab order, Tab leaves the grid, and the Output pane's own toolbar stays reachable. Arrow keys move by cell. Home and End go to the first and last cell of the row. Ctrl+Home and Ctrl+End go to the first and last cell of the grid. Page Up and Page Down move by the visible height. Ctrl+C on a focused cell copies the cell's text. There is no editing and no sorting (a sort of a 100-row sample of a larger table would show an order that the table does not have, so it is not offered in 1.0).

**Null and empty are different, and must look different** (X0 R10, T21). A null cell shows the word `null` in italic muted text and has `aria-label="null, no value"`. A cell holding the empty string shows two quote marks in muted text and has `aria-label="empty text"`. A cell holding the five characters `null` shows them upright and in the normal colour. The word and the italic are two cues, and colour is a third that is never alone.

**Long values.** A cell's full text is always in the DOM, and the width is limited by CSS: minimum 6 rem, maximum 24 rem, `text-overflow: ellipsis`. The accessible name is therefore complete. Copying a cell gives the complete text. A column of 256 (the cap, `RENDER_LIMITS.maxSchemaColumns`) scrolls horizontally inside the grid's own scroll region. The page itself never scrolls horizontally (UI.md §1.6).

**Windowing.** A table of at most 5,000 cells (shown rows times shown columns) is drawn whole, so find-in-page and screen-reader browse mode see every row. A larger one (100 rows by more than 50 columns) is drawn in a window of rows, by the same method as `forge-hex-view.ts`: a spacer sets the scroll height and the visible rows are placed with `el.style.setProperty` and `el.style.transform` from script, never a `style` attribute. The window arithmetic is a pure function (`windowRange(scrollTop, viewport, rowHeight, count, overscan)`) with unit tests. This keeps D3's "virtualised grid" done-when true while keeping the common case simple.

**Themes.** The viewer reads only tokens, and custom properties pass into the shadow root, so the three themes need no per-theme code. The header and row-number column use `--surface-2`. Borders use `--border` and become 2 px through `--border-width` in the contrast theme. The focus ring is `--focus-width` solid `--focus` with `--focus-offset`. A `@media (forced-colors: active)` block in the adopted sheet maps surfaces and text to `Canvas`, `CanvasText`, `GrayText` and `Highlight`, and keeps an outline on the focused cell. `prefers-reduced-motion` needs no rule: the viewer has no motion.

**No adopted-stylesheet support.** If `CSSStyleSheet` or `adoptedStyleSheets` is missing, the sheet is skipped. The grid is then unstyled but readable, which is what X0 §8 found. The viewer must **not** fall back to a `<style>` element, because `style-src 'self'` blocks it (§7.3, rule 6b).

**Compact layout.** At 390 px the grid scrolls inside its own region. Cell targets are at least 36 px high (UI.md §1.4).

### 1.8 The relation viewer (R3)

A `relation` is a lazy query. Its viewer shows the Relix text form in monospace and wrapping, one line that reads "N nodes", and, when `relix:schema` has run, a schema line "columns: id int, name str" (RELIX.md §2.2). It never runs the query. Below it, one sentence says what that means: "This is a query that has not run yet. A step that needs rows, or the end of the recipe, runs it." The text form is cut as any other (§1.5). The Copy button copies the text form, which is the Relix text of the expression with the table leaves shown by name and no data. This answers RELIX.md §16, item 11, for the relation viewer.

### 1.9 Other kinds

`relix-expr` and `rat` need no special viewer. The text fallback, with the normal look (no explanatory sentence, because a viewer for them is not expected), is their viewer. Kinds from later packs follow the same contract: `image` draws to a `<canvas>` or an `<img>` whose `src` is a `blob:` URL made by the viewer and revoked through `ctx.signal`; `audio` uses a native `<audio controls>` element, whose controls are accessible without work and never autoplay. Both need `media-src blob:` (§7).

---

## 2. Kind-aware type fit, badges and the "Data here" line

**UI.md changes.** §2.3 WP 3.2 ("Type fit", "Content tier" and the "Fits the data" filter); §2.3 WP 3.3 (the step card gains a type badge); §2.2 (`fit.ts` stays in `src/ops/`); §1.2 (no new token: the fit tokens exist).

Today `fit.ts` compares tags. A value of tag `ext` fits every `ext` slot, so a `relix-expr` would look like valid input for a table step (X0 R5). X2 makes `fit.ts`, the card badges and the "Data here" line compare **kinds**. The catalogue already carries `inputKind` and `outputKind` for ext slots (X0 §7), and a bake step report carries the kind of what the step left (RECIPES-1.2 §7.5, `StepReport.out`).

### 2.1 The data types

```ts
// fit.ts (proposed)
export type ExtType = `ext{${string}}`; // "ext{table}", "ext{relation}"
export type DataType = ValueType | ExtType | "unknown";
export interface Need { readonly type: ParamType; readonly kind?: string } // an op's data input: CatalogueOp.input and inputKind
export function fitLevel(need: Need, data: DataType, utf8?: Utf8State, conversions?: readonly CatalogueConversion[]): FitLevel;
```

The existing signature `fitLevel(opInput: ParamType, data, utf8)` keeps working for every non-ext call, so the unit tests of WP 6.21 still pass. `dataLabel` takes a `noun` from the viewer registry, or from the manifest's kind list (§6.7) when no viewer is loaded.

### 2.2 The rules

The traffic light keeps its three levels, marks and tokens (`--fit-yes`, `--fit-converts`, `--fit-no`). The new rows:

| The op needs | The data is | Level | Hint text |
|---|---|---|---|
| `any` | any `ext{k}` | green | none |
| `ext{k}` | `ext{k}` | green | none |
| `ext{k}` | `ext{j}` (`j` is not `k`), a conversion `j` to `k` is declared | green if it cannot fail and does no work (the `table` to `relation` lift); amber otherwise (the `relation` to `table` run) | "uses the table as a relation"; "runs the query first" |
| `ext{k}` | `ext{j}`, no conversion declared | red | "needs a `<noun k>`; this is a `<noun j>`" |
| `ext{k}` | `bytes`, `str`, `int`, `num`, `bool`, `list`, `record`, `file` | red | "needs a `<noun k>`" and, when the kind registers a repair, " Add `<op label>` first." |
| `bytes`, `str`, `int`, `num`, `bool`, `list`, `quot`, `record`, `file` | `ext{k}` | red | "needs `<type>`; this is a `<noun k>`" |
| anything | `unknown` | green | none (as now) |

The repair text comes from the kind's registration: the table kind registers `{ from: "bytes", op: "csv:parse", label: "Parse CSV" }`, so "needs a table. Add Parse CSV first." (RELIX-LANES §6). The repair is a hint, never an automatic edit.

**Why the lift is green and the run is amber.** The lift (`table` to `relation`) cannot fail and costs nothing. The run (`relation` to `table`) executes a query, can fail, and may be slow, so it earns the half disc and the hint. Both are also shown as a **coercion badge** (§2.4), because RELIX-LANES §6 says the conversions the compiler inserts are shown as a badge and not as a red mark. This is Q4 in §11.

**No content tier for ext values.** The content tier (WP 6.28) identifies bytes. It never runs for an `ext` value, and the "Data here" line never claims more than the kind's noun (§2.3).

### 2.3 "Data here"

The pane header states the type of the data at the end of the recipe (WP 6.1). With kinds:

| Source of the answer | Line |
|---|---|
| A finished, successful, non-stale bake whose output is `ext{table}` | "Data here: table (4 columns, 12,408 rows)" (the shape from `view`) |
| The same, from a step report with a schema but no `view` | "Data here: table (4 columns)" |
| The last step's declared `outputKind`, no bake | "Data here: table" |
| `ext{relation}` | "Data here: relation (lazy)" |
| An unregistered kind | "Data here: `<kind>` extension value" |

The line is the pane's header text, so it is read by a screen reader as the existing line is. It updates when the recipe, the bake or the catalogue changes, as now.

### 2.4 Badges on step cards

Step cards gain two small pieces (UI.md WP 3.3, the card header):

- **An output badge**: the type the step leaves, as text with a shape mark: `bytes`, `text`, `table`, `relation · lazy`. Before a bake it comes from the catalogue (`output`, `outputKind`). After a bake it comes from `StepReport.out` (`tag`, `kind`), so it is true for `fork` and other containers. The badge for a table with a known schema reads "table, 4 columns".
- **An input mark**: the fit level of this step's input against the data above, the same marks as the operations pane. It is shown only when the level is amber or red, so a correct recipe stays quiet. Its text is part of the card's accessible name ("Step 3, Select. Needs a table; the data above is bytes. Add Parse CSV first."). The data above comes from `dataSourcePath(recipe, path)` (RECIPES-1.2 §7.5): the output of the previous step, or, for the first step of a slot lane, the data entering the slot step.
- **A coercion badge**: when `planConversions(recipe, catalogue)` plans an insertion before this step, the card shows "table → relation" or "relation → table" with the word the compiler writes. After a bake, `StepReport.implicit` confirms what ran. The badge is informative, not a warning, and carries an accessible name that says "added for you".

`fit.ts` and these badges are the pure part of X2. `planConversions` is the one function the compiler, `recipeNeedsHardKill` and the editor share (RECIPES-1.2 §6.9), so the editor never decides a conversion on its own.

### 2.5 Inside lanes

The checks of RELIX-LANES §6 hold, using the same function: a slot lane is checked from its first step; a lane that starts with a source ignores the data it is given; a lane must end in `table` or `relation`. The message on a slot (not a card) says what to add: "The data above is bytes. Add Parse CSV above this step." or "This side ends as bytes. Add Parse CSV to it." These are page checks. The validator reports no `slot-type` (T24), and the bake's `E_TYPE` is the last defence.

---

## 3. Ext parameter fields

**UI.md changes.** §2.3 WP 3.4 (a new field type, `ext`; the helper registry; the live check); §2.3 WP 3.3 (a step card with `pack-not-enabled` shows no fields); §1.6 (no change: the field follows the existing validation rules).

A parameter whose type is `ext{kind}` carries the kind's **text form** as a JSON string (RECIPES-1.2 §3.2). The first and most important kind is `relix-expr`: a condition, a projection list, sort keys and so on (RELIX.md §2.3). X3 builds the field. R5b builds the Relix helper that plugs into it.

### 3.1 The field

`forge-param-form` renders `type: "ext"` as a new element, `forge-ext-field`, which wraps the existing text input and adds a status line and a completion list.

```
 cond                                                      [Value | Register]
 +------------------------------------------------------------------------+
 | status = 'paid' and total >                                            |   <- textarea, mono, 2 rows, grows
 +------------------------------------------------------------------------+
 Check: Expected a value at column 28.            [Show where]   28 of 4,096
 Columns: id int, customer_id int, status str, total num      [Columns v]
 Written as a condition. See the reference for Select.          <- the doc text, as now
```

- The input is a `<textarea>` in `--font-mono`, one row high that grows to six rows. Enter inserts a newline (an expression may span lines). The value is written with `actions.setParam` after 150 ms of typing, as for other fields.
- The text is never normalised (RECIPES-1.2 §3.4). Two spellings of one expression are two recipes. An optional **Tidy** button appears only when the kind's helper provides `tidy`, and it is one undo step.
- A **count** appears near the limit: from 3,800 code points on, "4,012 of 4,096" (code points, `RECIPE_LIMITS.maxExtChars`, counted with the spread operator, not `.length`). The validator's `bad-param` (`constraint: "length <= 4096"`) is shown through the existing `issuesForPath` route.
- The field switches between **Value** and **Register** as every other type does. A register that holds a `str` or an `ext` of the same kind is accepted (RECIPES-1.2 §3.2). While a register supplies the value, the check is off and the field says "Supplied by register `<name>`."
- An ext parameter is **not secret**. It never gets the key hint or the reveal toggle.

### 3.2 The helper registry

```ts
// apps/web/src/params/ext-widgets.ts (proposed; X3 owns the contract, a pack supplies a helper)
interface CheckContext {
  readonly op: string; // the qualified name of the step's op
  readonly param: string; // the parameter's name
  readonly inputs: readonly { name: string; schema?: readonly SchemaColumn[]; truncated?: boolean }[]; // see §3.4
}
type CheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly line?: number; readonly column?: number }; // 1-based, in code points

interface ExtWidget {
  readonly kind: string;
  check(text: string, ctx: CheckContext): CheckResult; // tier 1: sync, dependency-free
  checkAsync?(text: string, ctx: CheckContext, signal: AbortSignal): Promise<CheckResult>; // tier 2: through the Worker
  complete?(text: string, caret: number, ctx: CheckContext): readonly Completion[];
  tidy?(text: string, ctx: CheckContext): string;
}
interface Completion { readonly label: string; readonly insert: string; readonly detail?: string } // detail: the type or a short doc
```

This is X0's helper contract (`check(text, schema) => { ok, message }`, optional `complete`) with the changes of RELIX.md §2.3 and §16 item 9: the result may carry a position, and `checkAsync` is a promise. `check` is **tier 1**: a small shape check in the module that the worker and the page share (T20). It runs on every change. `checkAsync` is **tier 2**: the engine's own parser, reached through the bake Worker (§3.5). The `insert` text is the helper's job: for a column name that is not a plain identifier it writes the backticked form (RELIX.md §4.2).

### 3.3 What the field shows, and when

| State | Text | Announced? |
|---|---|---|
| Empty, required | "Required." (from `missing-param`, as now) | no |
| Tier 1 fails | "Check: `<message>`" (with "Show where" when a position is known) | once, when it changes from valid to invalid, after 600 ms of no typing |
| Tier 1 passes, tier 2 is running | "Checking..." | no |
| Tier 2 fails | "Check: `<message>`" with the position | as tier 1 |
| Everything passes | "Valid." | no |
| Tier 2 unavailable (pack off, chunk loading, worker busy) | nothing extra | no |

The status line is `role="status"` and polite, in the same region as the field's help. The field has `aria-describedby` for the help, the status and any validator message, and `aria-invalid="true"` when a check or the validator says so. Messages arrive as text, set with `textContent`.

**Checks are advice.** `validateRecipe` never reports a grammar error in an ext string (RECIPES-1.2 §3.3). A bad expression does not block a bake, and the bake's own `E_COERCE` is what stops the run. The page check only tells the person earlier. So the status line says "Check:", not "Invalid:", and an issue from the validator keeps its own line.

**Show where.** The button focuses the field and calls `setSelectionRange` on the span the check gave (converted from code points to UTF-16 indices by a pure helper). It does not move the selection unasked, because that would take over the caret while the person is typing.

### 3.4 Columns and completion

The field offers the names of the columns that the data entering the step has. They come from the **per-step schema** of the last bake (`StepReport.out.schema`, RECIPES-1.2 §7.5; T28):

- For a unary step, the schema of `dataSourcePath(recipe, path)`. While a bake is paused, the `dataInfo` of the `paused` event serves for the step about to run.
- For a binary step's `on` or similar field, **both** inputs are listed, in two groups: the piped side and the lane's value (the `out` of the last enabled step of the lane). Each group is headed with its source ("Left: from step 3", "Right: customers.csv"). This is the page's answer to RECIPES-1.2 §7.5's closing paragraph. A column that appears on both sides is listed in both groups, and the field adds no qualification of its own, because qualification is Relix's syntax and the helper's `insert` knows it.
- Schemas are known **up to the first failure**. A step after one has none. The field then says "Columns are not known: step 3 failed." and offers no list.
- Before the first bake, or when auto-bake is off and the recipe changed, the field says "Run the recipe to see the columns." with a **Bake** button when auto-bake is off. A schema from an older bake is used and labelled "Columns from the last run." (the bake is stale).
- If `schemaTruncated` is true, the list says "The first 256 columns."

The completion is an ARIA 1.2 **combobox**: the textarea has `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` (the listbox) and `aria-activedescendant`. The list opens on **Ctrl+Space**, or while typing an identifier character when the helper offers items. Up and Down move in it, **Enter or Tab** accepts (only when the list is open), **Escape** closes it, and Tab never gets trapped. Each option reads "name, type". The visible **Columns** button opens the same list, so a mouse or touch person has the way the spike's per-column buttons gave, without 256 tab stops. The list is a native `popover="manual"` element (as the help popover is, WP 6.13), built with `createElement`.

### 3.5 The async check through the Worker

R5b's tier-2 check asks the engine's parser, which lives in the lazily loaded Relix chunk (RELIX.md §2.3.1). The page sends a generic `ext.check` request to the **bake Worker** (RELIX.md §16 item 9; the message belongs to X5/R13). The UI rules, which this file fixes:

1. **Sequence numbers.** Each request carries a number. A reply for an older number is discarded.
2. **Debounce.** The request is sent 400 ms after typing stops, and only after tier 1 passed.
3. **Never cancel a bake.** If a bake is running, the request waits (one slot, the newest wins) and is answered after it. A check is advice; a bake is the work. The page does not start a second worker, and a second copy of the engine, to answer a check.
4. **Never load the pack for a check.** If the pack is on and its chunk is not loaded yet, the check waits for the bake that loads it. If the pack is off, there is no field (the step is `pack-not-enabled`).
5. **Failure is quiet.** A check that cannot run shows nothing. It is never an error banner.
6. **No console output.** The e2e fixture treats any console message as a failure.

Q5 in §11 records this choice.

### 3.6 A step whose pack is off

A step whose op is `pack-not-enabled` has no `ParamSpec`, so the form shows no fields. The card shows the issue text of §6.6 and a **Turn on the Relix pack** button. This is also the case for an op that is `unknown-op`: the form shows no fields and the existing message.

---
## 4. The lanes and slots UI

**UI.md changes.** §1.1 (the recipe pane line, the pane header's view control); §1.5 (no global key change; the shortcuts dialog gains a "Lanes" group); §2.2 (new files under `src/recipe/`); §2.3 WP 3.3 (cards for slot steps, drag and drop, keyboard lift, the three views, announcements); §3.2 (new actions; `DragPayload` gains `source` and `pipe`); §3 "Recipe tree paths" (slot paths and `childLists`); §2.3 "Registers and return" (slot lanes); §6 (tests).

This section makes RELIX-LANES concrete against RECIPES-1.2. Where the two differ, RECIPES-1.2 and RELIX.md win (as RELIX-LANES says of itself). The model (lanes, slots, the pipe rule, the normal form) is RELIX-LANES §2 and RECIPES-1.2 §4 and is not repeated. The decisions of Gate T1 stand: two slots `left` and `right` and a chain for N-ary union (T24); `FIX` and `ITERATE` have the slots `base` and `step` (T25); a lane may start with byte steps (RELIX-LANES Q5, first point).

### 4.1 The state and the tree actions (RL2)

RL2 is pure code and has no UI of its own, but UI.md §3 changes, so it is listed.

- **Paths.** A slot adds the segment of its name, then `steps`: `/steps/4/right/steps/1`, `/steps/1/step/steps/0` (RECIPES-1.2 §5.3). `state/recipe-ops.ts` gains the four slot keys beside `CHILD_LIST_KEYS` (`steps`, `then`, `else`). `childLists(step, stepPath)` returns the slot lanes that are **present** (the piped slot is absent in the JSON), with their paths. `moveStep`, `insertStep`, `removeStep` and `isWithin` then work on slots unchanged, because they work on list paths. A slot lane counts as a descendant of its own step, so a step cannot be moved into its own slot.
- **New actions** (UI.md §3.2): `swapSides(path)`, `mainLine(path)`, `fillSlot(path, slot, source)` and `joinIn(gapPath, source)`. Each is one undo step. Each returns the announcement text, which the caller passes to `actions.announce`.
- **The editor's normal form** (RELIX-LANES §2.3, rules 1 and 2) runs after every edit, in `recipe-ops.ts`. The validator's rules (3 and 4) are RECIPES-1.2 §5.2.
- **`DragPayload`** (`state/dnd.ts`) gains two types: `{ type: "source"; source: ... }` for a table dragged from the drawer (an input tab or a saved relation) and `{ type: "pipe"; path }` for the "data above" chip. The shell owner (WP 3.1) makes this change when RL3 asks, as UI.md §2.2 requires for `src/state/**`.
- **Registers and return** follow RELIX-LANES §8.1 and RECIPES-1.2 §5.4. The `insertStep` guard that refuses a misplaced Return (UI.md, "Registers and return") refuses a slot lane as a target, and the keyboard lift gives a Return no slot stop.

### 4.2 The slot step card

A slot step is a `kind: "op"` step (RELIX-LANES L6), so it keeps the card of UI.md WP 3.3: position badge, op name, status, issue count, step controls. Its body shows the parameters first (`on`, `how`, ...), then the slots.

```
 4  ⋈ Join                                  [table → relation]  [relation · lazy]
    [Swap sides]  [Make main line]                          step controls ...
    +-------------------------------------------------------------------------+
    | operator [Join v]            Same rows either way round.                |
    | on       [customer_id = id                                          ]   |
    |                                                                         |
    | LEFT SIDE   takes the data above                                        |
    | +---------------------------------------------------------------------+ |
    | | [↑ Data above]   from step 3                                        | |
    | +---------------------------------------------------------------------+ |
    | RIGHT SIDE  /steps/4/right/steps                                        |
    | +---------------------------------------------------------------------+ |
    | | 1  relix:input   tab customers.csv                  [relation]      | |
    | | 2  Select        country = 'NZ'                     [relation]      | |
    | |    (drop a step here)                                               | |
    | +---------------------------------------------------------------------+ |
    +-------------------------------------------------------------------------+
```

- **Names.** The slots are called **Left side**, **Right side**, **Base** and **Step** in the UI, with a one-line hint each: "takes the data above" on the piped slot; "Base: the rows the recursion starts from" and "Step: runs again on its own result" for `FIX` and `ITERATE`. The JSON names stay `left`, `right`, `base` and `step`.
- **The piped slot** shows a solid border, a filled label and the **Data above** chip. It holds no lane (the JSON has no key for it). **The other slot** shows its lane as a nested list, with the same cards and gaps as a `fork` child list. An empty lane shows "Empty. Choose a table, or add a step." and a **Choose a table** control (§4.3).
- **Swap sides** and **Make main line** are two separate buttons with text labels and tooltips (RELIX-LANES L3). In the compact layout they move into the card's overflow menu and stay reachable.
  - **Swap sides** is always available on a binary step.
  - **Make main line** is available when the step has a `pipe` **and** the other slot's lane holds at least one enabled step. Otherwise it is disabled and a visible hint says why: "The other side is empty, so there is no lane to make the main line." (Q8 in §11, the second point of RELIX-LANES Q5.) On a first step it says "This step is first in its lane, so there is no main line to change."
  - Neither button exists on a `FIX` or `ITERATE` step. The sides are not symmetric, and `step` is never the data above (RECIPES-1.2 §4.2; `pipe: "step"` is `bad-value`). Its **Data above** chip sits on **Base** and is not draggable.
- **The operator select** lists only operators of the **same slot family** (`CatalogueOp.slot` equal). Changing a join to a left join is a select change and swaps nothing. When the new operator is order-sensitive the announcement adds "Order matters for this operator, so check which side is which." (RELIX-LANES §3.1). Changing to an operator of another family is not offered here, because it would drop a lane.
- **The side-effect line.** Under the operator select the card says either "Same rows either way round." or "Order matters." The text comes from the operator table's commutative flag (RELIX.md §4.1). It is plain text and is part of the card's accessible name.
- **`unused-pipe`** (a warning): a slot step that is not first, with a lane in every slot. The card shows "The data above is not used by this step." as a warning, with the issue count badge, and no action. The way to use the data is to empty one side (the normal form then pipes it) or to add the step above the data's source.
- **Type badges and the traffic light.** The step's output badge is `relation · lazy`. Each lane's end is checked as in §2.5. The messages name the repair.
- **A `FIX` or `ITERATE` step.** The **Step** lane starts with `relix:recur`, which the editor inserts when it creates the lane. The card shows it as a locked first row ("relix:recur: the result of the previous round"), which can be disabled for editing but not moved out of the lane. The operations pane offers `relix:recur` only when the insertion point is inside a `step` lane, as it offers Return only where a Return is valid (a `bad-position` otherwise). The `name` parameter of the `recur` row is filled with the step's own `name`.

### 4.3 Drop rules and gestures

RELIX-LANES §4.2 is the table of drop rules and stands. The page-level facts that this proposal adds:

| What | Rule |
|---|---|
| Targets | Gaps in any lane, and slot boxes (a whole present slot, or an empty one). A slot lane is a list, so the existing gap code is reused. |
| Op onto the piped slot | Refused, with the text of RELIX-LANES §4.2: "The left side takes the data above. Drop the operation on the main line instead." The text names the actual side. |
| Table onto a gap between steps | **Join it in**: a join with the pipe on the left and the table on the right (Q7 in §11 recommends keeping this default). A table that is an input tab becomes a `relix:input` source when its format is CSV, TSV, JSON or NDJSON, and an `input:tab` source otherwise. |
| The chip onto the other slot | Swap sides. |
| A step into its own slot | Refused: "A step can't be moved into its own slot." |
| Feedback | Targets that accept the payload are highlighted, with a shape cue (a dashed outline) and not colour alone. Gaps grow as today. Escape cancels and announces "Drag cancelled." |

Drag is optional everywhere (UI.md §1.6). Clicking an operation or a table in the drawer adds it at the end of the main line. **Choose a table** on an empty slot is a `<select>` of the input tabs and the saved relations. It is the keyboard and touch route for dropping a table on a slot.

### 4.4 Keyboard and announcements

The lift-and-move route of WP 3.3 gains slot stops (RELIX-LANES §7):

- A lifted step moving Down or Up that reaches a slot step finds a container. **Right** enters its non-piped slot lane as the last child. **Left** leaves the lane back to the list that holds the step. The piped slot has no lane and no stop. A lifted step never stops in its own slots.
- The **Data above** chip is a button. Enter or Space swaps sides, the same as **Swap sides**.
- Every move is announced with the slot named: "Step 1 of 2 in the right side of Join". A move in the main line stays "Step 2 of 5".
- No new global key is proposed. Swap sides and Make main line are buttons in the tab order of the card. The lift keys are listed in the shortcuts dialog under a new group, "Lanes".

Announcements (all through `actions.announce`, all plain text):

| Action | Text |
|---|---|
| Swap, commutative | "Swapped the sides of Join. It returns the same rows, and the columns of `<right>` now come first." |
| Swap, left join | "Swapped sides. Left join now keeps every row of `<new left>`." |
| Swap, anti join | "Swapped sides. Anti join now returns rows of `<new left>` that have no match." |
| Swap, minus | "Swapped sides. Minus now takes the data above away from `<new left>`." |
| Main line | "Redrew the recipe with `<name>` as the main line. The result is unchanged; the steps that were above are now the left side." |
| Join it in | "Joined `<table>` to the data above. The data above is on the left. Press Swap sides to put `<table>` on the left." |

`<name>` is the lane's source (the tab name, or the saved relation's name), or "the right side" when the lane has no source. The Swap texts for the order-sensitive operators come from RELIX-LANES §3.1.

### 4.5 The three views: Lanes, Tree and As text

RELIX-LANES L4 defines three views of one model. This proposal sets their UI as follows.

- **A view control in the recipe pane header**: a `role="tablist"` with two tabs, **Lanes** and **Tree**, with roving tabindex and Arrow keys, Home and End (as the compact tab bar, UI.md §1.4). Lanes is the default and the only view in the compact layout (below 900 px, the Tree tab is hidden). Edits in either view call the same tree actions, so undo and redo are shared and `ui.selectedPath` carries across views.
- **As text** is a button beside the tablist, **As text...**, that opens the existing `forge-fl-dialog`, which becomes the **"View as text"** dialog with a tab per text form: **FL** (as now, `compileRecipe`), **Relix** (R7a, the engine's printer; keywords by default, with a "Use symbols" switch, an "Include data" option capped at 200 rows per table, and the list of what the text lost, RELIX.md §9.1) and **JSON** (the recipe). A dialog is wider than the 350 px pane and works in the compact layout. It reuses the dialog's Copy button and its `lines` highlight. Q9 in §11 records the choice, which differs from RELIX-LANES §5.3 only in being a dialog.
- **Import** (R7b, `.relix` into a recipe) is a button in the same dialog, "Import a .relix script...". It opens an import dialog with the statement check (refused statements listed with positions) and the binding step ("Which tab is `Orders`?", RELIX.md §9.2).

### 4.6 The Tree view (RL4)

The Tree is the query plan: sources at the top, the result at the bottom, data flowing down, as Lanes does.

```
  ▤ orders.b64                         ▤ customers.csv
       |                                    |
  ≡ From Base64                        σ Select country = 'NZ'
       |                                    |
  σ Select status = 'paid'                  |
       #  [L]                         [R]   |
       +=====>  ⋈ Join  customer_id = id <==+
                   #
               γ Group
                   #
               τ Sort

   thick: the main line      thin: a slot lane
```

- **It is read-only in v1** (Q6 in §11, which is RELIX-LANES Q4). Editing stays in Lanes. Each binary node shows its two **sockets** L and R as buttons that swap sides (the filled one holds the pipe), and the node carries **Swap sides** and **Make main line** with the same rules as the card. **Enter** or a click on a node selects the step (`actions.selectStep`) and switches to Lanes with focus on that card. There is no drag in the Tree.
- **Structure for assistive technology.** The Tree is a nested list, not a picture: a `role="tree"` whose items carry `aria-level`, root first. The root is the last step (the result). A unary node has one child, the step above it; a binary node has two children, one per input. The SVG that draws the connectors is one `aria-hidden` layer. A node's name reads "Join, 2 inputs, takes the data above on the left". Arrow keys follow the tree pattern: Up and Down move among visible nodes, Right opens and enters, Left closes and leaves, Home and End jump.
- **Layout** is a pure function of the recipe (a depth-first layout with a fixed column width), tested without a DOM. A node is an element, not a drawing primitive with its own hit model.
- **Room for R8.** Each node and edge reserves a line for the per-step schema ("4 columns") and the on-demand row count (R8, T34). The count is a **Count rows** button on the node, never automatic (RQ2).
- A saved relation used twice is drawn as two source nodes (RELIX-LANES §8.1).

### 4.7 Issues, timings and texts

Matching by path prefix keeps working (RELIX-LANES §8): an issue under `/steps/4/right/steps/1` shows on that card and, as a count, on the join card. The new issue codes need user-facing texts. These are the proposed texts for RW10 (each is plain text, `textContent`, and shown by the existing issue mapping):

| Code and reason | Text |
|---|---|
| `bad-slot`, `not-slot-op` | "`<op>` has no sides, so it cannot have a left or right lane." |
| `bad-slot`, `mixed-slots` | "A step cannot have both left/right and base/step lanes." |
| `bad-slot`, `wrong-slots` | "`<op>` uses `<expected>` lanes, not these." |
| `bad-slot`, `piped-slot-present` | "The `<slot>` side takes the data above, so it cannot also hold a lane." |
| `bad-slot`, `slot-in-params` | "The `<slot>` side is a lane, not a parameter." |
| `missing-slot`, `absent` | "The `<slot>` side is missing." |
| `missing-slot`, `empty` | "The `<slot>` side is empty. Choose a table or add a step." |
| `missing-slot`, `no-slots` | "`<op>` needs two sides, and this step has none." |
| `unused-pipe` (warning) | "The data above is not used by this step." |
| `bad-position`, `outside-step-slot` (`relix:recur`) | "`relix:recur` only works inside the Step lane of Fix or Iterate." |
| `bad-position`, a `return` in a slot lane | "A Return cannot be inside a side of `<op>`. Put it after the step." |
| `pack-not-enabled` | see §6.6 |

The slot-step card still shows its own timing, and a failing step inside a lane highlights both its own card and the join card (as a failing step in a `fork` does).

### 4.8 What this section asks of others

RL3 asks the shell owner for the `DragPayload` change and the new actions. RL5 (the drawer's Tables group: input tabs and saved relations) needs D2 for the badge type and RW6's `inputNames` for "read by this recipe" (§5.4). RL6 needs RW3's compiler, so the "View as text" dialog shows FL for slot steps. RL7 needs R3 and X5.

---

## 5. Named inputs and the share dialog

**UI.md changes.** §2.3 WP 3.4 (a tab picker for the `tab` parameter); §2.3 WP 3.5 (input tabs: unique names, "read by the recipe" marker, rename offer; the error panel's missing-tab text); §2.3 WP 3.6 (the bake controller sends `inputs`; the share dialog lists the tabs; opening a link that carries tabs); §4 rule 12 (§7.3).

The bake protocol gains named inputs (X5, `PROTOCOL_VERSION` 2, T23). `input:tab` reads a tab as bytes and `relix:input` reads and parses it (T30). Both take a `tab` parameter that is matched against tab names **exactly**: case-sensitive, no trimming, no Unicode normalisation (RECIPES-1.2 §7.1).

### 5.1 Tab names must be unique and valid

The bake rejects two inputs with one name (`E_PROTOCOL`, `input-duplicate`) and a name outside 1 to 120 code points or with a control character (`input-name`). So the input pane must never let that happen:

- **Rename** (F2, WP 3.5) refuses a name that another tab has: "A tab named `<name>` already exists." The same check runs on **New input tab** (which picks "Input 2", "Input 3" and so on, the first free name) and on every route that adds a tab (a file drop, Try it, the share link).
- It refuses an empty name, a name over 120 code points and a name with a control character, with the reason as text next to the field.
- At **32 tabs** (`BAKE_INPUT_LIMITS.maxInputs`) the New tab button is disabled with the reason "A recipe can read at most 32 tabs."

### 5.2 The `tab` parameter field

For an op in `NAMED_INPUT_OPS` (`input:tab`, `relix:input`) the parameter `NAMED_INPUT_PARAM` (`tab`) is drawn as a **tab picker**, not a plain text field:

```
 tab    [ customers.csv                    v ]      [Value | Register]
        orders.b64
        customers.csv   (this recipe reads it)
        Other name...
 No tab is named "customers.csv". Add one with that name, or change the step.
 [Add a tab named "customers.csv"]   [Show tabs]
```

- A `<select>`-style combobox lists the tab names in order, and one last item, **Other name...**, which turns the field into a text input. The text input is needed because a recipe from a link may name a tab that does not exist yet, and because the name may be set by a register.
- Names are shown exactly as stored. A note under the field reads "Names must match exactly, including capitals and spaces." when the typed name is not a tab but differs from one only by case or surrounding spaces ("Did you mean `Customers.csv`?").
- When the name is not a tab, the field shows the missing-tab text of §5.3 and two buttons, **Add a tab named "..."** (`actions.addInput`, empty bytes, then selects it) and **Show tabs** (focuses the input pane, `Alt+3`).
- A register may supply the name (`{ "ref": ... }`, RECIPES-1.2 §7.1 item 3). The field then says "Supplied by register `<name>`." and cannot check the name.
- The step card of a source shows "reads tab `<name>`, 12 KB" and a **Show tab** button. The type badge is `bytes` for `input:tab` and `relation · lazy` for `relix:input`.

### 5.3 Missing-tab messages

Two places, one text. Before a bake, the page compares `inputNames(recipe)` with the tab names and marks the step: a warning on the card and the field. After a bake, the error `E_PARAM_INVALID` with `detail.reason = "no-such-input"` (RECIPES-1.2 §7.4) is shown by the error panel. The page-side check is a page notice, **not** a recipe issue and not a new issue code: it never enters `state.issues`, and it does not stop a bake (the baker's early check fails it before any step runs anyway). The text, from RECIPES-1.2 §7.4:

> This recipe reads the tab "customers.csv". There is no such tab. Add one with that name, or change the step.

The error panel adds `detail.tabs` as "Tabs you have: orders.b64" (at most 20, each cut to 80 code points, as the detail is), the **Show step** button of the panel, and **Add a tab named "customers.csv"**. A tab name is data, so it is rendered with `textContent`, and the hostile-name test of §10 covers it.

### 5.4 The input pane

- A tab that a step of the recipe reads by a literal name gets a marker in its tab label: visible text "read by recipe" in a smaller line under the name, and the same words in its accessible name. The list comes from `inputNames(recipe)`.
- **Renaming a tab that steps read.** If a rename leaves steps that named the old name, the pane says "2 steps read the tab `<old>`. Update them to `<new>`?" with **Update steps** and **Leave them**. **Update steps** is one undo step that renames the tab and the parameters together. This is Q11 in §11. Without it, a rename silently breaks the recipe at the next bake.
- **Closing a tab** that steps read asks the same question differently: "2 steps read this tab. Close it anyway?"

### 5.5 The bake controller sends the tabs

The controller builds `BakeOptions.inputs` (RECIPES-1.2 §7.2). The active tab is included under its name, because the main input is not named implicitly. **Only tabs the recipe reads are sent**: the literal names from `inputNames(recipe)`, plus the active tab, and **all** tabs only if some `input:tab` or `relix:input` step takes its tab from a register (a `{ ref }` name is not listed by `inputNames`). The reason: each bake copies and transfers the buffers of every named input, and an auto-bake runs after every keystroke, so sending ten 5 MB tabs that no step reads would be a large and invisible cost (Q10 in §11). If the total passes `limits.maxTotalBytes`, the bake fails with `E_PROTOCOL` (`input-size`), and the error panel says "The tabs together are too large to bake. Close or shrink a tab." with the sizes of the tabs, largest first.

### 5.6 The share dialog

UI.md WP 3.6's dialog shows the link, a **Copy** button, "Include the input" (default off), the clear-text warning, and the key confirmation. The v1.1 note says "This recipe needs Forge 1.1 or later; older versions show an error." The wave adds, in this order, above the link:

1. **The version note.** When `recipeUsesV12(recipe)` is true: "This recipe needs Forge 1.2 or later; older versions show an error." It replaces the v1.1 sentence (v1.2 contains v1.1's features), and the register-key sentence stays.
2. **The pack note.** When `packsUsed(recipe, index)` is not empty: "This recipe uses the Relix pack. Anyone who opens the link is asked to turn it on." (one pack name per pack, in the order of use). The link omits `catalogue`; the dialog does not mention it.
3. **The tab list**, only when `inputNames(recipe)` names tabs. A fieldset, "Tabs this recipe reads", with one row per tab:

```
 Tabs this recipe reads. They are stored in the link, in clear text.
 [x] orders.b64      the input tab        12 KB     read by step 1   (follows "Include the input")
 [x] customers.csv                        48 KB     read by step 5
 [ ] prices.json                          310 KB    read by step 7   <- left out
 Other tabs are never added to a link.
 Without prices.json, the recipe cannot run for whoever opens this link.
 Link length: 41,200 of 65,536 characters.
```

- Every tab that `inputNames` lists is a row, **selected by default** (T26). The rows are checkboxes, each with the name, the size (bytes as KB or MB, one decimal) and the step that reads it. A name is data: `textContent`.
- The **main tab**, when a step reads it by name, is a row that mirrors "Include the input" (it cannot be on while that box is off). This is the `n` key (RECIPES-1.2 §11.1).
- A tab left out gets a visible consequence line ("Without `<name>`, the recipe cannot run for whoever opens this link."). It is allowed. It is the user's choice (RECIPES-1.2 §11.3 item 2, Q7).
- **Other tabs are never added** (§11.3 item 1 is a MUST). The dialog says so once, in the same line as the list, so a person is not left wondering what else the link holds.
- The size of the whole link is shown, with the limits that fire: `input-too-large` (sum of `i` and the bundle) and `fragment-too-long` appear as text beside the list, naming the largest included tab, so the person can see what to drop. At 16 tabs (`SHARE_LIMITS.maxTabs`) the dialog says "A link can carry at most 16 tabs."
- The existing clear-text warning (UI.md §4, rule 12) gains the tabs: "the recipe, the input, **the tabs listed above** and any key values are stored in clear text in the link."

The URL sync of WP 3.6 is unchanged in spirit: the automatic `history.replaceState` fragment holds the recipe alone, never an input or a tab. A recipe that names a tab or a pack op is still written; the automatic fragment omits `catalogue` for a pack op as `encodeShare` does.

### 5.7 Opening a link that carries tabs

`decodeShare` returns `inputName` and `tabs` (RECIPES-1.2 §11.4). Today `loadDocument` replaces the bytes of the active tab only. With tabs, that is not enough, because step names must match exactly. The rule (Q12 in §11):

- The active tab takes the bytes of `i`, and the name `n` when present.
- Each tab of `t` becomes a tab with exactly that name.
- A carried name that **equals an existing tab's name replaces that tab's bytes**, and the open flow says so first: "This link carries the tabs `a` and `b`. It replaces your tab `b`." with **Open** and **Cancel**. The confirm step shows only when something would be replaced or added.
- The new recipe replaces the old one (as today), so no existing step is left naming a tab that changed.
- A decoding failure is shown as now (a dismissible banner with the `ShareError` code), and a missing tab is reported by §5.3.

---
## 6. Packs in the UI

**UI.md changes.** §1.1 (the More menu, the status bar, the dialog list); §2.2 and §2.3 (a new `src/packs/` directory, WP 3.2 drawer footer, WP 3.6 and WP 3.7 open flows); §3.2 (state and actions); §3.4 (the feature entry); §4 rule 10 and a new rule 13 (§7.3); §6 (tests).

This section uses only what a person sees. The manifest, discovery, the `init` protocol and the capability model are PACKS.md's (SP4). §6.7 lists what the UI needs of the manifest.

### 6.1 What a person sees

A **pack** is an optional set of operations, with its own value kinds and viewers, that is part of Forge but off until the person turns it on (T5, §5.2). The core (codes, ciphers, encodings, hashing, `table`, `csv`, `json`) is always on. A pack is first-party code: it is built and deployed with the site, loaded from the same origin, and cannot reach any other site, because the CSP allows none (§7). The UI says this in a short notice wherever it offers a pack.

### 6.2 The pack manager (P4)

The top bar's More menu gains **Packs...**, above "Keyboard shortcuts". It opens `forge-packs-dialog`, a `ForgeDialog` like the others (`DialogId` gains `"packs"`).

```
 Packs                                                                     [Close]
 ------------------------------------------------------------------------------------
 Packs are part of Forge. They load from this site, and they cannot reach any other
 site. Each one is off until you turn it on.

 Relix                                                              [ Off  (o  ) ]
   Query data with relational operators: select, join, group, sort and more.
   Adds 51 operations and the table-and-relation kinds. About 1.4 MB, loaded
   the first time you turn it on.

 Symbolic algebra                                                   [ On   (  o) ]
   Exact algebra and rational numbers.
   Adds 38 operations. About 120 KB.  3 steps of this recipe use it.

 Media                                                              [ Off  (o  ) ]
   ...
```

- One row per pack from the build-time manifest: **name**, a **one-line summary**, what it **adds** (a count of operations and the names of its kinds), the **size** (the pack's budget, gzip, from the manifest, P7), and a **switch** (`role="switch"`, `aria-checked`, labelled with the pack name). The list is a `role="list"`; the dialog's heading is `h2` and the pack names are `h3`.
- **States.** A pack is **off**, **turning on** (the switch is disabled and the row says "Turning on..." in a `role="status"` line), **on**, or **failed** ("The Relix pack did not load: `<message>`." and **Try again**). The row says how many steps of the current recipe use the pack, "3 steps of this recipe use it", from `packsUsed`.
- **Turning off** a pack that the recipe uses first shows the row's own confirm text, not a second dialog: "3 steps use this pack. They stay in the recipe and show an error until you turn it on again." with **Turn off** and **Keep on**. A pack the recipe does not use turns off at once.
- **Turning on** loads the pack's chunks lazily (§6.4), then updates the catalogue and the baker. The person hears "Relix pack is on. 51 operations added." through `actions.announce`. Turning off says "Relix pack is off. 51 operations removed."
- **Persistence.** The set of enabled pack ids is data, so it lives in IndexedDB, in the existing `kv` store under the key `packs` (so no schema migration, `DB_VERSION` stays 1), as `{ v: 1, enabled: [ids] }`. It is read on start-up, and every id is checked against the build-time manifest. An unknown id is dropped silently (UI.md §4 rule 6: nothing from storage is used unchecked). It is **per browser**, never part of a share link, and not in `localStorage`. All packs are off in a fresh browser (Q13 in §11).
- **No "always allow".** The dialog has no "turn on packs for shared links" setting. Every shared recipe that needs a pack asks (§6.5).
- **Keyboard and screen reader.** Each switch is reachable in tab order, toggles with Space, and its row text is its description (`aria-describedby`). A running state is announced once. Focus stays on the switch after a change.
- Axe in three themes, and the compact layout (the dialog already has a compact form).

### 6.3 Loading and the baker

Enabling a pack does three things in order, and the row reports the first that fails:

1. **The UI chunk.** The pack's UI feature (its viewers, ext widgets and any pane) loads with one dynamic `import()` from a fixed table the build generates (§7.3, rule 8). Its viewers register (§1.2) and its ext widgets register (§3.2).
2. **The catalogue.** The catalogue for the enabled set is loaded (a same-origin file the build emits, named by the manifest). `state.catalogue` changes, so the operations pane, fit, issues and the drawer update at once.
3. **The baker.** The baker is re-initialised with the enabled pack ids (`baker.init`, P2). The engine chunk itself is **not** loaded until a bake needs it: a recipe with no `relix:` word never pays the 1.3 MB (R13, RELIX.md §1.5). The first bake that does needs it shows the status "Loading the Relix engine..." in the bake controls' `role="status"` text (a worker event for this is an ask of R13, §6.7). If the load fails, the bake fails with `E_INTERNAL` and the load error, and the error panel shows **Bake again** (§8).

Disabling reverses 1 to 3. A running bake is cancelled and restarted by the existing auto-bake rule, because the catalogue changed.

### 6.4 State and actions

The shell owner (WP 3.1) adds, on request of P4:

```ts
// state/types.ts (proposed)
type PackStatus = "off" | "loading" | "on" | "failed";
interface PacksState {
  readonly status: Readonly<Record<string, PackStatus>>; // by pack id, for every pack in the manifest
  readonly message: Readonly<Record<string, string>>; // the failure text, by pack id
}
// AppState gains: packs: PacksState
// DialogId gains: "packs" | "pack-offer"
// actions: setPackEnabled(id: string, enabled: boolean): Promise<void>; the one place a pack is switched
```

`state.issues` is computed with `validateRecipe(recipe, catalogue, { packs: packIndex(state) })`, where `packIndex` builds the `PackIndex` of RECIPES-1.2 §8.2 (`vocabs` from the manifest, `enabled` from `state.packs`). `decodeShare` gets the same option. `src/packs/` holds the manager, the offer dialog, the persistence and these helpers (TOOLKIT P4 names `apps/web/src/packs/*`).

### 6.5 The enable offer for a shared recipe (P5)

`decodeShare` fails with the code `packs-needed` when every error is `pack-not-enabled` (RECIPES-1.2 §8.3). The failure carries the decoded `recipe`, the pack ids `packs` and what the link held (`input`, `inputName`, `tabs`). The page shows `forge-pack-offer-dialog` (`DialogId` `"pack-offer"`), not a banner, because it asks for a decision:

```
 This recipe needs the Relix pack
 ------------------------------------------------------------------------
 It uses 7 steps from the Relix pack: Select, Theta join, Group, Sort and 3 more.

 The Relix pack is part of Forge. It loads from this site and cannot reach
 any other site. It is about 1.4 MB, loaded now and then kept by your browser.

 [ Turn on and open ]   [ Open without the pack ]   [ Cancel ]
```

- **Turn on and open** is the primary button and has the focus. It enables every pack the link needs (all are first-party; one button covers several: "Turn on Relix and Media and open"), waits for the catalogue, validates again with the new `PackIndex`, and opens the recipe with its input and tabs by the flow of §5.7. If the pack fails to load, the dialog stays open with the failure text and **Try again**.
- **Open without the pack** loads the recipe into the editor with `pack-not-enabled` shown on each step. Nothing runs (the recipe has errors, so auto-bake is skipped, as it is for any invalid recipe). It lets a person read a recipe without enabling anything.
- **Cancel** discards the link and leaves the document as it was.
- The pack ids come from the page's own `PackIndex`, not from the link's text, and are still checked against the manifest before use (TOOLKIT §5.2; UI.md §4 rule 6). The link carries no pack list at all (T26).
- The list of steps comes from `packsUsed(recipe, index).paths`, shown as display names (text).
- The same offer, as an inline banner at the top of the recipe pane, appears for any recipe that is **already** loaded and has `pack-not-enabled` issues: a saved recipe opened from the Open dialog (WP 3.7), a recipe after a pack was turned off, or one loaded with **Open without the pack**. "3 steps need the Relix pack, which is off. [Turn on]". Both use `setPackEnabled`.

### 6.6 Texts

| Case | Text | Where |
|---|---|---|
| `pack-not-enabled` (an issue, error) | "`relix:select` is part of the Relix pack, which is turned off. Turn it on in Packs." with a **Turn on the Relix pack** button | the step card, the issue list, the output pane's issue list |
| Every issue is `pack-not-enabled` and the output pane has no result | "Turn on the Relix pack to run this recipe." | the output pane body |
| `packs-needed` (a share failure) | "This link uses the Relix pack, which is turned off." | the offer dialog's fallback line, and the banner if the dialog cannot open |
| `unknown-op` | unchanged: "There is no operation `<name>`." (and the existing wording) | the step card |
| A pack failed to load | "The Relix pack did not load: `<message>`. Try again." | the pack row |
| A step's pack was turned off | "This step needs the Relix pack, which is turned off." | the step card (the same issue) |

`<name>` and `<message>` are data and are rendered as text.

### 6.7 The operations pane, the status bar, and what the UI asks of PACKS.md

- **Operations pane.** Operations of a pack that is off are not listed. The drawer ends with one line: "Packs: Relix (off), Symbolic (on). **Manage packs**", which opens the dialog. Search does not look into packs that are off in 1.0 (Q13 in §11).
- **Status bar.** The right side reads "N operations · catalogue `<version>`" and gains " · 2 packs on" when any pack is on.
- **Console.** The console worker gets the same pack ids at its own `init`, so `help`, `see` and typed words match the editor (UI.md §5, P2).

What the UI needs from the manifest (SP4 decides the form): the **id** (lower-kebab-case), a **display name**, a **one-line summary** of at most 120 characters, a plain-text **description**, the **version**, the **size budget** (gzip bytes), the **vocabularies**, the **kinds** the pack registers with a `noun` for each ("table", "rational number"), the **conversions** it declares (RECIPES-1.2 §6.9), a **plain-words list of what it can do** (the capability model, TOOLKIT §5.4, in a sentence a person reads), its **dependencies** on other packs, and its **UI entry** (the chunk that holds viewers and widgets). A summary of the manifest, with these fields and no code, is bundled into the app as a JSON module, so the manager and `PackIndex` need no request. The pack's chunks and its catalogue file are fetched or imported by names the manifest holds. Asks of R13: a worker event that says the engine chunk is loading, and the structured Relix detail of §8.

---

## 7. The CSP amendments

**UI.md changes.** §4 (the header block and rules 5, 6, 7, 8, 10, 12 and a new 13); also PLAN §10 and `infra/site.tf`, which need the **owner's approval** and are not changed by this file.

### 7.1 What changes, and what does not

The production CSP today (PLAN §10, `infra/site.tf` `locals.csp`, UI.md §4):

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

**One directive is added: `media-src blob:`.** Without it `media-src` falls back to `default-src 'none'`, so an `<audio>` or `<video>` whose `src` is a `blob:` URL is blocked. The media pack's audio and video player needs it (TOOLKIT §10.1). Nothing else changes.

**The exact diff** for `locals.csp` in `infra/site.tf` (one line):

```diff
-  csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
+  csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
```

**The full proposed CSP string**, as UI.md §4 and PLAN §10 will show it:

```
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self';
  img-src 'self' data: blob:; media-src blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none';
  form-action 'none'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`media-src blob:` names no host, no `'self'` and no `data:`. The media pack makes `blob:` URLs from bytes its own worker produced, and plays no file from the site, so `blob:` is all it needs. The headers other than the CSP (COOP, COEP, CORP, Permissions-Policy, HSTS and so on) do not change. A `blob:` URL made by the page is same-origin, so `Cross-Origin-Embedder-Policy: require-corp` does not block it.

**`'unsafe-eval'` stays out** (T15). The Relix engine's JavaScript backend uses no `eval` and no `new Function`: R0 ran 380 reference examples and the benchmarks under the production CSP with no violation, and a positive control showed the detector works (R0 §6; RELIX.md §11.4). The Wasm GC build does use `new Function`, and `'wasm-unsafe-eval'` does **not** cover that (R0 §8). It stays out until TeaVM's Wasm runtime stops building functions that way. The standing test of §10 (`csp.spec.ts`) fails if a build ever needs `unsafe-eval`, and it is the test to re-run when T15 is revisited.

### 7.2 Does anything else need a change?

The question the task asks, feature by feature. The answer is no, except where the table says so.

| Feature | Directive that governs it | Change? |
|---|---|---|
| Lazy pack chunks, imported on the main thread with `import()` | `script-src 'self'` | none |
| `import()` of the `relix-web` module from inside the bake Worker (RELIX.md §1.5, §11.4) | the worker's own `script-src`, taken from the CSP header of the **worker script's response** | none, as long as the response-headers policy covers the worker script and the chunk. It does: the distribution attaches the same CSP to the default and the assets (`/assets/*`) policies. A test checks it (§10). |
| Module workers (`new Worker(url, { type: "module" })`, `?worker` with `format: "es"`, UI.md §4 rule 4) | `worker-src 'self'` | none. They are the workers Forge already has. |
| A pack that starts its own worker, or a worker nested in the bake Worker | `worker-src 'self'` | none to the CSP, but **not planned**: a pack worker needs its own cancellation design (R13) and its own review. Rule 13 says so. |
| `new CSSStyleSheet()`, `replaceSync`, `adoptedStyleSheets` in a viewer's shadow root | `style-src 'self'` | none. Constructable stylesheets raised no violation in X0 (§8, Chromium). Lit already depends on adopted stylesheets (UI.md §2.1). See §7.4. |
| `<style>` elements and `style="..."` attributes | `style-src 'self'` | still forbidden (rule 2). |
| `el.style.setProperty(...)`, `el.style.transform = ...` (CSSOM) | not governed by `style-src` | none; still the way to position anything dynamic. |
| Canvas drawing, `OffscreenCanvas` in a worker, `createImageBitmap` | none | none |
| `<img src="blob:...">`, `canvas.toBlob` then an object URL | `img-src 'self' data: blob:` | none |
| `<audio>` or `<video>` with a `blob:` `src` | `media-src` | **add `media-src blob:`** |
| `fetch` of the pack manifest summary, a pack's catalogue file | `connect-src 'self'` | none |
| Loading a `.wasm` file for a later pack | `script-src 'wasm-unsafe-eval'` for `WebAssembly.compile` | none (already present) |
| Shared-memory cancellation, `crossOriginIsolated` | COOP and COEP | none; a same-origin chunk or `blob:` URL passes `require-corp`. |
| Trusted Types | not enabled | not proposed; not tested by X0. |

### 7.3 The text of UI.md §4 after the change

This is the proposed text. A change relative to today is marked **(changed)** or **(new)**; every other rule stays as it is. Rule 6 and rule 8 are written out in full, as the task and TOOLKIT §13.3 require.

**The header block of §4**: the CSP of §7.1. The sentence "Production headers (PLAN §10):" stays.

**Rule 1, 2, 3, 4** unchanged. (Rule 2 already says dynamic styles go through the CSSOM or classes, and that `static styles` are adopted stylesheets.)

**Rule 5 (changed).**

> 5. **No `eval`, no `new Function`**, no string timers, and no `import()` of data. A dynamic `import()` takes a literal same-origin specifier, or an entry of the build's own chunk table; it never takes a string made from data (a URL fragment, a recipe, a pack id from a link). `'unsafe-eval'` is not allowed. Ajv is a test-only dependency and must not be imported by app code. `'wasm-unsafe-eval'` exists only for WebAssembly that a pack compiles; it does **not** allow `new Function`, so a WebAssembly or Wasm GC runtime that builds functions with `new Function` stays out until it is fixed (TOOLKIT T15).

**Rule 6 (changed).**

> 6. **Everything that came from data is rendered as text, and everything that draws it is built by script.**
>
> a. Metadata, help, error messages, issue messages, op docs, recipe names, tab names, user words, column names, cell values, the text form of an extension value, engine messages, and everything from a share URL or storage is rendered as text: `${text}` bindings, `.textContent` or `createTextNode`. Never `unsafeHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser`, `document.write`, `srcdoc`, `createContextualFragment`, a `<template>` filled from data, or a Markdown renderer. Links the app creates are `href` to same-origin pages only. Untrusted strings never reach `href`, `src` (the one exception is a `blob:` URL that the app made itself with `URL.createObjectURL`), `import`, or the text of a stylesheet.
>
> b. **Viewers and parameter widgets** (extension kinds; TOOLKIT §6) follow (a) and these rules: (i) a viewer returns a DOM node built with `document.createElement`, `createTextNode` and `textContent`; (ii) a viewer or widget in a shadow root takes its styles from **one constructable stylesheet**, `new CSSStyleSheet()` with `replaceSync(text)` assigned to `shadowRoot.adoptedStyleSheets`, where `text` is a string literal in the source and contains no data; (iii) it never adds a `<style>` element, never sets a `style` attribute, and never falls back to either when `adoptedStyleSheets` is missing (it renders unstyled instead); (iv) per-element dynamic values (a row offset, a width) go through the CSSOM (`el.style.setProperty`), as in rule 2; (v) it uses only the colour, size and font tokens of `tokens.css`, which pass into the shadow root as custom properties, so the three themes and forced colours need no code of their own; (vi) it fetches nothing and reads only its `output` and `ctx` arguments; (vii) if it cannot build its node it throws, and the host shows the text form of the value instead (it never shows a half-built node).
>
> c. A viewer that makes an object URL (an image, an audio clip) revokes it when its node is removed (rule 7).

**Rule 7 (changed, one sentence added).**

> 7. **Downloads and previews** use `blob:` URLs (`img-src ... blob:` and `media-src blob:` are allowed; `<a download href="blob:...">` is navigation of the user's own bytes and is fine). Revoke object URLs after use. Never navigate to or embed user content. Media never starts by itself: an `<audio>` or `<video>` element has the browser's own `controls` and no `autoplay`.

**Rule 8 (changed).**

> 8. **Only same-origin requests** (`connect-src 'self'`, `script-src 'self'`, `worker-src 'self'`): the catalogue, the pack manifest summary and a pack's catalogue file, lazy op chunks, lazy pack chunks (the Relix engine module among them), and workers. A pack is loaded through a fixed table that the build generates, one literal `import("...")` per pack, looked up by an id that has been checked against the build-time manifest (TOOLKIT §5.2). A chunk name or a pack id never comes from data. `fetch` is used for the catalogue, the pack manifest and the files the manifest names, and nowhere else; no other app code calls it. A pack runs under this same CSP, so it cannot reach any other origin. There is no analytics, no font, no CDN and no third-party anything.

**Rule 9** unchanged. (Packs add no `<iframe>`.)

**Rule 10 (changed, one sentence added).**

> 10. Storage: `localStorage` for layout and theme only, IndexedDB for data (which includes the set of enabled packs, in the `kv` store); both wrapped in try/catch. No cookies.

**Rule 11** unchanged.

**Rule 12 (changed).**

> 12. Share links contain the recipe, optionally the input, **the other tabs that the recipe reads and the person chose to include**, and any key values, **in the clear** (RECIPES §3.4, §7.4; RECIPES-1.2 §11). The UI must say so wherever it creates a link or a text form (WP 3.6 dialog, WP 3.3 FL dialog note, WP 3.7 export), and must list each tab with its size and let the person leave it out.

**Rule 13 (new).**

> 13. **Packs.** A pack is first-party code built and deployed with the site, and it gets no capability that the app does not have: the same CSP, the same workers rule (a pack starts no worker of its own without a reviewed work package), the same text rule. The set of enabled packs is per browser, stored in IndexedDB, and checked against the build-time manifest on every load. A pack's UI is a viewer, an ext widget, or a Lit element registered when its chunk loads, under rules 1 to 12. The UI shows the first-party notice wherever it offers to turn a pack on.

### 7.4 Adopted stylesheets, and what was and was not tested

X0 §8 found that `new CSSStyleSheet()`, `replaceSync` and `adoptedStyleSheets` raise no violation under `style-src 'self'` and that axe reported nothing for a grid in an open shadow root. That test ran in **Chromium**, the only browser of the e2e suite (UI.md §6). Rule 6b(iii) is written so that a browser without adopted stylesheets (an older Safari) still shows a readable, unstyled viewer. Q16 in §11 recommends adding a Firefox and WebKit smoke of the table viewer and the CSP test, which UI.md §6 already allows when the CI image has them. Untested items: a viewer that draws on a `<canvas>`, a `blob:` image or audio element (needs the new directive), and Trusted Types.

### 7.5 What the host needs: `serve-prod.mjs`, `infra/`, PLAN §10

- **`apps/web/scripts/serve-prod.mjs`: no change for the CSP.** `readCsp()` reads the string from `infra/site.tf` (the `csp = "..."` local), so the e2e suite tests what is deployed and the one-line change in `site.tf` reaches it by itself. Two notes: (1) the MIME table already has `.js`, `.mjs`, `.json`, `.wasm` and `.css`; a pack's files must use those extensions, because a module script needs a JavaScript MIME type. (2) The server does not send `Permissions-Policy`, HSTS or `X-Frame-Options`, which `site.tf` does. That is a gap between the test server and production, not a CSP point, and not proposed here.
- **`infra/site.tf`: one line**, the diff of §7.1. **This is an infra change. It needs the owner's approval and a `terraform apply`** (CLAUDE.md). `infra/README.md` repeats the CSP if it lists it and changes with it. No change to `cf_function.js` (it rewrites directory paths) and none to the cache behaviours, provided pack chunks live under `/assets/` so that they get the immutable policy. P1 and P7 own that rule for pack build output.
- **PLAN §10**: the CSP bullet gains `media-src blob:`; the `connect-src` sentence ("needed only to fetch lazy WASM, `.fth` and catalogue files") becomes "needed to fetch the catalogue, the pack manifest and pack catalogue files"; one bullet notes that pack chunks load with `import()` under `script-src 'self'`. PLAN §10 also lists no `Permissions-Policy`, which `site.tf` sets; that omission is not new.

**Staging.** (1) UI.md rules 5, 6, 8, 10, 12 and 13 land with X2 and P4, because viewers and the pack manager need them, and they change no header. (2) The CSP golden test lands at the same time, against the **current** string, so any later edit to the header is deliberate. (3) `media-src blob:` is applied **with the media pack's work package (T6)**, not before: a directive nothing uses is a wider policy for no gain (Q15 in §11). At that point the owner approves the one-line `site.tf` edit and runs `terraform apply`, the golden test's expected string changes in the same pull request, and PLAN §10 follows.

---

## 8. Errors from Relix

**UI.md changes.** §2.3 WP 3.5 (the error panel: the "From Relix" block, the span excerpt, the step path, the buttons); §2.3 WP 3.3 (the field focus request); §3.3 (`FocusPaneDetail`); §1.6 (no change: the panel is still `role="alert"` once per failure).

The panel today shows `error.code`, `error.message`, `error.word`, the failing step with a button that selects it, the `error.detail` as key and value pairs (text only), the issue list for `E_RECIPE_INVALID`, the partial output and the terminated note. Relix adds no error code (RX13). Every Relix error is an existing code with `detail.source = "relix"` and `detail.relix = { kind, message, line?, column? }`, and, when the error sits inside a parameter, `detail.span = { start, end }` in code points inside the parameter text, with the end marked approximate (RELIX.md §7.1, §7.2). The path is the step, and `.../params/<name>` when the position maps to a parameter (RELIX.md §7.3).

### 8.1 The step path in words

A pure helper, `describePath(recipe, path)`, turns a path into a sentence a person can read, and the panel and the failure announcement both use it:

| Path | Words |
|---|---|
| `/steps/2` | "Step 3, Select" |
| `/steps/4/right/steps/1` | "Step 5, Join, right side, step 2, Select" |
| `/steps/1/step/steps/0` | "Step 2, Fix, Step lane, step 1, relix:recur" |
| `/steps/4/params/on` | "Step 5, Join, parameter on" |
| `/steps/4/right/steps/1/params/cond` | "Step 5, Join, right side, step 2, Select, parameter cond" |

Positions are counted from 1. Op names are the catalogue's display names, as text. The role of the failing step in a fork or an `if` is named in the same way (`then`, `else`, `fork child 2`). The failure announcement (`role="alert"`, once per failure) reads "Baking failed at step 5, Join, right side, step 2, Select: `<short message>`."

### 8.2 The "From Relix" block

When `detail.source === "relix"`, the panel adds a block after the message:

```
 Baking failed                                                                 (alert)
 Step 5, Join, right side, step 2, Select, parameter cond
 [Show step]   [Show in field]

 The engine says: expected a value, found the end of the text.
 Line 1, column 28

   status = 'paid' and total >
                              ^

 Code: E_COERCE    Word: relix:select
 > Details
```

- **The engine's message** is text, plain, in the panel's message style (`textContent`). The line and column come from `detail.relix`.
- **The parameter excerpt.** When `detail.span` is present the panel shows the parameter's text, cut to 200 code points around the span with `...` marks, as three text nodes: before, the marked part, after. The marked part is a `<span class="span">` with a wavy underline and, in the contrast theme and forced colours, a 2 px outline, so colour is never the only cue. A second line draws a `^` under the start. Both lines are in a `<pre>`, with the caret line `aria-hidden`; the locator sentence ("Line 1, column 28") is the accessible way to the same fact. When `span.approximate` is true the panel adds "The end of the marked part is approximate." Code point offsets are converted to UTF-16 indices by a pure helper, with a unit test on a string that holds a surrogate pair. When there is no span (an execution error with no position), there is no excerpt and no caret.
- **Show in field** (shown when the path ends in `/params/<name>` and the field exists) selects the step (`actions.selectStep`), dispatches the existing `forge-focus-pane` event for the recipe pane with the extra detail `{ param, selection }` (`FocusPaneDetail` gains the two optional fields; the shell owner makes that change), expands a collapsed card or lane on the way, focuses the field and sets its selection to the span. This is the one place the page moves the caret, and it is on a button press.
- **Show step** is the existing button.
- A parameter supplied by a register keeps its sentence ("The parameter `cond` was supplied by register `v`."), above the Relix block, because the text the engine saw is the register's.

### 8.3 Other Relix cases

| Case (RELIX.md §7) | What the panel adds |
|---|---|
| An FL error inside a Relix function (`detail.via = "relix"`) | "This error came from the FL operation `fl.base64.decode`, called inside the query." and the arguments (each cut to 80 code points, as the detail is). The error keeps its own FL code and message. The step is the one whose clause makes the call. |
| `E_USER`, `reason: "unbounded"` | The engine's message, and the sentence "A query over data that never ends needs a limit before a step that must see every row." |
| `E_LIMIT_VALUE` for a relation over the node or text limit | The existing limit text; no new sentence. |
| `E_PARAM_INVALID` for `cover` with `exact`, or `optimize` | The existing parameter mapping puts the message beside the field. The step card also shows "Not in the browser" (§9.2). |
| `E_INTERNAL`, the engine chunk failed to load | "The Relix engine could not be loaded: `<error>`. Check your connection, then bake again." and a **Bake again** button. |
| `E_INTERNAL`, generated text failed to parse | "This is a bug in the Relix pack, not in your recipe." and the details, collapsed. |
| `E_ABORTED`, `E_LIMIT_TIME` from a cancelled engine query | The existing texts. |
| Analysis warnings (`Severity.WARNING`) | They are not errors. If the bake result carries step warnings (RELIX.md §7.1: "a bake warning on the step"), the step card shows a warning mark and the text. The result field is an ask of R13. |

---
## 9. Smaller items and a list of UI.md edits by section

### 9.1 The help dialog

- **`setup`, `finish`, `inputs` and slots in an example** (RECIPES-1.2 §10.3). A help example may carry steps before and after the op, named inputs and slot lanes. The dialog shows them in plain text: "Start with: Parse CSV", "Then: Table to CSV", "Tab `customers.csv` contains: ..." (the input, as the dialog shows other inputs, with the same cut and escapes) and, for a slot op, "Right side: Input tab `customers.csv`, Select `country = 'NZ'`". **Try it** loads the whole recipe (the setup, the op and the finish, with any lanes) and creates the tabs that `inputs` names, with exactly those names, in tabs of their own, never over the person's work (the existing "Replace the recipe?" step and the never-overwrite-the-input rule stand). `planTryIt` and its guard test grow to cover the new fields, and the guard still runs over every example of the built `help.json`.
- **The full reference page of a Relix operation** (RELIX.md §10.2) is plain text from `relix-reference.json`, loaded lazily with the pack: each `#` section as a heading element, its body as text in a `<pre>` (rule 6; Markdown is not rendered). A code block is a `<pre>`; a link is plain text.

### 9.2 "Not in the browser"

An operation that cannot run in the browser build (`relix:optimize`; `relix:cover` with `exact`, RELIX.md §4.6) is listed, and its row and card show the text **Not in the browser** with a short sentence in the quick help ("OPTIMIZE needs a solver, which is not part of the browser build"). It is not a fit level, and not red. Adding it is allowed, because the pack fails it at build with a clear error (§8.3) and a person may be preparing a recipe for the JVM. This is the badge asked for in RELIX.md §16, item 11.

### 9.3 Reference pages (UI.md §8)

The generated reference pages under `/ops/` come from the catalogue at build time. Recommend that the pages for pack operations are generated too (Q14 in §11), each marked "Part of the Relix pack, which is off by default" with an **Open in Forge** link. The link goes through the offer dialog of §6.5, so it works from a cold browser. The build does not load the engine. The page text comes from the pack's metadata.

### 9.4 The shortcuts dialog

The dialog lists keys by pane (UI.md §1.5). It gains three groups: **Table** (the grid keys of §1.7), **Expression field** (Ctrl+Space, Enter or Tab, Escape of §3.4) and **Lanes** (the lift and slot-stop keys of §4.4, and the pointer-free routes: Choose a table, Swap sides, Make main line).

### 9.5 File ownership (UI.md §2.2)

New directories and files, each with an owner. All new source files carry the Apache-2.0 header (CLAUDE.md).

| Path | Content | Work package |
|---|---|---|
| `src/io/viewers.ts` and test | the viewer registry, `renderExt`, the fallback | X2 |
| `src/io/table-view.ts`, `table-model.ts` and tests | the table viewer and its pure model (aria counts, `windowRange`, cell text rules) | D3 |
| `src/ops/fit.ts` (existing, amended) and test | ext types, conversions, repairs | X2 |
| `src/params/ext-field.ts`, `ext-widgets.ts` and tests | the field and the helper registry | X3 |
| `src/params/tab-picker.ts` and test | the `tab` field | X5 (RW10) |
| `src/bake/share-tabs.ts` and test; `forge-share-dialog.ts` (amended) | the tab list, sizes, limits | RW10 |
| `src/packs/*` | the manager, the offer dialog, the store, `packIndex` | P4, P5 |
| `src/recipe/lanes/*`, `src/recipe/tree/*` and tests | slot cards, drop rules, the Tree and its layout | RL3, RL4 |
| `src/state/recipe-ops.ts` (shell-owned, amended), `dnd.ts`, `actions.ts`, `types.ts` | slot lists, payloads, the packs slice | RL2, P4 (the shell owner makes the change) |
| `src/io/error-panel.ts`, `describe-path.ts` and tests | the "From Relix" block, the path in words | X2 (path), R5b or R14 (Relix block) |
| `e2e/*.spec.ts` | §10 | the owner of each package above, with WP 3.9's fixtures |

### 9.6 The bundle budget (UI.md §7)

Packs sit outside the 250 kB gzip core-plus-shell budget and carry their own (TOOLKIT §5.2, P7). In the core, the viewer registry, the fit changes and the ext field belong to the budget; the table viewer, the Tree view and the pack manager load with a dynamic `import()` on first use, and are outside the start-up bundle, as `help.json` and the checks are. `npm run size` reports each lazy chunk against the number its work package states.

### 9.7 The master list: UI.md sections and what changes

This is the list to apply, section by section, as the work packages land.

| UI.md section | Change | This file | Work package |
|---|---|---|---|
| Title block and §1 intro | Status line names UI-TOOLKIT.md as the proposal until folded in | none | the last landing package |
| §1.1 Regions | Output line (viewers); recipe pane line (the Lanes/Tree control and As text button); top bar More menu (Packs...); status bar (packs on); dialog list gains `forge-packs-dialog`, `forge-pack-offer-dialog` | §1, §4.5, §6 | X2, RL3, P4 |
| §1.2 Tokens | No new token. Viewers use the existing ones. A token may be added only if D3 finds a missing one (for example a row-hover surface), and then it goes in `tokens.css` for all three themes | §1.7 | D3 |
| §1.4 Responsive | The Tree view is hidden below 900 px; grid and lane behaviour at 390 px | §1.7, §4.5 | D3, RL3 |
| §1.5 Keyboard map | No global key. The shortcuts dialog gains three groups | §9.4 | D3, X3, RL3 |
| §1.6 Accessibility | No change to the baseline. The three themes and compact checks of §10 apply to every new component | §10 | all |
| §2.2 File layout | The rows of §9.5 | §9.5 | all |
| §2.3 WP 3.2 Operations pane | Kind-aware fit; Data here line; Tables group in the drawer; the packs footer line; Not in the browser | §2, §6.7, §9.2 | X2, RL5, P4 |
| §2.3 WP 3.3 Recipe pane | Output badge, input mark and coercion badge on cards; slot cards, drop rules, keyboard stops, the views; issue texts; `pack-not-enabled` card; the pack banner | §2.4, §4, §6.5 | X2, RL3, RL4, RW10, P5 |
| §2.3 WP 3.4 Parameter form | The `ext` field, helper registry, completion, async check; the tab picker; Register switch for ext | §3, §5.2 | X3, R5b, X5 |
| §2.3 WP 3.5 Input and Output | Viewer host, toolbar per kind, the footer, error panel Relix block, missing-tab text; unique tab names, read-by-recipe marker, rename offer | §1, §5.1, §5.3, §5.4, §8 | X2, D3, X5, RW10 |
| §2.3 WP 3.6 Bake controller | `inputs` in the bake call; the share dialog's version note, pack note and tab list; opening a link with tabs; the offer on `packs-needed` | §5.5 to §5.7, §6.5 | X5, RW10, P5 |
| §2.3 WP 3.7 Persistence | Open dialog uses the pack banner; the `kv` key `packs` | §6.2, §6.5 | P4 |
| §2.3 "Registers and return" | Slot lanes: scope, `return` refused, register shown in a lane; the pause list draws ext values with viewers | §1.1, §4.1 | RL2, X2 |
| §3.1 to §3.3 Store, actions, events | `packs` slice, `setPackEnabled`, slot actions, `FocusPaneDetail` extension, `DialogId` additions | §4.1, §6.4, §8.2 | RL2, P4, R5b |
| §3.4 Feature entry, §3.5 Catalogue loading | Packs register a feature when their chunk loads; the catalogue is per enabled set | §6.3 | P4 |
| §3.6 Pointer drag service | `source` and `pipe` payloads; slot targets | §4.1, §4.3 | RL3 |
| §3 "Recipe tree paths" | Slot paths and `childLists` | §4.1 | RL2 |
| §4 Security rules | The header block; rules 5, 6, 7, 8, 10, 12 amended; rule 13 new | §7 | X2 (6), P4 (8, 10, 13), RW10 (12), T6 media WP (header, 7) |
| §5 User words and the console | The console `init` takes pack ids | §6.7 | P3 |
| §6 Testing | The suites of §10; a CSP golden test; the optional Firefox and WebKit smoke | §10, §7.5 | WP 3.9 owners |
| §7 Bundle budget | Lazy chunks of §9.6 | §9.6 | P7 |
| §8 Static pages | Reference pages for pack operations | §9.3 | pages owner |

---

## 10. Accessibility and test list

Every new component passes the bar of UI.md §1.6 and §6: keyboard only, an accessible name and state on every control, polite announcements, no colour-only signal, 200% zoom, reduced motion, forced colours, and axe with **zero** violations of the tags `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa` in the **light, dark and contrast themes**, in the wide **and compact** layouts. Every e2e test uses the shared fixture, which fails on any console message, page error, failed request or `securitypolicyviolation` event.

### 10.1 Unit tests (Vitest, node, pure modules)

- `viewers.test.ts`: registration is idempotent and last wins; a viewer that throws, returns a non-element, or is unregistered gives the fallback and the right sentence; the failure announces once.
- `table-model.test.ts`: summary text for cut, uncut and empty tables; `aria-rowcount` and `aria-colcount` count what is in the DOM; null, empty and the text `null` get different labels; `windowRange` at the edges (first, last, one row, overscan).
- `fit.test.ts`: every row of the table in §2.2, including the conversions and repair text; the old rows are unchanged; `dataLine` for each source of the answer.
- `ext-check.test.ts`: sequence numbers discard a stale reply; tier 2 runs only after tier 1 passes; a failed check shows nothing; the code point and UTF-16 conversion on a surrogate pair; the 4,096 count uses code points.
- `lane-ops` tests (RL2): every row of the drop-rule table, swap and main line give the layouts of RELIX-LANES §3.2 and are involutions where they should be, main line is refused with an empty other slot, undo restores the tree, `relix:recur` placement, Return refused in a lane.
- `tree-layout.test.ts`: the layout is a pure function; the same recipe gives the same boxes; a shared relation draws two sources.
- `share-tabs.test.ts`: only tabs from `inputNames` are listed; sizes; the limits (16 tabs, bundle size, fragment length) give the right text; the main tab row follows "Include the input".
- `tab-picker.test.ts`: exact matching, the "Did you mean" case, a register-supplied name, unique-name rules (empty, 121 code points, a control character, a duplicate).
- `pack-state.test.ts`: `packIndex`; unknown stored ids dropped; the states and the disable confirm text; the offer's pack list comes from the index and not from the link.
- `describe-path.test.ts`, `error-span.test.ts`: the table of §8.1; the excerpt and caret for a span at the start, middle and end, an approximate end, a span past the text.

### 10.2 End to end (Playwright, production headers)

| Spec | Covers |
|---|---|
| `viewers.spec.ts` | A table output shows the grid; an unknown kind and a failing viewer show the text with the right sentence and the value is still there; Copy says "first 4,000 characters" when cut; Convert to bytes adds a step and the output becomes bytes; the paused view and a register show an ext value |
| `table-view.spec.ts` | Summary and limit text; keyboard through the grid (arrows, Home, End, Ctrl+Home, Page Down); null and empty look different; a 100 by 60 table windows and keeps row indexes; hostile cell and column text (`<img src=x onerror=...>`, `</script>`, a right-to-left override) renders as text and fires nothing; axe in three themes, wide and compact; forced-colours emulation keeps a visible focus |
| `ext-field.spec.ts` | Live check text and Show where; completion opens with Ctrl+Space, accepts with Enter, closes with Escape and never traps Tab; columns from the schema; both groups for a join; "Columns are not known" after a failed step; the async check does not cancel a running bake; axe |
| `lanes.spec.ts` | The Gate T4 recipe built with the keyboard only: add a join, choose a table, swap, make main line, join in, move a step into a slot, with each announcement asserted; drop refusals; `FIX` with `relix:recur`; `unused-pipe` text; compact layout; axe |
| `tree.spec.ts` | The Tree shows the same recipe as Lanes; sockets swap; Enter selects and returns to Lanes; the tree keys; hidden below 900 px; axe |
| `named-inputs.spec.ts` | The tab picker; the missing-tab text before and after a bake; Add a tab named...; unique names; read-by-recipe marker; the rename offer and one undo; only the named tabs are sent (a hook counts the buffers); a hostile tab name |
| `share-tabs.spec.ts` | The dialog lists tabs with sizes; leaving one out gives the consequence line; the notes (version, pack); a link round trip with two tabs; opening it asks before replacing a tab; a v1.1 recipe's link is unchanged |
| `packs.spec.ts` | The manager: turn on, off, persistence across reload, an unknown stored id dropped, the failed state and Try again; the offer from a link with `packs-needed` (Turn on and open, Open without the pack, Cancel); a hostile pack id in a fragment; the banner for a saved recipe; the demo pack (P8) loads lazily under the production headers |
| `relix-errors.spec.ts` | The block, the excerpt and caret, Show in field moves the caret and selection; an FL error inside a query; the engine-load failure and Bake again; hostile engine text |
| `csp.spec.ts` | The CSP golden test (below); `new Function("return 1")` throws `EvalError` (the positive control, so a regression that adds `unsafe-eval` is caught); a module worker `import()`s a pack chunk; adopted stylesheets raise no violation; a `blob:` image loads; **after T6**, a `blob:` audio element loads |

**The CSP golden test.** It parses `infra/site.tf` (as `serve-prod.mjs` does) and compares the directives, one by one, to an expected list in the test. A change to the header fails the test until the test and UI.md §4 change together. Before T6 the expected list is today's string. At T6 it gains `media-src blob:` in the same pull request as the `site.tf` edit.

### 10.3 Hostile input, one list

Every new text sink is covered by the same set of strings (`<img src=x onerror=alert(1)>`, `"><svg onload=...>`, `javascript:alert(1)`, `</script><script>`, a 5,000-character unbroken word, a right-to-left override, a lone surrogate, a C0 control character, a name of 121 code points) in: a cell and a column name; an ext text; a tab name (picker, share dialog, error text); an engine message and its excerpt; a pack id and name in a fragment; a viewer's kind name; a relation's node text. The assertion is the same each time: the text appears as text, and no script, request or violation results.

---

## 11. Open questions, with recommendations

Each question has a recommendation. None is decided. Q6, Q7 and Q8 answer the open editor questions of RELIX-LANES (its Q4, its Q1 and the second point of its Q5). The others are raised by this file.

| # | Question | Recommendation |
|---|---|---|
| Q1 | The table viewer: how many rows, and when to window? (T21 says first N with a stated limit.) | N is 100, as X0 measured. Draw whole up to 5,000 cells, window beyond that, so find-in-page and browse mode keep working in the common case. Set `aria-rowcount` to the rows present and state the total in the limit sentence. No sorting in 1.0. D3 confirms the 100 and the column cap (256, like the schema). |
| Q2 | Copy and Download only see `output.text`, cut at 4,000 characters. How does the page know it was cut? | X2 adds `truncated: true` to the `ext` output (a field of the contract bump of T19, no extra cost). The buttons say "first 4,000 characters", and Convert to bytes gives the whole value. Without the flag the page would have to guess from a trailing `...`. |
| Q3 | "Move to input" cannot work for an ext value. A disabled button, or a menu? | A **Convert to bytes** menu that adds `table:to-csv` or `table:to-json` (the viewer's `bytesOps`). One click, visible, one undo step, and the bytes route is then the existing one. |
| Q4 | Which conversions show as amber? | The lift (`table` to `relation`) is green with a badge: it cannot fail and costs nothing. The run (`relation` to `table`) is amber with "runs the query first": it executes, can fail, may be slow. Both carry the coercion badge. |
| Q5 | Where does the async `relix-expr` check run? | In the bake Worker, only when it is idle, one request queued, never cancelling a bake. The page never starts a second engine for a check. A bake is the work and a check is advice. Needs the generic `ext.check` message from X5 and R13. |
| Q6 | RELIX-LANES Q4: is the Tree view editable in v1? | **Read-only**, with the L and R sockets and Swap sides and Make main line as buttons, and "Enter selects and goes to Lanes". A second editable view needs a second hit-test and keyboard design, and a 2-D diagram is the hard part of accessibility. Revisit after v1 with the keyboard tests in hand. |
| Q7 | RELIX-LANES Q1: the default pipe side of "join it in". | The data above on the **left**, the dropped table on the right, with an announcement that names the Swap. No toast: a toast with a button is a poor fit for assistive technology, and Undo and Swap sides already exist. |
| Q8 | RELIX-LANES Q5, second point: after Main line, if the other slot is empty, what is the first step? | The question goes away: **Make main line is disabled** when the other lane has no enabled step, with the reason shown. The normal-form rule 1 case is then unreachable by this button. |
| Q9 | RELIX-LANES §5.3: is As text a third in-pane view or a dialog? | A **dialog** (the "View as text" dialog with tabs FL, Relix, JSON), opened by a button beside the Lanes and Tree tabs. It is wider than the pane, works in the compact layout, and extends the dialog that exists. |
| Q10 | Which tabs does a bake send? | Only the tabs `inputNames(recipe)` lists, plus the active tab, and all tabs if any tab name comes from a register. Each bake copies and transfers the buffers, and auto-bake runs on every keystroke. This is a rule for X5's controller. |
| Q11 | What happens when a tab that steps read is renamed or closed? | Offer, in one undo step, to update the steps (rename) or confirm (close). A silent break is the worst outcome. |
| Q12 | A link that carries tabs: merge or replace? | The carried names win: same name replaces that tab's bytes, a new name adds a tab, the recipe replaces the recipe, and a confirm step lists what will be replaced. Exact names are the contract, so merging by renaming would break the recipe. |
| Q13 | Pack defaults and discovery. | All packs **off** in a fresh browser (T5), the choice kept per browser in IndexedDB, **no "always trust" setting**, and no search into packs that are off in 1.0 (the drawer's one-line "Packs: ..." and the Packs dialog are the way in). Search into off packs needs an index of operation names and text, which is a build and size decision for P1 and P7. |
| Q14 | Reference pages (`/ops/`) for pack operations? | **Yes**, generated from pack metadata, marked as part of an optional pack, with an Open in Forge link that goes through the offer. People find operations through search engines. |
| Q15 | When is `media-src blob:` applied? | At **T6**, with the media pack, not now. Least privilege until used. Land the UI.md text and the CSP golden test earlier, against today's string. The owner approves and applies the one-line `site.tf` change. |
| Q16 | Run a Firefox and WebKit smoke of the viewer and the CSP test? | Yes, if the CI image has them (UI.md §6 allows it). The adopted-stylesheet finding is Chromium only. It is a smoke, not the full suite. |

---

## 12. Work package mapping

Which package carries each change. Rows are those of TOOLKIT §13.5 and §13.6, RELIX-LANES §11.2 and RECIPES-1.2 §18. SP3 itself changes no code.

| Change | Section | Carried by |
|---|---|---|
| Viewer registry, contract, fallback, failing viewer, Copy, Download, Convert to bytes, footer, `truncated` flag | §1.1 to §1.6, Q2, Q3 | **X2** (with `packages/worker/src/render.ts`) |
| Table viewer: grid, summary and limit, null and empty, windowing, keys, themes | §1.7 | **D3** |
| Relation viewer | §1.8 | **R3** (the kind) with X2's registry |
| Kind-aware `fit.ts`, badges, Data here, `planConversions` use | §2 | **X2** (R5 of X0); RL3 draws the lane messages |
| Ext field, helper registry, completion, live check, schema source | §3.1 to §3.4, §3.6 | **X3** (needs X5's `StepReport.out`) |
| Tier-2 check, completion helper for `relix-expr`, the Relix field UI | §3.5 | **R5a** (tier 1), **R5b** (tier 2 and UI) |
| `ext.check` worker message, engine-loading event, step warnings | §3.5, §6.3, §8.3 | **X5** and **R13** |
| Slot paths, `childLists`, actions, payloads, normal form | §4.1 | **RL2** (RW1 for the format) |
| Slot cards, drop rules, keyboard, announcements, issue texts | §4.2 to §4.4, §4.7 | **RL3**, with **RW10** for the texts |
| Tree view | §4.6 | **RL4** (R6) |
| Drawer Tables group, fit filter for lanes | §4.8 | **RL5** |
| "View as text" dialog, View as Relix | §4.5 | **RL6**, **R7a** |
| `.relix` import dialog | §4.5 | **R7b** |
| Lanes, Tree and accessibility end-to-end | §10 | **RL7** |
| Per-step schema and row counts on Tree nodes | §4.6 | **R8** |
| Unique tab names, the tab picker, missing-tab text, read-by-recipe marker, rename offer, sending `inputs` | §5.1 to §5.5 | **X5** (RW5 for the worker, RW10 for the page) |
| Share dialog: version note, pack note, tab list; opening a link with tabs | §5.6, §5.7 | **RW10** (RW6 for the codec) |
| Pack manager, persistence, state, `PackIndex` in the store | §6.2 to §6.4 | **P4** |
| Enable offer, banner, `packs-needed` and `pack-not-enabled` texts | §6.5, §6.6 | **P5** (needs RW6), texts with **RW10** |
| Console `init` with pack ids; catalogue per enabled set | §6.7 | **P2**, **P3** |
| Demo pack proving lazy load under production headers | §10 | **P8** |
| CSP: UI.md §4 text (rules 5, 6, 8, 10, 12, 13) | §7.3 | **X2** (6), **P4** (8, 10, 13), **RW10** (12) |
| CSP golden test and `csp.spec.ts` | §7.5, §10 | **X2** or **P8**, whichever lands first |
| `media-src blob:` in `infra/site.tf`, PLAN §10 | §7.1, §7.5 | the media pack's WP (**T6**), owner approval and `terraform apply` |
| Relix error block, span excerpt, Show in field, `describePath` | §8 | **R5b** and **R14** for the Relix block, **X2** for the panel base |
| Help dialog fields, Try it, reference text, Not in the browser, `/ops/` pages | §9.1 to §9.3 | **RW10**, **R10**, the pages owner |
| Relix security tests (hostile text) | §10.3 | **R14** |
| UI.md fold-in for what shipped | §9.7 | each package, then a last pass |

---

## 13. Edits needed in other documents

This file edits none of them. The orchestrator applies or briefs these.

**TOOLKIT.md**

1. §13.3, row SP3: "UI.md amendments: viewers, pack rules, CSP" becomes first a proposal file, `docs/UI-TOOLKIT.md`, with UI.md changing as work packages land (as SP2 did). "Owns" becomes `docs/UI-TOOLKIT.md`. Mark it written once approved. "Depends on SP1" is not needed for this proposal.
2. §5.5: **rule 6 is amended, not "unchanged"**: it gains the viewer and shadow-root rules (§7.3). Rule 8 amended as written. Add rule 13 (packs) and the amendments to rules 5, 7, 10 and 12. Replace "Nothing else in the CSP changes" with a pointer to UI-TOOLKIT.md §7.1 and §7.2, which also says when `media-src blob:` is applied (T6).
3. §7 and §13.5 disagree on the names of the table export words: §7 writes `table:>csv` and `table:>json`, and the D2 row writes `table:to-csv` and `table:to-json`. This file uses `table:to-csv` and `table:to-json`. SP1 or the D2 brief should settle the spelling.
4. §6.2: the viewer table lists `rat`, `cplx`, `qty` and `matrix` with viewer "text". Add that a kind with no `view` is drawn by the text fallback, and that a viewer is a `render(output, ctx)` function with optional `copyText`, `download` and `bytesOps` (UI-TOOLKIT.md §1.2).
5. §5.2, §5.5: the enable offer (P5) and the pack manager (P4) point to UI-TOOLKIT.md §6, and the notice text of §6.5 is the text that §5.2 asks for.
6. §13.5, rows X2, X3, X5, P4, P5 and D3: add the specifics that this file fixes. X2: the `truncated` flag on the `ext` output (Q2), `bytesOps`, the CSP golden test. X3: the helper contract with a position in the result and an async `checkAsync`. X5: only named tabs are sent (Q10), unique tab names. P4: the `kv` key, the `packs` state, the `DialogId` additions. D3: the 100-row limit, windowing at 5,000 cells, the null and empty rules.
7. §14.2: add the open questions Q1 to Q16 of UI-TOOLKIT.md §11 by reference, or list those the owner must decide (Q2, Q3, Q4, Q6, Q7, Q9, Q13, Q15).
8. §14.1, risk 8 ("CSP relaxation for media"): add that it is applied at T6 and guarded by the CSP golden test.
9. §15, UI.md bullet: "Amended in WP SP3" becomes "Amended as work packages land, from the proposal UI-TOOLKIT.md (WP SP3)". Add a UI-TOOLKIT.md bullet.
10. §2.3 blockers or §14.1: the `serve-prod.mjs` server omits `Permissions-Policy`, HSTS and `X-Frame-Options`, which `site.tf` sets. Not a blocker, but the e2e suite does not test those headers.

**RECIPES-1.2.md** (§19.2, "UI.md (SP3)")

11. The bullet that asks for UI.md edits is met by UI-TOOLKIT.md §5.6 (share dialog sentence, tab and pack lists), §5.3 (the missing-tab text), §6.6 (the `pack-not-enabled` text), §3 (the use of `StepReport.out`) and §9.1 (`setup` and `finish` in the help dialog). Note the page-level "missing tab" notice is not a recipe issue code.

**RELIX-LANES.md**

12. §5.3 and L4: As text is a dialog beside the Lanes and Tree tabs (Q9). §12.2, Q1, Q4 and Q5 (second point): record the recommendations of Q7, Q6 and Q8 once decided.

**RELIX.md** (§16, item 11)

13. Item 11 (SP3 / UI.md) is met by UI-TOOLKIT.md §1.8 (the relation viewer), §9.1 (the plain-text reference view) and §9.2 (the "Not in the browser" badge). §16 item 9 adds: the generic `ext.check` request is a message of the bake Worker that the page sends only when it is idle (UI-TOOLKIT.md §3.5).

**PLAN.md**

14. §10: the CSP bullet and the `connect-src` sentence, as in §7.5, when the owner approves. The Phase and decision tables gain the rows of §12 once the owner approves this file, as WPs 6.34 to 6.41 did for 1.1.

**UI.md**

15. No edit now. The edits are the list of §9.7, applied by the work packages as they land.

**PACKS.md (SP4)**

16. The manifest fields that the UI needs are listed in §6.7. The `media` pack's manifest states which kinds have viewers and which need `media-src blob:`.

**infra/ (owner)**

17. `infra/site.tf` `locals.csp` gets `media-src blob:` at T6. It is an infra change, so it needs the owner's approval and a `terraform apply`. Nothing else in `infra/` changes.
