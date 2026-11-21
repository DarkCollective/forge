# Recipe JSON v1.1, additive wave: specification proposal

Status: **approved by the owner** (2026-11-21) with every recommended answer of section 8 accepted; being implemented in WPs 6.35 to 6.41 (written in WP 6.34).

`packages/recipe` is a frozen Phase 1 to 2 contract (CLAUDE.md). The owner has approved *writing* a proposal for an additive wave, modelled on how FL v0.2 was done ([LANGUAGE-0.2.md](LANGUAGE-0.2.md), WP 6.2): a proposal with numbered open questions, each with a recommended answer; the owner decides; later work packages implement; a fold-in merges the result into the main specification. Implementing this wave needs a second decision, listed as question Q1: to unfreeze `packages/recipe` for additive changes, and to let the work packages edit one internal vocabulary file of `packages/ops`, and parts of `packages/worker` and `apps/web`.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. A reference of the form "§3.7" means RECIPES.md unless a file is named. Forge is an independent implementation (PLAN §1): the two features below are known from other recipe-based data tools, but every name, parameter and behaviour in this document is Forge's own, and where a cleaner design exists it is used (for example, registers are not numbered `$R0`, `$R1` slots and Return is not a flag on an operation).

## Contents

0. How to read this document
1. Summary and compatibility
2. Register
3. Return
4. Changes, per surface
5. Security
6. Conformance cases
7. Work packages
8. Open questions

---

## 0. How to read this document

### 0.1 The two features in one table

| | Register | Return |
|---|---|---|
| Problem | A later step needs a value that is a *part of the data* (the first 16 bytes are an IV, the next 32 a key). Today a key or IV parameter holds a literal (§3.4), so the recipe cannot read it from the data. | A recipe should stop early and give the current data as the result, skipping every later step. Today a recipe always runs to its last step; a branch cannot end the recipe. |
| JSON | step `{ "kind": "register", "name": "iv", "steps": [ … ] }`; reference `{ "ref": "iv" }` in the place of an op parameter value | step `{ "kind": "return" }` |
| Meaning | the children run on a **copy** of the data; the value they leave is bound to the name; the data is unchanged | leave the recipe now; the current data is the output |
| Compiles to | `[ … ] recipe:peek :> $name`; a reference is the local `$name` | `core:exit`, in an `if` that is compiled with literal quotations |
| New issue codes | `unknown-register`, `duplicate-register` | `bad-position`, `unreachable-step` (warning) |
| New limits | at most 64 registers, names of at most 32 characters | none |
| Version | `forge` stays `1` (section 1.3) | the same |

### 0.2 Rules this proposal obeys

1. **Every valid v1 recipe, share link, text form and golden stays valid and compiles to byte-identical FL.** A recipe that uses neither feature goes through exactly the code path it goes through today.
2. **A v1 reader rejects a v1.1 recipe; it never misreads one.** Section 1.2 shows what the current code does, from a run.
3. **No new ambient capability.** No new primitive, no new catalogue op, no new exported word of `core`. One new *internal* word (`recipe:peek`, section 2.7).
4. **No new FL syntax and no change to `packages/lang`.** Locals (`:>`, LANGUAGE §7.1) and `exit` (LANGUAGE §8) already exist. Where a limit of FL decides the design (section 3.2), the design follows it; changing FL is out of this wave.
5. **Every new construct is bounded** by the existing limits of §3.8 and §8.6, plus two new ones (section 2.8).

### 0.3 What was checked by running

Statements about current behaviour are cited to a section of RECIPES.md, LANGUAGE.md or to the code. Statements about how the *proposed* FL text behaves were checked on 2026-11-21 by scratch scripts (not committed) over the built packages at commit c94969b: hand-written compiled texts of the shape in section 2.7 and 3.4 were loaded into the vocabulary `bake` on a runtime assembled from the whole shipped bundle (plus the one proposed word `recipe:peek`, loaded as a trusted unit) and run. Each such statement is marked **(run)**. What those runs showed:

| checked | result |
|---|---|
| `$iv` is an ordinary word token; `[ … ] recipe:peek :> $iv` loads; a later `$iv` pushes the value | yes |
| the motivating recipe (section 2.1) decrypts the blob built with `aes:encrypt` | yes: output `attack at dawn` |
| a local bound in a `fork` piece, a `then` branch or a `recipe:peek` body is not visible after it; binding a name already visible is `E_REDEFINED` | yes (`E_UNDEFINED` at load, `E_REDEFINED` at load) |
| `core:exit` inside literal quotations of nested `if`, in the word body, runs and leaves the word with the data on the stack | yes |
| `positions[ip].line` of a text with a lowered `if` is **not** non-decreasing (the `jumpf` carries the line of the closing `if`), so the §5.5 rule gives empty instruction ranges to the children | yes; this is why section 3.5 changes the rule |
| a register value reaching a parameter is checked at word entry: `E_PARAM_INVALID` (constraint, regex), `E_TYPE` (tag), `E_RANGE` (op-specific), attributed through `frames` to the recipe word | yes |
| `StepEvent.frames()` lists a register's `$name` as a local of the frame of the recipe word (a register bound in the body) and of the quotation frame that binds it (a register bound inside a container), and not in the frames outside | yes |

Not checked, and flagged where it matters: the editor plugin, the web components, the real worker protocol, the baker's use of `frames()`.

### 0.4 Conformance cases in this document

RECIPES.md §12 is prose and tables, and **no test harness reads RECIPES.md**: the files under `packages/recipe/test/` and `packages/worker/test/` carry the §12 examples as hand-written tests and goldens (checked: no `*.ts`, `*.mjs` or `*.json` file of `packages/` or `apps/` reads `docs/RECIPES.md`; the only tests that read a document under `docs/` read LANGUAGE.md, and the conformance harness `packages/lang/test/conformance/parse.ts` takes only blocks with the info string `fl-test`). So the cases of section 6 are fenced with the info string **`recipe-proposed`**, which nothing reads, in a small line format described in section 6.1, and numbered in a reserved range **CR101 and up** (RECIPES.md has no numbered cases, so there is nothing to collide with). Each implementation work package writes tests that cite the CR numbers it covers; the fold-in work package moves the cases into RECIPES.md §12 as tables and keeps the numbers.

---

## 1. Summary and compatibility

### 1.1 The recommended design in short

- **Register** is a **container step** whose children compute a value from a copy of the data, as the test of an `if` does, and bind it to a name. Any op chain can produce the value (take bytes, hex decode, a JSON path, a regex capture group once such an op exists). The data flows through unchanged.
- A **reference** is the JSON object `{ "ref": "iv" }`, accepted wherever an op or op test takes a parameter value. It is checked statically for existence and scope; the value is checked at run time by the ordinary word-entry checks of FL.
- Scope is **lexical and follows the step lists**: a register is visible to the steps after it in the same list and to everything nested in them. A name that is already visible cannot be bound again (`duplicate-register`), as FL itself forbids it.
- **Return** is a leaf step that **ends the whole recipe** with the current data. It is valid only at the top of the recipe and inside `if` branches (to any depth of `if`), because that is where FL can compile it to a jump. Inside `fork`, `subsection`, `repeat` and `register` it is a validation error (`bad-position`).
- The compiled forms are `[ … ] recipe:peek :> $name`, `$name` as a literal group, and `core:exit` inside an `if` compiled with literal quotations. `forge` stays `1`.

### 1.2 What a v1 reader does with a v1.1 recipe

Every v1.1 construct is a **new step kind** (`register`, `return`) or can only appear after one (a reference needs a register). The validator of §3.7 rejects an unknown kind (`bad-kind`) and an unknown parameter shape (`unknown-field`, `required`), and the baker refuses an invalid recipe (`E_RECIPE_INVALID`, §8.2). So an old reader fails closed. Observed on the code at c94969b, with the bundle catalogue (run):

| input to the current code | result |
|---|---|
| a recipe with a `register` step, and a `{ "ref": … }` parameter | `bad-kind` at `/steps/0/kind`; `unknown-field` at `/steps/1/params/key/ref`, `required` at `…/key/value` and `…/key/enc` |
| a `return` step inside `then` | `bad-kind` at `/steps/2/then/0/kind` |
| text with a `core:exit` line | `unknown-op` "unknown operation 'core:exit'" |
| text with `[`, `] recipe:peek :> $iv` lines | `bad-value` "an op line ends with a qualified name" (line and column attached) |
| text with `$iv` as a parameter literal | `bad-value` "only literals may come before the operation name" |
| a share link whose recipe uses either feature | `invalid-recipe` with the issues of the first row (§7.3 step 7) |

The messages are less explicit than a version error would be. Section 1.3 says why that is accepted.

### 1.3 Version handling: keep `"forge": 1`

The two options: (A) keep `"forge": 1` and rely on the new step kinds failing validation in an old reader; (B) bump to `"forge": 2` for recipes that use a feature.

**Recommendation: A.** Reasons:

1. **Goldens.** The documented examples of the *unsupported version* behaviour use `"forge": 2`: §7.5 (`{"forge":2,"steps":[]}` is `invalid-recipe`) and §12.4 (`bad-version` at `/forge`), and the tests that pin them. Under B those inputs become valid recipes and the examples and tests must change. Under A the meaning of `bad-version` is unchanged: "a different major format".
2. **Fails closed either way** (section 1.2), so B buys only a clearer message.
3. **B needs more machinery**: a second JSON Schema (the schema says `"forge": { "const": 1 }`, §3.9, and a v1 document must keep validating exactly as before), a rule for who stamps the number, a text header `\ forge-recipe 2`, and a decision about the share `v` key. A keeps one schema (extended), the header `\ forge-recipe 1` and `v=1`.
4. **The number is a major version.** v1.1 is a minor, additive step, which is what the name says.

The cost of A is that a recipe that needs v1.1 does not say so. A pure helper `recipeUsesV11(recipe): boolean` (true iff an enabled or disabled `register` or `return` step exists) lets the UI add a one-line note to the share dialog ("this recipe needs Forge 1.1 or later; older versions show an error"), and lets tests state the compatibility rule. The text header and the share fragment keep their version numbers (`\ forge-recipe 1`, `v=1`). If the owner prefers B, section 4 changes in four places: `RECIPE_FORMAT_VERSION`, the schema (a second file), the validator (`bad-version` accepts 1 and 2; the new kinds need 2) and the text header; question Q2.

### 1.4 The compatibility promise, stated as tests

1. Every file under `packages/recipe/test/corpus/` and `…/goldens/` gives the same issues, canonical JSON, text and fragments as before.
2. For every v1 recipe `r` and catalogue `c`: `compileRecipe(r, c).text` is byte-identical to the text of the code at c94969b. (A recipe without a `return` step compiles every `if` to `recipe:branch`, section 3.4; a recipe without a `register` step has no `recipe:peek`.)
3. The step map of a v1 text is identical under the new rule of section 3.5 (the old and the new rule coincide when the instruction lines are non-decreasing, which they are in every v1 text).
4. `RECIPE_LIMITS`, `SHARE_LIMITS` and every existing issue code keep their values.
5. TypeScript consumers that switch exhaustively over `Step["kind"]` need two new cases. This is a source change in `apps/web` and `packages/worker` (section 4.1 lists the files), not a behaviour change.

---

## 2. Register

### 2.1 The motivating case and three shapes

A blob whose first 16 bytes are an IV, the next 32 an AES-256 key, and the rest CBC ciphertext. The decrypt op takes its key and IV as parameters (`aes:decrypt ( bytes key:key{…} iv:key{…}="" mode padding aad -- bytes )`); the slice ops are `bytes-slice:take ( data start length each-line -- bytes )` and `bytes-slice:remove`. The recipe in the shape recommended below (recipe M, used in sections 2 to 6):

