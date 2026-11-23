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
 * X0 SPIKE (throwaway): the extension value registry. A kind registers once, per process, before any
 * value of that kind exists. The helpers in values.ts (equals, sizeOf, repr) are plain module
 * functions with no runtime handle, so the registry is a module-level singleton here; see the X0 result
 * document for the per-runtime alternative.
 */
import type { Value } from "./types.js";

/** What a kind provides (TOOLKIT.md section 6.1). `P` is the payload type. */
export interface ExtKind<P = unknown> {
  /** Lower-case name, `[a-z][a-z0-9-]*`, as written in `ext{kind}`. */
  readonly kind: string;
  equals(a: P, b: P): boolean;
  /** Bytes charged to the size meter (limits.maxValueBytes and total), counted like `sizeOf` in values.ts. */
  sizeOf(p: P): number;
  /** The text form, cut near `max` UTF-16 units; round-trips through `fromText` when not cut. */
  toText(p: P, max: number): string;
  /** Parse the text form; throws a ForgeError (E_COERCE) on bad text. Absent: the kind cannot be a parameter. */
  fromText?(text: string): P;
  /** A structured-clone-safe summary for a viewer (worker side, see render.ts). Absent: text only. */
  view?(p: P, opts: { readonly maxRows: number }): unknown;
}

const kinds = new Map<string, ExtKind>();
const KIND_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Register a kind; a later registration of the same name replaces the earlier one (last wins). The first
 * version of this spike threw E_REDEFINED, and `sources.test.ts` showed why that is wrong: the same pack
 * module is evaluated twice when two entries (`@forge/ops` from dist, `@forge/ops/node` from src) load
 * it, so the second, identical registration must be accepted.
 */
export function registerExtKind<P>(def: ExtKind<P>): void {
  if (!KIND_RE.test(def.kind)) throw new TypeError(`invalid ext kind '${def.kind}'`);
  kinds.set(def.kind, def as ExtKind);
}

export function getExtKind(kind: string): ExtKind | undefined {
  return kinds.get(kind);
}

export function listExtKinds(): readonly string[] {
  return [...kinds.keys()];
}

/** Build an ext value. */
export function ext(kind: string, payload: unknown): Value {
  return { tag: "ext", kind, v: payload };
}

/** Text form of an ext value; a generic placeholder for a kind that is not registered. */
export function extText(kind: string, payload: unknown, max = Infinity): string {
  const k = kinds.get(kind);
  return k === undefined ? `<ext ${kind}>` : k.toText(payload, max);
}
