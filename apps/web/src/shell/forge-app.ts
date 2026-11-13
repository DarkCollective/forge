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
import { customElement, state } from "lit/decorators.js";
import { actions, store } from "../state/app.js";
import { FORGE_EVENTS } from "../state/events.js";
import type { FocusPaneDetail, SplitterChangeDetail } from "../state/events.js";
import { LAYOUT_LIMITS, clamp } from "../state/layout.js";
import { COMPACT_BREAKPOINT_PX } from "../state/layout.js";
import { StoreController } from "../state/store-controller.js";
import type { PaneId } from "../state/types.js";
import { baseStyles } from "../styles/shared.js";
import "./forge-splitter.js";
import "./forge-statusbar.js";
import "./forge-topbar.js";
import "./forge-shortcuts-dialog.js";

const SPLIT = 6; // px, mirrors --splitter-size

const PANE_LABEL: Record<PaneId, string> = {
  ops: "Operations",
  recipe: "Recipe",
  input: "Input",
  output: "Output",
  console: "Console",
};

interface Focusable extends HTMLElement {
  focusPrimary?: () => void;
}

/**
 * The application shell (UI.md section 1): top bar, operations drawer, recipe pipeline, input over
 * output, console, status bar; resizable and collapsible; one pane at a time below
 * COMPACT_BREAKPOINT_PX. Owns layout only. The panes are separate elements (see UI.md section 2).
 */
