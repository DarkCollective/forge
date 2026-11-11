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
 * argon2 primitives (RFC 9106), over the audited `@noble/hashes` (synchronous). Argon2 is memory-hard
 * and far too slow in FL. Two primitives:
 *
 *  - `_derive`: the tag of a password and salt for one of the types argon2d, argon2i, argon2id, either
 *    as raw bytes or as the PHC encoded string `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>` (unpadded
 *    standard base64) as ASCII bytes;
 *  - `_verify`: parses such a string, recomputes the tag with its parameters and compares in constant
 *    time. A string that is not a well-formed encoded hash is E_COERCE.
 *
 * The encoding lives here, not in FL, because it needs unpadded base64 and a strict parse of the PHC
 * grammar; the rest (parameters, metadata) is FL in vocab/argon2.fth.
 *
 * Caps (the bake deadline is 10 s for untrusted recipes), E_RANGE when exceeded, also for the
 * parameters read from an encoded string: memory at most 262144 KiB (256 MiB), time cost at most 64,
 * and memory times time cost at most 1,048,576 (about 2.5 s at 256 MiB with t = 4), parallelism 1 to
 * 64 with memory at least 8 * p, salt at least 8 bytes (RFC 9106 section 3.1), tag 4 to 1024 bytes.
 */
import { argon2d, argon2i, argon2id } from "@noble/hashes/argon2.js";
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";

type ArgonFn = typeof argon2id;

const TYPES: Readonly<Record<string, ArgonFn>> = { argon2d, argon2i, argon2id };

export const MAX_MEMORY = 262_144;
export const MAX_TIME = 64;
export const MAX_COST = 1_048_576;
export const MAX_PARALLELISM = 64;
export const MIN_SALT = 8;
export const MIN_LENGTH = 4;
export const MAX_LENGTH = 1024;
/** The version written into encoded strings: 0x13, v=19. */
const VERSION = 0x13;

function whole(name: string, v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    throw rangeFailure(`Argon2 ${name} must be ${min} to ${max}, not ${String(v)}`);
  return v;
}

export interface Params {
  readonly type: string;
  readonly version: number;
  readonly t: number;
  readonly m: number;
  readonly p: number;
  readonly length: number;
  /** The optional secret value and associated data of RFC 9106 (not part of the encoded string). */
  readonly secret?: Uint8Array;
  readonly ad?: Uint8Array;
}

function checkParams(salt: Uint8Array, q: Params): void {
  if (!Object.hasOwn(TYPES, q.type))
    throw rangeFailure(`unknown Argon2 type '${q.type.slice(0, 20)}'`);
  whole("memory (KiB)", q.m, 8, MAX_MEMORY);
  whole("iterations", q.t, 1, MAX_TIME);
  whole("parallelism", q.p, 1, MAX_PARALLELISM);
  whole("hash length", q.length, MIN_LENGTH, MAX_LENGTH);
  if (q.m < 8 * q.p)
    throw rangeFailure(`Argon2 memory of ${q.m} KiB is under 8 * parallelism (${8 * q.p})`);
  if (q.m * q.t > MAX_COST)
    throw rangeFailure(
      `Argon2 memory * iterations = ${q.m * q.t} is over the limit of ${MAX_COST} (for example 256 MiB with 4 iterations)`,
      { m: q.m, t: q.t, limit: MAX_COST },
    );
  if (salt.length < MIN_SALT)
    throw rangeFailure(`the Argon2 salt must be at least ${MIN_SALT} bytes, not ${salt.length}`);
}

/** The raw tag. Exported for the tests, which run the RFC 9106 vectors (they use a secret and associated data). */
export function tag(password: Uint8Array, salt: Uint8Array, q: Params): Uint8Array {
  checkParams(salt, q);
  const fn = TYPES[q.type] as ArgonFn;
  return fn(password, salt, {
    t: q.t,
    m: q.m,
    p: q.p,
    dkLen: q.length,
    version: q.version,
    key: q.secret,
    personalization: q.ad,
    maxmem: 2 ** 30,
  });
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 without padding. */
function b64encode(data: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 3 <= data.length; i += 3) {
    const n =
      ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
    out +=
      B64.charAt(n >> 18) +
      B64.charAt((n >> 12) & 63) +
      B64.charAt((n >> 6) & 63) +
      B64.charAt(n & 63);
  }
  const rest = data.length - i;
  if (rest === 1) {
    const n = (data[i] as number) << 16;
    out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((data[i] as number) << 16) | ((data[i + 1] as number) << 8);
    out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63);
  }
  return out;
}

