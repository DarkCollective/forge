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

/*
 * The input host of `input:tab` (RECIPES-1.2.md sections 7.2 and 7.3, X5). The named tabs of a bake belong to the
 * baker (`@forge/worker`), which depends on this package, so the primitive cannot import them. The baker installs
 * an `InputHost` for the duration of one bake, keyed by the bake's abort signal (the object the VM hands every
 * primitive as `ctx.signal`), exactly as it installs the Magic host (src/magic-host.ts): nothing is global, two
 * bakes in one realm never see each other's inputs, and the entry goes away with the signal. A runtime that no
 * baker drives has no host and finds no tabs. Nested bakes of `magic:magic` get no host.
 */
import type { AbortSignalLike } from "@forge/lang";

/** The named tabs of one bake. */
export interface InputHost {
  /** The bytes of the tab with exactly this name, or undefined. The caller must not change them. */
  read(name: string): Uint8Array | undefined;
  /** The names of all tabs, in the order the bake was given them. */
  names(): readonly string[];
}

/** Most names listed in `detail.tabs`, and the code points each name is cut to (RECIPES-1.2.md section 7.4). */
const MAX_LISTED_TABS = 20;
const MAX_LISTED_TAB_CHARS = 80;

const cut = (name: string): string => [...name].slice(0, MAX_LISTED_TAB_CHARS).join("");

/**
 * The `detail` of the error for a tab the bake does not have (RECIPES-1.2.md section 7.4), shared by the primitive
 * and by the baker's early check so that the two cannot differ: `param`, `reason`, `tab` and `tabs` (at most 20
 * names, each cut to 80 code points).
 */
export function noSuchInputDetail(
  tab: string,
  available: readonly string[],
): { param: "tab"; reason: "no-such-input"; tab: string; tabs: string[] } {
  return {
    param: "tab",
    reason: "no-such-input",
    tab: cut(tab),
    tabs: available.slice(0, MAX_LISTED_TABS).map(cut),
  };
}

/** The message of that error. */
export function noSuchInputMessage(tab: string): string {
  return `there is no input tab named '${cut(tab)}'`;
}

const hosts = new WeakMap<object, InputHost>();

/** Installs the host for the bake that owns `signal`; the returned function removes it. */
export function provideInputHost(signal: AbortSignalLike, host: InputHost): () => void {
  hosts.set(signal, host);
  return () => {
    if (hosts.get(signal) === host) hosts.delete(signal);
  };
}

/** The host of the bake that owns `signal`, or undefined (a plain runtime, a bake with no inputs, or no signal). */
export function inputHostFor(signal: AbortSignalLike | undefined): InputHost | undefined {
  return signal === undefined ? undefined : hosts.get(signal);
}
