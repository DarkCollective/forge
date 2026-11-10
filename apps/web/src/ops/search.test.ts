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
import { normaliseText, scoreOp, searchOps, subsequenceSpan, tokenise } from "./search.js";
import type { SearchableOp } from "./search.js";

function op(partial: Partial<SearchableOp> & { qname: string }): SearchableOp & { qname: string } {
  const name = partial.name ?? partial.qname.slice(partial.qname.indexOf(":") + 1);
  return {
    qname: partial.qname,
    name,
    aliases: partial.aliases ?? [],
    doc: partial.doc ?? null,
    category: partial.category ?? null,
  };
}

const CATALOGUE: (SearchableOp & { qname: string })[] = [
  op({ qname: "hex:encode", doc: "Encode bytes as hexadecimal text.", category: "Encoding" }),
  op({ qname: "hex:decode", doc: "Decode hexadecimal text to bytes.", category: "Encoding" }),
  op({
    qname: "base64:encode",
    name: "encode",
    aliases: ["b64"],
    doc: "Base 64 encoding of the input.",
    category: "Encoding",
  }),
  op({ qname: "base64:decode", name: "decode", aliases: ["unb64"], category: "Encoding" }),
  op({ qname: "hash:sha256", doc: "SHA-2 digest, 256 bits.", category: "Hashing" }),
  op({ qname: "hash:md5", doc: "Legacy digest.", category: "Hashing" }),
  op({ qname: "str:reverse", doc: "Reverse the characters.", category: null }),
  op({ qname: "user:rot47-classic", category: "User recipes" }),
];

describe("normaliseText and tokenise", () => {
  it("lower-cases, strips accents and trims", () => {
    expect(normaliseText("  Café  ")).toBe("cafe");
  });

  it("splits on whitespace, drops empties and caps the number of words", () => {
    expect(tokenise("  base   64 ")).toEqual(["base", "64"]);
    expect(tokenise("   ")).toEqual([]);
    expect(tokenise("a b c d e f g h i j")).toHaveLength(8);
  });
});

