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
import catalogueJson from "@forge/ops/catalogue.json";
import type { Catalogue, LoadBundleFn } from "@forge/ops";
import { withPrimitiveModules } from "../src/extra.js";
import { stripTimings } from "../src/render.js";
import type { BakeResult } from "../src/types.js";

/** The real, built catalogue (never a fixture, so pins are real hashes). */
export const catalogue = catalogueJson as Catalogue;

export const FX_URL = new URL("./fixtures/fx.mjs", import.meta.url).href;

/** `loadBundleNode` plus the `fx` fixture vocabulary. */
export const fxLoader: LoadBundleFn = withPrimitiveModules(loadBundleNode, [FX_URL]);

export const GATE2_RECIPE = {
  forge: 1,
  steps: [
    { kind: "op", op: "base64:decode", params: { alphabet: "standard" } },
    { kind: "op", op: "classical:rot", params: { amount: 13 } },
    { kind: "op", op: "hex:encode", params: { case: "lower", delimiter: "none" } },
  ],
};

export const GATE2_TEXT = "VXJ5eWIsIEpiZXlxIQ==";
export const GATE2_HEX = "48656c6c6f2c20576f726c6421";

export const GATE2_FRAGMENT =
  "v=1&r=1bY2xDgIhEAX_5dU0F43F_oqx2IP1jggsYTGaEP7dWBqvmW5mBu7aNgEtDtalGug68IglgKAV7gvCyiaXMwXxGgQOlRtnAw1wqjuv0kGwziVwC5jTHTR8YrPoOVHT_tvI-iwdtJyOzV3eJOVv7dkEhKQvaXAIkmKOXRoIRYtgztv8AA&i=0VlhKNWVXSXNJRXBpWlhseElRPT0&ie=utf8";

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** `JSON.stringify` of the stripped result, bytes as hex (RECIPES.md section 10.3, Identity). */
export function resultKey(result: BakeResult): string {
  return JSON.stringify(stripTimings(result), (_k, v: unknown) =>
    v instanceof Uint8Array ? Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("") : v,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
