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
import { describe, expect, test } from "vitest";
import { listWords } from "../dictionary.js";
import { createRuntime } from "../runtime.js";
import { PRELUDE_SOURCE, PRELUDE_WORDS } from "./prelude.js";

const rt = createRuntime();

async function go(src: string): Promise<string> {
  const r = await rt.run(src);
  return r.ok ? r.output : `ERR ${r.error.code}: ${r.error.message}`;
}

describe("the prelude", () => {
  test("twenty promoted words, listed, public in core and compiled from FL", () => {
    expect(PRELUDE_WORDS).toHaveLength(20);
    expect(new Set(PRELUDE_WORDS).size).toBe(20);
    const words = new Set(listWords(rt.dictionary, "core"));
    for (const w of PRELUDE_WORDS) {
      expect(words.has(w), w).toBe(true);
      const e = rt.lookup(`core:${w}`);
      expect(e.kind, w).toBe("fl");
      expect(e.vocab).toBe("core");
      expect(e.meta.hash, w).toMatch(/^[0-9a-f]{64}$/);
      expect(e.meta.doc ?? "", w).not.toBe("");
    }
  });

  test("the private helper stays private", () => {
    expect(listWords(rt.dictionary, "core")).not.toContain("_lead-step");
    expect(() => rt.lookup("core:_lead-step")).toThrow();
  });

  test("the source declares exactly the listed words, with the raise calls replaced", () => {
    const defined = [...PRELUDE_SOURCE.matchAll(/^: (\S+) \(/gm)].map((m) => m[1]);
    expect(defined.filter((n) => !(n as string).startsWith("_"))).toEqual([...PRELUDE_WORDS]);
    expect(PRELUDE_SOURCE).not.toMatch(/raise:|util:/);
    expect(PRELUDE_SOURCE).toMatch(/^IN: core$/m);
  });

  test("two runtimes give the same hashes", () => {
    const other = createRuntime();
    for (const w of PRELUDE_WORDS) {
      expect(other.lookup(`core:${w}`).meta.hash).toBe(rt.lookup(`core:${w}`).meta.hash);
    }
  });

  test("the runtime's limits do not apply to the prelude", () => {
    const small = createRuntime({ limits: { maxSourceChars: 3, maxIntBits: 64 } });
    expect(small.lookup("core:between?").kind).toBe("fl");
  });

  test("the prelude does not change the current vocabulary or the user vocabulary", () => {
    const fresh = createRuntime();
    expect(fresh.getScope()).toEqual({ current: "user", using: [] });
    expect(listWords(fresh.dictionary, "user")).toEqual([]);
  });

  test("a user unit cannot define into core", () => {
    expect(() =>
      createRuntime().load(": between? ( -- int ) 1 ;", { scope: { current: "core", using: [] } }),
    ).toThrow(expect.objectContaining({ code: "E_READONLY" }));
  });
});

describe("behaviour of the promoted words", () => {
  test("C283 promoted words behave as their util twins", async () => {
    expect(
      await go(
        [
          "5 1 10 between? . 11 1 10 between? .",
          '"abc" "ab" starts-with? . "abc" "bc" ends-with? .',
          "255 4 pad-hex .",
          `"xxab" [ 'x' = ] trim-start .`,
          "{ 1 2 3 } sum . 7 2 ceil-div .",
        ].join("\n"),
      ),
    ).toBe("true\nfalse\ntrue\ntrue\n00ff\nab\n6\n4\n");
  });

  test("C284 check-int-range raises E_RANGE with the documented message", async () => {
    expect(await go('12 0 9 "the level" check-int-range')).toBe(
      "ERR E_RANGE: the level must be 0 to 9, not 12",
    );
    expect(await go('5 0 9 "the level" check-int-range')).toBe("");
  });

  test("C285 a vocabulary's own word shadows a promoted word", async () => {
    const r = createRuntime();
    r.load("IN: demo\n: between? ( n:int -- bool ) n 0 > ;\n: t ( -- bool ) 5 between? ;");
    const out = await r.run("demo:t .");
    expect(out.ok && out.output).toBe("true\n");
  });

  test("an import wins over a promoted word", async () => {
    const r = createRuntime();
    r.load('IN: other\n: sum ( -- str ) "imported" ;');
    const out = await r.run("USING: other ;\nsum .");
    expect(out.ok && out.output).toBe("imported\n");
  });

  test("the other promoted words", async () => {
    expect(await go("65 cp>str . 0x1F600 cp>str len .")).toBe("A\n1\n");
    expect(await go("258 3 int>be-bytes bytes>hex .")).toBe("000102\n");
    expect(await go("9 space? . 32 space? . 65 space? .")).toBe("true\ntrue\nfalse\n");
    expect(await go('"ab" 3 repeat-str . "ab" 0 repeat-str len .')).toBe("ababab\n0\n");
    expect(await go("#[ 01 02 03 ] 10 digits>int .")).toBe("123\n");
    expect(await go("{ 1 2 3 } 2 contains? . { 1 2 3 } 4 contains? .")).toBe("true\nfalse\n");
    expect(await go('" a b\\t" strip-space .')).toBe("ab\n");
    expect(await go(`"abxx" [ 'x' = ] trim-end .`)).toBe("ab\n");
    expect(await go("3 zero-bytes bytes>hex .")).toBe("000000\n");
    expect(await go("{ 1 1 2 1 } [ 1 = ] count-leading .")).toBe("2\n");
    expect(await go("48 dec-digit? . 58 dec-digit? . 70 hex-digit? . 71 hex-digit? .")).toBe(
      "true\nfalse\ntrue\nfalse\n",
    );
  });
});
