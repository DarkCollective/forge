# Slow operations: marking them, and moving primitives back to FL

Status: design proposal, partly carried out (2026-11-16). The section 5 primitives that FL v0.2 could replace have been moved back to FL, apart from the rows marked not done, and MD4 and LS47 have moved too (outcome notes in sections 7a and 9). The snail marker, the Whirlpool and AMF moves and the mutable array are still for the owner to decide (section 9). One decision is recorded (section 4), and the measurement spike is recorded in section 7a. Every statement about a primitive comes from the header comment of its file in `packages/ops/src/prims/`, and every statement about the language from `docs/LANGUAGE.md` or `docs/PLAN.md`. Where a number is not in those, it says "to measure".

## 1. The idea

Some rare operations are slow when written in FL. The owner's idea is to mark them as slow (for example with a snail icon) and, when one is added to a recipe while auto-bake is on, to offer a choice: turn auto-bake off, or continue. If that works, a rare op no longer needs a TypeScript primitive just for speed, and PLAN §3.5 ("FL first") can be followed more strictly.

## 2. The constraint: a slow FL op usually fails, it does not run slowly

PLAN WP 1.6 sets the VM at 1e6 simple steps in under 200 ms, about 5 million steps a second. The limits are:

| Limit | Trusted default | Untrusted |
|---|---|---|
| `maxSteps` | 10 000 000 | 5 000 000 |
| `maxTotalBytes` | 1 GiB | 256 MiB |
| `maxMillis` | 30 000 | 10 000 |

(`packages/lang/src/types.ts`, `packages/worker/src/types.ts`.) So a slow op does not take a minute. At that speed it reaches `E_LIMIT_STEPS` after 1 to 2 seconds, or `E_LIMIT_TOTAL` sooner, and the bake fails. The 10 second untrusted deadline is not the limit that bites for step-bound code.

The web app bakes everything with `trust: "untrusted"` (`apps/web/src/bake/controller.ts`, in `run`). A marker that only pauses auto-bake therefore does not help: a manual bake fails the same way. It helps only if the user can also raise the limits for that bake, and only for a recipe the user wrote or trusts. A recipe from a shared link must stay under the untrusted limits. Raising limits is a separate feature (a per-bake "allow more time" choice) and needs its own decision.

Cancellation, as found: `BakerClient.bake` (`packages/worker/src/client.ts`) cancels the active bake before it starts a new one, and terminates the worker if it has not stopped within the 1 second grace. In the controller, a newer bake makes the older one's result be discarded (the `seq` check). Auto-bake is debounced (`debounceMs` 300, `autoBake` true by default, `apps/web/src/state/actions.ts`), and the pending debounce is cancelled when auto-bake is switched off. So typing during a slow bake does cancel it; the cost is a restart from the start of the recipe each time.

## 3. Suggested UX refinement

Trigger on how long a bake takes, not on adding the op. A snail op on 40 bytes is instant, and a warning there would be noise.

- The Operations pane shows the snail on the op, with a measured note such as "comfortable up to ~N KB". N comes from the measurement spike (section 9); until then it is "to measure".
- When a bake that includes a snail op takes longer than about 500 ms, auto-bake is paused for that recipe, with a bar: "Auto-bake paused: Snefru is slow on this input. [Resume] [Keep paused]". The 500 ms figure is a suggestion.
- Magic (PLAN WP 6.29) skips snail ops. It runs candidates under the untrusted limits and a deadline, and a slow candidate would use up that deadline.
- Metadata: a `META:` clause, for example `slow "comfortable up to 64 KiB" ;`, or a bare `slow ;` with the size taken from a test. The wording is a suggestion only. A new clause changes the language (the clause list in LANGUAGE.md §5.9), so it is an FL change as well as a UI one.

## 4. Decided: hashes and the catalogue version

Decided by the owner on 2026-11-13: changing word hashes and the catalogue version is acceptable. Forge is unreleased, so there are practically no consequences. Moving primitives back to FL, and adopting the FL v0.2 forms in the vocabularies, is therefore not blocked on that question. (PLAN, in the notes to waves 5 and 7, says the vocabularies have not yet adopted the v0.2 forms.)

