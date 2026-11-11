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
 * Tests for the shared `clock` vocabulary (vocab/clock.fth, src/prims/clock.ts): `clock:now-ms`, `clock:now-s`
 * and the Get Time op `clock:get-time`. The clock is faked, so the values are exact.
 */
import { valueHelpers } from "@forge/lang";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assembleRuntime } from "./bundle.js";
import { loadBundleNode } from "./sources-node.js";

const { bytes, str } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["clock"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const top = (r: Result) => (r.ok ? (r.stack[r.stack.length - 1] as { v: unknown }).v : undefined);

// 2026-11-11T12:34:56.789Z
const T = Date.UTC(2026, 10, 11, 12, 34, 56, 789);

afterEach(() => {
  vi.useRealTimers();
});

describe("clock", () => {
  test("now-ms is the host clock in milliseconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    expect(top(await runtime.call("clock:now-ms", []))).toBe(1_794_400_496_789);
    expect(top(await runtime.call("clock:now-ms", []))).toBe(T);
  });

  test("now-s is the whole seconds, rounded down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    expect(top(await runtime.call("clock:now-s", []))).toBe(1_794_400_496);
    vi.setSystemTime(999);
    expect(top(await runtime.call("clock:now-s", []))).toBe(0);
  });

  test("the words carry the +time effect, and none is a catalogue op", () => {
    for (const w of ["clock:now-ms", "clock:now-s", "clock:get-time"]) {
      expect(runtime.meta(w).effects).toContain("+time");
    }
  });

  test.each([
    ["seconds", "1794400496"],
    ["milliseconds", "1794400496789"],
    ["microseconds", "1794400496789000"],
    ["nanoseconds", "1794400496789000000"],
  ])("get-time in %s", async (unit, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const r = await runtime.call("clock:get-time", [bytes(new Uint8Array(0)), str(unit)]);
    expect(top(r)).toBe(expected);
  });

  test("get-time ignores its input", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const r = await runtime.call("clock:get-time", [
      bytes(Uint8Array.of(1, 2, 3)),
      str("milliseconds"),
    ]);
    expect(top(r)).toBe("1794400496789");
  });

  test("a unit that is not in the list is an error", async () => {
    const r = await runtime.call("clock:get-time", [bytes(new Uint8Array(0)), str("fortnights")]);
    expect(code(r)).not.toBe("ok");
  });

  test("the real clock is close to Date.now()", async () => {
    const before = Date.now();
    const v = top(await runtime.call("clock:now-ms", [])) as number;
    expect(v).toBeGreaterThanOrEqual(before);
    expect(v).toBeLessThanOrEqual(Date.now());
  });
});
