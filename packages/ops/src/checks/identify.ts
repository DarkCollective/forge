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
 * Data identification (WP 6.23a): what the data is, as specifically as a bounded look can say, so the
 * pane can show what it sees beside what an operation expects. Pure: no operation is run, nothing is
 * searched, only the 4 KiB prefix is parsed, and the whole-data UTF-8 result (`view.utf8Validity`) is
 * shared with the checks so the data is decoded once. Never throws.
 *
 * API:
 *   identifyData(bytesOrView)   `{ id, name, family, certainty }` or `null` (empty or unidentified data).
 *                               Pass the `CheckView` of the data when the checks run on it too.
 *   GENERIC_IDS                 the ids of the generic kinds; the signature ids are `SIGNATURE_IDS`
 *                               (src/filetype-sigs.ts). `pem` and `xml` are in both: the table row and the
 *                               generic kind are the same thing, the generic test adds the label or the
 *                               parse.
 *
 * Fields:
 *   id        a stable lower-kebab id: a signature's table id, or one of `GENERIC_IDS`.
 *   name      the display name: the table's `displayName` for a signature; "PEM data (CERTIFICATE)" for
 *             PEM; "JSON text", "XML document", "Base64 text", "hex text"; "UTF-8 text" and "ASCII text"
 *             with ", CRLF line endings" (or LF, CR) when the prefix's line breaks are all of one kind;
 *             "random-looking bytes".
 *   family    the general kind when the match is a refinement, else the id itself. The rule: when several
 *             non-weak table rows match, the most specific one (the most fixed bits in its magic) is the
 *             id and the least specific other one is the family, so an OOXML file is `ooxml` in family
 *             `zip` and a JAR is `jar` in family `zip`; a plain signature match has family equal to its
 *             id, and so does every generic kind except `ascii-text`, whose family is `utf8-text`.
 *   certainty "high": a non-weak signature, a complete parse, long enough Base64 or hex, valid text.
 *             "medium": a prefix that is consistent so far but cut by the 4 KiB limit, text whose
 *             validity is unknown (over `UTF8_WHOLE_CAP`), Base64 or hex that is only plausible.
 *             "low": a weak signature, Base64 or hex short enough to be a word or a number
 *             ("hello1", "deadbeef"), random-looking bytes.
 *
 * Order, most specific first: (1) a non-weak signature at offset 0 (a refinement beats its parent);
 * (2) PEM, JSON, XML, hex, Base64; (3) UTF-8 text (ASCII text when the whole data is ASCII); (4) a weak
 * signature at offset 0, low certainty; (5) high-entropy data, low certainty.
 */
import { FILE_SIGNATURES } from "../filetype-sigs.js";
import type { FileSig } from "../filetype-sigs.js";
import { matchesAt } from "../filetype-match.js";
import { CheckView, dataView } from "./data.js";

export type Certainty = "high" | "medium" | "low";

export interface Identification {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly certainty: Certainty;
}

/** The ids of the generic (non-table) kinds, for WP 6.32's `magic-format` choice. */
export const GENERIC_IDS: readonly string[] = [
  "pem",
  "json",
  "xml",
  "base64",
  "hex",
  "utf8-text",
  "ascii-text",
  "random-bytes",
];

/** Entropy (bits per byte) at and above which a prefix of at least `RANDOM_MIN_BYTES` looks random. */
const RANDOM_MIN_ENTROPY = 7.0;
const RANDOM_MIN_BYTES = 256;
/** The share of printable code points at and above which valid UTF-8 counts as text. */
const TEXT_MIN_PRINTABLE = 0.95;
/** Base64 and hex shorter than this many characters are ambiguous with a word or a number. */
const ENCODED_MIN_CHARS = 16;
const MAX_JSON_DEPTH = 64;

function result(id: string, name: string, family: string, certainty: Certainty): Identification {
  return { id, name, family, certainty };
}

/** A cut prefix cannot be fully sure: high becomes medium. */
function down(c: Certainty, truncated: boolean): Certainty {
  return truncated && c === "high" ? "medium" : c;
}

// ---- signatures ----

function popcount(n: number): number {
  let c = 0;
  for (let v = n; v > 0; v >>= 1) c += v & 1;
  return c;
}

const SPECIFICITY = new Map<FileSig, number>();
for (const sig of FILE_SIGNATURES) {
  let bits = 0;
  for (const p of sig.parts) for (const m of p.mask) bits += popcount(m);
  SPECIFICITY.set(sig, bits);
}