/** Strict unpadded standard base64; undefined when the text is not canonical. */
function b64decode(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]*$/.test(text) || text.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    acc = (acc << 6) | B64.indexOf(text.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  // The leftover bits must be zero for the encoding to be canonical.
  return acc === 0 ? out : undefined;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

/** The PHC string of a tag. */
function encodeHash(q: Params, salt: Uint8Array, hash: Uint8Array): string {
  return `$${q.type}$v=${q.version}$m=${q.m},t=${q.t},p=${q.p}$${b64encode(salt)}$${b64encode(hash)}`;
}

/**
 * The Argon2 tag of a password: raw bytes, or with `encoded` the PHC string as ASCII bytes. `type` is
 * argon2d, argon2i or argon2id, `m` the memory in KiB, `t` the iterations, `p` the lanes.
 */
export function derive(
  password: Uint8Array,
  salt: Uint8Array,
  t: number,
  m: number,
  p: number,
  length: number,
  type: string,
  encoded: boolean,
): Uint8Array {
  const q: Params = { type, version: VERSION, t, m, p, length };
  const out = tag(password, salt, q);
  return encoded ? ascii(encodeHash(q, salt, out)) : out;
}

const PHC =
  /^\$(argon2(?:id|i|d))(?:\$v=(\d{1,3}))?\$m=(\d{1,10}),t=(\d{1,10}),p=(\d{1,10})\$([A-Za-z0-9+/]*)\$([A-Za-z0-9+/]*)$/;

function malformed(reason: string) {
  return coerceFailure("str", "Argon2 encoded hash", reason);
}

/** True when the password produces the tag of the encoded hash. A malformed string is E_COERCE. */
export function verify(password: Uint8Array, encoded: string): boolean {
  const mt = PHC.exec(encoded.length > 4096 ? "" : encoded);
  if (mt === null) throw malformed("not of the form $argon2id$v=19$m=..,t=..,p=..$salt$hash");
  const version = mt[2] === undefined ? 0x10 : Number(mt[2]);
  if (version !== 0x10 && version !== 0x13) throw malformed(`unsupported version v=${version}`);
  const salt = b64decode(mt[6] as string);
  const want = b64decode(mt[7] as string);
  if (salt === undefined) throw malformed("the salt is not unpadded base64");
  if (want === undefined) throw malformed("the hash is not unpadded base64");
  if (salt.length < MIN_SALT) throw malformed(`the salt is under ${MIN_SALT} bytes`);
  if (want.length < MIN_LENGTH || want.length > MAX_LENGTH)
    throw malformed(`the hash must be ${MIN_LENGTH} to ${MAX_LENGTH} bytes`);
  const q: Params = {
    type: mt[1] as string,
    version,
    m: Number(mt[3]),
    t: Number(mt[4]),
    p: Number(mt[5]),
    length: want.length,
  };
  const got = tag(password, salt, q);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= (got[i] as number) ^ (want[i] as number);
  return diff === 0;
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "argon2",
    "_derive",
    "( password:bytes salt:bytes t:int m:int p:int length:int type:str encoded:bool -- bytes )",
    derive,
    {
      doc: "Argon2 (RFC 9106) over the audited noble library, raw or as a PHC string (private helper of argon2:derive).",
      category: "Key derivation",
    },
  ),
  definePrimitive("argon2", "_verify", "( password:bytes encoded:str -- bool )", verify, {
    doc: "Whether the password matches a PHC encoded Argon2 hash (private helper of argon2:compare).",
    category: "Key derivation",
  }),
];
