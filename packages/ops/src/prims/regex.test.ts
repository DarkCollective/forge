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
import { valueHelpers } from "@forge/lang";
import type { RunResult, Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "../bundle.js";
import { isRegexPrimitive, REGEX_LIMITS } from "../regex-engine.js";
import { loadBundleNode } from "../sources-node.js";
import { primitives } from "./regex.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["regex"]));

function toJson(v: Value): unknown {
  switch (v.tag) {
    case "list":
      return v.v.map(toJson);
    case "record":
      return Object.fromEntries([...v.v].map(([k, x]) => [k, toJson(x)]));
    case "str":
    case "bool":
    case "int":
      return v.v;
    default:
      throw new Error(`unexpected ${v.tag}`);
  }
}

async function run(name: string, ...args: string[]): Promise<RunResult> {
  return runtime.call(`regex:${name}`, args.map(str));
}
async function result(name: string, ...args: string[]): Promise<unknown> {
  const r = await run(name, ...args);
  if (!r.ok) throw r.error;
  return toJson(r.stack[r.stack.length - 1] as Value);
}
async function failure(name: string, ...args: string[]) {
  const r = await run(name, ...args);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

describe("regex:test", () => {
  test("RECIPES 4.2: an unanchored search, flags", async () => {
    expect(await result("test", "Hello", "^h", "")).toBe(false);
    expect(await result("test", "Hello", "^h", "i")).toBe(true);
    expect(await result("test", "a\nb", "^b", "m")).toBe(true);
    expect(await result("test", "xay", "a", "")).toBe(true);
  });

  test("flags outside ims are rejected by the declared constraint", async () => {
    expect((await failure("test", "a", "a", "g")).code).toBe("E_PARAM_INVALID");
    expect((await failure("test", "a", "a", "iiii")).code).toBe("E_PARAM_INVALID");
    expect((await failure("test", "a", "(", "")).code).toBe("E_PARAM_INVALID");
  });
});

describe("regex:find-all", () => {
  test("RECIPES 4.2: records with code point offsets", async () => {
    expect(await result("find-all", "a1b22", "\\d+", "")).toEqual([
      { start: 1, end: 2, text: "1", groups: [] },
      { start: 3, end: 5, text: "22", groups: [] },
    ]);
  });

  test("RECIPES 4.2: offsets are code points, not UTF-16 units", async () => {
    expect(await result("find-all", "😀a1", "\\d", "")).toEqual([
      { start: 2, end: 3, text: "1", groups: [] },
    ]);
  });

  test("the record keys are in the documented order", async () => {
    const r = await run("find-all", "a", "a", "");
    if (!r.ok) throw r.error;
    const item = (r.stack[0] as { v: readonly { v: ReadonlyMap<string, Value> }[] }).v[0];
    expect([...(item as { v: ReadonlyMap<string, Value> }).v.keys()]).toEqual([
      "start",
      "end",
      "text",
      "groups",
    ]);
  });

  test("groups: a group that did not take part is the empty string", async () => {
    expect(await result("find-all", "b", "(a)|(b)", "")).toEqual([
      { start: 0, end: 1, text: "b", groups: ["", "b"] },
    ]);
  });

  test("empty matches are included, with one-pass offsets across astral characters", async () => {
    expect(await result("find-all", "😀b", "x*", "")).toEqual([
      { start: 0, end: 0, text: "", groups: [] },
      { start: 1, end: 1, text: "", groups: [] },
      { start: 2, end: 2, text: "", groups: [] },
    ]);
    expect(await result("find-all", "a😀😀b", "😀+", "")).toEqual([
      { start: 1, end: 3, text: "😀😀", groups: [] },
    ]);
  });

  test("no match is the empty list", async () => {
    expect(await result("find-all", "abc", "\\d", "")).toEqual([]);
  });

  test("a result over maxValueBytes is E_LIMIT_VALUE before it is built", async () => {
    const small = assembleRuntime(await loadBundleNode(["regex"]), {
      limits: { maxValueBytes: 200 },
    });
    const ok = await small.call("regex:find-all", [str("ab"), str("a"), str("")]);
    expect(ok.ok).toBe(true);
    const r = await small.call("regex:find-all", [str("a".repeat(50)), str("a"), str("")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_LIMIT_VALUE");
      expect(r.error.detail.limit).toBe("maxValueBytes");
    }
  });

  test("more than the maximum number of matches is E_LIMIT_VALUE regexMatches", async () => {
    const e = await failure("find-all", "a".repeat(REGEX_LIMITS.maxMatches + 1), "a", "");
    expect(e.code).toBe("E_LIMIT_VALUE");
    expect(e.detail.limit).toBe("regexMatches");
  });

  test("input over the limit is E_LIMIT_VALUE regexInput", async () => {
    const e = await failure("find-all", "a".repeat(REGEX_LIMITS.maxInputChars + 1), "b", "");
    expect(e.detail.limit).toBe("regexInput");
  });

  test("a large text is handled in one pass", async () => {
    const text = "😀a".repeat(30_000);
    const r = await run("find-all", text, "a", "");
    if (!r.ok) throw r.error;
    const items = (r.stack[0] as { v: readonly Value[] }).v;
    expect(items).toHaveLength(30_000);
    const last = toJson(items[29_999] as Value) as { start: number };
    expect(last.start).toBe(59_999);
  });
});

describe("regex:replace", () => {
  test("RECIPES 4.2: numbered groups", async () => {
    expect(await result("replace", "John Smith", "(\\w+) (\\w+)", "$2, $1", "")).toBe(
      "Smith, John",
    );
  });

  test("RECIPES 4.2: named groups, $& and $$", async () => {
    expect(await result("replace", "a-b", "(?<x>-)", "[$<x>$&$$]", "")).toBe("a[--$]b");
  });

  test("$` and $' are the text before and after the match", async () => {
    expect(await result("replace", "abc", "b", "[$`|$']", "")).toBe("a[a|c]c");
  });

  test("a group number above the group count is literal; two digits fall back to one", async () => {
    expect(await result("replace", "ab", "(a)", "$2", "")).toBe("$2b");
    expect(await result("replace", "ab", "(a)", "$10", "")).toBe("a0b");
    expect(await result("replace", "ab", "(a)", "$01", "")).toBe("ab");
    expect(await result("replace", "ab", "(a)", "$00", "")).toBe("$00b");
    expect(await result("replace", "ab", "(a)", "$0", "")).toBe("$0b");
    expect(
      await result("replace", "abcdefghijk", "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)", "$11", ""),
    ).toBe("k");
  });

  test("an unmatched group and an unknown name are the empty string", async () => {
    expect(await result("replace", "b", "(a)?b", "[$1]", "")).toBe("[]");
    expect(await result("replace", "b", "(?<x>a)?b", "[$<x>$<nope>]", "")).toBe("[]");
  });

  test("$< is literal without named groups or without a closing >", async () => {
    expect(await result("replace", "a", "a", "$<x>", "")).toBe("$<x>");
    expect(await result("replace", "a", "(?<x>a)", "$<x", "")).toBe("$<x");
  });

  test("a lone or unknown $ is literal", async () => {
    expect(await result("replace", "a", "a", "$", "")).toBe("$");
    expect(await result("replace", "a", "a", "$z", "")).toBe("$z");
    expect(await result("replace", "a", "a", "x$", "")).toBe("x$");
  });

  test("replaces every match, honouring flags; empty matches are replaced too", async () => {
    expect(await result("replace", "aAa", "a", "x", "i")).toBe("xxx");
    expect(await result("replace", "abc", "x*", "-", "")).toBe("-a-b-c-");
    expect(await result("replace", "abc", "z", "-", "")).toBe("abc");
    expect(await result("replace", "", "", "-", "")).toBe("-");
  });

  test("a replacement without $ is used as is", async () => {
    expect(await result("replace", "aXa", "X", "\\n", "")).toBe("a\\na");
  });

  test("a result over maxValueBytes is E_LIMIT_VALUE while accumulating", async () => {
    const small = assembleRuntime(await loadBundleNode(["regex"]), {
      limits: { maxValueBytes: 100 },
    });
    const r = await small.call("regex:replace", [
      str("aaaaaaaaaa"),
      str("a"),
      str("$&$&$&$&$&$&"),
      str(""),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail.limit).toBe("maxValueBytes");
  });
});

describe("regex:split", () => {
  test("RECIPES 4.2", async () => {
    expect(await result("split", "a1b22c", "\\d+", "")).toEqual(["a", "b", "c"]);
    expect(await result("split", "a,b,,c", ",", "")).toEqual(["a", "b", "", "c"]);
    expect(await result("split", "abc", "x*", "")).toEqual(["abc"]);
  });

  test("like split: empty input, a match at the end", async () => {
    expect(await result("split", "", ",", "")).toEqual([""]);
    expect(await result("split", "a,", ",", "")).toEqual(["a", ""]);
    expect(await result("split", ",a", ",", "")).toEqual(["", "a"]);
  });

  test("capture groups are not included", async () => {
    expect(await result("split", "a-b", "(-)", "")).toEqual(["a", "b"]);
  });

  test("a result over maxValueBytes is E_LIMIT_VALUE", async () => {
    const small = assembleRuntime(await loadBundleNode(["regex"]), {
      limits: { maxValueBytes: 100 },
    });
    const r = await small.call("regex:split", [str("a,".repeat(40)), str(","), str("")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail.limit).toBe("maxValueBytes");
  });
});

describe("module", () => {
  test("four words, each marked as a regex-engine primitive, with doc and category", () => {
    expect(primitives.map((p) => `${p.vocab}:${p.name}`)).toEqual([
      "regex:test",
      "regex:find-all",
      "regex:replace",
      "regex:split",
    ]);
    for (const p of primitives) {
      expect(isRegexPrimitive(`${p.vocab}:${p.name}`)).toBe(true);
      expect(p.doc).toBeTruthy();
      expect(p.category).toBe("Regular expressions");
    }
  });

  test("the declared effects are the documented ones", () => {
    expect(runtime.meta("regex:test").effect.text).toBe(
      '( str pattern:regex flags:str[0..3,/[ims]*/]="" -- bool )',
    );
    expect(runtime.meta("regex:replace").effect.text).toBe(
      '( str pattern:regex replacement:str flags:str[0..3,/[ims]*/]="" -- str )',
    );
    expect(runtime.meta("regex:find-all").effect.outputs[0]?.type).toBe("list");
    expect(runtime.meta("regex:split").effect.outputs[0]?.type).toBe("list");
  });

  test("the parameter help comes from vocab/regex.fth", () => {
    for (const name of ["test", "find-all", "replace", "split"]) {
      const meta = runtime.meta(`regex:${name}`);
      expect(meta.params.every((p) => typeof p.doc === "string")).toBe(true);
    }
  });
});