@customElement("forge-app")
export class ForgeApp extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr) auto;
        height: 100%;
        background: var(--bg);
      }
      .skip {
        position: absolute;
        inset-inline-start: var(--space-2);
        inset-block-start: -4rem;
        z-index: 100;
        padding: var(--space-2) var(--space-3);
        background: var(--accent);
        color: var(--accent-fg);
        border-radius: var(--radius-m);
        font-weight: var(--weight-bold);
      }
      .skip:focus {
        inset-block-start: var(--space-2);
      }
      main {
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
      }
      .workbench {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns:
          var(--ops-w, 280px) var(--splitter-size) var(--recipe-w, 440px)
          var(--splitter-size) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
      }
      .pane {
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: var(--surface);
      }
      .pane:focus {
        outline: none;
      }
      .pane[inert] {
        visibility: hidden;
      }
      .io {
        display: grid;
        grid-template-rows: minmax(0, var(--in-fr, 40fr)) var(--splitter-size) minmax(
            0,
            var(--out-fr, 60fr)
          );
        min-width: 0;
        min-height: 0;
      }
      .console-wrap {
        display: grid;
        grid-template-rows: var(--splitter-size) var(--console-h, 240px);
        flex: none;
      }
      /* Narrow screens: one pane at a time, chosen by a tab bar. */
      :host([compact]) .workbench {
        grid-template-columns: minmax(0, 1fr);
      }
      :host([compact]) .io {
        display: contents;
      }
      :host([compact]) .pane:not([data-active]) {
        display: none;
      }
      .tabs {
        display: flex;
        background: var(--surface-2);
        border-top: var(--border-width) solid var(--border-strong);
      }
      .tabs button {
        flex: 1;
        border-radius: 0;
        border: 0;
        border-inline-end: var(--border-width) solid var(--border);
        min-height: 2.75rem;
        background: transparent;
      }
      .tabs button[aria-selected="true"] {
        background: var(--surface);
        box-shadow: inset 0 3px 0 var(--accent);
        font-weight: var(--weight-bold);
      }
      .overlays {
        position: absolute;
      }
      .live {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
    `,
  ];

  private readonly layout = new StoreController(this, store, (s) => s.layout);
  private readonly ui = new StoreController(this, store, (s) => s.ui);
  private readonly consoleOpen = new StoreController(this, store, (s) => s.ui.consoleOpen);

  @state() private mainWidth = 1200;
  @state() private mainHeight = 700;
  private resizeObserver: ResizeObserver | undefined;
  private mediaQuery: MediaQueryList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.mediaQuery = matchMedia(`(max-width: ${COMPACT_BREAKPOINT_PX - 1}px)`);
    actions.setCompact(this.mediaQuery.matches);
    this.mediaQuery.addEventListener("change", this.onMedia);
    window.addEventListener("keydown", this.onGlobalKey);
    this.addEventListener(FORGE_EVENTS.focusPane, this.onFocusPane as EventListener);
  }

  override disconnectedCallback(): void {
    this.mediaQuery?.removeEventListener("change", this.onMedia);
    window.removeEventListener("keydown", this.onGlobalKey);
    this.removeEventListener(FORGE_EVENTS.focusPane, this.onFocusPane as EventListener);
    this.resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    const main = this.renderRoot.querySelector("main");
    if (main === null) return;
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      this.mainWidth = entry.contentRect.width;
      this.mainHeight = entry.contentRect.height;
    });
    this.resizeObserver.observe(main);
  }

  private readonly onMedia = (e: MediaQueryListEvent): void => actions.setCompact(e.matches);

  private readonly onGlobalKey = (e: KeyboardEvent): void => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const pane = (
      {
        Digit1: "ops",
        Digit2: "recipe",
        Digit3: "input",
        Digit4: "output",
        Digit5: "console",
      } as const
    )[e.code as "Digit1"];
    if (pane === undefined) return;
    e.preventDefault();
    void this.focusPane(pane);
  };

  private readonly onFocusPane = (e: CustomEvent<FocusPaneDetail>): void => {
    void this.focusPane(e.detail.pane);
  };

  /** Reveal a pane (uncollapse, switch tab, open the console) and move focus into it. */
  async focusPane(pane: PaneId): Promise<void> {
    const ui = store.get().ui;
    if (ui.compact) actions.setCompactTab(pane);
    else if (pane === "ops") actions.setLayout({ opsCollapsed: false });
    else if (pane === "recipe") actions.setLayout({ recipeCollapsed: false });
    if (pane === "console") actions.setConsoleOpen(true);
    await this.updateComplete;
    const section = this.renderRoot.querySelector<HTMLElement>(`#pane-${pane}`);
    const inner = section?.firstElementChild as Focusable | null | undefined;
    if (inner?.focusPrimary !== undefined) inner.focusPrimary();
    else section?.focus();
  }

  // ---- geometry ----------------------------------------------------------------------------

  private opsMax(): number {
    const l = this.layout.value;
    const others = (l.recipeCollapsed ? 0 : l.recipeWidth) + LAYOUT_LIMITS.ioMinWidth + 2 * SPLIT;
    return Math.max(
      LAYOUT_LIMITS.opsWidth.min,
      Math.min(LAYOUT_LIMITS.opsWidth.max, this.mainWidth - others),
    );
  }

  private recipeMax(): number {
    const l = this.layout.value;
    const others = (l.opsCollapsed ? 0 : l.opsWidth) + LAYOUT_LIMITS.ioMinWidth + 2 * SPLIT;
    return Math.max(
      LAYOUT_LIMITS.recipeWidth.min,
      Math.min(LAYOUT_LIMITS.recipeWidth.max, this.mainWidth - others),
    );
  }

  private consoleMax(): number {
    return Math.max(
      LAYOUT_LIMITS.consoleHeight.min,
      Math.min(LAYOUT_LIMITS.consoleHeight.max, this.mainHeight - 240),
    );
  }

  protected override willUpdate(): void {
    const l = this.layout.value;
    const ui = this.ui.value;
    this.toggleAttribute("compact", ui.compact);
    // Sizes go in as custom properties through the CSSOM: no style attributes (production CSP).
    const set = (k: string, v: string): void => this.style.setProperty(k, v);
    set(
      "--ops-w",
      l.opsCollapsed ? "0px" : `${clamp(l.opsWidth, LAYOUT_LIMITS.opsWidth.min, this.opsMax())}px`,
    );
    set(
      "--recipe-w",
      l.recipeCollapsed
        ? "0px"
        : `${clamp(l.recipeWidth, LAYOUT_LIMITS.recipeWidth.min, this.recipeMax())}px`,
    );
    set("--in-fr", `${l.inputPercent}fr`);
    set("--out-fr", `${100 - l.inputPercent}fr`);
    set(
      "--console-h",
      `${clamp(l.consoleHeight, LAYOUT_LIMITS.consoleHeight.min, this.consoleMax())}px`,
    );
  }

  // ---- events ------------------------------------------------------------------------------

  private resize(key: "opsWidth" | "recipeWidth" | "consoleHeight" | "inputPercent") {
    return (e: CustomEvent<SplitterChangeDetail>): void => {
      const patch: Record<string, number | boolean> = { [key]: Math.round(e.detail.value) };
      if (key === "opsWidth") patch.opsCollapsed = false;
      if (key === "recipeWidth") patch.recipeCollapsed = false;
      actions.setLayout(patch);
    };
  }

  // ---- render ------------------------------------------------------------------------------

  private renderTabs() {
    const ui = this.ui.value;
    const panes: PaneId[] = ["ops", "recipe", "input", "output"];
    if (ui.consoleOpen) panes.push("console");
    const onKey = (e: KeyboardEvent): void => {
      const i = panes.indexOf(ui.compactTab);
      const last = panes.length - 1;
      const next =
        e.key === "ArrowRight"
          ? (i + 1) % panes.length
          : e.key === "ArrowLeft"
            ? (i - 1 + panes.length) % panes.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? last
                : -1;
      if (next < 0) return;
      e.preventDefault();
      const pane = panes[next] as PaneId;
      actions.setCompactTab(pane);
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>(`#tab-${pane}`)?.focus(),
      );
    };
    return html`<div class="tabs" role="tablist" aria-label="Panes" @keydown=${onKey}>
      ${panes.map(
        (p) =>
          html`<button
            type="button"
            role="tab"
            id=${`tab-${p}`}
            aria-selected=${String(ui.compactTab === p)}
            aria-controls=${`pane-${p}`}
            tabindex=${ui.compactTab === p ? "0" : "-1"}
            @click=${() => actions.setCompactTab(p)}
          >
            ${PANE_LABEL[p]}
          </button>`,
      )}
    </div>`;
  }

  protected override render() {
    const l = this.layout.value;
    const ui = this.ui.value;
    const compact = ui.compact;
    const role = compact ? "tabpanel" : "region";
    const active = (p: PaneId) => (compact && ui.compactTab === p ? "" : null);
    const labelled = (p: PaneId) => (compact ? `tab-${p}` : nothing);
    const showConsole = this.consoleOpen.value;
    return html`
      <a
        class="skip"
        href="#pane-recipe"
        @click=${(e: Event) => {
          e.preventDefault();
          void this.focusPane("recipe");
        }}
      >
        Skip to recipe
      </a>
      <header><forge-topbar></forge-topbar></header>
      <main>
        <div class="workbench">
          <aside
            id="pane-ops"
            class="pane"
            tabindex="-1"
            role=${role}
            aria-label=${compact ? nothing : "Operations"}
            aria-labelledby=${labelled("ops")}
            data-active=${active("ops") ?? nothing}
            ?inert=${!compact && l.opsCollapsed}
          >
            <forge-operations></forge-operations>
          </aside>
          ${
            compact
              ? nothing
              : html`<forge-splitter
                  label="Resize operations pane"
                  controls="pane-ops"
                  .value=${l.opsWidth}
                  .min=${LAYOUT_LIMITS.opsWidth.min}
                  .max=${this.opsMax()}
                  ?collapsed=${l.opsCollapsed}
                  @forge-splitter-change=${this.resize("opsWidth")}
                  @forge-splitter-toggle=${() => actions.setLayout({ opsCollapsed: !l.opsCollapsed })}
                ></forge-splitter>`
          }
          <section
            id="pane-recipe"
            class="pane"
            tabindex="-1"
            role=${role}
            aria-label=${compact ? nothing : "Recipe"}
            aria-labelledby=${labelled("recipe")}
            data-active=${active("recipe") ?? nothing}
            ?inert=${!compact && l.recipeCollapsed}
          >
            <forge-recipe></forge-recipe>
          </section>
          ${
            compact
              ? nothing
              : html`<forge-splitter
                  label="Resize recipe pane"
                  controls="pane-recipe"
                  .value=${l.recipeWidth}
                  .min=${LAYOUT_LIMITS.recipeWidth.min}
                  .max=${this.recipeMax()}
                  ?collapsed=${l.recipeCollapsed}
                  @forge-splitter-change=${this.resize("recipeWidth")}
                  @forge-splitter-toggle=${() => actions.setLayout({ recipeCollapsed: !l.recipeCollapsed })}
                ></forge-splitter>`
          }
          <div class="io">
            <section
              id="pane-input"
              class="pane"
              tabindex="-1"
              role=${role}
              aria-label=${compact ? nothing : "Input"}
              aria-labelledby=${labelled("input")}
              data-active=${active("input") ?? nothing}
            >
              <forge-input></forge-input>
            </section>
            ${
              compact
                ? nothing
                : html`<forge-splitter
                    orientation="horizontal"
                    label="Resize input and output"
                    controls="pane-input"
                    .value=${l.inputPercent}
                    .min=${LAYOUT_LIMITS.inputPercent.min}
                    .max=${LAYOUT_LIMITS.inputPercent.max}
                    .step=${2}
                    .largeStep=${10}
                    .pxPerUnit=${Math.max(1, this.mainHeight / 100)}
                    @forge-splitter-change=${this.resize("inputPercent")}
                    @forge-splitter-toggle=${() => actions.setLayout({ inputPercent: 40 })}
                  ></forge-splitter>`
            }
            <section
              id="pane-output"
              class="pane"
              tabindex="-1"
              role=${role}
              aria-label=${compact ? nothing : "Output"}
              aria-labelledby=${labelled("output")}
              data-active=${active("output") ?? nothing}
            >
              <forge-output></forge-output>
            </section>
          </div>
          ${
            compact && showConsole
              ? html`<section
                  id="pane-console"
                  class="pane"
                  tabindex="-1"
                  role="tabpanel"
                  aria-labelledby="tab-console"
                  data-active=${active("console") ?? nothing}
                >
                  <forge-console></forge-console>
                </section>`
              : nothing
          }
        </div>
        ${
          !compact && showConsole
            ? html`<div class="console-wrap">
                <forge-splitter
                  orientation="horizontal"
                  invert
                  label="Resize console"
                  controls="pane-console"
                  .value=${l.consoleHeight}
                  .min=${LAYOUT_LIMITS.consoleHeight.min}
                  .max=${this.consoleMax()}
                  .step=${16}
                  .largeStep=${64}
                  @forge-splitter-change=${this.resize("consoleHeight")}
                  @forge-splitter-toggle=${() => actions.setConsoleOpen(false)}
                ></forge-splitter>
                <section
                  id="pane-console"
                  class="pane"
                  tabindex="-1"
                  role="region"
                  aria-label="Console"
                >
                  <forge-console></forge-console>
                </section>
              </div>`
            : nothing
        }
        ${compact ? this.renderTabs() : nothing}
      </main>
      <footer><forge-statusbar></forge-statusbar></footer>
      <div class="live" role="status" aria-live="polite" aria-atomic="true">
        ${ui.announcement.text}
      </div>
      <div class="overlays">
        <forge-share-dialog></forge-share-dialog>
        <forge-save-dialog></forge-save-dialog>
        <forge-open-dialog></forge-open-dialog>
        <forge-fl-dialog></forge-fl-dialog>
        <forge-shortcuts-dialog></forge-shortcuts-dialog>
        <forge-op-help></forge-op-help>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-app": ForgeApp;
  }
}
