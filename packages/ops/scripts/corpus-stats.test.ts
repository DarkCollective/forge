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
 * Smoke test for `corpus-stats.ts`: the measures on a synthetic corpus, whose answers are known,
 * and on the real tree when it is built. Fast: it reads the vocabularies once.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  codeLineCount,
  lineCount,
  measureCorpus,
  readCorpus,
  renderMarkdown,
  type CorpusInput,
  type Measure,
} from "./corpus-stats.js";

const value = (ms: readonly Measure[], id: string): number | string => {
  const m = ms.find((x) => x.id === id);
  if (m === undefined) throw new Error(`no measure ${id}`);
  return m.value;
};

const synthetic: CorpusInput = {
  vocabFiles: [
    {
      name: "alpha.fth",
      // a private word used once, a closure helper, an else-if chain of depth 2, a choice header, a
      // local named like a new core word, and a VARIABLE
      text: [
        "\\ comment",
        ": _once ( x:int -- int ) x 1 + ;",
        ": pub ( n:int -- int ) _once ;",
        ": _bind ( first:int -- int ) first ;",
        ": pick ( c:bool a:int b:int -- int ) c [ a ] [ b ] if ;",
        ": chain ( c:bool d:bool -- int ) c [ 1 ] [ d [ 2 ] [ 3 ] if ] if ;",
        ": opt ( k:choice{x|y}=x -- int ) k :> last last ;",
        "0 VARIABLE _v",
        "",
      ].join("\n"),
    },
    {
      name: "beta.fth",
      text: ": tab ( -- bytes ) #[ 01 02 ] ;\n: _twice ( -- int ) 1 dup + ;\n",
    },
  ],
  vectorFiles: [
    {
      name: "alpha.test.json",
      text: JSON.stringify([
        { op: "alpha:pub", expect: { error: "E_PARAM_INVALID" } },
        { op: "alpha:pub" },
      ]),
    },
    { name: "beta.test.json", text: JSON.stringify([{ op: "beta:tab" }, { ref: "x" }]) },
  ],
  primFiles: [
    {
      name: "a.ts",
      text: 'import { definePrimitive } from "@forge/lang";\nimport { x } from "@noble/hashes";\n// note\nexport const p = [definePrimitive(1), definePrimitive(2)];\n',
    },
    { name: "b.ts", text: "export const q = 1;\n" },
  ],
  internalVocabs: ["util"],
  ops: [
    { qname: "alpha:pub", vocab: "alpha" },
    { qname: "beta:tab", vocab: "beta" },
  ],
};

describe("corpus-stats: line counts", () => {
  it("counts physical lines, with and without a final break", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
  });

  it("counts TypeScript code lines, leaving out blank and comment-only lines", () => {
    expect(codeLineCount("// c\n\n/* c */\n * doc\nconst x = 1;\n")).toBe(1);
  });
});

describe("corpus-stats: measures on a synthetic corpus", () => {
  const ms = measureCorpus(synthetic);

  it("sums vectors over the files, and splits them by the op field", () => {
    const perFile = synthetic.vectorFiles.reduce(
      (n, f) => n + (JSON.parse(f.text) as unknown[]).length,
      0,
    );
    expect(value(ms, "vectors")).toBe(perFile);
    expect(value(ms, "vectors")).toBe(4);
    expect(value(ms, "vector_items_op")).toBe(3);
    expect(value(ms, "vector_items_checkpair")).toBe(1);
    expect(value(ms, "e_param_invalid_expect")).toBe(1);
  });

  it("counts definitions and the private ones called exactly once", () => {
    expect(value(ms, "colon_words")).toBe(8);
    expect(value(ms, "colon_public")).toBe(5);
    expect(value(ms, "colon_private")).toBe(3);
    // _once is called by pub; _bind, _twice are not called; _v is a VARIABLE, not a definition
    expect(value(ms, "private_called_once")).toBe(1);
  });

  it("finds else-if chains and the depth of the deepest", () => {
    expect(value(ms, "else_if_links")).toBe(1);
    expect(value(ms, "else_if_chains")).toBe(1);
    expect(value(ms, "else_if_max")).toBe(2);
  });

  it("counts W_SHADOW locals of the new core names that the file does not define", () => {
    // `first` in _bind and `last` in opt
    expect(value(ms, "w_shadow_locals")).toBe(2);
    expect(value(ms, "w_shadow_names")).toBe(2);
  });

  it("counts choice headers, VARIABLEs and the byte-literal rebuild", () => {
    expect(value(ms, "choice_headers")).toBe(1);
    expect(value(ms, "variables")).toBe(1);
    expect(value(ms, "zero_input_rebuilding")).toBe(1);
  });

  it("counts ops and vocabularies from the catalogue", () => {
    expect(value(ms, "ops")).toBe(2);
    expect(value(ms, "op_vocabs")).toBe(2);
    expect(value(ms, "fth_internal")).toBe(0);
    expect(value(ms, "fth_other")).toBe(0);
  });

  it("counts primitives and the noble wrappers", () => {
    expect(value(ms, "primitives")).toBe(2);
    expect(value(ms, "prim_modules")).toBe(1);
    expect(value(ms, "prim_noble_files")).toBe(1);
  });

  it("renders a Markdown report that names each measure and its definition", () => {
    const md = renderMarkdown(ms, "npm run corpus-stats -w @forge/ops");
    expect(md).toContain("| vectors (all .test.json items) | 4 |");
    expect(md).toContain("## Not measured");
    expect(md.split("## 2.5 The FL corpus").length - 1).toBe(1);
  });
});

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const built = existsSync(`${root}/dist/types.js`);

describe.skipIf(!built)("corpus-stats: the real tree (needs dist/)", () => {
  it("counts the tree with positive, consistent totals", async () => {
    const ms = measureCorpus(await readCorpus(root));
    const vectors = value(ms, "vectors");
    expect(typeof vectors).toBe("number");
    expect(vectors as number).toBeGreaterThan(0);
    expect(value(ms, "fth_files") as number).toBeGreaterThan(0);
    expect(value(ms, "ops") as number).toBeGreaterThan(0);
    expect(value(ms, "vector_items_op")).toBe(vectors);
    expect(value(ms, "primitives") as number).toBeGreaterThan(0);
  });
});
