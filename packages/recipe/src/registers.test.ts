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
/** Registers and return, the recipe model (RECIPES-1.1.md; WP 6.36). Cases are cited by their CR number. */
import type { ParamSpec } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { fixtureText } from "../test/helpers.js";
import { canonicalRecipe, normaliseRecipe, pinRecipe, resolveRecipe } from "./normalise.js";
import {
  REGISTER_NAME_RE,
  isRegisterRef,
  recipeUsesV11,
  registerInfo,
  registersInScope,
} from "./registers.js";
import { decodeShare, encodeShare } from "./share.js";
import { RECIPE_ISSUE_CODES, RECIPE_LIMITS, STEP_KINDS } from "./types.js";
import type { CatalogueOpView, CatalogueView, Recipe, RecipeIssue } from "./types.js";
import { validateRecipe } from "./validate.js";

// ---------------------------------------------------------------------------------------------
// The catalogue of the cases (the ops of RECIPES-1.1.md section 6.1, with the shipped parameters)
// ---------------------------------------------------------------------------------------------

type SpecInput = Partial<ParamSpec> & { name: string; type: ParamSpec["type"] };

function op(
  qname: string,
  input: string,
  output: string,
  params: SpecInput[],
  needsHardKill = false,
): CatalogueOpView {
  return {
    qname,
    aliases: [],
    input,
    output,
    params: params.map((p, i) => ({ required: p.default === undefined, ...p, index: i + 1 })),
    hash: (qname.length * 7).toString(16).padStart(2, "0").repeat(32),
    needsHardKill,
  } as CatalogueOpView;
}

const ENCS = ["hex", "utf8", "latin1", "base64"];
const slice = (name: string): CatalogueOpView =>
  op(name, "bytes", "bytes", [
    { name: "start", type: "int", constraint: { min: 0 }, default: 0 },
    { name: "length", type: "int", constraint: { min: 0 }, default: 5 },
    { name: "each-line", type: "bool", default: false },
  ]);

const cat: CatalogueView = {
  version: "00112233445566ff",
  ops: [
    op("aes:decrypt", "bytes", "bytes", [
      { name: "key", type: "key", options: ENCS },
      { name: "iv", type: "key", options: ENCS, default: { value: "", enc: "hex" } },
      {
        name: "mode",
        type: "choice",
        options: ["CBC", "CFB", "OFB", "CTR", "GCM", "ECB"],
        default: "CBC",
      },
      { name: "padding", type: "choice", options: ["pkcs7", "none"], default: "pkcs7" },
      { name: "aad", type: "key", options: ENCS, default: { value: "", enc: "hex" } },
    ]),
    slice("bytes-slice:take"),
    slice("bytes-slice:remove"),
    op("classical:rot", "bytes", "bytes", [
      { name: "amount", type: "int", constraint: { min: 0, max: 25 }, default: 13 },
    ]),
    op("hex:decode", "bytes", "bytes", []),
    op("hex:encode", "bytes", "str", [
      { name: "delimiter", type: "choice", options: ["none", "space", "colon"], default: "none" },
      { name: "case", type: "choice", options: ["lower", "upper"], default: "lower" },
    ]),
    op(
      "regex:replace",
      "str",
      "str",
      [
        { name: "pattern", type: "regex" },
        { name: "replacement", type: "str" },
        { name: "flags", type: "str", constraint: { maxLength: 3 }, default: "" },
      ],
      true,
    ),
    op(
      "regex:test",
      "str",
      "bool",
      [
        { name: "pattern", type: "regex" },
        { name: "flags", type: "str", constraint: { maxLength: 3 }, default: "" },
      ],
      true,
    ),
    op(
      "search:count",
      "str",
      "int",
      [
        { name: "pattern", type: "str", constraint: { minLength: 1 } },
        {
          name: "mode",
          type: "choice",
          options: ["string", "regex", "extended"],
          default: "string",
        },
        { name: "ignore-case", type: "bool", default: false },
      ],
      true,
    ),
    op("text:upper", "str", "str", []),
    op("text:lower", "str", "str", []),
    op("text:reverse", "str", "str", []),
  ],
};

