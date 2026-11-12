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
// The help document (examples, "use when", links, inverses) of the operations pane (WP 6.13). It is
// a lazily loaded document: nothing here runs, and nothing is imported statically, until the user
// first opens help. Load once, cache, index by qname; a failed load is not cached, so "Try again"
// really tries again.
//
// The catalogue-version rule. `help.catalogue` is the version of the catalogue the document was
// built against. The catalogue the pane shows can differ from it for one benign reason: the user has
// words (vocabulary `user`), which change the version of the whole catalogue but not one bundled op.
// So:
//   - versions equal: every op of the document that the catalogue has is used;
//   - versions differ and the catalogue has no user words: the document belongs to another build, so
//     it is ignored altogether (wrong examples are worse than none);
//   - versions differ and the catalogue has user words: the bundled catalogue's own version is read
//     (the same static file the app loaded at start, normally from the HTTP cache). If it equals
//     `help.catalogue`, the document is used for every op that is not a user word; if not, or if it
//     cannot be read, the document is ignored.
// A user word never gets help from the document, whatever its name.
import type { Catalogue, HelpDoc, HelpOp } from "@forge/ops";

export type { HelpDoc, HelpOp };

/** Help for the ops of one catalogue. */
export interface HelpIndex {
  /** The help of an op, or undefined when the document has nothing for it. */
  get(qname: string): HelpOp | undefined;
  readonly size: number;
}

export const EMPTY_HELP: HelpIndex = { get: () => undefined, size: 0 };

export type HelpState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly index: HelpIndex }
  | { readonly status: "failed"; readonly message: string };

/** The shape check for data that came over the network; the build validates the file, this guards the client. */
export function isHelpDoc(value: unknown): value is HelpDoc {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Partial<HelpDoc>;
  return (
    doc.format === 1 &&
    typeof doc.catalogue === "string" &&
    Array.isArray(doc.ops) &&
    doc.ops.every(
      (op) =>
        typeof op === "object" &&
        op !== null &&
        typeof op.qname === "string" &&
        Array.isArray(op.links) &&
        Array.isArray(op.examples),
    )
  );
}

export type Verdict = "all" | "bundled" | "none";

/** What part of the document applies to `catalogue`, given the version of the bundled catalogue if it is needed. */
export function judge(
  doc: HelpDoc,
  catalogue: Pick<Catalogue, "version" | "ops">,
  bundledVersion: string | null,
): Verdict {
  if (doc.catalogue === catalogue.version) return "all";
  if (!catalogue.ops.some((op) => op.vocab === "user")) return "none";
  return bundledVersion !== null && bundledVersion === doc.catalogue ? "bundled" : "none";
}

/** Index the document for a catalogue: only ops the catalogue has, and no user words. */
export function indexHelp(
  doc: HelpDoc,
  catalogue: Pick<Catalogue, "ops">,
  verdict: Verdict,
): HelpIndex {
  if (verdict === "none") return EMPTY_HELP;
  const known = new Map(catalogue.ops.map((op) => [op.qname, op]));
  const map = new Map<string, HelpOp>();
  for (const op of doc.ops) {
    const entry = known.get(op.qname);
    if (entry === undefined || entry.vocab === "user") continue;
    map.set(op.qname, op);
  }
  return { get: (qname) => map.get(qname), size: map.size };
}

export interface HelpSources {
  /** Loads the document (a dynamic import of `@forge/ops/help.json`). */
  readonly loadDoc: () => Promise<unknown>;
  /** The version of the bundled catalogue (only called when the rule above needs it). */
  readonly bundledVersion: () => Promise<string>;
}

export interface HelpLoader {
  /** Resolves to the index for `catalogue`; rejects when the document cannot be loaded. */
  load(catalogue: Catalogue): Promise<HelpIndex>;
  /** The index for `catalogue` if it has already been loaded, without loading anything. */
  cached(catalogue: Pick<Catalogue, "version">): HelpIndex | null;
}

/** A loader with a one-time, cached document load. The index is memoised per catalogue version. */
export function createHelpLoader(sources: HelpSources): HelpLoader {
  let docPromise: Promise<HelpDoc> | null = null;
  let bundled: Promise<string | null> | null = null;
  const indexes = new Map<string, Promise<HelpIndex>>();
  const resolved = new Map<string, HelpIndex>();

  const doc = (): Promise<HelpDoc> => {
    if (docPromise === null) {
      docPromise = sources.loadDoc().then((raw) => {
        if (!isHelpDoc(raw)) throw new Error("the help document has an unexpected format");
        return raw;
      });
      // A failure must not stick: the next call tries again.
      docPromise.catch(() => {
        docPromise = null;
      });
    }
    return docPromise;
  };

  const bundledVersion = (): Promise<string | null> => {
    if (bundled === null) {
      bundled = sources.bundledVersion().then(
        (v) => v,
        () => null,
      );
    }
    return bundled;
  };

  return {
    cached: (catalogue) => resolved.get(catalogue.version) ?? null,
    async load(catalogue) {
      const hit = indexes.get(catalogue.version);
      if (hit !== undefined) return hit;
      const pending = (async () => {
        const d = await doc();
        const needsBundled =
          d.catalogue !== catalogue.version && catalogue.ops.some((op) => op.vocab === "user");
        const verdict = judge(d, catalogue, needsBundled ? await bundledVersion() : null);
        return indexHelp(d, catalogue, verdict);
      })();
      indexes.set(catalogue.version, pending);
      pending.then(
        (index) => resolved.set(catalogue.version, index),
        () => indexes.delete(catalogue.version),
      );
      return pending;
    },
  };
}
