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
import { loadBundleNode } from "@forge/ops/node";
import { describe, expect, test, vi } from "vitest";
import { FX_URL } from "../test/helpers.js";
import { withPrimitiveModules } from "./extra.js";
import { createWebWorkerHost } from "./host-web.js";
import type { WebWorkerLike } from "./types.js";

describe("createWebWorkerHost", () => {
  test("adapts a Worker", () => {
    const listeners: Record<string, (event: never) => void> = {};
    const worker: WebWorkerLike = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      addEventListener: ((type: string, listener: (event: never) => void) => {
        listeners[type] = listener;
      }) as WebWorkerLike["addEventListener"],
    };
    const host = createWebWorkerHost(() => worker);
    const buffer = new ArrayBuffer(1);
    host.postMessage({ type: "dispose" }, [buffer]);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "dispose" }, [buffer]);
    host.postMessage({ type: "dispose" });
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "dispose" }, []);

    const onMessage = vi.fn();
    host.onMessage(onMessage);
    (listeners["message"] as (e: unknown) => void)({ data: { type: "fatal", message: "m" } });
    expect(onMessage).toHaveBeenCalledWith({ type: "fatal", message: "m" });

    const onError = vi.fn();
    host.onError(onError);
    (listeners["error"] as (e: unknown) => void)({ message: "bad" });
    (listeners["error"] as (e: unknown) => void)({});
    expect(onError.mock.calls).toEqual([[{ message: "bad" }], [{ message: "worker error" }]]);

    host.terminate();
    expect(worker.terminate).toHaveBeenCalled();
  });
});

describe("withPrimitiveModules", () => {
  test("no modules: the loader itself", () => {
    expect(withPrimitiveModules(loadBundleNode, [])).toBe(loadBundleNode);
  });

  test("adds the primitives and their vocabularies to every bundle", async () => {
    const load = withPrimitiveModules(loadBundleNode, [FX_URL]);
    const bundle = await load(["hex"]);
    expect(bundle.vocabs).toEqual(["fx", "hex"]);
    expect(bundle.primitives.filter((p) => p.vocab === "fx").map((p) => p.name)).toEqual([
      "sleep",
      "busy",
    ]);
    expect(bundle.units.length).toBeGreaterThan(0);
  });
});
