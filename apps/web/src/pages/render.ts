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
// The HTML of the reference pages (UI.md section 8.2): one page per operation and the index of all of
// them. Pure: given the catalogue, the help document and the share links, it returns strings. Every
// piece of data goes through `h` (html.ts), so it is escaped as text; the literal markup below is the only
// markup there is. The pages need no JavaScript.
import type { Catalogue, CatalogueOp, HelpExample, HelpOp } from "@forge/ops";
import { describeConstraint, describeDefault } from "../ops/help.js";
import { viewExpect, viewLink, viewParams, viewValue } from "../ops/help-view.js";
import type { ValueView } from "../ops/help-view.js";
import { empty, h, join } from "./html.js";
import type { Part, SafeHtml } from "./html.js";
import { INDEX_PATH, categoryId, opPath } from "./slug.js";

export const SITE_ORIGIN = "https://forge.darkcollective.com";

/** The text of the "no category" group of the index. */
export const NO_CATEGORY = "Other";

/** What the renderer knows besides the catalogue. */
export interface RenderData {
  readonly catalogue: Catalogue;
  /** Help by qname; an op without an entry has no help. */
  readonly help: ReadonlyMap<string, HelpOp>;
  /** Per qname, per example: the share fragment that loads it into the app, or null when it cannot be linked. */
  readonly shares: ReadonlyMap<string, readonly (string | null)[]>;
}

/** The part of a page that varies: it is put into the template by build.ts. */
export interface PageParts {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly body: SafeHtml;
}

