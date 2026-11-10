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
import type { TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";
import type { BakeError, OutputValue } from "@forge/worker";
import type { RecipeIssue } from "@forge/recipe";
import { actions, store } from "../state/app.js";
import { FORGE_EVENTS, emit } from "../state/events.js";
import type { FocusPaneDetail } from "../state/events.js";
import { getStep } from "../state/recipe-ops.js";
import { StoreController } from "../state/store-controller.js";
import { baseStyles, paneStyles } from "../styles/shared.js";
import { icons } from "../styles/icons.js";
import { bytesToHex, formatBytes } from "./codec.js";
import {
  chooseView,
  detailText,
  downloadBytes,
  downloadSpec,
  outputBytes,
  outputText,
  stepLabel,
} from "./output-model.js";
import type { OutputView } from "./output-model.js";
import "./forge-hex-view.js";

/** The text view shows at most this many characters (all of it is still copied and downloaded). */
const TEXT_DISPLAY_LIMIT = 512 * 1024;

/** The view the user last chose; remembered for the session (UI.md WP 3.5). */
let preferredView: OutputView | null = null;

/** Output pane: the last bake result as text, hex dump or tree, with copy, download and move to input. */
@customElement("forge-output")
export class ForgeOutput extends LitElement {
  static override styles = [
    baseStyles,
    paneStyles,
    css`
      .pane-head {
        flex-wrap: wrap;
      }
      .tools {
        display: flex;
        gap: var(--space-1);
        flex-wrap: wrap;
        align-items: center;
      }
      .pane-body {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        overflow: auto;
      }
      .content {
        flex: 1;
        min-height: 8rem;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .content.stale {
        opacity: 0.55;
      }
      pre.text {
        flex: 1;
        margin: 0;
        padding: var(--space-2);
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        background: var(--surface);
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-s);
        tab-size: 4;
      }
      .scalar {
        font-family: var(--font-mono);
      }
      .footer {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-4);
        font-size: var(--text-xs);
        color: var(--text-muted);
        flex: none;
      }
      .note {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-muted);
      }
      .pill.stale {
        background: var(--warn-soft);
        border-color: var(--warn);
        color: var(--text);
      }
      .view-toggle {
        display: inline-flex;
      }
      .tree,
      .tree ul {
        list-style: none;
        margin: 0;
        padding: 0;
        font-family: var(--font-mono);
        font-size: var(--text-sm);
      }
      .tree ul {
        margin-inline-start: var(--space-4);
        border-inline-start: var(--border-width) solid var(--border);
        padding-inline-start: var(--space-2);
      }
      .tree details > summary {
        cursor: pointer;
      }
      .tree .key {
        color: var(--link);
      }
      .tree .tag {
        color: var(--text-muted);
      }
      .error-panel {
        border: var(--border-width) solid var(--danger);
        border-radius: var(--radius-m);
        background: var(--danger-soft);
        padding: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .error-panel h3 {
        font-size: var(--text-md);
      }
      .error-panel code {
        font-family: var(--font-mono);
      }
      .error-panel p {
        margin: 0;
      }
      .error-panel .msg {
        font-weight: var(--weight-medium);
        overflow-wrap: anywhere;
      }
      dl.kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--space-1) var(--space-3);
        margin: 0;
        font-size: var(--text-sm);
      }
      dl.kv dt {
        color: var(--text-muted);
      }
      dl.kv dd {
        margin: 0;
        overflow-wrap: anywhere;
        font-family: var(--font-mono);
      }
      .issues {
        margin: 0;
        padding-inline-start: var(--space-4);
        font-size: var(--text-sm);
      }
      .issues li {
        margin-bottom: var(--space-1);
      }
      .sev {
        font-weight: var(--weight-bold);
        text-transform: uppercase;
        font-size: var(--text-xs);
      }
      .partial {
        border-top: var(--border-width) solid var(--border-strong);
        padding-top: var(--space-2);
      }
      .partial h4 {
        margin: 0 0 var(--space-1);
        font-size: var(--text-sm);
      }
    `,
  ];

  private readonly bake = new StoreController(this, store, (s) => s.bake);
  private readonly recipe = new StoreController(this, store, (s) => s.recipe);

  @state() private view: OutputView | null = preferredView;
  @state() private flash = "";
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  /** Move focus to the pane's main control (called by the shell's pane shortcuts). */
  focusPrimary(): void {
    const target =
      this.renderRoot.querySelector<HTMLElement>(".tools button:not(:disabled)") ??
      this.renderRoot.querySelector<HTMLElement>("h2");
    target?.focus();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.flashTimer);
    super.disconnectedCallback();
  }

  // ---- actions -----------------------------------------------------------------------------------

  private say(text: string): void {
    this.flash = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flash = "";
    }, 3000);
    actions.announce(text);
  }

  private setView(view: OutputView): void {
    preferredView = view;
    this.view = view;
  }

  private async copy(value: OutputValue, view: OutputView): Promise<void> {
    const text =
      view === "hex" && value.kind === "bytes" ? bytesToHex(value.bytes, " ") : outputText(value);
    if (text === null) {
      this.say("Nothing to copy as text; switch to the hex view");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.say(`Copied ${text.length.toLocaleString("en-US")} characters`);
    } catch {
      this.say("Copy failed: the browser did not allow clipboard access");
    }
  }

  private download(value: OutputValue): void {
    const spec = downloadSpec(value);
    if (spec === null) return;
    const blob = new Blob([downloadBytes(value) as BlobPart], { type: spec.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = spec.filename;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.say(`Downloading ${spec.filename}`);
  }

  private moveToInput(value: OutputValue, newTab: boolean): void {
    const bytes = outputBytes(value);
    if (bytes === null) return;
    const copy = bytes.slice();
    if (newTab) {
      actions.addInput("From output", copy);
    } else {
      actions.setInputBytes(store.get().activeInputId, copy);
    }
    this.say(
      newTab
        ? `Output opened in a new input tab`
        : `Output moved to the input (${formatBytes(copy.length)})`,
    );
  }

  private showStep(path: string): void {
    actions.selectStep(path);
    emit<FocusPaneDetail>(this, FORGE_EVENTS.focusPane, { pane: "recipe" });
  }

  // ---- value rendering ---------------------------------------------------------------------------

  private renderBytesOrScalar(value: OutputValue, view: OutputView): TemplateResult {
    if (value.kind === "bytes" && view === "hex") {
      return html`<forge-hex-view .bytes=${value.bytes} label="Output bytes"></forge-hex-view>`;
    }
    if (value.kind === "list" || value.kind === "record") {
      return html`<ul class="tree" aria-label="Output structure">
        ${this.renderTree(value, null, 0)}
      </ul>`;
    }
    const text = outputText(value) ?? "";
    const cut = text.length > TEXT_DISPLAY_LIMIT;
    return html`${
        cut
          ? html`<p class="note" role="note">
              Showing the first ${TEXT_DISPLAY_LIMIT.toLocaleString("en-US")} of
              ${text.length.toLocaleString("en-US")} characters. Copy and download use all of it.
            </p>`
          : nothing
      }
      <pre class=${classMap({ text: true, scalar: value.kind !== "bytes" })} tabindex="0">
${cut ? text.slice(0, TEXT_DISPLAY_LIMIT) : text}</pre>`;
  }

  private renderTree(value: OutputValue, key: string | null, depth: number): TemplateResult {
    const label = key === null ? nothing : html`<span class="key">${key}</span>: `;
    switch (value.kind) {
      case "list":
      case "record": {
        const entries =
          value.kind === "list"
            ? value.items.map((v, i) => ({ key: String(i), value: v }))
            : value.entries;
        const shown = `${value.kind} of ${value.total}${
          value.total > entries.length ? ` (showing ${entries.length})` : ""
        }`;
        return html`<li>
          <details ?open=${depth < 2}>
            <summary>${label}<span class="tag">${shown}</span></summary>
            <ul>
              ${entries.map((e) => this.renderTree(e.value, e.key, depth + 1))}
            </ul>
          </details>
        </li>`;
      }
      case "bytes":
        return html`<li>
          ${label}${
            value.text !== null
              ? JSON.stringify(
                  value.text.length > 200 ? `${value.text.slice(0, 200)}...` : value.text,
                )
              : html`<span class="tag">${value.bytes.length} bytes:</span>
                  ${bytesToHex(value.bytes.subarray(0, 16), " ")}${
                    value.bytes.length > 16 ? "..." : ""
                  }`
          }
        </li>`;
      case "other":
        return html`<li>${label}<span class="tag">${value.tag}</span> ${value.repr}</li>`;
      case "str":
        return html`<li>${label}${JSON.stringify(value.text)}</li>`;
      default:
        return html`<li>${label}${outputText(value)}</li>`;
    }
  }

  private renderValue(value: OutputValue): TemplateResult {
    const view = chooseView(value, this.view);
    return this.renderBytesOrScalar(value, view);
  }

  // ---- error panel -------------------------------------------------------------------------------

  private renderIssue(issue: RecipeIssue) {
    const recipe = this.recipe.value;
    let step: string | null = null;
    try {
      if (issue.path.startsWith("/steps") && getStep(recipe, issue.path) !== undefined) {
        step = issue.path;
      }
    } catch {
      step = null;
    }
    return html`<li>
      <span class="sev">${issue.severity}</span> <code>${issue.code}</code>
      ${issue.path === "" ? "" : html`at <code>${issue.path}</code>`}: ${issue.message}
      ${
        step === null
          ? nothing
          : html`<button
              type="button"
              class="ghost"
              @click=${() => this.showStep(step)}
              aria-label="Show ${stepLabel(recipe, step)}"
            >
              Show step
            </button>`
      }
    </li>`;
  }

  private renderError(error: BakeError, partial: OutputValue | undefined, id: number) {
    const recipe = this.recipe.value;
    const detail = Object.entries(error.detail ?? {});
    return keyed(
      id,
      html`<section class="error-panel" role="alert" aria-labelledby="err-title">
        <h3 id="err-title">Bake failed: <code>${error.code}</code></h3>
        <p class="msg">${error.message}</p>
        <dl class="kv">
          ${
            error.word === null
              ? nothing
              : html`<dt>Word</dt>
                  <dd>${error.word}</dd>`
          }
          ${
            error.path === null
              ? nothing
              : html`<dt>Step</dt>
                  <dd>
                    ${stepLabel(recipe, error.path)}
                    <button type="button" @click=${() => this.showStep(error.path as string)}>
                      Show step
                    </button>
                  </dd>`
          }
          ${detail.map(
            ([k, v]) =>
              html`<dt>${k}</dt>
                <dd>${detailText(v)}</dd>`,
          )}
        </dl>
        ${
          error.terminated === true
            ? html`<p class="note">
                The worker had to be terminated to stop this bake and was restarted.
              </p>`
            : nothing
        }
        ${
          error.issues !== undefined && error.issues.length > 0
            ? html`<div>
                <h4>Recipe problems (${error.issues.length})</h4>
                <ul class="issues">
                  ${error.issues.map((i) => this.renderIssue(i))}
                </ul>
              </div>`
            : nothing
        }
        ${
          partial === undefined
            ? nothing
            : html`<div class="partial">
                <h4>Value at the failure</h4>
                ${this.renderValue(partial)}
              </div>`
        }
      </section>`,
    );
  }

  // ---- render ------------------------------------------------------------------------------------

  private renderTools(value: OutputValue | null, view: OutputView) {
    const spec = value === null ? null : downloadSpec(value);
    const canMove = value !== null && outputBytes(value) !== null;
    const hasText = value !== null && value.kind === "bytes" && value.text !== null;
    return html`<div class="tools">
      ${
        value !== null && value.kind === "bytes"
          ? html`<span class="view-toggle" role="group" aria-label="Output view">
              <button
                type="button"
                aria-pressed=${view === "text" ? "true" : "false"}
                ?disabled=${!hasText}
                title=${hasText ? "Show as text" : "These bytes are not UTF-8 text"}
                @click=${() => this.setView("text")}
              >
                Text
              </button>
              <button
                type="button"
                aria-pressed=${view === "hex" ? "true" : "false"}
                @click=${() => this.setView("hex")}
              >
                Hex
              </button>
            </span>`
          : nothing
      }
      <button
        type="button"
        ?disabled=${value === null}
        @click=${() => value && this.copy(value, view)}
      >
        ${icons.copy} Copy
      </button>
      <button
        type="button"
        ?disabled=${spec === null}
        @click=${() => value && this.download(value)}
      >
        Download
      </button>
      <button
        type="button"
        ?disabled=${!canMove}
        @click=${() => value && this.moveToInput(value, false)}
      >
        Move to input
      </button>
      <button
        type="button"
        class="ghost"
        ?disabled=${!canMove}
        @click=${() => value && this.moveToInput(value, true)}
      >
        To new tab
      </button>
    </div>`;
  }

  protected override render() {
    const bake = this.bake.value;
    const result = bake.result;
    const value = result !== null && result.ok ? result.output : null;
    const view = value === null ? "text" : chooseView(value, this.view);
    const running = bake.status === "baking" || bake.status === "queued";
    const stale = result !== null && (bake.stale || running);
    const bytesLength = value === null ? null : (outputBytes(value)?.length ?? null);

    let body: unknown;
    if (result === null) {
      body = html`<p class="note">
        ${
          running
            ? "Baking..."
            : "No output yet. Type some input; the recipe bakes automatically when auto-bake is on."
        }
      </p>`;
    } else if (result.ok) {
      body = this.renderValue(result.output);
    } else {
      body = this.renderError(result.error, result.partial, result.id);
    }

    return html`<header class="pane-head">
        <h2 tabindex="-1">Output</h2>
        ${stale ? html`<span class="pill stale">Out of date</span>` : nothing}
        ${this.renderTools(value, view)}
      </header>
      <div class="pane-body">
        ${
          bake.progress !== null && running
            ? html`<p class="note" role="status">
                Baking: step ${bake.progress.done} of ${bake.progress.total}
              </p>`
            : nothing
        }
        <div class=${classMap({ content: true, stale })}>${body}</div>
        <div class="footer">
          ${
            bytesLength === null
              ? nothing
              : html`<span>Length: ${bytesLength.toLocaleString("en-US")} bytes</span>`
          }
          ${
            value !== null && value.kind !== "bytes"
              ? html`<span>Type: ${value.kind}</span>`
              : nothing
          }
          ${
            bake.elapsedMs === null || result === null
              ? nothing
              : html`<span
                  >Time:
                  ${bake.elapsedMs < 10 ? bake.elapsedMs.toFixed(1) : Math.round(bake.elapsedMs)}
                  ms</span
                >`
          }
          <span aria-hidden="true">${this.flash}</span>
        </div>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-output": ForgeOutput;
  }
}
