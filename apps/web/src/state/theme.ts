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
// Themes (UI.md section 1.2): light, dark, high-contrast and "system". The page carries the
// resolved theme in `<html data-theme="light|dark|contrast">`; tokens.css does the rest.
import { safeStorage } from "./layout.js";
import type { ResolvedTheme, ThemePreference } from "./types.js";

export const THEME_STORAGE_KEY = "forge.theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
  "contrast",
];

export function isThemePreference(v: unknown): v is ThemePreference {
  return typeof v === "string" && (THEME_PREFERENCES as readonly string[]).includes(v);
}

/** "system" follows `prefers-contrast: more` first, then `prefers-color-scheme`. */
export function resolveTheme(
  pref: ThemePreference,
  prefersDark: boolean,
  prefersMoreContrast: boolean,
): ResolvedTheme {
  if (pref !== "system") return pref;
  if (prefersMoreContrast) return "contrast";
  return prefersDark ? "dark" : "light";
}

export function loadThemePreference(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): ThemePreference {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function saveThemePreference(
  pref: ThemePreference,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Not remembered; the theme still applies for this visit.
  }
}

export function systemTheme(): ResolvedTheme {
  return resolveTheme(
    "system",
    matchMedia("(prefers-color-scheme: dark)").matches,
    matchMedia("(prefers-contrast: more)").matches,
  );
}

export function resolveCurrent(pref: ThemePreference): ResolvedTheme {
  return resolveTheme(
    pref,
    matchMedia("(prefers-color-scheme: dark)").matches,
    matchMedia("(prefers-contrast: more)").matches,
  );
}

export function applyTheme(
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute("data-theme", theme);
}
