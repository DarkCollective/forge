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
/** `MEMO:` (LANGUAGE-0.2.md section 9): purity, caching, limits, interactions, `warm()`. */
import { describe, expect, test } from "vitest";
import type { ForgeError } from "./errors.js";
import { definePrimitive } from "./primitives.js";
import { createRuntime } from "./runtime.js";
import type { ForgeRuntime, RunResult, RuntimeOptions } from "./types.js";

let ticks = 0;
const prims = [
  definePrimitive("fx", "tick", "( -- int )", () => ++ticks),
  definePrimitive("fx", "now", "( -- int )", () => 1, { effects: ["+time"] }),
  definePrimitive("fx", "rand", "( -- int )", () => 4, { effects: ["+random"] }),
  definePrimitive("fx", "big", "( n:int -- str )", (n: unknown) => "x".repeat(n as number)),
];

function make(o: RuntimeOptions = {}): ForgeRuntime {
  ticks = 0;
  return createRuntime({ primitives: prims, ...o });
}

const err = (r: RunResult): ForgeError => {
  if (r.ok) throw new Error("expected a failure, output: " + r.output);
  return r.error as ForgeError;
};
const ok = async (rt: ForgeRuntime, src: string, o = {}): Promise<RunResult> => {
  const r = await rt.run(src, o);
  if (!r.ok) throw r.error;
  return r;
};
const loadFails = (src: string): ForgeError => {
  try {
    make().load(src);
  } catch (e) {
    return e as ForgeError;
  }
  throw new Error("expected load to fail");
};

describe("MEMO: headers and purity", () => {
  test("header shapes", () => {
    for (const h of [
      "( int -- int )",
      "( -- )",
      "( -- int int )",
      "( -- .. )",
      "( -- quot )",
      "( -- any )",
    ]) {
      expect(loadFails(`MEMO: f ${h} 1 ;`).code).toBe("E_HEADER");
    }
    expect(loadFails("MEMO: f 1 ;").code).toBe("E_HEADER");
    const rt = make();
    rt.load('MEMO: _p ( -- str ) "a" ;');
    expect(rt.lookup("user:_p").kind).toBe("fl");
  });

  test("the header error shows the effect once, with a single pair of parentheses", () => {
    const e = loadFails("MEMO: f ( int -- int ) 1 ;");
    expect(e.code).toBe("E_HEADER");
    expect(e.message).toBe("a MEMO: word takes no input: ( int -- int )");
  });

  test("effects, variables, session words, output are E_FORBIDDEN with detail.effect", () => {
    const cases: [string, string][] = [
      ["fx:rand", "+random"],
      ["fx:now", "+time"],
      ["v", "state"],
      ["v!", "state"],
      ['"x" help len', "state"],
      ["current-vocab len", "state"],
      ["vocabs len", "state"],
      ["1 .", "output"],
    ];
    for (const [body, effect] of cases) {
      const src = `0 VARIABLE v\nMEMO: f ( -- int ) ${body.replace(/^v!$/, "0 v!")} 1 ;`;
      const e = loadFails(src.replace("fx:rand 1", "fx:rand").replace("fx:now 1", "fx:now"));
      expect(e.code, body).toBe("E_FORBIDDEN");
      expect(e.detail.effect, body).toBe(effect);
    }
  });

  test("stateful and effects propagate through callees and quotations", () => {
    const base =
      "0 VARIABLE v\n: reads ( -- int ) v ;\n: deep ( -- int ) reads ;\n: rnd ( -- int ) fx:rand ;\n";
    for (const [body, effect] of [
      ["deep", "state"],
      ["[ deep ] call", "state"],
      ["{ rnd }  len", "+random"],
    ] as const) {
      const e = loadFails(`${base}MEMO: f ( -- int ) ${body} ;`);
      expect(e.code).toBe("E_FORBIDDEN");
      expect(e.detail.effect).toBe(effect);
    }
    // a pure callee is fine, and a memo word may call another memo word
    const rt = make();
    rt.load(": p ( -- int ) 2 3 + ;\nMEMO: a ( -- int ) p ;\nMEMO: b ( -- int ) a a + ;");
  });

  test("stateful is internal: not in WordMeta, set only when true", () => {
    const rt = make();
    rt.load("0 VARIABLE v\n: r ( -- int ) v ;\n: p ( -- int ) 1 ;");
    const code = (n: string) => (rt.lookup(n) as { code: { stateful?: boolean } }).code;
    expect(code("r").stateful).toBe(true);
    expect("stateful" in code("p")).toBe(false);
    expect(JSON.stringify(rt.meta("r"))).not.toContain("stateful");
  });

  test("recurse is E_SYNTAX; a second definition in a unit is E_REDEFINED; MEMO:foo is a qualified name", () => {
    expect(loadFails("MEMO: f ( -- int ) recurse ;").code).toBe("E_SYNTAX");
    expect(loadFails("MEMO: f ( -- int ) 1 ;\n: f ( -- int ) 2 ;").code).toBe("E_REDEFINED");
    expect(loadFails("MEMO: ( -- int ) 1 ;").code).toBe("E_NAME");
    expect(loadFails("MEMO: f ( -- int ) 1").code).toBe("E_SYNTAX");
  });

  test("the hash differs from the colon word with the same body and includes callees", () => {
    const rt = make();
    rt.load(": c ( -- int ) 1 ;\nMEMO: m ( -- int ) 1 ;");
    expect(rt.meta("m").hash).not.toBe(rt.meta("c").hash);
    expect(rt.meta("m").source?.text?.startsWith("MEMO:")).toBe(true);
  });
});

