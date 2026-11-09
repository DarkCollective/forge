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

// The few Node APIs the tests use (the package builds without Node typings).
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
declare module "@forge/ops/catalogue.json" {
  const catalogue: unknown;
  export default catalogue;
}
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
