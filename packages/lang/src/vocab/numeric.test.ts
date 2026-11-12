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
import { createRuntime } from "../runtime.js";
import { NUMERIC_PRIMITIVES } from "./numeric.js";

const rt = createRuntime();

/** Runs console source; returns the output, or `ERR <code>` for a failed run. */
async function go(src: string): Promise<string> {
  const r = await rt.run(src);
  return r.ok ? r.output : `ERR ${r.error.code}`;
}

describe("the numeric table", () => {
  test("the words, their effects and a doc that mentions the host", () => {
    expect(NUMERIC_PRIMITIVES.map((d) => d.name)).toEqual([
      "ln",
      "log2",
      "log10",
      "exp",
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "sinh",
      "cosh",
      "tanh",
      "fpow",
      "pi",
      "str>num",
    ]);
    for (const d of NUMERIC_PRIMITIVES) {
      expect(d.vocab).toBe("core");
      expect(d.doc ?? "").not.toBe("");
      expect(d.effects).toBeUndefined();
    }
    for (const d of NUMERIC_PRIMITIVES.filter((x) => !["pi", "str>num"].includes(x.name))) {
      expect(d.doc).toMatch(/host Math/);
    }
    const e = (n: string): string | undefined =>
      NUMERIC_PRIMITIVES.find((d) => d.name === n)?.effect;
    expect(e("ln")).toBe("( number -- num )");
    expect(e("atan2")).toBe("( y:number x:number -- num )");
    expect(e("fpow")).toBe("( base:number exp:number -- num )");
    expect(e("pi")).toBe("( -- num )");
    expect(e("str>num")).toBe("( str -- num )");
  });
});

describe("conformance cases of docs/LANGUAGE-0.2.md section 12", () => {
  test("C273 exact values", async () => {
    expect(await go("0 exp . 1 ln . 8 log2 . 100 log10 . 0 sin . 0 cos . 0 atan .")).toBe(
      "1.0\n0.0\n3.0\n2.0\n0.0\n1.0\n0.0\n",
    );
  });
  test("C274 atan2 takes y then x", async () => {
    expect(await go("1 1 atan2 .\n0 -1 atan2 pi = .")).toBe("0.7853981633974483\ntrue\n");
  });
  test("C275 domain errors are E_RANGE", async () => {
    expect(await go("0 ln")).toBe("ERR E_RANGE");
  });
  test("C276 a float result must be finite", async () => {
    expect(await go("1000 exp")).toBe("ERR E_RANGE");
  });
  test("C277 asin domain", async () => {
    expect(await go("2 asin")).toBe("ERR E_RANGE");
  });
  test("C278 str>num", async () => {
    expect(await go('"1.5e3" str>num .\n"-2" str>num .\n"0.25" str>num .')).toBe(
      "1500.0\n-2.0\n0.25\n",
    );
  });
  test("C279 str>num is strict", async () => {
    expect(await go('" 1" str>num')).toBe("ERR E_COERCE");
  });
  test("C280 str>num refuses non-finite and non-decimal text", async () => {
    expect(await go('"1e999" str>num')).toBe("ERR E_COERCE");
  });
});

