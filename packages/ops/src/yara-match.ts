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
 * String matching for the YARA ops (WP 5.58): the text strings with their modifiers (ascii, wide, nocase,
 * fullword, xor with a range, base64 and base64wide with an alphabet), the hex strings (wildcards, nibble
 * wildcards, `~` bytes, jumps, alternatives) and the regular expressions (through the regex seam only).
 *
 * Text and hex matching are plain byte loops over the data, bounded by a shared work counter and by a cap
 * on the matches of one string. Hex strings run on a Pike-style set simulation (no backtracking, so no
 * blow-up): jumps are lazy and the first choice of an alternative that lets the rest of the string match
 * wins, which is what libyara reports in nearly all cases (see the README for the one that differs). A regular expression is run as `(?=(PATTERN))` through `execAll`, so that it reports a match at
 * every start offset, as YARA does, not only the non-overlapping ones.
 */
import { limitFailure } from "./prim-util.js";
import { execAll } from "./regex-engine.js";
import type { HexItem, StringDef, TextModifiers } from "./yara-rules.js";

/** The most matches one string may have (YARA's own cap is 1,000,000). Over it the scan is E_LIMIT_VALUE. */
export const MAX_MATCHES_PER_STRING = 100_000;
/** The most byte steps (positions tried, NFA states advanced) one scan may spend before E_LIMIT_VALUE. */
export const MAX_WORK = 200_000_000;
/** The largest data that is scanned (the regex seam's own input limit). */
export const MAX_DATA = 4_194_304;

export class Budget {
  used = 0;
  add(n: number): void {
    this.used += n;
    if (this.used > MAX_WORK) {
      throw limitFailure("yaraWork", MAX_WORK, this.used, "YARA scan work (byte steps)");
    }
  }
}

/** The matches of one string: start offsets ascending, and the length of each. */
export interface Found {
  off: number[];
  len: number[];
}

const LOWER = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = i >= 65 && i <= 90 ? i + 32 : i;
  return t;
})();

const isAlnum = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

const fullAscii = (d: Uint8Array, p: number, len: number): boolean =>
  !(p > 0 && isAlnum(d[p - 1] as number)) && !(p + len < d.length && isAlnum(d[p + len] as number));

const fullWide = (d: Uint8Array, p: number, len: number): boolean =>
  !(p >= 2 && d[p - 1] === 0 && isAlnum(d[p - 2] as number)) &&
  !(p + len + 1 < d.length && isAlnum(d[p + len] as number) && d[p + len + 1] === 0);

/** One literal pattern to look for: bytes, whether ASCII case is ignored, and an xor key range. */
interface Variant {
  pat: Uint8Array;
  nocase: boolean;
  xor: [number, number] | null;
  wide: boolean;
}

const widen = (b: Uint8Array): Uint8Array => {
  const w = new Uint8Array(b.length * 2);
  for (let i = 0; i < b.length; i++) w[2 * i] = b[i] as number;
  return w;
};

/** The base64 variants of YARA: the characters that are fully determined by the text at each of 3 shifts. */
export function base64Variants(text: Uint8Array, alphabet: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const bits = text.length * 8;
  for (let shift = 0; shift < 3; shift++) {
    const s = shift * 8;
    const first = Math.ceil(s / 6);
    const last = Math.floor((s + bits) / 6) - 1;
    if (last < first) continue;
    const v = new Uint8Array(last - first + 1);
    for (let k = first; k <= last; k++) {
      let val = 0;
      for (let b = 0; b < 6; b++) {
        const pos = 6 * k + b - s; // bit index inside the text
        const bit = (((text[pos >> 3] as number) >> (7 - (pos & 7))) & 1) as number;
        val = (val << 1) | bit;
      }
      v[k - first] = alphabet.charCodeAt(val);
    }
    out.push(v);
  }
  return out;
}

function textVariants(bytes: Uint8Array, m: TextModifiers): Variant[] {
  if (m.base64 !== null || m.base64wide !== null) {
    const wide = m.base64wide !== null;
    return base64Variants(bytes, (m.base64 ?? m.base64wide) as string).map((v) => ({
      pat: wide ? widen(v) : v,
      nocase: false,
      xor: null,
      wide,
    }));
  }
  const out: Variant[] = [];
  const lower = (b: Uint8Array): Uint8Array => (m.nocase ? b.map((x) => LOWER[x] as number) : b);
  if (m.ascii) out.push({ pat: lower(bytes), nocase: m.nocase, xor: m.xor, wide: false });
  if (m.wide) out.push({ pat: lower(widen(bytes)), nocase: m.nocase, xor: m.xor, wide: true });
  return out;
}

