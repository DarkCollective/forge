# @forge/ops

The operation vocabularies of Forge: 61 ops in 16 vocabularies, written in FL (the Forth-like Forge language), plus the build-time catalogue and the loaders that make them available in Node and in the browser.

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

| Vocabulary  | Ops                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `analysis`  | entropy (bits per byte) and byte-frequency distribution                                                    |
| `base32`    | encode and decode, standard and hex alphabets (RFC 4648)                                                   |
| `base58`    | encode and decode, bitcoin, flickr and ripple alphabets                                                    |
| `base64`    | encode and decode, standard and URL-safe alphabets                                                         |
| `base85`    | encode and decode, Ascii85 and Z85                                                                         |
| `binary`    | bytes to and from 8-bit binary text                                                                        |
| `bits`      | XOR (and brute force), AND, OR, NOT, ADD, SUB, bit shifts and rotates (11 ops)                             |
| `charcode`  | text to and from character codes                                                                           |
| `classical` | rot (Caesar, ROT13), rot47, Atbash, Affine, Vigenère, Bacon, Bifid, Rail Fence, A1Z26, Substitute (16 ops) |
| `decimal`   | bytes to and from decimal numbers                                                                          |
| `hex`       | encode and decode                                                                                          |
| `html`      | encode and decode entities                                                                                 |
| `morse`     | encode and decode (ITU-R M.1677-1)                                                                         |
| `regex`     | test, find-all, replace, split                                                                             |
| `text`      | split, join, replace, reverse, upper, lower                                                                |
| `url`       | percent-encode and decode (RFC 3986)                                                                       |

Three internal vocabularies are not part of the catalogue as ops: `recipe` (the words recipes compile to), `raise` (typed errors, above) and `util` (shared helpers, below).

## The `util` vocabulary

`vocab/util.fth` holds FL helpers that more than one op vocabulary needs. A private (`_`) word cannot be called from another vocabulary, so without `util` each author copies the helper. `util` is in `INTERNAL_VOCABS`: its public words are callable from every vocabulary (`util:space?`, or `USING: util`), are never listed in the catalogue, have a doc string and no category, and user units cannot define into it.

| Word                                                 | Meaning                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space? ( b:int -- bool )`                           | ASCII white space: 9 to 13 and 32                                                                                                                                            |
| `space-or-comma? ( b:int -- bool )`                  | white space or a comma, the separators of numeric text                                                                                                                       |
| `separator ( choice:str -- str )`                    | none, space, comma, newline to the delimiter text                                                                                                                            |
| `decode-table ( alpha:str ws:int pad:int -- bytes )` | 256-byte lookup table for `translate`: index in the alphabet, else `ws` for white space, `pad` for `=`, else 255 (pass 255 for a marker you do not need)                     |
| `check-symbols ( data:bytes table:bytes -- bytes )`  | translate data through a decode table; E_COERCE ("a character is not in the alphabet") if any byte maps to 255; other markers (white space, padding) are left for the caller |
| `int>be-bytes ( v:int n:int -- bytes )`              | the low n bytes of v, big-endian                                                                                                                                             |
| `digits>int ( vals:bytes radix:int -- int )`         | positional fold of digit values, most significant first                                                                                                                      |

**Rule: check `util` before writing a helper. Anything more than one vocabulary needs goes in `util`.** If you wrote a helper that looks generally useful, say so in your report as a **utility candidate** (name, stack effect, why); the orchestrator promotes accepted candidates into `util` in a small follow-up work package. Do not copy a helper into a second vocabulary.

### Finding copies: the dupes test and `npm run dupes`

`src/dupes.ts` (not exported from the package, so not in the browser bundle) reads every `vocab/*.fth`, extracts each colon definition and normalises its body: comments, the `doc` and `category` lines are dropped, input names become positional placeholders (`b 32 =` equals `code 32 =`), and words of the same vocabulary are qualified so two private helpers with the same name are not confused. Two reports:

- **Exact duplicates**: definitions in different vocabularies with the same input and output types and identical normalised bodies. `src/dupes.test.ts` **fails** on any, naming the words; move the helper into `vocab/util.fth`.
- **Near duplicates**: pairs in different vocabularies with the same input and output arity and a Jaccard similarity of at least 0.8 over token bigrams. Bodies under 4 tokens are ignored. Near duplicates never fail a test.

`npm run dupes -w @forge/ops` builds the package and prints both reports (always exits 0). Run it when reviewing a work package.

## Running the vectors

Every op has vectors in `vocab/<v>.test.json`, and the catalogue test fails if an op has none. All 759 vectors run through the in-process baker in Node as part of the worker package's tests:

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

It fails if a `cyberchef` name is not in `cyberchef.json`, a name is mapped twice, or a `forge` word is not in the built catalogue. `src/coverage.test.ts` runs the same checks and **fails when `docs/COVERAGE.md` is out of date**. Every op WP adds or updates its own `docs/coverage/<area>.json`, so parallel WPs never edit the same file, and commits the regenerated `docs/COVERAGE.md`. A merge conflict in `docs/COVERAGE.md` is resolved by running `npm run coverage` again.
