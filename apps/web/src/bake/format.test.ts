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
import { IDLE_BAKE } from "../state/actions.js";
import { describeValue, formatMs, shortcutAction, statusText, stepLabel } from "./format.js";

describe("stepLabel", () => {
  it("numbers steps from one", () => {
    expect(stepLabel("/steps/2")).toBe("3");
    expect(stepLabel("/steps/1/steps/0")).toBe("2.1");
    expect(stepLabel("/steps/2/then/0")).toBe("3.then.1");
    expect(stepLabel("/steps/0/else/4")).toBe("1.else.5");
  });
});

describe("describeValue", () => {
  it("summarises values as plain text", () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(describeValue({ kind: "bytes", bytes: bytes("Hi"), text: "Hi" })).toBe('2 bytes: "Hi"');
    expect(describeValue({ kind: "bytes", bytes: new Uint8Array(0), text: "" })).toBe(
      "empty bytes",
    );
    expect(describeValue({ kind: "bytes", bytes: Uint8Array.of(255, 0, 1), text: null })).toBe(
      "3 bytes: hex ff0001",
    );
    expect(describeValue({ kind: "int", text: "42" })).toBe("int 42");
    expect(describeValue({ kind: "list", items: [], total: 3 })).toBe("list of 3");
    expect(describeValue({ kind: "bytes", bytes: bytes("a\nb"), text: "a\nb" })).toBe(
      '3 bytes: "a b"',
    );
  });

  it("clips long text", () => {
    const long = "x".repeat(100);
    const out = describeValue({ kind: "str", text: long }, 10);
    expect(out).toBe(`str "${"x".repeat(9)}…"`);
  });
});

describe("statusText", () => {
  it("renders every status", () => {
    expect(statusText(IDLE_BAKE)).toBe("Ready");
    expect(statusText(IDLE_BAKE, { autoBake: false })).toBe("Ready. Press Bake.");
    expect(statusText({ ...IDLE_BAKE, status: "queued" })).toBe("Waiting to bake…");
    expect(statusText({ ...IDLE_BAKE, status: "baking", progress: { done: 1, total: 4 } })).toBe(
      "Baking… (2 of 4)",
    );
    expect(statusText({ ...IDLE_BAKE, status: "done", elapsedMs: 12 })).toBe("Baked in 12 ms");
    expect(statusText({ ...IDLE_BAKE, status: "cancelled" })).toBe("Cancelled");
    expect(
      statusText({
        ...IDLE_BAKE,
        status: "paused",
        paused: { path: "/steps/2", reason: "step", data: { kind: "bool", value: true } },
      }),
    ).toBe("Paused at step 3");
  });
});

describe("formatMs and shortcuts", () => {
  it("formats durations", () => {
    expect(formatMs(0.2)).toBe("<1 ms");
    expect(formatMs(12.4)).toBe("12 ms");
    expect(formatMs(2500)).toBe("2.50 s");
  });

  it("maps F10 and F8 only while paused and outside fields", () => {
    expect(shortcutAction("F10", true, false)).toBe("step");
    expect(shortcutAction("F8", true, false)).toBe("continue");
    expect(shortcutAction("F10", false, false)).toBeNull();
    expect(shortcutAction("F10", true, true)).toBeNull();
    expect(shortcutAction("a", true, false)).toBeNull();
  });
});
