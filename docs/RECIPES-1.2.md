# Recipe format, the Relix wave: proposal (recommended as v1.2)

Status: **proposal**, 2026-11-23. Not normative. This is work package SP2 of the toolkit programme ([TOOLKIT.md](TOOLKIT.md) §13.3), written for Gate T1. It follows the precedent of [RECIPES-1.1.md](RECIPES-1.1.md): a separate proposal first, approval by the owner, implementation by work packages, and only then a fold-in into [RECIPES.md](RECIPES.md). Until then RECIPES.md is the specification and this file changes nothing in it. The one edit made to RECIPES.md by this work package is the §2.2 correction of section 13.

The file name follows the recommendation of Q1 (v1.2, `"forge": 1` stays). **If the owner decides on 2.0, this file is renamed `RECIPES-2.0.md`.** The text changes only where Q1 lists.

It builds on [RECIPES.md](RECIPES.md) (§2.2 what makes a word an op, §3 recipe JSON v1 and v1.1, §3.7 issues, §5 compilation, §6 canonical text, §7 share URL, §8 bake API, §9 op test vectors, §12 conformance, Appendix A), on [TOOLKIT.md](TOOLKIT.md) (§3 decisions T1 to T22, §5 packs, §6 and §7 extension values and the table, §8 the Relix pack, §13.5 rows X3, X5 and P1 to P8, §14.2 Q10), on [RELIX-LANES.md](RELIX-LANES.md) (the design for binary operators, made normative here) and on [research/x0-ext-values.md](research/x0-ext-values.md) (§6 ext parameters, §10, §11). The names of Relix words, parameters and value mappings belong to RELIX.md (SP6). This document owns the recipe-format mechanics only. Names used from SP6: the source op `relix:input` with parameter `tab`; the ext kinds `table`, `relation` and `relix-expr`; binary Relix operators are op steps with slots. Op names in the examples below (`relix:join`, `csv:parse` and so on) are illustrative and do not exist yet.

> **Packages are frozen.** `packages/*` hold frozen Phase 1 and 2 contracts (CLAUDE.md). This wave changes `@forge/recipe` (model, validator, compiler, text, share), `@forge/worker` (protocol, types, vector runner) and `@forge/ops` (catalogue types and build, vector schema). Each is an owner-approved change at Gate T1 (TOOLKIT §13.3), alongside the `@forge/lang` and `@forge/worker` changes of X1 and X2. Nothing here starts before that gate. No existing export or type changes meaning. Where a union gains a member, section 14 says so.

## Contents

1. What the wave contains
2. Versioning: the facts
3. Ext parameters (X3)
4. Slots for binary operators: the model and the JSON
5. Slots: validation, scope and limits
6. Compilation, step map and canonical text
7. Named inputs and the per-step schema (X5)
8. Pack ops
9. Pins across hash changes (TOOLKIT Q10)
10. Op test vectors with setup steps (T22)
11. Share URL
12. Bake protocol
13. Internal vocabularies: the §2.2 correction
14. Lists: issue codes, limits, types, catalogue and protocol fields
15. Conformance cases (CR201 to CR252)
16. What an old reader does
17. Open questions, with recommended answers
18. Work packages
19. What other documents need

---

## 1. What the wave contains

| # | Item | Layer | Section |
|---|---|---|---|
| 1 | Ext parameters: a parameter of type `ext{kind}` | catalogue, recipe validation, text | 3 |
| 2 | Slots for binary operators: `pipe`, `left`, `right` on an op step | recipe JSON, validation, compiler, text, step map | 4 to 6 |
| 3 | Named inputs: `relix:input` with `tab`, and a per-step schema in the bake result | bake protocol, share link | 7, 11, 12 |
| 4 | Pack ops: how a recipe names one, and what happens when its pack is off | validation, share decode | 8 |
| 5 | Pins across hash changes (TOOLKIT Q10) | catalogue, validation | 9 |
| 6 | Op vectors gain `setup` steps (T22) | vector format, runner | 10 |
| 7 | The §2.2 internal-vocabulary correction | RECIPES.md | 13 |

Items 1 to 6 are the new format. They are one wave because they depend on each other: a binary operator needs slots (2) and a second tab (3); a pack op needs ext parameters (1); a vector for a table op needs setup steps (6).

The recipe-format rules in this document follow the conventions of RECIPES.md: closed objects, JSON pointers for paths, limits checked before any recursive walk, no recursion in the text parser, and no kind-specific code in `@forge/recipe`.

---

## 2. Versioning: the facts

RECIPES R29 and Appendix A.11 kept `"forge": 1` for v1.1 on the rule that the number follows compatibility, not size. This section applies the same test to each item. The test has two parts. (a) Does any v1.1 recipe, text or link change meaning or validity? (b) Does an old reader fail closed on a new recipe, so that it never misreads it?

### 2.1 Observed on the v1.1 code

These were run on 2026-11-23 against the built `@forge/recipe` and `@forge/worker` of this repository, with the shipped catalogue and, where a case needed one, a hand-made catalogue with an ext parameter.

| New construct | What the v1.1 code does |
|---|---|
| `pipe` and `right` on an op step | `unknown-field` at `/steps/0/pipe` and `/steps/0/right` |
| `left` on an op step | `unknown-field` at `/steps/0/left` |
| an op `relix:join` that the catalogue lacks | `unknown-op` at `/steps/0/op` |
| text with `[`, a lane, then `] recipe:peek` or `] recipe:peek swap` | `bad-value`: "expected ] followed by fork, recipe:section, recipe:branch, recipe:repeat, recipe:settle or if" |
| a string value for an `ext` parameter, in a catalogue that has one | `bad-param` ("unsupported parameter type"). No build before this wave has such a catalogue, so the case arises only for a recipe that names a new op, and that is `unknown-op` first |
| a share link with the extra keys `n` and `t` | decoded: unknown keys are ignored (RECIPES §7.1), so a link made for a recipe that v1.1 can open still opens |
| a `bake` message with an `inputs` key, or `options.inputs` | the message guard `isClientMessage` refuses it, and the worker answers `fatal` |

### 2.2 Item by item

| Item | v1.1 recipes, text and links | Old reader and a new recipe | Additive? |
|---|---|---|---|
| Ext parameters | A JSON string where a string was already allowed. No v1.1 recipe changes. | The op is unknown in an old build. | Yes |
| Slots | A recipe with no slot step is unchanged, byte for byte (same canonical JSON, text and fragment). | `unknown-field`, and the text is `bad-value`. Fail closed. | Yes |
| Named inputs | `bake(recipe, input)` is unchanged. The new `inputs` option is optional. | `relix:input` is `unknown-op`. A link's extra keys are ignored. | Yes, with a protocol bump (Q8) |
| Pack ops | Names are ordinary `vocab:word` qualified names. | `unknown-op`. | Yes |
| Pins across hash changes | A pin keeps its spelling and meaning. A catalogue op may list earlier hashes that still count (section 9). | Unchanged. An old reader never sees the new catalogue field. | Yes, **by the design chosen in section 9** |
| Op vectors with `setup` | A vector without the new fields runs as before. | Not a recipe feature. | Yes |

One alternative is not additive, and it is rejected: making pins survive a hash change by changing how a pin is written or computed (for example `"hash": "2:<hex>"`, or hashing a canonical op signature). Every stored recipe, golden and share link carries pins in the current spelling, so a new spelling would make every pinned v1.1 recipe invalid in the new reader or in the old one. The design of section 9 keeps the spelling.

Three changes are source-breaking for TypeScript code that switches exhaustively, and none changes what a recipe means: the new `ShareErrorCode` member `packs-needed` (section 8), the `"ext"` members that X1 and X2 add to `Tag`, `Value`, `ParamType` and `OutputValue` (X0 §7, already inside Gate T1), and the `PROTOCOL_VERSION` of the bake protocol (Q8). They are tracked in section 14.

### 2.3 Conclusion

No item changes what a v1.1 recipe, text or link means, and every new construct fails closed in a v1.1 reader. Every item is additive at the format level. The recommendation is v1.2 with `"forge": 1`. The case for 2.0, and what it would cost, is Q1.

---

## 3. Ext parameters (X3)

A parameter whose type is `ext{kind}` carries the **text form** of a value of that kind: for `relix-expr`, Relix predicate or operand text. This follows X0 §6 and decisions T17 to T20.

### 3.1 The catalogue side

These are catalogue changes, made by X1 and by this wave's catalogue package (RW4). They are listed here because the recipe layer reads them.

