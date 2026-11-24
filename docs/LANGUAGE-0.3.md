# FL v0.3: the remaining language proposals of TOOLKIT §11

Status: **a proposal, 2026-11-23. Not normative.** This is work package SP1 of the toolkit programme ([TOOLKIT.md](TOOLKIT.md) §13.3). It waits for the owner at Gate T1. Until the owner approves it, [LANGUAGE.md](LANGUAGE.md) ("FL language specification, v0.2") is the only specification of FL. This file is **documentation only**: no code, no vector and no other document changed with it.

The file name follows the version recommendation of section 2 (v0.3). **If the owner decides another number, the file is renamed to match** (`LANGUAGE-0.3.md` to `LANGUAGE-<version>.md`) and nothing else in it changes except the version words.

It follows the precedent of [LANGUAGE-0.2.md](LANGUAGE-0.2.md) (the additive wave: a separate proposal, approval by the owner, implementation by work packages, then a fold-in into LANGUAGE.md as an appendix) and of [RECIPES-1.1.md](RECIPES-1.1.md) and [RECIPES-1.2.md](RECIPES-1.2.md). This file does **not** rewrite the normative text of LANGUAGE.md. At the fold-in (work package L14, section 20) LANGUAGE.md becomes "v0.3", gains an Appendix B, "Changes in v0.3", and takes the conformance cases of section 17 under their numbers.

It builds on [LANGUAGE.md](LANGUAGE.md) in full (§2 lexical grammar, §3 values, §4 coercion, §5 defining forms, §6 name resolution, §7 locals, §8 control flow, §10 execution model, §11 errors, §12 metadata, §13 `core`, §16 conformance, §17 decisions D1 to D68, Appendix A); on [TOOLKIT.md](TOOLKIT.md) (§3 decisions T1 to T34, especially T6 and T17 to T21; §6 extension values; §9 the symbolic pack; §11 FL v0.3 as it stands, with the items marked **done**; §13.3 to §13.4 rows SP1 and L1 to L13; §14.2 Q14 and Q15); on [research/x0-ext-values.md](research/x0-ext-values.md) (the accepted shape of the `ext` value, §3, §7, §10 R1 to R12, §11); on [RELIX.md](RELIX.md) (§2 value kinds, §5.4 NULL, §16) and [RECIPES-1.2.md](RECIPES-1.2.md) (§3 ext parameters); and on the studies [research/mutable-array.md](research/mutable-array.md), [research/int-words.md](research/int-words.md), [research/slow-ops.md](research/slow-ops.md) and [research/forth.md](research/forth.md).

> **Packages are frozen.** `packages/*` hold frozen Phase 1 and 2 contracts (CLAUDE.md). This wave changes `packages/lang` (types, reader, compiler, VM, primitives, metadata) and, through the work packages of section 20, `packages/ops` (the shared JSON words, the corpus sweep) and the one-line `ext` cases that the new union members force in `packages/worker` and `apps/web` (section 15). Each is an owner-approved change at Gate T1 ([TOOLKIT.md](TOOLKIT.md) §13.3). **Nothing here starts before that gate.** No existing export changes meaning. Where a union gains a member, section 15 says so.

> **Names shared with the other Gate T1 specifications.** The UI proposal (SP3) and PACKS.md (SP4) use the same names as this file: the type `ext{kind}`; the kind names `table`, `relation`, `relix-expr` and `rat`; a pack id is a lower-kebab-case name; an `ext` kind registers by name, and the pack manifest owns kind names (T18). This file defines **no** manifest and **no** UI. It adds two kind names of its own, **`null`** and **`array`**, which belong to the language and which the manifest must treat as reserved (sections 4.2, 7 and 10).

## Contents

1. What the wave contains
2. Versioning: the facts, the recommendation, and the answer to Q15
3. Conventions of this proposal
4. The `ext` value (X1)
5. Generic words and generic arithmetic (L10)
6. Tagged literals (X4)
7. JSON in core, and how FL holds JSON `null` (L3, Q14)
8. Core words that are still open (L2)
9. Defining forms: constant expressions, choice values, friend access, forward declarations, `VARIABLE`, record literals (L5, L6)
10. The mutable array and 32-bit words (L7)
11. `charge`, cost accounting and the `+media` label (L8)
12. The breaking fixes of TOOLKIT §11.5 (L9)
13. The kernel tier: what it needs from the language surface (L11, conditional on L0)
14. What breaks, and what the sweep rewrites (L12)
15. Frozen-contract changes in `packages/lang`
16. Tooling affected
17. Conformance cases (C401 to C594)
18. Design decisions (D69 to D96, proposed)
19. Open questions, each with a recommended answer
20. Work packages
21. What the other documents need

---

## 1. What the wave contains

Every row of the TOOLKIT §11.6 table that is **not** marked done is here. The column "TOOLKIT" names the proposal row and the work package of §13.4 and §13.5. "Kind" is the classification of section 3.

| # | Item | TOOLKIT | Kind | Section |
|---|---|---|---|---|
| 1 | The `ext` value tag: registry, `ext{kind}` header, equality, `repr`, `sizeOf`, coercion, `E_TYPE` rules | `ext` tag row; X1 | additive (the union types are source-breaking) | 4 |
| 2 | Generic arithmetic and generic words | generic words; L10 | additive (TOOLKIT §11.5 listed it as breaking; section 5 explains why it is not) | 5 |
| 3 | Tagged literals `tag"…"` | tagged literals; X4 | additive | 6 |
| 4 | JSON parse and serialise in core; JSON `null` as `ext{null}` (Q14) | JSON row; L3 | additive in the language; the `@forge/ops` sentinel is rewritten by the sweep | 7 |
| 5 | Core words still open: `first second last divmod tdiv zero-pad index-of set-nth`, float bytes | L-A rows; L2 | additive | 8 |
| 6 | Constant expressions (the computed load-time constant) | load-time constants; L5 | additive | 9.1 |
| 7 | Choice value mapping | shared `choice` types; L5 | additive | 9.2 |
| 8 | Friend access for private words | friend visibility; L6 | additive | 9.3 |
| 9 | Forward declarations and mutual recursion | forward declarations; L6 | additive | 9.4 |
| 10 | `VARIABLE` with any initial value; the re-entrancy rule | `VARIABLE` row; L6 | additive | 9.5 |
| 11 | The record literal `record{ … }` | record literal; L6 | additive | 9.6 |
| 12 | The mutable array (`ext{array}`) | mutable buffer; L7 | additive | 10.1 to 10.3 |
| 13 | 32-bit word words and bulk word conversion | 32-bit intrinsics; L7 | additive | 10.4 |
| 14 | `PrimitiveContext.charge` and cost accounting | `charge`; L8 | additive | 11 |
| 15 | The effect label `+media` | L-D; P6 | additive | 11.4 |
| 16 | `reduce` argument order | L-E; L9 | **no change recommended** (open question Q6) | 12.1 |
| 17 | `/` on integers beyond 2^53 | L-E; L9 | additive in effect (an error becomes a value) | 12.2 |
| 18 | Header-constraint violations: one code, and `runtime.call` header defaults | L-E; L9 | **breaking** for the code; additive for the defaults | 12.3, 12.4 |
| 19 | The `raise`/`range` name clash | L-E; L9 | closed (the `raise` vocabulary was removed on 2026-11-15) | 12.5 |
| 20 | Regex parameters with spaces or parentheses; the `\f` escape; the `doc` length cap | L-E; L9 | additive | 12.6 to 12.8 |
| 21 | Named inputs and the stack, reviewed | L-E; L9 | review; no change | 12.9 |
| 22 | The kernel tier: the language surface only | kernel tier; L11 | additive, **conditional on spike L0, which has not run** | 13 |

Of the 22 rows, **one** changes the behaviour of a program that ran under v0.2 (row 18, the error code of a violated header constraint). Section 14 lists what that costs.

**Not in this file.** The pack manifest and capabilities (SP4, PACKS.md), viewers and the UI (SP3), the symbolic pack's rules and words (SP5, SYMBOLIC.md v2), the `table` kind itself (D2, a vocabulary and kind in `@forge/ops`), the Relix pack (RELIX.md, decided at Gate T1), and the recipe format (RECIPES-1.2.md). Where this file needs a decision of theirs, it says "PACKS.md (SP4)" or "the UI proposal (SP3)" and gives the language side only.

---

## 2. Versioning: the facts, the recommendation, and the answer to Q15

### 2.1 Observed on the v0.2 code

These were run on 2026-11-23 against the built `@forge/lang` of this repository at commit `38a5122` (`createRuntime`, `load` and `run`; no change to any file). Each row is a construct that this wave makes valid or changes.

| Construct | What the v0.2 code does |
|---|---|
| `sym"x"` | `E_LEX` ("invalid character in name"), because `"` may not occur inside a token |
| `record{ "a" 1 }` | `E_LEX` ("invalid character in name") |
| `"a\fb"` | `E_LEX` ("invalid escape in string") |
| `3 4 + CONSTANT x` at the console | `E_SYNTAX` ("expected a single literal before CONSTANT or VARIABLE") |
| `3 4 + CONSTANT x` in a unit | `E_TOPLEVEL` at the `3` |
| `DEFER: f ( -- int ) ;` | `E_LEX` ("bad qualified name") |
| `: f ( t:ext{table} -- ) ;` | `E_HEADER` ("unknown parameter type 'ext'") |
| `100000000000000000000 3 /` | `E_COERCE` ("integer is outside the exactly representable range") |
| `: f ( x:int[1..5] -- int ) x ; 9 f` | `E_PARAM_INVALID` ("parameter x: 9 violates [1..5]") |
| `: f ( s:str[/a b/] -- str ) s ;` | `E_HEADER` ("a pattern may not contain whitespace or '\"'") |
| `: f ( s:str[/(a\|b)/] -- str ) s ;` | loads. Parentheses without white space already work; white space and `"` do not |
| `: a ( n:int -- ) n 0 > [ n 1 - b ] when ; : b ( n:int -- ) n a ;` | `E_UNDEFINED` (`b` is not defined yet, D6) |
| `META:` on a private word | `E_META` ("private word may not have a META: block") |
| `: f ( s:str n:int=3 -- str ) … ;` then `"a" f` | `E_STACK_UNDERFLOW`; `runtime.call("user:f", ["a"])` is `E_STACK_UNDERFLOW` too |
| a `doc` longer than 2000 code points | `E_META` |
| `1 "a" +` | `E_TYPE` ("expected number, got str") |
| `"+" help .` | `core:+  ( number number -- number )` |
| `{ 1 2 3 } 10 [ - ] reduce .` | `4` (the quotation sees the accumulator below the element) |

Every new construct is an error in a v0.2 runtime. **Every v0.3 construct fails closed in a v0.2 runtime**: it raises an error and never runs with another meaning.

### 2.2 Item by item

The test is the one of RECIPES-1.2 §2, applied to a language: (a) does any v0.2 program, vector, word hash or catalogue entry change meaning? (b) does an older runtime fail closed on a v0.3 program, so that it never misreads it?

| Item | A v0.2 program, vector or hash | A v0.2 runtime reading v0.3 source | Additive? |
|---|---|---|---|
| `ext` tag and `ext{kind}` | No change. `ext` was never a type name. | `E_HEADER` | Yes |
| Generic words | No change. Plain numbers take the old path unchanged; the header text of `+` and the other words, and so their hashes, do not change (section 5.1). | `E_TYPE` on an `ext` operand | Yes |
| Tagged literals | No change. A tag that is not registered is `E_LEX`, exactly as now. | `E_LEX` | Yes |
| JSON words | No change to the language. New names in `core`. | `E_UNDEFINED` | Yes |
| New `core` words | A vocabulary that defines the same name keeps resolving its own (§6.2). A local named like a new word draws `W_SHADOW`. | `E_UNDEFINED` | Yes |
| Constant expressions, choice values, `friend`, `DEFER:`, `record{`, `VARIABLE` of a list | These were errors. | `E_SYNTAX`, `E_META`, `E_LEX` | Yes |
| Array words, 32-bit words | New names in `core`. | `E_UNDEFINED` | Yes |
| `charge`, `+media` | A primitive that does not call `charge` is unchanged. | not a source feature | Yes |
| `/` of two integers beyond 2^53 | The error becomes a value. No corpus word catches it (12 `try` uses, all control flow). | `E_COERCE` | Yes, with a grep (section 12.2) |
| `runtime.call` defaults | An error (`E_STACK_UNDERFLOW`) becomes a value. | `E_STACK_UNDERFLOW` | Yes |
| Pattern strings, `\f`, the longer `doc` | These were errors. | `E_HEADER`, `E_LEX`, `E_META` | Yes |
| **A violated header constraint raises `E_RANGE`** (interval, set or length) | **A `try` handler and a vector that expect `E_PARAM_INVALID` change.** At most 20 vector expectations in 10 files (measured, section 14). | `E_PARAM_INVALID` | **No. Breaking** |

### 2.3 Recommendation: v0.3

**Recommended: this wave is FL v0.3, in the file `docs/LANGUAGE-0.3.md`.** The owner decides (Q1). The facts:

1. LANGUAGE.md is "v0.2". The earlier numbers were one per wave (v0.1, then the additive v0.2). The study [research/int-words.md](research/int-words.md) §5 already names `docs/LANGUAGE-0.3.md` as the file of the next proposal.
2. Exactly one item changes the behaviour of a v0.2 program (row 18). In a 0.x series that is a minor step. It needs a number that a recipe, a vector file and a pin can name, and it needs the owner's approval, which Gate T1 gives.
3. **It is not 1.0.** A 1.0 would be a compatibility promise. The `ext` mechanism, generic dispatch and the kernel tier have no client in production yet (Gate T3 proves the first one). The version that makes the promise should come after a pack has shipped on it.
4. **It is not two waves.** A split into a 0.3 (additive) and a 0.4 (breaking) would run the wave boundary of T6 twice: two windows with no op work in flight, two sweeps of vector expectations, two rounds of `previousHashes` (T27). With the recommendations of this file the one breaking item is small, and one boundary is enough.
5. If the owner removes row 18 (Q7), the wave is wholly additive and keeps the number v0.3: v0.2 was an additive wave and took a number too.

### 2.4 The answer to Q15, language side

TOOLKIT Q15 asks which version bump covers the frozen contracts at Gate T1: FL, the worker protocol and the X1 and X2 contract (T19). **The language side:**

- **One number for FL: v0.3.** `FORGE_LANG_VERSION` in `packages/lang/src/index.ts` (today `"0.0.0"`, which tracks nothing) becomes `"0.3.0"`, and the `@forge/lang` package version becomes `0.3.0`. The merge that closes the wave sets both (work package L12, section 20), so that no half-finished state carries the number.
- **The worker protocol is not part of this number.** It goes to `PROTOCOL_VERSION` 2 (T23, RECIPES-1.2 §12), and that bump also carries the `OutputValue` `ext` variant of X2. The `ext` tag of this file is what makes the variant necessary; the protocol number is not changed by anything else here.
- **The recipe format needs none** (T23): `"forge": 1` stays.
- **The catalogue `version`** changes at the sweep (every rewritten word has a new hash, and `ParamSpec.kind` adds a field). That is automatic: it is computed.
- **`meta.schema.json`** widens (`ext` in `paramType`, `kind`, `values`, `generic`, `friends`, `kernel`). It has no version in its `$id`; the file ships with the package, so no consumer sees a mismatch.

**How the bump is staged.** The contract changes are not all of one kind, so they are not all staged alike.

| Stage | What lands | Why that order |
|---|---|---|
| G0 | The owner approves this file (and SP3, SP4, SP5). Nothing in `packages/*` changes. | Gate T1 |
| G1 | **X1 with its forced edits, and X2 together.** X1 changes `Tag`, `Value` and `ParamType`, so every exhaustive `switch` over them in `packages/worker`, `packages/ops`, `packages/recipe` and `apps/web` stops compiling. X0 §7 lists them. The package X1 therefore **owns the one-line `ext` cases** in those files, and X2 adds the viewer behind them. Main never fails to typecheck. | One source-breaking step, once. T19 |
| G2 | The additive words and forms, each as its package finishes: L2, L3, L5, L6, L7a, L8, X4. | Each is additive. None changes a number. |
| G3 | **The wave-boundary group: L9b (the constraint code), L10 if it is not already in, then L12 (the sweep of vector expectations and of the `json` callers), in one merge group.** `FORGE_LANG_VERSION` becomes `0.3.0` here. | L9b makes vectors fail until the sweep has rewritten them. T6 |
| G4 | L13 and, if L0 passes, L11 and the moves of the cores. | After the boundary |

L9b is the only item that must wait for the boundary. Everything else may merge earlier because it changes no existing behaviour.

---

## 3. Conventions of this proposal

**Classification.** **Additive**: every program, vector, word hash, catalogue entry and error code that a v0.2 runtime produced is produced again by a v0.3 runtime; the only changes are that something that was an error is now valid, and that new names exist. A change that turns an error into a value counts as additive unless a vector or a corpus word expects that error; each such change says what was searched. **Breaking**: anything else, including a change of the error code that a `try` or a vector can see, and any change of a word hash that is not caused by an edit of its source text. **Source-breaking** is a third word, about TypeScript only: a union gains a member, so code that switches over it exhaustively stops compiling until it handles the member. Source-breaking is not breaking for FL programs.

