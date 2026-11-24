# @forge/packs

The pack manifest for Forge: its TypeScript types, the JSON Schema, and `validateManifest`, which
runs the schema and the checks of PACKS section 2.4 that need no runtime. The specification is
[docs/PACKS.md](../../docs/PACKS.md).

- `src/manifest.schema.json` is the schema of PACKS section 2.2 (draft 2020-12). Ajv is used by the
  tests only: it compiles with `new Function`, which the production CSP forbids. The runtime validator
  (`src/structure.ts`) is hand-written, reads its patterns from the schema file, and a test holds it to
  Ajv over the corpus and over about a thousand one-step mutations.
- `validateManifest(manifest, context?)` returns `{ ok, problems }`. A problem has a PACKS check code, a
  JSON Pointer and a message. A cross-check whose input is missing from the `context` does not run.
- `PACK_API`, `CORE_KIND_NAMES`, `CORE_VOCAB_NAMES`, `RESERVED_PACK_IDS`, `LICENCE_ALLOW_LIST` and
  `MANIFEST_EFFECTS` are the name sets. The first two are built from `@forge/lang` and `@forge/ops`.
- `test/manifests/valid/*.json` and `test/manifests/invalid/<code>[--case].json` are the corpus of PACKS
  section 10.1. Context that a file needs (a fake core, other packs, missing files) is in `test/corpus.ts`.

The codes decided here are `schema`, `id-dir`, `id-reserved`, `vocab-clash`, `kind-clash`,
`kind-reserved`, `entry-missing`, `requires-unknown`, `requires-cycle`, `requires-api` and
`licence-list`. The others need the loaded runtime or the pack's sources and belong to the generator.
