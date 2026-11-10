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
// The recipe pane (UI.md WP 3.3): the recipe as a vertical pipeline of step cards with nested blocks.
//
// Keyboard (also listed in the pane's tooltips and announced when a step is lifted):
//   Up / Down, Home / End   on a card: move focus to the previous / next / first / last card
//   Left / Right            on a card: collapse / expand a block
//   Alt+Up / Alt+Down       on a card or its buttons: move the step among its siblings
//   Left / Right, Home/End  in a card's button row: move between its buttons (one Tab stop per card)
//   Space or Enter          on the "Move" button: lift the step; then Up / Down move it among its
//                           siblings (and between the Then and Else lanes), Right moves it into the
//                           block above, Left out of its block, Space or Enter drops, Escape cancels
//   Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y)   undo / redo, when focus is not in a text field
import { LitElement, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import type { Catalogue } from "@forge/ops";
import type { BakeResult, StepReport } from "@forge/worker";
import type { Encoded, IfStep, Recipe, RecipeIssue, Step } from "@forge/recipe";
import { actions, store } from "../state/app.js";
import { beginPointerDrag, onDragChange, registerDropTarget } from "../state/dnd.js";
import type { DragPayload } from "../state/dnd.js";
import {
  childLists,
  childPath,
  getList,
  getStep,
  isWithin,
  splitStepPath,
} from "../state/recipe-ops.js";
import type { ListPath, StepPath } from "../state/recipe-ops.js";
import { StoreController } from "../state/store-controller.js";
import { baseStyles, paneStyles } from "../styles/shared.js";
import { icons } from "../styles/icons.js";
import "../shell/forge-menu.js";
import type { MenuItem } from "../shell/forge-menu.js";
import { BLOCK_KINDS, BLOCK_LABELS, defaultBlock } from "./defaults.js";
import type { BlockKind } from "./defaults.js";
import { escapeText, toggleFlag, unescapeText, usesEscapes } from "./fields.js";
import { recipeIcons } from "./icons.js";
import { fieldIssues, issueCounts, stepLevelIssues } from "./issues.js";
import { moveTarget } from "./move.js";
import type { MoveKey } from "./move.js";
import { ownerOfList, pathAfterMove, stepNumber } from "./paths.js";
import { recipeStyles } from "./recipe-styles.js";

type CatalogueOp = Catalogue["ops"][number];

const ENCODINGS: readonly (readonly [string, string])[] = [
  ["utf8", "Text (UTF-8)"],
  ["hex", "Hex"],
  ["latin1", "Latin-1"],
  ["base64", "Base64"],
];

const KIND_TITLES: Readonly<Record<string, string>> = {
  fork: "Fork",
  subsection: "Subsection",
  if: "If",
  repeat: "Repeat",
  comment: "Comment",
};

const DEBOUNCE_MS = 300;

interface Chip {
  readonly text: string;
  readonly tone: string;
}

interface Lift {
  readonly origin: StepPath;
  path: StepPath;
  moves: number;
}

function isTextField(e: Event): boolean {
  const first = e.composedPath()[0];
  if (!(first instanceof HTMLElement)) return false;
  const tag = first.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || first.isContentEditable;
}

const idOf = (path: string, field: string): string => `f${path.replace(/\//g, "-")}-${field}`;

@customElement("forge-recipe")
export class ForgeRecipe extends LitElement {
  static override styles = [baseStyles, paneStyles, recipeStyles];

  private readonly recipe = new StoreController(this, store, (s) => s.recipe);
  private readonly issues = new StoreController(this, store, (s) => s.issues);
  private readonly cat = new StoreController(this, store, (s) => s.catalogue);
  private readonly bake = new StoreController(this, store, (s) => s.bake);
  private readonly selected = new StoreController(this, store, (s) => s.ui.selectedPath);
  private readonly canUndo = new StoreController(this, store, (s) => s.history.past.length > 0);
  private readonly canRedo = new StoreController(this, store, (s) => s.history.future.length > 0);

  @state() private collapsed: ReadonlySet<string> = new Set();
  @state() private noteOpen: ReadonlySet<string> = new Set();
  @state() private lifted: Lift | null = null;
  @state() private drop: { listPath: ListPath; gap: number } | null = null;
  @state() private dragging: DragPayload | null = null;

  private readonly targets = new Map<Element, () => void>();
  private readonly drafts = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private offDrag: (() => void) | undefined;
  private refocusing = false;
  private lastSelected: string | null = null;
  private timingCache: { result: BakeResult | null; map: Map<string, StepReport> } = {
    result: null,
    map: new Map(),
  };
  private opCache: { catalogue: Catalogue | null; map: Map<string, CatalogueOp> } = {
    catalogue: null,
    map: new Map(),
  };

  // --------------------------------------------------------------------------------- lifecycle

  override connectedCallback(): void {
    super.connectedCallback();
    this.offDrag = onDragChange((payload) => {
      this.dragging = payload;
      if (payload === null) this.drop = null;
    });
    if (this.hasUpdated) this.syncTargets();
  }

  override disconnectedCallback(): void {
    this.offDrag?.();
    for (const off of this.targets.values()) off();
    this.targets.clear();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    super.disconnectedCallback();
  }

  /** Move focus to the selected card (or the first one), or the pane title when the recipe is empty. */
  focusPrimary(): void {
    const sel = this.selected.value;
    const card =
      (sel !== null ? this.cardEl(sel) : null) ??
      this.renderRoot.querySelector<HTMLElement>(".card");
    if (card !== null) card.focus();
    else this.renderRoot.querySelector<HTMLElement>("h2")?.focus();
  }

  protected override willUpdate(): void {
    // A selection made elsewhere (a bake error, a breakpoint) must be visible: open its ancestors.
    const sel = this.selected.value;
    if (sel !== null && sel !== this.lastSelected && this.collapsed.size > 0) {
      const keep = [...this.collapsed].filter((c) => c === sel || !isWithin(sel, c));
      if (keep.length !== this.collapsed.size) this.collapsed = new Set(keep);
    }
  }

  protected override updated(): void {
    this.syncTargets();
    const sel = this.selected.value;
    if (sel !== this.lastSelected) {
      this.lastSelected = sel;
      if (sel !== null) this.cardEl(sel)?.scrollIntoView({ block: "nearest" });
    }
  }

  // ------------------------------------------------------------------------------- data helpers

  private catalogue(): Catalogue | null {
    const c = this.cat.value;
    return c.status === "ready" ? c.catalogue : null;
  }

  private opInfo(qname: string): CatalogueOp | undefined {
    const catalogue = this.catalogue();
    if (catalogue === null) return undefined;
    if (this.opCache.catalogue !== catalogue) {
      const map = new Map<string, CatalogueOp>();
      for (const op of catalogue.ops) for (const a of op.aliases) map.set(a, op);
      for (const op of catalogue.ops) map.set(op.qname, op);
      this.opCache = { catalogue, map };
    }
    return this.opCache.map.get(qname);
  }

  private timings(): Map<string, StepReport> {
    const result = this.bake.value.result;
    if (this.timingCache.result !== result) {
      const map = new Map<string, StepReport>();
      for (const s of result?.steps ?? []) map.set(s.path, s);
      this.timingCache = { result, map };
    }
    return this.timingCache.map;
  }

  private titleOf(step: Step): { name: string; vocab: string | null } {
    if (step.kind === "op") {
      const info = this.opInfo(step.op);
      return { name: info?.name ?? step.op, vocab: info?.vocab ?? null };
    }
    return { name: KIND_TITLES[step.kind] ?? step.kind, vocab: null };
  }

  private cardEl(path: StepPath): HTMLElement | null {
    for (const el of this.renderRoot.querySelectorAll<HTMLElement>(".card")) {
      if (el.dataset["path"] === path) return el;
    }
    return null;
  }

  /** Human description of where a step sits, for announcements. */
  private locate(path: StepPath): string {
    const recipe = store.get().recipe;
    const { listPath, index } = splitStepPath(path);
    const count = getList(recipe, listPath).length;
    const owner = ownerOfList(listPath);
    let where = `Step ${index + 1} of ${count}`;
    if (owner !== null) {
      const parent = getStep(recipe, owner);
      const lane = listPath.endsWith("/then") ? " then" : listPath.endsWith("/else") ? " else" : "";
      if (parent !== undefined) {
        where += ` in ${this.titleOf(parent).name} ${stepNumber(owner)}${lane}`;
      }
    }
    return where;
  }

  private label(path: StepPath): string {
    const step = getStep(store.get().recipe, path);
    return step === undefined ? "step" : `step ${stepNumber(path)}, ${this.titleOf(step).name}`;
  }

  // ---------------------------------------------------------------------------------- focusing

  private async focusCard(path: StepPath, action?: string): Promise<void> {
    this.refocusing = true;
    try {
      await this.updateComplete;
      const card = this.cardEl(path);
      const button =
        action === undefined
          ? null
          : card?.querySelector<HTMLElement>(`:scope > .toolbar [data-action="${action}"]`);
      (button ?? card)?.focus();
    } finally {
      this.refocusing = false;
    }
  }

  /** After a deletion: the step now at the same place, else the one before, else its owner, else the pane. */
  private async focusAfterRemoval(listPath: ListPath, index: number): Promise<void> {
    await this.updateComplete;
    const owner = ownerOfList(listPath);
    const candidates = [
      childPath(listPath, index),
      index > 0 ? childPath(listPath, index - 1) : "",
    ];
    if (owner !== null) candidates.push(owner);
    for (const c of candidates) {
      const el = c === "" ? null : this.cardEl(c);
      if (el !== null) {
        el.focus();
        return;
      }
    }
    this.renderRoot.querySelector<HTMLElement>(".pane-head button, h2")?.focus();
  }

  // ----------------------------------------------------------------------------------- actions

  private select(path: StepPath): void {
    if (store.get().ui.selectedPath !== path) actions.selectStep(path);
  }

  private toggleIn(set: ReadonlySet<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  private toggleFlagOf(path: StepPath, key: "disabled" | "breakpoint", label: string): void {
    const step = getStep(store.get().recipe, path);
    if (step === undefined || step.kind === "comment") return;
    const on = step[key] !== true;
    actions.patchStep(path, { [key]: on ? true : undefined });
    actions.announce(`${label} ${on ? "on" : "off"} for ${this.label(path)}`);
  }

  private duplicate(path: StepPath): void {
    actions.duplicateStep(path);
    const { listPath, index } = splitStepPath(path);
    const copy = childPath(listPath, index + 1);
    actions.announce(`Duplicated ${this.label(path)}. ${this.locate(copy)}`);
    this.select(copy);
    void this.focusCard(copy, "duplicate");
  }

  private deleteStep(path: StepPath): void {
    const what = this.label(path);
    const { listPath, index } = splitStepPath(path);
    actions.removeStep(path);
    const sel = store.get().ui.selectedPath;
    if (sel !== null && isWithin(sel, path)) actions.selectStep(null);
    actions.announce(`Deleted ${what}`);
    void this.focusAfterRemoval(listPath, index);
  }

  /** Move by key; returns the new path, or null when nothing moved. */
  private move(path: StepPath, key: MoveKey): StepPath | null {
    const target = moveTarget(store.get().recipe, path, key);
    if (target === null) return null;
    const next = pathAfterMove(path, target.listPath, target.gap);
    actions.moveStep(path, target.listPath, target.gap);
    return next;
  }

  private moveButton(path: StepPath, key: MoveKey): void {
    const next = this.move(path, key);
    if (next === null) {
      actions.announce(`${this.label(path)} cannot move ${key === "in" ? "into a block" : key}`);
      return;
    }
    this.select(next);
    actions.announce(`Moved ${this.label(next)}. ${this.locate(next)}`);
    void this.focusCard(next, key);
  }

  private addBlock(kind: BlockKind): void {
    const recipe = store.get().recipe;
    const sel = store.get().ui.selectedPath;
    let listPath: ListPath = "/steps";
    let index = recipe.steps.length;
    if (sel !== null && getStep(recipe, sel) !== undefined) {
      const at = splitStepPath(sel);
      listPath = at.listPath;
      index = at.index + 1;
    }
    const path = actions.insertStep(listPath, index, defaultBlock(kind));
    actions.selectStep(path);
    actions.announce(`Added ${BLOCK_LABELS[kind]}. ${this.locate(path)}`);
    void this.focusCard(path);
  }

  private clear(): void {
    const recipe = store.get().recipe;
    if (recipe.steps.length === 0) return;
    actions.setRecipe({ ...recipe, steps: [] } as Recipe);
    actions.selectStep(null);
    actions.announce("Recipe cleared. Undo with Control Z.");
  }

  private undo(): void {
    actions.undo();
    actions.announce("Undone");
  }

  private redo(): void {
    actions.redo();
    actions.announce("Redone");
  }

  // ------------------------------------------------------------------ keyboard lift and move

  private lift(path: StepPath): void {
    this.lifted = { origin: path, path, moves: 0 };
    this.select(path);
    actions.announce(
      `Lifted ${this.label(path)}. ${this.locate(path)}. Use Up and Down to move, Right to move into the block above, Left to move out, Enter to drop, Escape to cancel.`,
    );
  }

  private endLift(cancel: boolean, announce = true): void {
    const lift = this.lifted;
    if (lift === null) return;
    this.lifted = null;
    if (cancel) {
      for (let i = 0; i < lift.moves; i += 1) actions.undo();
      this.select(lift.origin);
      if (announce) actions.announce(`Move cancelled. ${this.locate(lift.origin)}`);
      void this.focusCard(lift.origin, "handle");
    } else if (announce) {
      actions.announce(`Dropped ${this.label(lift.path)}. ${this.locate(lift.path)}`);
    }
  }

  private onHandleKey(e: KeyboardEvent, path: StepPath): void {
    const lift = this.lifted;
    if (lift === null) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.lift(path);
      }
      return;
    }
    const keys: Record<string, MoveKey> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowRight: "in",
      ArrowLeft: "out",
    };
    const key = keys[e.key];
    if (key !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      const next = this.move(lift.path, key);
      if (next === null) {
        actions.announce(
          `Cannot move ${key === "in" ? "into a block" : key === "out" ? "out of this block" : key} here. ${this.locate(lift.path)}`,
        );
        return;
      }
      lift.path = next;
      lift.moves += 1;
      this.requestUpdate();
      this.select(next);
      actions.announce(this.locate(next));
      void this.focusCard(next, "handle");
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this.endLift(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.endLift(true);
    }
  }

  private onHandleBlur(): void {
    if (this.lifted !== null && !this.refocusing) this.endLift(false);
  }

  // --------------------------------------------------------------------- generic key handling

  private onPaneKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTextField(e)) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (k === "y") {
        e.preventDefault();
        this.redo();
      }
    }
  }

  private cardOf(e: Event): HTMLElement | null {
    for (const n of e.composedPath()) {
      if (n instanceof HTMLElement && n.classList.contains("card")) return n;
    }
    return null;
  }

  private onCardKey(e: KeyboardEvent): void {
    if (this.cardOf(e) !== e.currentTarget || isTextField(e)) return;
    const card = e.currentTarget as HTMLElement;
    const path = card.dataset["path"] as string;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (this.lifted !== null) return;
      e.preventDefault();
      this.moveButton(path, e.key === "ArrowUp" ? "up" : "down");
      return;
    }
    if (e.target !== card || e.altKey || e.ctrlKey || e.metaKey) return;
    const cards = [...this.renderRoot.querySelectorAll<HTMLElement>(".card")];
    const i = cards.indexOf(card);
    let to: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        to = cards[i + 1];
        break;
      case "ArrowUp":
        to = cards[i - 1];
        break;
      case "Home":
        to = cards[0];
        break;
      case "End":
        to = cards.at(-1);
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        const step = getStep(store.get().recipe, path);
        if (step === undefined || childLists(step, path).length === 0) return;
        e.preventDefault();
        const wantCollapsed = e.key === "ArrowLeft";
        if (this.collapsed.has(path) !== wantCollapsed)
          this.collapsed = this.toggleIn(this.collapsed, path);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    to?.focus();
  }

  private onToolbarKey(e: KeyboardEvent): void {
    if (this.lifted !== null) return;
    const bar = e.currentTarget as HTMLElement;
    const buttons = [...bar.querySelectorAll<HTMLElement>("button")];
    const i = buttons.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    let to: HTMLElement | undefined;
    if (e.key === "ArrowRight") to = buttons[(i + 1) % buttons.length];
    else if (e.key === "ArrowLeft") to = buttons[(i - 1 + buttons.length) % buttons.length];
    else if (e.key === "Home") to = buttons[0];
    else if (e.key === "End") to = buttons.at(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
    to?.focus();
  }

  private onToolbarFocus(e: FocusEvent): void {
    const bar = e.currentTarget as HTMLElement;
    const target = e.target as HTMLElement;
    if (target.tagName !== "BUTTON") return;
    for (const b of bar.querySelectorAll("button")) b.tabIndex = b === target ? 0 : -1;
  }

  // ---------------------------------------------------------------------- pointer drag and drop

  private syncTargets(): void {
    const lanes = new Set(this.renderRoot.querySelectorAll<HTMLElement>(".lane"));
    for (const [el, off] of this.targets) {
      if (!lanes.has(el as HTMLElement)) {
        off();
        this.targets.delete(el);
      }
    }
    for (const lane of lanes) {
      if (this.targets.has(lane)) continue;
      const listPath = (): string => lane.dataset["list"] as string;
      this.targets.set(
        lane,
        registerDropTarget({
          element: lane,
          accepts: (p) => !(p.type === "step" && isWithin(listPath(), p.path)),
          onOver: (_p, at) => {
            const gap = this.gapAt(lane, at.y);
            const cur = this.drop;
            if (cur === null || cur.listPath !== listPath() || cur.gap !== gap) {
              this.drop = { listPath: listPath(), gap };
            }
          },
          onLeave: () => {
            this.drop = null;
          },
          onDrop: (p, at) => this.dropOn(listPath(), this.gapAt(lane, at.y), p),
        }),
      );
    }
  }

  /** The gap index in a lane for a pointer at height `y`. */
  private gapAt(lane: HTMLElement, y: number): number {
    const items = lane.querySelectorAll<HTMLElement>(":scope > ol > li.step");
    let gap = 0;
    for (const li of items) {
      const head = li.querySelector<HTMLElement>(":scope > .card > .card-head") ?? li;
      const r = head.getBoundingClientRect();
      if (y < r.top + r.height / 2) return gap;
      gap += 1;
    }
    return gap;
  }

  private dropOn(listPath: ListPath, gap: number, payload: DragPayload): void {
    if (payload.type === "op") {
      const path = actions.addOp(payload.op, { listPath, index: gap });
      actions.selectStep(path);
      actions.announce(`Added ${this.label(path)}. ${this.locate(path)}`);
      void this.focusCard(path);
      return;
    }
    if (isWithin(listPath, payload.path)) return;
    const next = pathAfterMove(payload.path, listPath, gap);
    actions.moveStep(payload.path, listPath, gap);
    actions.selectStep(next);
    actions.announce(`Moved ${this.label(next)}. ${this.locate(next)}`);
    void this.focusCard(next);
  }

  // --------------------------------------------------------------------------- field editing

  private draft(key: string, committed: string): string {
    return this.drafts.get(key) ?? committed;
  }

  /** Text-like input: commits after a pause while typing and at once on change. */
  private onTyping(key: string, text: string, commit: (text: string) => void): void {
    this.drafts.set(key, text);
    const old = this.timers.get(key);
    if (old !== undefined) clearTimeout(old);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        commit(text);
      }, DEBOUNCE_MS),
    );
  }

  private onCommitted(key: string, text: string, commit: (text: string) => void): void {
    const old = this.timers.get(key);
    if (old !== undefined) clearTimeout(old);
    this.timers.delete(key);
    commit(text);
    this.drafts.delete(key);
    this.requestUpdate();
  }

  private patch(path: StepPath, patch: Record<string, unknown>): void {
    actions.patchStep(path, patch);
  }

  private issueList(id: string, issues: readonly RecipeIssue[]) {
    if (issues.length === 0) return nothing;
    return html`<ul class="issues" id=${id}>
      ${issues.map(
        (i) =>
          html`<li class=${i.severity}>
            <span class="sev">${i.severity === "error" ? "Error" : "Warning"}:</span> ${i.message}
          </li>`,
      )}
    </ul>`;
  }

  private errorsOf(issues: readonly RecipeIssue[]): boolean {
    return issues.some((i) => i.severity === "error");
  }

  /** A labelled single-line text field with inline issues. */
  private textField(o: {
    path: StepPath;
    field: string;
    label: string;
    value: string;
    mono?: boolean;
    hint?: string;
    number?: { min: number; max: number };
    placeholder?: string;
    issues: readonly RecipeIssue[];
    commit: (text: string) => void;
  }) {
    const id = idOf(o.path, o.field);
    const key = `${o.path}|${o.field}`;
    const described = [o.issues.length > 0 ? `${id}-err` : "", o.hint ? `${id}-hint` : ""]
      .filter((x) => x !== "")
      .join(" ");
    return html`<div class="field">
      <label for=${id}>${o.label}</label>
      <input
        id=${id}
        class=${o.mono ? "mono" : ""}
        type=${o.number ? "number" : "text"}
        min=${o.number ? String(o.number.min) : nothing}
        max=${o.number ? String(o.number.max) : nothing}
        step=${o.number ? "1" : nothing}
        placeholder=${o.placeholder ?? nothing}
        autocomplete="off"
        spellcheck="false"
        aria-invalid=${this.errorsOf(o.issues) ? "true" : nothing}
        aria-describedby=${described === "" ? nothing : described}
        .value=${this.draft(key, o.value)}
        @input=${(e: Event) => this.onTyping(key, (e.target as HTMLInputElement).value, o.commit)}
        @change=${(e: Event) =>
          this.onCommitted(key, (e.target as HTMLInputElement).value, o.commit)}
      />
      ${o.hint ? html`<span class="hint" id="${id}-hint">${o.hint}</span>` : nothing}
      ${this.issueList(`${id}-err`, o.issues)}
    </div>`;
  }

  private selectField(o: {
    path: StepPath;
    field: string;
    label: string;
    value: string;
    options: readonly (readonly [string, string])[];
    issues?: readonly RecipeIssue[];
    commit: (value: string) => void;
  }) {
    const id = idOf(o.path, o.field);
    const issues = o.issues ?? [];
    return html`<div class="field">
      <label for=${id}>${o.label}</label>
      <select
        id=${id}
        aria-invalid=${this.errorsOf(issues) ? "true" : nothing}
        aria-describedby=${issues.length > 0 ? `${id}-err` : nothing}
        @change=${(e: Event) => o.commit((e.target as HTMLSelectElement).value)}
      >
        ${o.options.map(
          ([v, text]) => html`<option value=${v} ?selected=${v === o.value}>${text}</option>`,
        )}
      </select>
      ${this.issueList(`${id}-err`, issues)}
    </div>`;
  }

  /** An `{ value, enc }` field (fork split and join). `write` receives the new Encoded. */
  private encodedField(path: StepPath, field: "split" | "join", label: string, value: Encoded) {
    const id = idOf(path, field);
    const issues = fieldIssues(this.issues.value, path, field);
    const escapes = usesEscapes(value.enc);
    const shown = escapes ? escapeText(value.value) : value.value;
    const key = `${path}|${field}`;
    const write = (next: Encoded): void => this.patch(path, { [field]: next });
    return html`<div class="row">
      <div class="field">
        <label for=${id}>${label}</label>
        <input
          id=${id}
          class="mono"
          type="text"
          autocomplete="off"
          spellcheck="false"
          aria-invalid=${this.errorsOf(issues) ? "true" : nothing}
          aria-describedby=${[`${id}-hint`, issues.length > 0 ? `${id}-err` : ""]
            .filter((x) => x !== "")
            .join(" ")}
          .value=${this.draft(key, shown)}
          @input=${(e: Event) =>
            this.onTyping(key, (e.target as HTMLInputElement).value, (t) =>
              write({ value: escapes ? unescapeText(t) : t, enc: value.enc }),
            )}
          @change=${(e: Event) =>
            this.onCommitted(key, (e.target as HTMLInputElement).value, (t) =>
              write({ value: escapes ? unescapeText(t) : t, enc: value.enc }),
            )}
        />
        <span class="hint" id="${id}-hint"
          >${escapes ? "Escapes: \\n newline, \\t tab, \\\\ backslash." : "Digits of the chosen encoding."}</span
        >
        ${this.issueList(`${id}-err`, issues)}
      </div>
      ${this.selectField({
        path,
        field: `${field}-enc`,
        label: `${label} encoding`,
        value: value.enc,
        options: ENCODINGS,
        commit: (enc) => {
          // Keep the bytes: re-expressing a value in another encoding is the user's job, so the
          // text is kept and revalidation shows whether it still fits.
          write({ value: value.value, enc: enc as Encoded["enc"] });
        },
      })}
    </div>`;
  }

  private flagsField(
    path: StepPath,
    flags: string | undefined,
    issues: readonly RecipeIssue[],
    write: (flags: string | undefined) => void,
  ) {
    const id = idOf(path, "flags");
    return html`<fieldset aria-describedby=${issues.length > 0 ? `${id}-err` : nothing}>
      <legend>Regex flags</legend>
      <div class="inline-checks">
        ${(
          [
            ["i", "Ignore case"],
            ["m", "Multiline"],
            ["s", "Dot matches newline"],
          ] as const
        ).map(
          ([f, text]) =>
            html`<label
              ><input
                type="checkbox"
                .checked=${(flags ?? "").includes(f)}
                @change=${(e: Event) =>
                  write(toggleFlag(flags, f, (e.target as HTMLInputElement).checked))}
              />${text}</label
            >`,
        )}
      </div>
      ${this.issueList(`${id}-err`, issues)}
    </fieldset>`;
  }

  // ------------------------------------------------------------------------------- body parts

  private bodyFields(step: Step, path: StepPath) {
    const issues = this.issues.value;
    switch (step.kind) {
      case "op":
        return html`<forge-param-form path=${path}></forge-param-form>`;
      case "fork":
        return html`${this.encodedField(path, "split", "Split on", step.split)}
        ${this.encodedField(path, "join", "Join with", step.join)}`;
      case "subsection":
        return html`${this.textField({
            path,
            field: "pattern",
            label: "Regex pattern",
            value: step.pattern,
            mono: true,
            issues: fieldIssues(issues, path, "pattern"),
            commit: (t) => this.patch(path, { pattern: t }),
          })}
          <div class="row">
            ${this.flagsField(path, step.flags, fieldIssues(issues, path, "flags"), (f) =>
              this.patch(path, { flags: f }),
            )}
            ${this.selectField({
              path,
              field: "encoding",
              label: "Match against",
              value: step.encoding ?? "utf8",
              options: [
                ["utf8", "UTF-8 text"],
                ["latin1", "Latin-1 bytes"],
              ],
              issues: fieldIssues(issues, path, "encoding"),
              commit: (v) => this.patch(path, { encoding: v === "utf8" ? undefined : v }),
            })}
          </div>`;
      case "if":
        return this.ifFields(step, path);
      case "repeat":
        return this.repeatFields(step, path);
      case "comment": {
        const id = idOf(path, "text");
        const key = `${path}|text`;
        const errs = fieldIssues(issues, path, "text");
        return html`<div class="field">
          <label for=${id}>Comment</label>
          <textarea
            id=${id}
            maxlength="2000"
            aria-invalid=${this.errorsOf(errs) ? "true" : nothing}
            aria-describedby=${errs.length > 0 ? `${id}-err` : nothing}
            .value=${this.draft(key, step.text)}
            @input=${(e: Event) =>
              this.onTyping(key, (e.target as HTMLTextAreaElement).value, (t) =>
                this.patch(path, { text: t }),
              )}
            @change=${(e: Event) =>
              this.onCommitted(key, (e.target as HTMLTextAreaElement).value, (t) =>
                this.patch(path, { text: t }),
              )}
          ></textarea>
          ${this.issueList(`${id}-err`, errs)}
        </div>`;
      }
    }
  }

  private ifFields(step: IfStep, path: StepPath) {
    const issues = this.issues.value;
    const test = step.test;
    const testIssues = fieldIssues(issues, path, "test");
    const setTest = (next: Record<string, unknown>): void => this.patch(path, { test: next });
    const kindSelect = this.selectField({
      path,
      field: "test-kind",
      label: "Condition",
      value: test.kind,
      options: [
        ["regex", "Data matches a regex"],
        ["op", "An operation returns true"],
      ],
      commit: (kind) => {
        if (kind === test.kind) return;
        if (kind === "regex") setTest({ kind: "regex", pattern: "." });
        else setTest({ kind: "op", op: this.predicateOps()[0]?.qname ?? "" });
      },
    });
    if (test.kind === "regex") {
      const rest = (patch: Record<string, unknown>): void => {
        const next: Record<string, unknown> = { ...test, ...patch };
        for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
        setTest(next);
      };
      return html`${kindSelect}
        ${this.textField({
          path,
          field: "test-pattern",
          label: "Regex pattern",
          value: test.pattern,
          mono: true,
          issues: testIssues.filter((i) => i.path.endsWith("/pattern") || i.path.endsWith("/test")),
          commit: (t) => rest({ pattern: t }),
        })}
        <div class="row">
          ${this.flagsField(
            idOf(path, "test"),
            test.flags,
            testIssues.filter((i) => i.path.endsWith("/flags")),
            (f) => rest({ flags: f }),
          )}
          ${this.selectField({
            path,
            field: "test-encoding",
            label: "Match against",
            value: test.encoding ?? "utf8",
            options: [
              ["utf8", "UTF-8 text"],
              ["latin1", "Latin-1 bytes"],
            ],
            commit: (v) => rest({ encoding: v === "utf8" ? undefined : v }),
          })}
        </div>`;
    }
    const ops = this.predicateOps();
    const options: [string, string][] = ops.map((o) => [o.qname, `${o.name} (${o.vocab})`]);
    if (!ops.some((o) => o.qname === test.op))
      options.unshift([test.op, test.op || "Choose an operation"]);
    return html`${kindSelect}
      ${this.selectField({
        path,
        field: "test-op",
        label: "Test operation",
        value: test.op,
        options,
        issues: testIssues.filter((i) => !i.path.includes("/params")),
        commit: (op) => setTest({ kind: "op", op }),
      })} <forge-param-form path=${`${path}/test`}></forge-param-form>`;
  }

  private predicateOps(): CatalogueOp[] {
    return (this.catalogue()?.ops ?? []).filter((o) => o.output === "bool");
  }

  private repeatFields(step: Step & { kind: "repeat" }, path: StepPath) {
    const issues = this.issues.value;
    const until = step.until === "stable";
    return html`<div class="row">
      ${this.selectField({
        path,
        field: "mode",
        label: "Repeat",
        value: until ? "until" : "times",
        options: [
          ["times", "A fixed number of times"],
          ["until", "Until the data stops changing"],
        ],
        issues: fieldIssues(issues, path, "until"),
        commit: (mode) => {
          if (mode === "until" && !until) {
            this.patch(path, { times: undefined, until: "stable" });
          } else if (mode === "times" && until) {
            this.patch(path, { until: undefined, max: undefined, times: 2 });
          }
        },
      })}
      ${
        until
          ? this.textField({
              path,
              field: "max",
              label: "At most (rounds)",
              value: step.max === undefined ? "" : String(step.max),
              number: { min: 1, max: 1000 },
              placeholder: "100",
              issues: fieldIssues(issues, path, "max"),
              commit: (t) => {
                const n = Number(t);
                this.patch(path, { max: t.trim() === "" || !Number.isInteger(n) ? undefined : n });
              },
            })
          : this.textField({
              path,
              field: "times",
              label: "Times",
              value: step.times === undefined ? "" : String(step.times),
              number: { min: 1, max: 1000 },
              issues: fieldIssues(issues, path, "times"),
              commit: (t) => {
                const n = Number(t);
                if (t.trim() !== "" && Number.isInteger(n)) this.patch(path, { times: n });
              },
            })
      }
    </div>`;
  }

  private noteEditor(step: Step, path: StepPath) {
    if (step.kind === "comment") return nothing;
    if (step.note === undefined && !this.noteOpen.has(path)) return nothing;
    const id = idOf(path, "note");
    const key = `${path}|note`;
    const errs = fieldIssues(this.issues.value, path, "note");
    const write = (t: string): void => this.patch(path, { note: t === "" ? undefined : t });
    return html`<div class="field">
      <label for=${id}>Note</label>
      <textarea
        id=${id}
        maxlength="500"
        aria-invalid=${this.errorsOf(errs) ? "true" : nothing}
        aria-describedby=${errs.length > 0 ? `${id}-err` : nothing}
        .value=${this.draft(key, step.note ?? "")}
        @input=${(e: Event) => this.onTyping(key, (e.target as HTMLTextAreaElement).value, write)}
        @change=${(e: Event) =>
          this.onCommitted(key, (e.target as HTMLTextAreaElement).value, write)}
      ></textarea>
      ${this.issueList(`${id}-err`, errs)}
    </div>`;
  }

  // ------------------------------------------------------------------------------- rendering

  private chipsFor(path: StepPath, step: Step): Chip[] {
    const chips: Chip[] = [];
    if (step.kind !== "comment") {
      if (step.disabled === true) chips.push({ text: "Disabled", tone: "off" });
      if (step.breakpoint === true) chips.push({ text: "Breakpoint", tone: "pause" });
    }
    const bake = this.bake.value;
    if (bake.status === "baking" && bake.runningPath === path) {
      chips.push({ text: "Running", tone: "run" });
    }
    if (bake.status === "paused" && bake.paused?.path === path) {
      const why = bake.paused.reason === "breakpoint" ? "breakpoint" : bake.paused.reason;
      chips.push({ text: `Paused (${why})`, tone: "pause" });
    }
    const result = bake.result;
    if (result !== null && !result.ok && result.error.path === path) {
      chips.push({ text: `Failed: ${result.error.code}`, tone: "fail" });
    }
    const report = this.timings().get(path);
    if (report !== undefined) {
      const ms = report.ms < 10 ? report.ms.toFixed(1) : String(Math.round(report.ms));
      const runs = report.runs > 1 ? ` x${report.runs}` : "";
      chips.push({ text: `${ms} ms${runs}`, tone: bake.stale ? "time stale" : "time" });
    }
    const counts = issueCounts(this.issues.value, path);
    if (counts.errors > 0) {
      chips.push({
        text: `${counts.errors} ${counts.errors === 1 ? "error" : "errors"}`,
        tone: "error",
      });
    }
    if (counts.warnings > 0) {
      chips.push({
        text: `${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`,
        tone: "warning",
      });
    }
    return chips;
  }

  private button(o: {
    action: string;
    label: string;
    icon: unknown;
    onClick: () => void;
    pressed?: boolean;
    disabled?: boolean;
    first?: boolean;
  }) {
    return html`<button
      type="button"
      class="ghost icon"
      data-action=${o.action}
      aria-label=${o.label}
      title=${o.label}
      aria-pressed=${o.pressed === undefined ? nothing : String(o.pressed)}
      aria-disabled=${o.disabled === true ? "true" : nothing}
      tabindex=${o.first === true ? "0" : "-1"}
      @click=${() => {
        if (o.disabled !== true) o.onClick();
      }}
    >
      ${o.icon}
    </button>`;
  }

  private renderToolbar(step: Step, path: StepPath, index: number, count: number) {
    const recipe = store.get().recipe;
    const num = stepNumber(path);
    const lifted = this.lifted?.path === path;
    const can = (k: MoveKey): boolean => moveTarget(recipe, path, k) !== null;
    const collapsed = this.collapsed.has(path);
    const real = step.kind !== "comment";
    const label = this.label(path);
    return html`<div
      class="toolbar"
      role="toolbar"
      aria-label=${`Actions for step ${num}`}
      @keydown=${this.onToolbarKey}
      @focusin=${this.onToolbarFocus}
    >
      <button
        type="button"
        class="ghost icon handle"
        data-action="handle"
        tabindex="0"
        aria-pressed=${String(lifted)}
        aria-label=${lifted ? `Move ${label}: lifted` : `Move ${label}`}
        title="Move: drag, or press Space to lift then use the arrow keys (Alt+Up and Alt+Down also work)"
        @keydown=${(e: KeyboardEvent) => this.onHandleKey(e, path)}
        @blur=${() => this.onHandleBlur()}
        @pointerdown=${(e: PointerEvent) =>
          beginPointerDrag(e, { type: "step", path }, `Step ${num}: ${this.titleOf(step).name}`)}
      >
        ${recipeIcons.grip}
      </button>
      ${this.button({
        action: "collapse",
        label: collapsed ? `Expand step ${num}` : `Collapse step ${num}`,
        icon: collapsed ? icons.chevronRight : icons.chevronDown,
        pressed: undefined,
        onClick: () => (this.collapsed = this.toggleIn(this.collapsed, path)),
      })}
      ${
        real
          ? this.button({
              action: "disable",
              label: step.disabled === true ? `Enable step ${num}` : `Disable step ${num}`,
              icon: step.disabled === true ? recipeIcons.eyeOff : recipeIcons.eye,
              pressed: step.disabled === true,
              onClick: () => this.toggleFlagOf(path, "disabled", "Disabled"),
            })
          : nothing
      }
      ${
        real
          ? this.button({
              action: "breakpoint",
              label: `Breakpoint on step ${num}`,
              icon: recipeIcons.breakpoint,
              pressed: step.breakpoint === true,
              onClick: () => this.toggleFlagOf(path, "breakpoint", "Breakpoint"),
            })
          : nothing
      }
      ${
        real
          ? this.button({
              action: "note",
              label: `Note for step ${num}`,
              icon: recipeIcons.note,
              pressed: step.note !== undefined || this.noteOpen.has(path),
              onClick: () => this.openNote(path, step),
            })
          : nothing
      }
      ${this.button({
        action: "duplicate",
        label: `Duplicate step ${num}`,
        icon: icons.copy,
        onClick: () => this.duplicate(path),
      })}
      ${this.button({
        action: "up",
        label: `Move step ${num} up`,
        icon: icons.chevronUp,
        disabled: !can("up"),
        onClick: () => this.moveButton(path, "up"),
      })}
      ${this.button({
        action: "down",
        label: `Move step ${num} down`,
        icon: icons.chevronDown,
        disabled: !can("down"),
        onClick: () => this.moveButton(path, "down"),
      })}
      ${this.button({
        action: "in",
        label: `Move step ${num} into the block above`,
        icon: recipeIcons.indent,
        disabled: !can("in"),
        onClick: () => this.moveButton(path, "in"),
      })}
      ${this.button({
        action: "out",
        label: `Move step ${num} out of its block`,
        icon: recipeIcons.outdent,
        disabled: !can("out"),
        onClick: () => this.moveButton(path, "out"),
      })}
      ${this.button({
        action: "delete",
        label: `Delete step ${num}`,
        icon: icons.trash,
        onClick: () => this.deleteStep(path),
      })}
      <span class="sr-only">${index + 1} of ${count}</span>
    </div>`;
  }

  private openNote(path: StepPath, step: Step): void {
    if (step.kind === "comment") return;
    if (step.note === undefined && this.noteOpen.has(path)) {
      this.noteOpen = this.toggleIn(this.noteOpen, path);
      return;
    }
    if (!this.noteOpen.has(path)) this.noteOpen = this.toggleIn(this.noteOpen, path);
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`#${CSS.escape(idOf(path, "note"))}`)?.focus(),
    );
  }

  private renderStep(
    step: Step,
    path: StepPath,
    index: number,
    count: number,
    activePath: string,
  ): TemplateResult {
    const bake = this.bake.value;
    const result = bake.result;
    const failed =
      result !== null && !result.ok && result.error.path === path ? result.error : null;
    const current =
      failed !== null ||
      (bake.status === "baking" && bake.runningPath === path) ||
      (bake.status === "paused" && bake.paused?.path === path);
    const { name, vocab } = this.titleOf(step);
    const collapsed = this.collapsed.has(path);
    const lists = childLists(step, path);
    const isDisabled = step.kind !== "comment" && step.disabled === true;
    const classes = {
      card: true,
      [step.kind]: true,
      selected: this.selected.value === path,
      disabled: isDisabled,
      failed: failed !== null,
      running: bake.status === "baking" && bake.runningPath === path,
      paused: bake.status === "paused" && bake.paused?.path === path,
      lifted: this.lifted?.path === path,
      "drag-source": this.dragging?.type === "step" && this.dragging.path === path,
    };
    const errId = idOf(path, "bake-error");
    const stepIssues = stepLevelIssues(this.issues.value, path);
    const inner = lists.reduce((n, l) => n + l.steps.length, 0);
    return html`<li
      class=${classMap({
        step: true,
        "drop-before":
          this.drop?.listPath === splitStepPath(path).listPath && this.drop.gap === index,
      })}
    >
      <div class="drop-bar" aria-hidden="true"></div>
      <div class="drop-bar-end" aria-hidden="true"></div>
      <div
        class=${classMap(classes)}
        role="group"
        data-path=${path}
        tabindex=${path === activePath ? "0" : "-1"}
        aria-label=${`Step ${stepNumber(path)}: ${name}${isDisabled ? " (disabled)" : ""}`}
        aria-current=${current ? "step" : nothing}
        aria-describedby=${failed !== null ? errId : nothing}
        @click=${(e: Event) => {
          if (this.cardOf(e) === e.currentTarget) this.select(path);
        }}
        @focusin=${(e: Event) => {
          if (this.cardOf(e) === e.currentTarget) this.select(path);
        }}
        @keydown=${this.onCardKey}
      >
        <div class="card-head">
          <span class="num" aria-hidden="true">${stepNumber(path)}</span>
          <span class="title"
            >${name}${vocab !== null ? html` <span class="vocab">${vocab}</span>` : nothing}</span
          >
          <span class="chips">
            ${this.chipsFor(path, step).map(
              (c) => html`<span class="chip ${c.tone}">${c.text}</span>`,
            )}
          </span>
        </div>
        ${this.renderToolbar(step, path, index, count)}
        ${
          collapsed
            ? html`<p class="summary">
                Collapsed${inner > 0 ? `: ${inner} ${inner === 1 ? "step" : "steps"} inside` : ""}.
              </p>`
            : html`<div class="card-body">
                ${
                  failed !== null
                    ? html`<p class="bake-error" id=${errId}>
                        <strong>${failed.code}:</strong> ${failed.message}
                      </p>`
                    : nothing
                }
                ${this.issueList(idOf(path, "issues"), stepIssues)} ${this.bodyFields(step, path)}
                ${this.noteEditor(step, path)}
                ${lists.map((l) =>
                  this.renderLane(
                    l.path,
                    l.steps,
                    this.laneTitle(step, l.key),
                    true,
                    `Drop steps here, or add one with the operations pane.`,
                  ),
                )}
              </div>`
        }
      </div>
    </li>`;
  }

  private laneTitle(step: Step, key: string): string {
    if (key === "then") return "Then";
    if (key === "else") return "Else";
    switch (step.kind) {
      case "fork":
        return "Run on each piece";
      case "subsection":
        return "Run on each match";
      case "repeat":
        return "Repeated steps";
      default:
        return "Steps";
    }
  }

  private renderLane(
    listPath: ListPath,
    steps: readonly Step[],
    title: string | null,
    nested: boolean,
    emptyText: string,
  ): TemplateResult {
    const recipe = store.get().recipe;
    const selected = this.selected.value;
    const activePath =
      selected !== null && getStep(recipe, selected) !== undefined ? selected : "/steps/0";
    const over = this.drop?.listPath === listPath ? this.drop.gap : null;
    return html`<div
      class=${classMap({
        lane: true,
        nested,
        root: !nested,
        "drop-active": over !== null,
        "drop-end": over !== null && over >= steps.length && steps.length > 0,
      })}
      data-list=${listPath}
    >
      ${title !== null ? html`<div class="lane-title">${title}</div>` : nothing}
      ${
        steps.length === 0
          ? html`<p class="lane-empty">${emptyText}</p>`
          : html`<ol class="steps" role="list" aria-label=${title ?? "Recipe steps"}>
              ${steps.map((s, i) =>
                this.renderStep(s, childPath(listPath, i), i, steps.length, activePath),
              )}
            </ol>`
      }
    </div>`;
  }

  private blockItems(): MenuItem[] {
    return BLOCK_KINDS.map((k) => ({ id: k, label: BLOCK_LABELS[k] }));
  }

  protected override render() {
    const recipe = this.recipe.value;
    if (this.dragging !== null) this.setAttribute("dragging", "");
    else this.removeAttribute("dragging");
    const empty = recipe.steps.length === 0;
    return html`<header class="pane-head">
        <h2 tabindex="-1">Recipe</h2>
        <div class="group">
          <button
            type="button"
            class="ghost icon"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            ?disabled=${!this.canUndo.value}
            @click=${() => this.undo()}
          >
            ${recipeIcons.undo}
          </button>
          <button
            type="button"
            class="ghost icon"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            ?disabled=${!this.canRedo.value}
            @click=${() => this.redo()}
          >
            ${recipeIcons.redo}
          </button>
          <button
            type="button"
            class="ghost"
            title="Remove every step (Undo brings them back)"
            ?disabled=${empty}
            @click=${() => this.clear()}
          >
            ${recipeIcons.eraser} Clear
          </button>
          <forge-menu
            label="Add block"
            .items=${this.blockItems()}
            @forge-menu-select=${(e: CustomEvent<{ id: string }>) =>
              this.addBlock(e.detail.id as BlockKind)}
          >
            <span slot="trigger">${icons.plus} Add block</span>
          </forge-menu>
        </div>
      </header>
      <div class="pane-body" @keydown=${this.onPaneKey}>
        ${
          empty
            ? html`<div class="lane root" data-list="/steps">
                <div class="empty-state">
                  <p><strong>This recipe has no steps yet.</strong></p>
                  <p>
                    Search the operations pane and choose Add, or drag an operation here. Use Add
                    block for forks, subsections, conditions, repeats and comments.
                  </p>
                </div>
              </div>`
            : this.renderLane("/steps", recipe.steps, null, false, "")
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-recipe": ForgeRecipe;
  }
}
