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
/**
 * Tests of the collectors, `cond`, `case`, `sort-by`, `find`, `any?` and `all?`
 * (LANGUAGE-0.2.md sections 10 and 11; WP 6.8).
 */
import { describe, expect, test } from "vitest";
import type { ForgeError } from "./errors.js";
import { createRuntime } from "./runtime.js";
import type { RunOptions, RunResult } from "./types.js";

async function out(src: string, opts: RunOptions = {}): Promise<string> {
  const r = await createRuntime().run(src, opts);
  if (!r.ok) throw r.error;
  return r.output;
}

async function fail(src: string, opts: RunOptions = {}): Promise<ForgeError> {
  const r: RunResult = await createRuntime().run(src, opts);
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r.output)}`);
  return r.error as ForgeError;
}

async function steps(src: string): Promise<number> {
  const r = await createRuntime().run(src);
  if (!r.ok) throw r.error;
  return r.steps;
}

describe("collect, collect-bytes, collect-str", () => {
  test("build a list, bytes and a string", async () => {
    expect(await out("[ 1 emit { 2 3 } emit-all ] collect .")).toBe("{ 1 2 3 }\n");
    expect(await out("[ 255 emit #[ 01 ] emit-all ] collect-bytes .")).toBe("#[ ff 01 ]\n");
    expect(await out('[ 104 emit "i" emit-all 128512 emit ] collect-str len .')).toBe("3\n");
    expect(await out("[ ] collect . [ ] collect-bytes . [ ] collect-str len .")).toBe(
      "{ }\n#[ ]\n0\n",
    );
  });

  test("bytes beyond the first buffer grow", async () => {
    expect(await out("[ 300 [ 7 emit ] times ] collect-bytes len .")).toBe("300\n");
    expect(await out("[ 0 200 range [ emit ] each 200 [ 1 emit ] times ] collect len .")).toBe(
      "400\n",
    );
  });

  test("element kinds: E_TYPE for a wrong tag, E_RANGE for a bad number", async () => {
    expect((await fail("[ 1 emit-all ] collect")).code).toBe("E_TYPE");
    expect((await fail('[ "a" emit ] collect-bytes')).code).toBe("E_TYPE");
    expect((await fail("[ 256 emit ] collect-bytes")).code).toBe("E_RANGE");
    expect((await fail("[ -1 emit ] collect-bytes")).code).toBe("E_RANGE");
    expect((await fail("[ { 1 } emit-all ] collect-bytes")).code).toBe("E_TYPE");
    expect((await fail('[ "a" emit ] collect-str')).code).toBe("E_TYPE");
    expect((await fail("[ 55296 emit ] collect-str")).code).toBe("E_RANGE");
    expect((await fail("[ 1114112 emit ] collect-str")).code).toBe("E_RANGE");
    expect((await fail("[ #[ 01 ] emit-all ] collect-str")).code).toBe("E_TYPE");
  });

  test("emit outside a collector is E_EFFECT with a reason; so is one after the collector ended", async () => {
    const e = await fail("1 emit");
    expect(e.code).toBe("E_EFFECT");
    expect(e.detail["reason"]).toBe("emit outside collect");
    expect((await fail("{ 1 } emit-all")).code).toBe("E_EFFECT");
    expect((await fail("[ ] collect drop 1 emit")).code).toBe("E_EFFECT");
  });

  test("emit with an empty stack is an underflow", async () => {
    expect((await fail("[ emit ] collect")).code).toBe("E_STACK_UNDERFLOW");
  });

  test("the body must be stack-neutral", async () => {
    expect((await fail("[ 1 ] collect")).code).toBe("E_EFFECT");
    expect((await fail("1 [ drop ] collect")).code).toBe("E_EFFECT");
  });

  test("the innermost collector gets the element, also across words and escaped quotations", async () => {
    const src = `
      : two ( int -- ) dup emit 2 * emit ;
      [ 1 two [ 5 two ] collect emit ] collect .`;
    expect(await out(src)).toBe("{ 1 2 { 5 10 } }\n");
    // A quotation made inside one collector and called inside another emits into the second.
    const esc = "[ [ 7 emit ] ] collect-bytes drop [ ] collect drop";
    expect((await fail(`[ 7 emit ] ${esc}`)).code).toBe("E_EFFECT");
    expect(await out(": f ( -- list ) [ 7 emit ] :> q [ q call ] collect ; f .")).toBe("{ 7 }\n");
  });

  test("a try that catches an error inside a collector discards it and the outer one stays active", async () => {
    const src = `[ 1 emit [ [ 2 emit "boom" fail ] collect drop ] [ drop 3 emit ] try 4 emit ] collect .`;
    expect(await out(src)).toBe("{ 1 3 4 }\n");
    expect((await fail('[ [ 1 emit "boom" fail ] collect drop ] [ drop 2 emit ] try')).code).toBe(
      "E_EFFECT",
    );
  });

  test("a collector frame counts toward maxReturnDepth", async () => {
    const nested = "[ [ [ [ 1 emit ] collect drop ] collect drop ] collect drop ] collect";
    const e = await fail(nested, { limits: { maxReturnDepth: 4 } });
    expect(e.code).toBe("E_LIMIT_RETURN");
    expect(await out(nested + " .", { limits: { maxReturnDepth: 64 } })).toBe("{ }\n");
  });

  test("maxValueBytes is enforced as the collector grows, before the copy of emit-all", async () => {
    const lim = { limits: { maxValueBytes: 1000 } };
    expect((await fail("[ 1000 [ 1 emit ] times ] collect", lim)).code).toBe("E_LIMIT_VALUE");
    expect((await fail("[ 2000 [ 1 emit ] times ] collect-bytes", lim)).code).toBe("E_LIMIT_VALUE");
    expect((await fail("[ 600 [ 97 emit ] times ] collect-str", lim)).code).toBe("E_LIMIT_VALUE");
    expect(
      (await fail("[ 0 400 range emit-all ] collect", { limits: { maxValueBytes: 4000 } })).code,
    ).toBe("E_LIMIT_VALUE");
  });

  test("the result is metered once: 4,000 small lists flatten within a small total budget", async () => {
    const limits = { maxTotalBytes: 4_000_000, maxSteps: 1e9 };
    const defs = `
      : lists ( -- list ) 0 4000 range [ :> i { i i } ] map ;
      : flat1 ( -- list ) lists :> ll [ ll [ emit-all ] each ] collect ;
      : flat2 ( -- list ) lists :> ll ll { } [ cat ] reduce ;`;
    expect(await out(`${defs} flat1 len .`, { limits })).toBe("8000\n");
    // The reduce form re-copies the accumulator each time: quadratic against the same budget.
    expect((await fail(`${defs} flat2 len .`, { limits })).code).toBe("E_LIMIT_TOTAL");
  });

  test("a collect body that binds a local runs on its own environment", async () => {
    const src = ": f ( -- list ) [ 0 3 range [ :> i [ i ] emit ] each ] collect [ call ] map ; f .";
    expect(await out(src)).toBe("{ 0 1 2 }\n");
  });

  test("steps: emit and emit-all are one step each; the collector adds one iteration step", async () => {
    const base = await steps("[ ] collect drop");
    expect(await steps("[ 1 emit ] collect drop")).toBe(base + 2);
    // emit-all of three elements is one step, as one emit is.
    expect(await steps("[ { 1 2 3 } emit-all ] collect drop")).toBe(
      await steps("[ { 1 2 3 } drop ] collect drop"),
    );
  });
});

describe("cond", () => {
  test("runs the action of the first true test, or the default", async () => {
    const src = `: k ( n:int -- str ) { [ n 0 < ] [ "neg" ] [ n 0 = ] [ "zero" ] [ "pos" ] } cond ;
      -1 k . 0 k . 4 k .`;
    expect(await out(src)).toBe("neg\nzero\npos\n");
    expect(await out("{ [ true ] [ 1 2 ] } cond depth .")).toBe("2\n");
  });

  test("no test true and no default is E_RANGE; an empty list too", async () => {
    expect((await fail("{ [ false ] [ 1 ] } cond")).code).toBe("E_RANGE");
    expect((await fail("{ } cond")).code).toBe("E_RANGE");
  });

  test("the list is checked before any test runs", async () => {
    const r = await createRuntime().run('{ [ "ran" . true ] [ 1 ] 5 } cond');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_TYPE");
      expect(r.output).toBe("");
    }
    expect((await fail("5 cond")).code).toBe("E_TYPE");
  });

  test("a test is checked as a while condition: one bool above its start depth", async () => {
    expect((await fail("{ [ true true ] [ 1 ] } cond")).code).toBe("E_EFFECT");
    expect((await fail("{ [ ] [ 1 ] } cond")).code).toBe("E_EFFECT");
    expect((await fail("{ [ 1 ] [ 1 ] } cond")).code).toBe("E_TYPE");
  });

  test("each test tried is one extra step; the action and the default are not", async () => {
    const one = await steps("{ [ true ] [ ] } cond");
    const two = await steps("{ [ false ] [ ] [ true ] [ ] } cond");
    // one more test: the iteration step plus the `lit` of the extra pair's body, quotation and ret
    expect(two - one).toBeGreaterThan(0);
    const t1 = await steps("{ [ false ] [ ] [ ] } cond");
    const t2 = await steps("{ [ false ] [ ] [ false ] [ ] [ ] } cond");
    expect(t2 - t1).toBeGreaterThan(0);
  });

  test("an action that binds with :> runs on its own environment", async () => {
    expect(await out(": f ( -- int ) [ 4 :> x x x * ] :> a { [ true ] a } cond ; f .")).toBe(
      "16\n",
    );
  });

  test("the return stack is released before the action runs", async () => {
    const e = await fail("{ [ true ] [ { [ true ] [ { [ true ] [ 1 ] } cond ] } cond ] } cond", {
      limits: { maxReturnDepth: 3 },
    });
    expect(e.code).not.toBe("E_INTERNAL");
  });
});

describe("case", () => {
  test("matches with = and consumes the key; exact int/num equality", async () => {
    expect(await out('1.0 { 1 [ "one" ] [ "other" ] } case . depth .')).toBe("one\n0\n");
    expect(await out('"b" { "a" [ 1 ] "b" [ 2 ] } case .')).toBe("2\n");
    expect(await out('{ 1 2 } { { 1 2 } [ "list" ] [ "no" ] } case .')).toBe("list\n");
    expect(await out('99999999999999999999 { 99999999999999999999 [ "big" ] } case .')).toBe(
      "big\n",
    );
  });

  test("no match and no default is E_RANGE; the default alone always runs", async () => {
    expect((await fail("5 { 1 [ ] } case")).code).toBe("E_RANGE");
    expect((await fail("5 { } case")).code).toBe("E_RANGE");
    expect(await out('5 { [ "d" ] } case .')).toBe("d\n");
  });

  test("checks the whole list first: value that is a quotation, action that is not", async () => {
    expect((await fail("1 { 1 2 } case")).code).toBe("E_TYPE");
    expect((await fail("1 { [ ] [ ] } case")).code).toBe("E_TYPE");
    expect((await fail("1 { 9 [ ] 1 } case")).code).toBe("E_TYPE");
    expect((await fail("1 { 9 [ ] 1 [ 2 ] 3 4 } case")).code).toBe("E_TYPE");
    expect((await fail("1 5 case")).code).toBe("E_TYPE");
  });

  test("each comparison tried is one step", async () => {
    const a = await steps("1 { 1 [ ] 2 [ ] 3 [ ] } case");
    const b = await steps("3 { 1 [ ] 2 [ ] 3 [ ] } case");
    expect(b - a).toBe(2);
  });

  test("the action does not receive the key", async () => {
    expect(await out("7 { 7 [ depth ] } case .")).toBe("0\n");
  });
});

describe("sort-by", () => {
  test("orders stably by the key of each element", async () => {
    expect(await out('{ "ccc" "a" "bb" } [ len ] sort-by .')).toBe('{ "a" "bb" "ccc" }\n');
    expect(await out('{ "bb" "aa" "c" } [ len ] sort-by .')).toBe('{ "c" "bb" "aa" }\n');
    expect(await out("{ 3 1 2 } [ neg ] sort-by .")).toBe("{ 3 2 1 }\n");
    expect(await out('{ "b" "a" } [ ] sort-by .')).toBe('{ "a" "b" }\n');
    expect(await out("{ } [ ] sort-by .")).toBe("{ }\n");
  });

  test("keys: a mixture or another tag is E_TYPE; the input must be a list", async () => {
    expect((await fail('{ 1 2 } [ dup 1 = [ drop "a" ] when ] sort-by')).code).toBe("E_TYPE");
    expect((await fail("{ 1 2 } [ drop true ] sort-by")).code).toBe("E_TYPE");
    expect((await fail("{ 1 } [ drop { } ] sort-by")).code).toBe("E_TYPE");
    expect((await fail('"ab" [ ] sort-by')).code).toBe("E_TYPE");
  });

  test("the key quotation runs under the map depth rule, once per element, in order", async () => {
    expect((await fail("{ 1 2 } [ dup ] sort-by")).code).toBe("E_EFFECT");
    expect((await fail("{ 1 2 } [ drop ] sort-by")).code).toBe("E_EFFECT");
    expect(await out("{ 3 1 2 } [ dup . ] sort-by drop")).toBe("3\n1\n2\n");
  });

  test("a key quotation that binds with :> has its own locals per element", async () => {
    expect(await out(": f ( -- list ) { 3 1 2 } [ :> x x neg ] sort-by ; f .")).toBe("{ 3 2 1 }\n");
  });
});

describe("find, any?, all?", () => {
  test("find returns the index or -1, counting code points for a str", async () => {
    expect(await out("{ 1 2 3 4 } [ 2 > ] find . { 1 2 } [ 5 > ] find .")).toBe("2\n-1\n");
    expect(await out('"abc" [ 98 = ] find . #[ 05 06 ] [ 6 = ] find .')).toBe("1\n1\n");
    expect(await out('"a\u{1F600}b" [ 98 = ] find .')).toBe("2\n");
    expect(await out("{ } [ true ] find .")).toBe("-1\n");
  });

  test("any? and all? on the empty sequence and on data", async () => {
    expect(await out("{ } [ true ] any? . { } [ false ] all? .")).toBe("false\ntrue\n");
    expect(
      await out("{ 1 2 3 } [ 2 = ] any? . { 1 2 3 } [ 0 > ] all? . { 1 2 } [ 1 > ] all? ."),
    ).toBe("true\ntrue\nfalse\n");
  });

  test("they stop at the decisive element", async () => {
    expect(await out("{ 1 2 3 } [ dup . 2 = ] any? .")).toBe("1\n2\ntrue\n");
    expect(await out("{ 1 2 3 } [ dup . 2 < ] all? .")).toBe("1\n2\nfalse\n");
    expect(await out("{ 1 2 3 } [ dup . 2 = ] find .")).toBe("1\n2\n1\n");
    const short = await steps("{ 1 2 3 4 5 6 } [ 1 = ] find drop");
    const long = await steps("{ 1 2 3 4 5 6 } [ 6 = ] find drop");
    expect(long).toBeGreaterThan(short);
    expect(await steps("{ 1 2 3 4 5 6 } [ 0 > not ] any? drop")).toBeGreaterThan(short);
  });

  test("the quotation runs under the filter depth rule", async () => {
    expect((await fail("{ 1 } [ ] find")).code).toBe("E_TYPE");
    expect((await fail("{ 1 } [ drop ] any?")).code).toBe("E_EFFECT");
    expect((await fail("{ 1 } [ drop 1 ] all?")).code).toBe("E_TYPE");
    expect((await fail("5 [ true ] find")).code).toBe("E_TYPE");
  });
});

describe("exit with the new words", () => {
  test("is a syntax error in the quotations of the combinators and in cond and case lists", async () => {
    for (const body of [
      "{ [ true ] [ exit ] } cond",
      "1 { 1 [ exit ] } case",
      "[ exit ] collect drop",
      "{ 1 } [ exit ] find drop",
      "{ 1 } [ exit ] any? drop",
      "{ 1 } [ exit ] sort-by drop",
    ]) {
      const e = await fail(`: f ( -- ) ${body} ; f`);
      expect(e.code, body).toBe("E_SYNTAX");
    }
  });

  test("an exit before and after them in the word body still works", async () => {
    const src = `
      : f ( n:int -- str )
        n 0 < [ "neg" exit ] when
        n { 0 [ "zero" ] [ "pos" ] } case ;
      -1 f . 0 f . 5 f .`;
    expect(await out(src)).toBe("neg\nzero\npos\n");
  });
});
