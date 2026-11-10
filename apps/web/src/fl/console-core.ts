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
// The logic of the console worker, free of any worker globals so Node tests can drive it with
// `loadBundleNode` (UI.md section 5.2). `console-worker.ts` only wires it to `postMessage`.
//
// Semantics mirror packages/lang/scripts/repl.ts: one runtime per session, `stack` and `vars` persist
// between lines, a failed line leaves the stack as it was, the stack is shown with `.s` after a line.
import {
  formatErrorMessage,
  isForgeError,
  type Limits,
  type Value,
  type WordMeta,
} from "@forge/lang";
import { assembleRuntime, buildCatalogue, type Catalogue, type LoadBundleFn } from "@forge/ops";
import type { ForgeRuntime } from "@forge/lang";
import type { ClientMessage, UserUnit, WorkerMessage } from "./protocol.js";

/** Limits for console runs: bounded, and below the client's 10 s watchdog so a runaway loop is a plain error. */
export const CONSOLE_LIMITS: Readonly<Partial<Limits>> = Object.freeze({
  maxSteps: 20_000_000,
  maxMillis: 8_000,
});

export interface ConsoleCoreOptions {
  readonly loadBundle: LoadBundleFn;
  readonly limits?: Partial<Limits>;
}

export interface ConsoleCore {
  /** Handle one request; answers go to `post`. Requests are processed one at a time, in order. */
  handle(message: ClientMessage, post: (message: WorkerMessage) => void): Promise<void>;
}

const errorText = (e: unknown): string =>
  isForgeError(e) ? formatErrorMessage(e) : e instanceof Error ? e.message : String(e);

/** The metadata of a word as plain text, one field per line. */
export function formatMeta(meta: WordMeta): string {
  const lines: string[] = [
    `qname: ${meta.qname}`,
    `kind: ${meta.kind}`,
    `effect: ${meta.effect.text}`,
    `category: ${meta.category ?? "(none)"}`,
    `doc: ${meta.doc ?? "(none)"}`,
  ];
  if (meta.aliases.length > 0) lines.push(`aliases: ${meta.aliases.join(" ")}`);
  if (meta.seeAlso.length > 0) lines.push(`see also: ${meta.seeAlso.join(" ")}`);
  if (meta.effects.length > 0) lines.push(`effects: ${meta.effects.join(" ")}`);
  lines.push(`exported: ${meta.exported ? "yes" : "no"}`, `op: ${meta.op ? "yes" : "no"}`);
  lines.push(`version: ${meta.version}`, `hash: ${meta.hash}`);
  if (meta.source.unit !== null) lines.push(`unit: ${meta.source.unit}`);
  for (const p of meta.params)
    lines.push(`param ${p.name}: ${p.type}${p.doc ? ` - ${p.doc}` : ""}`);
  return lines.join("\n");
}

