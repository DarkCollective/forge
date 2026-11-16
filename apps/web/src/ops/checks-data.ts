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
// The content checks document (`checks.json`, WP 6.28) and the evaluator, loaded lazily together: nothing
// here runs, and nothing is imported statically, until the pane first asks. Load once, cache, index by
// qname; a failed load is not cached, so the next call tries again. Until it has loaded the pane shows the
// WP 6.21 result.
//
// The catalogue-version rule is the one of help.json (`judge` in help-data.ts, UI.md section 2.3): the
// document is used as is when `doc.catalogue` equals the catalogue's `version`; with user words and
// another version, the bundled catalogue's version decides; otherwise the document is ignored. A user word
// never gets checks from the document.
import type { Catalogue, ChecksDoc, ChecksOp } from "@forge/ops";
import type * as ChecksModule from "@forge/ops/checks";
import { judge } from "./help-data.js";
import type { Verdict } from "./help-data.js";

type Utf8Known = "valid" | "invalid" | "unknown";

/** The slice of `@forge/ops/checks` the pane uses, plus a way to seed a view with a known UTF-8 result. */
export interface Evaluator {
  readonly evaluateChecks: typeof ChecksModule.evaluateChecks;
  readonly expectedName: typeof ChecksModule.expectedName;
  readonly identifyData: typeof ChecksModule.identifyData;
  /** A shared view of `bytes` whose whole-data UTF-8 result is `utf8` when known (WP 6.21's, not decoded again). */
  readonly view: (bytes: Uint8Array, utf8: Utf8Known) => ChecksModule.CheckView;
}

/** Builds the evaluator from the module. The seeded view overrides only the `utf8Validity` getter. */
export function makeEvaluator(mod: typeof ChecksModule): Evaluator {
  class SeededView extends mod.CheckView {
    readonly #known: Utf8Known;
    constructor(bytes: Uint8Array, known: Utf8Known) {
      super(bytes);
      this.#known = known;
    }
    override get utf8Validity(): ChecksModule.Utf8Validity {
      return this.#known === "unknown" ? super.utf8Validity : this.#known;
    }
  }
  return {
    evaluateChecks: mod.evaluateChecks,
    expectedName: mod.expectedName,
    identifyData: mod.identifyData,
    view: (bytes, utf8) => new SeededView(bytes, utf8),
  };
}

/** The checks of the ops of one catalogue. */
export interface ChecksIndex {
  get(qname: string): ChecksOp | undefined;
  entries(): IterableIterator<[string, ChecksOp]>;
  readonly size: number;
}

export const EMPTY_CHECKS: ChecksIndex = {
  get: () => undefined,
  entries: () => new Map<string, ChecksOp>().entries(),
  size: 0,
};

/** What a successful load gives: the evaluator and the index for the catalogue. */
export interface ChecksReady {
  readonly evaluator: Evaluator;
  readonly index: ChecksIndex;
}

/** The shape check for data that came over the network; the build validates the file, this guards the client. */
export function isChecksDoc(value: unknown): value is ChecksDoc {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Partial<ChecksDoc>;
  if (doc.format !== 1 || typeof doc.catalogue !== "string") return false;
  if (typeof doc.ops !== "object" || doc.ops === null) return false;
  return Object.values(doc.ops).every(
    (op) => typeof op === "object" && op !== null && Array.isArray(op.checks),
  );
}

/** Index the document for a catalogue: only ops the catalogue has, and no user words. */
export function indexChecks(
  doc: ChecksDoc,
  catalogue: Pick<Catalogue, "ops">,
  verdict: Verdict,
): ChecksIndex {
  if (verdict === "none") return EMPTY_CHECKS;
  const known = new Map(catalogue.ops.map((op) => [op.qname, op]));
  const map = new Map<string, ChecksOp>();
  for (const [qname, entry] of Object.entries(doc.ops)) {
    const op = known.get(qname);
    if (op === undefined || op.vocab === "user") continue;
    map.set(qname, entry);
  }
  return { get: (qname) => map.get(qname), entries: () => map.entries(), size: map.size };
}

export interface ChecksSources {
  /** Loads the document (a dynamic import of `@forge/ops/checks.json`). */
  readonly loadDoc: () => Promise<unknown>;
  /** Loads the evaluator (a dynamic import of `@forge/ops/checks`). */
  readonly loadEvaluator: () => Promise<Evaluator>;
  /** The version of the bundled catalogue (only called when the rule needs it). */
  readonly bundledVersion: () => Promise<string>;
}

export interface ChecksLoader {
  /** Resolves for `catalogue`; rejects when the document or the evaluator cannot be loaded. */
  load(catalogue: Catalogue): Promise<ChecksReady>;
  /** The result for `catalogue` if it has already been loaded, without loading anything. */
  cached(catalogue: Pick<Catalogue, "version">): ChecksReady | null;
}

/** A loader with a one-time, cached load of the document and the evaluator. The index is memoised per catalogue version. */
export function createChecksLoader(sources: ChecksSources): ChecksLoader {
  let docPromise: Promise<ChecksDoc> | null = null;
  let evalPromise: Promise<Evaluator> | null = null;
  let bundled: Promise<string | null> | null = null;
  const indexes = new Map<string, Promise<ChecksReady>>();
  const resolved = new Map<string, ChecksReady>();

  const doc = (): Promise<ChecksDoc> => {
    if (docPromise === null) {
      docPromise = sources.loadDoc().then((raw) => {
        if (!isChecksDoc(raw)) throw new Error("the checks document has an unexpected format");
        return raw;
      });
      // A failure must not stick: the next call tries again.
      docPromise.catch(() => {
        docPromise = null;
      });
    }
    return docPromise;
  };

  const evaluator = (): Promise<Evaluator> => {
    if (evalPromise === null) {
      evalPromise = sources.loadEvaluator();
      evalPromise.catch(() => {
        evalPromise = null;
      });
    }
    return evalPromise;
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
      const pending = (async (): Promise<ChecksReady> => {
        const [d, ev] = await Promise.all([doc(), evaluator()]);
        const needsBundled =
          d.catalogue !== catalogue.version && catalogue.ops.some((op) => op.vocab === "user");
        const verdict = judge(d, catalogue, needsBundled ? await bundledVersion() : null);
        return { evaluator: ev, index: indexChecks(d, catalogue, verdict) };
      })();
      indexes.set(catalogue.version, pending);
      pending.then(
        (ready) => resolved.set(catalogue.version, ready),
        () => indexes.delete(catalogue.version),
      );
      return pending;
    },
  };
}
