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
 * The host dependency of `magic:magic` (RECIPES.md section 4.4, WP 6.33). The Magic engine lives in
 * `@forge/worker`, which depends on this package, so the operation cannot import it. Instead the worker
 * installs a `MagicHost` for the duration of one bake, keyed by the bake's abort signal (the object the VM
 * hands every primitive as `ctx.signal`), and the private primitive of the `magic` vocabulary looks it up.
 * A runtime that no worker drives has no host, and the operation fails with a typed error.
 *
 * Keying by the signal keeps the host per bake: nothing is global, two bakes in one realm never see each
 * other's host, and the entry goes away with the signal.
 */
import type { AbortSignalLike } from "@forge/lang";

/** What the operation asks the engine for. */
export interface MagicHostRequest {
  readonly data: Uint8Array;
  /** Operations in a candidate (the engine clamps it to its own maximum). */
  readonly depth: number;
  /** Accepted and passed on; the engine ignores it until WP 6.31. */
  readonly intensive: boolean;
  /** A regular expression the wanted output matches, or "" for none. */
  readonly crib: string;
}

/** One candidate, as the report needs it. */
export interface MagicHostCandidate {
  /** The qualified names of the operations, in order. */
  readonly ops: readonly string[];
  /** 100 times the score, rounded to an integer. */
  readonly score100: number;
  readonly reasons: readonly string[];
  /** The first 4096 bytes of the output. */
  readonly output: Uint8Array;
}

export interface MagicHostReport {
  /** Best first. */
  readonly candidates: readonly MagicHostCandidate[];
}

/**
 * The engine, as the operation sees it. `search` runs inside the enclosing bake: it charges its steps and
 * bytes to the run, ends at the run's deadline and with the run's cancellation. It rejects with a
 * `ForgeError` when a limit of the run (steps or bytes) is used up, or when the crib cannot be tested.
 */
export interface MagicHost {
  search(request: MagicHostRequest): Promise<MagicHostReport>;
}

const hosts = new WeakMap<object, MagicHost>();

/** Installs the host for the bake that owns `signal`; the returned function removes it. */
export function provideMagicHost(signal: AbortSignalLike, host: MagicHost): () => void {
  hosts.set(signal, host);
  return () => {
    if (hosts.get(signal) === host) hosts.delete(signal);
  };
}

/** The host of the bake that owns `signal`, or undefined (a plain runtime, or no signal). */
export function magicHostFor(signal: AbortSignalLike | undefined): MagicHost | undefined {
  return signal === undefined ? undefined : hosts.get(signal);
}
