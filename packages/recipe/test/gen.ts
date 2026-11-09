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
/** A seeded generator of valid recipes over a catalogue, for the round-trip and share properties. */
import type { ParamSpec } from "@forge/lang";
import type { CatalogueOpView, CatalogueView, Recipe } from "../src/types.js";

const UI_TYPES = new Set([
  "bytes",
  "str",
  "int",
  "num",
  "number",
  "bool",
  "choice",
  "toggle",
  "regex",
  "charset",
  "key",
]);

const NASTY = [
  "a",
  "b",
  "Z",
  " ",
  "  ",
  '"',
  "\\",
  "\n",
  "\r",
  "\t",
  "\u0000",
  "\u0001",
  "\u007f",
  "\u0085",
  "\u009f",
  " ",
  "é",
  "😀",
  "[",
  "]",
  "#",
  "@break",
  "\\ ~ ",
  "\\ # ",
  "  \\ @note=",
  "(",
  ")",
  ":",
];

const REGEXES = [
  "a+",
  "^x",
  "[a-z]+",
  "(?:a|b)c",
  "\\d+",
  "\\\\",
  "\\(",
  ".*",
  "(?<n>a)\\k<n>",
  "é",
];

export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  bool(p = 0.5): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }
}

function nastyString(rng: Rng, max = 6, min = 0): string {
  const n = min + rng.int(max - min + 1);
  let s = "";
  for (let i = 0; i < n; i++) s += rng.pick(NASTY);
  return s;
}

function hexOf(rng: Rng, bytes: number): string {
  let s = "";
  for (let i = 0; i < bytes; i++) {
    const b = rng.int(256).toString(16).padStart(2, "0");
    s += (rng.bool() ? b.toUpperCase() : b) + (rng.bool(0.3) ? " " : "");
  }
  return s;
}

function base64Of(rng: Rng): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  // whole groups of four are always canonical; a final "QQ==" style group is the canonical padded spelling of one byte
  let s = "";
  for (let i = 0, n = rng.int(3); i < n; i++)
    for (let j = 0; j < 4; j++) s += alphabet[rng.int(64)];
  if (rng.bool()) s += "QQ" + (rng.bool() ? "==" : "");
  return s;
}

/** A valid encoded value (`enc` among `allowed`). */
export function encodedValue(
  rng: Rng,
  allowed: readonly string[] = ["utf8", "hex", "latin1", "base64"],
  nonEmpty = false,
) {
  const enc = rng.pick(allowed);
  switch (enc) {
    case "hex":
      return { value: hexOf(rng, nonEmpty ? 1 + rng.int(3) : rng.int(3)), enc };
    case "latin1": {
      let s = "";
      for (let i = 0, n = nonEmpty ? 1 + rng.int(3) : rng.int(3); i < n; i++) {
        s += String.fromCharCode(rng.bool() ? 0x20 + rng.int(0x5f) : rng.int(256));
      }
      return { value: s, enc };
    }
    case "base64":
      return { value: nonEmpty ? "QQ==" : base64Of(rng), enc };
    default:
      return { value: nastyString(rng, 4, nonEmpty ? 1 : 0), enc };
  }
}

function intInRange(rng: Rng, c: ParamSpec["constraint"]): number | string {
  if (c?.oneOf !== undefined) return rng.pick(c.oneOf);
  if (c?.min === undefined && c?.max === undefined && rng.bool(0.15)) {
    return String(BigInt(2) ** BigInt(70) + BigInt(rng.int(100)));
  }
  const lo = c?.min ?? -50;
  const hi = c?.max ?? lo + 100;
  const n = lo + rng.int(hi - lo + 1);
  return rng.bool(0.2) ? String(n) : n;
}

function lengthRange(c: ParamSpec["constraint"], fallbackMax: number): [number, number] {
  if (c?.lengthOneOf !== undefined) {
    const v = c.lengthOneOf[0] as number;
    return [v, v];
  }
  return [c?.minLength ?? 0, c?.maxLength ?? fallbackMax];
}

/** A value of the right shape for `spec`. */
export function paramValue(rng: Rng, spec: ParamSpec): unknown {
  const c = spec.constraint;
  switch (spec.type) {
    case "int":
      return intInRange(rng, c);
    case "num":
    case "number": {
      if (c?.oneOf !== undefined) return rng.pick(c.oneOf);
      const lo = c?.min ?? -10;
      const hi = c?.max ?? lo + 20;
      const x = lo + rng.next() * (hi - lo);
      return rng.bool() ? Math.round(x) : Math.round(x * 100) / 100;
    }
    case "bool":
      return rng.bool();
    case "choice":
      return rng.pick(spec.options ?? []);
    case "regex": {
      const [, hi] = lengthRange(c, 1024);
      return rng.pick(REGEXES.filter((r) => [...r].length <= hi));
    }
    case "charset": {
      const [lo, hi] = lengthRange(c, 5);
      const n = Math.max(1, lo) + rng.int(Math.max(1, hi - Math.max(1, lo) + 1));
      return [..."abcdefghijé😀"].slice(0, n).join("");
    }
    case "str": {
      const [lo, hi] = lengthRange(c, 6);
      const target = lo + rng.int(hi - lo + 1);
      let s = "";
      while ([...s].length < target)
        s += rng.pick(NASTY.filter((x) => [...x].length === 1 && x !== "\u0000"));
      return s;
    }
    case "bytes": {
      const [lo, hi] = lengthRange(c, 4);
      return hexOf(rng, lo + rng.int(hi - lo + 1));
    }
    case "toggle":
    case "key": {
      const allowed = spec.options ?? ["utf8", "hex", "latin1", "base64"];
      for (;;) {
        const v = encodedValue(rng, allowed);
        const [lo, hi] = lengthRange(c, 8);
        const len =
          v.enc === "utf8"
            ? new TextEncoder().encode(v.value).length
            : v.enc === "hex"
              ? v.value.replace(/ /g, "").length / 2
              : v.enc === "latin1"
                ? v.value.length
                : v.value.length === 0
                  ? 0
                  : v.value.endsWith("==")
                    ? (v.value.length / 4) * 3 - 2
                    : (v.value.length / 4) * 3;
        if (len >= lo && len <= hi) return v;
      }
    }
    default:
      throw new Error(`no generator for ${spec.type}`);
  }
}

