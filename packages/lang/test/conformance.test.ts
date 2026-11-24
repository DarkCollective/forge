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
 * The FL conformance suite (docs/LANGUAGE.md section 16): one Vitest test per `fl-test` block, each
 * against a fresh runtime. The whole file skips while packages/lang/src/runtime.ts does not exist.
 * The runner itself is conformance/run.ts; the `fl-proposed` blocks are proposed.test.ts's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it } from "vitest";
import type { CreateRuntimeFn, PrimitiveDef } from "../src/types.js";
import { loadExtApi, supportedExtPrimitives } from "./conformance/ext-support.js";
import { loadSpec } from "./conformance/parse.js";
import {
  DEFAULT_TIMEOUT_MS,
  TIMING_SLACK_MS,
  executeCase,
  timingLimitMs,
} from "./conformance/run.js";

const runtimeUrl = new URL("../src/runtime.ts", import.meta.url);
const runtimeAvailable = ((): boolean => {
  try {
    readFileSync(fileURLToPath(runtimeUrl.href), "utf8");
    return true;
  } catch {
    return false;
  }
})();

if (!runtimeAvailable) {
  console.warn(
    "[conformance] packages/lang/src/runtime.ts does not exist yet: the FL conformance suite is skipped.",
  );
}

const spec = loadSpec();
let createRuntime: CreateRuntimeFn;
let extra: readonly PrimitiveDef[] = [];

beforeAll(async () => {
  if (!runtimeAvailable) return;
  // The specifier is a variable so that type-checking does not require the module to exist.
  const specifier = "../src/runtime.js";
  const mod = (await import(/* @vite-ignore */ specifier)) as { createRuntime: CreateRuntimeFn };
  createRuntime = mod.createRuntime;
  // The section 17.0 fixtures join the suite once ext.ts exists; before X1 the suite is v0.2 only.
  const ext = await loadExtApi();
  if (ext !== undefined) extra = supportedExtPrimitives(createRuntime, ext).accepted;
});

describe.skipIf(!runtimeAvailable)(
  runtimeAvailable
    ? "FL conformance (LANGUAGE.md section 16)"
    : "FL conformance SKIPPED: packages/lang/src/runtime.ts does not exist yet",
  () => {
    for (const tc of spec.cases) {
      const timeout = DEFAULT_TIMEOUT_MS + (tc.timing ? timingLimitMs(tc) + TIMING_SLACK_MS : 0);
      it(tc.name, { timeout }, async () => {
        await executeCase(createRuntime, spec.units, tc, extra);
      });
    }
  },
);