describe("MEMO: caching", () => {
  test("one build for any number of calls, one build per runtime", async () => {
    const src = "MEMO: t ( -- int ) fx:tick ;";
    const a = make();
    a.load(src);
    expect((await ok(a, "t t + t +")).stack).toEqual([{ tag: "int", v: 3 }]);
    expect(ticks).toBe(1);
    await ok(a, "t drop");
    expect(ticks).toBe(1);
    const b = createRuntime({ primitives: prims });
    b.load(src);
    await ok(b, "t drop t drop");
    expect(ticks).toBe(2);
  });

  test("a hit costs one step; the miss pays for the body (determinism of step counts)", async () => {
    const rt = make();
    rt.load(
      "MEMO: t ( -- list ) 0 50 range [ dup * ] map ;\n: c ( -- list ) 0 50 range [ dup * ] map ;",
    );
    const cold = (await ok(rt, "t drop")).steps;
    const warm1 = (await ok(rt, "t drop")).steps;
    const warm2 = (await ok(rt, "t drop")).steps;
    const plain = (await ok(rt, "c drop")).steps;
    expect(cold).toBe(plain); // a miss costs exactly what the colon word costs
    expect(warm1).toBe(3); // memo, drop, ret
    expect(warm2).toBe(warm1);
  });

  test("the total of a hit is not charged again", async () => {
    const rt = make();
    rt.load("MEMO: t ( -- str ) 1000 fx:big ;");
    await ok(rt, "t drop", { limits: { maxTotalBytes: 100_000 } });
    // 100 hits of a 2000-byte value stay under a 10000-byte total; the build was charged once earlier
    await ok(rt, "100 [ t drop ] times", { limits: { maxTotalBytes: 10_000 } });
  });

  test("a hit is checked against the caller's maxValueBytes", async () => {
    const rt = make();
    rt.load("MEMO: t ( -- str ) 1000 fx:big ;");
    await ok(rt, "t drop");
    expect(err(await rt.run("t drop", { limits: { maxValueBytes: 100 } })).code).toBe(
      "E_LIMIT_VALUE",
    );
  });

  test("failures and limits cache nothing and fail the same way next time", async () => {
    const rt = make();
    rt.load(
      "MEMO: bad ( -- int ) fx:tick drop 1 0 div ;\nMEMO: spin ( -- int ) fx:tick drop [ true ] loop 0 ;",
    );
    expect(err(await rt.run("bad")).code).toBe("E_DIV_ZERO");
    expect(err(await rt.run("bad")).code).toBe("E_DIV_ZERO");
    expect(ticks).toBe(2);
    expect(err(await rt.run("spin", { limits: { maxSteps: 500 } })).code).toBe("E_LIMIT_STEPS");
    expect(err(await rt.run("spin", { limits: { maxSteps: 500 } })).code).toBe("E_LIMIT_STEPS");
    expect(ticks).toBe(4);
    // a run with room succeeds for a word that did not fit before
    const r2 = make();
    r2.load(
      "MEMO: slow ( -- int ) 0 1000 [ drop ] each 7 ;".replace(
        "0 1000 [ drop ] each",
        "1000 [ ] times",
      ),
    );
    expect(err(await r2.run("slow", { limits: { maxSteps: 100 } })).code).toBe("E_LIMIT_STEPS");
    expect((await ok(r2, "slow")).stack).toEqual([{ tag: "int", v: 7 }]);
    expect((await ok(r2, "slow", { limits: { maxSteps: 100 } })).stack).toEqual([
      { tag: "int", v: 7 },
    ]);
  });

  test("a bad output is E_TYPE and is not cached", async () => {
    const rt = make();
    rt.load('MEMO: f ( -- int ) fx:tick drop "x" ;');
    expect(err(await rt.run("f")).detail.where).toBe("output");
    expect(err(await rt.run("f")).code).toBe("E_TYPE");
    expect(ticks).toBe(2);
  });

  test("the cache cap: a value over the cap is returned, not cached; the total is bounded", async () => {
    const rt = make({ memoCacheBytes: 5000 });
    rt.load(
      "MEMO: huge ( -- str ) fx:tick drop 10000 fx:big ;\nMEMO: m1 ( -- str ) fx:tick drop 1500 fx:big ;\n" +
        "MEMO: m2 ( -- str ) fx:tick drop 1500 fx:big ;\nMEMO: m3 ( -- str ) fx:tick drop 1500 fx:big ;",
    );
    const r = await ok(rt, "huge len .");
    expect(r.output).toBe("10000\n");
    await ok(rt, "huge drop");
    expect(ticks).toBe(2); // built twice: never cached
    await ok(rt, "m1 drop m2 drop m3 drop"); // 3000 each: m1 fits (3000), m2 does not (6000 > 5000)
    const before = ticks;
    await ok(rt, "m1 drop m2 drop m3 drop");
    expect(ticks - before).toBe(2); // m2 and m3 rebuilt, m1 served
    const w = await rt.warm();
    expect(w.built).toEqual(["user:m1"]);
    // built without error but not kept: reported as uncached, not as failed
    expect(w.failed).toEqual([]);
    expect(w.uncached).toEqual([
      { qname: "user:huge", reason: "too-large" },
      { qname: "user:m2", reason: "too-large" },
      { qname: "user:m3", reason: "too-large" },
    ]);
  });

  test("memoCacheBytes 0 caches nothing; bad values are rejected", async () => {
    const rt = make({ memoCacheBytes: 0 });
    rt.load("MEMO: t ( -- int ) fx:tick ;");
    await ok(rt, "t drop t drop");
    expect(ticks).toBe(2);
    expect(() => createRuntime({ memoCacheBytes: -1 })).toThrow(TypeError);
    expect(() => createRuntime({ memoCacheBytes: Number.NaN })).toThrow(TypeError);
  });

  test("a value holding a quotation is returned but not cached", async () => {
    const rt = make();
    rt.load("MEMO: q ( -- list ) fx:tick drop { [ 1 ] } ;");
    await ok(rt, "q drop q drop");
    expect(ticks).toBe(2);
  });

  test("the cached value is shared by aliases and cannot be changed by a caller", async () => {
    const rt = make();
    rt.load("MEMO: l ( -- list ) { 3 1 2 } ;\nMEMO: b ( -- bytes ) #[ 01 02 ] ;");
    const first = await ok(rt, "l");
    const snapshot = JSON.stringify(first.stack);
    // operations that build new values from the cached one
    await ok(rt, "l sort drop l rev drop l 9 append drop l { 7 } cat drop l [ 2 * ] map drop");
    await ok(rt, "b rev drop b #[ ff ] cat drop");
    expect(JSON.stringify((await ok(rt, "l")).stack)).toBe(snapshot);
    expect((await ok(rt, "b")).stack[0]).toMatchObject({ tag: "bytes" });
    expect(Array.from(((await ok(rt, "b")).stack[0] as { v: Uint8Array }).v)).toEqual([1, 2]);
    expect((await ok(rt, "l")).stack[0]).toBe(first.stack[0]);
  });
});

