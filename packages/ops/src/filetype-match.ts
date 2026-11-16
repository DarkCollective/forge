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
 * The pure matching of the file signature table (src/filetype-sigs.ts): does a row's magic, and its
 * `verify` refinement, match at an offset of some bytes, and where do the rows match. Pure functions on
 * Uint8Array, with no import of @forge/lang and no primitive, so that a consumer that only matches
 * signatures (the `@forge/ops/checks` evaluator of WP 6.23, for `magic-bytes format "<id>"`) loads
 * neither the vocabulary nor the primitive module. prims/filetype.ts adds the Value marshalling, the
 * limits, the end finders and the carving on top of these.
 */

import { FILE_SIGNATURES } from "./filetype-sigs.js";
import type { Category, FileSig } from "./filetype-sigs.js";

/** An unsigned 16-bit field at `p`, or -1 when it lies outside the data. */
export function u16(d: Uint8Array, p: number, le: boolean): number {
  if (p < 0 || p + 2 > d.length) return -1;
  return le
    ? (d[p] as number) | ((d[p + 1] as number) << 8)
    : ((d[p] as number) << 8) | (d[p + 1] as number);
}

/** An unsigned 32-bit field at `p`, or -1 when it lies outside the data. */
export function u32(d: Uint8Array, p: number, le: boolean): number {
  if (p < 0 || p + 4 > d.length) return -1;
  const a = d[p] as number;
  const b = d[p + 1] as number;
  const c = d[p + 2] as number;
  const e = d[p + 3] as number;
  return le
    ? (a | (b << 8) | (c << 16) | (e << 24)) >>> 0
    : ((a << 24) | (b << 16) | (c << 8) | e) >>> 0;
}

const CHUNK = 8192;

/** The Latin-1 text of the bytes (one character per byte), for `indexOf`. */
export function latin1Of(d: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < d.length; i += CHUNK)
    parts.push(String.fromCharCode.apply(null, d.subarray(i, i + CHUNK) as unknown as number[]));
  return parts.join("");
}

/** Does the magic of `sig` match with the file starting at `i`? The `verify` check is not run. */
export function magicAt(d: Uint8Array, i: number, sig: FileSig): boolean {
  for (const part of sig.parts) {
    const at = i + part.offset;
    if (at + part.value.length > d.length) return false;
    for (let k = 0; k < part.value.length; k++) {
      const m = part.mask[k] as number;
      if (((d[at + k] as number) & m) !== (part.value[k] as number)) return false;
    }
  }
  return true;
}

/** The offset of the PE header ("PE\0\0") of an MZ file, or null. */
export function peHeader(d: Uint8Array, i: number): number | null {
  const lfanew = u32(d, i + 0x3c, true);
  if (lfanew < 0x40 || i + lfanew + 24 > d.length) return null;
  return d[i + lfanew] === 0x50 &&
    d[i + lfanew + 1] === 0x45 &&
    d[i + lfanew + 2] === 0 &&
    d[i + lfanew + 3] === 0
    ? lfanew
    : null;
}

/** The checks the magic alone cannot do, by the name in the table's `verify` field. */
export function verifyAt(d: Uint8Array, i: number, name: string | undefined): boolean {
  if (name === undefined) return true;
  switch (name) {
    case "pe":
      return peHeader(d, i) !== null;
    case "dos":
      return d.length - i >= 28 && peHeader(d, i) === null;
    case "class": {
      const major = u16(d, i + 6, false);
      return major >= 45 && major <= 130;
    }
    case "fat": {
      const n = u32(d, i + 4, false);
      return n >= 1 && n <= 44;
    }
    default:
      throw new Error(`unknown verifier ${name}`);
  }
}

/** Does the whole row match with the file starting at `offset`: its magic, then its `verify`? */
export function matchesAt(d: Uint8Array, offset: number, sig: FileSig): boolean {
  return magicAt(d, offset, sig) && verifyAt(d, offset, sig.verify);
}

/** A row that matches at an offset. */
export interface Match {
  readonly offset: number;
  readonly sig: FileSig;
}

/** The rows of the given categories that match with the file starting at offset 0, in table order. */
export function detectAll(d: Uint8Array, cats: ReadonlySet<Category>): Match[] {
  const out: Match[] = [];
  for (const sig of FILE_SIGNATURES) {
    if (cats.has(sig.category) && matchesAt(d, 0, sig)) out.push({ offset: 0, sig });
  }
  return out;
}

/** Thrown by `scanAll` when more matches than `maxMatches` are found; the caller reports the limit. */
export class TooManyMatches extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`more than ${limit} signature matches`);
    this.name = "TooManyMatches";
    this.limit = limit;
  }
}

/**
 * Every offset where a row of the given categories matches, ordered by offset and then by table order.
 * With `ignoreWeak` the weak rows are left out. Throws `TooManyMatches` once more than `maxMatches`
 * matches are found.
 */
export function scanAll(
  d: Uint8Array,
  cats: ReadonlySet<Category>,
  ignoreWeak: boolean,
  maxMatches: number,
): Match[] {
  const text = latin1Of(d);
  const found: { offset: number; order: number; sig: FileSig }[] = [];
  FILE_SIGNATURES.forEach((sig, order) => {
    if (!cats.has(sig.category) || (ignoreWeak && sig.weak)) return;
    const needle = latin1Of(sig.anchor.bytes);
    let from = 0;
    for (;;) {
      const j = text.indexOf(needle, from);
      if (j < 0) break;
      from = j + 1;
      const i = j - sig.anchor.offset;
      if (i < 0) continue;
      if (matchesAt(d, i, sig)) {
        if (found.length >= maxMatches) throw new TooManyMatches(maxMatches);
        found.push({ offset: i, order, sig });
      }
    }
  });
  found.sort((a, b) => a.offset - b.offset || a.order - b.order);
  return found.map((m) => ({ offset: m.offset, sig: m.sig }));
}