export function createConsoleCore(options: ConsoleCoreOptions): ConsoleCore {
  const limits = { ...CONSOLE_LIMITS, ...options.limits };
  let bundlePromise: ReturnType<LoadBundleFn> | undefined;
  let units: readonly UserUnit[] = [];
  /** Set when the user unit failed to load: the session then runs without it. */
  let userFailed = false;
  let runtime: ForgeRuntime | undefined;
  let stack: readonly Value[] = [];
  let vars = new Map<string, Value>();
  let chain: Promise<void> = Promise.resolve();

  const bundle = (): ReturnType<LoadBundleFn> => (bundlePromise ??= options.loadBundle("all"));

  const vocabsOf = (rt: ForgeRuntime): string[] => [...rt.dictionary.vocabs()].sort();

  async function assemble(withUnits: boolean): Promise<ForgeRuntime> {
    return assembleRuntime(await bundle(), withUnits ? { units } : {});
  }

  async function renderStack(rt: ForgeRuntime): Promise<string[]> {
    const shown = await rt.run(".s", { stack, limits });
    return shown.output.split("\n").filter((line) => line !== "");
  }

  async function doInit(id: number, post: (m: WorkerMessage) => void): Promise<void> {
    const warnings: string[] = [];
    const warn = (m: string): void => void warnings.push(m);
    let catalogue: Catalogue;
    let rt: ForgeRuntime;
    const b = await bundle();
    userFailed = false;
    try {
      rt = await assemble(true);
      catalogue = buildCatalogue(rt, { bundleVocabs: b.vocabs, warn });
    } catch (e) {
      // Fall back to a runtime without the user unit so the console and the catalogue stay usable.
      userFailed = true;
      post({ type: "init-error", id, message: errorText(e) });
      warnings.length = 0;
      rt = await assemble(false);
      catalogue = buildCatalogue(rt, { bundleVocabs: b.vocabs, warn });
    }
    runtime = rt;
    stack = [];
    vars = new Map();
    post({
      type: "ready",
      id,
      catalogue,
      warnings,
      vocab: rt.currentVocab(),
      vocabs: vocabsOf(rt),
    });
  }

  async function doRun(
    id: number,
    source: string,
    post: (m: WorkerMessage) => void,
  ): Promise<void> {
    const rt = runtime;
    if (rt === undefined) {
      post({ type: "fatal", message: "the console session is not initialised" });
      return;
    }
    const result = await rt.run(source, { stack, vars, limits });
    if (result.ok) stack = [...result.stack];
    post({
      type: "result",
      id,
      ok: result.ok,
      output: result.output,
      stack: await renderStack(rt),
      vocab: rt.currentVocab(),
      vocabs: vocabsOf(rt),
      ...(result.ok
        ? {}
        : { error: { code: result.error.code, message: formatErrorMessage(result.error) } }),
    });
  }

  async function doReset(id: number, post: (m: WorkerMessage) => void): Promise<void> {
    runtime = await assemble(!userFailed);
    stack = [];
    vars = new Map();
    post({ type: "reset-done", id, vocab: runtime.currentVocab() });
  }

  async function doInspect(
    id: number,
    qname: string,
    post: (m: WorkerMessage) => void,
  ): Promise<void> {
    const rt = runtime;
    const failed = (error: string): void =>
      post({ type: "inspect-result", id, qname, ok: false, meta: "", source: "", help: "", error });
    if (rt === undefined) return failed("the console session is not initialised");
    try {
      const meta = rt.meta(qname);
      let source = meta.source.text ?? "";
      let help = "";
      // The language's own words render both texts; a string literal cannot be altered by the name
      // because the name is only used when it is a valid qualified word name.
      if (/^[^\s":\\]+:[^\s":\\]+$/.test(meta.qname)) {
        const q = JSON.stringify(meta.qname);
        const seen = await rt.run(`${q} see .`, { limits });
        if (seen.ok && seen.output.trim() !== "") source = seen.output.replace(/\n+$/, "");
        const helped = await rt.run(`${q} help .`, { limits });
        if (helped.ok) help = helped.output.replace(/\n+$/, "");
      }
      post({
        type: "inspect-result",
        id,
        qname: meta.qname,
        ok: true,
        meta: formatMeta(meta),
        source: source === "" ? `(no source: ${meta.kind} word)` : source,
        help,
      });
    } catch (e) {
      failed(errorText(e));
    }
  }

  return {
    handle(message, post) {
      if (message.type === "dispose") {
        runtime = undefined;
        return Promise.resolve();
      }
      const step = async (): Promise<void> => {
        try {
          switch (message.type) {
            case "init":
              units = message.units;
              await doInit(message.id, post);
              break;
            case "run":
              await doRun(message.id, message.source, post);
              break;
            case "reset":
              await doReset(message.id, post);
              break;
            case "inspect":
              await doInspect(message.id, message.qname, post);
              break;
          }
        } catch (e) {
          post({ type: "fatal", message: errorText(e) });
        }
      };
      chain = chain.then(step);
      return chain;
    },
  };
}
