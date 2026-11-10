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
import { classifyLine, openDefinitions } from "./definition.js";

describe("openDefinitions", () => {
  it("counts unclosed colon definitions", () => {
    expect(openDefinitions("")).toBe(0);
    expect(openDefinitions("2 3 +")).toBe(0);
    expect(openDefinitions(": sq ( n:int -- int )")).toBe(1);
    expect(openDefinitions(": sq ( n:int -- int ) dup * ;")).toBe(0);
    expect(openDefinitions(": a ( -- ) ; : b ( -- )")).toBe(1);
  });

  it("treats a lexical error as complete so it is reported when run", () => {
    expect(openDefinitions(': a "unterminated')).toBe(0);
  });

  it("ignores colons inside strings and qualified names", () => {
    expect(openDefinitions('": " drop core:dup')).toBe(0);
  });
});

describe("classifyLine", () => {
  it("recognises meta commands only when nothing is pending", () => {
    expect(classifyLine(".help", "")).toEqual({ kind: "meta", command: ".help", args: "" });
    expect(classifyLine("  .reset  now ", "")).toEqual({
      kind: "meta",
      command: ".reset",
      args: "now",
    });
    expect(classifyLine(".help", ": a ( -- )").kind).toBe("continue");
  });

  it("continues an open definition across lines and runs it when closed", () => {
    const first = classifyLine(": sq ( n:int -- int )", "");
    expect(first).toEqual({ kind: "continue", pending: ": sq ( n:int -- int )" });
    const second = classifyLine("  dup * ;", (first as { pending: string }).pending);
    expect(second).toEqual({ kind: "run", source: ": sq ( n:int -- int )\n  dup * ;" });
  });

  it("runs a plain line", () => {
    expect(classifyLine("2 3 +", "")).toEqual({ kind: "run", source: "2 3 +" });
  });
});