## 5. Primitives that FL v0.2 already lets us drop

No snail marker is needed for these. The last column was added on 2026-11-16 and says what was done (commits are on `main`). "Remaining doubt" is what the header or the docs leave open.

| Primitive | Gap it was written for (from its header) | v0.2 feature | Remaining doubt | Status |
|---|---|---|---|---|
| `cobs:_starts` | Block offsets need a growing list; quadratic, `E_LIMIT_TOTAL` at 64 KiB of one-byte blocks | `collect`, `emit` (LANGUAGE §8: linear time and allocation, `maxTotalBytes` charged once) | Steps per block: to measure | Done, b500639 (merge 9f9b090) |
| `tlv:_parse` | Growing the result list per element is quadratic | `collect` | Each element is a record with lists of ints for key and value; step and size cost: to measure | Done, b500639 (merge 9f9b090) |
| `http:_dechunk` | Collecting 10,900 chunks grows a bytes value each time (`E_LIMIT_TOTAL` after 0.2 s untrusted) | `collect-bytes`, `emit-all` | Steps per chunk: to measure | Done, b500639 (merge 9f9b090) |
| `tar:_headers` | Offsets depend on the previous size field; growing a list is quadratic (12,000 entries took over 30 s) | `collect` | Covers `_headers` only. `_oct` (about 250 steps, six times a header) and `_sum` (about 2,500 steps) are step-cost reasons, not list reasons: not confirmed | Done, 9605ce3 (merge ffc1646); `_oct` and `_sum` stay primitives |
| `zip:_cd-offsets` | Central directory walk, quadratic in FL | `collect` | Steps per entry: to measure. The other zip helpers wrap fflate and stay | Done, 9605ce3 (merge ffc1646); `_extract` stays |
| `asn1:parse-in` (growing lists only) | A record per element at a few hundred VM steps, and quadratic lists | `collect` fixes the lists only | Not confirmed: wave 7 records 245 steps an element, which does not fit a 64 KiB structure. Keep | Not done: keep |
| `packets:_name`, `asn1:oid-name`, `oid-short`, `oid-find` | No per-vocabulary constants, so an FL table is rebuilt on every call | `MEMO:` (LANGUAGE §5.13: built once, a hit is one step), with `has-key?` for the lookup | The tables are TypeScript data (`packets-names.ts`, `asn1-oids.ts`) and would have to be written in FL. The first-use build is charged to the run (the TLS registries alone have about 335 cipher suites): to measure under 5M steps | Not done |
| CRC table rebuild (about 20,000 steps a call, wave 3) | Rebuilt on every call | `MEMO:`, for the part that does not depend on the preset | A `MEMO:` word has no inputs, so a table per polynomial cannot be one. Only the 171-line preset text can be memoised. Partly confirmed | Not done |
| `generate-all:_crcs` | Parsing the preset table and calling the words once per preset | `MEMO:` for the parsed table | The per-byte loop (about 13 steps a byte, for up to 171 presets) is the other reason. Keep | Not done: keep |
| `charset` table rebuild | Rebuilt on every call (`mime` works around it) | `MEMO:` | The tables are already FL, so this is an adoption, not a dropped primitive. `charset:_decode` stays (section 8) | Not done |
| `analysis:_log2` | Core had no logarithm | `log2` (LANGUAGE §13, maths words) | Confirmed for the stated reason. Equal results to the TypeScript value: to measure | Done, 31d3a89 |
| `coords:_math`, `coords:_atan2` | Core had no trigonometric or hyperbolic functions | `sin`, `cos`, `atan`, `atan2` and the other maths words | Confirmed for the stated reason. That every function `_math` offers has an FL word, and equal results to the last digit: to measure | Done, 31d3a89 |
| `list:sort`, `list:sort-by` | No sort word | `sort`; `sort-by ( list quot -- list )` | The signatures differ: the prim's `sort-by` takes a keys list, the core word a quotation. Its mixed-type `E_COERCE` and its code point order against the core's behaviour: to check. `list:shuffle` stays, since it needs swaps | Done, 31d3a89 (`list:shuffle` is FL too, over `random:below`) |
| `float` (part) | No parse of decimal text to a float | `str>num` | The parse only. Reinterpreting float bits, and NaN and infinity, remain, so `float` stays | Not done: `float` stays |

