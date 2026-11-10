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
// The main-thread client of the console worker (UI.md section 5.2): a promise API over a transport,
// with a wall-clock watchdog and a hard kill. A run that does not answer within `runTimeoutMs`, or
// that the user stops, terminates the worker and starts a new one with the same user units. The session
// (stack, variables, current vocabulary) is lost, and the run's outcome says so.
import type { Catalogue } from "@forge/ops";
import {
  parseWorkerMessage,
  type ClientMessage,
  type RunError,
  type UserUnit,
  type WorkerMessage,
} from "./protocol.js";

/** What the client needs from a worker; the browser one is in web-worker.ts, tests use a fake. */
export interface ConsoleTransport {
  post(message: ClientMessage): void;
  /** Called for every message from the worker (unvalidated data). */
  onMessage(handler: (data: unknown) => void): void;
  /** Called when the worker crashes or sends something unreadable. */
  onFailure(handler: (message: string) => void): void;
  terminate(): void;
}

export interface InitResult {
  readonly catalogue: Catalogue;
  readonly warnings: readonly string[];
  /** Why the user unit failed to load (the session then runs without it), or null. */
  readonly userError: string | null;
  readonly vocab: string;
  readonly vocabs: readonly string[];
}

export type KillReason = "timeout" | "stopped" | "crashed";

export type RunOutcome =
  | {
      readonly kind: "result";
      readonly ok: boolean;
      readonly output: string;
      readonly stack: readonly string[];
      readonly vocab: string;
      readonly vocabs: readonly string[];
      readonly error?: RunError;
    }
  | { readonly kind: "killed"; readonly reason: KillReason; readonly message: string };

export interface InspectOutcome {
  readonly qname: string;
  readonly ok: boolean;
  readonly meta: string;
  readonly source: string;
  readonly help: string;
  readonly error?: string;
}

export interface ConsoleClientOptions {
  readonly createTransport: () => ConsoleTransport;
  /** Wall-clock limit for one run before the worker is killed. Default 10 s. */
  readonly runTimeoutMs?: number;
  /** Called after a killed worker has been replaced and is ready again (session is fresh). */
  readonly onRestart?: (result: InitResult) => void;
}

export interface ConsoleClient {
  /** (Re)load the user units; resets the session. Starts the worker if it is not running. */
  init(units: readonly UserUnit[]): Promise<InitResult>;
  run(source: string): Promise<RunOutcome>;
  /** Fresh session (empty stack and variables, current vocabulary `user`); resolves with the vocabulary. */
  reset(): Promise<string>;
  inspect(qname: string): Promise<InspectOutcome>;
  /** Hard-kill the worker now. A run in flight resolves as `killed`. */
  stop(): void;
  dispose(): void;
}

export const DEFAULT_RUN_TIMEOUT_MS = 10_000;

interface Pending {
  readonly kind: "init" | "run" | "reset" | "inspect";
  readonly resolve: (value: never) => void;
  readonly reject: (error: Error) => void;
  /** init only: the message of an `init-error` that arrived before `ready`. */
  userError?: string;
}

