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

// The package builds against ES2022 only (no Node typings). These are the Node APIs the core
// vocabulary test uses to read the table of docs/LANGUAGE.md.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
interface ImportMeta {
  readonly url: string;
}
