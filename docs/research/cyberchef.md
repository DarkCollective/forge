# CyberChef research notes (for the Forge project)

Researched from a shallow clone of https://github.com/gchq/CyberChef (HEAD `d4d96c6c`, package version **11.5.0**, commit dated 2026-11-04), read-only; nothing was built or run. All paths below are relative to the CyberChef repo root. Everything is described in my own words; no CyberChef source is reproduced. Forge should be an independent implementation that only mirrors the feature set (see section 6).

Headline numbers (counted from the source, not from memory):

- **506 operations** (one `src/core/operations/*.mjs` file each, excluding `index.mjs`; each has a unique `name`).
- **16 non-empty categories + an empty "Favourites"** in `src/core/config/Categories.json`; 540 category slots in total because 34 ops are listed in more than one category.
- 24 lazy-load "modules" (`this.module` values); 214 ops live in `Default`, the other 292 in 23 optional modules.
- 50 ops declare Magic `checks`, 45 implement `highlight`, 44 override `present`/`presentType`.

---

## 1. Architecture

### 1.1 Layers

- `src/core/` is UI-free: `Operation`, `Ingredient` (an argument), `Dish` (typed data container), `Recipe`, `Chef` (top-level "bake" entry), `ChefWorker.js` (the Web Worker shell around Chef), `Utils.mjs`, `lib/` (shared algorithms, ~100 files), `operations/` (one class per op), `dishTypes/` (converters), `errors/`.
- `src/web/` is the browser UI. It is split into "waiters" (one event-handling object per UI area: `InputWaiter`, `OutputWaiter`, `RecipeWaiter`, `OperationsWaiter`, `ControlsWaiter`, `OptionsWaiter`, `WorkerWaiter`, `HighlighterWaiter`, `TabWaiter`, ...), `App.mjs` (state, URL params, localStorage), `Manager.mjs` (event wiring), plus `HTMLOperation`/`HTMLIngredient`/`HTMLCategory` which render config into DOM.
- `src/node/` is the Node API, generated from the same op classes (section 4).

### 1.2 How an Operation is defined (`src/core/operations/*.mjs`, base class `src/core/Operation.mjs`)

Every op is an ES class extending `Operation`; the constructor sets metadata, `run` does the work.

Metadata fields (set in the constructor):

| Field | Meaning |
|---|---|
| `name` | Unique display name; also the key used in recipes and URLs (spaces become underscores in the URL form). |
| `module` | Which lazy-load bundle the op belongs to (e.g. `Default`, `Crypto`, `Image`). Section 4. |
| `description` | HTML string shown in the popover and searched by the op search box. |
| `infoURL` | Link to Wikipedia or similar; `null` allowed. |
| `inputType` / `outputType` | Dish type names (see 1.3). Setters convert the string to an enum; setting `outputType` also defaults `presentType` to the same value. |
| `presentType` | Optional type of the value *shown to the user* if different from `outputType`. |
| `args` | Array of argument (ingredient) configs; each is wrapped in an `Ingredient` (`src/core/Ingredient.mjs`). |
| `flowControl` | True for ops that manipulate the recipe itself rather than data (section 1.5). |
| `manualBake` | If true, changing this op never triggers auto-bake (used by network ops such as `HTTP request`, `DNS over HTTPS`; I saw it on 2 ops only). |
| `checks` | Optional Magic detection patterns (section 1.7). Not declared on the base class; ops just assign it, and the config generator picks it up. |

Methods:

- `run(input, args)` - the transform. Receives the input already converted to `inputType`, and the arg values (already coerced). Returns a value of `outputType`. Can be async. For flow-control ops, `run(state)` receives the whole recipe state instead.
- `present(data, args)` - optional second stage that turns the raw `run` result into something human-friendly (typically HTML) without changing what the next op in a chain would receive. Only called for the *last* executed op of a recipe (`Recipe.present` in `src/core/Recipe.mjs`). Example: Magic returns JSON from `run`, renders a clickable HTML table from `present` (`src/core/operations/Magic.mjs`).
- `highlight(pos, args)` / `highlightReverse(pos, args)` - optional functions mapping a selected input byte range to the corresponding output range and back. Example: To Base64 maps start/end by the 3-to-4 ratio (`operations/ToBase64.mjs`). Default returns `false`, meaning "highlighting not supported".
- Ingredient value accessors `ingValues`, `validateIngredients()`, `config` (op name + arg values, the recipe-JSON form), `breakpoint`, `disabled`.

`src/core/config/scripts/generateConfig.mjs` instantiates every op at build time and writes `OperationConfig.json` (module, description, infoURL, inputType, output/present type, flowControl, manualBake, args, checks) plus per-module import files. The UI never needs to load op code just to list operations. `generateOpsIndex.mjs` builds `operations/index.mjs`. `newOperation.mjs` is a scaffold script for contributors.

Distribution observed across the 506 ops: `inputType` string 327, ArrayBuffer 131, byteArray 27, JSON 11, BigNumber 7; `outputType` string 334, ArrayBuffer 53, byteArray 47, JSON 18, html 17, BigNumber 14, number 8, List<File> 4, File 2. (A few ops use inconsistent casing such as "json"/"Number"/"Object"; the type-name parser lowercases them, `Dish.typeEnum` in `src/core/Dish.mjs`.)

### 1.3 The Dish type system (`src/core/Dish.mjs`, `src/core/dishTypes/*.mjs`)

A `Dish` holds `{value, type}`. Nine types (numeric enum in `Dish.mjs`; type names via `enumLookup`):

| Enum | Name | JS representation / notes |
|---|---|---|
| 0 | `byteArray` | plain array or Uint8Array of 0-255 numbers; validated element-by-element (comment says this check could be relaxed for speed) |
| 1 | `string` | JS string (UTF-16) |
| 2 | `number` | JS number |
| 3 | `html` | string known to be HTML, rendered rather than escaped |
| 4 | `ArrayBuffer` | raw bytes; **the canonical hub type** |
| 5 | `BigNumber` | bignumber.js instance; re-hydrated after crossing a worker boundary because it serialises as `{c,e,s}` |
| 6 | `JSON` | any serialisable value; always "valid" |
| 7 | `File` | browser `File` |
| 8 | `List<File>` | array of Files (used by e.g. unzip) |

