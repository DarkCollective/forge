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
// The full help of one operation (WP 6.13): the catalogue's own help plus, when the lazily loaded help
// document has it, "Use this when", worked examples with a Try it button, the inverse operation and
// links to outside references.
//
// Container: a modal <dialog> (showModal), not the hover popover. The popover is a tooltip that goes
// away when the pointer or focus leaves, so it cannot hold buttons or links; a side panel would take
// room from the three working panes and would not exist in the compact layout. The dialog gives a
// focus trap, Escape, an inert background and focus return for free, scrolls on its own, and at 390 px
// it is the whole screen. It is a separate element, not a ForgeDialog subclass, because ForgeDialog is
// opened through the global DialogId in state/types.ts, which this package may not extend.
//
// Everything is rendered as text. Links are plain https anchors (viewLink checks again).
import { LitElement, css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { CatalogueOp, HelpExample, HelpOp } from "@forge/ops";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import { icons } from "../styles/icons.js";
import { baseStyles } from "../styles/shared.js";
import { helpFor } from "./help.js";
import type { HelpState } from "./help-data.js";
import { helpLoader } from "./help-loader.js";
import {
  exampleTabName,
  planInput,
  viewExpect,
  viewLink,
  viewParams,
  viewValue,
} from "./help-view.js";
import type { ValueView } from "./help-view.js";
import { planTryIt } from "./try-it.js";

@customElement("forge-op-help")
export class ForgeOpHelp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      dialog {
        width: min(44rem, calc(100vw - 2 * var(--space-4)));
        max-height: calc(100vh - 2 * var(--space-5));
        max-height: calc(100dvh - 2 * var(--space-5));
        padding: 0;
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-l);
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow-pop);
        overflow: hidden;
      }
      dialog[open] {
        display: flex;
        flex-direction: column;
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 0.5);
      }
      header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        border-bottom: var(--border-width) solid var(--border);
      }
      header h2 {
        font-size: var(--text-lg);
        margin-inline-end: auto;
        font-family: var(--font-mono);
        overflow-wrap: anywhere;
      }
      .body {
        padding: var(--space-3) var(--space-4) var(--space-4);
        overflow: auto;
        font-size: var(--text-sm);
        line-height: var(--leading-body);
      }
      .body p {
        margin: var(--space-1) 0;
        overflow-wrap: anywhere;
      }
      .body h3 {
        margin: var(--space-4) 0 var(--space-1);
        font-size: var(--text-xs);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .body h3:first-child {
        margin-top: 0;
      }
      h4 {
        margin: 0;
        font-size: var(--text-md);
      }
      code,
      pre {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
      }
      .use-when {
        font-size: var(--text-md);
        padding: var(--space-2) var(--space-3);
        border-inline-start: 0.25rem solid var(--accent);
        background: var(--accent-soft);
        border-radius: var(--radius-s);
      }
      .label {
        font-weight: var(--weight-bold);
      }
      dl {
        margin: 0;
      }
      .params dt {
        margin-top: var(--space-2);
        font-family: var(--font-mono);
        font-weight: var(--weight-bold);
        overflow-wrap: anywhere;
      }
      .params dd {
        margin: 0 0 0 var(--space-3);
        overflow-wrap: anywhere;
      }
      .example {
        margin: var(--space-2) 0;
        padding: var(--space-3);
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-m);
      }
      .example dl {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: var(--space-1) var(--space-3);
        margin: var(--space-2) 0;
      }
      .example dt {
        color: var(--text-muted);
      }
      .example dd {
        margin: 0;
        min-width: 0;
      }
      .example .kind {
        font-size: var(--text-xs);
        color: var(--text-muted);
      }
      .example pre {
        margin: 0;
        padding: var(--space-1) var(--space-2);
        background: var(--surface-2);
        border-radius: var(--radius-s);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .example .reading {
        margin: var(--space-1) 0 0;
        color: var(--text-muted);
      }
      .error-out {
        font-weight: var(--weight-bold);
      }
      .confirm {
        margin-top: var(--space-2);
        padding: var(--space-2);
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-s);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-top: var(--space-2);
      }
      ul.links {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      ul.links li {
        margin: var(--space-1) 0;
      }
      ul.links a {
        display: inline-block;
        padding: var(--space-1) 0;
        overflow-wrap: anywhere;
      }
      .ext {
        font-size: var(--text-xs);
      }
      .problem {
        padding: var(--space-2) var(--space-3);
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-s);
      }
    `,
  ];

  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);
  private readonly steps = new StoreController(this, store, (s) => s.recipe.steps.length);

  @state() private op: CatalogueOp | null = null;
  @state() private previous: CatalogueOp | null = null;
  @state() private help: HelpState = { status: "idle" };
  @state() private confirming: number | null = null;
  @state() private problem: string | null = null;

  @query("dialog") private readonly dialogEl!: HTMLDialogElement | null;
  @query("h2") private readonly headingEl!: HTMLElement | null;

  /** True while the dialog is open. */
  get isOpen(): boolean {
    return this.dialogEl?.open === true;
  }

  /** Open the help of `op`; focus returns to whatever had it when the dialog closes. */
  show(op: CatalogueOp): void {
    this.previous = null;
    this.setOp(op);
    void this.updateComplete.then(() => {
      const dialog = this.dialogEl;
      if (dialog && !dialog.open) dialog.showModal();
    });
  }

  close(): void {
    this.dialogEl?.close();
  }

  private setOp(op: CatalogueOp): void {
    this.op = op;
    this.confirming = null;
    this.problem = null;
    void this.loadHelp();
  }

  private async loadHelp(): Promise<void> {
    const cat = this.catalogue.value;
    if (cat.status !== "ready") return;
    const cached = helpLoader.cached(cat.catalogue);
    if (cached !== null) {
      this.help = { status: "ready", index: cached };
      return;
    }
    this.help = { status: "loading" };
    try {
      const index = await helpLoader.load(cat.catalogue);
      this.help = { status: "ready", index };
    } catch (e) {
      this.help = { status: "failed", message: e instanceof Error ? e.message : String(e) };
    }
  }

  protected override render() {
    const op = this.op;
    return html`<dialog aria-labelledby="op-help-title" @close=${this.onClose}>
      <header>
        <h2 id="op-help-title" tabindex="-1">${op?.qname ?? ""}</h2>
        <button
          type="button"
          class="ghost icon"
          aria-label="Close help"
          @click=${() => this.close()}
        >
          ${icons.close}
        </button>
      </header>
      <div class="body">${op === null ? nothing : this.renderBody(op)}</div>
    </dialog>`;
  }

  private readonly onClose = (): void => {
    this.confirming = null;
  };

  private renderBody(op: CatalogueOp): TemplateResult {
    const h = helpFor(op);
    const entry: HelpOp | undefined =
      this.help.status === "ready" ? this.help.index.get(op.qname) : undefined;
    return html`
      ${
        this.previous === null
          ? nothing
          : html`<p>
              <button type="button" @click=${() => this.back()}>
                Back to ${this.previous.qname}
              </button>
            </p>`
      }
      ${this.problem === null ? nothing : html`<p class="problem" role="alert">${this.problem}</p>`}
      ${
        entry?.useWhen
          ? html`<h3>Use this when</h3>
              <p class="use-when">${entry.useWhen}</p>`
          : nothing
      }
      ${h.effect === "" ? nothing : html`<p><code>${h.effect}</code></p>`}
      ${h.doc === null || h.doc === "" ? nothing : html`<p>${h.doc}</p>`}
      <p class="muted">${h.signature}</p>
      ${
        this.help.status === "loading"
          ? html`<p class="muted" role="status">Loading examples and links...</p>`
          : nothing
      }
      ${
        this.help.status === "failed"
          ? html`<div class="problem" role="alert">
              <p>
                Examples and links could not be loaded (${this.help.message}). The help above is
                complete without them. If trying again fails, reload the page.
              </p>
              <button type="button" @click=${() => void this.loadHelp()}>Try again</button>
            </div>`
          : nothing
      }
      ${entry?.inverse ? this.renderInverse(entry.inverse) : nothing}
      ${
        entry && entry.examples.length > 0
          ? html`<h3>Examples</h3>
              ${entry.examples.map((ex, i) => this.renderExample(op, ex, i))}`
          : nothing
      }
      ${entry && entry.links.length > 0 ? this.renderLinks(entry) : nothing}
      <h3>Parameters</h3>
      ${
        h.params.length === 0
          ? html`<p class="muted">No parameters.</p>`
          : html`<dl class="params">
              ${h.params.map(
                (p) =>
                  html`<dt>${p.name}</dt>
                    <dd>${p.summary}${p.doc === null ? nothing : html`. ${p.doc}`}</dd>`,
              )}
            </dl>`
      }
      ${h.aliases === "" ? nothing : html`<p><span class="label">Aliases:</span> ${h.aliases}</p>`}
      ${h.seeAlso === "" ? nothing : html`<p><span class="label">See also:</span> ${h.seeAlso}</p>`}
    `;
  }

  private renderInverse(qname: string): TemplateResult {
    const cat = this.catalogue.value;
    const target =
      cat.status === "ready" ? cat.catalogue.ops.find((o) => o.qname === qname) : undefined;
    return html`<h3>Inverse</h3>
      <p><code>${qname}</code> undoes this operation.</p>
      ${
        target === undefined
          ? nothing
          : html`<div class="actions">
              <button type="button" @click=${() => this.addInverse(target)}>
                ${icons.plus} Add ${target.qname} to the recipe
              </button>
              <button type="button" @click=${() => this.follow(target)}>
                Show help for ${target.qname}
              </button>
            </div>`
      }`;
  }

  private renderValue(v: ValueView): TemplateResult {
    return html`<pre>${v.empty ? "(empty)" : v.text}</pre>
      ${v.cut === null ? nothing : html`<p class="reading">${v.cut}</p>`}
      ${v.reading === null ? nothing : html`<p class="reading">As text: ${v.reading}</p>`}`;
  }

  private renderExample(op: CatalogueOp, ex: HelpExample, i: number): TemplateResult {
    const params = viewParams(ex.params);
    const input = viewValue(ex.input.value, ex.input.enc);
    const out = viewExpect(ex.expect);
    const titleId = `op-ex-${i}`;
    return html`<section class="example" aria-labelledby=${titleId}>
      <h4 id=${titleId}>${ex.title}</h4>
      ${ex.note === null ? nothing : html`<p>${ex.note}</p>`}
      <dl>
        <dt>Parameters</dt>
        <dd>
          ${
            params.length === 0
              ? html`<span class="muted">none (the defaults)</span>`
              : params.map(
                  (p) =>
                    html`<div>
                      <code>${p.name}</code> =
                      <code>${p.value.text}</code>
                      ${p.value.label === "text" ? nothing : html`<span class="kind">(${p.value.label})</span>`}
                    </div>`,
                )
          }
        </dd>
        <dt>Input</dt>
        <dd>
          <span class="kind">${input.label}</span>
          ${this.renderValue(input)}
        </dd>
        <dt>Result</dt>
        <dd>
          ${
            out.kind === "value"
              ? html`<span class="kind">${out.value.label}</span>${this.renderValue(out.value)}`
              : out.kind === "error"
                ? html`<p class="error-out">Fails with the error ${out.code}.</p>`
                : html`<span class="kind">list or record, as JSON</span>
                    <pre>${out.text}</pre>
                    ${out.cut === null ? nothing : html`<p class="reading">${out.cut}</p>`}`
          }
        </dd>
      </dl>
      ${ex.ref === null ? nothing : html`<p class="muted">Source: ${ex.ref}</p>`}
      ${
        this.confirming === i
          ? html`<div class="confirm" role="group" aria-label="Replace the recipe?">
              <p>
                Your recipe has ${this.steps.value} ${this.steps.value === 1 ? "step" : "steps"}.
                Trying this example replaces ${this.steps.value === 1 ? "it" : "them"} with
                ${op.qname}. Your input is kept: the example opens in its own input tab. Undo
                (Ctrl+Z) brings the recipe back.
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="primary"
                  id="op-ex-replace"
                  @click=${() => this.tryIt(ex)}
                >
                  Replace the recipe
                </button>
                <button type="button" @click=${() => this.cancelConfirm(i)}>Cancel</button>
              </div>
            </div>`
          : html`<div class="actions">
              <button
                type="button"
                class="primary"
                aria-label=${`Try it: ${ex.title}`}
                @click=${() => this.requestTry(ex, i)}
              >
                ${icons.play} Try it
              </button>
            </div>`
      }
    </section>`;
  }

  private renderLinks(entry: HelpOp): TemplateResult {
    const links = entry.links.map(viewLink).filter((l) => l !== null);
    if (links.length === 0) return html`${nothing}`;
    return html`<h3>Read more</h3>
      <ul class="links">
        ${links.map(
          (l) =>
            html`<li>
              <a href=${l.href} target="_blank" rel="noopener noreferrer"
                >${l.label}
                <span class="ext">(${l.host}, opens in a new tab, leaves Forge)</span></a
              >
            </li>`,
        )}
      </ul>`;
  }

  // ---- actions ---------------------------------------------------------------------------------

  private follow(target: CatalogueOp): void {
    this.previous = this.op;
    this.setOp(target);
    this.focusHeading();
  }

  private back(): void {
    const previous = this.previous;
    if (previous === null) return;
    this.previous = null;
    this.setOp(previous);
    this.focusHeading();
  }

  private focusHeading(): void {
    void this.updateComplete.then(() => {
      this.headingEl?.focus();
      this.renderRoot.querySelector(".body")?.scrollTo({ top: 0 });
    });
  }

  private addInverse(target: CatalogueOp): void {
    actions.addOp(target.qname);
    this.close();
    actions.announce(`Added ${target.qname} to the recipe`);
  }

  private requestTry(ex: HelpExample, index: number): void {
    if (this.steps.value === 0) {
      this.tryIt(ex);
      return;
    }
    // Existing work: ask first. The recipe is replaced (undoable), the input is never touched.
    this.confirming = index;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>("#op-ex-replace")?.focus();
    });
  }

  private cancelConfirm(index: number): void {
    this.confirming = null;
    void this.updateComplete.then(() => {
      this.renderRoot
        .querySelectorAll<HTMLElement>(".example")
        [index]?.querySelector<HTMLElement>("button.primary")
        ?.focus();
    });
  }

  /** Put the example into the workbench: its op and parameters as the recipe, its input in an input tab. */
  private tryIt(ex: HelpExample): void {
    const op = this.op;
    if (op === null) return;
    const bytes = planTryIt(op.qname, ex);
    if (!bytes.ok) {
      this.confirming = null;
      this.problem = `This example's input could not be read: ${bytes.message}`;
      actions.announce(this.problem);
      return;
    }
    const s = store.get();
    const hadWork = s.recipe.steps.length > 0;
    const name = exampleTabName(ex.title);
    const plan = planInput(s.inputs, s.activeInputId, name, bytes.bytes);
    let tab: string;
    if (plan.kind === "fill") {
      tab = plan.id;
      actions.setInputBytes(tab, bytes.bytes);
    } else if (plan.kind === "select") {
      tab = plan.id;
      actions.selectInput(tab);
    } else {
      tab = actions.addInput(plan.name, bytes.bytes);
    }
    actions.setInputEncoding(tab, bytes.encoding);
    actions.setRecipe(bytes.recipe);
    if (store.get().ui.compact) actions.setCompactTab("output");
    this.close();
    const issues = store.get().issues.length;
    const where =
      plan.kind === "new"
        ? ` Its input is in the new tab "${name}".`
        : plan.kind === "select"
          ? ` Its input is in the tab "${name}".`
          : "";
    actions.announce(
      `Loaded the example "${ex.title}": ${op.qname} is now the only step.${where}` +
        (hadWork ? " Undo brings your previous recipe back." : "") +
        (issues > 0 ? ` The recipe has ${issues} ${issues === 1 ? "issue" : "issues"}.` : ""),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-op-help": ForgeOpHelp;
  }
}
