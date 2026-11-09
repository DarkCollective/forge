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
// Test only: the package itself never creates a runtime. Here a real FL runtime (with stand-ins for the seed
// primitives) loads the compiled text, to check the line layout against `CompiledWord.positions` and the
// step map against RECIPES.md sections 12.1, 12.2 and 12.6.
import { bytes, createRuntime, definePrimitive } from "@forge/lang";
import type { ForgeRuntime, PrimitiveDef, SourcePos } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { golden, recipeOf, seed } from "../test/helpers.js";
import { compileRecipe } from "./compile.js";
import { base64Decode, hexEncode, utf8DecodeStrict, utf8Encode } from "./encoding.js";
import { attributeError, resolveStepIps } from "./stepmap.js";
import type { StepIpMap } from "./types.js";

const text = (b: Uint8Array) => utf8DecodeStrict(b) ?? "";

const prims: PrimitiveDef[] = [
  definePrimitive(
    "base64",
    "decode",
    "( bytes alphabet:choice{standard|url}=standard -- bytes )",
    (b: unknown) => {
      const out = base64Decode(text(b as Uint8Array));
      if (out === null) throw new Error("bad base64");
      return out;
    },
  ),
  definePrimitive(
    "hex",
    "encode",
    "( bytes delimiter:choice{none|space|colon}=none case:choice{lower|upper}=lower -- str )",
    (b: unknown, delimiter: unknown, kase: unknown) => {
      const hex = hexEncode(b as Uint8Array);
      const pairs = hex.match(/../g) ?? [];
      const joined = pairs.join(delimiter === "space" ? " " : delimiter === "colon" ? ":" : "");
      return kase === "upper" ? joined.toUpperCase() : joined;
    },
  ),
  definePrimitive("hex", "decode", "( bytes -- bytes )", (b: unknown) => {
    const s = text(b as Uint8Array).replace(/\s+/g, "");
    return Uint8Array.from((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  }),
  definePrimitive(
    "regex",
    "replace",
    '( str pattern:regex replacement:str flags:str[0..3,/[ims]*/]="" -- str )',
    (s: unknown, pattern: unknown, replacement: unknown, flags: unknown) =>
      (s as string).replace(
        new RegExp(pattern as string, `gu${flags as string}`),
        replacement as string,
      ),
  ),
  definePrimitive(
    "regex",
    "test",
    '( str pattern:regex flags:str[0..3,/[ims]*/]="" -- bool )',
    (s: unknown, pattern: unknown, flags: unknown) =>
      new RegExp(pattern as string, `u${flags as string}`).test(s as string),
  ),
  definePrimitive(
    "recipe",
    "_split-matches",
    "( bytes pattern:regex flags:str encoding:choice{utf8|latin1} -- list )",
    () => [],
  ),
];

const UNITS = [
  `IN: classical
: _rot-code ( code:int amount:int -- int )
  code 65 >= code 90 <= and
  [ code 65 - amount + 26 mod 65 + ]
  [ code 97 >= code 122 <= and
    [ code 97 - amount + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: rot ( bytes amount:int[0..25]=13 -- bytes )
  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc
  "Classical ciphers" category
  [ amount _rot-code ] map ;

META: rot
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
;
`,
  `IN: text
: upper ( str -- str ) "Convert to upper case." doc "Text" category core:upper ;
: lower ( str -- str ) "Convert to lower case." doc "Text" category core:lower ;
: reverse ( str -- str ) "Reverse the order of the characters." doc "Text" category core:rev ;
`,
  `IN: recipe
: as-bytes ( bytes -- bytes )
  "Normalise the data to bytes." doc ;

: latin1 ( str -- bytes )
  "Literal helper." doc
  latin1>bytes ;

: base64 ( str -- bytes )
  "Literal helper." doc
  str>bytes "standard" base64:decode ;

: matches ( bytes pattern:regex flags:str encoding:choice{utf8|latin1}="utf8" -- bool )
  "True when the pattern matches somewhere in the data." doc
  encoding "latin1" = [ bytes>latin1 ] [ bytes>str ] if
  pattern flags regex:test ;

: section ( bytes pattern:regex flags:str encoding:choice{utf8|latin1}="utf8" body:quot -- bytes )
  "Run body on every non-empty match." doc
  pattern flags encoding _split-matches
  [ 2 mod 1 = [ body call as-bytes ] when ] mapi
  #[ ] bjoin ;

: branch ( bytes test:quot then:quot else:quot -- any )
  "Run test on a copy of the data; then run then or else." doc
  dup test call [ then call ] [ else call ] if ;

: repeat ( bytes n:int[1..1000] body:quot -- bytes )
  "Run body n times." doc
  n [ body call as-bytes ] times ;

: settle ( bytes cap:int[1..1000] body:quot -- bytes )
  "Run body until its result equals its input, at most cap times." doc
  dup body call as-bytes
  dup2 = cap 1 = or
  [ nip ] [ nip cap 1 - body recurse ] if ;
`,
];

function runtimeWithUnits(): ForgeRuntime {
  const rt = createRuntime({ primitives: prims });
  for (const [i, source] of UNITS.entries()) rt.load(source, { unit: `unit${i}.fth` });
  return rt;
}

function loadRecipe(rt: ForgeRuntime, source: string): void {
  rt.setCurrentVocab("bake");
  rt.setCurrentVocab("user");
  rt.load(source, { unit: "recipe", scope: { current: "bake", using: [] } });
}

function positionsOf(rt: ForgeRuntime): readonly SourcePos[] {
  const entry = rt.lookup("bake:main");
  if (entry.kind !== "fl" || entry.code === null) throw new Error("not a colon word");
  return entry.code.positions;
}

describe("compiled text on a real FL runtime (RECIPES.md section 12.1)", () => {
  const gate = compileRecipe(
    {
      forge: 1,
      steps: [
        { kind: "op", op: "base64:decode", params: { alphabet: "standard" } },
        { kind: "op", op: "classical:rot", params: { amount: 13 } },
        { kind: "op", op: "hex:encode", params: { case: "lower", delimiter: "none" } },
      ],
    },
    seed,
  );

  test("the Gate recipe loads as bake:main, runs, and maps steps to instructions as 12.1 says", async () => {
    if (!gate.ok) throw new Error("compile failed");
    const rt = runtimeWithUnits();
    loadRecipe(rt, gate.text);
    const result = await rt.call("bake:main", [bytes(utf8Encode("VXJ5eWIsIEpiZXlxIQ=="))]);
    expect(result.ok).toBe(true);
    expect(result.stack.map((v) => v.v)).toEqual(["48656c6c6f2c20576f726c6421"]);

    const positions = positionsOf(rt);
    const map = resolveStepIps("bake:main", gate.lines, positions);
    expect(map.steps.map((s) => [s.path, s.startIp, s.endIp])).toEqual([
      ["/steps/0", 0, 2],
      ["/steps/1", 2, 4],
      ["/steps/2", 4, 7],
    ]);
    expect(positions).toHaveLength(8); // and a ret at 7
  });
});

describe("the recipe that uses every step kind (RECIPES.md section 12.2)", () => {
  const demo = compileRecipe(JSON.parse(golden("demo.recipe.json")), seed);

  test("the loaded word has 44 instructions and the step map of 12.2", () => {
    if (!demo.ok) throw new Error("compile failed");
    const rt = runtimeWithUnits();
    loadRecipe(rt, demo.text);
    const positions = positionsOf(rt);
    expect(positions).toHaveLength(44);
    const map = resolveStepIps("bake:main", demo.lines, positions);
    expect(map.steps.map((s) => [s.path, s.startIp, s.endIp])).toEqual([
      ["/steps/0", 0, 2],
      ["/steps/2", 2, 10],
      ["/steps/2/steps/0", 6, 8],
      ["/steps/3", 10, 18],
      ["/steps/3/steps/0", 15, 16],
      ["/steps/4", 18, 31],
      ["/steps/4/then/0", 26, 27],
      ["/steps/5", 31, 40],
      ["/steps/5/steps/0", 34, 38],
      ["/steps/6", 40, 43],
    ]);
    expect(map.events.map((e) => [e.ip, e.ends, e.starts])).toEqual([
      [0, [], ["/steps/0"]],
      [2, ["/steps/0"], ["/steps/2"]],
      [6, [], ["/steps/2/steps/0"]],
      [8, ["/steps/2/steps/0"], []],
      [10, ["/steps/2"], ["/steps/3"]],
      [15, [], ["/steps/3/steps/0"]],
      [16, ["/steps/3/steps/0"], []],
      [18, ["/steps/3"], ["/steps/4"]],
      [26, [], ["/steps/4/then/0"]],
      [27, ["/steps/4/then/0"], []],
      [31, ["/steps/4"], ["/steps/5"]],
      [34, [], ["/steps/5/steps/0"]],
      [38, ["/steps/5/steps/0"], []],
      [40, ["/steps/5"], ["/steps/6"]],
      [43, ["/steps/6"], []],
    ]);
    expect(map.breakpoints).toEqual([{ word: "bake:main", ip: 6 }]);
  });

  test("a disabled step and a comment leave no instructions", () => {
    if (!demo.ok) throw new Error("compile failed");
    const rt = runtimeWithUnits();
    loadRecipe(rt, demo.text);
    const map = resolveStepIps("bake:main", demo.lines, positionsOf(rt));
    expect(map.steps.some((s) => s.path === "/steps/1" || s.path === "/steps/2/steps/1")).toBe(
      false,
    );
  });
});

describe("attributing an error to a step (RECIPES.md section 12.6)", () => {
  function setup(steps: unknown[]) {
    const out = compileRecipe(recipeOf(steps), seed);
    if (!out.ok) throw new Error("compile failed");
    const rt = runtimeWithUnits();
    loadRecipe(rt, out.text);
    return { rt, map: resolveStepIps(out.word, out.lines, positionsOf(rt)), out };
  }

  const fork = {
    kind: "fork",
    split: { value: "\n", enc: "utf8" },
    join: { value: "\n", enc: "utf8" },
    steps: [{ kind: "op", op: "text:upper" }],
  };

  test("an error inside a container is attributed to the child", async () => {
    const { rt, map, out } = setup([{ kind: "op", op: "hex:decode" }, fork]);
    expect(out.text).toContain('recipe:as-bytes "\\n" "\\n" [');
    expect(map.steps.map((s) => [s.path, s.startIp, s.endIp])).toEqual([
      ["/steps/0", 0, 1],
      ["/steps/1", 1, 8],
      ["/steps/1/steps/0", 5, 6],
    ]);
    const result = await rt.call("bake:main", [bytes(utf8Encode("610a62ff0a63"))]);
    const error = result.ok ? undefined : result.error;
    expect(error?.code).toBe("E_COERCE");
    expect(error?.word).toBe("text:upper");
    expect(attributeError("bake:main", error?.frames ?? [], map)).toBe("/steps/1/steps/0");
  });

  test("an error at a top-level step", async () => {
    const { rt, map } = setup([
      { kind: "op", op: "hex:decode" },
      { kind: "op", op: "text:upper" },
    ]);
    const result = await rt.call("bake:main", [bytes(utf8Encode("ff"))]);
    const error = result.ok ? undefined : result.error;
    expect(error?.code).toBe("E_COERCE");
    expect(attributeError("bake:main", error?.frames ?? [], map)).toBe("/steps/1");
  });

  test("it succeeds on valid input", async () => {
    const { rt } = setup([
      { kind: "op", op: "hex:decode" },
      { kind: "op", op: "text:upper" },
    ]);
    const result = await rt.call("bake:main", [bytes(utf8Encode("6162"))]);
    expect(result.ok).toBe(true);
    expect(result.stack.map((v) => [v.tag, v.v])).toEqual([["str", "AB"]]);
  });
});

describe("attributeError and resolveStepIps on a hand-made map", () => {
  const map: StepIpMap = {
    steps: [
      { path: "/steps/0", kind: "fork", startIp: 0, endIp: 10, breakpoint: false },
      { path: "/steps/0/steps/0", kind: "op", startIp: 4, endIp: 6, breakpoint: false },
    ],
    events: [],
    breakpoints: [],
  };

  test("the deepest step wins; the first frame of the word is used; null when nothing fits", () => {
    expect(attributeError("w", [{ word: "w", ip: 5 }], map)).toBe("/steps/0/steps/0");
    expect(attributeError("w", [{ word: "w", ip: 7 }], map)).toBe("/steps/0");
    expect(
      attributeError(
        "w",
        [
          { word: "callee", ip: 0 },
          { word: "w", ip: 5 },
          { word: "w", ip: 1 },
        ],
        map,
      ),
    ).toBe("/steps/0/steps/0");
    expect(attributeError("w", [{ word: "w", ip: 10 }], map)).toBeNull();
    expect(attributeError("w", [{ word: "other", ip: 5 }], map)).toBeNull();
    expect(attributeError("w", [], map)).toBeNull();
  });

  test("resolveStepIps on empty input", () => {
    expect(resolveStepIps("w", [], [])).toEqual({ steps: [], events: [], breakpoints: [] });
    const line = {
      path: "/steps/0",
      kind: "op" as const,
      startLine: 3,
      endLine: 3,
      disabled: false,
      breakpoint: true,
    };
    const pos = [
      { offset: 0, line: 3, col: 1 },
      { offset: 0, line: 3, col: 1 },
      { offset: 0, line: 4, col: 1 },
    ];
    expect(resolveStepIps("w", [line], pos)).toMatchObject({
      steps: [{ startIp: 0, endIp: 2 }],
      breakpoints: [{ word: "w", ip: 0 }],
    });
    // a line that has no instruction yet: the range is empty and at the end
    expect(
      resolveStepIps("w", [{ ...line, startLine: 9, endLine: 9 }], pos).steps[0],
    ).toMatchObject({ startIp: 3, endIp: 3 });
  });
});