```json
{ "forge": 1, "steps": [
  { "kind": "register", "name": "iv",  "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 0,  "length": 16 } } ] },
  { "kind": "register", "name": "key", "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 16, "length": 32 } } ] },
  { "kind": "op", "op": "bytes-slice:remove", "params": { "start": 0, "length": 48 } },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "key" }, "iv": { "ref": "iv" }, "mode": "CBC" } }
] }
```

| shape | what it is | the motivating case | other cases | cost |
|---|---|---|---|---|
| (a) **capture step** | `{ "kind": "capture", "pattern": …, "flags", "encoding", "names": ["iv", "key"] }`: a regex whose groups are bound to names | possible: `^([\s\S]{16})([\s\S]{32})` with `encoding: "latin1"` and the `s` flag; the groups come back as latin1 text and are re-encoded to bytes | only text-shaped captures; a hex-encoded key needs a second mechanism; no JSON path, no length-prefixed field | a **new primitive** (`recipe:_capture`, groups as bytes); every recipe that uses it **needs a hard-kill baker** (`needsHardKill`, §4.1, R11) although slicing needs no regex; names live in a list apart from the step that gives them meaning |
| (b) **computed register** (recommended) | a container step: children compute a value from a copy of the data (as the test of an `if` does, §3.2) and the value is bound to one name | `bytes-slice:take` twice; no regex, no hard kill | **any** op chain: `hex:decode` of a field, a JSON path op, `search:count`, a predicate op for a bool; a regex capture group becomes one more op (`regex:…`) later without a new step kind | one new step kind and one internal FL word (`recipe:peek`) |
| (c) both | (a) as sugar over (b) | | | two ways to write the same thing; two grammars and two sets of tests; the text form needs both |

**Recommendation: (b) only.** It solves the motivating case without the regex engine (so an untrusted recipe that only slices bytes needs no hard kill), it composes with every existing and future op, and it adds one concept. A regex-capture convenience is better as an *op* than as a step kind: `regex:capture ( data pattern flags group:int -- … )` is an ordinary chainable op that can be a register's only child, with no change to this specification. Question Q3.

### 2.2 The step

```jsonc
{ "kind": "register", "name": "iv",
  "steps": [ /* Step[]: computes the value */ ],
  "disabled": false, "breakpoint": false, "note": "…" }
```

| field | rule |
|---|---|
| `kind` | `"register"` |
| `name` | required string, `^[a-z][a-z0-9-]{0,31}$` (the shape of a parameter name, §3.4, but at most 32 characters). Violation: `bad-value`, `constraint: "pattern ^[a-z][a-z0-9-]{0,31}$"`, at `/…/name`; absent: `required`. |
| `steps` | required list, possibly empty. |
| `disabled`, `breakpoint`, `note` | as on every step except `comment` (§3.2). |

No other keys (R1: objects are closed).

**Meaning.**

1. The data entering the step is copied. (FL values are immutable, LANGUAGE §3.1, so the copy is free.)
2. The children run on the copy in order, exactly as the children of any container do, with one difference: the first child receives the data **with its own tag**; there is no `recipe:as-bytes` in front, because the data must leave the step unchanged and `as-bytes` would turn a `str` into `bytes`. An op coerces at its own word boundary as always (§3.3).
3. The value the last child leaves is **bound to `name`**. It can have any tag: bytes, str, int, bool, even a list or record (an op chain may end in any output; only references to it are limited, section 2.5).
4. The data leaving the step is the data that entered: same tag, same value. A register has the stack effect `( x -- x )` and may be put anywhere between steps.
5. A register with **no children** binds the data itself. That is useful ("remember the input as `original`").
6. A failing child fails the recipe at that child's path (§5.7); nothing is bound.
7. A `return` step is not allowed in the children (section 3.2).

### 2.3 Scope and visibility

Registers are **lexical**, and every step list is a scope. The registers visible at a step are those defined by an *enabled* `register` step that is an **earlier sibling of the step, or an earlier sibling of one of its ancestors**: earlier, in a list on the path from the root to the step. So a register defined in a list is visible to the later steps of that list and to everything nested in them, and to nothing else. (The `test` of an `if` belongs to the `if` step: it sees what the `if` sees.)

| a register defined… | is visible to |
|---|---|
| in a list `L`, at index `i` | the steps of `L` after `i`, and everything nested in those steps (the children of containers, branches of `if`s, the `test` of an `if`) |
| in the `steps` of a `fork` | the later steps of that child list only. Each **piece** runs the child list afresh, so the register is bound afresh for every piece; no value survives to the next piece or to the steps after the `fork` |
| in the `steps` of a `subsection` | the same, per match |
| in the `steps` of a `repeat` | the same, per iteration. A reference *from* an iteration to a register defined *before* the `repeat` sees the value computed once, before the loop |
| in the `then` or `else` of an `if` | the later steps of that branch only; not the other branch, not the steps after the `if` |
| in the `steps` of another `register` | the later steps of that list only, not the outer list |
| inside the children of the register being defined | **no**: a register is bound after its children finish, so a reference inside its own children is `unknown-register` (reason `not-yet-defined`) |

**Use before definition** is `unknown-register`: a reference whose name is not visible is an error, with a `reason` that tells the author why.

**Shadowing.** A name that is visible at the point of a `register` step cannot be bound again: `duplicate-register`, at `/…/name`, with `detail.first` the path of the visible definition. This is FL's own rule (a `:>` name equal to a visible local is `E_REDEFINED`, LANGUAGE §7.1), and the compiled text would not load otherwise (run). Two registers of the same name in sibling scopes are fine: the two branches of an `if`, two child lists of different containers, two pieces. The recipe author sees one rule: *a name means one value at a time*.

**Disabled steps.** A disabled step compiles to comment lines (§5.4), so a disabled `register` defines nothing in the FL text. The validator checks each step in the view that matches its own state:

- an **enabled** step sees only definitions made by enabled steps; a reference to a name that only a disabled step defines is `unknown-register` with `reason: "disabled"`;
- a **disabled** step (or a step inside a disabled container) sees definitions made by any step, enabled or not, so that disabling both the register and its user does not make the recipe invalid (§3.2: "a disabled step still has to be valid");
- `duplicate-register` is checked among **enabled** definitions only, so that "disable the old attempt, add a new one with the same name" works; enabling the old one then shows the error.

### 2.4 References

**JSON form.** A reference is the object `{ "ref": "<name>" }`, with exactly one key. It is a new member of `ParamValue` (§3.4) and is distinguishable from `{ value, enc }` by shape. `ref` MUST match the name pattern above. A malformed reference is `type` (`ref` is not a string), `bad-value` (pattern) or `unknown-field` (another key), at the path of the offending member (`/steps/3/params/key/ref`, `/steps/3/params/key/x`). Chosen over a string prefix (`"$iv"`) because every string is already a valid `str` or `regex` parameter value, so a prefix would need escaping and would change what an existing string means.

**Where it may appear.** In the `params` of an `op` step and of an `op` test of an `if`, for **any parameter type** of `UI_PARAM_TYPES` (`bytes str int num number bool choice toggle regex charset key`). A reference fills a *required* parameter (no `missing-param`). It MUST NOT appear anywhere else: not in `fork.split`/`join`, `subsection.pattern`, the regex test of an `if`, `repeat.times` or `max`. In `split` and `join` a reference is `bad-value` with `constraint: "register references go in op parameters"`; elsewhere the existing type rules already reject an object. This keeps the structure of a recipe (what is split, matched, counted) visible without running it (question Q6).

**Normal form.** A reference is already normal: `{ "ref": "iv" }`, nothing omitted, nothing added. `normalise` copies it; `resolve` treats a parameter given as a reference as *given* (it does not materialise the default, and it does not apply the by-type normalisation of §3.6 step 2); key order is `ref` alone.

**Text form.** The literal group `$iv` (section 4.7).

### 2.5 What the register must hold: coercion

The value a reference supplies goes through the **word-entry sequence of LANGUAGE §10.5** exactly as a literal does: the coercion of LANGUAGE §4.2, then the validation of §4.3 (type, constraint, options, regex compile). The recipe layer adds no conversion of its own. For the parameter types of the catalogue:

| parameter type | runtime tag (LANGUAGE §5.6) | a register of tag … is accepted | otherwise |
|---|---|---|---|
| `bytes`, `toggle`, `key` | `bytes` | `bytes`; `str` (UTF-8 encoded) | `E_COERCE` (a lone surrogate), `E_TYPE` (any other tag); the byte-length constraint is `E_PARAM_INVALID` |
| `str`, `charset`, `regex`, `choice` | `str` | `str`; `bytes` (strict UTF-8 decoding) | `E_COERCE` (not UTF-8), `E_TYPE`; length, `charset` shape, regex compile and option membership are `E_PARAM_INVALID` |
| `int` | `int` | `int`; `num` that is integral | `E_COERCE` (not integral), `E_TYPE`; the range is `E_PARAM_INVALID` |
| `num` | `num` | `num`; `int` that fits | `E_COERCE`, `E_TYPE`; the range is `E_PARAM_INVALID` |
| `number` | `int` or `num` | either | `E_TYPE` |
| `bool` | `bool` | `bool` | `E_TYPE` |

The `{ value, enc }` of a `toggle` or `key` is **not** involved: the encoding (`hex`, `base64`, …) is how a *literal* is typed. A register holds bytes already decoded, so `{ "ref": "key" }` for a `key` parameter means "these bytes". If the data holds the key as hex text, the register's children decode it (`hex:decode` as the last child).

**Deferred validation.** The validator cannot see run-time values, so for a reference it checks only the reference itself (shape, name, scope) and *skips* everything §3.4 checks statically for that parameter: the constraint, the option list, `bad-regex`, the hex digits of a `bytes` value. These are checked in the Worker at word entry, and a failure is an ordinary `BakeError`:

| failure | `error.code` | `error.word` | `error.detail` | `error.path` |
|---|---|---|---|---|
| constraint, option, regex does not compile | `E_PARAM_INVALID` | the op | `param`, `constraint`, `value` (rendered; **redacted** for a `key` slot, LANGUAGE §10.14) | the op step (§5.7: the first frame of the recipe word is the instruction that called the op) **(run)** |
| wrong tag | `E_TYPE` | the op | `expected`, `actual`, `param` | the op step |
| not UTF-8, not integral | `E_COERCE` | the op | as LANGUAGE §11 | the op step |
| op-specific check (`the AES key must be 16, 24 or 32 bytes`) | `E_RANGE` | the op or one of its helpers | the op's own detail | the op step |

To help the user find the cause, the baker adds `detail.register` (the name) to the `BakeError` when `detail.param` names a parameter that the attributed step supplies by reference. That is the only new field (section 4.10).

### 2.6 Which compiled form (alternatives considered)

The value must be available to a later word in the same compiled `main`. Three ways in FL:

| way | verdict |
|---|---|
| **per-run `VARIABLE`** | no. A variable is defined at the top level of a unit with one literal, and has a fixed tag `T` for `n!` (LANGUAGE §5.10); the compiled recipe is *one colon definition and nothing else* (§5.1), and a register holds any tag. |
| the **data stack** (leave the value on the stack under the data) | no. Every step is `( x -- y )` (§3.3, `recipe:section` and the others check depth); a value kept below the data would break the depth rule of every combinator and the `E_EFFECT` checks. |
| a **local** bound with `:>` (LANGUAGE §7.1) | **yes.** Locals are immutable, lexically scoped to the enclosing body or quotation, shared by reference into the quotations of containers, and a quotation that binds one runs on a fresh copy of its environment on every call (§7.1 "Closures"), which is exactly "bound afresh per piece, per match, per iteration". **(run)** |

