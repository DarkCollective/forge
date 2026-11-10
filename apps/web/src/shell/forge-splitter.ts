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
import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { emit, FORGE_EVENTS } from "../state/events.js";
import type { SplitterChangeDetail } from "../state/events.js";
import { pointerSize, splitterKey } from "../state/layout.js";
import type { SplitterConfig } from "../state/layout.js";

/**
 * A resizable, collapsible splitter (WAI-ARIA window splitter pattern). The host is the separator:
 * role="separator", focusable, aria-valuenow/min/max, aria-controls. It owns no layout; the shell
 * applies `value` to the panes. Events: `forge-splitter-change` and `forge-splitter-toggle`.
 *
 * `value` is the size of the controlled pane in the splitter's units (px, or percent). While
 * `collapsed` the exposed aria-valuenow is 0.
 */
@customElement("forge-splitter")
export class ForgeSplitter extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      background: var(--border);
      touch-action: none;
      outline-offset: -2px;
      cursor: col-resize;
      transition: background var(--motion);
    }
    :host([aria-orientation="horizontal"]) {
      cursor: row-resize;
    }
    /* A wider, invisible hit area; the visible bar stays thin. */
    :host::after {
      content: "";
      position: absolute;
      inset: 0;
    }
    :host([aria-orientation="vertical"])::after {
      inset-inline: -5px;
    }
    :host([aria-orientation="horizontal"])::after {
      inset-block: -5px;
    }
    :host(:hover),
    :host([dragging]) {
      background: var(--accent);
    }
    :host(:focus-visible) {
      background: var(--accent);
      outline: var(--focus-width) solid var(--focus);
    }
    :host([collapsed])::before {
      content: "";
      position: absolute;
      inset: 0;
      background: var(--border-strong);
    }
  `;

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 16;
  @property({ type: Number, attribute: "large-step" }) largeStep = 64;
  @property({ type: String }) orientation: "vertical" | "horizontal" = "vertical";
  @property({ type: Boolean }) invert = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  /** Accessible name, e.g. "Resize operations pane". */
  @property({ type: String }) label = "Resize";
  /** id of the controlled pane (aria-controls). */
  @property({ type: String }) controls = "";
  /** Pixels of drag per unit of `value` (1 for px splitters; pane height / 100 for percent ones). */
  @property({ type: Number, attribute: "px-per-unit" }) pxPerUnit = 1;

  private drag: { startPos: number; startValue: number } | null = null;

  private get config(): SplitterConfig {
    return {
      min: this.min,
      max: this.max,
      step: this.step,
      largeStep: this.largeStep,
      orientation: this.orientation,
      invert: this.invert,
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute("role", "separator");
    this.tabIndex = 0;
    this.addEventListener("keydown", this.onKey);
    this.addEventListener("pointerdown", this.onPointerDown);
    this.addEventListener("dblclick", this.onDoubleClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener("keydown", this.onKey);
    this.removeEventListener("pointerdown", this.onPointerDown);
    this.removeEventListener("dblclick", this.onDoubleClick);
    super.disconnectedCallback();
  }

  override updated(): void {
    this.setAttribute("aria-orientation", this.orientation);
    this.setAttribute("aria-label", this.label);
    this.setAttribute("aria-valuemin", "0");
    this.setAttribute("aria-valuemax", String(Math.round(this.max)));
    this.setAttribute("aria-valuenow", String(this.collapsed ? 0 : Math.round(this.value)));
    if (this.controls !== "") this.setAttribute("aria-controls", this.controls);
    else this.removeAttribute("aria-controls");
  }

  protected override render() {
    return html``;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const result = splitterKey(e.key, e.shiftKey, this.collapsed ? 0 : this.value, this.config);
    if (result.kind === "none") return;
    e.preventDefault();
    if (result.kind === "toggle") {
      emit<void>(this, FORGE_EVENTS.splitterToggle, undefined);
      return;
    }
    // From collapsed, the first resize key opens the pane at the smallest size that the key implies.
    emit<SplitterChangeDetail>(this, FORGE_EVENTS.splitterChange, {
      value: Math.max(result.value, this.min),
      source: "keyboard",
    });
  };

  private readonly onDoubleClick = (): void => {
    emit<void>(this, FORGE_EVENTS.splitterToggle, undefined);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.focus();
    const vertical = this.orientation === "vertical";
    this.drag = {
      startPos: vertical ? e.clientX : e.clientY,
      startValue: this.collapsed ? 0 : this.value,
    };
    this.setAttribute("dragging", "");
    this.setPointerCapture(e.pointerId);
    this.addEventListener("pointermove", this.onPointerMove);
    this.addEventListener("pointerup", this.onPointerUp);
    this.addEventListener("pointercancel", this.onPointerUp);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.drag === null) return;
    const pos = this.orientation === "vertical" ? e.clientX : e.clientY;
    const value = pointerSize(
      this.drag.startValue,
      this.drag.startPos,
      pos,
      this.config,
      1 / this.pxPerUnit,
    );
    emit<SplitterChangeDetail>(this, FORGE_EVENTS.splitterChange, { value, source: "pointer" });
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.drag = null;
    this.removeAttribute("dragging");
    if (this.hasPointerCapture(e.pointerId)) this.releasePointerCapture(e.pointerId);
    this.removeEventListener("pointermove", this.onPointerMove);
    this.removeEventListener("pointerup", this.onPointerUp);
    this.removeEventListener("pointercancel", this.onPointerUp);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-splitter": ForgeSplitter;
  }
}