describe("searchOps ranking", () => {
  it("returns nothing for a blank query, so the browse view takes over", () => {
    expect(searchOps(CATALOGUE, "")).toEqual([]);
    expect(searchOps(CATALOGUE, "   ")).toEqual([]);
  });

  it("ranks an exact name, then a name prefix, then a word start, then a substring", () => {
    const tiers = [
      op({ qname: "c:tango", name: "tango" }),
      op({ qname: "d:x", name: "x", doc: "go fast" }),
      op({ qname: "a:go-tool", name: "go-tool" }),
      op({ qname: "b:go", name: "go" }),
    ];
    expect(searchOps(tiers, "go").map((o) => o.qname)).toEqual([
      "b:go",
      "a:go-tool",
      "c:tango",
      "d:x",
    ]);
  });

  it("ranks a name prefix above a match only in the description", () => {
    const ranked = searchOps(
      [
        op({ qname: "a:x", name: "x", doc: "decode the input" }),
        op({ qname: "b:decoder", name: "decoder" }),
      ],
      "dec",
    );
    expect(ranked.map((o) => o.qname)).toEqual(["b:decoder", "a:x"]);
  });

  it("ranks the name above an alias above the description", () => {
    expect(scoreOp(CATALOGUE[2]!, tokenise("b64"))).toBeGreaterThan(0);
    const byAlias = searchOps(CATALOGUE, "b64");
    expect(byAlias[0]?.qname).toBe("base64:encode");
    const byDoc = searchOps(CATALOGUE, "legacy");
    expect(byDoc.map((o) => o.qname)).toEqual(["hash:md5"]);
  });

  it("matches the qualified name, the category and the description", () => {
    expect(searchOps(CATALOGUE, "hash:").map((o) => o.qname)).toEqual(["hash:md5", "hash:sha256"]);
    expect(searchOps(CATALOGUE, "hashing").map((o) => o.qname)).toEqual([
      "hash:md5",
      "hash:sha256",
    ]);
    expect(searchOps(CATALOGUE, "hexadecimal").map((o) => o.qname)).toEqual([
      "hex:decode",
      "hex:encode",
    ]);
  });

  it("requires every word of the query to match", () => {
    expect(searchOps(CATALOGUE, "base encode").map((o) => o.qname)).toEqual(["base64:encode"]);
    expect(searchOps(CATALOGUE, "base sha256")).toEqual([]);
  });

  it("matches a word at a word boundary inside a qualified name", () => {
    expect(searchOps(CATALOGUE, "classic").map((o) => o.qname)).toEqual(["user:rot47-classic"]);
  });

  it("finds a name as a subsequence for words of three or more letters", () => {
    const named = [
      op({ qname: "base:base64", name: "base64" }),
      op({ qname: "x:other", name: "other" }),
    ];
    expect(searchOps(named, "bs64").map((o) => o.qname)).toEqual(["base:base64"]);
    expect(searchOps(named, "bs").map((o) => o.qname)).toEqual([]);
  });

  it("ranks a tight subsequence above a spread-out one", () => {
    const named = [
      op({ qname: "a:spread", name: "s-p-r-e-a-d" }),
      op({ qname: "b:tight", name: "sprea" }),
    ];
    expect(searchOps(named, "spr").map((o) => o.qname)).toEqual(["b:tight", "a:spread"]);
  });

  it("is case and accent insensitive", () => {
    expect(searchOps(CATALOGUE, "HEX").map((o) => o.qname)).toContain("hex:encode");
  });

  it("caps the result and breaks ties by name length, then qualified name", () => {
    const ties = [
      op({ qname: "b:go", name: "go" }),
      op({ qname: "a:gopher", name: "gopher" }),
      op({ qname: "a:goa", name: "goa" }),
    ];
    expect(searchOps(ties, "go").map((o) => o.qname)).toEqual(["b:go", "a:goa", "a:gopher"]);
    expect(searchOps(ties, "go", 2)).toHaveLength(2);
    expect(searchOps(ties, "go", 0)).toEqual([]);
  });
});

describe("vocabulary names in the ranking", () => {
  const VOCABS = [
    "hex-content:decode",
    "hex-content:encode",
    "hexdump:decode",
    "hexdump:encode",
    "hex:decode",
    "hex:encode",
    "base32:decode",
    "base32:encode",
    "base64:decode",
    "base64:encode",
    "modhex:decode",
    "quoted-printable:decode",
    "quoted-printable:encode",
  ].map((qname) => op({ qname }));
  const first = (q: string) => searchOps(VOCABS, q)[0]?.qname;

  it("puts the vocabulary that equals the token first", () => {
    expect(first("hex decode")).toBe("hex:decode");
    expect(first("hex encode")).toBe("hex:encode");
    expect(first("decode hex")).toBe("hex:decode");
  });

  it("ranks exact word matches above prefix matches of a vocabulary", () => {
    const names = searchOps(VOCABS, "hex decode").map((o) => o.qname);
    expect(names.slice(0, 3)).toEqual(["hex:decode", "hex-content:decode", "hexdump:decode"]);
  });

  it("falls back to the qualified-name order when no vocabulary equals the token", () => {
    expect(searchOps(VOCABS, "base decode").map((o) => o.qname)).toEqual([
      "base32:decode",
      "base64:decode",
    ]);
  });

  it("still finds a vocabulary by a prefix", () => {
    expect(searchOps(VOCABS, "quot").map((o) => o.qname)).toEqual([
      "quoted-printable:decode",
      "quoted-printable:encode",
    ]);
  });
});

describe("subsequenceSpan", () => {
  it("returns the span of the greedy match, or -1 when a letter is missing", () => {
    expect(subsequenceSpan("base64", "b64")).toBe(6);
    expect(subsequenceSpan("base64", "xyz")).toBe(-1);
  });
});
