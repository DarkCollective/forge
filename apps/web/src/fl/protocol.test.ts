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
import { describe, expect, it } from "vitest";
import { parseClientMessage, parseWorkerMessage } from "./protocol.js";

const catalogue = { format: 1, version: "0".repeat(16), vocabs: [], ops: [] };

describe("parseClientMessage", () => {
  it("accepts well formed requests", () => {
    expect(
      parseClientMessage({ type: "init", id: 1, units: [{ name: "user", source: "IN: user" }] }),
    ).not.toBeNull();
    expect(parseClientMessage({ type: "run", id: 2, source: "1" })).toEqual({
      type: "run",
      id: 2,
      source: "1",
    });
    expect(parseClientMessage({ type: "reset", id: 3 })).not.toBeNull();
    expect(parseClientMessage({ type: "inspect", id: 4, qname: "core:dup" })).not.toBeNull();
    expect(parseClientMessage({ type: "dispose" })).toEqual({ type: "dispose" });
  });

  it("rejects bad shapes", () => {
    for (const bad of [
      null,
      "run",
      [],
      { type: "run" },
      { type: "run", id: -1, source: "" },
      { type: "run", id: 1.5, source: "" },
      { type: "run", id: 1, source: 5 },
      { type: "init", id: 1, units: [{ name: "u" }] },
      { type: "init", id: 1, units: "x" },
      { type: "nope", id: 1 },
    ]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });
});

describe("parseWorkerMessage", () => {
  it("accepts well formed answers", () => {
    expect(
      parseWorkerMessage({
        type: "ready",
        id: 1,
        catalogue,
        warnings: [],
        vocab: "user",
        vocabs: ["core"],
      }),
    ).not.toBeNull();
    expect(parseWorkerMessage({ type: "init-error", id: 1, message: "x" })).not.toBeNull();
    const result = parseWorkerMessage({
      type: "result",
      id: 2,
      ok: false,
      output: "",
      stack: ["<0>"],
      vocab: "user",
      vocabs: [],
      error: { code: "E_X", message: "m" },
    });
    expect(result).toMatchObject({ type: "result", error: { code: "E_X" } });
    expect(parseWorkerMessage({ type: "reset-done", id: 3, vocab: "user" })).not.toBeNull();
    expect(
      parseWorkerMessage({
        type: "inspect-result",
        id: 4,
        qname: "a:b",
        ok: true,
        meta: "",
        source: "",
        help: "",
      }),
    ).not.toBeNull();
    expect(parseWorkerMessage({ type: "fatal", message: "boom" })).not.toBeNull();
  });

  it("rejects bad shapes", () => {
    for (const bad of [
      undefined,
      { type: "ready", id: 1, catalogue: { format: 2 }, warnings: [], vocab: "u", vocabs: [] },
      {
        type: "ready",
        id: 1,
        catalogue: { ...catalogue, ops: [1] },
        warnings: [],
        vocab: "u",
        vocabs: [],
      },
      { type: "result", id: 1, ok: "yes", output: "", stack: [], vocab: "u", vocabs: [] },
      { type: "result", id: 1, ok: true, output: "", stack: [1], vocab: "u", vocabs: [] },
      {
        type: "result",
        id: 1,
        ok: false,
        output: "",
        stack: [],
        vocab: "u",
        vocabs: [],
        error: { code: 1 },
      },
      { type: "fatal" },
      { type: "x" },
    ]) {
      expect(parseWorkerMessage(bad)).toBeNull();
    }
  });
});
