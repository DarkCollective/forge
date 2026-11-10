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
// Styles every component adopts (UI.md section 1.2). Lit turns `static styles` into constructable
// stylesheets (adoptedStyleSheets), which the production CSP (`style-src 'self'`) allows.
//
//     static override styles = [baseStyles, paneStyles, css`...`];
import { css } from "lit";

/** Reset, focus ring, buttons, inputs. Every component includes this first. */
export const baseStyles = css`
  :host {
    box-sizing: border-box;
    font-family: var(--font-ui);
    font-size: var(--text-md);
    line-height: var(--leading-body);
    color: var(--text);
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  [hidden] {
    display: none !important;
  }
  :focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  h1,
  h2,
  h3 {
    margin: 0;
    line-height: var(--leading-tight);
  }
  a {
    color: var(--link);
  }
  button,
  .btn {
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    min-height: var(--hit-min);
    min-width: var(--hit-min);
    padding: 0 var(--space-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-m);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    text-decoration: none;
    transition: background var(--motion);
  }
  button:hover:not(:disabled),
  .btn:hover {
    background: var(--surface-2);
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  button[aria-pressed="true"],
  button[aria-expanded="true"] {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button.ghost {
    border-color: transparent;
    background: transparent;
  }
  button.ghost:hover:not(:disabled) {
    background: var(--surface-2);
  }
  button.icon {
    padding: 0;
  }
  button svg,
  .btn svg {
    width: 1.15em;
    height: 1.15em;
    flex: none;
  }
  input,
  select,
  textarea {
    font: inherit;
    font-size: var(--text-sm);
    color: var(--text);
    background: var(--surface);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-s);
    min-height: var(--hit-min);
    padding: 0 var(--space-2);
  }
  textarea {
    padding: var(--space-2);
  }
  input::placeholder {
    color: var(--text-muted);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
  @media (forced-colors: active) {
    button,
    input,
    select,
    textarea {
      border-color: ButtonText;
    }
    button[aria-pressed="true"] {
      background: Highlight;
      color: HighlightText;
    }
  }
`;

/**
 * The frame of a pane: a column with a header bar (title + tools) and a scrolling body. A pane
 * element renders `<header class="pane-head"><h2>Title</h2> ...tools</header><div class="pane-body">`.
 */
export const paneStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    background: var(--surface);
  }
  .pane-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-3);
    border-bottom: var(--border-width) solid var(--border);
    background: var(--surface-2);
    flex: none;
  }
  .pane-head h2 {
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-inline-end: auto;
  }
  .pane-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
  }
  .pill {
    display: inline-block;
    padding: 0 var(--space-2);
    border-radius: 999px;
    font-size: var(--text-xs);
    border: var(--border-width) solid var(--border-strong);
    color: var(--text-muted);
  }
`;
