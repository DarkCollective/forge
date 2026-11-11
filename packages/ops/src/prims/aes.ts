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
 * aes primitives, over the audited `@noble/ciphers` (imported from the `aes.js` subpath only). AES is
 * 10 to 14 rounds of table lookups per block, far too slow in FL at 64 KiB, so these wrap the library:
 *
 *  - `_check-key`: the key must be 16, 24 or 32 bytes (E_RANGE);
 *  - `_block-enc` and `_block-dec`: one raw AES block (the block function of the shared `blockmode`
 *    layer, which the OFB mode of `aes:encrypt` runs on, since noble has no OFB);
 *  - `_crypt`: ECB, CBC, CFB (CFB-128) and CTR (the last four bytes of the counter block count, modulo
 *    2^32 with no carry into the rest, as node-forge and so CyberChef do), with or without PKCS#7;
 *  - `_gcm`: AES-GCM with the 16-byte tag appended to the ciphertext.
 *
 * Errors: a bad key or IV length is E_RANGE; a failed padding check, a failed tag check and a ciphertext
 * of an impossible length are E_COERCE. The word `aes:encrypt` and `aes:decrypt` (vocab/aes.fth) hold the
 * metadata, the parameters and the OFB mode.
 */
import { cbc, cfb, ctr, ecb, gcm } from "@noble/ciphers/aes.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

const BLOCK = 16;
const TAG = 16;
/** The shortest GCM nonce `@noble/ciphers` accepts. */
const MIN_GCM_IV = 8;

/** Rejects a key that is not 16, 24 or 32 bytes (E_RANGE). */
export function checkKey(key: Uint8Array): void {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32)
    throw rangeFailure(`the AES key must be 16, 24 or 32 bytes, not ${key.length}`, {
      length: key.length,
    });
}

function checkIv(iv: Uint8Array): void {
  if (iv.length !== BLOCK)
    throw rangeFailure(`the IV must be 16 bytes, not ${iv.length}`, { length: iv.length });
}

/** One raw AES block (16 bytes in, 16 bytes out). */
export function blockEncrypt(block: Uint8Array, key: Uint8Array): Uint8Array {
  checkKey(key);
  if (block.length !== BLOCK) throw rangeFailure(`an AES block is 16 bytes, not ${block.length}`);
  return ecb(key, { disablePadding: true }).encrypt(block);
}

/** One raw AES block, decrypted. */
export function blockDecrypt(block: Uint8Array, key: Uint8Array): Uint8Array {
  checkKey(key);
  if (block.length !== BLOCK) throw rangeFailure(`an AES block is 16 bytes, not ${block.length}`);
  return ecb(key, { disablePadding: true }).decrypt(block);
}

/**
 * CTR with a 32-bit counter: only the last four bytes of the counter block are incremented, big-endian modulo
 * 2^32, and a wrap does not carry into the other twelve bytes (node-forge's inc32, which CyberChef's AES uses).
 * Noble's `ctr` carries through the whole block, so the data is cut where the low word would wrap, and each
 * piece runs under noble with the counter the wrap leaves (the high twelve bytes unchanged, the low word 0).
 * A counter that does not wrap inside the data gives the same key stream as the whole-block counter.
 */
function ctr32(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  const counter = Uint8Array.from(iv);
  const view = new DataView(counter.buffer);
  let offset = 0;
  while (offset < data.length) {
    const low = view.getUint32(12, false);
    const toWrap = (0x100000000 - low) * BLOCK; // bytes until the low word wraps
    const end = Math.min(data.length, offset + toWrap);
    out.set(ctr(key, counter.slice()).encrypt(data.subarray(offset, end)), offset);
    offset = end;
    view.setUint32(12, 0, false);
  }
  return out;
}

/**
 * ECB, CBC, CFB or CTR. `padding` applies to ECB and CBC only (PKCS#7); with it off those two need whole
 * blocks. `decrypt` selects the direction. The IV is ignored for ECB.
 */
export function crypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  mode: string,
  padding: boolean,
  decrypt: boolean,
): Uint8Array {
  checkKey(key);
  if (mode !== "ECB") checkIv(iv);
  const block = mode === "ECB" || mode === "CBC";
  if (block && (decrypt || !padding) && data.length % BLOCK !== 0)
    throw coerceFailure(
      "bytes",
      "bytes",
      "the input is not a whole number of 16-byte blocks (use PKCS#7 padding or a multiple of 16)",
    );
  if (block && decrypt && padding && data.length === 0)
    throw coerceFailure("bytes", "bytes", "bad padding: there is no ciphertext");
  const opts = { disablePadding: !padding };
  let c;
  switch (mode) {
    case "ECB":
      c = ecb(key, opts);
      break;
    case "CBC":
      c = cbc(key, iv, opts);
      break;
    case "CFB":
      c = cfb(key, iv);
      break;
    case "CTR":
      // Encryption and decryption are the same operation in CTR.
      return ctr32(key, iv, data);
    default:
      throw rangeFailure(`unknown AES mode '${mode.slice(0, 20)}'`);
  }
  if (!decrypt) return c.encrypt(data);
  try {
    return c.decrypt(data);
  } catch {
    // The length is already checked, so the only failure left is the padding.
    throw coerceFailure("bytes", "bytes", "bad padding: the key, IV or ciphertext is wrong");
  }
}

/** AES-GCM: encrypt appends the 16-byte tag; decrypt takes it from the end and verifies it. */
export function gcmCrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
  decrypt: boolean,
): Uint8Array {
  checkKey(key);
  if (iv.length < MIN_GCM_IV)
    throw rangeFailure(`the GCM IV must be at least ${MIN_GCM_IV} bytes, not ${iv.length}`, {
      length: iv.length,
    });
  const c = gcm(key, iv, aad);
  if (!decrypt) return c.encrypt(data);
  if (data.length < TAG)
    throw coerceFailure("bytes", "bytes", "the input is shorter than the 16-byte GCM tag");
  try {
    return c.decrypt(data);
  } catch {
    throw coerceFailure(
      "bytes",
      "bytes",
      "the GCM tag check failed: wrong key, IV, data or additional data",
    );
  }
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive("aes", "_check-key", "( key:bytes -- )", checkKey, {
    doc: "Raise E_RANGE unless the key is 16, 24 or 32 bytes (private helper of aes:encrypt).",
    category: "Encryption",
  }),
  definePrimitive("aes", "_block-enc", "( block:bytes key:bytes -- bytes )", blockEncrypt, {
    doc: "Encrypt one 16-byte block with raw AES (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive("aes", "_block-dec", "( block:bytes key:bytes -- bytes )", blockDecrypt, {
    doc: "Decrypt one 16-byte block with raw AES (private block function for the blockmode layer).",
    category: "Encryption",
  }),
  definePrimitive(
    "aes",
    "_crypt",
    "( data:bytes key:bytes iv:bytes mode:str padding:bool decrypt:bool -- bytes )",
    crypt,
    {
      doc: "AES in ECB, CBC, CFB or CTR mode over noble (private helper of aes:encrypt and aes:decrypt).",
      category: "Encryption",
    },
  ),
  definePrimitive(
    "aes",
    "_gcm",
    "( data:bytes key:bytes iv:bytes aad:bytes decrypt:bool -- bytes )",
    gcmCrypt,
    {
      doc: "AES-GCM over noble, the tag appended to the ciphertext (private helper of aes:encrypt and aes:decrypt).",
      category: "Encryption",
    },
  ),
];
