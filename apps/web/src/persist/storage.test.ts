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
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createActions, createAppStore } from "../state/app.js";
import {
  createMemoryDatabase,
  DB_VERSION,
  getKv,
  openDatabase,
  setKv,
  upgradeSchema,
} from "./db.js";
import { fileNameFor, parseRecipeFile, recipeToJson } from "./recipe-io.js";
import { createRecipeStore, sanitiseRecord } from "./recipe-store.js";
import {
  KV_FAVOURITES,
  KV_OPTIONS,
  KV_USER_SOURCE,
  loadIntoStore,
  sanitiseFavourites,
  sanitiseOptions,
  startWriteBack,
} from "./sync.js";

function freshApp() {
  const store = createAppStore({
    layout: { sizes: {}, collapsed: {} } as never,
    theme: "system",
  });
  return { store, actions: createActions(store, false) };
}

describe("schema upgrade", () => {
  test("creates both stores on a new database and is idempotent", () => {
    const names = new Set<string>();
    const target = {
      objectStoreNames: { contains: (n: string) => names.has(n) },
      createObjectStore: (n: string, o: { keyPath: string }) => {
        names.add(`${n}`);
        expect(o.keyPath.length).toBeGreaterThan(0);
      },
    };
    upgradeSchema(target, 0);
    expect([...names].sort()).toEqual(["kv", "recipes"]);
    upgradeSchema(target, 0);
    expect(names.size).toBe(2);
    expect(DB_VERSION).toBe(1);
  });

  test("a current database needs no migration", () => {
    const create = vi.fn();
    upgradeSchema(
      { objectStoreNames: { contains: () => true }, createObjectStore: create },
      DB_VERSION,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe("openDatabase", () => {
  test("falls back to memory when IndexedDB is missing", async () => {
    const opened = await openDatabase(undefined);
    expect(opened.db.persistent).toBe(false);
    expect(opened.unavailable).toMatch(/not available/);
    await setKv(opened.db, "k", { a: 1 });
    expect(await getKv(opened.db, "k")).toEqual({ a: 1 });
  });
});

describe("memory database", () => {
  test("clones values in and out", async () => {
    const db = createMemoryDatabase();
    const value = { key: "x", value: [1, 2] };
    await db.put("kv", value);
    value.value.push(3);
    expect(await getKv(db, "x")).toEqual([1, 2]);
    await db.delete("kv", "x");
    expect(await db.get("kv", "x")).toBeUndefined();
  });
  test("rejects a record without a key", async () => {
    await expect(createMemoryDatabase().put("recipes", { name: "x" })).rejects.toThrow();
  });
});

describe("RecipeStore", () => {
  let t = 1000;
  const make = () => {
    let n = 0;
    return createRecipeStore(
      createMemoryDatabase(),
      () => (t += 10),
      () => `id${(n += 1)}`,
    );
  };
  const recipe = { forge: 1, steps: [] };

  test("save, get, list newest first, overwrite keeps createdAt", async () => {
    const s = make();
    const a = await s.save({ name: "A", description: "", recipe });
    const b = await s.save({
      name: "B",
      description: "d",
      recipe,
      input: new Uint8Array([1, 2]),
      inputEncoding: "hex",
    });
    expect((await s.list()).map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await s.get(b.id))?.input).toEqual(new Uint8Array([1, 2]));
    const a2 = await s.save({ id: a.id, name: "A2", description: "", recipe });
    expect(a2.id).toBe(a.id);
    expect(a2.createdAt).toBe(a.createdAt);
    expect(a2.updatedAt).toBeGreaterThan(a.updatedAt);
    expect((await s.list())[0]?.id).toBe(a.id);
  });

  test("rename updates the record and the name inside the recipe", async () => {
    const s = make();
    const a = await s.save({ name: "A", description: "", recipe: { ...recipe, name: "A" } });
    const r = await s.rename(a.id, "New");
    expect(r.name).toBe("New");
    expect((r.recipe as { name: string }).name).toBe("New");
    await expect(s.rename("missing", "x")).rejects.toThrow();
  });

  test("delete removes the record", async () => {
    const s = make();
    const a = await s.save({ name: "A", description: "", recipe });
    await s.delete(a.id);
    expect(await s.list()).toEqual([]);
    expect(await s.get(a.id)).toBeUndefined();
  });

  test("sanitiseRecord drops junk and keeps the damaged recipe as data", () => {
    expect(sanitiseRecord(null)).toBeNull();
    expect(sanitiseRecord({ id: 5 })).toBeNull();
    const r = sanitiseRecord({
      id: "x",
      name: 3,
      recipe: "garbage",
      input: [1],
      inputEncoding: "hex",
    });
    expect(r).toMatchObject({ id: "x", name: "", recipe: "garbage" });
    expect(r?.input).toBeUndefined();
  });
});

describe("recipe files", () => {
  test("imports a valid recipe and rejects bad input", () => {
    const ok = parseRecipeFile(JSON.stringify({ forge: 1, name: "n", steps: [] }));
    expect(ok.ok).toBe(true);
    expect(parseRecipeFile("not json")).toMatchObject({ ok: false });
    expect(parseRecipeFile(JSON.stringify({ forge: 2, steps: [] }))).toMatchObject({ ok: false });
    expect(parseRecipeFile(JSON.stringify([1]))).toMatchObject({ ok: false });
    expect(parseRecipeFile(" ".repeat(300_000))).toMatchObject({ ok: false });
  });
  test("export round-trips through import", () => {
    const text = recipeToJson({ forge: 1, steps: [] }, "My recipe", "about");
    const back = parseRecipeFile(text);
    expect(back).toMatchObject({ ok: true });
    if (back.ok) expect(back.recipe).toMatchObject({ name: "My recipe", description: "about" });
    expect(fileNameFor("My  Recipe!")).toBe("my-recipe.forge.json");
    expect(fileNameFor("???")).toBe("recipe.forge.json");
  });
});

describe("sanitisers", () => {
  test("options and favourites", () => {
    expect(sanitiseOptions({ autoBake: "yes", debounceMs: 99999999 })).toEqual({
      debounceMs: 10000,
    });
    expect(sanitiseOptions(null)).toEqual({});
    expect(sanitiseFavourites(["a:b", 3, "", null])).toEqual(["a:b"]);
    expect(sanitiseFavourites("x")).toEqual([]);
  });
});

describe("load and write back", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("stored values reach the store", async () => {
    const db = createMemoryDatabase();
    await setKv(db, KV_FAVOURITES, ["base64:encode"]);
    await setKv(db, KV_OPTIONS, { autoBake: false, debounceMs: 750 });
    await setKv(db, KV_USER_SOURCE, "IN: user\n");
    const { store, actions } = freshApp();
    expect(await loadIntoStore(db, actions)).toEqual([]);
    expect(store.get().favourites).toEqual(["base64:encode"]);
    expect(store.get().settings).toMatchObject({ autoBake: false, debounceMs: 750 });
    expect(store.get().user.source).toBe("IN: user\n");
  });

  test("changes are written once, after the delay", async () => {
    const db = createMemoryDatabase();
    const { store, actions } = freshApp();
    const errors: string[] = [];
    const writer = startWriteBack(store, db, (m) => errors.push(m));
    actions.toggleFavourite("a:b");
    actions.toggleFavourite("c:d");
    actions.setSetting("autoBake", false);
    actions.setUserSource("IN: user\n: x ;\n");
    await vi.advanceTimersByTimeAsync(299);
    expect(await getKv(db, KV_FAVOURITES)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(await getKv(db, KV_FAVOURITES)).toEqual(["a:b", "c:d"]);
    expect(await getKv(db, KV_OPTIONS)).toEqual({ autoBake: false, debounceMs: 300 });
    expect(await getKv(db, KV_USER_SOURCE)).toBe("IN: user\n: x ;\n");
    // Unrelated state changes write nothing.
    actions.announce("hello");
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toEqual([]);
    // flush() writes immediately.
    actions.toggleFavourite("e:f");
    await writer.flush();
    expect(await getKv(db, KV_FAVOURITES)).toEqual(["a:b", "c:d", "e:f"]);
    writer.stop();
  });

  test("a failing write is reported, not thrown", async () => {
    const db = createMemoryDatabase();
    db.put = () => Promise.reject(new Error("quota"));
    const { store, actions } = freshApp();
    const errors: string[] = [];
    const writer = startWriteBack(store, db, (m) => errors.push(m));
    actions.toggleFavourite("a:b");
    await writer.flush();
    expect(errors).toEqual(["quota"]);
    writer.stop();
  });
});
