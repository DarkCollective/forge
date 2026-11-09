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
/**
 * Limits and the iterative pre-walk (RECIPES.md sections 3.7 and 3.8).
 *
 * `prewalk` looks at an untrusted value with an explicit stack and a byte budget, before any recursive
 * check runs, so a hostile document costs a bounded amount of work and can never overflow the stack.
 */
import { RECIPE_LIMITS } from "./types.js";

/** At most this many issues are reported; the next one is replaced by a `limit` issue. */
export const MAX_ISSUES = 100;

/** Longest piece of user-supplied text that an issue message or detail may carry. */
export const MAX_ECHO_CHARS = 80;

/** True when `s` contains a UTF-16 surrogate that is not part of a pair. */
export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else return true;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Number of code points (a lone surrogate counts as one). */
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** At most `max` code points of `s`, never splitting a surrogate pair. */
export function clip(s: string, max: number = MAX_ECHO_CHARS): string {
  if (s.length <= max) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (n++ >= max) break;
    out += ch;
  }
  return out;
}

/** A JSON-safe echo of an arbitrary user value for `detail` (never more than `MAX_ECHO_CHARS` of text). */
export function echo(value: unknown): unknown {
  if (typeof value === "string") return clip(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Bytes that `JSON.stringify` spends on the string `s`, quotes included. */
function jsonStringBytes(s: string): number {
  if (s.length > RECIPE_LIMITS.maxJsonBytes) return RECIPE_LIMITS.maxJsonBytes + 1;
  let n = 2;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      c === 0x22 ||
      c === 0x5c ||
      c === 0x08 ||
      c === 0x09 ||
      c === 0x0a ||
      c === 0x0c ||
      c === 0x0d
    ) {
      n += 2;
    } else if (c < 0x20) {
      n += 6;
    } else if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 6; // JSON.stringify writes a lone surrogate as \udXXX
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      n += 6;
    } else {
      n += 3;
    }
  }
  return n;
}

/** Why the pre-walk stopped. */
export interface PrewalkFailure {
  readonly limit: "maxJsonBytes" | "maxJsonDepth" | "cycle";
  readonly max?: number;
}

/** The own data property `key` of `obj`; accessors and missing properties read as `undefined`. Never runs user code. */
export function dataProp(obj: object, key: string | number): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d !== undefined && "value" in d ? d.value : undefined;
}

interface Frame {
  readonly value: object;
  readonly keys: readonly string[] | null;
  readonly count: number;
  next: number;
}

function scalarBytes(v: unknown): number {
  switch (typeof v) {
    case "string":
      return jsonStringBytes(v);
    case "number":
      return Number.isFinite(v) ? String(v).length : 4;
    case "boolean":
      return v ? 4 : 5;
    default:
      return 4; // null, and what JSON.stringify turns into null or drops
  }
}

/**
 * Walks `root` with an explicit stack. Returns the first limit that is exceeded, or null.
 * The byte count is what `JSON.stringify` would produce for a JSON value. Accessor properties are not invoked.
 */
export function prewalk(root: unknown): PrewalkFailure | null {
  const maxBytes = RECIPE_LIMITS.maxJsonBytes;
  const maxDepth = RECIPE_LIMITS.maxJsonDepth;
  let bytes = 0;
  const onPath = new Set<object>();
  const stack: Frame[] = [];

  /** Enter `v` if it is a container. Returns a failure, "scalar" or null (entered). */
  const enter = (v: unknown): PrewalkFailure | "scalar" | null => {
    if (typeof v !== "object" || v === null) {
      bytes += scalarBytes(v);
      return bytes > maxBytes ? { limit: "maxJsonBytes", max: maxBytes } : "scalar";
    }
    if (onPath.has(v)) return { limit: "cycle" };
    if (stack.length >= maxDepth) return { limit: "maxJsonDepth", max: maxDepth };
    onPath.add(v);
    bytes += 2;
    const isArray = Array.isArray(v);
    const keys = isArray ? null : Object.keys(v);
    stack.push({ value: v, keys, count: isArray ? v.length : (keys as string[]).length, next: 0 });
    return bytes > maxBytes ? { limit: "maxJsonBytes", max: maxBytes } : null;
  };

  const first = enter(root);
  if (first !== null && first !== "scalar") return first;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    if (frame.next >= frame.count) {
      onPath.delete(frame.value);
      stack.pop();
      continue;
    }
    const index = frame.next++;
    let child: unknown;
    if (frame.keys === null) {
      bytes += index > 0 ? 1 : 0; // the comma between elements
      child = dataProp(frame.value, index);
    } else {
      const key = frame.keys[index] as string;
      bytes += jsonStringBytes(key) + (index > 0 ? 2 : 1); // the key, the colon and the comma between members
      child = dataProp(frame.value, key);
    }
    if (bytes > maxBytes) return { limit: "maxJsonBytes", max: maxBytes };
    const result = enter(child);
    if (result !== null && result !== "scalar") return result;
  }
  return null;
}
