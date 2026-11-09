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
 * Shape validation of every message that crosses the worker boundary (RECIPES.md section 8.4). The
 * guards check the envelope and the option objects strictly. The recipe is untrusted JSON that the
 * validator checks later, and the bake results are checked one level deep (their contents come from
 * our own code).
 */
import { DEFAULT_LIMITS } from "@forge/lang";
import type { ClientMessage, WorkerMessage } from "./types.js";

/** Largest source text of one user unit, and the most units and vocabulary names in an `init`. */
const MAX_UNIT_CHARS = 1_048_576;
const MAX_UNITS = 64;
const MAX_VOCABS = 256;
const MAX_NAME_CHARS = 256;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the object has no own key outside `allowed` (accessors count as keys, they are not read). */
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((k) => typeof k === "string" && allowed.includes(k));
}

function ownData(value: Record<string, unknown>, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d !== undefined && "value" in d ? d.value : undefined;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value);
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return tagOf(value) === "[object ArrayBuffer]";
}

function isSharedArrayBuffer(value: unknown): boolean {
  return (
    tagOf(value) === "[object SharedArrayBuffer]" &&
    (value as { byteLength: number }).byteLength >= 4
  );
}

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isInit(value: unknown): boolean {
  if (!isObject(value) || !onlyKeys(value, ["vocabs", "units"])) return false;
  const vocabs = ownData(value, "vocabs");
  if (vocabs !== undefined && vocabs !== "all") {
    if (!Array.isArray(vocabs) || vocabs.length > MAX_VOCABS) return false;
    if (!vocabs.every((v) => isString(v, MAX_NAME_CHARS))) return false;
  }
  const units = ownData(value, "units");
  if (units === undefined) return true;
  if (!Array.isArray(units) || units.length > MAX_UNITS) return false;
  return units.every(
    (u) =>
      isObject(u) &&
      onlyKeys(u, ["name", "source"]) &&
      isString(ownData(u, "name"), MAX_NAME_CHARS) &&
      isString(ownData(u, "source"), MAX_UNIT_CHARS),
  );
}

function isLimits(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Reflect.ownKeys(value).every((k) => {
    const v = typeof k === "string" ? ownData(value, k) : undefined;
    return (
      typeof k === "string" &&
      Object.hasOwn(DEFAULT_LIMITS, k) &&
      typeof v === "number" &&
      !Number.isNaN(v) &&
      v >= 0
    );
  });
}

function isOptions(value: unknown): boolean {
  if (!isObject(value) || !onlyKeys(value, ["trust", "limits", "pins", "debug"])) return false;
  const trust = ownData(value, "trust");
  if (trust !== undefined && trust !== "trusted" && trust !== "untrusted") return false;
  const pins = ownData(value, "pins");
  if (pins !== undefined && pins !== "ignore" && pins !== "warn" && pins !== "strict") return false;
  const limits = ownData(value, "limits");
  if (limits !== undefined && !isLimits(limits)) return false;
  const debug = ownData(value, "debug");
  if (debug === undefined) return true;
  if (!isObject(debug) || !onlyKeys(debug, ["startPaused"])) return false;
  const sp = ownData(debug, "startPaused");
  return sp === undefined || typeof sp === "boolean";
}

/**
 * Accepts any integer `protocol`: a mismatch is answered with `init-error` (`E_PROTOCOL`) by the
 * worker side, not with `fatal`.
 */
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObject(value)) return false;
  switch (ownData(value, "type")) {
    case "init":
      return (
        onlyKeys(value, ["type", "reqId", "protocol", "init"]) &&
        isId(ownData(value, "reqId")) &&
        Number.isSafeInteger(ownData(value, "protocol")) &&
        isInit(ownData(value, "init"))
      );
    case "bake": {
      if (!onlyKeys(value, ["type", "id", "recipe", "input", "options", "abort"])) return false;
      const abort = ownData(value, "abort");
      return (
        isId(ownData(value, "id")) &&
        isArrayBuffer(ownData(value, "input")) &&
        isOptions(ownData(value, "options")) &&
        (abort === undefined || isSharedArrayBuffer(abort))
      );
    }
    case "step":
    case "continue":
    case "cancel":
      return onlyKeys(value, ["type", "id"]) && isId(ownData(value, "id"));
    case "dispose":
      return onlyKeys(value, ["type"]);
    default:
      return false;
  }
}

function isBakeError(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof ownData(value, "code") === "string" &&
    typeof ownData(value, "message") === "string" &&
    isObject(ownData(value, "detail"))
  );
}

function isEvent(value: unknown): boolean {
  if (!isObject(value) || !isId(ownData(value, "id"))) return false;
  switch (ownData(value, "type")) {
    case "progress":
      return ["done", "total", "vmSteps", "elapsedMs"].every(
        (k) => typeof ownData(value, k) === "number",
      );
    case "paused":
      return typeof ownData(value, "path") === "string" && isObject(ownData(value, "data"));
    case "resumed":
      return true;
    default:
      return false;
  }
}

function isResult(value: unknown): boolean {
  if (!isObject(value) || !isId(ownData(value, "id"))) return false;
  if (!Array.isArray(ownData(value, "steps")) || !Array.isArray(ownData(value, "coercions"))) {
    return false;
  }
  if (!Array.isArray(ownData(value, "warnings")) || !isObject(ownData(value, "stats"))) {
    return false;
  }
  return ownData(value, "ok") === true
    ? isObject(ownData(value, "output"))
    : ownData(value, "ok") === false && isBakeError(ownData(value, "error"));
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!isObject(value)) return false;
  switch (ownData(value, "type")) {
    case "ready": {
      const info = ownData(value, "info");
      return (
        isId(ownData(value, "reqId")) &&
        isObject(info) &&
        typeof ownData(info, "catalogueVersion") === "string" &&
        Array.isArray(ownData(info, "vocabs"))
      );
    }
    case "init-error":
      return isId(ownData(value, "reqId")) && isBakeError(ownData(value, "error"));
    case "event":
      return isId(ownData(value, "id")) && isEvent(ownData(value, "event"));
    case "result":
      return isId(ownData(value, "id")) && isResult(ownData(value, "result"));
    case "fatal":
      return typeof ownData(value, "message") === "string";
    default:
      return false;
  }
}
