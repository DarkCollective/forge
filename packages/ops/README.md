# @forge/ops

The operation vocabularies of Forge: 102 ops in 36 vocabularies, written in FL (the Forth-like Forge language), plus the build-time catalogue and the loaders that make them available in Node and in the browser.

The package holds:

- `vocab/` the FL sources (`.fth`) and their test vectors (`.test.json`);
- `src/prims/` the few TypeScript primitives that FL cannot replace;
- `src/` the loaders (Node fs provider and Vite `import.meta.glob`), the dependency scan, and the catalogue builder;
- `dist/catalogue.json` the catalogue, derived from the vocabularies at build time (`npm run build`). Nothing is registered by hand.

## Layout per vocabulary

For a vocabulary `<v>`:

| File                  | Holds                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| `vocab/<v>.fth`       | the words, with their stack-effect headers and `META:` blocks                  |
| `vocab/<v>.test.json` | the op test vectors (schema: `vocab/vectors.schema.json`, spec: RECIPES.md §9) |
| `src/prims/<v>.ts`    | optional: primitives, only when FL cannot do the job (see below)               |
| `src/<v>.test.ts`     | tests of the FL vocabulary                                                     |

`src/prims/` holds only primitive modules and their tests (`src/prims/<v>.test.ts`). Tests of FL vocabularies go in `src/<v>.test.ts`. The package tests derive the vocabulary list from disk, so a new vocabulary is picked up without registering it. A qualified `see-also` counts as a load dependency, as does `USING:`.

## FL first

Ops are written in FL wherever feasible. A TypeScript primitive is allowed only when the core cannot express something (the core has no logarithm, so `analysis:_log2` is a primitive) or when FL is too slow on realistic input, measured at 64 KiB. Then the primitive is a minimal private `_helper`, and the op logic and metadata stay in FL.

FL's own `fail` raises only `E_USER`. Typed errors come from the internal `raise` vocabulary:

- `raise:coerce ( reason:str -- )` raises `E_COERCE`, for data that cannot be decoded;
- `raise:range ( reason:str -- )` raises `E_RANGE`, for a bad argument.

Use it with `USING: raise` or the qualified names. The words have no outputs, so they are not catalogue ops.

## Vocabularies

36 vocabularies, 102 ops (two ops each unless noted). Vocabulary names are lower-kebab-case.

