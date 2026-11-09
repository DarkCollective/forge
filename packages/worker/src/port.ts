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
 * The worker side of the message protocol (RECIPES.md section 8.4): `attachBakerCore(port, core)`.
 */
import { isClientMessage } from "./protocol.js";
import { PROTOCOL_VERSION } from "./types.js";
import type {
  AttachBakerCoreFn,
  BakeError,
  BakeResult,
  ClientMessage,
  OutputValue,
  WorkerMessage,
} from "./types.js";

/** Cancel requests kept for bakes that have been accepted but not started. */
const MAX_PENDING_CANCELS = 64;

/** Every `ArrayBuffer` of a `bytes` value inside an output, each once. */
function collectBuffers(output: OutputValue | undefined, into: Set<ArrayBuffer>): void {
  if (output === undefined) return;
  if (output.kind === "bytes") into.add(output.bytes.buffer as ArrayBuffer);
  else if (output.kind === "list") for (const item of output.items) collectBuffers(item, into);
  else if (output.kind === "record") for (const e of output.entries) collectBuffers(e.value, into);
}

function failedResult(id: number, error: BakeError): BakeResult {
  return {
    id,
    ok: false,
    error,
    steps: [],
    coercions: [],
    coercionsTruncated: false,
    warnings: [],
    stats: { elapsedMs: 0, vmSteps: 0, effects: [] },
  };
}

export const attachBakerCore: AttachBakerCoreFn = (port, core) => {
  let dead = false;
  let lastId = 0;
  let activeId: number | null = null;
  let queue: Promise<void> = Promise.resolve();
  const cancelled = new Set<number>();

  const post = (message: WorkerMessage, transfer?: ArrayBuffer[]): void => {
    port.postMessage(message, transfer);
  };
  const fatal = (message: string): void => {
    dead = true;
    post({ type: "fatal", message });
  };
  const enqueue = (job: () => Promise<void>): void => {
    queue = queue.then(job).catch((e: unknown) => {
      fatal(e instanceof Error ? e.message : String(e));
    });
  };

  const protocolError = (message: string): BakeError => ({
    code: "E_PROTOCOL",
    message,
    path: null,
    word: null,
    detail: {},
  });

  async function runInit(msg: Extract<ClientMessage, { type: "init" }>): Promise<void> {
    try {
      const info = await core.init(msg.init);
      post({ type: "ready", reqId: msg.reqId, info });
    } catch (e) {
      post({
        type: "init-error",
        reqId: msg.reqId,
        error: {
          code: "E_INTERNAL",
          message: e instanceof Error ? e.message : String(e),
          path: null,
          word: null,
          detail: {},
        },
      });
    }
  }

  async function runBake(msg: Extract<ClientMessage, { type: "bake" }>): Promise<void> {
    if (msg.id <= lastId) {
      post({
        type: "result",
        id: msg.id,
        result: failedResult(msg.id, protocolError("bake id is not larger than the last one")),
      });
      return;
    }
    lastId = msg.id;
    if (cancelled.delete(msg.id)) {
      post({
        type: "result",
        id: msg.id,
        result: failedResult(msg.id, {
          code: "E_ABORTED",
          message: "cancelled before it started",
          path: null,
          word: null,
          detail: {},
        }),
      });
      return;
    }
    activeId = msg.id;
    try {
      const result = await core.bake(msg.recipe, new Uint8Array(msg.input), {
        ...msg.options,
        ...(msg.abort === undefined ? {} : { abortFlag: new Int32Array(msg.abort) }),
        onEvent: (event) => post({ type: "event", id: msg.id, event: { ...event, id: msg.id } }),
      });
      const buffers = new Set<ArrayBuffer>();
      if (result.ok) collectBuffers(result.output, buffers);
      else collectBuffers(result.partial, buffers);
      post({ type: "result", id: msg.id, result: { ...result, id: msg.id } }, [...buffers]);
    } finally {
      activeId = null;
    }
  }

  port.onMessage((raw) => {
    if (dead) return;
    if (!isClientMessage(raw)) {
      fatal("malformed message");
      return;
    }
    const msg = raw;
    switch (msg.type) {
      case "init":
        if (msg.protocol !== PROTOCOL_VERSION) {
          post({
            type: "init-error",
            reqId: msg.reqId,
            error: protocolError(`protocol ${String(msg.protocol)} is not supported`),
          });
          return;
        }
        if (activeId !== null) void core.cancel();
        enqueue(() => runInit(msg));
        return;
      case "bake":
        if (activeId !== null) void core.cancel();
        enqueue(() => runBake(msg));
        return;
      case "step":
      case "continue":
      case "cancel":
        if (msg.id !== activeId) {
          if (msg.type === "cancel" && msg.id > lastId && cancelled.size < MAX_PENDING_CANCELS) {
            cancelled.add(msg.id);
          }
          return;
        }
        void core[msg.type]();
        return;
      case "dispose":
        if (activeId !== null) void core.cancel();
        enqueue(() => core.dispose());
        return;
    }
  });
};
