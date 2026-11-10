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
import { customElement } from "lit/decorators.js";
import { actions, store } from "../state/app.js";
import type { MenuSelectDetail } from "../state/events.js";
import { StoreController } from "../state/store-controller.js";
import type { ThemePreference } from "../state/types.js";
import { baseStyles } from "../styles/shared.js";
import { brandMark, icons } from "../styles/icons.js";
import type { MenuItem } from "./forge-menu.js";
import "./forge-menu.js";

const THEME_LABELS: readonly { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "contrast", label: "High contrast" },
];

const SITE_LINKS: readonly MenuItem[] = [
  { id: "about", label: "About Forge", href: "/about/" },
  { id: "privacy", label: "Privacy", href: "/privacy/" },
  { id: "terms", label: "Terms", href: "/terms/" },
  { id: "security", label: "Security", href: "/security/" },
  { id: "accessibility", label: "Accessibility", href: "/accessibility/" },
];

/** The top bar: brand, recipe name, document actions, console toggle, theme and site menus. */
@customElement("forge-topbar")
export class ForgeTopbar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--surface);
        border-bottom: var(--border-width) solid var(--border-strong);
      }
      .bar {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-height: var(--topbar-h);
        padding: var(--space-1) var(--space-3);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-lg);
        font-weight: var(--weight-bold);
        letter-spacing: 0.01em;
        margin: 0;
      }
      .brand svg {
        width: 1.75rem;
        height: 1.75rem;
      }
      .name {
        flex: 1 1 8rem;
        min-width: 0;
        max-width: 24rem;
        margin-inline: var(--space-2);
        background: transparent;
        border-color: transparent;
        font-size: var(--text-md);
        font-weight: var(--weight-medium);
      }
      .name:hover {
        border-color: var(--border);
      }
      .name:focus {
        background: var(--surface);
        border-color: var(--border-strong);
      }
      .actions svg {
        width: 1.15em;
        height: 1.15em;
      }
      .spacer {
        flex: 1;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      .dirty {
        color: var(--warn);
        font-size: var(--text-xs);
      }
      @media (max-width: 1100px) {
        .label {
          display: none;
        }
        button {
          padding: 0;
        }
      }
      @media (max-width: 560px) {
        .brand span {
          display: none;
        }
        .actions .optional {
          display: none;
        }
      }
    `,
  ];

  private readonly recipeName = new StoreController(this, store, (s) => s.recipe.name ?? "");
  private readonly theme = new StoreController(this, store, (s) => s.settings.theme);
  private readonly consoleOpen = new StoreController(this, store, (s) => s.ui.consoleOpen);
  private readonly opsCollapsed = new StoreController(this, store, (s) => s.layout.opsCollapsed);
  private readonly compact = new StoreController(this, store, (s) => s.ui.compact);
  private readonly dirty = new StoreController(this, store, (s) => s.doc.dirty);

  private onThemeSelect = (e: CustomEvent<MenuSelectDetail>): void => {
    actions.setTheme(e.detail.id as ThemePreference);
    actions.announce(
      `Theme: ${THEME_LABELS.find((t) => t.id === e.detail.id)?.label ?? e.detail.id}`,
    );
  };

  private onMoreSelect = (e: CustomEvent<MenuSelectDetail>): void => {
    if (e.detail.id === "shortcuts") actions.openDialog("shortcuts");
    else if (e.detail.id === "fl") actions.openDialog("fl");
    else if (e.detail.id === "console") actions.setConsoleOpen(!store.get().ui.consoleOpen);
  };

  protected override render() {
    const theme = this.theme.value;
    const themeIcon =
      theme === "light"
        ? icons.sun
        : theme === "dark"
          ? icons.moon
          : theme === "contrast"
            ? icons.contrast
            : icons.monitor;
    const themeItems: MenuItem[] = THEME_LABELS.map((t) => ({
      id: t.id,
      label: t.label,
      checked: t.id === theme,
    }));
    const moreItems: MenuItem[] = [
      { id: "fl", label: "View recipe as FL" },
      { id: "console", label: this.consoleOpen.value ? "Hide console" : "Show console" },
      { id: "shortcuts", label: "Keyboard shortcuts" },
      ...SITE_LINKS.map((l, i) => (i === 0 ? { ...l, separator: true } : l)),
    ];
    return html`<div class="bar" role="toolbar" aria-label="Forge">
      ${
        this.compact.value
          ? null
          : html`<button
              type="button"
              class="ghost"
              aria-label="Operations pane"
              aria-pressed=${String(!this.opsCollapsed.value)}
              @click=${() => actions.setLayout({ opsCollapsed: !this.opsCollapsed.value })}
            >
              ${icons.panelLeft}
            </button>`
      }
      <h1 class="brand">${brandMark}<span>Forge</span></h1>
      <input
        class="name"
        type="text"
        maxlength="120"
        placeholder="Untitled recipe"
        aria-label="Recipe name"
        .value=${this.recipeName.value}
        @change=${(e: Event) => actions.setRecipeName((e.target as HTMLInputElement).value)}
      />
      ${this.dirty.value ? html`<span class="dirty" role="img" aria-label="Unsaved changes">●</span>` : null}
      <span class="spacer"></span>
      <div class="actions">
        <button type="button" aria-label="Share" @click=${() => actions.openDialog("share")}>
          ${icons.share}<span class="label">Share</span>
        </button>
        <button type="button" aria-label="Save" @click=${() => actions.openDialog("save")}>
          ${icons.save}<span class="label">Save</span>
        </button>
        <button type="button" aria-label="Open" @click=${() => actions.openDialog("open")}>
          ${icons.open}<span class="label">Open</span>
        </button>
        <button
          type="button"
          class="optional"
          aria-label="View FL"
          @click=${() => actions.openDialog("fl")}
        >
          ${icons.code}<span class="label">View FL</span>
        </button>
        <button
          type="button"
          class="optional"
          aria-label="Console"
          aria-pressed=${String(this.consoleOpen.value)}
          @click=${() => actions.setConsoleOpen(!this.consoleOpen.value)}
        >
          ${icons.terminal}<span class="label">Console</span>
        </button>
        <forge-menu
          label="Theme: ${theme}"
          @forge-menu-select=${this.onThemeSelect}
          .items=${themeItems}
        >
          <span slot="trigger">${themeIcon}</span>
        </forge-menu>
        <forge-menu label="More" @forge-menu-select=${this.onMoreSelect} .items=${moreItems}>
          <span slot="trigger">${icons.more}</span>
        </forge-menu>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-topbar": ForgeTopbar;
  }
}