| Vocabulary         | Ops                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `analysis`         | entropy (bits per byte) and byte-frequency distribution                                                          |
| `base32`           | encode and decode, standard and hex alphabets (RFC 4648)                                                         |
| `base45`           | encode and decode (RFC 9285)                                                                                     |
| `base58`           | encode and decode, bitcoin, flickr and ripple alphabets                                                          |
| `base62`           | encode and decode, standard and inverted alphabets                                                               |
| `base64`           | encode and decode, standard and URL-safe alphabets                                                               |
| `base85`           | encode and decode, Ascii85 and Z85                                                                               |
| `base92`           | encode and decode (thenoviceoof)                                                                                 |
| `bcd`              | binary-coded decimal: 8421, 7421, 4221 and excess-3, packed or unpacked, signed or not                           |
| `bech32`           | Bech32 and Bech32m (BIP-173, BIP-350) encode and decode                                                          |
| `bigint`           | big-endian bytes to and from decimal text of an unsigned integer                                                 |
| `binary`           | bytes to and from 8-bit binary text                                                                              |
| `bits`             | XOR (and brute force), AND, OR, NOT, ADD, SUB, bit shifts and rotates (11 ops)                                   |
| `braille`          | bytes as 8-dot Unicode Braille patterns and back                                                                 |
| `caret`            | caret and M- notation as printed by `cat -v`                                                                     |
| `charcode`         | text to and from character codes in a chosen base                                                                |
| `charset`          | legacy character sets (single-byte, EBCDIC, UTF-16/32, CJK), with brute force (3 ops)                            |
| `classical`        | rot (Caesar, ROT13), rot47, Atbash, Affine, Vigenère, Bacon, Bifid, Rail Fence, A1Z26, Substitute (16 ops)       |
| `cobs`             | Consistent Overhead Byte Stuffing encode and decode                                                              |
| `decimal`          | bytes to and from decimal numbers                                                                                |
| `endian`           | swap the byte order of 2, 4 or 8 byte words                                                                      |
| `float`            | IEEE 754 binary32 and binary64 numbers to and from bytes                                                         |
| `hex`              | encode and decode                                                                                                |
| `hex-content`      | Snort and Suricata rule `content` text, with `                                                                   | 41 42 | ` hex sections |
| `hexdump`          | xxd-style hex dump, encode and decode                                                                            |
| `html`             | encode and decode character references (full named-entity table)                                                 |
| `modhex`           | Yubico ModHex encode and decode                                                                                  |
| `morse`            | encode and decode (ITU-R M.1677-1)                                                                               |
| `octal`            | bytes to and from octal numbers                                                                                  |
| `punycode`         | Punycode (RFC 3492), as a label or per domain label with `xn--`                                                  |
| `quoted-printable` | Quoted-Printable (RFC 2045 section 6.7) encode and decode                                                        |
| `radix`            | convert an integer of any size from one base to another                                                          |
| `regex`            | test, find-all, replace, split                                                                                   |
| `text`             | split, join, replace, reverse, upper, lower                                                                      |
| `unicode`          | escape and unescape code points (`\u`, `U+`, `%u`, `\x{}`, `&#x;`), normalisation, smart quotes to ASCII (4 ops) |
| `url`              | percent-encode and decode (RFC 3986)                                                                             |

Three internal vocabularies are not part of the catalogue as ops: `recipe` (the words recipes compile to), `raise` (typed errors, above) and `util` (shared helpers, below).

## The `util` vocabulary

`vocab/util.fth` holds FL helpers that more than one op vocabulary needs. A private (`_`) word cannot be called from another vocabulary, so without `util` each author copies the helper. `util` is in `INTERNAL_VOCABS`: its public words are callable from every vocabulary (`util:space?`, or `USING: util`), are never listed in the catalogue, have a doc string and no category, and user units cannot define into it.

