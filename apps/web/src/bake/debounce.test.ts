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
import { createDebouncer } from "./debounce.js";
import { fakeTimers } from "./fake-timers.js";

describe("createDebouncer", () => {
  it("fires once after the last call", () => {
    const t = fakeTimers();
    let n = 0;
    const d = createDebouncer(() => n++, 300, t);
    d.schedule();
    t.advance(200);
    d.schedule();
    t.advance(200);
    expect(n).toBe(0);
    expect(d.pending).toBe(true);
    t.advance(100);
    expect(n).toBe(1);
    expect(d.pending).toBe(false);
  });

  it("reads the delay at schedule time", () => {
    const t = fakeTimers();
    let ms = 100;
    let n = 0;
    const d = createDebouncer(
      () => n++,
      () => ms,
      t,
    );
    d.schedule();
    t.advance(100);
    expect(n).toBe(1);
    ms = 500;
    d.schedule();
    t.advance(499);
    expect(n).toBe(1);
    t.advance(1);
    expect(n).toBe(2);
  });

  it("cancel drops the call and flush runs it now", () => {
    const t = fakeTimers();
    let n = 0;
    const d = createDebouncer(() => n++, 50, t);
    d.schedule();
    d.cancel();
    t.advance(100);
    expect(n).toBe(0);
    d.flush();
    expect(n).toBe(0);
    d.schedule();
    d.flush();
    expect(n).toBe(1);
    t.advance(100);
    expect(n).toBe(1);
  });

  it("treats a negative delay as immediate", () => {
    const t = fakeTimers();
    let n = 0;
    const d = createDebouncer(() => n++, -5, t);
    d.schedule();
    t.advance(0);
    expect(n).toBe(1);
  });
});
