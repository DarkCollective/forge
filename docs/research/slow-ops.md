# Slow operations: marking them, and moving primitives back to FL

Status: design proposal, written to consider later. Nothing here is implemented, and the options in section 9 are for the owner to choose between. One decision is recorded (section 4). Every statement about a primitive comes from the header comment of its file in `packages/ops/src/prims/`, and every statement about the language from `docs/LANGUAGE.md` or `docs/PLAN.md`. Where a number is not in those, it says "to measure".

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

No snail marker is needed for these. "Remaining doubt" is what the header or the docs leave open.

| Primitive | Gap it was written for (from its header) | v0.2 feature | Remaining doubt |
|---|---|---|---|
| `cobs:_starts` | Block offsets need a growing list; quadratic, `E_LIMIT_TOTAL` at 64 KiB of one-byte blocks | `collect`, `emit` (LANGUAGE §8: linear time and allocation, `maxTotalBytes` charged once) | Steps per block: to measure |
| `tlv:_parse` | Growing the result list per element is quadratic | `collect` | Each element is a record with lists of ints for key and value; step and size cost: to measure |
| `http:_dechunk` | Collecting 10,900 chunks grows a bytes value each time (`E_LIMIT_TOTAL` after 0.2 s untrusted) | `collect-bytes`, `emit-all` | Steps per chunk: to measure |
| `tar:_headers` | Offsets depend on the previous size field; growing a list is quadratic (12,000 entries took over 30 s) | `collect` | Covers `_headers` only. `_oct` (about 250 steps, six times a header) and `_sum` (about 2,500 steps) are step-cost reasons, not list reasons: not confirmed |
| `zip:_cd-offsets` | Central directory walk, quadratic in FL | `collect` | Steps per entry: to measure. The other zip helpers wrap fflate and stay |
| `asn1:parse-in` (growing lists only) | A record per element at a few hundred VM steps, and quadratic lists | `collect` fixes the lists only | Not confirmed: wave 7 records 245 steps an element, which does not fit a 64 KiB structure. Keep |
| `packets:_name`, `asn1:oid-name`, `oid-short`, `oid-find` | No per-vocabulary constants, so an FL table is rebuilt on every call | `MEMO:` (LANGUAGE §5.13: built once, a hit is one step), with `has-key?` for the lookup | The tables are TypeScript data (`packets-names.ts`, `asn1-oids.ts`) and would have to be written in FL. The first-use build is charged to the run (the TLS registries alone have about 335 cipher suites): to measure under 5M steps |
| CRC table rebuild (about 20,000 steps a call, wave 3) | Rebuilt on every call | `MEMO:`, for the part that does not depend on the preset | A `MEMO:` word has no inputs, so a table per polynomial cannot be one. Only the 171-line preset text can be memoised. Partly confirmed |
| `generate-all:_crcs` | Parsing the preset table and calling the words once per preset | `MEMO:` for the parsed table | The per-byte loop (about 13 steps a byte, for up to 171 presets) is the other reason. Keep |
| `charset` table rebuild | Rebuilt on every call (`mime` works around it) | `MEMO:` | The tables are already FL, so this is an adoption, not a dropped primitive. `charset:_decode` stays (section 8) |
| `analysis:_log2` | Core had no logarithm | `log2` (LANGUAGE §13, maths words) | Confirmed for the stated reason. Equal results to the TypeScript value: to measure |
| `coords:_math`, `coords:_atan2` | Core had no trigonometric or hyperbolic functions | `sin`, `cos`, `atan`, `atan2` and the other maths words | Confirmed for the stated reason. That every function `_math` offers has an FL word, and equal results to the last digit: to measure |
| `list:sort`, `list:sort-by` | No sort word | `sort`; `sort-by ( list quot -- list )` | The signatures differ: the prim's `sort-by` takes a keys list, the core word a quotation. Its mixed-type `E_COERCE` and its code point order against the core's behaviour: to check. `list:shuffle` stays, since it needs swaps |
| `float` (part) | No parse of decimal text to a float | `str>num` | The parse only. Reinterpreting float bits, and NaN and infinity, remain, so `float` stays |

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

## 8. Must stay primitives

- Too slow even on small input: Bombe (tens of millions of simple operations per rotor order), QR (a version 40 symbol has 31,329 modules, each mask scored).
- Library wrappers: noble (AES, ChaCha, BLAKE, Argon2, ECDSA and others), fflate (deflate, zip), yaml, jsonata, xpath, css, and the compressors (brotli, bzip2, lz4, lzma, zstd).
- Capability gaps: `charset:_decode` (TextDecoder), `unicode:_normalize`, `datetime` (Intl zone rules), `random`, `clock`.
- Shared by common paths: CRC-32 and Adler-32 (gzip, zip), JSON and CSV scanners, DES (Triple DES, the LM hash, CMAC), Blowfish (bcrypt). A snail on these would mark common work.
- File-sized forensic inputs: LZNT1 (12 to 49 steps an output byte in a prototype) and XPRESS.

## 9. Suggested next steps (options for the owner)

1. A measurement spike: prototype LS47, MD4, Whirlpool and AMF in FL and record steps per byte or element. That gives a "comfortable up to" size for each, and shows whether a snail marker is needed at all.
2. A work package that moves the section 5 primitives back to FL with vectors unchanged. Hash and catalogue version changes are accepted (section 4).
3. A decision on the snail UX of section 3, including whether a bake may raise its limits and for which recipes.
4. A decision on a core mutable byte array. It would unlock most of section 6(a) and much of section 7, and it is a change to the language, so it is the largest of the four.
