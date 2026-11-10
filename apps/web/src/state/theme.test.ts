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
import {
  THEME_STORAGE_KEY,
  isThemePreference,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
} from "./theme.js";

describe("theme", () => {
  it("resolves explicit choices as they are", () => {
    expect(resolveTheme("light", true, true)).toBe("light");
    expect(resolveTheme("dark", false, false)).toBe("dark");
    expect(resolveTheme("contrast", false, false)).toBe("contrast");
  });

  it("resolves system by contrast first, then colour scheme", () => {
    expect(resolveTheme("system", false, false)).toBe("light");
    expect(resolveTheme("system", true, false)).toBe("dark");
    expect(resolveTheme("system", true, true)).toBe("contrast");
  });

  it("validates and persists the preference", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    expect(loadThemePreference(storage)).toBe("system");
    saveThemePreference("dark", storage);
    expect(mem.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(loadThemePreference(storage)).toBe("dark");
    mem.set(THEME_STORAGE_KEY, "garbage");
    expect(loadThemePreference(storage)).toBe("system");
  });
});
