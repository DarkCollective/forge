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
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { ParamSpec } from "@forge/lang";
import type { CatalogueOp } from "@forge/ops";
import type { RecipeIssue } from "@forge/recipe";
import { actions, store } from "../state/app.js";
import { getStep } from "../state/recipe-ops.js";
import { StoreController } from "../state/store-controller.js";
import { baseStyles } from "../styles/shared.js";
import {
  constraintHint,
  defaultText,
  encodingChoices,
  encodingOf,
  isEncoded,
  isNumeric,
  stepNumberText,
  textToValue,
  valueToText,
} from "./convert.js";
import { paramIssues } from "./issues.js";

/** Debounce for typing; selects, checkboxes and resets write immediately (UI.md WP 3.4). */
const TYPING_DEBOUNCE_MS = 150;

/**
 * What the user has typed into a text-like field, kept next to the committed value.
 *
 * Raw text versus committed JSON value: the store holds only the committed value (`node.params[name]`,
 * see `convert.ts` `textToValue`). Parsing is lossy and normalising ("1." -> 1, "007" -> 7), so while a
 * field is being edited we remember the exact text and keep showing it. A draft is dropped (and the
 * field shows the stored value again) when
 *   * the stored value changes behind our back (undo, redo, reset, another editor): `committed` no
 *     longer equals the stored value;
 *   * the field loses focus and the validator reports nothing for it (the canonical form is shown).
 * A draft whose value the validator rejects survives blur, so the user keeps what they typed.
 */
