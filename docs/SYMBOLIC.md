# Symbolic math (HP 48-style): design, v1

Status: draft v1 (2026-11-11). A design proposal, not yet normative. It builds on [PLAN.md](PLAN.md) (§1 principles, §3 language, §3.5 primitives, §5 security, §6 testing, §7–8 phases and orchestration, §9 decisions), [LANGUAGE.md](LANGUAGE.md) (FL v0.1, frozen), [RECIPES.md](RECIPES.md) (catalogue, recipe JSON, bake host) and [UI.md](UI.md) (§4 CSP). Code contracts referred to: `packages/lang/src/types.ts`, `packages/lang/src/values.ts`, `packages/lang/src/meta.schema.json`, `packages/worker/src/protocol.ts`, `packages/worker/src/render.ts`, `packages/ops/src/catalogue.ts`, `packages/ops/src/types.ts`.

> **Project rule.** Forge is inspired by the HP 48G/GX symbolic calculator, not compatible with it, in the same way it is inspired by CyberChef (PLAN §1). Word names, text syntax, error messages and tables are Forge's own. No HP command names, ROM tables or documentation text are copied, and keystroke or RPL compatibility is not a goal.

> **Packages are frozen.** `packages/*` hold frozen Phase 1–2 contracts (CLAUDE.md). Stage A (§3) needs no language change and one small, owner-approved edit to a constant in `packages/ops` (S6). Stage B (§4) changes frozen contracts and needs an explicit owner-approved version bump (FL v0.2); nothing in it starts before the gate in §8.

## Contents

1. Goal and scope
2. Gap analysis
3. Stage A: library only
4. Stage B: language changes (FL v0.2)
5. UI and recipes
6. Security and limits
7. Testing
8. Phasing and work packages
9. Decisions and open questions

---

## 1. Goal and scope

Forge's core is a small Forth-like language. The goal is a capability like the HP 48's computer algebra system: expressions are values, names can stay unbound, arithmetic on an expression builds a bigger expression, and a set of words simplifies, differentiates, integrates, solves and substitutes. The audience is the same as for the rest of Forge: people working with codes and data, for whom exact integer, rational and modular arithmetic, polynomial manipulation (CRC, LFSR and Reed–Solomon style work), and unit-aware numbers are useful next to ciphers and encodings.

**In scope (48-style):**

