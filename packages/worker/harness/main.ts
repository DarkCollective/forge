/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The browser half of Gate 2 (RECIPES.md section 10.3, G2-5): decode a share fragment, bake it in a real
// Web Worker and publish the outcome on `window`.
import catalogueUrl from "@forge/ops/catalogue.json?url";
import { decodeShare } from "@forge/recipe";
import type { CatalogueView } from "@forge/recipe";
import { createBakerClient, createWebWorkerHost, runOpVectors, stripTimings } from "@forge/worker";
import type { BakeResult, OpTestVector, VectorReport } from "@forge/worker";
import WebWorker from "@forge/worker/worker-web?worker";

/** The golden fragment of RECIPES.md section 12.5 (the Gate 2 recipe and its input). */
const GOLDEN =
  "v=1&r=1bY2xDgIhEAX_5dU0F43F_oqx2IP1jggsYTGaEP7dWBqvmW5mBu7aNgEtDtalGug68IglgKAV7gvCyiaXMwXxGgQOlRtnAw1wqjuv0kGwziVwC5jTHTR8YrPoOVHT_tvI-iwdtJyOzV3eJOVv7dkEhKQvaXAIkmKOXRoIRYtgztv8AA&i=0VlhKNWVXSXNJRXBpWlhseElRPT0&ie=utf8";

interface Gate2 {
  done: boolean;
  crossOriginIsolated: boolean;
  sharedAbort: boolean;
  catalogueVersion?: string;
  result?: BakeResult;
  error?: string;
}

interface CancelOutcome {
  code: string | null;
  terminated: boolean;
  ms: number;
}

declare global {
  interface Window {
    /** Gate 4: `run` bakes every vector in the Web Worker; scripts/gate4-browser.mjs calls it with the vector files. */
    __gate4?: {
      ready: boolean;
      crossOriginIsolated: boolean;
      sharedAbort: boolean;
      run?: (files: Record<string, OpTestVector[]>) => Promise<VectorReport>;
      error?: string;
    };
    __gate2?: Gate2;
    __gate2cancel?: {
      done: boolean;
      loop?: CancelOutcome;
      regex?: CancelOutcome;
      after?: string;
      error?: string;
    };
  }
}

const out = document.getElementById("out") as HTMLElement;
const isolated = globalThis.crossOriginIsolated === true;
const sharedAbort = isolated && typeof SharedArrayBuffer !== "undefined";

function newClient(): ReturnType<typeof createBakerClient> {
  return createBakerClient({
    host: () => createWebWorkerHost(() => new WebWorker()),
    cancelGraceMs: 500,
    deadlineGraceMs: 500,
  });
}

function outcome(r: BakeResult, t0: number): CancelOutcome {
  return {
    code: r.ok ? null : r.error.code,
    terminated: !r.ok && r.error.terminated === true,
    ms: Math.round(performance.now() - t0),
  };
}

async function runGate2(): Promise<void> {
  const catalogue = (await (await fetch(catalogueUrl)).json()) as CatalogueView;
  const fragment = location.hash.length > 1 ? location.hash.slice(1) : GOLDEN;
  const decoded = await decodeShare(fragment, { catalogue });
  if (!decoded.ok || decoded.input === undefined) {
    throw new Error(
      `cannot decode the fragment: ${decoded.ok ? "no input" : decoded.error.message}`,
    );
  }
  const baker = newClient();
  const info = await baker.init({ vocabs: "all" });
  const result = await baker.bake(decoded.recipe, decoded.input, { trust: "untrusted" });
  await baker.dispose();
  window.__gate2 = {
    done: true,
    crossOriginIsolated: isolated,
    sharedAbort,
    catalogueVersion: info.catalogueVersion,
    result: stripTimings(result),
  };
  out.textContent = JSON.stringify(window.__gate2, null, 2);
}

/** Cancel a long FL loop (through the abort flag or the message) and a runaway regex (by termination). */
async function runCancel(): Promise<void> {
  const baker = newClient();
  await baker.init({ vocabs: "all" });
  const state: NonNullable<Window["__gate2cancel"]> = { done: false };
  window.__gate2cancel = state;

  let t0: number;
  let running: () => void = () => undefined;
  let started = new Promise<void>((r) => (running = r));
  const loop = baker.bake(
    {
      forge: 1,
      steps: [
        {
          kind: "repeat",
          times: 1000,
          steps: [{ kind: "op", op: "classical:rot", params: { amount: 1 } }],
        },
      ],
    },
    new Uint8Array(2_000_000).fill(65),
    { trust: "trusted", onEvent: (e) => e.type === "progress" && running() },
  );
  await started;
  t0 = performance.now();
  await baker.cancel();
  state.loop = outcome(await loop, t0);

  started = new Promise<void>((r) => (running = r));
  const regex = baker.bake(
    { forge: 1, steps: [{ kind: "op", op: "regex:test", params: { pattern: "(a+)+$" } }] },
    new TextEncoder().encode("a".repeat(40) + "b"),
    { trust: "untrusted", onEvent: (e) => e.type === "progress" && running() },
  );
  await started;
  t0 = performance.now();
  await baker.cancel();
  state.regex = outcome(await regex, t0);

  const after = await baker.bake(
    { forge: 1, steps: [{ kind: "op", op: "text:upper" }] },
    new TextEncoder().encode("ok"),
  );
  state.after = after.ok && after.output.kind === "str" ? after.output.text : "failed";
  await baker.dispose();
  state.done = true;
  out.textContent = JSON.stringify(state, null, 2);
}

/** Gate 4 (PLAN section 7): the op vector runner against the baker in a real Web Worker. */
async function runVectors(): Promise<void> {
  const catalogue = (await (await fetch(catalogueUrl)).json()) as CatalogueView;
  const baker = newClient();
  await baker.init({ vocabs: "all" });
  window.__gate4 = {
    ready: true,
    crossOriginIsolated: isolated,
    sharedAbort,
    run: (files) => runOpVectors({ baker, catalogue, files }),
  };
  out.textContent = "ready: call window.__gate4.run(files)";
}

const mode = new URLSearchParams(location.search).get("mode");
(mode === "cancel" ? runCancel() : mode === "vectors" ? runVectors() : runGate2()).catch(
  (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (mode === "vectors")
      window.__gate4 = { ready: true, crossOriginIsolated: isolated, sharedAbort, error: message };
    else if (mode === "cancel") window.__gate2cancel = { done: true, error: message };
    else
      window.__gate2 = { done: true, crossOriginIsolated: isolated, sharedAbort, error: message };
    out.textContent = `error: ${message}`;
  },
);
