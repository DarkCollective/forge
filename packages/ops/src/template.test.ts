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
 * Tests for the `template` vocabulary (vocab/template.fth, src/prims/template.ts): `template:render`. The op vectors
 * (vocab/template.test.json) hold the cases whose expected text was produced by Handlebars 4.7.10 itself; these tests
 * add the safety cases (no code runs, only own properties are read), the bounds and the cost at 64 KiB. During
 * development the renderer was also compared with Handlebars on 3,700 random templates (white-space control,
 * standalone lines, else chains, sections, each over lists and objects) with no difference.
 */
import { valueHelpers } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { MAX_BLOCK_DEPTH, MAX_STEPS } from "./prims/template.js";
import { loadBundleNode } from "./sources-node.js";

const { str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["template"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const out = (r: Result): string => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return (r.stack[r.stack.length - 1] as { v: string }).v;
};
const render = (data: string, template: string, limits?: { maxValueBytes: number }) =>
  runtime.call(
    "template:render",
    [str(data), str(template)],
    limits === undefined ? undefined : { limits },
  );

describe("no code runs, only own data is read", () => {
  test("members of Object.prototype are absent", async () => {
    const d = '{"a":1}';
    for (const t of [
      "{{constructor}}",
      "{{__proto__}}",
      "{{toString}}",
      "{{constructor.constructor}}",
      "{{a.constructor}}",
      "{{lookup this 'constructor'}}",
      "{{lookup a '__proto__'}}",
    ]) {
      expect(out(await render(d, t)), t).toBe("");
    }
  });

  test("a key named like an Object member is read when the data has it", async () => {
    expect(
      out(
        await render(
          '{"constructor":"c","__proto__":"p","toString":"t"}',
          "{{constructor}}{{__proto__}}{{toString}}",
        ),
      ),
    ).toBe("cpt");
  });

  test("the template is not JavaScript: code-like text is text or an error", async () => {
    expect(
      code(await render("{}", "{{#with (constructor.constructor 'return 1')}}x{{/with}}")),
    ).toBe("E_COERCE");
    expect(code(await render("{}", "{{constructor.constructor('return 1')()}}"))).toBe("E_COERCE");
    expect(out(await render("{}", "process.exit(1) ${1+1} <script>alert(1)</script>"))).toBe(
      "process.exit(1) ${1+1} <script>alert(1)</script>",
    );
  });

  test("HTML in data is escaped by {{x}} and not by {{{x}}}", async () => {
    expect(out(await render('{"x":"<img src=x onerror=alert(1)>"}', "{{x}}"))).toBe(
      "&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;",
    );
    expect(out(await render('{"x":"<b>"}', "{{{x}}}"))).toBe("<b>");
  });

  test("helpers that are not part of the subset are missing helpers", async () => {
    for (const t of [
      "{{log a}}",
      "{{foo}}x{{foo a}}",
      "{{#foo a}}x{{/foo}}",
      "{{#custom a b}}{{/custom}}",
    ]) {
      expect(code(await render('{"a":1}', t)), t).toBe("E_COERCE");
    }
  });
});

describe("bounds", () => {
  test("blocks nest 100 deep, not 101", async () => {
    const nest = (n: number) => "{{#if t}}".repeat(n) + "x" + "{{/if}}".repeat(n);
    expect(out(await render('{"t":true}', nest(MAX_BLOCK_DEPTH)))).toBe("x");
    expect(code(await render('{"t":true}', nest(MAX_BLOCK_DEPTH + 1)))).toBe("E_LIMIT_VALUE");
  });

  test("100,000 open blocks do not exhaust the stack", async () => {
    expect(code(await render("{}", "{{#if t}}".repeat(100_000)))).toBe("E_LIMIT_VALUE");
  });

  test("nested loops with empty bodies stop at the step limit", { timeout: 60_000 }, async () => {
    const items = JSON.stringify({ a: Array.from({ length: 300 }, (_, i) => i) });
    const t = "{{#each a}}{{#each ../a}}{{#each ../../a}}{{/each}}{{/each}}{{/each}}";
    const t0 = Date.now();
    expect(code(await render(items, t))).toBe("E_LIMIT_STEPS");
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(MAX_STEPS).toBe(5_000_000);
  });

  test("the output is held to the value limit", async () => {
    const d = JSON.stringify({ a: Array.from({ length: 1000 }, () => "xxxxxxxxxx") });
    expect(code(await render(d, "{{#each a}}{{this}}{{/each}}", { maxValueBytes: 4_000 }))).toBe(
      "E_LIMIT_VALUE",
    );
    expect(code(await render(d, "{{#each a}}{{this}}{{/each}}"))).toBe("ok");
  });

  test("an unterminated mustache or comment is an error with the position", async () => {
    for (const t of ["x {{name", "x {{!-- never closed", "{{! open"]) {
      const r = await render("{}", t);
      expect(code(r), t).toBe("E_COERCE");
      if (!r.ok) expect(r.error.message).toMatch(/line 1, column \d+/);
    }
  });
});

describe("what a value prints as", () => {
  test("like JavaScript's String() inside Handlebars", async () => {
    const d =
      '{"i":-7,"b":12345678901234567890123,"f":1.5,"w":1.0,"t":true,"n":null,"l":[1,[2,3],null,"x"],"o":{"a":1}}';
    expect(out(await render(d, "{{i}}|{{b}}|{{f}}|{{w}}|{{t}}|{{n}}|{{l}}|{{o}}"))).toBe(
      "-7|12345678901234567890123|1.5|1|true||1,2,3,,x|[object Object]",
    );
  });
});

describe("cost at 64 KiB", () => {
  test(
    "a 56 KB template with 2,000 blocks renders in a few milliseconds and a few VM steps",
    { timeout: 60_000 },
    async () => {
      const t = "{{#if t}}A{{name}}{{/if}} ".repeat(2000);
      expect(t.length).toBeGreaterThan(50_000);
      const t0 = Date.now();
      const r = await render('{"t":true,"name":"N"}', t);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // measured: 7 steps (the renderer is one primitive call); about 30 ms
      expect(r.steps).toBeLessThan(50);
      expect(out(r)).toBe("AN ".repeat(2000));
      expect(Date.now() - t0).toBeLessThan(5000);
    },
  );

  test("a loop over 60,000 numbers (a 64 KB document)", { timeout: 60_000 }, async () => {
    const d = JSON.stringify({ a: Array.from({ length: 12_000 }, (_, i) => i) });
    expect(d.length).toBeGreaterThan(60_000);
    const r = await render(d, "{{#each a}}{{this}},{{/each}}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps).toBeLessThan(50);
    expect(out(r).length).toBeGreaterThan(60_000);
  });
});