describe("MEMO: interactions", () => {
  test("redefinition at the console is never served stale; earlier callers keep the old word", async () => {
    const rt = make();
    await ok(rt, "MEMO: t ( -- int ) 1 ;");
    await ok(rt, ": use ( -- int ) t ;");
    expect((await ok(rt, "t")).stack).toEqual([{ tag: "int", v: 1 }]);
    await ok(rt, "MEMO: t ( -- int ) 2 ;");
    expect((await ok(rt, "t")).stack).toEqual([{ tag: "int", v: 2 }]);
    expect((await ok(rt, "use")).stack).toEqual([{ tag: "int", v: 1 }]);
    await ok(rt, ": t ( -- int ) 3 ;");
    expect((await ok(rt, "t")).stack).toEqual([{ tag: "int", v: 3 }]);
  });

  test("memo words calling memo words build each once", async () => {
    const rt = make();
    rt.load("MEMO: a ( -- int ) fx:tick ;\nMEMO: b ( -- int ) a a + ;\nMEMO: c ( -- int ) b a + ;");
    expect((await ok(rt, "c c +")).stack).toEqual([{ tag: "int", v: 6 }]);
    expect(ticks).toBe(1);
  });

  test(":> and exit inside the body", async () => {
    const rt = make();
    rt.load(
      "MEMO: m ( -- int ) fx:tick :> n true [ n 10 + exit ] when 0 ;\n" +
        "MEMO: e ( -- int ) 1 exit ;",
    );
    expect((await ok(rt, "m m +")).stack).toEqual([{ tag: "int", v: 22 }]);
    expect(ticks).toBe(1);
    expect((await ok(rt, "e e +")).stack).toEqual([{ tag: "int", v: 2 }]);
  });

  test("collect inside a memo body, and a memo word called inside a collect", async () => {
    const rt = make();
    rt.load(
      "MEMO: sq ( -- list ) fx:tick drop [ 1 4 range [ dup * emit ] each ] collect ;\n" +
        "MEMO: bad ( -- int ) 1 emit 2 ;\n" +
        ": add ( x:int -- ) x emit ;\n" +
        "MEMO: helper ( -- list ) [ 5 add 6 add ] collect ;",
    );
    expect((await ok(rt, "[ 0 emit sq emit-all 9 emit ] collect .")).output).toBe(
      "{ 0 1 4 9 9 }\n",
    );
    expect((await ok(rt, "[ 0 emit sq emit-all ] collect len .")).output).toBe("4\n");
    expect(ticks).toBe(1);
    // the body cannot emit into the caller's collector, cold or warm
    for (let i = 0; i < 2; i++) {
      const e = err(await rt.run("[ bad drop ] collect"));
      expect(e.code).toBe("E_EFFECT");
      expect(e.detail.reason).toBe("emit outside collect");
    }
    expect((await ok(rt, "[ 1 emit helper emit-all ] collect .")).output).toBe("{ 1 5 6 }\n");
  });

  test("try inside a memo body inside a collect does not see the caller's collector", async () => {
    const rt = make();
    rt.load("MEMO: t ( -- int ) [ 1 emit 1 ] [ drop 2 ] try ;");
    const r = await ok(rt, "[ 0 emit t drop ] collect .");
    // the failed emit is caught inside the body; the caller's collector got only its own item
    expect(r.output).toBe("{ 0 }\n");
    expect((await ok(rt, "t")).stack).toEqual([{ tag: "int", v: 2 }]);
  });

  test("try around a failing build: nothing cached, later call retries", async () => {
    const rt = make();
    rt.load("MEMO: bad ( -- int ) fx:tick drop 1 0 div ;");
    const r = await ok(rt, "[ bad ] [ drop -1 ] try [ bad ] [ drop -2 ] try");
    expect(r.stack).toEqual([
      { tag: "int", v: -1 },
      { tag: "int", v: -2 },
    ]);
    expect(ticks).toBe(2);
  });

  test("hooks and trace see the memo instruction", async () => {
    const rt = make();
    rt.load("MEMO: t ( -- int ) 4 ;");
    const r = await ok(rt, "t drop", { trace: true });
    expect(r.trace?.map((x) => x.op)).toEqual([
      "memo",
      "lit",
      "ret",
      "drop".length ? "stack" : "stack",
      "ret",
    ]);
    const r2 = await ok(rt, "t drop", { trace: true });
    expect(r2.trace?.map((x) => x.op)).toEqual(["memo", "stack", "ret"]);
  });

  test("a build under maxReturnDepth is charged to the caller", async () => {
    const rt = make();
    rt.load("MEMO: t ( -- int ) 1 ;");
    expect(err(await rt.run("t", { limits: { maxReturnDepth: 1 } })).code).toBe("E_LIMIT_RETURN");
    expect((await ok(rt, "t")).stack).toEqual([{ tag: "int", v: 1 }]);
  });
});

