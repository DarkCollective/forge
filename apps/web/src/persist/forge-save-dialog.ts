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
import { html } from "lit";
import type { CSSResultGroup } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RECIPE_LIMITS } from "@forge/recipe";
import type { Recipe } from "@forge/recipe";
import { ForgeDialog } from "../shell/forge-dialog.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { DialogId } from "../state/types.js";
import { persistDialogStyles } from "./dialog-styles.js";
import { getServices, STORAGE_UNAVAILABLE_MESSAGE } from "./services.js";

/** Save the current recipe (and optionally the active input) to the library. */
@customElement("forge-save-dialog")
export class ForgeSaveDialog extends ForgeDialog {
  static override styles: CSSResultGroup = [ForgeDialog.styles, persistDialogStyles];

  protected readonly dialogId: DialogId = "save";
  protected readonly heading = "Save recipe";

  private readonly doc = new StoreController(this, store, (s) => s.doc);
  private readonly recipe = new StoreController(this, store, (s) => s.recipe);
  private readonly inputs = new StoreController(this, store, (s) => s.inputs);

  @state() private name = "";
  @state() private description = "";
  @state() private includeInput = false;
  @state() private busy = false;
  @state() private error = "";
  @state() private memoryOnly = false;
  private wasOpen = false;

  protected override willUpdate(): void {
    const open = this.isOpen;
    if (open && !this.wasOpen) {
      const recipe = store.get().recipe;
      this.name = recipe.name ?? "";
      this.description = recipe.description ?? "";
      this.includeInput = false;
      this.busy = false;
      this.error = "";
      void getServices().then((s) => {
        this.memoryOnly = s.unavailable !== null;
      });
    }
    this.wasOpen = open;
  }

  private statusText(): string {
    const { savedId, dirty } = this.doc.value;
    if (savedId === null) return dirty ? "Not saved yet. Unsaved changes." : "Not saved yet.";
    return dirty ? "Unsaved changes since the last save." : "No changes since the last save.";
  }

  private async save(overwrite: boolean): Promise<void> {
    const name = this.name.trim();
    const description = this.description.trim();
    if (name === "") {
      this.error = "Give the recipe a name.";
      return;
    }
    if (name.length > RECIPE_LIMITS.maxNameChars) {
      this.error = `The name is longer than ${RECIPE_LIMITS.maxNameChars} characters.`;
      return;
    }
    if (description.length > RECIPE_LIMITS.maxDescriptionChars) {
      this.error = `The description is longer than ${RECIPE_LIMITS.maxDescriptionChars} characters.`;
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      const s = store.get();
      const base: Record<string, unknown> = { ...s.recipe, name };
      if (description === "") delete base.description;
      else base.description = description;
      const recipe = base as unknown as Recipe;
      if (s.recipe.name !== recipe.name || s.recipe.description !== recipe.description) {
        actions.setRecipe(recipe);
      }
      const tab = s.inputs.find((t) => t.id === s.activeInputId);
      const { recipes } = await getServices();
      const record = await recipes.save({
        ...(overwrite && s.doc.savedId !== null ? { id: s.doc.savedId } : {}),
        name,
        description,
        recipe,
        ...(this.includeInput && tab !== undefined
          ? { input: tab.bytes, inputEncoding: tab.encoding }
          : {}),
      });
      actions.markSaved(record.id);
      actions.announce(`Saved recipe ${name}.`);
      actions.closeDialog();
    } catch (e) {
      this.error = `Could not save: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.busy = false;
    }
  }

  protected override renderBody() {
    const savedId = this.doc.value.savedId;
    const tab = this.inputs.value.find((t) => t.id === store.get().activeInputId);
    // Reading the recipe here keeps the dialog subscribed to it.
    void this.recipe.value;
    return html`
      <form
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.save(savedId !== null);
        }}
      >
        <p class="status" role="status">${this.statusText()}</p>
        ${this.memoryOnly ? html`<p class="notice">${STORAGE_UNAVAILABLE_MESSAGE}</p>` : null}
        ${this.error === "" ? null : html`<p class="error" role="alert">${this.error}</p>`}
        <div class="field">
          <label for="save-name">Name</label>
          <input
            id="save-name"
            type="text"
            required
            autocomplete="off"
            maxlength=${RECIPE_LIMITS.maxNameChars}
            .value=${this.name}
            @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label for="save-description">Description (optional)</label>
          <textarea
            id="save-description"
            rows="3"
            maxlength=${RECIPE_LIMITS.maxDescriptionChars}
            .value=${this.description}
            @input=${(e: Event) => (this.description = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
        <div class="check">
          <input
            id="save-input"
            type="checkbox"
            .checked=${this.includeInput}
            @change=${(e: Event) => (this.includeInput = (e.target as HTMLInputElement).checked)}
          />
          <label for="save-input">
            Include the input${tab === undefined ? "" : ` (${tab.bytes.length} bytes)`}
          </label>
        </div>
        <p class="hint">
          Recipes are stored in this browser only. Anything you include, such as key values or the
          input, is stored in clear text.
        </p>
        <div class="actions">
          <button type="button" @click=${() => actions.closeDialog()}>Cancel</button>
          ${
            savedId === null
              ? html`<button type="submit" class="primary" ?disabled=${this.busy}>Save</button>`
              : html`
                  <button
                    type="button"
                    ?disabled=${this.busy}
                    @click=${() => void this.save(false)}
                  >
                    Save as copy
                  </button>
                  <button type="submit" class="primary" ?disabled=${this.busy}>Overwrite</button>
                `
          }
        </div>
      </form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-save-dialog": ForgeSaveDialog;
  }
}
