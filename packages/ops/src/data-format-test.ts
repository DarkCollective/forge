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
 * Test helpers of the WP 5.55 data-format vocabularies (cbor, msgpack, amf, avro, tlv, rison, plist,
 * base64-offsets, qr): a runtime loader, result readers, hex helpers, the "every cut point" and "every mutated
 * byte" checks of the wave 7 conventions, and a small seeded random source. Used by the `*.test.ts` files only.
 */
import { valueHelpers } from "@forge/lang";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}

/** UTF-8 text of bytes. */
export const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

export type Runtime = ReturnType<typeof assembleRuntime>;
export type Result = Awaited<ReturnType<Runtime["call"]>>;
export type Limits = { maxValueBytes?: number; maxIntBits?: number };

export async function loadRuntime(vocabs: string[]): Promise<Runtime> {
  return assembleRuntime(await loadBundleNode(vocabs));
}

/** `ok`, or the error code. */
export const code = (r: Result): string => (r.ok ? "ok" : r.error.code);

/** The top of the stack as a string (a `str` result). */
export function text(r: Result): string {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
}

/** The top of the stack as bytes. */
export function raw(r: Result): Uint8Array {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: Uint8Array }).v;
}

export const message = (r: Result): string => (r.ok ? "" : r.error.message);
export const steps = (r: Result): number => (r.ok ? r.steps : -1);

export function fromHex(h: string): Uint8Array {
  const t = h.replace(/\s+/g, "");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(t.slice(2 * i, 2 * i + 2), 16);
  return out;
}
export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const asBytes = (b: Uint8Array) => bytes(b);

/**
 * Runs `run` on every proper prefix of `data` (every cut point) and requires E_COERCE for each, and a result for
 * the whole of it. Returns the cut points that were not E_COERCE (an empty array when the parser is strict).
 */
export async function cutPoints(
  data: Uint8Array,
  run: (d: Uint8Array) => Promise<Result>,
): Promise<{ cut: number; code: string }[]> {
  const bad: { cut: number; code: string }[] = [];
  for (let cut = 0; cut < data.length; cut++) {
    const c = code(await run(data.subarray(0, cut)));
    if (c !== "E_COERCE") bad.push({ cut, code: c });
  }
  return bad;
}

/**
 * Replaces each byte of `data` (at most `limit` positions, spread over the input) by several other values and
 * requires a result or E_COERCE/E_LIMIT_VALUE every time. Returns the codes that were something else.
 */
export async function mutations(
  data: Uint8Array,
  run: (d: Uint8Array) => Promise<Result>,
  values: number[] = [0x00, 0x01, 0x7f, 0x80, 0xff],
  limit = 400,
): Promise<string[]> {
  const bad: string[] = [];
  const stride = Math.max(1, Math.floor(data.length / limit));
  for (let i = 0; i < data.length; i += stride)
    for (const v of values) {
      const copy = data.slice();
      copy[i] = v;
      const c = code(await run(copy));
      if (c !== "ok" && c !== "E_COERCE" && c !== "E_LIMIT_VALUE") bad.push(`${c} at ${i}=${v}`);
    }
  return bad;
}

/** A small deterministic random source (mulberry32), so a failing case can be replayed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random JSON value built from `rand` (no NaN, no -0), at most `depth` levels deep. */
export function randomJson(rand: () => number, depth: number): unknown {
  const pick = Math.floor(rand() * (depth > 0 ? 9 : 6));
  switch (pick) {
    case 0:
      return null;
    case 1:
      return rand() < 0.5;
    case 2:
      return Math.floor((rand() - 0.5) * 2 ** (1 + Math.floor(rand() * 40)));
    case 3:
      return (rand() - 0.5) * 10 ** Math.floor(rand() * 20 - 8) + 0.5;
    case 4:
      return Array.from({ length: Math.floor(rand() * 12) }, () =>
        String.fromCharCode(32 + Math.floor(rand() * 90)),
      ).join("");
    case 5:
      return Math.floor(rand() * 300);
    case 6:
    case 7:
      return Array.from({ length: Math.floor(rand() * 5) }, () => randomJson(rand, depth - 1));
    default: {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < Math.floor(rand() * 5); i++)
        o[`k${Math.floor(rand() * 40)}`] = randomJson(rand, depth - 1);
      return o;
    }
  }
}