const BOM = new RegExp("^\\uFEFF");
const PEM_LABEL = /^-----BEGIN ([A-Z0-9][A-Z0-9 ]*)-----/;

function pemName(view: CheckView): string {
  const m = PEM_LABEL.exec(view.prefixText.replace(BOM, "").trimStart());
  return m === null ? "PEM data" : `PEM data (${m[1]})`;
}

function bySignature(view: CheckView): Identification | null {
  const hits: FileSig[] = [];
  for (const sig of FILE_SIGNATURES) {
    if (!sig.weak && matchesAt(view.bytes, 0, sig)) hits.push(sig);
  }
  if (hits.length === 0) return null;
  const spec = (s: FileSig): number => SPECIFICITY.get(s) as number;
  let best = hits[0] as FileSig;
  let least = best;
  for (const h of hits) {
    if (spec(h) > spec(best)) best = h;
    if (spec(h) < spec(least)) least = h;
  }
  const name = best.id === "pem" ? pemName(view) : best.displayName;
  return result(best.id, name, least.id, "high");
}

function byWeakSignature(view: CheckView): Identification | null {
  let best: FileSig | null = null;
  for (const sig of FILE_SIGNATURES) {
    if (sig.weak && matchesAt(view.bytes, 0, sig)) {
      if (best === null || (SPECIFICITY.get(sig) as number) > (SPECIFICITY.get(best) as number))
        best = sig;
    }
  }
  return best === null ? null : result(best.id, best.displayName, best.id, "low");
}

// ---- JSON: a bounded recursive-descent check of the prefix ----

type Scan = "ok" | "incomplete" | "bad";

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;

class JsonScanner {
  i = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  ws(): void {
    for (;;) {
      const c = this.s.charCodeAt(this.i);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.i++;
      else return;
    }
  }

  value(depth: number): Scan {
    if (depth > MAX_JSON_DEPTH) return "bad";
    this.ws();
    if (this.i >= this.s.length) return "incomplete";
    const c = this.s[this.i] as string;
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return this.string();
    if (c === "-" || (c >= "0" && c <= "9")) return this.number();
    return this.word();
  }

  word(): Scan {
    for (const w of ["true", "false", "null"]) {
      if (this.s.startsWith(w, this.i)) {
        this.i += w.length;
        return "ok";
      }
      const rest = this.s.slice(this.i);
      if (rest.length < w.length && w.startsWith(rest)) {
        this.i = this.s.length;
        return "incomplete";
      }
    }
    return "bad";
  }

  number(): Scan {
    const m = NUMBER.exec(this.s.slice(this.i, this.i + 400));
    if (m === null) return this.i + 1 >= this.s.length ? "incomplete" : "bad";
    this.i += m[0].length;
    return this.i >= this.s.length ? "incomplete" : "ok";
  }

  string(): Scan {
    this.i++;
    for (;;) {
      if (this.i >= this.s.length) return "incomplete";
      const c = this.s.charCodeAt(this.i);
      if (c === 0x22) {
        this.i++;
        return "ok";
      }
      if (c < 0x20) return "bad";
      if (c === 0x5c) {
        const e = this.s[this.i + 1];
        if (e === undefined) return "incomplete";
        if (e === "u") {
          const h = this.s.slice(this.i + 2, this.i + 6);
          if (!/^[0-9a-fA-F]*$/.test(h)) return "bad";
          if (h.length < 4) return "incomplete";
          this.i += 6;
        } else if ('"\\/bfnrt'.includes(e)) this.i += 2;
        else return "bad";
      } else this.i++;
    }
  }

  array(depth: number): Scan {
    this.i++;
    this.ws();
    if (this.i >= this.s.length) return "incomplete";
    if (this.s[this.i] === "]") {
      this.i++;
      return "ok";
    }
    for (;;) {
      const v = this.value(depth + 1);
      if (v !== "ok") return v;
      this.ws();
      if (this.i >= this.s.length) return "incomplete";
      const c = this.s[this.i];
      this.i++;
      if (c === "]") return "ok";
      if (c !== ",") return "bad";
    }
  }

  object(depth: number): Scan {
    this.i++;
    this.ws();
    if (this.i >= this.s.length) return "incomplete";
    if (this.s[this.i] === "}") {
      this.i++;
      return "ok";
    }
    for (;;) {
      this.ws();
      if (this.i >= this.s.length) return "incomplete";
      if (this.s[this.i] !== '"') return "bad";
      const k = this.string();
      if (k !== "ok") return k;
      this.ws();
      if (this.i >= this.s.length) return "incomplete";
      if (this.s[this.i] !== ":") return "bad";
      this.i++;
      const v = this.value(depth + 1);
      if (v !== "ok") return v;
      this.ws();
      if (this.i >= this.s.length) return "incomplete";
      const c = this.s[this.i];
      this.i++;
      if (c === "}") return "ok";
      if (c !== ",") return "bad";
    }
  }
}