**Corpus numbers.** The numbers are those that TOOLKIT §2.5 and §11 cite (1,853 colon words; 237 `choice{}` headers with 116 distinct lists; 234 else-if chains, 96 of them at depth 3 or more; 12 `try` uses; 101 zero-input constants, 22 of which rebuild tables; 106 `VARIABLE`s, 89 in five machine simulations; 119 primitives; TEA 478 steps per byte, SHA-1 186; 4,488 vectors; 161 `.fth` files). **Where this file measured something new it says so**, with the command. Two of the TOOLKIT numbers are older than the tree: `packages/ops/README.md` now counts 7,302 vectors in 201 vocabularies and the vocabulary directory holds 208 `.fth` files. Work package L1 (`npm run corpus-stats -w @forge/ops`) fixes the baseline before the sweep. This file does not repeat the newer numbers except in section 14, where they decide a count.

**Writing a rule.** MUST, MUST NOT, SHOULD and MAY are used as in LANGUAGE.md. "Error `E_X`" means a `ForgeError` with that code. **This wave adds no error code**: the list stays at the 34 codes of LANGUAGE.md §11.1 (decision D68 is the precedent: a case that needs a reason uses `detail.reason`).

**Conformance cases.** The cases are numbered **C401 to C594**. The numbers C347 to C400 are left free for corrections to v0.2. Each is a fenced block with the info string `fl-proposed` while its feature does not exist, and the harness ignores it (LANGUAGE.md §16.1). The package that implements a feature flips its blocks to `fl-test` and moves them into LANGUAGE.md §16 with their numbers; the numbers do not change. **No block has been run**, because none of the features exists. The expected output of each follows from the rules of its section; the implementing package corrects a block if the rule and the block disagree and says so in its report. The blocks that use only v0.2 behaviour (C573 and, for its output format, C591) were checked against the v0.2 code on 2026-11-23.

The harness (`packages/lang/test/conformance`) gains the following, owned by the package named in section 20:

| Addition | What |
|---|---|
| Fixture kinds | `fx-pair`, `fx-other` and `fx-big`, registered once per process (the registry is process-wide, so no test needs to reset it). Defined in section 17.0. |
| Fixture literal tags | `pair` (kind `fx-pair`) and `big` (kind `fx-big`) |
| Fixture primitives | `fx:pair`, `fx:pair-a`, `fx:other`, `fx:big`, `fx:charge`, `fx:spin`, `fx:media-op` |
| The section `@call <qname>` | runs `runtime.call(qname, args)` instead of `run()`, with `@stack-in` as the arguments (deepest first). `@stack` and `@error` apply as for `@run`. It tests the header defaults of section 12.4. |
| `@meta` paths | the new fields of section 15 (`kind`, `values`, `generic`, `friends`, `kernel`) |

---

## 4. The `ext` value (X1)

This section makes the accepted shape of [research/x0-ext-values.md](research/x0-ext-values.md) §3 normative (T17 to T21). It refines X0 in three places, each marked "refines X0".

### 4.1 The tag

`Tag` gains `"ext"`, so FL has ten tags. `Value` gains the variant `{ tag: "ext"; kind: string; v: unknown }`. The payload field is `v`, like every other tag, because several guards in `primitives.ts` and `vm.ts` test `"v" in x` (X0 §3.1). A payload is **opaque to the VM and MUST be immutable**. A payload never leaves the Worker; only what a kind's `view` returns does (X2).

LANGUAGE.md §3.1 gains a tenth row:

| tag | JS payload `v` | Equality `=` | Printed (`.s`, nested) |
|---|---|---|---|
| `ext` | the kind's payload (opaque) | same kind and the kind's `equals`; different kinds are unequal | `<ext KIND TEXT>`, or the kind's own `repr` (section 4.6) |

The rule "There is no null/nil/unit value" of §3.1 stays true for every tag of the first nine. FL gets a null **value** only as an `ext` kind (section 7).

### 4.2 The kind and the registry

```ts
interface ExtKind<P = unknown> {
  readonly kind: string;                          // /^[a-z][a-z0-9-]{0,63}$/
  equals(a: P, b: P): boolean;
  sizeOf(p: P): number;                           // O(1), a conservative upper bound, cached
  toText(p: P, max: number): string;              // at most `max` UTF-16 code units
  fromText?(text: string): P;                     // throws ForgeError E_COERCE (detail.offset?)
  repr?(p: P, max: number): string;               // refines X0; default in 4.6
  view?(p: P, o: { maxRows: number }): unknown;   // structured-clone-safe; for X2, not used by the VM
  readonly storable?: boolean;                    // default true; false for a mutable kind (section 10)
  readonly methods?: ExtMethods<P>;               // generic words (section 5)
}
registerExtKind(k: ExtKind): void   // idempotent by name; the last registration wins (T18)
getExtKind(name: string): ExtKind | undefined
listExtKinds(): readonly string[]
ext(kind: string, payload: unknown): Value      // builds the Value; the kind must be registered
```

- **The registry is process-wide**, in module scope, keyed by kind name (T18, X0 R1). `RuntimeOptions` gains nothing; TOOLKIT §6.1's "the host registers an `ext` tag through `RuntimeOptions`" is replaced by this. FL code can never register a kind: only TypeScript can (so untrusted code cannot invent one, D8).
- **Registration is idempotent and the last one wins** (T18, X0 R2). A module that two entry points evaluate registers twice without error. A kind name that another **pack** owns is refused at the manifest (P1, PACKS.md (SP4)), not at run time. `registerExtKind` throws a `TypeError` (a programmer error, not a `ForgeError`) for a bad kind name or a missing `equals`, `sizeOf` or `toText`.
- **Reserved kind names.** The language registers **`null`** (section 7) and **`array`** (section 10) when `@forge/lang` loads. `@forge/ops` registers **`table`** (D2, T21). The pack kinds are **`relation`** and **`relix-expr`** (RELIX.md §2) and **`rat`** (the symbolic pack). The manifest MUST refuse a pack that claims any of these names for a kind it does not own (T18).
- **Contract of `sizeOf`** (T19, X0 R8): O(1), a conservative upper bound (at least the bytes the payload holds), cached by the kind because payloads are immutable, and stable across calls. The VM charges `16 + sizeOf(payload)` wherever it meters a value (§10.8). Every kind ships a conformance test of these three properties (`kindConformance`, work package X1).
- **Contract of `fromText`** (T20): pure, deterministic, and linear in the text. It throws `E_COERCE`; `detail.offset` is the UTF-16 offset of the first bad character. A kind with no faithful text form has no `fromText`, and so cannot be the type of a parameter (RECIPES-1.2 §3.1 rule 4).
- **Contract of `toText`**: it returns a string of at most `max` code units and ends a cut text with `...`. The caller cuts again if the kind did not.

### 4.3 The header: `ext{kind}`

The §5.4 grammar gains one `ptype`:

```ebnf
ptype = … | "ext" , "{" , kind-name , "}" ;
kind-name = lower , { lower | digit | "-" } ;          (* 1 to 64 characters *)
out-item  = … | "ext" , "{" , kind-name , "}" ;        (* also pname:ext{kind} *)
```

- Allowed on a data input, on a parameter and on an output, named or bare. `( t:ext{table} expr:ext{relix-expr} -- ext{table} )` is a header.
- **Bare `ext` is `E_HEADER`** ("'ext' needs a kind"). A kind name that does not match the grammar is `E_HEADER`. The header parser stays pure and context-free (§5.8): it never looks the kind up. A header may therefore name a kind that no pack has loaded yet; the error comes when a value reaches the slot (section 4.4).
- **A constraint on an `ext` slot is `E_HEADER`.**
- **A default on an `ext` parameter MAY be a string literal**: `expr:ext{relix-expr}="true"`. *(Refines X0 §3.3, which made every default on an `ext` slot an `E_HEADER`.)* The reason is RECIPES-1.2 §3.4, which has `resolve` write a default for an omitted ext parameter. The header parser checks only that the default is a string. Whether the kind's `fromText` accepts it is checked by the catalogue build and by the first bake, where the kind is registered. A non-string default is `E_HEADER`. A default is never allowed on the data input (§5.4, unchanged).
- `StackSlot` gains **`kind?: string`**, present exactly when `type` is `"ext"`. `ParamSpec` inherits it. *(Refines X0 §3.3, which used `options[0]`; X0 R3 asked for this field.)* `options` keeps its meaning (`choice` options, `toggle` and `key` encodings).
- The canonical text (§12.3) of the type is `ext{kind}`, so a header round-trips: `( t:ext{table} -- ext{table} )` prints as it was written.
- A `MEMO:` header whose output is `ext{kind}` is allowed unless the kind is not `storable` (section 10.3).
- `meta.schema.json`: `paramType` gains `"ext"`; a slot gains `kind` (a string matching the kind grammar, required when `type` is `ext`, forbidden otherwise).

### 4.4 Coercion and `E_TYPE`

The §4.2 table gains a row and a column for `ext`. "Declared `ext{k}`" is a slot of that type. A dash is no coercion (`E_TYPE`).

| value \ declared | `any` | `str` and every other type | `ext{k}` |
|---|---|---|---|
| `ext` of kind `k` | ok | `E_TYPE` | ok |
| `ext` of kind `j`, `j` not `k` | ok | `E_TYPE` | `E_TYPE` |
| `str` | ok | ok (for `str`) | **co**: the kind's `fromText` |
| any other tag | ok | as §4.2 | `E_TYPE` |

- `str` to `ext{k}` calls `fromText` and is recorded in `RunResult.coercions` (`from` `"str"`, `to` `"ext"`). A text the kind refuses is `E_COERCE` with the kind's message and `detail.offset`. This is the whole recipe-to-VM path of an `ext` parameter (RECIPES-1.2 §3.3).
- A kind with no `fromText` gives `E_TYPE` for a `str` (there is no coercion).
- `E_TYPE` carries `detail.expected` (`"ext{k}"`), `detail.actual` (`"ext{j}"` or the tag name) and `detail.param`.
- **An unregistered kind**: a slot `ext{nosuch}` that receives a value, or a `str`, is `E_TYPE` with `detail.kind = "nosuch"` and `detail.reason = "unregistered"`. A value of an unregistered kind cannot exist, because only a registered kind creates one.
- Outputs are validated, never coerced (D13): an output slot `ext{k}` needs a value of kind `k`, else `E_TYPE` with `detail.where = "output"`.
- **No implicit conversion between kinds** is made by the VM. A recipe compiler may insert explicit words (RELIX.md §2.4, RECIPES-1.2 §6.9). The `number` slot does not accept `ext`; generic words are the one exception (section 5).

### 4.5 Equality and ordering

`=` and `<>`: values of different tags are unequal (except `int` and `num`, §3.1); two `ext` values are equal when their kinds are equal and `kind.equals` holds; an `ext` and any other tag are unequal, never `E_TYPE`. A value of an unregistered kind (impossible in a run, possible in a test) compares by identity of the payload. Equality never dispatches to `methods`.

`<` `>` `<=` `>=` on `ext` operands dispatch through the `compare` method (section 5.3). `sort` and `sort-by` accept a list or keys that are all `ext` of one kind with a `compare` method.

### 4.6 Text forms

| | form |
|---|---|
| `display` (`.`, top level) | `toText(p, max)` |
| `repr` (inside a list or record, and `.s`) | the kind's `repr(p, max)` when it has one, else `<ext KIND TEXT>` with `TEXT` from `toText`, cut by the §3.3 rule (80 code points in `.s`) |
| an unregistered kind | `<ext KIND>` |

The text form is the one form used for recipe JSON parameters, share URLs and vector JSON (`{"$ext": kind, "text": …}`, X0 §9). New words:

| word | kind | effect | description |
|---|---|---|---|
| `ext-kind` | P | `( any -- str )` | the kind name of an `ext` value; any other tag is `E_TYPE` |
| `ext>text` | P | `( any -- str )` | `toText` of an `ext` value, cut at `maxValueBytes / 2` code units; any other tag is `E_TYPE` |

`type` returns `"ext"` for every `ext` value. Code that needs the kind calls `ext-kind`.

### 4.7 Size and limits

`sizeOf(ext)` is `16 + kind.sizeOf(payload)` (§10.8). A value produced by a primitive, an intrinsic or a list literal is metered by the existing rules: `E_LIMIT_VALUE` when it exceeds `maxValueBytes`, and it counts toward `maxTotalBytes`. A list of `ext` values adds `8` per element plus each element's size. The X1 tests MUST include a primitive that does **not** guard its own size, so that the VM meter is the thing under test (X0 §3.2).

### 4.8 The primitive boundary

A primitive whose slot is `ext{k}` receives the bare payload and returns the bare payload; the call boundary tags it with the slot's kind (X0 §3.4). A primitive whose slot is `any` sees and returns whole `Value`s; an `ext` result of an `any` slot MUST name a registered kind, else `E_TYPE` with `detail.where = "result"`. Purity (D44) is unchanged: a primitive MUST NOT mutate a payload. The one family that changes state in place, the array words, is **not** a primitive (section 10).

### 4.9 Containers and `fork`

An `ext` value can be an element of a list, a value of a record, a local, a captured variable of a quotation and an argument of any combinator. `fork` still needs `str` or `bytes` data and coerces each piece result to that tag (§8), so an `ext` **result** of a `fork` quotation is `E_TYPE`; a quotation may capture and use an `ext` local. `emit` takes an `ext` value into a `collect` list. A `VARIABLE` of an `ext` type is allowed (section 9.5).

### 4.10 Errors, hash and metadata

No new error code. `E_HEADER` (bad header form), `E_TYPE`, `E_COERCE`, `E_LIMIT_VALUE`, `E_LIMIT_TOTAL`. The hash of a word covers its source text, which includes `ext{kind}`; **the behaviour of a kind is not hashed** (it lives in TypeScript). A pack version change that alters a kind's behaviour is covered by the pack's own vectors, not by a pin. This is the same limit that primitives have (§12.4 hashes name, effect and version).

Cases: C401 to C428 (section 17.1).

---

## 5. Generic words and generic arithmetic (L10)

TOOLKIT §6.4 and §11.5 decided that core arithmetic becomes generic, so that a vocabulary need not shadow `+`. SYMBOLIC.md B2 offered two designs: closed method tables (`GENERIC:` and `METHOD:`) and "`any` plus registered handlers". **This file chooses a third, smaller one: a closed list of generic `core` words, whose methods come from the `ext` kind of an operand.**

### 5.1 The rule

- A **generic word** is a `core` word of the closed list in 5.2. It keeps its header, its metadata and its hash. `help` shows the same effect text as before (`( number number -- number )` for `+`). `WordMeta` gains `generic: true` for these words (omitted for every other word, so other JSON is unchanged), and their `doc` says "generic".
- **The old path is untouched.** When no operand is an `ext` value, the word runs exactly as in v0.2: the same slot validation, the same code, the same step count, the same errors. For plain numbers v0.3 is bit-identical to v0.2. The only added work is a tag test on the operands (L10 measures it; the target is within 2% on the 10^6-step benchmark of §10.4).
- **When an operand is an `ext` value**, the entry sequence (§10.5) does not apply the `number` check to it. It dispatches (5.3). The primitive's own function never sees an `ext`.
- Because the header text is unchanged, **no word hash changes** for words whose source did not change. This is why generic arithmetic is **additive** here, although TOOLKIT §11.5 listed it as breaking (it assumed a new header, and so new hashes for every caller of `+`).

### 5.2 The generic words

| class | words | the method key |
|---|---|---|
| binary arithmetic | `+ - * / pow min max fpow atan2` | the word |
| unary arithmetic and maths | `neg abs sqrt ln log2 log10 exp sin cos tan asin acos atan sinh cosh tanh floor ceil round` | the word |
| ordering | `< > <= >=` | `compare` |
| structure | `len nth cat slice rev` | the word |

`=` and `<>` are **not** generic (4.5). `div`, `mod`, `gcd`, `invmod`, `powmod` and the bitwise words stay integer-only. `sort` and `sort-by` use `compare` for same-kind `ext` keys (4.5).

### 5.3 Methods and dispatch

```ts
type GenericWord = "+" | "-" | "*" | "/" | "pow" | "min" | "max" | "fpow" | "atan2"
  | "neg" | "abs" | "sqrt" | "ln" | "log2" | "log10" | "exp" | "sin" | "cos" | "tan"
  | "asin" | "acos" | "atan" | "sinh" | "cosh" | "tanh" | "floor" | "ceil" | "round"
  | "compare" | "len" | "nth" | "cat" | "slice" | "rev";
type ExtMethods<P> = Partial<Record<GenericWord,
  (args: readonly Value[], ctx: PrimitiveContext) => Value | undefined>>;
```

`args` are the operands, deepest first (a binary word gets `[a, b]`). A method returns a `Value`, or `undefined` to **decline**. It MAY throw a `ForgeError` (`E_RANGE`, `E_DIV_ZERO`, `E_COERCE`). It MUST be pure (D44) and deterministic. It MAY call `ctx.charge(n)` for heavy work (section 11).

**Dispatch.** 1. If no operand is `ext`, run the old path. 2. Otherwise build the candidates in this order: the kind of the **first** `ext` operand (deepest first), then the kind of the other operand if it is `ext` of another kind. 3. For each candidate that has a method for the word, call it. The first result that is not `undefined` is the result. 4. If every candidate declines or has no method, raise `E_TYPE` with `detail.expected = "number"`, `detail.actual` the first `ext` operand as `ext{k}`, and `detail.word`.