### 2.7 Compilation to FL

**The internal word** (added to `packages/ops/vocab/recipe.fth`, §4.3; it is internal, like the others, and never in the catalogue):

```forth
: peek ( any body:quot -- any any )
  "Run body on a copy of the data; leave the data and push what body leaves." doc
  dup body call ;
```

`recipe:peek` runs the quotation on a copy and leaves the data and the result. The effect check at its exit (LANGUAGE §10.5, not run for this case) would make a body that leaves other than one value an `E_EFFECT`; the validator guarantees it cannot, because every step is `( x -- y )`. No `recipe:as-bytes`.

**A `register` step** compiles to an **open line** `[` (alone), the children, and a **close line** `] recipe:peek :> $name`:

```
  [
    0 16 false bytes-slice:take
  ] recipe:peek :> $iv
```

The open line carries the annotations (`@break`, `@note`) like every container; the name is on the close line because `:>` must follow the call. `StepLine` covers both lines. `:>` is valid in the body of `main` and inside the quotation of a container (LANGUAGE §7.1); it is not inside a `{ }` list literal, and the compiler never emits one.

**A reference** is the local `$name`, as the literal group of that parameter, in `ParamSpec` order, like any other literal (§5.2):

```
  $key $iv "CBC" "pkcs7" #[ ] aes:decrypt
```

**Why `$name`.** The compiled word is in the vocabulary `bake`, whose only word is `main`, but the bundle's words are visible and so are the `core` words: a local named `key` would shadow nothing today and could shadow a new `core` word tomorrow. A word name may start with a symbol including `$` (LANGUAGE §2.11), and no word of `core` or of the bundle starts with `$` (checked with grep over LANGUAGE.md and `packages/ops/vocab`). So every register local starts with `$`, which also makes it stand out in the text, and a register name needs no reserved-word list. **(run)**

**Recipe M** (section 2.1) compiles to (`StepLine` and instruction ranges in section 6, CR119):

```
\ forge-recipe 1
: main ( bytes -- any )
  [
    0 16 false bytes-slice:take
  ] recipe:peek :> $iv
  [
    16 32 false bytes-slice:take
  ] recipe:peek :> $key
  0 48 false bytes-slice:remove
  $key $iv "CBC" "pkcs7" #[ ] aes:decrypt
;
```

**Hashes and pins.** The hash of a word covers its own source and the hashes of its callees (LANGUAGE §12.4). No existing word changes, so no op hash and no catalogue `version` changes, and no `@pin=` changes: a pin is the hash of an *op* (§3.10), written on the op's line, also inside a register's children. The new word `recipe:peek` is a new entry in an internal vocabulary; the recipe unit `bake:main` has a new hash for a recipe that uses it, which nothing stores. `npm run snapshot` of `packages/ops` must show exactly one new word and no other change (done-when of WP 6.35).

### 2.8 Limits

| limit | value | where |
|---|---|---|
| `register` steps in the whole tree (enabled or not) | **64** (`RECIPE_LIMITS.maxRegisters`); the 65th is `limit` with `limit: "maxRegisters"`, and the walk stops as it does for `maxSteps` | validator |
| register name | 32 characters (`maxRegisterNameChars`, expressed by the name pattern) | validator, schema |
| steps, depth, JSON size | the existing 500, 8, 262 144 bytes; `register` and `return` count as steps, `register` as a container level | §3.8 |
| size of a bound value | **no new limit**: a value is bounded by `maxValueBytes` when created and counts towards `maxTotalBytes`, the cumulative allocation meter (LANGUAGE §10.8), so a register cannot hold more than a run may allocate; a register with no children aliases the data and allocates nothing | VM |
| return-stack frames | a `register` uses two while its children run (`recipe:peek` and the quotation); the depth limit of 8 container levels keeps this far from `maxReturnDepth` | VM |

---

## 3. Return

### 3.1 The step

```jsonc
{ "kind": "return", "disabled": false, "breakpoint": false, "note": "…" }
```

A leaf with no fields besides the common three. It ends the recipe: **the current data is the output**, whatever its tag, and no later step runs. In an `if`:

```json
{ "kind": "if", "test": { "kind": "op", "op": "magic:is-format", "params": { "format": "gzip" } },
  "then": [ { "kind": "op", "op": "gzip:decompress" }, { "kind": "return" } ] }
```

### 3.2 Scope: the whole recipe, from where FL can jump

**Recommendation: `return` ends the whole recipe, and is valid only at the top of the recipe and inside `if` branches, to any depth of `if`.**

| position of the `return` | valid | what it does |
|---|---|---|
| in the root `steps` | yes | ends the recipe (the steps after it are unreachable: warning `unreachable-step`) |
| in `then` or `else` of an `if`, itself in a valid position | yes | ends the **whole recipe**, not just the branch |
| in the children of a `fork` | **no**: `bad-position` | |
| in the children of a `subsection` | **no** | |
| in the children of a `repeat` | **no** | |
| in the children of a `register` | **no** | |

`detail` of `bad-position`: `kind: "return"`, `container` (the path of the nearest enclosing step that is not an `if`), `containerKind`.

**Why not a scoped return** ("end the current piece, match or iteration"). The container words run their children as quotations called by `mapi`, `times` and `recurse` (§4.3). In FL, `exit` is valid only in the word body or in a literal quotation that `if`, `when`, `unless`, `while` or `loop` lowers inline; in a quotation given to `fork`, `map`, `times`, `try`, `call` or a stored quotation it is `E_SYNTAX` (LANGUAGE §8, "`exit`"). The reason in FL is sound (a jump out of a combinator would be a non-local return through its frames). So inside a container the only ways to end the current child list early would be:

| alternative | why not |
|---|---|
| `try`/`fail` with a recovery handler | `try` restores the data stack from a snapshot taken at its start, so the current data is lost; the handler receives an error record, not the data; and every real error would have to be re-raised, changing frames and attribution |
| rewrite the steps after an `if` that contains a `return` into the other branch | duplicates code (a tail after two fall-through paths appears twice), and breaks the one-to-one step to line map and the text round trip |
| a flag in the data (box the value) | every op step would unbox; changes every step's compiled form |
| change FL (a quotation-level early exit word) | outside this wave (no change to `packages/lang`) |

If the owner later wants a scoped return inside containers, the clean way is a new FL word; the step kind and its JSON do not change, only the set of valid positions grows (question Q5).

**Return and registers.** A return after registers is fine: the locals die with the word. A return in the children of a register is rejected for the reason in the table, and because it has no meaning there (the children compute a value).

**Unreachable steps.** In a list, an enabled step after an enabled `return` of the same list is unreachable. The validator reports one warning `unreachable-step` at the first such step (`detail.after`: the path of the `return`). Comments and disabled steps do not count. It is a warning: the recipe still compiles and runs. (A branch that ends in a return does not make the steps after the `if` unreachable; the warning does not look through `if`.) Question Q9.

### 3.3 Why `exit` and not something else

`exit` leaves the current colon word at once, running the exit check of LANGUAGE §10.5: the data depth must be the word's base plus one output, then the output tag is checked (`any`). At a position where every step has left exactly one value, the depth is right. The compiled recipe is one colon word `( bytes -- any )` (§5.1), so leaving the word is leaving the recipe, and the one value left is the output. **(run)**

### 3.4 Compilation

A `return` step is one line:

```
    core:exit
```

written qualified (`core:exit`, "always means this one", LANGUAGE §8), with the usual annotations (`  \ @break @note="…"`). A disabled return is `\ ~ core:exit`.

For `exit` to be valid, every `if` on the path from the word body to the `return` MUST be compiled with **literal quotations and the core `if`**, which the compiler lowers to jumps (LANGUAGE §8, "Lowering"), instead of `recipe:branch`, which calls its quotations. So:

> An `if` step whose **enabled** subtree contains an enabled `return` (through `then`, `else` and nested `if`s) compiles to the *lowered form*; every other `if` compiles to `recipe:branch`, exactly as in v1.

The lowered form (the test is inline and consumes a copy of the data, which is what `recipe:branch` does with `dup test call`):

| step | lines |
|---|---|
| `if`, regex test, lowered | open: `recipe:as-bytes dup ⟨pattern⟩ ⟨flags⟩ ⟨encoding⟩ recipe:matches [⟨anns⟩`; the `then` children; `] [`; the `else` children; close: `] if` |
| `if`, op test, lowered | open: `recipe:as-bytes dup ⟨lits⟩ qname [⟨anns⟩`; then as above |

For example (CR120):

```
\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes dup "^a" "" "utf8" recipe:matches [
    "none" "upper" hex:encode
    core:exit
  ] [
  ] if
  text:reverse
;
```

The `else` part is always written, as in v1. The line count of an `if` does not depend on the form, so enabling or disabling a `return` changes the text of its `if` (open line and close line) but not the line numbers of any step. An `if` with no enabled return, in a recipe that has returns elsewhere, keeps `recipe:branch` (CR121). The step annotation `@pin=` on an op test's open line is the predicate's pin, as before.

### 3.5 The step map, breakpoints, progress

**The §5.5 rule must change.** §5.5 computes a step's instruction range from the line of each instruction, assuming that `positions[ip].line` is non-decreasing "since code is emitted in source order". With a lowered `if` that is false: the `jumpf` and the `jump` carry the line of the closing `] if`, but they are emitted before and between the branch code, so the branch instructions have *smaller* lines than the `jumpf` before them. Under the §5.5 rule the children of a lowered `if` get **empty** ranges (`[7, 7)` in CR120), so breakpoints, stepping and error attribution inside the branches would not work. **(run)**

The new rule, which does not assume monotonic lines:

> For each enabled step with lines `[startLine, endLine]`: `startIp` is the **smallest** `ip` whose `positions[ip].line` lies in `[startLine, endLine]`, and `endIp` is the **largest such `ip` plus one**.

For every v1 text the two rules give the same ranges (when lines are non-decreasing, the instructions of a step are contiguous and `endIp` is the first instruction whose line is greater than `endLine`). For a lowered `if`, every instruction emitted for the step, branch code, `jumpf` and `jump` included, has a line inside the step's lines, and instruction ranges of different steps still nest or are disjoint, so `attributeError` (deepest range containing the `ip`) and `events` keep their definitions. CR120 gives the numbers. The change is in `resolveStepIps` only (`packages/recipe/src/stepmap.ts`); no change in `packages/lang`.

**Breakpoints and pausing.** A `return` is a step like any other: `breakpoint: true` pauses before the `exit` instruction, with `data` the value about to become the output; `step()` after it ends the bake (there is no next step). A `register` step starts at its open line, so `step()` goes into its first child, and the pause `data` is the data entering the step.

**Steps still open at the end.** The hook sees the `ends` event of a step at its `endIp`. A `return` skips the rest of the code, so `exit` leaves steps open (the `return`, the `if`s that contain it). The baker already closes steps still open at a failure (§8.2, `steps`: "steps still open at the end are closed at the failure time"); the same rule applies at the end of a successful run. Steps that never started have no `StepReport` (§8.2: "for every step that started"). The final `progress` event after a return reports `done = total` of top-level steps (CR138).

---

## 4. Changes, per surface

Each item is a delta against the text or the code named. File names are those of the repository at c94969b.

### 4.1 `packages/recipe/src/types.ts`

