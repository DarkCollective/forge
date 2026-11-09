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
/** FL literal rendering of parameter values (RECIPES.md section 5.2). */
import type { ParamSpec } from "@forge/lang";
import { hexDecode, normaliseEncodedValue } from "./encoding.js";
import type { Encoded, ParamValue } from "./types.js";

const HEX = "0123456789abcdef";

/**
 * An FL string literal: `\` is `\\`, `"` is `\"`, U+0000 `\0`, LF `\n`, CR `\r`, tab `\t`, every other C0 and
 * C1 control character `\xHH`, anything else as itself. The result never contains a raw line break.
 */
export function stringLiteral(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i] as string;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (c === 0x00) out += "\\0";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
      out += `\\x${HEX[c >> 4] as string}${HEX[c & 15] as string}`;
    } else out += ch;
  }
  return out + '"';
}

/** A JSON string literal (RFC 8259) in which only `"`, `\` and C0 controls are escaped. */
export function jsonStringLiteral(s: string): string {
  return JSON.stringify(s);
}

/** `#[ de ad ]`; the empty array is `#[ ]`. */
export function bytesLiteral(bytes: Uint8Array): string {
  let out = "#[";
  for (const b of bytes) out += ` ${HEX[b >> 4] as string}${HEX[b & 15] as string}`;
  return out + " ]";
}

/** A float literal: `String(x)`, with `.0` appended when it has neither `.` nor `e`; negative zero is `-0.0`. */
export function floatLiteral(x: number): string {
  if (Object.is(x, -0)) return "-0.0";
  const s = String(x);
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

/** Decimal digits, with `-` for negatives. A decimal string prints as it is. */
export function intLiteral(v: number | string): string {
  if (typeof v === "string") return v;
  return Number.isSafeInteger(v) ? String(v === 0 ? 0 : v) : BigInt(v).toString();
}

/** By `enc`: a string, `#[ ... ]`, or a string followed by `recipe:latin1` / `recipe:base64`. */
export function encodedLiteral(e: Encoded): string {
  switch (e.enc) {
    case "utf8":
      return stringLiteral(e.value);
    case "hex":
      return bytesLiteral(hexDecode(e.value) ?? new Uint8Array(0));
    case "latin1":
      return `${stringLiteral(e.value)} recipe:latin1`;
    case "base64":
      return `${stringLiteral(normaliseEncodedValue(e.value, "base64"))} recipe:base64`;
  }
}

/** The literal group of one parameter value, by the parameter's type. */
export function paramLiteral(spec: ParamSpec, value: ParamValue): string {
  switch (spec.type) {
    case "int":
      return intLiteral(value as number | string);
    case "num":
      return floatLiteral(value as number);
    case "number":
      return Number.isInteger(value) ? intLiteral(value as number) : floatLiteral(value as number);
    case "bool":
      return value === true ? "true" : "false";
    case "bytes":
      return bytesLiteral(hexDecode(value as string) ?? new Uint8Array(0));
    case "toggle":
    case "key":
      return encodedLiteral(value as Encoded);
    default:
      // str, choice, regex, charset
      return stringLiteral(String(value));
  }
}
