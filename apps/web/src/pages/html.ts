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
// A tiny HTML builder for the generated reference pages, written so that escaping cannot be forgotten.
//
// Everything that is DATA (catalogue text, help text, parameter values, URLs) is interpolated through
// the `h` template tag, which escapes every value as text. The only way to put markup in is a value that
// is itself the result of `h` (a `SafeHtml`) or `join` of such values. There is no function that turns a
// string into markup, so a hostile string can only ever appear as text or as an attribute value.
// Pure: no DOM, no I/O.

/** Markup that was built by `h`: its dynamic parts are already escaped. Cannot be made from a string. */
export class SafeHtml {
  readonly #markup: string;
  /** @internal Use `h`. Kept public only so `h` and `join` can build one. */
  constructor(markup: string, token: typeof TOKEN) {
    if (token !== TOKEN) throw new Error("SafeHtml is made by h`` only");
    this.#markup = markup;
  }
  toString(): string {
    return this.#markup;
  }
}

const TOKEN = Symbol("SafeHtml");

/** A value that may be interpolated: text (escaped), markup built by `h`, or a list of these. */
export type Part = string | number | boolean | null | undefined | SafeHtml | readonly Part[];

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Text for an element body or a double or single quoted attribute value. Also replaces NUL. */
export function escapeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[&<>"'`\u0000]/g, (c) => ESCAPES[c] ?? "\ufffd");
}

function part(value: Part): string {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (value instanceof SafeHtml) return value.toString();
  if (typeof value === "string") return escapeText(value);
  if (typeof value === "number") return escapeText(String(value));
  return value.map(part).join("");
}

/** Build markup. The literal parts are trusted (they are in the source); every interpolation is escaped. */
export function h(strings: TemplateStringsArray, ...values: readonly Part[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += part(values[i] as Part) + (strings[i + 1] ?? "");
  return new SafeHtml(out, TOKEN);
}

/** Concatenate parts (text is escaped, markup is kept) with an optional separator markup. */
export function join(parts: readonly Part[], separator: SafeHtml | string = ""): SafeHtml {
  const sep = part(separator);
  return new SafeHtml(parts.map(part).join(sep), TOKEN);
}

/** The empty markup. */
export const empty: SafeHtml = new SafeHtml("", TOKEN);