The order is by operand position, never by kind name or registration order, so a result does not depend on which pack loaded first. A plain `int` or `num` operand is passed to the method as a tagged `Value`; the **kind decides** how to lift it (`rat` turns an `int` into a rational; `sym` wraps it as a constant; a kind may return a `num` for `rat` plus `num`, SYMBOLIC.md S10). For `compare` the method returns an `int` `Value` of −1, 0 or 1. For `len` it returns an `int`; `nth`, `cat`, `slice` and `rev` dispatch on the first operand.

The result is metered like any primitive result (§10.8). A method that returns an `ext` value of an unregistered kind is `E_TYPE` with `detail.where = "result"`.

### 5.4 What is not in this wave

User-written generic words (`GENERIC:`, `METHOD:`, `EXTENDS:` of SYMBOLIC.md S16) are **not** proposed. They would need early-binding rules (D5), a hash rule for method tables, and an `E_AMBIGUOUS` rule between two packs that extend one word, and the three clients named in TOOLKIT §6.4 (symbolic arithmetic, table words, matrices) all get their methods from a TypeScript kind. Open question Q4 records the choice. A pack that wants FL-level behaviour writes ordinary words that call a kind's functions.

Cases: C431 to C445.

---

## 6. Tagged literals (X4)

### 6.1 Grammar

```ebnf
tagged   = tag , string ;                   (* no white space between *)
tag      = lower , { lower | digit | "-" } ; (* 1 to 32 characters *)
```

`sym"x^2 + 1"` and `relix"σ age > 30 (People)"` are tagged literals. The body follows §2.6 (escapes, raw line breaks, the closing `"`). A tagged literal MUST be followed by white space or the end of input (`pair"1,2"x` is `E_LEX`). §2.3 gains rule 3a: *a token that begins with a registered tag directly followed by `"` is a tagged string literal.*

### 6.2 The reader

`read(source, opts)` stays pure and never looks at a dictionary. `ReadOptions` gains **`literalTags?: ReadonlySet<string>`**, the tags to accept. `createRuntime` passes the registered set at every `load` and `run`. **A tag that is not in the set is lexed as before: `E_LEX` at the token.** So no v0.2 error changes, and a v0.3 program that uses a tag whose pack is not loaded fails closed. A new token kind `tstr` carries `{ tag, value }` (`value` the decoded body) and `text`, `pos`, `end` as usual.

### 6.3 The registry and the compiler

```ts
registerLiteralTag(t: { tag: string; kind: string; parse(text: string): unknown }): void
getLiteralTag(tag: string): …;  listLiteralTags(): readonly string[]
```

Process-wide, idempotent, last registration wins (as kinds). `parse` returns the payload; it is normally the kind's `fromText`, and it MUST be pure and bounded. The **compiler** (not the reader) evaluates the literal **at compile time** and emits `lit` of `ext(kind, payload)`. So a tagged literal costs one step and is pure: it is allowed in a `MEMO:` body and in a constant expression (section 9.1). It is not allowed in a header default (a default is a string, section 4.3). FL source cannot register a tag, so D8 holds: there is no user-defined parsing.

### 6.4 Errors and positions

- A body the parser refuses is **`E_SYNTAX`**, with the kind's message, `detail.kind`, and `detail.offset` (the UTF-16 offset in the decoded body). The position is the source position of that character **when no escape is at or before it in the body**; otherwise it is the start of the literal. *(X4's done-when: "the error offset points at the bad character".)*
- A payload whose `sizeOf` exceeds `maxValueBytes` of the compiling limits is `E_LIMIT_VALUE` at the literal.
- A registered tag whose kind is not registered is `E_SYNTAX` with `detail.reason = "unregistered kind"`.

### 6.5 Hash and metadata

`source.text` contains the literal, so the hash covers it. The parser's behaviour is not hashed (the same limit as section 4.10).

Cases: C446 to C455.

---

## 7. JSON in core, and how FL holds JSON `null` (L3, Q14)

### 7.1 The facts

JSON already exists in FL, outside the language. `@forge/ops` has an **internal** vocabulary `json` with the primitives `json:parse` and `json:stringify`, the FL words `json:compact` and `json:pretty`, and a **null sentinel**: `json:null` is the `record` with the one key U+DFFF followed by `null`, whose value is `true`, and `json:null?` tests for it (`packages/ops/src/prims/json.ts`, README "JSON values (WP 5.48)"). Ten data-format vocabularies read and write through it (`cbor`, `msgpack`, `yaml`, `amf`, `avro`, `rison`, `csv`, `jwk`, `jsonpath`, `template` and others). The sentinel has two costs, both visible in the corpus. `type` of a null is `"record"`, so code must test `json:null?` before reading a record: `jwk.fth` does it three times (`jwk type "record" = jwk json:null? not and`). And a null passes any `record` slot without an error.

Measured for this proposal on 2026-11-23 at `38a5122`: `grep -rn 'json:null' packages/ops/vocab --include=*.fth` finds 8 lines in 4 files (`csv`, `json`, `jwk`, `yaml`); the sentinel is used by 9 TypeScript lines in `data-format-util.ts` and the `amf`, `avro`, `cbor`, `msgpack`, `rison` and `yaml` primitives. No vector expectation contains the sentinel (the ops return JSON text).

### 7.2 Q14: the answer

**Recommended: JSON `null` is the value of the `ext` kind `null`.** *(Open question Q3 has the alternatives.)*