const NAV: readonly { readonly href: string; readonly label: string }[] = [
  { href: "/ops/", label: "Operations" },
  { href: "/about/", label: "About" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/terms/", label: "Terms" },
  { href: "/security/", label: "Security" },
  { href: "/accessibility/", label: "Accessibility" },
];

function header(current: string | null): SafeHtml {
  return h`<a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="/">Forge</a>
        <nav class="site-nav" aria-label="Site">
          <ul>
            ${NAV.map((n) =>
              n.href === current
                ? h`<li><a href="${n.href}" aria-current="page">${n.label}</a></li>`
                : h`<li><a href="${n.href}">${n.label}</a></li>`,
            )}
          </ul>
        </nav>
        <a class="button" href="/">Open Forge</a>
      </div>
    </header>`;
}

const FOOTER: SafeHtml = h`<footer class="site-footer">
      <div class="site-footer__inner">
        <nav aria-label="Footer">
          <ul>
            <li><a href="/">Open Forge</a></li>
            ${NAV.map((n) => h`<li><a href="${n.href}">${n.label}</a></li>`)}
            <li><a href="https://github.com/DarkCollective/forge">GitHub repository</a></li>
          </ul>
        </nav>
        <p>© 2026 Darkcollective, LLC. Forge is licensed under Apache-2.0.</p>
      </div>
    </footer>`;

function shell(current: string | null, main: SafeHtml): SafeHtml {
  return h`${header(current)}

    <main id="main" class="page ref">
      ${main}
    </main>

    ${FOOTER}`;
}

/** The text a search result or a link preview shows: the use-when line, else the start of the description. */
export function describe(op: CatalogueOp, help: HelpOp | undefined): string {
  const text = (help?.useWhen ?? "").trim() || (op.doc ?? "").trim();
  if (text === "") return `Reference for the ${op.qname} operation in Forge.`;
  return text.length <= 300 ? text : `${text.slice(0, 297).trimEnd()}...`;
}

function category(op: CatalogueOp): string {
  return op.category === null || op.category.trim() === "" ? NO_CATEGORY : op.category;
}

function valueBlock(value: ValueView): SafeHtml {
  return h`<pre class="value">${value.empty ? "(empty)" : value.text}</pre>
              <p class="value-meta">Written as ${value.label}.${value.cut === null ? "" : ` ${value.cut}`}</p>
              ${value.reading === null ? empty : h`<p class="value-meta">Read as text: <code>${value.reading}</code></p>`}`;
}

function renderParamValue(value: ValueView): SafeHtml {
  const shown = value.empty ? "(empty)" : value.text;
  return h`<code>${shown}</code>${value.label === "text" && value.cut === null ? empty : h` <span class="value-meta">(${value.label}${value.cut === null ? "" : `, ${value.cut.toLowerCase()}`})</span>`}`;
}

function renderExpect(ex: HelpExample): SafeHtml {
  const view = viewExpect(ex.expect);
  switch (view.kind) {
    case "value":
      return valueBlock(view.value);
    case "error":
      return h`<p class="error-out">An error, code <code>${view.code}</code>.</p>`;
    default:
      return h`<pre class="value">${view.text}</pre>${view.cut === null ? empty : h`<p class="value-meta">${view.cut}</p>`}`;
  }
}

function renderExample(
  op: CatalogueOp,
  ex: HelpExample,
  index: number,
  fragment: string | null,
): SafeHtml {
  const id = `example-${index + 1}`;
  const params = viewParams(ex.params);
  const input = viewValue(ex.input.value, ex.input.enc);
  return h`<section class="example" aria-labelledby="${id}">
        <h3 id="${id}">${ex.title}</h3>
        ${ex.note === null ? empty : h`<p>${ex.note}</p>`}
        <dl>
          ${
            params.length === 0
              ? empty
              : h`<dt>Parameters</dt>
          <dd>
            <ul class="plain">
              ${params.map((p) => h`<li><code>${p.name}</code> = ${renderParamValue(p.value)}</li>`)}
            </ul>
          </dd>`
          }
          <dt>Input</dt>
          <dd>${valueBlock(input)}</dd>
          <dt>Result</dt>
          <dd>${renderExpect(ex)}</dd>
          ${ex.ref === null ? empty : h`<dt>Source</dt><dd>${ex.ref}</dd>`}
        </dl>
        ${
          fragment === null
            ? h`<p class="value-meta">This example is too large to open from a link.</p>`
            : h`<p><a class="button" href="/#${fragment}">Open in Forge<span class="sr-only"> (${op.qname}: ${ex.title})</span></a></p>`
        }
      </section>`;
}

function opLink(byQname: ReadonlyMap<string, CatalogueOp>, qname: string): SafeHtml {
  const target = byQname.get(qname);
  return target === undefined
    ? h`<code>${qname}</code>`
    : h`<a href="${opPath(target)}"><code>${qname}</code></a>`;
}

function renderParams(op: CatalogueOp, help: HelpOp | undefined): SafeHtml {
  if (op.params.length === 0) return h`<p>This operation has no parameters.</p>`;
  return h`<dl class="params">
        ${op.params.map((p) => {
          const fallback = p.required ? null : describeDefault(p.default);
          const constraint = describeConstraint(p.constraint);
          const optionDocs = help?.optionDocs?.[p.name] ?? {};
          return h`<dt id="param-${p.name}"><code>${p.name}</code> <span class="type">${p.type}</span></dt>
          <dd>
            ${p.doc === null || p.doc === undefined || p.doc === "" ? empty : h`<p>${p.doc}</p>`}
            <p class="value-meta">${p.required ? "Required." : fallback === null ? "Optional." : `Default ${fallback}.`}${constraint.length === 0 ? "" : ` Allowed: ${constraint.join("; ")}.`}</p>
            ${
              p.options === undefined || p.options.length === 0
                ? empty
                : h`<ul class="plain options">
              ${p.options.map((o) => {
                const text = optionDocs[o];
                return h`<li><code>${o}</code>${text === undefined ? empty : h`: ${text}`}</li>`;
              })}
            </ul>`
            }
          </dd>`;
        })}
      </dl>`;
}

function renderLinks(help: HelpOp): SafeHtml {
  const links = help.links.flatMap((l) => {
    const view = viewLink(l);
    return view === null ? [] : [view];
  });
  if (links.length === 0) return empty;
  return h`<h2 id="links">Further reading</h2>
      <p class="value-meta">These links leave Forge and open other sites.</p>
      <ul class="links">
        ${links.map(
          (l) =>
            h`<li><a href="${l.href}" rel="noopener noreferrer">${l.label}</a> <span class="ext">(external site: ${l.host})</span></li>`,
        )}
      </ul>`;
}

/** The page of one operation. */
export function renderOpPage(op: CatalogueOp, data: RenderData): PageParts {
  const help = data.help.get(op.qname);
  const byQname = new Map(data.catalogue.ops.map((o) => [o.qname, o]));
  const fragments = data.shares.get(op.qname) ?? [];
  const cat = category(op);
  const examples = help?.examples ?? [];
  const sections: Part[] = [];
  sections.push(h`<nav aria-label="Breadcrumb" class="crumbs">
        <a href="${INDEX_PATH}">Operations</a> / <a href="${INDEX_PATH}#${categoryId(cat)}">${cat}</a>
      </nav>
      <h1><code>${op.qname}</code></h1>
      <p class="meta">${cat}. Input ${op.input}, output ${op.output}.</p>`);
  if (help?.useWhen) {
    sections.push(h`<h2 id="use-when">Use this when</h2>
      <p class="use-when">${help.useWhen}</p>`);
  }
  if (op.doc !== null && op.doc !== "") {
    sections.push(h`<h2 id="description">Description</h2>
      <p>${op.doc}</p>`);
  }
  sections.push(h`<h2 id="signature">Signature</h2>
      <p>The stack effect, as Forge writes it:</p>
      <pre class="value">${op.effect}</pre>`);
  sections.push(h`<h2 id="parameters">Parameters</h2>
      ${renderParams(op, help)}`);
  if (examples.length > 0) {
    sections.push(h`<h2 id="examples">Examples</h2>
      ${examples.map((ex, i) => renderExample(op, ex, i, fragments[i] ?? null))}`);
  }
  if (help?.inverse) {
    sections.push(h`<h2 id="inverse">Inverse</h2>
      <p>${opLink(byQname, help.inverse)} undoes this operation.</p>`);
  }
  if (op.seeAlso.length > 0) {
    sections.push(h`<h2 id="see-also">See also</h2>
      <ul class="plain">
        ${op.seeAlso.map((q) => h`<li>${opLink(byQname, q)}</li>`)}
      </ul>`);
  }
  if (op.aliases.length > 0) {
    sections.push(h`<h2 id="aliases">Aliases</h2>
      <p>Also searched for as ${join(
        op.aliases.map((a) => h`<code>${a}</code>`),
        ", ",
      )}.</p>`);
  }
  if (help !== undefined) sections.push(renderLinks(help));
  return {
    title: `${op.qname} operation | Forge`,
    description: describe(op, help),
    canonical: `${SITE_ORIGIN}${opPath(op)}`,
    body: shell(null, join(sections, "\n      ")),
  };
}

/** The index of all operations, grouped by category. */
export function renderIndexPage(data: RenderData): PageParts {
  const groups = new Map<string, CatalogueOp[]>();
  for (const op of data.catalogue.ops) {
    const key = category(op);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [op]);
    else list.push(op);
  }
  const names = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const total = data.catalogue.ops.length;
  const body = h`<h1>Operations</h1>
      <p class="lead">
        Every operation in Forge, with what it is for, how to set it up and worked examples you can
        open in the app. ${total} operations in ${names.length} categories.
      </p>
      <nav aria-label="Categories" class="categories">
        <ul class="plain">
          ${names.map((n) => h`<li><a href="#${categoryId(n)}">${n}</a> <span class="value-meta">(${groups.get(n)?.length ?? 0})</span></li>`)}
        </ul>
      </nav>
      ${names.map((n) => {
        const id = categoryId(n);
        const ops = (groups.get(n) ?? [])
          .slice()
          .sort((a, b) => (a.qname < b.qname ? -1 : a.qname > b.qname ? 1 : 0));
        return h`<section aria-labelledby="${id}">
        <h2 id="${id}">${n}</h2>
        <ul class="op-list">
          ${ops.map((op) => {
            const text = describe(op, data.help.get(op.qname));
            return h`<li><a href="${opPath(op)}"><code>${op.qname}</code></a><span class="op-list__text">${text}</span></li>`;
          })}
        </ul>
      </section>`;
      })}`;
  return {
    title: "Operations | Forge",
    description: `All ${total} operations in Forge, grouped by category, with what each is for and worked examples.`,
    canonical: `${SITE_ORIGIN}${INDEX_PATH}`,
    body: shell(INDEX_PATH, body),
  };
}
