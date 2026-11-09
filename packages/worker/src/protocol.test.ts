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
import { isClientMessage, isWorkerMessage } from "./protocol.js";

const bake = (over: Record<string, unknown> = {}) => ({
  type: "bake",
  id: 1,
  recipe: { forge: 1, steps: [] },
  input: new ArrayBuffer(2),
  options: {},
  ...over,
});
const init = (over: Record<string, unknown> = {}) => ({
  type: "init",
  reqId: 1,
  protocol: 1,
  init: {},
  ...over,
});

describe("isClientMessage accepts well-formed messages", () => {
  test.each([
    ["init", init()],
    [
      "init with vocabs and units",
      init({ init: { vocabs: ["hex"], units: [{ name: "a", source: "" }] } }),
    ],
    ["init with all", init({ init: { vocabs: "all" } })],
    ["init with another protocol (answered by the port)", init({ protocol: 7 })],
    ["bake", bake()],
    [
      "bake with options and a shared flag",
      bake({
        options: {
          trust: "trusted",
          pins: "strict",
          limits: { maxMillis: 5 },
          debug: { startPaused: true },
        },
        abort: new SharedArrayBuffer(4),
      }),
    ],
    ["bake with an unchecked recipe", bake({ recipe: 12 })],
    ["step", { type: "step", id: 1 }],
    ["continue", { type: "continue", id: 0 }],
    ["cancel", { type: "cancel", id: 3 }],
    ["dispose", { type: "dispose" }],
  ])("%s", (_name, message) => {
    expect(isClientMessage(message)).toBe(true);
  });
});

describe("isClientMessage rejects hostile messages", () => {
  const hugeText = "x".repeat(2_000_000);
  test.each([
    ["null", null],
    ["a string", "bake"],
    ["a number", 1],
    ["an array", [{ type: "dispose" }]],
    ["no type", {}],
    ["unknown type", { type: "exec" }],
    ["a non-string type", { type: 1 }],
    ["an extra field", { type: "dispose", extra: 1 }],
    ["a symbol key", { type: "dispose", [Symbol("s")]: 1 }],
    ["init without reqId", init({ reqId: undefined })],
    ["init with a negative reqId", init({ reqId: -1 })],
    ["init with a fractional reqId", init({ reqId: 1.5 })],
    ["init with an unsafe reqId", init({ reqId: 2 ** 60 })],
    ["init with a string protocol", init({ protocol: "1" })],
    ["init with a fractional protocol", init({ protocol: 1.5 })],
    ["init with a null init", init({ init: null })],
    ["init with an array init", init({ init: [] })],
    ["init with unknown fields", init({ init: { evil: 1 } })],
    ["init with vocabs of the wrong type", init({ init: { vocabs: "hex" } })],
    ["init with a non-string vocab", init({ init: { vocabs: [1] } })],
    ["init with too many vocabs", init({ init: { vocabs: new Array(300).fill("a") } })],
    ["init with a long vocab name", init({ init: { vocabs: ["a".repeat(300)] } })],
    ["init with units of the wrong type", init({ init: { units: {} } })],
    [
      "init with too many units",
      init({ init: { units: new Array(65).fill({ name: "a", source: "" }) } }),
    ],
    ["init with a unit without a name", init({ init: { units: [{ source: "" }] } })],
    [
      "init with a unit with an extra field",
      init({ init: { units: [{ name: "a", source: "", x: 1 }] } }),
    ],
    ["init with a unit that is not an object", init({ init: { units: [null] } })],
    ["init with a huge unit", init({ init: { units: [{ name: "a", source: hugeText }] } })],
    ["bake with a bad id", bake({ id: "1" })],
    ["bake with a negative id", bake({ id: -2 })],
    ["bake with a typed array instead of a buffer", bake({ input: new Uint8Array(2) })],
    ["bake with a shared buffer as input", bake({ input: new SharedArrayBuffer(2) })],
    ["bake without input", bake({ input: undefined })],
    ["bake with an object that looks like a buffer", bake({ input: { byteLength: 2 } })],
    ["bake with null options", bake({ options: null })],
    ["bake with unknown options", bake({ options: { onEvent: () => undefined } })],
    ["bake with the abortFlag option", bake({ options: { abortFlag: new Int32Array(1) } })],
    ["bake with a bad trust", bake({ options: { trust: "root" } })],
    ["bake with bad pins", bake({ options: { pins: "no" } })],
    ["bake with limits that are not an object", bake({ options: { limits: 5 } })],
    ["bake with an unknown limit", bake({ options: { limits: { rm: 1 } } })],
    ["bake with a NaN limit", bake({ options: { limits: { maxMillis: Number.NaN } } })],
    ["bake with a negative limit", bake({ options: { limits: { maxMillis: -1 } } })],
    ["bake with a string limit", bake({ options: { limits: { maxMillis: "9" } } })],
    ["bake with a bad debug", bake({ options: { debug: true } })],
    ["bake with an unknown debug field", bake({ options: { debug: { x: 1 } } })],
    ["bake with a non-boolean startPaused", bake({ options: { debug: { startPaused: 1 } } })],
    ["bake with a plain array as the flag", bake({ abort: [0, 0, 0, 0] })],
    ["bake with a too small shared flag", bake({ abort: new SharedArrayBuffer(2) })],
    ["bake with an ordinary buffer as the flag", bake({ abort: new ArrayBuffer(4) })],
    ["bake with an extra field", bake({ extra: 1 })],
    ["step without id", { type: "step" }],
    ["continue with a string id", { type: "continue", id: "1" }],
    ["cancel with an extra field", { type: "cancel", id: 1, force: true }],
  ])("%s", (_name, message) => {
    expect(isClientMessage(message)).toBe(false);
  });

  test("a getter is never invoked", () => {
    let called = false;
    const message = {
      type: "dispose",
      get extra() {
        called = true;
        return 1;
      },
    };
    expect(isClientMessage(message)).toBe(false);
    const sneaky = {
      type: "cancel",
      get id() {
        called = true;
        return 1;
      },
    };
    expect(isClientMessage(sneaky)).toBe(false);
    expect(called).toBe(false);
  });

  test("an inherited type is not a type", () => {
    expect(isClientMessage(Object.create({ type: "dispose" }))).toBe(false);
  });

  test("an own __proto__ key is just an unknown key", () => {
    const message = JSON.parse('{"type":"dispose","__proto__":{"x":1}}') as unknown;
    expect(isClientMessage(message)).toBe(false);
  });
});