```ts
export const STEP_KINDS = ["op", "fork", "subsection", "if", "repeat", "comment", "register", "return"] as const;

export interface RegisterRef { readonly ref: string }
export type ParamValue = number | string | boolean | Encoded | RegisterRef;   // ParamValues follows

export interface RegisterStep extends StepCommon {
  readonly kind: "register";
  readonly name: string;
  readonly steps: readonly Step[];
}
export interface ReturnStep extends StepCommon { readonly kind: "return" }
export type Step = OpStep | ForkStep | SubsectionStep | IfStep | RepeatStep | CommentStep
  | RegisterStep | ReturnStep;
```

`StepKind` widens through `STEP_KINDS`; `RECIPE_FORMAT_VERSION` stays `1`; `Recipe.forge` stays `1`. `RECIPE_ISSUE_CODES` gains `"unknown-register"`, `"duplicate-register"`, `"bad-position"`, `"unreachable-step"` (the last is a warning). `RECIPE_LIMITS` gains `maxRegisters: 64` and `maxRegisterNameChars: 32`. New pure exports (a new file `packages/recipe/src/registers.ts`): `isRegisterRef(v): v is RegisterRef`; `REGISTER_NAME_RE`; `recipeUsesV11(recipe): boolean`; `registerInfo(recipe, catalogue): RegisterInfo[]` with `RegisterInfo { name, path, secret }` (`path` of the defining step, `secret` per section 4.9); `registersInScope(recipe, stepPath): RegisterInfo[]` (outermost first). All are total on valid recipes and iterative.

Exhaustive switches over `Step["kind"]` that need two new cases (found by `grep '"subsection"'`): in `packages/recipe/src`: `normalise.ts` (`normaliseStep`, `mapSteps`), `validate.ts` (`validateStep`), `compile.ts` (`emitSteps`), `text.ts` (the parser builds steps), `share.ts` (`forEachOp`), `stepmap.ts` (`recipeNeedsHardKill`); in `packages/worker/src/core.ts` (the alias and path walk near line 113); in `apps/web/src`: `state/recipe-ops.ts` (`childLists`), `recipe/forge-recipe.ts`, `recipe/defaults.ts` (`BlockKind`, `BLOCK_KINDS`, `BLOCK_LABELS`, `defaultBlock`), `ops/fit.ts`.

### 4.2 The JSON Schema (`packages/recipe/src/recipe.schema.json`)

Extended in place (`$id` stays `urn:forge:schema:recipe:1`, `forge` stays `{ "const": 1 }`); every document that validated still validates. Additions to `$defs`:

```json
"ref": {
  "type": "object",
  "properties": { "ref": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" } },
  "required": ["ref"], "additionalProperties": false },
"paramValue": { "oneOf": [ { "type": "number" }, { "type": "string" }, { "type": "boolean" },
                           { "$ref": "#/$defs/encoded" }, { "$ref": "#/$defs/ref" } ] },
"registerStep": {
  "type": "object", "allOf": [ { "$ref": "#/$defs/common" } ],
  "properties": { "kind": { "const": "register" },
                  "name": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
                  "steps": { "$ref": "#/$defs/steps" },
                  "disabled": true, "breakpoint": true, "note": true },
  "required": ["kind", "name", "steps"], "additionalProperties": false },
"returnStep": {
  "type": "object", "allOf": [ { "$ref": "#/$defs/common" } ],
  "properties": { "kind": { "const": "return" }, "disabled": true, "breakpoint": true, "note": true },
  "required": ["kind"], "additionalProperties": false }
```

and `step.oneOf` gains `registerStep` and `returnStep`. The table of §3.9 gains, under **validator-only**: scope and existence of references, `duplicate-register`, `bad-position`, `unreachable-step`, the register count, and the rule that a reference is not valid in `fork.split`/`join`. A reference in `fork.split` or `join` is rejected by the schema (`encodedNonEmpty` and `encoded` stay closed); the validator reports it with the more specific `bad-value` (CR113). `schema.test.ts` keeps its "schema rejects ⇒ validator rejects" check and gains the new corpus files.

### 4.3 Validation issue codes (§3.7)

| code | severity | path | when | `detail` |
|---|---|---|---|---|
| `unknown-register` | error | the `ref` member, `/…/params/key/ref` | a reference whose name is not visible (section 2.3) | `register`, `reason` |
| `duplicate-register` | error | the `name` member of the second `register` | its name is visible at that point | `register`, `first` (path of the visible definition) |
| `bad-position` | error | the `return` step | not at the root and not through `if` branches only (section 3.2) | `kind`, `container`, `containerKind` |
| `unreachable-step` | warning | the first unreachable step | an enabled step follows an enabled `return` in the same list | `after` |

`reason` of `unknown-register` is one of: `not-defined` (no register of that name anywhere), `not-yet-defined` (an enabled definition exists later in the same or an enclosing list, or is the enclosing `register` step itself, which binds after its children), `out-of-scope` (defined in a closed scope that does not contain the reference), `disabled` (defined only by disabled steps). Algorithm for the validator: one iterative walk keeps a stack of per-list name tables (depth at most 8 levels, at most 64 names), so the cost is linear in the number of steps. Existing codes cover the rest: `required`, `type`, `unknown-field`, `bad-value` for fields and for the name pattern, `limit` for `maxRegisters`, `bad-kind` where it was. A reference where a parameter is required satisfies `missing-param`; no `bad-param` and no `bad-regex` is raised for a reference. `bad-version` is unchanged (the message stays "forge must be the integer 1"). Order of checks: structure first, then catalogue, as in §3.7; the scope pass runs after both and skips a step that already has an error, so a reference inside a step with an unknown op gives `unknown-op` only.

### 4.4 Normal forms (§3.6)

- Key order: `register`: `kind name steps`, then `disabled breakpoint note`; `return`: `kind`, then `disabled breakpoint note`; a reference: `ref`.
- Omitted as before: `disabled: false`, `breakpoint: false`, empty `note`. A `register` keeps `steps: []` (as `fork` does); `else: []` omission is unchanged.
- `resolve`: references are *given* values (section 2.4); aliases of ops inside a register's children are resolved; the other parameters of the same op are made explicit as today. `pinRecipe`/`pinOps` recurse into `register` children.
- `canonical` and its idempotence: unchanged in statement. Case CR118.

### 4.5 Limits (§3.8)

Two rows added (section 2.8). `SHARE_LIMITS` unchanged.

### 4.6 Compilation (§5)

Changes to §5.3 (one table row each): `register` (open `[` and close `] recipe:peek :> $name`), `return` (`core:exit`), `if` lowered (section 3.4), and literal groups (§5.2): a reference is `$name` in the position of its parameter. §5.5 (the new range rule, section 3.5). §5.1: "every word is written qualified, and core words such as `fork` unqualified" gains the sentence "and `core:exit` and the core `if` of the lowered form". §4.3: `recipe:peek` (section 2.7). `recipeNeedsHardKill` (stepmap.ts) recurses into `register` children; a `return` needs nothing. §12.2 and every existing golden are unchanged.

### 4.7 The canonical text form (§6)

Delta to the grammar of §6.2:

```ebnf
body        = comment
            | op-line , [ anns ]
            | return-line , [ anns ]
            | container-open , [ anns ]
            | register-open , [ anns ]
            | "] ["
            | "] " , closer
            | register-close ;
return-line     = "core:exit" ;
register-open   = "[" ;                                   (* the whole line *)
register-close  = "] recipe:peek :> " , local ;
local           = "$" , reg-name ;
reg-name        = lower , { lower | digit | "-" } ;        (* 1 to 32 characters *)
group           = FL-int | FL-float | FL-bool | FL-bytes | FL-string
                | FL-string , " " , helper | local ;       (* local: any parameter type *)
container-open  = "recipe:as-bytes" , [ " dup" ] , { " " , atom } , " [" ;
closer          = "fork" | "recipe:section" | "recipe:branch" | "recipe:repeat"
                | "recipe:settle" | "if" ;
```

`dup` after `recipe:as-bytes` is allowed only with the closer `if`, which requires it. The header stays `\ forge-recipe 1`. Delta to the parsing steps of §6.3 (step 3 classification gains three cases, and the atoms of a closer gain two):

1. A line whose tokens are exactly `[` is a **register open**; it pushes a frame whose children go to `steps`.
2. A line whose tokens are `]`, the qualified name `recipe:peek`, the keyword `:>` and one word token `$name` is a **register close**. `name` MUST match `^[a-z][a-z0-9-]{0,31}$` (else `bad-value`, `constraint: "pattern …"`, with `line` and `col`); the level and frame rules are those of any close line; the frame MUST be a register frame.
3. A line whose only token is the qualified name `core:exit` is a **return** step (before the op-line rule, which would otherwise report `unknown-op` for `core`). Any other token on the line is `bad-value`.
4. Closer `if`: the atoms MUST be `dup` followed by a regex test (`FL-string FL-string FL-string recipe:matches`; a `@pin=` annotation is allowed only with an op test, as for `recipe:branch`) or literal groups and one qualified name (an op test). Without the leading `dup`, or with `dup` and another closer, it is `bad-value` with `constraint: "block structure"`. It completes an `if` step exactly as `recipe:branch` does (one else line, `then` before it).
5. Op lines and op tests (step 6): a **`word` token** matching `$name` is accepted in the position of a parameter group of any type and becomes `{ "ref": name }`; any other `word` token is the existing `bad-value`. The check of the parameter's type is skipped for a reference, as in the validator.
6. After assembling, `validateRecipe` and `canonical` run as before, so scope errors (`unknown-register`, `duplicate-register`, `bad-position`) come out as for JSON. The parser is still explicit-stack, never recurses, never loads FL.

**Round trip** (§6.5) holds unchanged in statement: `parseRecipeText(compileRecipe(r, c).text, c)` returns `canonical(r, c)`. It is a statement about JSON to text to JSON: text that is parsed and recompiled may change form (a closer `if` on an `if` that has no return recompiles to `recipe:branch`), exactly as other non-canonical spellings do today. Cases CR125 to CR128.

### 4.8 The share URL (§7)

No change to the fragment format, `SHARE_FORMAT_VERSION` (1), `SHARE_LIMITS` or the order of §7.3. The recipe payload is `normalise(recipe)` and now contains registers and references; step 7 of §7.3 (`validateRecipe`, then the whitelist rebuild) handles them because the validator and `normalise` do. A reference adds about 14 bytes and a register step about 40, within the 262 144-byte cap. `encodeShare`'s pinning recurses into register children. A v1 reader decoding such a link gets `invalid-recipe` with the issues of section 1.2. Decoding stays data-only: nothing is loaded or run. Cases CR129, CR130.

### 4.9 Secrets (§3.4, §7.4, LANGUAGE §10.14)

**The link.** A register is *computed from the data*; the recipe holds the operations that compute it, not its value. A `key` parameter supplied by a reference has no literal in the recipe, so `encodeShare` adds **no** `secret-in-url` warning for it (the warning is for a literal `key` value present and different from its default, §7.4), and the automatic fragment sync of UI.md (which stops writing the fragment when there is such a warning) keeps the recipe linked. The key material is in the **input**, which §7.4 already says is never inspected and is in the clear in a link that includes it; the share dialog's existing warning covers it, and the dialog adds one sentence when `recipeUsesV11` is true and a reference feeds a `key` parameter: "a register takes its key from the input, so a link that includes the input includes the key" (UI.md §2.3, share dialog).

