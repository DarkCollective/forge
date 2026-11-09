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
 * The one primitive of the internal `recipe` vocabulary (RECIPES.md section 4.3). Everything else
 * in that vocabulary is FL (`vocab/recipe.fth`).
 */
import { coerce, definePrimitive, bytes as bytesValue, str as strValue } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { guardResult } from "../prim-util.js";
import { execAll, markRegexPrimitive } from "../regex-engine.js";

const CHUNK = 8192;

function latin1Decode(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += CHUNK) {
    out += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return out;
}

function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/**
 * Decode `data` as `encoding`, find the non-empty matches and return `gap match gap ... gap` as bytes,
 * so that the concatenation is the input again.
 */
function splitMatches(
  data: Uint8Array,
  pattern: string,
  flags: string,
  encoding: string,
  ctx: PrimitiveContext,
): Value[] {
  const latin1 = encoding === "latin1";
  const text = latin1 ? latin1Decode(data) : (coerce(bytesValue(data), "str").v as string);
  const matches = execAll(pattern, flags, text).filter((m) => m.end > m.index);
  guardResult(ctx, data.length + 8 * (2 * matches.length + 1), "regex split result");
  const encode = (piece: string): Value => ({
    tag: "bytes",
    v: latin1 ? latin1Encode(piece) : (coerce(strValue(piece), "bytes").v as Uint8Array),
  });
  const out: Value[] = [];
  let last = 0;
  for (const m of matches) {
    out.push(encode(text.slice(last, m.index)), encode(m.text));
    last = m.end;
  }
  out.push(encode(text.slice(last)));
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive(
      "recipe",
      "_split-matches",
      "( bytes pattern:regex flags:str encoding:choice{utf8|latin1} -- list )",
      (data: Uint8Array, pattern: string, flags: string, encoding: string, ctx: PrimitiveContext) =>
        splitMatches(data, pattern, flags, encoding, ctx),
      {
        doc: "Split the data into gap, match, gap, ... pieces at the non-empty regex matches.",
        category: "Recipes",
      },
    ),
  ),
];
