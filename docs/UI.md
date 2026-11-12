# Forge UI specification (Phase 3)

Status: v1, written with WP 3.1 (2026-11-10). This is the authoritative spec for `apps/web`. It sits beside [PLAN.md](PLAN.md) (§4 UI, §5 security, §6 testing, §10 hosting), [RECIPES.md](RECIPES.md) (catalogue §2.3, recipe JSON §3, share URL §7, bake API §8) and [LANGUAGE.md](LANGUAGE.md). Where the three disagree about the UI, this document wins.

The shell (WP 3.1) is already implemented, and the shared contracts of §3 are real TypeScript under `apps/web/src/state/`. Every other work package builds against them and **only edits the files it owns** (§2.2).

## Contents

1. Layout and visual design
2. Architecture, file ownership, work packages
3. Shared contracts
4. Security rules imposed by the production CSP
5. User words and the console
6. Testing
7. Bundle budget
8. Static site pages

---

## 1. Layout and visual design

Forge's layout is its own. It is a **workbench with a pipeline in the middle**, not a three-column copy of any other tool: the recipe is a vertical pipeline of step cards, flanked on the left by a drawer of operations and on the right by the data (input over output).

### 1.1 Regions

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ top bar: [ops drawer toggle] Forge · recipe name ●           Share Save Open View-FL Console 🌓 ⋯ │
├──────────────┬─┬─────────────────────────┬─┬────────────────────────────────────────────────┤
│ OPERATIONS   │ │ RECIPE                  │ │ INPUT                                           │
│ (drawer)     │ │ ┌ step 1 ─────────────┐ │ │  tabs, file drop, encoding/EOL, length, entropy │
│  search      │ │ │ op · params · ⋮     │ │ ├─┴─────────────────────────────────────────────┤
│  favourites  │ │ └──────────┬──────────┘ │ │ OUTPUT                                          │
│  categories  │ │            ▼            │ │  text/hex view, copy, download, move to input,  │
│              │ │ ┌ step 2 ─────────────┐ │ │  structured error panel                         │
│              │ │ │ ...                 │ │ │                                                 │
├──────────────┴─┴─────────────────────────┴─┴────────────────────────────────────────────────┤
│ console (collapsible, own splitter)                                                          │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ status bar: bake state · timing · step/continue · auto-bake        N operations · catalogue v │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Element | Notes |
|---|---|---|
| Top bar | `forge-topbar` | Brand (`<h1>`), editable recipe name, unsaved dot, **Share / Save / Open / View FL / Console** buttons, a theme menu (System, Light, Dark, High contrast) and a **More** menu (View recipe as FL, Show/Hide console, Keyboard shortcuts, then links to About, Privacy, Terms, Security, Accessibility at `/about/`, `/privacy/`, ...). The left button toggles the operations drawer. Below 1100 px the button labels are hidden (the accessible names stay); below 560 px View FL and Console move into the More menu only. |
| Operations drawer | `forge-operations` | Left. Search, favourites, categories, help. Collapsible. |
| Recipe pipeline | `forge-recipe` | Centre. Vertical step cards joined by a connector line; nested blocks for containers. Collapsible. |
| Data column | `forge-input` over `forge-output` | Right, takes the remaining width. The two panes share a horizontal splitter. |
| Console | `forge-console` | Bottom, full width, hidden until toggled. Own splitter above it. |
| Status bar | `forge-statusbar` | Left: `forge-bake-controls` (WP 3.6). Right: catalogue state (`N operations · catalogue <version>`, a retry button on failure). |
| Dialogs | `forge-share-dialog`, `forge-save-dialog`, `forge-open-dialog`, `forge-fl-dialog`, `forge-shortcuts-dialog` | Native `<dialog>` via the `ForgeDialog` base class; opened with `actions.openDialog(id)`. |

Landmarks: `<header>` (top bar), `<main>` (workbench, console, compact tab bar), `<footer>` (status bar), each pane a labelled region (`Operations` is an `<aside>` with `role="region"`). A skip link ("Skip to recipe") is the first focusable element. One shared polite live region (`role="status"`) carries `actions.announce(text)`.

### 1.2 Visual language, tokens, themes

- **One tokens file**: `src/styles/tokens.css`. It is the only place that writes raw colours, sizes or font names. It defines, as CSS custom properties on `:root`: colour roles (`--bg --surface --surface-2 --surface-3 --border --border-strong --text --text-muted --accent --accent-hover --accent-fg --accent-soft --focus --danger --danger-soft --warn --warn-soft --ok --ok-soft --link --selection --drop`), spacing (`--space-1..6`, 0.25 to 2 rem), radii (`--radius-s/m/l`), type scale (`--text-xs/sm/md/lg/xl`, `--leading-*`, `--weight-*`), fonts (`--font-ui`, `--font-mono`: system stacks only), the focus ring (`--focus-width`, `--focus-offset`), chrome sizes (`--topbar-h --statusbar-h --splitter-size --hit-min`), `--border-width` and `--motion`.
- **Themes** are selected by `data-theme="light|dark|contrast"` on `<html>`, set by `boot.ts` (`watchTheme`). The user preference is `system | light | dark | contrast`, remembered in `localStorage["forge.theme"]`. `system` resolves `prefers-contrast: more` to `contrast`, else `prefers-color-scheme`; the app follows live changes. With no attribute (before the script runs) a media query in tokens.css picks light or dark, so there is no flash and no inline script is needed.
- **Light** is warm paper with an ember accent (`--accent` `#a9420a`); **dark** is slate with a lighter ember; **contrast** is black and white with a yellow accent, 2 px borders (`--border-width: 2px`), a 4 px cyan focus ring and no shadows. Also honour `forced-colors: active` (system colours) and `prefers-reduced-motion` (`--motion: 0ms`).
- Text and UI contrast: body text at least 4.5:1, large text and component boundaries at least 3:1 in every theme (the axe audit of WP 3.9 enforces this on the whole page). Never convey state by colour alone.
- **Focus** is always an outline (`:focus-visible`, `--focus-width` solid `--focus`, `--focus-offset`), never removed.
- **Components** include `baseStyles` (and `paneStyles` for panes) from `src/styles/shared.ts` in their `static styles`, and use only tokens. Buttons are at least `--hit-min` (2.25 rem) square. Icons are inline SVG from `src/styles/icons.ts` (`aria-hidden`; the button carries the name).
- **No web fonts, no external hosts**, no images other than inline SVG.
- Type: UI text 15 px base; section titles are small caps-style (`pane-head h2`); output and parameter values in `--font-mono`.

### 1.3 Splitters, collapsing, remembered sizes

`forge-splitter` implements the WAI-ARIA window splitter pattern:

