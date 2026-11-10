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
import { escapeText, toggleFlag, unescapeText } from "./fields.js";

describe("escapeText", () => {
  it("round-trips awkward values", () => {
    for (const s of ["", "\n", "a\r\nb\t", "\\n", "\\", "x\\\\y", "plain", "é\u0000"]) {
      expect(unescapeText(escapeText(s))).toBe(s);
    }
  });
  it("shows control characters as escapes", () => {
    expect(escapeText("a\nb")).toBe("a\\nb");
    expect(escapeText("\\")).toBe("\\\\");
  });
  it("keeps unknown escapes and a trailing backslash", () => {
    expect(unescapeText("\\q")).toBe("\\q");
    expect(unescapeText("ab\\")).toBe("ab\\");
    expect(unescapeText("\\n")).toBe("\n");
  });
});

describe("toggleFlag", () => {
  it("keeps the canonical order and drops empties", () => {
    expect(toggleFlag(undefined, "s", true)).toBe("s");
    expect(toggleFlag("s", "i", true)).toBe("is");
    expect(toggleFlag("ims", "m", false)).toBe("is");
    expect(toggleFlag("i", "i", false)).toBeUndefined();
  });
});
