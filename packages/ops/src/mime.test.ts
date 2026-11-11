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
 * Tests for the `mime` vocabulary (vocab/mime.fth): `mime:decode`. The op vectors (vocab/mime.test.json) hold the
 * cases computed with Python's email.header; these tests add every character set name the table knows, the
 * behaviour around the words, and the cost at 64 KiB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["mime"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const decode = (text: string) => runtime.call("mime:decode", [str(text)]);

describe("character sets", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../vocab/mime.fth", import.meta.url).href),
    "utf8",
  );
  const table = /"(\|[^"]+\|)" CONSTANT _names/.exec(source)?.[1] ?? "";
  const names = table
    .split("|")
    .filter((n) => n !== "")
    .map((p) => p.split("=") as [string, string]);

  test("the table lists the sets documented", () => {
    expect(names.length).toBeGreaterThanOrEqual(50);
    expect(names.map((n) => n[0])).toContain("iso-8859-1");
    expect(names.map((n) => n[0])).toContain("shift_jis");
  });

  test("every name in the table decodes plain ASCII text, and both cases of the name work", async () => {
    for (const [name] of names) {
      if (name.startsWith("utf-16")) continue; // not ASCII-compatible
      expect(out(await decode(`=?${name}?Q?abc_XYZ?=`)), name).toBe("abc XYZ");
      expect(out(await decode(`=?${name.toUpperCase()}?q?abc?=`)), name).toBe("abc");
    }
  });

  test("UTF-16 words decode from their bytes", async () => {
    expect(out(await decode("=?utf-16le?B?QQBCAA==?="))).toBe("AB");
    expect(out(await decode("=?utf-16be?B?AEEAQg==?="))).toBe("AB");
  });

  test("a name that is not in the table, or has odd characters, is E_COERCE", async () => {
    for (const n of ["iso-8859-9", "iso-8859-11", "x-unknown", "utf-7", "a.b", "a(b"]) {
      expect(code(await decode(`=?${n}?Q?a?=`)), n).toBe("E_COERCE");
    }
  });
});

describe("around the words", () => {
  test("text before, between and after is kept; blank text between two words is not", async () => {
    expect(out(await decode("A =?utf-8?Q?b?= C =?utf-8?Q?d?=  =?utf-8?Q?e?= F"))).toBe(
      "A b C de F",
    );
  });

  test("a tab or a line break between words is blank text too", async () => {
    expect(out(await decode("=?utf-8?Q?a?=\t=?utf-8?Q?b?=\n  =?utf-8?Q?c?="))).toBe("abc");
  });

  test("a word that is not well formed stays as text", async () => {
    for (const t of [
      "=?utf-8?Q?a b?=",
      "=??Q?a?=",
      "=?utf-8??a?=",
      "=?utf-8?Q?a",
      "?=?utf-8?Q?a?",
      "=?utf-8?Qx?a?=",
    ]) {
      expect(out(await decode(t)), t).toBe(t);
    }
  });

  test("Q words: a hex escape in either case, _ for a space, everything else literal", async () => {
    expect(out(await decode("=?utf-8?Q?=c3=A9_x-y.z/1+2?="))).toBe("é x-y.z/1+2");
  });

  test("B words: padding is optional, white space is not part of the word", async () => {
    expect(out(await decode("=?utf-8?B?Q2Fmw6k?="))).toBe("Café");
    expect(out(await decode("=?utf-8?B?Q2Fmw6k=?="))).toBe("Café");
  });

  test("an empty word is empty text", async () => {
    expect(out(await decode("a=?utf-8?Q??=b"))).toBe("ab");
  });

  test("bytes that are not valid in their set are E_COERCE", async () => {
    expect(code(await decode("=?utf-8?B?/w==?="))).toBe("E_COERCE");
  });
});

describe("cost at 64 KiB", () => {
  test("2,800 UTF-8 words in a 64 KB header", { timeout: 60_000 }, async () => {
    const words = Array.from({ length: 2800 }, (_, i) => `=?UTF-8?Q?caf=C3=A9${i}?=`);
    const text = words.join(" ");
    expect(text.length).toBeGreaterThan(60_000);
    const t0 = Date.now();
    const r = await decode(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // measured: about 260 VM steps a word (722,000 for 2,800 words), 10 million is the default limit
    expect(r.steps).toBeLessThan(2_000_000);
    expect(out(r)).toBe(Array.from({ length: 2800 }, (_, i) => `café${i}`).join(""));
    expect(Date.now() - t0).toBeLessThan(20_000);
  });

  test(
    "words in other character sets cost a table lookup each: a few hundred are fine",
    { timeout: 60_000 },
    async () => {
      const text = Array.from({ length: 300 }, () => "=?windows-1252?Q?caf=E9?=").join(" ");
      const r = await decode(text);
      expect(r.ok).toBe(true);
      expect(out(r)).toBe("café".repeat(300));
    },
  );
});
