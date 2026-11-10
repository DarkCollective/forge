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
import { svg } from "lit";
import type { TemplateResult } from "lit";

function icon(paths: TemplateResult): TemplateResult {
  return svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** Icons the recipe pane needs beyond `styles/icons.ts` (which the shell owns). Decorative. */
export const recipeIcons = {
  grip: icon(
    svg`<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>`,
  ),
  eye: icon(
    svg`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  ),
  eyeOff: icon(
    svg`<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 4M6.3 6.4A16 16 0 0 0 2 12s4 7 10 7a9.5 9.5 0 0 0 4-.9"/>`,
  ),
  breakpoint: icon(svg`<circle cx="12" cy="12" r="6" fill="currentColor"/>`),
  note: icon(svg`<path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5M8 9h8M8 13h4"/>`),
  indent: icon(svg`<path d="M4 6h16M12 12h8M4 18h16M4 9l3 3-3 3"/>`),
  outdent: icon(svg`<path d="M4 6h16M12 12h8M4 18h16M8 9l-3 3 3 3"/>`),
  undo: icon(svg`<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`),
  redo: icon(svg`<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>`),
  eraser: icon(svg`<path d="M20 20H9L4 15l10-10 6 6-7 7"/><path d="M8 11l6 6"/>`),
} as const;
