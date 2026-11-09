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
// The package builds against ES2022 only (no DOM or Node typings). These are the few host
// globals the conformance harness uses; Node and every browser provide them.
declare class URL {
  readonly href: string;
  constructor(input: string, base?: string);
}
declare class AbortController {
  readonly signal: {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: "abort", listener: () => void): void;
  };
  abort(): void;
}
declare function setTimeout(handler: () => void, ms?: number): number;
declare function clearTimeout(handle: number | undefined): void;
declare const performance: { now(): number };
declare const console: { warn(...data: unknown[]): void };
