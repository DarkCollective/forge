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
// Inline SVG icons (24x24, stroked with currentColor). Decorative: always `aria-hidden`; the button
// that holds one carries the accessible name. No external assets, so the CSP needs nothing for them.
import { svg } from "lit";
import type { TemplateResult } from "lit";

function icon(paths: TemplateResult): TemplateResult {
  return svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export const icons = {
  menu: icon(svg`<path d="M4 6h16M4 12h16M4 18h16"/>`),
  more: icon(
    svg`<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`,
  ),
  share: icon(
    svg`<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>`,
  ),
  save: icon(svg`<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>`),
  open: icon(
    svg`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
  ),
  code: icon(svg`<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>`),
  terminal: icon(svg`<path d="M4 5h16v14H4z"/><path d="M8 10l3 2-3 2M13 15h4"/>`),
  sun: icon(
    svg`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  ),
  moon: icon(svg`<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>`),
  contrast: icon(
    svg`<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>`,
  ),
  monitor: icon(svg`<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>`),
  plus: icon(svg`<path d="M12 5v14M5 12h14"/>`),
  close: icon(svg`<path d="M6 6l12 12M18 6L6 18"/>`),
  chevronRight: icon(svg`<path d="M9 6l6 6-6 6"/>`),
  chevronDown: icon(svg`<path d="M6 9l6 6 6-6"/>`),
  chevronUp: icon(svg`<path d="M6 15l6-6 6 6"/>`),
  trash: icon(svg`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`),
  copy: icon(
    svg`<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>`,
  ),
  play: icon(svg`<path d="M7 4l13 8-13 8z" fill="currentColor"/>`),
  step: icon(svg`<path d="M5 4l10 8-10 8z" fill="currentColor"/><path d="M19 4v16"/>`),
  stop: icon(svg`<rect x="6" y="6" width="12" height="12" fill="currentColor"/>`),
  panelLeft: icon(svg`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16"/>`),
  search: icon(svg`<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`),
  keyboard: icon(
    svg`<rect x="2" y="6" width="20" height="12" rx="1"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>`,
  ),
};

/** The Forge mark: an anvil face with a spark. Decorative. */
export const brandMark = svg`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M7 20h18v-3.5H17.5c-1 0-1.5-.6-1.5-1.5V13h-3.2c-3 0-5.8 1.9-5.8 5z" fill="var(--accent-fg)"/><path d="M12 22.5h10V25H12z" fill="var(--accent-fg)"/><path d="M22 6l.9 2.6L25.5 9.5l-2.6.9L22 13l-.9-2.6-2.6-.9 2.6-.9z" fill="var(--accent-fg)"/></svg>`;
