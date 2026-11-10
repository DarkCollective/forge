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
// Operations pane (UI.md section 2.3, WP 3.2): the catalogue grouped by category, favourites, fuzzy
// search, help and the way to put an operation into the recipe.
//
// Keyboard (documented here and in the shortcuts dialog):
//   Search box: type to filter; Down or Enter moves into the list; Escape clears the search.
//   List (roving focus, role listbox): Up/Down move, Home/End first/last, PageUp/PageDown by 10,
//     Enter adds the operation to the recipe, F toggles its favourite, ? shows or pins its help,
//     Escape closes the help and returns to the search box (Up from the first row does too).
//     Moving onto a row shows its help.
//   Group headers are buttons (Tab reaches them, Enter or Space folds the group).
// The row's own star, help and add buttons are pointer and touch shortcuts: they are out of the Tab
// order, because every one of them has a key above. Dragging a row (pointer) drops it on the recipe.
//
// All catalogue text is rendered as text (CSP rule 6). Help is built by `help.ts`.
import { LitElement, css, html, nothing, svg } from "lit";
import type { TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { CatalogueOp } from "@forge/ops";
import { loadCatalogue } from "../catalogue.js";
import { actions, store } from "../state/app.js";
import { beginPointerDrag } from "../state/dnd.js";
import { StoreController } from "../state/store-controller.js";
import { icons } from "../styles/icons.js";
import { baseStyles, paneStyles } from "../styles/shared.js";
import { helpFor } from "./help.js";
import { buildListModel } from "./group.js";
import type { ListModel, ListSection } from "./group.js";

const SEARCH_ID = "op-search";
const LIST_ID = "op-list";
const HELP_ID = "op-help";
const PAGE_STEP = 10;

const starIcon = (filled: boolean): TemplateResult =>
  svg`<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;

/** Inputs that every operation of the library accepts without a conversion step. */
function takesText(op: CatalogueOp): boolean {
  return op.input === "bytes" || op.input === "str";
}

@customElement("forge-operations")
export class ForgeOperations extends LitElement {
  static override styles = [
    baseStyles,
    paneStyles,
    css`
      .tools {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        flex: none;
        border-bottom: var(--border-width) solid var(--border);
      }
      .tools input {
        flex: 1;
        min-width: 0;
        width: 100%;
      }
      .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 var(--space-2) var(--space-3);
      }
      .section {
        margin-top: var(--space-2);
      }
      .group-head {
        display: flex;
        align-items: center;
        min-height: 1.75rem;
        font-size: var(--text-xs);
        font-weight: var(--weight-bold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .group-toggle {
        justify-content: flex-start;
        min-height: 1.75rem;
        min-width: 0;
        padding: 0 var(--space-1);
        border: 0;
        background: transparent;
        color: inherit;
        font-size: inherit;
        font-weight: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
      }
      .group-toggle[aria-expanded="true"] {
        background: transparent;
        border-color: transparent;
      }
      .group-toggle:hover:not(:disabled) {
        background: var(--surface-2);
      }
      .group-toggle svg {
        width: 1em;
        height: 1em;
      }
      .count {
        font-weight: var(--weight-normal);
      }
      .hint,
      .empty {
        margin: var(--space-1) var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-muted);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        min-height: var(--hit-min);
        border-radius: var(--radius-s);
      }
      .row:hover {
        background: var(--surface-2);
      }
      .opt {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-s);
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
      }
      .name {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        overflow-wrap: anywhere;
      }
      .vocab {
        font-size: var(--text-xs);
        color: var(--text-muted);
      }
      .row-hint {
        flex-basis: 100%;
        font-size: var(--text-xs);
        font-style: italic;
        color: var(--text-muted);
      }
      .row > button {
        flex: none;
        padding: 0;
        border-color: transparent;
        background: transparent;
      }
      .row > button:hover:not(:disabled) {
        background: var(--surface-3);
      }
      .row > button[aria-pressed="true"] {
        color: var(--accent);
        background: transparent;
        border-color: transparent;
      }
      .row > button[aria-expanded="true"] {
        background: var(--accent-soft);
      }
      .help[popover] {
        inset: auto;
        margin: 0;
        width: min(20rem, calc(100vw - 1rem));
        max-height: min(70vh, 30rem);
        overflow: auto;
        padding: var(--space-3);
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-m);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
        font-size: var(--text-sm);
        line-height: var(--leading-body);
      }
      .help p {
        margin: var(--space-1) 0;
        overflow-wrap: anywhere;
      }
      .help h3 {
        margin: var(--space-3) 0 var(--space-1);
        font-size: var(--text-xs);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .help code {
        font-family: var(--font-mono);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .help dl {
        margin: 0;
      }
      .help dt {
        margin-top: var(--space-2);
        font-family: var(--font-mono);
        font-weight: var(--weight-bold);
        overflow-wrap: anywhere;
      }
      .help dd {
        margin: 0 0 0 var(--space-3);
        overflow-wrap: anywhere;
      }
      .label {
        font-weight: var(--weight-bold);
      }
    `,
  ];

  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);
  private readonly favourites = new StoreController(this, store, (s) => s.favourites);

  @state() private query = "";
  @state() private collapsed: ReadonlySet<string> = new Set();
  /** Index into the visible rows of the row that holds the roving tab stop. */
  @state() private cursor = 0;
  /** Index of the row whose help is shown, or null. */
  @state() private helpIndex: number | null = null;
  /** True when the help was pinned with `?` and hover or focus must not dismiss it. */
  @state() private helpPinned = false;

  @query(`#${SEARCH_ID}`) private readonly searchEl!: HTMLInputElement | null;
  @query(`#${HELP_ID}`) private readonly helpEl!: HTMLElement | null;
  @query(".scroll") private readonly scrollEl!: HTMLElement | null;

  /** Move focus to the pane's main control (called by the shell's pane shortcuts). */
  focusPrimary(): void {
    if (this.searchEl) this.searchEl.focus();
    else this.renderRoot.querySelector<HTMLElement>("h2")?.focus();
  }

  private currentModel(): ListModel | null {
    const cat = this.catalogue.value;
    if (cat.status !== "ready") return null;
    return buildListModel(cat.catalogue.ops, this.favourites.value, this.query, this.collapsed);
  }

  protected override updated(): void {
    this.syncHelp();
  }

  protected override render() {
    const cat = this.catalogue.value;
    const model = this.currentModel();
    const count = model?.visible.length ?? 0;
    const cursor = Math.min(this.cursor, Math.max(0, count - 1));
    const helpOp =
      model !== null && this.helpIndex !== null ? model.visible[this.helpIndex] : undefined;

    return html`
      <header class="pane-head"><h2 tabindex="-1">Operations</h2></header>
      <div class="tools">
        <label class="sr-only" for=${SEARCH_ID}>Search operations</label>
        <input
          id=${SEARCH_ID}
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search by name, alias or description"
          aria-controls=${LIST_ID}
          .value=${this.query}
          @input=${this.onQueryInput}
          @keydown=${this.onSearchKey}
        />
      </div>
      <div class="scroll" @focusout=${this.onScrollFocusOut}>
        ${this.renderBody(cat.status, model, cursor)}
      </div>
      <p class="sr-only" role="status">${this.statusText(model)}</p>
      <div id=${HELP_ID} popover="manual" role="tooltip" class="help">
        ${helpOp === undefined ? nothing : this.renderHelp(helpOp)}
      </div>
    `;
  }

  private statusText(model: ListModel | null): string {
    if (model === null || model.mode !== "search") return "";
    if (model.total === 0) return `No operations match "${this.query.trim()}".`;
    return model.total === 1 ? "1 operation found." : `${model.total} operations found.`;
  }

  private renderBody(
    status: string,
    model: ListModel | null,
    cursor: number,
  ): TemplateResult | typeof nothing {
    if (status === "loading") {
      return html`<p class="empty" role="status">Loading operations...</p>`;
    }
    if (status === "error") {
      const cat = this.catalogue.value;
      const message = cat.status === "error" ? cat.message : "unknown error";
      return html`<p class="empty" role="alert">Could not load the operations: ${message}</p>
        <div class="empty">
          <button type="button" @click=${() => loadCatalogue(actions)}>Try again</button>
        </div>`;
    }
    if (model === null) return nothing;
    if (model.mode === "search" && model.visible.length === 0) {
      return html`<p class="empty">
        No operations match "${this.query.trim()}". Check the spelling, or clear the search.
      </p>`;
    }
    if (model.mode === "browse" && model.total === 0) {
      return html`<p class="empty">The catalogue has no operations.</p>`;
    }
    return html`<div id=${LIST_ID} role="listbox" aria-label="Operations">
      ${model.sections.map((section, index) => this.renderSection(section, index, cursor))}
    </div>`;
  }

  private renderSection(section: ListSection, index: number, cursor: number): TemplateResult {
    const headId = `op-section-${index}`;
    const bodyId = `op-section-body-${index}`;
    const open = !section.collapsed;
    const rows = section.ops.map((op, i) => this.renderRow(op, section.start + i, cursor));
    let body: TemplateResult | typeof nothing = nothing;
    if (open) {
      const empty =
        section.kind === "favourites" && section.ops.length === 0
          ? html`<p class="hint">Star an operation, or press F on it, to keep it here.</p>`
          : nothing;
      body = html`<div id=${bodyId} class="group-body">${empty}${rows}</div>`;
    }
    return html`<div
      class="section"
      role="group"
      aria-labelledby=${headId}
      data-kind=${section.kind}
    >
      <div class="group-head" role="presentation">
        ${
          section.collapsible
            ? html`<button
                type="button"
                class="group-toggle"
                aria-expanded=${open ? "true" : "false"}
                aria-controls=${bodyId}
                @click=${() => this.toggleSection(section.id)}
              >
                ${open ? icons.chevronDown : icons.chevronRight}
                <span id=${headId}>${section.title}</span>
                <span class="count">(${section.ops.length})</span>
              </button>`
            : html`<span id=${headId}
                >${section.title} <span class="count">(${section.ops.length})</span></span
              >`
        }
      </div>
      ${body}
    </div>`;
  }

  private renderRow(op: CatalogueOp, index: number, cursor: number): TemplateResult {
    const favourite = this.favourites.value.includes(op.qname);
    const showingHelp = this.helpIndex === index;
    return html`<div
      class="row"
      @pointerenter=${() => this.peekHelp(index)}
      @pointerleave=${() => this.leaveHelp(index)}
    >
      <div
        id=${`op-row-${index}`}
        role="option"
        class="opt"
        tabindex=${index === cursor ? "0" : "-1"}
        aria-keyshortcuts="Enter F ?"
        aria-describedby=${showingHelp ? HELP_ID : nothing}
        title=${op.qname}
        @focus=${() => this.onRowFocus(index)}
        @keydown=${(e: KeyboardEvent) => this.onRowKey(e, index, op)}
        @dblclick=${() => this.add(op)}
        @pointerdown=${(e: PointerEvent) => beginPointerDrag(e, { type: "op", op: op.qname }, op.name)}
      >
        <span class="name">${op.name}</span>
        <span class="vocab">${op.vocab}</span>
        ${takesText(op) ? nothing : html`<span class="row-hint">takes ${op.input}</span>`}
      </div>
      <button
        type="button"
        class="icon"
        tabindex="-1"
        aria-pressed=${favourite ? "true" : "false"}
        aria-label=${`${favourite ? "Remove" : "Add"} ${op.qname} ${favourite ? "from" : "to"} favourites`}
        @click=${() => this.toggleFavourite(op)}
      >
        ${starIcon(favourite)}
      </button>
      <button
        type="button"
        class="icon"
        tabindex="-1"
        aria-expanded=${showingHelp ? "true" : "false"}
        aria-controls=${HELP_ID}
        aria-label=${`Help for ${op.qname}`}
        @click=${() => this.toggleHelp(index)}
      >
        ?
      </button>
      <button
        type="button"
        class="icon"
        tabindex="-1"
        aria-label=${`Add ${op.qname} to the recipe`}
        @click=${() => this.add(op)}
      >
        ${icons.plus}
      </button>
    </div>`;
  }

  private renderHelp(op: CatalogueOp): TemplateResult {
    const h = helpFor(op);
    return html`
      <p><code>${h.qname}</code></p>
      ${h.effect === "" ? nothing : html`<p><code>${h.effect}</code></p>`}
      ${h.doc === null || h.doc === "" ? nothing : html`<p>${h.doc}</p>`}
      <p class="muted">${h.signature}</p>
      ${h.aliases === "" ? nothing : html`<p><span class="label">Aliases:</span> ${h.aliases}</p>`}
      ${h.seeAlso === "" ? nothing : html`<p><span class="label">See also:</span> ${h.seeAlso}</p>`}
      <h3>Parameters</h3>
      ${
        h.params.length === 0
          ? html`<p class="muted">No parameters.</p>`
          : html`<dl>
              ${h.params.map(
                (p) =>
                  html`<dt>${p.name}</dt>
                    <dd>${p.summary}${p.doc === null ? nothing : html`. ${p.doc}`}</dd>`,
              )}
            </dl>`
      }
    `;
  }

  // ---- actions ---------------------------------------------------------------------------------

  private readonly onQueryInput = (e: Event): void => {
    this.query = (e.target as HTMLInputElement).value;
    this.cursor = 0;
    this.helpIndex = null;
    this.helpPinned = false;
  };

  private readonly onSearchKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.query !== "") {
      e.preventDefault();
      this.clearQuery();
    } else if ((e.key === "ArrowDown" || e.key === "Enter") && !e.altKey) {
      e.preventDefault();
      this.focusRow(0);
    }
  };

  private readonly clearQuery = (): void => {
    this.query = "";
    this.cursor = 0;
    this.helpIndex = null;
    this.helpPinned = false;
    this.searchEl?.focus();
  };

  private toggleSection(id: string): void {
    const next = new Set(this.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed = next;
  }

  private add(op: CatalogueOp): void {
    actions.addOp(op.qname);
    actions.announce(`Added ${op.qname} to the recipe`);
  }

  private toggleFavourite(op: CatalogueOp): void {
    const was = store.get().favourites.includes(op.qname);
    actions.toggleFavourite(op.qname);
    actions.announce(
      was ? `Removed ${op.qname} from favourites` : `Added ${op.qname} to favourites`,
    );
  }

  private peekHelp(index: number): void {
    if (!this.helpPinned) this.helpIndex = index;
  }

  private leaveHelp(index: number): void {
    if (!this.helpPinned && this.helpIndex === index) this.helpIndex = null;
  }

  private toggleHelp(index: number): void {
    if (this.helpPinned && this.helpIndex === index) {
      this.helpPinned = false;
      this.helpIndex = null;
    } else {
      this.helpIndex = index;
      this.helpPinned = true;
    }
  }

  private onRowFocus(index: number): void {
    this.cursor = index;
    this.helpIndex = index;
  }

  /** Focus left the list: the help that followed the focus goes with it. */
  private onScrollFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget;
    if (next instanceof Node && this.scrollEl?.contains(next)) return;
    this.helpIndex = null;
    this.helpPinned = false;
  }

  private focusRow(index: number): void {
    const count = this.currentModel()?.visible.length ?? 0;
    if (count === 0) return;
    const target = Math.min(Math.max(0, index), count - 1);
    this.cursor = target;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(`#op-row-${target}`)?.focus();
    });
  }

  private onRowKey(e: KeyboardEvent, index: number, op: CatalogueOp): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const count = this.currentModel()?.visible.length ?? 0;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.focusRow(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (index === 0) this.searchEl?.focus();
        else this.focusRow(index - 1);
        break;
      case "Home":
        e.preventDefault();
        this.focusRow(0);
        break;
      case "End":
        e.preventDefault();
        this.focusRow(count - 1);
        break;
      case "PageDown":
        e.preventDefault();
        this.focusRow(index + PAGE_STEP);
        break;
      case "PageUp":
        e.preventDefault();
        this.focusRow(index - PAGE_STEP);
        break;
      case "Enter":
        e.preventDefault();
        this.add(op);
        break;
      case "f":
      case "F":
        e.preventDefault();
        this.toggleFavourite(op);
        break;
      case "?":
        e.preventDefault();
        this.toggleHelp(index);
        break;
      case "Escape":
        // Leaves the list for the search box (closing any help); a second Escape clears the search.
        e.preventDefault();
        this.helpIndex = null;
        this.helpPinned = false;
        this.searchEl?.focus();
        break;
      default:
        break;
    }
  }

  /** Show or hide the help popover to match `helpIndex`, and place it beside its row. */
  private syncHelp(): void {
    const el = this.helpEl;
    if (!el) return;
    const model = this.currentModel();
    const index = this.helpIndex;
    const row =
      model !== null && index !== null && index < model.visible.length
        ? this.renderRoot.querySelector<HTMLElement>(`#op-row-${index}`)?.closest(".row")
        : null;
    if (!(row instanceof HTMLElement)) {
      if (el.matches(":popover-open")) el.hidePopover();
      return;
    }
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      return;
    }
    const rect = row.getBoundingClientRect();
    const height = el.offsetHeight;
    const width = el.offsetWidth;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    el.style.setProperty("top", `${top}px`);
    el.style.setProperty("left", `${left}px`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-operations": ForgeOperations;
  }
}
