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
import type { PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { InputTab } from "../state/types.js";
import { baseStyles, paneStyles } from "../styles/shared.js";
import { icons } from "../styles/icons.js";
import {
  ENCODINGS,
  EOLS,
  FILE_LIMIT_BYTES,
  countUtf8Chars,
  decodeUtf8Strict,
  detectEol,
  formatBytes,
  inputView,
  shannonEntropy,
  textToBytes,
} from "./codec.js";
import type { EncodingName, EolName, InputView } from "./codec.js";
import "./forge-hex-view.js";

const ENCODING_LABEL: Record<EncodingName, string> = {
  utf8: "UTF-8",
  hex: "Hex",
  latin1: "Latin-1",
  base64: "Base64",
};
const EOL_LABEL: Record<EolName, string> = { lf: "LF", crlf: "CRLF", cr: "CR" };

interface Draft {
  readonly tabId: string;
  readonly text: string;
  /** The bytes this text produced (identity compared with the tab's), or null when it is invalid. */
  readonly bytes: Uint8Array | null;
  readonly error: string | null;
}

/** Input pane: tabs, text area (by encoding and EOL), files, length and entropy. */
@customElement("forge-input")
export class ForgeInput extends LitElement {
  static override styles = [
    baseStyles,
    paneStyles,
    css`
      .pane-body {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        overflow: hidden;
        position: relative;
      }
      .tabs {
        display: flex;
        gap: var(--space-1);
        align-items: center;
        overflow-x: auto;
        flex: none;
      }
      .tab {
        display: inline-flex;
        align-items: center;
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-m);
        background: var(--surface);
        flex: none;
      }
      .tab.active {
        background: var(--accent-soft);
        border-color: var(--accent);
      }
      .tab button {
        border: 0;
        background: transparent;
        max-width: 12rem;
      }
      .tab button.name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
        line-height: var(--hit-min);
      }
      .tab input {
        width: 9rem;
        margin: 0 var(--space-1);
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-3);
        align-items: center;
        flex: none;
      }
      .controls label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-muted);
      }
      .editor {
        flex: 1;
        min-height: 5rem;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      textarea {
        flex: 1;
        min-height: 5rem;
        width: 100%;
        resize: none;
        font-family: var(--font-mono);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      textarea[aria-invalid="true"] {
        border-color: var(--danger);
      }
      .error {
        margin: 0;
        padding: var(--space-1) var(--space-2);
        font-size: var(--text-sm);
        color: var(--danger);
        background: var(--danger-soft);
        border-radius: var(--radius-s);
      }
      .notice {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-muted);
      }
      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-4);
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-muted);
        flex: none;
      }
      .stats div {
        display: inline-flex;
        gap: var(--space-1);
      }
      .stats dt::after {
        content: ":";
      }
      .stats dd {
        margin: 0;
        font-family: var(--font-mono);
        color: var(--text);
      }
      .drop {
        display: none;
        position: absolute;
        inset: 0;
        align-items: center;
        justify-content: center;
        background: var(--drop);
        border: 2px dashed var(--accent);
        border-radius: var(--radius-m);
        font-weight: var(--weight-bold);
        pointer-events: none;
        z-index: 2;
      }
      .dragging .drop {
        display: flex;
      }
    `,
  ];

  private readonly inputs = new StoreController(this, store, (s) => s.inputs);
  private readonly activeId = new StoreController(this, store, (s) => s.activeInputId);

  @state() private draft: Draft | null = null;
  @state() private renaming: string | null = null;
  @state() private message: string | null = null;
  @state() private dragging = false;

  private viewMemo: { bytes: Uint8Array; encoding: EncodingName; view: InputView } | undefined;
  private statsMemo: { bytes: Uint8Array; entropy: number; chars: number | null } | undefined;
  private dragDepth = 0;

  /** Move focus to the pane's main control (called by the shell's pane shortcuts). */
  focusPrimary(): void {
    const target =
      this.renderRoot.querySelector<HTMLElement>("textarea") ??
      this.renderRoot.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      this.renderRoot.querySelector<HTMLElement>("h2");
    target?.focus();
  }

  private get active(): InputTab {
    const inputs = this.inputs.value;
    return inputs.find((t) => t.id === this.activeId.value) ?? (inputs[0] as InputTab);
  }

  protected override willUpdate(changed: PropertyValues): void {
    void changed;
    const tab = this.active;
    if (this.draft !== null && this.draft.tabId !== tab.id) this.draft = null;
  }

  // ---- derived values ----------------------------------------------------------------------------

  private viewOf(tab: InputTab): InputView {
    const m = this.viewMemo;
    if (m !== undefined && m.bytes === tab.bytes && m.encoding === tab.encoding) return m.view;
    const view = inputView(tab.bytes, tab.encoding);
    this.viewMemo = { bytes: tab.bytes, encoding: tab.encoding, view };
    return view;
  }

  private statsOf(bytes: Uint8Array) {
    if (this.statsMemo?.bytes === bytes) return this.statsMemo;
    const valid = decodeUtf8Strict(bytes) !== null;
    this.statsMemo = {
      bytes,
      entropy: shannonEntropy(bytes),
      chars: valid ? countUtf8Chars(bytes) : null,
    };
    return this.statsMemo;
  }

  // ---- tabs --------------------------------------------------------------------------------------

  private onTabKeydown(e: KeyboardEvent, tab: InputTab): void {
    const inputs = this.inputs.value;
    const i = inputs.findIndex((t) => t.id === tab.id);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % inputs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + inputs.length) % inputs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = inputs.length - 1;
    else if (e.key === "F2") {
      e.preventDefault();
      this.startRename(tab.id);
      return;
    } else if (e.key === "Delete" && inputs.length > 1) {
      e.preventDefault();
      this.closeTab(tab.id);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    const target = inputs[next] as InputTab;
    actions.selectInput(target.id);
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`#tab-${target.id} .name`)?.focus(),
    );
  }

  private startRename(id: string): void {
    this.renaming = id;
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>("input.rename");
      input?.focus();
      input?.select();
    });
  }

  private finishRename(id: string, value: string | null): void {
    if (this.renaming !== id) return;
    this.renaming = null;
    if (value !== null && value.trim() !== "") actions.setInputName(id, value.trim());
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`#tab-${id} .name`)?.focus(),
    );
  }

  private closeTab(id: string): void {
    const tab = this.inputs.value.find((t) => t.id === id);
    actions.closeInput(id);
    if (tab !== undefined) actions.announce(`Closed ${tab.name}`);
  }

  private addTab(): void {
    actions.addInput();
    this.message = null;
    void this.updateComplete.then(() => this.focusPrimary());
  }

  // ---- editing -----------------------------------------------------------------------------------

  private onText(e: Event): void {
    const tab = this.active;
    const text = (e.target as HTMLTextAreaElement).value;
    const r = textToBytes(text, tab.encoding, tab.eol);
    if (r.ok) {
      this.draft = { tabId: tab.id, text, bytes: r.bytes, error: null };
      actions.setInputBytes(tab.id, r.bytes);
    } else {
      // The previous bytes stay; the text the user typed stays in the box.
      this.draft = { tabId: tab.id, text, bytes: null, error: r.message };
    }
  }

  private onEncoding(e: Event): void {
    const tab = this.active;
    this.draft = null;
    actions.setInputEncoding(tab.id, (e.target as HTMLSelectElement).value as EncodingName);
  }

  private onEol(e: Event): void {
    const tab = this.active;
    const eol = (e.target as HTMLSelectElement).value as EolName;
    actions.setInputEol(tab.id, eol);
    // Re-write the line endings of the text that is shown (text encodings only).
    if (tab.encoding !== "utf8" && tab.encoding !== "latin1") return;
    const view = this.viewOf(tab);
    const text =
      this.draft?.error != null
        ? null
        : (this.draft?.text ?? (view.kind === "text" ? view.text : null));
    if (text === null) return;
    const r = textToBytes(text, tab.encoding, eol);
    if (r.ok) {
      this.draft = null;
      actions.setInputBytes(tab.id, r.bytes);
    }
  }

  private clear(): void {
    const tab = this.active;
    this.draft = null;
    this.message = null;
    actions.setInputBytes(tab.id, new Uint8Array(0));
    actions.announce("Input cleared");
    void this.updateComplete.then(() => this.focusPrimary());
  }

  // ---- files -------------------------------------------------------------------------------------

  private async loadFiles(files: readonly File[]): Promise<void> {
    this.message = null;
    let loaded = 0;
    for (const file of files) {
      if (file.size > FILE_LIMIT_BYTES) {
        this.message = `"${file.name}" is ${formatBytes(file.size)}; the limit is ${formatBytes(FILE_LIMIT_BYTES)}. It was not loaded.`;
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        this.message = `"${file.name}" could not be read.`;
        continue;
      }
      const current = this.active;
      const text = bytes.length <= 1024 * 1024 ? decodeUtf8Strict(bytes) : null;
      const eol = text === null ? "lf" : detectEol(text);
      this.draft = null;
      if (current.bytes.length === 0 && loaded === 0) {
        actions.setInputBytes(current.id, bytes);
        actions.setInputName(current.id, file.name);
        actions.setInputEol(current.id, eol);
      } else {
        const id = actions.addInput(file.name, bytes);
        actions.setInputEol(id, eol);
      }
      loaded++;
    }
    if (loaded > 0) {
      actions.announce(loaded === 1 ? "File loaded" : `${loaded} files loaded`);
    }
  }

  private onFilePicked(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    void this.loadFiles(files);
  }

  private onDragEnter(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging = true;
  }

  private onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  private onDragLeave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragging = false;
  }

  private onDrop(e: DragEvent): void {
    const files = Array.from(e.dataTransfer?.files ?? []);
    this.dragDepth = 0;
    this.dragging = false;
    if (files.length === 0) return;
    e.preventDefault();
    void this.loadFiles(files);
  }

  // ---- render ------------------------------------------------------------------------------------

  private renderTab(tab: InputTab) {
    const selected = tab.id === this.active.id;
    const count = this.inputs.value.length;
    return html`<div class=${classMap({ tab: true, active: selected })} role="presentation">
      ${
        this.renaming === tab.id
          ? html`<input
              class="rename"
              aria-label="Rename input tab"
              .value=${tab.name}
              maxlength="80"
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter")
                  this.finishRename(tab.id, (e.target as HTMLInputElement).value);
                else if (e.key === "Escape") this.finishRename(tab.id, null);
                e.stopPropagation();
              }}
              @blur=${(e: FocusEvent) =>
                this.finishRename(tab.id, (e.target as HTMLInputElement).value)}
            />`
          : html`<button
              id="tab-${tab.id}"
              class="name"
              role="tab"
              type="button"
              aria-selected=${selected ? "true" : "false"}
              aria-controls="panel-${tab.id}"
              tabindex=${selected ? "0" : "-1"}
              title="${tab.name} (double-click or F2 to rename)"
              @click=${() => actions.selectInput(tab.id)}
              @dblclick=${() => this.startRename(tab.id)}
              @keydown=${(e: KeyboardEvent) => this.onTabKeydown(e, tab)}
            >
              ${tab.name}
            </button>`
      }
      ${
        count > 1
          ? html`<button
              class="icon ghost"
              type="button"
              aria-label="Close ${tab.name}"
              @click=${() => this.closeTab(tab.id)}
            >
              ${icons.close}
            </button>`
          : nothing
      }
    </div>`;
  }

  private renderEditor(tab: InputTab) {
    const view = this.viewOf(tab);
    if (view.kind === "readonly") {
      const why =
        view.reason === "too-large"
          ? `This input is ${formatBytes(tab.bytes.length)}, too large to edit as text.`
          : "These bytes are not valid UTF-8, so they are not shown as text.";
      return html`<div
        class="editor"
        id="panel-${tab.id}"
        role="tabpanel"
        aria-labelledby="tab-${tab.id}"
      >
        <p class="notice" role="note">
          ${why} Showing a read-only hex dump. All bytes are kept.
          ${
            view.reason === "invalid-utf8"
              ? "Choose Hex, Latin-1 or Base64 to edit them, or clear the input."
              : "Clear the input to type instead."
          }
        </p>
        <forge-hex-view .bytes=${tab.bytes} label="Input bytes"></forge-hex-view>
      </div>`;
    }
    const draft = this.draft;
    const useDraft =
      draft !== null &&
      draft.tabId === tab.id &&
      (draft.error !== null || draft.bytes === tab.bytes);
    const text = useDraft ? draft.text : view.text;
    const error = useDraft ? draft.error : null;
    return html`<div
      class="editor"
      id="panel-${tab.id}"
      role="tabpanel"
      aria-labelledby="tab-${tab.id}"
    >
      <textarea
        aria-label="Input text, ${ENCODING_LABEL[tab.encoding]}"
        aria-invalid=${error === null ? "false" : "true"}
        aria-describedby=${ifDefined(error === null ? undefined : "input-error")}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        placeholder="Type or paste input, or drop a file here"
        .value=${text}
        @input=${this.onText}
      ></textarea>
      ${
        error === null
          ? nothing
          : html`<p id="input-error" class="error" role="alert">
              ${error} The input keeps its previous bytes until this is fixed.
            </p>`
      }
    </div>`;
  }

  protected override render() {
    const tab = this.active;
    const stats = this.statsOf(tab.bytes);
    const binary = this.viewOf(tab).kind === "readonly";
    return html`<header class="pane-head">
        <h2 tabindex="-1">Input</h2>
        <button
          type="button"
          @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#file")?.click()}
        >
          Open file
        </button>
        <button type="button" @click=${this.clear} ?disabled=${tab.bytes.length === 0}>
          Clear
        </button>
        <input id="file" type="file" multiple hidden @change=${this.onFilePicked} />
      </header>
      <div
        class=${classMap({ "pane-body": true, dragging: this.dragging })}
        @dragenter=${this.onDragEnter}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <div class="tabs" role="tablist" aria-label="Inputs">
          ${this.inputs.value.map((t) => this.renderTab(t))}
          <button class="icon" type="button" aria-label="New input tab" @click=${this.addTab}>
            ${icons.plus}
          </button>
        </div>
        <div class="controls">
          <label>
            Encoding
            <select aria-label="Text encoding" @change=${this.onEncoding}>
              ${ENCODINGS.map(
                (enc) =>
                  html`<option value=${enc} ?selected=${enc === tab.encoding}>
                    ${ENCODING_LABEL[enc]}
                  </option>`,
              )}
            </select>
          </label>
          <label>
            Line ending
            <select
              aria-label="Line ending"
              ?disabled=${tab.encoding === "hex" || tab.encoding === "base64" || binary}
              @change=${this.onEol}
            >
              ${EOLS.map(
                (eol) =>
                  html`<option value=${eol} ?selected=${eol === tab.eol}>
                    ${EOL_LABEL[eol]}
                  </option>`,
              )}
            </select>
          </label>
        </div>
        ${this.message === null ? nothing : html`<p class="error" role="alert">${this.message}</p>`}
        ${this.renderEditor(tab)}
        <dl class="stats" aria-label="Input statistics">
          <div>
            <dt>Bytes</dt>
            <dd>${tab.bytes.length.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Characters</dt>
            <dd>
              ${stats.chars === null ? "n/a (not UTF-8)" : stats.chars.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt>Entropy</dt>
            <dd>${stats.entropy.toFixed(3)} bits/byte</dd>
          </div>
        </dl>
        <div class="drop" aria-hidden="true">Drop a file to load its bytes</div>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-input": ForgeInput;
  }
}
