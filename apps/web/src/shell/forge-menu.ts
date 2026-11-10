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
import { customElement, property, state } from "lit/decorators.js";
import { emit, FORGE_EVENTS } from "../state/events.js";
import type { MenuSelectDetail } from "../state/events.js";
import { baseStyles } from "../styles/shared.js";

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** A link item navigates; without it the item fires `forge-menu-select`. */
  readonly href?: string;
  /** Radio-style item: shows a check and `aria-checked`. */
  readonly checked?: boolean;
  /** Draw a separator before this item. */
  readonly separator?: boolean;
}

/**
 * A menu button with a popup menu (WAI-ARIA menu button pattern). The trigger content comes from the
 * `trigger` slot; `label` is its accessible name. Keys: Enter/Space/ArrowDown open; Arrow keys,
 * Home, End move; Escape closes and returns focus; Tab closes. Items with `checked` defined are
 * `menuitemradio`. Emits `forge-menu-select` {id} for non-link items, then closes.
 */
@customElement("forge-menu")
export class ForgeMenu extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        position: relative;
        display: inline-block;
      }
      .panel {
        position: absolute;
        inset-block-start: calc(100% + var(--space-1));
        inset-inline-end: 0;
        z-index: 50;
        min-width: 13rem;
        padding: var(--space-1);
        background: var(--surface);
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-m);
        box-shadow: var(--shadow-pop);
      }
      :host([align="start"]) .panel {
        inset-inline-end: auto;
        inset-inline-start: 0;
      }
      [role^="menuitem"] {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        min-height: var(--hit-min);
        padding: 0 var(--space-3);
        border: 0;
        border-radius: var(--radius-s);
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: var(--text-sm);
        text-align: start;
        text-decoration: none;
        justify-content: flex-start;
        cursor: pointer;
      }
      [role^="menuitem"]:hover,
      [role^="menuitem"]:focus-visible {
        background: var(--accent-soft);
      }
      [role^="menuitem"]:focus-visible {
        outline-offset: -3px;
      }
      .check {
        inline-size: 1em;
        color: var(--accent);
      }
      hr {
        border: 0;
        border-top: var(--border-width) solid var(--border);
        margin: var(--space-1) 0;
      }
    `,
  ];

  @property({ type: String }) label = "Menu";
  @property({ type: Array }) items: readonly MenuItem[] = [];
  @property({ type: String, reflect: true }) align: "start" | "end" = "end";
  @state() private open = false;

  private readonly onDocPointer = (e: Event): void => {
    if (!e.composedPath().includes(this)) this.close(false);
  };

  override disconnectedCallback(): void {
    document.removeEventListener("pointerdown", this.onDocPointer, true);
    super.disconnectedCallback();
  }

  private get trigger(): HTMLButtonElement | null {
    return this.renderRoot.querySelector<HTMLButtonElement>("button[aria-haspopup]");
  }

  private menuItems(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  }

  private async show(focus: "first" | "last" | "selected"): Promise<void> {
    this.open = true;
    document.addEventListener("pointerdown", this.onDocPointer, true);
    await this.updateComplete;
    const items = this.menuItems();
    const checked = items.find((i) => i.getAttribute("aria-checked") === "true");
    const target =
      focus === "last" ? items.at(-1) : focus === "selected" ? (checked ?? items[0]) : items[0];
    target?.focus();
  }

  private close(refocus: boolean): void {
    if (!this.open) return;
    this.open = false;
    document.removeEventListener("pointerdown", this.onDocPointer, true);
    if (refocus) this.trigger?.focus();
  }

  private onTriggerKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      void this.show("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      void this.show("last");
    }
  }

  private onMenuKey(e: KeyboardEvent): void {
    const items = this.menuItems();
    const i = items.indexOf(e.target as HTMLElement);
    let next: HTMLElement | undefined;
    switch (e.key) {
      case "ArrowDown":
        next = items[(i + 1) % items.length];
        break;
      case "ArrowUp":
        next = items[(i - 1 + items.length) % items.length];
        break;
      case "Home":
        next = items[0];
        break;
      case "End":
        next = items.at(-1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        return;
      case "Tab":
        this.close(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    next?.focus();
  }

  private choose(item: MenuItem): void {
    this.close(true);
    if (item.href === undefined)
      emit<MenuSelectDetail>(this, FORGE_EVENTS.menuSelect, { id: item.id });
  }

  protected override render() {
    return html`
      <button
        type="button"
        class="ghost"
        aria-haspopup="menu"
        aria-expanded=${this.open ? "true" : "false"}
        aria-label=${this.label}
        @click=${() => (this.open ? this.close(false) : void this.show("selected"))}
        @keydown=${this.onTriggerKey}
      >
        <slot name="trigger"></slot>
      </button>
      ${
        this.open
          ? html`<div class="panel" role="menu" aria-label=${this.label} @keydown=${this.onMenuKey}>
              ${this.items.map((item) => {
                const role = item.checked === undefined ? "menuitem" : "menuitemradio";
                const check =
                  item.checked === undefined
                    ? nothing
                    : html`<span class="check" aria-hidden="true"
                        >${item.checked ? "✓" : ""}</span
                      >`;
                return html`${item.separator === true ? html`<hr role="separator" />` : nothing}
                ${
                  item.href !== undefined
                    ? html`<a
                        role=${role}
                        tabindex="-1"
                        href=${item.href}
                        @click=${() => this.choose(item)}
                        >${check}${item.label}</a
                      >`
                    : html`<button
                        type="button"
                        role=${role}
                        tabindex="-1"
                        aria-checked=${item.checked === undefined ? nothing : String(item.checked)}
                        @click=${() => this.choose(item)}
                      >
                        ${check}${item.label}
                      </button>`
                }`;
              })}
            </div>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-menu": ForgeMenu;
  }
}
