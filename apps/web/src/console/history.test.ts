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
import { CommandHistory } from "./history.js";

describe("CommandHistory", () => {
  it("walks back and forth and restores the draft", () => {
    const h = new CommandHistory();
    h.push("1 2 +");
    h.push("dup");
    expect(h.previous("draft")).toBe("dup");
    expect(h.previous("ignored")).toBe("1 2 +");
    expect(h.previous("ignored")).toBeUndefined();
    expect(h.next()).toBe("dup");
    expect(h.next()).toBe("draft");
    expect(h.next()).toBeUndefined();
  });

  it("skips blank lines and immediate repeats", () => {
    const h = new CommandHistory();
    h.push("  ");
    h.push("a");
    h.push("a");
    expect(h.size).toBe(1);
  });

  it("is bounded", () => {
    const h = new CommandHistory(3);
    for (const l of ["1", "2", "3", "4"]) h.push(l);
    expect(h.size).toBe(3);
    expect(h.previous("")).toBe("4");
    expect(h.previous("")).toBe("3");
    expect(h.previous("")).toBe("2");
    expect(h.previous("")).toBeUndefined();
  });

  it("returns to the end after a push", () => {
    const h = new CommandHistory();
    h.push("a");
    h.previous("");
    h.push("b");
    expect(h.previous("")).toBe("b");
  });
});
