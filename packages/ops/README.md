# @forge/ops

The operation vocabularies of Forge: 143 ops in 46 vocabularies, written in FL (the Forth-like Forge language), plus the build-time catalogue and the loaders that make them available in Node and in the browser.

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

The private primitives, each in `src/prims/<v>.ts`:

- `analysis:_log2`: the logarithm the core lacks;
- `charset:_decode`: the WHATWG decoder for an encoding label;
- `cobs:_starts`: the offsets of the blocks of COBS data;
- `float:_pack` and `float:_unpack`: decimal text to and from IEEE 754 bytes;
- `unicode:_normalize`: Unicode normalisation (NFC, NFD, NFKC, NFKD);
- `sigaba:_run`: the SIGABA rotor stack over letters 0 to 25 (the loop needs a fast mutable array, which FL lacks);
- `classical:_ls47`: the LS47 letter-by-letter cipher on a given board, for the same reason;
- `bombe:_search`: the Bombe test over the 17,576 start positions of one rotor order.

The public primitives are the `hex`, `base64` and `regex` words and `raise:coerce` and `raise:range`.

FL's own `fail` raises only `E_USER`. Typed errors come from the internal `raise` vocabulary:

- `raise:coerce ( reason:str -- )` raises `E_COERCE`, for data that cannot be decoded;
- `raise:range ( reason:str -- )` raises `E_RANGE`, for a bad argument.

Use it with `USING: raise` or the qualified names. The words have no outputs, so they are not catalogue ops.

## Vocabularies

46 vocabularies, 143 ops (two ops each unless noted). Vocabulary names are lower-kebab-case.

| Vocabulary         | Ops                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analysis`         | entropy (bits per byte), byte-frequency distribution, index of coincidence and chi-squared against English (4 ops)                                                     |
| `base32`           | encode and decode, standard and hex alphabets (RFC 4648)                                                                                                               |
| `base45`           | encode and decode (RFC 9285)                                                                                                                                           |
| `base58`           | encode and decode, bitcoin, flickr and ripple alphabets                                                                                                                |
| `base62`           | encode and decode, standard and inverted alphabets                                                                                                                     |
| `base64`           | encode and decode, standard and URL-safe alphabets                                                                                                                     |
| `base85`           | encode and decode, Ascii85 and Z85                                                                                                                                     |
| `base92`           | encode and decode (thenoviceoof)                                                                                                                                       |
| `bcd`              | binary-coded decimal: 8421, 7421, 4221 and excess-3, packed or unpacked, signed or not                                                                                 |
| `bech32`           | Bech32 and Bech32m (BIP-173, BIP-350) encode and decode                                                                                                                |
| `bigint`           | big-endian bytes to and from decimal text of an unsigned integer                                                                                                       |
| `binary`           | bytes to and from 8-bit binary text                                                                                                                                    |
| `bits`             | XOR (and brute force), AND, OR, NOT, ADD, SUB, bit shifts and rotates (11 ops)                                                                                         |
| `bombe`            | Turing-Welchman Bombe for the Enigma I and M3: a crib search for stops, one word for one or many rotor orders (1 op)                                                   |
| `braille`          | bytes as 8-dot Unicode Braille patterns and back                                                                                                                       |
| `caret`            | caret and M- notation as printed by `cat -v`                                                                                                                           |
| `charcode`         | text to and from character codes in a chosen base                                                                                                                      |
| `charset`          | legacy character sets (single-byte, EBCDIC, UTF-16/32, CJK), with brute force (3 ops)                                                                                  |
| `classical`        | rot (Caesar, ROT13), rot47, rot8000, rot brute force, Atbash, Affine, Vigenère, Bacon, Bifid, Rail Fence, Caesar box, A1Z26, Cetacean, CTX1, LS47, Substitute (26 ops) |
| `cobs`             | Consistent Overhead Byte Stuffing encode and decode                                                                                                                    |
| `colossus`         | Colossus-style counting: how often a Boolean condition holds over every start position of two chi wheels, for the Lorenz break-in (1 op)                               |
| `decimal`          | bytes to and from decimal numbers                                                                                                                                      |
| `endian`           | swap the byte order of 2, 4 or 8 byte words                                                                                                                            |
| `enigma`           | Enigma I, M3 and M4 rotor machines, one reciprocal word; also the shared historical rotor, turnover and reflector data (1 op)                                          |
| `float`            | IEEE 754 binary32 and binary64 numbers to and from bytes                                                                                                               |
| `fractionating`    | ADFGX and ADFGVX, Polybius, Nihilist and Trifid (8 ops)                                                                                                                |
| `hex`              | encode and decode                                                                                                                                                      |
| `hex-content`      | Snort and Suricata rule `content` text, with `                                                                                                                         | 41 42 | ` hex sections |
| `hexdump`          | xxd-style hex dump, encode and decode                                                                                                                                  |
| `html`             | encode and decode character references (full named-entity table)                                                                                                       |
| `lorenz`           | Lorenz SZ40/42a/42b with the KH, ZMUG and BREAM patterns and the P5 mode, and a pattern merge helper (2 ops)                                                           |
| `modhex`           | Yubico ModHex encode and decode                                                                                                                                        |
| `morse`            | encode and decode (ITU-R M.1677-1)                                                                                                                                     |
| `octal`            | bytes to and from octal numbers                                                                                                                                        |
| `polyalphabetic`   | Beaufort, Gronsfeld, Porta and autokey Vigenere (6 ops)                                                                                                                |
| `polygraphic`      | Playfair, four-square and Hill (6 ops)                                                                                                                                 |
| `punycode`         | Punycode (RFC 3492), as a label or per domain label with `xn--`                                                                                                        |
| `quoted-printable` | Quoted-Printable (RFC 2045 section 6.7) encode and decode                                                                                                              |
| `radix`            | convert an integer of any size from one base to another                                                                                                                |
| `regex`            | test, find-all, replace, split                                                                                                                                         |
| `sigaba`           | SIGABA (ECM Mark II) rotor machine, one reciprocal word (1 op)                                                                                                         |
| `text`             | split, join, replace, reverse, upper, lower                                                                                                                            |
| `transposition`    | columnar transposition, encrypt and decrypt                                                                                                                            |
| `typex`            | Typex-style five-rotor machine with the wirings as parameters (1 op)                                                                                                   |
| `unicode`          | escape and unescape code points (`\u`, `U+`, `%u`, `\x{}`, `&#x;`), normalisation, smart quotes to ASCII (4 ops)                                                       |
| `url`              | percent-encode and decode (RFC 3986)                                                                                                                                   |

