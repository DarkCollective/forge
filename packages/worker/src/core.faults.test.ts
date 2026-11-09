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

// The core's defences against faults that a valid recipe cannot normally cause (a compile or load
// failure, a runtime that throws, stray hook events): the runtime and the compiler are wrapped to
// misbehave on demand.
import { ForgeError } from "@forge/lang";
import type { ForgeRuntime, RunOptions, RunResult, StepEvent } from "@forge/lang";
import { loadBundleNode } from "@forge/ops/node";
import { afterEach, describe, expect, test, vi } from "vitest";
import { utf8 } from "../test/helpers.js";
import { createBakerCore } from "./core.js";
import type { BakeResult } from "./types.js";

const fault = vi.hoisted(() => ({
  load: null as null | (() => never),
  compile: false,
  call: null as null | ((real: () => Promise<RunResult>, opts: RunOptions) => Promise<RunResult>),
  onLoad: null as null | (() => void),
}));

vi.mock("@forge/ops", async (importOriginal) => {
  const original = await importOriginal<typeof import("@forge/ops")>();
  return {
    ...original,
    assembleRuntime: (...args: Parameters<typeof original.assembleRuntime>): ForgeRuntime => {
      const rt = original.assembleRuntime(...args);
      return new Proxy(rt, {
        get(target, prop) {
          if (prop === "load") {
            return (source: string, opts?: Parameters<ForgeRuntime["load"]>[1]) => {
              if (opts?.unit === "recipe") {
                fault.onLoad?.();
                fault.load?.();
              }
              return target.load(source, opts);
            };
          }
          if (prop === "call") {
            return (name: string, args2: never, opts: RunOptions) => {
              const real = () => target.call(name, args2, opts);
              return fault.call ? fault.call(real, opts) : real();
            };
          }
          return Reflect.get(target, prop) as unknown;
        },
      });
    },
  };
});

vi.mock("@forge/recipe", async (importOriginal) => {
  const original = await importOriginal<typeof import("@forge/recipe")>();
  return {
    ...original,
    compileRecipe: (...args: Parameters<typeof original.compileRecipe>) =>
      fault.compile ? { ok: false as const, issues: [] } : original.compileRecipe(...args),
  };
});

afterEach(() => {
  fault.load = null;
  fault.compile = false;
  fault.call = null;
  fault.onLoad = null;
});

const recipe = {
  forge: 1,
  steps: [
    { kind: "op", op: "hex:decode" },
    { kind: "op", op: "text:upper" },
  ],
};
const T = { trust: "trusted" } as const;

async function ready() {
  const baker = createBakerCore({ loadBundle: loadBundleNode });
  await baker.init();
  return baker;
}

function error(r: BakeResult) {
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

describe("faults", () => {
  test("a compile failure after validation is E_INTERNAL with the issues", async () => {
    const baker = await ready();
    fault.compile = true;
    const e = error(await baker.bake(recipe, utf8("6162"), T));
    expect(e.code).toBe("E_INTERNAL");
    expect(e.issues).toEqual([]);
  });

  test("a ForgeError while loading keeps its code and detail", async () => {
    const baker = await ready();
    fault.load = () => {
      throw new ForgeError({ code: "E_LIMIT_SOURCE", message: "too long", detail: { max: 1 } });
    };
    const e = error(await baker.bake(recipe, utf8("6162"), T));
    expect(e).toMatchObject({ code: "E_LIMIT_SOURCE", detail: { max: 1 } });
  });

  test("any other error while loading is E_INTERNAL", async () => {
    const baker = await ready();
    fault.load = () => {
      throw new Error("disk on fire");
    };
    const e = error(await baker.bake(recipe, utf8("6162"), T));
    expect(e).toMatchObject({ code: "E_INTERNAL", message: "disk on fire" });
    fault.load = () => {
      throw "a string" as unknown as Error;
    };
    expect(error(await baker.bake(recipe, utf8("6162"), T)).message).toBe("a string");
  });

  test("a bake cancelled while it is being set up ends E_ABORTED without running", async () => {
    const baker = await ready();
    fault.onLoad = () => void baker.cancel();
    const calls: number[] = [];
    fault.call = (real) => {
      calls.push(1);
      return real();
    };
    const e = error(await baker.bake(recipe, utf8("6162"), T));
    expect(e.code).toBe("E_ABORTED");
    expect(calls).toEqual([]);
  });

  test("a runtime that throws is E_INTERNAL", async () => {
    const baker = await ready();
    fault.call = () => Promise.reject(new Error("vm exploded"));
    expect(error(await baker.bake(recipe, utf8("6162"), T))).toMatchObject({
      code: "E_INTERNAL",
      message: "vm exploded",
    });
  });

  test("stray hook events are ignored: another word, an unknown ip, an end without a start", async () => {
    const baker = await ready();
    fault.call = async (real, opts) => {
      const hook = opts.onStep as (e: StepEvent) => unknown;
      const bps = opts.breakpoints as { word: string; ip: number }[];
      const word = (bps[0] as { word: string }).word;
      const last = (bps[bps.length - 1] as { ip: number }).ip;
      const fake = (w: string, ip: number) =>
        ({ step: 1, word: w, ip, stack: [] }) as unknown as StepEvent;
      hook(fake("other:word", 0));
      hook(fake(word, 99_999));
      hook(fake(word, last));
      return real();
    };
    const r = await baker.bake(recipe, utf8("6162"), T);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.path)).toEqual(["/steps/0", "/steps/1"]);
  });

  test("a result without a value, and a failure without a stack", async () => {
    const baker = await ready();
    const base = { output: "", steps: 1, elapsedMs: 0, coercions: [], effects: [] };
    fault.call = () => Promise.resolve({ ...base, ok: true, stack: [] } as RunResult);
    expect(error(await baker.bake(recipe, utf8("6162"), T))).toMatchObject({
      code: "E_INTERNAL",
      message: "the recipe left no value",
    });
    const err = new ForgeError({ code: "E_RANGE", message: "x", frames: [] });
    fault.call = () => Promise.resolve({ ...base, ok: false, stack: [], error: err } as RunResult);
    const r = await baker.bake(recipe, utf8("6162"), T);
    expect(r.ok === false && r.partial).toBeUndefined();
    expect(error(r)).toMatchObject({ code: "E_RANGE", path: null });
  });

  test("only coercions of the data input count", async () => {
    const baker = await ready();
    fault.call = async (real) => {
      const r = await real();
      return {
        ...r,
        coercions: [
          { step: 3, word: "text:upper", slot: 1, name: null, from: "int", to: "str" },
          ...r.coercions,
        ],
      } as RunResult;
    };
    const r = await baker.bake(recipe, utf8("6162"), T);
    expect(r.coercions.every((c) => c.from === "bytes")).toBe(true);
  });
});
