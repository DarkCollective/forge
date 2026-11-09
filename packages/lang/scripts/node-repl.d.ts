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

// The package builds without Node typings (TypeScript 6 includes no @types packages by default).
// These are the Node APIs the console (repl.ts) and its test use, declared the same way as
// src/node-fs.d.ts.
interface ConsoleStream {
  write(chunk: string): boolean;
  readonly isTTY?: boolean;
}

declare const process: {
  readonly stdin: ConsoleStream;
  readonly stdout: ConsoleStream;
  readonly stderr: ConsoleStream;
  readonly execPath: string;
  exitCode: number | undefined;
};

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
}

declare module "node:readline" {
  export interface Interface extends AsyncIterable<string> {
    setPrompt(prompt: string): void;
    prompt(): void;
    close(): void;
    on(event: "SIGINT", listener: () => void): this;
  }
  export function createInterface(options: {
    input: unknown;
    output?: unknown;
    terminal?: boolean;
  }): Interface;
}

declare module "node:child_process" {
  export interface SpawnSyncReturns {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: { input?: string; encoding: "utf8" },
  ): SpawnSyncReturns;
}
