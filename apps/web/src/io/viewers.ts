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

// The viewer registry and contract for extension values (UI-TOOLKIT.md section 1, TOOLKIT.md section 6.2).
//
// A viewer draws an `ext` output. It returns a DOM node built by script only (createElement, createTextNode,
// textContent: UI.md section 4 rule 6). A kind with no viewer, a viewer that is still loading, and a viewer
// that throws are all shown by the text fallback, so that the value is never hidden. This module holds no
// DOM of its own: the document is passed in, so that it is tested in node with a stand-in.
import type { OutputValue } from "@forge/worker";

export type ExtOutput = Extract<OutputValue, { readonly kind: "ext" }>;

/** Where a value is shown (UI-TOOLKIT.md section 1.1). */
export type ViewerPlace = "output" | "partial" | "paused" | "register";

export interface ViewerContext {
  readonly place: ViewerPlace;
  /** `ui.compact`. */
  readonly compact: boolean;
  /** Aborted when the node is removed: revoke object URLs, stop timers. */
  readonly signal: AbortSignal;
}

/** An op that turns the kind into bytes; it is offered by the "Convert to bytes" menu (section 1.5). */
export interface BytesOp {
  readonly op: string;
  readonly label: string;
}

/** What `download` returns: a file made from the value. */
export interface ViewerFile {
  readonly filename: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** An op that makes a kind out of data the kind does not take, offered in the hint of a red row (section 2.2). */
export interface KindRepair {
  /** The type of the data the repair starts from: a tag (`bytes`) or `ext{kind}`. */
  readonly from: string;
  readonly op: string;
  readonly label: string;
}

export interface Viewer {
  /** The extension kind this viewer draws. */
  readonly kind: string;
  /** What people call it: "table", "relation", "rational number". */
  readonly noun: string;
  /** May throw: the host shows the text form. Must return an element, built by script. */
  render(output: ExtOutput, ctx: ViewerContext): HTMLElement;
  /** The shape in a few words ("4 columns, 12,408 rows"), for the "Data here" line and the badge. */
  summary?(output: ExtOutput): string | null;
  /** Default: `output.text`. */
  copyText?(output: ExtOutput): string;
  /** Default: `output.text` as UTF-8 in `forge-output.txt`. */
  download?(output: ExtOutput): ViewerFile | null;
  /** Ops that turn this kind into bytes (the "Convert to bytes" menu). */
  readonly bytesOps?: readonly BytesOp[];
  /** Ops that make this kind from other data (the hint of a red row). */
  readonly repairs?: readonly KindRepair[];
}

/**
 * Kinds the language owns (LANGUAGE-0.3.md section 4.2). They are drawn by the text fallback with its normal
 * look: no sentence, because a viewer for them is not expected (UI-TOOLKIT.md section 1.9).
 */
const LANGUAGE_KINDS: ReadonlySet<string> = new Set(["null", "array"]);

const viewers = new Map<string, Viewer>();
const loaders = new Map<string, () => Promise<unknown>>();
/** Kinds whose viewer module is loading, or failed to load. */
const loading = new Set<string>();
const failedLoad = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

const KIND_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Registers a viewer. Idempotent, and the last one wins (a module can be evaluated twice, as for the kind
 * registry). A bad kind name is a programmer error.
 */
export function registerViewer(viewer: Viewer): void {
  if (!KIND_RE.test(viewer.kind)) throw new TypeError(`registerViewer: bad kind '${viewer.kind}'`);
  viewers.set(viewer.kind, viewer);
  loading.delete(viewer.kind);
  failedLoad.delete(viewer.kind);
  notify();
}

export function getViewer(kind: string): Viewer | undefined {
  return viewers.get(kind);
}

/**
 * Registers the loader of a viewer that lives in a lazy chunk (`() => import("./table-view.js")`). The
 * module is expected to call `registerViewer` when it is evaluated. Until it has, the kind is drawn by
 * the text fallback with "Loading the viewer...", and the listeners are told when it arrives or fails.
 */
export function registerViewerLoader(kind: string, load: () => Promise<unknown>): void {
  if (!KIND_RE.test(kind)) throw new TypeError(`registerViewerLoader: bad kind '${kind}'`);
  loaders.set(kind, load);
}

/** Calls `listener` when a viewer is registered or a lazy one has loaded or failed. Returns the unsubscribe. */
export function onViewersChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the page has for a kind: a viewer, one on its way, one that failed to load, or none. */
export type ViewerState = "ready" | "loading" | "failed" | "missing";

export function viewerState(kind: string): ViewerState {
  if (viewers.has(kind)) return "ready";
  if (loading.has(kind)) return "loading";
  if (failedLoad.has(kind)) return "failed";
  return "missing";
}

/** Starts the lazy load of a kind's viewer, once. Returns false when there is none to load. */
function startLoad(kind: string): boolean {
  const load = loaders.get(kind);
  if (load === undefined || loading.has(kind) || failedLoad.has(kind) || viewers.has(kind)) {
    return loading.has(kind);
  }
  loading.add(kind);
  void Promise.resolve()
    .then(load)
    .then(
      () => {
        loading.delete(kind);
        if (!viewers.has(kind)) failedLoad.add(kind);
        notify();
      },
      () => {
        loading.delete(kind);
        failedLoad.add(kind);
        notify();
      },
    );
  return true;
}

/** Forgets every registration. For tests. */
export function resetViewers(): void {
  viewers.clear();
  loaders.clear();
  loading.clear();
  failedLoad.clear();
  listeners.clear();
  announced = new WeakSet<object>();
}

// ---- what the rest of the app asks of a kind ----------------------------------------------------

/** `ext{kind}`, as the header syntax writes it. */
export function extTypeText(kind: string): string {
  return `ext{${kind}}`;
}

/** What people call the kind: the viewer's noun, else "<kind> extension value" for an unregistered kind. */
export function kindNoun(kind: string): string {
  return viewers.get(kind)?.noun ?? `${kind} extension value`;
}

export function kindRepairs(kind: string): readonly KindRepair[] {
  return viewers.get(kind)?.repairs ?? [];
}

// ---- the text fallback and the host ---------------------------------------------------------------

/** The part of `document` the host needs; a stand-in implements it in node tests. */
export type DocumentLike = Pick<Document, "createElement">;

export interface RenderHost {
  /** Default: the global `document`. */
  readonly doc?: DocumentLike;
  /** Called once per output when a viewer failed (the live region of the app). */
  readonly announce?: (text: string) => void;
}

/** Why the fallback was used. */
export type FallbackReason = "none" | "unknown" | "loading" | "failed" | "no-view";

const SENTENCES: Readonly<Record<"unknown" | "loading" | "failed", (kind: string) => string>> = {
  unknown: (kind) => `No viewer for ${kind} is loaded. Showing the text form.`,
  loading: (kind) => `Loading the viewer for ${kind}. Showing the text form.`,
  failed: (kind) => `The viewer for ${kind} failed. Showing the text form.`,
};

/** "Showing the first 4,000 characters." when the worker cut the text. */
export function truncationSentence(output: ExtOutput): string {
  return output.truncated
    ? `Showing the first ${output.text.length.toLocaleString("en-US")} characters.`
    : "";
}

/** The sentence that goes above the text form, or "" for none. */
export function fallbackSentence(output: ExtOutput, reason: FallbackReason): string {
  const parts: string[] = [];
  if (reason === "unknown" || reason === "loading" || reason === "failed") {
    parts.push(SENTENCES[reason](output.extKind));
  }
  const cut = truncationSentence(output);
  if (cut !== "") parts.push(cut);
  return parts.join(" ");
}

/**
 * The text fallback: `<pre class="text scalar" tabindex="0">` with the text form as a text node, under an
 * optional sentence. Built by script; the text is never parsed as markup.
 */
export function fallbackViewer(
  output: ExtOutput,
  reason: FallbackReason = "none",
  doc: DocumentLike = document,
): HTMLElement {
  const box = doc.createElement("div");
  box.className = "ext-fallback";
  box.setAttribute("data-ext-kind", output.extKind);
  const sentence = fallbackSentence(output, reason);
  if (sentence !== "") {
    const p = doc.createElement("p");
    p.className = "note";
    p.textContent = sentence;
    box.append(p);
  }
  const pre = doc.createElement("pre");
  pre.className = "text scalar";
  pre.tabIndex = 0;
  pre.textContent = output.text;
  box.append(pre);
  return box;
}

/** A node is an element when it says so. `instanceof HTMLElement` is not available in node tests. */
function isElement(x: unknown): x is HTMLElement {
  return typeof x === "object" && x !== null && (x as { nodeType?: unknown }).nodeType === 1;
}

let announced = new WeakSet<object>();

/**
 * The node for an ext output: the registered viewer's, or the text fallback when there is none, it is still
 * loading, the output has no `view`, or it throws or returns something that is not an element. Never throws,
 * never logs, and a failure is announced once per output.
 */
export function renderExt(
  output: ExtOutput,
  ctx: ViewerContext,
  host: RenderHost = {},
): HTMLElement {
  const doc = host.doc ?? document;
  const viewer = viewers.get(output.extKind);
  if (viewer === undefined) {
    if (LANGUAGE_KINDS.has(output.extKind)) return fallbackViewer(output, "none", doc);
    const state = startLoad(output.extKind) ? "loading" : viewerState(output.extKind);
    return fallbackViewer(
      output,
      state === "loading" ? "loading" : state === "failed" ? "failed" : "unknown",
      doc,
    );
  }
  // A kind with a viewer but no `view` in the output: the text form is the normal look (section 1.3).
  if (output.view === undefined) return fallbackViewer(output, "none", doc);
  try {
    const node = viewer.render(output, ctx) as unknown;
    if (isElement(node)) return node;
    throw new TypeError("a viewer must return an element");
  } catch {
    if (!announced.has(output)) {
      announced.add(output);
      host.announce?.(SENTENCES.failed(output.extKind));
    }
    return fallbackViewer(output, "failed", doc);
  }
}

// ---- Copy, Download, Convert to bytes ------------------------------------------------------------

/** What Copy puts on the clipboard for an ext output. */
export function extCopyText(output: ExtOutput): string {
  const viewer = viewers.get(output.extKind);
  if (viewer?.copyText !== undefined) {
    try {
      return viewer.copyText(output);
    } catch {
      return output.text;
    }
  }
  return output.text;
}

/** What Download saves for an ext output. */
export function extDownloadFile(output: ExtOutput): ViewerFile {
  const viewer = viewers.get(output.extKind);
  if (viewer?.download !== undefined) {
    try {
      const file = viewer.download(output);
      if (file !== null) return file;
    } catch {
      // The text form below.
    }
  }
  return {
    filename: "forge-output.txt",
    mime: "text/plain;charset=utf-8",
    bytes: new TextEncoder().encode(output.text),
  };
}

/** The ops that turn the kind into bytes, for the "Convert to bytes" menu. */
export function extBytesOps(output: ExtOutput): readonly BytesOp[] {
  return viewers.get(output.extKind)?.bytesOps ?? [];
}

/** The shape in a few words as the viewer states it ("4 columns, 12,408 rows"), or null when it states none. */
export function extShape(output: ExtOutput): string | null {
  try {
    const shape = viewers.get(output.extKind)?.summary?.(output) ?? null;
    return shape === "" ? null : shape;
  } catch {
    return null;
  }
}

/** "table, 3 columns": the noun and the viewer's summary, for the register summary and the badges. */
export function extSummary(output: ExtOutput): string {
  const shape = extShape(output);
  const noun = kindNoun(output.extKind);
  return shape === null ? noun : `${noun}, ${shape}`;
}
