# @forge/recipe

The recipe model for Forge: recipe JSON v1, validation and normal forms, the recipe to FL compiler, the
canonical FL text form and its restricted parser, the step to instruction map, and the share-URL codec.

Every function is pure. The package never creates an FL runtime (it uses `read` and a few name predicates
from `@forge/lang`, and works on the catalogue as JSON) and it does not depend on `@forge/ops`.

The specification is [docs/RECIPES.md](../../docs/RECIPES.md); the exports are listed in its section 11.5.

- `src/recipe.schema.json` is the JSON Schema (draft 2020-12) that the hand-written validator is tested
  against. Ajv is used by the tests only: it compiles with `new Function`, which the production CSP forbids.
- `test/fixtures/catalogue.json` is a hand-written catalogue of the twelve seed ops. Its hashes are arbitrary.
- `src/deflate.ts` finds the end of a deflate-raw stream so that data after it can be rejected on every platform.
