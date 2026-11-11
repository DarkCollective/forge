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
 * pbkdf2 primitives. Only `_derive` is a primitive: PBKDF2 (RFC 8018 section 5.2) is `iterations`
 * HMAC calls per output block, so a real iteration count (hundreds of thousands) is far beyond the FL
 * step budget, and it wraps the audited `@noble/hashes` (synchronous). The word `pbkdf2:derive`
 * (vocab/pbkdf2.fth) holds the metadata and the parameters.
 *
 * Cap (the bake deadline is 10 s for untrusted recipes): the work, that is the iterations times the
 * number of output blocks, is at most 2,000,000 HMAC iterations (about 1.2 s for SHA-1 and 4.7 s for
 * SHA-512 on a laptop), and the key is at most 1024 bytes.
 */
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import type { CHash } from "@noble/hashes/utils.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { rangeFailure } from "../prim-util.js";

interface Hash {
  readonly fn: CHash;
  /** The digest length in bytes. */
  readonly size: number;
}

const HASHES: Readonly<Record<string, Hash>> = {
  sha1: { fn: sha1, size: 20 },
  sha256: { fn: sha256, size: 32 },
  sha384: { fn: sha384, size: 48 },
  sha512: { fn: sha512, size: 64 },
  md5: { fn: md5, size: 16 },
};

/** The most output bytes. */
export const MAX_KEY = 1024;
/** The most HMAC iterations in one call (iterations times output blocks). */
export const MAX_WORK = 2_000_000;

/** PBKDF2-HMAC of `password` and `salt`: `size` bytes after `iterations` rounds with the named hash. */
export function derive(
  password: Uint8Array,
  salt: Uint8Array,
  size: number,
  iterations: number,
  hash: string,
): Uint8Array {
  const h = Object.hasOwn(HASHES, hash) ? HASHES[hash] : undefined;
  if (h === undefined) throw rangeFailure(`unknown PBKDF2 hash '${hash.slice(0, 20)}'`);
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > MAX_KEY)
    throw rangeFailure(`the PBKDF2 key size must be 1 to ${MAX_KEY} bytes, not ${String(size)}`);
  if (typeof iterations !== "number" || !Number.isSafeInteger(iterations) || iterations < 1)
    throw rangeFailure(`the PBKDF2 iteration count must be at least 1, not ${String(iterations)}`);
  const blocks = Math.ceil(size / h.size);
  if (iterations * blocks > MAX_WORK)
    throw rangeFailure(
      `${iterations} iterations of ${blocks} blocks is over the limit of ${MAX_WORK} HMAC iterations`,
      { iterations, size, limit: MAX_WORK },
    );
  return pbkdf2(h.fn, password, salt, { c: iterations, dkLen: size });
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "pbkdf2",
    "_derive",
    "( password:bytes salt:bytes size:int iterations:int hash:str -- bytes )",
    derive,
    {
      doc: "PBKDF2-HMAC (RFC 8018) over the audited noble library (private helper of pbkdf2:derive).",
      category: "Key derivation",
    },
  ),
];
