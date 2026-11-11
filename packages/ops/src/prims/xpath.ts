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
 * xpath primitive: the XPath 1.0 engine behind `xpath:query`. The libraries are the ones CyberChef uses:
 * `@xmldom/xmldom` (MIT, an XML parser that needs no browser DOMParser, which a Worker does not have) and `xpath`
 * (MIT, by Cameron McCormack and Yaron Naveh), both imported here only, both synchronous, with no `eval` and no
 * `Function`. xmldom reads no external entity and does not expand the entities a document type declares
 * (an entity it does not know is reported and kept as text), so there is no entity bomb to bound.
 *
 *  - `_query ( xml:str expression:str -- list )`: the result of the expression over the document, as a list of
 *    str: for a node set the serialisation of each node in document order (an element as markup, an attribute as
 *    name="value", a text node as its escaped text), for a number, a string or a boolean the one text of the value
 *    (3, abc, true). Names with no prefix match any namespace, as CyberChef does (`allowAnyNamespaceForNoPrefix`).
 *    A document that is not well formed is E_COERCE with the parser's message (and position); a bad expression is
 *    E_COERCE.
 *
 * Bounds. The expression is held to 4,096 characters (E_RANGE). The parsed document is walked once without
 * recursion before the query: more than 512 levels of elements (xpath is quadratic in the depth: 5,000 levels cost
 * seconds, 20,000 a minute) or more than 200,000 nodes is E_LIMIT_VALUE, and the output is held to
 * `ctx.limits.maxValueBytes` while it grows. Evaluation itself cannot be interrupted from here and an expression
 * can multiply (`//a/ancestor::*` followed by `/descendant::*` over a few thousand nodes took ten seconds at
 * 64 KiB), so the primitive is marked for the bake's hard kill, like the regex words.
 */
import { ForgeError, definePrimitive, valueHelpers } from "@forge/lang";
import type { PrimitiveContext, PrimitiveDef, Value } from "@forge/lang";
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { MAX_DEPTH } from "../json-js.js";
import { coerceFailure, limitFailure, rangeFailure } from "../prim-util.js";
import { markRegexPrimitive } from "../regex-engine.js";

const { str } = valueHelpers;

/** The longest expression accepted, in characters. */
export const MAX_EXPRESSION = 4096;
/** The most nodes (of any kind, attributes excluded) a document may hold. */
export const MAX_NODES = 200_000;

interface XmlNode {
  firstChild: XmlNode | null;
  nextSibling: XmlNode | null;
  nodeType: number;
  toString(): string;
}

/** Walks a parsed document without recursion; E_LIMIT_VALUE past the depth and node limits. */
function checkTree(root: XmlNode): void {
  let nodes = 0;
  const stack: { node: XmlNode; depth: number }[] = [];
  for (let c = root.firstChild; c !== null; c = c.nextSibling) stack.push({ node: c, depth: 1 });
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: XmlNode; depth: number };
    if (++nodes > MAX_NODES) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `the XML document has more than ${MAX_NODES} nodes`,
        detail: { limit: "xmlNodes", max: MAX_NODES },
      });
    }
    if (depth > MAX_DEPTH && node.nodeType === 1) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: `the XML document is nested deeper than ${MAX_DEPTH} levels`,
        detail: { limit: "xmlDepth", max: MAX_DEPTH },
      });
    }
    for (let c = node.firstChild; c !== null; c = c.nextSibling)
      stack.push({ node: c, depth: depth + 1 });
  }
}

interface Evaluated {
  toArray?: () => XmlNode[];
  stringValue(): string;
}

function parseXml(xml: string): XmlNode {
  try {
    const doc = new DOMParser({ onError: () => undefined }).parseFromString(xml, "application/xml");
    return doc as unknown as XmlNode;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const first = message.split("\n")[0] ?? message;
    const loc = (e as { locator?: { lineNumber?: number; columnNumber?: number } }).locator;
    const where =
      loc !== undefined && typeof loc.lineNumber === "number"
        ? ` (line ${loc.lineNumber}, column ${String(loc.columnNumber)})`
        : "";
    throw coerceFailure("str", "XML document", `${first}${where}`);
  }
}

function query(xml: string, expression: string, ctx: PrimitiveContext): Value[] {
  if (expression.length > MAX_EXPRESSION) {
    throw rangeFailure(`the XPath expression is longer than ${MAX_EXPRESSION} characters`, {
      length: expression.length,
    });
  }
  const doc = parseXml(xml);
  checkTree(doc);
  let result: Evaluated;
  try {
    const compiled = (
      xpath as unknown as {
        parse(e: string): { evaluate(o: object): Evaluated };
      }
    ).parse(expression);
    result = compiled.evaluate({ node: doc, allowAnyNamespaceForNoPrefix: true });
  } catch (e) {
    if (e instanceof RangeError) {
      throw new ForgeError({
        code: "E_LIMIT_VALUE",
        message: "the XPath expression went deeper than the stack allows",
        detail: { limit: "xpathDepth" },
      });
    }
    const message = e instanceof Error ? e.message : String(e);
    throw coerceFailure("str", "XPath expression", message);
  }
  const max = ctx.limits.maxValueBytes;
  if (typeof result.toArray !== "function") return [str(result.stringValue())];
  const out: Value[] = [];
  let size = 0;
  for (const node of result.toArray()) {
    // an attribute is serialised with a leading space; the result is name="value"
    const text = node.nodeType === 2 ? node.toString().trimStart() : node.toString();
    size += 2 * text.length + 8;
    if (size > max) throw limitFailure("maxValueBytes", max, size, "XPath result");
    out.push(str(text));
  }
  return out;
}

export const primitives: readonly PrimitiveDef[] = [
  markRegexPrimitive(
    definePrimitive("xpath", "_query", "( xml:str expression:str -- list )", query, {
      doc: "Private. The result of an XPath 1.0 expression over an XML document as a list of str: the serialisation of each selected node in document order, or the one text of a number, string or boolean result. A document that is not well formed or a bad expression is E_COERCE; an expression longer than 4096 characters is E_RANGE; a document nested deeper than 512 levels, with more than 200,000 nodes, or a result past the value limit is E_LIMIT_VALUE.",
    }),
  ),
];
