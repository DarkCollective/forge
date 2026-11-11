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
 * The YARA engine behind `yara:scan` (vocab/yara.fth), WP 5.58. One private primitive:
 * `yara:_scan ( data:bytes rules:str matches:bool -- list )` parses the rules (a documented subset of
 * YARA 4, src/yara-rules.ts), matches the strings (src/yara-match.ts), evaluates the conditions
 * (src/yara-eval.ts) and returns one record per matching, non-private rule: name, tags, meta (records of
 * key, value text and kind) and strings (records of id, count and, when `matches` is true, the matches as
 * records of offset, length and an escaped text excerpt). The report layout and the options are FL.
 *
 * Why a primitive and not FL: this is a language implementation (a rule parser, a hex-string state
 * machine, a condition evaluator) plus byte loops over the data. A bare FL loop costs about 5.5 VM steps a
 * character before any state, so a scan of 64 KiB for dozens of strings would be tens of millions of
 * steps. No FL prototype was written (a deviation from "FL first", recorded in the README section).
 *
 * The primitive is marked as a regex-engine primitive: regular-expression strings run through the regex
 * seam (`regex-engine.ts`), whose ECMAScript engine cannot be interrupted, so an untrusted recipe that
 * reaches this primitive needs the hard kill. The primitive itself holds no `RegExp`.
 */
import { definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { guardResult } from "../prim-util.js";
import { markRegexPrimitive } from "../regex-engine.js";
import { scanRules } from "../yara-eval.js";
import { parseRules } from "../yara-rules.js";

const { int, str, list, record } = valueHelpers;

/** At most this many bytes of a match are shown as text. */
const EXCERPT = 32;

function excerpt(d: Uint8Array, off: number, len: number): string {
  let s = "";
  const n = Math.min(len, EXCERPT);
  for (let i = 0; i < n; i++) {
    const c = d[off + i] as number;
    if (c === 0x22) s += '\\"';
    else if (c === 0x5c) s += "\\\\";
    else if (c === 0x0a) s += "\\n";
    else if (c === 0x0d) s += "\\r";
    else if (c === 0x09) s += "\\t";
    else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
    else s += "\\x" + c.toString(16).padStart(2, "0");
  }
  return len > EXCERPT ? s + "..." : s;
}

function scan(d: Uint8Array, rules: string, matches: boolean, ctx: PrimitiveContext): Value[] {
  const parsed = parseRules(rules);
  const found = scanRules(d, parsed);
  const out: Value[] = [];
  let size = 0;
  const grow = (n: number): void => {
    size += n;
    guardResult(ctx, size, "yara:scan result");
  };
  for (const r of found) {
    grow(300 + 2 * r.name.length);
    const meta = r.meta.map((m): Value => {
      const text = m.value.kind === "str" ? m.value.v : String(m.value.v);
      grow(200 + 2 * (m.key.length + text.length));
      return record([
        ["key", str(m.key)],
        ["value", str(text)],
        ["kind", str(m.value.kind)],
      ]);
    });
    const strings = r.strings
      .filter((s) => !s.isPrivate)
      .map((s): Value => {
        grow(200 + 2 * s.id.length);
        const ms: Value[] = [];
        if (matches) {
          for (let i = 0; i < s.off.length; i++) {
            const text = excerpt(d, s.off[i] as number, s.len[i] as number);
            grow(260 + 2 * text.length);
            ms.push(
              record([
                ["offset", int(s.off[i] as number)],
                ["length", int(s.len[i] as number)],
                ["text", str(text)],
              ]),
            );
          }
        }
        return record([
          ["id", str(s.id === "" ? "$" : "$" + s.id)],
          ["count", int(s.off.length)],
          ["matches", list(ms)],
        ]);
      });
    out.push(
      record([
        ["name", str(r.name)],
        ["tags", list(r.tags.map((t) => str(t)))],
        ["meta", list(meta)],
        ["strings", list(strings)],
      ]),
    );
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive(
      "yara",
      "_scan",
      "( data:bytes rules:str matches:bool -- list )",
      (d: Uint8Array, rules: string, matches: boolean, ctx: PrimitiveContext) =>
        scan(d, rules, matches, ctx),
      {
        doc:
          "Scan the data with YARA rules (a documented subset): one record per matching, non-private rule with " +
          "name, tags, meta (key, value, kind) and strings (id, count, matches: offset, length, text). " +
          "Rules outside the subset are E_COERCE with the line and column (private helper of yara:scan).",
      },
    ),
  ),
];
