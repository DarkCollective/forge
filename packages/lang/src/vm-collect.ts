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
 * The collectors of LANGUAGE-0.2.md section 10: the accumulator behind `collect`, `collect-bytes`
 * and `collect-str`. It lives in a VM frame (a `LoopFrame` of the VM), grows by `emit` and
 * `emit-all`, checks `maxValueBytes` at each addition with incremental accounting, and builds the
 * result value once.
 */
import { ForgeError } from "./errors.js";
import type { Value } from "./types.js";
import { sizeOf } from "./values.js";

/** The three kinds of collector, named after the combinator that starts them. */
export type CollectKind = "collect" | "collect-bytes" | "collect-str";

function typeError(expected: string, actual: string): ForgeError {
  return new ForgeError({
    code: "E_TYPE",
    message: `expected ${expected}, got ${actual}`,
    detail: { expected, actual },
  });
}

function elemSize(v: Value): number {
  switch (v.tag) {
    case "int":
      return typeof v.v === "number" ? 8 : sizeOf(v);
    case "num":
      return 8;
    case "bool":
      return 1;
    case "str":
      return 2 * v.v.length;
    case "bytes":
      return v.v.byteLength;
    default:
      return sizeOf(v);
  }
}

/** The error of `emit` or `emit-all` with no `collect` frame on the return stack. */
export function emitOutsideCollect(): ForgeError {
  return new ForgeError({
    code: "E_EFFECT",
    message: "emit outside collect",
    detail: { reason: "emit outside collect" },
  });
}

export class Collector {
  private size = 0;
  private items: Value[] = [];
  private buf: Uint8Array = new Uint8Array(0);
  private len = 0;
  private text = "";

  constructor(
    readonly kind: CollectKind,
    private readonly maxValue: number,
  ) {
    if (kind === "collect-bytes") this.buf = new Uint8Array(64);
  }

  /** Accounts `n` more bytes and checks the value limit before anything is copied. */
  private grow(n: number): void {
    const total = this.size + n;
    if (total > this.maxValue) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `value size limit of ${this.maxValue} exceeded (${total})`,
        detail: { limit: this.maxValue, value: total },
      });
    }
    this.size = total;
  }

  private reserve(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** `emit`: one element. */
  add(v: Value): void {
    switch (this.kind) {
      case "collect":
        this.grow(8 + elemSize(v));
        this.items.push(v);
        return;
      case "collect-bytes": {
        if (v.tag !== "int") throw typeError("int", v.tag);
        const n = v.v;
        if (typeof n === "bigint" || n < 0 || n > 255) {
          throw new ForgeError({
            code: "E_RANGE",
            message: `${String(n)} is not a byte`,
            detail: { value: String(n) },
          });
        }
        this.grow(1);
        this.reserve(1);
        this.buf[this.len++] = n;
        return;
      }
      case "collect-str": {
        if (v.tag !== "int") throw typeError("int", v.tag);
        const n = v.v;
        if (typeof n === "bigint" || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) {
          throw new ForgeError({
            code: "E_RANGE",
            message: `${String(n)} is not a Unicode scalar value`,
            detail: { value: String(n) },
          });
        }
        const ch = String.fromCodePoint(n);
        this.grow(2 * ch.length);
        this.text += ch;
        return;
      }
    }
  }

  /** `emit-all`: every element of a list (`collect`), bytes (`collect-bytes`) or str (`collect-str`). */
  addAll(v: Value): void {
    switch (this.kind) {
      case "collect": {
        if (v.tag !== "list") throw typeError("list", v.tag);
        let n = 0;
        for (const e of v.v) n += 8 + elemSize(e);
        this.grow(n);
        for (const e of v.v) this.items.push(e);
        return;
      }
      case "collect-bytes":
        if (v.tag !== "bytes") throw typeError("bytes", v.tag);
        this.grow(v.v.byteLength);
        this.reserve(v.v.byteLength);
        this.buf.set(v.v, this.len);
        this.len += v.v.byteLength;
        return;
      case "collect-str":
        if (v.tag !== "str") throw typeError("str", v.tag);
        this.grow(2 * v.v.length);
        this.text += v.v;
        return;
    }
  }

  /** The result value (not yet metered). */
  finish(): Value {
    switch (this.kind) {
      case "collect":
        return { tag: "list", v: this.items };
      case "collect-bytes":
        return { tag: "bytes", v: this.buf.slice(0, this.len) };
      case "collect-str":
        return { tag: "str", v: this.text };
    }
  }
}
