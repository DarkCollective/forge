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
import type { CSSResultGroup, PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { RECIPE_LIMITS, validateRecipe } from "@forge/recipe";
import type { Recipe } from "@forge/recipe";
import { ForgeDialog } from "../shell/forge-dialog.js";
import { actions, store } from "../state/app.js";
import { StoreController } from "../state/store-controller.js";
import type { DialogId } from "../state/types.js";
import { persistDialogStyles } from "./dialog-styles.js";
import { checkWordName, DEFAULT_CATEGORY, promoteToWord } from "./promote.js";
import { downloadText, fileNameFor, parseRecipeFile, recipeToJson } from "./recipe-io.js";
import type { RecipeRecord } from "./recipe-store.js";
import { getServices, STORAGE_UNAVAILABLE_MESSAGE } from "./services.js";

const MAX_IMPORT_BYTES = RECIPE_LIMITS.maxJsonBytes;

interface Row {
  readonly record: RecipeRecord;
  /** The validated recipe, or null when the stored data is damaged. */
  readonly recipe: Recipe | null;
  readonly problem: string;
}

type Tab = "recipes" | "words";

/** The library: open, rename, delete, export, import, promote to a word; and the user words editor. */
@customElement("forge-open-dialog")
export class ForgeOpenDialog extends ForgeDialog {
  static override styles: CSSResultGroup = [
    ForgeDialog.styles,
    persistDialogStyles,
    css`
      .tabs {
        display: flex;
        gap: var(--space-1);
        margin-block-end: var(--space-3);
        border-bottom: var(--border-width) solid var(--border);
      }
      .tabs button {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        border-bottom-width: 0;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        align-items: center;
        margin-block-end: var(--space-3);
      }
      .toolbar input[type="search"] {
        flex: 1 1 12rem;
      }
      ul.list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      ul.list > li {
        border: var(--border-width) solid var(--border);
        border-radius: var(--radius-m);
        padding: var(--space-2) var(--space-3);
      }
      .title {
        font-weight: var(--weight-bold);
        overflow-wrap: anywhere;
      }
      .meta {
        color: var(--text-muted);
        font-size: var(--text-sm);
        overflow-wrap: anywhere;
      }
      .row-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        margin-block-start: var(--space-2);
      }
      .damaged {
        color: var(--danger);
        font-weight: var(--weight-medium);
      }
      .inline-form {
        margin-block-start: var(--space-2);
        padding-block-start: var(--space-2);
        border-top: var(--border-width) dashed var(--border);
      }
      textarea.words {
        width: 100%;
        min-height: 16rem;
        font-family: var(--font-mono);
      }
    `,
  ];

  protected readonly dialogId: DialogId = "open";
  protected readonly heading = "Open recipe";

  private readonly docState = new StoreController(this, store, (s) => s.doc);
  private readonly userState = new StoreController(this, store, (s) => s.user);

  @state() private tab: Tab = "recipes";
  @state() private rows: readonly Row[] = [];
  @state() private loaded = false;
  @state() private search = "";
  @state() private message = "";
  @state() private error = "";
  @state() private memoryOnly = false;
  @state() private renaming: string | null = null;
  @state() private renameValue = "";
  @state() private confirmDelete: string | null = null;
  @state() private confirmOpen: string | null = null;
  @state() private promoting: string | null = null;
  @state() private wordName = "";
  @state() private wordDoc = "";
  @state() private wordCategory = DEFAULT_CATEGORY;
  @state() private promoteError = "";
  @state() private wordsDraft = "";
  private wasOpen = false;
  private focusSelector: string | null = null;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const open = this.isOpen;
    if (open && !this.wasOpen) {
      this.tab = "recipes";
      this.search = "";
      this.message = "";
      this.error = "";
      this.renaming = null;
      this.confirmDelete = null;
      this.confirmOpen = null;
      this.promoting = null;
      this.wordsDraft = store.get().user.source;
      void this.refresh();
    }
    this.wasOpen = open;
  }

  protected override updated(): void {
    super.updated();
    if (this.focusSelector !== null) {
      const el = this.renderRoot.querySelector<HTMLElement>(this.focusSelector);
      this.focusSelector = null;
      el?.focus();
    }
  }

  private focusNext(selector: string): void {
    this.focusSelector = selector;
  }

  private async refresh(): Promise<void> {
    try {
      const services = await getServices();
      this.memoryOnly = services.unavailable !== null;
      const records = await services.recipes.list();
      const cs = store.get().catalogue;
      const catalogue = cs.status === "ready" ? cs.catalogue : undefined;
      this.rows = records.map((record): Row => {
        const r = validateRecipe(record.recipe, catalogue);
        if (r.ok) return { record, recipe: r.recipe, problem: "" };
        const first = r.issues.find((i) => i.severity === "error") ?? r.issues[0];
        return { record, recipe: null, problem: first?.message ?? "Not a valid recipe." };
      });
      this.loaded = true;
    } catch (e) {
      this.error = `Could not read the library: ${e instanceof Error ? e.message : String(e)}`;
      this.loaded = true;
    }
  }

  private visibleRows(): Row[] {
    const q = this.search.trim().toLowerCase();
    if (q === "") return [...this.rows];
    return this.rows.filter(
      (r) =>
        r.record.name.toLowerCase().includes(q) || r.record.description.toLowerCase().includes(q),
    );
  }

  private clearMessages(): void {
    this.message = "";
    this.error = "";
  }

  // ---- actions on recipes ---------------------------------------------------------------------

  private requestOpen(row: Row): void {
    this.clearMessages();
    if (row.recipe === null) return;
    if (this.docState.value.dirty && this.confirmOpen !== row.record.id) {
      this.confirmOpen = row.record.id;
      this.focusNext("[data-confirm-open]");
      return;
    }
    this.confirmOpen = null;
    const { record } = row;
    actions.loadDocument({
      recipe: row.recipe,
      ...(record.input === undefined
        ? {}
        : {
            input: record.input,
            ...(record.inputEncoding === undefined ? {} : { inputEncoding: record.inputEncoding }),
          }),
      savedId: record.id,
    });
    actions.announce(`Opened recipe ${record.name === "" ? "(unnamed)" : record.name}.`);
    actions.closeDialog();
  }

  private async doRename(row: Row): Promise<void> {
    this.clearMessages();
    const name = this.renameValue.trim();
    if (name === "" || name.length > RECIPE_LIMITS.maxNameChars) {
      this.error = `A name has 1 to ${RECIPE_LIMITS.maxNameChars} characters.`;
      return;
    }
    try {
      const { recipes } = await getServices();
      await recipes.rename(row.record.id, name);
      this.renaming = null;
      this.message = `Renamed to ${name}.`;
      await this.refresh();
      this.focusNext(`[data-rename-btn="${CSS.escape(row.record.id)}"]`);
    } catch (e) {
      this.error = `Could not rename: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async doDelete(row: Row): Promise<void> {
    this.clearMessages();
    try {
      const { recipes } = await getServices();
      await recipes.delete(row.record.id);
      this.confirmDelete = null;
      this.message = `Deleted ${row.record.name === "" ? "the recipe" : row.record.name}.`;
      await this.refresh();
      this.focusNext("input[type='search']");
    } catch (e) {
      this.error = `Could not delete: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private doExport(row: Row): void {
    this.clearMessages();
    downloadText(
      fileNameFor(row.record.name),
      recipeToJson(row.recipe ?? row.record.recipe, row.record.name, row.record.description),
    );
    this.message =
      "Exported. The file holds the recipe in clear text, including any key values you entered.";
  }

  private async onImport(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    this.clearMessages();
    if (file === undefined) return;
    if (file.size > MAX_IMPORT_BYTES) {
      this.error = "That file is too large to be a recipe.";
      return;
    }
    try {
      const cs = store.get().catalogue;
      const parsed = parseRecipeFile(
        await file.text(),
        cs.status === "ready" ? cs.catalogue : undefined,
      );
      if (!parsed.ok) {
        this.error = parsed.error;
        return;
      }
      const name = parsed.recipe.name ?? file.name.replace(/\.json$/i, "");
      const { recipes } = await getServices();
      await recipes.save({
        name,
        description: parsed.recipe.description ?? "",
        recipe: { ...parsed.recipe, name },
      });
      this.message = `Imported ${name}.${parsed.warnings.length > 0 ? ` Warnings: ${parsed.warnings.join("; ")}` : ""}`;
      await this.refresh();
    } catch (err) {
      this.error = `Could not import: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ---- promote ---------------------------------------------------------------------------------

  private startPromote(row: Row): void {
    this.clearMessages();
    this.promoting = row.record.id;
    this.wordName = "";
    this.wordDoc = row.record.description.split("\n")[0]?.slice(0, 200) ?? "";
    this.wordCategory = DEFAULT_CATEGORY;
    this.promoteError = "";
    this.focusNext("#word-name");
  }

  private doPromote(row: Row): void {
    const cs = store.get().catalogue;
    if (cs.status !== "ready" || row.recipe === null) {
      this.promoteError = "The operations catalogue is not ready yet.";
      return;
    }
    const result = promoteToWord({
      recipe: row.recipe,
      catalogue: cs.catalogue,
      name: this.wordName.trim(),
      doc: this.wordDoc,
      category: this.wordCategory,
      userSource: store.get().user.source,
    });
    if (!result.ok) {
      this.promoteError = result.error;
      return;
    }
    actions.setUserSource(result.source);
    this.wordsDraft = result.source;
    this.promoting = null;
    this.message = `Added the word ${result.word}. It will appear in the operations pane once your words have loaded.`;
    actions.announce(`Added the word ${result.word}.`);
    this.focusNext(`[data-promote-btn="${CSS.escape(row.record.id)}"]`);
  }

  // ---- rendering --------------------------------------------------------------------------------

  private renderRow(row: Row) {
    const { record } = row;
    const id = record.id;
    const label = record.name === "" ? "(unnamed)" : record.name;
    const confirming = this.confirmDelete === id;
    const renaming = this.renaming === id;
    return html`
      <li>
        <div class="title">${label}</div>
        ${record.description === "" ? null : html`<div class="meta">${record.description}</div>`}
        <div class="meta">
          Saved
          ${new Date(record.updatedAt).toLocaleString()}${
            record.input === undefined ? "" : `, with input (${record.input.length} bytes)`
          }
        </div>
        ${
          row.recipe === null
            ? html`<div class="damaged">
                Damaged: ${row.problem} It cannot be opened; you can delete it.
              </div>`
            : null
        }
        ${
          this.confirmOpen === id
            ? html`<div class="inline-form" role="alert">
                You have unsaved changes. Opening this recipe discards them.
                <div class="row-actions">
                  <button
                    type="button"
                    class="primary"
                    data-confirm-open
                    @click=${() => this.requestOpen(row)}
                  >
                    Discard and open
                  </button>
                  <button type="button" @click=${() => (this.confirmOpen = null)}>Cancel</button>
                </div>
              </div>`
            : confirming
              ? html`<div class="inline-form" role="alert">
                  Delete ${label}? This cannot be undone.
                  <div class="row-actions">
                    <button
                      type="button"
                      class="primary"
                      data-confirm-delete
                      @click=${() => void this.doDelete(row)}
                    >
                      Delete
                    </button>
                    <button type="button" @click=${() => (this.confirmDelete = null)}>
                      Cancel
                    </button>
                  </div>
                </div>`
              : renaming
                ? html`<form
                    class="inline-form"
                    @submit=${(e: Event) => {
                      e.preventDefault();
                      void this.doRename(row);
                    }}
                  >
                    <div class="field">
                      <label for="rename-input">New name</label>
                      <input
                        id="rename-input"
                        type="text"
                        autocomplete="off"
                        maxlength=${RECIPE_LIMITS.maxNameChars}
                        .value=${this.renameValue}
                        @input=${(e: Event) => (this.renameValue = (e.target as HTMLInputElement).value)}
                      />
                    </div>
                    <div class="row-actions">
                      <button type="submit" class="primary">Rename</button>
                      <button type="button" @click=${() => (this.renaming = null)}>Cancel</button>
                    </div>
                  </form>`
                : html`<div class="row-actions">
                    <button
                      type="button"
                      class="primary"
                      ?disabled=${row.recipe === null}
                      aria-label=${`Open ${label}`}
                      @click=${() => this.requestOpen(row)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      data-rename-btn=${id}
                      aria-label=${`Rename ${label}`}
                      @click=${() => {
                        this.clearMessages();
                        this.renaming = id;
                        this.renameValue = record.name;
                        this.focusNext("#rename-input");
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      ?disabled=${row.recipe === null}
                      aria-label=${`Export ${label} as JSON`}
                      @click=${() => this.doExport(row)}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      data-promote-btn=${id}
                      ?disabled=${row.recipe === null}
                      aria-label=${`Promote ${label} to a word`}
                      @click=${() => this.startPromote(row)}
                    >
                      Promote to word
                    </button>
                    <button
                      type="button"
                      aria-label=${`Delete ${label}`}
                      @click=${() => {
                        this.clearMessages();
                        this.confirmDelete = id;
                        this.focusNext("[data-confirm-delete]");
                      }}
                    >
                      Delete
                    </button>
                  </div>`
        }
        ${this.promoting === id ? this.renderPromote(row) : null}
      </li>
    `;
  }

  private renderPromote(row: Row) {
    const nameProblem =
      this.wordName === "" ? null : checkWordName(this.wordName, store.get().user.source);
    return html`
      <form
        class="inline-form"
        aria-label="Promote to word"
        @submit=${(e: Event) => {
          e.preventDefault();
          this.doPromote(row);
        }}
      >
        <p class="hint">
          Turns this recipe into a word in your words. It takes bytes and gives back any value, and
          shows up in the operations pane as <span class="mono">user:name</span>.
        </p>
        ${this.promoteError === "" ? null : html`<p class="error" role="alert">${this.promoteError}</p>`}
        <div class="field">
          <label for="word-name">Word name</label>
          <input
            id="word-name"
            type="text"
            autocomplete="off"
            spellcheck="false"
            aria-describedby="word-name-hint"
            .value=${this.wordName}
            @input=${(e: Event) => (this.wordName = (e.target as HTMLInputElement).value)}
          />
          <span id="word-name-hint" class="hint">
            ${nameProblem ?? "Lowercase letters, digits and hyphens, for example my-decoder."}
          </span>
        </div>
        <div class="field">
          <label for="word-doc">Description (one line)</label>
          <input
            id="word-doc"
            type="text"
            autocomplete="off"
            maxlength="500"
            .value=${this.wordDoc}
            @input=${(e: Event) => (this.wordDoc = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label for="word-category">Category</label>
          <input
            id="word-category"
            type="text"
            autocomplete="off"
            .value=${this.wordCategory}
            @input=${(e: Event) => (this.wordCategory = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="row-actions">
          <button type="submit" class="primary">Add word</button>
          <button type="button" @click=${() => (this.promoting = null)}>Cancel</button>
        </div>
      </form>
    `;
  }

  private renderRecipes() {
    const rows = this.visibleRows();
    return html`
      <div class="toolbar">
        <label class="sr-only" for="open-search">Search recipes</label>
        <input
          id="open-search"
          type="search"
          placeholder="Search recipes"
          autocomplete="off"
          .value=${this.search}
          @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          @click=${() => this.renderRoot.querySelector<HTMLInputElement>("#open-import")?.click()}
        >
          Import JSON
        </button>
        <input
          id="open-import"
          hidden
          aria-label="Recipe JSON file to import"
          type="file"
          accept=".json,application/json"
          @change=${(e: Event) => void this.onImport(e)}
        />
      </div>
      ${
        !this.loaded
          ? html`<p class="muted">Loading</p>`
          : rows.length === 0
            ? html`<p class="muted">
                ${this.rows.length === 0 ? "No saved recipes yet." : "No recipe matches the search."}
              </p>`
            : html`<ul class="list" aria-label="Saved recipes">
                ${rows.map((r) => this.renderRow(r))}
              </ul>`
      }
    `;
  }

  private renderWords() {
    const userError = this.userState.value.error;
    return html`
      <p class="hint">
        Your words are one FL source unit that starts with <span class="mono">IN: user</span>.
        Applying it reloads the console and the baker. The unit is stored in this browser only.
      </p>
      ${
        userError === null
          ? null
          : html`<p class="error" role="alert">Your words did not load: ${userError}</p>`
      }
      <div class="field">
        <label for="words-source">Source</label>
        <textarea
          id="words-source"
          class="words"
          spellcheck="false"
          autocomplete="off"
          .value=${this.wordsDraft}
          @input=${(e: Event) => (this.wordsDraft = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>
      <div class="actions">
        <button
          type="button"
          class="primary"
          ?disabled=${this.wordsDraft === this.userState.value.source}
          @click=${() => {
            actions.setUserSource(this.wordsDraft);
            this.message = "Applied your words.";
            actions.announce("Applied your words.");
          }}
        >
          Apply
        </button>
      </div>
    `;
  }

  private readonly onTabKey = (e: KeyboardEvent): void => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    this.tab = this.tab === "recipes" ? "words" : "recipes";
    this.focusNext(`#tab-${this.tab}`);
  };

  protected override renderBody() {
    return html`
      ${this.memoryOnly ? html`<p class="notice">${STORAGE_UNAVAILABLE_MESSAGE}</p>` : null}
      <div class="tabs" role="tablist" aria-label="Library" @keydown=${this.onTabKey}>
        <button
          id="tab-recipes"
          type="button"
          role="tab"
          aria-selected=${this.tab === "recipes"}
          aria-controls="panel-recipes"
          tabindex=${this.tab === "recipes" ? 0 : -1}
          @click=${() => (this.tab = "recipes")}
        >
          Recipes
        </button>
        <button
          id="tab-words"
          type="button"
          role="tab"
          aria-selected=${this.tab === "words"}
          aria-controls="panel-words"
          tabindex=${this.tab === "words" ? 0 : -1}
          @click=${() => (this.tab = "words")}
        >
          My words
        </button>
      </div>
      ${this.message === "" ? null : html`<p class="status" role="status">${this.message}</p>`}
      ${this.error === "" ? null : html`<p class="error" role="alert">${this.error}</p>`}
      <div
        id=${this.tab === "recipes" ? "panel-recipes" : "panel-words"}
        role="tabpanel"
        aria-labelledby=${this.tab === "recipes" ? "tab-recipes" : "tab-words"}
      >
        ${this.tab === "recipes" ? this.renderRecipes() : this.renderWords()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "forge-open-dialog": ForgeOpenDialog;
  }
}
