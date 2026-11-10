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
// A trailing-edge debouncer with an injectable clock, so the schedule is unit-testable.

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Debouncer {
  /** (Re)start the wait; `fn` runs once, `delay` ms after the last call. */
  schedule(): void;
  /** Drop a pending call. */
  cancel(): void;
  /** Run a pending call now. Does nothing when none is pending. */
  flush(): void;
  readonly pending: boolean;
}

export function createDebouncer(
  fn: () => void,
  delay: number | (() => number),
  timers: Timers = realTimers,
): Debouncer {
  let handle: unknown;
  let pending = false;
  const wait = (): number => Math.max(0, typeof delay === "function" ? delay() : delay);

  function fire(): void {
    pending = false;
    handle = undefined;
    fn();
  }
  return {
    schedule(): void {
      if (pending) timers.clear(handle);
      pending = true;
      handle = timers.set(fire, wait());
    },
    cancel(): void {
      if (!pending) return;
      timers.clear(handle);
      pending = false;
      handle = undefined;
    },
    flush(): void {
      if (!pending) return;
      timers.clear(handle);
      fire();
    },
    get pending(): boolean {
      return pending;
    },
  };
}
