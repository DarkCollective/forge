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
// The console worker protocol (UI.md section 5.2). Structured-clone-only: every FL value is rendered
// to text inside the worker, no `Value` crosses the boundary. Both sides validate the shape of every
// message they receive (a worker message is data, never trusted to be well formed).
import type { Catalogue } from "@forge/ops";

export interface UserUnit {
  readonly name: string;
  readonly source: string;
}

/** Client to worker. Every request carries an `id` that the answer repeats. */
export type ClientMessage =
  | { readonly type: "init"; readonly id: number; readonly units: readonly UserUnit[] }
  | { readonly type: "run"; readonly id: number; readonly source: string }
  | { readonly type: "reset"; readonly id: number }
  | { readonly type: "inspect"; readonly id: number; readonly qname: string }
  | { readonly type: "dispose" };

export interface RunError {
  readonly code: string;
  /** `formatErrorMessage` text. */
  readonly message: string;
}

/** Worker to client. */
export type WorkerMessage =
  | {
      readonly type: "ready";
      readonly id: number;
      readonly catalogue: Catalogue;
      readonly warnings: readonly string[];
      readonly vocab: string;
      readonly vocabs: readonly string[];
    }
  | { readonly type: "init-error"; readonly id: number; readonly message: string }
  | {
      readonly type: "result";
      readonly id: number;
      readonly ok: boolean;
      readonly output: string;
      /** The `.s` text of the stack after the line, one string per line. */
      readonly stack: readonly string[];
      readonly vocab: string;
      readonly vocabs: readonly string[];
      readonly error?: RunError;
    }
  | { readonly type: "reset-done"; readonly id: number; readonly vocab: string }
  | {
      readonly type: "inspect-result";
      readonly id: number;
      readonly qname: string;
      readonly ok: boolean;
      /** Metadata as plain text (empty when not ok). */
      readonly meta: string;
      /** The word's source text, or a short description when it has none. */
      readonly source: string;
      /** Output of the language's own `help`. */
      readonly help: string;
      readonly error?: string;
    }
  | { readonly type: "fatal"; readonly message: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Shape check of a catalogue (not a full schema validation: the producer is our own worker). */
export function isCatalogueShape(v: unknown): v is Catalogue {
  return (
    isRecord(v) &&
    v["format"] === 1 &&
    typeof v["version"] === "string" &&
    isStringArray(v["vocabs"]) &&
    Array.isArray(v["ops"]) &&
    v["ops"].every(
      (op) => isRecord(op) && typeof op["qname"] === "string" && typeof op["vocab"] === "string",
    )
  );
}

function parseUnits(v: unknown): UserUnit[] | null {
  if (!Array.isArray(v)) return null;
  const units: UserUnit[] = [];
  for (const u of v) {
    if (!isRecord(u) || typeof u["name"] !== "string" || typeof u["source"] !== "string")
      return null;
    units.push({ name: u["name"], source: u["source"] });
  }
  return units;
}

/** Validate a message received by the worker; `null` when it is not a well formed `ClientMessage`. */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (!isRecord(data)) return null;
  const id = data["id"];
  switch (data["type"]) {
    case "init": {
      const units = parseUnits(data["units"]);
      return isId(id) && units !== null ? { type: "init", id, units } : null;
    }
    case "run":
      return isId(id) && typeof data["source"] === "string"
        ? { type: "run", id, source: data["source"] }
        : null;
    case "reset":
      return isId(id) ? { type: "reset", id } : null;
    case "inspect":
      return isId(id) && typeof data["qname"] === "string"
        ? { type: "inspect", id, qname: data["qname"] }
        : null;
    case "dispose":
      return { type: "dispose" };
    default:
      return null;
  }
}

function parseRunError(v: unknown): RunError | undefined | null {
  if (v === undefined) return undefined;
  if (!isRecord(v) || typeof v["code"] !== "string" || typeof v["message"] !== "string")
    return null;
  return { code: v["code"], message: v["message"] };
}

/** Validate a message received by the client; `null` when it is not a well formed `WorkerMessage`. */
export function parseWorkerMessage(data: unknown): WorkerMessage | null {
  if (!isRecord(data)) return null;
  const id = data["id"];
  switch (data["type"]) {
    case "ready":
      return isId(id) &&
        isCatalogueShape(data["catalogue"]) &&
        isStringArray(data["warnings"]) &&
        typeof data["vocab"] === "string" &&
        isStringArray(data["vocabs"])
        ? {
            type: "ready",
            id,
            catalogue: data["catalogue"],
            warnings: data["warnings"],
            vocab: data["vocab"],
            vocabs: data["vocabs"],
          }
        : null;
    case "init-error":
      return isId(id) && typeof data["message"] === "string"
        ? { type: "init-error", id, message: data["message"] }
        : null;
    case "result": {
      const error = parseRunError(data["error"]);
      if (
        !isId(id) ||
        typeof data["ok"] !== "boolean" ||
        typeof data["output"] !== "string" ||
        !isStringArray(data["stack"]) ||
        typeof data["vocab"] !== "string" ||
        !isStringArray(data["vocabs"]) ||
        error === null
      ) {
        return null;
      }
      return {
        type: "result",
        id,
        ok: data["ok"],
        output: data["output"],
        stack: data["stack"],
        vocab: data["vocab"],
        vocabs: data["vocabs"],
        ...(error !== undefined ? { error } : {}),
      };
    }
    case "reset-done":
      return isId(id) && typeof data["vocab"] === "string"
        ? { type: "reset-done", id, vocab: data["vocab"] }
        : null;
    case "inspect-result":
      if (
        !isId(id) ||
        typeof data["qname"] !== "string" ||
        typeof data["ok"] !== "boolean" ||
        typeof data["meta"] !== "string" ||
        typeof data["source"] !== "string" ||
        typeof data["help"] !== "string" ||
        (data["error"] !== undefined && typeof data["error"] !== "string")
      ) {
        return null;
      }
      return {
        type: "inspect-result",
        id,
        qname: data["qname"],
        ok: data["ok"],
        meta: data["meta"],
        source: data["source"],
        help: data["help"],
        ...(data["error"] !== undefined ? { error: data["error"] } : {}),
      };
    case "fatal":
      return typeof data["message"] === "string"
        ? { type: "fatal", message: data["message"] }
        : null;
    default:
      return null;
  }
}
