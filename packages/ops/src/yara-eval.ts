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
 * The YARA condition evaluator and the scan driver (WP 5.58). Values are 64-bit integers (BigInt, wrapped
 * to int64), booleans, or undefined (an offset past the data, a division by zero, a missing match): an
 * undefined comparison is undefined, `and`, `or` and `not` follow three-valued logic, and a rule matches
 * only when its condition is true (a non-zero integer is true). Every evaluated node counts against a
 * step budget, so a loop over a huge range stops with E_LIMIT_VALUE.
 */
import { limitFailure } from "./prim-util.js";
import { findMatches, makeScanner } from "./yara-match.js";
import type { Found, Scanner } from "./yara-match.js";
import type { Expr, MetaValue, Quant, Rule } from "./yara-rules.js";

/** The most condition nodes one scan may evaluate. */
export const MAX_COND_STEPS = 20_000_000;

type Val = bigint | boolean | undefined;

export interface ScanString {
  id: string;
  isPrivate: boolean;
  off: number[];
  len: number[];
}

export interface ScanRule {
  name: string;
  tags: string[];
  meta: { key: string; value: MetaValue }[];
  strings: ScanString[];
}

const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);

class Eval {
  steps = 0;
  found: Found[] = [];
  vars: bigint[] = [];
  cur = -1;
  constructor(
    readonly sc: Scanner,
    readonly results: boolean[],
  ) {}

  tick(): void {
    if (++this.steps > MAX_COND_STEPS) {
      throw limitFailure("yaraSteps", MAX_COND_STEPS, this.steps, "YARA condition steps");
    }
  }

  truth(v: Val): boolean | undefined {
    if (v === undefined) return undefined;
    return typeof v === "boolean" ? v : v !== 0n;
  }

  int(e: Expr): bigint | undefined {
    const v = this.ev(e);
    if (typeof v === "bigint") return v;
    if (typeof v === "boolean") return v ? 1n : 0n;
    return undefined;
  }

  /** The index of the string a `$` / `#` / `@` / `!` without a name stands for. */
  curIndex(): number {
    return this.cur;
  }

  inRange(f: Found, lo: bigint, hi: bigint): number {
    let n = 0;
    for (const o of f.off) if (BigInt(o) >= lo && BigInt(o) <= hi) n++;
    return n;
  }

  read(size: number, signed: boolean, be: boolean, at: bigint | undefined): bigint | undefined {
    if (at === undefined || at < 0n) return undefined;
    const d = this.sc.data;
    if (at + BigInt(size) > BigInt(d.length)) return undefined;
    const p = Number(at);
    let v = 0n;
    for (let k = 0; k < size; k++) {
      const byte = BigInt(d[be ? p + k : p + size - 1 - k] as number);
      v = (v << 8n) | byte;
    }
    return signed ? BigInt.asIntN(size * 8, v) : v;
  }

  quant(q: Quant, matched: number, total: number): boolean | undefined {
    switch (q.k) {
      case "any":
        return matched >= 1;
      case "all":
        return matched === total;
      case "none":
        return matched === 0;
      case "n": {
        const n = this.int(q.e);
        return n === undefined ? undefined : BigInt(matched) >= n;
      }
      case "pct": {
        const n = this.int(q.e);
        return n === undefined ? undefined : BigInt(matched) * 100n >= n * BigInt(total);
      }
    }
  }

