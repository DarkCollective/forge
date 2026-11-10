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
import { css } from "lit";

/** Styles of the recipe pane. Tokens only; no inline style attributes anywhere (UI.md section 4). */
export const recipeStyles = css`
  .pane-head {
    flex-wrap: wrap;
  }
  forge-menu svg {
    width: 1.15em;
    height: 1.15em;
  }
  forge-menu span[slot="trigger"] {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pane-head .group {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .pane-body {
    background: var(--bg);
  }
  ol.steps {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li.step {
    position: relative;
    padding-block-start: var(--space-4);
  }
  li.step:first-child {
    padding-block-start: 0;
  }
  /* The connector joining one card to the next, with an arrow head. */
  li.step:not(:first-child)::before {
    content: "";
    position: absolute;
    inset-block-start: var(--space-1);
    inset-inline-start: 1.5rem;
    width: 2px;
    height: calc(var(--space-4) - var(--space-1) - 6px);
    background: var(--border-strong);
  }
  li.step:not(:first-child)::after {
    content: "";
    position: absolute;
    inset-block-start: calc(var(--space-4) - 7px);
    inset-inline-start: calc(1.5rem - 4px);
    border-inline: 5px solid transparent;
    border-block-start: 7px solid var(--border-strong);
  }
  /* Drop indicator: a bar above the item, or below the last one. Drawn over the connector. */
  li.step.drop-before > .drop-bar,
  .lane.drop-end > ol > li.step:last-child > .drop-bar-end {
    display: block;
  }
  .drop-bar,
  .drop-bar-end {
    display: none;
    position: absolute;
    inset-inline: 0;
    height: 4px;
    border-radius: 2px;
    background: var(--drop);
    pointer-events: none;
    forced-color-adjust: none;
  }
  .drop-bar {
    inset-block-start: calc(var(--space-4) / 2 - 2px);
  }
  li.step:first-child > .drop-bar {
    inset-block-start: -2px;
  }
  .drop-bar-end {
    inset-block-end: calc(var(--space-4) / -2 - 2px);
  }
  @media (forced-colors: active) {
    .drop-bar,
    .drop-bar-end {
      background: Highlight;
    }
  }

  .card {
    background: var(--surface);
    border: var(--border-width) solid var(--border-strong);
    border-inline-start: 4px solid var(--border-strong);
    border-radius: var(--radius-m);
    box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
  }
  .card.op {
    border-inline-start-color: var(--accent);
  }
  .card.comment {
    background: var(--surface-2);
    border-style: dashed;
    border-inline-start-style: solid;
  }
  .card.selected {
    background: var(--accent-soft);
  }
  .card.disabled > .card-head,
  .card.disabled > .card-body {
    opacity: 0.6;
  }
  .card.failed {
    border-color: var(--danger);
    border-inline-start-color: var(--danger);
    border-width: 2px;
    border-inline-start-width: 4px;
  }
  .card.running,
  .card.paused {
    border-color: var(--accent);
    border-width: 2px;
    border-inline-start-width: 4px;
  }
  .card.lifted {
    outline: 3px dashed var(--drop);
    outline-offset: 2px;
  }
  .card.drag-source {
    opacity: 0.45;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    padding: var(--space-2) var(--space-3) 0;
  }
  .num {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    min-width: 1.6rem;
    padding: 0 var(--space-2);
    text-align: center;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--text);
  }
  .title {
    font-weight: var(--weight-bold);
    overflow-wrap: anywhere;
  }
  .vocab {
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-inline-start: auto;
  }
  .chip {
    font-size: var(--text-xs);
    padding: 0 var(--space-2);
    border-radius: 999px;
    border: var(--border-width) solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    white-space: nowrap;
  }
  .chip.error,
  .chip.fail {
    background: var(--danger-soft);
    border-color: var(--danger);
    color: var(--danger);
  }
  .chip.warning {
    background: var(--warn-soft);
    border-color: var(--warn);
    color: var(--warn);
  }
  .chip.run,
  .chip.pause {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .chip.time.stale {
    opacity: 0.6;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
  }
  .toolbar button {
    min-width: 2rem;
    padding: 0;
  }
  .toolbar button[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  :host([dragging]) {
    user-select: none;
  }
  .toolbar button.handle {
    cursor: grab;
    touch-action: none;
  }
  .toolbar button.handle[aria-pressed="true"] {
    background: var(--drop);
    color: var(--bg);
    border-color: var(--drop);
  }
  .card-body {
    padding: 0 var(--space-3) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .summary {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* fields */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .field > label,
  fieldset legend,
  .field .label {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    color: var(--text-muted);
    padding: 0;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    align-items: flex-end;
  }
  .row > .field {
    flex: 1 1 8rem;
  }
  .inline-checks {
    display: flex;
    gap: var(--space-3);
    min-height: var(--hit-min);
    align-items: center;
  }
  .inline-checks label {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--text-sm);
  }
  input[type="checkbox"] {
    min-height: 0;
    width: 1.1rem;
    height: 1.1rem;
  }
  .field input,
  .field select,
  .field textarea {
    width: 100%;
  }
  .field textarea {
    min-height: 3.5rem;
    resize: vertical;
    font-family: inherit;
  }
  .field .mono {
    font-family: var(--font-mono);
  }
  .field [aria-invalid="true"] {
    border-color: var(--danger);
    border-width: 2px;
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  ul.issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  ul.issues li {
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-s);
    border-inline-start: 4px solid var(--danger);
    background: var(--danger-soft);
    overflow-wrap: anywhere;
  }
  ul.issues li.warning {
    border-inline-start-color: var(--warn);
    background: var(--warn-soft);
  }
  ul.issues .sev {
    font-weight: var(--weight-bold);
  }
  .bake-error {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    border-radius: var(--radius-s);
    border-inline-start: 4px solid var(--danger);
    background: var(--danger-soft);
    overflow-wrap: anywhere;
  }

  /* nested lanes */
  .lane {
    border-radius: var(--radius-m);
  }
  .lane.nested {
    margin-block-start: var(--space-1);
    margin-inline-start: var(--space-3);
    padding: var(--space-2);
    border-inline-start: 2px solid var(--border-strong);
    background: var(--bg);
    min-height: 2.5rem;
  }
  .lane-title {
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-block-end: var(--space-2);
  }
  .lane-empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-s);
  }
  .lane.drop-active > .lane-empty {
    border-color: var(--drop);
    border-style: solid;
    color: var(--text);
  }
  :host([dragging]) .lane.nested {
    outline: 1px dashed var(--drop);
  }
  .empty-state {
    padding: var(--space-4);
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-m);
    color: var(--text-muted);
  }
  .empty-state p {
    margin: 0 0 var(--space-2);
  }
  .empty-state p:last-child {
    margin: 0;
  }
  .lane.root {
    min-height: 100%;
  }
`;