## 6. Gaps still open

(a) No fast mutable array and no per-element state. This keeps SIGABA, LS47, Bombe, RC4, Rabbit, GOST meshing, Levenshtein (about 39 steps a cell) and the Myers diff as primitives, and `list:shuffle`. v0.2 did not change it.

(b) The cost of a per-byte loop, about 13 VM steps a byte (wave 6). That caps a payload near 750 KB at the default limit and near 380 KB untrusted. LANGUAGE §8 says `map`, `reduce` and `each` over `bytes` hand the body each byte as an `int`, and `map` on bytes returns bytes. A `bytes` value is sized at its byte length (§10.8), against 16 bytes an element for a list of ints. So the wave 6 complaint about the 16-bytes-per-element list is answered for these combinators, and only the step cost remains (with one extra step per iteration, §10). Whether the shared Adler-32 and CRC-32 loops could run in FL is then a step-cost question: to measure.

(c) `num` cannot hold NaN or infinity, so the float conversions stay.

## 7. Candidates for a snail marker

Speed-only primitives, written by us (not library wrappers), for rare operations usually run on short input. "Array" marks those that also need gap (a) closed, where a header says so; "to confirm" where it does not.

| Group | Primitives | Notes |
|---|---|---|
| State machines | LS47 (`classical:_ls47`, about 800 steps a letter; 54 million steps for 64 KiB), SIGABA (`_run`; about 26 steps a rotor pass, 25 passes a letter) | Array |
| Rare hashes written from the spec | MD2, MD4, MD6, SHA-0, HAS-160, Snefru, Whirlpool, RIPEMD-128/256/320, Streebog, GOST R 34.11-94, SM3 | Headers say too slow in FL at 64 KiB, or equivalent. Whether MD2, Snefru, Whirlpool and Streebog (lookup tables) need an array: to confirm. `generate-all:hashes` runs them all at once, so a snail there would show on every run |
| Rare ciphers | RC2, RC6, PRESENT, XXTEA, GOST 28147, Rabbit, CipherSaber-2 | Rabbit (counter and state variables) and CipherSaber-2 (RC4 state) are Array. The others: to confirm |
| Data formats | AMF, Avro, Rison, plist | AMF and Avro readers cost several hundred VM steps an element; Rison and plist are character scanners at 5.5 steps a character before any state. Array not named in the headers |
| Maybe | Levenshtein, ssdeep | Levenshtein is Array (about 39 steps a cell); ssdeep is 60 to 100 steps a byte, 4 to 7 million for one 64 KiB pass, and may need several passes |

## 7a. Measurement spike (2026-11-16)

Four primitives were prototyped in pure FL (v0.2) on unmerged branches. Each prototype matched the primitive on all the op's vectors and on seeded random inputs. Steps are VM steps; the limits are 5,000,000 steps for untrusted bakes (the web app bakes everything untrusted) and 10,000,000 for trusted ones, with a default `maxTotalBytes` of 256 MiB untrusted and 1 GiB trusted. Each prototype is `packages/ops/spike/<op>.fth` with `packages/ops/src/spike-<op>.test.ts`, so it can be reused when the op is moved.

| Op (branch, commit) | Unit | Steps per unit | At 64 KiB: steps, FL time | Primitive at 64 KiB | Largest input under 5M / 10M steps | Binding limit | Lines, FL / TS |
|---|---|---|---|---|---|---|---|
| MD4 (`wp/spike-md4`, 80dc09f) | byte | about 38.4 | 2,516,022; 400 ms | 0.47 ms (about 850x) | 130,359 B (813 ms) / 260,727 B (1,549 ms) | Steps; 500 ms is reached at about 80 KiB | 46 / 52 |
| LS47 (`wp/spike-ls47`, ded1980) | letter | 55 (decrypt 53) | 3,605,522; 475 ms | 5.9 ms | 90,668 letters (659 ms, cold) / 181,550 (1,348 ms) | Steps; 500 ms is reached at about 64 KiB | 80 / about 45 |
| Whirlpool (`wp/spike-whirlpool`, adf04b7) | byte | about 38.1 | 2,496,978; 910 ms | 2.2 ms (about 400x) | about 131 KB (1.8 s) / about 262 KB (3.9 s) | Wall time; 500 ms is reached at about 35 KiB | 91 / 98 |
| AMF decoder (`wp/spike-amf`, 4eaffae) | element | about 95-225 (11-39 a byte) | 722,719 (flat AMF0, 78 ms) to 2.5M (objects, AMF3 with references; 1.5 s) | 0.6-2.4 ms | Not reached | Total allocation: `E_LIMIT_TOTAL` at about 40-150 KB | 272 / 396 |