const info = { protocol: 1, catalogueVersion: "0123456789abcdef", vocabs: [] };
const error = { code: "E_PROTOCOL", message: "m", path: null, word: null, detail: {} };
const result = (over: Record<string, unknown> = {}) => ({
  id: 1,
  ok: true,
  output: { kind: "str", text: "x" },
  steps: [],
  coercions: [],
  coercionsTruncated: false,
  warnings: [],
  stats: { elapsedMs: 0, vmSteps: 0, effects: [] },
  ...over,
});

describe("isWorkerMessage", () => {
  test.each([
    ["ready", { type: "ready", reqId: 1, info }],
    ["init-error", { type: "init-error", reqId: 1, error }],
    ["fatal", { type: "fatal", message: "m" }],
    [
      "progress",
      {
        type: "event",
        id: 1,
        event: { type: "progress", id: 1, path: null, done: 0, total: 1, vmSteps: 0, elapsedMs: 0 },
      },
    ],
    [
      "paused",
      {
        type: "event",
        id: 1,
        event: {
          type: "paused",
          id: 1,
          path: "/steps/0",
          reason: "step",
          data: { kind: "str", text: "" },
        },
      },
    ],
    ["resumed", { type: "event", id: 1, event: { type: "resumed", id: 1 } }],
    ["an ok result", { type: "result", id: 1, result: result() }],
    [
      "a failed result",
      { type: "result", id: 1, result: result({ ok: false, error, output: undefined }) },
    ],
  ])("accepts %s", (_n, message) => {
    expect(isWorkerMessage(message)).toBe(true);
  });

  test.each([
    ["null", null],
    ["unknown type", { type: "hello" }],
    ["ready with a bad reqId", { type: "ready", reqId: "1", info }],
    ["ready without info", { type: "ready", reqId: 1 }],
    ["ready with a bad info", { type: "ready", reqId: 1, info: { vocabs: [] } }],
    [
      "ready with vocabs that are not an array",
      { type: "ready", reqId: 1, info: { ...info, vocabs: 1 } },
    ],
    ["init-error with a bad error", { type: "init-error", reqId: 1, error: { code: 1 } }],
    [
      "init-error with no detail",
      { type: "init-error", reqId: 1, error: { code: "E", message: "m" } },
    ],
    ["fatal without a message", { type: "fatal" }],
    ["event with a bad id", { type: "event", id: -1, event: { type: "resumed", id: 1 } }],
    ["event with a bad event", { type: "event", id: 1, event: null }],
    ["event of unknown type", { type: "event", id: 1, event: { type: "x", id: 1 } }],
    ["event with a bad inner id", { type: "event", id: 1, event: { type: "resumed", id: "1" } }],
    [
      "progress with a missing number",
      { type: "event", id: 1, event: { type: "progress", id: 1 } },
    ],
    ["paused without data", { type: "event", id: 1, event: { type: "paused", id: 1, path: "/a" } }],
    ["result with a bad id", { type: "result", id: "1", result: result() }],
    ["result that is not an object", { type: "result", id: 1, result: 5 }],
    ["result with no steps", { type: "result", id: 1, result: result({ steps: undefined }) }],
    ["result with no coercions", { type: "result", id: 1, result: result({ coercions: 1 }) }],
    ["result with no warnings", { type: "result", id: 1, result: result({ warnings: null }) }],
    ["result with no stats", { type: "result", id: 1, result: result({ stats: null }) }],
    ["ok result with no output", { type: "result", id: 1, result: result({ output: 1 }) }],
    ["failed result with no error", { type: "result", id: 1, result: result({ ok: false }) }],
    ["result with ok of another type", { type: "result", id: 1, result: result({ ok: "yes" }) }],
    ["an array", []],
  ])("rejects %s", (_n, message) => {
    expect(isWorkerMessage(message)).toBe(false);
  });
});
