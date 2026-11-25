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
 * The fixture catalogue of RECIPES-1.2.md section 15 with its kinds and its conversions (section 6.9): `table` to
 * `relation` by `relix:from`, and `relation` to `table` by `relix:run`, which is also applied to the end of a recipe.
 * The fixture ops `fx:cat` and `fx:then` take and give `str`, so that a real runtime can run them with the core word `cat`.
 */
import type { ParamSpec } from "@forge/lang";
import type { CatalogueOpView, CatalogueView } from "../src/types.js";
import { op, seed } from "./helpers.js";

type Spec = Partial<ParamSpec> & { name: string; type: ParamSpec["type"] };

const relSlotOp = (qname: string, slot: "right" | "step", rest: Spec[]): CatalogueOpView =>
  op(qname, "ext", "ext", [{ name: slot, type: "ext", kind: "relation" }, ...rest], {
    slot,
    inputKind: "relation",
    outputKind: "relation",
  });
const relOp = (qname: string, params: Spec[]): CatalogueOpView =>
  op(qname, "ext", "ext", params, { inputKind: "relation", outputKind: "relation" });
const expr = (name: string): Spec => ({ name, type: "ext", kind: "relix-expr" });

export const conversionCatalogue: CatalogueView = {
  version: "00000000000000a2",
  ops: [
    ...seed.ops,
    op("input:tab", "any", "bytes", [{ name: "tab", type: "str" }]),
    op(
      "relix:input",
      "any",
      "ext",
      [
        { name: "tab", type: "str" },
        {
          name: "format",
          type: "choice",
          options: ["csv", "tsv", "json", "ndjson"],
          default: "csv",
        },
        { name: "header", type: "bool", default: true },
      ],
      { outputKind: "relation" },
    ),
    op("relix:recur", "any", "ext", [{ name: "name", type: "str" }], { outputKind: "relation" }),
    relOp("relix:select", [expr("cond")]),
    relOp("relix:group", [expr("spec")]),
    relOp("relix:sort", [expr("keys")]),
    relOp("relix:rename", [expr("spec")]),
    relOp("relix:project", [expr("columns")]),
    relSlotOp("relix:theta-join", "right", [expr("on")]),
    relSlotOp("relix:left-join", "right", [expr("on")]),
    relSlotOp("relix:union", "right", []),
    relSlotOp("relix:fix", "step", [{ name: "name", type: "str" }]),
    op("relix:from", "ext", "ext", [{ name: "name", type: "str", default: "" }], {
      inputKind: "table",
      outputKind: "relation",
    }),
    op(
      "relix:run",
      "ext",
      "ext",
      [{ name: "limit", type: "int", constraint: { min: 0 }, default: 0 }],
      {
        inputKind: "relation",
        outputKind: "table",
      },
    ),
    op("csv:parse", "bytes", "ext", [], { outputKind: "table" }),
    op("table:filter", "ext", "ext", [expr("expr")], { inputKind: "table", outputKind: "table" }),
    op("table:to-json", "ext", "str", [], { inputKind: "table" }),
    op("fx:cat", "str", "str", [{ name: "right", type: "str" }], { slot: "right" }),
    op("fx:then", "str", "str", [{ name: "step", type: "str" }], { slot: "step" }),
  ],
  conversions: [
    { from: "table", to: "relation", op: "relix:from" },
    { from: "relation", to: "table", op: "relix:run", atEnd: true },
  ],
};