**Redaction.** Values created by ops are not marked secret; FL marks a `bytes` value as secret when it is **bound to a `key` slot** at word entry, and every diagnostic then shows `<redacted>` for that slot (LANGUAGE §10.14). A register's value is bound to a local, not a slot, so FL does not mark it. Rule for the debugger and reports: a register is **secret** iff at least one reference to it, in its scope, is the value of a parameter whose catalogue type is `key`. This is static, so `registerInfo` computes it without running. The baker shows a secret register as `{ kind: "other", tag: <the tag>, repr: "<redacted>" }`, the shape of §8.3 for a secret value, and never sends its bytes. In recipe M both `iv` and `key` are secret (the `iv` parameter of `aes:decrypt` is declared `key` too). The limit of this is the one LANGUAGE §10.14 states: redaction is a safety net for logs and UIs, not a secrecy boundary. The data pane and the paused `data` still show the whole blob, key bytes included, because they are the user's own input. There is no "reveal" toggle (question Q13).

**The error path.** An `E_PARAM_INVALID` on a `key` slot already shows `detail.value = <redacted>` (LANGUAGE §10.14, C166), and `E_RANGE` details contain lengths only **(run)**. The new `detail.register` holds a name, never a value.

### 4.10 The bake API and the debugger (§8)

- **§8.2 `bake`**: step 2 (`validateRecipe`) now accepts the new kinds; step 3 unchanged (`recipeNeedsHardKill` recurses into registers, section 4.6); step 4 compiles with the new forms; step 5 `resolveStepIps` uses the rule of section 3.5. `BakeError.detail` gains the optional `register` (section 2.5). `StepReport`s are produced for steps that started (unchanged text), and steps open at a `return` are closed at the end time (section 3.5).
- **§8.4 messages**: `protocol` stays `1`. The `paused` event gains one optional field:

  ```ts
  interface RegisterView { readonly name: string; readonly path: string; readonly value: OutputValue }
  // BakeEvent "paused": … , registers?: readonly RegisterView[]
  ```

  `registers` lists the registers visible at the step that is about to start (`registersInScope`, outermost first), with `path` the defining step and `value` rendered by `renderValue` (§8.3), or the redacted form for a secret register. The baker reads the values from `StepEvent.frames()`: the locals `$name` of the frame of `bake:main` and of the quotation frame that binds them **(run)**; `frames()` is built only at a pause, so a bake that never pauses pays nothing. A client that ignores the field loses nothing (CR137).
- **§8.8 debugging**: `step()` after a `register` start goes to its first child; a pause inside a register's children shows the registers defined before the register.
- **`BakeResult`** gains no field. The final values of registers are not reported (they live in closed scopes); question Q14.

### 4.11 The Magic engine (§8.9)

**It never generates these steps (recommended).** A candidate is a chain of one-step bakes of ops that run on their defaults (§8.9, "Operations tried"); there is no way to guess a slice offset or a key. `magic:magic` prints candidate recipes as text of one-step recipes. No change in `packages/worker/src/magic` or `apps/web/src/magic`; their tests keep passing because they construct `{ forge: 1, steps: [ op ] }` only. Question Q16.

### 4.12 The UI (`apps/web`)

All strings below are rendered as text (UI.md §4 rule 6). No new request, worker, inline style or script.

| surface | change |
|---|---|
| **Operations pane / add-step menu** | "Register" and "Return" join the block kinds (`BlockKind`, `BLOCK_LABELS`, `defaultBlock`): a new register is `{ kind: "register", name: <next free name: "value", "value-2", …>, steps: [] }`; a new return is `{ kind: "return" }`. "Return" is offered only where valid (root, `if` branches); a drop into any other list is refused with the `bad-position` text as the announcement (`state/dnd.ts` `accepts`, `recipe-ops.ts` `moveStep`/`insertStep` validity) |
| **Recipe pane (`forge-recipe`)** | a `register` renders as a container card titled "Register `name`" (name editable, validated by the same pattern; field-level issues from `/…/name`), with its children list captioned "computed from a copy of the data"; a `return` renders as a one-line card "Return: stop here and output"; a step after a return that draws `unreachable-step` shows the warning text. `childLists` returns `steps` for a register. The step card shows `duplicate-register` and `bad-position` through the existing step-level issue helper |
| **Parameter form (`forge-param-form`)** | each field gets a small "Value / Register" switch. In *Register* mode the field is a select of `registersInScope(recipe, stepPath)` (the names visible at that step; empty list: the switch is disabled with the hint "no register defined before this step"), the value written is `{ "ref": name }`, and the typed field is replaced by the select; a note says "checked when the recipe runs". `issuesForPath` maps `/…/params/<name>/ref` to the field like `/value` and `/enc`. A reset puts the default back. Secret registers are marked with the same "key" hint as key fields |
| **Debug panel (WP 6.40)** | while paused, a "Registers" list from `paused.registers` (name, defining step as a button that selects it, value in the existing hex/text view; `<redacted>` for a secret one). Empty list: nothing shown |
| **Share dialog** | the sentence of section 4.9 when it applies; the `recipeUsesV11` note of section 1.3 |
| **FL dialog (`forge-fl-dialog`)** | parses and shows the new text forms (it uses the recipe package) |
| **Type fit (`ops/fit.ts`)** | `register` is transparent (the data type after it is the data type before it); after a `return` in the root list there is no data type to show |
| **Format indication** | none. `forge` stays 1 |

### 4.13 The editor plugin (`forge-plugin`, read-only reference)

The repository was found at `darkcollective/forge-plugin` in this environment (CLAUDE.md says "next to this one"). Read in `src/main/java/com/forge/fl/diagnostics/FLDiagnostics.java` (`exits()`, `exitProblem`) and `docs/FL-STYLE.md`. Findings:

- **Nothing is needed for the JSON.** The plugin does not read recipe JSON; its only link to `packages/recipe` is a check that the package is built, for the vector runner (`FLForgeEnvironment`).
- **`core:exit` in compiled text.** The plugin's diagnostic accepts `exit` in the word body and in literal quotations of `if`, `when`, `unless`, `while`, `loop`, at any nesting, and reports `E_SYNTAX` elsewhere, but it compares `ref.getBareName()` with `"exit"` and resolves the target to a builtin. The compiled text of section 3.4 has `core:exit` (qualified) inside the literal quotations of `if`, which the diagnostic allows; whether a *qualified* reference reaches `exits()` was not checked. A user who pastes the compiled text into an `.fl` file should see no error: **to verify in the plugin before 6.41**.
- **`$name` words.** `$` is a `symbol` of `name-start` (LANGUAGE §2.11), so the plugin lexer MUST accept `$iv` as a word and `:> $iv` as a binding. Not checked.
- **`recipe:peek`** is a new word of an internal vocabulary: the plugin's navigation and completion list it if it indexes `packages/ops/vocab`. Its source follows FL-STYLE (header, doc string, one body line).
- Recipes are not edited in the plugin, so no formatter or inspection change is required.

### 4.14 Documents amended by the fold-in (WP 6.41)

RECIPES.md: §1.1 (decisions R25 to R30, below), §3.2 (two kinds), §3.4 (references), §3.6, §3.7, §3.8, §3.9, §4.3 (`recipe:peek`), §5.1 to §5.5, §6.2 to §6.5, §7.4, §8.2, §8.4, §8.8, §12 (the cases). PLAN.md §3.6 (step kinds) and the Phase 6 table. UI.md §2.3 (WP texts for the recipe pane, parameter form, debug panel, share dialog). This file becomes a historical note, like LANGUAGE-0.2.md.

Proposed new rows for the table of decisions in §1.1:

