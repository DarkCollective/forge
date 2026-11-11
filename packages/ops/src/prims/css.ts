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
 * css primitive: the CSS selector engine behind `css:select`. A Worker has no DOM, so the HTML is parsed by
 * `htmlparser2` (MIT, an HTML parser that never fails: it repairs unclosed and mis-nested tags as browsers do),
 * the selector is matched by `css-select` (BSD-2-Clause) and the matches are written by `dom-serializer` (MIT), all
 * three of the same family (the cheeriojs organisation), synchronous, imported here only, with no `eval` and no
 * `Function`. CyberChef parses with xmldom and matches with nwmatcher; it fails on HTML that is not XML.
 *
 *  - `_select ( html:str selector:str -- list )`: the outer HTML of each element that matches the selector, in
 *    document order (an element nested in another match is listed again inside it, as in CyberChef), as a list
 *    of str. A selector that css-select cannot read (a syntax error, a pseudo-element, an unknown pseudo-class) is
 *    E_COERCE with the library's message.
 *
 * Bounds. The selector is held to 4,096 characters (E_RANGE). The parsed document is walked once without
 * recursion: more than 512 levels of elements (the serialiser and the matcher recurse) or more than 200,000 nodes
 * is E_LIMIT_VALUE, and the output is held to `ctx.limits.maxValueBytes` while it grows (matches nest, so the
 * output can be larger than the input). Matching is linear in the document for the usual selectors and
 * polynomial for nested `:has()` and `:not()`; it cannot be interrupted from here, so the primitive is marked
 * for the bake's hard kill, like the regex words.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { selectAll } from "css-select";
import render from "dom-serializer";
import { parseDocument } from "htmlparser2";
import { MAX_DEPTH } from "../json-js.js";
import { coerceFailure, limitFailure, rangeFailure } from "../prim-util.js";
import { markRegexPrimitive } from "../regex-engine.js";

const { str } = valueHelpers;

/** The longest selector accepted, in characters. */
export const MAX_SELECTOR = 4096;
/** The most nodes a document may hold. */
export const MAX_NODES = 200_000;

interface HtmlNode {
  children?: HtmlNode[];
}

function checkTree(root: HtmlNode): void {
  let nodes = 0;
  const stack: { node: HtmlNode; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: HtmlNode; depth: number };
    if (++nodes > MAX_NODES) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `the HTML document has more than ${MAX_NODES} nodes`,
        detail: { limit: "htmlNodes", max: MAX_NODES },
      });
    }
    if (depth > MAX_DEPTH && node.children !== undefined) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `the HTML document is nested deeper than ${MAX_DEPTH} levels`,
        detail: { limit: "htmlDepth", max: MAX_DEPTH },
      });
    }
    if (node.children !== undefined) {
      for (const c of node.children) stack.push({ node: c, depth: depth + 1 });
    }
  }
}

function select(html: string, selector: string, ctx: PrimitiveContext): Value[] {
  if (selector.length > MAX_SELECTOR) {
    throw rangeFailure(`the CSS selector is longer than ${MAX_SELECTOR} characters`, {
      length: selector.length,
    });
  }
  if (selector.length === 0 || html.length === 0) return [];
  const doc = parseDocument(html);
  checkTree(doc as unknown as HtmlNode);
  let found;
  try {
    found = selectAll(selector, doc);
  } catch (e) {
    if (e instanceof RangeError) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: "the CSS selector went deeper than the stack allows",
        detail: { limit: "cssDepth" },
      });
    }
    throw coerceFailure("str", "CSS selector", e instanceof Error ? e.message : String(e));
  }
  const max = ctx.limits.maxValueBytes;
  const out: Value[] = [];
  let size = 0;
  for (const el of found) {
    const text = render(el, { encodeEntities: "utf8" });
    size += 2 * text.length + 8;
    if (size > max) throw limitFailure("maxValueBytes", max, size, "CSS selector result");
    out.push(str(text));
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive("css", "_select", "( html:str selector:str -- list )", select, {
      doc: "Private. The outer HTML of each element of an HTML document that matches a CSS selector, in document order, as a list of str. The HTML parser repairs bad markup, so no document fails; a selector css-select cannot read is E_COERCE; a selector longer than 4096 characters is E_RANGE; a document nested deeper than 512 levels, with more than 200,000 nodes, or a result past the value limit is E_LIMIT_VALUE.",
    }),
  ),
];