- `null` is an `ext` kind registered by `@forge/lang` itself (section 4.2). Its payload is one frozen object; `equals` is always true; `sizeOf` is 0 (so a null costs 16 bytes); `toText` and `repr` are `null`; it has **no** `fromText` and no methods; it is `storable`.
- New `core` words: **`null ( -- ext{null} )`** and **`null? ( any -- bool )`** (true for the null, false for every other value, never an error).
- It is a value that travels through `list`, `record`, `emit` and locals, and `=` works (two nulls are equal; a null is unequal to `0`, `""`, `false` and `{ }`).
- **Every typed slot rejects it** with `E_TYPE`: it is not a `record` (the sentinel's flaw), not an `int`, and so on. Only `any`, and the containers, carry a null. `sort` of a list with a null and a number is `E_TYPE`.
- It adds **no** operation: no arithmetic, no ordering. FL still has no "null propagation". A word that cannot produce a value still raises an error (§3.1).

**Why not the others.** A **tenth tag** `null` would be a second source-breaking union change for one value that `ext` already carries. Keeping the **sentinel** keeps the corpus costs above. `ext{null}` costs the same as the sentinel (one registered kind) and removes both. It is consistent with RELIX.md §2 and §5.4: the Relix bridge maps a NULL **inside** a struct or array to `ext{null}` and back, and the rule "a NULL top-level argument returns NULL without calling FL" stays. RELIX.md §5.4 and the row "NULL, inside a struct or array" of §5.1 change from "refused with `E_COERCE`" to this mapping (section 21).

**Migration.** The `@forge/ops` primitives build and test `null` through the new kind; `json:null` and `json:null?` are replaced by `null` and `null?` in the sweep (section 14). The sentinel does not appear in any vector, so no vector changes.

### 7.3 The words

| word | kind | effect | description |
|---|---|---|---|
| `json>value` | P | `( text:str -- any )` | strict RFC 8259 text to a value |
| `value>json` | P | `( value:any indent:int -- str )` | a value to JSON text; `indent` 0 is compact, 1 to 32 is that many spaces per level, else `E_RANGE` |

They replace `json:parse` and `json:stringify` of `@forge/ops`; **there is one implementation** (L3's done-when). `json:compact` and `json:pretty` stay as the two-line FL words of the `json` vocabulary, or are dropped by the sweep; they are not promoted. The shipped rules become normative here, with one change (null):

- **Mapping.** object to `record` (keys in the order written); array to `list`; string to `str`; a number written with only an optional minus and digits to an exact `int` (`-0` is `0`); any other number to `num`; `true` and `false` to `bool`; **`null` to `ext{null}`**.
- **Numbers.** The text decides, not the value. A `num` out of the double range (`1e999`) is `E_COERCE`; an `int` over `maxIntBits` is `E_LIMIT_VALUE`. `value>json` writes an `int` in exact digits and a `num` with the shortest text that reads back as the same double, always with a fraction or an exponent (`100.0`, `-0.0`, `1e+21`).
- **Strings.** Escapes are read; a surrogate pair is one character. A lone surrogate, a raw control character below U+0020 and a byte order mark are `E_COERCE`. `value>json` escapes `"` `\` and the controls and writes everything else raw.
- **Records.** A repeated key is `E_COERCE` at the second one (never "last wins"). The keys `__proto__` and `""` are ordinary.
- **What has no JSON form.** `bytes`, `quot`, `file`, and every `ext` value except `null`, anywhere in the value, are `E_TYPE`. The caller converts first (`bytes>hex`, `table:to-json`, `ext>text`).
- **Whole value.** Any JSON value may be the top level. Only space, tab, LF and CR are white space. Comments, trailing commas, `NaN`, `Infinity`, `+1`, `.5`, `1.` and `01` are `E_COERCE`.
- **Errors.** `E_COERCE` with `detail { offset, line, column, reason }` (counted in code points; lines and columns start at 1). Nesting beyond **512** levels is `E_LIMIT_VALUE` in both words. The size of the value (and of the text written) is held to `maxValueBytes` while it grows.
- **Cost.** Each word is one primitive call (one VM step). A bare FL scanner costs 5.5 steps per character (358,523 steps for 64 KiB), which is why they are primitives.

Cases: C456 to C470.

---

## 8. Core words that are still open (L2)

The L-A rows marked done stay done. What is left of them, and what the studies asked for, is below. **All are additive.** Each is a pure primitive that costs one step. The sections cited are those of LANGUAGE.md that gain a row.

| word | kind | effect | description |
|---|---|---|---|
| `first` `second` `last` | P | `( seq -- any )` | element 0, element 1 and the last element of a list, bytes or `str`, as `nth` gives it (a `str` gives a 1-code-point `str`). An empty sequence, or a one-element sequence for `second`, is `E_RANGE`: there is no null (§3.1) |
| `divmod` | P | `( a:int b:int -- q:int r:int )` | floor quotient and floor remainder (`div` and `mod` in one step); `b` zero is `E_DIV_ZERO` |
| `tdiv` | P | `( a:int b:int -- int )` | division that rounds toward zero (`-7 2 tdiv` is `-3`); `b` zero is `E_DIV_ZERO`. Promotes `util:tdiv`, which required `b` positive |
| `zero-pad` | P | `( n:int w:int -- str )` | the decimal digits of a non-negative `n`, left-padded with `0` to at least `w` digits, never cut. A negative `n` is `E_RANGE`. Promotes `util:zero-pad` |
| `index-of` | P | `( seq x -- int )` | the first position of `x` in a list (by `=`), in bytes (`x` an `int` 0 to 255, else `E_RANGE`) or in a `str` (`x` a `str`, a substring, position in code points; the empty substring gives 0). **−1 when absent**, as `find` does. `util:index-of`, which raises `E_RANGE`, is not changed |
| `set-nth` | P | `( seq i:int x -- seq )` | a copy of a list or bytes with element `i` replaced (bytes take an `int` 0 to 255, else `E_RANGE`); `i` out of range is `E_RANGE`; a `str` is `E_TYPE`. Step zero of [research/mutable-array.md](research/mutable-array.md): it moves RC4 and CipherSaber-2 to FL |
| `num>float-bytes` | P | `( n:num width:int little:bool -- bytes )` | the IEEE 754 binary32 (`width` 32, rounded to the nearest single) or binary64 (`width` 64) bytes of `n`; another width is `E_RANGE`; a finite `n` that overflows binary32 is `E_RANGE` |
| `float-bytes>num` | P | `( b:bytes little:bool -- num )` | the number in 4 or 8 bytes; any other length is `E_RANGE`; a NaN or infinity pattern is `E_RANGE` (a `num` is always finite, §3.2) |
| `float-bytes-class` | P | `( b:bytes little:bool -- str )` | `"finite"`, `"nan"`, `"inf"` or `"-inf"`, so that `float:decode` can still report the patterns a `num` cannot hold |

These 11 words, with `ext-kind`, `ext>text`, `null`, `null?`, `json>value`, `value>json` (sections 4 and 7) and the 8 array words and 10 word words of section 10, take `core` from 160 words to **195**. The `core` table of §13 is parsed by the unit tests, so each word needs its row and its `META` in the same package.

`first`, `second`, `last` and `divmod` answer the PLAN gap "no stack-to-list word, no first/last" only in part; `pick` and `bool>str` stay out (no corpus evidence in TOOLKIT §11).

Cases: C471 to C492.

---

## 9. Defining forms (L5, L6)

### 9.1 Constant expressions (the computed load-time constant)

TOOLKIT §11.2 asked for "computed load-time constants and memoised words, run under a load budget". The memoised half shipped (`MEMO:`, `warm()`). **The load-time half cannot run FL at load.** `load()` is synchronous and free of user code (D23), and the VM is an `async` function. So the proposal is narrower and needs no VM:

```forth
0xff 8 shl 0xff bor CONSTANT mask16      \ 65535
"ab" "cd" cat CONSTANT s
pair"1,2" VARIABLE origin                \ section 9.5
```

- **Form.** `CONSTANT` and `VARIABLE` take a **constant expression** instead of exactly one literal (D4 is refined): a sequence of literals, tagged literals, `{ … }` and `record{ … }` literals of those, names of earlier constants, and the **foldable words** below. At least one token, at most **256**.
- **Foldable words.** The pure, total-on-valid-input `core` primitives that need no VM frame: arithmetic and comparison (`+ - * / div mod pow neg abs min max gcd =  <> < > <= >=`), logic and bitwise (`and or not band bor bxor bnot shl shr rotl rotr`), the 32-bit words of section 10.4, sequences (`len cat slice nth rev split join upper lower range append zip first second last index-of`), conversions (`int>str str>int str>num int>num num>int floor ceil round str>bytes bytes>str bytes>hex hex>bytes str>codes codes>str bytes>list list>bytes latin1>bytes bytes>latin1`), `>record`, `get`, `put`, `keys`, `has-key?`, `null`, `json>value`, `value>json`. **Not** foldable: quotations and combinators, `.` `.s`, `help` `see` `words` `vocabs` `current-vocab`, any word with an effect label, any user word, any `VARIABLE` word, any array word.
- **When it runs.** At compile time, in the compiler, by calling each primitive's function directly: no VM, no steps, no user code. So D23 holds: compilation still never executes user code.
- **Errors.** A fault of a primitive is that primitive's error (`E_DIV_ZERO`, `E_RANGE`, `E_COERCE`, `E_TYPE`) positioned at the word. A word that is not foldable is `E_SYNTAX` ("not allowed in a constant expression"). More than 256 tokens is `E_SYNTAX`. A result over `maxValueBytes` is `E_LIMIT_VALUE`. The expression must leave **exactly one** value: else `E_SYNTAX`.
- **`CONSTANT`** takes a **scalar** result (`int num str bytes bool`, or an `ext` tagged literal); any other result is `E_TYPE` with `detail.where = "constant"`. The word is inlined as `lit` as before. Lists and tables stay the job of `MEMO:`.
- **Console and unit.** In a unit `3 4 + CONSTANT x` was `E_TOPLEVEL` and is now a form; any other executable code in a unit is still `E_TOPLEVEL`. At the console it was `E_SYNTAX` and is now a form.
- **Hash.** `source.text` is the whole text, so the hash covers it.

Cases: C493 to C500.

### 9.2 Choice value mapping

A `CHOICE:` option may carry a **value**: the option text is what a user and a recipe write, and the value is what the word receives.

```forth
CHOICE: block-size
  option small = 128 "Short blocks." ;
  option large = 256 ;
;
: scale ( n:int sz:choice<block-size>="small" -- int ) sz n * ;
```

- **Clause.** `option <opt> [ "=" <literal> ] [<help>] ;`. The literal is an `int`, `float`, `bool` or `str` token. The `=` marks it, so a `str` is never mistaken for the help. **Every** option of a type has a value or **none** does; all values have the same tag; a duplicate value is allowed. Otherwise `E_META` with `detail.clause = "option"`.
- **Effect.** The slot keeps `options` (the texts, in order) and gains **`values`**, the literals. The slot's **runtime tag is the tag of the values**. A recipe or the UI still pushes the **option text**; the word boundary maps it (an extra coercion row, recorded in `RunResult.coercions` as `str` to the value's tag). A text that is not an option is `E_PARAM_INVALID`. The default of the parameter is still an option text.
- **Canonical text.** A slot with `values` prints as `choice<vocab:type>` (qualified), not expanded, because the inline form `choice{a=1}` already means an option whose text contains `=`. **A type without values expands exactly as in v0.2**, so no existing word's `effect.text` or hash changes.
- **Hash.** `typehash` of a mapped type covers the option texts **and** the values.
- **Evidence.** `util:delimiter` is the corpus pattern this replaces: a `choice` followed by `{ "space" [ " " ] … } case`. The L1 report counts how many headers are followed by such a table; **the work package implements this item last** (section 20) and drops it if that count is small.

Cases: C501 to C506.

### 9.3 Friend access for private words

A private word (`_name`) is visible only inside its vocabulary (§5.7). That kept `zip` from calling `deflate:_deflate`, and produced the internal vocabularies (`util`, `json`, `list`, `random`, …). **`friend` grants named vocabularies a qualified reference.**

```forth
IN: lib
: _helper ( n:int -- int ) n 2 * ;
META: _helper
  friend app zip ;
;
```

- **Clause.** `friend <vocab-name> { <vocab-name> } ;`, repeatable and accumulating. The vocabularies need not exist when it is written. A name that is not a `vocab-name` is `E_META`.
- **Where.** `META:` is allowed on a private word **only for `friend`** (any other clause stays `E_META`; v0.2 refused every clause).
- **Effect.** Code compiled with current vocabulary `f` may write `lib:_helper` when `f` is `lib` or is listed. Any other vocabulary gets `E_PRIVATE`, as now. **Unqualified lookup is unchanged**: a private word is never found through `USING:` (so `_helper` in `app` without the qualifier is `E_UNDEFINED`). The word stays out of the catalogue, `words` and search.
- **Metadata.** `WordDiscovery` gains `friends?: string[]` (sorted, omitted when empty). `META:` is not hashed, so no hash changes.
- **Privacy is a convention, not a security boundary.** `IN: lib` already reaches `lib`'s private words from a user unit, because §5.7 allows `v:_name` from code compiled with current vocabulary `v`. `friend` adds no hole.

Cases: C507 to C512.

### 9.4 Forward declarations and mutual recursion

D6 has no forward references and no mutual recursion. `DEFER:` declares a word whose body comes later **in the same unit or console input**.

```forth
DEFER: odd? ( n:int -- bool )
: even? ( n:int -- bool ) n 0 = [ true ] [ n 1 - odd? ] if ;
: odd?  ( n:int -- bool ) n 0 = [ false ] [ n 1 - even? ] if ;
```

- **Form.** `DEFER: name header`: no body, no `;`. `DEFER:` is a keyword like `MEMO:` (§2.3 rule 9; the `(` after `DEFER: name` is the header, §2.8; `DEFER:foo` stays a qualified name, and `DEFER:` joins the reserved words).
- **Resolution.** The next `: name header …;` of the same vocabulary in the same unit **resolves** it: the same `WordEntry` gets the body, so callers compiled earlier call the real word. Its header MUST have the same canonical text (§12.3), else `E_HEADER` with `detail.expected` the declared text. Until it resolves, a call to it compiles (early binding to the entry).
- **Errors.** A declaration not resolved by the end of the unit (or of the console input) is `E_UNDEFINED` at the `DEFER:` with `detail.reason = "declared, not defined"`, and the unit commits nothing (atomic, §6.7). A second `DEFER:` of a name, or a `DEFER:` of a name defined in the unit, is `E_REDEFINED`. A `MEMO:` or `CONSTANT` of the name resolves nothing (`E_REDEFINED`). `DEFER:` is `E_SYNTAX` inside a body.
- **Hash of a cycle.** A word's hash covers its callees' hashes (§12.4), and a cycle has no first word. For each strongly connected group `G` of one unit: `H(G)` is the SHA-256 of the lines `<qname> <ownText>` of the members, sorted by qname, followed by the sorted dependency lines of every callee **outside** `G`. A member's hash is the SHA-256 of `ownText + "\n" +` its dependency lines outside `G`, **plus** the one line `cycle <H(G)>`. A word that is on no cycle hashes exactly as in v0.2.
- **`effects`, `stateful`, `deps`.** For the members of a cycle these are computed after the whole unit has compiled, as the union over the group (a fixpoint over the group).
- **Unchanged.** There is still no tail call (D6): a deep mutual recursion hits `maxReturnDepth`. `recurse` stays.

Cases: C513 to C520.

### 9.5 `VARIABLE` with any initial value, and re-entrancy

- **Initial value.** `<constant expression> VARIABLE name` (section 9.1). The result may be any **storable** value: a scalar, a `list`, a `record`, or an `ext` value of a storable kind (so `{ 1 2 } VARIABLE items` and `pair"1,2" VARIABLE p`). The variable's type `T` is the tag, and for an `ext` value the slot type `ext{kind}`. A non-storable result (an array) is `E_TYPE`. `n!` still rejects a value of another tag or kind with `E_TYPE` (D31). Each run starts at the initial value, as now.
- **Re-entrancy: no change, stated.** A `VARIABLE` is **one cell per run**, shared by every activation of every word. A word that uses one is **not** re-entrant: a recursive call, or a call from inside a `collect` that the word is already running in, sees and changes the same cell. `MEMO:` bodies cannot use variables (§5.13). **A `with-variable` form is not proposed** (Q12): the corpus clients are 89 variables in five machine simulations, each a single instance, and the "named per-run array" case that motivated the question in [research/mutable-array.md](research/mutable-array.md) §3 (option E) is answered by `ext{array}` in section 10.

Cases: C521 to C526.

### 9.6 The record literal

```forth
record{ "name" "Ada" "born" 1815 "tags" { "math" } }
```

- **Token.** The token `record{` (standalone) opens a record literal; it is closed by `}`. A `record{` glued to anything (`record{x`) is `E_LEX`, as now.
- **Meaning.** The contents are code, **evaluated like a list literal** (§8: a body that leaves values above a mark). They MUST leave an even number of values, alternating key and value; the keys MUST be `str`. The result is the same record as `{ { k1 v1 } { k2 v2 } } >record`: **a later duplicate key wins**, and keys keep their insertion order.
- **Errors.** An odd count is `E_EFFECT` (`detail.reason = "record literal needs key and value pairs"`); a key that is not a `str` is `E_TYPE` (`detail.index`). Unbalanced `record{` is `E_SYNTAX`. `:>` and `exit` inside it are `E_SYNTAX`, as inside `{ }` (§7.1, §8). It nests in `{ }`, in `record{ }` and in quotations.
- **Metering.** The record is measured at creation like a list literal (§10.8).
- **Instructions.** `listOpen` opens it and a new `recClose` closes it (section 15).
- **Decision.** D10 ("no record literal") is replaced. The printed form `record{ "a": 1 }` of §3.3 is **not** the literal's syntax (it has colons); the two are different on purpose, because `"a":` would be a string token followed by a colon.

Cases: C527 to C536.

---

## 10. The mutable array and 32-bit words (L7)

### 10.1 Why an `ext` kind, and what changes in D44

[research/mutable-array.md](research/mutable-array.md) recommended step zero (`set-nth`, `index-of`, section 8) and then a restricted **array**, option B, as a new tag. X1 makes the new tag unnecessary: **`array` is an `ext` kind**, registered by `@forge/lang` (a reserved name, section 4.2). It has identity, it is mutable, and it cannot be stored. That is a language change of about 400 lines in the study's estimate, without an eleventh tag.

D44 ("primitives MUST NOT mutate any argument") **stays true**, because the five words that change an array in place are **intrinsics** (kind I, one VM instruction each, like `emit`), not primitives. The three words that make or seal one are primitives that return fresh values.

### 10.2 The value and the words

An array has one of two element kinds, chosen by how it is made: **values** (any storable `Value`) or **bytes** (`int` 0 to 255). Its payload holds the storage and a `sealed` flag.

| word | kind | effect | description |
|---|---|---|---|
| `thaw` | P | `( seq -- ext{array} )` | a new array copied from a `list` (value array) or `bytes` (byte array) |
| `anew` | P | `( n:int x -- ext{array} )` | a value array of `n` copies of `x`; `n` negative is `E_RANGE`; `x` must be storable |
| `anew-bytes` | P | `( n:int -- ext{array} )` | a byte array of `n` zeros |
| `aget` | I | `( a:ext{array} i:int -- any )` | element `i` (an `int` for a byte array); out of range is `E_RANGE` |
| `aset!` | I | `( a:ext{array} i:int x -- )` | set element `i`; byte arrays take `int` 0 to 255 (`E_TYPE`, `E_RANGE`); `x` must be storable (`E_TYPE`); a sealed array is `E_EFFECT` with `detail.reason = "sealed"` |
| `apush!` | I | `( a:ext{array} x -- )` | append to a **value** array (a byte array is `E_TYPE`); sealed is `E_EFFECT` |
| `alen` | I | `( a:ext{array} -- int )` | the length |
| `freeze` | I | `( a:ext{array} -- seq )` | seal the array in O(1) and return a `list` or `bytes` that shares its storage; later writes to the array are `E_EFFECT` |

Updates return nothing, so a forgotten `drop` cannot leave a stale copy. `aset!` and `apush!` end in `!` to mark a word that changes an argument (a naming rule for FL-STYLE.md; the formatter test keeps the two in agreement).

### 10.3 Aliasing and storage rules

- **Aliasing.** `dup` of an array gives two names for one array: that is the Forth model. An array may be passed to a word, returned, captured by a quotation, and held in a local, so helpers can be factored.
- **An array cannot be stored.** The kind is `storable: false`. A container that would hold one is `E_TYPE` with `detail.reason = "not storable"`: a `{ }` or `record{ }` literal, `append`, `put`, `>record`, `zip`, `cat` and every result that the VM meters is walked by `sizeOf`, and the walk raises the error. `emit` and `emit-all`, `varSet` (`n!`), the `MEMO:` store and a `MEMO:` output type `ext{array}` (`E_HEADER`) check it directly. This rules out cycles, escape into immutable data, and a cached mutable value. A `MEMO:` body MAY use arrays internally.
- **Equality** is identity. `type` is `ext`; `ext-kind` is `array`. `.` prints a snapshot: `array{ 1 2 3 }` (values) or `array#[ 01 02 ]` (bytes); `repr` is the same text. A trace entry or `ForgeError.stackSnapshot` shows a copy of the first 16 elements.
- **Limits.** `thaw` and `anew` are metered at their full size (`16 + 8 * n` for values, `16 + n` for bytes) against `maxValueBytes` and `maxTotalBytes`. `apush!` adds **8** to `totalBytes` and checks the live size against `maxValueBytes` at every push (`E_LIMIT_VALUE`). `aset!` charges nothing. `freeze` charges nothing and checks the live size once.
- **Steps.** Each word is one instruction and one step.
- **Purity.** A body that uses arrays is still pure for `MEMO:` and for the hash. A word that mutates its argument has no effect label; the `!` suffix is the only mark.
- **In the worker.** An array never crosses the worker boundary: `render.ts` shows its text snapshot (X2).

Cases: C537 to C556.

### 10.4 32-bit words and bulk conversion

[research/int-words.md](research/int-words.md) measured `rotl` at about 21% of MD4 and rejected the single masked add (`addw`, 2.1 points). The wave keeps `rotl`, `rotr` and the byte readers it already has, and proposes the closed set below. **The evidence is thin** (TOOLKIT §11.3): two measured ciphers and one hash. Work package L7b is therefore **gated on spike L0**: if the kernel tier passes, these words are not needed for the cipher and hash cores, and the owner may drop them (Q13).

All take and return an `int` in `[0, 2^32)`. An operand outside that range is first **reduced modulo 2^32** (two's complement, so `-1` is `4294967295`).

| word | effect | result |
|---|---|---|
| `add32` `sub32` `mul32` | `( a:int b:int -- int )` | the sum, difference and product modulo 2^32 |
| `shl32` | `( v:int k:int -- int )` | `v` shifted left by `k`, modulo 2^32; `k` ≥ 32 gives 0; `k` < 0 is `E_RANGE` |
| `shr32` | `( v:int k:int -- int )` | logical shift right; `k` ≥ 32 gives 0; `k` < 0 is `E_RANGE` |
| `not32` | `( v:int -- int )` | `2^32 - 1 - v` |
| `rotl32` `rotr32` | `( v:int k:int -- int )` | rotation of the 32-bit value; `k` is taken modulo 32; `k` < 0 is `E_RANGE` |
| `bytes>u32` | `( b:bytes little:bool -- list )` | the list of 32-bit words; a length that is not a multiple of 4 is `E_RANGE` |
| `u32>bytes` | `( words:list little:bool -- bytes )` | the bytes; an element that is not an `int` in `[0, 2^32)` is `E_RANGE` (`E_TYPE` for a non-`int`) |

Each is one primitive and one step. `bxor`, `band` and `bor` already give a 32-bit result for 32-bit operands, so they have no `32` form.

Cases: C557 to C566.

---

## 11. `charge`, cost accounting and the `+media` label (L8)

### 11.1 The problem

The VM counts one step per instruction. A primitive is one instruction, however long it runs: SHA-1 of 64 KiB is one step in TypeScript and about 12.2 million in FL (TOOLKIT §2.5), and a synchronous primitive cannot be interrupted (§10.7). So `maxSteps` bounds FL work but not primitive work, and a pack that wants honest limits has no tool.

### 11.2 `PrimitiveContext.charge`

`PrimitiveContext` (§10.5) gains **`charge(n: number): void`**.

- `n` MUST be a non-negative safe integer; anything else is a `RangeError` (a programmer error, §10.12).
- `charge(n)` adds `n` to the run's step counter. If the counter then exceeds `limits.maxSteps` it throws **`E_LIMIT_STEPS`** from inside the primitive (uncatchable, as ever). `n` of 0 adds nothing.
- **Polling.** Whenever the charged total crosses a multiple of 1024, and on every call with `n` of 0, `charge` polls `RunOptions.signal`, `RunOptions.abortFlag` and the deadline, and throws `E_ABORTED` or `E_LIMIT_TIME`. A primitive that calls `charge(0)` in its loop can therefore be stopped without the Worker watchdog. The caveat of §10.7 no longer applies to such a primitive.
- **Determinism.** The charge of a primitive MUST depend only on its inputs and its own algorithm, never on the clock or the host. Then a primitive reaches `maxSteps` at the same instruction in Node and in a Worker (the done-when of L8).
- **Weights are opt-in.** No existing primitive changes: one that does not call `charge` costs one step as before, so no step count, limit error or vector changes. `PrimitiveDef` gains an optional **`cost?: (args: readonly unknown[]) => number`**, charged by the VM before `fn` runs, so that a pack can declare "one extra step per 64 bytes" without editing the body. Which bundled primitives get a weight is decided per pack (the cipher cores, when L13 moves them).
- **Trace.** `StepEvent` and `TraceEntry` report the step counter after the charge.

### 11.3 What this does not do

It does not make an async primitive cooperative (it already is) and it does not add a memory meter: the byte meter of `maxTotalBytes` is unchanged. A kind method (section 5.3) gets the same `ctx` and the same `charge`.

### 11.4 The label `+media`

`EffectLabel` gains **`"+media"`** (TOOLKIT §5.4), for the media pack's primitives. It behaves as the three existing labels (§10.10): a colon word's `effects` is the union over its callees; `RunOptions.deny` containing it makes a call raise `E_FORBIDDEN` with `detail.effect = "+media"`. `core` has no labelled word. `+net` is **not** added (T3: no network in v1). Which packs may be granted which labels, and the wiring of `deny` into the baker, belong to PACKS.md (SP4) and work package P6; the language only declares the label. `meta.schema.json` adds it to the `effects` enum.

Cases: C567 to C572.

---

## 12. The breaking fixes of TOOLKIT §11.5 (L9)

TOOLKIT §11.5 lists nine fixes. Each is classified here. **Only 12.3 breaks a v0.2 program.** 12.1 recommends **no change**; if the owner disagrees, Q6 gives the exact alternative.

### 12.1 `reduce` argument order: no change

**The fact.** `reduce ( seq init quot -- acc )` takes the sequence first, then the start value, and the quotation sees `( acc elem )`, the accumulator below the element. PLAN wave 3 called this "the opposite of `foldl`". Compared with the languages FL is used next to:

| language | order | the function sees |
|---|---|---|
| FL | `seq init quot` | `acc elem` |
| Factor `reduce` | `seq identity quot` | `prev elt` |
| JavaScript `reduce` | `seq.reduce(f, init)` | `acc, elem` |
| Python `reduce` | `reduce(f, seq, init)` | `acc, elem` |
| Haskell `foldl` | `f z xs` | `acc x` |

Only Haskell puts the start value before the sequence. The quotation order matches all five. FL's rule "the first input is the data input" (§5.4: data deepest, parameters after) puts the sequence first for every word, `map`, `filter`, `fork` and `sort-by` included.

**The cost of a swap.** The corpus holds 88 lines that mention `reduce`, in 41 vocabulary files (measured on 2026-11-23 with `grep -c reduce`, comments and doc strings included, so an upper bound). A swap to `init seq quot` is not a text rewrite of two adjacent tokens, because `seq` and `init` are arbitrary expressions. The codemod can only insert `-rot swap rot` before `reduce`, which makes every call longer and slower (three steps per call).

**Recommended: keep the order; fix the trap in the documentation.** §8 and §13.6 gain the table above and one example. The conformance case C573 pins the order and the quotation's stack picture, so that no later change is silent. Kind: **no change**.

### 12.2 `/` on integers beyond 2^53

**The fact.** `/` converts both operands to `num` (D29); a `bigint` operand is `E_COERCE` (§3.2). `100000000000000000000 3 /` is an error although the quotient is a finite double.

**The fix.** For two `int` operands, `/` returns **the double nearest to the exact quotient** `a / b` (ties to even), computed from the exact integers, for operands of any size. A quotient beyond the double range is `E_RANGE` (§3.2: results MUST be finite); a quotient too small for a double is `0.0` or `-0.0` by the same rounding; `b` of 0 is `E_DIV_ZERO`. Operands that are both safe integers give the same result as before (their conversion is exact, and one IEEE division of two exact doubles is the correctly rounded quotient). **A `num` operand is unchanged**: `big 2.0 /`, and `+`, `-` and `*` on a mixed `bigint` and `num`, stay `E_COERCE` (§3.2), and `int>num` stays strict.

**Kind.** Additive in effect: an error becomes a value. Searched: no corpus word catches it (the 12 `try` uses of TOOLKIT §2.5 are control flow around other words), and no vector expects `E_COERCE` from `/`. L9a runs `grep` and a vector scan to confirm before it merges.

### 12.3 One code for a violated header constraint (breaking)

**The fact.** A value that breaks an interval, a set or a length constraint of a header slot raises `E_PARAM_INVALID` (§4.3). A word body that checks the same thing raises `E_RANGE` (`check-int-range`, `fail-range`). PLAN wave 5 and wave 6 record the cost: "every range check of a compressor (levels, block sizes, work factors) is written in the word body to give the typed error", and "invalid choice and int params cannot be vector expectations".

**The fix.** A violated **interval, set or length** constraint (§5.5: `int`, `num`, `str` and `charset` length, `bytes`, `key`, `toggle` and `list` length) raises **`E_RANGE`**, with the same `detail` (`param`, `constraint`, `value`). `E_PARAM_INVALID` stays for the other four: a `pattern` that does not match, a `choice` that is not an option, a `regex` that does not compile or is too long, and a `charset` with a repeated code point. A word can then replace its body check with a header constraint and keep the code.

**Kind: breaking.** A `try` handler or a vector that compares the code `E_PARAM_INVALID` for a range violation changes. Measured on 2026-11-23: `grep -h '"error": "E_PARAM_INVALID"' packages/ops/vocab/*.test.json` finds **20 expectations in 10 files**; at most those change, and the sweep rewrites exactly the ones whose cause is an interval, set or length (section 14). `E_RANGE` is already the expected code of 313 other vector expectations. The recipe layer's own issue codes (`bad-param`) are unaffected: it pre-validates before the VM runs.

**The alternative** (Q7): keep `E_PARAM_INVALID` for all, and change nothing. That leaves the wave wholly additive and the duplicate body checks in place.

### 12.4 `runtime.call` applies header defaults

`ForgeRuntime.call(name, args)` pushes `args` and runs the word. **If fewer values are given than the word has inputs, each missing trailing parameter (index 1 and up) that has a default is filled with it**, as the recipe compiler would push it (§5.4's table: `choice` option text as `str`, a `toggle` or `key` default as bytes decoded in the first-listed encoding, a `bytes` default from its hex, numbers and booleans as written). The data input is never defaulted. A missing parameter with no default is `E_STACK_UNDERFLOW` as now. Extra arguments are untouched. The VM itself still never supplies a missing argument (D15); only the facade does.

**Kind.** Additive in effect (an `E_STACK_UNDERFLOW` becomes a call). It answers the PLAN wave 5 gap "`runtime.call` does not apply header defaults" and the empty-string-sentinel workaround.

### 12.5 The `raise`/`range` name clash: closed

The clash was `USING: raise` making the name `range` resolve to `raise:range` instead of `core:range`. The `raise` vocabulary was **removed on 2026-11-15** (TOOLKIT §11.1) and no `raise:` reference is left in the tree (`grep -rn 'raise:' packages/ops` is empty at `38a5122`). **No language change.** The general shape of the clash (a vocabulary word shadowing a core word, wave 5) is the §6.2 rule working as designed; `core:name` always reaches the core word. C574 pins that rule.

### 12.6 Regex parameters with spaces or parentheses

**The fact.** A header `pattern` is written `/source/` and MUST contain no white space and no `"` (§5.5); the header ends at the first white-space-delimited `)` (§2.8). Parentheses alone already work (section 2.1). White space and `"` do not, so `a b` and `"q"` need `\x20` and `\x22`.

**The fix.** A `cpart` of a `str` constraint may also be a **string literal** holding the regex source: `s:str["(a|b) c"]`. The string follows §2.6, so it may hold white space, parentheses and `\"`. At most one pattern per constraint still holds, and the source is still compiled with the `u` flag and capped at `maxRegexLength`. The header scanner already skips string literals when it looks for the closing `)`, so §2.8 needs no change. **Canonical text** (§12.3): a pattern with no white space and no `"` prints as `/source/` exactly as now; any other prints as the string form. **Kind: additive** (these were `E_HEADER`; no existing `effect.text` changes).

### 12.7 The `\f` escape

String and char literals gain `\f` (U+000C). **Kind: additive** (it was `E_LEX`). `repr` still prints U+000C as `\x0c` (§3.3), so no printed form and no vector changes; the escape is input only.

### 12.8 Length caps

The `doc` clause and declaration cap rises from 2000 to **8000** code points (`meta.schema.json` `maxLength`). The `use-when` (160), `expects` (64), `link` and per-parameter (200) caps do not change. **Kind: additive** (a longer `doc` was `E_META`). The vector `ref` cap of 200 characters (PLAN wave 3) is not a language item; it belongs to the vector format (RECIPES-1.2 §10, `vectors.schema.json`), and **1000** is recommended there (section 21). A conformance block would need an 8,001-character literal, so L9a tests the cap by a unit test, not a block.

### 12.9 Named inputs and the stack: reviewed, no change

Reviewed against §5.4 and §7: (1) a named input is consumed into a local and an anonymous input stays (D14): correct, and the data input may be either; (2) a local that shares a name with a visible word hides it and draws `W_SHADOW`; the wave 7 complaint ("a parameter named `len` shadows `len`") is answered by `core:len`, and the corpus gains nothing from turning the warning into an error, because the fix (renaming a local) is not a text rewrite of two tokens; (3) with `ext` slots the rules are unchanged: a named `ext{k}` input is a local, an anonymous one stays on the stack. **No change.** C575 pins (2).

### 12.10 Core arithmetic made generic

Specified in section 5. Additive.

Cases: C573 to C592.

---

## 13. The kernel tier: what it needs from the language surface (L11, conditional on L0)

**Everything in this section is conditional on spike L0, which has not run (TOOLKIT §13.2).** L0's pass criteria are proposed in TOOLKIT §11.3: TEA, SHA-1, MD4 and RC4 written in FL pass their vectors and run 64 KiB within 3 times the time of the current TypeScript primitive. **This file does not decide the kernel tier.** It lists only what the tier would need from the language, so that SP1 does not block L11 if L0 passes, and it adds nothing to the language if L0 fails.

If L0 passes, the language needs:

1. **A marker.** A `META:` clause **`kernel ;`** (singular, no arguments) that names a word as a candidate for ahead-of-time compilation. It changes no behaviour in the interpreter and is not hashed. `WordDiscovery` gains `kernel?: true`. A bundle build compiles the marked words to JavaScript at **build time**, never at run time, and never for user code (UI.md §4 rule 5: no `eval`).
2. **A subset rule.** A restricted, statically typed subset of FL (fixed-width integers, buffers, loops, no escaping quotations). **Its exact definition is L0's output**, not this file's: the checker reports a violation as `E_META` with `detail.clause = "kernel"` and `detail.reason`.
3. **The words it relies on.** The array of section 10 (`ext{array}`, a byte array as the buffer) and the 32-bit words of section 10.4. If L0 passes these are the reason L7b is worth building; if L0 passes **without** them, L7b is dropped (Q13).
4. **A reference rule.** The interpreter stays the reference. A kernel word MUST give the same results and the same errors as the interpreted run, and MUST **charge the same steps** through `charge` (section 11), so that limits behave alike. `RunOptions` gains **`kernels?: boolean`** (default true for the bundle); `false` forces the interpreter, which is how every kernel word is tested against itself.
5. **A registry hook.** `registerKernel(qname, hash, fn)`: the VM calls `fn` in place of the body when the word's current hash equals `hash`, so a stale kernel never runs for edited source.

**Not decided here:** the type syntax of fixed-width integers, the generated code's shape, how exact the step equality must be (equal, or within a declared bound), and the benchmark thresholds. L0 decides them.

Cases: C593 and C594 (conditional on L0; they test only item 1).

---

## 14. What breaks, and what the sweep rewrites (L12)

### 14.1 The table

| What | Breaks | What the sweep (L12) rewrites | How many |
|---|---|---|---|
| A violated interval, set or length constraint raises `E_RANGE` (12.3) | the code seen by a `try` or a vector | the `error` field of the vector expectations whose violation is an interval, set or length; a `try` or `catch` that compares the code (L12 greps for `E_PARAM_INVALID` in `.fth`: none expected) | at most 20 vector expectations in 10 files (measured) |
| `json:parse`, `json:stringify`, `json:null`, `json:null?` replaced by `json>value`, `value>json`, `null`, `null?` (7) | the `json` vocabulary and the sentinel, which are not part of the language | the callers in `csv`, `jwk`, `yaml`, `jsonpath`, `rison`, `rsa`, `amf`, `cbor`, `protobuf`, `avro`, `msgpack`, `tlv`, `template`, `ecdsa`, `jsonata` (16 files list `json:` words; measured) and the primitives that build the sentinel; the `jwk` guards `json:null? not and` disappear | 8 `json:null` lines in 4 files; 9 TypeScript lines |
| Word hashes | every rewritten word, and every word that calls one | nothing to rewrite; the catalogue `version` bumps and `previousHashes` (T27) are generated **before** the sweep, on the pre-sweep tag | derived |
| `reduce` order | nothing (12.1) | nothing | 0 |
| `/` beyond 2^53 | nothing observed | nothing | 0 |
| Generic words | nothing | nothing | 0 |
| New names in `core` (35 words) | a vocabulary that defined the same name keeps its own; a **local** of the same name draws `W_SHADOW` | L12 lists every `W_SHADOW` that the 35 names cause (`first`, `last`, `index-of`, `thaw`, `null`, … are plausible parameter names) and renames only where a body needs the core word | to be counted by L1 |

**What the sweep does not do.** It does not adopt `record{`, `DEFER:`, constant expressions, `friend`, choice values or the new core words in existing words; that is optional migration (L13 and later) and changes hashes. With the recommendations of this file **the sweep rewrites no word's source except the `json` callers**. TOOLKIT §11.5 described a sweep of all 161 files; that assumed the `reduce` swap and a new arithmetic header. The `previousHashes` script still runs first (T27) because the `json` callers change.

### 14.2 What the sweep must keep

All vectors pass except the expectation rewrites above. TOOLKIT §13.4's "all 4,488 vectors pass unchanged" becomes "all vectors pass, and only the listed expectation codes changed" (section 21). The catalogue version bumps. The recipe format number does not change (T23).

---

## 15. Frozen-contract changes in `packages/lang`

The table follows X0 §7. "Source-breaking" is the third word of section 3.

| File | Export or type | Change | Kind |
|---|---|---|---|
| `types.ts` | `Tag` | adds `"ext"` | source-breaking |
| `types.ts` | `Value` | adds `{ tag: "ext"; kind: string; v: unknown }` | source-breaking |
| `types.ts` | `ParamType` | adds `"ext"` | source-breaking |
| `types.ts` | `StackSlot` | adds `kind?`; adds `values?` (choice values, 9.2) | additive |
| `types.ts` | `TokenKind`, `Token` | adds `tstr` with `tag` and `value` | source-breaking |
| `types.ts` | `ReadOptions` | adds `literalTags?` | additive |
| `types.ts` | `EffectLabel` | adds `"+media"` | source-breaking for a `Record<EffectLabel, …>` |
| `types.ts` | `PrimitiveContext` | adds `charge(n)` | additive for callers; every constructor of a context (the VM, tests) adds it |
| `types.ts` | `PrimitiveDef` | adds `cost?` | additive |
| `types.ts` | `WordMeta` | adds `generic?: true` | additive |
| `types.ts` | `WordDiscovery` | adds `friends?`, `kernel?` | additive |
| `types.ts` | `Instruction`, `Opcode`, `IntrinsicName` | adds `recClose`, `aop` (the five array intrinsics); `IntrinsicName` adds `aget aset! apush! alen freeze` | source-breaking |
| `types.ts` | `RunOptions` | adds `kernels?` (conditional on L0) | additive |
| `types.ts` | `ErrorCode` | **no change** (34 codes) | |
| `ext.ts` (new) | `ExtKind`, `ExtMethods`, `GenericWord`, `registerExtKind`, `getExtKind`, `listExtKinds`, `ext`, `registerLiteralTag`, `getLiteralTag`, `listLiteralTags`, `kindConformance` | new exports | additive |
| `index.ts` | the exports above; `FORGE_LANG_VERSION` `"0.3.0"` (at L12) | | additive |
| `values.ts` | `equals`, `repr`, `display`, `sizeOf`, `validate`, `coerceTracked` | an `ext` branch each; `coerceTracked` takes the kind | additive |
| `reader.ts` | `read` | rule 3a, `record{`, `\f`, a pattern string is not a reader matter | additive |
| `meta.ts`, `meta.schema.json` | `parseHeader`, `slotText` | `ext{kind}`, a string default on `ext`, string patterns, `choice<…>` with values; `paramType`, `effects`, `kind`, `values`, `generic`, `friends`, `kernel`, `doc` `maxLength` 8000 | additive |
| `compiler.ts` | constant expressions, `DEFER:`, `record{`, tagged literals, friend check | | additive |
| `vm.ts`, `primitives.ts` | dispatch of generic words, `charge`, `aop`, `recClose` | | additive |
| `vocab/core.ts`, `numeric.ts`, `intwords.ts`, new files | the 35 new words | | additive |
| `runtime.ts` | `call` applies defaults; `warm` unchanged | | additive in effect |
| `test/conformance/parse.ts` | `TAG_TABLE: Record<Tag, true>` adds `ext` | | test-only, forced |
| `RESERVED_WORDS` | adds `DEFER:` | | additive (not a valid name) |

Outside `packages/lang` the forced one-line cases are those of X0 §7: `packages/ops/src/types.ts` (`UI_PARAM_TYPES`), `packages/recipe/src/validate.ts`, `packages/worker/src/{types,render}.ts` and `apps/web/src/{ops/fit.ts,bake/format.ts,io/output-model.ts}`.

---

## 16. Tooling affected

For the editor plugin (maintained by the owner, outside this repository) and any other lexer, the checklist of LANGUAGE.md A.6 grows by:

- **Tokens.** `DEFER:` (keyword), `record{` (opens a literal closed by `}`), the tagged-literal token `tag"…"` for a registered tag, the escape `\f`.
- **Forms.** `DEFER: name header`; `CONSTANT` and `VARIABLE` after a constant expression; `option x = <literal> …;` in `CHOICE:`.
- **Header types.** `ext{kind}`, with a string default; a string literal as a `str` pattern; `choice<type>` whose options have values.
- **`META:` clauses.** `friend` (also on a private word) and `kernel` (conditional).
- **Words.** the 35 of section 8, 4, 7 and 10, with the effects given there. `builtins.json` is regenerated with `tools/export-builtins.mjs`; the `!` suffix rule goes into FL-STYLE.md (the formatter test keeps the two in agreement).
- **Diagnostics worth mirroring.** `:>` and `exit` inside `record{`; a `DEFER:` with no definition; a non-foldable word in a constant expression; `emit` or `{ }` of an array.

---

## 17. Conformance cases (C401 to C594)

The block format is that of LANGUAGE.md §16.1 and the numbering rule is that of section 3. A case that the text says is conditional is marked in its title.

### 17.0 Fixtures

Registered by the harness once per process.

| fixture | definition |
|---|---|
| kind `fx-pair` | payload `{a, b}` (two safe integers). `equals` compares both; `sizeOf` 16; `toText` `a,b`; `fromText` accepts `^-?\d+,-?\d+$` and otherwise throws `E_COERCE` with `detail.offset` the index of the first character that does not fit; default `repr`. Methods: `+` (pair and pair: sum of components; pair and `int` either way: the `int` added to both), `*` (pair and `int` either way: both scaled; pair and pair declines), `neg` (negates both), `compare` (pair with pair: lexicographic; anything else declines), `len` (2), `nth` (0 gives `a`, 1 gives `b`, else `E_RANGE`) |
| kind `fx-other` | payload `{}`; `equals` true; `sizeOf` 16; `toText` `o`; no methods; no `fromText` |
| kind `fx-big` | payload an integer `n`; `sizeOf` `n`; `toText` `big`; no methods |
| literal tag `pair` | kind `fx-pair`, parse is the kind's `fromText` |
| literal tag `big` | kind `fx-big`, parse reads a decimal integer |
| `fx:pair` | `( a:int b:int -- ext{fx-pair} )` |
| `fx:pair-a` | `( p:ext{fx-pair} -- int )` |
| `fx:other` | `( -- ext{fx-other} )` |
| `fx:big` | `( n:int -- ext{fx-big} )` |
| `fx:charge` | `( n:int -- )`, calls `ctx.charge(n)` once |
| `fx:spin` | `( -- )`, loops forever calling `ctx.charge(0)` |
| `fx:media-op` | `( -- int )`, returns 1, effect label `+media` |

### 17.1 The `ext` value (C401 to C428)

```fl-proposed
# C401 an ext header round-trips and records the kind
@unit
: f ( p:ext{fx-pair} -- ext{fx-pair} ) p ;
@meta
user:f effect.text = "( p:ext{fx-pair} -- ext{fx-pair} )"
user:f effect.inputs[0].type = "ext"
user:f effect.inputs[0].kind = "fx-pair"
```

```fl-proposed
# C402 a bare ext needs a kind
@unit-fails E_HEADER
: f ( p:ext -- ) ;
```

```fl-proposed
# C403 a kind name is lower-kebab-case
@unit-fails E_HEADER
: f ( p:ext{Pair} -- ) ;
```

```fl-proposed
# C404 a constraint on an ext slot is a header error
@unit-fails E_HEADER
: f ( s:str p:ext{fx-pair}[1..2] -- str ) s ;
```

```fl-proposed
# C405 a string default is accepted on an ext parameter
@unit
: f ( s:str p:ext{fx-pair}="1,2" -- str ) s ;
@meta
user:f params[0].kind = "fx-pair"
user:f params[0].default = "1,2"
user:f params[0].required = false
```

```fl-proposed
# C406 a non-string default on an ext parameter is a header error
@unit-fails E_HEADER
: f ( s:str p:ext{fx-pair}=3 -- str ) s ;
```

```fl-proposed
# C407 a value of the right kind passes
@unit
: f ( p:ext{fx-pair} -- ext{fx-pair} ) p ;
@run
1 2 fx:pair f fx:pair-a .
@out
1
```

```fl-proposed
# C408 a value of another kind is E_TYPE
@unit
: f ( p:ext{fx-pair} -- ext{fx-pair} ) p ;
@run
fx:other f
@error
E_TYPE detail.expected=ext{fx-pair} detail.actual=ext{fx-other}
```

```fl-proposed
# C409 another tag is E_TYPE
@unit
: f ( p:ext{fx-pair} -- ext{fx-pair} ) p ;
@run
5 f
@error
E_TYPE
```

```fl-proposed
# C410 a str is coerced through fromText and recorded
@unit
: f ( p:ext{fx-pair} -- ext{fx-pair} ) p ;
@run
"3,4" f fx:pair-a .
@out
3
@coercions
user:f 0 str ext
```

```fl-proposed
# C411 a bad text is E_COERCE with the kind's offset
@unit
: f ( p:ext{fx-pair} -- ext{fx-pair} ) p ;
@run
"3;4" f
@error
E_COERCE detail.offset=1
```

```fl-proposed
# C412 a kind with no fromText gives E_TYPE for a str
@unit
: f ( p:ext{fx-other} -- ext{fx-other} ) p ;
@run
"o" f
@error
E_TYPE
```

```fl-proposed
# C413 an unregistered kind is E_TYPE, not a load error
@unit
: f ( p:ext{nosuch} -- ) ;
@run
"x" f
@error
E_TYPE detail.kind=nosuch detail.reason=unregistered
```

```fl-proposed
# C414 an output of the wrong kind is E_TYPE
@unit
: f ( -- ext{fx-pair} ) fx:other ;
@run
f
@error
E_TYPE detail.where=output
```

```fl-proposed
# C415 equality: same kind compares payloads, kinds never mix
@run
1 2 fx:pair 1 2 fx:pair = .
1 2 fx:pair 1 3 fx:pair = .
1 2 fx:pair fx:other = .
1 2 fx:pair 1 = .
@out
true
false
false
false
```

```fl-proposed
# C416 display and repr
@run
1 2 fx:pair .
1 2 fx:pair .s
{ 1 2 fx:pair } .
@out
1,2
<1> <ext fx-pair 1,2>
{ <ext fx-pair 1,2> }
```

```fl-proposed
# C417 type, ext-kind and ext>text
@run
1 2 fx:pair type .
1 2 fx:pair ext-kind .
1 2 fx:pair ext>text .
@out
ext
fx-pair
1,2
```

```fl-proposed
# C418 ext-kind of another tag is E_TYPE
@run
5 ext-kind
@error
E_TYPE
```

```fl-proposed
# C419 an ext value passes through a list
@run
{ 1 2 fx:pair 3 4 fx:pair } len .
{ 1 2 fx:pair 3 4 fx:pair } 1 nth fx:pair-a .
{ 1 2 fx:pair } [ ] map 0 nth fx:pair-a .
@out
2
3
1
```

```fl-proposed
# C420 an ext value passes through a record
@run
{ { "k" 1 2 fx:pair } } >record "k" get fx:pair-a .
@out
1
```

```fl-proposed
# C421 a fork quotation may use an ext local
@unit
: f ( p:ext{fx-pair} -- str ) "a-b" "-" "+" [ drop p fx:pair-a int>str ] fork ;
@run
1 2 fx:pair f .
@out
1+1
```

```fl-proposed
# C422 fork with an ext piece result
@unit
: g ( p:ext{fx-pair} -- str ) "a-b" "-" "+" [ drop p ] fork ;
@run
1 2 fx:pair g
@error
E_TYPE
```

```fl-proposed
# C423 size is metered by the VM: one value over maxValueBytes
@limits maxValueBytes=1000
@run
5000 fx:big
@error
E_LIMIT_VALUE
```

```fl-proposed
# C424 size counts toward maxTotalBytes
@limits maxTotalBytes=3000
@run
1000 fx:big drop 1000 fx:big drop 1000 fx:big drop
@error
E_LIMIT_TOTAL
```

```fl-proposed
# C425 a number slot does not accept an ext value
@unit
: f ( n:number -- number ) n ;
@run
1 2 fx:pair f
@error
E_TYPE
```

```fl-proposed
# C426 an ext value in a collector
@run
[ 1 2 fx:pair emit ] collect len .
@out
1
```

```fl-proposed
# C427 an ext value is a valid VARIABLE type after a tagged literal
@unit
pair"1,2" VARIABLE origin
@run
origin fx:pair-a .
3 4 fx:pair origin!
origin fx:pair-a .
5 origin!
@error
E_TYPE
@out
1
3
```

```fl-proposed
# C428 an ext in a typed header with a default and a call by text
@unit
: f ( s:str p:ext{fx-pair}="1,2" -- int ) s drop p fx:pair-a ;
@run
"x" "7,8" f .
@out
7
```

### 17.2 Generic words (C431 to C445)

```fl-proposed
# C431 plain numbers are unchanged
@run
2 3 + .
2.5 1 + .
7 2 / .
@out
5
3.5
3.5
```

```fl-proposed
# C432 a method of the first ext operand
@run
1 2 fx:pair 3 4 fx:pair + .
@out
4,6
```

```fl-proposed
# C433 a plain number on either side; the kind decides the lift
@run
1 2 fx:pair 10 + .
10 1 2 fx:pair + .
1 2 fx:pair 3 * .
@out
11,12
11,12
3,6
```

```fl-proposed
# C434 a method that declines gives E_TYPE
@run
1 2 fx:pair 3 4 fx:pair *
@error
E_TYPE detail.expected=number
```

```fl-proposed
# C435 two kinds that both decline
@run
1 2 fx:pair fx:other +
@error
E_TYPE
```

```fl-proposed
# C436 a unary method, and a word the kind does not implement
@run
1 2 fx:pair neg .
1 2 fx:pair abs
@out
-1,-2
@error
E_TYPE
```

```fl-proposed
# C437 ordering goes through compare
@run
1 2 fx:pair 1 3 fx:pair < .
2 1 fx:pair 1 9 fx:pair > .
@out
true
true
```

```fl-proposed
# C438 compare against a plain number declines
@run
1 2 fx:pair 5 <
@error
E_TYPE
```

```fl-proposed
# C439 sort of same-kind ext values uses compare
@run
{ 3 1 fx:pair 1 2 fx:pair 1 1 fx:pair } sort .
@out
{ <ext fx-pair 1,1> <ext fx-pair 1,2> <ext fx-pair 3,1> }
```

```fl-proposed
# C440 structure words dispatch on the first operand
@run
1 2 fx:pair len .
1 2 fx:pair 1 nth .
@out
2
2
```

```fl-proposed
# C441 min has no method for fx-pair
@run
1 2 fx:pair 3 4 fx:pair min
@error
E_TYPE
```

```fl-proposed
# C442 the old type error is the same
@run
1 "a" +
@error
E_TYPE
```

```fl-proposed
# C443 a generic word keeps its header and says it is generic
@meta
core:+ effect.text = "( number number -- number )"
core:+ generic = true
```

```fl-proposed
# C444 equality never dispatches
@run
1 2 fx:pair 1 2 fx:pair = .
@out
true
```

```fl-proposed
# C445 a generic result is metered
@limits maxValueBytes=1000
@run
1 2 fx:pair 3 4 fx:pair + drop "ok" .
@out
ok
```

### 17.3 Tagged literals (C446 to C455)

```fl-proposed
# C446 a tagged literal is a compile-time value
@run
pair"3,4" fx:pair-a .
@out
3
```

```fl-proposed
# C447 inside a definition, a list and a MEMO body
@unit
: f ( -- int ) pair"3,4" fx:pair-a ;
MEMO: _p ( -- ext{fx-pair} ) pair"1,2" ;
@run
f .
{ pair"1,2" pair"3,4" } len .
_p fx:pair-a .
@out
3
2
1
```

```fl-proposed
# C448 a bad body points at the bad character
@run
pair"3;4" .
@error
E_SYNTAX line=1 col=7
```

```fl-proposed
# C449 after an escape the position is the start of the literal
@run
pair"3,\x3b" .
@error
E_SYNTAX line=1 col=1
```

```fl-proposed
# C450 an unregistered tag is E_LEX, as in v0.2
@run
nosuch"x" .
@error
E_LEX line=1 col=1
```

```fl-proposed
# C451 a tagged literal must be followed by white space
@run
pair"1,2"x
@error
E_LEX
```

```fl-proposed
# C452 an oversize literal is refused at compile time
@limits maxValueBytes=100
@run
big"5000" drop
@error
E_LIMIT_VALUE
```

```fl-proposed
# C453 the literal is part of the hash
@unit
: a ( -- ext{fx-pair} ) pair"1,2" ;
: b ( -- ext{fx-pair} ) pair"1,3" ;
@hash-ne
user:a user:b
```

```fl-proposed
# C454 a tagged literal cannot be a header default
@unit-fails E_HEADER
: f ( s:str p:ext{fx-pair}=pair"1,2" -- str ) s ;
```

```fl-proposed
# C455 negative components
@run
pair"-1,-2" fx:pair-a .
@out
-1
```

### 17.4 JSON and `null` (C456 to C470)

```fl-proposed
# C456 json to values, null included
@run
"[1,2.5,\"a\",true,null]" json>value .
@out
{ 1 2.5 "a" true null }
```

```fl-proposed
# C457 null is an ext value of kind null
@run
null type .
null ext-kind .
"null" json>value null? .
1 null? .
@out
ext
null
true
false
```

```fl-proposed
# C458 equality of nulls
@run
null null = .
null 0 = .
null "" = .
null false = .
@out
true
false
false
false
```

```fl-proposed
# C459 null in a container and in any
@unit
: f ( v:any -- bool ) v null? ;
@run
{ null } len .
null f .
5 f .
@out
1
true
false
```

```fl-proposed
# C460 a typed slot refuses null
@unit
: f ( n:int -- int ) n ;
@run
null f
@error
E_TYPE
```

```fl-proposed
# C461 a record slot refuses null
@unit
: f ( r:record -- int ) 1 ;
@run
null f
@error
E_TYPE
```

```fl-proposed
# C462 a round trip keeps null, int and num apart
@run
"{\"a\":[null,{\"b\":null}]}" json>value 0 value>json .
"[1,1.0,12345678901234567890]" json>value 0 value>json .
null 0 value>json .
@out
{"a":[null,{"b":null}]}
[1,1.0,12345678901234567890]
null
```

```fl-proposed
# C463 indent
@run
"[1,{\"a\":2}]" json>value 2 value>json .
@out
[
  1,
  {
    "a": 2
  }
]
```

```fl-proposed
# C464 a repeated key is E_COERCE
@run
"{\"a\":1,\"a\":2}" json>value
@error
E_COERCE
```

```fl-proposed
# C465 bad text is E_COERCE with a position
@run
"[1,]" json>value
@error
E_COERCE
```

```fl-proposed
# C466 bytes and other ext values have no JSON form
@run
#[ 01 ] 0 value>json
@error
E_TYPE
```

```fl-proposed
# C467 an ext value other than null has no JSON form
@run
1 2 fx:pair 0 value>json
@error
E_TYPE
```

```fl-proposed
# C468 a bad indent
@run
1 33 value>json
@error
E_RANGE
```

```fl-proposed
# C469 sort refuses a mixture with null
@run
{ 1 null } sort
@error
E_TYPE
```

```fl-proposed
# C470 a null is a collectable, storable value
@run
[ null emit null emit ] collect len .
@out
2
```

### 17.5 Core words (C471 to C492)

```fl-proposed
# C471 first, second, last
@run
{ 5 6 7 } first .
{ 5 6 7 } second .
{ 5 6 7 } last .
"héllo" last .
#[ 0a 0b ] first .
@out
5
6
7
o
10
```

```fl-proposed
# C472 first of an empty sequence is E_RANGE
@run
{ } first
@error
E_RANGE
```

```fl-proposed
# C473 second of one element is E_RANGE
@run
{ 1 } second
@error
E_RANGE
```

```fl-proposed
# C474 divmod follows floor semantics
@run
7 2 divmod . .
-7 2 divmod . .
@out
1
3
1
-4
```

```fl-proposed
# C475 divmod by zero
@run
1 0 divmod
@error
E_DIV_ZERO
```

```fl-proposed
# C476 tdiv rounds toward zero
@run
-7 2 tdiv .
7 -2 tdiv .
7 2 tdiv .
@out
-3
-3
3
```

```fl-proposed
# C477 tdiv by zero
@run
1 0 tdiv
@error
E_DIV_ZERO
```

```fl-proposed
# C478 zero-pad
@run
7 3 zero-pad .
1234 2 zero-pad .
@out
007
1234
```

```fl-proposed
# C479 zero-pad of a negative number
@run
-5 3 zero-pad
@error
E_RANGE
```

```fl-proposed
# C480 index-of in a list, bytes and a string
@run
{ 1 2 3 } 3 index-of .
{ 1 2 3 } 9 index-of .
#[ 01 02 ] 2 index-of .
"héllo" "l" index-of .
"abc" "" index-of .
@out
2
-1
1
2
0
```

```fl-proposed
# C481 index-of a byte out of range
@run
#[ 01 ] 300 index-of
@error
E_RANGE
```

```fl-proposed
# C482 set-nth copies
@run
{ 1 2 3 } 1 9 set-nth .
#[ 01 02 ] 0 255 set-nth bytes>hex .
@out
{ 1 9 3 }
ff02
```

```fl-proposed
# C483 set-nth index and byte range
@run
{ 1 } 5 0 set-nth
@error
E_RANGE
```

```fl-proposed
# C484 set-nth byte value out of range
@run
#[ 01 ] 0 256 set-nth
@error
E_RANGE
```

```fl-proposed
# C485 set-nth of a string
@run
"abc" 0 "x" set-nth
@error
E_TYPE
```

```fl-proposed
# C486 float bytes out
@run
1.0 64 false num>float-bytes bytes>hex .
1.0 32 true num>float-bytes bytes>hex .
0.1 32 false num>float-bytes bytes>hex .
@out
3ff0000000000000
0000803f
3dcccccd
```

```fl-proposed
# C487 float bytes in
@run
#[ 3f f0 00 00 00 00 00 00 ] false float-bytes>num .
@out
1.0
```

```fl-proposed
# C488 a NaN pattern is not a num
@run
#[ 7f f8 00 00 00 00 00 00 ] false float-bytes>num
@error
E_RANGE
```

```fl-proposed
# C489 float-bytes-class
@run
#[ 7f f8 00 00 00 00 00 00 ] false float-bytes-class .
#[ 7f f0 00 00 00 00 00 00 ] false float-bytes-class .
#[ ff f0 00 00 00 00 00 00 ] false float-bytes-class .
#[ 3f f0 00 00 00 00 00 00 ] false float-bytes-class .
@out
nan
inf
-inf
finite
```

```fl-proposed
# C490 a width other than 32 or 64
@run
1.0 16 false num>float-bytes
@error
E_RANGE
```

```fl-proposed
# C491 a length other than 4 or 8
@run
#[ 01 02 03 ] false float-bytes>num
@error
E_RANGE
```

```fl-proposed
# C492 a vocabulary's own name still wins over a new core word
@unit
IN: v
: last ( -- int ) 42 ;
: f ( -- int ) last ;
@run
v:f .
@out
42
```

### 17.6 Constant expressions and choice values (C493 to C506)

```fl-proposed
# C493 a computed integer constant
@unit
0xff 8 shl 0xff bor CONSTANT mask16
@run
mask16 .
@out
65535
```

```fl-proposed
# C494 a text constant and a constant that uses a constant
@unit
"ab" "cd" cat CONSTANT s
2 CONSTANT two
two 10 pow CONSTANT k
@run
s .
k .
@out
abcd
1024
```

```fl-proposed
# C495 an error of a primitive is a compile error
@unit-fails E_DIV_ZERO
1 0 div CONSTANT bad
```

```fl-proposed
# C496 a user word is not foldable
@unit-fails E_SYNTAX
: g ( -- int ) 1 ;
g CONSTANT x
```

```fl-proposed
# C497 a quotation is not foldable
@unit-fails E_SYNTAX
[ 1 ] CONSTANT q
```

```fl-proposed
# C498 a constant must be a scalar
@unit-fails E_TYPE
{ 1 2 } CONSTANT l
```

```fl-proposed
# C499 an expression must leave exactly one value
@unit-fails E_SYNTAX
1 2 CONSTANT x
```

```fl-proposed
# C500 a computed constant at the console
@run
3 4 + CONSTANT seven
seven .
@out
7
```

```fl-proposed
# C501 a choice with values: the word receives the value
@unit
CHOICE: block-size
  option small = 128 "Short blocks." ;
  option large = 256 ;
;
: scale ( n:int sz:choice<block-size>="small" -- int ) sz n * ;
@run
5 "large" scale .
@out
1280
@coercions
user:scale 1 str int
```

```fl-proposed
# C502 a text that is not an option
@unit
CHOICE: block-size
  option small = 128 ;
  option large = 256 ;
;
: scale ( n:int sz:choice<block-size>="small" -- int ) sz n * ;
@run
5 "huge" scale
@error
E_PARAM_INVALID
```

```fl-proposed
# C503 the slot keeps the texts and the values
@unit
CHOICE: block-size
  option small = 128 ;
  option large = 256 ;
;
: scale ( n:int sz:choice<block-size>="small" -- int ) sz n * ;
@meta
user:scale params[0].options = ["small","large"]
user:scale params[0].values = [128,256]
```

```fl-proposed
# C504 values of two tags are a bad clause
@unit-fails E_META
CHOICE: bad
  option a = 1 ;
  option b = "x" ;
;
```

```fl-proposed
# C505 some options with a value and some without
@unit-fails E_META
CHOICE: bad
  option a = 1 ;
  option b ;
;
```

```fl-proposed
# C506 a type without values expands as in v0.2
@unit
CHOICE: padding
  option pkcs7 ;
  option none ;
;
: f ( b:bytes p:choice<padding>="pkcs7" -- bytes ) b ;
@meta
user:f effect.text = "( b:bytes p:choice{pkcs7|none}=pkcs7 -- bytes )"
```

### 17.7 Friend access, forward declarations, `VARIABLE`, `record{` (C507 to C536)

```fl-proposed
# C507 a friend may name a private word
@unit
IN: lib
: _helper ( n:int -- int ) n 2 * ;
META: _helper
  friend app ;
;
IN: app
: use ( n:int -- int ) n lib:_helper ;
@run
4 app:use .
@out
8
```

```fl-proposed
# C508 a vocabulary that is not a friend still gets E_PRIVATE
@unit-fails E_PRIVATE
IN: lib
: _helper ( n:int -- int ) n 2 * ;
META: _helper
  friend app ;
;
IN: other
: bad ( n:int -- int ) n lib:_helper ;
```

```fl-proposed
# C509 a friend grant does not make the name visible through USING
@unit-fails E_UNDEFINED
IN: lib
: _helper ( n:int -- int ) n 2 * ;
META: _helper
  friend app ;
;
IN: app
USING: lib ;
: bad ( n:int -- int ) n _helper ;
```

```fl-proposed
# C510 any other clause on a private word is still E_META
@unit-fails E_META
: _x ( -- int ) 1 ;
META: _x
  doc "x" ;
;
```

```fl-proposed
# C511 the grant is metadata and is not hashed
@unit
IN: lib
: _helper ( n:int -- int ) n 2 * ;
META: _helper
  friend app zip ;
;
@meta
lib:_helper discovery.friends = ["app","zip"]
```

```fl-proposed
# C512 a bad vocabulary name in friend
@unit-fails E_META
: _x ( -- int ) 1 ;
META: _x
  friend "no spaces" ;
;
```

```fl-proposed
# C513 mutual recursion through DEFER:
@unit
DEFER: odd? ( n:int -- bool )
: even? ( n:int -- bool ) n 0 = [ true ] [ n 1 - odd? ] if ;
: odd? ( n:int -- bool ) n 0 = [ false ] [ n 1 - even? ] if ;
@run
10 even? .
7 even? .
@out
true
false
```

```fl-proposed
# C514 the header must match the declaration
@unit-fails E_HEADER
DEFER: f ( n:int -- bool )
: f ( n:int -- int ) n ;
```

```fl-proposed
# C515 a declaration with no definition
@unit-fails E_UNDEFINED
DEFER: f ( -- int )
```

```fl-proposed
# C516 declaring a name twice
@unit-fails E_REDEFINED
DEFER: f ( -- int )
DEFER: f ( -- int )
: f ( -- int ) 1 ;
```

```fl-proposed
# C517 at the console, in one input
@run
DEFER: f ( -- int )
: g ( -- int ) f ;
: f ( -- int ) 7 ;
g .
@out
7
```

```fl-proposed
# C518 the members of a cycle have distinct hashes
@unit
DEFER: odd? ( n:int -- bool )
: even? ( n:int -- bool ) n 0 = [ true ] [ n 1 - odd? ] if ;
: odd? ( n:int -- bool ) n 0 = [ false ] [ n 1 - even? ] if ;
@hash-ne
user:even? user:odd?
```

```fl-proposed
# C519 there is still no tail call
@limits maxReturnDepth=1000
@unit
DEFER: odd? ( n:int -- bool )
: even? ( n:int -- bool ) n 0 = [ true ] [ n 1 - odd? ] if ;
: odd? ( n:int -- bool ) n 0 = [ false ] [ n 1 - even? ] if ;
@run
5000 even?
@error
E_LIMIT_RETURN
```

```fl-proposed
# C520 DEFER: inside a body
@unit-fails E_SYNTAX
: f ( -- int ) DEFER: g ( -- int ) 1 ;
```

```fl-proposed
# C521 a list as the initial value
@unit
{ 1 2 } VARIABLE items
@run
items len .
{ 9 } items!
items first .
@out
2
9
```

```fl-proposed
# C522 a record as the initial value
@unit
record{ "k" 1 } VARIABLE conf
@run
conf "k" get .
@out
1
```

```fl-proposed
# C523 the type is fixed by the initial value
@unit
{ 1 } VARIABLE items
@run
5 items!
@error
E_TYPE
```

```fl-proposed
# C524 an array cannot be an initial value
@unit-fails E_SYNTAX
{ 1 } thaw VARIABLE a
```

```fl-proposed
# C525 each run starts at the initial value
@unit
{ 1 2 } VARIABLE items
@run
{ 9 } items!
@run
items len .
@out
2
```

```fl-proposed
# C526 a variable is one cell per run, shared by recursion
@unit
0 VARIABLE n
: bump ( -- ) n 1 + n! ;
: twice ( -- ) bump bump ;
@run
twice twice n .
@out
4
```

```fl-proposed
# C527 a record literal
@run
record{ "a" 1 "b" 2 } "b" get .
record{ "a" 1 } .
@out
2
record{ "a": 1 }
```

```fl-proposed
# C528 the contents are code
@run
record{ "x" 1 2 + } "x" get .
@out
3
```

```fl-proposed
# C529 an odd number of values
@run
record{ "a" } .
@error
E_EFFECT
```

```fl-proposed
# C530 a key that is not a string
@run
record{ 1 2 } .
@error
E_TYPE
```

```fl-proposed
# C531 a later key wins
@run
record{ "a" 1 "a" 2 } "a" get .
@out
2
```

```fl-proposed
# C532 an empty literal and a nested one
@run
record{ } keys len .
record{ "l" { 1 2 } } "l" get len .
@out
0
2
```

```fl-proposed
# C533 :> inside a record literal
@unit-fails E_SYNTAX
: f ( -- record ) record{ "a" 1 :> x } ;
```

```fl-proposed
# C534 an unterminated record literal
@run
record{ "a" 1
@error
E_SYNTAX
```

```fl-proposed
# C535 record{ glued to a name is still E_LEX
@run
record{x
@error
E_LEX
```

```fl-proposed
# C536 a record literal is metered like a list literal
@limits maxValueBytes=100
@run
record{ "a" "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
@error
E_LIMIT_VALUE
```

### 17.8 The mutable array and 32-bit words (C537 to C566)

```fl-proposed
# C537 thaw, aset!, aget, alen
@unit
: f ( -- int ) { 1 2 3 } thaw :> a  a 1 99 aset!  a alen  a 1 aget + ;
@run
f .
@out
102
```

```fl-proposed
# C538 two names for one array
@unit
: f ( -- int ) 3 0 anew :> a  a :> b  b 0 7 aset!  a 0 aget ;
@run
f .
@out
7
```

```fl-proposed
# C539 apush! grows a value array
@unit
: f ( -- int ) { } thaw :> a  a 5 apush!  a 6 apush!  a alen ;
@run
f .
@out
2
```

```fl-proposed
# C540 a byte array and freeze
@unit
: f ( -- str ) 4 anew-bytes :> a  a 0 255 aset!  a freeze bytes>hex ;
@run
f .
@out
ff000000
```

```fl-proposed
# C541 a byte out of range
@unit
: f ( -- ) 2 anew-bytes :> a  a 0 256 aset! ;
@run
f
@error
E_RANGE
```

```fl-proposed
# C542 a write to a sealed array
@unit
: f ( -- ) { 1 } thaw :> a  a freeze drop  a 0 5 aset! ;
@run
f
@error
E_EFFECT detail.reason=sealed
```

```fl-proposed
# C543 an index out of range
@run
{ 1 } thaw 5 aget
@error
E_RANGE
```

```fl-proposed
# C544 an array cannot be put in a list literal
@run
{ { 1 } thaw } drop
@error
E_TYPE detail.reason=not-storable
```

```fl-proposed
# C545 nor appended
@run
{ } { 1 } thaw append
@error
E_TYPE
```

```fl-proposed
# C546 nor emitted
@run
[ { 1 } thaw emit ] collect
@error
E_TYPE
```

```fl-proposed
# C547 equality is identity
@run
{ 1 } thaw dup = .
{ 1 } thaw { 1 } thaw = .
@out
true
false
```

```fl-proposed
# C548 display is a snapshot
@run
{ 1 2 } thaw .
#[ 01 02 ] thaw .
{ 1 2 } thaw .s
@out
array{ 1 2 }
array#[ 01 02 ]
<1> array{ 1 2 }
```

```fl-proposed
# C549 thaw is metered at its full size
@limits maxValueBytes=1000
@run
200 0 anew
@error
E_LIMIT_VALUE
```

```fl-proposed
# C550 apush! checks the live size at every push
@limits maxValueBytes=1000
@unit
: g ( -- ) { } thaw :> a  200 0 range [ drop a 0 apush! ] each ;
@run
g
@error
E_LIMIT_VALUE
```

```fl-proposed
# C551 a MEMO: output cannot be an array
@unit-fails E_HEADER
MEMO: _a ( -- ext{array} ) { 1 } thaw ;
```

```fl-proposed
# C552 a MEMO: body may use an array inside
@unit
MEMO: _t ( -- list ) { 1 2 } thaw :> a  a 0 9 aset!  a freeze ;
@run
_t .
@out
{ 9 2 }
```

```fl-proposed
# C553 an array passes to a helper word
@unit
: bump ( a:ext{array} -- ) a 0 a 0 aget 1 + aset! ;
: use ( -- int ) { 1 } thaw :> a  a bump  a 0 aget ;
@run
use .
@out
2
```

```fl-proposed
# C554 aset! of an array value is refused
@unit
: f ( -- ) { 1 } thaw :> a  { 0 } thaw :> b  a 0 b aset! ;
@run
f
@error
E_TYPE
```

```fl-proposed
# C555 a byte array refuses apush!
@run
2 anew-bytes 1 apush!
@error
E_TYPE
```

```fl-proposed
# C556 a negative size
@run
-1 0 anew
@error
E_RANGE
```

```fl-proposed
# C557 32-bit arithmetic wraps
@run
4294967295 1 add32 .
0 1 sub32 .
65536 65536 mul32 .
4294967295 4294967295 mul32 .
-1 1 add32 .
@out
0
4294967295
0
1
0
```

```fl-proposed
# C558 shifts and not
@run
1 31 shl32 .
1 32 shl32 .
2147483648 31 shr32 .
0 not32 .
@out
2147483648
0
1
4294967295
```

```fl-proposed
# C559 rotations
@run
1 1 rotr32 .
2147483648 1 rotl32 .
1 33 rotl32 .
@out
2147483648
1
2
```

```fl-proposed
# C560 a negative shift
@run
1 -1 shl32
@error
E_RANGE
```

```fl-proposed
# C561 bytes to words
@run
#[ 01 02 03 04 ] false bytes>u32 .
#[ 01 02 03 04 ] true bytes>u32 .
@out
{ 16909060 }
{ 67305985 }
```

```fl-proposed
# C562 words to bytes
@run
{ 16909060 } false u32>bytes bytes>hex .
@out
01020304
```

```fl-proposed
# C563 a length that is not a multiple of four
@run
#[ 01 02 03 ] false bytes>u32
@error
E_RANGE
```

```fl-proposed
# C564 a word out of range
@run
{ 4294967296 } false u32>bytes
@error
E_RANGE
```

```fl-proposed
# C565 a negative word
@run
{ -1 } false u32>bytes
@error
E_RANGE
```

```fl-proposed
# C566 a non-integer word
@run
{ "a" } false u32>bytes
@error
E_TYPE
```

### 17.9 `charge` and `+media` (C567 to C572)

```fl-proposed
# C567 a primitive that charges stays inside the limit
@limits maxSteps=100
@run
10 fx:charge
"ok" .
@out
ok
```

```fl-proposed
# C568 and reaches it deterministically
@limits maxSteps=100
@run
200 fx:charge
@error
E_LIMIT_STEPS
```

```fl-proposed
# C569 the step limit is not catchable from inside a primitive
@limits maxSteps=100
@run
[ 200 fx:charge ] [ drop ] try
@error
E_LIMIT_STEPS
```

```fl-proposed
# C570 charge(0) polls the deadline
@limits maxMillis=100
@run
fx:spin
@error
E_LIMIT_TIME
```

```fl-proposed
# C571 a denied +media label
@deny +media
@run
fx:media-op
@error
E_FORBIDDEN detail.effect=+media
```

```fl-proposed
# C572 the label is inferred through callers
@unit
: m ( -- int ) fx:media-op ;
@meta
user:m effects = ["+media"]
```

### 17.10 The breaking fixes (C573 to C592)

```fl-proposed
# C573 reduce: the order and the quotation's stack picture are pinned
@run
{ 1 2 3 } 10 [ - ] reduce .
@out
4
```

```fl-proposed
# C574 a vocabulary word that shares a core name; core: reaches the core word
@unit
IN: v
: range ( -- int ) 1 ;
: both ( -- int list ) range 0 3 core:range ;
@run
v:both . .
@out
{ 0 1 2 }
1
```

```fl-proposed
# C575 a local named like a core word draws W_SHADOW, as before
@unit
: f ( len:int -- int ) len ;
@warnings
W_SHADOW
```

```fl-proposed
# C576 / of big integers is the nearest double
@run
100000000000000000000 3 /  .
1180591620717411303425 1 / .
@out
33333333333333330000.0
1.1805916207174113e+21
```

```fl-proposed
# C577 / of a quotient beyond the double range
@run
10 400 pow 1 /
@error
E_RANGE
```

```fl-proposed
# C578 / by zero is still E_DIV_ZERO for big integers
@run
100000000000000000000 0 /
@error
E_DIV_ZERO
```

```fl-proposed
# C579 a big integer with a num is still E_COERCE
@run
100000000000000000000 2.0 /
@error
E_COERCE
```

```fl-proposed
# C580 an interval constraint raises E_RANGE
@unit
: f ( x:int[1..5] -- int ) x ;
@run
9 f
@error
E_RANGE detail.param=x
```

```fl-proposed
# C581 a set constraint and a length constraint
@unit
: f ( x:int[1|2|3] -- int ) x ;
: g ( s:str[1..3] -- str ) s ;
@run
9 f
@error
E_RANGE
```

```fl-proposed
# C582 a length constraint
@unit
: g ( s:str[1..3] -- str ) s ;
@run
"abcd" g
@error
E_RANGE
```

```fl-proposed
# C583 a pattern that does not match stays E_PARAM_INVALID
@unit
: f ( s:str[/a+/] -- str ) s ;
@run
"b" f
@error
E_PARAM_INVALID
```

```fl-proposed
# C584 a choice that is not an option stays E_PARAM_INVALID
@unit
: f ( s:str m:choice{a|b}=a -- str ) s ;
@run
"x" "c" f
@error
E_PARAM_INVALID
```

```fl-proposed
# C585 runtime.call fills a missing parameter from its default
@unit
: f ( s:str mode:choice{a|b}=b -- str ) s mode cat ;
@stack-in
"x"
@call user:f
@stack
<1> "xb"
```

```fl-proposed
# C586 a missing parameter without a default is still an underflow
@unit
: h ( s:str n:int -- str ) s ;
@stack-in
"a"
@call user:h
@error
E_STACK_UNDERFLOW
```

```fl-proposed
# C587 the data input is never defaulted
@unit
: f ( s:str n:int=3 -- str ) s ;
@call user:f
@error
E_STACK_UNDERFLOW
```

```fl-proposed
# C588 a pattern with white space, written as a string
@unit
: f ( s:str["a b"] -- str ) s ;
@run
"a b" f .
@out
a b
@meta
user:f effect.text = "( s:str[\"a b\"] -- str )"
```

```fl-proposed
# C589 a string pattern with parentheses, and a mismatch
@unit
: f ( s:str["(a|b) c"] -- str ) s ;
@run
"b c" f .
"d c" f
@out
b c
@error
E_PARAM_INVALID
```

```fl-proposed
# C590 a pattern without white space keeps its old canonical text
@unit
: f ( s:str[/a+/] -- str ) s ;
@meta
user:f effect.text = "( s:str[/a+/] -- str )"
```

```fl-proposed
# C591 the \f escape
@run
"\f" str>codes .
'\f' .
"\f" .s
@out
{ 12 }
12
<1> "\x0c"
```

```fl-proposed
# C592 an unknown escape is still E_LEX
@run
"\q"
@error
E_LEX
```

### 17.11 The kernel clause (C593 and C594, conditional on L0)

These two cases exist **only if L0 passes** and the owner approves L11. If L0 fails they are deleted with section 13.

```fl-proposed
# C593 the kernel clause is accepted and is metadata only (conditional on L0)
@unit
: f ( n:int -- int ) n 1 + ;
META: f
  kernel ;
;
@meta
user:f discovery.kernel = true
```

```fl-proposed
# C594 kernel is singular and takes no argument (conditional on L0)
@unit-fails E_META
: f ( n:int -- int ) n 1 + ;
META: f
  kernel 1 ;
;
```

---

## 18. Design decisions (D69 to D96, proposed)

These continue the D-numbers of LANGUAGE.md §17. They become decisions when the owner approves the answers of section 19.

| # | Decision | Rationale |
|---|---|---|
| D69 | FL gets a tenth tag, `ext`, for host-registered kinds. A payload is opaque and immutable. | One mechanism for `table`, `relation`, `rat`, `null`, `array` (T8, T17). |
| D70 | The kind registry is process-wide, keyed by name, idempotent, last registration wins. FL code cannot register. | T18; X0 R1, R2; D8. |
| D71 | `ext{kind}` is a header type. `StackSlot.kind` holds the kind. A string default is allowed; a constraint is not. | X0 R3; RECIPES-1.2 §3.4. |
| D72 | `str` coerces to `ext{kind}` through `fromText`; no other coercion into or out of `ext`. | One recipe-to-VM path. |
| D73 | `sizeOf` of a kind is O(1), conservative, cached, and tested per kind. | T19; X0 R8. |
| D74 | The behaviour of a kind is not hashed. | Same limit as primitives. |
| D75 | Core arithmetic and the structure words are generic through the kind's `methods`; the header text and the hash of each are unchanged. | Plain numbers stay bit-identical; no hash churn. |
| D76 | Dispatch is by operand position (first `ext` operand, then the other), and a method may decline. | Independent of pack load order. |
| D77 | No user-written generic words (`GENERIC:`, `METHOD:`) in v0.3. | No client; D5 and hash costs. |
| D78 | Tagged literals `tag"…"` are accepted by the reader only for registered tags and evaluated at compile time. An unregistered tag stays `E_LEX`. | Nothing valid changes (D8). |
| D79 | JSON `null` is `ext{null}`, with the words `null` and `null?`. | Q14; the sentinel's flaws. |
| D80 | `json>value` and `value>json` are `core` primitives; the shipped JSON rules become normative. | One JSON implementation. |
| D81 | `CONSTANT` and `VARIABLE` take a constant expression of foldable words, run by the compiler with no VM. `CONSTANT` takes a scalar. | `load()` stays synchronous and free of user code (D23); refines D4. |
| D82 | A `CHOICE:` option may carry a value; the word receives the value and the recipe still pushes the text. | Replaces the `choice … case` pattern. |
| D83 | `friend` lets named vocabularies reference a private word by qualified name. | §5.7; privacy is a convention. |
| D84 | `DEFER:` declares a word; the next definition resolves it. The hash of a cycle uses a group hash. | Refines D6. |
| D85 | A `VARIABLE` may start as any storable value. It stays one cell per run; there is no re-entrancy form. | No client. |
| D86 | `record{ … }` is a record literal with list-literal semantics. | Replaces the record part of D10. |
| D87 | `array` is an `ext` kind. Its five in-place words are intrinsics, so D44 holds for primitives. An array cannot be stored. | Option B of the study, without an eleventh tag. |
| D88 | A write to a sealed array is `E_EFFECT` with a reason. | No new error code (D68). |
| D89 | 32-bit words and bulk conversion are specified and gated on L0. | Thin evidence (TOOLKIT §11.3). |
| D90 | `PrimitiveContext.charge(n)` adds steps, polls abort and deadline, and is deterministic. A weight is opt-in. | L8; SYMBOLIC S19. |
| D91 | `+media` is an effect label; `+net` is not added. | TOOLKIT §5.4; T3. |
| D92 | `reduce` keeps its order. | Matches Factor, JavaScript and Python; a swap costs steps. |
| D93 | `/` of two integers is the correctly rounded quotient at any size. | A finite quotient is not an error. |
| D94 | An interval, set or length violation of a header constraint is `E_RANGE`; the other four stay `E_PARAM_INVALID`. | One code for a bad argument. |
| D95 | `runtime.call` applies header defaults; the VM never does. | D15 stands. |
| D96 | Pattern strings, `\f` and an 8000-character `doc` are added. | Each was an `E_HEADER`, `E_LEX` or `E_META`. |

---

## 19. Open questions, each with a recommended answer

Each question starts with its version where it has one. The recommended answer is what this file specifies.

**Q1. Version: is this wave FL v0.3, with the file `docs/LANGUAGE-0.3.md`?** Recommended: **yes, v0.3** (section 2.3): one breaking item, one wave boundary, not a 1.0. The alternatives are 1.0 (rejected: no pack has shipped on `ext` yet) and a split into v0.3 and v0.4 (rejected: two sweeps).

**Q2. Version staging: how is the bump staged (Q15, language side)?** Recommended: **one number, `FORGE_LANG_VERSION` `"0.3.0"`, set at the wave-boundary merge (L12)**; X1 and X2 land together with the forced one-line `ext` cases (G1); L9b and L12 land in one group (G3); the worker protocol is `PROTOCOL_VERSION` 2 and the recipe format stays `"forge": 1` (section 2.4).

**Q3. v0.3: how does FL hold JSON `null` (Q14)?** Recommended: **`ext{null}`**, with the words `null` and `null?` (section 7). Alternatives: keep the sentinel record (no language change, keeps `type` `record` and the `jwk` guards); a tenth tag `null` (a second source-breaking union change). If the owner keeps the sentinel, section 7 shrinks to the JSON words and RELIX.md §5.4 needs the sentinel as its representation.

**Q4. v0.3: are generic words a closed list with kind methods (section 5), or user-declared (`GENERIC:`, `METHOD:`)?** Recommended: **closed list, kind methods**, header text and hashes unchanged. User-declared generics wait for a client.

**Q5. v0.3: is the mutable array an `ext` kind with five intrinsics?** Recommended: **yes** (section 10). Alternatives: a new tag (the study's option B as written); step zero only (`set-nth`, `index-of`, which is already in section 8). This also needs the owner to see that `array` and `null` are reserved kind names.

**Q6. v0.3: does `reduce` change its argument order?** Recommended: **no** (section 12.1). If the owner wants `init seq quot`: `reduce` becomes `( init seq quot -- acc )`; the quotation keeps `( acc elem )`; the sweep inserts `-rot swap rot` before every `reduce` whose arguments are not literal (88 lines mention it in 41 files), the 88 callers change hash, and `C573` changes to `10 { 1 2 3 } [ - ] reduce`.

**Q7. v0.3: does a violated interval, set or length constraint raise `E_RANGE` (breaking)?** Recommended: **yes** (section 12.3), with the vector expectation rewrite (at most 20). Alternative: leave `E_PARAM_INVALID`, and the wave is wholly additive.

**Q8. v0.3: are computed constants constant expressions run by the compiler, not by the VM at load?** Recommended: **yes** (section 9.1). `load()` cannot run FL (D23, and the VM is async). `warm()` remains the explicit load budget for `MEMO:`.

**Q9. v0.3: are choice values specified now and implemented last?** Recommended: **yes**, and dropped if the L1 count of `choice … case` tables is small (section 9.2).

**Q10. v0.3: forward declarations by `DEFER:` with a group hash for cycles?** Recommended: **yes** (section 9.4). The alternative is no mutual recursion (D6), which keeps hashing simple.

**Q11. v0.3: is friend access a `friend` clause on a private word?** Recommended: **yes** (section 9.3). It removes the need for internal vocabularies in new code.

**Q12. v0.3: is a re-entrancy form for `VARIABLE` (`with-variable`) added?** Recommended: **no**; state the rule (section 9.5).

**Q13. v0.3: are the 32-bit words (L7b) built before L0 reports?** Recommended: **no**: specify now, build after L0; drop them if L11 makes them unnecessary.

**Q14. v0.3: may an `ext` parameter have a string default?** Recommended: **yes** (section 4.3). This refines X0 §3.3, because RECIPES-1.2 §3.4 already assumes it.

**Q15. v0.3: are `null` and `array` reserved core kind names?** Recommended: **yes**; the manifest of PACKS.md (SP4) must refuse a pack that claims them, as it refuses `table`, `relation`, `relix-expr` and `rat` for non-owners (T18).

**Q16. v0.3: is the `doc` cap 8000 and the vector `ref` cap 1000?** Recommended: **yes** (section 12.8). The `ref` cap is the vector schema owner's.

**Q17. v0.3: are the two `ext` words `ext-kind` and `ext>text` enough?** Recommended: **yes**; a word that builds a value of a kind from text is the coercion at a typed slot, and a tagged literal.

**Q18. v0.3: which spelling for the table export words, `table:>csv` and `table:>json` (TOOLKIT §7) or `table:to-csv` and `table:to-json` (the D2 row, X0, RECIPES-1.2, RELIX.md, UI-TOOLKIT)?** Recommended: **`table:to-csv` and `table:to-json`.** Reasons: (a) every approved document and the X0 prototype already use `to-`; RECIPES-1.2 and RELIX.md name `table:to-json` in vectors and examples; (b) the `A>B` spelling in FL is the convention of **`core`** conversion words (`str>int`, `bytes>hex`, `json>value`), which are one-step primitives of a closed vocabulary; an op of a data vocabulary uses `to-` and `from-` (`csv:to-json`, `csv:from-json`, `yaml:to-json`); (c) `table:to-json` keeps the family of `csv:to-json`. TOOLKIT §7 should be corrected. The same section writes `json:parse`; after L3 the word is the core `json>value`.

---

## 20. Work packages

Ids continue TOOLKIT §13.4 and §13.5. "Maps to" names the TOOLKIT row. All packages: Apache header on every new file, the CSP rules of UI.md §4, `npm run lint && npm run typecheck && npm test && npm run build` pass, no edits outside owned paths, no `Co-Authored-By`. Packages that change `packages/*` start only after Gate T1. Agents: So is Sonnet, Ha is Haiku (CLAUDE.md).

| WP | Scope | Files | Depends on | Maps to | Agent | Done when |
|---|---|---|---|---|---|---|
| H0 | The harness additions of section 3 (fixtures, `@call`, `@meta` paths) | `packages/lang/test/conformance/*` | Gate T1 | SP1 | So | Existing 317 blocks pass; the fixtures exist; a fixture block runs |
| X1 | Section 4: `ext.ts`, registry, `ext{kind}`, `StackSlot.kind`, coercion, equality, text, size, `ext-kind`, `ext>text`, `null` kind and words; the forced one-line cases outside `packages/lang` (X0 §7); `kindConformance` | `packages/lang/src/{types,values,meta,primitives,vm,errors}.ts`, `ext.ts`, `meta.schema.json`, `vocab/core.ts`; the forced cases in `packages/{ops,recipe,worker}` and `apps/web` | H0 | X1 | So | C401 to C428 and C456 to C461 pass as `fl-test`; v0.2 conformance unchanged; a module evaluated twice registers cleanly; size limits apply |
| X4 | Section 6: `tstr` token, `ReadOptions.literalTags`, `registerLiteralTag`, compile-time evaluation | `reader.ts`, `compiler.ts`, `ext.ts` | X1 | X4 | So | C446 to C455 pass; the error position points at the bad character |
| L2 | Section 8 words | `packages/lang/src/vocab/*` | H0 | L2 | Ha | C471 to C492 pass; the §13 table test passes; `core` has the new rows |
| L3 | Section 7 words and one JSON implementation; the `json` vocabulary of `@forge/ops` becomes wrappers | `packages/lang/src/vocab/json.ts`, `packages/ops/src/prims/json.ts` | X1, L2 | L3 | So | C456 to C470 pass; round-trip properties pass; one implementation |
| L5a | Section 9.1 constant expressions | `compiler.ts`, `compiler-const.ts` | X4, L2 | L5 | So | C493 to C500 pass; no VM code runs at load |
| L5b | Section 9.2 choice values (last; may be dropped, Q9) | `compiler-choice.ts`, `meta.ts` | L5a | L5 | So | C501 to C506 pass; no existing `effect.text` or hash changes |
| L6 | Section 9.3 to 9.6: `friend`, `DEFER:` and the group hash, `VARIABLE` any value, `record{` | `compiler.ts`, `dictionary.ts`, `meta.ts`, `meta-discovery.ts`, `reader.ts`, `vm.ts` | L5a, X1 | L6 | So | C507 to C536 pass; a vocabulary can call another's private word by `friend` |
| L7a | Section 10.1 to 10.3: `ext{array}`, the five intrinsics, `thaw`, `anew`, `anew-bytes`, the `storable` rule | `vm.ts`, `values.ts`, `vocab/array.ts` | X1, L2 | L7 | So | C537 to C556 pass; aliasing rules tested; D44 holds for primitives |
| L7b | Section 10.4 32-bit words, **gated on L0** | `vocab/word32.ts` | L7a, L0 | L7 | Ha | C557 to C566 pass |
| L8 | Section 11: `charge`, `cost`, `+media` | `vm.ts`, `primitives.ts`, `types.ts` | X1 | L8 | So | C567 to C572 pass; a primitive reaches `maxSteps` at the same step in Node and a Worker |
| L9a | Section 12.2, 12.4, 12.6 to 12.8: `/`, `runtime.call` defaults, pattern strings, `\f`, `doc` cap; the grep for `E_COERCE` from `/` | `vocab/core.ts`, `runtime.ts`, `meta.ts`, `reader.ts`, `meta.schema.json` | L2 | L9 | So | C576 to C579, C585 to C592 pass; the `/` search finds nothing |
| L9b | Section 12.3: the `E_RANGE` constraint code. **Merges only in group G3.** | `values.ts`, `vm.ts` | L9a | L9 | So | C580 to C584 pass; the vectors fail until L12 rewrites the listed expectations |
| L10 | Section 5: the `generic` flag, dispatch, `methods`, `sort` by `compare` | `primitives.ts`, `vm.ts`, `values.ts`, `types.ts` | X1 | L10 | So | C431 to C445 pass; plain numbers bit-identical; the step and time overhead is measured (target: within 2% on the 10^6-step benchmark) |
| L11 | Section 13, **only if L0 passes** | `packages/lang/src/kernel/*` | L7a, L0 | L11 | So | C593 and C594 pass; every kernel word equals the interpreted run |
| L12 | The sweep: the `json` callers; the expectation codes of 12.3; `previousHashes` first (T27); `FORGE_LANG_VERSION` | `packages/ops/vocab/*.fth`, `*.test.json`, `src/prims/*` | L2, L3, L9b, L10 | L12 | So | All vectors pass except the listed expectation codes; catalogue version bumped; run at a wave boundary |
| L13 | Move primitives to FL (the 7 + 3 + 9 of TOOLKIT §2.5; the cipher and hash cores only if L11 passes) | `packages/ops/prims/*`, `vocab/*` | L12, L7a, L11 | L13 | Ha | Vectors unchanged; the corpus-stats report shows the change |
| L14 | The fold-in: LANGUAGE.md v0.3, Appendix B, the cases of section 17 under their numbers, `LANGUAGE-0.3.md` becomes a historical note | `docs/LANGUAGE.md`, `docs/LANGUAGE-0.3.md` | all of the above | SP1 | So | The harness reads LANGUAGE.md only again |

---

## 21. What the other documents need

This file edits none of them. The orchestrator applies or briefs these.

**TOOLKIT.md**

1. §11 title and §13.3 row SP1: "FL v0.2" becomes "FL v0.3"; the status of the table rows (section 1 of this file lists each). Q14 and Q15 get this file's answers, once the owner decides.
2. §7 (the table words): `table:>csv` and `table:>json` become `table:to-csv` and `table:to-json` (Q18); `json:parse` becomes `json>value`.
3. §11.5: `reduce` order recommended unchanged; generic arithmetic is additive; the `raise`/`range` clash is closed; the sweep rewrites no word source except the `json` callers (section 14).
4. §13.4: L-rows refined to H0, L5a, L5b, L7a, L7b, L9a, L9b, L14; L12's "all 4,488 vectors pass unchanged" becomes "pass except the listed expectation codes"; the counts 4,488, 161 and 1,853 are older than the tree (`packages/ops/README.md` counts 7,302 vectors; 208 `.fth` files); L1 refreshes them.
5. §6.1: the registry is process-wide, not a `RuntimeOptions` field (T18); a string default is allowed on an `ext` parameter.
6. §3: new decisions for the owner's answers (T35 and up).

**RELIX.md**: §5.4 and the "NULL inside a struct or array" row of §5.1: a nested NULL maps to `ext{null}` and back (Q14); §5.2 "other `ext` kinds not mappable" gains the exception `null`; §16 item 13 is answered.

**RECIPES-1.2.md**: §3.1 rule 4 stays; the string default on an `ext` parameter is confirmed (Q14 here). The vector `ref` cap (200) is the vector schema's; 1000 is recommended (Q16).

**PACKS.md (SP4)**: the manifest reserves the kind names `null`, `array`, `table`; a pack declares its literal tags beside its kinds; the labels `+media` (and later `+net`) are declared by the language, granted by the pack system.

**The UI proposal (SP3)**: no kind named `null` or `array` needs a viewer: both render as text. A kind with a `view` is for X2 only.

**SYMBOLIC.md v2 (SP5)**: S15 to S19 become this file's sections 4, 5, 6 and 11. S16 is answered by section 5 (kind methods, no `GENERIC:`); S17 by section 6; S19 by section 11. Its rules and words are FL and call kind functions.

**docs/research/**: `mutable-array.md` and `int-words.md` §5 are answered by sections 8 and 10.

**The editor plugin** (outside this repository): section 16.
