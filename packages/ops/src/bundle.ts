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
 * Bundle loading and runtime assembly (RECIPES.md sections 2.4 and 2.5).
 */
import { CORE_VOCAB, ForgeError, createRuntime, read } from "@forge/lang";
import type { ForgeRuntime, PrimitiveDef } from "@forge/lang";
import { scanVocab } from "./scan.js";
import { INTERNAL_VOCABS } from "./types.js";
import type {
  AssembleRuntimeFn,
  CreateBundleLoaderFn,
  PrimitiveModule,
  ScanResult,
  VocabBundle,
} from "./types.js";

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `loadBundle` over a provider. The first call lists the sources, scans and checks them (a failure
 * is not cached: the next call scans again). A call returns the requested vocabularies plus their
 * transitive dependencies; primitive modules are imported only for those.
 */
export const createBundleLoader: CreateBundleLoaderFn = (provider) => {
  let scanned: Promise<ScanResult> | undefined;
  const scan = (): Promise<ScanResult> => {
    const result = (scanned ??= provider
      .fthFiles()
      .then((files) => scanVocab(files, Object.keys(provider.primitiveLoaders()))));
    result.catch(() => {
      if (scanned === result) scanned = undefined;
    });
    return result;
  };

  return async (names = "all"): Promise<VocabBundle> => {
    const { units, vocabs: all } = await scan();
    const requested = names === "all" ? all : names;
    const wanted = new Set<string>();
    const queue = [...requested];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      if (wanted.has(name)) continue;
      if (!all.includes(name)) throw new Error(`unknown vocabulary '${name}'`);
      wanted.add(name);
      const unit = units.find((u) => u.vocab === name);
      if (unit !== undefined) queue.push(...unit.deps);
    }
    const vocabs = [...wanted].sort(compareCodePoints);
    const available = provider.primitiveLoaders();
    const primitives: PrimitiveDef[] = [];
    for (const vocab of vocabs) {
      const load = Object.hasOwn(available, vocab) ? available[vocab] : undefined;
      if (load === undefined) continue;
      const mod: PrimitiveModule = await load();
      if (!Array.isArray(mod.primitives)) {
        throw new Error(`prims/${vocab}: the module does not export a 'primitives' array`);
      }
      for (const def of mod.primitives) {
        if (def.vocab !== vocab) {
          throw new Error(
            `prims/${vocab}: primitive '${def.name}' is in vocabulary '${def.vocab}', not '${vocab}'`,
          );
        }
        primitives.push(def);
      }
    }
    return {
      vocabs,
      units: units.filter((u) => wanted.has(u.vocab)),
      primitives,
    };
  };
};

function prefixed(unit: string, e: unknown): unknown {
  return e instanceof ForgeError ? e.with({ message: `${unit}: ${e.message}` }) : e;
}

/** Throws `E_READONLY` if the source has an `IN:` that names a bundled, internal or `core` vocabulary. */
function checkUserUnit(unit: string, source: string, protectedVocabs: ReadonlySet<string>): void {
  let tokens;
  try {
    tokens = read(source);
  } catch (e) {
    throw prefixed(unit, e);
  }
  tokens.forEach((token, i) => {
    if (token.kind !== "word" || token.text !== "IN:") return;
    const name = tokens[i + 1];
    if (name === undefined || name.kind !== "word" || !protectedVocabs.has(name.text)) return;
    throw new ForgeError({
      code: "E_READONLY",
      message: `${unit}: vocabulary '${name.text}' is read-only; a user unit cannot define into it`,
      detail: { vocab: name.text },
      pos: name.pos,
    });
  });
}

/**
 * `createRuntime` with the bundle's primitives, then `load` every unit in order (untrusted). Extra
 * units (user vocabularies) are loaded last and may not define into a bundled, internal or `core`
 * vocabulary (`E_READONLY`). A `ForgeError` is rethrown with the unit name prefixed to its message.
 */
export const assembleRuntime: AssembleRuntimeFn = (bundle, options = {}) => {
  const runtime: ForgeRuntime = createRuntime({
    primitives: bundle.primitives,
    ...(options.limits !== undefined ? { limits: options.limits } : {}),
  });
  for (const unit of bundle.units) {
    try {
      runtime.load(unit.source, { unit: unit.name, trusted: false });
    } catch (e) {
      throw prefixed(unit.name, e);
    }
  }
  const protectedVocabs = new Set<string>([...bundle.vocabs, ...INTERNAL_VOCABS, CORE_VOCAB]);
  for (const unit of options.units ?? []) {
    checkUserUnit(unit.name, unit.source, protectedVocabs);
    try {
      runtime.load(unit.source, { unit: unit.name, trusted: false });
    } catch (e) {
      throw prefixed(unit.name, e);
    }
  }
  return runtime;
};