  ev(e: Expr): Val {
    this.tick();
    switch (e.t) {
      case "int":
        return e.v;
      case "bool":
        return e.v;
      case "filesize":
        return BigInt(this.sc.data.length);
      case "str":
        return (this.found[e.i] as Found).off.length > 0;
      case "cnt":
        return BigInt((this.found[e.i] as Found).off.length);
      case "cntin": {
        const lo = this.int(e.lo);
        const hi = this.int(e.hi);
        if (lo === undefined || hi === undefined) return undefined;
        const f = this.found[e.i] as Found;
        this.steps += f.off.length;
        return BigInt(this.inRange(f, lo, hi));
      }
      case "off":
      case "len": {
        const f = this.found[e.i] as Found;
        const k = e.idx === null ? 1n : this.int(e.idx);
        if (k === undefined || k < 1n || k > BigInt(f.off.length)) return undefined;
        return BigInt((e.t === "off" ? f.off : f.len)[Number(k) - 1] as number);
      }
      case "cur": {
        const f = this.found[this.cur] as Found;
        if (e.what === "str") return f.off.length > 0;
        if (e.what === "cnt") return BigInt(f.off.length);
        if (f.off.length === 0) return undefined;
        return BigInt((e.what === "off" ? f.off : f.len)[0] as number);
      }
      case "at": {
        const p = this.int(e.e);
        if (p === undefined) return undefined;
        const f = this.found[e.i < 0 ? this.cur : e.i] as Found;
        this.steps += f.off.length;
        return f.off.includes(Number(BigInt.asIntN(53, p)));
      }
      case "in": {
        const lo = this.int(e.lo);
        const hi = this.int(e.hi);
        if (lo === undefined || hi === undefined) return undefined;
        const f = this.found[e.i < 0 ? this.cur : e.i] as Found;
        this.steps += f.off.length;
        return this.inRange(f, lo, hi) > 0;
      }
      case "rd":
        return this.read(e.size, e.signed, e.be, this.int(e.e));
      case "neg": {
        const a = this.int(e.a);
        return a === undefined ? undefined : wrap(-a);
      }
      case "bnot": {
        const a = this.int(e.a);
        return a === undefined ? undefined : wrap(~a);
      }
      case "bin": {
        const a = this.int(e.a);
        const b = this.int(e.b);
        if (a === undefined || b === undefined) return undefined;
        switch (e.op) {
          case "+":
            return wrap(a + b);
          case "-":
            return wrap(a - b);
          case "*":
            return wrap(a * b);
          case "\\":
            return b === 0n ? undefined : wrap(a / b);
          case "%":
            return b === 0n ? undefined : wrap(a % b);
          case "&":
            return a & b;
          case "|":
            return a | b;
          case "^":
            return a ^ b;
          case "<<":
            return b < 0n ? undefined : b >= 64n ? 0n : wrap(a << b);
          default:
            return b < 0n ? undefined : b >= 64n ? (a < 0n ? -1n : 0n) : a >> b;
        }
      }
      case "cmp": {
        const a = this.int(e.a);
        const b = this.int(e.b);
        if (a === undefined || b === undefined) return undefined;
        switch (e.op) {
          case "<":
            return a < b;
          case "<=":
            return a <= b;
          case ">":
            return a > b;
          case ">=":
            return a >= b;
          case "==":
            return a === b;
          default:
            return a !== b;
        }
      }
      case "and": {
        const a = this.truth(this.ev(e.a));
        if (a === false) return false;
        const b = this.truth(this.ev(e.b));
        if (b === false) return false;
        return a === undefined || b === undefined ? undefined : true;
      }
      case "or": {
        const a = this.truth(this.ev(e.a));
        if (a === true) return true;
        const b = this.truth(this.ev(e.b));
        if (b === true) return true;
        return a === undefined || b === undefined ? undefined : false;
      }
      case "not": {
        const a = this.truth(this.ev(e.a));
        return a === undefined ? undefined : !a;
      }
      case "var":
        return this.vars[e.slot];
      case "rule":
        return this.results[e.i] === true;
      case "of": {
        let matched = 0;
        let lo: bigint | undefined;
        let hi: bigint | undefined;
        let at: bigint | undefined;
        if (e.range !== null) {
          lo = this.int(e.range[0]);
          hi = this.int(e.range[1]);
          if (lo === undefined || hi === undefined) return undefined;
        }
        if (e.at !== null) {
          at = this.int(e.at);
          if (at === undefined) return undefined;
        }
        for (const i of e.set) {
          this.tick();
          const f = this.found[i] as Found;
          let ok: boolean;
          if (lo !== undefined && hi !== undefined) ok = this.inRange(f, lo, hi) > 0;
          else if (at !== undefined) ok = f.off.includes(Number(BigInt.asIntN(53, at)));
          else ok = f.off.length > 0;
          if (ok) matched++;
        }
        return this.quant(e.q, matched, e.set.length);
      }
      case "forof": {
        let matched = 0;
        const saved = this.cur;
        for (const i of e.set) {
          this.cur = i;
          if (this.truth(this.ev(e.body)) === true) matched++;
        }
        this.cur = saved;
        return this.quant(e.q, matched, e.set.length);
      }
      case "forin": {
        const items: bigint[] = [];
        let count: bigint;
        let start = 0n;
        if (e.list !== null) {
          for (const x of e.list) {
            const v = this.int(x);
            if (v === undefined) return undefined;
            items.push(v);
          }
          count = BigInt(items.length);
        } else {
          const lo = this.int(e.lo as Expr);
          const hi = this.int(e.hi as Expr);
          if (lo === undefined || hi === undefined) return undefined;
          start = lo;
          count = hi < lo ? 0n : hi - lo + 1n;
        }
        if (count > BigInt(MAX_COND_STEPS)) {
          throw limitFailure("yaraSteps", MAX_COND_STEPS, Number(count), "YARA loop iterations");
        }
        const total = Number(count);
        let matched = 0;
        for (let k = 0; k < total; k++) {
          this.vars[e.slot] = e.list !== null ? (items[k] as bigint) : start + BigInt(k);
          if (this.truth(this.ev(e.body)) === true) matched++;
          // any / none / n can stop once decided
          if (e.q.k === "any" && matched >= 1) return true;
        }
        return this.quant(e.q, matched, total);
      }
    }
  }
}

/** Scans the data with the rules; the matching, non-private rules in source order, with their matched strings. */
export function scanRules(data: Uint8Array, rules: readonly Rule[]): ScanRule[] {
  const sc = makeScanner(data);
  const results: boolean[] = new Array<boolean>(rules.length).fill(false);
  const out: (ScanRule | null)[] = new Array<ScanRule | null>(rules.length).fill(null);
  const ev = new Eval(sc, results);
  const run = (idx: number): boolean => {
    const rule = rules[idx] as Rule;
    ev.found = rule.strings.map((s) => findMatches(sc, s));
    ev.vars = new Array<bigint>(rule.slots).fill(0n);
    const ok = ev.truth(ev.ev(rule.cond)) === true;
    if (ok) {
      out[idx] = {
        name: rule.name,
        tags: rule.tags,
        meta: rule.meta,
        strings: rule.strings
          .map((s, i): ScanString => {
            const f = ev.found[i] as Found;
            return { id: s.id, isPrivate: s.isPrivate, off: f.off, len: f.len };
          })
          .filter((s) => s.off.length > 0),
      };
    }
    return ok;
  };
  // global rules first: one that is false makes every other rule false
  let globalsOk = true;
  rules.forEach((r, i) => {
    if (r.isGlobal) {
      results[i] = run(i);
      if (!results[i]) globalsOk = false;
    }
  });
  rules.forEach((r, i) => {
    if (!r.isGlobal) results[i] = globalsOk && run(i);
  });
  const shown: ScanRule[] = [];
  rules.forEach((r, i) => {
    const o = out[i];
    if (o && results[i] && !r.isPrivate) shown.push(o);
  });
  return shown;
}
