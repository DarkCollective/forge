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
 * The shared view of one piece of data for the check evaluator (WP 6.23), and for the identification
 * of WP 6.23a, so the data is looked at once however many checks and identifications ask about it.
 *
 * API:
 *   dataView(bytes)       a `CheckView` of `bytes` (the bytes are not copied and must not change
 *                         while the view is in use). Pass the same view to every `evaluateChecks`,
 *                         `scoreChecks` and `identifyData` call on the same data.
 *   isCheckView(x)        true when `x` is a `CheckView`.
 *   view.bytes            the whole data.
 *   view.prefix           the first `CHECK_PREFIX_BYTES` bytes (a subarray; the whole data if shorter).
 *   view.truncated        true when the data is longer than the prefix.
 *   view.utf8Validity     "valid" | "invalid" | "unknown": strict UTF-8 over the WHOLE data;
 *                         "unknown" when the data is longer than `UTF8_WHOLE_CAP`. Computed on first
 *                         use, once. Empty data is "valid" here (a check treats empty data as unknown
 *                         before asking).
 *   view.prefixText       the prefix decoded as UTF-8, leniently (a bad byte becomes U+FFFD); a
 *                         multi-byte sequence cut by the end of a truncated prefix is dropped, not
 *                         replaced. Computed on first use.
 *   view.prefixLength     the number of code points of `prefixText`.
 *   view.entropy          Shannon entropy of the prefix bytes, bits per byte (0 for empty data).
 *   view.printableShare   the share (0 to 1) of the code points of `prefixText` that are printable
 *                         (see `isPrintableCodePoint`); 0 for empty data.
 *
 * Pure: no DOM, no Node API (`TextDecoder` is a standard global).
 */
import { CHECK_PREFIX_BYTES, UTF8_WHOLE_CAP } from "./limits.js";

export type Utf8Validity = "valid" | "invalid" | "unknown";

/**
 * Printable text (LANGUAGE.md section 5.9): graphic characters, space, tab and line breaks. ASCII
 * 0x20 to 0x7E, tab, LF and CR; above ASCII, every code point from U+00A0 except U+FFFD (what a bad
 * byte decodes to) and the noncharacters U+FFFE and U+FFFF. C1 controls (U+0080 to U+009F) are not
 * printable.
 */
export function isPrintableCodePoint(cp: number): boolean {
  if (cp < 0x80) return (cp >= 0x20 && cp < 0x7f) || cp === 9 || cp === 10 || cp === 13;
  return cp >= 0xa0 && cp !== 0xfffd && cp !== 0xfffe && cp !== 0xffff;
}

export class CheckView {
  readonly bytes: Uint8Array;
  readonly prefix: Uint8Array;
  readonly truncated: boolean;
  #validity: Utf8Validity | undefined;
  #text: string | undefined;
  #length: number | undefined;
  #entropy: number | undefined;
  #printable: number | undefined;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.truncated = bytes.length > CHECK_PREFIX_BYTES;
    this.prefix = this.truncated ? bytes.subarray(0, CHECK_PREFIX_BYTES) : bytes;
  }

  get utf8Validity(): Utf8Validity {
    if (this.#validity === undefined) {
      if (this.bytes.length > UTF8_WHOLE_CAP) this.#validity = "unknown";
      else {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(this.bytes);
          this.#validity = "valid";
        } catch {
          this.#validity = "invalid";
        }
      }
    }
    return this.#validity;
  }

  get prefixText(): string {
    if (this.#text === undefined) {
      this.#text = new TextDecoder("utf-8").decode(this.prefix, { stream: this.truncated });
    }
    return this.#text;
  }

  get prefixLength(): number {
    this.#stats();
    return this.#length as number;
  }

  get printableShare(): number {
    this.#stats();
    return this.#printable as number;
  }

  get entropy(): number {
    if (this.#entropy === undefined) {
      const p = this.prefix;
      if (p.length === 0) this.#entropy = 0;
      else {
        const counts = new Uint32Array(256);
        for (let i = 0; i < p.length; i++) counts[p[i] as number]!++;
        let h = 0;
        for (let i = 0; i < 256; i++) {
          const c = counts[i] as number;
          if (c > 0) {
            const q = c / p.length;
            h -= q * Math.log2(q);
          }
        }
        this.#entropy = h;
      }
    }
    return this.#entropy;
  }

  #stats(): void {
    if (this.#length !== undefined) return;
    const t = this.prefixText;
    let n = 0;
    let ok = 0;
    for (let i = 0; i < t.length; i++) {
      let cp = t.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < t.length) {
        const d = t.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          cp = (cp - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
          i++;
        }
      }
      n++;
      if (isPrintableCodePoint(cp)) ok++;
    }
    this.#length = n;
    this.#printable = n === 0 ? 0 : ok / n;
  }
}

/** The shared view of `bytes`; see the header comment for the API. */
export function dataView(bytes: Uint8Array): CheckView {
  return new CheckView(bytes);
}

export function isCheckView(x: unknown): x is CheckView {
  return x instanceof CheckView;
}
