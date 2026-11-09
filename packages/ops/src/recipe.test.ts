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
 * RECIPES.md section 12.1 and 12.2 (the parts that belong to ops): the container words of the internal
 * `recipe` vocabulary and the compiled-unit layout, run on a real runtime. The compiler itself is
 * @forge/recipe; these tests load the compiled text the spec gives.
 */
import { valueHelpers } from "@forge/lang";
import type { ForgeRuntime, RunResult, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { buildCatalogue } from "./catalogue.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Loads a compiled recipe unit into the internal `bake` vocabulary, as the Baker does. */
function loadUnit(rt: ForgeRuntime, text: string): void {
  rt.setCurrentVocab("bake");
  rt.setCurrentVocab("user");
  rt.load(text, { unit: "recipe", scope: { current: "bake", using: [] } });
}

async function bake(text: string, input: Uint8Array): Promise<RunResult> {
  const rt = assembleRuntime(await loadBundleNode("all"));
  loadUnit(rt, text);
  return rt.call("bake:main", [bytes(input)]);
}

function unit(body: string): string {
  return `\\ forge-recipe 1\n: main ( bytes -- any )\n  ${body}\n;\n`;
}

function top(r: RunResult): Value {
  if (!r.ok) throw r.error;
  return r.stack[r.stack.length - 1] as Value;
}

describe("12.1 the Gate recipe", () => {
  const GATE = unit('"standard" base64:decode\n  13 classical:rot\n  "none" "lower" hex:encode');

  test("bakes the Gate input to the Gate output", async () => {
    const r = await bake(GATE, ascii("VXJ5eWIsIEpiZXlxIQ=="));
    expect(top(r)).toEqual({ tag: "str", v: "48656c6c6f2c20576f726c6421" });
    expect(r.stack).toHaveLength(1);
  });

  test("the compiled word has the documented ranges", async () => {
    const rt = assembleRuntime(await loadBundleNode("all"));
    loadUnit(rt, GATE);
    const entry = rt.lookup("bake:main");
    if (entry.kind !== "fl" || entry.code === null) throw new Error("not compiled");
    const ops = entry.code.code.map((i) =>
      i.op === "prim" || i.op === "call" ? `${i.op} ${i.entry.qname}` : i.op,
    );
    expect(ops).toEqual([
      "lit",
      "prim base64:decode",
      "lit",
      "call classical:rot",
      "lit",
      "lit",
      "prim hex:encode",
      "ret",
    ]);
    expect(entry.code.positions.map((p) => p.line)).toEqual([3, 3, 4, 4, 5, 5, 5, 6]);
  });
});

describe("12.1 container words", () => {
  const REPLACE = (from: string, to: string) => `"${from}" "${to}" "" regex:replace`;

  test("recipe:section runs the body only on the matches", async () => {
    const text = unit(`recipe:as-bytes "[a-c]+" "" "utf8" [ ${REPLACE("b", "X")} ] recipe:section`);
    const r = await bake(text, ascii("abc-def-cab"));
    expect(top(r)).toEqual({ tag: "bytes", v: ascii("aXc-def-caX") });
  });

  test("recipe:section reads latin1 data and leaves invalid UTF-8 outside the matches", async () => {
    const text = unit(
      `recipe:as-bytes "[a-c]+" "" "latin1" [ ${REPLACE("b", "X")} ] recipe:section`,
    );
    const r = await bake(text, Uint8Array.of(0xff, 0x61, 0x62, 0xfe));
    expect(top(r)).toEqual({ tag: "bytes", v: Uint8Array.of(0xff, 0x61, 0x58, 0xfe) });
  });

  test("recipe:section skips empty matches and passes through when nothing matches", async () => {
    const calls = unit(`recipe:as-bytes "x*" "" "utf8" [ ${REPLACE("a", "b")} ] recipe:section`);
    expect(top(await bake(calls, ascii("aaa")))).toEqual({ tag: "bytes", v: ascii("aaa") });
  });

  test("recipe:section with invalid UTF-8 is E_COERCE", async () => {
    const text = unit(`recipe:as-bytes "a" "" "utf8" [ ] recipe:section`);
    const r = await bake(text, Uint8Array.of(0xff));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_COERCE");
  });

  test("recipe:settle stops when the result equals its input", async () => {
    const text = unit(`recipe:as-bytes 10 [ ${REPLACE("aa", "a")} ] recipe:settle`);
    expect(top(await bake(text, ascii("aaaaaaaa")))).toEqual({ tag: "bytes", v: ascii("a") });
  });

  test("recipe:settle stops at the cap", async () => {
    const text = unit(`recipe:as-bytes 2 [ ${REPLACE("aa", "a")} ] recipe:settle`);
    expect(top(await bake(text, ascii("aaaaaaaa")))).toEqual({ tag: "bytes", v: ascii("aa") });
  });

  test("recipe:settle with a cap of 1 runs the body once", async () => {
    const text = unit(`recipe:as-bytes 1 [ ${REPLACE("aa", "a")} ] recipe:settle`);
    expect(top(await bake(text, ascii("aaaaaaaa")))).toEqual({ tag: "bytes", v: ascii("aaaa") });
    expect(top(await bake(text, ascii("b")))).toEqual({ tag: "bytes", v: ascii("b") });
  });

  test("recipe:repeat runs the body n times", async () => {
    const text = unit(`recipe:as-bytes 3 [ ${REPLACE("aa", "a")} ] recipe:repeat`);
    expect(top(await bake(text, ascii("aaaaaaaa")))).toEqual({ tag: "bytes", v: ascii("a") });
  });

  test("recipe:branch takes then when the test passes (and returns what the branch returns)", async () => {
    const text = unit(
      `recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [ ${REPLACE("b", "B")} ] [ ] recipe:branch`,
    );
    expect(top(await bake(text, ascii("abc")))).toEqual({ tag: "str", v: "aBc" });
  });

  test("recipe:branch takes else otherwise", async () => {
    const text = unit(
      `recipe:as-bytes [ "^a" "" "utf8" recipe:matches ] [ ${REPLACE("b", "B")} ] [ ] recipe:branch`,
    );
    expect(top(await bake(text, ascii("xbc")))).toEqual({ tag: "bytes", v: ascii("xbc") });
  });

  test("recipe:matches reads latin1 data", async () => {
    const text = unit(`recipe:as-bytes [ "^ÿ" "" "latin1" recipe:matches ] [ ] [ ] recipe:branch`);
    const r = await bake(text, Uint8Array.of(0xff));
    expect(top(r)).toEqual({ tag: "bytes", v: Uint8Array.of(0xff) });
  });

  test("fork: the second piece is not UTF-8, so text:upper fails with E_COERCE (12.1 and 12.6)", async () => {
    const text = unit('hex:decode\n  recipe:as-bytes "\\n" "\\n" [\n    text:upper\n  ] fork');
    const r = await bake(text, ascii("610a62ff0a63"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_COERCE");
      expect(r.error.word).toBe("text:upper");
      expect(r.error.frames).toEqual([
        { word: "bake:main", ip: 5 },
        { word: "bake:main", ip: 7 },
        { word: "<console>", ip: 0 },
      ]);
    }
  });

  test("12.6: a str input to text:upper is coerced and recorded", async () => {
    const text = unit("hex:decode\n  text:upper");
    const r = await bake(text, ascii("6162"));
    expect(top(r)).toEqual({ tag: "str", v: "AB" });
    expect(r.coercions.map((c) => [c.word, c.from, c.to])).toEqual([
      ["text:upper", "bytes", "str"],
    ]);
  });

  test("as-bytes rejects a value that is neither bytes nor str", async () => {
    const rt = assembleRuntime(await loadBundleNode("all"));
    const r = await rt.call("recipe:as-bytes", [{ tag: "int", v: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_TYPE");
  });

  test("the literal helpers", async () => {
    const rt = assembleRuntime(await loadBundleNode("all"));
    const latin = await rt.call("recipe:latin1", [{ tag: "str", v: "hé" }]);
    expect(top(latin)).toEqual({ tag: "bytes", v: Uint8Array.of(0x68, 0xe9) });
    const b64 = await rt.call("recipe:base64", [{ tag: "str", v: "3q2+7w==" }]);
    expect(top(b64)).toEqual({ tag: "bytes", v: Uint8Array.of(0xde, 0xad, 0xbe, 0xef) });
  });
});

describe("12.2 a recipe that uses every step kind", () => {
  const TEXT = [
    "\\ forge-recipe 1",
    '\\ name "Demo"',
    ": main ( bytes -- any )",
    '  "standard" base64:decode',
    '  \\ # "split into lines"',
    '  recipe:as-bytes "\\n" #[ 0a ] [',
    "    13 classical:rot  \\ @break",
    '    \\ ~ text:upper  \\ @note="off for now"',
    "  ] fork",
    '  recipe:as-bytes "[a-z]+" "i" "utf8" [',
    "    text:reverse",
    "  ] recipe:section",
    '  recipe:as-bytes [ "^o" "" "utf8" recipe:matches ] [',
    "    text:lower",
    "  ] [",
    "  ] recipe:branch",
    "  recipe:as-bytes 100 [",
    '    "aa" "a" "" regex:replace',
    "  ] recipe:settle",
    '  "space" "lower" hex:encode',
    ";",
    "",
  ].join("\n");

  test("bakes to the documented output", async () => {
    const r = await bake(TEXT, ascii("VXJ5eWIKSmJleXE="));
    expect(top(r)).toEqual({ tag: "str", v: "6f 6c 6c 65 68 0a 64 6c 72 6f 77" });
  });

  test("the loaded word has 44 instructions and the documented ranges", async () => {
    const rt = assembleRuntime(await loadBundleNode("all"));
    loadUnit(rt, TEXT);
    const entry = rt.lookup("bake:main");
    if (entry.kind !== "fl" || entry.code === null) throw new Error("not compiled");
    const { code, positions } = entry.code;
    expect(code).toHaveLength(44);
    expect(code[43]?.op).toBe("ret");

    // resolveStepIps (RECIPES 5.5): the first instruction at or after a line, and after a line
    const startIp = (line: number) => positions.findIndex((p) => p.line >= line);
    const endIp = (line: number) => {
      const i = positions.findIndex((p) => p.line > line);
      return i < 0 ? code.length : i;
    };
    const steps: [string, number, number, number, number][] = [
      ["/steps/0", 4, 4, 0, 2],
      ["/steps/2", 6, 9, 2, 10],
      ["/steps/2/steps/0", 7, 7, 6, 8],
      ["/steps/3", 10, 12, 10, 18],
      ["/steps/3/steps/0", 11, 11, 15, 16],
      ["/steps/4", 13, 16, 18, 31],
      ["/steps/4/then/0", 14, 14, 26, 27],
      ["/steps/5", 17, 19, 31, 40],
      ["/steps/5/steps/0", 18, 18, 34, 38],
      ["/steps/6", 20, 20, 40, 43],
    ];
    for (const [path, first, last, from, to] of steps) {
      expect([path, startIp(first), endIp(last)]).toEqual([path, from, to]);
    }
  });
});

describe("recipe vocabulary is internal", () => {
  test("none of its words, nor bake:main, is in the catalogue", async () => {
    const rt = assembleRuntime(await loadBundleNode("all"));
    loadUnit(rt, unit("13 classical:rot"));
    const names = buildCatalogue(rt).ops.map((op) => op.qname);
    expect(names.some((n) => n.startsWith("recipe:") || n.startsWith("bake:"))).toBe(false);
  });
});
