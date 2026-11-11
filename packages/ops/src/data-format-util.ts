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
 * Helpers shared by the binary data-format primitives of WP 5.55 (cbor, msgpack, amf, avro, tlv, rison, plist).
 * They are not in `prims/` because every file there is loaded as a vocabulary's primitive module.
 * util-candidate: Meter, bufferValue, asBuffer, isoFromMs, strictUtf8 (the close-out may promote them).
 *
 * The JSON side of the formats is the shared `json` value model: FL values with the json:null sentinel
 * (src/prims/json.ts). Bytes have no JSON form, so a decoder shows them the way Node's Buffer is shown by
 * JSON.stringify, as CyberChef does: {"type":"Buffer","data":[1,2,3]} (`bufferValue`); an encoder can read that
 * shape back (`asBuffer`) when its `typed-objects` switch is on.
 */
import { ForgeError, valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { limitFailure } from "./prim-util.js";
import { NULL_KEY } from "./prims/json.js";

const { int, str, bool, list, record } = valueHelpers;

/** The host's TextDecoder (Node 20 and every browser have it; the package is typed against ES2022 only). */
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

/** An int value, normalised against the run's `maxIntBits` (E_LIMIT_VALUE beyond it). */
export function intValue(n: number | bigint, maxIntBits: number): Value {
  if (typeof n === "bigint") {
    const bits = n.toString(16).length * 4;
    if (bits > maxIntBits + 4) throw limitFailure("maxIntBits", maxIntBits, bits, "integer bits");
  }
  return int(n);
}

/** Text from bytes in a WHATWG encoding label, strict (`E_COERCE` through `onError`). */
export function decodeStrict(b: Uint8Array, label: string, onError: () => never): string {
  try {
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(b);
  } catch {
    return onError();
  }
}

/** Containers nested deeper than this are `E_COERCE` in the binary decoders and the encoders of WP 5.55. */
export const MAX_DEPTH = 64;

/** The json:null sentinel as a value. */
export const nullValue = (): Value => record([[NULL_KEY, bool(true)]]);

/** True for the json:null sentinel. */
export function isNullValue(v: Value): boolean {
  if (v.tag !== "record") return false;
  const m = v.v as ReadonlyMap<string, Value>;
  return m.size === 1 && m.has(NULL_KEY);
}

/** The bytes of the value budget a decoder may build (`limits.maxValueBytes`), counted while it builds. */
export class Meter {
  size = 0;
  constructor(
    private readonly max: number,
    private readonly what: string,
  ) {}
  add(n: number): void {
    this.size += n;
    if (this.size > this.max) throw limitFailure("maxValueBytes", this.max, this.size, this.what);
  }
}

/** E_COERCE for malformed data of a format, naming the offset. */
export function formatFailure(format: string, reason: string, offset: number): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot read ${format} data: ${reason} at offset ${offset}`,
    detail: { from: "bytes", to: format, reason, offset },
  });
}

/** E_COERCE for a value that cannot be written in a format. */
export function writeFailure(format: string, reason: string): ForgeError {
  return new ForgeError({
    code: "E_COERCE",
    message: `cannot write ${format}: ${reason}`,
    detail: { from: "json", to: format, reason },
  });
}

/** A byte string as CyberChef shows it: {"type":"Buffer","data":[...]}. */
export function bufferValue(b: Uint8Array, meter: Meter): Value {
  meter.add(64 + 16 * b.length);
  const items: Value[] = new Array<Value>(b.length);
  for (let i = 0; i < b.length; i++) items[i] = int(b[i] as number);
  return record([
    ["type", str("Buffer")],
    ["data", list(items)],
  ]);
}

/** The bytes of a {"type":"Buffer","data":[...]} value, or undefined when the value has another shape. */
export function asBuffer(v: Value): Uint8Array | undefined {
  if (v.tag !== "record") return undefined;
  const m = v.v as ReadonlyMap<string, Value>;
  if (m.size !== 2) return undefined;
  const t = m.get("type");
  const d = m.get("data");
  if (t === undefined || d === undefined || t.tag !== "str" || t.v !== "Buffer") return undefined;
  if (d.tag !== "list") return undefined;
  const items = d.v as readonly Value[];
  const out = new Uint8Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const x = items[i] as Value;
    if (x.tag !== "int" || typeof x.v !== "number" || x.v < 0 || x.v > 255) return undefined;
    out[i] = x.v;
  }
  return out;
}

/** Strict UTF-8 (no replacement characters, no lone surrogates); `E_COERCE` at `offset` otherwise. */
export function strictUtf8(b: Uint8Array, format: string, offset: number): string {
  return decodeStrict(b, "utf-8", () => {
    throw formatFailure(format, "a text string is not valid UTF-8", offset);
  });
}

/**
 * ISO 8601 text of an instant given as whole seconds since the epoch and nanoseconds, in the layout of
 * JavaScript's Date.toJSON (`2020-01-02T03:04:05.678Z`, three fractional digits), with the fraction extended
 * to 6 or 9 digits only when the instant needs it. `undefined` when the date is outside the range of Date.
 */
export function isoFromMs(seconds: number, nanos: number): string | undefined {
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return undefined;
  const s = d.toISOString(); // ...T..:..:..000Z
  const head = s.slice(0, s.length - 5);
  let frac = String(nanos).padStart(9, "0");
  if (frac.endsWith("000000")) frac = frac.slice(0, 3);
  else if (frac.endsWith("000")) frac = frac.slice(0, 6);
  return `${head}.${frac}Z`;
}

/** Text of a JSON number the way JavaScript prints it (`String(x)`), for object keys built from numbers. */
export const numberKey = (x: number): string => String(x);

/** A growing byte buffer for the encoders, capped at `max` bytes (`E_LIMIT_VALUE`). */
export class ByteSink {
  private buf = new Uint8Array(256);
  length = 0;
  constructor(private readonly max: number) {}
  private room(n: number): void {
    const need = this.length + n;
    if (need > this.max) throw limitFailure("maxValueBytes", this.max, need, "encoded data");
    if (need > this.buf.length) {
      const next = new Uint8Array(Math.max(need, this.buf.length * 2));
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
    }
  }
  byte(b: number): void {
    this.room(1);
    this.buf[this.length++] = b;
  }
  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  /** `n` bytes of the unsigned `v`, big-endian (`v` below 2^n bytes). */
  be(v: number | bigint, n: number): void {
    let x = BigInt(v);
    const tmp = new Uint8Array(n);
    for (let i = n - 1; i >= 0; i--) {
      tmp[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    this.bytes(tmp);
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}
