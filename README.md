# Forge

Forge is a browser-only, CyberChef-like toolkit for codes and ciphers. Its core is a Forth-like language interpreter written in TypeScript; operations are defined in that language and composed into recipes in a static web app.

The detailed plan lives in `docs/PLAN.md`.

## Layout

- `packages/lang` (`@forge/lang`) - the Forth-like language interpreter.
- `packages/ops` (`@forge/ops`) - operation definitions; `vocab/` will hold `.fth` files.
- `apps/web` (`@forge/web`) - Vite + Lit web app; builds to a static `dist/`.

## Scripts

- `npm run dev` - start the web app dev server.
- `npm run build` - build all workspaces.
- `npm test` - run all tests (Vitest).
- `npm run lint` - ESLint and Prettier check.
- `npm run format` - format with Prettier.
- `npm run typecheck` - type-check all workspaces.
