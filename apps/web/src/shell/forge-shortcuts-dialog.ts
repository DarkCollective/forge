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
import { css, html } from "lit";
import type { CSSResultGroup } from "lit";
import { customElement } from "lit/decorators.js";
import type { DialogId } from "../state/types.js";
import { ForgeDialog } from "./forge-dialog.js";

type Row = readonly [keys: string, what: string];
interface Section {
  readonly title: string;
  readonly rows: readonly Row[];
}

// Keep in step with the header comment of each pane (the code is the authority).
const SECTIONS: readonly Section[] = [
  {
    title: "Anywhere",
    rows: [
      ["Alt + 1", "Focus the operations pane"],
      ["Alt + 2", "Focus the recipe pane"],
      ["Alt + 3", "Focus the input"],
      ["Alt + 4", "Focus the output"],
      ["Alt + 5", "Open the console and focus it"],
      ["Esc", "Close a dialog or menu, cancel a drag"],
      ["F10", "Step to the next operation (while a bake is paused)"],
      ["F8", "Continue a paused bake"],
      [
        "Left / Right (on a splitter)",
        "Resize a pane; Shift for bigger steps, Home and End for the limits",
      ],
      ["Enter (on a splitter)", "Collapse or expand the pane"],
    ],
  },
  {
    title: "Operations",
    rows: [
      ["Type in the search box", "Filter operations"],
      ["Down or Enter (search box)", "Move into the results"],
      ["Esc (search box)", "Clear the search"],
      ["Up / Down, Home / End, Page Up / Page Down", "Move through the list"],
      ["Enter (list)", "Add the operation to the recipe"],
      ["F (list)", "Toggle favourite"],
      ["?", "Show or pin the operation's help"],
      ["Esc (list)", "Close the help and return to the search box"],
      ["Enter or Space (group header)", "Fold or unfold the category"],
    ],
  },
  {
    title: "Recipe",
    rows: [
      ["Up / Down, Home / End (step)", "Move between steps"],
      ["Left / Right (step)", "Collapse or expand a block"],
      ["Alt + Up / Alt + Down", "Move the step up or down among its siblings"],
      ["Space or Enter (Move button)", "Lift the step; then Up / Down move it"],
      ["Right / Left (lifted)", "Move into the block above / out of the block"],
      ["Space or Enter (lifted)", "Drop the step"],
      ["Esc (lifted)", "Cancel the move"],
      ["Ctrl / Cmd + Z", "Undo (outside text fields)"],
      ["Ctrl / Cmd + Shift + Z, Ctrl + Y", "Redo (outside text fields)"],
    ],
  },
  {
    title: "Input",
    rows: [
      ["Left / Right, Home / End (tab)", "Move between input tabs"],
      ["F2 (tab)", "Rename the tab"],
      ["Delete (tab)", "Close the tab"],
    ],
  },
  {
    title: "Console",
    rows: [
      ["Enter", "Run the line"],
      ["Up / Down", "Previous / next command from history"],
      ["Esc", "Drop an unfinished definition, or stop a running line"],
    ],
  },
];

/** The keyboard shortcut reference (opened from the More menu). */
@customElement("forge-shortcuts-dialog")
export class ForgeShortcutsDialog extends ForgeDialog {
  static override styles: CSSResultGroup = [
    ForgeDialog.styles,
    css`
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--space-2) var(--space-4);
        margin: 0;
      }
      dd {
        margin: 0;
      }
      h3 {
        margin: var(--space-4) 0 var(--space-2);
        font-size: var(--text-md);
      }
      kbd {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        padding: 0 var(--space-2);
        border: var(--border-width) solid var(--border-strong);
        border-radius: var(--radius-s);
        background: var(--surface-2);
      }
    `,
  ];

  protected readonly dialogId: DialogId = "shortcuts";
  protected readonly heading = "Keyboard shortcuts";

  protected override renderBody() {
    return html`${SECTIONS.map(
      (section) =>
        html`<h3>${section.title}</h3>
          <dl>
            ${section.rows.map(
              ([keys, what]) =>
                html`<dt><kbd>${keys}</kbd></dt>
                  <dd>${what}</dd>`,
            )}
          </dl>`,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-shortcuts-dialog": ForgeShortcutsDialog;
  }
}