interface Draft {
  text: string;
  /** The value we last wrote for this text (`pending` until the debounce fires). */
  committed: unknown;
  pending: boolean;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The parameter form of one op step, generated from the catalogue. `path` is the JSON pointer of the
 * op node ("/steps/0", or "/steps/2/test" for an if-test). Validity comes only from `state.issues`.
 */
@customElement("forge-param-form")
export class ForgeParamForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      form,
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        margin: 0;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 0;
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .head label,
      .check label {
        font-weight: var(--weight-medium);
        font-size: var(--text-sm);
      }
      .tag {
        font-size: var(--text-xs);
        color: var(--text-muted);
      }
      .reset {
        margin-inline-start: auto;
        min-height: var(--hit-min);
      }
      .control {
        display: flex;
        gap: var(--space-2);
        align-items: stretch;
        min-width: 0;
      }
      .control input,
      .control textarea,
      .control select {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
      }
      .control select.enc {
        flex: 0 0 auto;
        width: auto;
      }
      textarea {
        min-height: 4.5rem;
        resize: vertical;
      }
      .check {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--hit-min);
      }
      .check input {
        min-height: 0;
        width: 1.25rem;
        height: 1.25rem;
        accent-color: var(--accent);
      }
      .help {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-muted);
        overflow-wrap: anywhere;
      }
      .errors {
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: var(--text-sm);
        color: var(--danger);
      }
      .errors li.warning {
        color: var(--warn);
      }
      .errors strong {
        font-weight: var(--weight-bold);
      }
      [aria-invalid="true"] {
        border-color: var(--danger);
        outline: var(--border-width) solid var(--danger);
        outline-offset: 0;
      }
      [aria-invalid="true"]:focus-visible {
        outline: var(--focus-width) solid var(--focus);
        outline-offset: var(--focus-offset);
      }
      .unknown {
        border: var(--border-width) dashed var(--border-strong);
        border-radius: var(--radius-s);
        padding: var(--space-2);
      }
    `,
  ];

  /** JSON pointer of the op-like node. */
  @property({ type: String }) path = "";

  private readonly recipe = new StoreController(this, store, (s) => s.recipe);
  private readonly issues = new StoreController(this, store, (s) => s.issues);
  private readonly catalogue = new StoreController(this, store, (s) => s.catalogue);

  private drafts = new Map<string, Draft>();
  private timers = new Map<string, number>();
  @state() private revealed = new Set<string>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.flushAll();
  }

  protected override willUpdate(): void {
    // Drop drafts whose committed value was changed by someone else (undo, reset, load).
    const params = this.params();
    for (const [name, draft] of this.drafts) {
      if (!draft.pending && !same(draft.committed, params[name])) this.drafts.delete(name);
    }
  }

  // --- model -----------------------------------------------------------------------------------

  private node(): Record<string, unknown> | undefined {
    const step = getStep(this.recipe.value, this.path);
    return step === undefined ? undefined : (step as unknown as Record<string, unknown>);
  }

  private params(): Record<string, unknown> {
    const p = this.node()?.params;
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  }

  private opFor(qname: unknown): CatalogueOp | undefined {
    const c = this.catalogue.value;
    if (c.status !== "ready" || typeof qname !== "string") return undefined;
    return (
      c.catalogue.ops.find((o) => o.qname === qname) ??
      c.catalogue.ops.find((o) => o.aliases.includes(qname))
    );
  }

  // --- writes ----------------------------------------------------------------------------------

  private write(name: string, value: unknown): void {
    actions.setParam(this.path, name, value);
  }

  private commitDraft(spec: ParamSpec, enc?: string): void {
    const draft = this.drafts.get(spec.name);
    if (draft === undefined) return;
    const timer = this.timers.get(spec.name);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(spec.name);
    const value = textToValue(spec, draft.text, enc ?? this.currentEnc(spec));
    draft.committed = value;
    draft.pending = false;
    this.write(spec.name, value);
  }

  private flushAll(): void {
    for (const [name, timer] of this.timers) {
      window.clearTimeout(timer);
      const draft = this.drafts.get(name);
      const spec = this.specs().find((s) => s.name === name);
      this.timers.delete(name);
      if (draft?.pending === true && spec !== undefined) this.commitDraft(spec);
    }
  }

  private specs(): readonly ParamSpec[] {
    return this.opFor(this.node()?.op)?.params ?? [];
  }

  private currentEnc(spec: ParamSpec): string {
    return encodingOf(spec, this.params()[spec.name]);
  }

  private onText(spec: ParamSpec, text: string): void {
    this.drafts.set(spec.name, { text, committed: undefined, pending: true });
    const old = this.timers.get(spec.name);
    if (old !== undefined) window.clearTimeout(old);
    this.timers.set(
      spec.name,
      window.setTimeout(() => {
        this.timers.delete(spec.name);
        this.commitDraft(spec);
        this.requestUpdate();
      }, TYPING_DEBOUNCE_MS),
    );
    this.requestUpdate();
  }

  private onBlur(spec: ParamSpec): void {
    this.commitDraft(spec);
    if (paramIssues(this.issues.value, this.path, spec.name).length === 0) {
      this.drafts.delete(spec.name);
    }
    this.requestUpdate();
  }

  private onEnc(spec: ParamSpec, enc: string): void {
    const draft = this.drafts.get(spec.name);
    const text = draft?.text ?? this.textOf(spec);
    const value = textToValue(spec, text, enc);
    if (draft !== undefined) {
      draft.committed = value;
      draft.pending = false;
    }
    this.write(spec.name, value);
  }

  private onKeyDown(spec: ParamSpec, e: KeyboardEvent): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const input = e.target as HTMLInputElement;
    const next = stepNumberText(spec, input.value, e.key === "ArrowUp" ? 1 : -1);
    if (next === undefined) return;
    e.preventDefault();
    input.value = next;
    this.onText(spec, next);
  }

  private reset(spec: ParamSpec): void {
    const timer = this.timers.get(spec.name);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(spec.name);
    this.drafts.delete(spec.name);
    this.write(spec.name, undefined);
    actions.announce(`${spec.name} reset to ${spec.required ? "empty" : "its default"}`);
  }

  // --- rendering -------------------------------------------------------------------------------

  /** The text a text-like control shows: the draft, else the stored value (default stays a placeholder). */
  private textOf(spec: ParamSpec): string {
    const draft = this.drafts.get(spec.name);
    if (draft !== undefined) return draft.text;
    return valueToText(this.params()[spec.name]);
  }

  protected override render() {
    const catalogue = this.catalogue.value;
    const node = this.node();
    if (node === undefined) return html`<span class="help">No step at ${this.path}.</span>`;
    if (catalogue.status !== "ready") {
      return html`<span class="help">Parameters load with the catalogue.</span>`;
    }
    const op = this.opFor(node.op);
    if (op === undefined) {
      return html`<span class="help">Unknown operation, so its parameters cannot be shown.</span>`;
    }
    const params = this.params();
    const known = new Set(op.params.map((p) => p.name));
    const extras = Object.keys(params).filter((k) => !known.has(k));
    if (op.params.length === 0 && extras.length === 0) {
      return html`<span class="help">This operation has no parameters.</span>`;
    }
    return html`<div class="fields" role="group" aria-label=${`Parameters of ${op.name}`}>
      ${op.params.map((p) => this.renderField(p))} ${extras.map((k) => this.renderExtra(k))}
    </div>`;
  }

  private renderExtra(name: string) {
    const errors = paramIssues(this.issues.value, this.path, name);
    const errId = `err-${name}`;
    return html`<div class="field unknown">
      <div class="head">
        <span class="mono">${name}</span>
        <span class="tag">not a parameter of this operation</span>
        <button
          type="button"
          class="reset"
          aria-label=${`Remove ${name}`}
          aria-describedby=${errors.length > 0 ? errId : nothing}
          @click=${() => this.write(name, undefined)}
        >
          Remove
        </button>
      </div>
      ${this.renderErrors(errId, errors)}
    </div>`;
  }

  private renderErrors(id: string, errors: readonly RecipeIssue[]) {
    if (errors.length === 0) return nothing;
    return html`<ul class="errors" id=${id}>
      ${errors.map(
        (e) =>
          html`<li class=${e.severity}>
            <strong>${e.severity === "error" ? "Error:" : "Note:"}</strong> ${e.message}
          </li>`,
      )}
    </ul>`;
  }

  private renderField(spec: ParamSpec): TemplateResult {
    const name = spec.name;
    const id = `p-${name}`;
    const helpId = `help-${name}`;
    const errId = `err-${name}`;
    const errors = paramIssues(this.issues.value, this.path, name).filter(
      (i) => i.severity === "error" || i.severity === "warning",
    );
    const invalid = errors.some((e) => e.severity === "error");
    const present = Object.hasOwn(this.params(), name);
    const describedBy = [helpId, errors.length > 0 ? errId : ""].filter(Boolean).join(" ");

    const helpParts: string[] = [];
    if (spec.doc !== undefined && spec.doc !== "") helpParts.push(spec.doc);
    const hint = constraintHint(spec);
    if (hint !== "") helpParts.push(`${hint}.`);
    if (spec.default !== undefined && spec.type !== "bool" && spec.type !== "choice") {
      const d = defaultText(spec);
      if (d !== "") helpParts.push(`Default: ${d}.`);
    }
    if (spec.type === "regex") {
      helpParts.push("ECMAScript syntax, Unicode mode; flags are set separately.");
    }
    if (spec.type === "key") {
      helpParts.push("Stored in the clear in share links and the text form.");
    }
    const resetLabel = spec.required ? "Clear" : "Reset";

    const head =
      spec.type === "bool"
        ? nothing
        : html`<div class="head">
            <label for=${id}>${name}</label>
            ${spec.required ? html`<span class="tag">required</span>` : nothing}
            ${this.renderReset(spec, present, resetLabel)}
          </div>`;

    return html`<div class="field" data-param=${name}>
      ${head} ${this.renderControl(spec, id, describedBy, invalid)}
      ${
        spec.type === "bool" && present
          ? html`<div class="head">${this.renderReset(spec, present, resetLabel)}</div>`
          : nothing
      }
      <p class="help" id=${helpId}>${helpParts.join(" ")}</p>
      ${this.renderErrors(errId, errors)}
    </div>`;
  }

  private renderReset(spec: ParamSpec, present: boolean, label: string) {
    if (!present) return nothing;
    return html`<button
      type="button"
      class="ghost reset"
      aria-label=${`${label} ${spec.name}${spec.required ? "" : " to default"}`}
      @click=${() => this.reset(spec)}
    >
      ${label}
    </button>`;
  }

  private renderControl(spec: ParamSpec, id: string, describedBy: string, invalid: boolean) {
    const invalidAttr = invalid ? "true" : "false";
    const value = this.params()[spec.name];
    const placeholder = defaultText(spec);
    switch (spec.type) {
      case "bool": {
        const checked = typeof value === "boolean" ? value : spec.default === true;
        return html`<div class="check">
          <input
            type="checkbox"
            id=${id}
            .checked=${checked}
            aria-invalid=${invalidAttr}
            aria-describedby=${describedBy}
            @change=${(e: Event) => this.write(spec.name, (e.target as HTMLInputElement).checked)}
          />
          <label for=${id}>${spec.name}</label>
          ${spec.required ? html`<span class="tag">required</span>` : nothing}
        </div>`;
      }
      case "choice": {
        const options = spec.options ?? [];
        const current = typeof value === "string" ? value : "";
        const shown =
          current !== "" ? current : typeof spec.default === "string" ? spec.default : "";
        const odd = shown !== "" && !options.includes(shown);
        return html`<div class="control">
          <select
            id=${id}
            aria-invalid=${invalidAttr}
            aria-describedby=${describedBy}
            @change=${(e: Event) => this.write(spec.name, (e.target as HTMLSelectElement).value)}
          >
            ${shown === "" ? html`<option value="" selected>Choose...</option>` : nothing}
            ${odd ? html`<option value=${shown} selected>${shown}</option>` : nothing}
            ${options.map((o) => html`<option value=${o} ?selected=${o === shown}>${o}</option>`)}
          </select>
        </div>`;
      }
      case "toggle":
      case "key":
        return this.renderEncoded(spec, id, describedBy, invalidAttr);
      default:
        break;
    }
    // Numeric with a oneOf constraint: pick from the list (a stored odd value stays visible).
    const oneOf = spec.constraint?.oneOf;
    if (isNumeric(spec.type) && oneOf !== undefined && oneOf.length > 0) {
      const shown = this.textOf(spec) || placeholder;
      const list = oneOf.map(String);
      return html`<div class="control">
        <select
          id=${id}
          aria-invalid=${invalidAttr}
          aria-describedby=${describedBy}
          @change=${(e: Event) => {
            this.drafts.delete(spec.name);
            this.write(spec.name, textToValue(spec, (e.target as HTMLSelectElement).value));
          }}
        >
          ${list.includes(shown) ? nothing : html`<option value=${shown} selected>${shown}</option>`}
          ${list.map((o) => html`<option value=${o} ?selected=${o === shown}>${o}</option>`)}
        </select>
      </div>`;
    }
    const text = this.textOf(spec);
    const onInput = (e: Event) => this.onText(spec, (e.target as HTMLInputElement).value);
    const onBlur = () => this.onBlur(spec);
    if (spec.type === "str" && this.isLongText(spec)) {
      return html`<div class="control">
        <textarea
          id=${id}
          rows="2"
          spellcheck="false"
          placeholder=${placeholder}
          .value=${live(text)}
          aria-invalid=${invalidAttr}
          aria-describedby=${describedBy}
          @input=${onInput}
          @blur=${onBlur}
        ></textarea>
      </div>`;
    }
    const numeric = isNumeric(spec.type);
    const mono = spec.type === "regex" || spec.type === "charset" || spec.type === "bytes";
    return html`<div class="control">
      <input
        type="text"
        id=${id}
        class=${mono ? "mono" : ""}
        inputmode=${spec.type === "int" ? "numeric" : numeric ? "decimal" : "text"}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder=${placeholder}
        .value=${live(text)}
        aria-invalid=${invalidAttr}
        aria-describedby=${describedBy}
        @input=${onInput}
        @blur=${onBlur}
        @keydown=${numeric ? (e: KeyboardEvent) => this.onKeyDown(spec, e) : nothing}
      />
    </div>`;
  }

  /** A `str` gets a textarea unless its declared maximum length is short. */
  private isLongText(spec: ParamSpec): boolean {
    const max = spec.constraint?.maxLength;
    return max === undefined || max > 64;
  }

  private renderEncoded(spec: ParamSpec, id: string, describedBy: string, invalidAttr: string) {
    const value = this.params()[spec.name];
    const draft = this.drafts.get(spec.name);
    const fallback = isEncoded(spec.default) && value === undefined ? spec.default.value : "";
    const text = draft?.text ?? (value === undefined ? fallback : valueToText(value));
    const enc = this.currentEnc(spec);
    const secret = spec.type === "key" && !this.revealed.has(spec.name);
    const choices = encodingChoices(spec);
    const encChoices = choices.includes(enc) ? choices : [enc, ...choices];
    return html`<div class="control">
      <input
        type=${secret ? "password" : "text"}
        id=${id}
        class="mono"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        .value=${live(text)}
        aria-invalid=${invalidAttr}
        aria-describedby=${describedBy}
        @input=${(e: Event) => this.onText(spec, (e.target as HTMLInputElement).value)}
        @blur=${() => this.onBlur(spec)}
      />
      <select
        class="enc"
        aria-label=${`Encoding of ${spec.name}`}
        aria-invalid=${invalidAttr}
        aria-describedby=${describedBy}
        @change=${(e: Event) => this.onEnc(spec, (e.target as HTMLSelectElement).value)}
      >
        ${encChoices.map((o) => html`<option value=${o} ?selected=${o === enc}>${o}</option>`)}
      </select>
      ${
        spec.type === "key"
          ? html`<button
              type="button"
              aria-pressed=${this.revealed.has(spec.name) ? "true" : "false"}
              @click=${() => this.toggleReveal(spec.name)}
            >
              Reveal
            </button>`
          : nothing
      }
    </div>`;
  }

  private toggleReveal(name: string): void {
    const next = new Set(this.revealed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.revealed = next;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-param-form": ForgeParamForm;
  }
}