const v11 = (dir: string, file: string): unknown =>
  JSON.parse(fixtureText(`corpus/v11/${dir}`, file)) as unknown;

/** `severity code path` of each issue. */
function rows(issues: readonly RecipeIssue[]): string[] {
  return issues.map((i) => `${i.severity} ${i.code} ${i.path}`);
}

function check(doc: unknown, catalogue: CatalogueView | undefined = cat) {
  return validateRecipe(doc, catalogue, { pins: "ignore" });
}

const NAME_PATTERN = "pattern ^[a-z][a-z0-9-]{0,31}$";

const asRecipe = (doc: unknown): Recipe => doc as Recipe;

// ---------------------------------------------------------------------------------------------
// Validation: CR101 to CR117
// ---------------------------------------------------------------------------------------------

describe("validateRecipe: registers and return (RECIPES-1.1.md section 6.2)", () => {
  test("CR101 recipe M is valid", () => {
    const result = check(v11("valid", "cr101-recipe-m.json"));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("CR102 a register name has a pattern and is required", () => {
    const result = check(v11("invalid", "cr102-name-pattern-and-required.json"));
    expect(rows(result.issues)).toEqual([
      "error bad-value /steps/0/name",
      "error required /steps/1/name",
    ]);
    expect(result.issues[0]?.detail).toEqual({ constraint: NAME_PATTERN });
    expect(result.issues[1]?.detail).toEqual({ field: "name" });
  });

  test("CR103 closed objects: a register and a return take no other fields", () => {
    const result = check(v11("invalid", "cr103-closed-objects.json"));
    expect(rows(result.issues)).toEqual([
      "error unknown-field /steps/0/extra",
      "error unknown-field /steps/1/steps",
    ]);
    expect(result.issues.map((i) => i.detail)).toEqual([{ field: "extra" }, { field: "steps" }]);
  });

  test("CR104 a reference to a register that does not exist", () => {
    const result = check(v11("validator-only", "cr104-not-defined.json"));
    expect(rows(result.issues)).toEqual(["error unknown-register /steps/0/params/key/ref"]);
    expect(result.issues[0]?.detail).toEqual({ register: "k", reason: "not-defined" });
  });

  test("CR105 use before definition, and a reference inside the register's own children", () => {
    const result = check(v11("validator-only", "cr105-use-before-definition.json"));
    expect(rows(result.issues)).toEqual([
      "error unknown-register /steps/0/params/key/ref",
      "error unknown-register /steps/1/steps/0/params/key/ref",
    ]);
    for (const i of result.issues) {
      expect(i.detail).toEqual({ register: "k", reason: "not-yet-defined" });
    }
  });

  test("CR106 a register defined in a closed scope is not visible after it", () => {
    const result = check(v11("validator-only", "cr106-out-of-scope.json"));
    expect(rows(result.issues)).toEqual(["error unknown-register /steps/1/params/key/ref"]);
    expect(result.issues[0]?.detail).toEqual({ register: "k", reason: "out-of-scope" });
  });

  test("CR107 a visible name cannot be bound again", () => {
    const result = check(v11("validator-only", "cr107-duplicate-register.json"));
    expect(rows(result.issues)).toEqual([
      "error duplicate-register /steps/1/name",
      "error duplicate-register /steps/2/steps/0/name",
    ]);
    for (const i of result.issues) expect(i.detail).toEqual({ register: "a", first: "/steps/0" });
  });

  test("CR108 sibling scopes may reuse a name", () => {
    const result = check(v11("valid", "cr108-sibling-scopes.json"));
    expect(result.issues).toEqual([]);
  });

  test("CR109 a disabled definition: an enabled user is an error, a disabled user is not", () => {
    const first = check(v11("validator-only", "cr109a-disabled-definition.json"));
    expect(rows(first.issues)).toEqual(["error unknown-register /steps/1/params/key/ref"]);
    expect(first.issues[0]?.detail).toEqual({ register: "a", reason: "disabled" });
    expect(check(v11("valid", "cr109b-disabled-then-enabled.json")).issues).toEqual([]);
  });

  test("CR110 return is not valid in a container other than an if", () => {
    const result = check(v11("validator-only", "cr110-return-bad-position.json"));
    expect(rows(result.issues)).toEqual([
      "error bad-position /steps/0/steps/0",
      "error bad-position /steps/1/steps/0/then/0",
      "error bad-position /steps/2/steps/0",
      "error bad-position /steps/3/steps/0",
    ]);
    expect(result.issues.map((i) => i.detail)).toEqual([
      { kind: "return", container: "/steps/0", containerKind: "fork" },
      { kind: "return", container: "/steps/1", containerKind: "subsection" },
      { kind: "return", container: "/steps/2", containerKind: "repeat" },
      { kind: "return", container: "/steps/3", containerKind: "register" },
    ]);
  });

  test("CR111 return is valid at the root and through if branches to any depth", () => {
    expect(check(v11("valid", "cr111-return-positions.json")).issues).toEqual([]);
  });

  test("CR112 unreachable steps are a warning; a branch that ends in a return does not make the rest unreachable", () => {
    const result = check(v11("valid", "cr112-unreachable-step.json"));
    expect(result.ok).toBe(true);
    expect(rows(result.issues)).toEqual(["warning unreachable-step /steps/5"]);
    expect(result.issues[0]?.detail).toEqual({ after: "/steps/2" });
  });

  test("CR113 a reference is not a value of a fork separator", () => {
    const result = check(v11("invalid", "cr113-ref-in-fork-separator.json"));
    expect(rows(result.issues)).toEqual(["error bad-value /steps/1/split"]);
    expect(result.issues[0]?.detail).toEqual({
      constraint: "register references go in op parameters",
    });
  });

  test("CR114 malformed references", () => {
    const result = check(v11("invalid", "cr114-malformed-references.json"));
    expect(rows(result.issues)).toEqual([
      "error type /steps/1/params/key/ref",
      "error bad-value /steps/1/params/iv/ref",
      "error unknown-field /steps/2/params/key/x",
    ]);
    expect(result.issues.map((i) => i.detail)).toEqual([
      { expected: "a string" },
      { constraint: NAME_PATTERN },
      { field: "x" },
    ]);
  });

  test("CR115 a reference fills a required parameter, and its constraint is not checked statically", () => {
    const doc = v11("valid", "cr115-ref-fills-required-parameter.json");
    expect(check(doc).issues).toEqual([]);
    // the same parameters as literals are checked: 26 is out of range, a missing key is missing
    const literal = check({
      forge: 1,
      steps: [
        { kind: "op", op: "classical:rot", params: { amount: 26 } },
        { kind: "op", op: "aes:decrypt" },
      ],
    });
    expect(rows(literal.issues)).toEqual([
      "error bad-param /steps/0/params/amount",
      "error missing-param /steps/1/params/key",
    ]);
  });

  test("CR116 the register limit", () => {
    const result = check(v11("validator-only", "cr116-register-limit.json"));
    expect(rows(result.issues)).toEqual(["error limit /steps/64"]);
    expect(result.issues[0]?.detail).toEqual({ limit: "maxRegisters", max: 64 });
    expect(RECIPE_LIMITS.maxRegisters).toBe(64);
    expect(RECIPE_LIMITS.maxRegisterNameChars).toBe(32);
    // 64 are fine
    const sixtyFour = {
      forge: 1,
      steps: Array.from({ length: 64 }, (_, i) => ({ kind: "register", name: `r${i}`, steps: [] })),
    };
    expect(check(sixtyFour).ok).toBe(true);
  });

  test("CR117 a reference in an op test of an if sees the registers visible at the if", () => {
    const result = check(v11("validator-only", "cr117-ref-in-op-test.json"));
    expect(rows(result.issues)).toEqual([
      "error unknown-register /steps/0/test/params/pattern/ref",
    ]);
    expect(result.issues[0]?.detail).toEqual({ register: "p", reason: "not-yet-defined" });
  });
});

describe("validateRecipe: the rules of RECIPES-1.1.md sections 2.3 and 4.3 beyond the cases", () => {
  const take = { kind: "op", op: "bytes-slice:take" };
  const use = (name: string, extra: Record<string, unknown> = {}) => ({
    kind: "op",
    op: "aes:decrypt",
    params: { key: { ref: name } },
    ...extra,
  });
  const reg = (name: string, extra: Record<string, unknown> = {}) => ({
    kind: "register",
    name,
    steps: [],
    ...extra,
  });
  const recipe = (steps: unknown[]) => ({ forge: 1, steps });

  test("a register is visible to later steps nested in later siblings", () => {
    const doc = recipe([
      reg("k"),
      { kind: "if", test: { kind: "regex", pattern: "a" }, then: [use("k")], else: [use("k")] },
      {
        kind: "repeat",
        times: 2,
        steps: [
          {
            kind: "fork",
            split: { value: "x", enc: "utf8" },
            join: { value: "", enc: "utf8" },
            steps: [use("k")],
          },
        ],
      },
    ]);
    expect(check(doc).issues).toEqual([]);
  });

  test("a register in one branch is not visible in the other or after the if", () => {
    const doc = recipe([
      {
        kind: "if",
        test: { kind: "regex", pattern: "a" },
        then: [reg("k")],
        else: [use("k")],
      },
      use("k"),
    ]);
    const result = check(doc);
    expect(rows(result.issues)).toEqual([
      "error unknown-register /steps/0/else/0/params/key/ref",
      "error unknown-register /steps/1/params/key/ref",
    ]);
    expect(result.issues.map((i) => i.detail?.reason)).toEqual(["out-of-scope", "out-of-scope"]);
  });

  test("two views: a disabled step sees definitions of disabled and enabled steps, an enabled step only enabled ones", () => {
    const doc = recipe([
      reg("a", { disabled: true }),
      use("a", { disabled: true }),
      use("a"),
      {
        kind: "fork",
        disabled: true,
        split: { value: "x", enc: "utf8" },
        join: { value: "", enc: "utf8" },
        steps: [use("a")],
      },
    ]);
    expect(rows(check(doc).issues)).toEqual(["error unknown-register /steps/2/params/key/ref"]);
  });

  test("a register inside a disabled container is disabled too, and its users in it are disabled", () => {
    const doc = recipe([
      {
        kind: "fork",
        disabled: true,
        split: { value: "x", enc: "utf8" },
        join: { value: "", enc: "utf8" },
        steps: [reg("a"), use("a")],
      },
    ]);
    expect(check(doc).issues).toEqual([]);
  });

  test("duplicates count enabled definitions only; enabling the old one shows the error", () => {
    const old = (disabled: boolean) => recipe([reg("a", { disabled }), reg("a")]);
    expect(check(old(true)).issues).toEqual([]);
    expect(rows(check(old(false)).issues)).toEqual(["error duplicate-register /steps/1/name"]);
  });

  test("a reference in a step with an error of its own gives that error only", () => {
    const doc = recipe([{ kind: "op", op: "nope:x", params: { key: { ref: "ghost" } } }]);
    expect(rows(check(doc).issues)).toEqual(["error unknown-op /steps/0/op"]);
    const unknownParam = recipe([
      { kind: "op", op: "text:upper", params: { nothing: { ref: "ghost" } } },
    ]);
    expect(rows(check(unknownParam).issues)).toEqual([
      "error unknown-param /steps/0/params/nothing",
    ]);
  });

  test("references work without a catalogue too, and a reference needs no param type", () => {
    const doc = recipe([
      reg("a", { steps: [take] }),
      { kind: "op", op: "x:y", params: { p: { ref: "a" } } },
    ]);
    const bare = (d: unknown) => validateRecipe(d, undefined, { pins: "ignore" });
    expect(bare(doc).issues).toEqual([]);
    expect(
      rows(bare(recipe([{ kind: "op", op: "x:y", params: { p: { ref: "z" } } }])).issues),
    ).toEqual(["error unknown-register /steps/0/params/p/ref"]);
  });

  test("a reference is not valid in any structural position", () => {
    const sep = { ref: "a" };
    const doc = recipe([
      reg("a"),
      { kind: "fork", split: { value: "x", enc: "utf8" }, join: sep, steps: [] },
      { kind: "subsection", pattern: sep, steps: [] },
      { kind: "repeat", times: sep, steps: [] },
      { kind: "if", test: { kind: "regex", pattern: sep }, then: [] },
    ]);
    const result = check(doc);
    expect(result.ok).toBe(false);
    expect(rows(result.issues)[0]).toBe("error bad-value /steps/1/join");
    expect(result.issues.every((i) => i.code !== "unknown-register")).toBe(true);
  });

  test("a return in the root and in a deep if chain is fine; a return in a register is not, even disabled", () => {
    const deep = (depth: number): unknown => {
      let steps: unknown[] = [{ kind: "return" }];
      for (let i = 1; i < depth; i++) {
        steps = [{ kind: "if", test: { kind: "regex", pattern: "a" }, then: steps }];
      }
      return recipe(steps);
    };
    expect(check(deep(RECIPE_LIMITS.maxDepth)).issues).toEqual([]);
    const inRegister = recipe([reg("a", { steps: [{ kind: "return", disabled: true }] })]);
    expect(rows(check(inRegister).issues)).toEqual(["error bad-position /steps/0/steps/0"]);
  });

  test("unreachable-step: disabled returns and comments do not count, and only the first step is reported", () => {
    const doc = recipe([
      { kind: "return", disabled: true },
      { kind: "op", op: "text:upper" },
      { kind: "return" },
      { kind: "op", op: "text:upper" },
      { kind: "op", op: "text:lower" },
    ]);
    const result = check(doc);
    expect(rows(result.issues)).toEqual(["warning unreachable-step /steps/3"]);
    expect(result.issues[0]?.detail).toEqual({ after: "/steps/2" });
    // the list of the else branch is its own list
    const branches = recipe([
      {
        kind: "if",
        test: { kind: "regex", pattern: "a" },
        then: [{ kind: "return" }],
        else: [{ kind: "op", op: "text:upper" }],
      },
    ]);
    expect(check(branches).issues).toEqual([]);
  });

  test("the version stays 1 and bad-version is unchanged", () => {
    expect(rows(check({ forge: 2, steps: [{ kind: "return" }] }).issues)).toEqual([
      "error bad-version /forge",
    ]);
  });

  test("the new codes and kinds are registered", () => {
    for (const code of [
      "unknown-register",
      "duplicate-register",
      "bad-position",
      "unreachable-step",
    ]) {
      expect(RECIPE_ISSUE_CODES).toContain(code);
    }
    expect(STEP_KINDS).toContain("register");
    expect(STEP_KINDS).toContain("return");
  });

  test("a register name of 33 characters and one of 32", () => {
    expect(REGISTER_NAME_RE.test("a".repeat(32))).toBe(true);
    expect(REGISTER_NAME_RE.test("a".repeat(33))).toBe(false);
    expect(check(recipe([reg("a".repeat(32))])).ok).toBe(true);
    expect(rows(check(recipe([reg("a".repeat(33))])).issues)).toEqual([
      "error bad-value /steps/0/name",
    ]);
    expect(check(recipe([reg("__proto__")])).ok).toBe(false);
  });

  test("hostile input does not throw", () => {
    const loop: Record<string, unknown> = { kind: "register", name: "a" };
    loop.steps = [loop];
    expect(() => validateRecipe({ forge: 1, steps: [loop] }, cat)).not.toThrow();
    const getter = {
      forge: 1,
      steps: [
        {
          kind: "op",
          op: "aes:decrypt",
          get params() {
            throw new Error("no");
          },
        },
      ],
    };
    expect(() => validateRecipe(getter, cat)).not.toThrow();
    expect(validateRecipe(getter, cat).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Normal forms: CR118
// ---------------------------------------------------------------------------------------------

describe("normalise, resolve, pin and canonical (RECIPES-1.1.md section 4.4)", () => {
  test("CR118 normalise and canonical with registers, references and return", () => {
    const doc = asRecipe(v11("valid", "cr118-normalise-not-normal.json"));
    expect(check(doc).ok).toBe(true);
    const canonical =
      '{"forge":1,"steps":[{"kind":"register","name":"p","steps":[{"kind":"op","op":"bytes-slice:take","params":{"start":0,"length":2,"each-line":false}}]},{"kind":"if","test":{"kind":"regex","pattern":"x"},"then":[{"kind":"return"}]},{"kind":"op","op":"regex:replace","params":{"pattern":{"ref":"p"},"replacement":"-","flags":""}}]}';
    expect(JSON.stringify(canonicalRecipe(doc, cat))).toBe(canonical);
    // normalise alone: no each-line, no flags; params keys sorted; the reference untouched
    expect(JSON.stringify(normaliseRecipe(doc))).toBe(
      '{"forge":1,"steps":[{"kind":"register","name":"p","steps":[{"kind":"op","op":"bytes-slice:take","params":{"length":2,"start":0}}]},{"kind":"if","test":{"kind":"regex","pattern":"x"},"then":[{"kind":"return"}]},{"kind":"op","op":"regex:replace","params":{"pattern":{"ref":"p"},"replacement":"-"}}]}',
    );
  });

  test("canonical is idempotent and stays valid", () => {
    const doc = asRecipe(v11("valid", "cr118-normalise-not-normal.json"));
    const once = canonicalRecipe(doc, cat);
    expect(canonicalRecipe(once, cat)).toEqual(once);
    expect(check(once).ok).toBe(true);
    expect(normaliseRecipe(normaliseRecipe(doc))).toEqual(normaliseRecipe(doc));
  });

  test("resolve keeps a reference as given and materialises the other parameters", () => {
    const doc = asRecipe(v11("valid", "cr101-recipe-m.json"));
    const resolved = resolveRecipe(normaliseRecipe(doc), cat);
    const decrypt = resolved.steps[3];
    expect(decrypt).toEqual({
      kind: "op",
      op: "aes:decrypt",
      params: {
        key: { ref: "key" },
        iv: { ref: "iv" },
        mode: "CBC",
        padding: "pkcs7",
        aad: { value: "", enc: "hex" },
      },
    });
    // the children of a register are resolved too
    expect(resolved.steps[0]).toEqual({
      kind: "register",
      name: "iv",
      steps: [
        {
          kind: "op",
          op: "bytes-slice:take",
          params: { start: 0, length: 16, "each-line": false },
        },
      ],
    });
  });

  test("a reference does not materialise a default: the given value is the reference", () => {
    const doc = asRecipe({
      forge: 1,
      steps: [
        { kind: "register", name: "n", steps: [] },
        { kind: "op", op: "classical:rot", params: { amount: { ref: "n" } } },
      ],
    });
    const out = resolveRecipe(doc, cat);
    expect(out.steps[1]).toEqual({
      kind: "op",
      op: "classical:rot",
      params: { amount: { ref: "n" } },
    });
  });

  test("normalise keeps return and register flags in the order of section 4.4", () => {
    const doc = asRecipe({
      forge: 1,
      steps: [
        { note: "n", breakpoint: true, disabled: true, steps: [], name: "a", kind: "register" },
        { note: "m", disabled: true, kind: "return", breakpoint: true },
      ],
    });
    expect(JSON.stringify(normaliseRecipe(doc).steps)).toBe(
      '[{"kind":"register","name":"a","steps":[],"disabled":true,"breakpoint":true,"note":"n"},{"kind":"return","disabled":true,"breakpoint":true,"note":"m"}]',
    );
  });

  test("pinRecipe recurses into register children, op tests in branches, and leaves references alone", () => {
    const doc = asRecipe(v11("valid", "cr101-recipe-m.json"));
    const pinned = pinRecipe(doc, cat);
    const child = (pinned.steps[0] as unknown as { steps: { hash?: string }[] }).steps[0];
    expect(child?.hash).toBe(cat.ops.find((o) => o.qname === "bytes-slice:take")?.hash);
    expect((pinned.steps[3] as { params: unknown }).params).toEqual({
      key: { ref: "key" },
      iv: { ref: "iv" },
      mode: "CBC",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// registers.ts
// ---------------------------------------------------------------------------------------------

describe("registers.ts (RECIPES-1.1.md section 4.1)", () => {
  const M = asRecipe(v11("valid", "cr101-recipe-m.json"));

  test("isRegisterRef recognises exactly { ref: string }", () => {
    expect(isRegisterRef({ ref: "iv" })).toBe(true);
    expect(isRegisterRef({ ref: 1 })).toBe(false);
    expect(isRegisterRef({ ref: "iv", x: 1 })).toBe(false);
    expect(isRegisterRef({ value: "a", enc: "hex" })).toBe(false);
    for (const v of [null, undefined, "iv", 3, true, [], ["ref"]])
      expect(isRegisterRef(v)).toBe(false);
  });

  test("recipeUsesV11: a register, a return (enabled or disabled), or a reference", () => {
    expect(recipeUsesV11(M)).toBe(true);
    expect(recipeUsesV11(asRecipe({ forge: 1, steps: [] }))).toBe(false);
    const nested = (step: unknown) =>
      asRecipe({
        forge: 1,
        steps: [
          {
            kind: "fork",
            split: { value: "x", enc: "utf8" },
            join: { value: "", enc: "utf8" },
            steps: [step],
          },
        ],
      });
    expect(recipeUsesV11(nested({ kind: "register", name: "a", steps: [], disabled: true }))).toBe(
      true,
    );
    expect(
      recipeUsesV11(
        asRecipe({
          forge: 1,
          steps: [
            {
              kind: "if",
              test: { kind: "regex", pattern: "a" },
              then: [],
              else: [{ kind: "return", disabled: true }],
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(recipeUsesV11(nested({ kind: "op", op: "text:upper" }))).toBe(false);
    expect(
      recipeUsesV11(
        asRecipe({
          forge: 1,
          steps: [
            {
              kind: "if",
              test: { kind: "op", op: "regex:test", params: { pattern: { ref: "p" } } },
              then: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("registerInfo: names, paths, and secret when a reference feeds a key parameter", () => {
    expect(registerInfo(M, cat)).toEqual([
      { name: "iv", path: "/steps/0", secret: true },
      { name: "key", path: "/steps/1", secret: true },
    ]);
    const plain = asRecipe({
      forge: 1,
      steps: [
        { kind: "register", name: "n", steps: [] },
        { kind: "op", op: "classical:rot", params: { amount: { ref: "n" } } },
        { kind: "register", name: "unused", steps: [], disabled: true },
      ],
    });
    expect(registerInfo(plain, cat)).toEqual([
      { name: "n", path: "/steps/0", secret: false },
      { name: "unused", path: "/steps/2", secret: false },
    ]);
  });

  test("registersInScope: outermost first, per step, and a list path means the end of that list", () => {
    const doc = asRecipe({
      forge: 1,
      steps: [
        { kind: "register", name: "a", steps: [] },
        {
          kind: "fork",
          split: { value: "x", enc: "utf8" },
          join: { value: "", enc: "utf8" },
          steps: [
            { kind: "register", name: "b", steps: [{ kind: "op", op: "text:upper" }] },
            { kind: "op", op: "aes:decrypt", params: { key: { ref: "b" } } },
            { kind: "register", name: "c", steps: [] },
          ],
        },
        { kind: "register", name: "d", steps: [] },
        {
          kind: "if",
          test: { kind: "regex", pattern: "x" },
          then: [{ kind: "register", name: "e", steps: [] }],
        },
      ],
    });
    const names = (path: string, c?: CatalogueView) =>
      registersInScope(doc, path, c).map((r) => r.name);
    expect(names("/steps/0")).toEqual([]);
    expect(names("/steps/1")).toEqual(["a"]);
    expect(names("/steps/1/steps/0")).toEqual(["a"]);
    expect(names("/steps/1/steps/0/steps/0")).toEqual(["a"]);
    expect(names("/steps/1/steps/1")).toEqual(["a", "b"]);
    expect(names("/steps/1/steps/1/params/key")).toEqual(["a", "b"]);
    expect(names("/steps/1/steps/2")).toEqual(["a", "b"]);
    expect(names("/steps/1/steps")).toEqual(["a", "b", "c"]);
    expect(names("/steps/2")).toEqual(["a"]);
    expect(names("/steps")).toEqual(["a", "d"]);
    expect(names("/steps/3/then")).toEqual(["a", "d", "e"]);
    expect(names("/steps/9")).toEqual([]);
    expect(names("/nonsense")).toEqual([]);
    // secret needs a catalogue
    expect(registersInScope(M, "/steps/3").map((r) => r.secret)).toEqual([false, false]);
    expect(registersInScope(M, "/steps/3", cat).map((r) => r.secret)).toEqual([true, true]);
    expect(registersInScope(M, "/steps/3", cat).map((r) => r.path)).toEqual([
      "/steps/0",
      "/steps/1",
    ]);
  });

  test("registersInScope: the view follows the step's state", () => {
    const doc = asRecipe({
      forge: 1,
      steps: [
        { kind: "register", name: "a", steps: [], disabled: true },
        { kind: "op", op: "text:upper" },
        { kind: "op", op: "text:upper", disabled: true },
      ],
    });
    expect(registersInScope(doc, "/steps/1")).toEqual([]);
    expect(registersInScope(doc, "/steps/2").map((r) => r.name)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Share: CR129, CR130
// ---------------------------------------------------------------------------------------------

describe("the share URL with registers (RECIPES-1.1.md sections 4.8 and 4.9)", () => {
  const M = asRecipe(v11("valid", "cr101-recipe-m.json"));
  const hex = (s: string) => Uint8Array.from(s.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
  const blob = hex(
    "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf" +
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
      "6f498b8b870a0d8175f26312b99705c8",
  );

  test("CR129 a link round trip of recipe M, with and without a catalogue", async () => {
    expect(blob.length).toBe(64);
    const plain = await encodeShare({ recipe: M, input: blob, inputEncoding: "hex" });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.fragment.startsWith("v=1&r=")).toBe(true);
    expect(plain.warnings).toEqual([]);
    const back = await decodeShare(plain.fragment);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.recipe).toEqual(normaliseRecipe(M));
    expect(back.input).toEqual(blob);
    expect(back.inputEncoding).toBe("hex");

    const pinned = await encodeShare(
      { recipe: M, input: blob, inputEncoding: "hex" },
      { catalogue: cat },
    );
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    expect(pinned.fragment.startsWith("v=1&r=")).toBe(true);
    expect(pinned.warnings).toEqual([]);
    const back2 = await decodeShare(pinned.fragment, { catalogue: cat });
    expect(back2.ok).toBe(true);
    if (!back2.ok) return;
    expect(back2.warnings).toEqual([]);
    expect(back2.recipe).toEqual(pinRecipe(normaliseRecipe(M), cat));
    // pins on the ops inside the registers; references untouched
    const take = (back2.recipe.steps[0] as unknown as { steps: { hash?: string }[] }).steps[0];
    expect(take?.hash).toBe(cat.ops.find((o) => o.qname === "bytes-slice:take")?.hash);
    expect((back2.recipe.steps[3] as { params: Record<string, unknown> }).params.key).toEqual({
      ref: "key",
    });
  });

  test("CR130 a literal key still warns, a reference does not", async () => {
    const literal = await encodeShare(
      { recipe: asRecipe(v11("valid", "cr130a-literal-key.json")) },
      { catalogue: cat },
    );
    expect(literal.ok && literal.warnings.map((w) => `${w.severity} ${w.code} ${w.path}`)).toEqual([
      "warning secret-in-url /steps/0/params/key",
    ]);
    const reference = await encodeShare(
      { recipe: asRecipe(v11("valid", "cr130b-reference-key.json")) },
      { catalogue: cat },
    );
    expect(reference.ok && reference.warnings).toEqual([]);
  });

  test("a literal key inside a register's children warns at its path", async () => {
    const doc = asRecipe({
      forge: 1,
      steps: [
        {
          kind: "register",
          name: "a",
          steps: [
            {
              kind: "op",
              op: "aes:decrypt",
              params: { key: { value: "00", enc: "hex" } },
            },
          ],
        },
      ],
    });
    const out = await encodeShare({ recipe: doc }, { catalogue: cat });
    expect(out.ok && out.warnings.map((w) => w.path)).toEqual(["/steps/0/steps/0/params/key"]);
  });

  test("a link whose recipe has a bad reference is refused with the issues", async () => {
    const doc = asRecipe({
      forge: 1,
      steps: [{ kind: "op", op: "aes:decrypt", params: { key: { ref: "nope" } } }],
    });
    const out = await encodeShare({ recipe: doc }, { catalogue: cat });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe("invalid-recipe");
      expect(out.error.issues?.map((i) => i.code)).toEqual(["unknown-register"]);
    }
  });
});