MD4 costs about 2,455 steps a 64-byte block plus about 672 fixed. The TS is 52 lines and also uses four `hash-util.ts` helpers, not counted. Missing: a fixed-width `rotl32` and masked add would save about 25-30% (estimate). A mutable array would not help much.

LS47 costs 55 steps a letter, against about 800 for the WP 5.9 FL version (14.5x fewer). The one-off `MEMO:` table build is 11,815 steps. The board is held inverted (letter to place), so a rotation or offset move is one `translate` through a `MEMO:` table (7 row, 7 column, 49 add and 49 subtract tables); version 1 cost 104 steps a letter and version 2 added the add and subtract tables. The 80 FL lines are about 36 for the cipher and about 44 building tables once. Wall time is dominated by allocating small values per letter. Missing: a mutable array or indexed update would cut it to about 15-25 steps a letter, and a bytes `index-of` would save about 10 a letter (both estimates).

Whirlpool costs about 2,436 steps a block plus about 2,514 fixed; the one-off table build is about 11,404 steps (2.2 ms). The whole state, with the key schedule, is one wide integer (1536 bits), so bitwise words act on the whole state at once, and the S-box is a hex round trip through `translate`. A step here costs about 2.5x an MD4 step in time (big-integer work), so wall time reaches the 500 ms snail threshold before steps do. Missing: a one-step bytes to int would save about 5%, and a lane-wise 64-bit rotate about 40% a round (estimates). A lookup-table design would cost about 500 steps a byte (estimate, not built).

AMF0 and AMF3 are complete, including all three AMF3 reference tables. All 116 decode vectors agree (77 values, 39 errors), as do 240 random values. Gaps: a non-integer double dictionary key is refused; dates beyond year 9999 differ; all errors are `E_COERCE` without offsets; the `maxValueBytes` meter is not replicated. It uses `float:decode` for doubles, itself a primitive. Cost is about 95-110 steps an element for a flat array of ints and strings and 120-225 for lists of 5-field objects. Main finding: the step limit is not the binding one. The reference tables grow by `put` and `append`, which copy, so total allocation is quadratic, and with default limits the decoder hits `E_LIMIT_TOTAL` at about 40-150 KB of input (about 6,000-18,000 elements), where steps alone would allow 130-450 KB. Missing: update-in-place for lists or records; mutual recursion (it goes through quotations); `:>` inside `{ }` (so each `case` action needs a helper); `case` and `cond` rebuilding their quotations per call; a big-endian read at an offset and a float-bits word in core; tail calls.

**Outcome (2026-11-16).** MD4 and LS47 moved to FL in 23ea242 (`md4:_hash` and `classical:_ls47` are no longer primitives), MD4 was switched to the new words in 89c74c1, and both were merged in dc9d0d1 ("Merge WP: MD4 and LS47 in FL"). The new core words (`be-bytes>int`, `le-bytes>int`, `int>be-bytes` now native, `int>le-bytes`, `rotl`, `rotr`; `docs/LANGUAGE.md` section 13) took the shipped MD4 at 64 KiB from 2,516,727 steps (FL, before the new words) to 1,975,151 (with `rotl`, `le-bytes>int` and `int>le-bytes`), about -21.5%; `generate-all:hashes` is 1,980,589. The study (`docs/research/int-words.md`) measured -25.4% on its prototype (2,515,651 to 1,876,046); the estimate above was 25 to 30%. The new words are 21b4c36 (merge c25c344). `nthash:digest` runs MD4 over UTF-16LE text at about 84 steps a character, so the largest text under the untrusted limits is about 59,000 characters (58,000 took 4,884,038 steps). Held back: the lane-wise rotates and `addw`. The LS47 estimate above was wrong: a mutable board costs 163 steps a letter, against 55 for the tables, so a mutable array does not help LS47 (`docs/research/mutable-array.md`). That study recommends a copying `set-nth` and a bytes `index-of` now, and a restricted `array` type later.

