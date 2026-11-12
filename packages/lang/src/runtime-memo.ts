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
/**
 * `ForgeRuntime.warm()` (LANGUAGE-0.2.md section 9): evaluates the `MEMO:` words of a runtime up
 * front, each in its own run under the memo limits. It reuses the ordinary call path: a run whose
 * only code is the `memo` instruction.
 */
import { ForgeError } from "./errors.js";
import type {
  CompiledWord,
  ConsoleSegment,
  Dictionary,
  FlWordEntry,
  Limits,
  RunResult,
  Scope,
  StackEffect,
  WarmReport,
  WordEntry,
} from "./types.js";

/** What `warm` needs from the runtime. */
export interface WarmHost {
  readonly dictionary: Dictionary;
  readonly resolve: (name: string, scope: Scope) => WordEntry;
  /** The effect `( -- .. )` of a console segment. */
  readonly segmentEffect: StackEffect;
  readonly limits: Readonly<Limits>;
  readonly scope: Scope;
  readonly execute: (
    segments: readonly ConsoleSegment[],
    limits: Readonly<Limits>,
  ) => Promise<RunResult>;
}

/** Every live `MEMO:` entry of the dictionary, in definition order (the creation order of its cache). */
function memoEntries(dictionary: Dictionary): FlWordEntry[] {
  const seen = new Set<FlWordEntry>();
  for (const v of dictionary.vocabs()) {
    for (const e of dictionary.vocab(v)?.words.values() ?? []) {
      if (e.kind === "fl" && e.memo !== undefined) seen.add(e);
    }
  }
  return [...seen].sort((a, b) => (a.memo?.seq ?? 0) - (b.memo?.seq ?? 0));
}

function notMemo(name: string, why: string): ForgeError {
  return new ForgeError({ code: "E_TYPE", message: `'${name}' ${why}`, detail: { name } });
}

/** Evaluates the memo words (all, or the named ones) and reports which are now cached. */
export async function warmMemo(
  host: WarmHost,
  words: readonly string[] | undefined,
): Promise<WarmReport> {
  const built: string[] = [];
  const failed: { qname: string; error: ForgeError }[] = [];
  const targets: { qname: string; entry: FlWordEntry }[] = [];
  if (words === undefined) {
    for (const entry of memoEntries(host.dictionary)) targets.push({ qname: entry.qname, entry });
  } else {
    for (const name of words) {
      try {
        const entry = host.resolve(name, host.scope);
        if (entry.kind !== "fl" || entry.memo === undefined) {
          failed.push({ qname: name, error: notMemo(name, "is not a MEMO: word") });
        } else {
          targets.push({ qname: entry.qname, entry });
        }
      } catch (e) {
        if (!(e instanceof ForgeError)) throw e;
        failed.push({ qname: name, error: e });
      }
    }
  }
  for (const { qname, entry } of targets) {
    const slot = entry.memo as NonNullable<FlWordEntry["memo"]>;
    if (slot.value === undefined) {
      const code: CompiledWord = {
        qname: "<console>",
        effect: host.segmentEffect,
        localNames: [],
        namedInputs: [],
        anonInputs: [],
        nlocals: 0,
        code: [{ op: "memo", entry }, { op: "ret" }],
        positions: [entry.meta.source?.pos ?? ZERO, entry.meta.source?.pos ?? ZERO],
        effects: [],
        deps: [entry],
      };
      const r = await host.execute([{ code, scope: host.scope }], host.limits);
      if (!r.ok) {
        failed.push({ qname, error: r.error as ForgeError });
        continue;
      }
    }
    if (slot.value === undefined) {
      failed.push({
        qname,
        error: new ForgeError({
          code: "E_LIMIT_TOTAL",
          message: `the value of '${qname}' was not cached: it does not fit the memo cache or holds a quotation`,
          word: qname,
          detail: { word: qname },
        }),
      });
    } else {
      built.push(qname);
    }
  }
  return { built, failed };
}

const ZERO = Object.freeze({ offset: 0, line: 1, col: 1 });
