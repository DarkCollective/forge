# FL corpus statistics

Command: `npm run --silent corpus-stats -w @forge/ops > docs/research/corpus-baseline-2026-11-24.md`

Every value is counted from the tree by `packages/ops/scripts/corpus-stats.ts`. The definition of each is in the right-hand column.

## 2.1 Forge today

| Measure | Value | Definition |
|---|---:|---|
| .fth files in vocab/ | 208 | files named *.fth in vocab/ |
| .fth lines | 28,759 | physical lines of every .fth file (blank lines and comments included) |
| .test.json files | 201 | files named *.test.json in vocab/ |
| vectors (all .test.json items) | 7,589 | top-level items of every .test.json array |
| vectors with an "op" field | 7,589 | items with a string "op" (the op vectors) |
| other items (checkPair) | 0 | items without an "op" field |
| .test.json with no .fth | 0 | vocabularies with vectors but no .fth file |
| .fth with no .test.json | 7 | vocabularies with a .fth but no .test.json |
| ops (catalogue entries) | 461 | entries of the built catalogue (dist/catalogue.json) |
| vocabularies with an op | 201 | distinct vocabularies of the catalogue entries |
| ops with at least one vector | 461 | catalogue ops whose qualified name is the "op" of a vector |
| .fth files that are op vocabularies | 201 | .fth files whose name is a catalogue vocabulary |
| .fth files that are internal vocabularies | 7 | .fth files whose name is in INTERNAL_VOCABS (src/types.ts) |
| .fth files neither op nor internal | 0 | .fth files in neither set: none |
| vectors in op-vocabulary files | 7,589 | vectors in .test.json files of catalogue vocabularies |

## 11.5 The fixes

| Measure | Value | Definition |
|---|---:|---|
| vector expectations of E_PARAM_INVALID | 20 | vectors whose expect.error is E_PARAM_INVALID (the expectations LANGUAGE-0.3 §14.1 says L12 rewrites) |
| files holding them | 10 | test files with at least one such expectation |
| definitions that call reduce | 83 | definitions whose body holds the word reduce |
| reduce call sites | 86 | word tokens reduce |
| files calling reduce | 36 | files with a reduce word token |

## 2.5 The FL corpus

| Measure | Value | Definition |
|---|---:|---|
| tokens | 100,410 | reader tokens of every .fth file, excluding eof and headers |
| colon words | 3,254 | `: name` definitions (MEMO: excluded), in every .fth file |
| public colon words | 609 | definitions whose name does not start with `_` |
| private colon words | 2,645 | definitions whose name starts with `_` |
| MEMO: words | 119 | MEMO: definitions (memoised zero-input words) |
| private words called exactly once | 1,816 | private definitions with exactly one reference in their own file (a word token of the name, or a qualified call to their own vocabulary) |
| single-use helpers that only bind a closure variable | 0 | private single-use words whose whole body is one quotation and that quotation uses a named input |
| small single-use named helpers | 98 | private single-use words that are not closure helpers, with a body of at most 5 tokens |
| stack shuffling per 100 tokens | 1.95 | dup drop swap over rot -rot nip tuck dup2 drop2 occurrences per 100 reader tokens |
| zero-input words (not MEMO:) with an output | 67 | `: name ( -- … )` with at least one output |
| of which build a literal on each call | 10 | the body holds a list, record or byte literal |
| zero-input MEMO: words | 119 | MEMO: definitions with no input |
| CONSTANT definitions | 7 | uses of the word CONSTANT |
| VARIABLE uses | 106 | uses of the word VARIABLE |
| VARIABLE uses in the five busiest files | 87 | the five files with most VARIABLE uses: bombe 26, typex 21, enigma 16, lorenz 12, punycode 12 |
| try uses | 31 | the word token `try` |
| qualified raise: calls | 0 | qualified words with vocabulary raise |
| choice{} occurrences in headers | 94 | each `choice{…}` in a stack-effect header, counted per occurrence |
| distinct choice{} lists | 92 | distinct text between the braces |
| choice{} occurrences whose list recurs | 4 | occurrences whose list text appears in more than one occurrence |
| choice{} occurrences beyond the first of their list | 2 | occurrences minus distinct lists |
| definitions with a choice{} header | 73 | definitions whose header holds at least one choice{} |
| else-if links | 12 | an `if` whose else quotation ends with another `if` |
| else-if chains | 9 | outermost `if` of a chain of at least two links |
| else-if chains of depth 3 or more | 1 | chains counting the outermost `if` as depth 1 |
| deepest else-if chain | 5 | maximum depth counted as above |
| util public words | 80 | definitions of vocab/util.fth whose name does not start with `_` |
| util words used by three or more vocabularies | 32 | util: names called from at least three other vocabularies |
| most-called util words | be-int 52, delimiter 34, zero-pad 22, letter? 20, match-texts 16, decode-table 15 | util: calls, from other vocabularies, the six most called |
| primitive files | 101 | src/prims/*.ts, tests excluded |
| primitive modules (files with a definePrimitive) | 101 | files of src/prims with at least one definePrimitive( call |
| primitives | 193 | definePrimitive( calls in src/prims |
| TypeScript lines of the primitive files | 21,723 | physical lines of src/prims/*.ts (tests excluded) |
| code lines of the primitive files | 16,741 | lines that are neither blank nor comment-only |
| primitive files importing @noble | 22 | files with an import from @noble/ |
| primitives in those files | 43 | definePrimitive( calls in those files (the audited-library wrappers of §2.5) |

## 11.2 Group L-B

| Measure | Value | Definition |
|---|---:|---|
| `} case` tables | 84 | a `case` word directly after a closing brace (a value table, LANGUAGE-0.3 §9.2) |
| of which in definitions with a choice{} header | 3 | definitions with a choice{} header whose body holds a `} case` table |

## 14.1 The table

| Measure | Value | Definition |
|---|---:|---|
| files that call json: | 15 | files, other than json.fth, with a json-qualified word |
| json-qualified word uses | 38 | qualified words with vocabulary json |
| lines with json:null or json:null? | 4 | distinct (file, line) pairs holding json:null or json:null? |
| files with json:null or json:null? | 2 | files holding json:null or json:null? |
| W_SHADOW locals of the 35 new core names | 10 | named inputs and `:>` bindings named as one of the 35 new core words, in files that do not define the word themselves |
| files with such locals | 9 | distinct files of the locals above |
| distinct names of such locals | 2 | distinct names of the locals above |
| locals of those names already shadowing an own word | 0 | the same names where the file defines the word itself (not counted above, as the warning is drawn already) |
| locals per name | first 6, last 4 | the locals above, per name |

## Not measured

- 184 'not yet' ops and their triage (§2.1): a classification by the orchestrator, not a property of the tree.
- The 119 primitives by reason (§2.5 table): needs a judgement per primitive; only the audited-library wrappers are measured.
- The 53 own cipher and hash cores, their 3,626 code lines, the 13 host-capability and 9 stateful primitives: needs the same judgement.
- TEA 478 and SHA-1 186 VM steps per byte, RC4 80 steps per byte, html:decode about 5 ms per call, the CRC table about 20,000 steps per call, about 1 ms per caught error: these need running the VM and timing it.
- Today's W_SHADOW warnings from the compiler: needs the runtime's warning list; the count above is static.
- The 3.5 shuffles per 100 tokens and the 84 and 221 helper counts of the survey are re-measured here; the survey's own token and helper definitions are not in the TOOLKIT text, so the definitions above are L1's choice.
- The 88 callers of reduce (§11.5): re-measured as definitions calling reduce; the survey's count is not reproduced by its definition.
