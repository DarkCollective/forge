# Recipe JSON v1.1, additive wave: historical note

Status: **implemented and folded into [RECIPES.md](RECIPES.md)**. This file is kept as a record. It is not a specification: RECIPES.md ("Recipes, operations and the bake host: Phase 2 specification, v1 and v1.1") is the single reference, and its [Appendix A, "Changes in v1.1"](RECIPES.md#appendix-a-changes-in-v11) lists every new step kind, field, reference form, issue code, limit, export and protocol field, with its section number, for the author of a tool that reads the format.

## What it was

WP 6.34 wrote a proposal for an additive wave of the recipe format, approved by the owner on 2026-11-21 with every recommended answer of its open questions accepted. The wave adds two step kinds, `register` (a value computed from a copy of the data and bound to a name, read back as a `{ "ref": … }` parameter value) and `return` (end the recipe with the current data). It keeps `"forge": 1`, so an old reader rejects a new recipe with an error and never misreads it. WPs 6.35 to 6.40 implemented it, each with its tests, and WP 6.41 folded the result into the main documents:

| WP | What |
|---|---|
| 6.35 | the internal word `recipe:peek` in the `recipe` vocabulary of `@forge/ops`, with tests of the FL facts the proposal relies on |
| 6.36 | the model: types, `RECIPE_LIMITS`, the schema, the validator with its scope pass, `normalise`, `resolve` and `pin`, the `registers.ts` helpers, and the corpus under `packages/recipe/test/corpus/v11/{valid,invalid,validator-only}/` |
| 6.37 | compilation and the text form: `$name` locals, the `register` and `return` lines, the lowered `if`, the line-membership step map, and the parser for the new lines |
| 6.38 | the baker: the new kinds in `bake`, the optional `registers` field of `paused`, `detail.register`, redaction of secret registers, the steps open at a `return`, and the final progress |
| 6.39 | the editing UI: block kinds, recipe-pane cards, drop rules, the Value/Register switch of the parameter form, issue texts and type fit |
| 6.40 | the debug panel's list of registers at a pause, the register named in a bake error, the share-dialog note, the `insertStep` guard for a misplaced Return, and an end-to-end test of recipe M |
| 6.41 | this fold-in |

The 38 conformance cases of the proposal (CR101 to CR138) were fenced `recipe-proposed` while their feature did not exist. They are now in RECIPES.md section 12.8, with their numbers and text, fenced `recipe-case`. Each case is asserted by the tests named in its row of the index there.

## Where each section went

The source code still cites sections of this proposal (for example "RECIPES-1.1.md section 3.5" in `packages/recipe/src/stepmap.ts`). This table gives the section that now holds the text, as LANGUAGE-0.2.md does for FL.

| Proposal section | Now in |
|---|---|
| 0 How to read this document | RECIPES.md §3.2 and Appendix A (the summary); the rules of 0.2 are §3 and Appendix A.1 |
| 0.1 The two features in one table | §3.2 (`register`, `return`), §3.8 (limits) |
| 0.2 Rules this proposal obeys | §3 introduction, Appendix A.1 |
| 0.3 What was checked by running | the cases marked **(run)** in §12.8, and the tests they name |
| 0.4 Conformance cases in this document | §12.8 |
| 1.1 The recommended design in short | §1.1 (R25 to R30), §3.2, §5.2, §5.3 |
| 1.2 What a v1 reader does with a v1.1 recipe | Appendix A.11 |
| 1.3 Version handling: keep `"forge": 1` | §3 introduction, §3.1, R29 |
| 1.4 The compatibility promise, stated as tests | §12.8 (CR124), Appendix A.1 |
| 2.1 The motivating case and three shapes | §12.8.1 (CR101, recipe M) and §12.8.6 (CR131) |
| 2.2 The step | §3.2 |
| 2.3 Scope and visibility | §3.2 (`register`), §3.7 (the scope pass) |
| 2.4 References | §3.4 |
| 2.5 What the register must hold: coercion | §3.4 (tables) |
| 2.6 Which compiled form | §5.2, §5.3, R27 |
| 2.7 Compilation to FL | §4.3 (`recipe:peek`), §5.2, §5.3 |
| 2.8 Limits | §3.8 |
| 3.1 The step | §3.2 (`return`) |
| 3.2 Scope: the whole recipe | §3.2 (`return`), §3.7 (`bad-position`, `unreachable-step`) |
| 3.3 Why `exit` | §5.3 (the lowered `if`) |
| 3.4 Compilation | §5.3, §5.4 |
| 3.5 The step map, breakpoints, progress | §5.5, §8.2, §8.8 |
| 4.1 `packages/recipe/src/types.ts` | the code; Appendix A.8 |
| 4.2 The JSON Schema | §3.9 |
| 4.3 Validation issue codes | §3.7 |
| 4.4 Normal forms | §3.6 |
| 4.5 Limits | §3.8 |
| 4.6 Compilation | §5 |
| 4.7 The canonical text form | §6.2, §6.3, §6.4 |
| 4.8 The share URL | §7.1, §7.4; §7.3 is unchanged |
| 4.9 Secrets | §7.4, §8.4 |
| 4.10 The bake API and the debugger | §8.2, §8.4 |
| 4.11 The Magic engine | §8.9 (unchanged: Magic never generates the new steps, Q16) |
| 4.12 The UI | UI.md §2.3 |
| 4.13 The editor plugin | the backlog item below |
| 4.14 Documents amended by the fold-in | this table |
| 5 Security | the rules are in §3.4, §3.7, §7.4 and §8.2; PLAN.md §5 is unchanged |
| 6 Conformance cases | §12.8 |
| 7 Work packages | PLAN.md, Phase 6, rows 6.34 to 6.41 |
| 8 Open questions | the answers as decided, below |
| 9 What this wave does not do | unchanged: a scoped `return` and registers in structural parameters are not in the format (§3.2, §3.4) |

### The open questions

The owner accepted every recommended answer. Where each is now:

| # | Decided | Now in |
|---|---|---|
| Q1 | additive changes to `packages/recipe`, and the work packages allowed in `packages/ops/vocab/recipe.fth`, `packages/worker` and `apps/web` | the wave itself (§1.1 R29) |
| Q2 | keep `"forge": 1` | §3, R29 |
| Q3 | the computed register only | §3.2 |
| Q4 | the names `register` and `return` | §3.2 |
| Q5 | `return` ends the whole recipe, valid at the root and in `if` branches | §3.2, §3.7 |
| Q6 | a reference only in op and op-test parameters | §3.4 |
| Q7 | a reference supplies every parameter type | §3.4 |
| Q8 | the two views of disabled steps | §3.7 (scope pass) |
| Q9 | `unreachable-step` as a warning | §3.7 |
| Q10 | 32-character names, 64 registers | §3.8 |
| Q11 | the internal word `recipe:peek` | §4.3 |
| Q12 | locals named `$name` | §5.2 |
| Q13 | redaction of a register that feeds a `key`, no reveal toggle | §7.4, §8.4 |
| Q14 | register values at pauses only | §8.4 |
| Q15 | `protocol: 1` with an optional `registers` field | §8.4 |
| Q16 | Magic does not generate the new steps | §8.9 |
| Q17 | the step-map fix in `resolveStepIps` | §5.5 |
| Q18 | one line in the share dialog when a recipe uses v1.1 | UI.md §2.3 |
| Q19 | the name on the close line, `] recipe:peek :> $name` | §5.3, §6.2 |
| Q20 | two checks, in 6.38 and 6.41 (see below) | §8.2 |

Q20 has two halves. The baker does not clip a register's value: `ForgeError.toJSON()` already renders a value in `detail` with `reprShort`, which cuts it to 80 code points, so the detail that reaches `BakeError` is clipped (checked in `packages/lang/src/errors.ts`). Whether the editor plugin accepts a qualified `core:exit` and `$`-prefixed words was **not** checked; it is in the backlog below.

## Where the code differs from the proposal

The implementing packages made corrections and refinements. RECIPES.md describes the code. The ones that matter to a reader of the proposal:

- **Limits.** `maxRegisters` (64) and `maxRegisterNameChars` (32) are in `RECIPE_LIMITS` in `packages/recipe/src/types.ts`, next to the existing limits. `limits.ts` holds the JSON size helpers and no limit of its own.
- **`registersInScope(recipe, stepPath, catalogue?)`** takes an optional catalogue. Without one, `secret` is false for every register. A path that ends at a list (`/steps/1/then`) means the position after the list's last step. An unknown path gives `[]`.
- **The scope pass** skips a step that already has an error of its own, so a reference in a step with an unknown op gives `unknown-op` only.
- **`unknown-register`** has the four reasons of §3.7 (`not-defined`, `not-yet-defined`, `out-of-scope`, `disabled`), with the text of each in the code. Its `detail` is `{ register, reason }`.
- **Parser codes** (6.37): a closer `if` without its leading `dup`, or with `dup` and another closer, is `bad-value` with `constraint: "block structure"`; a `core:exit` line with atoms before it is `bad-value`; a `@pin=` on a register or return line is `bad-value`. The proposal named none of the pin cases.
- **A disabled `if` keeps `recipe:branch`** even when an enabled `return` is inside it, because the whole block is commented out. The text of its lines is the same either way, so no instruction changes.
- **A step with no instruction** of its own gets the empty range at the first instruction after its last line.
- **`RegisterView`** is `{ name, path, value }` with no `secret` field. A secret register's value is `{ kind: "other", tag, repr: "<redacted>" }`. The `registers` field is omitted when the list is empty, and a register with no value yet is left out.
- **`detail.register`** is added only when `detail.param` names a parameter that a register supplies by reference. An `E_RANGE` from a helper word of the op (an AES key length, for example) gets none.
- **Progress after a `return`**: the final `progress` event has `done` equal to `total` (CR138).
- **Default register names** are `value`, `value-2`, `value-3` and so on, the first free name. Renaming a register re-points the references to it in scope, in one undo step. A new name that is already visible leaves the references unchanged and says so in the announcement.
- **The Value/Register switch** is on op and op-test parameters only. It is not on `fork` separators, `subsection` patterns, the regex test of an `if`, or repeat counts, which the format does not allow references in.
- **The Return card** reads "Return", with "stop here and output" beside it. A placement that is refused gives the text `BAD_POSITION_TEXT` ("A Return can only go at the top of the recipe or inside the branches of an If."), and `actions.insertStep` throws a `RangeError` for it, changing nothing.
- **The debug panel** has a section "Registers at this pause" in the output pane (not in a separate panel). Each row has a **Show step** button. The output is no longer dimmed while the bake is paused (a contrast fix found by axe).
- **The error sentence** for a register-supplied parameter is "The parameter `<p>` was supplied by register `<r>`."
- **The share-dialog note** is "This recipe needs Forge 1.1 or later; older versions show an error.", with the key sentence when a register is secret.

## Open items and the editor plugin

- **Editor plugin (section 4.13): a backlog item for the forge-plugin repository**, checked out next to this one (`../forge-plugin`). It was not edited by this wave. The items: whether its diagnostics (`FLDiagnostics.java`, `exits()`) accept a qualified `core:exit` in the literal quotations of an `if`; whether its lexer takes `$iv` as a word and `:> $iv` as a binding (LANGUAGE §2.11 says `$` is a name-start symbol); and whether its navigation and completion list `recipe:peek` if it indexes `packages/ops/vocab`. The plugin does not read recipe JSON, so the JSON needs no change there.
- **Q20, the plugin half**: not checked (see above).
- **The corpus**: `packages/recipe/test/corpus/v11/` has no README, so there is nothing to update in it.
