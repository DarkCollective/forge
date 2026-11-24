# Recipe format v1.2: the Relix wave

Status: **approved at Gate T1 on 2026-11-23.** It is still to be folded into [RECIPES.md](RECIPES.md) after implementation (work package RW9). Until the fold-in, RECIPES.md is the specification of v1 and v1.1, and this file is the specification of the v1.2 additions. Where the two differ on a v1.2 feature, this file wins. This is work package SP2 of the toolkit programme ([TOOLKIT.md](TOOLKIT.md) §13.3). It followed the precedent of [RECIPES-1.1.md](RECIPES-1.1.md): a separate proposal first, approval by the owner, implementation by work packages, and only then a fold-in into RECIPES.md. The owner's answers to the open questions are recorded in section 17. The one edit made to RECIPES.md by this work package is the §2.2 correction of section 13. Section 8.5, the lists of sections 12 and 14 and Q11 of section 17 were amended at Gate T1 on 2026-11-24 by PACKS.md decision PK9, and each says so.

The file name follows decision Q1 (v1.2, `"forge": 1` stays). The file keeps its name.

It builds on [RECIPES.md](RECIPES.md) (§2.2 what makes a word an op, §3 recipe JSON v1 and v1.1, §3.7 issues, §5 compilation, §6 canonical text, §7 share URL, §8 bake API, §9 op test vectors, §12 conformance, Appendix A), on [TOOLKIT.md](TOOLKIT.md) (§3 decisions T1 to T22, §5 packs, §6 and §7 extension values and the table, §8 the Relix pack, §13.5 rows X3, X5 and P1 to P8, §14.2 Q10), on [RELIX-LANES.md](RELIX-LANES.md) (the design for slots, made normative here) and on [research/x0-ext-values.md](research/x0-ext-values.md) (§6 ext parameters, §10, §11). The names of Relix words, parameters and value mappings belong to [RELIX.md](RELIX.md) (SP6, also approved at Gate T1). This document owns the recipe-format mechanics only. Names used from SP6: the source ops `relix:input` (it reads and parses a tab: parameters `tab`, `format` and `header`), `relix:inline`, `relix:from`, `relix:run` and `relix:recur`; the ext kinds `table`, `relation` and `relix-expr`; binary operators such as `relix:theta-join`, `relix:left-join` and `relix:union`, which are op steps with the slots `left` and `right`; and the base-and-step operators `relix:fix` and `relix:iterate`, which are op steps with the slots `base` and `step`. The **core** op `input:tab` (it reads a tab as raw bytes) is made concrete in RELIX.md §3.2.1 and used here. The D1 words `csv:parse`, `table:filter` and `table:to-json` do not exist yet, and their names in the examples below are illustrative. `fx:cat` and `fx:then` are test fixtures.

> **Packages are frozen.** `packages/*` hold frozen Phase 1 and 2 contracts (CLAUDE.md). This wave changes `@forge/recipe` (model, validator, compiler, text, share), `@forge/worker` (protocol, types, vector runner) and `@forge/ops` (catalogue types and build, vector schema). Each is an owner-approved change at Gate T1 (TOOLKIT §13.3), alongside the `@forge/lang` and `@forge/worker` changes of X1 and X2. Nothing here starts before that gate. No existing export or type changes meaning. Where a union gains a member, section 14 says so.

## Contents

1. What the wave contains
2. Versioning: the facts
3. Ext parameters (X3)
4. Slots for binary and base-and-step operators: the model and the JSON
5. Slots: validation, scope and limits
6. Compilation, step map, canonical text and implicit conversions
7. Named inputs and the per-step schema (X5)
8. Pack ops
9. Pins across hash changes (TOOLKIT Q10)
10. Op test vectors with setup steps (T22)
11. Share URL
12. Bake protocol
13. Internal vocabularies: the §2.2 correction
14. Lists: issue codes, limits, types, catalogue and protocol fields
15. Conformance cases (CR201 to CR268)
16. What an old reader does
17. Decisions: the owner's answers to Q1 to Q16
18. Work packages
19. Answers to the asks of RELIX.md, and what other documents need

---

## 1. What the wave contains

| # | Item | Layer | Section |
|---|---|---|---|
| 1 | Ext parameters: a parameter of type `ext{kind}` | catalogue, recipe validation, text | 3 |
| 2 | Slots for binary and base-and-step operators: `pipe`, `left`, `right`, `base` and `step` on an op step | recipe JSON, validation, compiler, text, step map | 4 to 6 |
| 3 | Named inputs: the core bytes source `input:tab`, the pack source `relix:input`, and a per-step schema in the bake result | bake protocol, share link | 7, 11, 12 |
| 4 | Pack ops: how a recipe names one, and what happens when its pack is off | validation, share decode | 8 |
| 5 | Pins across hash changes (TOOLKIT Q10) | catalogue, validation | 9 |
| 6 | Op vectors gain `setup` steps (T22) | vector format, runner | 10 |
| 7 | The §2.2 internal-vocabulary correction | RECIPES.md | 13 |
| 8 | Implicit conversions between ext kinds (`relix:from`, `relix:run`), `needsHardKill` for engine words, and `setup` in help examples: the asks of RELIX.md §16 | compiler, catalogue, help | 6.9, 6.8, 10, 19.1 |

Items 1 to 6 and 8 are the new format. They are one wave because they depend on each other: a binary operator needs slots (2) and a second tab (3); a pack op needs ext parameters (1); a vector for a table op needs setup steps (6); a Relix recipe that starts from bytes needs the conversions of (8).

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
| `base` or `step` on an op step, with or without `pipe: "base"` | `unknown-field` at `/steps/0/base`, `/steps/0/step` and `/steps/0/pipe` |
| an op `relix:theta-join` or `input:tab` that the catalogue lacks | `unknown-op` at `/steps/0/op` |
| text with `[`, a lane, then `] recipe:peek` or `] recipe:peek swap` | `bad-value`: "expected ] followed by fork, recipe:section, recipe:branch, recipe:repeat, recipe:settle or if" |
| a string value for an `ext` parameter, in a catalogue that has one | `bad-param` ("unsupported parameter type"). No build before this wave has such a catalogue, so the case arises only for a recipe that names a new op, and that is `unknown-op` first |
| a share link with the extra keys `n` and `t` | decoded: unknown keys are ignored (RECIPES §7.1), so a link made for a recipe that v1.1 can open still opens |
| a `bake` message with an `inputs` key, or `options.inputs` | the message guard `isClientMessage` refuses it, and the worker answers `fatal` |

### 2.2 Item by item

| Item | v1.1 recipes, text and links | Old reader and a new recipe | Additive? |
|---|---|---|---|
| Ext parameters | A JSON string where a string was already allowed. No v1.1 recipe changes. | The op is unknown in an old build. | Yes |
| Slots | A recipe with no slot step is unchanged, byte for byte (same canonical JSON, text and fragment). | `unknown-field`, and the text is `bad-value`. Fail closed. | Yes |
| Named inputs | `bake(recipe, input)` is unchanged. The new `inputs` option is optional. | `input:tab` and `relix:input` are `unknown-op`. A link's extra keys are ignored. | Yes, with a protocol bump (Q8) |
| Pack ops | Names are ordinary `vocab:word` qualified names. | `unknown-op`. | Yes |
| Pins across hash changes | A pin keeps its spelling and meaning. A catalogue op may list earlier hashes that still count (section 9). | Unchanged. An old reader never sees the new catalogue field. | Yes, **by the design chosen in section 9** |
| Op vectors with `setup` | A vector without the new fields runs as before. | Not a recipe feature. | Yes |

One alternative is not additive, and it is rejected: making pins survive a hash change by changing how a pin is written or computed (for example `"hash": "2:<hex>"`, or hashing a canonical op signature). Every stored recipe, golden and share link carries pins in the current spelling, so a new spelling would make every pinned v1.1 recipe invalid in the new reader or in the old one. The design of section 9 keeps the spelling.

Three changes are source-breaking for TypeScript code that switches exhaustively, and none changes what a recipe means: the new `ShareErrorCode` member `packs-needed` (section 8), the `"ext"` members that X1 and X2 add to `Tag`, `Value`, `ParamType` and `OutputValue` (X0 §7, already inside Gate T1), and the `PROTOCOL_VERSION` of the bake protocol (Q8). They are tracked in section 14.

### 2.3 Conclusion

No item changes what a v1.1 recipe, text or link means, and every new construct fails closed in a v1.1 reader. Every item is additive at the format level. The decision is v1.2 with `"forge": 1` (Q1). The case for 2.0, and what it would have cost, is kept in Q1 for the record.

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

## 4. Slots for binary and base-and-step operators: the model and the JSON

[RELIX-LANES.md](RELIX-LANES.md) is the design input. This section and the next make it normative, and RELIX-LANES.md has been brought into line with them (Gate T1). Where the two differ, this file wins.

### 4.1 Terms

- A **lane** is a list of steps, as a `fork`'s `steps` is. The recipe's own `steps` is the **main line**.
- A **slot** is a named input of a step that holds a lane. There are two families of slots:
  - a **binary op** has the slots `left` and `right`;
  - a **base-and-step op** (`relix:fix`, `relix:iterate`) has the slots `base` and `step`.
- A **slot op** is a catalogue op with a **slot parameter** (section 4.5). Its data input is its first slot (`left` or `base`). Its slot parameter is its second slot (`right` or `step`).
- A **slot step** is an op step with `pipe`, `left`, `right`, `base` or `step`.
- The **pipeable slot** is the slot that the data above may feed. A binary op has two (`left` and `right`). A base-and-step op has one (`base`). The `step` slot never takes data from above, because inside it the data is the accumulator, which `relix:recur` reads.

### 4.2 The pipe rule

> **The pipe rule.** Every step reads the output of the step above it. A slot step records which slot that data feeds, as `"pipe": "left"`, `"pipe": "right"` or `"pipe": "base"`. The slot that `pipe` names is **absent**. Every other slot holds a lane. A slot step with no `pipe` has a lane in every slot, and the data above is not used.

The data from above feeds the slot that `pipe` names, and that slot is **absent** because the data is that side. The other slots are **present**.

Binary op:

