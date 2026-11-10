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

// The package builds against ES2022 only (no Node or DOM typings). These are the few host APIs the
// package uses: the Node provider and the build script read files, and the tests make temporary
// directories. Declared minimally, as in @forge/lang.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string): string;
  export function pathToFileURL(path: string): { readonly href: string };
}

/**
 * Test-only: charset.test.ts compares the package's UTF-8 encoder with the host's. Node 20 and
 * browsers both provide TextEncoder as a global; only the member the test uses is declared.
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

interface ImportMeta {
  readonly url: string;
  /**
   * Vite's `import.meta.glob`, only the overloads `sources-vite.ts` uses. Vite replaces the calls at
   * build time; they exist at run time only under Vite (and Vitest).
   */
  glob<T = unknown>(
    pattern: string | readonly string[],
    options: {
      readonly eager: true;
      readonly query?: string;
      readonly import?: string;
    },
  ): Record<string, T>;
  glob<T = unknown>(
    pattern: string | readonly string[],
    options?: {
      readonly eager?: false;
      readonly query?: string;
      readonly import?: string;
    },
  ): Record<string, () => Promise<T>>;
}
