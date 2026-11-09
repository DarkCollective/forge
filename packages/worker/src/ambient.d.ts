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

// The package builds against ES2022 only (no DOM or Node typings, RECIPES.md section 11.6). These are the
// host APIs it uses. Browsers, Web Workers and Node 20 all provide the globals.

declare class AbortController {
  readonly signal: import("@forge/lang").AbortSignalLike;
  abort(reason?: unknown): void;
}

declare const performance: { now(): number };

declare function setTimeout(handler: (...args: never[]) => void, ms?: number): unknown;
declare function clearTimeout(handle: unknown): void;

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

/** The global scope of a dedicated Web Worker, as `worker-web.ts` uses it. */
declare const self: {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
};

declare class URL {
  constructor(url: string, base?: string);
  readonly href: string;
}

interface ImportMeta {
  readonly url: string;
}

declare module "node:worker_threads" {
  export class Worker {
    constructor(filename: string, options?: { workerData?: unknown });
    postMessage(value: unknown, transferList?: readonly unknown[]): void;
    on(event: "message", listener: (value: unknown) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "exit", listener: (code: number) => void): this;
    terminate(): Promise<number>;
  }
  export const parentPort: {
    postMessage(value: unknown, transferList?: readonly unknown[]): void;
    on(event: "message", listener: (value: unknown) => void): void;
  } | null;
  export const workerData: unknown;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