| `pipe` | `left` | `right` | The data above feeds | Meaning |
|---|---|---|---|---|
| `"left"` | absent | lane | the left input (the op's data input) | the usual form: the pipeline is on the left |
| `"right"` | lane | absent | the right input (the slot parameter) | the pipeline is on the right. For ⟕, ▷ and − this is a different query from `"left"` |
| absent | lane | lane | nothing | both inputs are lanes. The data above is dropped |

Base-and-step op:

| `pipe` | `base` | `step` | The data above feeds | Meaning |
|---|---|---|---|---|
| `"base"` | absent | lane | the base (the op's data input) | the usual form: the pipeline is the starting relation. The `step` lane is always explicit |
| absent | lane | lane | nothing | both are lanes. The data above is dropped |

`"pipe": "step"` does not exist. It is `bad-value` (section 5.2).

The JSON shape of a slot is an object with a single required field, `steps`, a list of steps. A slot is a lane object, not a bare list, so that it can carry fields later (a name, a note) without a format change (RELIX-LANES §8). Slot objects are closed.

```json
{
  "kind": "op",
  "op": "relix:theta-join",
  "params": { "on": "customer_id = id" },
  "pipe": "left",
  "right": {
    "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
      { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } }
    ]
  }
}
```

`relix:input` reads the tab and parses it, so the lane needs no Parse CSV step (RELIX.md §3.2, RQ1). A lane that needs byte steps first (a Base64 tab, say) starts with the core source `input:tab`, then the byte steps, then Parse CSV:

```json
{
  "right": {
    "steps": [
      { "kind": "op", "op": "input:tab", "params": { "tab": "customers.b64" } },
      { "kind": "op", "op": "base64:decode" },
      { "kind": "op", "op": "csv:parse" },
      { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } }
    ]
  }
}
```

(The excerpt shows the slot only. `csv:parse` leaves a `table`, and the compiler lifts it to a relation where `relix:select` needs one, section 6.9.)

A slot step stays `"kind": "op"` (RELIX-LANES L6, accepted here). It keeps `params`, `hash`, `disabled`, `breakpoint` and `note`, and the catalogue says whether it may have slots. A new kind would need a second path through every consumer, and would give an old reader `bad-kind` where it now gets `unknown-field`, which is not a better message.

### 4.3 What a slot lane computes

A slot lane is a scope, and its semantics are those of a `register`'s children (RECIPES §3.2):

- A lane runs on **a copy of the data that enters the slot step**, in document order: `left` before `right`, `base` before `step`, whatever the order of keys in the JSON.
- The value the last step of the lane leaves is the input of the op for that side. The data entering the slot step is unchanged by the lane.
- A lane that starts with a source op (`relix:input`, `input:tab`, `relix:recur` and the other sources of RELIX.md §3.2) ignores the data it is given. A lane that starts with byte steps (From Base64, Parse CSV) works on that copy. The format does not require a source. This answers RELIX-LANES Q5: a lane has data at its top, so there is no "lane with no data" case to report.
- The `step` lane of a base-and-step op starts with `relix:recur name`, which reads the accumulator. `relix:recur` is valid only inside a `step` lane, at any depth (section 5.2).
- The slot step then has the stack effect of every step, `( x -- y )`: the op gets its slot inputs and its other parameters, and leaves one value.

Order of evaluation matters only for effects and errors. A failing lane fails the recipe at its own path.

### 4.4 The example recipes in each form

The orders recipe (Base64 CSV, parsed, filtered, joined to the New Zealand customers, grouped and sorted). The main line starts from the tab `orders.b64` as raw bytes with `input:tab`, then the byte steps, then Parse CSV. The right lane reads `customers.csv` with `relix:input`, which parses it. The two tabs are in the bake's `inputs` (section 7):

```json
{
  "forge": 1,
  "name": "Paid orders by region",
  "steps": [
    { "kind": "op", "op": "input:tab", "params": { "tab": "orders.b64" } },
    { "kind": "op", "op": "base64:decode" },
    { "kind": "op", "op": "csv:parse" },
    { "kind": "op", "op": "relix:select", "params": { "cond": "status = 'paid'" } },
    {
      "kind": "op",
      "op": "relix:theta-join",
      "params": { "on": "customer_id = id" },
      "pipe": "left",
      "right": {
        "steps": [
          { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
          { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } }
        ]
      }
    },
    { "kind": "op", "op": "relix:group", "params": { "spec": "region; sum(total) as revenue" } },
    { "kind": "op", "op": "relix:sort", "params": { "keys": "revenue desc" } }
  ]
}
```

After **Swap sides** (RELIX-LANES §3), the same join has `pipe: "right"`, no `right` key, and the lane under `left`. Nothing else in the recipe moves:

```json
{
  "kind": "op",
  "op": "relix:theta-join",
  "params": { "on": "customer_id = id" },
  "pipe": "right",
  "left": {
    "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
      { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } }
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
      "op": "relix:theta-join",
      "params": { "on": "customer_id = id" },
      "left": {
        "steps": [{ "kind": "op", "op": "relix:input", "params": { "tab": "orders.csv" } }]
      },
      "right": {
        "steps": [{ "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } }]
      }
    }
  ]
}
```

A base-and-step op. The data above is the base, and the `step` lane reads the accumulator with `relix:recur`. The text of each parameter is illustrative. Here `edges.csv` is the base (the edges), and each round joins the accumulator `Reach` with the edges again:

```json
{
  "forge": 1,
  "steps": [
    { "kind": "op", "op": "relix:input", "params": { "tab": "edges.csv" } },
    {
      "kind": "op",
      "op": "relix:fix",
      "params": { "name": "Reach" },
      "pipe": "base",
      "step": {
        "steps": [
          { "kind": "op", "op": "relix:recur", "params": { "name": "Reach" } },
          {
            "kind": "op",
            "op": "relix:theta-join",
            "params": { "on": "dst = src2" },
            "pipe": "left",
            "right": {
              "steps": [
                { "kind": "op", "op": "relix:input", "params": { "tab": "edges.csv" } },
                { "kind": "op", "op": "relix:rename", "params": { "spec": "src, dst -> src2, dst2" } }
              ]
            }
          },
          { "kind": "op", "op": "relix:project", "params": { "columns": "src, dst2 -> dst" } }
        ]
      }
    }
  ]
}
```

**Main line** (RELIX-LANES §3) is an editor action. It moves steps between a lane and a slot and flips `pipe`. It needs no rule in the format: the result is an ordinary recipe whose paths have changed.

### 4.5 How the catalogue marks a slot op

`CatalogueOp` gains an optional field `slot`: the name of the slot parameter. `buildCatalogue` sets it iff the op's **data input** and its **first parameter** both have type `ext` with kind `relation` (the set of such kinds is a constant, `SLOT_KINDS`, in `@forge/ops`). The first parameter is then the slot parameter, and the op is a slot op.

**The name of the slot parameter selects the family.** The constant `SLOT_FAMILIES` (in `@forge/recipe` and `@forge/ops`) maps it:

| Slot parameter | Slots | Pipeable | The data input is |
|---|---|---|---|
| `right` | `left`, `right` | both | `left` |
| `step` | `base`, `step` | `base` | `base` |

A slot parameter with any other name is a build error in `buildCatalogue`: the op is a pack bug, not an op that quietly has no slots. This extends the derivation rule of the first draft ("data input and first parameter both `ext{relation}`"). That rule detects a base-and-step op as it detects a binary one, because `relix:fix` has the header `( base:relation step:relation … )`, but it did not say which slots the op has. The name does. RELIX.md §3.4 and §3.5 write the headers this way.

```json
{
  "qname": "relix:theta-join",
  "input": "ext",
  "output": "ext",
  "effect": "( left:ext{relation} right:ext{relation} on:ext{relix-expr} -- ext{relation} )",
  "params": [
    { "name": "right", "type": "ext", "kind": "relation", "index": 1, "required": true },
    { "name": "on", "type": "ext", "kind": "relix-expr", "index": 2, "required": true }
  ],
  "slot": "right"
}
```

```json
{
  "qname": "relix:fix",
  "input": "ext",
  "output": "ext",
  "effect": "( base:ext{relation} step:ext{relation} name:str -- ext{relation} )",
  "params": [
    { "name": "step", "type": "ext", "kind": "relation", "index": 1, "required": true },
    { "name": "name", "type": "str", "index": 2, "required": true }
  ],
  "slot": "step"
}
```

(The excerpts show only the fields that matter here.) Five consequences:

1. `@forge/recipe` reads `slot` and nothing about kinds, so it stays kind-blind. `CatalogueOpView` gains `slot?: string`. The family comes from `SLOT_FAMILIES`.
2. The slot parameter is **never** in the recipe's `params`. Its value is the lane. A `params` key with the slot parameter's name (`right` or `step`) is `bad-slot`.
3. The slot parameter is the **first** parameter, so that the compiled code can evaluate the lanes before it pushes any literal (section 6.1). This is a requirement on the Relix wrappers (section 18, "Requirements on RELIX.md").
4. `resolve` makes every parameter explicit except the slot parameter. `params` is present exactly when the op has a parameter other than the slot parameter.
5. An op that has a relation-kind data input and first parameter but is not meant to have slots cannot exist: every such op is a slot op. RELIX.md §4.3 has no unary operator with a relation as its first parameter.

Whether the marker should instead be a `META:` clause was Q2. The decision is **derived**, with the family chosen by the name.

### 4.6 What is format and what is editor

RELIX-LANES §2.3 gives the editor's **normal form**. Its four rules split as follows.

| RELIX-LANES §2.3 rule | In the format? |
|---|---|
| 3. A piped slot is absent. 4. Every slot that is not the piped one exists. | **Format.** These are the tables of section 4.2, checked by the validator (`bad-slot`, `missing-slot`) and by the schema. |
| 1. A first step has no `pipe`. | **Editor.** The format accepts `pipe` on a first step: the data it feeds is a copy of the data entering the list. On the main line that is the input bytes, so the bake fails with `E_TYPE` at that step. In a slot lane it is the data that entered the outer slot step. |
| 2. A step after the first with no `pipe` takes the pipe on the first empty slot. | **Editor.** The format accepts a step with no `pipe` after other steps and warns (`unused-pipe`, section 5). For a base-and-step op the editor puts the pipe on `base`. |

`normalise` is catalogue-free and adds nothing. It does not apply rules 1 and 2.

---

## 5. Slots: validation, scope and limits

### 5.1 The schema

The JSON Schema (RECIPES §3.9) gains one definition and changes `opStep`. The consistency of `pipe`, `left`, `right`, `base` and `step` is structural, so it is in the schema. Which ops may have slots, and which family an op has, is a catalogue question, so it is not.

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
        "pipe": { "enum": ["left", "right", "base"] },
        "left": { "$ref": "#/$defs/slot" },
        "right": { "$ref": "#/$defs/slot" },
        "base": { "$ref": "#/$defs/slot" },
        "step": { "$ref": "#/$defs/slot" }
      },
      "allOf": [
        {
          "if": {
            "anyOf": [
              { "required": ["pipe"] },
              { "required": ["left"] },
              { "required": ["right"] },
              { "required": ["base"] },
              { "required": ["step"] }
            ]
          },
          "then": {
            "oneOf": [
              {
                "properties": { "pipe": { "const": "left" } },
                "required": ["pipe", "right"],
                "not": { "anyOf": [{ "required": ["left"] }, { "required": ["base"] }, { "required": ["step"] }] }
              },
              {
                "properties": { "pipe": { "const": "right" } },
                "required": ["pipe", "left"],
                "not": { "anyOf": [{ "required": ["right"] }, { "required": ["base"] }, { "required": ["step"] }] }
              },
              {
                "required": ["left", "right"],
                "not": { "anyOf": [{ "required": ["pipe"] }, { "required": ["base"] }, { "required": ["step"] }] }
              },
              {
                "properties": { "pipe": { "const": "base" } },
                "required": ["pipe", "step"],
                "not": { "anyOf": [{ "required": ["base"] }, { "required": ["left"] }, { "required": ["right"] }] }
              },
              {
                "required": ["base", "step"],
                "not": { "anyOf": [{ "required": ["pipe"] }, { "required": ["left"] }, { "required": ["right"] }] }
              }
            ]
          }
        }
      ]
    }
  }
}
```

`opStepAdditions` is shown separately for reading. In the schema file its `properties` are merged into `opStep.properties` and its `allOf` entry is appended to `opStep.allOf`. The five alternatives are the rows of the two tables of section 4.2. They are mutually exclusive, so exactly one can match. The `if` has no `else`: an op step with none of the five keys is valid, because the schema cannot tell whether its op has slots. Slots are not accepted in the `test` of an `if` (the `ifTest` op shape is closed, so `unknown-field`).

A document the schema rejects, the validator rejects (RECIPES §3.9). The validator is stricter and gives precise codes.

### 5.2 Validator rules and the new issue codes

The validator runs the structural rules, then the catalogue rules, in the order of RECIPES §3.7. For an op step `S` at path `p`, with the catalogue entry `O` if the op is known. Here "the slots of `S`" are the family of `O` (`left` and `right`, or `base` and `step`). Without a catalogue they are the family that `S`'s own keys name.

| Rule | Issue | Path | `detail` |
|---|---|---|---|
| `pipe` is not `"left"`, `"right"` or `"base"` (`"step"` included) | `bad-value` | `p/pipe` | `constraint` |
| a slot is not an object with `steps` and no other key | `type`, `required`, `unknown-field` | the slot or key | as for any object |
| keys of both families are present (`left` or `right` with `base` or `step`) | `bad-slot` | `p` | `reason: "mixed-slots"`, `op` |
| `pipe` names a slot that is also present | `bad-slot` | `p/<slot>` | `reason: "piped-slot-present"`, `slot`, `op` |
| `pipe` is absent and a slot of the family is absent | `missing-slot` | `p/<slot>` | `slot`, `reason: "absent"` |
| `pipe` is set and the other slot of the family is absent | `missing-slot` | `p/<slot>` | `slot`, `reason: "absent"` |
| with a catalogue: `O` is not a slot op and one of the five keys is present | `bad-slot` | the first of `p/pipe`, `p/left`, `p/right`, `p/base`, `p/step` that is present | `reason: "not-slot-op"`, `op` |
| with a catalogue: `O` is a slot op and `S` uses the keys of the other family (`base` on a binary op, `left` on `relix:fix`, `pipe: "left"` on `relix:fix`, `pipe: "base"` on a binary op) | `bad-slot` | the first key of the wrong family, in the order `pipe left right base step` | `reason: "wrong-slots"`, `op`, `expected` (`"left,right"` or `"base,step"`) |
| with a catalogue: `O` is a slot op and `params` has the key `O.slot` | `bad-slot` | `p/params/<name>` | `reason: "slot-in-params"`, `op`, `slot` |
| with a catalogue: `O` is a slot op and none of the five keys is present | `missing-slot` | `p` | `reason: "no-slots"`, `op` |
| a present lane has no enabled step other than a `comment` (it has no steps, or only comments and disabled steps) | `missing-slot` | `p/<slot>` | `slot`, `reason: "empty"` |
| `S` has no `pipe` and an enabled earlier step of the same list, other than a `comment`, exists | `unused-pipe` (warning) | `p` | `op` |
| `S` is the op `relix:recur` (`RECUR_OP`) and no enclosing slot lane is a `step` lane | `bad-position` | `p` | `kind: "relix:recur"`, `reason: "outside-step-slot"` |

Notes.

- `bad-slot` and `missing-slot` are errors, and a disabled slot step still reports them (RECIPES §3.2, "a disabled step still has to be valid"). They take no part in the scope pass of RECIPES §3.7.
- The structural rows apply without a catalogue. The rows marked "with a catalogue" apply only when `validateRecipe` was given one and the op is known. An unknown op gets `unknown-op` and no slot checks, as it gets no parameter checks.
- `unused-pipe` is raised only for a step that has a lane in every slot and no other slot issue.
- `unused-pipe` is a warning, because a slot step with a lane in every slot is a legal way to start over. It looks at siblings in the same list only. A slot step that is first in its list never warns.
- The editor reports `missing-slot` as it reports `missing-param` today: live, as the user builds a step.
- RELIX-LANES §8 proposed `bad-pipe` and `slot-type`. `bad-pipe` is merged into `bad-slot`. `slot-type` is **not** a validator rule: the validator tracks no value types. The check "a lane ends in a table or relation" is `fit.ts` in the UI and `E_TYPE` at run time, attributed to the step.
- Paths never carry the slot's `steps` segment unless they point inside the lane: the slot itself is `/steps/3/right`, and its first step is `/steps/3/right/steps/0`.
- **`relix:recur`.** The rule is by name, as `NAMED_INPUT_OPS` is (section 7.1), so it runs with or without a catalogue. A `relix:recur` is valid anywhere inside a `step` lane, at any depth: in a nested lane of a binary step, in a `fork`, in an `if` branch. It is `bad-position` in the main line, and in any lane that is not inside a `step` lane (a `base`, `left` or `right` lane of a step that is not itself inside a `step` lane). A disabled `relix:recur` is still checked. That `name` equals the `name` of an enclosing `relix:fix` or `relix:iterate` is **not** checked here. It is a parameter rule of the pack, reported at build time as `E_PARAM_INVALID` (RELIX.md §7.4). In hand-written FL a `relix:recur` outside a `step` slot is also `E_PARAM_INVALID` (RELIX.md §3.2).

### 5.3 Paths

A slot adds one segment to a path: the slot's name, then `steps`, as RELIX-LANES §8 says.

```text
/steps/3                      the slot step
/steps/3/right                the right slot (a lane object)
/steps/3/right/steps          the lane's list
/steps/3/right/steps/1        its second step
/steps/1/step/steps/0         the first step of the step lane of a base-and-step op
/steps/1/base/steps/2         the third step of a base lane
```

The four slot names are `left`, `right`, `base` and `step`. This is one more kind of child list, next to `steps` of a `fork`, `subsection`, `repeat` and `register`, and `then` and `else` of an `if`. Every walker of child lists must learn it: `validate`, `normalise`, `resolve`, `pinRecipe`, `compile`, `stepmap`, the text parser, `registersInScope`, `registerInfo`, `recipeNeedsHardKill`, `recipeUsesV11` and the new helpers. `apps/web` has its own list (`childLists`, `CHILD_LIST_KEYS`; RELIX-LANES §8).

Issue paths, the failing-step path of a `BakeError`, and `StepReport.path` are matched to cards by prefix, so a step inside a lane highlights its own card and the slot step's card, as a step inside a `fork` does.

### 5.4 Registers and `return` in slot lanes

These apply the v1.1 rules to a lane. They are RELIX-LANES §8.1 made normative, with one change (the top of a lane has data).

- **Scope.** A lane is a list, so it is a scope. A register defined earlier in the list that holds the slot step is visible in the step's own `params` (a `{ "ref": … }` for `on`, say) and in the steps of both lanes, as inside a `fork`.
- **A register defined in a lane** is bound in that lane only. It is not visible after the slot step, and not in the other lane. Two lanes may use the same name (`duplicate-register` looks at names visible at the step). A name visible at the lane's step cannot be bound again.
- **A register at the top of a lane** takes the copy of the data that entered the slot step (section 4.3). No special case.
- **`return`** is valid only in the root list and in the `then` and `else` lists of an `if` that is in a valid position (RECIPES §3.2). A slot lane is not the root list, so a `return` in a lane, or in an `if` inside a lane, is `bad-position`. Its `detail` is `kind: "return"`, `container: <the path of the slot step>`, `containerKind: "op"` and the new key `slot`. A `return` after the slot step, in the main line, is valid.
- **A register cannot be a slot's source.** A reference is accepted only in the `params` of op steps and op tests. The way to use one sub-expression twice is a saved relation (a word) read by a source op in both lanes. RELIX-LANES Q6 is answered no (Q6 below).
- **Base and step.** The `step` lane of `relix:fix` or `relix:iterate` is a lane like any other. It sees the registers above the step and may define its own. The accumulator is not a register: it is read by the source op `relix:recur`.
- `registersInScope(recipe, "/steps/3/right/steps/1", catalogue?)` returns the registers visible there. A path that ends at a lane (`/steps/3/right/steps`) means the position after the lane's last step.

### 5.5 Limits

A lane counts as a container level, as `fork` children do.

- Steps in the whole tree (500): steps in lanes count.
- Container nesting depth (8): a slot step adds one level for its lanes.
- Raw JSON depth (64): a lane adds three JSON levels (the step object, the slot object, the `steps` array), against two for a `fork`. Eight nested slot levels use 24 levels, plus the root, `steps`, `params` and a reference object, so below 64. RW1 asserts this with a generated recipe (CR216).
- There is no new limit on the number of slot steps. A hostile recipe is bounded by the step and size limits.

---

## 6. Compilation, step map, canonical text and implicit conversions

### 6.1 The compiled form

A slot step compiles to the lanes, then the op. No new FL word is needed: a lane is the quotation of the v1.1 word `recipe:peek ( any body:quot -- any any )`, which runs `body` on a copy of the data and leaves the data and the result. The op word needs its inputs in the order of its header: the data input, then the slot parameter, then the other parameters. The lanes are evaluated first, before any literal is pushed, which is why the slot parameter must be the first parameter.

The three forms of a binary op. `⟨lits⟩` is the literal group of the op's other parameters, in `ParamSpec` order (the slot parameter has none). The stack is written deepest first. `D` is the data entering the step.

| Form | Text | Stack |
|---|---|---|
| `pipe: "left"` | `[` right lane `] recipe:peek`, then `⟨lits⟩ qname` | `D`, then `D R`, then the op consumes `D R ⟨lits⟩` |
| `pipe: "right"` | `[` left lane `] recipe:peek swap`, then `⟨lits⟩ qname` | `D L`, `swap`: `L D`, then the op consumes `L D ⟨lits⟩` (the pipeline is the right input) |
| no `pipe` | `[` left lane `] recipe:peek swap`, `[` right lane `] recipe:peek nip`, then `⟨lits⟩ qname` | `D L`, `L D`, `L D R`, `nip`: `L R`, then the op consumes `L R ⟨lits⟩` |

`swap` and `nip` are core words and are written unqualified, as `fork` and `if` are (RECIPES §5.1). Each lane is a quotation `( x -- y )`: every step in it is `( x -- y )` already, so the `E_EFFECT` check of `recipe:peek` holds.

**A base-and-step op** (`relix:fix`, `relix:iterate`) uses the first and third form with `base` for `left` and `step` for `right`. There is no `swap` form, because only `base` can be piped:

| Form | Text | Stack |
|---|---|---|
| `pipe: "base"` | `[` step lane `] recipe:peek`, then `⟨lits⟩ qname` | `D`, then `D S`, then the op consumes `D S ⟨lits⟩` |
| no `pipe` | `[` base lane `] recipe:peek swap`, `[` step lane `] recipe:peek nip`, then `⟨lits⟩ qname` | `B S`, then the op consumes `B S ⟨lits⟩` |

The op's header is `( base:relation step:relation params… -- relation )` (RELIX.md §3.5), so the base is below the step, as the left is below the right. The text of a base-and-step step is the text of a binary step, so the closers are the same (section 6.6). The parser tells them apart by the catalogue.

The orders recipe of section 4.4 compiles to the text below. Two lines carry the annotation `@implicit`: they are the conversions that the compiler inserts (section 6.9), and they are not steps of the recipe. The main line starts from the tab as bytes (`input:tab`), `csv:parse` leaves a `table`, and the first Relix step needs a `relation`, so `relix:from` is inserted. The recipe ends in a `relation`, so `relix:run` is appended.

```text
\ forge-recipe 1
\ name "Paid orders by region"
: main ( bytes -- any )
  "orders.b64" input:tab
  "standard" base64:decode
  csv:parse
  "" relix:from  \ @implicit
  "status = 'paid'" relix:select
  [
    "customers.csv" "csv" true relix:input
    "country = 'NZ'" relix:select
  ] recipe:peek
  "customer_id = id" relix:theta-join
  "region; sum(total) as revenue" relix:group
  "revenue desc" relix:sort
  0 relix:run  \ @implicit
