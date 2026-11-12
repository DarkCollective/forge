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
// What the help dialog shows for the examples and links of the help document, as plain strings and
// plain data (WP 6.13). Pure: no DOM, no store. Nothing here is HTML (CSP rule 6); the component
// renders every string as text.
import type { Step } from "@forge/recipe";
import type { HelpExample, HelpLink } from "@forge/ops";
import { base64ToBytes, decodeUtf8Strict, hexToBytes, textToBytes } from "../io/codec.js";
import type { EncodingName } from "../io/codec.js";
import type { InputTab } from "../state/types.js";

/** Longest value shown in full, in characters; longer ones are cut and say so (Try it still loads all of it). */
export const SHOW_LIMIT = 480;
/** Longest byte string whose text reading is attempted for a hex or base64 value. */
const PREVIEW_LIMIT = 4096;

export interface ValueView {
  /** The value as text, control characters made visible, cut at SHOW_LIMIT. */
  readonly text: string;
  /** How the value is written: "text", "hex", "base64" or "latin1". */
  readonly label: string;
  /** "The first 480 of 2048 characters.", or null when nothing was cut. */
  readonly cut: string | null;
  /** For a hex or base64 value that is readable UTF-8 text: that text. Otherwise null. */
  readonly reading: string | null;
  readonly empty: boolean;
}

// C0 controls except line feed, DEL, C1 controls, line and paragraph separators, zero-width and
// direction marks, and the byte order mark: all shown as an escape so nothing is invisible or reorders text.
const HIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;

/** Make invisible characters visible: `\t`, `\r`, `\x00`, `\u202e`. Line feeds stay line feeds. */
export function showControls(text: string): string {
  return text.replace(HIDDEN, (c) => {
    if (c === "\t") return "\\t";
    if (c === "\r") return "\\r";
    const code = c.charCodeAt(0);
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

function cutAt(text: string): { text: string; cut: string | null } {
  const chars = [...text];
  if (chars.length <= SHOW_LIMIT) return { text, cut: null };
  return {
    text: chars.slice(0, SHOW_LIMIT).join(""),
    cut: `The first ${SHOW_LIMIT} of ${chars.length} characters.`,
  };
}

function plainReading(text: string): string | null {
  // eslint-disable-next-line no-control-regex
  return text !== "" && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(text) ? text : null;
}

/** An example's input, or an expected value, as it is shown. `enc` is the encoding the value is written in. */
export function viewValue(value: string, enc: string): ValueView {
  const shown = cutAt(showControls(value));
  const label = enc === "utf8" ? "text" : enc;
  let reading: string | null = null;
  if (enc !== "utf8" && value.length <= PREVIEW_LIMIT * 2) {
    const bytes =
      enc === "hex" ? hexToBytes(value) : enc === "base64" ? base64ToBytes(value) : null;
    if (bytes !== null && bytes.ok && bytes.bytes.length <= PREVIEW_LIMIT) {
      const text = decodeUtf8Strict(bytes.bytes);
      const readable = text === null ? null : plainReading(text);
      if (readable !== null) reading = cutAt(readable).text;
    }
  }
  return { text: shown.text, label, cut: shown.cut, reading, empty: value === "" };
}

export type ExpectView =
  | { readonly kind: "value"; readonly value: ValueView }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "json"; readonly text: string; readonly cut: string | null }
  | { readonly kind: "unknown"; readonly text: string; readonly cut: string | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The expected result of an example: text, an error code, or a list or record written as JSON. */
export function viewExpect(expect: unknown): ExpectView {
  if (isRecord(expect)) {
    if (typeof expect.value === "string" && typeof expect.enc === "string") {
      return { kind: "value", value: viewValue(expect.value, expect.enc) };
    }
    if (typeof expect.error === "string") return { kind: "error", code: expect.error };
    if ("json" in expect) {
      const shown = cutAt(showControls(JSON.stringify(expect.json, null, 2) ?? "null"));
      return { kind: "json", text: shown.text, cut: shown.cut };
    }
  }
  const shown = cutAt(showControls(JSON.stringify(expect, null, 2) ?? "null"));
  return { kind: "unknown", text: shown.text, cut: shown.cut };
}

export interface ParamLine {
  readonly name: string;
  readonly value: ValueView;
}

function paramText(value: unknown): { text: string; enc: string } {
  if (isRecord(value) && typeof value.value === "string" && typeof value.enc === "string") {
    return { text: value.value, enc: value.enc };
  }
  if (typeof value === "string") return { text: value, enc: "utf8" };
  return { text: JSON.stringify(value) ?? "null", enc: "utf8" };
}

/** The parameters of an example, one line each, in the order the document gives them. */
export function viewParams(params: Readonly<Record<string, unknown>>): ParamLine[] {
  return Object.entries(params).map(([name, v]) => {
    const { text, enc } = paramText(v);
    return { name, value: viewValue(text, enc) };
  });
}

export interface LinkView {
  readonly href: string;
  readonly host: string;
  /** The label, or the host when the link has none. */
  readonly label: string;
}

/** A link as an anchor needs it, or null when it is not a plain https URL (the build checks, the client checks again). */
export function viewLink(link: HelpLink): LinkView | null {
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.host === "") {
    return null;
  }
  const label = link.label !== null && link.label.trim() !== "" ? link.label : url.host;
  return { href: url.href, host: url.host, label };
}

// ---- Try it ---------------------------------------------------------------------------------------

/** The step an example runs: the op with the example's parameters. */
export function exampleStep(qname: string, example: Pick<HelpExample, "params">): Step {
  return Object.keys(example.params).length === 0
    ? { kind: "op", op: qname }
    : ({ kind: "op", op: qname, params: example.params } as unknown as Step);
}

export type BytesResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly encoding: EncodingName }
  | { readonly ok: false; readonly message: string };

const ENCODINGS: readonly string[] = ["utf8", "hex", "latin1", "base64"];

/** The example's input as bytes, and the encoding the input tab should show them in. */
export function exampleInput(example: Pick<HelpExample, "input">): BytesResult {
  const { value, enc } = example.input;
  if (!ENCODINGS.includes(enc)) return { ok: false, message: `unknown encoding ${enc}` };
  const encoding = enc as EncodingName;
  const r = textToBytes(value, encoding, "lf");
  return r.ok ? { ok: true, bytes: r.bytes, encoding } : { ok: false, message: r.message };
}

export type InputPlan =
  | { readonly kind: "fill"; readonly id: string }
  | { readonly kind: "select"; readonly id: string }
  | { readonly kind: "new"; readonly name: string };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Where an example's input goes. The user's input is never overwritten: an empty active tab is filled
 * (nothing to lose), a tab that already holds exactly this example is selected again, and anything else
 * gets a new tab.
 */
export function planInput(
  inputs: readonly Pick<InputTab, "id" | "name" | "bytes">[],
  activeId: string,
  name: string,
  bytes: Uint8Array,
): InputPlan {
  const active = inputs.find((t) => t.id === activeId);
  if (active !== undefined && active.bytes.length === 0) return { kind: "fill", id: active.id };
  const same = inputs.find((t) => t.name === name && sameBytes(t.bytes, bytes));
  if (same !== undefined) return { kind: "select", id: same.id };
  return { kind: "new", name };
}

/** The name of the input tab an example creates. */
export function exampleTabName(title: string): string {
  return `Example: ${title}`.slice(0, 80);
}
