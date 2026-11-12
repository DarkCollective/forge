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

/*
 * `npm run -s hash-snapshot -w @forge/ops` (LANGUAGE-0.2.md section 15.1): the hash guard. Loads the
 * full bundle and prints one line `qname hash` for every word of every vocabulary (core included;
 * private words and aliases too), sorted by code point, followed by one line
 * `catalogue.json <sha256>` with the SHA-256 of `dist/catalogue.json`. Only the snapshot goes to
 * stdout, so two runs (on the merge base and on a branch) can be diffed. Words that carry no hash
 * (for example primitives) print `-`.
 *
 * Runs against the compiled package (`../dist`); `dist/catalogue.json` is written by the build
 * (`npm run build -w @forge/ops`), so build before taking a snapshot.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@forge/lang";
import { assembleRuntime } from "../dist/bundle.js";
import { loadBundleNode } from "../dist/sources-node.js";

const here = fileURLToPath(import.meta.url).replaceAll("\\", "/");
const root = here.slice(0, here.lastIndexOf("/", here.lastIndexOf("/") - 1));

function compareCodePoints(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

async function main(): Promise<void> {
  const runtime = assembleRuntime(await loadBundleNode("all"));
  const lines: string[] = [];
  for (const vocab of runtime.dictionary.vocabs()) {
    const v = runtime.dictionary.vocab(vocab);
    if (v === undefined) continue;
    for (const [name, entry] of v.words) {
      const hash = (entry.meta as { readonly hash?: string }).hash;
      lines.push(`${vocab}:${name} ${hash === undefined || hash === "" ? "-" : hash}`);
    }
  }
  lines.sort(compareCodePoints);
  // The file is UTF-8 JSON text; `sha256` hashes the UTF-8 encoding of the string.
  const catalogue = sha256(readFileSync(`${root}/dist/catalogue.json`, "utf8"));
  process.stdout.write(`${lines.join("\n")}\ncatalogue.json ${catalogue}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`hash-snapshot failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