| Word                                                          | Meaning                                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space? ( b:int -- bool )`                                    | ASCII white space: 9 to 13 and 32                                                                                                                        |
| `space-or-comma? ( b:int -- bool )`                           | white space or a comma, the separators of numeric text                                                                                                   |
| `between? ( n:int lo:int hi:int -- bool )`                    | lo <= n <= hi                                                                                                                                            |
| `cp>str ( cp:int -- str )`                                    | the one-character string of a code point                                                                                                                 |
| `separator ( choice:str -- str )`                             | none, space, comma, newline to the delimiter text                                                                                                        |
| `decode-table ( alpha:str ws:int pad:int -- bytes )`          | 256-byte lookup table for `translate`: index in the alphabet, else `ws` for white space, `pad` for `=`, else 255 (pass 255 for a marker you do not need) |
| `check-symbols ( data:bytes table:bytes -- bytes )`           | translate data through a decode table; E_COERCE if any byte maps to 255; other markers (white space, padding) are left for the caller                    |
| `int>be-bytes ( v:int n:int -- bytes )`                       | the low n bytes of v, big-endian                                                                                                                         |
| `digits>int ( vals:bytes radix:int -- int )`                  | positional fold of digit values, most significant first                                                                                                  |
| `dec-digit? ( c:int -- bool )`                                | ASCII 0 to 9                                                                                                                                             |
| `hex-digit? ( c:int -- bool )`                                | ASCII 0 to 9, A to F, a to f                                                                                                                             |
| `byte>hex ( b:int -- str )`                                   | two upper-case hex digits of a byte                                                                                                                      |
| `pad-hex ( v:int n:int -- str )`                              | lower-case hex of v, zero-padded to at least n digits                                                                                                    |
| `repeat-str ( s:str n:int -- str )`                           | s repeated n times                                                                                                                                       |
| `starts-with? ( s:str prefix:str -- bool )`                   | length-guarded: false, not an error, when s is shorter                                                                                                   |
| `ends-with? ( s:str suffix:str -- bool )`                     | length-guarded                                                                                                                                           |
| `strip-space ( s:str -- str )`                                | remove every ASCII white space character                                                                                                                 |
| `count-leading ( items pred:quot -- int )`                    | how many elements at the start (list or bytes) satisfy pred                                                                                              |
| `trim-start ( s:str pred:quot -- str )`                       | drop leading characters whose code satisfies pred                                                                                                        |
| `trim-end ( s:str pred:quot -- str )`                         | drop trailing characters whose code satisfies pred                                                                                                       |
| `number-tokens ( s:str -- list )`                             | split numeric text at white space and commas, empty pieces dropped                                                                                       |
| `numbers>bytes ( data:bytes radix:int msg:str -- bytes )`     | decode byte values written in a radix (0 to 255, no sign); E_COERCE with msg if out of range                                                             |
| `hex-unescape ( s:str marker:str msg:str -- bytes )`          | text where marker (`%`, `=`) introduces two hex digits for a byte; E_COERCE with msg otherwise                                                           |
| `zero-bytes ( n:int -- bytes )`                               | n zero bytes                                                                                                                                             |
| `byte-at ( d j:int -- int )`                                  | element j of bytes or a list, 0 past the end                                                                                                             |
| `bit-field ( d:bytes p:int n:int -- int )`                    | n bits (up to 13) from bit p, zero padded past the end                                                                                                   |
| `nibbles>byte ( nibs i:int -- int )`                          | byte i from nibbles 2i (high) and 2i + 1 (low)                                                                                                           |
| `int>bytes ( n:int -- bytes )`                                | big-endian bytes of a non-negative integer, none for 0, linear time                                                                                      |
| `int>symbols ( n:int alpha:bytes -- bytes )`                  | digits of n written with the bytes of alpha (radix = its length)                                                                                         |
| `bytes>symbols ( data:bytes alpha:bytes -- bytes )`           | Base58/Base62 style big-integer conversion; each leading zero byte is one first symbol                                                                   |
| `symbols>bytes ( data:bytes table:bytes radix:int -- bytes )` | the inverse, through a decode table with 254 for white space                                                                                             |

**Rule: check `util` before writing a helper. Anything more than one vocabulary needs goes in `util`.**

When work packages run in parallel, an agent cannot edit `util.fth` (the orchestrator owns it), so it may need a private copy of a helper for the length of its package. The rules for that:

1. Keep a **straight copy** of the helper in your own vocabulary, with the body you would have put in `util`. **Never vary the body to avoid the sweep**: do not reorder the words, swap an operand test (`j d len <` for `j d len >=`), change a constant into a computed one or otherwise write the same function differently. A disguised copy is a defect, and the structural check below reports it anyway.
2. Put the comment line `\ util-candidate: <proposed util name>` **immediately before** the definition (no blank line between).
3. List the helper in your report as a **utility candidate**: proposed name, stack effect, why, and the vocabularies that have the same need.
4. The orchestrator promotes every marked helper into `util` at the wave close-out, deletes the copies and the markers, and the final state has no marker left.

Example:

```forth
\ util-candidate: strip-space
: _clean ( s:str -- str )
  s str>codes [ util:space? not ] filter codes>str ;
