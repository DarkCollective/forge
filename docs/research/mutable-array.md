# A mutable array for FL: design study

Status: design proposal for the owner to decide. Nothing here is merged into the shipped language. The numbers come from a throwaway prototype on the branch `wp/study-mutable-array` (`packages/lang/src/proto-mutable.ts`, the `spike-mutable-*` tests in `packages/ops/src` and the `.fth` files in `packages/ops/spike`), which is not to be merged and may be deleted once this is decided. Statements about the language are from `docs/LANGUAGE.md`, about primitives from the header comments of `packages/ops/src/prims/`, and about the earlier spike from `docs/research/slow-ops.md` section 7a. Where a number is an estimate it says so.

## 1. Summary

Values in FL are immutable (LANGUAGE section 3.1), so every `put`, `append` and `cat` copies. Nothing mutable was ever proposed because of the determinism and debugger rules, and the gap has kept about ten primitives in TypeScript (PLAN waves 2, 4 and 5; slow-ops section 6a).

The measurements say something narrower than the earlier estimates:

1. For small state (RC4's 256 bytes, LS47's 49, the other ciphers) a plain copying `set-nth` is enough. No mutation is needed. The cost is about 44 steps a byte for RC4, set by the steps, not by the copying.
2. For large or growing state, copying is quadratic in allocation and only in-place update helps. The AMF decoder at 64 KiB allocates 0.3 to 2.2 GB with copying and 4 to 98 MB with in-place tables, for identical steps.
3. LS47 does not benefit. The 15 to 25 steps a letter estimated in slow-ops section 7a is wrong: a direct mutable-board version costs 163 steps a letter, three times the 55 of the table version already in the spike.

Recommendation, in three lines:

- Do a small first step now: a copying `set-nth` for lists and bytes (and a bytes `index-of`). It is pure, adds no semantics, and moves RC4, CipherSaber-2 and probably the small-state ciphers back to FL.
- For the large-state cases add an explicit, restricted mutable `array` value (option B below): made by `thaw`, changed by `aset!` and `apush!`, sealed in O(1) by `freeze`, never storable in a list, record, variable or `MEMO:` cache.
- Do not do transparent update-when-unique (option A): the prototype shows it gives no gain on the unchanged AMF decoder, because every `:>` local read ends uniqueness, and it spreads a soundness obligation over the whole VM.

## 2. The problem

`put` copies the record, `append` copies the list (and also sizes it, which is another pass), and the VM meters the result at its full size (`sizeOf`, LANGUAGE section 10.8) even though only one slot changed. So building an n-element table one entry at a time costs n squared in steps of the host and in `maxTotalBytes`. At the default 256 MiB untrusted limit the AMF decoder fails at 40 to 150 KB of input where the step limit alone would allow 130 to 450 KB. A value-level cure is needed, not a faster loop.

A second cost is smaller but real: a state array that is updated per element in an `each` has to be threaded through the stack, and most FL code binds its inputs with `:>`.

## 3. Options compared

| | A. In place when unique | B. Explicit `array` | C. `with-array` scope | D. Persistent structure |
|---|---|---|---|---|
| Semantics | Unchanged: `put`, `append`, `set-nth` mutate only if the VM can prove no other reference | New value with identity: aliases see updates | Buffer visible only inside a quotation, result frozen | Unchanged: O(log n) updates, shared structure |
| Determinism | Kept; allocation depends on uniqueness, so a hook that changes uniqueness changes limits | Kept: aliasing is explicit and single threaded | Kept | Kept |
| `maxTotalBytes` | Charged only when a copy happens | `thaw` full size, `apush!` 8 bytes, `aset!` nothing, `freeze` nothing | As B, by scope | Charged per node (log n), a new rule |
| Debugger and trace | Snapshots must clear uniqueness of what they capture (the prototype switches the feature off instead) | Snapshots copy a bounded prefix of an array | Same as B | Unchanged |
| `MEMO:` | Cached values must be cleared of uniqueness | An array output type is refused; arrays can live inside a body | Same as B | Unchanged |
| Untrusted code | Soundness is a VM invariant; a missed alias corrupts data silently | Aliasing hurts only programs that use arrays; no cycles if arrays cannot hold arrays | Same | Safe |
| Size in `packages/lang` | VM about 200 lines (measured: 52 in `vm.ts` plus a 155 line module); plus a last-use analysis in the compiler, about 250 lines (estimate), to help `:>` code | New tag, 8 words, meter and display rules: about 400 lines (estimate) | About 250 lines (estimate), but see below | 600 to 1000 lines, and it changes the payload that every primitive receives (`readonly Value[]`) |
| Frozen contracts | None visible | New tag in the `Value` union: an additive wave, touching the 19 files that switch on tags in `lang`, `ops`, `worker` and `web` | A new combinator, no tag | A representation change: not additive |
| Editor plugin | None | New core words and a type name in `builtins.json` (regenerated by `tools/export-builtins.mjs`) | One word | None |
| Fits the AMF decoder | Only after last-use moves | Yes, one line changed | No: three tables live across deep recursion | Yes |
| Fits LS47, RC4, Levenshtein | Stack threading only | Yes | One buffer at a time: Levenshtein needs two | Yes |

