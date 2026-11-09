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
 * The main-thread client (RECIPES.md sections 8.5 and 8.7): promises over a `WorkerHost`, the shared
 * abort flag, and the watchdog that terminates a worker that cannot be stopped any other way.
 */
import { effectiveLimits } from "./limits.js";
import { isWorkerMessage } from "./protocol.js";
import { PROTOCOL_VERSION, WATCHDOG_DEFAULTS } from "./types.js";
import type {
  BakeError,
  BakeErrorCode,
  BakeEvent,
  BakeOptions,
  BakeResult,
  BakerClient,
  BakerInit,
  CreateBakerClientFn,
  InitInfo,
  SerialBakeOptions,
  WorkerHost,
  WorkerMessage,
} from "./types.js";

/** Longest delay a timer can take. */
const MAX_TIMER = 2 ** 31 - 1;

interface PendingInit {
  readonly resolve: (info: InitInfo) => void;
  readonly reject: (error: Error) => void;
}

interface ActiveBake {
  readonly id: number;
  readonly t0: number;
  readonly onEvent: ((event: BakeEvent) => void) | undefined;
  readonly flag: Int32Array | null;
  readonly maxMillis: number;
  readonly settled: Promise<BakeResult>;
  readonly settle: (result: BakeResult) => void;
  lastPath: string | null;
  deadlineTimer: unknown;
  deadlineAt: number;
  deadlineRemaining: number | null;
  cancelTimer: unknown;
}

function synthesised(
  id: number,
  code: BakeErrorCode,
  message: string,
  path: string | null,
  elapsedMs: number,
  terminated: boolean,
): BakeResult {
  const error: BakeError = {
    code,
    message,
    path,
    word: null,
    detail: {},
    ...(terminated ? { terminated: true } : {}),
  };
  return {
    id,
    ok: false,
    error,
    steps: [],
    coercions: [],
    coercionsTruncated: false,
    warnings: [],
    stats: { elapsedMs, vmSteps: 0, effects: [] },
  };
}

function notReady(id: number, message: string): BakeResult {
  return synthesised(id, "E_NOT_READY", message, null, 0, false);
}

