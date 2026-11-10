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

Two internal vocabularies are not part of the catalogue as ops: `recipe` (the words recipes compile to) and `raise` (typed errors, above).

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