Two more forms were considered. E: named per-run arrays declared like `VARIABLE` (the Forth way, no new tag). They are not re-entrant: a word that builds its own rows, such as Levenshtein inside a `map`, would share them. F: a copying `set-nth` and nothing else, which is step one of the recommendation and is also the fallback if the owner wants no new concept.

Why not C: the buffer would have to be reachable from words called inside the scope, so it is either ambient (only the innermost, which is too few) or a handle, which is option B with a scope rule. Why not D: lists reach primitives as plain `readonly Value[]`, so a persistent vector would have to be flattened at every primitive call.

## 4. The prototype

One mechanism serves both A and B, in `packages/lang/src/proto-mutable.ts` and 52 lines of `vm.ts`:

- `core:append`, `core:put` and `mut:set-nth` (a new word in a throwaway `mut` vocabulary, so the `core` conformance tests are untouched) mutate their first argument in place if its wrapper carries a flag.
- Option A: the flag `u` is set on the fresh copy those words return, and cleared by `dup`, `over`, `tuck`, `dup2`, a local or variable read, a list literal, `emit`, `map`, the `MEMO:` store and every other primitive taking the value as an argument. With a trace or an `onStep` hook the feature is off.
- Option B: `mut:thaw` returns a copy with a permanent flag `m`, which nothing clears; the words always mutate it. `mut:freeze` copies back.
- Metering: an in-place `append` charges 8 bytes, `put` 16 plus the key, `set-nth` nothing; the list size is cached on the wrapper.
- The VM reports `totalBytes` in the run result (prototype only).

The existing `packages/lang` suite passes (1731 tests, 7 of them new, in `proto-mutable.test.ts`, which check that `dup`, locals and list literals never expose an update and that a unique list grows in linear allocation). The whole `packages/ops` suite (5,813 tests, the vectors of every FL word, with in-place `append` and `put` live wherever a result is unique) also passes; two suites fail to resolve `@forge/worker` and `@forge/ops/vite` only because `dist` is not built in the worktree. The prototype is not claimed sound: section 6 lists what a real version would have to audit.

## 5. Measurements

Steps are VM steps. All programs agree with the primitives they replace (LS47 on 60 random inputs and the vectors, RC4 and Levenshtein on random inputs, the AMF decoder on 116 vectors and 240 random values). Wall times in the logs are noisy because other jobs ran at the same time and are not quoted.

**AMF decoder, total allocation** (`maxTotalBytes` meter, 64 KiB input; steps are the same in both columns). The unchanged decoder run under the prototype is option A on code that binds its tables to locals.

| Shape (64 KiB) | Steps | Total, unchanged (A engaged) | Total, tables thawed (B) |
|---|---|---|---|
| Flat list of ints and strings, AMF3 | 1.12 M | 327 MB | 4.1 MB |
| Records of five fields, AMF3 | 1.52 M | 911 MB | 12.7 MB |
| Records of five fields, AMF3 with object references | 2.54 M | 2,238 MB | 97.5 MB |
| Records of five fields, AMF0 (not converted) | 0.83 M | 154 MB | 154 MB |

