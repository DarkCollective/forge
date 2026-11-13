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
// Pure helpers of the input and output panes (UI.md WP 3.5): text <-> bytes by encoding and line
// ending, Shannon entropy, hex dump rows. Bytes are canonical (PLAN.md 3.1): text always has an
// explicit encoding, UTF-8 is strict, and nothing here ever substitutes U+FFFD.
import type { EncodingName } from "@forge/lang";
import type { EolName } from "../state/types.js";

export type { EncodingName, EolName };

export const ENCODINGS: readonly EncodingName[] = ["utf8", "hex", "latin1", "base64"];
export const EOLS: readonly EolName[] = ["lf", "crlf", "cr"];
export const EOL_TEXT: Record<EolName, string> = { lf: "\n", crlf: "\r\n", cr: "\r" };

/** Largest input (bytes) the text area edits; larger ones are shown read-only as a hex summary. */
export const EDIT_LIMIT_BYTES = 256 * 1024;
/** Largest file the input pane reads. */
export const FILE_LIMIT_BYTES = 64 * 1024 * 1024;

export type DecodeResult =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string };

export type EncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string; readonly index: number };

// ---- line endings --------------------------------------------------------------------------------

/** Every CRLF, CR and LF becomes LF (what a text area holds). */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** LF-only text to the chosen line ending. The input must already be normalised. */
export function applyEol(text: string, eol: EolName): string {
  return eol === "lf" ? text : text.replace(/\n/g, EOL_TEXT[eol]);
}

/** The most common line ending of `text`, or `lf` when it has none. */
export function detectEol(text: string): EolName {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf > lf && crlf >= cr) return "crlf";
  if (cr > lf && cr > crlf) return "cr";
  return "lf";
}

/**
 * The line ending a tab should show `bytes` with: the most common one (a tie goes to LF) for the text
 * encodings, LF when there is none. Bytes that are not well-formed UTF-8 in a utf8 tab, and the hex and
 * base64 views, get LF (the editor shows no lines there). CR (13) and LF (10) are the same bytes in UTF-8
 * and Latin-1, so the count runs on the bytes.
 */
export function inferEol(bytes: Uint8Array, encoding: EncodingName): EolName {
  if (encoding !== "utf8" && encoding !== "latin1") return "lf";
  if (encoding === "utf8" && decodeUtf8Strict(bytes) === null) return "lf";
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 13) {
      if (bytes[i + 1] === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf > lf && crlf >= cr) return "crlf";
  if (cr > lf && cr > crlf) return "cr";
  return "lf";
}

// ---- strict UTF-8 --------------------------------------------------------------------------------

/** Strict UTF-8 decoding (a BOM is kept as U+FEFF, not dropped). Null when the bytes are not well formed. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Index of the first unpaired surrogate in `text`, or -1. */
export function findLoneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else return i;
    } else if (c >= 0xdc00 && c <= 0xdfff) return i;
  }
  return -1;
}

/** Number of code points of well-formed UTF-8 bytes (counts non-continuation bytes). */
export function countUtf8Chars(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (((bytes[i] as number) & 0xc0) !== 0x80) n++;
  return n;
}

// ---- hex and base64 ------------------------------------------------------------------------------

const HEX = "0123456789abcdef";

export function bytesToHex(bytes: Uint8Array, separator = ""): string {
  const parts: string[] = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    parts[i] = (HEX[b >> 4] as string) + (HEX[b & 15] as string);
  }
  return parts.join(separator);
}

function hexValue(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/** Hex text (case-insensitive, white space between digits allowed) to bytes. */
export function hexToBytes(text: string): EncodeResult {
  const out = new Uint8Array(text.length >> 1);
  let n = 0;
  let high = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) continue;
    const v = hexValue(c);
    if (v < 0) {
      return {
        ok: false,
        index: i,
        message: `Not a hex digit: ${JSON.stringify(text[i])} at position ${i + 1}.`,
      };
    }
    if (high < 0) high = v;
    else {
      out[n++] = (high << 4) | v;
      high = -1;
    }
  }
  if (high >= 0) {
    return { ok: false, index: text.length, message: "Odd number of hex digits." };
  }
  return { ok: true, bytes: out.slice(0, n) };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const n = (a << 16) | (b << 8) | c;
    s += (B64[(n >> 18) & 63] as string) + (B64[(n >> 12) & 63] as string);
    s += i + 1 < bytes.length ? (B64[(n >> 6) & 63] as string) : "=";
    s += i + 2 < bytes.length ? (B64[n & 63] as string) : "=";
    if (s.length >= 8192) {
      chunks.push(s);
      s = "";
    }
  }
  chunks.push(s);
  return chunks.join("");
}

/** Standard base64 (RFC 4648 section 4), white space ignored, padding optional but exact when present. */
export function base64ToBytes(text: string): EncodeResult {
  const clean: number[] = [];
  let pad = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) continue;
    if (c === 61) {
      pad++;
      continue;
    }
    if (pad > 0) {
      return { ok: false, index: i, message: `Base64 data after padding at position ${i + 1}.` };
    }
    const v = B64.indexOf(text[i] as string);
    if (v < 0) {
      return {
        ok: false,
        index: i,
        message: `Not a base64 character: ${JSON.stringify(text[i])} at position ${i + 1}.`,
      };
    }
    clean.push(v);
  }
  const rem = clean.length % 4;
  if (rem === 1) {
    return {
      ok: false,
      index: text.length,
      message: "Base64 length is impossible (one stray character).",
    };
  }
  if (pad > 2 || (pad > 0 && (clean.length + pad) % 4 !== 0)) {
    return { ok: false, index: text.length, message: "Base64 padding is wrong." };
  }
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      ((clean[i] as number) << 18) |
      ((clean[i + 1] as number) << 12) |
      ((clean[i + 2] ?? 0) << 6) |
      (clean[i + 3] ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return { ok: true, bytes: out };
}

