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
// A tiny promise wrapper over IndexedDB (UI.md WP 3.7). Everything above this file talks to the
// `Database` interface, so the logic is tested against `createMemoryDatabase()`; the real
// implementation `openIndexedDb` is a thin adapter. `openDatabase` never rejects: when IndexedDB is
// unavailable (private windows, blocked storage) it hands back the in-memory database and the reason.

export const DB_NAME = "forge";
export const DB_VERSION = 1;

export type StoreName = "recipes" | "kv";

/** Every object store with its key path, as created by the latest schema. */
export const STORES: readonly { readonly name: StoreName; readonly keyPath: string }[] = [
  { name: "recipes", keyPath: "id" },
  { name: "kv", keyPath: "key" },
];

export interface Database {
  /** False for the in-memory fallback: nothing survives a reload. */
  readonly persistent: boolean;
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, value: object): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  close(): void;
}

// ---- schema migrations ------------------------------------------------------------------------

/** The part of `IDBDatabase` a migration may use (lets tests pass a stub). */
export interface SchemaTarget {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options: { keyPath: string }): unknown;
}

/** `MIGRATIONS[n]` upgrades a database of version `n` to version `n + 1`. Append, never edit. */
export const MIGRATIONS: readonly ((db: SchemaTarget) => void)[] = [
  (db) => {
    for (const s of STORES) {
      if (!db.objectStoreNames.contains(s.name)) {
        db.createObjectStore(s.name, { keyPath: s.keyPath });
      }
    }
  },
];

/** Run the migrations from `oldVersion` (0 = a new database) up to `DB_VERSION`. */
export function upgradeSchema(db: SchemaTarget, oldVersion: number): void {
  for (let v = Math.max(0, oldVersion); v < DB_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step !== undefined) step(db);
  }
}

// ---- IndexedDB implementation -----------------------------------------------------------------

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function openIndexedDb(factory: IDBFactory | undefined): Promise<Database> {
  if (factory === undefined) throw new Error("IndexedDB is not available");
  const idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      upgradeSchema(request.result, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
  // Another tab upgrading the schema must not be held up by this connection.
  idb.onversionchange = () => idb.close();
  return {
    persistent: true,
    async getAll<T>(store: StoreName): Promise<T[]> {
      return (await requestResult(
        idb.transaction(store, "readonly").objectStore(store).getAll(),
      )) as T[];
    },
    async get<T>(store: StoreName, key: string): Promise<T | undefined> {
      return (await requestResult(
        idb.transaction(store, "readonly").objectStore(store).get(key),
      )) as T | undefined;
    },
    async put(store: StoreName, value: object): Promise<void> {
      const tx = idb.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      await transactionDone(tx);
    },
    async delete(store: StoreName, key: string): Promise<void> {
      const tx = idb.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      await transactionDone(tx);
    },
    close(): void {
      idb.close();
    },
  };
}

// ---- in-memory implementation -----------------------------------------------------------------

/** Same contract as IndexedDB (values are structured-cloned in and out), kept in a Map. */
export function createMemoryDatabase(): Database {
  const stores = new Map<StoreName, Map<string, unknown>>();
  const keyPaths = new Map(STORES.map((s) => [s.name, s.keyPath]));
  const table = (name: StoreName): Map<string, unknown> => {
    let t = stores.get(name);
    if (t === undefined) {
      t = new Map();
      stores.set(name, t);
    }
    return t;
  };
  return {
    persistent: false,
    getAll<T>(store: StoreName): Promise<T[]> {
      return Promise.resolve([...table(store).values()].map((v) => structuredClone(v) as T));
    },
    get<T>(store: StoreName, key: string): Promise<T | undefined> {
      const v = table(store).get(key);
      return Promise.resolve(v === undefined ? undefined : (structuredClone(v) as T));
    },
    put(store: StoreName, value: object): Promise<void> {
      const key = (value as Record<string, unknown>)[keyPaths.get(store) as string];
      if (typeof key !== "string") return Promise.reject(new Error("record has no string key"));
      table(store).set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete(store: StoreName, key: string): Promise<void> {
      table(store).delete(key);
      return Promise.resolve();
    },
    close(): void {
      /* nothing to release */
    },
  };
}

export interface OpenedDatabase {
  readonly db: Database;
  /** Why IndexedDB could not be used (the in-memory fallback is in `db`), or null. */
  readonly unavailable: string | null;
}

/** Open IndexedDB, or fall back to memory. Never rejects. */
export async function openDatabase(
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<OpenedDatabase> {
  try {
    return { db: await openIndexedDb(factory), unavailable: null };
  } catch (e) {
    return {
      db: createMemoryDatabase(),
      unavailable: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---- key/value helpers ------------------------------------------------------------------------

export async function getKv<T>(db: Database, key: string): Promise<T | undefined> {
  const row = await db.get<{ key: string; value: T }>("kv", key);
  return row?.value;
}

export async function setKv(db: Database, key: string, value: unknown): Promise<void> {
  await db.put("kv", { key, value });
}
