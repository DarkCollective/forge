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
import {
  ERROR_CODES,
  ForgeError,
  MAX_FRAMES,
  MAX_SNAPSHOT,
  REDACTED,
  formatErrorMessage,
  isCatchable,
  isCatchableError,
  isForgeError,
  redactDetail,
  redactKeySlots,
  redactSnapshot,
  redactValue,
} from "./errors.js";
import type { ErrorCode, Value } from "./types.js";
import { bool, bytes, int, list, markSecret, num, record, str } from "./values.js";

const secret = (...b: number[]): Value => markSecret(bytes(new Uint8Array(b)));

describe("ForgeError", () => {
  test("applies the documented defaults", () => {
    const e = new ForgeError({ code: "E_USER", message: "boom" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ForgeError");
    expect(e.message).toBe("boom");
    expect(e.code).toBe("E_USER");
    expect(e.word).toBeNull();
    expect(e.vocab).toBeNull();
    expect(e.step).toBeNull();
    expect(e.ip).toBeNull();
    expect(e.pos).toBeNull();
    expect(e.stackSnapshot).toEqual([]);
    expect(e.frames).toEqual([]);
    expect(e.detail).toEqual({});
    expect(e.cause).toBeUndefined();
    expect("cause" in e).toBe(false);
  });

  test("keeps the supplied fields", () => {
    const pos = { offset: 4, line: 2, col: 3 };
    const cause = new Error("inner");
    const e = new ForgeError({
      code: "E_TYPE",
      message: "m",
      word: "user:f",
      vocab: "user",
      step: 7,
      ip: 3,
      pos,
      stackSnapshot: [int(1)],
      frames: [{ word: "user:f", ip: 3 }],
      detail: { expected: "int" },
      cause,
    });
    expect(e.word).toBe("user:f");
    expect(e.vocab).toBe("user");
    expect(e.step).toBe(7);
    expect(e.ip).toBe(3);
    expect(e.pos).toEqual(pos);
    expect(e.stackSnapshot).toEqual([int(1)]);
    expect(e.frames).toEqual([{ word: "user:f", ip: 3 }]);
    expect(e.detail).toEqual({ expected: "int" });
    expect(e.cause).toBe(cause);
  });

  test("a step or ip of 0 is kept, not defaulted", () => {
    const e = new ForgeError({ code: "E_USER", message: "m", step: 0, ip: 0 });
    expect(e.step).toBe(0);
    expect(e.ip).toBe(0);
  });

  test("keeps the top 16 snapshot values and at most 64 frames", () => {
    const stack = Array.from({ length: 20 }, (_, i) => int(i));
    const frames = Array.from({ length: 70 }, (_, i) => ({ word: `w${i}`, ip: i }));
    const e = new ForgeError({ code: "E_USER", message: "m", stackSnapshot: stack, frames });
    expect(MAX_SNAPSHOT).toBe(16);
    expect(e.stackSnapshot).toHaveLength(16);
    expect(e.stackSnapshot[0]).toEqual(int(4));
    expect(e.stackSnapshot[15]).toEqual(int(19));
    expect(MAX_FRAMES).toBe(64);
    expect(e.frames).toHaveLength(64);
    expect(e.frames[0]?.word).toBe("w0");
    expect(e.frames[63]?.word).toBe("w63");
    expect(e.framesSkipped).toBe(0);
  });

  test("framesSkipped defaults to 0, is in toJSON and survives with()", () => {
    const plain = new ForgeError({ code: "E_USER", message: "m" });
    expect(plain.framesSkipped).toBe(0);
    expect(plain.toJSON().framesSkipped).toBe(0);
    const e = new ForgeError({ code: "E_USER", message: "m", framesSkipped: 7 });
    expect(e.toJSON().framesSkipped).toBe(7);
    expect(e.with({ step: 3 }).framesSkipped).toBe(7);
    expect(e.with({ framesSkipped: 9 }).framesSkipped).toBe(9);
  });

  test("copies its inputs", () => {
    const stack = [int(1)];
    const detail: Record<string, unknown> = { a: 1 };
    const e = new ForgeError({ code: "E_USER", message: "m", stackSnapshot: stack, detail });
    stack.push(int(2));
    detail.b = 2;
    expect(e.stackSnapshot).toHaveLength(1);
    expect(e.detail).toEqual({ a: 1 });
  });

  test("with() overlays fields and keeps the rest", () => {
    const cause = new Error("c");
    const e = new ForgeError({
      code: "E_RANGE",
      message: "m",
      detail: { k: 1 },
      stackSnapshot: [int(1)],
      cause,
    });
    const f = e.with({ word: "user:w", step: 9, ip: 2 });
    expect(f).not.toBe(e);
    expect(f.code).toBe("E_RANGE");
    expect(f.message).toBe("m");
    expect(f.word).toBe("user:w");
    expect(f.step).toBe(9);
    expect(f.ip).toBe(2);
    expect(f.detail).toEqual({ k: 1 });
    expect(f.stackSnapshot).toEqual([int(1)]);
    expect(f.cause).toBe(cause);
    expect(e.word).toBeNull();
    const g = new ForgeError({ code: "E_USER", message: "x" }).with({ message: "y" });
    expect(g.message).toBe("y");
    expect("cause" in g).toBe(false);
  });

  test("toString uses the formatted message", () => {
    const e = new ForgeError({
      code: "E_TYPE",
      message: "expected int, got str",
      word: "user:f",
      pos: { offset: 0, line: 3, col: 9 },
    });
    expect(String(e)).toBe("E_TYPE: expected int, got str at 3:9 in user:f");
  });

  test("toJSON replaces values by reprs and is JSON serialisable", () => {
    const e = new ForgeError({
      code: "E_PARAM_INVALID",
      message: "m",
      word: "classical:rot",
      vocab: "classical",
      step: 4,
      ip: 1,
      pos: { offset: 1, line: 1, col: 2 },
      stackSnapshot: [str("a\nb"), list([int(1), num(2)]), bytes(new Uint8Array([1]))],
      frames: [{ word: "classical:rot", ip: 1 }],
      detail: { param: "amount", big: 2n ** 70n, v: int(5), many: [int(1), "x"], n: 3 },
    });
    const j = e.toJSON();
    expect(j.name).toBe("ForgeError");
    expect(j.code).toBe("E_PARAM_INVALID");
    expect(j.stackSnapshot).toEqual(['"a\\nb"', "{ 1 2.0 }", "#[ 01 ]"]);
    expect(j.frames).toEqual([{ word: "classical:rot", ip: 1 }]);
    expect(j.detail).toEqual({
      param: "amount",
      big: (2n ** 70n).toString(),
      v: "5",
      many: ["1", "x"],
      n: 3,
    });
    expect("cause" in j).toBe(false);
    expect(() => JSON.stringify(e)).not.toThrow();
    expect(JSON.parse(JSON.stringify(e))).toEqual(j);
  });

  test("toJSON cuts long reprs and reports the cause", () => {
    const long = str("x".repeat(200));
    const e1 = new ForgeError({
      code: "E_PRIMITIVE",
      message: "m",
      stackSnapshot: [long],
      cause: new Error("inner"),
    });
    const j1 = e1.toJSON();
    expect((j1.stackSnapshot as string[])[0]).toHaveLength(80);
    expect((j1.stackSnapshot as string[])[0]?.endsWith("...")).toBe(true);
    expect(j1.cause).toBe("inner");
    const e2 = new ForgeError({ code: "E_PRIMITIVE", message: "m", cause: "plain" });
    expect(e2.toJSON().cause).toBe("plain");
  });

  test("redacts secrets at construction", () => {
    const e = new ForgeError({
      code: "E_PARAM_INVALID",
      message: "m",
      stackSnapshot: [int(1), secret(1, 2)],
      detail: { value: secret(9), items: [secret(8), 1] },
    });
    expect(e.stackSnapshot[0]).toEqual(int(1));
    expect(e.stackSnapshot[1]).toEqual(str(REDACTED));
    expect(e.detail.value).toEqual(str(REDACTED));
    expect(e.detail.items).toEqual([str(REDACTED), 1]);
    expect(JSON.stringify(e)).not.toContain("0102");
  });
});

describe("formatErrorMessage", () => {
  test("code: message at line:col in word", () => {
    expect(
      formatErrorMessage({
        code: "E_LEX",
        message: "bad escape",
        pos: { offset: 3, line: 2, col: 5 },
        word: "user:w",
      }),
    ).toBe("E_LEX: bad escape at 2:5 in user:w");
  });
  test("omits missing parts", () => {
    expect(formatErrorMessage({ code: "E_USER", message: "x" })).toBe("E_USER: x");
    expect(formatErrorMessage({ code: "E_USER", message: "x", pos: null, word: null })).toBe(
      "E_USER: x",
    );
    expect(formatErrorMessage({ code: "E_USER", message: "x", word: "w" })).toBe("E_USER: x in w");
    expect(
      formatErrorMessage({ code: "E_USER", message: "x", pos: { offset: 0, line: 1, col: 1 } }),
    ).toBe("E_USER: x at 1:1");
  });
});

describe("catchability", () => {
  const uncatchable: ErrorCode[] = [
    "E_ABORTED",
    "E_INTERNAL",
    "E_FORBIDDEN",
    "E_LIMIT_STEPS",
    "E_LIMIT_STACK",
    "E_LIMIT_RETURN",
    "E_LIMIT_VALUE",
    "E_LIMIT_TOTAL",
    "E_LIMIT_TIME",
    "E_LIMIT_OUTPUT",
    "E_LIMIT_SOURCE",
  ];

  test("the code list has exactly the 34 codes of the spec", () => {
    expect(ERROR_CODES).toHaveLength(34);
    expect(new Set(ERROR_CODES).size).toBe(34);
  });

  test("exactly the documented codes are uncatchable", () => {
    expect(ERROR_CODES.filter((c) => !isCatchable(c)).sort()).toEqual([...uncatchable].sort());
    expect(ERROR_CODES.filter(isCatchable)).toHaveLength(23);
  });

  test.each(uncatchable)("%s is not catchable", (c) => {
    expect(isCatchable(c)).toBe(false);
  });

  test.each(["E_USER", "E_TYPE", "E_RANGE", "E_PRIMITIVE", "E_DIV_ZERO", "E_LEX"] as const)(
    "%s is catchable",
    (c) => {
      expect(isCatchable(c)).toBe(true);
    },
  );

  test("isCatchableError", () => {
    expect(isCatchableError(new ForgeError({ code: "E_USER", message: "m" }))).toBe(true);
    expect(isCatchableError(new ForgeError({ code: "E_LIMIT_STEPS", message: "m" }))).toBe(false);
    expect(isCatchableError(new Error("x"))).toBe(false);
    expect(isCatchableError(undefined)).toBe(false);
  });
});

describe("isForgeError", () => {
  test("recognises instances", () => {
    expect(isForgeError(new ForgeError({ code: "E_USER", message: "m" }))).toBe(true);
  });
  test("recognises a look-alike from another realm", () => {
    const e = Object.assign(new Error("m"), { name: "ForgeError", code: "E_USER" });
    expect(isForgeError(e)).toBe(true);
  });
  test("rejects everything else", () => {
    expect(isForgeError(new Error("m"))).toBe(false);
    expect(isForgeError(Object.assign(new Error("m"), { name: "ForgeError" }))).toBe(false);
    expect(
      isForgeError(Object.assign(new Error("m"), { name: "ForgeError", code: "E_NOPE" })),
    ).toBe(false);
    expect(isForgeError({ name: "ForgeError", code: "E_USER" })).toBe(false);
    expect(isForgeError(null)).toBe(false);
    expect(isForgeError("E_USER")).toBe(false);
  });
});

describe("redaction", () => {
  test("a secret bytes value becomes the str <redacted>", () => {
    expect(redactValue(secret(1))).toEqual({ tag: "str", v: "<redacted>" });
  });

  test("values without secrets are returned unchanged (same object)", () => {
    const plain = [
      int(1),
      bytes(new Uint8Array([1])),
      list([int(1), list([str("a")])]),
      record([["k", bool(true)]]),
    ];
    for (const v of plain) expect(redactValue(v)).toBe(v);
  });

  test("secrets nested in lists and records are redacted, the rest kept", () => {
    const v = list([
      int(1),
      secret(1),
      record([
        ["k", secret(2)],
        ["j", int(3)],
      ]),
    ]);
    const r = redactValue(v);
    expect(r).toEqual(
      list([
        int(1),
        str(REDACTED),
        record([
          ["k", str(REDACTED)],
          ["j", int(3)],
        ]),
      ]),
    );
    // the original is untouched
    expect((v.v as readonly Value[])[1]).toEqual(secret(1));
  });

  test("a secret under pathologically deep nesting redacts the subtree instead of overflowing", () => {
    let v: Value = secret(1);
    for (let i = 0; i < 400; i++) v = list([v]);
    const r = redactValue(v);
    let depth = 0;
    let cur: Value = r;
    while (cur.tag === "list") {
      cur = (cur.v as readonly Value[])[0] as Value;
      depth++;
    }
    expect(depth).toBe(256);
    expect(cur).toEqual(str(REDACTED));
  });

  test("redactSnapshot keeps the top 16 and redacts", () => {
    const stack = [...Array.from({ length: 20 }, (_, i) => int(i)), secret(7)];
    const s = redactSnapshot(stack);
    expect(s).toHaveLength(16);
    expect(s[15]).toEqual(str(REDACTED));
    expect(s[0]).toEqual(int(5));
  });

  test("redactKeySlots replaces the values destined for key slots", () => {
    const stack = [int(0), bytes(new Uint8Array([1])), bytes(new Uint8Array([2])), int(3)];
    const out = redactKeySlots(stack, [{ type: "bytes" }, { type: "key" }, { type: "int" }]);
    expect(out[0]).toEqual(int(0));
    expect(out[1]).toEqual(bytes(new Uint8Array([1])));
    expect(out[2]).toEqual(str(REDACTED));
    expect(out[3]).toEqual(int(3));
    expect(stack[2]).toEqual(bytes(new Uint8Array([2])));
  });

  test("redactKeySlots ignores inputs below the bottom of a short stack", () => {
    const out = redactKeySlots([bytes(new Uint8Array([1]))], [{ type: "key" }, { type: "key" }]);
    expect(out).toEqual([str(REDACTED)]);
  });

  test("redactDetail redacts values and arrays of values, keeps plain data", () => {
    const d = redactDetail({ a: secret(1), b: [secret(2), "x"], c: "text", d: { tag: "no" } });
    expect(d).toEqual({
      a: str(REDACTED),
      b: [str(REDACTED), "x"],
      c: "text",
      d: { tag: "no" },
    });
  });
});
