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
import { describe, expect, it } from "vitest";
import type { CatalogueOp } from "@forge/ops";
import { buildListModel, favouriteOps, groupByCategory } from "./group.js";

function op(qname: string, overrides: Partial<CatalogueOp> = {}): CatalogueOp {
  const colon = qname.indexOf(":");
  return {
    qname,
    name: qname.slice(colon + 1),
    vocab: qname.slice(0, colon),
    category: null,
    doc: null,
    aliases: [],
    seeAlso: [],
    input: "bytes",
    output: "bytes",
    effect: "( bytes -- bytes )",
    params: [],
    effects: [],
    version: "1",
    hash: "h",
    needsHardKill: false,
    ...overrides,
  };
}

const OPS: CatalogueOp[] = [
  op("base64:encode", { category: "Encoding", aliases: ["b64"] }),
  op("base64:decode", { category: "Encoding" }),
  op("hash:sha256", { category: "Hashing" }),
  op("hash:md5", { category: "Hashing" }),
  op("str:reverse", { category: null, doc: "Reverse the characters." }),
  op("user:rot47-classic", { category: "User recipes" }),
  op("user:shout", { category: null }),
  op("hex:encode", { category: "encoding " }),
];

describe("favouriteOps", () => {
  it("returns the favourites in favourite order and skips unknown names", () => {
    const names = favouriteOps(OPS, ["hash:md5", "gone:op", "base64:encode"]).map((o) => o.qname);
    expect(names).toEqual(["hash:md5", "base64:encode"]);
  });

  it("is empty with no favourites", () => {
    expect(favouriteOps(OPS, [])).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("puts user words first, then categories in code-point order, then Other last", () => {
    const groups = groupByCategory(OPS);
    expect(groups.map((g) => g.title)).toEqual([
      "User words",
      "Encoding",
      "Hashing",
      "encoding ",
      "Other",
    ]);
  });

  it("keeps the catalogue order inside a group and moves user ops out of their category", () => {
    const groups = groupByCategory(OPS);
    expect(groups[0]?.ops.map((o) => o.qname)).toEqual(["user:rot47-classic", "user:shout"]);
    expect(groups[1]?.ops.map((o) => o.qname)).toEqual(["base64:encode", "base64:decode"]);
    expect(groups.at(-1)?.ops.map((o) => o.qname)).toEqual(["str:reverse"]);
  });

  it("treats a blank category as no category", () => {
    const groups = groupByCategory([op("x:blank", { category: "  " })]);
    expect(groups.map((g) => g.title)).toEqual(["Other"]);
  });

  it("gives no groups for an empty catalogue", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe("buildListModel", () => {
  it("browses with favourites first, then the category groups", () => {
    const model = buildListModel(OPS, ["hash:md5"], "");
    expect(model.mode).toBe("browse");
    expect(model.sections.map((s) => s.id)).toEqual([
      "favourites",
      "user",
      "category:Encoding",
      "category:Hashing",
      "category:encoding ",
      "other",
    ]);
    expect(model.sections[0]?.ops.map((o) => o.qname)).toEqual(["hash:md5"]);
    expect(model.total).toBe(OPS.length);
  });

  it("numbers the visible rows so that each section starts where the previous one ends", () => {
    const model = buildListModel(OPS, ["hash:md5"], "");
    expect(model.sections.map((s) => s.start)).toEqual([0, 1, 3, 5, 7, 8]);
    expect(model.visible).toHaveLength(OPS.length + 1);
    expect(model.visible[0]?.qname).toBe("hash:md5");
    expect(model.visible[1]?.qname).toBe("user:rot47-classic");
  });

  it("leaves the rows of a collapsed section out of the visible list", () => {
    const model = buildListModel(OPS, [], "", new Set(["category:Encoding"]));
    const encoding = model.sections.find((s) => s.id === "category:Encoding");
    expect(encoding?.collapsed).toBe(true);
    expect(encoding?.ops).toHaveLength(2);
    expect(model.visible.map((o) => o.qname)).not.toContain("base64:encode");
    const hashing = model.sections.find((s) => s.id === "category:Hashing");
    expect(hashing?.start).toBe(model.visible.indexOf(hashing!.ops[0]!));
  });

  it("shows one ranked section of matches while a query is active, ignoring favourites", () => {
    const model = buildListModel(OPS, ["hash:md5"], "encode", new Set(["results"]));
    expect(model.mode).toBe("search");
    expect(model.sections).toHaveLength(1);
    expect(model.sections[0]?.kind).toBe("results");
    expect(model.sections[0]?.collapsible).toBe(false);
    expect(model.sections[0]?.collapsed).toBe(false);
    expect(model.visible[0]?.qname).toBe("base64:encode");
    expect(model.total).toBe(model.visible.length);
  });

  it("reports zero matches for a query nothing satisfies", () => {
    const model = buildListModel(OPS, [], "zzzz");
    expect(model.mode).toBe("search");
    expect(model.visible).toEqual([]);
    expect(model.total).toBe(0);
  });

  it("treats a whitespace-only query as browsing", () => {
    expect(buildListModel(OPS, [], "   ").mode).toBe("browse");
  });
});
