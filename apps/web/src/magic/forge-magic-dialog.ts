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
// The Magic dialog (WP 6.30, UI.md "Magic"): a `ForgeDialog` opened by the input pane's Magic button. It runs
// Magic on the active input when it opens (the click on the button is the request), shows the ranked
// candidates and adds one to the recipe on request. The run itself is in `controller.ts`.
import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Catalogue } from "@forge/ops";
import { createWebBaker } from "../bake/web-baker.js";
import { checksLoader } from "../ops/checks-loader.js";
import { ForgeDialog } from "../shell/forge-dialog.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { DialogId } from "../state/types.js";
import {
  CRIB_MAX_CHARS,
  DEFAULT_RUN_OPTIONS,
  DEPTH_RANGE,
  createMagicController,
} from "./controller.js";
import type { MagicController } from "./controller.js";
import { MAGIC_INPUT_NOTE_BYTES, viewCandidate } from "./magic-view.js";

const DEPTHS = Array.from(
  { length: DEPTH_RANGE.max - DEPTH_RANGE.min + 1 },
  (_, i) => DEPTH_RANGE.min + i,
);

/** Magic dialog: options, the running state with Cancel, and the ranked candidates. */
@customElement("forge-magic-dialog")
export class ForgeMagicDialog extends ForgeDialog {
  static override styles = [
    ForgeDialog.styles,
    css`
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      p {
        margin: 0 0 var(--space-3);
      }
      .muted {
        color: var(--text-muted);
        font-size: var(--text-sm);
      }
      .options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-3);
        align-items: end;
        margin-block-end: var(--space-3);
      }
      .options label {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-muted);
      }
      .options label.crib {
        flex: 1 1 14rem;
      }
      .status {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2) var(--space-3);
        margin-block-end: var(--space-3);
      }
      .status p {
        margin: 0;
      }
      h3 {
        font-size: var(--text-md);
        margin: 0 0 var(--space-2);
      }
      ol.candidates {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      li.candidate {
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-m);
        padding: var(--space-3);
        background: var(--surface-2);
      }
      li.candidate h4 {
        margin: 0 0 var(--space-2);
        font-size: var(--text-md);
      }
      ol.steps {
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-2);
        margin: 0 0 var(--space-2);
        padding: 0;
      }
      ol.steps li:not(:last-child)::after {
        content: "\\2192";
        margin-inline-start: var(--space-2);
        color: var(--text-muted);
      }
      code {
        font-family: var(--font-mono);
        overflow-wrap: anywhere;
      }
      .preview {
        margin: 0 0 var(--space-2);
      }
      ul.reasons {
        margin: 0 0 var(--space-3);
        padding-inline-start: var(--space-4);
        font-size: var(--text-sm);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .confirm {
        margin-block-start: var(--space-3);
        border-inline-start: 0.4rem solid var(--accent);
        padding-inline-start: var(--space-3);
      }
      .error {
        border: var(--border-width) solid var(--danger);
        border-radius: var(--radius-m);
        padding: var(--space-3);
        color: var(--danger);
        background: var(--danger-soft);
      }
    `,
  ];