describe("warm()", () => {
  test("reports built and failed words, in definition order", async () => {
    const rt = make();
    rt.load(
      "MEMO: a ( -- int ) fx:tick ;\nMEMO: bad ( -- int ) 1 0 div ;\nMEMO: _c ( -- int ) fx:tick ;\n" +
        "MEMO: spin ( -- int ) [ true ] loop 0 ;",
    );
    const w = await rt.warm();
    expect(w.built).toEqual(["user:a", "user:_c"]);
    expect(w.failed.map((f) => [f.qname, f.error.code])).toEqual([
      ["user:bad", "E_DIV_ZERO"],
      ["user:spin", "E_LIMIT_STEPS"],
    ]);
    expect(ticks).toBe(2);
    await ok(rt, "a drop");
    expect(ticks).toBe(2);
    const again = await rt.warm({ words: ["user:a", "nope", "core:dup", "user:bad"] });
    expect(again.built).toEqual(["user:a"]);
    expect(again.failed.map((f) => f.error.code)).toEqual(["E_UNDEFINED", "E_TYPE", "E_DIV_ZERO"]);
  });

  test("a value that holds a quotation is uncached with its own reason, not a failure", async () => {
    const rt = make();
    rt.load(
      "MEMO: q ( -- list ) { [ 1 ] } ;\nMEMO: ok1 ( -- int ) 7 ;\nMEMO: bad ( -- int ) 1 0 div ;",
    );
    const w = await rt.warm();
    expect(w.built).toEqual(["user:ok1"]);
    expect(w.uncached).toEqual([{ qname: "user:q", reason: "contains-quot" }]);
    expect(w.failed.map((f) => [f.qname, f.error.code])).toEqual([["user:bad", "E_DIV_ZERO"]]);
    // the word still works, and is built again on each use
    expect((await ok(rt, "q len")).stack).toEqual([{ tag: "int", v: 1 }]);
  });

  test("memoLimits bound a build; defaults are 2M steps and 5 s", async () => {
    const rt = make({ memoLimits: { maxSteps: 300 } });
    rt.load("MEMO: slow ( -- int ) 1000 [ ] times 1 ;\nMEMO: fast ( -- int ) 1 ;");
    const w = await rt.warm();
    expect(w.built).toEqual(["user:fast"]);
    expect(w.failed[0]?.error.code).toBe("E_LIMIT_STEPS");
    // the default limits are generous: a 100k-step body fits
    const r2 = make();
    r2.load("MEMO: mid ( -- int ) 100000 [ ] times 1 ;");
    expect((await r2.warm()).built).toEqual(["user:mid"]);
    // a runtime with no memo words warms to an empty report
    expect(await make().warm()).toEqual({ built: [], failed: [], uncached: [] });
  });
});