- Host attributes: `role="separator"`, `tabindex="0"`, `aria-orientation` (the separator line's orientation: **vertical** for a bar between side-by-side panes), `aria-label`, `aria-controls` (id of the controlled pane), `aria-valuenow` (current size; **0 while collapsed**), `aria-valuemin="0"`, `aria-valuemax`.
- Pointer: drag with pointer capture (works for mouse, pen, touch); double-click toggles collapse.
- Keyboard (pure logic in `state/layout.ts` `splitterKey`, unit tested): Left/Right on a vertical separator, Up/Down on a horizontal one, move the **handle** by `step`; Shift+Arrow and PageUp/PageDown by `largeStep`; Home and End jump to min and max; Enter toggles collapse. From the collapsed state a resize key re-opens the pane.
- `invert` is true when the controlled pane is after the handle (the console), so that dragging towards the start grows it.
- Splitters: operations width (px), recipe width (px), input share of the data column (percent, 10 to 90), console height (px). The data column never shrinks below 320 px; maxima follow the window. Operations and recipe panes collapse to zero width and become `inert`; the console collapses by closing it.
- Sizes and collapsed flags are **layout state** in `localStorage["forge.layout.v1"]` (versioned, sanitised on load by `sanitizeLayout`, errors swallowed). Data (recipes, favourites, user words, options) goes to IndexedDB (§3.7), never to localStorage. Theme preference is the one other localStorage key (it must be readable synchronously before first paint).
- Sizes are applied as CSS custom properties on the host through the CSSOM (`style.setProperty`), never as `style="..."` attributes.

### 1.4 Responsive behaviour

- At 900 px and above: the four-pane workbench of §1.1.
- **Below 900 px** (`COMPACT_BREAKPOINT_PX`; `matchMedia` sets `ui.compact`, host attribute `compact`): one pane at a time (the Recipe pane is shown first), chosen by a bottom tab bar (`role="tablist"`: Operations, Recipe, Input, Output, plus Console when open; Arrow keys, Home and End move between tabs, roving tabindex). Panes stay in the DOM (hidden ones are `display: none`), so state is kept. Splitters are not shown. `actions.setCompactTab` switches; adding an op from the operations tab does not switch automatically (it announces "Added <op> to the recipe" instead).
- Touch: all targets at least 36 px; drag and drop has a non-drag alternative everywhere (§2.3).

### 1.5 Keyboard map (global)

| Keys | Action |
|---|---|
| `Alt+1` .. `Alt+4` | Focus operations, recipe, input, output (uncollapses, or switches tab when compact). Uses `event.code` so it works on every layout. |
| `Alt+5` | Open the console and focus it. |
| `Tab` / `Shift+Tab` | Normal document order: top bar, operations, recipe, input, output, console, status bar. |
| `Esc` | Closes a menu or dialog, cancels a drag. |

Each pane element may implement `focusPrimary(): void` (search box, first step card, text area, ...); the shell calls it for the shortcuts, and falls back to focusing the pane's region. Panes may add their own keys (listed in their own sections); a pane must document them in its header comment and in the shortcuts dialog list (`forge-shortcuts-dialog.ts`, grouped by pane; the code is the authority). `F10` (step) and `F8` (continue) work anywhere while a bake is paused and focus is not in a text field. `Esc` also cancels a pointer drag (`state/dnd.ts` listens on `window` in the capture phase).

### 1.6 Accessibility baseline (part of "done" for every WP)

- Everything works with the keyboard alone; focus order follows visual order; focus is never lost (after deleting a step focus goes to the next step, or the previous, or the list).
- Every control has an accessible name; icon-only buttons have `aria-label`; state is exposed (`aria-pressed`, `aria-expanded`, `aria-selected`, `aria-checked`, `aria-invalid`, `aria-describedby` for errors and help).
- Dynamic results are announced through `actions.announce` or a pane-local `role="status"` / `aria-live="polite"` region (not `assertive`, except for a failed bake error summary, which uses `role="alert"` once per failure).
- Respect `prefers-reduced-motion`, forced colours and 200% zoom / 320 px reflow (no horizontal page scroll; the compact mode covers this).
- Drag and drop is never the only way to do something (§2.3, WP 3.2 and 3.3).
- Validation errors appear next to the field, are linked with `aria-describedby`, and the field has `aria-invalid="true"`.

---

## 2. Architecture, file ownership, work packages

### 2.1 Stack

Lit 3 web components (shadow DOM, `static styles` through adopted stylesheets), TypeScript strict with `experimentalDecorators` and `useDefineForClassFields: false` (see `tsconfig.json`), Vite 8, no UI framework, no router (hash-only state, §WP 3.6), no runtime dependency beyond `lit` and the `@forge/*` packages. State is a hand-written reactive store (§3.1).

### 2.2 File layout and ownership

All paths are under `apps/web/`. **A work package edits only the paths it owns.** If it needs a change elsewhere (a new store field, a new action, a new event, a shell hook) it reports it to the orchestrator; the shell owner (WP 3.1) makes it. Adding a *new file* inside your own directory is always fine. Merge conflicts then cannot occur except in `package-lock.json` and `package.json`, which the orchestrator resolves.

| Owner | Paths | Content |
|---|---|---|
| **3.1 shell** | `index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `package.json` (dependencies: only the orchestrator adds more), `src/main.ts`, `src/boot.ts`, `src/modules.ts`, `src/catalogue.ts`, `src/shell/**`, `src/styles/**`, `src/state/**` (the contracts), `public/favicon.svg` (handed to the pages WP once it exists) | tokens, themes, layout, splitters, menus, dialog base, top and status bar, store, actions, events, DnD service, recipe tree operations, catalogue loader |
| **3.2 operations** | `src/ops/**` | `forge-operations` and everything it needs (search index, help popover, favourites UI) |
| **3.3 recipe** | `src/recipe/**` | `forge-recipe`, step cards, drag and drop, nested blocks, step controls, `forge-fl-dialog` ("View FL") |
| **3.4 params** | `src/params/**` | `forge-param-form` and field components, issue-path mapping |
| **3.5 input/output** | `src/io/**` | `forge-input`, `forge-output`, encoding, entropy, hex view, error panel |
| **3.6 bake** | `src/bake/**` | bake controller, `forge-bake-controls`, `forge-share-dialog`, URL sync |
| **3.7 persistence** | `src/persist/**` | IndexedDB wrapper, repositories, `forge-save-dialog`, `forge-open-dialog`, promote-to-word |
| **3.8 console** | `src/console/**`, `src/fl/**` | `forge-console`, the console worker, the console client |
| **3.9 e2e** | `e2e/**`, `playwright.config.ts`, `scripts/**`, `devDependencies` and `scripts` entries for them in `package.json`, root `.github/workflows` additions | Playwright, axe, production-header server |
| **pages** | `pages/**` (HTML sources, one directory per page), `public/**` except `favicon.svg`'s initial version (which it may replace), `vite.pages.ts`, `src/styles/pages.css` | static site pages, `robots.txt`, `sitemap.xml`, `.well-known/security.txt` |

Each WP directory has an entry module `src/<dir>/index.ts` that **imports its custom elements (side effect registration) and exports `feature: Feature`** (§3.4). The 3.1 placeholders already exist; a WP replaces its placeholder files and keeps the entry's export. Placeholders to replace:

| Placeholder file | Tag | WP |
|---|---|---|
| `src/ops/forge-operations.ts` | `forge-operations` | 3.2 |
| `src/recipe/forge-recipe.ts` | `forge-recipe` | 3.3 |
| `src/recipe/forge-fl-dialog.ts` | `forge-fl-dialog` | 3.3 |
| `src/params/forge-param-form.ts` | `forge-param-form` | 3.4 |
| `src/io/forge-input.ts`, `src/io/forge-output.ts` | `forge-input`, `forge-output` | 3.5 |
| `src/bake/forge-bake-controls.ts` | `forge-bake-controls` | 3.6 |
| `src/bake/forge-share-dialog.ts` | `forge-share-dialog` | 3.6 |
| `src/persist/forge-save-dialog.ts`, `src/persist/forge-open-dialog.ts` | `forge-save-dialog`, `forge-open-dialog` | 3.7 |
| `src/console/forge-console.ts` | `forge-console` | 3.8 |

Tag names are fixed: the shell renders them by name. A WP may add further elements (prefix `forge-`) inside its own directory.

### 2.3 Work package specifications

All packages: Apache header on every new file; Lit components with the tokens and `baseStyles`; pure logic in separate `.ts` modules with Vitest unit tests (`*.test.ts` next to the module, node environment, no DOM); respect §1.6 and §4; `npm run lint && npm run typecheck && npm test && npm run build` pass; no edits outside owned paths.

**WP 3.2: Operations pane** (`forge-operations`).
- Data: `store.get().catalogue` (`status: "ready"`); re-renders when the catalogue changes (the console worker may publish a new one with user ops). Show a loading and an error state.
- Search box (`type="search"`, label "Search operations", `focusPrimary` focuses it): fuzzy ranking over `qname`, `name`, `aliases`, `doc` and `category` (pure module `search.ts`, tested; prefer prefix and word-boundary matches, name over alias over doc; result list capped, highlights as `<mark>`-free text spans). Empty query: **Favourites** (from `state.favourites`, star toggle per op via `actions.toggleFavourite`) then categories (collapsible, `<details>` or button + `aria-expanded`), ops grouped by `category` (null category: "Other"), user ops (vocab `user`) first. **The categories (and "Other") start collapsed; Favourites and User words start open.** The user opens and closes any section, and the choice holds for the session (kept as a per-section override in the component, so a section without a choice follows the default). A collapsed header shows its operation count; the arrow keys move over the rows of open sections only, and with every section collapsed Down from the search box lands on the first section header. Search results are never collapsed.
- Each op row: name, vocab qualifier (muted), star. Activate with Enter or double click or an explicit **Add** button: `actions.addOp(qname)` and `actions.announce("Added …")`. Drag with the pointer via `beginPointerDrag` (`{ type: "op", op }`); drop targets are the recipe pane's. Keyboard: Arrow Up/Down move through rows (roving tabindex in a `role="listbox"` or `role="tree"` with documented keys), `F` toggles favourite, `Enter` adds. In compact mode adding does not switch tabs.
- Help: hover and keyboard focus (and a `?` button, so touch works) show a popover (`popover` attribute is fine) with the op's `effect` (monospace), `doc`, `aliases`, `seeAlso` (as text), parameters with types, constraints and defaults. **All metadata is rendered as text**, never HTML or Markdown (§4).
- Disabled-state hints: an op whose `input` is not `bytes`/`str` is still shown.
- **Type fit** (pure module `fit.ts`, tested; WP 6.1). The pane header states the type of the data at the end of the recipe ("Data here: text", "bytes", "list"; "any" when it cannot be told). It is the type of the last bake output when there is a finished, successful, non-stale bake; otherwise it is inferred from the last enabled, non-comment step (none: `bytes`; an op: its declared `output`; `fork`, `subsection`, `repeat`: `bytes`; `if`, an unknown op or an output of `any`: unknown), and it updates when the recipe, the bake or the catalogue changes. An op "fits" when the type is unknown, its `input` is `any`, the types are equal, or LANGUAGE.md §4.2 has a coercion (`bytes`↔`str`, `int`↔`num`, `int` or `num` into `number`). An op that does not fit stays addable but is dimmed (muted text and a dashed edge) and carries visible text that is also part of its accessible name, for example "needs a list" (the header line says what the data is). The **Fits the data** toggle button (`aria-pressed`) hides the ops that do not fit, in the browse view and in search; section counts reflect the filter, and when it hides every search match the pane says "N matches hidden because they do not fit the data" instead of an empty list.
- Done when: search, favourites, categories, add by keyboard and by drag work; unit tests for search ranking and for the fit rules; axe clean.

**WP 3.3: Recipe pane** (`forge-recipe`, `forge-fl-dialog`).
- Renders `state.recipe.steps` as a **vertical pipeline of cards** joined by a connector; containers (`fork`, `subsection`, `if` with `then`/`else`, `repeat`) render their children as an indented nested list inside the card (`role="list"`/`listitem`, or `role="tree"` with `aria-level`; pick one and test it). A comment step is a note card. All edits go through the tree actions of §3.2 (`insertStep`, `removeStep`, `moveStep`, `duplicateStep`, `patchStep`, `addOp`); never mutate state.
- Step card: header with a position badge, the op's name and vocab, status (from `state.bake`: running, done with time from `bake.result.steps`, failed; failing step from `bake.result.error.path` highlighted and `aria-current`/described), issue count badge from `state.issues` whose `path` starts with the step path; body = `<forge-param-form path="<step path>">` (WP 3.4) for op steps, the container's own fields (fork split/join with encoding picker, subsection pattern/flags/encoding, if test, repeat times/until/max) for containers (these use the same validation mapping, see WP 3.4). **Step controls** (buttons with labels and tooltips): disable/enable (`disabled`), breakpoint (`breakpoint`), duplicate, delete, move up, move down, collapse the card. Selecting a card sets `ui.selectedPath`.
- **Drag and drop**: pointer (via `state/dnd.ts`: register the list areas as drop targets, show an insertion indicator at the computed gap; accept `op` payloads from the operations pane and `step` payloads from within, including into container lists; reject dropping a step into its own descendants, which `moveStep` also refuses) and **keyboard**: the card's drag handle is a button; Space or Enter "lifts" the step (announce "Lifted step 2, <op>. Use arrow keys to move, Enter to drop, Escape to cancel"), Up/Down move it among its siblings, Right moves it into the container above (as its last child) or out of its list to the parent list with Left, Enter drops, Escape cancels; every move is announced ("Step 2 of 5"). Also plain `Alt+Up` / `Alt+Down` on a focused card move it directly, and the move up/down buttons exist for touch.
- Empty state explains how to add (search then Add, or drag). A **Clear** and **Undo/Redo** (`actions.undo/redo`; `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` when focus is inside the pane and not in a text field) are in the pane header. A "container" menu adds fork, subsection, if, repeat and comment steps with valid defaults (a fork needs `split` and `join`, e.g. `{value:"\n",enc:"utf8"}`; a repeat `times: 2`; an `if` `test: {kind:"regex",pattern:"."}` with an empty `then`).
- **View as FL**: `forge-fl-dialog` shows `compileRecipe(state.recipe, catalogue).text` (monospace, selectable, Copy button, line numbers optional, `lines` map used to highlight the selected step), or the compile issues as a list. Text only.
- Done when: add, reorder, nest, disable, breakpoint, duplicate, delete work with pointer and keyboard alone, with announcements; unit tests for any pure move logic beyond `recipe-ops`; axe clean.

**WP 3.4: Parameter form** (`forge-param-form`, attribute `path` = JSON pointer of an op-like node: an op step `/steps/0`, or an op test `/steps/2/test`).
- Reads the op's `CatalogueOp.params` (`ParamSpec`: `name`, `type`, `required`, `constraint`, `default`, `doc`, options) for `op` from the recipe node, and the current value from `node.params[name]`, falling back to the catalogue default (shown as the placeholder/"default" hint and **not written** to the recipe until the user changes it).
- One field component per type: `int`/`num`/`number` (numeric input with min/max from the constraint, step), `str` (text, or textarea when the constraint allows long text), `bool` (checkbox/switch), `choice` (select or radio group for up to five options), `regex` (text with a note about flags), `charset`, `bytes` (hex text), `toggle`/`key` (value + an encoding select limited to `options`; keys get a visible "stored in the clear in links" hint). A reset-to-default button per parameter (`actions.setParam(path, name, undefined)`). Writes go through `actions.setParam(nodePath, name, value)` (debounced 150 ms for typing, immediate for selects).
- **Validation is `validateRecipe(recipe, catalogue)`** from `@forge/recipe`, already run by the store into `state.issues`. The form does **not** re-implement constraints: it filters `state.issues` for paths `${path}/params/${name}` (and `${path}/params/${name}/value` or `/enc` for encoded values), also `missing-param` at `${path}/params/${name}`, and shows the message text beside the field with `aria-invalid` and `aria-describedby`. Issues at the step level (`unknown-op`, `hash-mismatch`, `alias-used`) are shown by the step card (WP 3.3) through the same helper. Export a pure helper `issuesForPath(issues, pathPrefix)` from `src/params/issues.ts` with tests; the recipe pane may import it.
- For container fields (fork `split`/`join`, subsection `pattern`/`flags`/`encoding`, if `test`, repeat `times`/`until`/`max`, step `note`) provide `forge-field-*` building blocks that WP 3.3 uses; the same issue mapping applies (paths like `/steps/1/split/value`).
- Parameter doc text is shown as text (help `aria-describedby`).
- Done when: every `ParamType` in the seed catalogue renders, edits flow to the store and revalidate, issues appear on the right field; unit tests for value conversion (JSON shape of RECIPES §3.4) and issue mapping.

**WP 3.5: Input and Output panes** (`forge-input`, `forge-output`).
- **Input**: tabs for `state.inputs` (add, close, rename, roving tabindex tablist; `actions.addInput/closeInput/selectInput/setInputName`), text area bound to the active tab's bytes shown through its `encoding` (utf8, hex, latin1, base64: invalid text in a non-utf8 encoding keeps the previous bytes and shows an inline error) and `eol` (lf, crlf, cr: converts line endings when decoding/encoding the *text view*; bytes stay canonical), a file drop zone and an "Open file" button (reads the file as **bytes**, capped at the `SHARE_LIMITS`-independent working limit of 64 MiB with a clear message), length (bytes and, for utf8, characters) and Shannon entropy (bits per byte, pure module `entropy.ts`, tested) readouts. Large inputs: show only the first N KB in the text area with a notice, keep all bytes.
- **Output**: renders `state.bake.result` (stale results are dimmed with a "Out of date" note while a bake is queued/running). For `OutputValue`: `bytes` (text view when `text !== null`, hex dump view, selectable view toggle; remembered per session), `str`, `int`, `num`, `bool`, `list`, `record` (expandable tree, `total` vs shown), `other` (repr). Toolbar: **Copy** (text or hex), **Download** (`Blob` + `URL.createObjectURL` + `<a download>`; bytes as `application/octet-stream`, text as `text/plain;charset=utf-8`), **Move to input** (`actions.addInput(name, bytes)` or replace the active tab; announce), output length and time.
- **Error panel** on a failed result (`result.ok === false`): `error.code`, `error.message`, `error.word`, the failing step (`error.path` as "Step 3: <op name>", with a button that selects it: `actions.selectStep(path)` and the `forge-focus-pane` event for the recipe), `error.detail` as a key/value list (text only), `issues` list for `E_RECIPE_INVALID`, the `partial` output if any, and the `terminated` note. Role `alert` once per new failure.
- Progress/status for long bakes comes from `state.bake.progress`.
- Done when: all four encodings and EOLs round-trip, file drop yields bytes, copy/download/move work, errors render; unit tests for encoding/EOL conversion, entropy, hex dump formatting.

**WP 3.6: Bake controller** (`src/bake/**`).
- `controller.ts` exports `feature` whose `start(ctx)` creates the baker once: `createBakerClient({ host: () => createWebWorkerHost(() => new WebWorker()), cancelGraceMs: 1000, deadlineGraceMs: 1000 })` with `import WebWorker from "@forge/worker/worker-web?worker"` (always `?worker`, never `?worker&inline`), `await baker.init({ vocabs: "all", units })` where `units = user.source === "" ? [] : [{ name: "user", source: user.source }]`. When `state.user.source` changes, re-run `init` (it may be called again to reload) and report a failure with `actions.setUserError(message)`. Compare `InitInfo.catalogueVersion` with the build-time catalogue's `version`; on a difference, log a console warning (the two agree because the browser has a single `@forge/ops` module instance, so a warning means a real mismatch; the console worker provides the authoritative catalogue including user ops, §5).
- **Auto-bake**: subscribe to `recipe`, the active input's `bytes`, `user.source` and `settings.autoBake`. On change (and when auto-bake is on) set `bake.status = "queued"`, debounce `settings.debounceMs`, then `baker.bake(recipe, bytes, { trust: "untrusted", onEvent })`. A new bake **cancels the previous** automatically (the baker does it); ignore results whose bake id is stale. Skip baking while `state.issues` has errors, and show the issues instead (status `failed` with a synthetic message; the output pane shows the recipe issues). With auto-bake off, the **Bake** button runs it. Write progress and results with `actions.setBake` (`status`, `result`, `runningPath`, `progress`, `paused`, `elapsedMs`, `stale`).
- **Step/continue/breakpoints**: a "Debug" toggle or button in `forge-bake-controls` starts `bake(..., { debug: { startPaused?: boolean } })`; breakpoints are the recipe's `breakpoint: true` steps. On a `paused` event set `bake.status = "paused"`, `bake.paused = { path, reason, data }`, `selectStep(path)`. **Step**, **Continue** and **Cancel/Stop** buttons call `baker.step()`, `baker.continue()`, `baker.cancel()`. Keyboard shortcuts `F10` step, `F8` continue only while paused and not in a text field.
- **Timing**: per-step ms from `BakeResult.steps` is read by the recipe pane; `forge-bake-controls` shows the status text (`Baked in 12 ms`, `Baking...`, `Paused at step 3`, `Cancelled`, `Failed: E_...`), the whole-call time, and an auto-bake checkbox. Status text is in a `role="status"` region.
- **URL sync** (the only router): `url.ts` encodes `{ recipe, input, inputEncoding }` with `encodeShare` into the `#` fragment **on explicit Share only**, never automatically for the input bytes: on every recipe change the fragment is updated with the recipe alone (`#v=1&r=...`) using `history.replaceState` (debounced 500 ms). **Deviation (accepted):** when the encoded recipe has `secret-in-url` warnings (key parameters are set), the automatic sync does not write the fragment at all: it clears it, and the recipe is linked only through the Share dialog, which asks for explicit confirmation. The input is added only when the user shares with "include input". On load, `decodeShare(location.hash, { catalogue })` (after the catalogue is ready) and `actions.loadDocument(...)`; on `hashchange` do the same. Decode failures are shown in a dismissible banner/dialog with the `ShareError` code and message, never thrown. Warnings (`hash-mismatch`, `alias-used`, `catalogue-mismatch`) are shown in the share/open flow. Decoded recipes are **untrusted data** and are baked with `trust: "untrusted"` (the default).
- **`forge-share-dialog`**: shows the full URL (`location.origin + location.pathname + "#" + fragment`), Copy button, checkboxes "Include the input" (default off) and a **prominent warning** (RECIPES §3.4, §7.4): *the recipe, the input and any key values are stored in clear text in the link and anyone who has the link can read them; do not share secrets this way*. If `encodeShare` returns `secret-in-url` warnings, list the affected parameters and require an explicit confirmation before showing the link. Show `fragment-too-long` / `input-too-large` errors as text.
- Done when: typing in the input or editing a step re-bakes after the debounce; a long bake is cancelled by the next edit; breakpoints pause and step; reload of a `#` URL reproduces recipe and result; unit tests for the debouncer and URL helpers (pure modules); the controller is tested with an in-process baker (`createInProcessBaker` with `loadBundleNode` from `@forge/ops/node`) injected through a factory parameter.

**WP 3.7: Persistence** (`src/persist/**`).
- `db.ts`: a tiny promise wrapper over IndexedDB (`indexedDB.open("forge", 1)`; object stores `recipes` (key `id`) and `kv` (key `key`)) with a pluggable factory so tests can use an in-memory fake. Every call tolerates IndexedDB being unavailable (private windows): the feature then works in memory and tells the user once through `actions.announce`.
- Stores: `recipes: { id, name, description, recipe (JSON), input?: bytes, inputEncoding?, createdAt, updatedAt }`; `kv: { key, value }` for `favourites` (string[]), `options` (`{ autoBake, debounceMs }`), `user-source` (string). Recipes loaded from storage are **untrusted**: pass them through `validateRecipe` before use; invalid ones are listed as "damaged" and can be deleted.
- `feature.start`: load favourites, options and user source into the store (`setFavourites`, `setSetting`, `setUserSource`), then subscribe and write back on change (debounced 300 ms). This feature starts **first** (§3.4).
- `forge-save-dialog`: name, description, "Include the input" checkbox (default off), Save (new) or Save as copy / Overwrite when `doc.savedId` is set; `actions.markSaved(id)`. `forge-open-dialog`: list (newest first, search), Open (`actions.loadDocument`), Rename, Delete (with confirmation), Export/Import as a JSON file (download via blob URL; import through `<input type="file">`, validated), and **Promote to word** (below).
- **Promote recipe to user word**: choose a word name (`^[a-z][a-z0-9-]{0,63}$`, not already defined in vocab `user`), a doc string and optionally a category (default "User recipes"). Compile: `compileRecipe(recipe, catalogue, { word: name, vocab: "user" })`; on `ok`, take `text` (it starts with `\ forge-recipe 1` and `: <name> ( bytes -- any )`); insert `  "<doc>" doc` and `  "<category>" category` as two lines **right after the header line** (a user word without both `doc` and `category` is skipped from the catalogue; escape `"` and `\` in the strings the way the FL reader requires, and refuse control characters); append the result to the user source (which starts `IN: user`; create `IN: user\n` when empty) and call `actions.setUserSource(newSource)`. The console worker and the baker reload from it, and `buildCatalogue` then lists `user:<name>` as an op with input `bytes` and output `any`. Pure module `promote.ts` with tests (including: name clash, quotes in the doc, empty source, the compiled recipe containing parameters). The user can also edit the whole user source in the open dialog's "My words" tab (a textarea, Save applies `setUserSource`; load errors come back through `state.user.error` and are shown there).
- Done when: saved recipes, favourites, options and user words survive reload; promote works end to end (op appears in the operations pane and bakes); unit tests with the fake IndexedDB.

**WP 3.8: FL console** (`forge-console`, `src/fl/**`): see §5 for the design. Pane: scrollback (`role="log"`, `aria-live="off"`; new results are announced by a separate polite status line "Result: ..." limited to the last line), input line with history (Up/Down), multi-line definitions, a vocabulary indicator (`current-vocab`) and picker, a "Stack" strip that shows `.s`, buttons Clear and Reset session. Help integration: typing `help word` or `see word` works through the language's own words; the pane additionally offers a "Word inspector" (search a qualified name, show `meta` and source text as text).
- Done when: REPL semantics match `packages/lang/scripts/repl.ts`; a definition typed in the console is usable next line; persistent user words load; the catalogue with user ops reaches the store; worker is terminated on hard failure and restarts; unit tests for the line-assembly logic (`openDefinitions`, history) and for the worker protocol using an in-process transport.

**WP 3.9: End to end and accessibility** (`e2e/**`): see §6.

**Pages WP** (`pages/**`, `public/**`, `vite.pages.ts`): see §8.

### 2.4 Dependency order for parallel work

3.1 first (done). Then 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, pages are independent of each other (they meet only through the store and the tag names). 3.3 imports `issuesForPath` from 3.4 and 3.4 may be developed against the recipe-ops helpers; until both land each can stub the other (the placeholder exists). 3.9 starts when most others have merged but may scaffold the server and axe harness against the shell immediately.

---

## 3. Shared contracts

These are real code in `src/state/`; the descriptions below summarise them. Changing any of them needs the orchestrator's agreement.

### 3.1 The store (`state/store.ts`)

```ts
interface Store<S extends object> {
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;       // shallow merge; notifies only if a key changed (Object.is)
  subscribe(listener: (state: S, previous: S) => void): () => void;
  select<T>(selector: (s: S) => T, listener: (value: T, previous: T) => void,
            options?: { equals?: (a: T, b: T) => boolean; immediate?: boolean }): () => void;
}
```

State objects are immutable: replace, never mutate. Listeners run synchronously. In Lit components use `new StoreController(this, store, (s) => s.recipe)` (`state/store-controller.ts`), whose `.value` re-renders the host when the selected value changes.

### 3.2 State and actions (`state/types.ts`, `state/actions.ts`, `state/app.ts`)

`import { store, actions } from "../state/app.js"` gives the singleton; tests use `createAppStore()` and `createActions(store, false)` (`false` disables localStorage writes).

```ts
interface AppState {
  catalogue: { status: "loading" } | { status: "ready"; catalogue: Catalogue } | { status: "error"; message: string };
  recipe: Recipe;                         // the document the user edits (RECIPES §3)
  issues: readonly RecipeIssue[];         // validateRecipe(recipe, catalogue).issues, recomputed by the actions
  history: { past: Recipe[]; future: Recipe[] };   // undo/redo (100 deep)
  doc: { savedId: string | null; dirty: boolean };
  inputs: InputTab[];  activeInputId: string;      // InputTab { id, name, bytes: Uint8Array, encoding, eol }
  bake: BakeState;                        // written only by WP 3.6 (setBake)
  settings: { theme; autoBake: boolean; debounceMs: number };
  layout: LayoutState;                    // sizes and collapsed flags (localStorage)
  ui: { dialog; consoleOpen; compact; compactTab; selectedPath; resolvedTheme; announcement };
  favourites: string[];                   // qualified op names
  user: { source: string; error: string | null };  // the persistent user words unit (§5)
}
```

`BakeState`: `status` (`idle | queued | baking | paused | done | failed | cancelled`), `result: BakeResult | null` (the last finished result, kept while the next bake runs), `runningPath`, `paused { path, reason, data } | null`, `progress { done, total } | null`, `elapsedMs`, `stale` (set by the actions when the recipe, input or user words change after a result exists).

Actions (all synchronous; the *only* way to change state):

| Group | Actions |
|---|---|
| catalogue | `setCatalogueLoading()`, `setCatalogue(catalogue)` (revalidates; also used by the console worker to publish a catalogue with user ops), `setCatalogueError(message)` |
| recipe | `setRecipe(recipe)`, `setRecipeName(name)`, `addOp(qname, { listPath?, index? }) → stepPath`, `insertStep(listPath, index, step) → stepPath`, `removeStep(path)`, `moveStep(fromPath, toListPath, toIndexGap)`, `duplicateStep(path)`, `patchStep(path, patch)` (a key set to `undefined` is deleted), `setParam(nodePath, name, value)` (`undefined` clears; works on op steps and on `/steps/n/test`), `undo()`, `redo()`, `loadDocument({ recipe, input?, inputEncoding?, savedId? })` (resets history and `dirty`), `markSaved(id)` |
| inputs | `setInputBytes(id, bytes)`, `setInputEncoding`, `setInputEol`, `setInputName`, `addInput(name?, bytes?) → id`, `closeInput(id)`, `selectInput(id)` |
| bake | `setBake(patch)` |
| settings/theme/layout | `setSetting(key, value)`, `setTheme(pref)` (persists), `setLayout(patch)` (persists), `resetLayout()` |
| ui | `openDialog(id)`, `closeDialog()`, `setConsoleOpen(bool)`, `setCompact(bool)`, `setCompactTab(pane)`, `selectStep(path \| null)`, `setResolvedTheme(theme)`, `announce(text)` |
| data | `setFavourites(list)`, `toggleFavourite(qname)`, `setUserSource(source)` (clears `user.error`), `setUserError(message \| null)` |

Every recipe-changing action goes through one `commit` that revalidates (`validateRecipe` is the **single source of truth** for validity), records history, marks `doc.dirty` and `bake.stale`.

**Recipe tree paths** (`state/recipe-ops.ts`, pure and tested): a *step path* is an RFC 6901 pointer such as `/steps/1`, `/steps/1/steps/0` (child of a fork/subsection/repeat), `/steps/2/then/0` or `/steps/2/else/1` (branches of an `if`); a *list path* is the array that holds steps (`/steps`, `/steps/1/steps`, `/steps/2/then`, `/steps/2/else`). These are the same pointers that `RecipeIssue.path` and `BakeResult.steps[].path` / `BakeError.path` use, so issues, timings and failing-step highlights map to cards by plain string comparison and prefix. `moveStep`'s `toIndexGap` is the gap index in the target list *before* the move (what an insertion indicator shows); the function fixes up shifted indexes itself. Helpers: `getStep`, `getList`, `splitStepPath`, `childLists(step, path)`, `childPath`, `isWithin`, `countSteps`.

### 3.3 Events (`state/events.ts`)

State flows through the store. DOM `CustomEvent`s (bubbling, composed) exist only for widget gestures addressed to a parent:

| Event | Detail | From → to |
|---|---|---|
| `forge-splitter-change` | `{ value: number, source: "pointer" \| "keyboard" }` | `forge-splitter` → shell |
| `forge-splitter-toggle` | none | `forge-splitter` → shell |
| `forge-menu-select` | `{ id: string }` | `forge-menu` → its owner |
| `forge-focus-pane` | `{ pane: PaneId }` | any component → shell (reveal and focus a pane) |

A WP that needs another cross-component notification uses the store (add a field through the shell owner) or defines a `forge-<wp>-<name>` event inside its own directory and documents it in its entry file.

### 3.4 Custom elements and the feature entry

Tags the shell renders: `forge-app`, `forge-topbar`, `forge-statusbar`, `forge-splitter`, `forge-menu` (shell-owned) and `forge-operations`, `forge-recipe`, `forge-input`, `forge-output`, `forge-console`, `forge-bake-controls`, `forge-share-dialog`, `forge-save-dialog`, `forge-open-dialog`, `forge-fl-dialog` (WP-owned; the shell also renders `forge-shortcuts-dialog`). `forge-param-form` is rendered by `forge-recipe`.

Dialogs extend `ForgeDialog` (`shell/forge-dialog.ts`): set `dialogId`, `heading`, implement `renderBody()`; the base opens and closes the native `<dialog>` from `state.ui.dialog`, handles Escape and focus return, and renders the body only while open.

Panes are plain `LitElement`s; they should use `paneStyles` (a flex column with `.pane-head` and `.pane-body`) and render their own `<h2>` title. They may implement `focusPrimary()`.

Startup (`boot.ts`): theme watcher → `forge-app` → catalogue fetch started in parallel with every `feature.start(ctx)` in the order of `modules.ts` (persist, ops, params, recipe, io, bake, console), failures logged and isolated. **Catalogue ordering rule:** `loadCatalogue(actions, store)` publishes the build-time catalogue only while the store's catalogue is not yet `ready`; a catalogue already published by the console worker (which includes `user:` ops) always wins, and a failed fetch never replaces a ready catalogue with an error. The console worker's `setCatalogue` always replaces whatever is shown (unless its version is identical).

```ts
interface Feature { readonly name: string; start?(ctx: { store: AppStore; actions: Actions }): void | Promise<void>; }
```

### 3.5 Catalogue loading

`src/catalogue.ts` fetches the build-time catalogue (`import catalogueUrl from "@forge/ops/catalogue.json?url"`, a hashed asset of our own origin, `connect-src 'self'`), checks `format === 1`, and publishes it with `actions.setCatalogue`. `Catalogue.ops[]` is the only description of operations the UI reads (RECIPES §2.3): `qname`, `name`, `vocab`, `category`, `doc`, `aliases`, `seeAlso`, `input`, `output`, `effect`, `params` (`ParamSpec[]`), `effects`, `version`, `hash`, `needsHardKill`. `Catalogue` is assignable to `@forge/recipe`'s `CatalogueView`. The console worker later replaces it with a catalogue that includes user ops (§5).

### 3.6 Pointer drag and drop service (`state/dnd.ts`)

`beginPointerDrag(event, payload, label, options?)` (call from `pointerdown`; a 5 px threshold keeps clicks working), `registerDropTarget({ element, accepts, onOver, onLeave, onDrop })`, `onDragChange`, `activeDrag`. Payloads: `{ type: "op"; op: qname }` and `{ type: "step"; path }`. Hit-testing looks through shadow roots (`deepElementsFromPoint`, which visits each root once because Chromium's `ShadowRoot.elementsFromPoint` returns the host itself), the innermost registered target that accepts the payload wins, a ghost label follows the pointer (class `forge-drag-ghost`, positioned through the CSSOM), Escape cancels, the click after a drag is swallowed. This service is **only the pointer route**; keyboard alternatives are each pane's job (§2.3).

---

## 4. Security rules imposed by the production CSP

Production headers (PLAN §10):

```
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self';
  img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none';
  form-action 'none'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Rules that follow, which every WP must obey (WP 3.9 tests them against a production build served with exactly these headers, and fails on any CSP violation in the console):

1. **No inline `<script>`** and no inline event handler attributes (`onclick="..."`). Lit `@click=${...}` is fine (it is `addEventListener`).
2. **No `style="..."` attributes** in `index.html`, page HTML or Lit templates (`style-src 'self'` blocks them). Lit's `styleMap` is **not** CSP-safe under `style-src 'self'` (no `'unsafe-inline'`): it writes a `style` attribute on first render, which violates `style-src-attr`. Set dynamic styles only through the CSSOM from script, e.g. in `updated()` (`el.style.setProperty(...)`, `el.style.transform = ...`, as `apps/web/src/io/forge-hex-view.ts` does for row positions), or set CSS custom properties the same way, or use classes (`classMap`, `static styles`, adopted stylesheets). Do not use `unsafeCSS` with user data. No `<style>` elements in templates (use `static styles`).
3. **Global CSS lives in `.css` files** imported from `main.ts` or a page entry (Vite emits them as same-origin files). Component CSS is in `static styles`.
4. **Workers** are separate files loaded from our origin: always `import W from "...?worker"` (or `new Worker(new URL(...), { type: "module" })`), **never** `?worker&inline` (that creates a `blob:` worker, which `worker-src 'self'` forbids). `worker: { format: "es" }` in `vite.config.ts` (already set) because lazy primitive chunks are ES modules. Workers inherit the same CSP.
5. **No `eval`, no `new Function`**, no string timers, no `import()` of data. (`'unsafe-eval'` is not allowed; Ajv is a test-only dependency and must not be imported by app code. `'wasm-unsafe-eval'` exists only for later WASM primitives.)
6. **Metadata, help, error messages, issue messages, op docs, recipe names, user words and everything from a share URL or storage is rendered as text** (`${text}` bindings, `.textContent`), never through `unsafeHTML`, `innerHTML` or a Markdown renderer. Links the app creates are `href` to same-origin pages only. Untrusted strings never reach `href` (no `javascript:` risk), `src` or `import`.
7. **Downloads and previews** use `blob:` URLs (`img-src ... blob:` is allowed; `<a download href="blob:...">` is navigation of the user's own bytes and is fine). Revoke object URLs after use. Never navigate to or embed user content.
8. **Only same-origin requests** (`connect-src 'self'`): the catalogue, lazy op chunks and workers. There is no analytics, no font, no CDN, no third-party anything. `fetch` is used for the catalogue only; no other app code calls it.
9. **Cross-origin isolation** (`COOP same-origin` + `COEP require-corp`): every subresource must be same-origin or send CORP; there are none. The page is `crossOriginIsolated`, so the bake client uses the shared abort flag (RECIPES §8.5). Do not add `<iframe>`s or third-party images.
10. Storage: `localStorage` for layout and theme only, IndexedDB for data; both wrapped in try/catch. No cookies.
11. `Referrer-Policy: no-referrer`, HSTS and `frame-ancestors 'none'` are set by the host; nothing in the app depends on a referrer or framing.
12. Share links contain the recipe, optionally the input, and any key values **in the clear** (RECIPES §3.4, §7.4). The UI must say so wherever it creates a link or a text form (WP 3.6 dialog, WP 3.3 FL dialog note, WP 3.7 export).

`vite dev` has no CSP (HMR needs inline code) but sends COOP/COEP; the e2e suite is the CSP gate.

---

## 5. User words and the console

### 5.1 Model

- **Console definitions are session-only.** A definition needs a stack-effect header, e.g. `: sq ( n:int -- int ) n n * ;` (a bare `: sq dup * ;` without the header is rejected). The console is an FL REPL (semantics of `packages/lang/scripts/repl.ts`): the session keeps `stack` and `vars`; multi-line `:` definitions are collected until balanced (`openDefinitions`); after a successful line the stack is shown with `.s`.
- **Persistent user words are ONE editable source unit**: `IN: user` followed by definitions, stored as a string in IndexedDB (kv key `user-source`, §3.7 WP) and mirrored in `state.user.source`. It is the only persistent FL source. `user` is the only vocabulary a user unit may define into (the loaders refuse bundled and internal vocabularies with `E_READONLY`).
- Both consumers load the same unit: the **baker** with `baker.init({ vocabs: "all", units: [{ name: "user", source }] })` and the **console worker** with `assembleRuntime(bundle, { units: [{ name: "user", source }] })`. Neither changes the frozen packages.
- **The catalogue including user ops comes from the console worker.** `InitInfo` of the baker carries only `catalogueVersion`, not the catalogue, and its protocol must not be changed. So the console worker builds `buildCatalogue(runtime, { bundleVocabs, warn })` over the assembled runtime and posts it to the page, which calls `actions.setCatalogue(catalogue)`. The operations pane, parameter forms and validation then all see `user:<name>` ops. (A catalogue `version` that differs from the baker's `catalogueVersion` is expected only when the user unit is being reloaded; the controller re-inits the baker on `user.source` changes so they converge.)
- **Promote recipe to word** (verified by experiment): `compileRecipe(recipe, catalogue, { word: "<name>", vocab: "user" })` yields text of the form

  ```
  \ forge-recipe 1
  : <name> ( bytes -- any )
    ...;
  ```

  Insert two lines right after the header line, `  "<doc>" doc` and `  "User recipes" category` (a user word with neither `doc` nor `category` is skipped from the catalogue and a `warn` is issued), append the text to the user unit (which starts with `IN: user`), and `buildCatalogue` then lists `user:<name>` as an op with input `bytes` and output `any`. WP 3.7 owns this (`promote.ts`).

### 5.2 Console worker (`src/fl/`)

- Files: `src/fl/console-worker.ts` (the worker entry), `src/fl/protocol.ts` (message types, structured-clone-only), `src/fl/console-client.ts` (promise API over the worker with restart on failure). Loaded as `import ConsoleWorker from "./console-worker.ts?worker"` (never inline).
- The worker: `const bundle = await loadBundleVite("all")` (from `@forge/ops/vite`), `runtime = assembleRuntime(bundle, { units })`, `catalogue = buildCatalogue(runtime, { bundleVocabs: bundle.vocabs, warn })`. Evaluation: `runtime.run(source, { stack, vars })` returning `{ ok, output, stack, error }` as in the REPL; the worker keeps `stack` and `vars` per session. Limits: console runs are **trusted** for the user's own words but still bounded (a wall-clock watchdog in the client: if a run does not answer within 10 s the client terminates and recreates the worker, keeping the user source, losing the session stack; a "Stop" button does the same on demand).
- Messages (client → worker): `init { units }` (reload, resets the session), `run { id, source }`, `reset`, `inspect { qname }`, `dispose`. Worker → client: `ready { catalogue, warnings }`, `init-error { message }`, `result { id, ok, output, stack: string[] (rendered with `.s` text), vocab, error? }`, `inspect-result { qname, meta, source }`, `fatal`. All values rendered to text in the worker; no `Value` crosses the boundary.
- On `ready` and on every successful `init` the client calls `actions.setCatalogue(catalogue)` and `actions.setUserError(null)`; on `init-error` it calls `actions.setUserError(message)` and falls back to a runtime without the user unit (so the console stays usable and the catalogue stays valid).
- Reload: `feature.start` subscribes to `state.user.source` and re-inits the worker (debounced 300 ms). The console starts lazily: the worker is created when the pane is first opened, **but** the catalogue-with-user-ops publication must not wait for that if `user.source !== ""`: in that case `start` creates the worker immediately; otherwise the build-time catalogue is already correct.
- The console pane never shows raw HTML; output is text.

---

## 6. Testing

- **Unit tests** (Vitest): the root `vitest.config.ts` lists `apps/web` as a project (`apps/web/vitest.config.ts`: `name: "web"`, node environment, `src/**/*.test.ts`). Test pure modules only: store, actions, recipe-ops, layout/splitter logic, theme resolution (done in 3.1) and each WP's pure modules (search, entropy, encoding/EOL conversion, hex dump, issue mapping, promote, debouncer, URL helpers, console line assembly, IndexedDB wrapper against a fake). No DOM library is added; components are covered by e2e. `npm test` runs everything.
- **End to end** (WP 3.9): `@playwright/test` (or the installed `playwright` package with its own runner; chromium only, plus a webkit/firefox smoke if the CI image has them) in `apps/web/e2e/`. The server for e2e is `scripts/serve-prod.mjs`: it serves `apps/web/dist` after `vite build` with **exactly** the production headers of §4 (CSP, COOP, COEP, CORP, `Cache-Control` split) and the CloudFront-style rewrite of `/dir/` to `/dir/index.html`; the Playwright config starts it on port 4783, or on the port in the environment variable `FORGE_E2E_PORT` (set it to a free port when several worktrees run `npm run e2e` at once, because outside CI an already running server on the port is reused, whatever build it serves; CI always starts its own). Every test fails on any console error, any `securitypolicyviolation` event and any failed request. A dedicated test asserts `crossOriginIsolated === true`.
- **Accessibility**: `@axe-core/playwright` runs on the main page in light, dark and contrast themes, in the wide and compact layouts, with a recipe loaded, with the console open, with a dialog open, with a menu open, and on every static page; zero violations of WCAG 2.2 A/AA rules (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` tags). Colour-contrast is checked by axe in all three themes.
- **Gate 3 test** (must exist and pass, keyboard only, no `click()` and no mouse): focus the search (`Alt+1`), type "base64", arrow to an op and press Enter to add it, add `hex:encode`; move to the first step and its parameter fields (`Alt+2`, Tab) and set one; focus the input (`Alt+3`) and type text; the output (`Alt+4`) shows the expected result (assert the exact value from a known vector); open Share (via the top bar buttons with Tab/Enter), copy the link text, close; reload the page at that URL; the same recipe and input are restored and the same output appears.
- **Further e2e cases**: add/reorder/nest/disable/delete a step by keyboard; drag an op with the pointer; an invalid parameter shows an inline error and no bake runs; cancelling a long bake (e.g. `repeat` of 1000); breakpoint and step; file drop as bytes (a binary file round-trips through hex); bad share fragments show an error and do not throw; save, reload, open; promote a recipe to a word and use it from the operations pane; console define-and-use; theme persistence across reload; layout persistence (resize by keyboard, reload); splitter keyboard behaviour; compact layout tabs at 390 px.
- Visual spot checks (screenshots) are for humans, not assertions.