The unchanged decoder matches the original spike (a limit hit at 40 to 150 KB), so A did nothing for it: its tables go through `:>` bindings, and each read clears uniqueness. The thawed variant changes exactly one line, `{ } >record { } { }` becoming `{ } >record mut:thaw { } mut:thaw { } mut:thaw`. With in-place tables, total allocation no longer binds under the default untrusted limits for AMF3 (step limit first: 283 KB flat, 209 KB records, against 40 to 150 KB before), and AMF3 with references reaches 127 KB flat and 129 KB records at 5 M steps. For the unchanged decoder the total grows with the square of the input, so scaling the 16 KiB and 64 KiB rows puts the 256 MiB untrusted limit at about 22 KB (records with references), 35 KB (records) and 59 KB (flat), and the 1 GiB trusted limit at about 44, 70 and 119 KB (interpolated, not run to the limit; the earlier spike reached the limit at 40 to 150 KB).

**LS47** (cold fixed cost 14 to 15 thousand steps, both):

| Version | Steps a letter (decrypt) | Total at 64 K letters | Largest under 5 M / 10 M steps |
|---|---|---|---|
| WP 5.9 FL (slow-ops) | about 800 | not measured | not measured |
| Tables and `translate`, no array (the spike, `wp/spike-ls47`) | 55.0 (53.0) | 104 MB | 90,603 / 181,486 letters |
| Direct, mutable 49 byte board | 163.0 (164.1) | 66 MB | 30,586 / 61,261 letters |

The direct version is the one an author would write: find the letter, move a row by `slice` and `cat`, move a column by seven `set-nth`. It is five times cheaper than the first FL version and three times dearer than the table version. A mutable array removes no work from the table version, whose steps are bindings and table reads. A bytes `index-of` would save about 20 a letter in the direct version (two position searches of about 13 steps each, call included, become about 3; estimate).

**RC4** (16-byte key, 16 KiB of data; the setup adds about 8,000 steps):

| Version | Steps a byte | Total allocation | Largest under 5 M / 10 M steps |
|---|---|---|---|
| In-place array held in a local (B) | 45.5 | 1.34 MB (82 B a byte) | about 110 KB / 220 KB |
| S-box threaded on the stack, in place when unique (A) | 43.5 | 5.60 MB (342 B a byte) | about 115 KB / 230 KB |
| Same program with plain copying `set-nth` | 43.5 | 9.86 MB (602 B a byte) | about 115 KB / 230 KB; 69 MB of allocation at 115 KB |

**Levenshtein** (unit costs, square inputs; PLAN gives about 39 steps a cell without an array):

| Version | Steps a cell | Total at 256 by 256 | Remark |
|---|---|---|---|
| Two mutable rows (B) | 36.2 | 6.4 MB | |
| Rows threaded on the stack, in place (A) | 34.2 | 7.4 MB | needs the row never to be bound to a local |
| Same program, copying `set-nth` | 34.2 | 277 MB | cubic: reaches the 256 MiB untrusted limit at 256 by 256 |

The step count barely moves: the cost is the arithmetic of a cell, so an array does not make Levenshtein fast, it only lets it stay in budget. About 5 M steps allow about 370 by 370 characters; the primitive does 64 KiB samples. It should stay a primitive.

SIGABA, Bombe, Rabbit, GOST meshing, the Myers diff and `list:shuffle` were not built. Estimates are in section 8.

## 6. Recommendation and design sketch

Option B, in a restricted form, after step zero.

**Step zero (a work package of its own).** Add to `core`: `set-nth ( list|bytes i x -- list|bytes )`, a copy with one element replaced (bytes take an `int` 0 to 255, else `E_RANGE`); `index-of ( bytes|list x -- int )`, the first position or minus one. Both are pure, metered like `cat`, and need no VM change. They carry RC4 (measured) and CipherSaber-2 (the same loop), and probably Rabbit, GOST meshing and `list:shuffle` at small sizes.

**The array (step one).**