| # | Decision | Why |
|---|---|---|
| R25 | **Register is a container step whose children compute a value from a copy of the data**; any op chain can produce it. | One concept covers slices, decoded fields and predicate results; no new primitive; no regex needed for slicing. |
| R26 | A **reference is `{ "ref": name }`**, allowed in op and op-test parameters of any type, checked statically for scope and at run time by the word-entry checks. | No string escaping; constraints stay in one place (the op's header). |
| R27 | Registers are **lexical**, compile to **`$name` locals** bound by `:>`, and a visible name cannot be bound again. | FL's own scoping gives per-piece and per-iteration binding for free; `$` keeps names clear of every word. |
| R28 | **Return ends the whole recipe** and is valid only at the root and in `if` branches, compiled to `core:exit` in a lowered `if`. | It is where FL can jump; a scoped return needs an FL change. |
| R29 | `forge` stays 1; a v1 reader rejects the new kinds. | Goldens keep their meaning; the schema stays one file. |
| R30 | The step to ip map uses **line membership**, not monotonic lines. | Lowered `if` code is not in line order. |

---

## 5. Security

PLAN §5 applies unchanged: recipes from URLs are data, validated, then compiled to text that only the compiler writes, then run in a Worker under hard limits.

| concern | how it is met |
|---|---|
| **Untrusted JSON** | the new fields go through the iterative pre-walk and the same limits (§3.7); the scope pass is iterative with a stack bounded by `maxDepth` (8) and at most 64 names; names are matched against `^[a-z][a-z0-9-]{0,31}$` before any use and live in a `Map`/`Set`, never as object keys, so `__proto__` cannot occur; references are rebuilt from a whitelist by `normalise` (§7.3 step 7). |
| **Untrusted text** | the parser stays an explicit-stack line parser that never calls the FL compiler and never loads FL (R5). Register names and `$name` tokens are matched against the pattern before they are put into JSON. Only compiler output reaches `runtime.load`, and the compiler writes `$` plus a validated name. |
| **Resource limits** | at most 64 registers, 500 steps, depth 8; values are bounded by `maxValueBytes` and the cumulative `maxTotalBytes`; steps and time by `maxSteps`, `maxMillis` and the watchdog (§8.5, §8.6). A register cannot create a loop. A `return` only shortens a run. |
| **No new ambient capability** | no new primitive, no new op, no new `core` word. `recipe:peek` is internal and only calls its quotation; `core:exit` is an existing intrinsic. A reference is data: it selects a value that already exists in the run, not a word, an op or a vocabulary, so a recipe cannot name anything new through it. |
| **Data-chosen parameters** | a register can now supply a regex, a delimiter or a length that comes from the data. The checks that bound those (regex length and compile, constraints) run at word entry in the Worker (§2.5). A regex still needs a hard-kill baker through the op's `needsHardKill` (R11), which is computed from the ops of the recipe and does not depend on where the pattern came from. A recipe with `regex:replace` and a register-supplied pattern therefore needs the same hard kill as one with a literal pattern. |
| **Information flow** | a register can carry bytes from the data into a `key` slot, which FL then marks secret for diagnostics; a register that feeds `key` is shown redacted (section 4.9). Nothing leaves the Worker that did not already. |
| **CSP** | no new script, style attribute, worker, request or `href` (UI.md §4). Register names and values are rendered as text. |
| **Failure mode of old readers** | closed (section 1.2). |

---

## 6. Conformance cases

### 6.1 Format

Each case is a fenced block with the info string `recipe-proposed`. The first line is `# CRnnn title`. A block holds sections introduced by a line that starts with `@`; text after a section line, until the next one, is that section's body.

| section | meaning |
|---|---|
| `@catalogue` | always the shipped catalogue (`dist/catalogue.json` of `@forge/ops`). Ops used: `aes:decrypt`, `bytes-slice:take`, `bytes-slice:remove`, `classical:rot`, `hex:decode`, `hex:encode`, `regex:replace`, `regex:test`, `search:count`, `text:upper`, `text:lower`, `text:reverse`. Pins are absent unless a case shows one |
| `@recipe` | recipe JSON (wrapped for reading; compared as parsed JSON) |
| `@issues` | the issues of `validateRecipe` with pins `ignore`: one per line `severity code path key=value …`, or `none` |
| `@canonical` | the JSON of `canonical(recipe, catalogue)`, compared as `JSON.stringify` text |
| `@text` | the compiled text (`compileRecipe`, no `name`), without line numbers; `@lines` and `@ranges` follow with `StepLine` and `[startIp, endIp)` |
| `@parse` | the input of `parseRecipeText` |
| `@input`, `@output` | the input as `utf8 "…"` or `hex …`, the output as `str "…"` or `bytes hex …` (the text of a bytes output follows) |
| `@error` | `CODE path=… word=… detail.k=v …` of a failed bake |

Cases marked **(run)** have a hand-written FL text whose behaviour was checked as section 0.3 says; the others follow from the rules.

### 6.2 Validation

```recipe-proposed
# CR101 recipe M is valid
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "iv",
    "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 0, "length": 16 } } ] },
  { "kind": "register", "name": "key",
    "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 16, "length": 32 } } ] },
  { "kind": "op", "op": "bytes-slice:remove", "params": { "start": 0, "length": 48 } },
  { "kind": "op", "op": "aes:decrypt",
    "params": { "key": { "ref": "key" }, "iv": { "ref": "iv" }, "mode": "CBC" } } ] }
@issues
none
```

```recipe-proposed
# CR102 a register name has a pattern and is required
@recipe
{ "forge": 1, "steps": [ { "kind": "register", "name": "IV", "steps": [] },
                         { "kind": "register", "steps": [] } ] }
@issues
error bad-value /steps/0/name constraint="pattern ^[a-z][a-z0-9-]{0,31}$"
error required /steps/1/name field=name
```

```recipe-proposed
# CR103 closed objects: a register and a return take no other fields
@recipe
{ "forge": 1, "steps": [ { "kind": "register", "name": "a", "steps": [], "extra": 1 },
                         { "kind": "return", "steps": [] } ] }
@issues
error unknown-field /steps/0/extra field=extra
error unknown-field /steps/1/steps field=steps
```

```recipe-proposed
# CR104 a reference to a register that does not exist
@recipe
{ "forge": 1, "steps": [ { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "k" } } } ] }
@issues
error unknown-register /steps/0/params/key/ref register=k reason=not-defined
```

```recipe-proposed
# CR105 use before definition, and a reference inside the register's own children
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "k" } } },
  { "kind": "register", "name": "k", "steps": [
      { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "k" } } } ] } ] }
@issues
error unknown-register /steps/0/params/key/ref register=k reason=not-yet-defined
error unknown-register /steps/1/steps/0/params/key/ref register=k reason=not-yet-defined
```

```recipe-proposed
# CR106 a register defined in a closed scope is not visible after it
@recipe
{ "forge": 1, "steps": [
  { "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "0a", "enc": "hex" },
    "steps": [ { "kind": "register", "name": "k", "steps": [] },
               { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "k" } } } ] },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "k" } } } ] }
@issues
error unknown-register /steps/1/params/key/ref register=k reason=out-of-scope
```

```recipe-proposed
# CR107 a visible name cannot be bound again
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "a", "steps": [] },
  { "kind": "register", "name": "a", "steps": [] },
  { "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "", "enc": "utf8" },
    "steps": [ { "kind": "register", "name": "a", "steps": [] } ] } ] }
@issues
error duplicate-register /steps/1/name register=a first=/steps/0
error duplicate-register /steps/2/steps/0/name register=a first=/steps/0
```

```recipe-proposed
# CR108 sibling scopes may reuse a name
@recipe
{ "forge": 1, "steps": [
  { "kind": "if", "test": { "kind": "regex", "pattern": "x" },
    "then": [ { "kind": "register", "name": "a", "steps": [] } ],
    "else": [ { "kind": "register", "name": "a", "steps": [] } ] },
  { "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "0a", "enc": "hex" },
    "steps": [ { "kind": "register", "name": "a", "steps": [] } ] } ] }
@issues
none
```

```recipe-proposed
# CR109 a disabled definition: an enabled user is an error, a disabled user is not
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "a", "disabled": true, "steps": [] },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "a" } } },
  { "kind": "op", "op": "aes:decrypt", "disabled": true, "params": { "key": { "ref": "a" } } } ] }
@issues
error unknown-register /steps/1/params/key/ref register=a reason=disabled
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "a", "disabled": true, "steps": [] },
  { "kind": "register", "name": "a", "steps": [] } ] }
@issues
none
```

The enabled step at index 1 sees only definitions made by enabled steps, and the one at index 0 is disabled, so it gets `disabled` as the reason. The disabled step at index 2 sees all definitions and is fine. In the second recipe the enabled `a` is not a duplicate, because duplicates are checked among enabled definitions only.

```recipe-proposed
# CR110 return is not valid in a container other than an if
@recipe
{ "forge": 1, "steps": [
  { "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "0a", "enc": "hex" },
    "steps": [ { "kind": "return" } ] },
  { "kind": "subsection", "pattern": "a", "steps": [
      { "kind": "if", "test": { "kind": "regex", "pattern": "x" }, "then": [ { "kind": "return" } ] } ] },
  { "kind": "repeat", "times": 2, "steps": [ { "kind": "return" } ] },
  { "kind": "register", "name": "a", "steps": [ { "kind": "return" } ] } ] }
@issues
error bad-position /steps/0/steps/0 kind=return container=/steps/0 containerKind=fork
error bad-position /steps/1/steps/0/then/0 kind=return container=/steps/1 containerKind=subsection
error bad-position /steps/2/steps/0 kind=return container=/steps/2 containerKind=repeat
error bad-position /steps/3/steps/0 kind=return container=/steps/3 containerKind=register
```

```recipe-proposed
# CR111 return is valid at the root and through if branches to any depth
@recipe
{ "forge": 1, "steps": [
  { "kind": "if", "test": { "kind": "regex", "pattern": "a" },
    "then": [ { "kind": "if", "test": { "kind": "regex", "pattern": "b" },
                "then": [ { "kind": "return" } ],
                "else": [ { "kind": "op", "op": "text:upper" } ] } ],
    "else": [ { "kind": "return" } ] },
  { "kind": "return" } ] }
@issues
none
```

```recipe-proposed
# CR112 unreachable steps are a warning; a branch that ends in a return does not make the rest unreachable
@recipe
{ "forge": 1, "steps": [
  { "kind": "if", "test": { "kind": "regex", "pattern": "a" }, "then": [ { "kind": "return" } ] },
  { "kind": "op", "op": "text:upper" },
  { "kind": "return" },
  { "kind": "comment", "text": "after" },
  { "kind": "op", "op": "text:lower", "disabled": true },
  { "kind": "op", "op": "text:reverse" } ] }
@issues
warning unreachable-step /steps/5 after=/steps/2
```

```recipe-proposed
# CR113 a reference is not a value of a fork separator
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "sep", "steps": [] },
  { "kind": "fork", "split": { "ref": "sep" }, "join": { "value": "", "enc": "utf8" }, "steps": [] } ] }
@issues
error bad-value /steps/1/split constraint="register references go in op parameters"
```

```recipe-proposed
# CR114 malformed references
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "a", "steps": [] },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": 5 }, "iv": { "ref": "A" } } },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "a", "x": 1 } } } ] }
@issues
error type /steps/1/params/key/ref expected="a string"
error bad-value /steps/1/params/iv/ref constraint="pattern ^[a-z][a-z0-9-]{0,31}$"
error unknown-field /steps/2/params/key/x field=x
```

```recipe-proposed
# CR115 a reference fills a required parameter, and its constraint is not checked statically
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "n", "steps": [ { "kind": "op", "op": "search:count", "params": { "pattern": "a" } } ] },
  { "kind": "op", "op": "classical:rot", "params": { "amount": { "ref": "n" } } },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "n" } } } ] }
@issues
none
```

`classical:rot` takes an `int[0..25]`: a literal 26 is `bad-param` (§12.4), a reference to any register is accepted and checked at run time (CR133). `aes:decrypt` has a required `key`, so no `missing-param`.

```recipe-proposed
# CR116 the register limit
@recipe
(65 root steps; step i is { "kind": "register", "name": "r<i+1>", "steps": [] }, so r1 to r65)
@issues
error limit /steps/64 limit=maxRegisters max=64
```

```recipe-proposed
# CR117 a reference in an op test of an if sees the registers visible at the if
@recipe
{ "forge": 1, "steps": [
  { "kind": "if", "test": { "kind": "op", "op": "regex:test", "params": { "pattern": { "ref": "p" } } }, "then": [] },
  { "kind": "register", "name": "p", "steps": [] },
  { "kind": "if", "test": { "kind": "op", "op": "regex:test", "params": { "pattern": { "ref": "p" } } }, "then": [] } ] }
@issues
error unknown-register /steps/0/test/params/pattern/ref register=p reason=not-yet-defined
```

### 6.3 Normal forms

```recipe-proposed
# CR118 normalise and canonical with registers, references and return
@recipe
{ "steps": [
  { "disabled": false, "kind": "register", "note": "", "name": "p",
    "steps": [ { "params": { "length": 2, "start": 0 }, "op": "bytes-slice:take", "kind": "op" } ] },
  { "kind": "if", "test": { "pattern": "x", "kind": "regex" },
    "then": [ { "kind": "return", "breakpoint": false, "disabled": false } ] },
  { "op": "regex:replace", "kind": "op", "params": { "replacement": "-", "pattern": { "ref": "p" } } } ],
  "forge": 1 }
@canonical
{"forge":1,"steps":[{"kind":"register","name":"p","steps":[{"kind":"op","op":"bytes-slice:take","params":{"start":0,"length":2,"each-line":false}}]},{"kind":"if","test":{"kind":"regex","pattern":"x"},"then":[{"kind":"return"}]},{"kind":"op","op":"regex:replace","params":{"pattern":{"ref":"p"},"replacement":"-","flags":""}}]}
```

`normalise` alone gives the same without `each-line` and `flags`, with `params` keys sorted (`length`, `start`; `pattern`, `replacement`). The reference is untouched in both forms.

### 6.4 JSON to FL

```recipe-proposed
# CR119 recipe M compiles to registers and locals (run)
@recipe
(recipe M, CR101)
@text
\ forge-recipe 1
: main ( bytes -- any )
  [
    0 16 false bytes-slice:take
  ] recipe:peek :> $iv
  [
    16 32 false bytes-slice:take
  ] recipe:peek :> $key
  0 48 false bytes-slice:remove
  $key $iv "CBC" "pkcs7" #[ ] aes:decrypt
;
@lines
/steps/0 3-5 register
/steps/0/steps/0 4-4 op
/steps/1 6-8 register
/steps/1/steps/0 7-7 op
/steps/2 9-9 op
/steps/3 10-10 op
@ranges
/steps/0 [0, 8)
/steps/0/steps/0 [1, 5)
/steps/1 [8, 16)
/steps/1/steps/0 [9, 13)
/steps/2 [16, 20)
/steps/3 [20, 26)
```

The loaded word has 27 instructions (`ret` at 26). `$key` and `$iv` are `local` instructions, `:> ` is a `bind` on the close line of its register.

```recipe-proposed
# CR120 an if that contains a return is compiled with the core if, and the step map uses line membership (run)
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "hex:decode" },
  { "kind": "if", "test": { "kind": "regex", "pattern": "^a" },
    "then": [ { "kind": "op", "op": "hex:encode", "params": { "delimiter": "none", "case": "upper" } },
              { "kind": "return" } ] },
  { "kind": "op", "op": "text:reverse" } ] }
@text
\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes dup "^a" "" "utf8" recipe:matches [
    "none" "upper" hex:encode
    core:exit
  ] [
  ] if
  text:reverse
;
@lines
/steps/0 3-3 op
/steps/1 4-8 if
/steps/1/then/0 5-5 op
/steps/1/then/1 6-6 return
/steps/2 9-9 op
@ranges
/steps/0 [0, 1)
/steps/1 [1, 13)
/steps/1/then/0 [8, 11)
/steps/1/then/1 [11, 12)
/steps/2 [13, 14)
```

The loaded word has 15 instructions (`ret` at 14): `0 call hex:decode`, `1 call recipe:as-bytes`, `2 stack dup`, `3 to 5` the three literals, `6 call recipe:matches`, `7 jumpf` (line 8), `8 to 10` the literals and `hex:encode`, `11 exit` (line 6), `12 jump` (line 8), `13 call text:reverse`, `14 ret`. The rule of §5.5 would give both children the range `[7, 7)`. `events`: `0: - | /steps/0`; `1: /steps/0 | /steps/1`; `8: - | /steps/1/then/0`; `11: /steps/1/then/0 | /steps/1/then/1`; `12: /steps/1/then/1 | -`; `13: /steps/1 | /steps/2`; `14: /steps/2 | -`. `breakpoints` for a `breakpoint: true` on the return: `[ { "word": "bake:main", "ip": 11 } ]`.

```recipe-proposed
# CR121 nested ifs with a return are all lowered; an unrelated if keeps recipe:branch (run, bakes in CR135)
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "hex:decode" },
  { "kind": "if", "test": { "kind": "regex", "pattern": "^a" },
    "then": [ { "kind": "if", "test": { "kind": "regex", "pattern": "b$" },
                "then": [ { "kind": "op", "op": "hex:encode", "params": { "delimiter": "none", "case": "upper" } },
                          { "kind": "return" } ] },
              { "kind": "op", "op": "text:upper" } ] },
  { "kind": "if", "test": { "kind": "regex", "pattern": "z" }, "then": [ { "kind": "op", "op": "text:lower" } ] },
  { "kind": "op", "op": "hex:encode" } ] }
@text
\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes dup "^a" "" "utf8" recipe:matches [
    recipe:as-bytes dup "b$" "" "utf8" recipe:matches [
      "none" "upper" hex:encode
      core:exit
    ] [
    ] if
    text:upper
  ] [
  ] if
  recipe:as-bytes [ "z" "" "utf8" recipe:matches ] [
    text:lower
  ] [
  ] recipe:branch
  "none" "lower" hex:encode
;
```

```recipe-proposed
# CR122 a disabled return: the if is compiled as in v1, the line numbers do not move (run)
@recipe
(the recipe of CR120 with "disabled": true on the return)
@text
\ forge-recipe 1
: main ( bytes -- any )
  hex:decode
  recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [
    "none" "upper" hex:encode
    \ ~ core:exit
  ] [
  ] recipe:branch
  text:reverse
;
@lines
/steps/1 4-8 if
/steps/1/then/1 6-6 return
```

```recipe-proposed
# CR123 a register inside a fork child, and a reference to a regex parameter (run, bakes in CR134)
@recipe
{ "forge": 1, "steps": [
  { "kind": "fork", "split": { "value": "\n", "enc": "utf8" }, "join": { "value": "0a", "enc": "hex" },
    "steps": [
      { "kind": "register", "name": "pat",
        "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 0, "length": 2 } } ] },
      { "kind": "op", "op": "bytes-slice:remove", "params": { "start": 0, "length": 3 } },
      { "kind": "op", "op": "regex:replace", "params": { "pattern": { "ref": "pat" }, "replacement": "-" } } ] } ] }
@text
\ forge-recipe 1
: main ( bytes -- any )
  recipe:as-bytes "\n" #[ 0a ] [
    [
      0 2 false bytes-slice:take
    ] recipe:peek :> $pat
    0 3 false bytes-slice:remove
    $pat "-" "" regex:replace
  ] fork
;
```

```recipe-proposed
# CR124 compatibility: a recipe without the new kinds compiles to the text it has today
@recipe
(the recipe of RECIPES.md section 12.2, "Demo")
@text
(exactly the 21 lines of RECIPES.md section 12.2, byte for byte; the ranges of section 12.2 are unchanged
 by the line-membership rule)
```

### 6.5 Text and JSON

```recipe-proposed
# CR125 the text of CR119 parses to the canonical JSON of recipe M, and back
@parse
(the @text of CR119)
@canonical
{"forge":1,"steps":[{"kind":"register","name":"iv","steps":[{"kind":"op","op":"bytes-slice:take","params":{"start":0,"length":16,"each-line":false}}]},{"kind":"register","name":"key","steps":[{"kind":"op","op":"bytes-slice:take","params":{"start":16,"length":32,"each-line":false}}]},{"kind":"op","op":"bytes-slice:remove","params":{"start":0,"length":48,"each-line":false}},{"kind":"op","op":"aes:decrypt","params":{"key":{"ref":"key"},"iv":{"ref":"iv"},"mode":"CBC","padding":"pkcs7","aad":{"value":"","enc":"hex"}}}]}
```

`compileRecipe` of that JSON returns the text of CR119 again.

```recipe-proposed
# CR126 the text of CR120 parses to the canonical JSON of its recipe, and back
@parse
(the @text of CR120)
@canonical
{"forge":1,"steps":[{"kind":"op","op":"hex:decode"},{"kind":"if","test":{"kind":"regex","pattern":"^a"},"then":[{"kind":"op","op":"hex:encode","params":{"delimiter":"none","case":"upper"}},{"kind":"return"}]},{"kind":"op","op":"text:reverse"}]}
```

```recipe-proposed
# CR127 structure errors of the new lines
@parse
\ forge-recipe 1
: main ( bytes -- any )
  recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [
    text:upper
  ] [
  ] if
;
@issues
bad-value /steps/0 constraint="block structure" line=6
@parse
\ forge-recipe 1
: main ( bytes -- any )
  [
    text:upper
  ] recipe:peek :> $IV
;
@issues
bad-value /steps/0/name constraint="pattern ^[a-z][a-z0-9-]{0,31}$" line=5
@parse
\ forge-recipe 1
: main ( bytes -- any )
  [
    text:upper
;
@issues
bad-value /steps/0 constraint="block structure"
@parse
\ forge-recipe 1
: main ( bytes -- any )
  1 core:exit
;
@issues
bad-value /steps/0 line=3
```

The first text has the closer `if` without `dup`; the second a name outside the pattern; the third an unterminated register; the fourth an atom before `core:exit`.

```recipe-proposed
# CR128 a reference to an int parameter, and the lines of an op with several (round trip)
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "n", "steps": [ { "kind": "op", "op": "search:count", "params": { "pattern": "a" } } ] },
  { "kind": "op", "op": "classical:rot", "params": { "amount": { "ref": "n" } } } ] }
@text
\ forge-recipe 1
: main ( bytes -- any )
  [
    "a" "string" false search:count
  ] recipe:peek :> $n
  $n classical:rot
;
```

`parseRecipeText` of this text returns `canonical(recipe)`: the `$n` group is accepted for the `int` parameter `amount` and becomes `{ "ref": "n" }`.

### 6.6 Share

```recipe-proposed
# CR129 a link round trip of recipe M, with and without a catalogue
@recipe
(recipe M, CR101; the input is the 64 bytes of CR131 with ie hex)
@issues
(encodeShare: ok, fragment starts "v=1&r=", warnings none; decodeShare: the recipe deep-equals normalise(recipe),
 the input and ie hex come back; with a catalogue the op steps carry pins and the references are untouched)
```

```recipe-proposed
# CR130 a literal key still warns, a reference does not
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "aes:decrypt",
    "params": { "key": { "value": "000102030405060708090a0b0c0d0e0f", "enc": "hex" } } } ] }
@issues
(encodeShare warnings) warning secret-in-url /steps/0/params/key param=key
@recipe
{ "forge": 1, "steps": [ { "kind": "register", "name": "k", "steps": [] },
  { "kind": "op", "op": "aes:decrypt", "params": { "key": { "ref": "k" } } } ] }
@issues
(encodeShare warnings) none
```

### 6.7 Bake

The input of CR131 is the blob `iv ++ key ++ ciphertext`, built with `aes:encrypt` (AES-256-CBC, PKCS#7) from the plaintext `attack at dawn`:

```
iv  = a0a1a2a3a4a5a6a7a8a9aaabacadaeaf
key = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
ct  = 6f498b8b870a0d8175f26312b99705c8
```

```recipe-proposed
# CR131 recipe M decrypts the blob (run)
@recipe
(recipe M, CR101)
@input
hex a0a1a2a3a4a5a6a7a8a9aaabacadaeaf000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f6f498b8b870a0d8175f26312b99705c8
@output
bytes 61747461636b206174206461776e
(text "attack at dawn")
```

```recipe-proposed
# CR132 a register that supplies an int parameter (run)
@recipe
(the recipe of CR128)
@input
utf8 "banana"
@output
bytes 656471647164
(text "edqdqd": three letters a, so rot 3)
```

```recipe-proposed
# CR133 deferred validation: the same recipe, three failures (run)
@recipe
(the recipe of CR128)
@input
utf8 "aaaaaaaaaaaaaaaaaaaaaaaaaa"
@error
E_PARAM_INVALID path=/steps/1 word=classical:rot detail.param=amount detail.constraint=[0..25] detail.value=26 detail.register=n
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "n",
    "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 0, "length": 1 } } ] },
  { "kind": "op", "op": "classical:rot", "params": { "amount": { "ref": "n" } } } ] }
@input
utf8 "banana"
@error
E_TYPE path=/steps/1 word=classical:rot detail.param=amount detail.expected=int detail.actual=bytes detail.register=n
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "p",
    "steps": [ { "kind": "op", "op": "bytes-slice:take", "params": { "start": 0, "length": 1 } } ] },
  { "kind": "op", "op": "bytes-slice:remove", "params": { "start": 0, "length": 2 } },
  { "kind": "op", "op": "regex:replace", "params": { "pattern": { "ref": "p" }, "replacement": "-" } } ] }
@input
utf8 "(:xxabxx"
@error
E_PARAM_INVALID path=/steps/2 word=regex:replace detail.param=pattern detail.constraint=regex detail.register=p
```

The step paths come from the recipe frame of `ForgeError.frames` as in §5.7 (the frame of `bake:main` is the first, `bake:main@9` in the first run). The `detail` keys other than `register` are what the FL runtime reports **(run)**; `register` is added by the baker.

```recipe-proposed
# CR134 a register per fork piece, as a regex parameter (run)
@recipe
(the recipe of CR123)
@input
utf8 "ab:xxabxx\ncd:yycdyy"
@output
bytes 78782d78780a79792d7979
(text "xx-xx\nyy-yy": each piece takes its own two-character pattern)
```

```recipe-proposed
# CR135 return taken, not taken, and from a nested if (run)
@recipe
(the recipe of CR120)
@input
utf8 "6162"
@output
str "6162"
@input
utf8 "6362"
@output
str "bc"
@recipe
(the recipe of CR121)
@input
utf8 "6162"
@output
str "6162"
@input
utf8 "6161"
@output
str "4141"
@input
utf8 "6263"
@output
str "6263"
```

The first input of the CR120 recipe decodes to `ab`, matches `^a`, and is returned as upper-case hex without reaching `text:reverse`; the second decodes to `cb`, does not match, and goes on to `text:reverse` (`bc`). For CR121: `ab` matches `^a` and `b$`, so it returns at once; `aa` matches `^a` only, so `text:upper` runs, then the last `hex:encode`; `bc` matches neither.

```recipe-proposed
# CR136 return at the root skips what follows, and keeps the tag of the data (run)
@recipe
{ "forge": 1, "steps": [ { "kind": "op", "op": "hex:decode" }, { "kind": "return" }, { "kind": "op", "op": "text:upper" } ] }
@input
utf8 "6162"
@output
bytes 6162
(text "ab")
@issues
warning unreachable-step /steps/2 after=/steps/1
```

```recipe-proposed
# CR137 registers at a pause (specified; the redaction rule of section 4.9)
@recipe
(recipe M, CR101, with "breakpoint": true on /steps/3, bake with debug: {})
@input
(the blob of CR131)
@paused
path=/steps/3 reason=breakpoint registers=[
  { name: "iv",  path: "/steps/0", value: { kind: "other", tag: "bytes", repr: "<redacted>" } },
  { name: "key", path: "/steps/1", value: { kind: "other", tag: "bytes", repr: "<redacted>" } } ]
@recipe
(the recipe of CR123, "breakpoint": true on /steps/0/steps/1, debug: {})
@input
utf8 "ab:xxabxx\ncd:yycdyy"
@paused
path=/steps/0/steps/1 reason=breakpoint registers=[
  { name: "pat", path: "/steps/0/steps/0", value: { kind: "bytes", text: "ab" } } ]
(and again before the second piece, with pat = "cd")
```

Both registers of recipe M are secret because `iv` and `key` of `aes:decrypt` are declared `key`. `pat` feeds a `regex` parameter, so it is shown. The pause of the second recipe repeats for each piece.

```recipe-proposed
# CR138 steps that never started have no report, and progress ends complete (specified)
@recipe
(the recipe of CR120)
@input
utf8 "6162"
@output
str "6162"
@steps
/steps/0 runs=1; /steps/1 runs=1; /steps/1/then/0 runs=1; /steps/1/then/1 runs=1
(no entry for /steps/2)
@progress
final: done=3 total=3
```

---

## 7. Work packages

Numbers continue PLAN.md's Phase 6 table after 6.34 (this proposal). Each package is briefed from this document, owns the files listed and no others, writes tests that cite its CR numbers, and obeys CLAUDE.md (licence header on new source files, no attribution trailers, no push). "Model" is the suggestion of PLAN §8 for the orchestrator.

| WP | Scope | Files owned | Depends on | Done when | Model |
|---|---|---|---|---|---|
| **6.35** | The internal word `recipe:peek` (section 2.7) in the `recipe` vocabulary, with a unit test over the shipped bundle that checks the three FL facts this proposal relies on (a `$name` local, nested lowered `if` with `core:exit`, a register bound inside a quotation is not visible after it). | `packages/ops/vocab/recipe.fth`, `packages/ops/src/recipe.test.ts` | none | `npm run snapshot -w @forge/ops` shows one new word and no changed hash; the catalogue `version` is unchanged; CR119 (first part), CR120, CR121, CR123 texts load and CR131, CR132, CR134, CR135, CR136 bake to the stated outputs on a runtime with the word | Haiku |
| **6.36** | The recipe model: types, limits, schema, validator (structure, catalogue skip for references, the scope pass), `normalise`/`resolve`/`pin`, the `registers.ts` module (`registerInfo`, `registersInScope`, `recipeUsesV11`), `recipeNeedsHardKill`, the share walk, corpus files for every case. | `packages/recipe/src/{types,limits,validate,normalise,share,registers,index}.ts`, `packages/recipe/src/recipe.schema.json`, `packages/recipe/test/corpus/**` (new files only), the matching `*.test.ts` | none (parallel with 6.35) | CR101 to CR118, CR129, CR130 pass; every file of `test/corpus` and `test/goldens` unchanged; the schema agrees with the validator on the new corpus; `npm run lint && npm run typecheck && npm test` | Sonnet |
| **6.37** | Compilation and the text form: literals (`$name`), `register` and `return` lines, the lowered `if`, the line-membership rule in `resolveStepIps`, the grammar delta and the parser cases. | `packages/recipe/src/{compile,literals,stepmap,text}.ts` and their tests | 6.35, 6.36 | CR119 to CR128 pass; the golden of §12.2 and every existing text test unchanged (CR124); `parseRecipeText(compileRecipe(r).text)` equals `canonical(r)` over the whole corpus including the new files | Sonnet |
| **6.38** | The baker: `bake` with the new kinds, `RegisterView` in `paused`, `detail.register`, redaction of secret registers, closing steps open at a return, the final progress, hard-kill recursion. | `packages/worker/src/{core,types,render,protocol}.ts` and their tests | 6.37 | CR131 to CR138 pass in-process; the Worker protocol test accepts the optional field and an old-shape `paused` message; Gate 2 (`npm run gate2:browser -w @forge/worker`) unchanged | Sonnet |
| **6.39** | The editing UI: block kinds, recipe pane cards, drag rules, the parameter form's Value/Register switch, issue mapping, type fit. | `apps/web/src/{recipe,params,state/recipe-ops.ts,state/dnd.ts,ops/fit.ts}` and their tests | 6.36 (parallel with 6.37 and 6.38) | unit tests for the pure helpers (`registersInScope` use, valid drop positions, name generation, issue mapping); axe clean; keyboard-only add, rename, reorder and "use register" work | Sonnet |
| **6.40** | The debug panel, the FL dialog, the share-dialog sentences, and an e2e test of recipe M against a production build served with the production headers. | `apps/web/src/{bake,io,pages}` parts named in UI.md §2.3 for these features, `apps/web/e2e/**` (new files) | 6.37, 6.38, 6.39 | `npm run e2e` includes recipe M (CR131) and a pause with the registers listed; no CSP violation; `npm run size` within budget | Sonnet |
| **6.41** | **Fold-in.** Merge sections 1 to 4 and the cases of section 6 into RECIPES.md (and the text of PLAN §3.6, UI.md §2.3), keep the CR numbers, turn this file into a historical note, update the corpus README if any. Add the editor-plugin checks of section 4.13 to the plugin repository's backlog. | `docs/RECIPES.md`, `docs/RECIPES-1.1.md`, `docs/PLAN.md`, `docs/UI.md` | 6.35 to 6.40 | the documents and the code agree (the spot checks of section 0.3 repeated on the merged result); `npm run lint` | Haiku |

Order: **6.35 and 6.36 in parallel**; then **6.37**; then **6.38 and 6.39 in parallel** (6.39 may start as soon as 6.36 is merged, in parallel with 6.37); then **6.40**; then **6.41**. 6.36 and 6.37 do not share files; 6.37 and 6.38 do not either. The orchestrator re-runs `npm run lint && npm run typecheck && npm test && npm run build`, `npm run e2e` and `npm run size` after each merge, and at the end `npm run gate2:browser -w @forge/worker` and the production-headers check (`node apps/web/scripts/serve-prod.mjs`).

---

## 8. Open questions

Each has a recommended answer. Items I could not check are here and not in the design.

| # | Question | Recommended answer | Reason |
|---|---|---|---|
| Q1 | Unfreeze `packages/recipe` for additive changes, and allow edits to `packages/ops/vocab/recipe.fth`, `packages/worker` and `apps/web` for this wave? | **Yes**, additive only: no existing export, issue code, limit or golden changes meaning (section 1.4). | The same decision as for FL v0.2 (WP 6.2); the alternative is to leave these two features out. |
| Q2 | Version signalling: keep `"forge": 1` or bump to 2 for recipes that use a feature? | **Keep 1** (section 1.3). | Old readers fail closed already; the `forge: 2` goldens keep their meaning; one schema, one text header, one share version. |
| Q3 | Register shape: (b) computed register only, or add (a) a regex capture step? | **(b) only.** Add a `regex:capture`-style op later if wanted. | It needs no new primitive or hard kill for slicing, and composes with every op. |
| Q4 | Step kind names: `register` and `return`, or Forge-only names (`let`, `stop`)? | **`register` and `return`.** | They match the feature names the owner uses and read well in the UI; they are standard words (R21). Cheap to rename before implementation. |
| Q5 | Return scope: whole recipe, valid only at the root and in `if` branches; or a scoped return in `fork`, `subsection`, `repeat`? | **Whole recipe, root and `if` only.** A scoped return needs a quotation-level early exit in FL, which is out of this wave. | FL's `exit` is valid only where it compiles to a jump (LANGUAGE §8); the alternatives break data or the step map (section 3.2). |
| Q6 | May a reference appear in `fork.split`/`join`, `subsection.pattern`/`flags`, the regex test of an `if`, `repeat.times`? | **No**, op and op-test parameters only. | The shape of the recipe stays readable without running it; each can be added later without breaking anything. |
| Q7 | May a reference supply every parameter type, `bool` and `choice` included? | **Yes.** | One rule; the word-entry check is the same for a literal and a register. |
| Q8 | Disabled steps and scope: the two views of section 2.3 (an enabled step sees enabled definitions; a disabled step sees all; duplicates only among enabled)? | **Yes**, as written. | Disabling a step never makes a recipe invalid, and the compiled text always loads. The cost is a rule with three clauses. |
| Q9 | Warn about unreachable steps after a `return` (`unreachable-step`)? | **Yes**, warning only, same list only. | Cheap, helpful, and never blocks a bake. |
| Q10 | Register limits: names of 32 characters, 64 registers per recipe? | **Yes.** | A name is read in a pane and in text; 64 is far above need and keeps lists small; both are constants. |
| Q11 | A new internal word `recipe:peek`, or inline `dup [ … ] call :> $name`? | **The word.** | The text is shorter, the parser has one fixed close line, and the effect check sits in one place. |
| Q12 | Local names `$name`, with the leading `$`? | **Yes.** Checked in `@forge/lang` (section 0.3); the plugin side is unchecked (section 4.13). | No collision with any word or future `core` word. |
| Q13 | Redact a register that feeds a `key` parameter in the debugger, with no reveal toggle? | **Yes, static rule, no toggle.** | It matches how `key` values are treated elsewhere; the data pane shows the input anyway. |
| Q14 | Show register values only at pauses, or also the final values in `BakeResult`? | **Pauses only.** | Registers live in scopes that have closed by the end; a result field would show only the root ones. Can be added later. |
| Q15 | Keep `protocol: 1` with an optional `registers` field in `paused`? | **Yes.** | Additive; an old client ignores it. |
| Q16 | Does Magic ever generate `register` or `return`? | **No.** | It searches ops on their defaults; no way to guess offsets or keys (section 4.11). |
| Q17 | The step-map fix (line membership) lives in `resolveStepIps`; or fix the line positions of lowered `if` in `packages/lang`? | **In `resolveStepIps`.** | No change to `packages/lang`; the new rule equals the old on every v1 text. |
| Q18 | Add a note to the share dialog when a recipe uses v1.1 features (`recipeUsesV11`)? | **Yes, one line.** | It is the only place where an old reader's confusing error can be forestalled. |
| Q19 | The compiled shape of a register: the name on the close line (`] recipe:peek :> $name`), and the word name `peek`? | **As proposed**; the word name is open to change. | `:>` must follow the call, so the name cannot be on the open line. |
| Q20 | Unverified: does the plugin accept a qualified `core:exit` and `$` word names; does `ForgeError.detail.value` clip a very large register value before it reaches `BakeError.detail`? | **Check both in 6.38 and 6.41**; if the second is not clipped, clip in the baker (§8.2: details are JSON-safe text). | I read the plugin's diagnostic and the error type but did not run either. |

## 9. What this wave does not do

Not in scope, and left for later: a scoped return inside containers (needs an FL change, Q5); registers in structural parameters (Q6); a regex capture op (Q3); reporting register values in the result (Q14); rebinding or mutating a register (FL locals are immutable and so are registers); registers visible to other recipes or to promoted words; Magic generating the new steps (Q16); any change to `packages/lang`.