export const createBakerClient: CreateBakerClientFn = (options): BakerClient => {
  const cancelGraceMs = options.cancelGraceMs ?? WATCHDOG_DEFAULTS.cancelGraceMs;
  const deadlineGraceMs = options.deadlineGraceMs ?? WATCHDOG_DEFAULTS.deadlineGraceMs;
  const sharedAllowed = options.sharedAbort !== false;

  let host: WorkerHost | null = null;
  let lastInit: BakerInit | null = null;
  let nextReq = 1;
  let nextId = 1;
  /** Resolves when the current host has an initialised runtime; replaced when a host is recreated. */
  let hostReady: Promise<boolean> = Promise.resolve(true);
  const pendingInits = new Map<number, PendingInit>();
  let active: ActiveBake | null = null;

  function clearTimers(a: ActiveBake): void {
    clearTimeout(a.deadlineTimer);
    clearTimeout(a.cancelTimer);
    a.deadlineTimer = undefined;
    a.cancelTimer = undefined;
  }

  function finish(a: ActiveBake, result: BakeResult): void {
    clearTimers(a);
    active = null;
    a.settle(result);
  }

  /** Stop the worker for good, fail what was waiting for it, and let the next call create a new one. */
  function dropHost(): void {
    const old = host;
    host = null;
    old?.terminate();
    for (const p of pendingInits.values()) p.reject(new Error("the worker was terminated"));
    pendingInits.clear();
  }

  function kill(code: BakeErrorCode, message: string): void {
    const a = active;
    dropHost();
    if (a === null) return;
    finish(a, synthesised(a.id, code, message, a.lastPath, performance.now() - a.t0, true));
  }

  function handle(h: WorkerHost, message: WorkerMessage): void {
    if (h !== host) return;
    switch (message.type) {
      case "ready":
        pendingInits.get(message.reqId)?.resolve(message.info);
        pendingInits.delete(message.reqId);
        return;
      case "init-error":
        pendingInits.get(message.reqId)?.reject(new Error(message.error.message));
        pendingInits.delete(message.reqId);
        return;
      case "event": {
        const a = active;
        if (a === null || a.id !== message.id) return;
        onEvent(a, message.event);
        return;
      }
      case "result": {
        const a = active;
        if (a === null || a.id !== message.id) return;
        finish(a, message.result);
        return;
      }
      case "fatal":
        kill("E_INTERNAL", `the worker failed: ${message.message}`);
        return;
    }
  }

  function armDeadline(a: ActiveBake, ms: number): void {
    if (!Number.isFinite(ms)) return;
    const delay = Math.min(Math.max(ms, 0), MAX_TIMER);
    a.deadlineAt = performance.now() + delay;
    a.deadlineTimer = setTimeout(() => {
      kill("E_LIMIT_TIME", "the bake exceeded its time limit and was terminated");
    }, delay);
  }

  function onEvent(a: ActiveBake, event: BakeEvent): void {
    if (event.type === "progress") a.lastPath = event.path;
    else if (event.type === "paused" && a.deadlineTimer !== undefined) {
      a.deadlineRemaining = Math.max(0, a.deadlineAt - performance.now());
      clearTimeout(a.deadlineTimer);
      a.deadlineTimer = undefined;
    } else if (event.type === "resumed" && a.deadlineRemaining !== null) {
      armDeadline(a, a.deadlineRemaining);
      a.deadlineRemaining = null;
    }
    try {
      a.onEvent?.(event);
    } catch {
      // A faulty listener must not disturb the protocol.
    }
  }

  /** The current host, creating one (and re-sending the last `init`) when there is none. */
  function ensureHost(): WorkerHost {
    if (host !== null) return host;
    const h = options.host();
    host = h;
    h.onMessage((message) => {
      if (!isWorkerMessage(message)) {
        if (h === host) kill("E_INTERNAL", "the worker sent a malformed message");
        return;
      }
      handle(h, message);
    });
    h.onError((error) => {
      if (h === host) kill("E_INTERNAL", `the worker failed: ${error.message}`);
    });
    if (lastInit !== null)
      hostReady = sendInit(h, lastInit).then(
        () => true,
        () => false,
      );
    return h;
  }

  function sendInit(h: WorkerHost, init: BakerInit): Promise<InitInfo> {
    return new Promise<InitInfo>((resolve, reject) => {
      const reqId = nextReq++;
      pendingInits.set(reqId, { resolve, reject });
      h.postMessage({ type: "init", reqId, protocol: PROTOCOL_VERSION, init });
    });
  }

  async function init(request: BakerInit = {}): Promise<InitInfo> {
    await cancel();
    lastInit = null; // a recreated host must not also replay the old init
    const h = ensureHost();
    lastInit = request;
    const attempt = sendInit(h, request);
    hostReady = attempt.then(
      () => true,
      () => false,
    );
    return attempt;
  }

  async function bake(
    recipe: unknown,
    input: Uint8Array,
    bakeOptions: BakeOptions = {},
  ): Promise<BakeResult> {
    if (active !== null) await cancel();
    const id = nextId++;
    if (lastInit === null) return notReady(id, "the baker has not been initialised");
    const h = ensureHost();
    if (!(await hostReady)) return notReady(id, "the worker could not be initialised");
    if (h !== host) return synthesised(id, "E_INTERNAL", "the worker failed", null, 0, true);

    const { onEvent: listener, abortFlag: _ignored, ...serial } = bakeOptions;
    void _ignored;
    const wire: SerialBakeOptions = serial;
    const copy = new ArrayBuffer(input.length);
    new Uint8Array(copy).set(input);

    const useFlag =
      sharedAllowed &&
      typeof SharedArrayBuffer !== "undefined" &&
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
    const sab = useFlag ? new SharedArrayBuffer(4) : undefined;

    let settle: (result: BakeResult) => void = () => undefined;
    const settled = new Promise<BakeResult>((resolve) => (settle = resolve));
    const a: ActiveBake = {
      id,
      t0: performance.now(),
      onEvent: listener,
      flag: sab === undefined ? null : new Int32Array(sab),
      maxMillis: effectiveLimits(bakeOptions.trust ?? "untrusted", bakeOptions.limits).maxMillis,
      settled,
      settle,
      lastPath: null,
      deadlineTimer: undefined,
      deadlineAt: 0,
      deadlineRemaining: null,
      cancelTimer: undefined,
    };
    active = a;
    armDeadline(a, a.maxMillis + deadlineGraceMs);
    h.postMessage(
      {
        type: "bake",
        id,
        recipe,
        input: copy,
        options: wire,
        ...(sab === undefined ? {} : { abort: sab }),
      },
      [copy],
    );
    return settled;
  }

  function control(type: "step" | "continue"): Promise<void> {
    if (active !== null && host !== null) host.postMessage({ type, id: active.id });
    return Promise.resolve();
  }

  async function cancel(): Promise<void> {
    const a = active;
    if (a === null) return;
    if (a.cancelTimer === undefined) {
      if (a.flag !== null) Atomics.store(a.flag, 0, 1);
      host?.postMessage({ type: "cancel", id: a.id });
      a.cancelTimer = setTimeout(() => {
        kill("E_ABORTED", "the bake did not stop and was terminated");
      }, cancelGraceMs);
    }
    await a.settled;
  }

  return {
    hardKill: true,
    init,
    bake,
    step: () => control("step"),
    continue: () => control("continue"),
    cancel,
    async dispose() {
      await cancel();
      host?.postMessage({ type: "dispose" });
      dropHost();
      lastInit = null;
      hostReady = Promise.resolve(true);
    },
  };
};
