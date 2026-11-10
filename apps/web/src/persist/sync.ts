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
// Favourites, options and the user words unit: load them into the store once, then write changes
// back (debounced). Layout and theme stay in localStorage (owned by the shell).
import type { Actions, AppStore } from "../state/actions.js";
import { getKv, setKv } from "./db.js";
import type { Database } from "./db.js";

export const KV_FAVOURITES = "favourites";
export const KV_OPTIONS = "options";
export const KV_USER_SOURCE = "user-source";

export const WRITE_DELAY_MS = 300;
const MAX_DEBOUNCE_MS = 10_000;
const MAX_USER_SOURCE_CHARS = 1_000_000;

export interface StoredOptions {
  readonly autoBake?: boolean;
  readonly debounceMs?: number;
}

/** Storage is untrusted input: keep only well-formed fields. */
export function sanitiseOptions(value: unknown): StoredOptions {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const out: { autoBake?: boolean; debounceMs?: number } = {};
  if (typeof v.autoBake === "boolean") out.autoBake = v.autoBake;
  if (typeof v.debounceMs === "number" && Number.isFinite(v.debounceMs)) {
    out.debounceMs = Math.min(MAX_DEBOUNCE_MS, Math.max(0, Math.round(v.debounceMs)));
  }
  return out;
}

export function sanitiseFavourites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((q): q is string => typeof q === "string" && q.length > 0 && q.length <= 200);
}

export function sanitiseUserSource(value: unknown): string {
  return typeof value === "string" && value.length <= MAX_USER_SOURCE_CHARS ? value : "";
}

/** Read the stored values into the app store. A failing read leaves the defaults and rethrows nothing. */
export async function loadIntoStore(db: Database, actions: Actions): Promise<string[]> {
  const problems: string[] = [];
  const attempt = async <T>(key: string, apply: (value: T | undefined) => void): Promise<void> => {
    try {
      apply(await getKv<T>(db, key));
    } catch (e) {
      problems.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await attempt<unknown>(KV_FAVOURITES, (v) => {
    if (v !== undefined) actions.setFavourites(sanitiseFavourites(v));
  });
  await attempt<unknown>(KV_OPTIONS, (v) => {
    const o = sanitiseOptions(v);
    if (o.autoBake !== undefined) actions.setSetting("autoBake", o.autoBake);
    if (o.debounceMs !== undefined) actions.setSetting("debounceMs", o.debounceMs);
  });
  await attempt<unknown>(KV_USER_SOURCE, (v) => {
    const s = sanitiseUserSource(v);
    if (s !== "") actions.setUserSource(s);
  });
  return problems;
}

export interface WriteBack {
  /** Write everything pending now. */
  flush(): Promise<void>;
  stop(): void;
}

/**
 * Subscribe to the store and write changed favourites, options and user source after `delayMs` of
 * quiet. `onError` is called with each failed write's message.
 */
export function startWriteBack(
  store: AppStore,
  db: Database,
  onError: (message: string) => void,
  delayMs: number = WRITE_DELAY_MS,
): WriteBack {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = async (key: string): Promise<void> => {
    const s = store.get();
    try {
      if (key === KV_FAVOURITES) await setKv(db, key, [...s.favourites]);
      else if (key === KV_OPTIONS) {
        await setKv(db, key, {
          autoBake: s.settings.autoBake,
          debounceMs: s.settings.debounceMs,
        });
      } else await setKv(db, key, s.user.source);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const keys = [...pending];
    pending.clear();
    for (const key of keys) await write(key);
  };

  const schedule = (key: string): void => {
    pending.add(key);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  };

  const unsubscribe = store.subscribe((s, p) => {
    if (s.favourites !== p.favourites) schedule(KV_FAVOURITES);
    if (
      s.settings.autoBake !== p.settings.autoBake ||
      s.settings.debounceMs !== p.settings.debounceMs
    ) {
      schedule(KV_OPTIONS);
    }
    if (s.user.source !== p.user.source) schedule(KV_USER_SOURCE);
  });

  return {
    flush,
    stop() {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
