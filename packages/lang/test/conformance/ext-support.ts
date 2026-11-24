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
/*
 * Gives a conformance run the fixtures of LANGUAGE-0.3.md section 17.0 that the runtime under test
 * can take. Before X1 that is `fx:charge` and `fx:spin` (they need `ctx.charge` to do anything, and
 * fail cleanly without it); after X1 and L8 it is all of them, with the kinds and tags registered.
 */
import type { CreateRuntimeFn, PrimitiveDef } from "../../src/types.js";
import {
  extPrimitives,
  plainExt,
  registerExtFixtures,
  type ExtRegistryApi,
} from "./ext-fixtures.js";

/** The exports of `src/ext.ts`, or undefined while that module does not exist (before X1). */
export async function loadExtApi(): Promise<ExtRegistryApi | undefined> {
  // The specifier is a variable so that type-checking and bundling do not require the module.
  const specifier = "../../src/ext.js";
  try {
    return (await import(/* @vite-ignore */ specifier)) as ExtRegistryApi;
  } catch {
    return undefined;
  }
}

export interface ExtSupport {
  /** The fixture primitives the runtime accepted, to pass as `extra` to `executeCase`. */
  readonly accepted: readonly PrimitiveDef[];
  /** Qualified names of the ones it rejected (a header or label it does not know yet). */
  readonly rejected: readonly string[];
}

/**
 * Probes each primitive of section 17.0 on its own with `createRuntime` (a runtime rejects one whose
 * header or label it does not know). With `ext` given, the kinds and tags are registered first, once
 * per process, and `ext()` builds the values.
 */
export function supportedExtPrimitives(
  createRuntime: CreateRuntimeFn,
  ext?: ExtRegistryApi,
): ExtSupport {
  if (ext !== undefined) registerExtFixtures(ext);
  const accepted: PrimitiveDef[] = [];
  const rejected: string[] = [];
  for (const def of extPrimitives(ext?.ext ?? plainExt)) {
    try {
      createRuntime({ primitives: [def] });
      accepted.push(def);
    } catch {
      rejected.push(`${def.vocab}:${def.name}`);
    }
  }
  return { accepted, rejected };
}
