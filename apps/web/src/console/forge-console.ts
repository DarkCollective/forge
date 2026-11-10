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
import { LitElement, css, html, nothing } from "lit";
import { customElement, query } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, paneStyles } from "../styles/shared.js";
import { store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { ConsoleController, ConsoleViewState } from "./controller.js";
import { getConsoleController } from "./instance.js";

/**
 * Console pane (UI.md section 5): an FL read-eval-print loop over the console worker. Everything shown
 * is text (`${...}` bindings): output, errors, metadata and source never reach HTML.
 */
@customElement("forge-console")
export class ForgeConsole extends LitElement {
  static override styles = [
    baseStyles,
    paneStyles,
    css`
      .pane-body {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        overflow: hidden;
      }
      .scrollback {
        flex: 1;
        min-height: 3rem;
        overflow: auto;
        margin: 0;
        padding: var(--space-2);
        background: var(--bg);
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-s);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
      }
      .entry {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .entry.input .prompt {
        color: var(--accent);
        user-select: none;
      }
      .entry.error {
        color: var(--danger);
      }
      .entry.info {
        color: var(--text-muted);
      }
      .stack {
        display: flex;
        gap: var(--space-2);
        align-items: baseline;
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        padding: var(--space-1) var(--space-2);
        background: var(--surface-2);
        border-radius: var(--radius-s);
        overflow-x: auto;
        white-space: pre;
      }
      .stack .label {
        font-family: var(--font-ui);
        color: var(--text-muted);
        font-weight: var(--weight-bold);
        font-size: var(--text-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .line {
        display: flex;
        gap: var(--space-2);
        align-items: center;
      }
      .line label {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        color: var(--accent);
        white-space: nowrap;
      }
      .line input {
        flex: 1;
        min-width: 0;
        font-family: var(--font-mono);
      }
      .tools {
        display: flex;
        gap: var(--space-2);
        align-items: center;
      }
      .tools select {
        max-width: 10rem;
      }
      details.inspector {
        flex: none;
        max-height: 40%;
        overflow: auto;
      }
      details.inspector summary {
        cursor: pointer;
        font-size: var(--text-sm);
        font-weight: var(--weight-bold);
        color: var(--text-muted);
        min-height: var(--hit-min);
        display: flex;
        align-items: center;
      }
      .inspect-form {
        display: flex;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
      }
      .inspect-form input {
        flex: 1;
        min-width: 0;
        font-family: var(--font-mono);
      }
      .inspect-out h3 {
        font-size: var(--text-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        margin-top: var(--space-2);
      }
      pre.block {
        margin: 0;
        padding: var(--space-2);
        background: var(--bg);
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-s);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .err {
        color: var(--danger);
      }
    `,
  ];

  private readonly controller: ConsoleController = getConsoleController();
  private view: ConsoleViewState = this.controller.getState();
  private unsubscribe: (() => void) | undefined;
  // Re-render when the catalogue changes: the inspector's word list follows it.
  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);

  @query("input.cmd") private cmd?: HTMLInputElement;
  @query(".scrollback") private scrollback?: HTMLElement;

  override connectedCallback(): void {
    super.connectedCallback();
    this.view = this.controller.getState();
    this.unsubscribe = this.controller.subscribe(() => {
      const before = this.view.entries.length;
      this.view = this.controller.getState();
      this.requestUpdate();
      if (this.view.entries.length !== before) void this.scrollToEnd();
    });
    this.controller.start();
  }

  override disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    super.disconnectedCallback();
  }

  /** Move focus to the input line (called by the shell's pane shortcuts). */
  focusPrimary(): void {
    (this.cmd ?? this.renderRoot.querySelector<HTMLElement>("h2"))?.focus();
  }

  private async scrollToEnd(): Promise<void> {
    await this.updateComplete;
    const el = this.scrollback;
    if (el) el.scrollTop = el.scrollHeight;
  }

  private onKeydown(e: KeyboardEvent): void {
    const input = e.currentTarget as HTMLInputElement;
    const history = this.controller.history;
    if (e.key === "Enter") {
      e.preventDefault();
      if (this.view.busy) return;
      const line = input.value;
      input.value = "";
      void this.controller.submit(line);
    } else if (e.key === "ArrowUp" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const previous = history.previous(input.value);
      if (previous !== undefined) {
        e.preventDefault();
        input.value = previous;
        input.setSelectionRange(previous.length, previous.length);
      }
    } else if (e.key === "ArrowDown" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const next = history.next();
      if (next !== undefined) {
        e.preventDefault();
        input.value = next;
        input.setSelectionRange(next.length, next.length);
      }
    } else if (e.key === "Escape") {
      if (this.view.pending !== "") {
        e.preventDefault();
        e.stopPropagation();
        this.controller.cancelPending();
      } else if (this.view.busy) {
        e.preventDefault();
        e.stopPropagation();
        this.controller.stop();
      }
    }
  }

  private onInspect(e: Event): void {
    e.preventDefault();
    const input = this.renderRoot.querySelector<HTMLInputElement>("input.word");
    if (input) void this.controller.inspect(input.value);
  }

  private wordNames(): string[] {
    const c = this.catalogue.value;
    return c.status === "ready" ? c.catalogue.ops.map((o) => o.qname) : [];
  }

  private renderEntry(entry: ConsoleViewState["entries"][number]) {
    return html`<p class="entry ${entry.kind}">
      ${entry.prompt !== undefined ? html`<span class="prompt">${entry.prompt} </span>` : nothing}${entry.text}
    </p>`;
  }

  private renderInspector() {
    const i = this.view.inspector;
    return html`<details class="inspector">
      <summary>Word inspector</summary>
      <form class="inspect-form" @submit=${(e: Event) => this.onInspect(e)}>
        <label class="sr-only" for="inspect-word">Word name</label>
        <input
          id="inspect-word"
          class="word"
          list="forge-console-words"
          placeholder="word or vocab:word"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          .value=${i.qname}
        />
        <datalist id="forge-console-words">
          ${this.wordNames().map((n) => html`<option value=${n}></option>`)}
        </datalist>
        <button type="submit">Inspect</button>
      </form>
      <div class="inspect-out" aria-live="polite">
        ${i.status === "loading" ? html`<p class="muted">Looking up ${i.qname}...</p>` : nothing}
        ${i.status === "error" ? html`<p class="err">${i.error}</p>` : nothing}
        ${
          i.status === "done"
            ? html`<h3>Metadata</h3>
                <pre class="block">${i.meta}</pre>
                ${
                  i.help !== ""
                    ? html`<h3>Help</h3>
                        <pre class="block">${i.help}</pre>`
                    : nothing
                }
                <h3>Source</h3>
                <pre class="block">${i.source}</pre>`
            : nothing
        }
      </div>
    </details>`;
  }

  protected override render() {
    const v = this.view;
    const prompt = v.pending === "" ? `${v.vocab}>` : "...";
    return html`
      <header class="pane-head">
        <h2 tabindex="-1">Console</h2>
        <label class="sr-only" for="vocab-picker">Current vocabulary</label>
        <div class="tools">
          <select
            id="vocab-picker"
            title="Current vocabulary (VOCAB x)"
            ?disabled=${v.busy || v.starting || v.vocabs.length === 0}
            @change=${(e: Event) => void this.controller.setVocab((e.target as HTMLSelectElement).value)}
          >
            ${
              v.vocabs.length === 0
                ? html`<option>${v.vocab}</option>`
                : v.vocabs.map(
                    (n) => html`<option value=${n} ?selected=${n === v.vocab}>VOCAB ${n}</option>`,
                  )
            }
          </select>
          <button ?hidden=${!v.busy} @click=${() => this.controller.stop()}>Stop</button>
          <button ?disabled=${v.busy} @click=${() => void this.controller.reset()}>
            Reset session
          </button>
          <button ?disabled=${v.entries.length === 0} @click=${() => this.controller.clear()}>
            Clear
          </button>
        </div>
      </header>
      <div class="pane-body">
        <div class="scrollback" role="log" aria-live="off" aria-label="Console output" tabindex="0">
          ${v.starting && v.entries.length === 0 ? html`<p class="entry info">Starting the console...</p>` : nothing}
          ${repeat(
            v.entries,
            (e) => e.id,
            (e) => this.renderEntry(e),
          )}
        </div>
        <div class="stack" aria-label="Stack" role="group">
          <span class="label">Stack</span>
          <span class="mono">${v.stack.length === 0 ? "(empty)" : v.stack.join("  ")}</span>
        </div>
        <div class="line">
          <label for="cmd">${prompt}</label>
          <input
            id="cmd"
            class="cmd"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            aria-label=${v.pending === "" ? "FL input" : "FL input, definition continues"}
            placeholder=${v.pending === "" ? "Type FL, .help for help" : "continue the definition, ends with ;"}
            ?readonly=${v.busy}
            @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}
          />
        </div>
        ${this.renderInspector()}
        <div class="sr-only" role="status" aria-live="polite">${v.status}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-console": ForgeConsole;
  }
}
