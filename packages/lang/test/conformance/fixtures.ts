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
 * The fixture primitives of docs/LANGUAGE.md section 16.1. `fx:*` are passed to the runtime through
 * `RuntimeOptions.primitives` (registered and bound); `fz:twice` is registered afterwards through
 * `runtime.registry.define` and stays unbound until a trusted unit says `PRIMITIVE twice`.
 *
 * Every argument a fixture receives is a frozen copy, and a result that is the very same object as
 * an argument is recorded in `violations` (the conformance test then fails).
 */
import { definePrimitive } from "../../src/primitives.js";
import type { PrimitiveDef } from "../../src/types.js";

export interface FixtureSet {
  /** The `fx:*` primitives, for `RuntimeOptions.primitives`. */
  readonly bound: readonly PrimitiveDef[];
  /** `fz:twice`: to be registered with `runtime.registry.define`, not bound. */
  readonly unbound: readonly PrimitiveDef[];
  /** Descriptions of aliasing violations seen so far (should stay empty). */
  readonly violations: string[];
}

function deepFreezeCopy<T>(x: T): T {
  if (typeof x !== "object" || x === null) return x;
  if (x instanceof Uint8Array) return x.slice() as T;
  if (x instanceof Map) {
    const m = new Map<unknown, unknown>();
    for (const [k, v] of x) m.set(k, deepFreezeCopy(v));
    return Object.freeze(m) as T;
  }
  if (Array.isArray(x)) return Object.freeze(x.map(deepFreezeCopy)) as T;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) o[k] = deepFreezeCopy(v);
  return Object.freeze(o) as T;
}

function isObject(x: unknown): boolean {
  return (typeof x === "object" && x !== null) || typeof x === "function";
}

export function createFixtures(): FixtureSet {
  const violations: string[] = [];

  /** Wraps `fn`: the arguments (all but the trailing PrimitiveContext) are frozen copies. */
  const guarded = (qname: string, fn: (...args: never[]) => unknown): PrimitiveDef["fn"] => {
    return (...all: unknown[]) => {
      const copies = all.slice(0, -1).map(deepFreezeCopy);
      const result = (fn as (...a: unknown[]) => unknown)(...copies);
      const check = (r: unknown): unknown => {
        const items = Array.isArray(r) ? r : [r];
        for (const item of items) {
          if (isObject(item) && copies.includes(item)) {
            violations.push(`${qname} returned one of its arguments`);
          }
        }
        return r;
      };
      return result instanceof Promise ? result.then(check) : check(result);
    };
  };

  const sum = (a: number | bigint, b: number | bigint): number | bigint =>
    typeof a === "bigint" || typeof b === "bigint" ? BigInt(a) + BigInt(b) : a + b;

  const bound: PrimitiveDef[] = [
    definePrimitive(
      "fx",
      "add-async",
      "( a:int b:int -- int )",
      guarded("fx:add-async", (a: number | bigint, b: number | bigint) => {
        // Resolves after a macrotask, so the VM really has to await it.
        return new Promise<number | bigint>((resolve) => setTimeout(() => resolve(sum(a, b)), 0));
      }),
      { effects: ["+async"], doc: "Adds two ints after a macrotask (conformance fixture)." },
    ),
    definePrimitive(
      "fx",
      "sleep",
      "( ms:int -- )",
      guarded("fx:sleep", (ms: number | bigint) => {
        return new Promise<void>((resolve) => setTimeout(resolve, Number(ms)));
      }),
      { effects: ["+async"], doc: "Resolves after ms milliseconds (conformance fixture)." },
    ),
    definePrimitive(
      "fx",
      "now",
      "( -- int )",
      guarded("fx:now", () => Date.now()),
      {
        effects: ["+time"],
        doc: "The current time in milliseconds (conformance fixture).",
      },
    ),
    definePrimitive(
      "fx",
      "throw",
      "( -- )",
      guarded("fx:throw", () => {
        throw new Error("kaput");
      }),
      { doc: "Throws a plain Error (conformance fixture)." },
    ),
    definePrimitive(
      "fx",
      "bad-result",
      "( -- int )",
      guarded("fx:bad-result", () => "x"),
      {
        doc: "Returns a string where an int is declared (conformance fixture).",
      },
    ),
    definePrimitive(
      "fx",
      "bad-int",
      "( -- int )",
      guarded("fx:bad-int", () => 1.5),
      {
        doc: "Returns a non-integer number where an int is declared (conformance fixture).",
      },
    ),
    definePrimitive(
      "fx",
      "small-big",
      "( -- int )",
      guarded("fx:small-big", () => 5n),
      {
        doc: "Returns the bigint 5n, which must normalise to 5 (conformance fixture).",
      },
    ),
    definePrimitive(
      "fx",
      "reject",
      "( -- )",
      guarded("fx:reject", () => Promise.reject(new Error("nope"))),
      { effects: ["+async"], doc: "Returns a rejected promise (conformance fixture)." },
    ),
  ];

  const unbound: PrimitiveDef[] = [
    definePrimitive(
      "fz",
      "twice",
      "( n:int -- int )",
      guarded("fz:twice", (n: number | bigint) => (typeof n === "bigint" ? n * 2n : n * 2)),
      { doc: "Doubles an int; registered but unbound (conformance fixture)." },
    ),
  ];

  return { bound, unbound, violations };
}
