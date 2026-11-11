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
 * fernet primitives: the two inputs of Fernet encryption that FL cannot produce, kept apart from the
 * construction so a test can pin them (vocab/fernet.fth takes them as arguments of `_seal` and `_open`).
 *
 *  - `_now`: the current Unix time in whole seconds (+time);
 *  - `_random-iv`: 16 random bytes from the host CSPRNG (+random). It never falls back to Math.random:
 *    a host without `crypto.getRandomValues` is an error, because a predictable IV breaks Fernet.
 */
import { ForgeError, definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";

interface HostCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/** The current Unix time in seconds. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** 16 bytes from the host's cryptographic random source. */
export function randomIv(): Uint8Array {
  const c = (globalThis as unknown as { crypto?: HostCrypto }).crypto;
  if (c === undefined || typeof c.getRandomValues !== "function") {
    throw new ForgeError({
      code: "E_PRIMITIVE",
      message: "this host has no cryptographic random source (crypto.getRandomValues)",
    });
  }
  return c.getRandomValues(new Uint8Array(16));
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("fernet", "_now", "( -- int )", now, {
    effects: ["+time"],
    doc: "The current Unix time in seconds (private helper of fernet:encrypt and fernet:decrypt).",
    category: "Encryption",
  }),
  definePrimitive("fernet", "_random-iv", "( -- bytes )", randomIv, {
    effects: ["+random"],
    doc: "Sixteen random bytes from the host CSPRNG (private helper of fernet:encrypt).",
    category: "Encryption",
  }),
];