`dishTypes/` has one small converter class per type (`DishString`, `DishByteArray`, ..., base class `DishType`) with `toArrayBuffer` and `fromArrayBuffer`.

**Type conversion between ops**: `dish.get(wantedType)` returns the value in the requested type. If the dish is already that type nothing happens. Otherwise `_translate` always goes **through ArrayBuffer**: source -> ArrayBuffer -> target (hub-and-spoke, so only 2 converters per type instead of N^2). In the browser this is async (a File needs `FileReader`), in Node it is synchronous; `Dish.mjs` has parallel code paths for both. `dish.set(value, type)` validates with `valid()` and throws `DishError` on mismatch. Strings convert to bytes via UTF-8 (`Utils.strToArrayBuffer`), and ops that want Latin-1 "byte strings" must handle that themselves (see the `toggleString` option sets "UTF8"/"Latin1" in section 2).

Other Dish members: `clone()`, `size`, `presentAs()`, `detectDishType()`, `getTitle()` (preview for tabs).

### 1.4 Recipe execution (`src/core/Recipe.mjs`, `src/core/Chef.mjs`)

- A recipe config is an array of `{op, args, disabled?, breakpoint?}` objects (the same JSON used everywhere: URL, save dialog, Node API).
- `Recipe` first maps names to module + hydrates op instances lazily (`_hydrateOpList`, dynamic import of the generated `OpModules`), sets arg values (which coerces them via `Ingredient.prepare`), breakpoint and disabled flags. A `Comment` op is always treated as disabled.
- `execute(dish, startFrom, forkState)` loops over ops: skip if disabled; **stop and return index if breakpoint**; `await dish.get(op.inputType)`; report progress to the UI (inside a worker); run `validateIngredients`; if `flowControl` call `op.run(state)` with a state bundle (progress index, dish, full opList, jump counter, register counter, fork offset) and take back the mutated state; otherwise `output = await op.run(input, op.ingValues)` then `dish.set(output, op.outputType)`.
- Errors: `OperationError` and `DishError` are "expected" errors - the message is put into the dish as a string output and execution stops at that op (so the user sees the message in the output pane). Any other exception gets a display string of the form "op name - message", is annotated with the failing index (`progress`) and re-thrown.
- `Chef.bake(input, recipeConfig, options)` (`src/core/Chef.mjs`) builds the Recipe, loads the input (string or ArrayBuffer), executes, clones the *raw* dish, calls `recipe.present(dish)` (only the last executed op's `present` runs), converts to a return type (HTML stays HTML, else ArrayBuffer by default) and returns `{dish, result, type, progress, duration, error}`. The raw (unpresented) dish is kept so the UI can later ask for it in another type (copy, save, step).
- **Breakpoints and Step**: a breakpoint makes `execute` return early at that index; the UI remembers `progress` and the next "Step" call resumes from there (`App.mjs` `step()` / `bake(step)`; the worker is told progress + step flag). Setting a breakpoint also disables highlighting. `Recipe.removeBreaksUpTo` is used by Fork so sub-recipes do not re-trigger earlier breakpoints.
- **Highlighting**: `Chef.calculateHighlights` composes each op's `highlight` function forward (or `highlightReverse` backwards over the reversed list). If any enabled op has no highlighter, or a breakpoint exists, or the recipe contains flow control, highlighting is turned off (`generateHighlightList`, and `attemptHighlight` option in `Chef.bake`). Errors thrown by highlighters are swallowed.
- `silentBake` warms the worker after the tab has been idle (browser memory swapping) without touching output.

### 1.5 Flow control ops (category "Flow control", module mostly `Default`; Register is in `Regex`)

All have `flowControl = true` and operate on the *recipe state* instead of data. They live in `src/core/operations/` with helpers in `src/core/lib/FlowControl.mjs`.

| Op | Behaviour |
|---|---|
| **Fork** (`Fork.mjs`) | Splits the current string by a delimiter, then runs the *following ops up to the matching Merge* on each piece independently by constructing a sub-`Recipe`; results are joined with a merge delimiter. Optional "ignore errors". Nesting is tracked by counting Fork/Subsection vs Merge by op *name*; Merge has a "Merge All" flag that closes every open branch. Ingredient values are deep-copied per branch so registers reset. |
| **Subsection** (`Subsection.mjs`) | Like Fork but the pieces are regex matches (optionally a capture group); the unmatched text between is preserved and the processed matches are spliced back in. Also ended by Merge. |
| **Merge** | Marker that ends the branching scope; the data was already merged by Fork/Subsection when they ran. |
| **Register** (`Register.mjs`, module Regex) | Runs a regex over the input and stores capture groups; later ops' string args may contain `$R0`, `$R1`... which are substituted (escape with a backslash). In a worker it calls `self.setRegisters` so the UI can show values. |
| **Label** | Names a position. |
| **Jump** (`Jump.mjs`) | Moves the progress pointer to a Label; "maximum jumps" caps loops when jumping backwards. If the label is missing or the cap is hit, it falls through. |
| **Conditional Jump** | Same, but only jumps when the data matches a regex (or does not match, with invert). Enables loops/branches. |
| **Return** | Ends the recipe early. |
| **Comment** | No-op; stored as disabled. |
| **Magic** | Technically a flow-control op because it needs the whole opList (section 1.7). |

Note the design smell: Fork/Subsection/Merge locate each other by string comparison on op names, and Fork rebuilds a recipe from a slice of the op list - flow control is tightly coupled to `Recipe` internals. The Node API excludes Fork, Merge, Jump, Conditional Jump, Label and Comment because plain JS can express those (`src/node/config/excludedOperations.mjs`).

### 1.6 Operation types of state: errors

`src/core/errors/`: `OperationError` (user-facing, shown as output), `DishError` (bad conversions/validation), `ExcludedOperationError` (Node API).

### 1.7 Magic auto-detection (`src/core/lib/Magic.mjs`, `src/core/operations/Magic.mjs`)

How it works:

1. Each op may declare `checks`: a list of `{pattern, flags, args, useful, entropyRange, output}` records. `pattern` is a regex tested against the input as a string; `args` are the arg values to run the op with if it matches; `entropyRange` restricts by Shannon entropy; `output` is a criteria object (`pattern`, `entropyRange`, `mime`) the *result* must satisfy; `useful` boosts the ranking. E.g. From Base64 lists several regexes, one per alphabet variant, each with its alphabet as args (`operations/FromBase64.mjs`). 50 ops declare checks.
2. `Magic._generateOpCriteria` walks `OperationConfig`, compiles every pattern once.
3. `speculativeExecution(depth, extLang, intensive, recipeSoFar, useful, crib)`: find matching ops, run each as a one-op recipe, drop empty or no-progress (same op repeating with same output) or output-criteria-failing results, then recurse on the output until depth is exhausted. Each node records: language scores (chi-squared comparison of byte frequencies to per-language tables, ~40 common languages or 284 in "extensive" mode), detected file type (magic bytes via `lib/FileType.mjs`), UTF-8 validity, entropy, matching ops, and crib match (optional user regex).
4. "Intensive mode" additionally brute-forces XOR, bit rotation and character encodings (first ~100 bytes) to create extra branches.
5. Branches are pruned (must have some language, file type, UTF-8 validity, a matching op, or crib match), then sorted by language score and usefulness. The op's `present` renders a table of candidate recipes, each with a link that loads that recipe.
6. In the UI, the `autoMagic` option makes a background worker (`BackgroundWorkerWaiter.mjs`) run Magic on the current output after each bake and show a magic-wand button if something is found (`OutputWaiter.backgroundMagic`).

---

## 2. Argument (ingredient) types

Defined by config objects on `this.args`; coerced/validated in `src/core/Ingredient.mjs`; rendered by `src/web/HTMLIngredient.mjs`. Frequency counts are over all op files (approx.).

| Type | Meaning / value shape | Notes |
|---|---|---|
| `string` | single-line text input | most common text type |
| `shortString` | same but a narrow input box | |
| `binaryString` | text where backslash escapes (`\n`, `\xNN`, `\uNNNN`, octal) are decoded before `run` | `Ingredient.prepare` calls `Utils.parseEscapedChars` |
| `binaryShortString` | narrow variant of the above | used for delimiters in Fork etc. |
| `text` | multi-line textarea (`rows` option) | also used by Comment |
| `number` | numeric input; supports `min`, `max`, `step`, `integer` | parsed with parseFloat; NaN falls back to default; validated in `Ingredient.validate` |
| `boolean` | checkbox | |
| `option` | dropdown; `value` is the array of choices; first (or `defaultIndex`) is default; runtime value is the selected string | entries written like `[Group name]` and `[/Group name]` become optgroups and are excluded from the legal set |
| `editableOption` | dropdown plus free-text override; choices are `{name, value}` pairs (e.g. Base64 alphabets) | run value is the chosen/typed string after escape parsing |
| `editableOptionShort` | narrow variant | |
| `toggleString` | text input plus a dropdown selecting how to interpret it (`toggleValues`, e.g. Hex / UTF8 / Latin1 / Base64) | runtime value is `{string, option}`; ops convert with `Utils.convertToByteArray/String` (`Utils.mjs`). 90+ uses, mostly keys, IVs, salts |
| `argSelector` | dropdown whose choices each show/hide other args by index (`on: [...]`, `off: [...]`) | e.g. AES mode, HKDF salt on/off |
| `populateOption` | dropdown that fills *another* arg's text with a preset (`target` = arg index; each choice has a `name` and `value`) | used for date/time format presets, regex presets |
| `populateMultiOption` | same but fills several args at once from an array | only 1 op |
| `label` | static, non-input heading inside the arg list | |
| `byteArray` | hex text converted to a byte array in `prepare` | rare, internal |

Common optional fields on every arg: `name`, `value` (default; array for the option types), `hint` (tooltip), `disabled`, `rows`, `maxLength`, `allowEmpty` (default true), `min/max/step/integer`, `defaultIndex`, `target`, `toggleValues`.

**Defaults and validation**: the default is the config `value` (for options, the first entry or `defaultIndex`). A `NaN` number is replaced by the default (`Operation.ingValues` setter). `Ingredient.validate` (called from `Recipe.execute` before each run) checks in this order: skip when disabled; use default when value is null; treat empty as an error unless `allowEmpty` (options/argSelector empty only OK if an empty choice exists); `maxLength`; for numbers: is-a-number, integer, min, max; for option/argSelector: value must case-insensitively equal one of the legal choices. All failures throw `OperationError("<arg name> must be ...")`, which surfaces as the output text. Validation is a relatively recent addition on top of an older "coerce and hope" design, so many ops still contain their own ad-hoc checks.

Recipe-side argument encoding: the value array is written as JSON, so `toggleString` appears as `{'option':'Hex','string':'3a'}` and `editableOption` as its string.

---

## 3. UI

Source: `src/web/` (HTML shell `src/web/html/index.html`, styles in `src/web/stylesheets/`). Built on jQuery + Bootstrap 4 (bootstrap-material-design), CodeMirror 6 for input/output editors (`@codemirror/*`, helpers in `src/web/utils/editorUtils.mjs`), Split.js for resizable panes, SortableJS for drag and drop.

### 3.1 Panes

- **Operations list** (`OperationsWaiter.mjs`, `HTMLCategory.mjs`, `HTMLOperation.mjs`): categories are collapsible accordions populated from `Categories.json` (each category: `{name, ops[]}`). Search box does fuzzy matching on op *names* (`lib/FuzzyMatch.mjs`, ranked by score, matched letters highlighted) followed by plain substring matches on *descriptions*. Hovering shows a popover with description and info link. Double-click adds an op to the recipe; dragging works too. A "Favourites" category is user-editable (modal with sortable list), persisted in `localStorage.favourites`, with defaults supplied in `src/web/index.js`. The option `showCatCount` shows per-category counts. The header shows total op count.
- **Recipe** (`RecipeWaiter.mjs`): ordered list of op cards; drag from the operations list (SortableJS), reorder, drag out to delete. Each card has its arguments, disable (eye) toggle, breakpoint toggle, remove, and shows flow-control indentation. Top bar buttons: Save, Load, Clear. Bottom bar: **Step**, **Bake!**, **Auto Bake** checkbox. Register values are shown beside their ops.
- **Input** (`InputWaiter.mjs`, `workers/InputWorker.mjs`, `workers/LoaderWorker.js`): CodeMirror editor with status bar (length, lines, selection), character-encoding picker and EOL picker. Multiple input **tabs** (max tabs computed from window width, `TabWaiter.calcMaxTabs`); drag and drop or open file(s)/folder; files are read in 10 MiB chunks inside a worker (`LoaderWorker.js`) and stored as ArrayBuffers, with a hard cap at 2 GiB-ish (checked as 128 * 256^3 bytes). Large inputs are held in the InputWorker, not the main thread. Image preview is an option (`imagePreview`).
- **Output** (`OutputWaiter.mjs`): CodeMirror read-only editor or an HTML view (for `html` results), copy, save to file, replace-input-with-output, maximise, tabs mirroring input tabs ("syncTabs" option), per-tab status (duration, bake progress), a magic-wand button, switching the output chosen encoding/EOL. Text selection in input or output triggers highlight computation (`HighlighterWaiter.mjs`) only when auto-bake is on, nothing is baking, and the recipe is highlightable.
- **Options panel** (`OptionsWaiter.mjs`): modal of switches stored as one JSON blob in `localStorage.options`. Defaults live in `src/web/index.js`: `updateUrl` (rewrite the URL hash as the recipe changes), `showHighlighter`, `wordWrap`, `showErrors`, `errorTimeout` (4000 ms), `attemptHighlight`, `theme` ("classic" plus dark and other themes), `useMetaKey`, `logLevel`, `autoMagic`, `imagePreview`, `syncTabs`, `showCatCount`. A "Reset" restores defaults.

### 3.2 Baking and web workers

- Baking never happens on the UI thread. `WorkerWaiter.mjs` owns a pool of `ChefWorker`s (`src/core/ChefWorker.js`, loaded with worker-loader inline), sized from `navigator.hardwareConcurrency` (1 if unknown). Multi-tab inputs bake in parallel across the pool; a queue hands out the next input as a worker finishes. A separate `DishWorker` converts dishes for display/copy/save without blocking, and a `BackgroundWorkerWaiter` keeps a spare ChefWorker for Magic. `ZipWorker` zips output files, `InputWorker` stores inputs.
- Message protocol (ChefWorker): actions `bake`, `silentBake`, `getDishAs`, `getDishTitle`, `docURL`, `highlight`, `setLogLevel`, `setLogPrefix`; replies include `workerLoaded`, `bakeComplete`, `bakeError`, `statusMessage`, `progress`, `optionUpdate`, `setRegisters`. ArrayBuffer results are *transferred* not copied.
- Cancelling a bake (auto-bake interrupting a long bake) terminates the worker and spawns a fresh one. Pragmatic, but it throws away all loaded modules.
- **Auto Bake**: `App.autoBake()` runs on every state change (debounced). Ops with `manualBake = true` suppress it. If auto bake is off, a stale-output indicator is shown instead. A `stateChangeId` / `bakeStateId` pair decides staleness.

### 3.3 Saving and loading recipes, and URL encoding

Three recipe text formats, all convertible and parsed by one function (`Utils.parseRecipeConfig` in `src/core/Utils.mjs`; save dialog in `ControlsWaiter.saveClick`):

1. **Chef format** ("pretty" recipe; `Utils.generatePrettyRecipe`). Grammar, as implemented: a sequence of `Op_Name(arg1,arg2,...)` with no separators between ops. Spaces in op names become underscores. Arguments are the op's JSON args array without the outer brackets, but string quotes are single quotes instead of double (so they need no percent-encoding) with `\'` for an embedded single quote. Objects (toggleString values) look like `{'option':'Hex','string':'3a'}`. Optional flags are appended inside the parentheses after a slash: `/disabled`, `/breakpoint`. The save dialog also shows it newline-separated for readability. Example from the README: `From_Base64('A-Za-z0-9+/=',true,false)`. Example with registers: `Register('(.{32})',true,false,false)Drop_bytes(0,32,false)`.
2. **Clean JSON**: pretty-printed JSON array with compact arg lists (regexes in `saveClick` tidy the indentation) - human editable.
3. **Compact JSON**: `JSON.stringify` of `[{"op":"To Hex","args":["Space",0]}, ...]`.

`parseRecipeConfig` trims, returns `[]` for empty, treats anything starting with `[` as JSON, and otherwise runs the Chef-format regex parser after a structural validation pass (`_validatePrettyRecipe`) - the validation was added to stop malformed or hostile fragments.

**URL hash** (`ControlsWaiter.generateStateUrl`, `App.loadURIParams`): `https://host/path/#recipe=<chef format>&input=<base64>&ienc=<n>&oenc=<n>&ieol=<code>&oeol=<code>`. Only non-default parts are included: `recipe` is the Chef format run through `Utils.encodeURIFragment` (a percent-encoder that deliberately leaves characters legal in a fragment such as `( ) ' , : ; @ / ? ! $ * ~` unescaped for readability); `input` is the input as Base64 (README says so; the code passes the already-base64 string through); `ienc/oenc` are numeric character-encoding codes (omitted for the default 0); `ieol/oeol` are EOL codes (omitted for LF). A legacy `op=` param (search-and-add one op) also exists. The `theme` param is documented in the README. With `updateUrl` on, the URL is rewritten with `history` after each state change (`App.mjs`, near `lastStateUrl`). The "Save recipe" dialog also produces a deep link with checkboxes for including recipe/input.

**Local save/load**: "Save recipe" stores named recipes as JSON in `localStorage.savedRecipes` (array, with a counter in `localStorage.recipeId`); "Load recipe" lists, deletes, and loads them, or accepts pasted text in any of the three formats. There is also a "report a bug" box that embeds version, compile time, user agent and a repro link (`ControlsWaiter`).

---

## 4. Modules, lazy loading, build output, Node API

- Each op declares `module`. The generator (`src/core/config/scripts/generateConfig.mjs`) emits `src/core/config/modules/<Module>.mjs` which imports all ops in that module and registers them onto a shared `OpModules` object, plus an `OpModules.mjs` that imports every module (used by Node and tests).
- Module list and sizes (op counts): Default 214, Ciphers 67, Crypto 66, Image 28, Code 23, Compression 21, Encodings 14, Regex 13, PublicKey 12, PGP 8, Hashing 8, Bletchley 7, Serialise 6, Charts 5, URL 3, Shellcode 2, Protobuf 2, and single-op modules Yara, UserAgent, OCR, Jq, Handlebars, File, Diff.
- **Web build** (`Gruntfile.js`, `webpack.config.js`): webpack gets the main entry (`src/web/index.js`) plus one entry per non-Default module (`listEntryModules`), emitted as `modules/<Name>.js`. For the web build `OpModules.mjs` is aliased to `Default.mjs`, so the worker starts with only Default ops. When a recipe needs another module, `ChefWorker.loadRequiredModules` (`src/core/ChefWorker.js`) calls `importScripts('<docURL>/modules/<Module>.js')` and shows a "Loading X module" status; the loaded script adds itself to `self.OpModules`. The worker is created with worker-loader inlined into main.js. Special-case assets are copied (tesseract.js worker, node-forge prime worker). Build also generates a bundle-analyser report and a standalone zip (a comment in the Gruntfile mentions the zip being 75+ MB).
- Grunt tasks: `dev` (watch + dev server), `prod` (lint, generate config, find modules, webpack, zip, sha256 of the zip embedded in index.html), `node`, `configTests`, `testui`, `testnodeconsumer`.
- **Node API** (`src/node/`): `generateNodeIndex.mjs` writes an index that exports every non-excluded op as a wrapped function (`api.mjs`: `_wrap`, `help`, `bake`, `_explainExcludedFunction`), a `NodeDish` and a `File` shim. Ops are called as functions: `chef.toBase64("hello", {alphabet: "..."})` style (args can be an object keyed by arg name, matched case/space-insensitively, or a positional array - see `transformArgs` in `api.mjs`); results are `NodeDish` objects with `toString()`, `get(type)`. `chef.bake(input, recipe)` takes a recipe of op functions/names/configs. Excluded: flow control ops listed in 1.5, JS beautify/minify/parser (esprima issues in ESM), SyntaxHighlighter. `NodeRecipe.mjs`, `repl.mjs` (`npm run repl`) and `apiUtils.mjs` complete it. In Node, Dish conversion is synchronous (separate branch in `Dish.mjs`).
- Tests: `tests/operations` (per-op), `tests/node`, `tests/lib`, `tests/browser` (Nightwatch UI tests), `tests/samples`.

---

## 5. Catalogue of operations

Total: **506 distinct operations**, 540 category entries (an op can appear in several categories).

| Category | Entries |
|---|---|
| Favourites | 0 (runtime) |
| Data format | 80 |
| Encryption / Encoding | 95 |
| Public Key | 33 |
| Arithmetic / Logic | 31 |
| Networking | 38 |
| Language | 7 |
| Utils | 52 |
| Date / Time | 10 |
| Extractors | 20 |
| Compression | 21 |
| Hashing | 50 |
| Code tidy | 30 |
| Forensics | 12 |
| Multimedia | 29 |
| Other | 22 |
| Flow control | 10 |
| **Sum of entries** | **540** (506 unique) |

Full lists are in the appendix at the end of this file.


### Heavy third-party dependencies (what a clean-room Forge would need to replace or choose carefully)

Counts are approximate (from import scanning of op files and the lib files they import; a few indirect dependencies are likely missed, so treat them as lower bounds). Dependency list: `package.json`.

| Library | Used by (approx. ops) | Examples / purpose |
|---|---|---|
| jimp | 25 | all Image ops (resize, blur, dither, text, format convert) |
| node-forge | 21 | AES/DES/RC/Blowfish ciphers, RSA, X.509, PEM, HMAC, many hashes |
| crypto-api | 21 | assorted hashes (HAS-160, SM3, ...), HKDF, Flask session |
| bignumber.js | 20 | arbitrary-precision arithmetic, From/To Base, BCD |
| jsrsasign | 17 | ECDSA, ASN.1/X.509/CRL parsing, key conversion |
| crypto-js | 7+ | classic ciphers and some symmetric/hash ops |
| kbpgp (+ openpgp for key parsing) | 8 | PGP ops (heavy, slow startup) |
| codepage | 7 | text encoding/decoding to legacy code pages |
| @wavesenterprise/crypto-gost-js | 6 | GOST ciphers |
| zlibjs, vkbeautify | 6 each | gzip/zip/deflate; CSS/JSON/SQL beautify/minify |
| moment-timezone, xregexp | 5 each | date/time ops; regex ops with named groups/flags |
| d3 + nodom + d3-hexbin | 5 | chart ops (entropy, heatmap, scatter, series, hex density) |
| protobufjs | 4 | protobuf decode/encode, varint |
| bcryptjs, js-sha3, jsonwebtoken, js-ascon, bson | 3 each | |
| libyara-wasm, tesseract.js, jq-web, libbzip2-wasm, argon2-browser, @alexaltea/capstone-js | 1-2 each | WASM/large: YARA, OCR, jq, bzip2, Argon2, ARM/x86 disassembly |
| markdown-it, highlight.js, handlebars, jsonata, esprima/escodegen/terser, sql-formatter, js-yaml | 1-2 each | language tooling ops |
| chi-squared | Magic | language detection statistics |

Also notable: the whole UI stack (jquery 3.7.1, bootstrap 4.6.2, bootstrap-material-design, popper, CodeMirror 6, sortablejs, split.js, dompurify, used in `RecipeWaiter.mjs`, for sanitising HTML). Because the heavy libs sit in separate lazily-loaded modules, they only cost bytes for users that invoke them (explicit repo principle in `AGENTS.md`).

---

## 6. Licence

- `LICENSE`: **Apache License 2.0**; every source header says "Crown Copyright" and `@license Apache-2.0`; README states "released under the Apache 2.0 Licence and covered by Crown Copyright". Contributions require signing the GCHQ Contributor Licence Agreement.
- Implications for Forge:
  - Ideas, feature lists, op names, category structure, the concept of a recipe, and file formats are not covered by copyright, so an independent implementation that mirrors the *feature set* is fine as long as no CyberChef source (including long description strings, generated config JSON, test fixtures and icons) is copied.
  - If any CyberChef code, text or assets were copied or closely adapted, Apache-2.0 obligations apply: keep the licence and copyright/NOTICE text, state changes, and (for patents) the grant and termination terms. Apache-2.0 permits commercial and closed reuse, so this is a manageable fallback, but it is simplest to avoid it.
  - Do not use the CyberChef name/branding ("CyberChef", GCHQ, Crown logos); Apache-2.0 gives no trademark licence. Forge's own name and visual identity avoid the issue.
  - Be consistent about *recipe compatibility*: reading CyberChef's JSON/Chef recipe formats is a compatibility feature, not copying; if Forge wants it, document it as such and implement it from observed behaviour.
  - Third-party libraries carry their own licences (mostly MIT/BSD/Apache; check each one - e.g. kbpgp, jsrsasign, jimp, libyara-wasm, tesseract). Forge's dependency choices need their own audit.
  - Two things to avoid copying verbatim from CyberChef's tree because they are data, not ideas: the language byte-frequency tables used by Magic (`src/core/lib/Magic.mjs`) and file-signature tables (`src/core/lib/FileSignatures.mjs`). Derive Forge's from public sources.

---

## 7. Lessons for Forge

What works well (worth mirroring conceptually):

1. **One uniform recipe model**: an ordered list of `{op, args, flags}` that is JSON-serialisable and shared by UI, URL, saved recipes, tests and the Node API. Very easy to share and diff.
2. **Typed data between steps with automatic conversion** through one canonical type (bytes). Authors write ops in whatever type is natural and the engine adapts.
3. **Declarative op metadata** (name, description, typed args, defaults) so the UI form, docs, search, validation, CLI and Node bindings are generated from one place. Config is generated at build time so the UI can list ops without loading code.
4. **Separation of `run` and `present`**, so chaining uses raw data while the last step can show rich HTML.
5. **Workers + lazy modules**: all baking off the main thread; heavy libs only downloaded when needed; cancellable bakes.
6. **Debuggability**: breakpoints, step, per-op disable, highlight mapping between input and output, progress and timing.
7. **Magic**: declarative `checks` next to each op make auto-detection extensible without a central registry. Depth-limited speculative decode with pruning is simple and effective.
8. **Shareable state in the URL hash** with a human-readable recipe syntax and nothing sent to a server (hash is never transmitted) - great for privacy and airgapped use (`AGENTS.md` makes "client-side only" a principle).

Pain points / things to avoid (from the source plus top-reacted open issues, via `gh api search/issues`):

1. **Flow control is bolted onto the recipe loop**: ops receive the entire mutable state, find each other by name strings, and break highlighting. Forge should model branching (fork/merge/subsection/jump) as first-class nodes in a recipe tree/IR with explicit scopes, rather than a flat list plus name matching.
2. **Everything converts via ArrayBuffer** and strings are UTF-8 by default, so Latin-1 "byte strings" vs real strings is a recurring confusion (hence the many `toggleString` Hex/UTF8/Latin1/Base64 pickers and `binaryString` escape decoding). Decide early: bytes are the primary type, text carries an explicit encoding; never silently round-trip bytes through JS strings.
3. **Dual sync (Node) / async (browser) code paths** in `Dish.mjs` double the surface area. Make the whole core async or run the same code in both with one path.
4. **Errors**: expected failures are returned as output text, unexpected ones thrown; the output pane is overloaded for errors. A structured error object with op index and an error view would be clearer.
5. **Validation was retrofitted** (`Ingredient.validate`); many ops still validate by hand. Put schema validation (type, range, enum, required) in the first version of the arg system and make it the only way args reach `run`.
6. **Magic's `present` stores per-instance state** (`this.state`) and is only the last op's `present` - fragile. Keep presentation pure.
7. **Cancel = terminate the worker** and reload modules; fine as a fallback, but support cooperative cancellation/chunked progress for long ops.
8. **Legacy UI stack** (jQuery + Bootstrap 4 + hand-rolled waiters with DOM-string templates; mobile UI is a long-standing open request, issue #181; `AGENTS.md` itself says to prefer vanilla JS). Build Forge's UI with a component model and responsive layout from the start, and keep accessibility in mind.
9. **Build weight**: the standalone download exceeds 75 MB; lots of overlapping crypto libs (node-forge, crypto-js, crypto-api, jsrsasign, noble) for one feature set. Prefer the platform WebCrypto API where possible, one library per primitive, and tree-shakeable ESM libs; keep a lint rule against importing heavy libs from the core.
10. **Generated files & codegen steps** (`OperationConfig.json`, module files, Node index) must run before dev/test; a registry that is derived at import time (or a Vite/esbuild plugin) would remove a class of stale-config bugs.
11. **Recipe URL format quirks**: pretty-recipe parsing is regex based and needed a later validator; op names with spaces/underscores, and slashes/ampersands in args, require careful escaping. Define a formal grammar (or use compact JSON + base64/deflate) with versioning from day one, and keep arg order stable (positional args break when an op gains or reorders arguments - op arg lists are positional, so adding an arg in the middle silently breaks old links; prefer named args plus a schema version).
12. **Inconsistent metadata**: mixed type-name casing ("json", "Number", "Object"), JSON-style vs JS-style keys in arg configs, duplicated ops across categories (34 duplicates). Enforce metadata with a schema/type checker.
13. **Demand signals from the open issue tracker** (reaction counts via `gh api search/issues`): zstd (+23) and brotli (+18) compression, YAML to JSON (+16), a CLI (+15), VSCode extension (+20), desktop app (+8), offline PWA (+6), mobile UI (+6), swap/reverse recipe (+5), xxHash, UUencode, PKCS7, JWE. These are good candidates for Forge's early roadmap since users are explicitly asking for them (modern browsers expose native `CompressionStream` for gzip/deflate, and WASM builds exist for zstd/brotli).

---

## Appendix: full operation catalogue by category

(Counts are entries per category, taken from `src/core/config/Categories.json`.)

### Favourites (0)

(empty in Categories.json; the Favourites list is filled at runtime from localStorage or a default list in `src/web/index.js`.)

### Data format (80)

To Hexdump; From Hexdump; To Hex; From Hex; To Charcode; From Charcode; To Decimal; From Decimal; To Float; From Float; To Binary; From Binary; To Octal; From Octal; To Base32; From Base32; To Base45; From Base45; To Base58; From Base58; To Bech32; From Bech32; To Base62; From Base62; To Base64; From Base64; Show Base64 offsets; To Base92; From Base92; To Base85; From Base85; To Base; From Base; To BCD; From BCD; Text-Integer Conversion; To HTML Entity; From HTML Entity; URL Encode; URL Decode; Escape Unicode Characters; Unescape Unicode Characters; Normalise Unicode; Escape Smart Characters; To Quoted Printable; From Quoted Printable; To Punycode; From Punycode; AMF Encode; AMF Decode; To Hex Content; From Hex Content; PEM to Hex; Hex to PEM; Parse ASN.1 hex string; Change IP format; Encode text; Decode text; Text Encoding Brute Force; Swap endianness; To MessagePack; From MessagePack; To Braille; From Braille; Parse TLV; CSV to JSON; JSON to CSV; Avro to JSON; CBOR Encode; CBOR Decode; YAML to JSON; JSON to YAML; Caret/M-decode; Rison Encode; Rison Decode; To Modhex; From Modhex; MIME Decoding; To COBS; From COBS

### Encryption / Encoding (95)

AES Encrypt; AES Decrypt; Blowfish Encrypt; Blowfish Decrypt; DES Encrypt; DES Decrypt; Triple DES Encrypt; Triple DES Decrypt; Fernet Encrypt; Fernet Decrypt; LS47 Encrypt; LS47 Decrypt; RC2 Encrypt; RC2 Decrypt; RC4; RC4 Drop; ChaCha; Salsa20; XSalsa20; Rabbit; SM4 Encrypt; SM4 Decrypt; RC6 Encrypt; RC6 Decrypt; Ascon Encrypt; Ascon Decrypt; PRESENT Encrypt; PRESENT Decrypt; Twofish Encrypt; Twofish Decrypt; GOST Encrypt; GOST Decrypt; GOST Sign; GOST Verify; GOST Key Wrap; GOST Key Unwrap; ROR13; ROT13; ROT13 Brute Force; ROT47; ROT47 Brute Force; ROT8000; XOR; XOR Brute Force; Vigenère Encode; Vigenère Decode; TEA Encrypt; TEA Decrypt; XTEA Encrypt; XTEA Decrypt; XXTEA Encrypt; XXTEA Decrypt; To Morse Code; From Morse Code; Bacon Cipher Encode; Bacon Cipher Decode; Bifid Cipher Encode; Bifid Cipher Decode; Caesar Box Cipher; Affine Cipher Encode; Affine Cipher Decode; A1Z26 Cipher Encode; A1Z26 Cipher Decode; Rail Fence Cipher Encode; Rail Fence Cipher Decode; Atbash Cipher; CipherSaber2 Encrypt; CipherSaber2 Decrypt; Cetacean Cipher Encode; Cetacean Cipher Decode; Substitute; Derive PBKDF2 key; Derive EVP key; Derive HKDF key; Bcrypt; Scrypt; JWT Sign; JWT Verify; JWT Decode; Citrix CTX1 Encode; Citrix CTX1 Decode; AES Key Wrap; AES Key Unwrap; Pseudo-Random Number Generator; Pseudo-Random Prime Generator; Enigma; Bombe; Multiple Bombe; Typex; Lorenz; Colossus; SIGABA; Flask Session Decode; Flask Session Sign; Flask Session Verify

### Public Key (33)

Parse X.509 certificate; Parse X.509 certificate bundles; Parse X.509 CRL; Parse ASN.1 hex string; PEM to Hex; Hex to PEM; Hex to Object Identifier; Object Identifier to Hex; PEM to JWK; JWK to PEM; Generate PGP Key Pair; PGP Encrypt; PGP Decrypt; PGP Sign; PGP Verify; PGP Encrypt and Sign; PGP Decrypt and Verify; Parse PGP Key; Generate RSA Key Pair; RSA Sign; RSA Verify; RSA Encrypt; RSA Decrypt; Generate ECDSA Key Pair; ECDSA Signature Conversion; ECDSA Sign; ECDSA Verify; Parse SSH Host Key; Parse CSR; Public Key from Certificate; Public Key from Private Key; SM2 Encrypt; SM2 Decrypt

### Arithmetic / Logic (31)

Set Union; Set Intersection; Set Difference; Symmetric Difference; Cartesian Product; Power Set; XOR; XOR Brute Force; OR; NOT; AND; ADD; SUB; Sum; Subtract; Multiply; Divide; MOD; Extended GCD; Modular Exponentiation; Modular Inverse; Mean; Median; Standard Deviation; Bit shift left; Bit shift right; Rotate left; Rotate right; ROR13; ROT13; ROT8000

### Networking (38)

HTTP request; DNS over HTTPS; Strip HTTP headers; Dechunk HTTP response; Parse Ethernet frame; Parse User Agent; Parse IP range; Parse IPv6 address; IPv6 Transition Addresses; Parse IPv4 header; Strip IPv4 header; Parse TCP; Strip TCP header; Parse TLS record; Parse UDP; Strip UDP header; Parse SSH Host Key; Parse URI; URL Encode; URL Decode; Protobuf Decode; Protobuf Encode; VarInt Encode; VarInt Decode; JA3 Fingerprint; JA3S Fingerprint; JA4 Fingerprint; JA4Server Fingerprint; HASSH Client Fingerprint; HASSH Server Fingerprint; Format MAC addresses; Change IP format; Group IP addresses; Encode NetBIOS Name; Decode NetBIOS Name; Defang URL; Fang URL; Defang IP Addresses

### Language (7)

Encode text; Decode text; Unicode Text Format; Remove Diacritics; Unescape Unicode Characters; Convert to NATO alphabet; Convert Leet Speak

### Utils (52)

Diff; Remove whitespace; Remove null bytes; Remove ANSI Escape Codes; To Upper case; To Lower case; Swap case; Alternating Caps; To Case Insensitive Regex; From Case Insensitive Regex; Add line numbers; Remove line numbers; Get All Casings; To Table; Reverse; Sort; Shuffle; Unique; Split; Filter; Head; Tail; Count occurrences; Expand alphabet range; Drop bytes; Take bytes; Pad lines; Find / Replace; Regular expression; Fuzzy Match; Offset checker; Hamming Distance; Levenshtein Distance; Convert distance; Convert area; Convert mass; Convert speed; Convert data units; Convert co-ordinate format; Show on map; Parse UNIX file permissions; Parse ObjectID timestamp; Swap endianness; Parse colour code; Escape string; Unescape string; Pseudo-Random Number Generator; Sleep; File Tree; Wrap; Take nth bytes; Drop nth bytes

### Date / Time (10)

Parse DateTime; Translate DateTime Format; From UNIX Timestamp; To UNIX Timestamp; Windows Filetime to UNIX Timestamp; UNIX Timestamp to Windows Filetime; DateTime Delta; Extract dates; Get Time; Sleep

### Extractors (20)

Strings; Extract IP addresses; Extract email addresses; Extract MAC addresses; Extract URLs; Extract domains; Extract file paths; Extract dates; Extract hashes; Regular expression; XPath expression; JPath expression; Jsonata Query; CSS selector; Extract EXIF; Extract ID3; Extract Audio Metadata; Extract Files; RAKE; Template

### Compression (21)

Raw Deflate; Raw Inflate; Zlib Deflate; Zlib Inflate; Gzip; Gunzip; Zip; Unzip; Bzip2 Decompress; Bzip2 Compress; Tar; Untar; LZString Decompress; LZString Compress; LZMA Decompress; LZMA Compress; LZ4 Decompress; LZ4 Compress; LZNT1 Decompress; XPRESS Decompress; XPRESS LZ77+Huffman Decompress

### Hashing (50)

Analyse hash; Generate all checksums; Generate all hashes; MD2; MD4; MD5; MD6; SHA0; SHA1; SHA2; SHA3; SM3; Keccak; Shake; RIPEMD; HAS-160; Whirlpool; Snefru; BLAKE2b; BLAKE2s; BLAKE3; Ascon Hash; Ascon MAC; GOST Hash; Streebog; SSDEEP; CTPH; Compare SSDEEP hashes; Compare CTPH hashes; HMAC; CMAC; Bcrypt; Bcrypt compare; Bcrypt parse; Argon2; Argon2 compare; Scrypt; NT Hash; LM Hash; MurmurHash3; Fletcher-8 Checksum; Fletcher-16 Checksum; Fletcher-32 Checksum; Fletcher-64 Checksum; Adler-32 Checksum; Luhn Checksum; CRC Checksum; TCP/IP Checksum; XOR Checksum; Parity Bit

### Code tidy (30)

Syntax highlighter; Generic Code Beautify; JavaScript Parser; JavaScript Beautify; JavaScript Minify; JSON Beautify; JSON Minify; XML Beautify; XML Minify; SQL Beautify; SQL Minify; CSS Beautify; CSS Minify; XPath expression; JPath expression; Jq; CSS selector; PHP Deserialize; PHP Serialize; Microsoft Script Decoder; Strip HTML tags; Diff; To Snake case; To Camel case; To Kebab case; BSON serialise; BSON deserialise; To MessagePack; From MessagePack; Render Markdown

### Forensics (12)

Detect File Type; Scan for Embedded Files; Extract Files; YARA Rules; Remove EXIF; Extract EXIF; Extract RGBA; View Bit Plane; Randomize Colour Palette; Extract LSB; ELF Info; Extract Audio Metadata

### Multimedia (29)

Render Image; Play Media; Generate Image; Optical Character Recognition; Remove EXIF; Extract EXIF; Split Colour Channels; Rotate Image; Resize Image; Blur Image; Dither Image; Invert Image; Flip Image; Crop Image; Image Brightness / Contrast; Image Opacity; Image Filter; Contain Image; Cover Image; Image Hue/Saturation/Lightness; Sharpen Image; Normalise Image; Convert Image Format; Add Text To Image; Hex Density chart; Scatter chart; Series chart; Heatmap chart; Render PDF

### Other (22)

Entropy; Frequency distribution; Index of Coincidence; Chi Square; P-list Viewer; Disassemble x86; Disassemble ARM; Pseudo-Random Number Generator; Pseudo-Random Integer Generator; Generate De Bruijn Sequence; Generate UUID; Analyse UUID; Generate TOTP; Generate HOTP; Generate QR Code; Parse QR Code; Haversine distance; HTML To Text; Generate Lorem Ipsum; Numberwang; XKCD Random Number; Automated Validation Test Op

### Flow control (10)

Magic; Fork; Subsection; Merge; Register; Label; Jump; Conditional Jump; Return; Comment
