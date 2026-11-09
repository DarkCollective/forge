# @forge/worker

The bake host for Forge: a host-agnostic `Baker` that runs a recipe over input bytes, the Web Worker
(and `worker_threads`) message protocol around it, cancellation, the watchdog, the main-thread
client, and the op test vector runner. The specification is [docs/RECIPES.md](../../docs/RECIPES.md)
section 8 to 11.

- Entries: `@forge/worker` (core, in-process baker, client, protocol, vectors), `@forge/worker/node`
  (`createNodeWorkerHost`), `@forge/worker/worker-web` (the Web Worker module, import with `?worker`).
- Tests need the built packages (`npm run build`, or `npm run typecheck`, which builds them).
- Gate 2 in a real browser: `npx playwright install chromium`, then `npm run gate2:browser -w @forge/worker`.
  It is not part of `npm test`.