function byJson(text: string, truncated: boolean): Identification | null {
  const first = text[0];
  if (first !== "{" && first !== "[") return null;
  const sc = new JsonScanner(text);
  const r = sc.value(0);
  if (r === "ok") {
    sc.ws();
    // A complete value followed by more data is not JSON, whether or not the prefix was cut.
    if (sc.i < text.length) return null;
    return result("json", "JSON text", "json", down("high", truncated));
  }
  if (r === "incomplete" && truncated) return result("json", "JSON text", "json", "medium");
  return null;
}

// ---- XML: a bounded tag scanner over the prefix ----

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;
const SPACE = /\s/;

function byXml(s: string, truncated: boolean): Identification | null {
  let i = 0;
  const stack: string[] = [];
  let rootClosed = false;
  let sawRoot = false;
  const end = s.length;

  // The prefix ended inside a construct: consistent so far, if it was cut.
  const cut = (): Identification | null =>
    truncated && sawRoot ? result("xml", "XML document", "xml", "medium") : null;

  const skipTo = (token: string): boolean => {
    const j = s.indexOf(token, i);
    if (j < 0) return false;
    i = j + token.length;
    return true;
  };

  while (i < end) {
    const c = s[i] as string;
    if (c !== "<") {
      if (SPACE.test(c)) {
        i++;
        continue;
      }
      if (stack.length === 0) return null; // text outside the root
      const j = s.indexOf("<", i);
      if (j < 0) {
        i = end;
        break;
      }
      i = j;
      continue;
    }
    if (s.startsWith("<?", i)) {
      if (!skipTo("?>")) return truncated && (sawRoot || s.startsWith("<?xml")) ? xmlCut() : null;
      continue;
    }
    if (s.startsWith("<!--", i)) {
      if (!skipTo("-->")) return truncated && sawRoot ? xmlCut() : null;
      continue;
    }
    if (s.startsWith("<![CDATA[", i)) {
      if (stack.length === 0) return null;
      if (!skipTo("]]>")) return cut();
      continue;
    }
    if (s.startsWith("<!", i)) {
      if (sawRoot) return null;
      // A doctype: skip to its closing ">" (an internal subset in brackets may contain ">").
      let depth = 0;
      let k = i + 2;
      for (; k < end; k++) {
        const d = s[k];
        if (d === "[") depth++;
        else if (d === "]") depth--;
        else if (d === ">" && depth <= 0) break;
      }
      if (k >= end) return truncated && s.startsWith("<!DOCTYPE", i) ? xmlCut() : null;
      i = k + 1;
      continue;
    }
    if (s.startsWith("</", i)) {
      let k = i + 2;
      while (k < end && NAME_CHAR.test(s[k] as string)) k++;
      const name = s.slice(i + 2, k);
      while (k < end && SPACE.test(s[k] as string)) k++;
      if (k >= end) return cut();
      if (s[k] !== ">" || name === "" || stack.pop() !== name) return null;
      i = k + 1;
      if (stack.length === 0) rootClosed = true;
      continue;
    }
    // A start tag.
    if (rootClosed) return null;
    let k = i + 1;
    if (k >= end) return cut();
    if (!NAME_START.test(s[k] as string)) return null;
    while (k < end && NAME_CHAR.test(s[k] as string)) k++;
    const name = s.slice(i + 1, k);
    sawRoot = true;
    for (;;) {
      while (k < end && SPACE.test(s[k] as string)) k++;
      if (k >= end) return cut();
      const d = s[k] as string;
      if (d === ">") {
        stack.push(name);
        i = k + 1;
        break;
      }
      if (d === "/") {
        if (k + 1 >= end) return cut();
        if (s[k + 1] !== ">") return null;
        i = k + 2;
        if (stack.length === 0) rootClosed = true;
        break;
      }
      if (!NAME_START.test(d)) return null;
      while (k < end && NAME_CHAR.test(s[k] as string)) k++;
      while (k < end && SPACE.test(s[k] as string)) k++;
      if (k >= end) return cut();
      if (s[k] !== "=") return null;
      k++;
      while (k < end && SPACE.test(s[k] as string)) k++;
      if (k >= end) return cut();
      const q = s[k] as string;
      if (q !== '"' && q !== "'") return null;
      const close = s.indexOf(q, k + 1);
      if (close < 0) return cut();
      if (s.slice(k + 1, close).includes("<")) return null;
      k = close + 1;
    }
  }
  if (!sawRoot) return truncated && /^\s*<\?xml/.test(s) ? xmlCut() : null;
  if (rootClosed && stack.length === 0)
    return result("xml", "XML document", "xml", down("high", truncated));
  return cut();
}