Conclusions the spike supports:

- All four fit realistic CTF inputs (a few KB) in a few ms, so each could be a snail op rather than a primitive. In wall time at 64 KiB FL is about 80x (LS47) to about 2,500x (AMF, worst case) slower than the primitive, from the figures above.
- The 500 ms snail threshold, not the step limit, is reached first for Whirlpool (about 35 KiB) and LS47 (about 64 KiB). MD4 reaches it at about 80 KiB.
- For AMF the binding limit is total allocation, not steps, and a snail marker cannot fix that. It needs update-in-place.
- Language gaps, ranked by how many spikes hit them: (1) mutable or indexed update (LS47, AMF, and section 6(a)); (2) fixed-width word operations such as rotate and masked add, and bytes to int at an offset (MD4, Whirlpool, AMF); (3) smaller ones: mutual recursion, `:>` in `{ }`, tail calls.
- Compactness: FL was 46/52, 80/45, 91/98 and 272/396 lines against TS. FL is about as compact or more so for the hashes and the decoder, but LS47 is longer because its speed comes from precomputed tables. This is a weaker result than the 2.5x of the CRC comparison.

## 8. Must stay primitives

- Too slow even on small input: Bombe (tens of millions of simple operations per rotor order), QR (a version 40 symbol has 31,329 modules, each mask scored).
- Library wrappers: noble (AES, ChaCha, BLAKE, Argon2, ECDSA and others), fflate (deflate, zip), yaml, jsonata, xpath, css, and the compressors (brotli, bzip2, lz4, lzma, zstd).
- Capability gaps: `charset:_decode` (TextDecoder), `unicode:_normalize`, `datetime` (Intl zone rules), `random`, `clock`.
- Shared by common paths: CRC-32 and Adler-32 (gzip, zip), JSON and CSV scanners, DES (Triple DES, the LM hash, CMAC), Blowfish (bcrypt). A snail on these would mark common work.
- File-sized forensic inputs: LZNT1 (12 to 49 steps an output byte in a prototype) and XPRESS.

## 9. Suggested next steps (options for the owner)

**Outcome (2026-11-16).** Step 2 is done for section 5, apart from the rows marked not done there: `cobs:_starts`, `tlv:_parse`, `http:_dechunk`, `tar:_headers`, `zip:_cd-offsets`, `analysis:_log2`, the `coords` helpers, `list:sort` and `list:sort-by`, and the `cmac` and `lmhash` block calls are FL, and so are MD4 and LS47 from the spike branches. The new integer words took about 21.5% of the steps of the shipped MD4 (the study measured 25.4% on its prototype). Step 4 was studied in `docs/research/mutable-array.md` and is not decided; that study corrects the LS47 estimate in section 7a (a mutable array does not help it) and recommends the copying `set-nth` and bytes `index-of` first. Step 3 (the snail UX) and the Whirlpool and AMF moves are open.

1. Done: the measurement spike (section 7a). It gives a "comfortable up to" size for MD4, LS47 and Whirlpool, and shows that AMF is limited by allocation, not steps.
2. A work package that moves the section 5 primitives back to FL with vectors unchanged. Hash and catalogue version changes are accepted (section 4). It could also start with MD4 and LS47 from the spike branches. Whirlpool needs the snail marker first, and AMF waits for update-in-place.
3. A decision on the snail UX of section 3, including whether a bake may raise its limits and for which recipes.
4. A decision on a core mutable byte array, or at least update-in-place for lists and records. The spike makes this the most-hit gap (LS47, AMF), and AMF cannot move without it. It would unlock most of section 6(a) and much of section 7, and it is a change to the language, so it is the largest of the four.
