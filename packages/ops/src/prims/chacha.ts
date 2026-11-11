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
 * chacha primitive, over the audited `@noble/ciphers` (imported from the `chacha.js` subpath only). The
 * ChaCha keystream is ARX work per 64-byte block, too slow in FL at 64 KiB, so this wraps the library.
 *
 * Noble covers two layouts, and the primitive picks one from the nonce length:
 *
 *  - a 12-byte nonce with a 4-byte block counter (RFC 8439), with 20, 12 or 8 rounds, and a 32-byte key;
 *  - an 8-byte nonce with an 8-byte block counter (the original layout), with 20 rounds only, and a 16-
 *    or 32-byte key.
 *
 * A 16-byte key with a 12-byte nonce, which CyberChef accepts, is not in noble (it needs the "expand
 * 16-byte k" core with the key repeated, written by hand); it raises E_RANGE. The word `chacha:encrypt`
 * (vocab/chacha.fth) holds the metadata and the parameters.
 *
 * Errors: a key, nonce or round count that noble does not take is E_RANGE, and so is a counter that noble
 * refuses (noble rejects a counter that would wrap, rather than wrapping it as CyberChef does).
 */
import { chacha8, chacha12, chacha20, chacha20orig } from "@noble/ciphers/chacha.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

/** The 12-byte-nonce (RFC 8439) layout, by round count. */
const IETF: Readonly<Record<string, typeof chacha20>> = {
  "20": chacha20,
  "12": chacha12,
  "8": chacha8,
};

/**
 * Encrypts or decrypts (the same operation) the bytes with the ChaCha keystream: the key 16 or 32 bytes,
 * the nonce 8 or 12 bytes, the first block counter, and the rounds (a string: "20", "12" or "8").
 */
export function crypt(
  data: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  counter: number,
  rounds: string,
): Uint8Array {
  if (key.length !== 16 && key.length !== 32)
    throw rangeFailure(`the ChaCha key must be 16 or 32 bytes, not ${key.length}`, {
      length: key.length,
    });
  if (!Number.isSafeInteger(counter) || counter < 0)
    throw rangeFailure(`the ChaCha counter must be a whole number from 0, not ${counter}`);
  let cipher: (
    k: Uint8Array,
    n: Uint8Array,
    d: Uint8Array,
    o?: Uint8Array,
    c?: number,
  ) => Uint8Array;
  if (nonce.length === 12) {
    if (key.length !== 32)
      throw rangeFailure(
        "ChaCha with a 12-byte nonce takes a 32-byte key (16-byte keys need an 8-byte nonce)",
      );
    if (!Object.hasOwn(IETF, rounds))
      throw rangeFailure(`ChaCha rounds must be 20, 12 or 8, not '${rounds.slice(0, 10)}'`);
    cipher = IETF[rounds] as typeof cipher;
  } else if (nonce.length === 8) {
    if (rounds !== "20")
      throw rangeFailure(
        "ChaCha with an 8-byte nonce runs 20 rounds only (noble has no reduced-round original layout)",
      );
    cipher = chacha20orig;
  } else {
    throw rangeFailure(`the ChaCha nonce must be 8 or 12 bytes, not ${nonce.length}`, {
      length: nonce.length,
    });
  }
  try {
    return cipher(key, nonce, data, undefined, counter);
  } catch (err) {
    throw rangeFailure(`ChaCha: ${(err as Error).message}`);
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "chacha",
    "_crypt",
    "( data:bytes key:bytes nonce:bytes counter:int rounds:str -- bytes )",
    crypt,
    {
      doc: "The ChaCha keystream XORed over the bytes, the same both ways (private helper of chacha:encrypt).",
      category: "Encryption",
    },
  ),
];
