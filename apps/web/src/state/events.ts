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
// Names and payloads of the DOM CustomEvents that components exchange (UI.md section 3.3). State
// changes go through the store; events exist only for things that are not state: a user gesture on a
// widget, addressed to its parent. All events bubble and are composed, so they cross shadow roots.

export const FORGE_EVENTS = {
  /** forge-splitter -> shell: the size changed. */
  splitterChange: "forge-splitter-change",
  /** forge-splitter -> shell: collapse or expand was requested. */
  splitterToggle: "forge-splitter-toggle",
  /** forge-menu -> its parent: an item was chosen. */
  menuSelect: "forge-menu-select",
  /** anything -> shell: please move focus into a pane (the pane's `focusPrimary()`, or the pane itself). */
  focusPane: "forge-focus-pane",
} as const;

export interface SplitterChangeDetail {
  /** New size in the splitter's units. */
  readonly value: number;
  readonly source: "pointer" | "keyboard";
}

export interface MenuSelectDetail {
  readonly id: string;
}

export interface FocusPaneDetail {
  readonly pane: "ops" | "recipe" | "input" | "output" | "console";
}

declare global {
  interface HTMLElementEventMap {
    "forge-splitter-change": CustomEvent<SplitterChangeDetail>;
    "forge-splitter-toggle": CustomEvent<void>;
    "forge-menu-select": CustomEvent<MenuSelectDetail>;
    "forge-focus-pane": CustomEvent<FocusPaneDetail>;
  }
}

export function emit<T>(target: EventTarget, name: string, detail: T): boolean {
  return target.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
}
