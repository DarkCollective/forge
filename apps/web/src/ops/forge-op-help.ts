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
// Container: the shared dialog system (WP 6.13b). This is a `ForgeDialog` with the id "op-help": it is
// open while `ui.dialog === "op-help"` and shows the operation `ui.helpOp`, so frame, title, close
// button, focus trap, Escape, backdrop and focus return are the same as in every other dialog.
// Navigating to the inverse's help is `actions.openOpHelp(other)` while open; only the one-step Back
// target (`previous`) is local to this element and is forgotten when the dialog closes.
// A modal dialog rather than the hover popover (which cannot hold buttons or links) or a side panel
// (which would take room from the working panes and does not exist in the compact layout).
//
// Everything is rendered as text. Links are plain https anchors (viewLink checks again).
import { css, html, nothing } from "lit";
import type { CSSResultGroup, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { CatalogueOp, HelpExample, HelpOp } from "@forge/ops";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import { icons } from "../styles/icons.js";
import { ForgeDialog } from "../shell/forge-dialog.js";
import type { DialogId } from "../state/types.js";
import { helpFor } from "./help.js";
import type { HelpState } from "./help-data.js";
import { helpLoader } from "./help-loader.js";
import { exampleTabName, viewExpect, viewLink, viewParams, viewValue } from "./help-view.js";
import type { ValueView } from "./help-view.js";
import { planTryIt } from "./try-it.js";
import { applyTryIt } from "./try-it-apply.js";
import { hasReferencePage, opPath } from "../pages/slug.js";

@customElement("forge-op-help")
export class ForgeOpHelp extends ForgeDialog {
  static override styles: CSSResultGroup = [
    ForgeDialog.styles,
    css`
      dialog {
        width: min(44rem, calc(100vw - 2 * var(--space-4)));
        max-height: calc(100dvh - 2 * var(--space-5));
      }
      header h2 {
        font-family: var(--font-mono);
        overflow-wrap: anywhere;
      }
      .body {
        padding: var(--space-3) var(--space-4) var(--space-4);
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

  protected readonly dialogId: DialogId = "op-help";
  protected override readonly closeLabel = "Close help";
  protected override readonly headingFocusable = true;

  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);
  private readonly steps = new StoreController(this, store, (s) => s.recipe.steps.length);
  private readonly helpOp = new StoreController(this, store, (s) => s.ui.helpOp);

  @state() private previous: string | null = null;
  @state() private help: HelpState = { status: "idle" };
  @state() private confirming: number | null = null;
  @state() private problem: string | null = null;

  /** The operation the last update was prepared for (null while closed), to notice a change. */
  private shown: string | null = null;

  protected override get heading(): string {
    return this.helpOp.value ?? "";
  }

  /** The operation being shown, or null while closed or when the catalogue does not have it. */
  private get op(): CatalogueOp | null {
    const qname = this.helpOp.value;
    const cat = this.catalogue.value;
    if (qname === null || cat.status !== "ready") return null;
    return cat.catalogue.ops.find((o) => o.qname === qname) ?? null;
  }

  protected override willUpdate(): void {
    const qname = this.isOpen ? this.helpOp.value : null;
    if (qname === this.shown) return;
    this.shown = qname;
    this.confirming = null;
    this.problem = null;
    if (qname === null) this.previous = null;
    else void this.loadHelp();
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

  protected override renderBody(): TemplateResult {
    const op = this.op;
    return op === null ? html`${nothing}` : this.renderOp(op);
  }

  private renderOp(op: CatalogueOp): TemplateResult {
    const h = helpFor(op);
    const entry: HelpOp | undefined =
      this.help.status === "ready" ? this.help.index.get(op.qname) : undefined;
    return html`
      ${
        this.previous === null
          ? nothing
          : html`<p>
              <button type="button" @click=${() => this.back()}>Back to ${this.previous}</button>
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
      ${
        hasReferencePage(op)
          ? html`<p>
              <a href=${opPath(op)} target="_blank" rel="noopener">Reference page</a>
              <span class="muted">(opens in a new tab)</span>
            </p>`
          : nothing
      }
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
      ${v.lineBreaks === null ? nothing : html`<p class="reading">${v.lineBreaks}</p>`}
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
    this.previous = this.helpOp.value;
    actions.openOpHelp(target.qname);
    this.focusHeading();
  }

  private back(): void {
    const previous = this.previous;
    if (previous === null) return;
    this.previous = null;
    actions.openOpHelp(previous);
    this.focusHeading();
  }

  private focusHeading(): void {
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>("h2")?.focus();
      this.renderRoot.querySelector(".body")?.scrollTo({ top: 0 });
    });
  }

  /**
   * Close the dialog, then say `text`. The live region is inert while a modal dialog is open, so the
   * announcement waits until this element has updated (and so closed its native dialog).
   */
  private closeThenAnnounce(text: string): void {
    actions.closeDialog();
    void this.updateComplete.then(() => actions.announce(text));
  }

  private addInverse(target: CatalogueOp): void {
    actions.addOp(target.qname);
    this.closeThenAnnounce(`Added ${target.qname} to the recipe`);
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
    const { plan } = applyTryIt(actions, s.inputs, s.activeInputId, name, bytes);
    if (store.get().ui.compact) actions.setCompactTab("output");
    const issues = store.get().issues.length;
    const where =
      plan.kind === "new"
        ? ` Its input is in the new tab "${name}".`
        : plan.kind === "select"
          ? ` Its input is in the tab "${name}".`
          : "";
    this.closeThenAnnounce(
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
