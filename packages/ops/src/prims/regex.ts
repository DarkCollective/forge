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
 * regex primitives (RECIPES.md section 4.2). Offsets and lengths are in code points. Every
 * primitive goes through `regex-engine.ts` and is marked as a regex-engine primitive.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { guardResult } from "../prim-util.js";
import {
  codePointsBetween,
  execAllNamed,
  markRegexPrimitive,
  testAny,
  type RegexMatchNamed,
} from "../regex-engine.js";

const CATEGORY = "Regular expressions";
const FLAGS = 'flags:str[0..3,/[ims]*/]=""';
const { int, str, list, record } = valueHelpers;

/** Size of one `find-all` record in the LANGUAGE.md 10.8 measure (including its slot in the list). */
function findAllItemSize(m: RegexMatchNamed): number {
  // list slot 8, record 16 per entry, keys start/end/text/groups, two ints, the text, the groups list
  let size = 8 + 4 * 16 + 2 * (5 + 3 + 4 + 6) + 8 + 8 + 2 * m.text.length + 8 * m.groups.length;
  for (const g of m.groups) size += 2 * (g?.length ?? 0);
  return size;
}

function findAll(text: string, pattern: string, flags: string, ctx: PrimitiveContext): Value[] {
  const matches = execAllNamed(pattern, flags, text);
  const items: Value[] = [];
  let size = 0;
  let cp = 0; // code points before `last`, advanced between matches: one pass over the text
  let last = 0;
  for (const m of matches) {
    size += findAllItemSize(m);
    guardResult(ctx, size, "regex:find-all result");
    cp += codePointsBetween(text, last, m.index);
    const start = cp;
    cp += codePointsBetween(text, m.index, m.end);
    last = m.end;
    items.push(
      record([
        ["start", int(start)],
        ["end", int(cp)],
        ["text", str(m.text)],
        ["groups", list(m.groups.map((g) => str(g ?? "")))],
      ]),
    );
  }
  return items;
}

const isDigit = (c: string | undefined): c is string => c !== undefined && c >= "0" && c <= "9";

/** ECMAScript's GetSubstitution for one match. */
function substitute(replacement: string, text: string, m: RegexMatchNamed): string {
  if (!replacement.includes("$")) return replacement;
  let out = "";
  let i = 0;
  while (i < replacement.length) {
    const ch = replacement.charAt(i);
    const next = replacement.charAt(i + 1);
    if (ch !== "$" || i + 1 >= replacement.length) {
      out += ch;
      i++;
    } else if (next === "$") {
      out += "$";
      i += 2;
    } else if (next === "&") {
      out += m.text;
      i += 2;
    } else if (next === "`") {
      out += text.slice(0, m.index);
      i += 2;
    } else if (next === "'") {
      out += text.slice(m.end);
      i += 2;
    } else if (isDigit(next)) {
      const two = replacement.charAt(i + 2);
      let digits = isDigit(two) ? next + two : next;
      if (digits.length === 2 && Number(digits) > m.groups.length) digits = next;
      const n = Number(digits);
      if (n >= 1 && n <= m.groups.length) out += m.groups[n - 1] ?? "";
      else out += "$" + digits;
      i += 1 + digits.length;
    } else if (next === "<" && m.named !== undefined) {
      const close = replacement.indexOf(">", i + 2);
      if (close < 0) {
        out += "$<";
        i += 2;
      } else {
        out += m.named.get(replacement.slice(i + 2, close)) ?? "";
        i = close + 1;
      }
    } else {
      out += "$";
      i++;
    }
  }
  return out;
}

function replace(
  text: string,
  pattern: string,
  replacement: string,
  flags: string,
  ctx: PrimitiveContext,
): string {
  const matches = execAllNamed(pattern, flags, text);
  const parts: string[] = [];
  let units = 0;
  const add = (part: string) => {
    units += part.length;
    guardResult(ctx, 2 * units, "regex:replace result");
    parts.push(part);
  };
  let last = 0;
  for (const m of matches) {
    add(text.slice(last, m.index));
    add(substitute(replacement, text, m));
    last = m.end;
  }
  add(text.slice(last));
  return parts.join("");
}

function split(text: string, pattern: string, flags: string, ctx: PrimitiveContext): Value[] {
  const items: Value[] = [];
  let size = 0;
  const push = (piece: string) => {
    size += 8 + 2 * piece.length;
    guardResult(ctx, size, "regex:split result");
    items.push(str(piece));
  };
  let last = 0;
  for (const m of execAllNamed(pattern, flags, text)) {
    if (m.end === m.index) continue;
    push(text.slice(last, m.index));
    last = m.end;
  }
  push(text.slice(last));
  return items;
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive(
      "regex",
      "test",
      `( str pattern:regex ${FLAGS} -- bool )`,
      (text: string, pattern: string, flags: string) => testAny(pattern, flags, text),
      { doc: "True when the pattern matches anywhere in the text.", category: CATEGORY },
    ),
  ),
  markRegexPrimitive(
    definePrimitive(
      "regex",
      "find-all",
      `( str pattern:regex ${FLAGS} -- list )`,
      (text: string, pattern: string, flags: string, ctx: PrimitiveContext) =>
        findAll(text, pattern, flags, ctx),
      {
        doc:
          "Every match as a record with start, end (code points, end exclusive), text and groups. " +
          "Empty matches are included.",
        category: CATEGORY,
      },
    ),
  ),
  markRegexPrimitive(
    definePrimitive(
      "regex",
      "replace",
      `( str pattern:regex replacement:str ${FLAGS} -- str )`,
      (text: string, pattern: string, replacement: string, flags: string, ctx: PrimitiveContext) =>
        replace(text, pattern, replacement, flags, ctx),
      {
        doc: "Replace every match. The replacement follows ECMAScript's substitution rules.",
        category: CATEGORY,
      },
    ),
  ),
  markRegexPrimitive(
    definePrimitive(
      "regex",
      "split",
      `( str pattern:regex ${FLAGS} -- list )`,
      (text: string, pattern: string, flags: string, ctx: PrimitiveContext) =>
        split(text, pattern, flags, ctx),
      {
        doc: "The pieces between the non-empty matches. Empty matches never split.",
        category: CATEGORY,
      },
    ),
  ),
];
