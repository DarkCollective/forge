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
/**
 * Text encodings of byte strings (RECIPES.md sections 3.4 and 7.1): hex, standard base64, latin1, UTF-8 and
 * unpadded base64url. Every parser is strict and returns null for a value that is not valid, so that each
 * byte string has exactly one normal spelling.
 */
import type { EncodingName } from "@forge/lang";
import { hasLoneSurrogate } from "./limits.js";
import type { Encoded } from "./types.js";

const utf8Encoder = new TextEncoder();
const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const HEX_DIGITS = "0123456789abcdef";
const STANDARD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The ASCII whitespace that hex and base64 text may contain: space, tab, LF, VT, FF, CR. */
const ASCII_WS = /[ \t\n\v\f\r]/g;

function reverseTable(alphabet: string): Int8Array {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
}

const STANDARD_REVERSE = reverseTable(STANDARD);
const URL_REVERSE = reverseTable(URL_SAFE);

export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

/** Strict UTF-8 decoding; null when the bytes are not well-formed. A leading BOM is kept. */
export function utf8DecodeStrict(bytes: Uint8Array): string | null {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return null;
  }
}

/** Lowercase hex, two digits per byte, no separators. */
export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX_DIGITS[b >> 4] + (HEX_DIGITS[b & 15] as string);
  return out;
}

/** Hex digit pairs with ASCII whitespace ignored; null if there is anything else or an odd digit count. */
export function hexDecode(text: string): Uint8Array | null {
  const s = text.replace(ASCII_WS, "");
  if (s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = nibble(s.charCodeAt(2 * i));
    const lo = nibble(s.charCodeAt(2 * i + 1));
    if (hi < 0 || lo < 0) return null;
    out[i] = hi * 16 + lo;
  }
  return out;
}

function nibble(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return -1;
}

function base64Core(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out +=
      alphabet.charAt(n >> 18) +
      alphabet.charAt((n >> 12) & 63) +
      alphabet.charAt((n >> 6) & 63) +
      alphabet.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += alphabet.charAt(n >> 18) + alphabet.charAt((n >> 12) & 63) + (pad ? "==" : "");
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out +=
      alphabet.charAt(n >> 18) +
      alphabet.charAt((n >> 12) & 63) +
      alphabet.charAt((n >> 6) & 63) +
      (pad ? "=" : "");
  }
  return out;
}

/** Standard base64 (RFC 4648 section 4) with padding. */
export function base64Encode(bytes: Uint8Array): string {
  return base64Core(bytes, STANDARD, true);
}

/** Base64url (RFC 4648 section 5) without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Core(bytes, URL_SAFE, false);
}

/**
 * Decodes `body` (no padding characters) with `table`. Null for a character outside the alphabet, a length of
 * the form 4n + 1, or non-zero unused trailing bits (so every byte string has one spelling).
 */
function base64Body(body: string, table: Int8Array): Uint8Array | null {
  const rem = body.length % 4;
  if (rem === 1) return null;
  const out = new Uint8Array(Math.floor(body.length / 4) * 3 + (rem === 0 ? 0 : rem - 1));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const v = c < 128 ? (table[c] as number) : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return acc === 0 ? out : null;
}

/** Standard base64: padding optional (but correct if present), ASCII whitespace ignored. */
export function base64Decode(text: string): Uint8Array | null {
  const s = text.replace(ASCII_WS, "");
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0x3d) end--;
  const pad = s.length - end;
  const body = s.slice(0, end);
  if (pad > 0 && (pad > 2 || s.length % 4 !== 0)) return null;
  return base64Body(body, STANDARD_REVERSE);
}

/** Canonical unpadded base64url: nothing outside the alphabet, no `=`, no whitespace. */
export function base64UrlDecode(text: string): Uint8Array | null {
  return base64Body(text, URL_REVERSE);
}

/** One character per byte. */
export function latin1Encode(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** Null when a code point is above U+00FF. */
export function latin1Decode(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff) return null;
    out[i] = c;
  }
  return out;
}

/** The bytes of an encoded value, or null when `value` is not valid for `enc`. */
export function tryDecodeEncoded(value: string, enc: EncodingName): Uint8Array | null {
  switch (enc) {
    case "utf8":
      return hasLoneSurrogate(value) ? null : utf8Encode(value);
    case "hex":
      return hexDecode(value);
    case "latin1":
      return latin1Decode(value);
    case "base64":
      return base64Decode(value);
  }
}

/** The normal spelling of a valid encoded value (RECIPES.md section 3.4). */
export function normaliseEncodedValue(value: string, enc: EncodingName): string {
  if (enc === "hex" || enc === "base64") {
    const bytes = tryDecodeEncoded(value, enc);
    if (bytes !== null) return enc === "hex" ? hexEncode(bytes) : base64Encode(bytes);
  }
  return value;
}

/** The bytes an `Encoded` stands for. The value must be valid; a `RangeError` is thrown otherwise. */
export function decodeEncoded(encoded: Encoded): Uint8Array {
  const bytes = tryDecodeEncoded(encoded.value, encoded.enc);
  if (bytes === null) throw new RangeError(`invalid ${encoded.enc} value`);
  return bytes;
}

/** The text spelling of `bytes` in `enc` (hex lowercase, base64 padded). `utf8` needs well-formed UTF-8, else a `RangeError`. */
export function encodeBytes(bytes: Uint8Array, enc: EncodingName): string {
  switch (enc) {
    case "hex":
      return hexEncode(bytes);
    case "base64":
      return base64Encode(bytes);
    case "latin1":
      return latin1Encode(bytes);
    case "utf8": {
      const text = utf8DecodeStrict(bytes);
      if (text === null) throw new RangeError("bytes are not well-formed UTF-8");
      return text;
    }
  }
}
