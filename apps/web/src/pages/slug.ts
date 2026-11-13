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
// URLs of the reference pages (UI.md section 8.2). Pure.
//
// An operation is at /ops/<vocab>/<name>/. Each of the two segments is the vocabulary or the name with
// the slug rule applied:
//   - a character in a-z, 0-9 or - stays as it is (every real operation name is made of these only, so
//     every real URL is just the op name);
//   - any other character, including upper case, a dot, a slash, > ? + * and every non-ASCII character,
//     becomes _<hex>_ where <hex> is its code point in lower case hex without leading zeros;
//   - an empty segment becomes _.
// The rule is injective: _ only ever starts an escape or stands alone for the empty segment, so a
// segment decodes uniquely; the output has no dot (CloudFront treats a last segment with a dot as a
// file, infra/cf_function.js), no slash, no percent and no upper case, so it never needs encoding.
import type { Catalogue, CatalogueOp } from "@forge/ops";

/** The URL path of the index of all operations. */
export const INDEX_PATH = "/ops/";

/** One path segment: see the rule above. */
export function slugSegment(text: string): string {
  if (text === "") return "_";
  let out = "";
  for (const ch of text) {
    out += /^[a-z0-9-]$/.test(ch) ? ch : `_${(ch.codePointAt(0) ?? 0).toString(16)}_`;
  }
  return out;
}

/** Inverse of `slugSegment`, for tests and tools. Returns null when `slug` is not a valid output of the rule. */
export function unslugSegment(slug: string): string | null {
  if (slug === "_") return "";
  let out = "";
  let i = 0;
  while (i < slug.length) {
    const c = slug.charAt(i);
    if (c === "_") {
      const m = /^_([0-9a-f]+)_/.exec(slug.slice(i));
      if (m === null) return null;
      const code = Number.parseInt(m[1] as string, 16);
      if (code > 0x10ffff || /^[a-z0-9-]$/.test(String.fromCodePoint(code))) return null;
      out += String.fromCodePoint(code);
      i += m[0].length;
    } else if (/^[a-z0-9-]$/.test(c)) {
      out += c;
      i += 1;
    } else {
      return null;
    }
  }
  return out;
}

/** The URL path of an operation's page, with leading and trailing slash. */
export function opPath(op: Pick<CatalogueOp, "vocab" | "name">): string {
  return `/ops/${slugSegment(op.vocab)}/${slugSegment(op.name)}/`;
}

/** The file inside dist for a URL path: /ops/x/y/ to ops/x/y/index.html. */
export function fileOfPath(path: string): string {
  return `${path.slice(1)}index.html`;
}

/** The anchor id of a category on the index: lower case, other runs of characters as one hyphen. */
export function categoryId(category: string): string {
  const id = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return id === "" ? "other" : id;
}

/** Throws when two operations would share a URL (the build refuses to write a page over another). */
export function assertUniquePaths(catalogue: Pick<Catalogue, "ops">): void {
  const seen = new Map<string, string>();
  for (const op of catalogue.ops) {
    const path = opPath(op);
    const other = seen.get(path);
    if (other !== undefined)
      throw new Error(`reference pages: ${other} and ${op.qname} share ${path}`);
    seen.set(path, op.qname);
  }
}