```

### Finding copies: the dupes test and `npm run dupes`

`src/dupes.ts` (not exported from the package, so not in the browser bundle) reads every `vocab/*.fth`, extracts each colon definition and normalises its body: comments, the `doc` and `category` lines are dropped, input names become positional placeholders (`b 32 =` equals `code 32 =`), and words of the same vocabulary are qualified so two private helpers with the same name are not confused. Four reports:

- **Exact duplicates**: definitions in different vocabularies with the same input and output types and identical normalised bodies. `src/dupes.test.ts` **fails** on any, naming the words; move the helper into `vocab/util.fth`. A group whose copies **all** carry a `util-candidate` marker is not an exact duplicate but a pending promotion (next).
- **Pending util promotion**: exact-duplicate groups where every copy has the marker `\ util-candidate: <name>` right before it, listed by proposed name. Not a failure while a wave is running. One unmarked copy in the group makes the whole group a failure. `src/dupes.test.ts` also checks that **none is left** in the repository, so the close-out cannot forget them.
- **Near duplicates**: pairs in different vocabularies with the same input and output arity and a Jaccard similarity of at least 0.8 over token bigrams. Bodies under 4 tokens are ignored.
- **Likely re-implementations**: private (`_`) helpers in different vocabularies with the **same effect signature** (input and output types) and the **same set of core words** (every word of the body that is not a parameter or defined in its own vocabulary, qualified words included; order and repetition ignored; at least 3 distinct words). This catches the same function written with a different body. Near duplicates and likely re-implementations never fail a test: look at each at the close-out, and either promote the helper or write down why the two are different (for example `classical:_atbash-code` reflects a letter, `morse:_upper-cp` folds case; they only look alike).

`npm run dupes -w @forge/ops` builds the package and prints all four reports (always exits 0). Run it when reviewing a work package. At a wave close-out the target is 0 exact duplicates, 0 pending promotions, and every remaining near duplicate or likely re-implementation resolved or justified.

## Running the vectors

Every op has vectors in `vocab/<v>.test.json`, and the catalogue test fails if an op has none. All 1,472 vectors (36 files) run through the in-process baker in Node as part of the worker package's tests:

```sh
npm test -w @forge/worker                              # includes test/vectors.test.ts
npx vitest run packages/worker/test/vectors.test.ts    # the vectors alone
```

The same vectors run in Chromium Web Workers, with and without cross-origin isolation:

```sh
npm run gate4:browser -w @forge/worker
```

Multi-step recipes that cross vocabularies (for example `text:split` into `text:join`) are tested in `packages/worker/test/phase4-recipes.test.ts`, because a single-op vector cannot feed a list into another op.

## The CyberChef coverage table

`docs/COVERAGE.md` is generated: it lists each of CyberChef's 506 operations (names only, in `docs/coverage/cyberchef.json`, grouped by CyberChef category) against the Forge words that cover it, or `redesigned` / `dropped` with a reason, or `not yet`. The data is one JSON file per area, `docs/coverage/<area>.json` (`encodings`, `classical`, `bits`, `text`, `regex`, `analysis`, `flow`, ...), an array of `{ "cyberchef", "status": "covered" | "redesigned" | "dropped", "forge": [...], "note" }` checked by `docs/coverage/coverage.schema.json`. `forge` lists catalogue words (`base64:decode`; an alias is written `classical:rot13`) and, for a structural recipe step that replaces an operation, `step:fork`, `step:subsection`, `step:if`, `step:repeat` or `step:comment`. `forge` is required for covered and redesigned, `note` for redesigned and dropped. Map only what exists; unmapped names show as `not yet`.

```sh
npm run coverage    # validate docs/coverage/*.json, then rewrite docs/COVERAGE.md (do not edit it by hand)
```

The part before the colon of a `forge` word is a lower-kebab-case vocabulary name (`quoted-printable:encode`). It fails if a `cyberchef` name is not in `cyberchef.json`, a name is mapped twice, or a `forge` word is not in the built catalogue. `src/coverage.test.ts` runs the same checks and **fails when `docs/COVERAGE.md` is out of date**. Every op WP adds or updates its own `docs/coverage/<area>.json`, so parallel WPs never edit the same file, and commits the regenerated `docs/COVERAGE.md`. A merge conflict in `docs/COVERAGE.md` is resolved by running `npm run coverage` again.
