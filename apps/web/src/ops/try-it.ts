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
// What Try it builds for a help example (WP 6.13a): the one-step recipe, the input bytes and the encoding
// of the input tab. Pure (no DOM, no store), so the dialog and the guard test over every real example
// (try-it.guard.test.ts) use the very same function.
import type { Recipe } from "@forge/recipe";
import type { HelpExample } from "@forge/ops";
import { detectEol, findLoneSurrogate, latin1ToBytes } from "../io/codec.js";
import type { EncodingName, EolName } from "../io/codec.js";
import { exampleInput, exampleStep } from "./help-view.js";
import type { BytesResult } from "./help-view.js";

export type TryItPlan =
  | {
      readonly ok: true;
      readonly recipe: Recipe;
      readonly bytes: Uint8Array;
      readonly encoding: EncodingName;
      /** The line ending the input tab should show the bytes with (the one the text uses most). */
      readonly eol: EolName;
    }
  | { readonly ok: false; readonly message: string };

/**
 * The bytes of a text input exactly as written. The editor's own conversion (`textToBytes`) turns every
 * CR LF and lone CR into LF, which is right for typing but wrong for an example: the vector's input has
 * CR LF line breaks (a CSV file, a PEM block, an HTTP message) and its expected output depends on them.
 * Hex and base64 text has no line endings and goes through the shared reader.
 */
function exactInput(example: Pick<HelpExample, "input">): BytesResult {
  const { value, enc } = example.input;
  if (enc === "utf8") {
    const lone = findLoneSurrogate(value);
    if (lone >= 0) return { ok: false, message: `unpaired surrogate at position ${lone + 1}` };
    return { ok: true, bytes: new TextEncoder().encode(value), encoding: "utf8" };
  }
  if (enc === "latin1") {
    const r = latin1ToBytes(value);
    return r.ok
      ? { ok: true, bytes: r.bytes, encoding: "latin1" }
      : { ok: false, message: r.message };
  }
  return exampleInput(example);
}

/** The recipe (the op with the example's parameters as its only step) and the input of an example. */
export function planTryIt(
  qname: string,
  example: Pick<HelpExample, "params" | "input">,
): TryItPlan {
  const input = exactInput(example);
  if (!input.ok) return input;
  const recipe = { forge: 1, steps: [exampleStep(qname, example)] } as unknown as Recipe;
  const text = input.encoding === "utf8" || input.encoding === "latin1";
  const eol = text ? detectEol(example.input.value) : "lf";
  return { ok: true, recipe, bytes: input.bytes, encoding: input.encoding, eol };
}