;
```

With `pipe: "right"` the lines from `[` to `relix:theta-join` are the same except for the closer, `] recipe:peek swap`. With no `pipe`:

```text
  [
    "orders.csv" "csv" true relix:input
  ] recipe:peek swap
  [
    "customers.csv" "csv" true relix:input
  ] recipe:peek nip
  "customer_id = id" relix:theta-join
```

The `relix:fix` recipe of section 4.4 compiles to (the lane of the inner join is a binary slot lane inside a `step` lane):

```text
  "edges.csv" "csv" true relix:input
  [
    "Reach" relix:recur
    [
      "edges.csv" "csv" true relix:input
      "src, dst -> src2, dst2" relix:rename
    ] recipe:peek
    "dst = src2" relix:theta-join
    "src, dst2 -> dst" relix:project
  ] recipe:peek
  "Reach" relix:fix
  0 relix:run  \ @implicit
```

**Checked by running** (2026-11-23, the v1.1 runtime, with the core word `cat` as the binary op, the main input `D`, and lanes that replace the copy with `"R"` or `"L"`): the left form gives `"DR"`, the right form `"LD"`, the no-pipe form `"LR"`. A register defined above the step and read inside a lane works (`"DQR"` and `"QLD"`). A nested lane works (`"DR1x"`). An empty lane leaves the copy (`"DD"`), which is why the validator rejects it. The base-and-step forms are the same text as the binary forms with the slots renamed, so they have the same stack effect. They were **argued, not run**: RW3 runs them with the fixture op `fx:then` (CR260). Everything else is argued from RECIPES §5.

### 6.2 Literals

The ext literal is a string literal (section 3.4). A reference is `$name`. Nothing else changes in RECIPES §5.2. `relix:input` is an ordinary op step, and every parameter is written, as `resolve` makes them explicit: `"customers.csv" "csv" true relix:input` (`tab`, `format`, `header`). `input:tab` has one parameter: `"orders.b64" input:tab`.

### 6.3 Disabled steps, annotations and breakpoints

- A disabled slot step is written as comment lines, every line of it (each lane line, each lane closer, the op line) prefixed by `\ ~ ` once per disabled level, as for containers (RECIPES §5.4).
- The annotations of the step (`@pin`, `@break`, `@note`) sit on the **op line**, the last line, where the step's own word is. The lane lines carry the annotations of the steps in them.
- `core:exit` and the lowered `if` are never inside a lane (`bad-position`), so the lowering of RECIPES §5.3 needs no change.
- The compiler plans conversions over **enabled** steps only (section 6.9). A disabled step gets none, and a conversion is never written as a disabled line.

### 6.4 The step map

`StepLine` has one entry for the slot step: `startLine` is the first line of its first lane (the `[`), and `endLine` is the op line. The steps inside the lanes have their own entries with the paths of section 5.3, and their line ranges lie inside the slot step's. Document order is the slot step, then the first slot's steps, then the second slot's steps. An implicit conversion line lies inside the range of the step it serves (section 6.9). For the recipe of section 6.1:

| Step | Path | Lines | Notes |
|---|---|---|---|
| input tab | `/steps/0` | 4 | |
| decode | `/steps/1` | 5 | |
| parse | `/steps/2` | 6 | |
| select | `/steps/3` | 7 to 8 | line 7 is the implicit `relix:from` |
| join | `/steps/4` | 9 to 13 | the `[` is line 9; `] recipe:peek` is line 12; the op is line 13 |
| lane input | `/steps/4/right/steps/0` | 10 | |
| lane select | `/steps/4/right/steps/1` | 11 | |
| group | `/steps/5` | 14 | |
| sort | `/steps/6` | 15 to 16 | line 16 is the implicit `relix:run` |

(Line 1 is the header, line 2 the name, line 3 the word line, line 17 the `;`.)

`resolveStepIps` already uses line membership (RECIPES §5.5), so it needs no change. The `startIp` of the slot step is the first instruction of its first lane, so a breakpoint on it pauses before any lane runs, with the data entering the step. `step()` goes into the first lane's first step. `attributeError` takes the deepest enabled step whose range contains the `ip`, so an error in a lane step is that step's, and an error in the op's own parameters, or an `E_EFFECT` of `recipe:peek`, is the slot step's. The data-input coercion of the op (`slot === 0`) belongs to the slot step by the step log (RECIPES §8.2). An error in an implicit line belongs to the step whose range holds the line.

### 6.5 Canonical text: grammar

The grammar of RECIPES §6.2 gains two productions and one annotation. A lane opens with the same line as a register, a lone `[`. What it is is decided by its closer.

```ebnf
slot-close  = "] recipe:peek" , [ " swap" | " nip" ] ;
body        = ... | slot-close ;                    (* added to the alternatives *)
ann         = ... | "@implicit" ;                   (* added to the alternatives *)
```

`register-close` (`] recipe:peek :> $name`) is unchanged. The two closers differ by what follows `recipe:peek`: `:>`, `swap`, `nip` or nothing.

`@implicit` marks a line that the compiler inserted (section 6.9). It appears alone: an implicit line carries no `@pin`, `@break` or `@note`. It is an annotation like the others, so on an op line it is a plain trailing FL comment and has no effect when the text is run.

### 6.6 Canonical text: parsing

`parseRecipeText` keeps its explicit stack. The `[` frame is created as for a register. At a close line, by what follows `] recipe:peek`:

- `:> $name`: a register close (unchanged).
- nothing, `swap` or `nip`: a **slot close**. The frame's steps become a pending lane, `{ closer, steps, level, line }`, appended to the `pending` list of the enclosing list's frame. No step is completed yet.
- The next line must be another `[` or the **op line** that completes the slot step. Any other line while `pending` is not empty is `bad-value` with `constraint: "block structure"`. This includes a comment step, a close line, an `else` line and the end of the list.
- At the op line, the list of pending closers must be exactly one of: `[]` empty (an ordinary op line), `[peek]`, `[swap]` or `[swap, nip]`. Anything else is `bad-value`, `block structure`. A closer `nip` that does not follow a `swap` lane, a second `swap`, or a third lane is that error.
- The meaning of the three non-empty lists depends on the op's slot family, which the parser reads from the catalogue (`CatalogueOp.slot`):

| Pending closers | Binary op (`slot: "right"`) | Base-and-step op (`slot: "step"`) |
|---|---|---|
| `[peek]` | `pipe: "left"`, lane `right` | `pipe: "base"`, lane `step` |
| `[swap]` | `pipe: "right"`, lane `left` | not valid: assembled as a binary step, so the validator reports `bad-slot` (`wrong-slots`) |
| `[swap, nip]` | no pipe, lanes `left` and `right` | no pipe, lanes `base` and `step` |

- All pending lanes and the op line must have the same disabled level. The step is disabled iff its level is one more than the enclosing frame's, as for containers.
- The op line is read as an op line (RECIPES §6.3 item 6) with one difference: the literal groups are matched to the op's parameters **after the slot parameter**. The op must be a slot op. If it is not, the assembled step has slot keys on an op without slots and `validateRecipe` reports `bad-slot` (`not-slot-op`). The parser does not repeat the check.
- A line carrying `@implicit` is an **implicit line**: the parser drops it and adds no step. It checks nothing about it, because the compiler writes it again (section 6.9). An `@implicit` annotation on any line that is not an op line is `bad-value`.
- The result goes through `validateRecipe` and `canonical`, as in RECIPES §6.3 item 7, so scope and slot errors come out as they do for JSON.

An ext parameter is read from an `FL-string` group. The parser never loads FL and never recurses.

### 6.7 Round trip

RECIPES §6.5 holds with slots and conversions: `parseRecipeText(compileRecipe(r, c).text, c)` returns `canonical(r, c)` for every valid `r`, because implicit lines are dropped on the way back. CR236 covers each of the three binary forms, a disabled slot step and a register inside a lane. CR261 covers the base-and-step forms and CR264 the implicit lines. A recipe with no slot step and no conversion compiles to the text it has today, byte for byte (CR124 is the model; CR231 asserts it for v1.2).

### 6.8 Hard kill and helpers

`recipeNeedsHardKill(recipe, catalogue)` recurses into lanes, and counts the words that the compiler would insert (section 6.9) as steps. A recipe that ends in a `relation` needs a hard kill when `relix:run` does, although no step of it is `relix:run`. It uses the same planning function as the compiler, so the two cannot disagree. The flag itself is extended in section 19.1 (a). `recipeUsesV11` is unchanged (it does not report slots, so a recipe with slots and nothing else from 1.1 is not "needs 1.1").

### 6.9 Implicit conversions between ext kinds

RELIX.md §2.4 (RX5) says that the lift from a `table` to a `relation`, and the run from a `relation` to a `table`, are inserted by the recipe compiler and marked implicit in the step map. This section gives the mechanism. `@forge/recipe` stays kind-blind: it compares kind names as strings and knows nothing about tables or relations. The pack supplies the facts.

**The catalogue declares the conversions.** `Catalogue` gains an optional list:

```ts
interface CatalogueConversion {
  readonly from: string; // an ext kind name, or a tag
  readonly to: string;
  readonly op: string; // the qualified name of the word that converts
  readonly atEnd?: true; // also apply it to the value that the recipe ends with
}
// Catalogue.conversions?: readonly CatalogueConversion[]
```

The pack's manifest declares them and `buildCatalogue` copies them in (RW4). `op` must be a catalogue op whose data input is the `from` kind and whose output is the `to` kind, and whose parameters all have defaults. For the Relix pack:

```json
[
  { "from": "table", "to": "relation", "op": "relix:from" },
  { "from": "relation", "to": "table", "op": "relix:run", "atEnd": true }
]
```

There is no conversion from `relation` to `bytes` or `str`. An op that takes those, after a relation, is `E_TYPE` at run time and red in the editor (RELIX.md §2.4).

**The compiler tracks the kind of the data.** Within one list, in order, over enabled steps only:

- The data entering the main line is `bytes`. The data entering a slot lane is the data entering the slot step.
- After an op step the kind is that op's `outputKind` (when `output` is `ext`), else its `output` tag.
- A `register` or a `comment` leaves the kind unchanged. A `fork`, `subsection`, `repeat` or `if` leaves it **unknown**. With an unknown kind no conversion is inserted at the next step, and a mismatch is `E_TYPE` at run time.
- A source op (data input `any`) accepts every kind, so no conversion is inserted before it.

**Where a conversion is inserted.** Before an op step whose data input has a kind (`inputKind`) different from the current kind, when a conversion `(from = current, to = inputKind)` exists. Before a slot step the same test is made for its data input. At the end of a slot lane the test is made against the slot parameter's kind (the `kind` of the slot parameter in the catalogue). At the end of the main line, a conversion with `atEnd` whose `from` is the current kind is appended, so that the output pane shows a table. Nothing is inserted when no conversion matches. The word is written with the defaults of its parameters, in `ParamSpec` order, like any op line: `"" relix:from`, `0 relix:run`.

**What the text and the map say.** An inserted line has the annotation `@implicit` (section 6.5). It is not a step of the recipe, so it has no path. It lies inside the line range of the step it serves: the step that needs the converted value, or the last step of the list for an end-of-recipe conversion, or the slot step for the end of a lane. `StepLine` gains an optional `implicit?: readonly { line: number; op: string }[]`. The baker reports each conversion that ran in `StepReport.implicit?: readonly { op: string; from: string; to: string }[]`, so the trace shows `relation -> table` (TOOLKIT §8.1).

**Why in the compiler and not in the VM.** A VM coercion is synchronous, and a run may await an FL batch (RELIX.md §2.4). A conversion that is a word, in the text, is also visible and debuggable. The text round trip is unaffected (section 6.7).

The planning function is exported by `@forge/recipe` as `planConversions(recipe, catalogue)`, which returns the insertions with their positions and is used by the compiler, by `recipeNeedsHardKill` and by the editor (the type badges of RELIX-LANES §6).

---

## 7. Named inputs and the per-step schema (X5)

### 7.1 The source ops

Two ops read an input tab by name. Both are **sources**: their data input is `any`, and they ignore what is above them. A catalogue op needs at least one input (RECIPES §2.2), so a source has `any` as its data input, and in a slot lane the data entering the slot step may be a relation.

| Op | Vocabulary | Header | What it returns |
|---|---|---|---|
| `input:tab` | `input`, **core**: it works with no pack enabled | `( any tab:str -- bytes )` | the raw bytes of the tab, as the page holds them |
| `relix:input` | `relix`, the Relix pack | `( any tab:str format:choice{csv\|tsv\|json\|ndjson}=csv header:bool=true -- ext{relation} )` | the tab parsed by the core table parsers (format `csv`, `tsv`, `json` or `ndjson`) and lifted to a relation named after the tab |

`input:tab` is the route for **byte steps first**: a Base64 tab, a compressed tab, a tab in another charset. The recipe is `input:tab`, then the byte steps, then Parse CSV. `relix:input` is the route for a tab that is already CSV, TSV, JSON or NDJSON: it reads and parses the tab itself, so no Parse CSV follows it. A Parse CSV after `relix:input` is wrong: its input is a relation, not bytes. The validator tracks no types, so the recipe is valid, and the bake fails with `E_TYPE` at the Parse CSV step (CR263). The effects, parameters and results of both ops are RELIX.md's (§3.2 and §3.2.1; decision RQ1).

The format needs three things from both ops:

1. Their data input accepts **any** value. A source ignores what is above it.
2. `tab` is matched against the names of the bake's inputs **exactly**: case-sensitive, no trimming, no Unicode normalisation.
3. `tab` may be a literal or a `{ "ref": … }`.

The names are constants in `@forge/recipe`: `NAMED_INPUT_OPS` (`["input:tab", "relix:input"]`) and `NAMED_INPUT_PARAM` (`"tab"`), because the baker, the share encoder and the editor all need them. They are used by name, as `recipe:peek` and `relix:recur` (`RECUR_OP`) are. A pack op that is named here is `unknown-op` when its pack is off, as any pack op is (section 8.2). `input:tab` is core and never is.

### 7.2 The bake call

`Baker.bake(recipe, input, options)` keeps its signature. `input` is still the data that enters step 0. `BakeOptions` gains `inputs`:

```ts
interface BakeInput {
  readonly name: string; // the tab's name
  readonly bytes: Uint8Array;
}
// BakeOptions: …, inputs?: readonly BakeInput[]
```

`inputs` is the set of all named tabs. The main input is **not** named implicitly: a host that wants `input:tab` or `relix:input` to read the active tab passes it in `inputs` as well, under its name. This keeps the call free of a hidden rule. The bytes of the main input and of its entry in `inputs` are not required to be the same object.

Rules, checked by the client before the message is sent, and by the worker on receipt:

| Rule | Value |
|---|---|
| names | 1 to 120 code points, well-formed UTF-16, no C0 or C1 control character |
| uniqueness | exact; two entries with the same name are an error |
| count | at most `BAKE_INPUT_LIMITS.maxInputs` (32) |
| size | the total of all inputs and the main input is at most `limits.maxTotalBytes` of the effective limits (RECIPES §8.6) |

A violation gives a result with `ok: false` and `error.code: "E_PROTOCOL"`, `path: null`, and `detail.reason` (`"input-name"`, `"input-duplicate"`, `"input-count"` or `"input-size"`) with `detail.name` for the first three. It is a bad request, not a recipe error. No new `BakeErrorCode` is added.

### 7.3 Reading a tab at run time

The baker core installs the inputs for the duration of a bake, keyed by the bake's abort signal, as it installs the Magic host (RECIPES §4.4), so that nothing is global. The primitive of `input:tab` (core, in `packages/ops`) asks that host for the bytes. `relix:input` is FL over `input:tab`: it calls it, then the core table parser that `format` names, then `relix:from` (RELIX.md §3.2), so there is one reader of tabs and one place that meters it. A runtime with no host, or a bake with no `inputs`, finds no tabs. Each read is metered as a new value. Nested bakes of `magic:magic` get no inputs.

### 7.4 Missing tab

A recipe may name a tab that is not there: a shared recipe, a renamed tab, a closed tab. There are three layers, from cheapest.

1. **`inputNames(recipe)`** (new, in `@forge/recipe`) returns the literal tab names of enabled `input:tab` and `relix:input` steps (the ops of `NAMED_INPUT_OPS`), with their paths: `{ name, path }[]`. A `{ "ref": … }` tab is not listed. The editor uses it to flag a step before baking and the share dialog to list the tabs that a link must carry. It is pure and works without a catalogue.
2. **The baker's early check.** After validation and before compile, the baker SHOULD check every name that `inputNames` returns against `inputs`. The first missing one in document order fails the bake before any step runs, with the error of layer 3 and that step's path. An early failure saves a long bake that would fail at step 8.
3. **The run-time error.** The primitive raises `E_PARAM_INVALID` for a name it cannot find. The shape is the same in layers 2 and 3:

```text
E_PARAM_INVALID path=/steps/0 word=input:tab detail.param=tab detail.reason=no-such-input
                detail.tab=customers.csv detail.tabs=["orders.b64"]
```

The `word` is `input:tab` for both ops, because `relix:input` calls it. The path is the step. `detail.tabs` lists the available names, at most 20, each cut to 80 code points. If `tab` is supplied by a register, `detail.register` is also set (RECIPES §3.4). No new error code is needed. The UI turns the error into "This recipe reads the tab "customers.csv". There is no such tab. Add one with that name, or change the step."

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

TOOLKIT §5 defines packs. A pack has a manifest with its vocabularies. Discovery, the manifest and the `init` pack ids belong to PACKS.md (SP4; approved at Gate T1, 2026-11-24). This section gives the recipe side.

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

A pack op has a catalogue `hash` like any op, and `pinRecipe` and `encodeShare` pin it. The rules of RECIPES §3.10 apply unchanged. One requirement is new: a pack whose op calls code that its FL does not hash (an engine compiled to JavaScript, for `relix`) MUST make the hash change when that code's behaviour changes. A primitive's hash covers its header and its `version` (RECIPES §3.10), so the pack declares this by including the engine's version in the `version` of each of its primitives. PACKS.md §5.5 states it (the checks `external-sha` and `external-version`), and P1 tests it.

### 8.5 `recipe.catalogue` and packs

*This section was amended at Gate T1, 2026-11-24 (PACKS PK9).*

`Catalogue.version` is a content id of the ops in the catalogue in use (RECIPES §2.3). With packs it differs for each set of enabled packs, so a `recipe.catalogue` that held it would raise `catalogue-mismatch` for every reader with a different set.

**Rule (PACKS PK9, PACKS.md §5.4): `recipe.catalogue` is the core catalogue version, or it is absent.** The page keeps the merged catalogue for the operations pane, the forms and `fit`. It passes the recipe layer (`validateRecipe`, `encodeShare`, `compileRecipe` and every stamp) a view of it whose `version` is the core version. So a recipe with no pack op is compared against the core version whatever packs are on, and a pack-free recipe does not warn because two readers differ only in their packs.

The two rules of Q11 still hold for a recipe that has a pack op. The validator does not raise `catalogue-mismatch` for a recipe that has at least one op in a pack vocabulary (it needs `packs`), and `encodeShare` omits `catalogue` for it. The page never stamps such a recipe, so its `catalogue` is absent.

**The baker drops `catalogue-mismatch`.** Under closure loading the baker's catalogue is partial (PACKS.md §4.4), so its version is neither the core version nor the merged one. The baker removes `catalogue-mismatch` from the warnings it returns. The page validated the recipe against the full catalogue and owns that warning. The per-step pins are the safeguard (RECIPES §3.1).

### 8.6 Vectors for pack ops

A pack's vectors are `packs/<name>/vocab/*.test.json` (TOOLKIT §5.1). The runner (section 10) loads the pack's vocabularies before it runs them, and includes the pack's ops in `uncovered`.

---

## 9. Pins across hash changes (TOOLKIT Q10)

### 9.1 The problem

An op's `hash` covers its source and everything it calls (RECIPES §3.10). The FL v0.2 migration sweeps all 161 `.fth` files in one pass, "all 4,488 vectors must pass unchanged", and "word hashes all change" (TOOLKIT §11.5). After it, every pinned share link shows one `hash-mismatch` warning for every op (RECIPES §3.10, `pins: "warn"`), or refuses under `"strict"`. The warning is true for an op whose behaviour changed (T6 allows breaking fixes) and false for an op that only changed its spelling. A user who sees 20 warnings on every old link learns to ignore the 21st, and then the pin has stopped doing its job.

### 9.2 The decided answer

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
| B. `previousHashes` (decided, Q10) | Only ops whose vectors changed warn | Adds a build step and an optional catalogue field |
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
| `pipe`, `left`, `right`, `base`, `step` | as in section 4 | the slots of the op under test, when it is a slot op. The lanes hold `op` steps only, up to 8 |

`finish` is an addition beyond T22's text and was Q12 (decided: yes). It is the symmetric case: an op that returns a table has no byte output to compare. `setup`, `finish` and lane steps are **op steps only**: a vector tests one op, and its surroundings are a chain of ops. A step in them follows RECIPES §3.2 (ops, params, no `disabled`).

The runner builds `{ "forge": 1, "steps": [ …setup, <the op step with its slots>, …finish ] }` and bakes it with `inputs` set from the vector. The recipe's input is `input`. The compiler inserts the conversions of section 6.9 as it does for any recipe, so a Relix vector needs no `relix:from` or `relix:run` in `setup` or `finish`: a `relix:select` vector ends in `table:to-json`, and the compiler puts `relix:run` between them. The first step of `setup` may be a source (`relix:inline`, `relix:input`, `input:tab`), which ignores `input`.

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

A binary op with a second tab. The right lane reads `customers` with `relix:input`, which parses it, so the lane has no Parse CSV step:

```json
{
  "name": "join matches customer_id to id",
  "ref": "hand-computed",
  "op": "relix:theta-join",
  "params": { "on": "customer_id = id" },
  "setup": [{ "kind": "op", "op": "csv:parse" }],
  "pipe": "left",
  "right": {
    "steps": [{ "kind": "op", "op": "relix:input", "params": { "tab": "customers" } }]
  },
  "inputs": [{ "name": "customers", "value": "id,name\n1,Ada\n", "enc": "utf8" }],
  "finish": [{ "kind": "op", "op": "table:to-json" }],
  "input": { "value": "customer_id,total\n1,40\n", "enc": "utf8" },
  "expect": { "value": "[{\"customer_id\":1,\"total\":40,\"name\":\"Ada\"}]", "enc": "utf8" }
}
```

A Relix op whose input comes from a source in `setup`. `relix:inline` ignores `input`, so the vector's `input` is empty:

```json
{
  "name": "select keeps the rows that match",
  "ref": "relix-core docs/reference/operators/select.md#1",
  "op": "relix:select",
  "params": { "cond": "age > 18" },
  "setup": [
    {
      "kind": "op",
      "op": "relix:inline",
      "params": { "table": "| name | age |\n|---|---|\n| Ann | 30 |\n| Bob | 12 |" }
    }
  ],
  "finish": [{ "kind": "op", "op": "table:to-json" }],
  "input": { "value": "", "enc": "utf8" },
  "expect": { "value": "[{\"name\":\"Ann\",\"age\":30}]", "enc": "utf8" }
}
```

A source with byte steps first, tested through `inputs` and `input:tab`:

```json
{
  "name": "input:tab then Base64 then Parse CSV reads a Base64 tab",
  "ref": "hand-computed",
  "op": "csv:parse",
  "setup": [
    { "kind": "op", "op": "input:tab", "params": { "tab": "orders.b64" } },
    { "kind": "op", "op": "base64:decode" }
  ],
  "inputs": [{ "name": "orders.b64", "value": "aWQsdG90YWwKMSw0MAo=", "enc": "utf8" }],
  "finish": [{ "kind": "op", "op": "table:to-json" }],
  "input": { "value": "", "enc": "utf8" },
  "expect": { "value": "[{\"id\":1,\"total\":40}]", "enc": "utf8" }
}
```

(The ops and the JSON text of the output are illustrative. The expected value of a real vector must come from outside the implementation, RECIPES §9.2 rule 1. `aWQsdG90YWwKMSw0MAo=` is the Base64 of `id,total\n1,40\n`.)

### 10.3 Rules

- **Which step is under test.** The op step at index `setup.length`. A run-time error vector expects `error.path` of `/steps/<setup.length>`. An error raised inside a lane or in `setup` or `finish` has another path and is not an expected form. A static violation is still `E_RECIPE_INVALID` with path `null`.
- **Coverage.** Only `op` is covered. Ops used in `setup`, `finish` or lanes are not. The `uncovered` list is unchanged in meaning.
- **Examples.** A vector with `setup`, `finish`, `inputs` or slots **may** carry `example`. `buildHelp` copies those fields into the help example (`HelpExample` gains the optional `setup`, `finish`, `inputs`, `pipe`, `left`, `right`, `base` and `step`, with the shapes of this section), and the help dialog shows the steps before and after the op in plain text ("Start with: Parse CSV"). The example is still one op on one input. This is the `setup` field of help examples that RELIX.md §10.2 asks for, and it lets the generated vectors of RELIX.md §12.3 mark the first worked example of each page. `vocab/vectors.test.ts` checks that every copied step is an `op` step of the catalogue.
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
| `StepReport.implicit?: { op, from, to }[]` | `types.ts`, `core.ts`, `render.ts` | section 6.9; read from `StepLine.implicit` |
| `BakeEvent` `paused` gains `dataInfo?: StepOutputInfo` | `types.ts`, `core.ts`, `protocol.ts` | optional: a client may ignore it |
| `BAKE_INPUT_LIMITS = { maxInputs: 32, maxInputNameChars: 120 }` and `RENDER_LIMITS.maxSchemaColumns = 256` | `types.ts`, `render.ts` | |
| the input host, read by the core op `input:tab` (and so by `relix:input`) | `core.ts`, `ops` (`input-host.ts`, as `magic-host.ts`; the primitive in `src/prims/input.ts`, vocabulary `input`) | section 7.3 |
| the baker's early tab check | `core.ts` | section 7.4, a SHOULD |
| `init` gains `packs?: readonly string[]` on `BakerInit`, and `InitInfo` gains `packs` | `types.ts`, `protocol.ts` (the strict guard), `core.ts`, `client.ts`, `port.ts` | PACKS.md §4.2 (PK7). **It rides the same protocol 2 bump** (PACKS PQ7: work package P2b lands with RW5, so one bump covers both). A `protocol: 1` client is refused at `init` with `E_PROTOCOL`. *Amended at Gate T1, 2026-11-24.* |
| `BakeOptions.deny?: readonly EffectLabel[]` | `types.ts`, `core.ts` | PACKS.md §6.5, additive, protocol 2 |
| the baker removes `catalogue-mismatch` from the warnings it returns | `core.ts` | section 8.5; PACKS.md §5.4 (P3) |

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
| `bad-slot` | error | a slot key on an op that has no slots; keys of both families; the keys of the other family; the piped slot also present; the slot parameter in `params` | `reason` (`not-slot-op`, `mixed-slots`, `wrong-slots`, `piped-slot-present`, `slot-in-params`), `op`, `slot?`, `expected?` |
| `missing-slot` | error | a slot that must be present is absent, a lane has no enabled step, or a slot op has no slot keys | `slot?`, `reason` (`absent`, `empty`, `no-slots`), `op?` |
| `unused-pipe` | warning | a slot step with no `pipe` after other enabled steps of its list | `op` |
| `pack-not-enabled` | error | an op not in the catalogue, in a vocabulary of a known pack that is off (needs `ValidateOptions.packs`) | `op`, `vocab`, `pack` |

Existing codes with new uses: `bad-param` (an ext string that is not a string, is too long, or has a lone surrogate); `bad-position` (a `return` in a slot lane: `containerKind: "op"`, new `detail.slot`; and `relix:recur` outside a `step` lane: `kind: "relix:recur"`, `reason: "outside-step-slot"`); `bad-value`, `type`, `required`, `unknown-field` (the shape of `pipe` and of a slot; `pipe: "step"` is `bad-value`); `limit` (steps, depth, size); `hash-mismatch` (now silent for a pin in `previousHashes`).

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
| vector `ref` | 1000 characters (was 200) | `vectors.schema.json` (RW8; LANGUAGE-0.3 Q16, §12.8) |

`maxPairs` (8) is unchanged: a link has at most six pairs.

### 14.3 Types and exports

| Package | Addition |
|---|---|
| `@forge/recipe` | `OpStep` gains `pipe?`, `left?`, `right?`, `base?`, `step?`; types `SlotName` (`"left" \| "right" \| "base" \| "step"`), `SlotLane { steps }`, `PackIndex`, `PackUse`, `ImplicitLine`, `Conversion`; `StepLine` gains `implicit?`; `RECIPE_ISSUE_CODES` and `RECIPE_LIMITS` as above; `SHARE_LIMITS` as above; `ShareErrorCode` gains `"packs-needed"`; `ShareError` gains `recipe?`, `packs?`; `ShareState` gains `inputName?`, `tabs?`; `DecodeShareResult` ok gains `inputName?`, `tabs?`; `ValidateOptions.packs?`, `DecodeShareOptions.packs?`; `CatalogueOpView` gains `slot?`, `previousHashes?`; the catalogue view gains `conversions?` |
| `@forge/recipe` | functions `recipeUsesSlots(recipe)`, `recipeUsesV12(recipe, { catalogue?, packs? })`, `inputNames(recipe)`, `dataSourcePath(recipe, path)`, `opVocabs(recipe)`, `packsUsed(recipe, index)`, `planConversions(recipe, catalogue)`; constants `NAMED_INPUT_OPS`, `NAMED_INPUT_PARAM`, `RECUR_OP`, `SLOT_NAMES`, `SLOT_FAMILIES` |
| `@forge/worker` | `BakeInput`, `BakeOptions.inputs`, `StepOutputInfo`, `SchemaColumn`, `StepReport.out`, `StepReport.implicit`, `BakeEvent.paused.dataInfo`, `BAKE_INPUT_LIMITS`, `RENDER_LIMITS.maxSchemaColumns`, `PROTOCOL_VERSION = 2`, and from PACKS.md: `BakerInit.packs`, `InitInfo.packs`, `BakeOptions.deny` |
| `@forge/ops` | `CatalogueOp.slot?`, `CatalogueOp.previousHashes?`, `Catalogue.conversions?`, `SLOT_KINDS`, `SLOT_FAMILIES`, `PrimitiveDef.hardKill?` (section 19.1 a); the core vocabulary `input` with the op `input:tab`; the catalogue schema allows the new fields; `vectors.schema.json` gains the fields of section 10; `HelpExample` gains the optional vector fields of section 10.3 |

`recipeUsesSlots` is true iff some op step has `pipe`, `left`, `right`, `base` or `step`. `recipeUsesV12` is true iff `recipeUsesSlots` is true, or `inputNames` is not empty (so a recipe that only reads a tab with `input:tab` is a v1.2 recipe), or (with `catalogue`) some op step has an `ext` parameter given a value, or (with `packs`) some op is in a pack vocabulary. With no options only the first two tests run. It decides the sentence of the share dialog (section 11.5). `recipeUsesV11` is unchanged.

Source-breaking members, for code that switches exhaustively: `ShareErrorCode` `"packs-needed"`, and the `PROTOCOL_VERSION` literal type. The `ext` members of X1 and X2 are not new here.

### 14.4 Catalogue

- `ParamSpec.kind` (X1, T18), `ParamType "ext"` (X1).
- `CatalogueOp.slot?: string` (section 4.5): `"right"` for a binary op, `"step"` for a base-and-step op.
- `Catalogue.conversions?: CatalogueConversion[]` (section 6.9), declared by packs.
- `CatalogueOp.needsHardKill` is computed over `PrimitiveDef.hardKill` as well as the regex primitives (section 19.1 a).
- `CatalogueOp.previousHashes?: string[]` (section 9.2).
- Rule 4 of RECIPES §2.2: an `ext` parameter counts only for a kind registered with `fromText`.
- The catalogue `version` is a hash of `JSON.stringify(ops)` (RECIPES §2.3), so adding either field to an op changes the version, as any change to an op does.
- With packs, the version of the merged catalogue differs for each set of enabled packs. A recipe's `catalogue` stamp is the **core** version, never the merged one (section 8.5, PACKS PK9).

---

## 15. Conformance cases (CR201 to CR268)

The cases of RECIPES §12.8 are CR101 to CR138. These continue the numbering. Each case is a fenced block with the info string `recipe-proposed` while its feature does not exist (RECIPES-1.1 did the same). When a case is implemented its fence becomes `recipe-case` and RECIPES §12.8 style takes over. The sections of a block are those of RECIPES §12.8 (`@catalogue`, `@recipe`, `@issues`, `@canonical`, `@text`, `@parse`, `@input`, `@output`, `@error`).

**The catalogue of these cases** is the shipped catalogue plus a fixture, written by hand with arbitrary hashes. Its ops:

| op | signature | notes |
|---|---|---|
| `input:tab` | `( any tab:str -- bytes )` | the core source |
| `relix:input` | `( any tab:str format:choice{csv\|tsv\|json\|ndjson}=csv header:bool=true -- ext{relation} )` | a source |
| `relix:recur` | `( any name:str -- ext{relation} )` | a source, valid only in a `step` lane |
| `relix:select` | `( ext{relation} cond:ext{relix-expr} -- ext{relation} )` | unary |
| `relix:theta-join`, `relix:left-join` | `( left:ext{relation} right:ext{relation} on:ext{relix-expr} -- ext{relation} )` | binary, `slot: "right"` |
| `relix:union` | `( left:ext{relation} right:ext{relation} -- ext{relation} )` | binary, `slot: "right"`, no other parameter |
| `relix:fix` | `( base:ext{relation} step:ext{relation} name:str -- ext{relation} )` | base-and-step, `slot: "step"` |
| `relix:from`, `relix:run` | `( ext{table} name:str="" -- ext{relation} )`, `( ext{relation} limit:int[0..]=0 -- ext{table} )` | the conversions of section 6.9, declared in `conversions` |
| `csv:parse` | `( bytes -- ext{table} )` | |
| `table:filter` | `( ext{table} expr:ext{relix-expr} -- ext{table} )` | ext parameter |
| `table:to-json` | `( ext{table} -- str )` | |
| `fx:cat` | `( str right:str -- str )` | `slot: "right"`. A fixture binary op for the cases marked (run); its word is the core `cat` |
| `fx:then` | `( str step:str -- str )` | `slot: "step"`. A fixture base-and-step op; its word is the core `cat` |

The names, parameters and slots of the `relix:` and `input:tab` rows are RELIX.md's. The `fx:` rows are fixtures.

"(run)" marks a case whose FL text was checked by running (section 6.1). Cases marked "(fixture)" need a fixture primitive in the worker tests, because the Relix engine is not part of this wave. Cases marked "(argued)" have text that follows from the rules of section 6 and were not run. RW3 runs them.

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
| CR209 | slot keys on a unary op | invalid, `bad-slot` (`not-slot-op`) |
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
| CR249 | a vector with `setup`, `finish` and slots may be an example, and `buildHelp` copies the fields | vectors, help |
| CR250 | a binary-op vector with a lane and `inputs` | vectors |
| CR251 | the pin cases of CR227 under `strict` | pins |
| CR252 | `previousHashes` limits: five entries, a malformed hash, equal to `hash` | catalogue, invalid |
| CR253 | `relix:fix` with `pipe: "base"`, a `step` lane with `relix:recur` and an inner join | valid |
| CR254 | a base-and-step op with a lane in both slots: first step, and after other steps | valid, `unused-pipe` warning |
| CR255 | `pipe: "step"`; `pipe: "base"` on a binary op; `pipe: "left"` on a base-and-step op | invalid, `bad-value`, `bad-slot` (`wrong-slots`) |
| CR256 | a base-and-step op with no `step` lane, with no slot keys, with an empty `step` lane | invalid, `missing-slot` |
| CR257 | keys of both families; the piped `base` also present; `step` in `params` | invalid, `bad-slot` (`mixed-slots`, `piped-slot-present`, `slot-in-params`) |
| CR258 | `relix:recur` outside a `step` slot, and inside one at depth | invalid, valid |
| CR259 | a `return` in a `step` lane; registers visible in both lanes of a base-and-step op | invalid, valid |
| CR260 | compile base-and-step: `pipe: "base"` and no pipe, with `fx:then` (argued) | text, step map |
| CR261 | the text of CR260 parses to the canonical JSON and back; `[swap]` on a base-and-step op | round trip, invalid |
| CR262 | `input:tab` as the first step and in a lane: `inputNames` lists both ops, a link carries both tabs | valid, share |
| CR263 | `relix:input` followed by Parse CSV | valid; `E_TYPE` at the second step (fixture) |
| CR264 | the lift and the end-of-recipe run are inserted, marked `@implicit` and dropped on parse | text, step map, round trip |
| CR265 | vectors for Relix ops: a source in `setup`, `finish`, and an `input:tab` vector with `inputs` | vectors |
| CR266 | a run inserted before a table op in mid-recipe, and `StepReport.implicit` (fixture) | bake |
| CR267 | `needsHardKill` of an op that reaches a `hardKill` primitive, and of a recipe whose only hard-kill word is the implicit run | catalogue, helpers |
| CR268 | a slot parameter named neither `right` nor `step` fails `buildCatalogue` | catalogue, invalid |

### 15.2 Validation

```recipe-proposed
# CR201 the orders recipe, pipe left
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "input:tab", "params": { "tab": "orders.b64" } },
  { "kind": "op", "op": "base64:decode" },
  { "kind": "op", "op": "csv:parse" },
  { "kind": "op", "op": "relix:select", "params": { "cond": "status = 'paid'" } },
  { "kind": "op", "op": "relix:theta-join", "params": { "on": "customer_id = id" }, "pipe": "left",
    "right": { "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": "customers.csv" } },
      { "kind": "op", "op": "relix:select", "params": { "cond": "country = 'NZ'" } } ] } } ] }
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
{ "forge": 1, "steps": [ { "kind": "op", "op": "relix:theta-join", "params": { "on": "a = b" } } ] }
@issues
error missing-slot /steps/0 reason=no-slots op=relix:theta-join
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
  { "kind": "op", "op": "relix:select", "params": { "cond": "a = 1" }, "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } },
  { "kind": "op", "op": "relix:theta-join", "params": { "on": "a = b", "right": "orders" }, "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
error bad-slot /steps/0/pipe reason=not-slot-op op=relix:select
error bad-slot /steps/1/params/right reason=slot-in-params op=relix:theta-join slot=right
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
  { "kind": "op", "op": "relix:theta-join", "params": { "on": { "ref": "min-age" } }, "pipe": "left",
    "right": { "steps": [
      { "kind": "op", "op": "relix:input", "params": { "tab": { "ref": "min-age" } } },
      { "kind": "register", "name": "inner", "steps": [] } ] } },
  { "kind": "op", "op": "relix:select", "params": { "cond": { "ref": "inner" } } } ] }
@issues
error unknown-register /steps/3/params/cond/ref register=inner reason=out-of-scope
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

```recipe-proposed
# CR253 a base-and-step op: the data above is the base, and the step lane reads the accumulator
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:input", "params": { "tab": "edges.csv" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "Reach" }, "pipe": "base",
    "step": { "steps": [
      { "kind": "op", "op": "relix:recur", "params": { "name": "Reach" } },
      { "kind": "op", "op": "relix:theta-join", "params": { "on": "dst = src2" }, "pipe": "left",
        "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "edges.csv" } } ] } } ] } } ] }
@issues
none
```

```recipe-proposed
# CR254 a lane in both slots: fine as a first step, a warning after other steps
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" },
    "base": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "step": { "steps": [ { "kind": "op", "op": "relix:recur", "params": { "name": "R" } } ] } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" },
    "base": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "step": { "steps": [ { "kind": "op", "op": "relix:recur", "params": { "name": "R" } } ] } } ] }
@issues
warning unused-pipe /steps/1 op=relix:fix
```

```recipe-proposed
# CR255 pipe "step" does not exist; the other family's keys on a slot op
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:input", "params": { "tab": "a" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" }, "pipe": "step",
    "base": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] } },
  { "kind": "op", "op": "relix:union", "pipe": "base",
    "step": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" }, "pipe": "left",
    "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
error bad-value /steps/1/pipe
error bad-slot /steps/2/pipe reason=wrong-slots op=relix:union expected=left,right
error bad-slot /steps/3/pipe reason=wrong-slots op=relix:fix expected=base,step
```

```recipe-proposed
# CR256 a base-and-step op needs its lanes
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:input", "params": { "tab": "a" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" }, "pipe": "base" },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" }, "pipe": "base", "step": { "steps": [] } } ] }
@issues
error missing-slot /steps/1/step slot=step reason=absent
error missing-slot /steps/2 reason=no-slots op=relix:fix
error missing-slot /steps/3/step slot=step reason=empty
```

```recipe-proposed
# CR257 keys of both families; the piped base also present; the slot parameter in params
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:input", "params": { "tab": "a" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" },
    "left": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "step": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" }, "pipe": "base",
    "base": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] },
    "step": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R", "step": "x" }, "pipe": "base",
    "step": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "b" } } ] } } ] }
@issues
error bad-slot /steps/1 reason=mixed-slots op=relix:fix
error bad-slot /steps/2/base reason=piped-slot-present slot=base op=relix:fix
error bad-slot /steps/3/params/step reason=slot-in-params op=relix:fix slot=step
```

A step with `mixed-slots` or `wrong-slots` reports no further slot issue (`missing-slot`, `unused-pipe`), because the family it meant is not known.

```recipe-proposed
# CR258 relix:recur is valid only inside a step lane, at any depth (issues in path order)
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:recur", "params": { "name": "R" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" },
    "base": { "steps": [ { "kind": "op", "op": "relix:recur", "params": { "name": "R" } } ] },
    "step": { "steps": [
      { "kind": "op", "op": "relix:union",
        "left": { "steps": [ { "kind": "op", "op": "relix:recur", "params": { "name": "R" } } ] },
        "right": { "steps": [ { "kind": "op", "op": "relix:input", "params": { "tab": "a" } } ] } } ] } } ] }
@issues
error bad-position /steps/0 kind=relix:recur reason=outside-step-slot
warning unused-pipe /steps/1 op=relix:fix
error bad-position /steps/1/base/steps/0 kind=relix:recur reason=outside-step-slot
```

The `relix:recur` at `/steps/1/step/steps/0/left/steps/0` is inside a `step` lane, in a nested lane of a binary step, and is valid. A disabled `relix:recur` outside a `step` lane is still `bad-position`.

```recipe-proposed
# CR259 a return in a step lane is bad-position
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "relix:input", "params": { "tab": "a" } },
  { "kind": "op", "op": "relix:fix", "params": { "name": "R" }, "pipe": "base",
    "step": { "steps": [ { "kind": "op", "op": "relix:recur", "params": { "name": "R" } },
                         { "kind": "return" } ] } } ] }
@issues
error bad-position /steps/1/step/steps/1 kind=return container=/steps/1 containerKind=op slot=step
```

CR259, second half: a register defined above a `relix:fix` is visible in its `base` lane and its `step` lane, and a register defined in one lane is not visible in the other (the rules of CR214 and CR215, with the other slot names).

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
  { "kind": "op", "op": "relix:select", "params": { "cond": "a = 1" } },
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
  "note": "join", "pipe": "left", "params": { "on": "a = b" }, "op": "relix:theta-join", "kind": "op" } ] }
@canonical
{"forge":1,"steps":[{"kind":"op","op":"relix:theta-join","params":{"on":"a = b"},"pipe":"left","right":{"steps":[{"kind":"op","op":"relix:input","params":{"tab":"b"}}]},"note":"join"}]}
```

The key order is `kind op params hash pipe left right base step` and then `disabled breakpoint note`. CR230: `"age>30"` and `"age > 30"` stay as written, in `normalise` and in `canonical`.

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

```recipe-proposed
# CR260 base-and-step, pipe base (argued, with the fixture op fx:then)
@catalogue
shipped plus the fixture ops
@recipe
{ "forge": 1, "steps": [
  { "kind": "op", "op": "text:upper" },
  { "kind": "op", "op": "fx:then", "pipe": "base",
    "step": { "steps": [ { "kind": "op", "op": "text:lower" } ] } } ] }
@text
\ forge-recipe 1
: main ( bytes -- any )
  text:upper
  [
    text:lower
  ] recipe:peek
  fx:then
;
```

CR260, no pipe: `] recipe:peek swap` for the `base` lane, `] recipe:peek nip` for the `step` lane, then `fx:then`. The two texts are the texts of CR232 and CR234 with `fx:cat` replaced by `fx:then`, which is the point: the family changes the names in the JSON and nothing in the text. CR261: each text parses to the canonical JSON of its recipe, the catalogue's `slot: "step"` deciding that the lanes are `base` and `step`. The text of CR233 (`] recipe:peek swap`, then `fx:then`) is `bad-slot` (`wrong-slots`) after parsing, because `fx:then` has no `left` slot.

CR264 (argued). The recipe of section 4.4 compiles to the text of section 6.1, with `"" relix:from  \ @implicit` after `csv:parse` and `0 relix:run  \ @implicit` before the `;`. Their step-map entries are the ones in the table of section 6.4: lines 7 to 8 for `/steps/3` and 15 to 16 for `/steps/6`. `parseRecipeText` of that text returns the canonical JSON of section 4.4, with neither implicit line. A text that has `@implicit` on a `core:exit` line, a comment, a register open line or a container line is `bad-value`. A recipe with no conversion in its catalogue (no `conversions`) compiles with no implicit line.

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

CR262: a recipe whose first step is `input:tab` of `orders.b64` and whose right lane has `relix:input` of `customers.csv`: `inputNames` returns both names, in document order, with their paths, and a link carries both tabs under the rules of CR239. `recipeUsesV12` is true for a recipe whose only v1.2 feature is `input:tab`.

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
- **CR247 to CR250.** The vectors of section 10.2 pass; an error vector with `setup` of length 1 expects `path: "/steps/1"`; a vector with `setup` and `example` is accepted, and `buildHelp` copies its `setup`, `finish`, `inputs` and slot fields into the help example (CR249); the binary-op vector passes with its lane and `inputs`.
- **CR252.** A catalogue op with five `previousHashes`, with a hash that is not 64 hex digits, or with one equal to `hash` fails the catalogue schema.
- **CR263 (fixture).** The recipe `input:tab` of `a.csv`, then `relix:input` of `b.csv`, then `csv:parse`, is valid: the validator tracks no types. The bake fails at `/steps/2` with `E_TYPE` (the data input of `csv:parse` is `bytes` and it got a relation), and the editor shows the red type badge of RELIX-LANES §6. The same recipe without the `csv:parse` runs.
- **CR265.** The vectors of section 10.2 with `relix:select` and with `input:tab` pass on a fixture runtime. A `relix:` vector with a `setup` that starts with a source ignores `input`. The error path of a vector with a source in `setup` is `/steps/<setup.length>`.
- **CR266 (fixture).** The recipe `relix:input`, `relix:select`, `table:to-json` compiles with `0 relix:run  \ @implicit` between the last two lines. The `StepReport` of `/steps/2` has `implicit: [{ op: "relix:run", from: "relation", to: "table" }]`. The same recipe in a catalogue with no `conversions` compiles with no extra line, and the bake fails with `E_TYPE` at `/steps/2`.
- **CR267.** In a catalogue with a primitive that declares `hardKill: true` and an FL op that calls it, `buildCatalogue` sets `needsHardKill` on both. A recipe whose steps are `relix:input` and `relix:select` has `recipeNeedsHardKill` true when `relix:run` is hard-kill, although no step is `relix:run`, and false when it is not.
- **CR268.** A catalogue build with a binary-looking op whose first parameter is a relation named `other` fails with a build error that names the op and the two accepted names, `right` and `step`.

---

## 16. What an old reader does

An old reader means any code that implements recipe format v1.1 (this repository before this wave, an editor plugin, a converter). The first column is a new feature. "Observed" means run in section 2.1.

| New feature | What a v1.1 reader does | Safe? |
|---|---|---|
| `pipe`, `left`, `right`, `base` or `step` on an op step | `unknown-field` at the key (observed). A recipe with slots is `invalid-recipe` | Yes: it fails closed |
| an op from the Relix pack or other new vocabulary, or the core op `input:tab` | `unknown-op` (observed for `relix:theta-join` and `input:tab`) | Yes |
| an ext parameter string | not reachable: the op is unknown. If a v1.1 reader were given a catalogue with one, `bad-param` (observed) | Yes |
| the text of a slot step | `bad-value`, "expected ] followed by fork, …" (observed) | Yes |
| `n` and `t` in a link | ignored (observed). Safe because the writer MUST NOT write them unless the recipe names a tab (with `input:tab` or `relix:input`, section 11.3), and such a recipe is invalid in v1.1 | Yes |
| `@implicit` on a line of the text | `bad-value`: the annotation is not one of `@pin`, `@break` and `@note`. The recipe it came from has Relix ops anyway, which are `unknown-op` there | Yes |
| a `bake` message with `inputs` to a v1.1 worker | refused by the message guard, answered `fatal` (observed). With `protocol: 2`, `init` fails first with `E_PROTOCOL` | Yes |
| a `previousHashes` field in a catalogue | an old build does not read a catalogue it was not built with | n/a |
| a vector with `setup` | an old runner rejects the file against its schema (`additionalProperties: false`) | Yes |
| the new issue codes | an old reader never emits them | n/a |

The messages are less explicit than a version error would be. That was accepted for v1.1 (RECIPES A.11) and is accepted again here (Q1). The share dialog states the requirement before the link is made.

A **new reader** reads every v1 and v1.1 recipe, text and link unchanged. Their canonical JSON, text and fragments do not change, and the goldens of RECIPES §12 and the cases CR101 to CR138 stand.

---

## 17. Decisions: the owner's answers to Q1 to Q16

The owner decided these at Gate T1 on 2026-11-23. **Every recommended answer was accepted**, with two changes that come from [RELIX.md](RELIX.md): Q5 is replaced (FIX and ITERATE are in the format, as slots `base` and `step`), and a new decision, Q16, records that `relix:input` reads and parses a tab, with a separate core op `input:tab` for bytes. The sections of this file say what each answer means.

**Q1. Is the wave v1.2 (`"forge": 1`) or 2.0?** Decided: **v1.2, `"forge": 1`.**

- *Why.* Section 2 finds every item additive: no v1.1 recipe changes meaning, and every new construct fails closed. The 1.1 precedent (R29) applies. The facts do not call for a bump.
- *What it means.* One number stays on every recipe, text, link and golden. A new Forge writes recipes that older Forge refuses with `unknown-field`, `unknown-op` or `bad-value`, not with `bad-version`. The share dialog warns the author first. This file is `RECIPES-1.2.md`. At fold-in, RECIPES.md gains Appendix B, "Changes in v1.2", as Appendix A did for v1.1.
- *The rejected alternative, kept for the record.* A 2.0 would give a clearer old-reader message (`bad-version`), and one name for "the Relix wave". If a bump had been made it would have been a **minimum-version writer**: `forge` is written as 1 unless the recipe uses a v1.2 feature (`recipeUsesV12`), so that a plain byte recipe saved by a new Forge still opens in every old one. The rules to add would have been: the schema `forge` becomes `{ "enum": [1, 2] }` and the schema `$id` a second one; `bad-version` fires for any other value; `normalise` sets `forge` to the minimum that the recipe needs; the text header is `\ forge-recipe 2` only for such recipes, and the parser accepts both; `v=` of the share link stays 1. Added cost: the version rule in `normalise`, the schema, the text header, `bad-version` cases, and a second `forge` value in every tool that reads the format. A fixed `forge: 2` writer would have made every recipe from the new Forge unreadable by every old Forge, plain ones included.

**Q2. How does the catalogue mark a slot op?** Decided: **derived**. `buildCatalogue` sets `CatalogueOp.slot` when the data input and the first parameter are both `ext{relation}` (section 4.5), and RELIX.md writes its wrappers that way. The alternative, a `META:` clause such as `slot right ;`, is explicit but is an FL change (LANGUAGE v0.2, SP1) and a second place that must agree with the header.

- *Base and step.* The derivation rule detects `relix:fix` and `relix:iterate` as it detects a binary op, because their headers are `( base:relation step:relation … )`. It did not say which slots the op has, so it is **extended**: the **name** of the slot parameter selects the family. `right` gives the slots `left` and `right`. `step` gives the slots `base` and `step`. Any other name is a build error. `CatalogueOp.slot` is `"right"` or `"step"` accordingly, and `SLOT_FAMILIES` maps it (section 4.5). RELIX.md §3.4 and §3.5 use these names.

**Q3. May a slot lane start with something other than a source?** Decided: **yes** (RELIX-LANES Q5). A lane runs on a copy of the data entering the step (section 4.3). A source op ignores it. The editor may still insist that its own gestures start a lane with a source.

**Q4. Is `pipe` on a first step an error?** Decided: **no.** It is valid and has the meaning of section 4.6. The editor keeps its normal form (RELIX-LANES §2.3 rule 1) and clears it. The alternative is a `bad-slot` code, which needs the validator to know what "first" means once comments and registers are in the list, for little gain.

**Q5. N-ary union, FIX and ITERATE (RELIX-LANES Q2 and Q3).** Decided: **N-ary union is a chain; FIX and ITERATE are recipe steps with two slots, `base` and `step`.** This replaces the first draft's answer, which kept FIX and ITERATE outside the format, by the owner's decision on conflict 1: RELIX.md's answer (RQ5) wins.

- Binary operators have exactly two slots, `left` and `right`. An N-ary union is a chain of `relix:union` steps.
- `relix:fix` and `relix:iterate` are op steps with the slots `base` and `step` (sections 4.1 and 4.2). The data from above may feed `base` only (`"pipe": "base"`). The `step` lane is always explicit, and inside it `relix:recur` reads the accumulator. `"pipe": "step"` does not exist.
- The `step` lane is a lane like any other: a scope, a copy of the data entering the step, the same limits. It is not a second kind of slot with another rule for its input. What makes it a loop body is only that `relix:recur` is valid there (section 5.2). The loop itself is the op's, not the format's: the lane is evaluated once, to build the relation, and the engine runs it round by round. This is why no new format mechanism is needed, and why the first draft's worry (a "second kind of slot like `repeat`") does not arise.
- A later wave can add more named slots, because a slot is a lane object.

**Q6. May a register be a slot's source (RELIX-LANES Q6)?** Decided: **no.** A reference is accepted in `params` only (RECIPES §3.4). Use a saved relation, or `relix:input` of a tab. A "register as source" step is a possible later addition and would not change anything here.

**Q7. What does a share link carry of the other tabs?** Decided: **only the tabs an `input:tab` or `relix:input` step names, offered by the dialog with the name and the size of each, selected by default**, because a link to a recipe that reads a tab it does not carry cannot be run. The user can deselect any. The writer MUST NOT carry other tabs (section 11.3). The alternative is to carry no tabs and let the opener supply them, which makes every shared join unrunnable until the opener finds the data.

**Q8. Bump `PROTOCOL_VERSION` to 2?** Decided: **yes** (section 12). The alternative is to keep 1 and accept a `fatal` on a skewed build. The bump is a contract change at Gate T1 with the other `packages/worker` changes.

**Q9. Is there a `packs` field in the recipe?** Decided: **no** (section 8.1). Pack ops are named by their qualified names, `PackIndex` tells the validator which vocabularies are in a pack that is off, and a link that needs a pack is a `packs-needed` failure that carries the recipe. The alternative is a header field `"packs": ["relix"]`. It would let the page offer the pack without a catalogue lookup, at the cost of a second source of truth.

**Q10. Pins across hash changes (TOOLKIT Q10).** Decided: **`previousHashes`** (section 9). Only ops whose vectors are identical in both releases get one, and an old pin to such an op is silent. The alternatives are in section 9.3. The owner confirms before the v0.2 sweep, because the script has to run on the pre-sweep tag.

**Q11. `recipe.catalogue` and packs.** Decided: **the validator skips `catalogue-mismatch` for a recipe that has an op in a pack vocabulary, and `encodeShare` omits `catalogue` for it** (section 8.5). The alternative is to leave the warning, which fires for every reader with a different set of packs on. *Amended at Gate T1, 2026-11-24 (PACKS PK9): `recipe.catalogue` is the core catalogue version or absent, so a pack-free recipe is compared against the core version whatever packs are on, and the baker drops `catalogue-mismatch`. The two rules above still hold for a recipe that has a pack op.*

**Q12. Add `finish` beside `setup` in vectors?** Decided: **yes** (section 10.2). T22 names only `setup`. Without `finish`, an op that returns a table cannot have a vector, and `table:to-json` has to be the op under test for every such case.

**Q13. Where does the per-step schema travel?** Decided: **in `StepReport.out` of the final result, and in `dataInfo` of the `paused` event** (section 7.5). The alternative is a progress event per step, which costs one message per step. The editor can recompute from the last result.

**Q14. Does the validator report `slot-type` (RELIX-LANES §8)?** Decided: **no.** The validator tracks no types. `fit.ts` shows the badge and the traffic light, and `E_TYPE` at run time is attributed to the step.

**Q15. Are ext strings normalised?** Decided: **no** (section 3.4). The format has no `toText`. A page action can tidy a string through the kind.

**Q16. What do `relix:input` and the bytes source look like? (Conflict 2 between SP2's first draft and RELIX.md RQ1.)** Decided: **RELIX.md's answer wins.**

- `relix:input ( -- relation )` has the parameters `tab`, `format` (`csv`, `tsv`, `json`, `ndjson`; default `csv`) and `header` (default `true`). It reads a tab **and parses it itself**, with the core table parsers. A Parse CSV after it is wrong.
- A new **core** op reads a tab as raw bytes for the byte-step route: **`input:tab ( -- bytes )` with the parameter `tab`**, in the core vocabulary `input`. It works with no pack enabled. RELIX.md §3.2.1 makes it concrete.
- A recipe that needs byte steps first (Base64, decompression, another charset) is `input:tab`, then the byte steps, then Parse CSV. A recipe that reads a plain CSV tab is `relix:input` alone.
- Both ops are sources: in the catalogue their data input is `any` (a catalogue op needs an input, section 7.1), and they ignore it.
- The format needs both to share one reader of tabs (section 7.3), one set of constants (`NAMED_INPUT_OPS`), and one early check and error (section 7.4).

---

## 18. Work packages

Ids have the prefix RW (recipe wave). "Maps to" says which TOOLKIT row or RELIX-LANES package the work package is or overlaps. All packages: Apache header on every new file, the CSP rules of UI.md §4, `npm run lint && npm run typecheck && npm test && npm run build` pass, and no edits outside owned paths. Packages that change `packages/*` start only after Gate T1, which has now passed. Agents: So is Sonnet, Ha is Haiku (CLAUDE.md).

| WP | Scope | Files | Depends on | Maps to | Agent | Done when |
|---|---|---|---|---|---|---|
| RW1 | The model for slots: types (`pipe`, `left`, `right`, `base`, `step`, `SLOT_NAMES`, `SLOT_FAMILIES`, `RECUR_OP`), `RECIPE_ISSUE_CODES` and limits, the schema (`opStepAdditions`), the validator rules and codes of section 5.2 including `relix:recur` and the base-and-step rules, `normalise`, `resolve`, `pinRecipe`, `registersInScope`, `registerInfo`, `recipeNeedsHardKill`, `recipeUsesSlots`, `recipeUsesV12`, `dataSourcePath`, `inputNames` (over `NAMED_INPUT_OPS`); the corpus `packages/recipe/test/corpus/v12/{valid,invalid,validator-only}/` | `packages/recipe/src/*`, `recipe.schema.json`, `test/corpus/v12/` | Gate T1 | RELIX-LANES RL1; the format half of X3 and X5 | So | Schema and validator agree on the corpus; every v1 and v1.1 recipe, golden and case CR101 to CR138 unchanged; CR201 to CR219 and CR253 to CR259 hold; a v1.1 reader refuses a recipe with slots (the corpus runs against a copy of the v1.1 validator) |
| RW2 | Ext parameters in the recipe layer: `checkParamValue` `case "ext"`, `maxExtChars`, the coercion row, resolve default, text parsing of an ext literal | `packages/recipe/src/validate.ts`, `normalise.ts`, `text.ts`, `types.ts` | X1 (`ParamSpec.kind`), RW1 | X3 (recipe half) | So | CR220 to CR225, CR230 hold; `@forge/recipe` has no kind registry (a test greps for one) |
| RW3 | Compilation, step map and text for slots and conversions: the binary and base-and-step forms, the pending-lane parser with the catalogue's slot family, `StepLine` ranges, `planConversions` and the `@implicit` annotation (section 6.9), round trips | `packages/recipe/src/compile.ts`, `text.ts`, `stepmap.ts`, `conversions.ts`, tests including the (run) cases on a real runtime in `packages/ops/src/recipe.test.ts` | RW1, RW4 (or a fixture catalogue with `slot` and `conversions`) | RL6 (compiler half); RELIX.md R4 (compiler hook) | So | CR231 to CR238, CR260, CR261, CR264 and CR266 hold; CR232 to CR235 run on a real runtime with the fixture `fx:cat`, and CR260 with `fx:then`; `compileRecipe` of a recipe with no slot step and no conversion is byte-identical to today's |
| RW4 | The catalogue: `CatalogueOp.slot` and its derivation with the family names, `previousHashes`, `Catalogue.conversions`, `SLOT_KINDS`, `SLOT_FAMILIES`, `PrimitiveDef.hardKill` and `needsHardKill` over it, rule 4 for `ext`, the schema, `pins-compat.json` loading | `packages/ops/src/catalogue.ts`, `types.ts`, `catalogue.schema.json`, `catalogue.test.ts` | X1 | X1 (catalogue part), P1 | So | `slot` is `"right"` for the fixture binary ops, `"step"` for the fixture base-and-step ops and absent for every other op; CR252, CR267 and CR268 hold; `version` changes accordingly |
| RW5 | The bake protocol and the tab sources: `inputs`, `PROTOCOL_VERSION` 2, the input host, the core vocabulary `input` with the op `input:tab` (the primitive and its `META:`), the early tab check over `NAMED_INPUT_OPS`, `StepReport.out` and `.implicit`, `dataInfo`, limits, the message guards, `core`, `client`, `port` | `packages/worker/src/*`, `packages/ops/src/prims/input.ts`, `packages/ops/src/input-host.ts`, `packages/ops/vocab/input.fth` and its vectors | RW1, X1 (`ExtKind.schema`) | X5 | So | CR242 to CR246, CR262 and CR266 hold; `input:tab` has vectors with `inputs` (RW8's format, or a hand-written test until RW8 lands); a `protocol: 1` client gets `E_PROTOCOL` at `init`; the in-process baker, the client and the Node host pass the same tests |
| RW6 | Share: `n`, `t`, the bundle codec, `packs-needed`, `PackIndex`, `opVocabs`, `packsUsed`, limits | `packages/recipe/src/share.ts`, `types.ts`, `index.ts` | RW1 | P5 (the codec half), P3 (`opVocabs`) | So | CR226 to CR228, CR239 to CR241 hold; the hostile-fragment cases of RECIPES §7.5 still pass; a v1.1 fragment is decoded as before |
| RW7 | Pins: `previousHashes` in the pin check; the script `pins:compat` and its test | `packages/recipe/src/validate.ts`, `packages/ops/scripts/pins-compat.ts`, `vocab/pins-compat.json` | RW4, and the v0.2 sweep (SP1 and T2) for the first real run | TOOLKIT Q10 | So | CR227 and CR251 hold; the script's output on two fixture catalogues is tested |
| RW8 | Vectors and help examples: `setup`, `finish`, `inputs` and the slot fields in `vectors.schema.json`, and the vector `ref` cap of 1000 characters (LANGUAGE-0.3 Q16); the runner; `HelpExample` fields and the `buildHelp` copy; pack vector discovery | `packages/worker/src/vectors.ts`, `packages/ops/vocab/vectors.schema.json`, `vocab/vectors.test.ts`, `buildHelp` | RW1, RW3, RW5 | T22 | So | CR247 to CR250 and CR265 hold; an existing vector file is unchanged and passes |
| RW9 | The fold-in: RECIPES.md sections 2.2, 3, 5, 6, 7, 8, 9 and 12, a new Appendix B, UI.md §2.3 pointers, and this file becomes a historical note (as RECIPES-1.1.md did) | `docs/RECIPES.md`, `docs/RECIPES-1.2.md` | RW1 to RW8 | as WP 6.41 | So | the "where each piece goes" table below is complete; the cases of section 15 are `recipe-case` blocks with their tests named |
| RW10 | The web app's format-facing work: share dialog notes and the tab and pack lists, the enable offer, `fit` for slot lanes and for the conversions of `planConversions`, the issue texts for the new codes and reasons, the missing-tab text | `apps/web/src/*` | RW1, RW3, RW5, RW6 | RL2 to RL7 (the editor), P4 and P5, X3 (UI half) | So | the editor packages of RELIX-LANES §11.2 own the gestures. This package adds the texts and the dialogs, and passes axe |

RW2, RW4 and RW5 touch different packages (RW4 and RW5 touch different files of `packages/ops`) and can run in parallel after RW1, in separate worktrees. RW3 and RW6 touch `packages/recipe` files that RW1 owns, so they follow RW1's merge. RW3 needs the catalogue types of RW4, and may start against a fixture catalogue. RW7 waits for the sweep to have a real second catalogue, but its script can be built and tested earlier on two fixture catalogues.

**Where each piece goes in RECIPES.md at the fold-in.**

| Piece | Section |
|---|---|
| `ext` parameter type | §2.2 rule 4, §3.4 table, §3.7 (`bad-param`), §3.8 |
| slots: model, JSON, rules (four slot names, `relix:recur`) | §3.2 (a paragraph under `op`), §3.7 (new codes), §3.8, §3.9 |
| slots: compilation, map, text | §5.3, §5.5, §6.2, §6.3, §6.4 |
| implicit conversions, `@implicit` | §2.3 (`conversions`), §5.3, §5.5, §6.2 |
| `CatalogueOp.slot`, `previousHashes`, `hardKill` | §2.3 and the catalogue schema; §3.10 |
| named inputs, `input:tab`, `StepReport.out` | §2.1 (the vocabulary `input`), §8.2, §8.4, §8.8 |
| pack ops | §3.7 (`pack-not-enabled`), §7.3, §8.2 |
| `n`, `t`, `packs-needed` | §7.1, §7.3 |
| vectors and help examples | §9.1, §9.2, §9.3, §2.7 |
| conformance cases | §12.9 (CR201 to CR268) |
| the summary | Appendix B, "Changes in v1.2" |

**Requirements on RELIX.md (SP6).** The recipe mechanics need these of the Relix words. RELIX.md meets them as of the Gate T1 edit. SP6 owns everything else.

1. Every binary operator has the header `( left:relation right:relation … -- relation )`: the data input and the first parameter are `relation`, and the first parameter is the slot parameter, named `right`. Every base-and-step operator has the header `( base:relation step:relation … -- relation )`, with the slot parameter named `step` (section 4.5; RELIX.md §3.4 and §3.5).
2. Every source has the data input `any` and ignores it. `relix:input` and `input:tab` have the parameter `tab`, which is matched exactly (section 7.1; RELIX.md §3.2 and §3.2.1).
3. The kinds are `table`, `relation` and `relix-expr`. `relix-expr` has a `fromText` and a `schema`-aware parser module shared by the worker and the page (T20). `relation` has a text form.
4. A primitive that calls the engine includes the engine's version in its `version` (section 8.4), and declares `hardKill: true` unless its cancellation is cooperative (section 19.1 a).
5. The pack declares the conversions of section 6.9 in its manifest: `table` to `relation` (`relix:from`) and `relation` to `table` (`relix:run`, `atEnd`). Both words have defaults for every parameter. RELIX.md §2.4 states which coercions happen at a word boundary.

---

## 19. Answers to the asks of RELIX.md, and what other documents need

### 19.1 Answers to the asks of RELIX.md §16, item 10

RELIX.md §16 asks SP2 for six things, and §3.4 and §12.3 ask for two more. Where an ask was already covered, this list points to it. Where it was not, this section specifies it.

| Ask | Answer | Where |
|---|---|---|
| How the catalogue marks a slot parameter | `CatalogueOp.slot`, derived from the header, with the family chosen by the parameter's name | §4.5, Q2 |
| Slots `base` and `step` for FIX and ITERATE, and what the data from above may feed | Slots `base` and `step`. The data above feeds `base` only (`pipe: "base"`). The `step` lane is explicit. | §4.1, §4.2, Q5 |
| How the compiler orders the two relations on the stack (RELIX.md §3.4) | the data input, then the slot parameter, then the other parameters; the forms of §6.1 | §6.1 |
| The compiler inserts `relix:from` and `relix:run`, marked implicit | `Catalogue.conversions`, `planConversions`, the `@implicit` annotation, `StepLine.implicit`, `StepReport.implicit` | §6.9 |
| The `setup` field of op vectors and of help examples (T22) | `setup`, `finish`, `inputs` and the slot fields in vectors; copied into help examples | §10 |
| `needsHardKill` for engine-running words | (a) below | here |
| The 4,096-character limit for `relix-expr` text | `RECIPE_LIMITS.maxExtChars` is 4096 **code points**, per ext parameter. A kind may enforce less in its own tier-1 check. | §3.2, §3.3, §14.2 |
| How a table output is compared in a vector (RELIX.md §12.3) | `finish` turns the output into bytes; the vector compares bytes | §10.2 |

**(a) `needsHardKill` for engine words.** RECIPES §2.3 computes `needsHardKill` from the regex primitives only (`isRegexPrimitive`). It is extended. A primitive may declare `hardKill: true` in its `PrimitiveDef` (a new optional field in `@forge/ops`). `buildCatalogue` sets `needsHardKill` on an op iff the op, or any FL word reachable from it through `CompiledWord.deps`, is a regex primitive or a primitive that declares `hardKill: true`. The Relix pack declares it on each primitive that runs the engine: the terminals (`relix:run`, `relix:explain`, `relix:optimized`, `relix:schema`, `relix:>text`, `relix:parse`) and the FL batch loop. The building words do not run the engine and do not declare it. When the pack's cancellation works through the shared flag in every environment (RELIX.md §8.2), the pack may drop the declaration, and nothing else changes. An untrusted bake without `hardKill` refuses a recipe that reaches such an op, as it does for regexes (RECIPES §4.1, §8.6). The compiler appends `relix:run` to a recipe that ends in a relation, so `recipeNeedsHardKill` counts that word as a step (section 6.8). `input:tab` and `relix:input` need no hard kill.

### 19.2 Edits to other documents

This work package changes this file and the §2.2 rule of RECIPES.md. The Gate T1 edit also brought RELIX.md and RELIX-LANES.md into line. The other documents need these edits.

**TOOLKIT.md**

- §2.3 (Blockers), "Doc drift" row, and §15, RECIPES bullet: `INTERNAL_VOCABS` holds eight vocabularies, not six, and the §2.2 correction is done (section 13). §11.6, the "Public not an op" row, says "six internal vocabularies in code": eight.
- §2.3, "Recipe shape" row: "Parameters cannot be trees" becomes "slots" (section 4).
- §8.2, the "Binary operators" bullet: replace "a relation-valued parameter … The recipe format needs parameters that can be trees (RECIPES v2)" by slots (`pipe`, `left`, `right`, and `base` and `step` for FIX and ITERATE) and "the next wave of the recipe format, v1.2". The slot parameter is not in `params`. Add the core source `input:tab` next to `relix:input` (RELIX.md §3.2.1).
- §13.3, row SP2: the deliverable is first a proposal, `docs/RECIPES-1.2.md`, and RECIPES.md changes at the fold-in (RW9). "Depends on SP1" is not needed for this proposal.
- §13.5, rows X3 and X5: add the per-step schema (`StepReport.out`, `dataInfo`, section 7.5), `PROTOCOL_VERSION` 2 and `BakeOptions.inputs`; X5 also owns the core op `input:tab` and its input host. X3 depends on RW2 and X5 on RW5. Row P5 needs `packs-needed` and `PackIndex` (RW6), and P3 `opVocabs`. Add the RW rows or point to section 18.
- §14.2, Q10: record the decided answer of section 9. Record the decisions of section 17 as T23 onward, and the version decision (Q1) as one of them.
- §14.1: a new risk, "a catalogue that depends on the enabled packs (`catalogue-mismatch`, section 8.5)".

**UI.md (SP3)**

- §2.3: the share dialog sentence for the new wave, the tab and pack lists, the missing-tab and `pack-not-enabled` texts, the help dialog's display of `setup` and `finish` (section 10.3), and the use of `StepReport.out` for the ext field. Not part of this work package. *Met at Gate T1 (2026-11-24) by the proposal UI-TOOLKIT.md*: §5.6 (the share dialog sentence and the tab and pack lists), §5.3 (the missing-tab text), §6.6 (the `pack-not-enabled` text), §3 (the use of `StepReport.out`) and §9.1 (`setup` and `finish` in the help dialog). UI.md itself changes as the work packages of UI-TOOLKIT.md §12 land. The page-level "missing tab" notice is not a recipe issue code.

**PLAN.md**

- The Phase table and decisions gain the rows of section 18 now that the owner has approved this file, as WPs 6.34 to 6.41 did for 1.1.