- A new tag `array`. Two kinds, chosen by how it is made: an array of values, and a byte array (elements 0 to 255). `thaw ( list|bytes -- array )` copies; `anew ( n x -- array )` makes a value array of n copies of x and `anew-bytes ( n -- array )` a zeroed byte array; `freeze ( array -- list|bytes )` seals in O(1) (the result shares the storage and the array refuses further updates with a new error code `E_STATE`).
- Words: `aget ( array i -- x )`, `aset! ( array i x -- )`, `apush! ( array x -- )` (value arrays only), `alen ( array -- int )`. Updates return nothing, so a forgotten `drop` is not needed and a stale copy is not tempting. The `!` suffix marks a word that changes an argument, by convention (names such as `n!` already exist).
- Arrays may be passed to and returned from words and captured by quotations, so helpers can be factored. They may not be stored: `aset!` and `apush!` of an array, `{ }` containing an array, a `VARIABLE` set, and a `MEMO:` output of type `array` are all errors (`E_TYPE`, and `E_HEADER` for the output type). That rules out cycles, escape into immutable data, and a cached mutable value.
- `=` on arrays is identity. `type` gives `array`. `.` prints `array{ 1 2 3 }` (a value array) or `array#[ 01 02 ]` (a byte array), as a snapshot.
- Limits: `thaw` and `anew` charge the full size to `maxTotalBytes` and check `maxValueBytes`; `apush!` charges 8 and checks the live size; `aset!` and `freeze` charge nothing (a value array's live size is checked at `freeze` with `sizeOf`, once). So a decoder that fills a table costs its real allocation.
- Debugger and traces: a trace entry or `ForgeError.stackSnapshot` replaces an array by a copy of its first 16 elements, so a trace never shows later contents. A debugger reads the live array through `aget`-like access in the UI.
- Purity: a body that uses arrays internally is still pure for `MEMO:` and for the word hash; the hash covers source text and callees only. A word that mutates its argument is not an effect label, the `!` convention is the only mark.

**Why not A.** The prototype shows the failure: the unchanged decoder gets no gain. Making A useful needs a last-use analysis in the compiler so a `local` read can move the value out, which is only sound when the read cannot run again (loops, `each` bodies and quotations that capture the local are excluded) and which makes the debugger show a local as gone after its last use. A is also silent: an author cannot tell that a stray `dup` makes a loop quadratic. And its correctness is an invariant of every VM instruction that can copy a reference. The 13 sites the prototype touched (four stack words, local and variable reads, list literal, `emit`, `map`, the `MEMO:` store, primitive arguments, the result stack, hooks) are the ones found by reading; a new combinator that forgets one would corrupt data without an error. If the owner wants A anyway, the cheap safeguard is to run the whole conformance suite twice, with the feature on and off, and compare.

**What B costs in complexity.** Aliasing: `dup` of an array gives two names for one thing. That is the Forth model, and the rules above keep it inside one run and one call tree. A scoped form (valid only inside `with-arrays [ ... ]`) was considered and rejected as extra syntax for no extra safety.

## 7. Open questions, each with a recommended answer

1. New tag, or a flag on `list` and `bytes`? Recommended: a new tag. A flag would let every core word and combinator see an array, including `map` over an array that the body is changing.
2. Should `aset!` return the array? Recommended: no.
3. Should `freeze` copy? Recommended: no, seal in O(1) and refuse later writes. A copy makes returning a 20,000 element table cost as much as building it.
4. Should core words such as `nth`, `len` and `slice` accept an array? Recommended: no; the array words are `aget` and `alen`, and `freeze` hands over to the rest of the language.
5. Which error for a write to a sealed array? Recommended: a new code `E_STATE`, an additive entry in the error table, rather than overloading `E_EFFECT`.
6. Should arrays be allowed in `MEMO:` bodies? Recommended: yes inside, never as the output, as in section 6.
7. Should the step-zero words ship before the array decision? Recommended: yes. They are useful alone and the array words are then added to the same section of LANGUAGE.
8. Do the ops that move back to FL keep a primitive fallback? Recommended: no for RC4 (the vectors are the oracle) but mark it a snail op once slow-ops section 3 exists, since 115 KB is the untrusted limit.
9. Should this be a numbered wave (v0.3) approved like v0.2? Recommended: yes: step zero and step one as work packages of one wave, with LANGUAGE.md appendix A listing the new words and the tag, and every `packages/*` change additive. The 19 files that switch on `tag` get a compile error for the missing case, which is a useful checklist.
10. Does the editor plugin need work? Recommended: regenerate `builtins.json` with `tools/export-builtins.mjs`, add `array` to the header type names if the plugin's header grammar lists types, and add the `!` naming rule to `FL-STYLE.md` (the formatter test keeps the two in agreement). I did not change `../forge-plugin`; whether its header grammar hard-codes the type list is to check.

## 8. What it would unlock

Measured: RC4 (`rc4:_crypt`) and with it CipherSaber-2: 43 to 45 steps a byte, about 115 KB under the untrusted step limit, a snail op rather than a fast one. The AMF decoder's reference tables (and probably the Avro, plist and similar readers that keep tables): the allocation cure, with the step limit as the only bound. These need step one for AMF, step zero for RC4.

Not helped, measured: LS47 (the table version of the spike is better; it needs no array), Levenshtein (36 steps a cell; keep the primitive for long samples).

Estimates, not built:

- Rabbit (eight 32-bit state words and counters, bigint arithmetic) and GOST 28147 meshing (a 32 byte key re-encrypted every 1,024 bytes): small state, so step zero is enough; the cost is the 32-bit arithmetic, which slow-ops section 7a already identifies as a language gap (fixed-width rotate and masked add).
- `list:shuffle`: a Fisher-Yates swap loop of about 25 steps an element, in place; with copying `set-nth` it is cubic in allocation beyond a few thousand elements.
- Myers diff (`diff:_edits`): one vector of furthest-reaching points updated per diagonal. About 30 to 60 steps a diagonal. With in place arrays the 5 M budget examines about 100,000 diagonals, ample for line diffs of source files, not for 64 KiB of characters. Keep the primitive for the character case; moving the line case is possible.
- SIGABA: its cost is the 26-step rotor pass, not state updates, so an array does not help. Bombe: a union-find over 351 pairs for each of 17,576 positions, tens of millions of operations: stays a primitive.
- `asn1:parse-in` and the data-format readers: the quadratic growing lists go away; the few hundred steps an element stay. Whether they fit a step budget at 64 KiB is to measure.

## 9. Cost summary

| Item | Estimate |
|---|---|
| Step zero (`set-nth`, `index-of`) | about 60 lines in `core.ts`, tests, LANGUAGE section 13.4: one small work package |
| Step one (array) in `packages/lang` | about 400 lines of source (tag, `values.ts` size, equality and display, eight words, VM meter and trace rules, header type, `MEMO:` rule, error code) and about 400 of tests |
| Other packages | 19 files switch on tags; most need one case. `worker` (`port.ts`, `render.ts`) must refuse to send an array across the worker boundary or send a snapshot; the web output model shows a snapshot |
| Docs | LANGUAGE sections 3.1, 5.6, 10.8, 11 and 13.4, appendix A, FL-STYLE |
| Moving primitives back | RC4 and AMF are the first two; each is a work package like the spike ones, with the spike `.fth` files as a start |

The prototype for A cost 52 lines of `vm.ts` plus a 155 line module for three words, and was the cheap part; the last-use analysis it would still need is not in that count.

## 10. How to reproduce

From the repository root on the prototype branch, after `npm install` and `npm run build -w @forge/lang`:

- `AMF_VARIANT=base|mut npx vitest run packages/ops/src/spike-mutable-amf.test.ts --reporter=verbose --disableConsoleIntercept` (about 3 minutes for `mut`, much longer for `base`).
- `LS47_VARIANT=base|mut npx vitest run packages/ops/src/spike-mutable-ls47.test.ts -t measure --reporter=verbose --disableConsoleIntercept`.
- `npx vitest run packages/ops/src/spike-mutable-small.test.ts --reporter=verbose --disableConsoleIntercept` for RC4 and Levenshtein.
- `npx vitest run packages/lang` for the language suite with the prototype in place.
