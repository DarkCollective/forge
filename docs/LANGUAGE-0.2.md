# FL v0.2, additive wave: historical note

Status: **implemented and folded into [LANGUAGE.md](LANGUAGE.md)**. This file is kept as a record. It is not a specification: LANGUAGE.md ("FL language specification, v0.2") is the single reference, and its [Appendix A, "Changes in v0.2"](LANGUAGE.md#appendix-a-changes-in-v02) lists every new token, form, clause and `core` word with its section number, for the author of an editor plugin.

## What it was

WP 6.2 wrote a proposal for an additive wave of FL, approved by the owner with every recommendation of its open questions accepted. The wave changed `packages/lang` and `packages/ops` only, each change with its specification, and kept every v0.1 program, vector and word hash valid. WPs 6.3 to 6.10 implemented it:

| WP | What |
|---|---|
| 6.3 | `ForgeError.frames` keeps the 32 innermost and 32 outermost frames (`framesSkipped`); the conformance harness reads two documents; the hash snapshot script |
| 6.4 | maths words, strict `str>num`, `has-key?`, `sort`, `fail-coerce`, `fail-range`, and the FL prelude of twenty promoted `util` words |
| 6.5 | the `META:` clauses `use-when`, `link`, `inverse`, `helper`, and the reserved `checks` |
| 6.6 | the vector `example` key, `buildHelp` and `help.json` |
| 6.7 | `:>` and `exit` |
| 6.8 | the collectors, `cond`, `case`, `sort-by`, `find`, `any?` and `all?` |
| 6.9 | shared choice types (`CHOICE:`, `choice<…>`) |
| 6.10 | `MEMO:` and `warm()` |
| 6.11 | the fold-in: this document, LANGUAGE.md, RECIPES.md and PLAN.md |

The 85 conformance cases of the proposal (C201 to C285) were fenced `fl-proposed` while their feature did not exist, flipped to `fl-test` by the package that implemented it, and moved into LANGUAGE.md section 16 with their numbers and text unchanged. The harness reads LANGUAGE.md only again.

## Where each section of the proposal went

The source code still cites sections of the proposal ("LANGUAGE-0.2.md section 9"); this table gives the section that now holds the text.

| Proposal section | Now in |
|---|---|
| 1 `use-when` and `link` | LANGUAGE.md §5.9, §12.1, §12.5 |
| 2 `inverse` | §5.9; the symmetric closure in RECIPES.md §2.7 |
| 3 "not an operation" marker (`helper`) | §5.7, §5.9 |
| 4 shared `choice` types | §5.4, §5.12, §6.8, §12.4; the scanner in RECIPES.md §2.4 |
| 5 reserved `checks` | §5.9, §17.1 |
| 6 examples on test vectors | RECIPES.md §9.1, §9.2 |
| 7 `help.json` | RECIPES.md §2.7 |
| 8 `:>` | §7.1, §8 |
| 9 `MEMO:` | §5.13, §10.13 |
| 10 collectors | §8 |
| 11 control and lookup words, `exit` | §8, §13.4, §13.6 |
| 12 maths and `str>num` | §3.2, §13.2, §13.5 |
| 13 promoted `util` words, failure words | §13.6, §13.8 |
| 14 `ForgeError.frames` | §11 |
| 15 work packages | PLAN.md, Phase 6 |
| 16 tooling affected | LANGUAGE.md Appendix A, §A.5 |
| 17 open questions | all accepted; LANGUAGE.md §17 |
| 18 decisions D50 to D64 | §17, D50 to D68 |
| 19 what the wave does not do | §17.1 |
| 0.4 conformance workflow | §16.1 |

## Where the code differs from the proposal

The implementing packages made corrections and extensions, which the owner was told about. LANGUAGE.md describes the code. The ones that matter to a reader of the proposal:

- Frames: the 32 + 32 split is of word **and quotation** frames; `framesSkipped` is in `toJSON()`.
- A promoted word such as `core:between?` has the **same** hash as `util:between?` when its text and callees are the same, because the hash covers source text and callees, not the vocabulary. The prelude is compiled under the default limits, not the caller's, and `createRuntime` costs about 1.7 ms more (the 1 ms target was not met and was accepted).
- `help` prints `use when:` after `category:` (before `aliases:`) and `links:` after `see also:`.
- `WordMeta.discovery` is omitted when empty; a second `META:` block for a word starts from the discovery already collected; `inverse` is checked at the end of the unit (or console input), in the same vocabulary only, and an alias target is stored as the canonical name.
- `:>` is `E_SYNTAX` anywhere lexically inside a `{ }` list, and a `while` or `loop` that contains a `:>` is not lowered, so an `exit` in it is `E_SYNTAX`. `cond` and `case` are runtime combinators and are never lowered, so an `exit` in their branches is `E_SYNTAX`. `exit` resolves by the normal name rules.
- `sort-by` takes a list only; `find` returns an index or −1; a collector is a return-stack frame, its size is checked at each `emit`, and a memo build hides the collectors of its callers.
- Shared choice types: a type name may not contain `<` or `>` (`E_NAME`); `option true ;` is an error (a bool token is not a valid option); clause faults are `E_META` with `detail.clause = "option"` and structure faults `E_SYNTAX`; the hash gets the extra `choice <typehash>` line only for words that use a type; a redefined type warns `W_REDEFINED`.
- `MEMO:`: the header must be `( -- T )` with one concrete output (not `quot`, not `any`); `.` and `.s` are impure ("output"); `recurse` is `E_SYNTAX`; a value that holds a `quot` anywhere is returned but not cached; a cache hit is one step and is refused with `E_LIMIT_VALUE` if the value is larger than the using run's `maxValueBytes`; a cached value keeps its secret mark; `warm()` reports a value that could not be cached as failed (`E_LIMIT_TOTAL`).
- `help.json`: `format` 1; the catalogue is unchanged (same version as before the wave); `optionDocs` is built from shared choice types.
