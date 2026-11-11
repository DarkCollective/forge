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
 * Tests for the `unicode-format` vocabulary (vocab/unicode-format.fth): the combining marks, line breaks and code
 * points above the BMP.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, str } = valueHelpers;
type Result = Awaited<ReturnType<ReturnType<typeof assembleRuntime>["call"]>>;
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const bundle = await loadBundleNode(["unicode-format"]);
const runtime = assembleRuntime(bundle);
const decorate = async (s: string, underline: boolean, strike: boolean) =>
  top(
    await runtime.call("unicode-format:decorate", [str(s), bool(underline), bool(strike)]),
  ) as string;

const U = "̲";
const S = "̶";

describe("catalogue", () => {
  test("unicode-format:decorate is a Language op", () => {
    const op = buildCatalogue(assembleRuntime(bundle)).ops.find(
      (o) => o.qname === "unicode-format:decorate",
    );
    expect(op?.category).toBe("Language");
  });
});

describe("unicode-format:decorate", () => {
  test("underline puts U+0332 after each character", async () => {
    expect(await decorate("abc", true, false)).toBe(`a${U}b${U}c${U}`);
  });

  test("strikethrough puts U+0336 after each character", async () => {
    expect(await decorate("abc", false, true)).toBe(`a${S}b${S}c${S}`);
  });

  test("both: the strikethrough first, as in CyberChef", async () => {
    expect(await decorate("ab", true, true)).toBe(`a${S}${U}b${S}${U}`);
  });

  test("neither leaves the text alone", async () => {
    expect(await decorate("a b\nc", false, false)).toBe("a b\nc");
  });

  test("line breaks are left alone and spaces are decorated", async () => {
    expect(await decorate("a b\nc\r\nd", true, false)).toBe(`a${U} ${U}b${U}\nc${U}\r\nd${U}`);
  });

  test("code points above the BMP get one mark, not one per UTF-16 unit", async () => {
    expect(await decorate("😀a", true, false)).toBe(`😀${U}a${U}`);
    expect(await decorate("\u{10FFFF}", false, true)).toBe(`\u{10FFFF}${S}`);
  });

  test("the empty text, and 64 KiB within the step limit", async () => {
    expect(await decorate("", true, true)).toBe("");
    const big = "x".repeat(60_000);
    const r = await decorate(big, true, true);
    expect(r).toHaveLength(180_000);
    expect(r.startsWith(`x${S}${U}x${S}${U}`)).toBe(true);
  });
});