## 7. Bundle budget

Core plus UI shell under **250 kB gzip** (PLAN §6): that is the entry chunk plus its static CSS and the shared chunks needed for first paint, **excluding** the bake and console workers, op primitive chunks and the catalogue JSON, which are separate lazy assets. WP 3.9 adds a check (`scripts/check-size.mjs`) that reads `dist/assets/*` and fails the build above the budget. Measured at WP 3.1: JS 35.6 kB gzip, CSS 1.5 kB gzip, HTML 0.4 kB (the shell, state, `@forge/recipe` and Lit). Each WP should report the delta it adds; large optional features (hex view, markdown-free help, console) are loaded with dynamic `import()` when first used where practical. Do not add runtime dependencies without the orchestrator's agreement.

## 8. Static site pages

Built as Vite multi-page inputs (the shell's `vite.config.ts` reads `vite.pages.ts`, which the pages WP edits). Pretty URLs are directories with an `index.html`. The sources live in `pages/<name>/index.html`; in `vite dev` they are served at `/pages/<name>/` (e.g. `/pages/about/`), and at build time the `flattenPages` plugin in `vite.config.ts` moves `dist/pages/<name>/index.html` to `dist/<name>/index.html` (and `404` to `dist/404.html`), so they are served at `/<name>/` (`/about/`) (CloudFront rewrites `/about/` to `/about/index.html` with a viewer-request function; the e2e server mimics it).

Pages: `/about/`, `/privacy/`, `/terms/`, `/security/`, `/accessibility/`, and `404.html` (the CloudFront error response for 403/404). Files in `public/` (copied verbatim): `robots.txt`, `sitemap.xml` (the app and the five pages under `https://forge.darkcollective.com/`), `.well-known/security.txt` (RFC 9116: `Contact`, `Expires` within a year, `Preferred-Languages`, `Canonical: https://forge.darkcollective.com/.well-known/security.txt`; the contact is provided by the owner, leave a clearly marked `TODO` for the orchestrator to fill if unknown), `favicon.svg`.

Rules for pages: static HTML with `<link rel="stylesheet">` to the shared tokens and global CSS (`src/styles/tokens.css`, `global.css`, plus `pages.css`), **no JavaScript required** (a tiny module script is allowed only to apply the stored theme: import the same `data-theme` logic from `src/state/theme.ts`, no inline script), a skip link, one `<h1>`, landmarks (`header`, `main`, `footer`), the same top navigation (Forge home, About, Privacy, Terms, Security, Accessibility) and theme following the system or the stored preference, readable at 320 px and in the contrast theme. Content: plain, accurate statements that match the architecture (Forge runs entirely in your browser; nothing you type or load is sent anywhere; no cookies, no analytics, no third-party requests; what is stored locally (layout, theme, favourites, saved recipes, user words) and how to clear it; links contain recipe, optional input and key values in the clear; the security model of PLAN §5 and headers of §10 in user terms and how to report a vulnerability; the accessibility conformance goal (WCAG 2.2 AA), known limitations and a contact; terms: Apache-2.0 software, provided as is, no warranty, do not rely on it for protecting real secrets, acceptable use). Legal wording is a draft for the owner to review. All pages carry a `<meta name="description">` and a canonical link to `https://forge.darkcollective.com/<page>/`.