describe("maths words", () => {
  test("pi", async () => {
    expect(await go("pi .")).toBe("3.141592653589793\n");
  });

  test("logarithms: x <= 0 is E_RANGE, for ints and floats, negative zero included", async () => {
    for (const w of ["ln", "log2", "log10"]) {
      expect(await go(`0 ${w}`)).toBe("ERR E_RANGE");
      expect(await go(`-1 ${w}`)).toBe("ERR E_RANGE");
      expect(await go(`0.0 ${w}`)).toBe("ERR E_RANGE");
      expect(await go(`-0.0 ${w}`)).toBe("ERR E_RANGE");
      expect(await go(`-1.5 ${w}`)).toBe("ERR E_RANGE");
    }
    expect(await go("1 log2 . 1 log10 . 0.5 log2 . 1000 log10 .")).toBe("0.0\n0.0\n-1.0\n3.0\n");
  });

  test("exp: overflow is E_RANGE, underflow is 0.0", async () => {
    expect(await go("709 exp 0.0 > .")).toBe("true\n");
    expect(await go("710 exp")).toBe("ERR E_RANGE");
    expect(await go("-1000 exp .")).toBe("0.0\n");
  });

  test("sin cos tan and atan on exact points", async () => {
    expect(await go("0.0 sin . 0.0 cos . 0.0 tan . 0.0 atan .")).toBe("0.0\n1.0\n0.0\n0.0\n");
    expect(await go("1 atan 4 * pi - abs 0.000000000001 < .")).toBe("true\n");
    expect(await go("pi sin abs 0.000000000001 < .")).toBe("true\n");
  });

  test("asin and acos: |x| > 1 is E_RANGE, the ends are valid", async () => {
    expect(await go("-2 asin")).toBe("ERR E_RANGE");
    expect(await go("1.0000001 acos")).toBe("ERR E_RANGE");
    expect(await go("-2 acos")).toBe("ERR E_RANGE");
    expect(await go("0 asin . 1 acos . -1 acos pi = .")).toBe("0.0\n0.0\ntrue\n");
    expect(await go("1 asin 2 * pi = .")).toBe("true\n");
  });

  test("atan2: y is the deeper operand; (0, 0) is 0.0", async () => {
    expect(await go("1 0 atan2 2 * pi = .")).toBe("true\n");
    expect(await go("0 1 atan2 .")).toBe("0.0\n");
    expect(await go("0 0 atan2 .")).toBe("0.0\n");
    expect(await go("-1 0 atan2 -2 * pi = .")).toBe("true\n");
  });

  test("sinh cosh tanh: overflow is E_RANGE", async () => {
    expect(await go("0 sinh . 0 cosh . 0 tanh .")).toBe("0.0\n1.0\n0.0\n");
    expect(await go("1000 sinh")).toBe("ERR E_RANGE");
    expect(await go("-1000 sinh")).toBe("ERR E_RANGE");
    expect(await go("1000 cosh")).toBe("ERR E_RANGE");
    expect(await go("1000 tanh .")).toBe("1.0\n");
  });

  test("fpow: float power, a NaN or infinite result is E_RANGE", async () => {
    expect(await go("2 10 fpow . 2 0.5 fpow 2 sqrt = . 2 -1 fpow . 0 0 fpow .")).toBe(
      "1024.0\ntrue\n0.5\n1.0\n",
    );
    expect(await go("-8 0.5 fpow")).toBe("ERR E_RANGE");
    expect(await go("0 -1 fpow")).toBe("ERR E_RANGE");
    expect(await go("10 400 fpow")).toBe("ERR E_RANGE");
    expect(await go("2 10 pow .")).toBe("1024\n");
  });

  test("an int is converted to num and the result is always num", async () => {
    expect(await go("0 sin type . 2 3 fpow type . pi type .")).toBe("num\nnum\nnum\n");
  });

  test("a bigint beyond 2^53 is E_COERCE; a safe one is accepted", async () => {
    for (const w of ["ln", "exp", "sin", "cos", "tan", "asin", "atan", "sinh", "log2", "log10"]) {
      expect(await go(`9007199254740993 ${w}`)).toBe("ERR E_COERCE");
    }
    expect(await go("1 9007199254740993 atan2")).toBe("ERR E_COERCE");
    expect(await go("9007199254740993 1 atan2")).toBe("ERR E_COERCE");
    expect(await go("2 9007199254740993 fpow")).toBe("ERR E_COERCE");
    expect(await go("9007199254740993 2 fpow")).toBe("ERR E_COERCE");
    expect(await go("9007199254740991 ln 0.0 > .")).toBe("true\n");
  });

  test("a non-number is E_TYPE", async () => {
    expect(await go('"a" ln')).toBe("ERR E_TYPE");
    expect(await go('1 "a" atan2')).toBe("ERR E_TYPE");
    expect(await go("1 fpow")).toBe("ERR E_STACK_UNDERFLOW");
  });

  test("E_RANGE carries the operand", async () => {
    const r = await rt.run("0 ln");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_RANGE");
      expect(r.error.detail).toEqual({ value: 0 });
    }
  });
});

describe("str>num", () => {
  test("valid texts", async () => {
    expect(
      await go('"12" str>num . "-0.5" str>num . "2E-2" str>num . "1e3" str>num . "0" str>num .'),
    ).toBe("12.0\n-0.5\n0.02\n1000.0\n0.0\n");
    expect(await go('"1E+2" str>num . "007" str>num . "-1.25e-1" str>num .')).toBe(
      "100.0\n7.0\n-0.125\n",
    );
  });

  test('"-0" is negative zero, as the literal -0.0', async () => {
    const r = await rt.run('"-0" str>num "-0.0" str>num');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [a, b] = r.stack;
      expect(Object.is((a as { v: number }).v, -0)).toBe(true);
      expect(Object.is((b as { v: number }).v, -0)).toBe(true);
    }
  });

  test("the result is a num even for integral text", async () => {
    expect(await go('"12" str>num type .')).toBe("num\n");
  });

  test("everything else is E_COERCE", async () => {
    const bad = [
      "",
      " 1",
      "1 ",
      "+1",
      ".5",
      "5.",
      "1.",
      "-",
      "--1",
      "1_000",
      "0x10",
      "NaN",
      "Infinity",
      "-Infinity",
      "1e",
      "1e+",
      "e5",
      "1.5.2",
      "1,5",
      "\n1",
      "１",
      "1e999",
      "-1e999",
      "1" + "0".repeat(400),
    ];
    for (const s of bad) {
      const r = await rt.run(`${JSON.stringify(s)} str>num`);
      expect(r.ok, JSON.stringify(s)).toBe(false);
      if (!r.ok) expect(r.error.code, JSON.stringify(s)).toBe("E_COERCE");
    }
  });

  test("underflow to zero is accepted, a huge exponent that stays finite is exact", async () => {
    expect(await go('"1e-999" str>num .')).toBe("0.0\n");
    expect(await go('"1.7976931348623157e308" str>num 0.0 > .')).toBe("true\n");
  });

  test("a non-string is E_TYPE", async () => {
    expect(await go("1 str>num")).toBe("ERR E_TYPE");
  });
});
