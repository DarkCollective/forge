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
 * bcrypt primitives (Provos and Mazieres, "A Future-Adaptable Password Scheme", USENIX 1999), written
 * from the paper over the Blowfish state of src/prims/blowfish.ts. bcrypt is EksBlowfish: the Blowfish
 * state is keyed with the salt and the password (ExpandKey with a salt), then 2^cost times keyed again
 * with the password and with the salt (ExpandKey with a zero salt). The result is the 24-byte text
 * "OrpheanBeholderScryDoubt" encrypted 64 times in ECB. The password key is the password bytes plus a
 * terminating zero byte, cut at 72 bytes, as in the $2a$, $2b$ and $2y$ versions (all three give the same
 * hash here; they differ only in old, buggy implementations). The 23 first bytes of the result and the
 * 16 bytes of salt are written in bcrypt's own base64 ("./A-Za-z0-9", no padding):
 *
 *     $2b$10$<22 characters of salt><31 characters of hash>
 *
 * Primitives:
 *  - `_hash ( password salt cost prefix -- bytes )`: the 60-character string as ASCII bytes;
 *  - `_verify ( password hash -- bool )`: parses the string, recomputes and compares in constant time;
 *  - `_parse ( hash -- str )`: a text report of the cost, salt and hash (CyberChef's "Bcrypt parse");
 *  - `_random-salt ( -- bytes )`: 16 random bytes (effect +random), the only source of randomness.
 *
 * Cost cap: the work doubles with each step of the cost, and the bake deadline of an untrusted recipe is
 * 10 s. `MAX_COST` (16) bounds the cost of `_hash` and of the cost read from a string in `_verify`
 * (E_RANGE). Measured on a 2026 laptop under Node: cost 10 takes 0.10 s, 12 takes 0.23 s, 14 takes
 * 0.9 s and 16 takes 3.8 s; cost 17 would take about 7.6 s, too close to the deadline for a slower
 * machine. The cost is at least 4, as in the reference implementation.
 */
import { definePrimitive } from "@forge/lang";
import type { PrimitiveDef } from "@forge/lang";
import { coerceFailure, rangeFailure } from "../prim-util.js";
import { bfEncryptBlock, bfExpandKey, bfInit } from "./blowfish.js";

export const MIN_COST = 4;
export const MAX_COST = 16;
const SALT_LENGTH = 16;
const HASH_LENGTH = 23;
const ALPHABET = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** "OrpheanBeholderScryDoubt". */
const MAGIC = Uint8Array.from("OrpheanBeholderScryDoubt", (c) => c.charCodeAt(0));

/** bcrypt's base64 of `data`, without padding. */
function encode64(data: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of data) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET.charAt((acc >> bits) & 63);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET.charAt((acc << (6 - bits)) & 63);
  return out;
}