function scanVariant(
  d: Uint8Array,
  v: Variant,
  fullword: boolean,
  budget: Budget,
  out: { off: number; len: number }[],
): void {
  const n = d.length;
  const pat = v.pat;
  const m = pat.length;
  if (m > n) return;
  budget.add(n - m + 1);
  const last = n - m;
  const f = pat[0] as number;
  const check = v.wide ? fullWide : fullAscii;
  const push = (p: number): void => {
    if (fullword && !check(d, p, m)) return;
    out.push({ off: p, len: m });
    if (out.length > MAX_MATCHES_PER_STRING) {
      throw limitFailure(
        "yaraMatches",
        MAX_MATCHES_PER_STRING,
        out.length,
        "matches of one YARA string",
      );
    }
  };
  if (v.xor !== null) {
    const [lo, hi] = v.xor;
    for (let p = 0; p <= last; p++) {
      const key = (d[p] as number) ^ f;
      if (key < lo || key > hi) continue;
      let k = 1;
      while (k < m && ((d[p + k] as number) ^ key) === pat[k]) k++;
      if (k === m) push(p);
    }
  } else if (v.nocase) {
    for (let p = 0; p <= last; p++) {
      if (LOWER[d[p] as number] !== f) continue;
      let k = 1;
      while (k < m && LOWER[d[p + k] as number] === pat[k]) k++;
      if (k === m) push(p);
    }
  } else {
    for (let p = 0; p <= last; p++) {
      if (d[p] !== f) continue;
      let k = 1;
      while (k < m && d[p + k] === pat[k]) k++;
      if (k === m) push(p);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// hex strings: a state machine run as a set of states
// ---------------------------------------------------------------------------------------------

interface Nfa {
  kind: Uint8Array; // 0 byte, 1 split, 2 accept
  val: Uint8Array;
  mask: Uint8Array;
  neg: Uint8Array;
  o1: Int32Array;
  o2: Int32Array;
  start: number;
  size: number;
  first: Uint8Array; // bytes that can start a match
}

function buildNfa(items: HexItem[]): Nfa {
  const kind: number[] = [];
  const val: number[] = [];
  const mask: number[] = [];
  const neg: number[] = [];
  const o1: number[] = [];
  const o2: number[] = [];
  const add = (k: number, a: number, b: number, nn: number, x: number, y: number): number => {
    kind.push(k);
    val.push(a);
    mask.push(b);
    neg.push(nn);
    o1.push(x);
    o2.push(y);
    return kind.length - 1;
  };
  const accept = add(2, 0, 0, 0, -1, -1);
  const any = (next: number): number => add(0, 0, 0, 0, next, -1);
  const seq = (list: HexItem[], next: number): number => {
    let cur = next;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i] as HexItem;
      if (it.k === "b") cur = add(0, it.val, it.mask, it.neg ? 1 : 0, cur, -1);
      else if (it.k === "j") {
        let tail = cur;
        if (it.hi === -1) {
          const loop = add(1, 0, 0, 0, cur, -1);
          o2[loop] = any(loop);
          tail = loop;
        } else {
          for (let k = 0; k < it.hi - it.lo; k++) tail = add(1, 0, 0, 0, cur, any(tail));
        }
        for (let k = 0; k < it.lo; k++) tail = any(tail);
        cur = tail;
      } else {
        const entries = it.alts.map((a) => seq(a, cur));
        let e = entries[entries.length - 1] as number;
        for (let k = entries.length - 2; k >= 0; k--) e = add(1, 0, 0, 0, entries[k] as number, e);
        cur = e;
      }
    }
    return cur;
  };
  const start = seq(items, accept);
  const size = kind.length;
  const nfa: Nfa = {
    kind: Uint8Array.from(kind),
    val: Uint8Array.from(val),
    mask: Uint8Array.from(mask),
    neg: Uint8Array.from(neg),
    o1: Int32Array.from(o1),
    o2: Int32Array.from(o2),
    start,
    size,
    first: new Uint8Array(256),
  };
  // the possible first bytes
  const seen = new Uint8Array(size);
  const stack = [start];
  while (stack.length > 0) {
    const s = stack.pop() as number;
    if (seen[s] === 1) continue;
    seen[s] = 1;
    if (nfa.kind[s] === 1) stack.push(nfa.o1[s] as number, nfa.o2[s] as number);
    else if (nfa.kind[s] === 0) {
      for (let b = 0; b < 256; b++) {
        if (((b & (nfa.mask[s] as number)) === nfa.val[s]) !== (nfa.neg[s] === 1)) nfa.first[b] = 1;
      }
    }
  }
  return nfa;
}

function scanHex(
  d: Uint8Array,
  items: HexItem[],
  budget: Budget,
  out: { off: number; len: number }[],
): void {
  const nfa = buildNfa(items);
  const n = d.length;
  const { kind, val, mask, neg, o1, o2 } = nfa;
  const mark = new Uint32Array(nfa.size);
  let gen = 0;
  let cur = new Int32Array(nfa.size);
  let nxt = new Int32Array(nfa.size);
  const stack = new Int32Array(nfa.size * 2 + 2);
  /** Adds the byte and accept states reachable from `s`, in priority order, to `list`; returns the length. */
  const close = (s: number, list: Int32Array, len: number): number => {
    let sp = 0;
    stack[sp++] = s;
    while (sp > 0) {
      const x = stack[--sp] as number;
      if (mark[x] === gen) continue;
      mark[x] = gen;
      if (kind[x] === 1) {
        stack[sp++] = o2[x] as number;
        stack[sp++] = o1[x] as number;
      } else list[len++] = x;
    }
    return len;
  };
  for (let p = 0; p < n; p++) {
    if (nfa.first[d[p] as number] === 0) continue;
    gen++;
    let cl = close(nfa.start, cur, 0);
    let best = -1;
    budget.add(1);
    for (let i = p; cl > 0; i++) {
      gen++;
      let nl = 0;
      const b = i < n ? (d[i] as number) : -1;
      for (let k = 0; k < cl; k++) {
        const s = cur[k] as number;
        if (kind[s] === 2) {
          best = i - p; // a match: the threads of lower priority are dropped
          break;
        }
        if (b >= 0 && ((b & (mask[s] as number)) === val[s]) !== (neg[s] === 1))
          nl = close(o1[s] as number, nxt, nl);
      }
      budget.add(cl + 1);
      const t = cur;
      cur = nxt;
      nxt = t;
      cl = nl;
    }
    if (best > 0) {
      out.push({ off: p, len: best });
      if (out.length > MAX_MATCHES_PER_STRING) {
        throw limitFailure(
          "yaraMatches",
          MAX_MATCHES_PER_STRING,
          out.length,
          "matches of one YARA string",
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// the entry point
// ---------------------------------------------------------------------------------------------

/** The Latin-1 text of the data (one UTF-16 unit per byte), built in chunks. */
export function latin1(d: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < d.length; i += 8192) {
    parts.push(String.fromCharCode(...d.subarray(i, Math.min(d.length, i + 8192))));
  }
  return parts.join("");
}

export interface Scanner {
  data: Uint8Array;
  budget: Budget;
  text: string | null;
}

export function makeScanner(data: Uint8Array): Scanner {
  if (data.length > MAX_DATA) {
    throw limitFailure("yaraInput", MAX_DATA, data.length, "YARA input");
  }
  return { data, budget: new Budget(), text: null };
}

/** All matches of one string definition in the data, ordered by offset. */
export function findMatches(sc: Scanner, def: StringDef): Found {
  const raw: { off: number; len: number }[] = [];
  const d = sc.data;
  if (def.kind === "text") {
    for (const v of textVariants(def.bytes, def.mods))
      scanVariant(d, v, def.fullword, sc.budget, raw);
  } else if (def.kind === "hex") {
    scanHex(d, def.items, sc.budget, raw);
  } else {
    sc.text ??= latin1(d);
    sc.budget.add(d.length);
    const found = execAll(`(?=(${def.pattern}))`, def.flags, sc.text);
    for (const m of found) {
      const len = (m.groups[0] ?? "").length;
      if (len === 0 && m.index >= d.length) continue;
      if (def.fullword && !fullAscii(d, m.index, len)) continue;
      raw.push({ off: m.index, len });
      if (raw.length > MAX_MATCHES_PER_STRING) {
        throw limitFailure(
          "yaraMatches",
          MAX_MATCHES_PER_STRING,
          raw.length,
          "matches of one YARA string",
        );
      }
    }
  }
  if (def.kind === "text") {
    raw.sort((a, b) => a.off - b.off || a.len - b.len);
  }
  const off: number[] = [];
  const len: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as { off: number; len: number };
    if (i > 0 && off[off.length - 1] === r.off) continue; // one match per offset, the shortest (ascii before wide)
    off.push(r.off);
    len.push(r.len);
  }
  return { off, len };
}