  protected readonly dialogId: DialogId = "magic";
  protected readonly heading = "Magic";
  protected override readonly headingFocusable = true;

  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);
  private readonly steps = new StoreController(this, store, (s) => s.recipe.steps.length);

  private readonly controller: MagicController = createMagicController({
    createBaker: createWebBaker,
    loadEngine: () => import("@forge/worker/magic"),
    loadChecks: (catalogue: Catalogue) => checksLoader.load(catalogue),
    userSource: () => store.get().user.source,
  });
  private unsubscribe: (() => void) | null = null;

  @state() private depth: number = DEFAULT_RUN_OPTIONS.depth;
  @state() private crib: string = DEFAULT_RUN_OPTIONS.crib;
  @state() private confirming: number | null = null;
  /** The input the run is on: a snapshot taken when the dialog opened (or when Run again was pressed). */
  @state() private target: { name: string; bytes: Uint8Array } | null = null;

  private wasOpen = false;
  private wasRunning = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.controller.subscribe(() => this.requestUpdate());
  }

  override disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    void this.controller.dispose();
    super.disconnectedCallback();
  }

  protected override updated(): void {
    super.updated();
    const open = this.isOpen;
    if (open && !this.wasOpen) this.opened();
    else if (!open && this.wasOpen) this.closed();
    this.wasOpen = open;
    const running = this.controller.state.phase === "running";
    if (open && this.wasRunning && !running) {
      // The Cancel button is gone: put focus on the result so it is not lost.
      this.renderRoot.querySelector<HTMLElement>("#magic-result")?.focus();
    }
    this.wasRunning = running;
  }

  private opened(): void {
    this.confirming = null;
    this.runNow();
  }

  private closed(): void {
    const wasRunning = this.controller.state.phase === "running";
    this.controller.reset();
    this.target = null;
    this.confirming = null;
    if (wasRunning) actions.announce("Magic cancelled");
  }

  private runNow(): void {
    const s = store.get();
    const tab = s.inputs.find((t) => t.id === s.activeInputId) ?? s.inputs[0];
    if (tab === undefined) return;
    this.target = { name: tab.name, bytes: tab.bytes };
    this.confirming = null;
    this.controller.reset();
    const cat = s.catalogue;
    if (tab.bytes.length === 0 || cat.status !== "ready") return;
    void this.controller.run(tab.bytes, cat.catalogue, { depth: this.depth, crib: this.crib });
  }

  /** Close the dialog, then say `text`: the live region of the page is inert while a modal is open. */
  private closeThenAnnounce(text: string): void {
    actions.closeDialog();
    void this.updateComplete.then(() => actions.announce(text));
  }

  private requestAdd(index: number): void {
    if (this.steps.value === 0) {
      this.addCandidate(index);
      return;
    }
    this.confirming = index;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>("#magic-replace")?.focus();
    });
  }

  private cancelConfirm(index: number): void {
    this.confirming = null;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(`#magic-add-${index}`)?.focus();
    });
  }

  private candidateAt(index: number) {
    const s = this.controller.state;
    return s.phase === "done" || s.phase === "cancelled" ? s.result.candidates[index] : undefined;
  }

  private addCandidate(index: number): void {
    const c = this.candidateAt(index);
    if (c === undefined) return;
    const had = store.get().recipe.steps.length > 0;
    actions.setRecipe(c.recipe);
    const n = c.ops.length;
    const what = `${n} ${n === 1 ? "step" : "steps"}`;
    this.closeThenAnnounce(
      had
        ? `Replaced the recipe with the ${what} Magic found. Undo (Ctrl+Z) brings the old recipe back.`
        : `Added the ${what} Magic found to the recipe. Undo (Ctrl+Z) removes them.`,
    );
  }

  private addFirst(index: number): void {
    const first = this.candidateAt(index)?.ops[0];
    if (first === undefined) return;
    actions.addOp(first);
    this.closeThenAnnounce(`Added ${first} to the recipe`);
  }

  // ---- render --------------------------------------------------------------------------------------

  private renderControls(running: boolean): TemplateResult {
    return html`<div class="options">
      <label>
        Depth
        <select
          aria-label="Depth, the most steps in a candidate"
          ?disabled=${running}
          @change=${(e: Event) => {
            this.depth = Number((e.target as HTMLSelectElement).value);
          }}
        >
          ${DEPTHS.map((d) => html`<option value=${d} ?selected=${d === this.depth}>${d}</option>`)}
        </select>
      </label>
      <label class="crib">
        Crib (optional)
        <input
          type="text"
          maxlength=${CRIB_MAX_CHARS}
          spellcheck="false"
          autocomplete="off"
          placeholder="a regular expression the output should match"
          .value=${this.crib}
          ?disabled=${running}
          @input=${(e: Event) => {
            this.crib = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              this.runNow();
            }
          }}
        />
      </label>
      <button type="button" ?disabled=${running || this.catalogueNotReady()} @click=${this.runNow}>
        Run again
      </button>
    </div>`;
  }

  private catalogueNotReady(): boolean {
    return this.catalogue.value.status !== "ready";
  }

  private renderCandidate(raw: number): TemplateResult {
    const c = this.candidateAt(raw);
    if (c === undefined) return html`${nothing}`;
    const v = viewCandidate(c, raw);
    const n = raw + 1;
    const steps = this.steps.value;
    return html`<li class="candidate">
      <h4>Candidate ${n}</h4>
      <ol class="steps" aria-label="Steps">
        ${v.ops.map((op) => html`<li><code>${op}</code></li>`)}
      </ol>
      <p class="preview">
        <span class="muted"
          >${v.previewKind === "text" ? "Output" : "Output (bytes, in hex)"}:</span
        >
        <code>${v.preview}${v.cut ? "…" : ""}</code>
      </p>
      <p class="muted">
        Score ${v.score}. The output is ${v.outputLength.toLocaleString("en-US")}
        ${v.outputLength === 1 ? "byte" : "bytes"}.
      </p>
      ${
        v.reasons.length === 0
          ? nothing
          : html`<ul class="reasons" aria-label="Reasons">
              ${v.reasons.map((r) => html`<li>${r}</li>`)}
            </ul>`
      }
      ${
        this.confirming === raw
          ? html`<div class="confirm" role="group" aria-label="Replace the recipe?">
              <p>
                Your recipe has ${steps} ${steps === 1 ? "step" : "steps"}. Adding this candidate
                replaces ${steps === 1 ? "it" : "them"} with these ${v.ops.length}
                ${v.ops.length === 1 ? "step" : "steps"}. Your input is kept. Undo (Ctrl+Z) brings
                the recipe back.
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="primary"
                  id="magic-replace"
                  @click=${() => this.addCandidate(raw)}
                >
                  Replace the recipe
                </button>
                <button type="button" @click=${() => this.cancelConfirm(raw)}>Cancel</button>
              </div>
            </div>`
          : html`<div class="actions">
              <button
                type="button"
                class="primary"
                id="magic-add-${raw}"
                aria-label="Add to recipe, candidate ${n}"
                @click=${() => this.requestAdd(raw)}
              >
                Add to recipe
              </button>
              ${
                v.ops.length > 1
                  ? html`<button
                      type="button"
                      aria-label="Add first step, candidate ${n}"
                      @click=${() => this.addFirst(raw)}
                    >
                      Add first step
                    </button>`
                  : nothing
              }
            </div>`
      }
    </li>`;
  }

  protected override renderBody(): TemplateResult {
    const st = this.controller.state;
    const running = st.phase === "running";
    const target = this.target;
    const empty = target !== null && target.bytes.length === 0;
    const big = target !== null && target.bytes.length > MAGIC_INPUT_NOTE_BYTES;
    return html`
      <p>
        Magic tries operations, with their default parameters, on the input and suggests recipes
        that make it easier to read. It only suggests: nothing changes until you add a candidate.
      </p>
      ${
        target === null
          ? nothing
          : html`<p class="muted">
              Input: ${target.name}, ${target.bytes.length.toLocaleString("en-US")}
              ${target.bytes.length === 1 ? "byte" : "bytes"}.
              ${
                big
                  ? "This is more than Magic can work on in one step (4 MiB), so it will probably find nothing."
                  : ""
              }
            </p>`
      }
      ${this.renderControls(running)}
      <div class="sr-only" role="status">${st.announcement}</div>
      ${
        this.catalogueNotReady()
          ? html`<p class="error" role="note">
              The operations have not loaded, so Magic cannot run.
            </p>`
          : empty
            ? html`<p id="magic-result" tabindex="-1">
                The input is empty. Type or load some data, then run Magic again.
              </p>`
            : this.renderState()
      }
    `;
  }

  private renderState(): TemplateResult {
    const st = this.controller.state;
    switch (st.phase) {
      case "idle":
        return html`${nothing}`;
      case "running": {
        const p = st.progress;
        return html`<div class="status">
          <p aria-live="off">
            ${
              p === null
                ? st.stage === "loading"
                  ? "Starting Magic…"
                  : "Searching…"
                : `Searching: ${p.tried} operation runs, ${p.candidates} ${
                    p.candidates === 1 ? "candidate" : "candidates"
                  } so far, ${(p.elapsedMs / 1000).toFixed(1)} s.`
            }
          </p>
          <button type="button" id="magic-cancel" @click=${() => this.controller.cancel()}>
            Cancel
          </button>
        </div>`;
      }
      case "error":
        return html`<p id="magic-result" tabindex="-1" class="error" role="note">
          Magic could not run: ${st.message}
        </p>`;
      case "done":
      case "cancelled": {
        const found = st.result.candidates;
        const summary =
          st.phase === "cancelled"
            ? found.length === 0
              ? "Magic was cancelled before it found a candidate."
              : `Magic was cancelled. These ${found.length === 1 ? "candidate was" : "candidates were"} found so far.`
            : found.length === 0
              ? "No candidate. Magic found nothing that makes this input easier to read."
              : `${found.length} ${found.length === 1 ? "candidate" : "candidates"}, best first.`;
        const note =
          st.phase === "done" && st.result.stopped === "deadline"
            ? "The search stopped at its time limit."
            : st.phase === "done" && st.result.stopped === "max-tried"
              ? "The search stopped at its limit of operation runs."
              : "";
        return html`<h3 id="magic-result" tabindex="-1">${summary}</h3>
          ${note === "" ? nothing : html`<p class="muted">${note}</p>`}
          ${
            found.length === 0
              ? html`<p class="muted">
                  Magic needs data it can recognise behind an encoding or compression. A crib, a
                  regular expression the result should match, lets it try more.
                </p>`
              : html`<ol class="candidates" aria-label="Candidates">
                  ${found.map((_, i) => this.renderCandidate(i))}
                </ol>`
          }`;
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-magic-dialog": ForgeMagicDialog;
  }
}