function xmlCut(): Identification {
  return result("xml", "XML document", "xml", "medium");
}

// ---- hex and Base64 ----

function byHex(text: string, truncated: boolean): Identification | null {
  const t = text.replace(/\r?\n$/, "");
  if (!/^[0-9a-fA-F]+$/.test(t)) return null;
  if (!truncated && t.length % 2 !== 0) return null;
  let c: Certainty;
  if (t.length < ENCODED_MIN_CHARS) c = "low";
  else if (/^[0-9]+$/.test(t)) c = "medium";
  else c = "high";
  return result("hex", "hex text", "hex", down(c, truncated));
}

function byBase64(text: string, truncated: boolean): Identification | null {
  const t = text.replace(/\r?\n/g, "");
  const m = /^([A-Za-z0-9+/]+|[A-Za-z0-9\-_]+)(={0,2})$/.exec(t);
  if (m === null) return null;
  const body = m[1] as string;
  const pad = (m[2] as string).length;
  if (pad > 0 && truncated) return null;
  const len = body.length + pad;
  if (!truncated && (pad > 0 ? len % 4 !== 0 : len % 4 === 1)) return null;
  const urlSafe = /[-_]/.test(body);
  let c: Certainty;
  if (len < ENCODED_MIN_CHARS) c = "low";
  else if (
    pad > 0 ||
    /[+/\-_]/.test(body) ||
    (/[a-z]/.test(body) && /[A-Z]/.test(body) && /[0-9]/.test(body))
  )
    c = "high";
  else c = "medium";
  return result(
    "base64",
    urlSafe ? "Base64 text (URL-safe)" : "Base64 text",
    "base64",
    down(c, truncated),
  );
}

// ---- text ----

function lineEndings(text: string): string {
  let crlf = 0;
  let lf = 0;
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
  const kinds = (crlf > 0 ? 1 : 0) + (lf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
  if (kinds !== 1) return "";
  return crlf > 0 ? ", CRLF line endings" : lf > 0 ? ", LF line endings" : ", CR line endings";
}

function isAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if ((bytes[i] as number) >= 0x80) return false;
  return true;
}

function byText(view: CheckView): Identification | null {
  const validity = view.utf8Validity;
  if (validity === "invalid") return null;
  if (view.printableShare < TEXT_MIN_PRINTABLE) return null;
  const note = lineEndings(view.prefixText);
  const certainty: Certainty = validity === "valid" ? "high" : "medium";
  if (!view.truncated && validity === "valid" && isAscii(view.prefix))
    return result("ascii-text", `ASCII text${note}`, "utf8-text", certainty);
  return result("utf8-text", `UTF-8 text${note}`, "utf8-text", certainty);
}

// ---- entry ----

function identifyView(view: CheckView): Identification | null {
  if (view.bytes.length === 0) return null;
  const sig = bySignature(view);
  if (sig !== null) return sig;

  if (view.utf8Validity !== "invalid") {
    const text = view.prefixText.replace(BOM, "");
    const lead = text.trimStart();
    if (PEM_LABEL.test(lead)) return result("pem", pemName(view), "pem", "high");
    const json = byJson(lead, view.truncated);
    if (json !== null) return json;
    const xml = byXml(lead, view.truncated);
    if (xml !== null) return xml;
    const hex = byHex(text, view.truncated);
    if (hex !== null) return hex;
    const b64 = byBase64(text, view.truncated);
    if (b64 !== null) return b64;
    const t = byText(view);
    if (t !== null) return t;
  }

  const weak = byWeakSignature(view);
  if (weak !== null) return weak;

  if (view.prefix.length >= RANDOM_MIN_BYTES && view.entropy >= RANDOM_MIN_ENTROPY)
    return result("random-bytes", "random-looking bytes", "random-bytes", "low");
  return null;
}

/** What `bytesOrView` is, as specifically as a bounded look says; see the header comment. */
export function identifyData(bytesOrView: Uint8Array | CheckView): Identification | null {
  try {
    return identifyView(bytesOrView instanceof CheckView ? bytesOrView : dataView(bytesOrView));
  } catch {
    return null;
  }
}
