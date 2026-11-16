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
 * The primitives of the magic vocabulary (vocab/magic.fth).
 *
 * `_identity` is `identifyData` of the content checks (src/checks/identify.ts), which is the evaluator itself
 * and so the justified helper under the FL-first rule. Pure: it looks at a bounded prefix, runs no operation
 * and does no search.
 *
 * `_search` is the host primitive of `magic:magic` (WP 6.33, RECIPES.md section 4.4): it asks the Magic
 * engine of the worker, through the host that the worker installs for the bake (src/magic-host.ts), and
 * returns the candidates as plain data; the report text is FL. It is marked as a regex-engine primitive
 * because the candidates may run regular expressions (the crib, `regex:*` operations), so `magic:magic`
 * needs a hard kill (`needsHardKill`). Without a host (a runtime no worker drives) it fails with E_PRIMITIVE.
 * Its lossy preview of the output (UTF-8 decoding that never fails, controls shown as escapes) is the one
 * thing FL has no word for.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { identifyData } from "../checks/identify.js";
import { magicHostFor } from "../magic-host.js";
import { markRegexPrimitive } from "../regex-engine.js";

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input: Uint8Array): string;
}

const { int, list, str } = valueHelpers;

/** Characters of the output a report block shows. */
const PREVIEW_CHARS = 80;

/** The first 80 characters of the output as one line: invalid UTF-8 becomes U+FFFD, controls are escaped. */
function previewOf(output: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(output);
  let out = "";
  let n = 0;
  for (const ch of text) {
    if (n++ === PREVIEW_CHARS) break;
    const c = ch.codePointAt(0) as number;
    if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "magic",
    "_identity",
    "( data:bytes -- list )",
    (data: Uint8Array) => {
      const found = identifyData(data);
      return found === null ? [str("unknown"), str("unknown")] : [str(found.id), str(found.family)];
    },
    {
      doc: "The id and the family of the most specific identification of the data, as a list of two strings, both unknown when there is none (private helper of magic:identify and magic:is-format).",
      category: "Forensics",
    },
  ),
  markRegexPrimitive(
    definePrimitive(
      "magic",
      "_search",
      "( data:bytes depth:int crib:str intensive:bool -- list )",
      async (
        data: Uint8Array,
        depth: number | bigint,
        crib: string,
        intensive: boolean,
        ctx: PrimitiveContext,
      ): Promise<Value[]> => {
        const host = magicHostFor(ctx.signal);
        if (host === undefined) {
          throw new ForgeError({
            code: "E_PRIMITIVE",
            message:
              "magic:magic needs the Forge worker, which provides the Magic engine; this runtime has none",
            detail: { reason: "no-magic-host" },
          });
        }
        const report = await host.search({ data, depth: Number(depth), intensive, crib });
        return report.candidates.map((c) =>
          list([
            str(c.ops.join(" ")),
            int(c.score100),
            list(c.reasons.map((r) => str(r))),
            str(previewOf(c.output)),
          ]),
        );
      },
      {
        effects: ["+async"],
        doc: "The candidates of the Magic engine for the data, as a list of { recipe:str score:int reasons:list preview:str } lists, best first; the score is 100 times the score (private helper of magic:magic).",
        category: "Forensics",
      },
    ),
  ),
];