- algebraic expression objects, and symbolic names that stay symbolic when unbound;
- generic arithmetic that builds an expression when an operand is symbolic;
- evaluate (exact) and to-number (approximate) words, and substitution (the 48's "where");
- exact and approximate numeric modes, rational numbers and complex numbers;
- collect, expand and simplify;
- derivative; integral (symbolic where possible, numeric definite integral otherwise); Taylor polynomial;
- isolate-a-variable, quadratic and polynomial roots, a numeric root finder; summation;
- rewrite rules (pattern up/down rewriting with wildcards and conditions);
- unit objects: value with unit, conversion, unit arithmetic, reduction to base units;
- user-defined functions, as named expressions in an environment record;
- vectors and matrices, as a later extension (§4, S.17).

**Non-goals:** HP RPL compatibility; a directory tree or global variable store (state is passed in **environment records**, which is consistent with "no ambient authority", PLAN §5); the graphical equation editor; plotting (possible later UI work, §5); keystroke compatibility; a general-purpose theorem prover. When the system cannot find a closed form it says so with an error. It never returns a wrong answer silently.

Two framings keep the scope honest. First, a CAS is open-ended: "supported" means **a documented rule set with test vectors** (§7), not "everything a textbook can do". Second, Stage A already delivers the user-visible capability; Stage B is about making it pleasant (literals, one `+` for everything) and robust (budgets), and is gated on evidence (§8).

---

## 2. Gap analysis

| HP 48 feature | FL v0.1 today | Gap |
|---|---|---|
| Algebraic objects | Nine tags (`bytes str int num bool list quot record file`, LANGUAGE §3.1; `Value` in `packages/lang/src/types.ts`). | No expression tag. Expressions can be encoded as `record`/`list` trees (Stage A) or get a registered tag (B1). |
| Names as values (an unbound name evaluates to itself) | Names are compile-time words; an unknown name is `E_UNDEFINED` (§6.2 step 5) and there are no forward references (D6). A name is never a runtime value. | Symbols must be created explicitly (`"x" sym:var`) or parsed from text. A literal syntax needs a reader change (B3). |
| Generic commands (`+` on numbers, expressions, units, arrays) | No overloading. Core `+` is `( number number -- number )` and a non-number is `E_TYPE` (§13.2). Only `len cat = bxor` and similar check tags themselves behind `any` (§4.1, D39). | Stage A shadows `+` in a vocabulary (§3.5). Real runtime dispatch is B2. |
| `EVAL`, `→NUM`, `|`, `STO`, `RCL` | `VARIABLE` is per-run with a fixed tag (D31, §5.10), there is no eval of data by design (PLAN §5), and quotations are compiled code, not data. | Replaced by `eval`/`>num`/`where` taking an **environment record**. No `STO`/`RCL`: use `put`/`get` on records. |
| Exact vs approximate mode, complex numbers | `int` is exact bigint, `num` is a float. `/` always gives `num` (D29). `sqrt` of a negative number is `E_RANGE` (§13.2). No rational, no complex. | Rational and complex leaves (Stage A as records, B4 as registered types), exact `sym:/`. |
| The `'…'` expression literal | `'` starts a char literal (§2.3 rule 4, §2.7). | Needs a different delimiter (B3). |
| CAS commands (collect, expand, derivative, integral, solve, series, sum, rewrite) | None. | The bulk of the work (§3.4). |
| Unit objects | None. | A units table, a unit-carrying value, dimension checking (§3.8). |
| Long-running commands that can be interrupted | A primitive is one synchronous call. The VM polls abort and the deadline between instructions only, so a long primitive cannot be pre-empted; the Worker host terminates the Worker instead (LANGUAGE §10.7, §10.8; RECIPES R14). The regex primitives have the same caveat (LANGUAGE §5.5, RECIPES R11). | CAS work is unbounded in the worst case (expansion blow-up, rule loops). Needs internal budgets and cooperative yielding in Stage A (§3.7) and step accounting in B5. |

---

## 3. Stage A: library only, no language change

Stage A adds vocabularies to `packages/ops` and changes nothing in `packages/lang`, `packages/recipe` or `packages/worker`. It ships real, tested functionality, and it is also the experiment that decides whether Stage B is worth doing.

### 3.1 Vocabularies and where the code lives

| Vocabulary | Level | Catalogue | Contents |
|---|---|---|---|
| `sym` | value | no (S6) | construction, parse/print, canonical form, generic arithmetic and functions |
| `sym-num` | value | no | `rat`, `cplx`, `eval`, `>num`, `where`, `define` |
| `sym-alg` | value | no | `simplify`, `collect`, `expand`, `zero?` |
| `sym-calc` | value | no | `deriv`, `taylor`, `sum` |
| `sym-int` | value | no | `integrate`, `integrate-def`, `integrate-num` |
| `sym-solve` | value | no | `isolate`, `solve-quad`, `solve-poly`, `roots`, `root` |
| `sym-rules` | value | no | `rule`, `match`, `rewrite-down`, `rewrite-up`, `rewrite` |
| `sym-units` | value | no | `parse`, `convert`, `base`, `value`, `unit` |
| `algebra` | recipe | yes | text-in, text-out ops over the above (§3.6) |
| `units` | recipe | yes | `convert`, `base` as text ops |

The split into several `sym-*` vocabularies follows how `packages/ops` is built, not taste: the bundle loader maps one `.fth` unit to one vocabulary and loads one primitive module per vocabulary, `prims/<vocab>.ts`, which must export a `primitives` array whose entries all name that vocabulary (`packages/ops/src/bundle.ts`). One file per vocabulary also gives parallel work packages disjoint file sets (§8). A user pulls in what is needed: `USING: sym sym-calc`.

Value-level words take and return expression values (§3.2). Recipe-level words take and return `str`. The split exists because the catalogue rule (RECIPES §2.2) checks only the **parameters** (inputs after the first) against `UI_PARAM_TYPES`, never the data input or the output type: a unary word such as `sym-alg:simplify ( any -- any )` has no parameters and would be listed as an op whose data input a recipe cannot supply (a recipe feeds `bytes`, and there is no `bytes` to expression coercion). Marking the value-level vocabularies internal removes them from the catalogue and from recipes (refused as unknown ops, as for `util`), while leaving them fully usable at the FL console and in user vocabularies. The words with an `any` parameter (the generic operators) are excluded by rule 4 anyway.

Files, following the existing layout (`packages/ops/vocab/<name>.fth` with `<name>.test.json`, primitives in `packages/ops/src/prims/<name>.ts`):

```
packages/ops/src/sym/        pure TypeScript engine, no @forge/lang import except Value helpers
  types.ts expr.ts numeric.ts canon.ts parse.ts print.ts budget.ts
  eval.ts simplify.ts calc.ts integrate.ts solve.ts rules.ts units.ts pretty.ts
packages/ops/src/prims/sym.ts, sym-num.ts, sym-calc.ts, ...   thin wrappers (Value <-> engine)
packages/ops/vocab/sym.fth, sym-num.fth, ... algebra.fth, units.fth   headers, docs, FL wrappers
```

The engine is loaded lazily with the other primitive modules (the core plus UI shell stays under the 250 kB gzip budget, PLAN §6).

### 3.2 Representation

An **expression** is an `int`, a `num`, or a `record` node. In headers the type is therefore `any` (a `number | record` union cannot be written in the header grammar, LANGUAGE §5.4). Nodes are plain `record` values with a `"sym"` key naming the node kind. They are immutable, structurally comparable with core `=` (record equality ignores key order, §3.1), and metered by the existing size rules (§10.8: 16 bytes per record entry plus keys and values, 8 per list element). A node costs roughly 100 bytes in that meter.

| Node | Shape (JSON notation) | Canonical constraints |
|---|---|---|
| number | a bare `int` or `num` value | `num` finite (as everywhere in FL) |
| variable | `{"sym":"var","name":"x"}` | name is `[A-Za-z_\p{L}][A-Za-z0-9_\p{L}]*`, at most 64 code points |
| constant | `{"sym":"const","name":"pi"}` | `name` in `pi`, `e` |
| rational | `{"sym":"rat","n":int,"d":int}` | `d >= 2`, `gcd(n,d) = 1`; `d = 1` collapses to an `int` |
| complex | `{"sym":"cplx","re":X,"im":Y}` | `X`, `Y` each `int`, `num` or `rat`; `im = 0` collapses to `re`; either part `num` makes both `num` |
| sum | `{"sym":"add","args":[…]}` | at least 2 args, flattened, sorted, at most one numeric arg (first) |
| product | `{"sym":"mul","args":[…]}` | as `add`; the numeric arg is the coefficient |
| power | `{"sym":"pow","args":[base,exp]}` | exactly 2 args |
| function | `{"sym":"fn","name":"sin","args":[…]}` | name from the built-in table (below) or an environment lambda |
| equation | `{"sym":"eq","args":[lhs,rhs]}` | exactly 2 args |
| quantity | `{"sym":"qty","value":X,"unit":{"m":1,"s":-2}}` | `X` is a real number leaf; `unit` is a record of unit symbol to non-zero `int` exponent, keys sorted by code point (§3.8) |
| lambda | `{"sym":"lambda","params":{"x","y"},"body":E}` | only as an environment value; `params` is a `list` of `str` |

Subtraction, division and negation are not nodes: `a-b` is `add[a, mul[-1,b]]`, `a/b` is `mul[a, pow[b,-1]]`. Built-in function names (the `fn` table): `sin cos tan asin acos atan sinh cosh tanh exp ln sqrt abs`, plus the unevaluated forms `d` (derivative), `int` (integral), `sum`. Evaluation performs an unevaluated form, as the 48's evaluate does for its derivative and integral objects. Angles are in radians (S14).

**Canonical form C1.** Every word in the `sym` family returns canonical nodes, and every constructor canonicalises, so that core `=` on two canonical values means "identical expression", cheaply and without a word. Rules, applied bottom-up:

1. Flatten nested `add` in `add` and `mul` in `mul`.
2. Fold the numeric arguments into one number (int/rat/cplx exact; any `num` makes the result `num`), placed first. Drop the identity (0 in `add`, 1 in `mul`). A `mul` with an exact 0 coefficient becomes 0.
3. Sort the remaining arguments by one total order: rank (numbers, then `cplx`, `const`, `var`, `qty`, then `pow`/`fn`/`mul`/`add`/`eq` by node kind), then names by code point order (LANGUAGE §3.1, D30), then arguments lexicographically by the same order.
4. A one-argument `add`/`mul` becomes the argument; an empty one becomes the identity.
5. `pow(a,1)` is `a`; `pow(a,0)` is 1 (`0^0` is `E_RANGE`); a `pow` of two exact numbers folds when the result is an integer or rational within the size limits; otherwise it stays a node.

C1 deliberately does **not** collect like terms (`x+x` stays two arguments) or apply identities such as `sin(x)^2+cos(x)^2`. Those are `collect` and `simplify`. So `=` is syntactic equality of canonical forms, and `sym-alg:zero?` (simplify, then test for 0; `true` is a proof, `false` is "not shown zero") is the semantic test. The printer is a function of the canonical form (`add` terms print by descending degree, constant last), so `x^2+3*x` prints identically however it was built.

**Boundary.** Words convert a `Value` to the engine's internal tree (hash-consed, with the node count capped, §6) at entry and back at exit, with iterative walkers, as `equals` and `sizeOf` in `values.ts` do. Hand-built records that violate C1 are accepted at entry and canonicalised, except for malformed shapes, which are `E_TYPE` with `detail.path`.

**Text syntax** (the parameter and output format of recipe ops, and `sym:parse`/`sym:>str`):

```
expr  = sum ;  sum = term { ("+" | "-") term } ;  term = factor { ("*" | "/") factor } ;
factor = unary [ "^" factor ] ;  unary = [ "-" ] atom ;     (* ^ is right-associative, binds tighter than unary minus *)
atom  = number | name | name "(" [ expr { "," expr } ] ")" | "(" expr ")" | number "[" unit "]" ;
eq    = expr "=" expr ;   where = expr "|" binding { "," binding } ;   binding = name "=" expr
```

Implicit multiplication is not accepted (`2x` is a parse error with a position), to keep the grammar unambiguous. A decimal literal is a `num`; `1/2` is `div` of two ints, which canonicalises to the rational. `i`, `pi` and `e` are reserved names. Printing emits the minimum parentheses for that grammar, `*` for every product, no spaces, and `[unit]` suffixes for quantities.

### 3.3 Example

```forth
USING: sym sym-calc
"x" var dup 2 pow swap 3 * +        \ x^2+3*x, built with the shadowed pow, * and +
"x" sym-calc:deriv >str .           \ 2*x+3
```

`var`, `pow`, `*`, `+` and `>str` resolve to `sym` because imports are searched before `core` (§6.2), `deriv` is qualified for clarity. `.` prints a `str` raw (§3.3), so the output is the infix text.

### 3.4 Word list

Stack effects use the FL header grammar (LANGUAGE §5.4): a bare first item is the data input, further inputs are named with a type, every public word is strict. An expression is written `any` (§3.2). Words are listed by the vocabulary that owns them (§3.1); the generic operators live in `sym`.

| Word | Effect | Notes |
|---|---|---|
| `sym:parse` | `( str -- any )` | text to canonical expression; `E_COERCE` with position on a syntax error |
| `sym:>str` | `( any -- str )` | infix text, deterministic; the inverse of `parse` on canonical forms |
| `sym:var` | `( str -- any )` | a variable node; `E_PARAM_INVALID` on a bad name |
| `sym-num:rat` | `( int d:int -- any )` | exact rational, normalised; `d = 0` is `E_DIV_ZERO` |
| `sym-num:cplx` | `( any im:any -- any )` | complex number from two real leaves |
| `sym:expr?` | `( any -- bool )` | is this a well-formed expression value |
| `sym:canon` | `( any -- any )` | canonicalise a hand-built tree |
| `sym:eq` | `( any rhs:any -- any )` | equation node (`=` is core's boolean equality) |
| `sym:+` `sym:-` `sym:*` `sym:/` `sym:pow` | `( any b:any -- any )` | generic arithmetic (§3.5) |
| `sym:neg` `sym:abs` `sym:sqrt` | `( any -- any )` | generic; `sqrt` of a negative exact number gives a complex result |
| `sym:sin` … `sym:ln` | `( any -- any )` | function nodes; exact values fold (`sin(0)`, `ln(1)`), others stay symbolic |
| `sym-num:eval` | `( any env:record -- any )` | substitute environment bindings and evaluate **exactly**; unbound names stay symbolic; expands lambdas, `d`, `int`, `sum` |
| `sym-num:>num` | `( any env:record -- any )` | like `eval`, then approximate: every exact number becomes `num`; a still-symbolic result stays an expression with float coefficients |
| `sym-num:where` | `( any env:record -- any )` | pure substitution, then C1 only (no evaluation) |
| `sym-alg:simplify` | `( any -- any )` | rule-driven simplification with a fixed rule set (§3.9) |
| `sym-alg:collect` | `( any -- any )` | combine like terms and like factors (`x+x` → `2*x`, `x*x` → `x^2`) |
| `sym-alg:expand` | `( any -- any )` | distribute products and positive integer powers over sums; term count is predicted first (§6) |
| `sym-alg:zero?` | `( any -- bool )` | simplify then test for 0 |
| `sym-num:define` | `( record name:str params:list body:any -- record )` | returns a new environment with a lambda bound; cannot redefine a built-in function name (`E_RANGE`) |
| `sym-calc:deriv` | `( any var:str -- any )` | symbolic derivative; unknown functions stay as `d(f(x),x)` |
| `sym-int:integrate` | `( any var:str -- any )` | antiderivative (no constant); `E_RANGE` ("no closed form found") when the table and rules fail |
| `sym-int:integrate-def` | `( any var:str lo:any hi:any -- any )` | exact definite integral through the antiderivative; falls back to `integrate-num` only if both limits are numeric, with an `num` result |
| `sym-int:integrate-num` | `( any var:str lo:num hi:num -- num )` | adaptive Gauss–Kronrod (G7/K15), bounded evaluations, absolute and relative tolerance `1e-10` |
| `sym-calc:taylor` | `( any var:str at:any order:int[0..64] -- any )` | Taylor polynomial about a point, exact coefficients when `at` and the derivatives are exact |
| `sym-calc:sum` | `( any var:str lo:any hi:any -- any )` | closed forms for polynomial and geometric bodies with symbolic bounds, direct addition for small numeric ranges |
| `sym-solve:isolate` | `( any var:str -- list )` | solve a single equation for a variable by inverting the operations on its path; a list of `eq` solutions; `E_RANGE` if the variable occurs on both sides in a way it cannot separate |
| `sym-solve:solve-quad` | `( any var:str -- list )` | exact roots of a degree ≤ 2 polynomial (radicals and complex numbers allowed) |
| `sym-solve:solve-poly` | `( any var:str -- list )` | exact rational roots by the rational-root theorem, deflation, then `solve-quad` on the remainder; non-solvable remainders are returned as a `fn` node `roots(poly,var)` |
| `sym-solve:roots` | `( any var:str -- list )` | all complex roots of a polynomial of degree ≤ 64, numerically (Durand–Kerner), as `num`-valued `cplx` |
| `sym-solve:root` | `( any var:str guess:num -- num )` | numeric root near a guess (Newton with a bisection safeguard); `E_RANGE` if it does not converge within the iteration cap |
| `sym-rules:rule` | `( str -- record )` | parse a rewrite rule (§3.10) |
| `sym-rules:match` | `( any pattern:any -- list )` | all bindings (records) that make the pattern equal the expression, up to the cap |
| `sym-rules:rewrite-down` `rewrite-up` | `( any rules:list -- any )` | one pass, pre-order or post-order |
| `sym-rules:rewrite` | `( any rules:list -- any )` | repeat until no rule fires or the iteration cap |
| `sym-units:parse` | `( str -- any )` | `"3[km/h]"` to a quantity |
| `sym-units:convert` | `( any to:str -- any )` | convert to a unit expression of the same dimension; `E_TYPE` with `detail.dimension` otherwise |
| `sym-units:base` | `( any -- any )` | reduce to base units (m, kg, s, A, K, mol, cd) |
| `sym-units:value` `unit` | `( any -- any )` `( any -- str )` | the number and the unit text |

An example of a user function with the environment passed explicitly (`f(x) = x^2+1`, then `f(3)`):

```forth
USING: sym sym-num
{ } >record "f" { "x" } "x^2+1" sym:parse sym-num:define   \ an environment holding f
"f(3)" sym:parse swap sym-num:eval sym:>str .              \ 10
```

The environment record is an ordinary value; a quotation can close over it (`[ env sym-num:eval ] map` over a list of expressions) because a quotation captures its frame's locals (LANGUAGE §8, `Quotation` in `types.ts`).

### 3.5 Generic arithmetic by shadowing

`USING: sym` makes `+ - * / pow neg abs sqrt` (and `sin`, `ln`, …, which core lacks) resolve to the `sym` versions. Resolution is lexical per source unit: current vocabulary, then **all imports together, then `core`** (LANGUAGE §6.2 steps 2, 3, 4). Because step 3 comes before step 4, an import that defines `+` beats core's `+` with no language change, and a scope that does not import `sym` is untouched. Each `sym` operator is a small FL word `( any b:any -- any )` that does the following:

- both operands plain `int`/`num`: call `core:+` (resp. `core:-`, …). Overflow to bigint, `E_LIMIT_VALUE`, finiteness and the error codes are then exactly core's;
- any operand is an expression, rational, complex or quantity: call a private primitive that builds the canonical node (C1 only, no simplification);
- `sym:/` on two `int` is the exact rational (S10), unlike core's float `/` (D29); `int` with `num` falls through to core.

Inside `IN: sym` the current vocabulary shadows imports and core (step 2), so the vocabulary's own source uses `core:+` explicitly.

**Limits of this approach.**

- It is opt-in per scope. Every `+` in a scope that imports `sym` pays the wrapper's cost (a few steps) and returns `sym` semantics, including `sym:/` being exact. Words in other vocabularies were compiled against core and still reject expressions (`E_TYPE` at the word boundary, §4.1), which is correct but means the library cannot be used inside, say, `analysis:` words.
- Two imports that both define a name are `E_AMBIGUOUS` (§6.2 step 3). `USING: sym matrix` would fail as soon as a later `matrix` vocabulary also defines `+`; the fix is qualified names or one combined vocabulary. This is the one real argument for B2.
- Expressions print with `.` and `.s` as `record{ "sym": "add" … }` (§3.3): use `sym:>str`. The header type is `any` (or `record` for words that need a node), so help and `see` cannot say "expression".
- The catalogue and UI cannot offer an expression input type; a parameter is a `str` (§3.6).
- Core `=` works (structural), `<` does not (`E_TYPE`); there is no ordering of expressions in Stage A.

### 3.6 Recipe and catalogue exposure

The `algebra` and `units` vocabularies hold ops of type `( str … -- str )`: the op parses its input, runs the engine and prints the result. They are ordinary catalogue ops (`doc` and `category` required, RECIPES §2.4), they take a `bytes` recipe value through the strict `bytes` to `str` coercion (LANGUAGE §4.2), and their vectors use the existing `vocab/<name>.test.json` form. Expression-valued parameters are `str` parameters (for example a list of `name=value` bindings), which the existing parameter form, JSON encoding (RECIPES §3.4) and share URL already carry.

| Op | Effect | Category |
|---|---|---|
| `algebra:simplify` `collect` `expand` | `( str -- str )` | Algebra |
| `algebra:eval` | `( str env:str="" mode:choice{exact\|approx}=exact -- str )` | Algebra |
| `algebra:where` | `( str bindings:str -- str )` | Algebra |
| `algebra:deriv` | `( str var:str="x" -- str )` | Calculus |
| `algebra:integrate` | `( str var:str="x" -- str )` | Calculus |
| `algebra:integrate-def` | `( str var:str="x" lo:str hi:str -- str )` | Calculus |
| `algebra:integrate-num` | `( str var:str="x" lo:num hi:num -- str )` | Calculus |
| `algebra:taylor` | `( str var:str="x" at:str="0" order:int[0..64]=5 -- str )` | Calculus |
| `algebra:sum` | `( str var:str lo:str hi:str -- str )` | Calculus |
| `algebra:isolate` | `( str var:str="x" -- str )` | Solving |
| `algebra:solve-poly` `roots` | `( str var:str="x" -- str )` | Solving |
| `algebra:root` | `( str var:str="x" guess:num=1 -- str )` | Solving |
| `algebra:rewrite` | `( str rules:str mode:choice{down\|up\|fixed}=fixed -- str )` | Algebra |
| `algebra:pretty` | `( str width:int[20..200]=80 -- str )` | Algebra |
| `units:convert` | `( str to:str -- str )` | Units |
| `units:base` | `( str -- str )` | Units |

Solution lists print one `x=…` per line. `mode` is an explicit parameter, never a global flag (S10), so a shared recipe means the same thing everywhere. A `mode:approx` result is printed with up to 15 significant digits.

### 3.7 Implementation

**Hand-written, in-repo TypeScript engine (S7).** This follows PLAN §1 ("Independent implementation") and the project's habit of writing small algorithms from the standard description (`sha256.ts` from FIPS 180-4; regex engine seam). The reasons not to take an npm CAS: the `packages/ops` runtime dependencies are only `@noble/*` (`packages/ops/package.json`), the bundle budget (PLAN §6), the CSP (no eval; some CAS libraries compile expressions with `new Function`, UI.md §4 rule 5), and the need to control budgets and exact output text. The cost is real: a CAS is a large surface with subtle bugs, which is why the scope is a documented rule set with vectors, and why the dependency choice stays an open question (§9, Q1).

**Deviation from "FL first" (PLAN §3.5, §9 item 9).** FL cannot express this: one step is a dispatched instruction, FL has no mutual recursion (D6), immutable aggregate values (§3.1), a return stack of 10 000 frames, and about a million steps cost a 64 KiB checksum; a simplifier in FL would be orders of magnitude slower and could not be bounded. The primitives are therefore the algorithms, not "a minimal private helper". The house pattern is kept where it can be: public words carry their header, `doc`, `category` and `see-also` in `.fth` (`PRIMITIVE` binds a registered primitive, §5.11), and the generic operators' fall-through to core is FL. The deviation is recorded as S7.

**Budgets and cooperative yielding (S8).** Every engine entry point takes a `Budget`: a tick counter charged per node visited, per rule application and per big-number operation, with default ticks `min(2 000 000, ctx.limits.maxSteps)` (the `PrimitiveContext` carries `limits`, `signal`, `scope` and nothing else, `types.ts`). Exhaustion raises `E_LIMIT_STEPS` with `detail.where = "sym"`, which is uncatchable like every `E_LIMIT_*` (D19). The engine primitives are **asynchronous** and yield to the event loop (a macrotask) every 50 000 ticks and observe `ctx.signal`; an async primitive is an existing, supported mechanism (LANGUAGE §10.7: the VM awaits it racing abort and deadline, and cooperative primitives SHOULD observe `ctx.signal`), and they are labelled `+async` (§10.10). Ticks do not count against the VM's `maxSteps`: that accounting is B5. The Worker watchdog (RECIPES R14) remains the backstop for a bug or a pathological single tick, and needs no change.

### 3.8 Numeric tower and units (in the library)

- **Exact by default.** `int` is exact (bigint, bounded by `maxIntBits`, 16 384 in untrusted bakes, `UNTRUSTED_LIMITS`). `rat` and `cplx` leaves are normalised as in §3.2. A `num` in any operand makes the result `num` (float contagion, as core already does for int with num, §3.2). `sym-num:>num` and `mode:approx` turn exact values into `num`; there is no global flag (S10).
- **Complex.** Exact complex arithmetic over int and rat parts; `sqrt` of a negative exact number gives `i*sqrt(|n|)`-style results; functions use the principal branch, documented per function; `ln` and `pow` with a complex or negative-base argument need an explicit branch-cut table (open question Q5).
- **Units.** A table of SI base and derived units, SI prefixes, and common non-SI units with exact conversion factors (from the SI brochure and NIST exact definitions; written by hand, no table copied from another calculator). A quantity is `qty` (§3.2): the value is kept in the unit the user wrote, `unit` is the exponent record. `+`/`-` require equal dimensions (the right operand converts to the left's unit); `*`/`/`/`pow` combine exponents; `convert` and `base` change unit. A mismatch is `E_TYPE` with `detail.dimension` (no new error code in Stage A). Affine units (degC, degF) are accepted only by `convert`; arithmetic on them is `E_TYPE` (S12), which avoids the 48's ambiguities with offset units. Dimensionless results collapse to plain numbers.

### 3.9 Simplify, collect, expand

`collect`, `expand` and `simplify` are separate words with fixed, documented behaviour so that vectors can pin them.

- `collect`: combine terms with equal non-numeric parts (`2*x+3*x` → `5*x`), merge equal bases in products (`x*x^2` → `x^3`).
- `expand`: distribute `mul` over `add`, expand `pow(add, n)` for integer `1 <= n <= 64` after a term-count prediction, expand `pow` of products, `(a+b)^2`-style identities by the same mechanism.
- `simplify`: repeat to a fixed point (iteration cap in §6) a **fixed rule list**: `collect`, numeric folding, `x^a*x^b`, `(x^a)^b` for integer `b`, `sin^2+cos^2 = 1`, `exp(ln x) = x` and `ln(exp x) = x` for real `x` documented as such, `sqrt(x^2) = abs(x)`, trivial inverse-function pairs, cancellation of common factors in a quotient of polynomials by polynomial gcd. The list lives in one data table in `simplify.ts` and is the same list `simplify` documents in its `doc`. No heuristics beyond the list; the result is not guaranteed minimal.

### 3.10 Rewrite rules

A rule is `{"sym":"rule","lhs":E,"rhs":E,"cond":E}` (`cond` optional). Text form: `?a*?x+?a*?y -> ?a*(?x+?y) if num?(?a)`. A name starting with `?` is a **pattern variable** (a wildcard that matches any subexpression and, within one rule, must match the same subexpression each time it occurs). Matching works on canonical forms and is modulo the commutativity and associativity that C1 already encodes: `add`/`mul` match by choosing a sub-multiset of their arguments, with backtracking limited by the budget. Conditions are a closed set of predicates, evaluated by the engine, never by FL code: `num?`, `int?`, `rat?`, `const?`, `free(e,x)` (e does not contain x), `neq(a,b)`, `lt(a,b)` and `gt(a,b)` on numeric operands, joined by `and`, `or`, `not`. There are no user-supplied predicates (no code from data, PLAN §5). `rewrite-down` visits nodes pre-order and applies the first matching rule once per node; `rewrite-up` post-order; `rewrite` repeats a full pass until the canonical form stops changing, with an iteration cap and a seen-form set so that a cycle is reported instead of looping (§6).

---

## 4. Stage B: language changes (FL v0.2)

Everything here changes frozen contracts. Each item gives motivation, spec sections touched, code touched, compatibility and the decision ID. Stage B starts only at the gate in §8, with an owner-approved version bump and a LANGUAGE.md v0.2 that supersedes the touched sections.

### B1. Extension value tags (S15)

**Motivation.** Records-as-expressions work but print badly, cannot be typed in headers, cannot have their own equality, size or text form, and are indistinguishable from other records. The same gap hits rational, complex, quantity and matrix. Preferred over hard-coding a `sym` tag: one mechanism, registered by a vocabulary, serves all five.

**Design.** One new core tag `ext`: `{ tag: "ext", kind: string, v: unknown }`, where `kind` names a type registered through `RuntimeOptions` (like primitives; never by FL code, so untrusted code cannot invent one). A registration supplies:

| Field | Purpose |
|---|---|
| `name` | the `kind`, a `vocab-name` |
| `equals(a, b)`, `hash`-stable canonical form | `=` (§3.1) |
| `display(v)`, `repr(v)` | `.`, `.s`, nested printing (§3.3); for `sym` the infix text |
| `sizeOf(v)` | §10.8 meters (the VM calls it where it calls `sizeOf` in `values.ts`) |
| `coerceFrom: { int?, num? }` | optional coercions into the type, recorded in `RunResult.coercions` |
| `toText(v)`, `fromText(s)` | the single text form used for recipe JSON params, share URLs, vector JSON (`$ext`) and UI input; `fromText` is the parser and is pure |
| `limits` | max nodes and depth, validated at construction |

**Spec touched.** LANGUAGE §3.1 (tag table, tenth row), §3.3 (printing), §4.2 (a column and row for `ext`), §5.4/§5.6 (header: `ptype = … | "ext" "{" name "}"`, parallel to `choice{…}`, so that `parseHeader` stays pure and context-free, §5.8), §10.8 (size), §12.1 and `meta.schema.json` (`paramType` enum gets `"ext"`, with `options: [name]` reusing the existing `options` array).

**Code touched.** `packages/lang/src/types.ts` (`Value` union, `Tag`, `ParamType`), `values.ts` (`equals`, `repr`, `display`, `sizeOf`, `coerceTracked`, `runtimeTypeOf`; these are exhaustive `switch`es on `tag`), `meta.ts`/`meta.schema.json`, `vm.ts` and `primitives.ts` (plain-JS conversion, §4.4: an `ext{sym}` slot passes the payload), `packages/worker/src/render.ts` (today any unknown tag falls to the `other` branch with `reprShort`, which already works as a text rendering; a dedicated `text` kind is optional), `packages/worker/src/protocol.ts` (no change: values never cross the protocol, only `OutputValue`), `packages/ops/src/types.ts` (`UI_PARAM_TYPES` gains `ext`), `catalogue.ts` and the recipe parameter encoder (an `ext` parameter is its `toText` string).

**Compatibility.** Additive: no existing program, recipe or hash changes. A `Value` consumer with an exhaustive `switch` fails typecheck until updated, which is the desired reminder. Word hashes (§12.4) are unaffected for existing words.

### B2. Generic words (runtime dispatch) (S16)

**Motivation.** Remove the opt-in-per-scope and `E_AMBIGUOUS` limits of §3.5, and let one `+` serve numbers, expressions, rationals, matrices and quantities in every vocabulary.

**Conflicts to resolve.**

- *D5 early binding* (§6.2, §6.5): a call binds one `WordEntry` at compile time. If methods can be added later, an old caller changes meaning without recompiling. Also one metadata record per word (PLAN §1) and the hash (§12.4) assume a word's identity is fixed by its text and callees.
- *Catalogue and UI forms*: a form needs one parameter list.
- *Error precedence*: §4.3 reports coercion errors before constraints, deepest slot first.

**Recommended: closed method tables resolved at call time.** A generic word is declared once with a union header and a method table that is **frozen when its source unit commits**:

```forth
GENERIC: + ( a:any b:any -- any )          \ declares the generic and its dispatch arity (2)
METHOD: + ( number number -- number ) … ;  \ ordinary bodies with their own headers, same unit
METHOD: + ( ext{sym} any -- ext{sym} ) … ;
```

- A call still binds one `WordEntry` at compile time (D5 unchanged). At run time the entry selects a method by the tags (and `ext` kinds) of its top `n` inputs, where `n` is the dispatch arity. Specificity: exact tag, then `number`/`ext`, then `any`; the most specific wins. Two equally specific methods are a **compile error** at definition (`E_AMBIGUOUS`, with the candidates), never a call-time surprise. No match is `E_TYPE` listing the candidate headers in `detail.candidates`.
- *Extension without drift.* A later unit cannot add to an existing table. It defines a new generic that declares `EXTENDS: core:+` and adds methods; only code compiled afterwards sees it, exactly like redefinition (D5). So `USING: matrix` still shadows (and the `E_AMBIGUOUS` rule between two imports still applies), but the new `+` includes core's methods and needs no wrapper.
- *Metadata and hash.* The generic's `WordMeta` has the union `effect` and a new `methods` array (`{qname, effect, hash}`); its hash covers its own text plus the sorted method hashes (extending §12.4's "callees" rule). Catalogue: a generic is an op only if all methods agree on parameter types; the data input follows method 0.
- *Cost.* Dispatch on already-popped tags is one table lookup in the `call` path of the VM (§10.5 entry sequence); input coercion (§4.2) applies per selected method, after selection. `core` arithmetic could become `GENERIC` with its current behaviour as the `number` method (compatible), or stay as is and be shadowed.

**Alternative: `any` plus registered handlers.** Core `+ - * /` change their header to `( any any -- any )` (like `=` and `len`, §4.1) and delegate to numeric-tower handlers registered with the `ext` types: if both are `int`/`num`, do what they do now; else look up a handler by the tag pair. No new syntax and no metadata change; costs: the header loses `number`, so `help` and the UI lose type information for core arithmetic and `E_TYPE` moves from the call boundary into the primitive, and the handler set is global per runtime (a hash cannot see it), which weakens pinning.

**Recommendation.** Do B2 only if the gate finds the `E_AMBIGUOUS` and wrapper-cost limits actually hurt (Q3). If so, prefer the closed method tables; take the alternative only if the owner wants no new defining forms. Touched: LANGUAGE §5.1–5.3 (forms), §6.2, §10.5, §12; `compiler.ts`, `dictionary.ts`, `vm.ts`, `meta.ts`.

### B3. Literal syntax (S17)

`'` is taken (§2.7). Proposed: a **tagged string literal**, `sym" x^2+1 "`. The token `sym"` (a `vocab-name` directly followed by `"`) is today an `E_LEX` ("any other use of `"` inside a token", §2.3), so the syntax space is free and no existing valid program changes. The body follows the string rules of §2.6 (escapes, closing `"`, whitespace after). The reader (a pure function that never looks at the dictionary, §2.13) emits a token `tstr { tag, value }`; the **compiler** looks up a literal parser registered for `tag` (host-registered like an `ext` type, therefore consistent with D8: no user-defined parsing from FL), runs it at compile time, and emits a `lit` of the result. A parse failure is `E_SYNTAX` at the position of the string start plus the parser's offset, so the editor underlines the right character. Alternative `$( … )` was rejected: the closing `)` clashes with nested parentheses in expressions. Touched: §2.3 (rule 3a), §2.12 (token kind), `reader.ts`, `compiler.ts`.

### B4. Numeric tower and modes (S18)

Rational and complex numbers become `ext` types (`rat`, `cplx`) shipped in `@forge/ops`, not core tags; the core stays at nine tags plus `ext`, and `int`/`num` keep their rules (§3.2). Exact division is a separate word (`sym:/` or a core `//`, decided at the gate), not a change to `/` (D29 stands). The exact/approximate and angle settings are **recipe options** carried in the recipe JSON and the share URL and exposed to primitives through `PrimitiveContext`, never as mutable global flags: a flag stored in the runtime would make a shared recipe depend on the viewer's state. Until B4, the explicit `mode` parameter of §3.6 does the same job. Touched: `PrimitiveContext` and `RunOptions` in `types.ts`, `packages/recipe` schema (an `options` addition, an additive change under a version bump), `runtime.ts`.

### B5. Budgeted and interruptible primitives (S19)

Stage A's async yielding makes CAS interruptible and gives it a private budget (§3.7). B5 makes it part of the VM's accounting: `PrimitiveContext` gains `charge(n: number): void`, which adds `n` to the VM's step counter (so `maxSteps` bounds CAS work deterministically and traces show it), polls the abort flag and the deadline every 1024 charged units, and throws `E_LIMIT_STEPS`, `E_ABORTED` or `E_LIMIT_TIME` from inside the primitive. The synchronous caveat of §10.7 then no longer applies to primitives that call `charge`. Touched: LANGUAGE §10.5, §10.7, §10.8; `vm.ts`, `primitives.ts`, `types.ts`. Alternative: keep async yielding only. B5 is justified if step-count determinism matters (test vectors that must fail the same way in Node and in a Worker).

### Not needed (explicitly)

- **Directories and a global variable store.** Environments are `record` values passed to `eval`, `where`, `define`; `put` and `get` already edit them (§13.4). FL `VARIABLE` stays as is.
- **Converting an expression to a `quot`.** Use `[ env sym-num:eval ]`, a quotation that closes over `env`. An expression never becomes compiled code.
- **Runtime evaluation of FL source** (an `eval` word). Not added; PLAN §5 forbids it, and the engine evaluates its own tree.
- **User-defined parsing words** (D8). Literal parsers are host-registered.

---

## 5. UI and recipes

- **Input.** Stage A: a `str` parameter, shown as the existing single-line text field; parse errors from `algebra:*` ops are `E_COERCE` with the offending offset in the message, which the existing error panel shows. Stage B (S15, S17): an `ext{sym}` parameter type shows the same field with live validation through `fromText`, and a literal `sym" … "` in the FL console and in the recipe's text form.
- **Output.** Results are `str`, rendered as text. The strict CSP (UI.md §4) is already satisfied: no HTML, no `innerHTML`, no Markdown from computed text (rule 6), no inline style, no external font. A numeric result (an `integrate-num` value) is printed as text too (§3.6).
- **Pretty printing.** `algebra:pretty` returns plain text with fraction bars, raised exponents on a separate line and sqrt signs made of ASCII or Unicode box characters, cut to a width parameter. It is output only; it is not parsed back. Whether monospace is guaranteed for the output pane is checked against UI.md during S.9.
- **MathML** (open question Q2). Building MathML with `createElementNS` from the parsed tree is CSP-compatible in principle (no `innerHTML`, no style), but it conflicts with the "rendered as text" rule in UI.md §4, adds a rendering path to test, and needs accessibility work. Not in this design; revisit after Stage A feedback.
- **Share URLs.** Parameters are text, so the existing `#v=1&r=…&i=…` codec carries them unchanged (RECIPES §7). The input expression travels like any input. Nothing here is a `key` parameter, so the UI.md §4 rule 12 notice is not newly relevant, but the size cap on a fragment applies.
- **Graphing.** Out of scope; if added later it is a UI feature over `integrate-num`/`eval` with `mode:approx`, drawing to a canvas (`img-src blob:` is allowed, `script-src 'self'` unaffected).

---

## 6. Security and limits

Recipes and shared URLs are untrusted (PLAN §1, §5), and a CAS is the classic source of exponential blow-up. Every limit below is a named constant in `packages/ops/src/sym/types.ts`, can only be tightened by a caller, and is smaller for untrusted bakes.

| Threat | Mitigation | Error |
|---|---|---|
| Huge input text | text parsed from a `str` or parameter is capped at 64 KiB | `E_LIMIT_VALUE` |
| Huge or deep tree | at most 20 000 nodes (10 000 untrusted) and depth 500; parse, print, canon and every pass are **iterative** with an explicit work stack (the style of `equals` and `sizeOf` in `values.ts`), so no recursion limit is reachable | `E_LIMIT_VALUE` |
| Expansion blow-up, `(x+1)^500`, `(a+b+c)^50` | `expand` computes the number of terms first (binomial and multinomial counts in bigint, bounded) and refuses above 5 000 terms or when the result would exceed the node cap; exponent cap 1000 for symbolic `pow` | `E_LIMIT_VALUE` |
| Integer growth | exact `int` bounded by `maxIntBits`; rational parts count as two ints; `2^(2^40)` is refused before computing | `E_LIMIT_VALUE` |
| Rewrite loops and non-termination | iteration cap 1 000 passes; a set of recent canonical forms detects cycles and reports them; every match attempt is charged to the budget | `E_LIMIT_STEPS`, or `E_RANGE` with `detail.cycle` |
| Exponential matching (modulo commutativity) | backtracking steps are ticks | `E_LIMIT_STEPS` |
| Unbounded numeric loops | `integrate-num` ≤ 10 000 integrand evaluations; `root` ≤ 200 iterations; `roots` ≤ 500 sweeps; `sum` of a numeric range ≤ 100 000 terms | `E_RANGE` (no convergence) or `E_LIMIT_STEPS` |
| Recursive user functions | lambda expansion depth ≤ 100; each expansion is charged; a lambda cannot shadow a built-in name | `E_LIMIT_STEPS` |
| A hostile or buggy primitive stalls the Worker | async yielding plus abort observation (§3.7); the Worker watchdog terminates the Worker as the backstop (RECIPES R14) | `E_ABORTED`, `E_LIMIT_TIME` |
| Output size | printing is metered by `maxOutputBytes` and `maxValueBytes` like any `str` | `E_LIMIT_OUTPUT`, `E_LIMIT_VALUE` |
| Code from data | none: conditions are a closed predicate set, functions are a closed table plus environment lambdas, the engine never builds or evaluates JS or FL source | n/a |
| Metadata and text injection | all output is text (UI.md §4 rule 6); user symbol names are restricted by the name grammar | `E_PARAM_INVALID` |

Error mapping used throughout: syntax error → `E_COERCE` (as `raise:coerce` does for undecodable data, PLAN §3.5); mathematical domain error (`ln 0`, division by zero) → `E_RANGE` or `E_DIV_ZERO`; "no closed form found" → `E_RANGE` with a reason string; shape or dimension mismatch → `E_TYPE`. All `E_LIMIT_*` are uncatchable by `try` (D19), so untrusted FL cannot loop around a limit.

---

## 7. Testing

- **Vector tables.** Every `algebra:*` and `units:*` op gets `vocab/<name>.test.json` in the existing form (`name`, `ref`, `op`, `params`, `input`, `expect`, `ref` at most 200 characters), run by the generic runner in Node and in Chromium Workers (`gate4:browser`). Refs are standard tables and identities (derivative and integral tables, polynomial identities, the SI brochure for units). Value-level words that cannot be catalogue ops are tested through `packages/ops/src/sym*.test.ts` and FL console conformance blocks, with the same expectations.
- **Per-word minimum.** Each word has vectors for the happy path, the identity and the empty/degenerate case, every documented error code, each limit (at the boundary and just over), and a regression vector per bug.
- **Property tests.** The generator in `packages/ops/src/sym/gen.ts` builds random canonical expressions with a seeded PRNG (so failures reproduce): `parse(print(e)) = e`; `canon` is idempotent; `simplify(simplify(e)) = simplify(e)`; `eval` agrees with direct float evaluation of the tree at random points (relative error bound, away from singularities); `deriv` agrees with a central difference; `integrate` then `deriv` returns an expression that `zero?`-differs from the integrand by 0 or agrees numerically; `integrate-def` agrees with `integrate-num`; `expand` then evaluate equals evaluate; `solve-poly` roots satisfy the polynomial exactly or to tolerance; units: `convert` there-and-back is the identity and `base` agrees with a conversion through base. PLAN §6 names fast-check for property tests; it is not a dependency in any `package.json` today, so adding it (or using the seeded generator alone) is a decision for WP S.0 (Q7).
- **Independent cross-checks, done locally and deleted.** As with the CyberChef cross-checks in PLAN §7 (WPs 5.13 and 5.20), a throwaway script compares many thousand random cases against an independent CAS (SymPy or Maxima, installed locally, not a dependency), for derivatives, polynomial expansion and factor-free simplification, exact roots, definite integrals, and unit conversions (against exact factors from a standard). Disagreements are triaged into either Forge bugs or documented convention differences (for example `0^0`, branch cuts), the script is deleted, and the result is summarised in this document the way PLAN §7 records the cross-checks.
- **Limit tests.** Each row of §6 has a test that the error fires with the right code and detail, and that a Worker bake of `(x+1)^500` terminates promptly with an error, not a hang.
- **Docs.** `npm run coverage` is unaffected (CyberChef mapping); `algebra`/`units` ops are Forge-native additions and are listed in `docs/coverage/` as "beyond CyberChef" rows only if the owner wants them tracked.

---

## 8. Phasing and work packages

Same conventions as PLAN §7–8: each WP is sized for one sub-agent in its own worktree on a `wp/<id>` branch, owns an explicit file set, and the orchestrator reviews the diff, merges and re-runs `npm run lint && npm run typecheck && npm test && npm run build`, `npm run e2e` and `npm run size`. Sonnet-class agents take the spec-critical WPs (S.0, S.1, S.3, S.5, S.7, B-stage language WPs); Haiku-class agents take vector-table and docs work. Every new source file carries the Apache-2.0 header; no AI attribution in commits; no push without the owner.

### Stage A

| WP | Deliverable | Owns (only these files) | Parallel with | Done when |
|---|---|---|---|---|
| S.0 | Contract: `sym/types.ts` (node types, limits, `Budget`), `numeric.ts` interface with an int/num-only stub, the `INTERNAL_VOCABS` edit (S6), a `gen.ts` skeleton, decision on property-test library (Q7) | `packages/ops/src/sym/types.ts`, `numeric.ts`, `gen.ts`, `packages/ops/src/types.ts` (the one constant) | none (first) | typecheck; owner approves the `INTERNAL_VOCABS` edit; the shapes in §3.2 are exactly the types |
| S.1 | Representation, canonical form C1, parser, printer, the generic operators and functions as FL wrappers over `core:` (§3.5), `sym:parse`, `>str`, `var`, `canon`, `expr?`, `eq` | `sym/expr.ts`, `canon.ts`, `parse.ts`, `print.ts`, `budget.ts`, `prims/sym.ts`, `vocab/sym.fth`, `sym.test.json`, tests | none (after S.0) | round-trip and idempotence properties pass on 100 000 random trees; error positions tested; depth 500 and node cap tests; operators fall through to core bit-identically for plain numbers (random ints incl. bigint) |
| S.2 | Numeric tower: exact rat and cplx arithmetic, `rat`, `cplx`, exact `eval`, `>num`, `where`, `define`, constant folding of functions | `sym/numeric.ts` (replaces the stub), `sym/eval.ts`, `prims/sym-num.ts`, `vocab/sym-num.fth`, tests | S.3 (against the S.0 interface) | exact identities (`1/3+1/6 = 1/2`, `sqrt(-4) = 2i`) and eval-vs-float property pass; lambda expansion depth cap tested |
| S.3 | `collect`, `expand`, `simplify`, `zero?` with the fixed rule table (§3.9) | `sym/simplify.ts`, `prims/sym-alg.ts`, `vocab/sym-alg.fth`, tests | S.2 | simplify idempotent; expansion blow-up refused (`(x+1)^500`); rule table matches the `doc` text |
| S.4 | `deriv`, `taylor`, `sum` | `sym/calc.ts`, `prims/sym-calc.ts`, `vocab/sym-calc.fth`, tests | S.5 to S.8 | derivative table complete; deriv vs central difference; Taylor error bound test |
| S.5 | `integrate`, `integrate-def`, `integrate-num` (table, linearity, substitution, parts for a bounded pattern set, rational functions by partial fractions over exact roots) | `sym/integrate.ts`, `prims/sym-int.ts`, `vocab/sym-int.fth`, tests | S.4, S.6 to S.8 | integral table vectors; deriv-of-integral property; GK15 accuracy tests |
| S.6 | `isolate`, `solve-quad`, `solve-poly`, `roots`, `root` | `sym/solve.ts`, `prims/sym-solve.ts`, `vocab/sym-solve.fth`, tests | S.4, S.5, S.7, S.8 | roots satisfy their polynomials; no silent wrong answers (every returned root checked by substitution) |
| S.7 | Rewrite rules: `rule`, `match`, `rewrite-*`, cycle detection | `sym/rules.ts`, `prims/sym-rules.ts`, `vocab/sym-rules.fth`, tests | S.4–S.6, S.8 | match modulo commutativity vectors; non-terminating rule set reports the cycle within the cap |
| S.8 | Units: table, parse, convert, base, quantity arithmetic hooks | `sym/units.ts`, `prims/sym-units.ts`, `vocab/sym-units.fth`, tests | S.4–S.7 | conversion vectors against exact factors; dimension errors; affine units only in `convert` |
| S.9 | Recipe ops and catalogue: `algebra.fth`, `units.fth`, vectors, `pretty`, bake tests in a Worker, limit tests, docs and category entries | `vocab/algebra.fth`, `algebra.test.json`, `units.fth`, `units.test.json`, `sym/pretty.ts`, `packages/worker/test/sym-recipes.test.ts` (new file), this document's status line | none (last) | `gate4:browser` passes with the new vectors; `(x+1)^500` bake ends in an error; catalogue lists exactly the intended ops |

File ownership follows the vocabulary: each WP owns its `sym/<area>.ts`, `prims/<vocab>.ts`, `vocab/<vocab>.fth` and its tests, and nothing else, so S.4 to S.8 can run as parallel agents. All of them import the S.0 types and the S.1 canonicaliser read-only; a defect found in S.1 or S.2 goes back to that WP rather than being patched by the finder. The S.0 contract is merged first; S.1 is merged before any of S.2 to S.8 is merged (they may start against the S.0 stub). WP ids carry a dot (S.3); decision ids do not (S3).

**Cross-check and close-out (S.10).** The throwaway independent-CAS cross-check (§7), the summary paragraph in this document, and the Stage A user guide section. Done when the cross-check disagreements are all explained and the script is deleted.

**Decision gate (G-sym).** Owner decision after S.10, with data from the Stage A work: (1) is `USING:` shadowing good enough (measure wrapper step overhead on a 1 000-term sum; count the places where `E_AMBIGUOUS` or core-only vocabularies got in the way); (2) is the `str`-only parameter model enough for recipe users; (3) is the engine's worst-case behaviour acceptable under the watchdog; (4) which of B1–B5 to start. Stage B is not scheduled before this gate.

### Stage B (after the gate; owner-approved FL v0.2)

| WP | Deliverable | Owns | Parallel with | Done when |
|---|---|---|---|---|
| S.11 | B1 core: the `ext` tag, registry in `RuntimeOptions`, `values.ts` (`equals`, `repr`, `display`, `sizeOf`, coercion), header `ext{name}`, schema, LANGUAGE.md v0.2 sections | `packages/lang/src/types.ts`, `values.ts`, `meta.ts`, `meta.schema.json`, `primitives.ts`, `docs/LANGUAGE.md` | none (first) | existing 171 conformance and unit tests unchanged; new conformance blocks for a test `ext` type; hashes of existing words unchanged |
| S.12 | B1 outer: render, vectors, recipe param encoding, `UI_PARAM_TYPES`, catalogue, UI text input with `fromText` validation | `packages/worker/src/render.ts`, `packages/ops/src/types.ts` and `catalogue.ts`, `packages/recipe/*` (additive), `apps/web/src/params/*` | S.13, S.15 | an `ext{sym}` param round-trips JSON ⇄ FL ⇄ URL; UI e2e and axe pass |
| S.13 | B3 literals: `tstr` token, compile-time parse, positions | `packages/lang/src/reader.ts`, `compiler.ts`, LANGUAGE.md §2 | S.12, S.15 | `sym" x^2 "` compiles to a `lit`; error offset points at the bad character; no existing valid program changes token kinds |
| S.14 | B2 generic words (only if the gate asks): `GENERIC:`, `METHOD:`, `EXTENDS:`, method tables, hash, metadata | `packages/lang/src/compiler.ts` (after S.13 merges), `dictionary.ts`, `vm.ts`, `meta.ts`, LANGUAGE.md §5, §6, §10, §12 | S.15 | dispatch conformance; D5 behaviour preserved (old callers unchanged); ambiguity detected at definition; step overhead measured |
| S.15 | B5 `charge`, plus the abort/deadline polling inside primitives | `packages/lang/src/vm.ts`, `types.ts` (after S.11 merges), `primitives.ts` | S.12, S.13 | a CAS primitive hits `maxSteps` deterministically in Node and in a Worker; abort during a primitive stops it without the watchdog |
| S.16 | B4: `rat`, `cplx` as `ext` types; migrate the in-library records; exact-mode recipe option | `packages/ops/src/sym/*`, `packages/recipe` schema (version bump) | after S.11 | Stage A vectors pass unchanged on the new types; shared URLs from before the bump still decode |
| S.17 | Matrices and vectors (Q6): `matrix` ext type, determinant, inverse, solve linear systems, eigenvalues (numeric) | `sym/matrix.ts`, `vocab/matrix.fth`, tests | after S.11 | exact `det`/`inverse` over rationals; dimension errors; size caps |

---

## 9. Decisions and open questions

IDs use the prefix S to avoid collisions with LANGUAGE.md's D-numbers and PLAN §9.

| ID | Decision | Rationale |
|---|---|---|
| S1 | Inspired by the HP 48 CAS, not compatible; Forge's own word names, text syntax, tables. | Same stance as CyberChef (PLAN §1); avoids copying tables and documentation. |
| S2 | Two stages. Stage A is library-only; Stage B (FL v0.2) waits for an owner gate. | Frozen `packages/*` (CLAUDE.md); Stage A already delivers the capability and produces the evidence for B. |
| S3 | An expression is an `int`, a `num` or a `record` node; header type `any`. | No new tag in Stage A; numbers stay numbers; records give structural `=` for free. |
| S4 | Node shape `{"sym": kind, …}` with canonical form C1 (flatten, fold numbers, sort, no like-term collection); `-` and `/` are encoded with `mul` and `pow`. | Makes `=` meaningful and cheap, and the printer a function of the canonical form. |
| S5 | Generic arithmetic by shadowing core in the `sym` vocabulary; plain numbers fall through to `core:`. Opt-in per scope. | Works today by §6.2 (imports before core) with no language change; bit-identical results for numbers. |
| S6 | Value-level vocabularies (`sym*`) are internal (added to `INTERNAL_VOCABS`); catalogue ops live in `algebra` and `units` and are `str` to `str`. | The catalogue checks parameters only, not data or output types (RECIPES §2.2). The edit changes a constant's value, not an export or type; owner approval needed. |
| S7 | A hand-written in-repo TypeScript engine behind primitives, an explicit exception to "FL first" (PLAN §3.5, §9 item 9). | FL cannot express or bound the algorithms; no CAS dependency (bundle, CSP, `@noble/*`-only policy, independence). |
| S8 | Engine entry points take a tick budget (`E_LIMIT_STEPS`, `detail.where = "sym"`), are async and yield, and observe `ctx.signal`; the Worker watchdog is the backstop. | Uses the existing async-primitive mechanism; no VM change in Stage A. |
| S9 | No directory or global variable store; environments are `record` values, user functions are lambdas in them. | PLAN §5 (no ambient authority); `put`/`get` exist. |
| S10 | Exact by default; `/` in `sym` is exact on ints; approximation is explicit (`sym-num:>num`, `mode:approx`); any `num` operand makes the result `num`. No global flags. | Predictable, reproducible recipes; D29 for core `/` is untouched. |
| S11 | Complex numbers are exact (int/rat parts), principal branch for functions, documented per function. | Needed for `sqrt(-4)`, quadratic roots. |
| S12 | Affine units (degC, degF) are accepted only by `convert`. | Avoids ambiguous offset arithmetic. |
| S13 | Rewrite rules use `?x` wildcards, matching modulo C1's commutativity, a closed predicate set for conditions, and iteration and cycle caps. | No code from data; terminating by construction. |
| S14 | Angles are radians. | Simple, exact `pi` handling; degrees are a Q4 question. |
| S15 | (Stage B) One registered `ext` value tag serves sym, rat, cplx, quantity and matrix; header spelling `ext{name}`; no hard-coded `sym` tag. | One mechanism; `parseHeader` stays pure (§5.8). |
| S16 | (Stage B, conditional) Generic words as closed method tables frozen at unit commit, selected by tags at call time, extension by `EXTENDS:` into a new word. Alternative: `any` core arithmetic with registered handlers. | Keeps D5 early binding, per-word metadata and hashes. |
| S17 | (Stage B) Tagged string literal `sym" … "`, host-registered parsers, compile-time parse. | `sym"` is `E_LEX` today so nothing valid changes; D8 preserved. |
| S18 | (Stage B) `rat`/`cplx` are `ext` types in `@forge/ops`; exact/angle settings are recipe options, not global flags. | Core stays small; shared recipes mean the same everywhere. |
| S19 | (Stage B) `PrimitiveContext.charge(n)` accounts primitive work in `maxSteps` and polls abort and deadline. | Deterministic limits across hosts. |
| S20 | Value-level sizes are bounded by named limits (§6) smaller in untrusted bakes; all walkers are iterative. | Same discipline as `values.ts`. |
| S21 | Output is plain text; the 2-D layout (`pretty`) is text; no HTML or MathML in v1. | UI.md §4 rule 6; strict CSP. |

**Open questions.**

1. **CAS from scratch or an npm dependency?** S7 chooses from scratch. A mature library would save months but must pass the bundle budget, the CSP (no `eval`/`new Function`), lazy loading, and the independence principle, and would need exact output control. Decide after S.1 and S.3 show the real cost.
2. **Pretty printing and MathML.** How far does 2-D text go; is a CSP-compatible MathML renderer (DOM built with `createElementNS`, no `innerHTML`) worth an exception to "rendered as text"?
3. **Is B2 needed at all** if `USING:` shadowing suffices? The gate measures wrapper cost and counts `E_AMBIGUOUS` incidents.
4. **Angle mode.** Radians only (S14), or a `deg` unit/recipe option, or per-function degree variants.
5. **Branch cuts for complex functions.** Principal values for `ln`, `pow`, `sqrt`, `asin`, `acos`, `atan` need an explicit table with vectors (and a decision on signed zero, which `num` keeps, LANGUAGE §3.3).
6. **Matrices.** Timing (S.17 or later) and whether vectors are a separate type or a one-column matrix.
7. **Property-test library.** fast-check (named in PLAN §6, not currently a dependency) or the seeded in-repo generator alone.
8. **A dedicated error code for dimension mismatch** (`E_UNITS`)? v0.1 has none and adding codes is a Stage B change; Stage A uses `E_TYPE` with `detail.dimension`.
9. **Exact `/` spelling in core** (a new `//`) versus only `sym:/`. Decided at the gate (B4).
10. **How much integration and solving is "enough".** The rule sets of S.4 to S.7 are a list the owner may widen or narrow before the WPs start (for instance partial fractions, trigonometric substitutions, cubic and quartic radicals).
