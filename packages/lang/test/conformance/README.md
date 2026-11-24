# FL conformance harness

Reads the test blocks of the language documents and runs them against `createRuntime`.

| File              | What                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `parse.ts`        | Extracts and validates `fl-test` blocks (and `fl-proposed` blocks) into typed cases. Pure.                              |
| `run.ts`          | Runs one case against a fresh runtime (`executeCase`). `../conformance.test.ts` and `proposed.test.ts` both use it.     |
| `fixtures.ts`     | The `fx:*` and `fz:*` primitives of LANGUAGE.md §16.1.                                                                  |
| `ext-fixtures.ts` | The fixtures of LANGUAGE-0.3.md §17.0: kinds `fx-pair`, `fx-other`, `fx-big`, tags `pair`, `big`, and seven primitives. |
| `ext-support.ts`  | Loads `src/ext.ts` if it exists and keeps the §17.0 primitives the runtime under test accepts.                          |
| `proposed.ts`     | Which `fl-proposed` blocks run (the opt-in).                                                                            |
| `*.test.ts`       | Tests of the harness itself, and `proposed.test.ts`, which parses every proposed block and runs the opted-in ones.      |

## Two kinds of block

- `fl-test` blocks in `docs/LANGUAGE.md` are the suite. Each is one test in `test/conformance.test.ts` and must pass.
- `fl-proposed` blocks in `docs/LANGUAGE-0.3.md` stage the cases of v0.3 (C401 to C594). They use the same grammar. They are **always parsed and validated** (a malformed one fails `proposed.test.ts`, which is a bug in the document) but they are **not run** unless opted in, because most of their features do not exist yet.

## Switching proposed blocks on

A package that implements a feature opts its blocks in, in the same commit as the feature:

1. Add the ids to `ENABLED_PROPOSED` in `proposed.ts`, for example `["C401-C428"]` (a case, `C401`, a range, `C401-C428`, or `all`). They are now required to pass.
2. When the package flips the blocks to `fl-test` and moves them into LANGUAGE.md (LANGUAGE-0.3.md §3), remove the ids again. The suite then runs them. An id that is no longer in LANGUAGE-0.3.md makes the selection fail, so a stale entry is caught.

To try a package without committing anything, set `FL_PROPOSED` to the same syntax:

```
FL_PROPOSED=C401-C428 npm test -w @forge/lang
FL_PROPOSED=all npm test -w @forge/lang     # everything: expect many failures
```

## Directives added for v0.3 (LANGUAGE-0.3.md §3)

- `@call <qname>`: runs `runtime.call(qname, args)` instead of `run()`. The arguments are the stack in force, deepest first: `@stack-in` for the first run, otherwise the final stack of the run before. `@stack`, `@out`, `@error` and `@coercions` apply as for `@run`. The directive has no body.
- `@meta` paths may name the new fields: `params[i].kind`, `params[i].values`, `generic`, `discovery.friends`, `discovery.kernel`. The first segment must be a `WordMeta` field (`META_FIELDS` in `parse.ts`).
- `@coercions` accepts the tag `ext`; `@deny` accepts the label `+media`.
- A block with only `@meta` or `@hash-eq`/`@hash-ne` assertions (no `@run`, `@unit` or `@use`) is allowed: it asks about words that already exist (C443).

## The §17.0 fixtures

They need features that do not exist before X1 and L8, so `ext-fixtures.ts` never imports `src/ext.ts`.

- Kinds and tags are plain data in the shape of `ExtKind` and `registerLiteralTag`. `registerExtFixtures(api)` registers them once per process; `ext-support.ts` calls it with the exports of `src/ext.ts` when that file exists. X1 should check that the shapes still match.
- The primitives are probed one by one with `createRuntime`: a runtime that does not know `ext{fx-pair}` or `+media` rejects the primitive and it is left out. Before X1, `fx:charge` and `fx:spin` are bound (and fail cleanly without `ctx.charge`); after X1 and L8, all seven are. The v0.2 suite gets them only once `src/ext.ts` exists.
- Primitives that take an `ext` argument accept either the payload or the `ext` Value; they return an `ext` Value built with `ext()`. X1 decides which form a primitive really sees and should adjust `ext-fixtures.ts`.