// ---- latin1 --------------------------------------------------------------------------------------

export function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return s;
}

export function latin1ToBytes(text: string): EncodeResult {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) {
      const cp = text.codePointAt(i) as number;
      return {
        ok: false,
        index: i,
        message: `U+${cp.toString(16).toUpperCase().padStart(4, "0")} cannot be written as Latin-1 (position ${i + 1}).`,
      };
    }
    out[i] = c;
  }
  return { ok: true, bytes: out };
}

// ---- text <-> bytes by encoding ------------------------------------------------------------------

/**
 * Text for the editor. The result always uses LF line endings (a text area does). Fails only for
 * UTF-8 bytes that are not well formed: they are never shown with replacement characters.
 */
export function bytesToText(bytes: Uint8Array, encoding: EncodingName): DecodeResult {
  switch (encoding) {
    case "utf8": {
      const text = decodeUtf8Strict(bytes);
      return text === null
        ? { ok: false, message: "The bytes are not valid UTF-8." }
        : { ok: true, text: normalizeEol(text) };
    }
    case "latin1":
      return { ok: true, text: normalizeEol(bytesToLatin1(bytes)) };
    case "hex":
      return { ok: true, text: bytesToHex(bytes, " ") };
    case "base64":
      return { ok: true, text: bytesToBase64(bytes) };
  }
}

/** Editor text to bytes. `eol` applies to utf8 and latin1 only (hex and base64 text has no meaningful lines). */
export function textToBytes(text: string, encoding: EncodingName, eol: EolName): EncodeResult {
  switch (encoding) {
    case "utf8": {
      const lone = findLoneSurrogate(text);
      if (lone >= 0) {
        return {
          ok: false,
          index: lone,
          message: `The text has an unpaired surrogate at position ${lone + 1}; it cannot be UTF-8.`,
        };
      }
      return { ok: true, bytes: new TextEncoder().encode(applyEol(normalizeEol(text), eol)) };
    }
    case "latin1":
      return latin1ToBytes(applyEol(normalizeEol(text), eol));
    case "hex":
      return hexToBytes(text);
    case "base64":
      return base64ToBytes(text);
  }
}

export type InputView =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "readonly"; readonly reason: "too-large" | "invalid-utf8" };

/** How the input pane shows `bytes` in `encoding`: an editable text, or a read-only hex summary. */
export function inputView(bytes: Uint8Array, encoding: EncodingName): InputView {
  if (bytes.length > EDIT_LIMIT_BYTES) return { kind: "readonly", reason: "too-large" };
  const r = bytesToText(bytes, encoding);
  return r.ok ? { kind: "text", text: r.text } : { kind: "readonly", reason: "invalid-utf8" };
}

// ---- statistics ----------------------------------------------------------------------------------

/** Shannon entropy in bits per byte (0 for empty input, at most 8). */
export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < bytes.length; i++)
    counts[bytes[i] as number] = (counts[bytes[i] as number] as number) + 1;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / bytes.length;
    h -= p * Math.log2(p);
  }
  return Math.max(0, h);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

// ---- hex dump ------------------------------------------------------------------------------------

export const HEX_DUMP_WIDTH = 16;

export interface HexRow {
  /** Byte offset of the row, 8 hex digits. */
  readonly offset: string;
  /** Hex of the row's bytes, padded to a full row, with an extra gap after 8 bytes. */
  readonly hex: string;
  /** Printable ASCII, `.` for everything else. */
  readonly ascii: string;
}

export function hexRowCount(length: number, width = HEX_DUMP_WIDTH): number {
  return Math.ceil(length / width);
}

/** Rows `first` .. `first + count - 1` of the dump of `bytes` (clamped to the data). */
export function hexDumpRows(
  bytes: Uint8Array,
  first: number,
  count: number,
  width = HEX_DUMP_WIDTH,
): HexRow[] {
  const rows: HexRow[] = [];
  const last = Math.min(hexRowCount(bytes.length, width), first + count);
  for (let r = Math.max(0, first); r < last; r++) {
    const start = r * width;
    let hex = "";
    let ascii = "";
    for (let i = 0; i < width; i++) {
      if (i === 8) hex += " ";
      if (start + i < bytes.length) {
        const b = bytes[start + i] as number;
        hex += (HEX[b >> 4] as string) + (HEX[b & 15] as string) + " ";
        ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
      } else {
        hex += "   ";
      }
    }
    rows.push({
      offset: start.toString(16).padStart(8, "0"),
      hex: hex.trimEnd().padEnd(width * 3),
      ascii,
    });
  }
  return rows;
}

/** The whole dump as text (offset, hex, ASCII per line), for copying small outputs and for tests. */
export function hexDumpText(bytes: Uint8Array): string {
  return hexDumpRows(bytes, 0, hexRowCount(bytes.length))
    .map((r) => `${r.offset}  ${r.hex} |${r.ascii}|`)
    .join("\n");
}
