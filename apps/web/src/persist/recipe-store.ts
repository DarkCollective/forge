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
// The saved-recipe library behind an interface, so a Phase 6 backend can replace IndexedDB.
import type { EncodingName } from "@forge/lang";
import type { Database } from "./db.js";

/** A stored recipe. `recipe` is untrusted JSON: run `validateRecipe` before using it. */
export interface RecipeRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recipe: unknown;
  readonly input?: Uint8Array;
  readonly inputEncoding?: EncodingName;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SaveRequest {
  /** Present = overwrite that record (keeping `createdAt`); absent = a new record. */
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly recipe: unknown;
  readonly input?: Uint8Array;
  readonly inputEncoding?: EncodingName;
}

export interface RecipeStore {
  /** All records, newest (by `updatedAt`) first. */
  list(): Promise<RecipeRecord[]>;
  get(id: string): Promise<RecipeRecord | undefined>;
  save(request: SaveRequest): Promise<RecipeRecord>;
  delete(id: string): Promise<void>;
  /** Rename a record (and the `name` inside its recipe). Rejects when the id is unknown. */
  rename(id: string, name: string): Promise<RecipeRecord>;
}

const ENCODINGS: readonly string[] = ["hex", "utf8", "latin1", "base64"];

/** Shape-check a row read from storage; anything unusable is dropped from listings. */
export function sanitiseRecord(row: unknown): RecipeRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const out: {
    -readonly [K in keyof RecipeRecord]: RecipeRecord[K];
  } = {
    id: r.id,
    name: typeof r.name === "string" ? r.name : "",
    description: typeof r.description === "string" ? r.description : "",
    recipe: r.recipe,
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  };
  if (r.input instanceof Uint8Array) {
    out.input = r.input;
    if (typeof r.inputEncoding === "string" && ENCODINGS.includes(r.inputEncoding)) {
      out.inputEncoding = r.inputEncoding as EncodingName;
    }
  }
  return out;
}

export function newRecipeId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c !== undefined && typeof c.randomUUID === "function") return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createRecipeStore(
  db: Database,
  now: () => number = Date.now,
  newId: () => string = newRecipeId,
): RecipeStore {
  const read = async (id: string): Promise<RecipeRecord | undefined> => {
    const row = await db.get<unknown>("recipes", id);
    return row === undefined ? undefined : (sanitiseRecord(row) ?? undefined);
  };
  return {
    async list() {
      const rows = await db.getAll<unknown>("recipes");
      const records: RecipeRecord[] = [];
      for (const row of rows) {
        const r = sanitiseRecord(row);
        if (r !== null) records.push(r);
      }
      return records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    },
    get: read,
    async save(request) {
      const existing = request.id === undefined ? undefined : await read(request.id);
      const t = now();
      const record: RecipeRecord = {
        id: existing?.id ?? newId(),
        name: request.name,
        description: request.description,
        recipe: request.recipe,
        ...(request.input === undefined
          ? {}
          : {
              input: request.input,
              ...(request.inputEncoding === undefined
                ? {}
                : { inputEncoding: request.inputEncoding }),
            }),
        createdAt: existing?.createdAt ?? t,
        updatedAt: t,
      };
      await db.put("recipes", record);
      return record;
    },
    async delete(id) {
      await db.delete("recipes", id);
    },
    async rename(id, name) {
      const existing = await read(id);
      if (existing === undefined) throw new Error("That recipe no longer exists.");
      const recipe =
        typeof existing.recipe === "object" &&
        existing.recipe !== null &&
        !Array.isArray(existing.recipe)
          ? { ...(existing.recipe as Record<string, unknown>), name }
          : existing.recipe;
      const record: RecipeRecord = { ...existing, name, recipe, updatedAt: now() };
      await db.put("recipes", record);
      return record;
    },
  };
}
