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

/**
 * Validation of the discovery clauses `use-when` and `link` (LANGUAGE-0.2.md section 1). Pure
 * functions: each returns `undefined` when the value is acceptable, otherwise the reason text.
 */

import { cpLength } from "./values.js";

export const USE_WHEN_MAX = 160;
export const LINK_URL_MAX = 300;
export const LINK_LABEL_MAX = 80;
export const LINKS_MAX = 8;

// eslint-disable-next-line no-control-regex
const C0 = /[\u0000-\u001f]/;

/** Plain one-line text: no C0 control character (this includes U+000A and U+000D). */
function oneLine(text: string, what: string): string | undefined {
  return C0.test(text) ? `${what} must be a single line without control characters` : undefined;
}

/** The reason `use-when` text is refused, or undefined. */
export function checkUseWhen(text: string): string | undefined {
  const line = oneLine(text, "use-when");
  if (line !== undefined) return line;
  if (/^\s|\s$/u.test(text)) return "use-when must not start or end with a space";
  if (cpLength(text) > USE_WHEN_MAX) return `use-when is longer than ${USE_WHEN_MAX} code points`;
  return undefined;
}

/** The reason a link label is refused, or undefined. */
export function checkLinkLabel(label: string): string | undefined {
  const line = oneLine(label, "link label");
  if (line !== undefined) return line;
  if (cpLength(label) > LINK_LABEL_MAX) {
    return `link label is longer than ${LINK_LABEL_MAX} code points`;
  }
  return undefined;
}

const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TAIL = /^[/?#](?:[A-Za-z0-9\-._~:/?#@!$&'()*+,;=]|%[0-9A-Fa-f]{2})*$/;

/** The reason a link URL is refused (grammar of section 1), or undefined. */
export function checkLinkUrl(url: string): string | undefined {
  if (cpLength(url) > LINK_URL_MAX) return `link URL is longer than ${LINK_URL_MAX} code points`;
  if (!url.startsWith("https://")) return "link URL must start with https://";
  const rest = url.slice("https://".length);
  const cut = rest.search(/[/?#]/);
  const authority = cut < 0 ? rest : rest.slice(0, cut);
  const tail = cut < 0 ? "" : rest.slice(cut);
  const colon = authority.indexOf(":");
  const host = colon < 0 ? authority : authority.slice(0, colon);
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      return "link URL has a bad port";
    }
  }
  const labels = host.split(".");
  if (labels.length < 2) return "link URL host needs at least two labels";
  if (!labels.every((l) => HOST_LABEL.test(l))) return "link URL has a bad host";
  if (!/[A-Za-z]/.test(labels[labels.length - 1] as string)) {
    return "link URL host must end in a label with a letter";
  }
  if (tail !== "" && !TAIL.test(tail)) return "link URL has a character that is not allowed";
  return undefined;
}