- `ParamType` gains `"ext"` and `ParamSpec` gains `kind` (the kind name, T18). The catalogue schema allows both.
- `UI_PARAM_TYPES` (RECIPES §2.2 rule 4) gains `"ext"`. Rule 4 gains one clause: a parameter of type `ext` counts only when its kind is registered **with a `fromText`**. A kind with no faithful text form cannot be a parameter. Its ops fail rule 4 and are not ops. (The `table` kind needs D2's faithful text form first; X0 R10.)
- `CatalogueOpView` (what `@forge/recipe` reads) gains nothing for ext parameters. It reads `ParamSpec.type`, and ignores `ParamSpec.kind`.

### 3.2 The JSON form

An ext parameter is a JSON **string**. It is added to the table of RECIPES §3.4:

| type | JSON value | notes |
|---|---|---|
| `ext` | a string | well-formed UTF-16; at most `RECIPE_LIMITS.maxExtChars` (4096) code points; **not normalised**: the text is kept exactly as written |

```json
{
  "forge": 1,
  "steps": [
    { "kind": "op", "op": "csv:parse" },
    { "kind": "op", "op": "table:filter", "params": { "expr": "age > 30 and name <> \"Bob\"" } }
  ]
}
```

A `{ "ref": name }` may supply an ext parameter, as for any type (RECIPES §3.4). The coercion rule is one more row of that section's table:

| parameter type | runtime tag | a register of tag … is accepted | otherwise |
|---|---|---|---|
| `ext{kind}` | `ext` of that kind | `ext` of the same kind; `str`, converted by the kind's `fromText` | `E_COERCE` (the text is not a valid text of the kind), `E_TYPE` (any other tag or kind) |

### 3.3 Who checks what

`@forge/recipe` stays kind-blind. It has no kind registry and never calls `fromText`.

| Check | Where | Result |
|---|---|---|
| the value is a string, well formed, within 4096 code points | `validateRecipe` | `bad-param` with `reason` and, for the length, `constraint: "length <= 4096"` |
| the text is valid for the kind | the baker, at word entry (the VM coerces `str` to `ext{kind}` with `fromText`, X0 §3.4) | `E_COERCE`, with the step path and, in the message, the kind's position ("expected a value at column 6") |
| a name or type the text uses exists (an unknown column) | the word itself | `E_PARAM_INVALID` with `detail.param` |
| live feedback while typing | the page, with the kind's parser module (T20) | advisory only. The bake decides |

`validateRecipe` never reports a grammar error in an ext string. A recipe whose `expr` is `"age >>"` is valid, and fails when it bakes. This is the rule of RECIPES §3.4 for `pattern` constraints: nothing that runs kind code runs on the main thread inside the validator.

The parser module that both the worker and the page import (T20, decided with P1) is not part of `@forge/recipe`.

### 3.4 Normal forms, text and share

- `normalise` and `canonical` keep an ext string as written. Two texts that mean the same (`age>30` and `age > 30`) are two recipes, with two share URLs. The format does not canonicalise kind text, because that needs `fromText` and `toText`. A page action "tidy" may rewrite a string through the kind. That is UI work, not format.
- `resolve` writes a default for an omitted ext parameter. A default is a string (`ParamDefault`) and is not normalised.
- The text form needs no new line. The literal of an ext parameter is a string literal, as for `str` (RECIPES §5.2: the compiler's default branch). The parser reads an ext parameter from an `FL-string` group (§6.3 item 6). X0 confirmed that `compileRecipe` needs no change.
- The share URL is unchanged. A recipe with ext parameters is encoded and decoded like any other. The only effect is length: an ext string is at most 4096 code points, and `maxRecipeBytes` (262 144) and `maxFragmentChars` (65 536) still apply.
- An ext parameter is **not secret**. `encodeShare` raises no `secret-in-url` for it. A kind that holds secrets is not supported by this wave.

### 3.5 What the page and pack must provide

The helper contract of X3 (X0 §11: `check(text, schema) => { ok, message }`, optional `complete`) lives in `apps/web` and in the pack. This document does not specify it. It depends on the per-step schema of section 7.6.

---

## 4. Slots for binary operators: the model and the JSON

[RELIX-LANES.md](RELIX-LANES.md) is the design input. This section and the next make it normative. Where the two differ, section 19 lists the change to RELIX-LANES.

### 4.1 Terms

- A **lane** is a list of steps, as a `fork`'s `steps` is. The recipe's own `steps` is the **main line**.
- A **slot** is a named input of a step that holds a lane. A binary operator has two slots, `left` and `right`.
- A **binary op** is a catalogue op with a **slot parameter** (section 4.5). Its data input is its `left` input. Its slot parameter is its `right` input.
- A **slot step** is an op step with `pipe`, `left` or `right`.

### 4.2 The pipe rule

> **The pipe rule.** Every step reads the output of the step above it. A slot step records which slot that data feeds, as `"pipe": "left"` or `"pipe": "right"`. The other slot holds a lane. A slot step with no `pipe` has a lane in both slots, and the data above is not used.

`pipe` names the slot that the data above **feeds**. That slot is **absent** (it holds no lane, because the data is that side). The other slot is **present**.

| `pipe` | `left` | `right` | The data above feeds | Meaning |
|---|---|---|---|---|
| `"left"` | absent | lane | the left input (the op's data input) | the usual form: the pipeline is on the left |
| `"right"` | lane | absent | the right input (the slot parameter) | the pipeline is on the right. For ⟕, ▷ and − this is a different query from `"left"` |
| absent | lane | lane | nothing | both inputs are lanes. The data above is dropped |

The JSON shape of a slot is an object with a single required field, `steps`, a list of steps. A slot is a lane object, not a bare list, so that it can carry fields later (a name, a note) without a format change (RELIX-LANES §8). Slot objects are closed.

```json
{
  "kind": "op",
  "op": "relix:join",
  "params": { "on": "customer_id = id" },
  "pipe": "left",
  "right": {
    "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
      { "kind": "op", "op": "csv:parse" },
      { "kind": "op", "op": "relix:select", "params": { "expr": "country = 'NZ'" } }
    ]
  }
}
```

A slot step stays `"kind": "op"` (RELIX-LANES L6, accepted here). It keeps `params`, `hash`, `disabled`, `breakpoint` and `note`, and the catalogue says whether it may have slots. A new kind would need a second path through every consumer, and would give an old reader `bad-kind` where it now gets `unknown-field`, which is not a better message.

### 4.3 What a slot lane computes

A slot lane is a scope, and its semantics are those of a `register`'s children (RECIPES §3.2):

- A lane runs on **a copy of the data that enters the slot step**, in document order: `left` before `right`, whatever the order of keys in the JSON.
- The value the last step of the lane leaves is the input of the op for that side. The data entering the slot step is unchanged by the lane.
- A lane that starts with a source op (`relix:input`) ignores the data it is given. A lane that starts with byte steps (From Base64, Parse CSV) works on that copy. The format does not require a source. This answers RELIX-LANES Q5: a lane has data at its top, so there is no "lane with no data" case to report.
- The slot step then has the stack effect of every step, `( x -- y )`: the op gets its two inputs and its other parameters, and leaves one value.

Order of evaluation matters only for effects and errors. A failing lane fails the recipe at its own path.

### 4.4 The example recipe in each form

The orders recipe (Base64 CSV, parsed, filtered, joined to the New Zealand customers, grouped and sorted), with the active tab `orders.b64` as the main input:

```json
{
  "forge": 1,
  "name": "Paid orders by region",
  "steps": [
    { "kind": "op", "op": "base64:decode" },
    { "kind": "op", "op": "csv:parse" },
    { "kind": "op", "op": "relix:select", "params": { "expr": "status = 'paid'" } },
    {
      "kind": "op",
      "op": "relix:join",
      "params": { "on": "customer_id = id" },
      "pipe": "left",
      "right": {
        "steps": [
          { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
          { "kind": "op", "op": "csv:parse" },
          { "kind": "op", "op": "relix:select", "params": { "expr": "country = 'NZ'" } }
        ]
      }
    },
    { "kind": "op", "op": "relix:group", "params": { "expr": "region; sum(total) as revenue" } },
    { "kind": "op", "op": "relix:sort", "params": { "expr": "revenue desc" } }
  ]
}
```

After **Swap sides** (RELIX-LANES §3), the same join has `pipe: "right"`, no `right` key, and the lane under `left`. Nothing else in the recipe moves:

```json
{
  "kind": "op",
  "op": "relix:join",
  "params": { "on": "customer_id = id" },
  "pipe": "right",
  "left": {
    "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
      { "kind": "op", "op": "csv:parse" },
      { "kind": "op", "op": "relix:select", "params": { "expr": "country = 'NZ'" } }
    ]
  }
}
```

A join with no pipe, which is valid as the first step of a list (here a one-step recipe whose main input is not used):

```json
{
  "forge": 1,
  "steps": [
    {
      "kind": "op",
      "op": "relix:join",
      "params": { "on": "customer_id = id" },
      "left": {
        "steps": [
          { "kind": "op", "op": "relix:input", "params": { "tab": "orders.csv" } },
          { "kind": "op", "op": "csv:parse" }
        ]
      },
      "right": {
        "steps": [
          { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
          { "kind": "op", "op": "csv:parse" }
        ]
      }
    }
  ]
}
```

**Main line** (RELIX-LANES §3) is an editor action. It moves steps between a lane and a slot and flips `pipe`. It needs no rule in the format: the result is an ordinary recipe whose paths have changed.

### 4.5 How the catalogue marks a binary op

`CatalogueOp` gains an optional field `slot`: the name of the slot parameter. `buildCatalogue` sets it iff the op's **data input** and its **first parameter** both have type `ext` with kind `relation` (the set of such kinds is a constant, `SLOT_KINDS`, in `@forge/ops`). The first parameter is then the slot parameter, and the op is binary.

```json
{
  "qname": "relix:join",
  "input": "ext",
  "output": "ext",
  "effect": "( ext{relation} right:ext{relation} on:ext{relix-expr} -- ext{relation} )",
  "params": [
    { "name": "right", "type": "ext", "kind": "relation", "index": 1, "required": true },
    { "name": "on", "type": "ext", "kind": "relix-expr", "index": 2, "required": true }
  ],
  "slot": "right"
}
```

(The excerpt shows only the fields that matter here.) Four consequences:

1. `@forge/recipe` reads `slot` and nothing about kinds, so it stays kind-blind. `CatalogueOpView` gains `slot?: string`.
2. The slot parameter is **never** in the recipe's `params`. Its value is the lane. A `params` key with the slot parameter's name is `bad-slot`.
3. The slot parameter is the **first** parameter, so that the compiled code can evaluate the lanes before it pushes any literal (section 6.1). This is a requirement on the Relix wrappers (section 19, "Requirements on RELIX.md").
4. `resolve` makes every parameter explicit except the slot parameter. `params` is present exactly when the op has a parameter other than the slot parameter.

Whether the marker should instead be a `META:` clause is Q2.

### 4.6 What is format and what is editor

RELIX-LANES §2.3 gives the editor's **normal form**. Its four rules split as follows.

| RELIX-LANES §2.3 rule | In the format? |
|---|---|
| 3. A piped slot is absent. 4. Every slot that is not the piped one exists. | **Format.** These are the table of section 4.2, checked by the validator (`bad-slot`, `missing-slot`) and by the schema. |
| 1. A first step has no `pipe`. | **Editor.** The format accepts `pipe` on a first step: the data it feeds is a copy of the data entering the list. On the main line that is the input bytes, so the bake fails with `E_TYPE` at that step. In a slot lane it is the data that entered the outer slot step. |
| 2. A step after the first with no `pipe` takes the pipe on the first empty slot. | **Editor.** The format accepts a step with no `pipe` after other steps and warns (`unused-pipe`, section 5). |

`normalise` is catalogue-free and adds nothing. It does not apply rules 1 and 2.

---

## 5. Slots: validation, scope and limits

### 5.1 The schema

The JSON Schema (RECIPES §3.9) gains one definition and changes `opStep`. The consistency of `pipe`, `left` and `right` is structural, so it is in the schema. Which ops may have slots is a catalogue question, so it is not.

```json
{
  "$defs": {
    "slot": {
      "type": "object",
      "properties": { "steps": { "$ref": "#/$defs/steps" } },
      "required": ["steps"],
      "additionalProperties": false
    },
    "opStepAdditions": {
      "properties": {
        "pipe": { "enum": ["left", "right"] },
        "left": { "$ref": "#/$defs/slot" },
        "right": { "$ref": "#/$defs/slot" }
      },
      "allOf": [
        {
          "if": {
            "anyOf": [
              { "required": ["pipe"] },
              { "required": ["left"] },
              { "required": ["right"] }
            ]
          },
          "then": {
            "oneOf": [
              {
                "properties": { "pipe": { "const": "left" } },
                "required": ["pipe", "right"],
                "not": { "required": ["left"] }
              },
              {
                "properties": { "pipe": { "const": "right" } },
                "required": ["pipe", "left"],
                "not": { "required": ["right"] }
              },
              {
                "required": ["left", "right"],
                "not": { "required": ["pipe"] }
              }
            ]
          }
        }
      ]
    }
  }
}
```

`opStepAdditions` is shown separately for reading. In the schema file its `properties` are merged into `opStep.properties` and its `allOf` entry is appended to `opStep.allOf`. The `if` has no `else`: an op step with none of the three keys is valid, because the schema cannot tell whether its op is binary. Slots are not accepted in the `test` of an `if` (the `ifTest` op shape is closed, so `unknown-field`).

A document the schema rejects, the validator rejects (RECIPES §3.9). The validator is stricter and gives precise codes.

### 5.2 Validator rules and the new issue codes

The validator runs the structural rules, then the catalogue rules, in the order of RECIPES §3.7. For an op step `S` at path `p`, with the catalogue entry `O` if the op is known:

| Rule | Issue | Path | `detail` |
|---|---|---|---|
| `pipe` is not `"left"` or `"right"` | `bad-value` | `p/pipe` | `constraint` |
| a slot is not an object with `steps` and no other key | `type`, `required`, `unknown-field` | the slot or key | as for any object |
| `pipe` names a slot that is also present | `bad-slot` | `p/<slot>` | `reason: "piped-slot-present"`, `slot`, `op` |
| `pipe` is absent and a slot is absent | `missing-slot` | `p/<slot>` | `slot`, `reason: "absent"` |
| `pipe` is set and the other slot is absent | `missing-slot` | `p/<slot>` | `slot`, `reason: "absent"` |
| with a catalogue: `O` is not binary and one of the three keys is present | `bad-slot` | the first of `p/pipe`, `p/left`, `p/right` that is present | `reason: "not-binary"`, `op` |
| with a catalogue: `O` is binary and `params` has the key `O.slot` | `bad-slot` | `p/params/<name>` | `reason: "slot-in-params"`, `op`, `slot` |
| with a catalogue: `O` is binary and none of the three keys is present | `missing-slot` | `p` | `reason: "no-slots"`, `op` |
| a present lane has no enabled step other than a `comment` (it has no steps, or only comments and disabled steps) | `missing-slot` | `p/<slot>` | `slot`, `reason: "empty"` |
| `S` has no `pipe` and an enabled earlier step of the same list, other than a `comment`, exists | `unused-pipe` (warning) | `p` | `op` |

Notes.

- `bad-slot` and `missing-slot` are errors, and a disabled slot step still reports them (RECIPES §3.2, "a disabled step still has to be valid"). They take no part in the scope pass of RECIPES §3.7.
- The structural rows apply without a catalogue. The rows marked "with a catalogue" apply only when `validateRecipe` was given one and the op is known. An unknown op gets `unknown-op` and no slot checks, as it gets no parameter checks.
- `unused-pipe` is raised only for a step that has both lanes and no other slot issue.
- `unused-pipe` is a warning, because a slot step with a lane on both sides is a legal way to start over. It looks at siblings in the same list only. A binary step that is first in its list never warns.
- The editor reports `missing-slot` as it reports `missing-param` today: live, as the user builds a step.
- RELIX-LANES §8 proposed `bad-pipe` and `slot-type`. `bad-pipe` is merged into `bad-slot`. `slot-type` is **not** a validator rule: the validator tracks no value types. The check "a lane ends in a table or relation" is `fit.ts` in the UI and `E_TYPE` at run time, attributed to the step.
- Paths never carry the slot's `steps` segment unless they point inside the lane: the slot itself is `/steps/3/right`, and its first step is `/steps/3/right/steps/0`.

### 5.3 Paths

A slot adds one segment to a path: the slot's name, then `steps`, as RELIX-LANES §8 says.

```text
/steps/3                      the slot step
/steps/3/right                the right slot (a lane object)
/steps/3/right/steps          the lane's list
/steps/3/right/steps/1        its second step
```

This is one more kind of child list, next to `steps` of a `fork`, `subsection`, `repeat` and `register`, and `then` and `else` of an `if`. Every walker of child lists must learn it: `validate`, `normalise`, `resolve`, `pinRecipe`, `compile`, `stepmap`, the text parser, `registersInScope`, `registerInfo`, `recipeNeedsHardKill`, `recipeUsesV11` and the new helpers. `apps/web` has its own list (`childLists`, `CHILD_LIST_KEYS`; RELIX-LANES §8).

Issue paths, the failing-step path of a `BakeError`, and `StepReport.path` are matched to cards by prefix, so a step inside a lane highlights its own card and the slot step's card, as a step inside a `fork` does.

### 5.4 Registers and `return` in slot lanes

These apply the v1.1 rules to a lane. They are RELIX-LANES §8.1 made normative, with one change (the top of a lane has data).

- **Scope.** A lane is a list, so it is a scope. A register defined earlier in the list that holds the slot step is visible in the step's own `params` (a `{ "ref": … }` for `on`, say) and in the steps of both lanes, as inside a `fork`.
- **A register defined in a lane** is bound in that lane only. It is not visible after the slot step, and not in the other lane. Two lanes may use the same name (`duplicate-register` looks at names visible at the step). A name visible at the lane's step cannot be bound again.
- **A register at the top of a lane** takes the copy of the data that entered the slot step (section 4.3). No special case.
- **`return`** is valid only in the root list and in the `then` and `else` lists of an `if` that is in a valid position (RECIPES §3.2). A slot lane is not the root list, so a `return` in a lane, or in an `if` inside a lane, is `bad-position`. Its `detail` is `kind: "return"`, `container: <the path of the slot step>`, `containerKind: "op"` and the new key `slot`. A `return` after the slot step, in the main line, is valid.
- **A register cannot be a slot's source.** A reference is accepted only in the `params` of op steps and op tests. The way to use one sub-expression twice is a saved relation (a word) read by a source op in both lanes. RELIX-LANES Q6 is answered no (Q6 below).
- `registersInScope(recipe, "/steps/3/right/steps/1", catalogue?)` returns the registers visible there. A path that ends at a lane (`/steps/3/right/steps`) means the position after the lane's last step.

### 5.5 Limits

A lane counts as a container level, as `fork` children do.

- Steps in the whole tree (500): steps in lanes count.
- Container nesting depth (8): a slot step adds one level for its lanes.
- Raw JSON depth (64): a lane adds three JSON levels (the step object, the slot object, the `steps` array), against two for a `fork`. Eight nested slot levels use 24 levels, plus the root, `steps`, `params` and a reference object, so below 64. RW1 asserts this with a generated recipe (CR216).
- There is no new limit on the number of slot steps. A hostile recipe is bounded by the step and size limits.

---

## 6. Compilation, step map and canonical text

### 6.1 The compiled form

A slot step compiles to the lanes, then the op. No new FL word is needed: a lane is the quotation of the v1.1 word `recipe:peek ( any body:quot -- any any )`, which runs `body` on a copy of the data and leaves the data and the result. The op word needs its two inputs in the order of its header: the data input, then the slot parameter, then the other parameters. The lanes are evaluated first, before any literal is pushed, which is why the slot parameter must be the first parameter.

The three forms. `⟨lits⟩` is the literal group of the op's other parameters, in `ParamSpec` order (the slot parameter has none). The stack is written deepest first. `D` is the data entering the step.

| Form | Text | Stack |
|---|---|---|
| `pipe: "left"` | `[` right lane `] recipe:peek`, then `⟨lits⟩ qname` | `D`, then `D R`, then the op consumes `D R ⟨lits⟩` |
| `pipe: "right"` | `[` left lane `] recipe:peek swap`, then `⟨lits⟩ qname` | `D L`, `swap`: `L D`, then the op consumes `L D ⟨lits⟩` (the pipeline is the right input) |
| no `pipe` | `[` left lane `] recipe:peek swap`, `[` right lane `] recipe:peek nip`, then `⟨lits⟩ qname` | `D L`, `L D`, `L D R`, `nip`: `L R`, then the op consumes `L R ⟨lits⟩` |

`swap` and `nip` are core words and are written unqualified, as `fork` and `if` are (RECIPES §5.1). Each lane is a quotation `( x -- y )`: every step in it is `( x -- y )` already, so the `E_EFFECT` check of `recipe:peek` holds.

The join of section 4.4 compiles to:

```text
\ forge-recipe 1
\ name "Paid orders by region"
: main ( bytes -- any )
  "standard" base64:decode
  csv:parse
  "status = 'paid'" relix:select
  [
    "customers.csv" relix:input
    csv:parse
    "country = 'NZ'" relix:select
  ] recipe:peek
  "customer_id = id" relix:join
  "region; sum(total) as revenue" relix:group
  "revenue desc" relix:sort
;
```

With `pipe: "right"` the lines from `[` to `relix:join` are the same except for the closer, `] recipe:peek swap`. With no `pipe`:

```text
  [
    "orders.csv" relix:input
    csv:parse
  ] recipe:peek swap
  [
    "customers.csv" relix:input
    csv:parse
  ] recipe:peek nip
  "customer_id = id" relix:join
```

**Checked by running** (2026-11-23, the v1.1 runtime, with the core word `cat` as the binary op, the main input `D`, and lanes that replace the copy with `"R"` or `"L"`): the left form gives `"DR"`, the right form `"LD"`, the no-pipe form `"LR"`. A register defined above the step and read inside a lane works (`"DQR"` and `"QLD"`). A nested lane works (`"DR1x"`). An empty lane leaves the copy (`"DD"`), which is why the validator rejects it. Everything else is argued from RECIPES §5.

### 6.2 Literals

The ext literal is a string literal (section 3.4). A reference is `$name`. Nothing else changes in RECIPES §5.2. `relix:input` is an ordinary op step: `"customers.csv" relix:input`.

### 6.3 Disabled steps, annotations and breakpoints

- A disabled slot step is written as comment lines, every line of it (each lane line, each lane closer, the op line) prefixed by `\ ~ ` once per disabled level, as for containers (RECIPES §5.4).
- The annotations of the step (`@pin`, `@break`, `@note`) sit on the **op line**, the last line, where the step's own word is. The lane lines carry the annotations of the steps in them.
- `core:exit` and the lowered `if` are never inside a lane (`bad-position`), so the lowering of RECIPES §5.3 needs no change.

### 6.4 The step map

`StepLine` has one entry for the slot step: `startLine` is the first line of its first lane (the `[`), and `endLine` is the op line. The steps inside the lanes have their own entries with the paths of section 5.3, and their line ranges lie inside the slot step's. Document order is the slot step, then the left lane's steps, then the right lane's steps. For the join of section 6.1:

| Step | Path | Lines | Notes |
|---|---|---|---|
| decode | `/steps/0` | 4 | |
| parse | `/steps/1` | 5 | |
| select | `/steps/2` | 6 | |
| join | `/steps/3` | 7 to 12 | the `[` is line 7; `] recipe:peek` is line 11; the op is line 12 |
| lane input | `/steps/3/right/steps/0` | 8 | |
| lane parse | `/steps/3/right/steps/1` | 9 | |
| lane select | `/steps/3/right/steps/2` | 10 | |
| group | `/steps/4` | 13 | |
| sort | `/steps/5` | 14 | |

(Line 1 is the header, line 2 the name, line 3 the word line, line 15 the `;`.)

`resolveStepIps` already uses line membership (RECIPES §5.5), so it needs no change. The `startIp` of the slot step is the first instruction of its first lane, so a breakpoint on it pauses before any lane runs, with the data entering the step. `step()` goes into the first lane's first step. `attributeError` takes the deepest enabled step whose range contains the `ip`, so an error in a lane step is that step's, and an error in the op's own parameters, or an `E_EFFECT` of `recipe:peek`, is the slot step's. The data-input coercion of the op (`slot === 0`) belongs to the slot step by the step log (RECIPES §8.2).

### 6.5 Canonical text: grammar

The grammar of RECIPES §6.2 gains two productions. A lane opens with the same line as a register, a lone `[`. What it is is decided by its closer.

```ebnf
slot-close  = "] recipe:peek" , [ " swap" | " nip" ] ;
body        = ... | slot-close ;                    (* added to the alternatives *)
```

`register-close` (`] recipe:peek :> $name`) is unchanged. The two closers differ by what follows `recipe:peek`: `:>`, `swap`, `nip` or nothing.

### 6.6 Canonical text: parsing

`parseRecipeText` keeps its explicit stack. The `[` frame is created as for a register. At a close line, by what follows `] recipe:peek`:

- `:> $name`: a register close (unchanged).
- nothing, `swap` or `nip`: a **slot close**. The frame's steps become a pending lane, `{ closer, steps, level, line }`, appended to the `pending` list of the enclosing list's frame. No step is completed yet.
- The next line must be another `[` or the **op line** that completes the slot step. Any other line while `pending` is not empty is `bad-value` with `constraint: "block structure"`. This includes a comment step, a close line, an `else` line and the end of the list.
- At the op line, the list of pending closers must be exactly one of: `[]` empty (an ordinary op line), `[peek]` (pipe left, the lane is `right`), `[swap]` (pipe right, the lane is `left`), `[swap, nip]` (no pipe, lanes `left` and `right`). Anything else is `bad-value`, `block structure`. A closer `nip` that does not follow a `swap` lane, a second `swap`, or a third lane is that error.
- All pending lanes and the op line must have the same disabled level. The step is disabled iff its level is one more than the enclosing frame's, as for containers.
- The op line is read as an op line (RECIPES §6.3 item 6) with one difference: the literal groups are matched to the op's parameters **after the slot parameter**. The op must be binary. If it is not, the assembled step has slot keys on a non-binary op and `validateRecipe` reports `bad-slot` (`not-binary`). The parser does not repeat the check.
- The result goes through `validateRecipe` and `canonical`, as in RECIPES §6.3 item 7, so scope and slot errors come out as they do for JSON.

An ext parameter is read from an `FL-string` group. The parser never loads FL and never recurses.

### 6.7 Round trip

RECIPES §6.5 holds with slots: `parseRecipeText(compileRecipe(r, c).text, c)` returns `canonical(r, c)` for every valid `r`. CR236 covers each of the three forms, a disabled slot step and a register inside a lane. A recipe with no slot step compiles to the text it has today, byte for byte (CR124 is the model; CR231 asserts it for v1.2).

### 6.8 Hard kill and helpers

`recipeNeedsHardKill` recurses into lanes. `recipeUsesV11` is unchanged (it does not report slots, so a recipe with slots and nothing else from 1.1 is not "needs 1.1").

---

## 7. Named inputs and the per-step schema (X5)

### 7.1 The source op

`relix:input` is a source op with one parameter, `tab` (a `str`): it reads the input tab of that name. Its header, signature and the type of what it returns are RELIX.md's (SP6). The format needs three things from it:

1. Its data input accepts **any** value (the header is `( any tab:str -- … )`). A source ignores what is above it, and in a lane the data entering the slot step may be a relation.
2. `tab` is matched against the names of the bake's inputs **exactly**: case-sensitive, no trimming, no Unicode normalisation.
3. `tab` may be a literal or a `{ "ref": … }`.

The names `relix:input` and `tab` are constants in `@forge/recipe` (`NAMED_INPUT_OP`, `NAMED_INPUT_PARAM`), because the baker, the share encoder and the editor all need them. They are used by name, as `recipe:peek` is.

### 7.2 The bake call

`Baker.bake(recipe, input, options)` keeps its signature. `input` is still the data that enters step 0. `BakeOptions` gains `inputs`:

```ts
interface BakeInput {
  readonly name: string; // the tab's name
  readonly bytes: Uint8Array;
}
// BakeOptions: …, inputs?: readonly BakeInput[]
```

`inputs` is the set of all named tabs. The main input is **not** named implicitly: a host that wants `relix:input` to read the active tab passes it in `inputs` as well, under its name. This keeps the call free of a hidden rule. The bytes of the main input and of its entry in `inputs` are not required to be the same object.

Rules, checked by the client before the message is sent, and by the worker on receipt:

| Rule | Value |
|---|---|
| names | 1 to 120 code points, well-formed UTF-16, no C0 or C1 control character |
| uniqueness | exact; two entries with the same name are an error |
| count | at most `BAKE_INPUT_LIMITS.maxInputs` (32) |
| size | the total of all inputs and the main input is at most `limits.maxTotalBytes` of the effective limits (RECIPES §8.6) |

A violation gives a result with `ok: false` and `error.code: "E_PROTOCOL"`, `path: null`, and `detail.reason` (`"input-name"`, `"input-duplicate"`, `"input-count"` or `"input-size"`) with `detail.name` for the first three. It is a bad request, not a recipe error. No new `BakeErrorCode` is added.

### 7.3 Reading a tab at run time

The baker core installs the inputs for the duration of a bake, keyed by the bake's abort signal, as it installs the Magic host (RECIPES §4.4), so that nothing is global. The primitive of `relix:input` (SP6) asks that host for the bytes. A runtime with no host, or a bake with no `inputs`, finds no tabs. Each read is metered as a new value (SP6 states how the bytes become a table). Nested bakes of `magic:magic` get no inputs.

### 7.4 Missing tab

A recipe may name a tab that is not there: a shared recipe, a renamed tab, a closed tab. There are three layers, from cheapest.

1. **`inputNames(recipe)`** (new, in `@forge/recipe`) returns the literal tab names of enabled `relix:input` steps, with their paths: `{ name, path }[]`. A `{ "ref": … }` tab is not listed. The editor uses it to flag a step before baking and the share dialog to list the tabs that a link must carry. It is pure and works without a catalogue.
2. **The baker's early check.** After validation and before compile, the baker SHOULD check every name that `inputNames` returns against `inputs`. The first missing one in document order fails the bake before any step runs, with the error of layer 3 and that step's path. An early failure saves a long bake that would fail at step 8.
3. **The run-time error.** The primitive raises `E_PARAM_INVALID` for a name it cannot find. The shape is the same in layers 2 and 3:

```text
E_PARAM_INVALID path=/steps/0 word=relix:input detail.param=tab detail.reason=no-such-input
                detail.tab=customers.csv detail.tabs=["orders.b64"]
```

`detail.tabs` lists the available names, at most 20, each cut to 80 code points. If `tab` is supplied by a register, `detail.register` is also set (RECIPES §3.4). No new error code is needed. The UI turns the error into "This recipe reads the tab "customers.csv". There is no such tab. Add one with that name, or change the step."

### 7.5 The per-step schema in the bake result (T20)

X3's live check and column buttons need the schema of the data at a step (X0 §6.3). The bake result gains it.

```ts
interface SchemaColumn {
  readonly name: string;
  readonly type: string;
}
interface StepOutputInfo {
  readonly tag: string; // the FL tag of the value the step left: bytes, str, int, num, bool, list, record, ext, other
  readonly kind?: string; // the ext kind, when tag is "ext"
  readonly schema?: readonly SchemaColumn[]; // present when the kind provides one
  readonly schemaTruncated?: true; // more than maxSchemaColumns columns
}
// StepReport: { path, ms, runs, out?: StepOutputInfo }
```

```json
{ "path": "/steps/3", "ms": 4, "runs": 1, "out": { "tag": "ext", "kind": "table", "schema": [{ "name": "region", "type": "str" }, { "name": "total", "type": "num" }] } }
```

- **When it is filled.** At the end of a step (an `ends` event of the step map, RECIPES §5.6), from the top of the stack, which `StepEvent.stack` already exposes. `tag` is free. `kind` and `schema` come from the kind's optional `schema(value)` function (X1 adds it to `ExtKind`). It must be O(1) or cached, like `sizeOf`, and a kind that has none gives no `schema`.
- **A step that runs many times** (a `fork` child) reports the output of its **last** run.
- **No report, no `out`.** A step that never started has no entry. A step that failed has an entry with no `out`. A disabled step has none.
- **Limit.** At most `RENDER_LIMITS.maxSchemaColumns` (256) columns, names cut to 120 code points. If there are more, the first 256 are kept and `schemaTruncated` is true.
- **While paused.** The `paused` event gains an optional `dataInfo: StepOutputInfo` for the value that is about to enter the step, so a pause shows the schema of its data.

**Finding the schema for a field.** The schema of the data entering a step is the `out` of the step before it. `@forge/recipe` exports a pure helper, `dataSourcePath(recipe, path)`, which returns the path of the step whose output enters `path`, or `null` when it is the bake's input:

- the nearest earlier enabled step of the same list that is not a `comment` or a `register` (a register leaves the data unchanged, so the step before it counts);
- for the first such step of a list, the data that entered the list's container: for a slot lane, the data entering the slot step; for an `if` branch, the data entering the `if`; for a `fork`, `subsection`, `repeat` or `register` child, the data entering that step. So the helper recurses upward.

For a binary step's two inputs: the left or piped input is `dataSourcePath` of the step, and the lane's value is the `out` of the **last** enabled step of the lane. Both schemas are available to the `on` field. Schemas are known up to the first failure. A step after it has none, and the field says so.

---

## 8. Pack ops

TOOLKIT §5 defines packs. A pack has a manifest with its vocabularies. Discovery, the manifest and the `init` pack ids belong to PACKS.md (SP4). This section gives the recipe side.

### 8.1 Naming

A recipe names a pack op by its **qualified name**, `vocab:word`, like any op. There is **no `pack` field** in the recipe, and no list of packs in its header. A pack's vocabulary names are unique across core and packs (P1 refuses a clash at the manifest, T18). The page learns which pack owns a vocabulary from the build-time manifest. Reasons for no header field: the vocabulary already identifies the pack; a header list could disagree with the steps and would need a rule to say which wins; and `recipe.catalogue` shows that a field recording the build's state ages badly.

### 8.2 When the pack is not enabled

Today an op that is not in the catalogue is `unknown-op`. A pack op whose pack is off should be told apart from a typo, so that the page can offer to enable the pack (TOOLKIT §5.2, P5). The validator is pure and cannot read a manifest. It gets one as an option:

```ts
interface PackIndex {
  /** vocabulary name -> id of the pack that owns it, for every pack this build knows */
  readonly vocabs: ReadonlyMap<string, string>;
  /** ids of the packs whose vocabularies are in the catalogue being used */
  readonly enabled: ReadonlySet<string>;
}
// ValidateOptions and DecodeShareOptions: …, packs?: PackIndex
```

With `packs` given, an op that is **not in the catalogue** and whose vocabulary is in `packs.vocabs` for a pack that is not in `packs.enabled` is `pack-not-enabled`, not `unknown-op`: severity error, path the `op` field, `detail { op, vocab, pack }`. No parameter or slot checks run on that step (as for `unknown-op`). Without `packs`, the issue is `unknown-op`, as today. The baker, which does not know disabled packs, always says `unknown-op`.

Two helpers, both pure and catalogue-free:

- `opVocabs(recipe) → ReadonlySet<string>`: the vocabulary of every op step and op test, enabled or not, in lanes included. P3 uses it to load the dependency closure instead of `vocabs: "all"`.
- `packsUsed(recipe, index) → readonly { pack, vocabs, paths, enabled }[]`: the packs that the recipe's ops belong to, with whether each is enabled.

### 8.3 Opening a shared recipe

`decodeShare` (RECIPES §7.3 step 7) validates the recipe. If it has errors, and **every** error is `pack-not-enabled`, the failure is a new code, `packs-needed`, and the result carries what the page needs to offer the pack and retry:

```ts
// ShareErrorCode gains "packs-needed"
// ShareError gains, for that code only:
//   recipe?: Recipe                 the decoded, structurally valid recipe
//   packs?: readonly string[]       the ids of the packs to enable
//   input?, inputName?, tabs?       what the link carried (section 11)
```

The page shows the notice of TOOLKIT §5.2 ("this recipe uses the Relix pack, first-party code on this site"), enables the pack on the owner's say-so, re-initialises the baker with the new pack ids, and validates again. If some errors are not `pack-not-enabled`, the failure is `invalid-recipe` with all the issues, as today.

### 8.4 Pins and hashes

A pack op has a catalogue `hash` like any op, and `pinRecipe` and `encodeShare` pin it. The rules of RECIPES §3.10 apply unchanged. One requirement is new: a pack whose op calls code that its FL does not hash (an engine compiled to JavaScript, for `relix`) MUST make the hash change when that code's behaviour changes. A primitive's hash covers its header and its `version` (RECIPES §3.10), so the pack declares this by including the engine's version in the `version` of each of its primitives. SP4 states it in PACKS.md and P1 tests it.

### 8.5 `recipe.catalogue` and packs

`Catalogue.version` is a content id of the ops in the catalogue in use (RECIPES §2.3). With packs it differs for each set of enabled packs, so `recipe.catalogue` would raise `catalogue-mismatch` for every reader with a different set. Recommended (Q11): the validator does not raise `catalogue-mismatch` for a recipe that has at least one op in a pack vocabulary (it needs `packs`), and `encodeShare` omits `catalogue` for such a recipe. The per-step pins are the safeguard (RECIPES §3.1).

### 8.6 Vectors for pack ops

A pack's vectors are `packs/<name>/vocab/*.test.json` (TOOLKIT §5.1). The runner (section 10) loads the pack's vocabularies before it runs them, and includes the pack's ops in `uncovered`.

---

## 9. Pins across hash changes (TOOLKIT Q10)

### 9.1 The problem

An op's `hash` covers its source and everything it calls (RECIPES §3.10). The FL v0.2 migration sweeps all 161 `.fth` files in one pass, "all 4,488 vectors must pass unchanged", and "word hashes all change" (TOOLKIT §11.5). After it, every pinned share link shows one `hash-mismatch` warning for every op (RECIPES §3.10, `pins: "warn"`), or refuses under `"strict"`. The warning is true for an op whose behaviour changed (T6 allows breaking fixes) and false for an op that only changed its spelling. A user who sees 20 warnings on every old link learns to ignore the 21st, and then the pin has stopped doing its job.

### 9.2 Recommended answer

An op in the catalogue may list **earlier hashes that still count**:

```json
{ "qname": "base64:decode", "hash": "<64 hex, current>", "previousHashes": ["<64 hex>", "<64 hex>"] }
```

- `CatalogueOp.previousHashes` is optional, at most 4 entries, each `^[0-9a-f]{64}$`, newest first, none equal to `hash`. `CatalogueOpView` gains `previousHashes?`.
- The pin check of RECIPES §3.10 passes when the pin equals `hash` **or** any entry of `previousHashes`. A pin that matches an earlier hash gives **no issue**, under all three policies. A pin that matches neither is `hash-mismatch` as today.
- `pinRecipe` ("update pins") sets the current `hash`, so the next save carries the new pin.
- The spelling of a pin does not change. Recipes, goldens and links are untouched.

**How the list is made.** At a release that changes hashes (the v0.2 sweep is the first), a script `npm run pins:compat -w @forge/ops` takes the catalogue of the previous release (built from its git tag) and the new one. For each op present in both, it records the old hash as a previous hash **iff** the op's vectors are identical in both releases (same JSON entries in the vector file) and pass in the new one, and its `effect` text is equal. It also keeps the op's own earlier previous hashes, up to the cap. The result is committed as `packages/ops/vocab/pins-compat.json` (`{ "<qname>": ["<hash>", …] }`), which `buildCatalogue` reads. An op whose vectors changed, or that is new, or whose header changed, gets none. Its old pins warn, which is the information a pin exists to give.

**What this asserts.** It asserts that no vector of the op changed. It does not assert that no behaviour changed. The authoring rules of RECIPES §9.2 (every op has vectors, one for each way it fails) are what make the assertion worth having. This is stated here so that nobody mistakes the list for a proof.

**What this does not do.** It does not select an old implementation (a pin never does, RECIPES §3.10), and it does not mark which ops changed. It only stops warning about those that did not.

### 9.3 Alternatives

| Option | Effect | Why not |
|---|---|---|
| A. Do nothing (the TOOLKIT §11.5 position) | Every old pinned link warns for every op | The pin loses its value, as above |
| B. `previousHashes` (recommended) | Only ops whose vectors changed warn | Adds a build step and an optional catalogue field |
| C. A "pin epoch" in the recipe or catalogue, and one summary message when the epoch differs | One message per link | It cannot tell a changed op from an unchanged one, so it either hides real drift or warns for all of it |
| D. Change the spelling or computation of the pin | Could survive hash changes | Not additive (section 2.2) |

---

## 10. Op test vectors with setup steps (T22)

### 10.1 The problem

A vector (RECIPES §9.1) is `{ op, params, input, expect }`. The runner builds the recipe `[ the op step ]` and bakes it on `input`. An op whose data input is a table or a relation cannot have a real vector: bytes cannot be its input, and there is no literal for a table. T22 asks for a `setup` field.

### 10.2 The new fields

A vector gains optional fields. All are validated by `vectors.schema.json`.

| Field | Type | Meaning |
|---|---|---|
| `setup` | up to 8 `op` steps | run before the op, on `input`, to make the op's data input |
| `finish` | up to 8 `op` steps | run after the op, to turn its output into something `expect` can compare |
| `inputs` | up to 8 `{ name, value, enc }` | named tabs for the bake (section 7), so that a lane can read a second tab |
| `pipe`, `left`, `right` | as in section 4 | the slots of the op under test, when it is binary. The lanes hold `op` steps only, up to 8 |

`finish` is an addition beyond T22's text and is Q12. It is the symmetric case: an op that returns a table has no byte output to compare. `setup`, `finish` and lane steps are **op steps only**: a vector tests one op, and its surroundings are a chain of ops. A step in them follows RECIPES §3.2 (ops, params, no `disabled`).

The runner builds `{ "forge": 1, "steps": [ …setup, <the op step with its slots>, …finish ] }` and bakes it with `inputs` set from the vector. The recipe's input is `input`.

```json
{
  "name": "filter keeps the rows that match",
  "ref": "hand-computed",
  "op": "table:filter",
  "params": { "expr": "age > 30" },
  "setup": [{ "kind": "op", "op": "csv:parse" }],
  "finish": [{ "kind": "op", "op": "table:to-json" }],
  "input": { "value": "name,age\nAda,36\nBo,29\n", "enc": "utf8" },
  "expect": { "value": "[{\"name\":\"Ada\",\"age\":36}]", "enc": "utf8" }
}
```

A binary op with a second tab:

```json
{
  "name": "join matches customer_id to id",
  "ref": "hand-computed",
  "op": "relix:join",
  "params": { "on": "customer_id = id" },
  "setup": [{ "kind": "op", "op": "csv:parse" }],
  "pipe": "left",
  "right": {
    "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers" } },
      { "kind": "op", "op": "csv:parse" }
    ]
  },
  "inputs": [{ "name": "customers", "value": "id,name\n1,Ada\n", "enc": "utf8" }],
  "finish": [{ "kind": "op", "op": "table:to-json" }],
  "input": { "value": "customer_id,total\n1,40\n", "enc": "utf8" },
  "expect": { "value": "[{\"customer_id\":1,\"total\":40,\"name\":\"Ada\"}]", "enc": "utf8" }
}
```

(The ops and the JSON text of the output are illustrative. The expected value of a real vector must come from outside the implementation, RECIPES §9.2 rule 1.)

### 10.3 Rules

- **Which step is under test.** The op step at index `setup.length`. A run-time error vector expects `error.path` of `/steps/<setup.length>`. An error raised inside a lane or in `setup` or `finish` has another path and is not an expected form. A static violation is still `E_RECIPE_INVALID` with path `null`.
- **Coverage.** Only `op` is covered. Ops used in `setup`, `finish` or lanes are not. The `uncovered` list is unchanged in meaning.
- **Examples.** A vector with `setup`, `finish`, `inputs` or slots cannot carry `example`: the help page shows one op on one input. `buildHelp` and `vocab/vectors.test.ts` reject it.
- **Authoring rules.** Rules 1 to 3 of RECIPES §9.2 still apply. Rule 3 (the empty, non-ASCII and binary inputs) applies to the vector's `input` where the op's *setup* accepts it, and otherwise to the setup's own vectors.
- **The schema.** `setup` and `finish` items, and lane steps, are `$ref`s to the `opStep` definition of the recipe schema (`urn:forge:schema:recipe:1`), which the runner adds to Ajv first. The runner then bakes the recipe, so the validator checks what the schema does not.
- **Pack vectors.** The runner also reads `packs/*/vocab/*.test.json` (section 8.6).

---

## 11. Share URL

### 11.1 What a link carries

A link already carries the recipe (`r`) and the main input (`i`, with `ie`). A recipe that reads other tabs (section 7) needs them too, and needs the name of the main tab if a step reads it by name. Two new keys carry these. Both are optional. Both are ignored by a v1.1 reader (RECIPES §7.1: other keys are ignored), which is safe: a recipe that names a tab is not valid there (section 16).

| key | meaning | rules |
|---|---|---|
| `n` | the name of the main input tab | optional; a payload of the UTF-8 bytes of the name (1 to 120 code points, no C0 or C1 control); **`n` without `i` is `malformed`**; written only when a step reads the main tab by name |
| `t` | the other tabs | optional; a payload of the **tab bundle** below |

The pairs of a link are now at most `v r i ie n t`, six, within `maxPairs` (8). Both keys follow the payload rules of RECIPES §7.1: a method digit, then canonical base64url.

### 11.2 The tab bundle

The inflated bytes of `t` are a sequence of entries, with no header and no padding:

```text
entry     = name-length , name , data-length , data
name-length = 2 bytes, big endian   (the length of name in bytes, 1 to 480)
name        = UTF-8
data-length = 4 bytes, big endian
data        = raw bytes (may be empty)
```

The decoder reads entries until the bytes are used up. It MUST fail with `malformed` if a length runs past the end, if the name is not well-formed UTF-8 (`TextDecoder` with `fatal: true`), if a name has fewer than 1 or more than 120 code points or has a control character, if two names are equal or a name equals `n`, if there are no entries, or if there are more than `SHARE_LIMITS.maxTabs`. The inflated size is limited by `SHARE_LIMITS.maxTabsBytes` (`too-large`), with the same budgeted inflate as the recipe (RECIPES §7.3 step 5). The encoder writes entries in order of first use in the recipe (the order of `inputNames`), and never repeats the main tab.

### 11.3 Encoding

`encodeShare(state, options)` gains in `ShareState`: `inputName?: string`, `tabs?: readonly { name: string; bytes: Uint8Array }[]`. Rules:

1. A `t` key is written **only** for tabs whose names `inputNames(recipe)` lists. A `n` key is written only when one of those names is the main tab's name. Other tabs are never carried. This is a MUST: it keeps a recipe that v1.1 can open readable by v1.1, and it keeps the user's other tabs private.
2. The names that `inputNames` lists but that are not in `state.tabs` or the main tab are not an error. The link then opens with a missing tab, which section 7.4 reports.
3. The size limits apply as for the input: `input-too-large` covers the sum of `i` and the bundle (at most `maxInputBytes` + `maxTabsBytes`), and `fragment-too-long` still applies to the whole fragment.
4. The tabs are shown in the clear in the link, as the input is (RECIPES §7.4). The share dialog must name each tab and its size, and let the user leave a tab out (Q7).

### 11.4 Decoding

Steps 1 to 3 of RECIPES §7.3 are unchanged (the pairs checks now know `n` and `t` as known keys: a repeated `n` or `t` is `malformed`). After step 4, the payloads of `n` and `t` are decoded and inflated within their budgets (`bad-base64`, `bad-compression`, `too-large`). Step 6 and 7 are unchanged for the recipe. The tabs are parsed after the recipe validates, so a bad recipe is reported first. `DecodeShareResult` ok gains `inputName?: string` and `tabs?: readonly { name; bytes }[]`.

### 11.5 Everything else

`SHARE_FORMAT_VERSION` stays 1. The `v=2` rejection (`unsupported-version`) is untouched. The share dialog says "This recipe needs Forge 1.2 or later; older versions show an error." when `recipeUsesV12` is true (section 14), and names the packs it needs (section 8). A link to a recipe that uses none of this is byte-identical to today's.

---

## 12. Bake protocol

All of it is in `packages/worker`. Section 7 gives the meaning. This section is the protocol checklist.

| Change | Where | Notes |
|---|---|---|
| `BakeOptions.inputs?: readonly BakeInput[]` | `types.ts` | section 7.2 |
| `bake` message gains `inputs?: { name: string; data: ArrayBuffer }[]` | `types.ts`, `protocol.ts` (`onlyKeys` list, a shape guard for the array), `client.ts` (copies each buffer, as it copies `input`), `port.ts` | **transferred**, like `input` |
| `PROTOCOL_VERSION` becomes **2** (Q8) | `types.ts` | `InitInfo.protocol` and `ClientMessage.init.protocol` are typed by it |
| `StepReport.out?: StepOutputInfo` | `types.ts`, `core.ts` (the `ends` hook), `render.ts` | section 7.5 |
| `BakeEvent` `paused` gains `dataInfo?: StepOutputInfo` | `types.ts`, `core.ts`, `protocol.ts` | optional: a client may ignore it |
| `BAKE_INPUT_LIMITS = { maxInputs: 32, maxInputNameChars: 120 }` and `RENDER_LIMITS.maxSchemaColumns = 256` | `types.ts`, `render.ts` | |
| the input host for `relix:input` | `core.ts`, `ops` (`input-host.ts`, as `magic-host.ts`) | section 7.3 |
| the baker's early tab check | `core.ts` | section 7.4, a SHOULD |
| `init` | unchanged here | the pack ids of `init` are PACKS.md's (SP4, P2). If they land in this wave, the same bump covers them |

**Why the protocol is bumped.** The v1.1 worker refuses a `bake` message with an `inputs` key and answers `fatal` (observed, section 2.1). A page and a worker from different builds (a cached worker chunk after an update) would fail on the first bake with that message. With `protocol: 2`, the same mismatch fails at `init` with `E_PROTOCOL`, which the page already shows. RECIPES-1.1 kept `1` because its change was an optional field of a worker message that an old client could ignore. This one is a request field that an old worker rejects.

**What does not change.** `BakeError` has no new code. `BakeResult` has no new top-level field. `RegisterView`, cancellation, the watchdog, limits and trust (RECIPES §8.5, §8.6) are unchanged. The in-process baker and the client implement the same interface.

---

## 13. Internal vocabularies: the §2.2 correction

TOOLKIT §2.3 and §15 say that RECIPES §2.2 and R18 name two internal vocabularies (`recipe`, `bake`) while `INTERNAL_VOCABS` holds six. Checked on 2026-11-23:

- `INTERNAL_VOCABS` in `packages/ops/src/types.ts` holds **eight**: `recipe`, `bake`, `util`, `blockmode`, `random`, `list`, `json`, `asn1`.
- Rule 2 of §2.2 already listed all eight, in that order, but gave no reason for any, and so read as if the list were a second source of truth.
- R18 and R23 name `recipe` and `bake` only. They say what is internal and why, and that is correct as far as it goes.
- TOOLKIT's "six" is itself out of date (it lacks `json` and `asn1`).
- The `raise` vocabulary no longer exists (its words became `fail-coerce` and `fail-range` in `core`), so a reader of PLAN.md §7 should not look for it.

The edit to RECIPES.md (the only one made by this work package) is in rule 2 of §2.2: it says what each of the eight is for, says that the constant is the authority and wins if the list differs, says why `clock` is not internal, and says that `raise` is gone. R18 and R23 are not edited. A test that fails when RECIPES §2.2 and the constant disagree is a possible follow-up and is not required.

---

## 14. Lists: issue codes, limits, types, catalogue and protocol fields

### 14.1 Issue codes (RECIPES §3.7)

| code | severity | when | `detail` |
|---|---|---|---|
| `bad-slot` | error | a slot key on an op that is not binary; the piped slot also present; the slot parameter in `params` | `reason` (`not-binary`, `piped-slot-present`, `slot-in-params`), `op`, `slot?` |
| `missing-slot` | error | a slot that must be present is absent, a lane has no enabled step, or a binary op has no slot keys | `slot?`, `reason` (`absent`, `empty`, `no-slots`), `op?` |
| `unused-pipe` | warning | a slot step with no `pipe` after other enabled steps of its list | `op` |
| `pack-not-enabled` | error | an op not in the catalogue, in a vocabulary of a known pack that is off (needs `ValidateOptions.packs`) | `op`, `vocab`, `pack` |

Existing codes with new uses: `bad-param` (an ext string that is not a string, is too long, or has a lone surrogate); `bad-position` (a `return` in a slot lane: `containerKind: "op"`, new `detail.slot`); `bad-value`, `type`, `required`, `unknown-field` (the shape of `pipe` and of a slot); `limit` (steps, depth, size); `hash-mismatch` (now silent for a pin in `previousHashes`).

### 14.2 Limits

| limit | value | where |
|---|---|---|
| ext string | 4096 code points | `RECIPE_LIMITS.maxExtChars` |
| steps and depth | unchanged (500, 8); slot lanes count | `RECIPE_LIMITS` |
| tabs in a link | 16 | `SHARE_LIMITS.maxTabs` |
| inflated tab bundle | 1 048 576 bytes | `SHARE_LIMITS.maxTabsBytes` |
| tab name | 120 code points (480 bytes in the bundle) | `SHARE_LIMITS.maxTabNameChars` |
| named inputs in a bake | 32, name 120 code points | `BAKE_INPUT_LIMITS` |
| schema columns in a report | 256 | `RENDER_LIMITS.maxSchemaColumns` |
| `previousHashes` per op | 4 | catalogue schema |
| vector `setup`, `finish`, lane steps, `inputs` | 8 each | `vectors.schema.json` |

`maxPairs` (8) is unchanged: a link has at most six pairs.

### 14.3 Types and exports

| Package | Addition |
|---|---|
| `@forge/recipe` | `OpStep` gains `pipe?`, `left?`, `right?`; types `SlotName` (`"left" \| "right"`), `SlotLane { steps }`, `PackIndex`, `PackUse`; `RECIPE_ISSUE_CODES` and `RECIPE_LIMITS` as above; `SHARE_LIMITS` as above; `ShareErrorCode` gains `"packs-needed"`; `ShareError` gains `recipe?`, `packs?`; `ShareState` gains `inputName?`, `tabs?`; `DecodeShareResult` ok gains `inputName?`, `tabs?`; `ValidateOptions.packs?`, `DecodeShareOptions.packs?`; `CatalogueOpView` gains `slot?`, `previousHashes?` |
| `@forge/recipe` | functions `recipeUsesSlots(recipe)`, `recipeUsesV12(recipe, { catalogue?, packs? })`, `inputNames(recipe)`, `dataSourcePath(recipe, path)`, `opVocabs(recipe)`, `packsUsed(recipe, index)`; constants `NAMED_INPUT_OP`, `NAMED_INPUT_PARAM`, `SLOT_NAMES` |
| `@forge/worker` | `BakeInput`, `BakeOptions.inputs`, `StepOutputInfo`, `SchemaColumn`, `StepReport.out`, `BakeEvent.paused.dataInfo`, `BAKE_INPUT_LIMITS`, `RENDER_LIMITS.maxSchemaColumns`, `PROTOCOL_VERSION = 2` |
| `@forge/ops` | `CatalogueOp.slot?`, `CatalogueOp.previousHashes?`, `SLOT_KINDS`; the catalogue schema allows both; `vectors.schema.json` gains the fields of section 10 |

`recipeUsesV12` is true iff `recipeUsesSlots` is true, or `inputNames` is not empty, or (with `catalogue`) some op step has an `ext` parameter given a value, or (with `packs`) some op is in a pack vocabulary. With no options only the first two tests run. It decides the sentence of the share dialog (section 11.5). `recipeUsesV11` is unchanged.

Source-breaking members, for code that switches exhaustively: `ShareErrorCode` `"packs-needed"`, and the `PROTOCOL_VERSION` literal type. The `ext` members of X1 and X2 are not new here.

### 14.4 Catalogue

- `ParamSpec.kind` (X1, T18), `ParamType "ext"` (X1).
- `CatalogueOp.slot?: string` (section 4.5).
- `CatalogueOp.previousHashes?: string[]` (section 9.2).
- Rule 4 of RECIPES §2.2: an `ext` parameter counts only for a kind registered with `fromText`.
- The catalogue `version` is a hash of `JSON.stringify(ops)` (RECIPES §2.3), so adding either field to an op changes the version, as any change to an op does.

---

## 15. Conformance cases (CR201 to CR252)

The cases of RECIPES §12.8 are CR101 to CR138. These continue the numbering. Each case is a fenced block with the info string `recipe-proposed` while its feature does not exist (RECIPES-1.1 did the same). When a case is implemented its fence becomes `recipe-case` and RECIPES §12.8 style takes over. The sections of a block are those of RECIPES §12.8 (`@catalogue`, `@recipe`, `@issues`, `@canonical`, `@text`, `@parse`, `@input`, `@output`, `@error`).

**The catalogue of these cases** is the shipped catalogue plus a fixture, written by hand with arbitrary hashes. Its ops:

| op | signature | notes |
|---|---|---|
| `relix:input` | `( any tab:str -- ext{relation} )` | a source |
| `relix:select` | `( ext{relation} expr:ext{relix-expr} -- ext{relation} )` | unary |
| `relix:join`, `relix:left-join` | `( ext{relation} right:ext{relation} on:ext{relix-expr} -- ext{relation} )` | binary, `slot: "right"` |
| `relix:union` | `( ext{relation} right:ext{relation} -- ext{relation} )` | binary, `slot: "right"`, no other parameter |
| `csv:parse` | `( bytes -- ext{table} )` | |
| `table:filter` | `( ext{table} expr:ext{relix-expr} -- ext{table} )` | ext parameter |
| `table:to-json` | `( ext{table} -- str )` | |
| `fx:cat` | `( str right:str -- str )` | `slot: "right"`. A fixture binary op for the cases marked (run); its word is the core `cat` |

"(run)" marks a case whose FL text was checked by running (section 6.1). Cases marked "(fixture)" need a fixture primitive in the worker tests, because the Relix engine is not part of this wave.

### 15.1 Index

| Case | Title | Kind |
|---|---|---|
| CR201 | the orders recipe, `pipe: "left"` | valid |
| CR202 | the same recipe, `pipe: "right"` | valid |
| CR203 | a join with no pipe, first step | valid |
| CR204 | no pipe after other steps | valid, `unused-pipe` warning |
| CR205 | `pipe: "left"` and a `left` lane | invalid, `bad-slot` |
| CR206 | `pipe: "left"` and no `right` lane; no pipe and one lane | invalid, `missing-slot` |
| CR207 | a binary op with no slot keys | invalid, `missing-slot` (`no-slots`) |
| CR208 | an empty lane; a lane of only a comment | invalid, `missing-slot` (`empty`) |
| CR209 | slot keys on a unary op | invalid, `bad-slot` (`not-binary`) |
| CR210 | the slot parameter in `params` | invalid, `bad-slot` (`slot-in-params`) |
| CR211 | `pipe` that is not left or right; a slot that is not an object | invalid, `bad-value`, `type` |
| CR212 | a slot with no `steps`, and with an extra key | invalid, `required`, `unknown-field` |
| CR213 | `return` in a lane, and after the join | invalid, valid |
| CR214 | registers and lanes: visibility | valid, invalid |
| CR215 | the same register name in both lanes; a name visible at the step | valid, `duplicate-register` |
| CR216 | eight nested slot levels, and nine | valid, `limit` |
| CR217 | slot keys in an op test | invalid, `unknown-field` |
| CR218 | a disabled slot step is still checked | invalid |
| CR219 | lane steps count toward 500 | `limit` |
| CR220 | an ext parameter, a string | valid |
| CR221 | an ext parameter that is a number or an object | invalid, `bad-param` |
| CR222 | an ext string of 4096 and of 4097 code points | valid, `bad-param` |
| CR223 | an ext string with a lone surrogate | invalid, as for `str` |
| CR224 | a register supplies an ext parameter | valid |
| CR225 | a grammar error in an ext string is valid statically | valid; bakes `E_COERCE` (fixture) |
| CR226 | a pack op, pack off, with and without `packs` | `pack-not-enabled`, `unknown-op` |
| CR227 | a pack op, pack on; pin equal, in `previousHashes`, and unknown | valid; valid; `hash-mismatch` |
| CR228 | decoding a link whose only errors are `pack-not-enabled` | `packs-needed` |
| CR229 | `normalise` and `canonical` with slots | normal form |
| CR230 | an ext string is kept as written | normal form |
| CR231 | a v1.1 recipe compiles to the text it has today | compatibility |
| CR232 | compile `pipe: "left"` (run) | text, step map |
| CR233 | compile `pipe: "right"` (run) | text |
| CR234 | compile no pipe (run) | text |
| CR235 | a register inside a lane; a reference from a lane (run) | text |
| CR236 | the text of CR232 to CR235 parses to the canonical JSON, and back | round trip |
| CR237 | structure errors of the slot lines | invalid text |
| CR238 | a disabled slot step, and a breakpoint on one | text, step map |
| CR239 | a link round trip with `n` and `t` | share |
| CR240 | tab bundle errors | share, invalid |
| CR241 | a link with `n` and `t` opened by a v1.1 reader | share |
| CR242 | a bake with two inputs (fixture) | bake |
| CR243 | a missing tab, early and at run time (fixture) | bake, error |
| CR244 | invalid `inputs`: duplicate, too many, a bad name | bake, `E_PROTOCOL` |
| CR245 | the per-step schema (fixture) | bake |
| CR246 | `dataInfo` at a pause (fixture) | bake |
| CR247 | a vector with `setup` and `finish` | vectors |
| CR248 | the error path of a vector with `setup` | vectors |
| CR249 | a vector with `setup` cannot be an example | vectors, invalid |
| CR250 | a binary-op vector with a lane and `inputs` | vectors |
| CR251 | the pin cases of CR227 under `strict` | pins |
| CR252 | `previousHashes` limits: five entries, a malformed hash, equal to `hash` | catalogue, invalid |

### 15.2 Validation

```recipe-proposed
# CR201 the orders recipe, pipe left
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "base64:decode" },
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:select", "params": { "expr": "status = 'paid'" } },
  { "kind": "op", "op": "relix:join", "params": { "on": "customer_id = id" }, "pipe": "left",
    "right": { "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
      { "kind": "op", "op": "csv:parse" },
      { "kind": "op", "op": "relix:select", "params": { "expr": "country = 'NZ'" } } ] } } ] }
@issues
none
```

```recipe-proposed
# CR204 no pipe after other steps is a warning
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:union",
    "left": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
warning unused-pipe /steps/1 op=relix:union
```

```recipe-proposed
# CR205 the piped slot must be absent
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:union", "pipe": "left",
    "left": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
error bad-slot /steps/1/left reason=piped-slot-present slot=left op=relix:union
```

```recipe-proposed
# CR206 a slot that must be present is absent
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:union",
    "left": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] } },
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:union", "pipe": "left" } ] }
@issues
error missing-slot /steps/0/right slot=right reason=absent
error missing-slot /steps/2/right slot=right reason=absent
```

```recipe-proposed
# CR207 a binary op with no slot keys
@recipe
{ "forge": 1, "steps": [ { "kind": "op", "op": "relix:join", "params": { "on": "a = b" } } ] }
@issues
error missing-slot /steps/0 reason=no-slots op=relix:join
```

```recipe-proposed
# CR208 a lane needs an enabled step that is not a comment
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:union", "pipe": "left", "right": { "steps": [] } },
  { "kind": "op", "op": "relix:union", "pipe": "left",
    "right": { "steps": [ { "kind": "comment", "text": "later" },
                          { "kind": "op", "op": "relix:input", "params": { "tab": "b" }, "disabled": true } ] } } ] }
@issues
error missing-slot /steps/1/right slot=right reason=empty
error missing-slot /steps/2/right slot=right reason=empty
```

```recipe-proposed
# CR209 slot keys on a unary op, and CR210 the slot parameter in params
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:select", "params": { "expr": "a = 1" }, "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } },
  { "kind": "op", "op": "relix:join", "params": { "on": "a = b", "right": "orders" }, "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
error bad-slot /steps/0/pipe reason=not-binary op=relix:select
error bad-slot /steps/1/params/right reason=slot-in-params op=relix:join slot=right
```

```recipe-proposed
# CR213 a return in a lane is bad-position; a return after the join is valid
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:union", "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } },
                          { "kind": "return" } ] } },
  { "kind": "return" } ] }
@issues
error bad-position /steps/1/right/steps/1 kind=return container=/steps/1 containerKind=op slot=right
```

The `return` at `/steps/2` is valid and is the last step, so there is no `unreachable-step`.

```recipe-proposed
# CR214 a register above the join is visible in its params and its lane; one defined in a lane is not visible after it
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "csv:parse" },
  { "kind": "register", "name": "min-age",
    "steps": [ { "kind": "op", "op": "table:to-json" } ] },
  { "kind": "op", "op": "relix:join", "params": { "on": { "ref": "min-age" } }, "pipe": "left",
    "right": { "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": { "ref": "min-age" } } },
      { "kind": "register", "name": "inner", "steps": [] } ] } },
  { "kind": "op", "op": "relix:select", "params": { "expr": { "ref": "inner" } } } ] }
@issues
error unknown-register /steps/3/params/expr/ref register=inner reason=out-of-scope
```

```recipe-proposed
# CR215 two lanes may reuse a name, a name visible at the step may not be bound in a lane
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "x", "steps": [] },
  { "kind": "op", "op": "relix:union",
    "left": { "steps": [ { "kind": "register", "name": "y", "steps": [] },
                         { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "right": { "steps": [ { "kind": "register", "name": "y", "steps": [] },
                          { "kind": "register", "name": "x", "steps": [] },
                          { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
error duplicate-register /steps/1/right/steps/1/name register=x first=/steps/0
warning unused-pipe /steps/1 op=relix:union
```

CR216, CR219: generated recipes (eight and nine nested slot levels of `relix:union`; 501 steps with part of them in lanes). The expected issues are none and `limit` (`maxDepth` 8, `maxSteps` 500), and the pre-walk depth is under 64 for the eight-level case.

### 15.3 Ext parameters

```recipe-proposed
# CR220 an ext parameter is a string; CR221 it is nothing else; CR222 it has a length limit
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "table:filter", "params": { "expr": "age > 30 and name <> \"Bob\"" } },
  { "kind": "op", "op": "table:filter", "params": { "expr": 30 } },
  { "kind": "op", "op": "table:filter", "params": { "expr": { "value": "a", "enc": "utf8" } } } ] }
@issues
error bad-param /steps/2/params/expr param=expr reason="expected a string"
error bad-param /steps/3/params/expr param=expr reason="expected a string"
```

```recipe-proposed
# CR224 a register supplies an ext parameter; CR225 text that is not valid Relix is valid here
@recipe
{ "forge": 1, "steps": [
  { "kind": "register", "name": "test", "steps": [ { "kind": "op", "op": "table:to-json" } ] },
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "table:filter", "params": { "expr": { "ref": "test" } } },
  { "kind": "op", "op": "table:filter", "params": { "expr": "age >>" } } ] }
@issues
none
```

CR222: `expr` of 4096 code points is valid; 4097 is `bad-param` with `constraint="length <= 4096"`, counting code points (a string of 4097 astral characters is 4097, not 8194). CR223: the lone surrogate has the code and message that a `str` parameter gets.

### 15.4 Packs and pins

```recipe-proposed
# CR226 a pack op with its pack off
@catalogue
shipped, without the fixture ops, packs = { vocabs: { relix: "relix" }, enabled: [] }
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:select", "params": { "expr": "a = 1" } },
  { "kind": "op", "op": "nosuch:thing" } ] }
@issues
error pack-not-enabled /steps/0/op op=relix:select vocab=relix pack=relix
error unknown-op /steps/1/op op=nosuch:thing
```

Without `packs`, the first line is `error unknown-op /steps/0/op`.

CR227: with the pack on, a pin equal to `hash` or in `previousHashes` gives no issue, and any other pin gives `warning hash-mismatch` (`error` under `strict`, CR251). CR228: `decodeShare` of a link to the recipe of CR226, given `packs`, returns `ok: false`, `error.code: "packs-needed"`, `error.packs: ["relix"]` and the decoded recipe. With a second, unrelated error, it returns `invalid-recipe`.

### 15.5 Normal forms

```recipe-proposed
# CR229 the key order of a slot step; the slot parameter is not made explicit
@recipe
{ "forge": 1, "steps": [ { "right": { "steps": [ { "op": "relix:input", "kind": "op", "params": { "tab": "b" } } ] },
  "note": "join", "pipe": "left", "params": { "on": "a = b" }, "op": "relix:join", "kind": "op" } ] }
@canonical
{"forge":1,"steps":[{"kind":"op","op":"relix:join","params":{"on":"a = b"},"pipe":"left","right":{"steps":[{"kind":"op","op":"relix:input","params":{"tab":"b"}}]},"note":"join"}]}
```

The key order is `kind op params hash pipe left right` and then `disabled breakpoint note`. CR230: `"age>30"` and `"age > 30"` stay as written, in `normalise` and in `canonical`.

### 15.6 Text and step map

```recipe-proposed
# CR232 pipe left (run, with the fixture op fx:cat)
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "text:upper" },
  { "kind": "op", "op": "fx:cat", "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "text:lower" } ] } } ] }
@text
\ forge-recipe 1
: main ( bytes -- any )
  text:upper
  [
    text:lower
  ] recipe:peek
  fx:cat
;
@lines
/steps/0 3-3 op
/steps/1 4-7 op
/steps/1/right/steps/0 5-5 op
```

CR233 and CR234 give the closers `] recipe:peek swap` (lane under `left`) and, for no pipe, `] recipe:peek swap` and `] recipe:peek nip` with the `fx:cat` line after both. CR235: a register above the step and read in the lane, and a register inside a lane, load and give `"DQR"` and `"QLD"` as in section 6.1. CR236: each of those texts parses to the canonical JSON of its recipe, with `fx:cat` matched to its parameters after the slot parameter, and compiles back to the same text. CR238: a disabled slot step has every line prefixed `\ ~ `, with no instruction, and `@break` on the op line of an enabled slot step gives a breakpoint at the first instruction of its first lane.

CR237, the structure errors, each `bad-value` with `constraint: "block structure"` and `detail.line`:

| Text | Why |
|---|---|
| a lane closed with `] recipe:peek` and then `;` | a pending lane with no op line |
| a lane closed with `] recipe:peek` and then a `\ #` comment | only a lane or the op line may follow |
| `] recipe:peek nip` as the first lane | `nip` follows a `swap` lane |
| `] recipe:peek swap`, then `] recipe:peek swap`, then the op | a second `swap` |
| three lanes | too many |
| a lane at level 0 and its op line at level 1 | the levels must agree |

### 15.7 Share

CR239: a recipe with `relix:input` steps for `orders.csv` (the main tab) and `customers.csv` (another tab) is encoded with `i`, `n` (the name `orders.csv`) and `t` (one entry, `customers.csv`) and decodes to the same recipe, `inputName`, input bytes and tab. Entries come in the order of `inputNames`. Tabs not named by a step are not carried.

CR240, each a `decodeShare` result:

| Fragment | Result |
|---|---|
| `n` without `i` | `malformed` |
| `t` whose bundle has a length past its end; has no entries; has two equal names; has a name equal to `n`; has a control character in a name; has 17 entries | `malformed` |
| a bundle that inflates past `maxTabsBytes` | `too-large` |
| a bundle name that is not UTF-8 | `malformed` |
| a repeated `t` | `malformed` |

CR241: the fragment of CR239, opened by the v1.1 code, is `invalid-recipe` (the issues of the slot keys or `unknown-op`), and not a different recipe. The fragment of a recipe that v1.1 can open, with an added `n` and `t`, opens as before (observed, section 2.1).

### 15.8 Bake and vectors

- **CR242 (fixture).** Two inputs, `orders` and `customers`. A recipe reads `customers` through `relix:input` in a lane and joins it with the data above, with `fx:cat` and a fixture source. The output uses both tabs.
- **CR243 (fixture).** `relix:input` of `"missing"` with `inputs` of `orders`: the early check gives `E_PARAM_INVALID path=/steps/0 detail.param=tab detail.reason=no-such-input detail.tab=missing detail.tabs=["orders"]` before step 0 runs (`steps` is empty). With the early check off, the primitive gives the same error and `steps` has the step. A tab supplied by a register adds `detail.register`.
- **CR244.** `inputs` with two entries named `a`: `E_PROTOCOL` with `detail.reason: "input-duplicate"`. 33 entries: `input-count`. A name with a control character: `input-name`. None of them runs a step.
- **CR245 (fixture).** After `csv:parse`, `StepReport` for `/steps/0` has `out: { tag: "ext", kind: "table", schema: [...] }`. A `fork` child that runs three times reports its last output. A failing step has no `out`, and a step after it has no report. A table of 300 columns has 256 and `schemaTruncated: true`.
- **CR246 (fixture).** A pause before `/steps/1` has `dataInfo` equal to the `out` of `/steps/0`.
- **CR247 to CR250.** The vectors of section 10.2 pass; an error vector with `setup` of length 1 expects `path: "/steps/1"`; a vector with `setup` and `example` is refused by `buildHelp` and the vector test; the binary-op vector passes with its lane and `inputs`.
- **CR252.** A catalogue op with five `previousHashes`, with a hash that is not 64 hex digits, or with one equal to `hash` fails the catalogue schema.

---

## 16. What an old reader does

An old reader means any code that implements recipe format v1.1 (this repository before this wave, an editor plugin, a converter). The first column is a new feature. "Observed" means run in section 2.1.

| New feature | What a v1.1 reader does | Safe? |
|---|---|---|
| `pipe`, `left` or `right` on an op step | `unknown-field` at the key (observed). A recipe with slots is `invalid-recipe` | Yes: it fails closed |
| an op from the Relix pack or other new vocabulary | `unknown-op` (observed for `relix:join`) | Yes |
| an ext parameter string | not reachable: the op is unknown. If a v1.1 reader were given a catalogue with one, `bad-param` (observed) | Yes |
| the text of a slot step | `bad-value`, "expected ] followed by fork, …" (observed) | Yes |
| `n` and `t` in a link | ignored (observed). Safe because the writer MUST NOT write them unless the recipe names a tab (section 11.3), and such a recipe is invalid in v1.1 | Yes |
| a `bake` message with `inputs` to a v1.1 worker | refused by the message guard, answered `fatal` (observed). With `protocol: 2`, `init` fails first with `E_PROTOCOL` | Yes |
| a `previousHashes` field in a catalogue | an old build does not read a catalogue it was not built with | n/a |
| a vector with `setup` | an old runner rejects the file against its schema (`additionalProperties: false`) | Yes |
| the new issue codes | an old reader never emits them | n/a |

The messages are less explicit than a version error would be. That was accepted for v1.1 (RECIPES A.11) and is accepted again here (Q1). The share dialog states the requirement before the link is made.

A **new reader** reads every v1 and v1.1 recipe, text and link unchanged. Their canonical JSON, text and fragments do not change, and the goldens of RECIPES §12 and the cases CR101 to CR138 stand.

---

## 17. Open questions, with recommended answers

The owner decides these at Gate T1. Each has a recommended answer, which this document assumes.

**Q1. Is the wave v1.2 (`"forge": 1`) or 2.0?** Recommended: **v1.2, `"forge": 1`.**

- *Why.* Section 2 finds every item additive: no v1.1 recipe changes meaning, and every new construct fails closed. The 1.1 precedent (R29) applies. The facts do not call for a bump.
- *If v1.2.* One number stays on every recipe, text, link and golden. A new Forge writes recipes that older Forge refuses with `unknown-field`, `unknown-op` or `bad-value`, not with `bad-version`. The share dialog warns the author first. This file is `RECIPES-1.2.md`. At fold-in, RECIPES.md gains Appendix B, "Changes in v1.2", as Appendix A did for v1.1.
- *If 2.0.* The owner might want it for a clearer old-reader message (`bad-version`), and for one name for "the Relix wave". If a bump is made it should be a **minimum-version writer**: `forge` is written as 1 unless the recipe uses a v1.2 feature (`recipeUsesV12`), so that a plain byte recipe saved by a new Forge still opens in every old one. The rules to add: the schema `forge` becomes `{ "enum": [1, 2] }` and the schema `$id` a second one; `bad-version` fires for any other value; `normalise` sets `forge` to the minimum that the recipe needs, and so a recipe written as `forge: 2` that uses no new feature normalises to 1 (one spelling per recipe); the text header is `\ forge-recipe 2` only for such recipes, and the parser accepts both; `v=` of the share link stays 1; CR101 to CR138 and the goldens stay valid because the writer emits 1 for them. Added cost: the version rule in `normalise`, the schema, the text header, `bad-version` cases, and a second `forge` value in every tool that reads the format. A fixed `forge: 2` writer (no minimum rule) would make every recipe from the new Forge unreadable by every old Forge, plain ones included, and is not recommended.
- *Either way.* The file is renamed `RECIPES-2.0.md` if 2.0 is chosen. Nothing else in sections 3 to 12 changes except the points above.

**Q2. How does the catalogue mark a binary op?** Recommended: **derived**. `buildCatalogue` sets `CatalogueOp.slot` when the data input and the first parameter are both `ext{relation}` (section 4.5), and RELIX.md writes its wrappers that way. The alternative is a `META:` clause such as `slot right ;`, which is explicit but is an FL change (LANGUAGE v0.2, SP1) and a second place that must agree with the header.

**Q3. May a slot lane start with something other than a source?** Recommended: **yes** (RELIX-LANES Q5). A lane runs on a copy of the data entering the step (section 4.3). A source op ignores it. The editor may still insist that its own gestures start a lane with a source.

**Q4. Is `pipe` on a first step an error?** Recommended: **no.** It is valid and has the meaning of section 4.6. The editor keeps its normal form (RELIX-LANES §2.3 rule 1) and clears it. The alternative is a `bad-slot` code, which needs the validator to know what "first" means once comments and registers are in the list, for little gain.

**Q5. N-ary union, FIX and ITERATE (RELIX-LANES Q2 and Q3).** Recommended: **two slots only.** An N-ary union is a chain of `relix:union` steps. FIX and ITERATE are out of the format: their step lane is a loop body (like `repeat`), a second kind of slot with another rule for its input. A later wave can add named slots next to `left` and `right`, because a slot is a lane object.

**Q6. May a register be a slot's source (RELIX-LANES Q6)?** Recommended: **no.** A reference is accepted in `params` only (RECIPES §3.4). Use a saved relation, or `relix:input` of a tab. A "register as source" step is a possible later addition and would not change anything here.

**Q7. What does a share link carry of the other tabs?** Recommended: **only the tabs a `relix:input` step names, offered by the dialog with the name and the size of each, selected by default**, because a link to a recipe that reads a tab it does not carry cannot be run. The user can deselect any. The writer MUST NOT carry other tabs (section 11.3). The alternative is to carry no tabs and let the opener supply them, which makes every shared join unrunnable until the opener finds the data.

**Q8. Bump `PROTOCOL_VERSION` to 2?** Recommended: **yes** (section 12). The alternative is to keep 1 and accept a `fatal` on a skewed build. The bump is a contract change at Gate T1 with the other `packages/worker` changes.

**Q9. Is there a `packs` field in the recipe?** Recommended: **no** (section 8.1). Pack ops are named by their qualified names, `PackIndex` tells the validator which vocabularies are in a pack that is off, and a link that needs a pack is a `packs-needed` failure that carries the recipe. The alternative is a header field `"packs": ["relix"]`. It would let the page offer the pack without a catalogue lookup, at the cost of a second source of truth.

**Q10. Pins across hash changes (TOOLKIT Q10).** Recommended: **`previousHashes`** (section 9). Only ops whose vectors are identical in both releases get one, and an old pin to such an op is silent. The alternatives are in section 9.3. The owner confirms before the v0.2 sweep, because the script has to run on the pre-sweep tag.

**Q11. `recipe.catalogue` and packs.** Recommended: **the validator skips `catalogue-mismatch` for a recipe that has an op in a pack vocabulary, and `encodeShare` omits `catalogue` for it** (section 8.5). The alternative is to leave the warning, which fires for every reader with a different set of packs on.

**Q12. Add `finish` beside `setup` in vectors?** Recommended: **yes** (section 10.2). T22 names only `setup`. Without `finish`, an op that returns a table cannot have a vector, and `table:to-json` has to be the op under test for every such case.

**Q13. Where does the per-step schema travel?** Recommended: **in `StepReport.out` of the final result, and in `dataInfo` of the `paused` event** (section 7.5). The alternative is a progress event per step, which costs one message per step. The editor can recompute from the last result.

**Q14. Does the validator report `slot-type` (RELIX-LANES §8)?** Recommended: **no.** The validator tracks no types. `fit.ts` shows the badge and the traffic light, and `E_TYPE` at run time is attributed to the step.

**Q15. Are ext strings normalised?** Recommended: **no** (section 3.4). The format has no `toText`. A page action can tidy a string through the kind.

---

## 18. Work packages

Ids have the prefix RW (recipe wave). "Maps to" says which TOOLKIT row or RELIX-LANES package the work package is or overlaps. All packages: Apache header on every new file, the CSP rules of UI.md §4, `npm run lint && npm run typecheck && npm test && npm run build` pass, and no edits outside owned paths. Packages that change `packages/*` start only after Gate T1. Agents: So is Sonnet, Ha is Haiku (CLAUDE.md).

| WP | Scope | Files | Depends on | Maps to | Agent | Done when |
|---|---|---|---|---|---|---|
| RW1 | The model for slots: types, `RECIPE_ISSUE_CODES` and limits, the schema (`opStepAdditions`), the validator rules and codes of section 5.2, `normalise`, `resolve`, `pinRecipe`, `registersInScope`, `registerInfo`, `recipeNeedsHardKill`, `recipeUsesSlots`, `recipeUsesV12`, `dataSourcePath`, `inputNames`; the corpus `packages/recipe/test/corpus/v12/{valid,invalid,validator-only}/` | `packages/recipe/src/*`, `recipe.schema.json`, `test/corpus/v12/` | Gate T1 | RELIX-LANES RL1; the format half of X3 and X5 | So | Schema and validator agree on the corpus; every v1 and v1.1 recipe, golden and case CR101 to CR138 unchanged; CR201 to CR219 hold; a v1.1 reader refuses a recipe with slots (the corpus runs against a copy of the v1.1 validator) |
| RW2 | Ext parameters in the recipe layer: `checkParamValue` `case "ext"`, `maxExtChars`, the coercion row, resolve default, text parsing of an ext literal | `packages/recipe/src/validate.ts`, `normalise.ts`, `text.ts`, `types.ts` | X1 (`ParamSpec.kind`), RW1 | X3 (recipe half) | So | CR220 to CR225, CR230 hold; `@forge/recipe` has no kind registry (a test greps for one) |
| RW3 | Compilation, step map and text for slots: the three forms, the pending-lane parser, `StepLine` ranges, round trips | `packages/recipe/src/compile.ts`, `text.ts`, `stepmap.ts`, tests including the (run) cases on a real runtime in `packages/ops/src/recipe.test.ts` | RW1 | RL6 (compiler half) | So | CR231 to CR238 hold; CR232 to CR235 run on a real runtime with the fixture `fx:cat`; `compileRecipe` of a recipe with no slot step is byte-identical to today's |
| RW4 | The catalogue: `CatalogueOp.slot`, `previousHashes`, `SLOT_KINDS`, rule 4 for `ext`, the schema, `pins-compat.json` loading | `packages/ops/src/catalogue.ts`, `types.ts`, `catalogue.schema.json`, `catalogue.test.ts` | X1 | X1 (catalogue part), P1 | So | `slot` is set for the fixture binary ops and for no other op; `previousHashes` limits (CR252); `version` changes accordingly |
| RW5 | The bake protocol: `inputs`, `PROTOCOL_VERSION` 2, the input host, the early tab check, `StepReport.out`, `dataInfo`, limits, the message guards, `core`, `client`, `port` | `packages/worker/src/*` | RW1, X1 (`ExtKind.schema`) | X5 | So | CR242 to CR246 hold; a `protocol: 1` client gets `E_PROTOCOL` at `init`; the in-process baker, the client and the Node host pass the same tests |
| RW6 | Share: `n`, `t`, the bundle codec, `packs-needed`, `PackIndex`, `opVocabs`, `packsUsed`, limits | `packages/recipe/src/share.ts`, `types.ts`, `index.ts` | RW1 | P5 (the codec half), P3 (`opVocabs`) | So | CR226 to CR228, CR239 to CR241 hold; the hostile-fragment cases of RECIPES §7.5 still pass; a v1.1 fragment is decoded as before |
| RW7 | Pins: `previousHashes` in the pin check; the script `pins:compat` and its test | `packages/recipe/src/validate.ts`, `packages/ops/scripts/pins-compat.ts`, `vocab/pins-compat.json` | RW4, and the v0.2 sweep (SP1 and T2) for the first real run | TOOLKIT Q10 | So | CR227 and CR251 hold; the script's output on two fixture catalogues is tested |
| RW8 | Vectors: `setup`, `finish`, `inputs` and slot fields in `vectors.schema.json`; the runner; help rules; pack vector discovery | `packages/worker/src/vectors.ts`, `packages/ops/vocab/vectors.schema.json`, `vocab/vectors.test.ts`, `buildHelp` | RW1, RW5 | T22 | So | CR247 to CR250 hold; an existing vector file is unchanged and passes |
| RW9 | The fold-in: RECIPES.md sections 2.2, 3, 5, 6, 7, 8, 9 and 12, a new Appendix B, UI.md §2.3 pointers, and this file becomes a historical note (as RECIPES-1.1.md did) | `docs/RECIPES.md`, `docs/RECIPES-1.2.md` | RW1 to RW8 | as WP 6.41 | So | the "where each piece goes" table below is complete; the cases of section 15 are `recipe-case` blocks with their tests named |
| RW10 | The web app's format-facing work: share dialog notes and the tab and pack lists, the enable offer, `fit` for slot lanes, the issue texts for the new codes, the missing-tab text | `apps/web/src/*` | RW1, RW5, RW6 | RL2 to RL7 (the editor), P4 and P5, X3 (UI half) | So | the editor packages of RELIX-LANES §11.2 own the gestures. This package adds the texts and the dialogs, and passes axe |

RW2, RW4 and RW5 touch different packages and can run in parallel after RW1, in separate worktrees. RW3 and RW6 touch `packages/recipe` files that RW1 owns, so they follow RW1's merge. RW7 waits for the sweep to have a real second catalogue, but its script can be built and tested earlier on two fixture catalogues.

**Where each piece goes in RECIPES.md at the fold-in.**

| Piece | Section |
|---|---|
| `ext` parameter type | §2.2 rule 4, §3.4 table, §3.7 (`bad-param`), §3.8 |
| slots: model, JSON, rules | §3.2 (a paragraph under `op`), §3.7 (new codes), §3.8, §3.9 |
| slots: compilation, map, text | §5.3, §5.5, §6.2, §6.3, §6.4 |
| `CatalogueOp.slot`, `previousHashes` | §2.3 and the catalogue schema; §3.10 |
| named inputs, `StepReport.out` | §8.2, §8.4, §8.8 |
| pack ops | §3.7 (`pack-not-enabled`), §7.3, §8.2 |
| `n`, `t`, `packs-needed` | §7.1, §7.3 |
| vectors | §9.1, §9.2, §9.3 |
| conformance cases | §12.9 (CR201 to CR252) |
| the summary | Appendix B, "Changes in v1.2" |

**Requirements on RELIX.md (SP6).** The recipe mechanics need these of the Relix words. SP6 owns everything else.

1. Every binary operator has the header `( ext{relation} right:ext{relation} … -- ext{relation} )`: the data input and the first parameter are `relation`, the first parameter is the slot parameter (section 4.5).
2. `relix:input` has the header `( any tab:str -- … )`, matches `tab` exactly, and ignores its data input (section 7.1).
3. The kinds are `table`, `relation` and `relix-expr`. `relix-expr` has a `fromText` and a `schema`-aware parser module shared by the worker and the page (T20). `relation` has a text form.
4. A primitive that calls the engine includes the engine's version in its `version` (section 8.4).
5. SP6 states which coercions between `table` and `relation` happen at a word boundary, because a lane may end in either.

---

## 19. What other documents need

This work package changes only this file and the §2.2 rule of RECIPES.md. The other documents need these edits.

**TOOLKIT.md**

- §2.3 (Blockers), "Doc drift" row, and §15, RECIPES bullet: `INTERNAL_VOCABS` holds eight vocabularies, not six, and the §2.2 correction is done (section 13). §11.6, the "Public not an op" row, says "six internal vocabularies in code": eight.
- §2.3, "Recipe shape" row: "Parameters cannot be trees" becomes "slots" (section 4).
- §8.2, the "Binary operators" bullet: replace "a relation-valued parameter … The recipe format needs parameters that can be trees (RECIPES v2)" by slots (`pipe`, `left`, `right`) and "the next wave of the recipe format, proposed as v1.2". The slot parameter is not in `params`.
- §13.3, row SP2: the deliverable is first a proposal, `docs/RECIPES-1.2.md` (or `RECIPES-2.0.md`), and RECIPES.md changes at the fold-in (RW9). "Depends on SP1" is not needed for this proposal.
- §13.5, rows X3 and X5: add the per-step schema (`StepReport.out`, `dataInfo`, section 7.5), `PROTOCOL_VERSION` 2 and `BakeOptions.inputs`; X3 depends on RW2 and X5 on RW5. Row P5 needs `packs-needed` and `PackIndex` (RW6), and P3 `opVocabs`. Add the RW rows or point to section 18.
- §14.2, Q10: add the recommended answer of section 9. Add the open questions of section 17 that the owner decides at Gate T1, and record the answers as T23 onward.
- §14.1: a new risk, "a catalogue that depends on the enabled packs (`catalogue-mismatch`, section 8.5)".
- §3: when Gate T1 decides, record the version decision (Q1) as a T-id.

**RELIX-LANES.md**

- §9.1 and §9.2: the JSON becomes the real shape of section 4.4: `"forge": 1`, no `format` or `version: "2.0-draft"`, `"kind": "op"` on every step, and the catalogue names. Delete "what this sketch simplifies" or reduce it to a pointer to this file.
- §9.3 and Q7: the wave is v1.2 and keeps `"forge": 1` (Q1 of this file). The confirmation run it asked for is section 2.1.
- §2.3: rules 1 and 2 of the normal form are editor rules. Rules 3 and 4 are validator rules, with these codes. A `pipe` on a first step is valid.
- §8, new issues: `bad-pipe` is merged into `bad-slot`; `missing-slot` also covers an absent slot and a binary op with no slot keys; `unused-pipe` is as proposed; `slot-type` is dropped from the validator.
- §8.1: a register at the top of a lane has data (the copy of the data entering the step), so the proposed validator report for it is dropped. A `return` in a lane has `containerKind: "op"` and `slot`.
- §2.1 and Q5: a source is an op that ignores its data input (`relix:input` takes `any`), and a lane need not start with one.
- §11.2: RL1 is RW1, with RW3 (compilation) and RW6 (share); RL6's compiler half is RW3.
- Q2, Q3 and Q6: the answers are in Q5 and Q6 of this file.

**UI.md (SP3)**

- §2.3: the share dialog sentence for the new wave, the tab and pack lists, the missing-tab and `pack-not-enabled` texts, and the use of `StepReport.out` for the ext field. Not part of this work package.

**PLAN.md**

- The Phase table and decisions gain the rows of section 18 when the owner approves the proposal, as WPs 6.34 to 6.41 did for 1.1.
