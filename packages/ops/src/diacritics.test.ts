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
 * Tests for the `diacritics` vocabulary (vocab/diacritics.fth): accents of many scripts, decomposed and precomposed
 * input, the letters with a stroke, text that must not change, and the size limit.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bool, str } = valueHelpers;
type Result = Awaited<ReturnType<ReturnType<typeof assembleRuntime>["call"]>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const bundle = await loadBundleNode(["diacritics"]);
const runtime = assembleRuntime(bundle);
const remove = async (s: string, strokes = true) =>
  top(await runtime.call("diacritics:remove", [str(s), bool(strokes)])) as string;

describe("catalogue", () => {
  test("diacritics:remove is a Language op", () => {
    const op = buildCatalogue(assembleRuntime(bundle)).ops.find(
      (o) => o.qname === "diacritics:remove",
    );
    expect(op?.category).toBe("Language");
  });
});

describe("diacritics:remove", () => {
  test.each([
    ["Crème Brûlée", "Creme Brulee"],
    ["ÀÉÎÕÜ àéîõü ñç ÿ", "AEIOU aeiou nc y"],
    ["Việt Nam", "Viet Nam"],
    ["Zażółć gęślą jaźń", "Zazolc gesla jazn"],
    ["Příliš žluťoučký kůň", "Prilis zlutoucky kun"],
    ["Ελληνικά ά ή ώ", "Ελληνικα α η ω"],
    ["Привет, ёж й", "Привет, еж и"],
    ["Ångström ǖ ǻ ṩ", "Angstrom u a s"],
  ])("%s -> %s", async (input, expected) => {
    expect(await remove(input)).toBe(expected);
  });

  test("a letter and a separate combining mark loses the mark", async () => {
    expect(await remove("é ạ̈ ñ")).toBe("e a n");
    expect(await remove("́")).toBe("");
    expect(await remove("x⃐y᪰z᷀︠")).toBe("xyz");
  });

  test("the letters with a stroke, with and without the option", async () => {
    expect(await remove("Ørsted øre Łódź łąka Đorđe đ Ħamrun ħ Ŧ ŧ ı Ð ð")).toBe(
      "Orsted ore Lodz laka Dorde d Hamrun h T t i D d",
    );
    expect(await remove("Ørsted Łódź ı", false)).toBe("Ørsted Łodz ı");
  });

  test("text without diacritics is unchanged", async () => {
    for (const s of [
      "",
      "plain ASCII 123 !?\n\t",
      "ß æ œ þ Æ Œ",
      "한국어 ガ ぱ ひらがな 日本語",
      "😀 👨‍👩‍👧 ✔",
      "\u{10FFFF}",
      "العربية",
    ]) {
      expect(await remove(s, false)).toBe(s);
    }
  });

  test("64 KiB of accented text is within the step limit", async () => {
    const input = "éàüñ ".repeat(13_000);
    const r = await runtime.call("diacritics:remove", [str(input), bool(true)]);
    expect(code(r)).toBe("ok");
    expect(top(r)).toBe("eaun ".repeat(13_000));
  });
});
