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
// The guard over the real help document (WP 6.13a): every example in the built help.json must work
// through Try it. For each one the recipe and input are built by `planTryIt`, the function the dialog
// calls, and then
//   (a) `validateRecipe` against the real catalogue reports no issue at all, and
//   (b) baking it gives the example's `expect`.
// (b) reuses `runOpVectors` of @forge/worker, the runner of the op test vectors, so there is no second
// comparer: a thin baker wrapper swaps in the Try it recipe and input for the one-step recipe the runner
// builds. The runner bakes "trusted": the in-process baker cannot terminate a running bake, which the
// app's Web Worker host can, and regex steps are refused "untrusted" without such a host (E_UNSAFE_HOST).
// The recipes are validated, and the ops are the same, so this is the same code path as in the app.
//
// Layering: web already depends on ops, recipe and worker, so a test in apps/web/src/ops imports all
// of them with no new dependency. It lives here, next to the code it guards, and runs in `npm test`.
// One baker is initialised once for all examples (about 2.5 s). Measured with 77 examples: a typical
// bake is about 4 ms, the whole test about 7 s, of which about 3 s is the key-derivation ops themselves
// (argon2 about 0.7 s each, scrypt and bcrypt about 0.1 s). At about 1,500 examples that is roughly
// 2.5 s + 1,500 x 4 ms + the slow KDFs, so 10 to 20 s; the timeout is 240 s like the vector test.
// The data is the build output (`npm run build` first), like the other tests that read dist/.
import { readFileSync } from "node:fs";
import { loadBundleNode } from "@forge/ops/node";
import type { Catalogue, HelpDoc } from "@forge/ops";
import { validateRecipe } from "@forge/recipe";
import { createInProcessBaker, runOpVectors } from "@forge/worker";
import type { Baker, OpTestVector } from "@forge/worker";
import { describe, expect, test } from "vitest";
import { planTryIt } from "./try-it.js";
import type { TryItPlan } from "./try-it.js";

const read = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../../../packages/ops/dist/${name}`, import.meta.url), "utf8"),
  ) as T;
const catalogue = read<Catalogue>("catalogue.json");
const help = read<HelpDoc>("help.json");

interface Case {
  readonly label: string;
  readonly qname: string;
  readonly plan: Extract<TryItPlan, { ok: true }>;
  readonly expect: OpTestVector["expect"];
}

const cases: Case[] = [];
const unreadable: string[] = [];
for (const op of help.ops) {
  for (const ex of op.examples) {
    const label = `${op.qname}: ${ex.title}`;
    const plan = planTryIt(op.qname, ex);
    if (plan.ok)
      cases.push({ label, qname: op.qname, plan, expect: ex.expect as OpTestVector["expect"] });
    else unreadable.push(`${label}: ${plan.message}`);
  }
}

describe("every help example works through Try it", () => {
  test("the document has examples, and every input can be read", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(unreadable).toEqual([]);
  });

  test("every Try it recipe validates against the real catalogue", () => {
    const failing: string[] = [];
    for (const c of cases) {
      const issues = validateRecipe(c.plan.recipe, catalogue).issues;
      if (issues.length > 0) {
        failing.push(`${c.label}: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
      }
    }
    expect(failing).toEqual([]);
  });

  test(
    "every Try it recipe bakes to the example's expected result",
    { timeout: 240_000 },
    async () => {
      const real = createInProcessBaker({ loadBundle: loadBundleNode });
      await real.init({ vocabs: "all" });
      // The runner bakes the cases in order, one vector each; the wrapper swaps in what Try it builds.
      let next = 0;
      const baker: Baker = {
        ...real,
        bake: (recipe, _input, options) => {
          const c = cases[next++];
          if (c === undefined) throw new Error("more bakes than examples");
          const first = (recipe as { steps: { op?: string }[] }).steps[0];
          if (first?.op !== c.qname) throw new Error(`order mismatch: ${first?.op} for ${c.label}`);
          return real.bake(c.plan.recipe, c.plan.bytes, options);
        },
      };
      const vectors: OpTestVector[] = cases.map((c) => ({
        name: c.label,
        op: c.qname,
        params: {},
        input: { value: "", enc: "utf8" },
        expect: c.expect,
      }));
      const report = await runOpVectors({ baker, catalogue, files: { "help.json": vectors } });
      await real.dispose();
      expect(report.failures.map((f) => f.message)).toEqual([]);
      expect(report.passed).toBe(cases.length);
    },
  );
});

// Line endings (WP 6.16). Try it used to put the input through the editor's text conversion, which turns
// CR LF and a lone CR into LF, so an example whose input has CR LF line breaks baked a different input from
// the vector's. The guard above could not tell, because it only compared with the example's own `expect`
// and the old examples did not depend on the line ending.
describe("Try it keeps the line endings of an example input", () => {
  const bytesOf = (value: string, enc: string) => {
    const plan = planTryIt("text:upper", { params: {}, input: { value, enc } } as never);
    if (!plan.ok) throw new Error(plan.message);
    return plan;
  };

  test("utf8 and latin1 text keep CR LF, a lone CR and LF byte for byte", () => {
    const text = "a\r\nb\rc\nd\r\n";
    const want = [0x61, 13, 10, 0x62, 13, 0x63, 10, 0x64, 13, 10];
    expect([...bytesOf(text, "utf8").bytes]).toEqual(want);
    expect([...bytesOf(text, "latin1").bytes]).toEqual(want);
  });

  test("the input tab is told the line ending the text uses", () => {
    expect(bytesOf("a\r\nb\r\n", "utf8").eol).toBe("crlf");
    expect(bytesOf("a\rb\r", "utf8").eol).toBe("cr");
    expect(bytesOf("a\nb\n", "utf8").eol).toBe("lf");
    expect(bytesOf("no breaks", "utf8").eol).toBe("lf");
    expect(bytesOf("0d0a", "hex").eol).toBe("lf");
  });

  test(
    "every csv vector input with CR LF bakes to the vector's own expected result",
    { timeout: 120_000 },
    async () => {
      const file = JSON.parse(
        readFileSync(
          new URL("../../../../packages/ops/vocab/csv.test.json", import.meta.url),
          "utf8",
        ),
      ) as (OpTestVector & { params: Record<string, unknown> })[];
      // includes "Quoted cells keep commas and line breaks": a quoted cell with CR LF inside it
      const withCrlf = file.filter(
        (v) =>
          !("checks" in v) &&
          v.op === "csv:to-json" &&
          "value" in v.input &&
          v.input.value.includes("\r\n"),
      );
      expect(withCrlf.length).toBeGreaterThan(5);
      const plans = withCrlf.map((v) => {
        const plan = planTryIt(v.op, v as never);
        if (!plan.ok) throw new Error(plan.message);
        expect(plan.bytes.includes(13)).toBe(true);
        return plan;
      });
      const real = createInProcessBaker({ loadBundle: loadBundleNode });
      await real.init({ vocabs: "all" });
      let next = 0;
      const baker: Baker = {
        ...real,
        bake: (_recipe, _input, options) => {
          const plan = plans[next++];
          if (plan === undefined) throw new Error("more bakes than vectors");
          return real.bake(plan.recipe, plan.bytes, options);
        },
      };
      const report = await runOpVectors({
        baker,
        catalogue,
        files: { "csv.json": withCrlf.map((v) => ({ ...v, params: {} })) as OpTestVector[] },
      });
      await real.dispose();
      expect(report.failures.map((f) => f.message)).toEqual([]);
      expect(report.passed).toBe(withCrlf.length);
    },
  );
});