Three internal vocabularies are not part of the catalogue as ops: `recipe` (the words recipes compile to), `raise` (typed errors, above) and `util` (shared helpers, below).

## The `util` vocabulary

`vocab/util.fth` holds FL helpers that more than one op vocabulary needs. A private (`_`) word cannot be called from another vocabulary, so without `util` each author copies the helper. `util` is in `INTERNAL_VOCABS`: its public words are callable from every vocabulary (`util:space?`, or `USING: util`), are never listed in the catalogue, have a doc string and no category, and user units cannot define into it.

| Word                                                          | Meaning                                                                                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space? ( b:int -- bool )`                                    | ASCII white space: 9 to 13 and 32                                                                                                                                             |
| `space-or-comma? ( b:int -- bool )`                           | white space or a comma, the separators of numeric text                                                                                                                        |
| `between? ( n:int lo:int hi:int -- bool )`                    | lo <= n <= hi                                                                                                                                                                 |
| `cp>str ( cp:int -- str )`                                    | the one-character string of a code point                                                                                                                                      |
| `separator ( choice:str -- str )`                             | none, space, comma, newline to the delimiter text                                                                                                                             |
| `decode-table ( alpha:str ws:int pad:int -- bytes )`          | 256-byte lookup table for `translate`: index in the alphabet, else `ws` for white space, `pad` for `=`, else 255 (pass 255 for a marker you do not need)                      |
| `check-symbols ( data:bytes table:bytes -- bytes )`           | translate data through a decode table; E_COERCE if any byte maps to 255, found in a constant number of VM steps; other markers (white space, padding) are left for the caller |
| `int>be-bytes ( v:int n:int -- bytes )`                       | the low n bytes of v, big-endian                                                                                                                                              |
| `digits>int ( vals:bytes radix:int -- int )`                  | positional fold of digit values, most significant first                                                                                                                       |
| `dec-digit? ( c:int -- bool )`                                | ASCII 0 to 9                                                                                                                                                                  |
| `hex-digit? ( c:int -- bool )`                                | ASCII 0 to 9, A to F, a to f                                                                                                                                                  |
| `byte>hex ( b:int -- str )`                                   | two upper-case hex digits of a byte                                                                                                                                           |
| `pad-hex ( v:int n:int -- str )`                              | lower-case hex of v, zero-padded to at least n digits                                                                                                                         |
| `repeat-str ( s:str n:int -- str )`                           | s repeated n times                                                                                                                                                            |
| `starts-with? ( s:str prefix:str -- bool )`                   | length-guarded: false, not an error, when s is shorter                                                                                                                        |
| `ends-with? ( s:str suffix:str -- bool )`                     | length-guarded                                                                                                                                                                |
| `strip-space ( s:str -- str )`                                | remove every ASCII white space character                                                                                                                                      |
| `count-leading ( items pred:quot -- int )`                    | how many elements at the start (list or bytes) satisfy pred                                                                                                                   |
| `trim-start ( s:str pred:quot -- str )`                       | drop leading characters whose code satisfies pred                                                                                                                             |
| `trim-end ( s:str pred:quot -- str )`                         | drop trailing characters whose code satisfies pred                                                                                                                            |
| `number-tokens ( s:str -- list )`                             | split numeric text at white space and commas, empty pieces dropped                                                                                                            |
| `numbers>bytes ( data:bytes radix:int msg:str -- bytes )`     | decode byte values written in a radix (0 to 255, no sign); E_COERCE with msg if out of range                                                                                  |
| `hex-unescape ( s:str marker:str msg:str -- bytes )`          | text where marker (`%`, `=`) introduces two hex digits for a byte; E_COERCE with msg otherwise                                                                                |
| `zero-bytes ( n:int -- bytes )`                               | n zero bytes                                                                                                                                                                  |
| `byte-at ( d j:int -- int )`                                  | element j of bytes or a list, 0 past the end                                                                                                                                  |
| `bit-field ( d:bytes p:int n:int -- int )`                    | n bits (up to 13) from bit p, zero padded past the end                                                                                                                        |
| `nibbles>byte ( nibs i:int -- int )`                          | byte i from nibbles 2i (high) and 2i + 1 (low)                                                                                                                                |
| `int>bytes ( n:int -- bytes )`                                | big-endian bytes of a non-negative integer, none for 0, linear time                                                                                                           |
| `int>symbols ( n:int alpha:bytes -- bytes )`                  | digits of n written with the bytes of alpha (radix = its length)                                                                                                              |
| `bytes>symbols ( data:bytes alpha:bytes -- bytes )`           | Base58/Base62 style big-integer conversion; each leading zero byte is one first symbol                                                                                        |
| `symbols>bytes ( data:bytes table:bytes radix:int -- bytes )` | the inverse, through a decode table with 254 for white space                                                                                                                  |
| `surrogate? ( cp:int -- bool )`                               | a UTF-16 surrogate, U+D800 to U+DFFF                                                                                                                                          |
| `str-chunks ( s:str n:int -- list )`                          | the pieces of s of n characters, the last one shorter                                                                                                                         |
| `list-flatten ( ll:list -- list )`                            | a list of lists joined one level                                                                                                                                              |
| `contains-bytes? ( data:bytes needle:bytes -- bool )`         | a byte search done on the Latin-1 text, a few steps for any length                                                                                                            |
| `drop-byte ( data:bytes b:int -- bytes )`                     | the bytes without any byte equal to b, a few steps for any length                                                                                                             |
| `popcount-26 ( m:int -- int )`                                | the set bits among the low 26 of a letter-set mask                                                                                                                            |
| `letter-numbers ( s:str -- bytes )`                           | the letters of any text as 0 to 25, other characters dropped                                                                                                                  |

The words from the cipher-machine and classical waves, also in `util` (see their doc strings in `vocab/util.fth`):

| Word                                                                                                                                 | Meaning                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `letter? letters? digits?`                                                                                                           | ASCII letter, text of only letters, text of only digits                           |
| `letter-indices ( s:str -- bytes )`, `digit-values ( s:str -- bytes )`, `letter-table ( -- bytes )`                                  | letters as 0 to 25, digits as 0 to 9, and the 256-byte translate table of letters |
| `count-of ( items x -- int )`                                                                                                        | how many elements of a list or bytes equal x                                      |
| `index-of`, `perm-invert`, `perm?`, `table-compose3`                                                                                 | positions and permutations of 0 to 25                                             |
| `rotor-shifted`, `rotor-shift-table`, `rotor-notch-flags`, `rotor-reflect-table`                                                     | rotor tables for every shift, notch flags and the rotor next to the reflector     |
| `letter-settings ( s:str n:int what:str -- bytes )`, `plugboard-table ( s:str -- bytes )`                                            | ring settings and start positions, and a plugboard as a permutation               |
| `cycle-bytes ( pat:bytes start:int n:int -- bytes )`                                                                                 | n bytes of the endless repetition of a pattern, in linear time                    |
| `ita2-alphabet`, `ita2-table`, `ita2-table2`, `ita2-code`, `ita2-entry`, `from-bp`                                                   | teleprinter (ITA2) text in Bletchley Park notation                                |
| `keyed-alphabet ( key:bytes alpha:bytes -- bytes )`, `square-positions ( grid:bytes -- bytes )`, `upper-merge-i ( code:int -- int )` | keyed squares and letter folding                                                  |

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

### Justified exceptions

The sweep reports copies that a promotion would remove. A pair it reports and that stays is written down here, and the private helper carries a one-line comment saying why. Pairs the sweep never sees (an exact copy whose body calls a private helper of its own vocabulary, so the normalised bodies differ) are listed as well.

- `enigma:_step` and `typex:_step` implement the same Enigma-style stepping with the double step, and `typex:_turn` only names the row-offset update. They stay separate: the rotor state is in each vocabulary's `VARIABLE`s (`_b1`, `_b2`, `_b3`, `_NR`, `_NM`), so a shared util word would have to take five values and give back three on every key press. That costs more VM steps on the per-letter path than the inline test and update. The sweep does not report the pair for the reason above.
- `enigma:_byte` and `typex:_byte` have the same core words. Each reads its own `_LT` table and its own `_press` on the per-letter path, so the call cannot be shared.
- `classical:_atbash-code` and `morse:_upper-cp` reflect a letter within its case and fold a lower-case letter to upper case. They only look alike.
- `classical:_text-printable?` and `url:_unreserved?` test two different byte sets.
- `base32:_ungroups` and `classical:_cb-enc` map a helper over an index range and join, over different per-group words.
- `fractionating:_adf-labels` and `polygraphic:_pl-alpha` each pick one of two unrelated literals by a name.

## Hashing conventions

The hashing vocabularies (wave 3) follow the `sha2` vocabulary, which is the template.

- **Bytes out.** A digest word returns the raw digest as `bytes`, never hex text. Chain `hex:encode` for text. The category is `Hashing`.
- **Naming.** One vocabulary per family (`sha2`, `sha3`, `blake2`, `md5`, `crc`, ...), lower-kebab-case. The public word of a hash is `digest`, with a parameter for the variants (`sha2:digest` takes `size:choice{"224"|"256"|"384"|"512"|"512/224"|"512/256"}`). Where CyberChef has a variant parameter, use one parameterised word, not one word per variant. Checksums (crc, adler-32, fletcher, ...) are written in FL, not primitives.
- **Library, not WebCrypto.** Hashes that `@noble/hashes` (audited, MIT, pinned to an exact version) covers use it, and all hash primitives are synchronous. Import only the subpath you need (`@noble/hashes/sha2.js`) so the vocabulary's lazy chunk stays small; the chunk is loaded only when the vocabulary is used and does not count against the first-paint budget.
- **Wrapping a noble function.** Follow `src/prims/sha2.ts`: one private primitive `_hash ( data:bytes <variant>:str -- bytes )` that looks the variant up in a table (with `Object.hasOwn`, so `toString` is not a variant) and raises `E_RANGE` through `rangeFailure` for an unknown one. The primitive does nothing else. The public word, its doc string, category, `choice{}` parameter, defaults and `META:` stay in `vocab/<v>.fth`. Own the tests: `src/prims/<v>.test.ts` for the primitive and `src/<v>.test.ts` for the word through the runtime.
- **Vectors.** `vocab/<v>.test.json` takes its vectors from the official specification or an RFC (FIPS 180-4, FIPS 202, RFC 1321, RFC 7693, RFC 2104, ...), and `ref` cites it. CyberChef is only a throwaway cross-check oracle: never copy its tables or outputs into the repository. Include the empty input, the standard short and long messages, and a 64 KiB test inside the default limits (against `node:crypto` where it has the algorithm).
- **HMAC** is its own vocabulary (`hmac`), taking the hash name and the key as parameters, not a parameter of each hash.
- **Not here.** CMAC, LM hash, bcrypt, Argon2 and Ascon need AES or DES, or are key derivation functions, and are wave 4.

## Running the vectors

Every op has vectors in `vocab/<v>.test.json`, and the catalogue test fails if an op has none. All 1,865 vectors (46 files) run through the in-process baker in Node as part of the worker package's tests:

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
