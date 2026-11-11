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
 * Tests for the `leet` vocabulary (vocab/leet.fth): both tables, both directions, text that must not change, and the
 * round trip for text the table can carry.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
type Result = Awaited<ReturnType<ReturnType<typeof assembleRuntime>["call"]>>;
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

const bundle = await loadBundleNode(["leet"]);
const runtime = assembleRuntime(bundle);
const convert = async (s: string, direction = "to", style = "basic") =>
  top(await runtime.call("leet:convert", [str(s), str(direction), str(style)])) as string;

describe("catalogue", () => {
  test("leet:convert is a Language op", () => {
    const op = buildCatalogue(assembleRuntime(bundle)).ops.find((o) => o.qname === "leet:convert");
    expect(op?.category).toBe("Language");
  });
});

describe("to leet", () => {
  test("the basic table, in either case", async () => {
    expect(await convert("abegiostz")).toBe("483610572");
    expect(await convert("ABEGIOSTZ")).toBe("483610572");
    expect(await convert("Leet speak")).toBe("L337 5p34k");
    expect(await convert("ELITE")).toBe("3L173");
  });

  test("the extended table", async () => {
    expect(await convert("abegiostzcdhlqx", "to", "extended")).toBe("483610572()#|9%");
    expect(await convert("Hello World", "to", "extended")).toBe("#3||0 W0r|)");
  });

  test("other characters, digits and non-ASCII text are unchanged", async () => {
    expect(await convert("fjkmnpruvwy 0123456789 !?-_ é ü 日本語 😀")).toBe(
      "fjkmnpruvwy 0123456789 !?-_ é ü 日本語 😀",
    );
    expect(await convert("")).toBe("");
  });
});

describe("from leet", () => {
  test("the basic table", async () => {
    expect(await convert("483610572", "from")).toBe("abegiostz");
    expect(await convert("L337 5p34k", "from")).toBe("Leet speak");
  });

  test("the extended table", async () => {
    expect(await convert("483610572()#|9%", "from", "extended")).toBe("abegiostzcdhlqx");
    expect(await convert("#3||0 W0r|)", "from", "extended")).toBe("hello World");
  });

  test("letters and the characters of the other table are unchanged", async () => {
    expect(await convert("abc ()#| 9%", "from")).toBe("abc ()#| 9%");
    expect(await convert("x y z", "from")).toBe("x y z");
  });

  test("every printable ASCII character is read to a single character", async () => {
    let all = "";
    for (let c = 32; c < 127; c++) all += String.fromCharCode(c);
    for (const style of ["basic", "extended"]) {
      expect(await convert(all, "from", style)).toHaveLength(all.length);
      expect(await convert(all, "to", style)).toHaveLength(all.length);
    }
  });

  test("to then from gives lower-case text back when it has no digits or leet symbols", async () => {
    for (const style of ["basic", "extended"]) {
      const text = "the quick brown fox jumps over a lazy dog";
      expect(await convert(await convert(text, "to", style), "from", style)).toBe(text);
    }
  });
});

describe("limits", () => {
  test("64 KiB is within the step limit", async () => {
    const text = "leet speak ".repeat(6000);
    expect(await convert(await convert(text), "from")).toBe(
      text.replace(/./g, (c) => c.toLowerCase()),
    );
  });
});