export function createConsoleClient(options: ConsoleClientOptions): ConsoleClient {
  const timeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  let units: readonly UserUnit[] = [];
  let transport: ConsoleTransport | undefined;
  let ready: Promise<InitResult> | undefined;
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, Pending>();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let watchedId = 0;

  const clearWatchdog = (): void => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = undefined;
  };

  function request<T>(
    kind: Pending["kind"],
    build: (id: number) => ClientMessage,
    t: ConsoleTransport,
  ): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { kind, resolve: resolve as (v: never) => void, reject });
      t.post(build(id));
    });
  }

  /** Terminate the worker, settle everything in flight, and (unless `respawn` is false) start a new one. */
  function kill(reason: KillReason, message: string, respawn: boolean): void {
    clearWatchdog();
    const dead = transport;
    transport = undefined;
    ready = undefined;
    dead?.terminate();
    const settled = [...pending.entries()];
    pending.clear();
    for (const [, p] of settled) {
      if (p.kind === "run")
        (p.resolve as (v: RunOutcome) => void)({ kind: "killed", reason, message });
      else p.reject(new Error(message));
    }
    if (respawn && !disposed) {
      spawn()
        .then((result) => options.onRestart?.(result))
        .catch(() => undefined); // the next request tries again
    }
  }

  function receive(data: unknown): void {
    const message: WorkerMessage | null = parseWorkerMessage(data);
    if (message === null) {
      kill("crashed", "the console worker sent a malformed message and was restarted", false);
      return;
    }
    if (message.type === "fatal") {
      kill("crashed", `the console worker failed (${message.message}) and was restarted`, false);
      return;
    }
    const p = pending.get(message.id);
    if (p === undefined) return;
    switch (message.type) {
      case "init-error":
        p.userError = message.message; // `ready` follows, from the fallback runtime
        return;
      case "ready":
        pending.delete(message.id);
        (p.resolve as (v: InitResult) => void)({
          catalogue: message.catalogue,
          warnings: message.warnings,
          userError: p.userError ?? null,
          vocab: message.vocab,
          vocabs: message.vocabs,
        });
        return;
      case "result": {
        pending.delete(message.id);
        if (watchedId === message.id) clearWatchdog();
        (p.resolve as (v: RunOutcome) => void)({
          kind: "result",
          ok: message.ok,
          output: message.output,
          stack: message.stack,
          vocab: message.vocab,
          vocabs: message.vocabs,
          ...(message.error !== undefined ? { error: message.error } : {}),
        });
        return;
      }
      case "reset-done":
        pending.delete(message.id);
        (p.resolve as (v: string) => void)(message.vocab);
        return;
      case "inspect-result": {
        pending.delete(message.id);
        (p.resolve as (v: InspectOutcome) => void)({
          qname: message.qname,
          ok: message.ok,
          meta: message.meta,
          source: message.source,
          help: message.help,
          ...(message.error !== undefined ? { error: message.error } : {}),
        });
        return;
      }
    }
  }

  /** Create the worker and load the units. */
  function spawn(): Promise<InitResult> {
    const t = options.createTransport();
    transport = t;
    t.onMessage((data) => {
      if (transport === t) receive(data);
    });
    t.onFailure((message) => {
      if (transport === t)
        kill("crashed", `the console worker failed (${message}) and was restarted`, false);
    });
    const loaded = request<InitResult>("init", (id) => ({ type: "init", id, units }), t);
    ready = loaded;
    loaded.catch(() => undefined); // observed by whoever awaits it; never an unhandled rejection
    return loaded;
  }

  function connection(): Promise<ConsoleTransport> {
    if (disposed) return Promise.reject(new Error("the console client is disposed"));
    const loaded =
      transport === undefined ? spawn() : (ready ?? Promise.resolve(undefined as never));
    return loaded.then(() => {
      if (transport === undefined) throw new Error("the console worker was restarted");
      return transport;
    });
  }

  return {
    init(next) {
      units = next;
      if (disposed) return Promise.reject(new Error("the console client is disposed"));
      if (transport === undefined) return spawn();
      const loaded = request<InitResult>("init", (id) => ({ type: "init", id, units }), transport);
      ready = loaded;
      loaded.catch(() => undefined);
      return loaded;
    },

    async run(source) {
      let t: ConsoleTransport;
      try {
        t = await connection();
      } catch (e) {
        return {
          kind: "killed",
          reason: "crashed",
          message: e instanceof Error ? e.message : String(e),
        };
      }
      const outcome = request<RunOutcome>(
        "run",
        (id) => {
          watchedId = id;
          clearWatchdog();
          watchdog = setTimeout(() => {
            kill(
              "timeout",
              `the line ran for more than ${Math.round(timeoutMs / 1000)} s; the console worker was restarted and the session (stack, variables, vocabulary) was lost`,
              true,
            );
          }, timeoutMs);
          return { type: "run", id, source };
        },
        t,
      );
      return outcome;
    },

    async reset() {
      const t = await connection();
      return request<string>("reset", (id) => ({ type: "reset", id }), t);
    },

    async inspect(qname) {
      const t = await connection();
      return request<InspectOutcome>("inspect", (id) => ({ type: "inspect", id, qname }), t);
    },

    stop() {
      if (transport === undefined) return;
      kill(
        "stopped",
        "stopped; the console worker was restarted and the session (stack, variables, vocabulary) was lost",
        true,
      );
    },

    dispose() {
      disposed = true;
      clearWatchdog();
      transport?.post({ type: "dispose" });
      transport?.terminate();
      transport = undefined;
      ready = undefined;
      for (const [, p] of pending) p.reject(new Error("the console client is disposed"));
      pending.clear();
    },
  };
}
