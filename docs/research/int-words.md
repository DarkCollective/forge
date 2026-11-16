# Integer and bytes words for FL: a measurement study

Status: decided and implemented, 2026-11-16. Five new words and a native `int>be-bytes` are in `core` (branch `wp/core-int-words`, [LANGUAGE.md](../LANGUAGE.md) §13 and §A.7). `rotl-lanes`, `rotr-lanes` and `addw` were prototyped and measured on `wp/study-int-words` and are held back; the numbers that decided it are in sections 2 to 4. A new core word is a language change approved per wave, and the owner approved this one.

## 1. The candidates

Nine words were prototyped (six of them, with `int>be-bytes` counted once, are now in the language; the lane-wise rotates and `addw` are held back) in `packages/lang/src/vocab/intwords.ts`, all kind P, all metered as one step like `shl`.

- Reads: `be-bytes>int` and `le-bytes>int`, `( data:bytes p:int n:int -- int )`, the n bytes at offset p as an unsigned integer. A negative p or n, or a read past the end, is the `slice` E_RANGE. A result over `maxIntBits` is E_LIMIT_VALUE, checked before computing.
- Writes: `int>be-bytes` and `int>le-bytes`, `( v:int n:int -- bytes )`, the low n bytes of v (two's complement for a negative v). A negative n is E_RANGE. `int>be-bytes` already exists as a prelude word; the prototype replaces it with a primitive of the same name and effect, and the only change in behaviour is that a negative n is now an error.
- Rotates: `rotl` and `rotr`, `( v:int k:int width:int -- int )`, and the lane-wise `rotl-lanes` and `rotr-lanes` with the same effect, where v is a non-negative integer holding width-bit lanes (lane 0 lowest). `k` is taken modulo width; width under 1 or a negative k is E_RANGE; a width over `maxIntBits` is E_LIMIT_VALUE.
- `addw ( a:int b:int width:int -- int )`, the sum modulo 2^width.

The prototype passes the whole lang suite (1,740 tests, with new tests in `intwords.test.ts` and the table of `docs/LANGUAGE.md` §13 updated to 163 words). The implemented set has no lane-wise rotates or `addw`, so `core` has 160 words.

## 2. Measurements at 64 KiB

Each variant of each spike was checked against the shipped primitive (md4 and whirlpool on 14 lengths from 0 to 700 bytes; AMF on the 116 decode vectors against the original spike, and on the 64 KiB inputs against the primitive). Steps are VM steps; times are the median of three runs on one laptop and are noisy by about 5%.

| Op and variant | Steps | Change | FL time |
|---|---|---|---|
| MD4, original spike | 2,515,651 | | 402 ms |
| MD4, bytes words and `rotl` | 1,876,046 | -25.4% | 258 ms |
| MD4, and `addw` as well | 1,822,746 | -27.5% | 235 ms |
| Whirlpool, original spike | 2,496,978 | | 971 ms |
| Whirlpool, bytes words only | 2,430,337 | -2.7% | 923 ms |
| Whirlpool, `rotr-lanes` only (in theta) | 1,994,728 | -20.1% | 773 ms |
| Whirlpool, both | 1,928,087 | -22.8% | 785 ms |
| AMF0 list of ints and strings (6,722 elements) | 722,719 to 699,161 | -3.3% | 84 to 79 ms |
| AMF0 list of 5-field records (5,371 elements) | 830,854 to 774,431 | -6.8% | 167 to 155 ms |
| AMF3, both shapes | unchanged | 0% | |

AMF3 does not change because it reads no fixed-width integers except in doubles (variable-length integers are built byte by byte, and doubles go through `float:decode`). A float-bits read was not prototyped, so the 25 to 40 steps per double in the spike is untouched; with about one double per five-field record it would be about 5% of the record shape (estimate, not measured). Only AMF0 and AMF3 at 64 KiB were measured, as the brief allowed; the full 8-minute harness was not run.

Per-call costs, measured in the console (steps beyond the operands): a 4-byte `util:be-int` costs 39 steps, an 8-byte one 63, a 4-byte `le-int` 40. The same read as a hex round trip (`slice bytes>hex 16 str>int-radix`) costs 11 whatever the length, and the native word 1. The FL `int>be-bytes` costs 63 steps for 4 bytes and 119 for 8; a hex form (mask, `pad-hex`, `hex>bytes`) costs 40; the native word 1. A hand-written 32-bit rotate costs 12 steps, `rotl` 1; `+ 0xffffffff band` costs 3 where `32 addw` costs 2.

The spike's estimates were close for MD4 (25 to 30%) but too high for Whirlpool: the lane-wise rotate saves 20% of the whole run, not 40% a round, because the S-box step (a hex round trip through `translate`) and `pi` are untouched, and Whirlpool's wall time is bignum arithmetic, so it still reaches 500 ms at about 35 KiB. The bytes words save only 3% there.

## 3. Call sites in `packages/ops/vocab`

Counted after removing comments and string literals.

| Pattern | Sites | Where |
|---|---|---|
| `util:be-int` | 51 | `packets` 44, `id3` 6, `exif` 1 |
| `util:le-int` | 6 | `lz4` 3, `deflate` 2, `zip` 1 |
| `256 digits>int` (a whole bytes value read as an integer) | 26 | 19 files |
| `rev 256 digits>int` (little-endian whole value) | 4 | `blockmode`, `datetime`, `exif`, `util` |
| `int>be-bytes` | 50 | 26 files, `uuid` 7, `asn1` 8, `lz4` 5 |
| `int>be-bytes rev` (a little-endian write) | 7 | `deflate` 2, `lz4` 2, `blockmode`, `datetime`, `zip` |
| `16 str>int-radix` | 29 | mostly text parsing, not byte reads; one is a bytes read (`rsa`) |
| Hand-written rotation (`shl ... shr ... bor`) | 3 | `murmur3` (`_rotl32`), `bits` (two 8-bit rotates inside `translate`) |
| `0xffffffff band` after an add or rotate | 3 | `murmur3` |

No primitive's header says it exists because FL lacks one of these words. The headers that give a reason (`sm3`, `whirlpool`, `amf`) say "too slow in FL" or give the alloc cost. Fifteen primitives in `src/prims` rotate words (`sm3`, `ripemd`, `sha0`, `has160`, `md4`, `rc6`, `twofish` and others), but a 25% saving on MD4, the best case, leaves it about 1.8 million steps at 64 KiB and about 500x slower than the primitive. No primitive moves back to FL because of these words.

## 4. Recommendation per word

The test: add if some realistic op saves 10% of steps, or the word replaces a pattern at 10 or more call sites, or a primitive can move back to FL.

| Word | Steps saved | Call sites | Moves a primitive | Verdict |
|---|---|---|---|---|
| `be-bytes>int`, `le-bytes>int` | 3% Whirlpool, 3 to 7% AMF0, about 4% MD4 | 57, plus 30 whole-value reads | no | Add (sites test). Each call goes from 39 to 1 step, and `packets` has 44 calls. |
| `int>le-bytes`, native `int>be-bytes` | under 1% in the spikes | 50 and 7 | no | Add (sites test). 63 steps a 4-byte write becomes 1, and the seven `rev` forms lose a word. |
| `rotl`, `rotr` | MD4 about 21% (of the 25.4%) | 3 | no | Add (steps test). Any 32-bit hash or cipher written in FL gains about a fifth. |
| `rotl-lanes`, `rotr-lanes` | Whirlpool 20% | 0 | no | Do not add on this evidence. Only one prototype uses it, and the 20% is below the 40% hoped for. Revisit if a second SWAR-style op appears. |
| `addw` | 2.1% on top of MD4 | 0 | no | Do not add. `+ mask band` is two words where `width addw` is two, so it saves one step per add. |

Caveat, and a cheaper route for the reads. Without any language change, `util:be-int`, `le-int` and `digits>int` at radix 256 could be rewritten through the hex round trip (11 steps, flat in length), which captures about 70% of the read saving for free. The empty read (n of 0) would need a guard, because an empty hex string does not parse. That route does nothing for the write (40 steps at best) or the rotate, and the native reads still win by one step against eleven, so the verdict above stands, but the owner may prefer the FL fix as a first, no-risk step.

Two design points for the owner.

- Whole-value reads (`256 digits>int`, 26 sites) are better served by a two-argument form than by `data 0 data len be-bytes>int`. If wanted, a separate `bytes>int ( bytes -- int )` pair would be the cleaner replacement; it was not prototyped.
- Turning `int>be-bytes` from a prelude word into a primitive changes its word hash and the hash of every FL word that calls it (§12.4), and makes a negative n an error. The `@forge/ops` test that compares the prelude with `util` needs the same attention, and the prelude shrinks to 19 words. If hash stability matters more than speed, leave `int>be-bytes` in the prelude and add only `int>le-bytes` and the readers.

## 5. What implementing properly would touch

- `packages/lang/src/vocab/intwords.ts` (or `core.ts`), registered in `CORE_PRIMITIVES`; `prelude.ts` loses `int>be-bytes` if it becomes a primitive.
- `docs/LANGUAGE.md`: the table rows (§13.2 to §13.5, §13.8), the totals in §13.8 and Appendix A, and the opening status paragraph. A new `docs/LANGUAGE-0.3.md` proposal in the style of `LANGUAGE-0.2.md`, since the table tests compare names, kinds and effects.
- Tests: `core.test.ts`, `runtime.test.ts`, `prelude.test.ts` (counts), the conformance cases of `LANGUAGE.md` (the `C` numbers), and `intwords.test.ts` (reference-checked reads, writes and rotates, errors, limits).
- `packages/ops`: switch `util:be-int`, `le-int` and the `rev` writes to the new words (the `util` words could become one-line wrappers), and re-run the equivalence test and `npm run dupes`.
- The editor plugin: `../forge-plugin/src/main/resources/builtins/builtins.json` lists every core word with its kind, effect and doc, and `src/test/testData/corpus` has `.fth` files that use them. Each new word needs a row there.
- The spike files and harnesses added on this branch are throwaway and do not typecheck cleanly under `tsc` (the original spike branches have the same errors); do not merge them.

## 6. Decision and results

Decision (the owner, 2026-11-16): add `be-bytes>int`, `le-bytes>int`, `int>le-bytes`, a native `int>be-bytes` (replacing the prelude word, and accepting the hash change) and `rotl`, `rotr`, with the names and effects of section 1. Held back, with the numbers that went against them: `rotl-lanes` and `rotr-lanes` (20% of Whirlpool, no call site in the vocabularies, one user) and `addw` (2.1 points of MD4, one step saved per add).

Callers of `int>be-bytes` cannot pass a negative count, which is now `E_RANGE`: every count in `packages/ops/vocab` is a literal, a block or key size already checked positive (`blockmode` `bs` goes through `ceil-div` first, `crc` width is 1 to 82, `fletcher` size is a choice of 8 to 64, `ecdsa` and `gost3410` sizes are curve constants), or the length of a value (`cmac`).

Vocabularies switched, with VM steps before and after (one run, 64 KiB input where the op takes one; the full suite also passes unchanged):

| Op | Steps before | Steps after | Change |
|---|---|---|---|
| `murmur3:digest`, 64 KiB (`_rotl`) | 1,622,144 | 1,392,705 | -14.1% (time 334 to 277 ms) |
| `bits:rotate-left` or `rotate-right`, 64 KiB | 3,341 | 1,293 | -61% |
| `lz4:compress`, 64 KiB (header writes) | 384 | 137 | -64% (fixed saving) |
| `lz4:decompress` | 514 | 294 | -43% (fixed saving) |
| `deflate:gzip`, 64 KiB | 448 | 236 | -47% (fixed saving) |
| `deflate:gunzip` | 363 | 266 | -27% (fixed saving) |
| `zip:zip`, 64 KiB | 2,128 | 597 | -72% (fixed saving) |
| `zip:unzip` (one entry) | 2,193 | 1,392 | -37% (fixed saving) |

The big percentages on `lz4`, `gzip` and `zip` are a fixed saving of a few hundred steps on small outputs (the work itself is in primitives); they say nothing about 64 KiB cost. `util:be-int` and `util:le-int` are now one-line wrappers over the readers, so each of their 57 callers saves about 38 steps a call (39 down to one, plus the wrapper call). `blockmode` (CTR little-endian counter) and `datetime` saved the `rev` word per call and were not measured separately. MD4 is not switched here; section 2 shows it would go from 2,515,651 to 1,876,046 steps at 64 KiB.
