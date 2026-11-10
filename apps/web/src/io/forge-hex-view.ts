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
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../styles/shared.js";
import { formatBytes, hexDumpRows, hexRowCount } from "./codec.js";

/** Height of one dump row in CSS pixels; the CSS below uses the same number. */
const ROW_PX = 20;
const OVERSCAN = 20;
/** Most bytes the dump scrolls through (browsers limit the height of a scrolling element). */
export const HEX_VIEW_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Virtualised hex dump (offset, hex, ASCII). Only the rows in view (plus a margin) exist in the DOM,
 * so a megabyte stays responsive. Scrollable by keyboard (the region is focusable).
 */
@customElement("forge-hex-view")
export class ForgeHexView extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      .scroller {
        flex: 1;
        min-height: 6rem;
        overflow: auto;
        background: var(--surface);
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-s);
        font-family: var(--font-mono);
        font-size: var(--text-sm);
      }
      .rows {
        position: relative;
        min-width: max-content;
      }
      .row {
        position: absolute;
        left: 0;
        height: 20px;
        line-height: 20px;
        display: flex;
        gap: 1.5ch;
        padding: 0 var(--space-2);
      }
      .row span {
        white-space: pre;
      }
      .off,
      .asc {
        color: var(--text-muted);
      }
      .note {
        margin: 0 0 var(--space-1);
        font-size: var(--text-xs);
        color: var(--text-muted);
      }
      .empty {
        padding: var(--space-3);
        color: var(--text-muted);
      }
    `,
  ];

  @property({ attribute: false }) bytes: Uint8Array = new Uint8Array(0);
  @property() label = "Hex dump";

  @state() private scrolled = 0;
  @state() private viewport = 400;
  private resizeObserver: ResizeObserver | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(this);
    }
  }

  override disconnectedCallback(): void {
    this.resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("bytes")) this.scrolled = 0;
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("bytes")) {
      const scroller = this.renderRoot.querySelector<HTMLElement>(".scroller");
      if (scroller !== null) scroller.scrollTop = 0;
    }
    this.measure();
  }

  private measure(): void {
    const scroller = this.renderRoot.querySelector<HTMLElement>(".scroller");
    if (scroller !== null && scroller.clientHeight > 0 && scroller.clientHeight !== this.viewport) {
      this.viewport = scroller.clientHeight;
    }
  }

  private onScroll(e: Event): void {
    this.scrolled = (e.target as HTMLElement).scrollTop;
  }

  protected override render() {
    const shown =
      this.bytes.length > HEX_VIEW_MAX_BYTES
        ? this.bytes.subarray(0, HEX_VIEW_MAX_BYTES)
        : this.bytes;
    const total = hexRowCount(shown.length);
    if (total === 0) {
      return html`<div class="scroller"><div class="empty">Empty (0 bytes).</div></div>`;
    }
    const first = Math.max(0, Math.floor(this.scrolled / ROW_PX) - OVERSCAN);
    const count = Math.ceil(this.viewport / ROW_PX) + OVERSCAN * 2;
    const rows = hexDumpRows(shown, first, count);
    const note =
      shown.length < this.bytes.length
        ? html`<p class="note" role="note">
            Showing the first ${formatBytes(shown.length)} of ${formatBytes(this.bytes.length)}.
          </p>`
        : nothing;
    return html`${note}
      <div
        class="scroller"
        role="region"
        tabindex="0"
        aria-label="${this.label}, ${formatBytes(this.bytes.length)}"
        @scroll=${this.onScroll}
      >
        <div class="rows" style=${styleMap({ height: `${total * ROW_PX}px` })}>
          ${rows.map(
            (r, i) =>
              html`<div class="row" style=${styleMap({ top: `${(first + i) * ROW_PX}px` })}>
                <span class="off">${r.offset}</span><span class="hex">${r.hex}</span
                ><span class="asc">|${r.ascii}|</span>
              </div>`,
          )}
        </div>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-hex-view": ForgeHexView;
  }
}