/** The `n` bytes in bcrypt's base64 text (the surplus bits of the last character are ignored). */
function decode64(text: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length && o < n; i++) {
    acc = (acc << 6) | ALPHABET.indexOf(text.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/** The raw 23-byte bcrypt hash: EksBlowfish setup, then the magic text encrypted 64 times. */
export function bcryptRaw(password: Uint8Array, salt: Uint8Array, cost: number): Uint8Array {
  const key = new Uint8Array(Math.min(password.length + 1, 72));
  key.set(password.subarray(0, key.length));
  const st = bfInit();
  bfExpandKey(st, key, salt);
  const rounds = 2 ** cost;
  for (let i = 0; i < rounds; i++) {
    bfExpandKey(st, key);
    bfExpandKey(st, salt);
  }
  let ct = MAGIC.slice();
  for (let i = 0; i < 64; i++) {
    const next = new Uint8Array(24);
    for (let b = 0; b < 24; b += 8) next.set(bfEncryptBlock(st, ct.subarray(b, b + 8)), b);
    ct = next;
  }
  // The 24 bytes are written as they are, and the last byte is dropped.
  return ct.subarray(0, HASH_LENGTH);
}

function checkCost(cost: unknown): number {
  if (typeof cost !== "number" || !Number.isSafeInteger(cost) || cost < MIN_COST || cost > MAX_COST)
    throw rangeFailure(
      `the bcrypt cost must be ${MIN_COST} to ${MAX_COST} (2^cost rounds), not ${String(cost)}`,
      { cost, min: MIN_COST, max: MAX_COST },
    );
  return cost;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

function format(prefix: string, cost: number, salt: Uint8Array, hash: Uint8Array): string {
  return `$${prefix}$${String(cost).padStart(2, "0")}$${encode64(salt).slice(0, 22)}${encode64(hash).slice(0, 31)}`;
}

/** The bcrypt string of a password: `prefix` is 2a, 2b or 2y. */
export function hash(
  password: Uint8Array,
  salt: Uint8Array,
  cost: number,
  prefix: string,
): Uint8Array {
  if (prefix !== "2a" && prefix !== "2b" && prefix !== "2y")
    throw rangeFailure(`unknown bcrypt version '${prefix.slice(0, 20)}'`);
  checkCost(cost);
  if (salt.length !== SALT_LENGTH)
    throw rangeFailure(`the bcrypt salt must be ${SALT_LENGTH} bytes, not ${salt.length}`, {
      length: salt.length,
    });
  return ascii(format(prefix, cost, salt, bcryptRaw(password, salt, cost)));
}

const FORMAT = /^\$(2[aby])\$(\d\d)\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/;

function parseHash(text: string) {
  const m = FORMAT.exec(text.length > 256 ? "" : text);
  if (m === null)
    throw coerceFailure(
      "str",
      "bcrypt hash",
      "not of the form $2b$10$ + 22 salt + 31 hash characters",
    );
  const cost = Number(m[2]);
  if (cost < MIN_COST || cost > 31)
    throw coerceFailure("str", "bcrypt hash", `the cost ${m[2]} is not 04 to 31`);
  return { prefix: m[1] as string, cost, salt: m[3] as string, hash: m[4] as string };
}

/** True when the password gives the hash in the string. A malformed string is E_COERCE. */
export function verify(password: Uint8Array, text: string): boolean {
  const p = parseHash(text);
  checkCost(p.cost);
  const got = format(
    p.prefix,
    p.cost,
    decode64(p.salt, SALT_LENGTH),
    bcryptRaw(password, decode64(p.salt, SALT_LENGTH), p.cost),
  );
  // The salt is re-encoded in canonical form, so a string whose last salt character carries stray bits
  // compares as the reference implementation does: by the whole string.
  let diff = got.length ^ text.length;
  for (let i = 0; i < text.length; i++) diff |= (got.charCodeAt(i) || 0) ^ text.charCodeAt(i);
  return diff === 0;
}

/** A text report of the parts of a bcrypt string (the cost need not be within the cap). */
export function parse(text: string): string {
  const p = parseHash(text);
  return `Rounds: ${p.cost}\nSalt: $${p.prefix}$${String(p.cost).padStart(2, "0")}$${p.salt}\nPassword hash: ${p.hash}\nFull hash: ${text}`;
}

/** Sixteen random bytes from the host's CSPRNG. */
export function randomSalt(): Uint8Array {
  const c = (globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } })
    .crypto;
  if (c === undefined) throw rangeFailure("no secure random source is available in this host");
  return c.getRandomValues(new Uint8Array(SALT_LENGTH));
}

export const primitives: readonly PrimitiveDef[] = [
  definePrimitive(
    "bcrypt",
    "_hash",
    "( password:bytes salt:bytes cost:int prefix:str -- bytes )",
    hash,
    {
      doc: "The bcrypt string of a password with a 16-byte salt, as ASCII bytes (private helper of bcrypt:hash).",
      category: "Key derivation",
    },
  ),
  definePrimitive("bcrypt", "_verify", "( password:bytes hash:str -- bool )", verify, {
    doc: "Whether the password matches a bcrypt string (private helper of bcrypt:compare).",
    category: "Key derivation",
  }),
  definePrimitive("bcrypt", "_parse", "( hash:str -- str )", parse, {
    doc: "A text report of the cost, salt and hash of a bcrypt string (private helper of bcrypt:parse).",
    category: "Key derivation",
  }),
  definePrimitive("bcrypt", "_random-salt", "( -- bytes )", randomSalt, {
    doc: "Sixteen random bytes for a bcrypt salt (private helper of bcrypt:hash).",
    category: "Key derivation",
    effects: ["+random"],
  }),
];