function usable(op: CatalogueOpView): boolean {
  return op.params.every((p) => UI_TYPES.has(p.type));
}

function genOp(
  rng: Rng,
  ops: readonly CatalogueOpView[],
  withAlias: boolean,
): Record<string, unknown> {
  const op = rng.pick(ops);
  const step: Record<string, unknown> = {
    kind: "op",
    op:
      withAlias && op.aliases.length > 0 && rng.bool()
        ? `${op.qname.split(":")[0]}:${op.aliases[0]}`
        : op.qname,
  };
  const params: Record<string, unknown> = {};
  for (const spec of op.params) {
    if (spec.required || rng.bool(0.6)) params[spec.name] = paramValue(rng, spec);
  }
  if (Object.keys(params).length > 0 || rng.bool(0.1)) step.params = params;
  return step;
}

export function genRecipe(
  rng: Rng,
  catalogue: CatalogueView,
  options: { maxDepth?: number } = {},
): Recipe {
  const ops = catalogue.ops.filter(usable);
  const predicates = ops.filter((o) => o.output === "bool");
  const plain = ops.filter((o) => o.output !== "bool" || true);
  const maxDepth = options.maxDepth ?? 4;
  let budget = 40;

  const common = (step: Record<string, unknown>): Record<string, unknown> => {
    if (rng.bool(0.15)) step.disabled = true;
    else if (rng.bool(0.05)) step.disabled = false;
    if (rng.bool(0.15)) step.breakpoint = true;
    if (rng.bool(0.2)) step.note = nastyString(rng, 5, rng.bool(0.1) ? 0 : 1);
    return step;
  };

  const list = (depth: number): unknown[] => {
    const n = rng.int(depth === 1 ? 6 : 4);
    const out: unknown[] = [];
    for (let i = 0; i < n && budget > 0; i++) out.push(step(depth));
    return out;
  };

  const step = (depth: number): unknown => {
    budget--;
    const pickKind = rng.int(depth >= maxDepth ? 3 : 8);
    if (pickKind < 2) {
      const s = genOp(rng, plain, true);
      if (rng.bool(0.2)) s.hash = hexOf(rng, 32).replace(/ /g, "").toLowerCase();
      return common(s);
    }
    if (pickKind === 2) return { kind: "comment", text: nastyString(rng, 8) };
    switch (pickKind) {
      case 3:
        return common({
          kind: "fork",
          split: encodedValue(rng, undefined, true),
          join: encodedValue(rng),
          steps: list(depth + 1),
        });
      case 4: {
        const s: Record<string, unknown> = { kind: "subsection", pattern: rng.pick(REGEXES) };
        if (rng.bool()) s.flags = rng.pick(["", "i", "mi", "sim", "ss", "m"]);
        if (rng.bool()) s.encoding = rng.pick(["utf8", "latin1"]);
        s.steps = list(depth + 1);
        return common(s);
      }
      case 5:
      case 6: {
        const test: Record<string, unknown> =
          predicates.length > 0 && rng.bool()
            ? genOp(rng, predicates, true)
            : { kind: "regex", pattern: rng.pick(REGEXES) };
        if (test.kind === "regex") {
          if (rng.bool()) test.flags = rng.pick(["", "i", "mi"]);
          if (rng.bool()) test.encoding = rng.pick(["utf8", "latin1"]);
        } else if (rng.bool(0.3)) {
          test.hash = "ab".repeat(32);
        }
        const s: Record<string, unknown> = { kind: "if", test, then: list(depth + 1) };
        if (rng.bool(0.6)) s.else = list(depth + 1);
        return common(s);
      }
      default: {
        const s: Record<string, unknown> = { kind: "repeat" };
        if (rng.bool()) s.times = 1 + rng.int(1000);
        else {
          s.until = "stable";
          if (rng.bool()) s.max = rng.pick([1, 100, 7, 1000]);
        }
        s.steps = list(depth + 1);
        return common(s);
      }
    }
  };

  const recipe: Record<string, unknown> = { forge: 1 };
  if (rng.bool(0.4)) recipe.name = nastyString(rng, 6);
  if (rng.bool(0.2)) recipe.description = nastyString(rng, 12);
  if (rng.bool(0.2)) recipe.catalogue = catalogue.version;
  recipe.steps = list(1);
  return recipe as unknown as Recipe;
}
