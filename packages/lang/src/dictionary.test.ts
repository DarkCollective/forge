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
import { describe, expect, test } from "vitest";
import { CORE_VOCAB, createDictionary, isPrivateName, listWords } from "./dictionary.js";
import { ForgeError } from "./errors.js";
import type { Dictionary, DictionaryTxn, Scope, WordEntry, WordMeta } from "./types.js";

function metaOf(tag: string): WordMeta {
  return { name: tag } as unknown as WordMeta;
}

/** A minimal fake word: only identity fields matter to the dictionary. */
function word(vocab: string, name: string, tag = `${vocab}:${name}`): WordEntry {
  return {
    kind: "fl",
    qname: `${vocab}:${name}`,
    name,
    vocab,
    meta: metaOf(tag),
    code: null,
  };
}

/** Commit the given words (core ones trusted) into a fresh dictionary. */
function build(...entries: WordEntry[]): Dictionary {
  const d = createDictionary();
  const t = d.begin();
  for (const e of entries) t.define(e, { trusted: e.vocab === CORE_VOCAB });
  t.commit();
  return d;
}

function scope(current: string, ...using: string[]): Scope {
  return { current, using };
}

function codeOf(fn: () => unknown): ForgeError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error("expected a ForgeError");
}

describe("vocabularies", () => {
  test("a new dictionary has only core, and it is read-only", () => {
    const d = createDictionary();
    expect(d.vocabs()).toEqual(["core"]);
    expect(d.vocab("core")?.readonly).toBe(true);
    expect(d.vocab("core")?.name).toBe("core");
    expect(d.vocab("nope")).toBeUndefined();
  });

  test("ensureVocab creates an empty writable vocabulary, idempotently", () => {
    const d = createDictionary();
    const t = d.begin();
    const v = t.ensureVocab("alpha");
    expect(v).toMatchObject({ name: "alpha", readonly: false });
    expect(v.words.size).toBe(0);
    expect(t.ensureVocab("alpha").name).toBe("alpha");
    expect(t.ensureVocab("core").readonly).toBe(true);
    expect(t.vocab("alpha")).toBeDefined();
    expect(d.vocab("alpha")).toBeUndefined();
    t.commit();
    expect(d.vocab("alpha")).toMatchObject({ readonly: false });
  });

  test("vocabs() are sorted by code point, not UTF-16 unit", () => {
    const d = createDictionary();
    const t = d.begin();
    for (const n of ["\u{1F600}", "Ａ", "b", "a", "Z"]) t.ensureVocab(n);
    expect(t.vocabs()).toEqual(["Z", "a", "b", "core", "Ａ", "\u{1F600}"]);
    t.commit();
    expect(d.vocabs()).toEqual(["Z", "a", "b", "core", "Ａ", "\u{1F600}"]);
  });

  test("txn.vocab sees staged words in a snapshot, and committed vocabs untouched by the txn", () => {
    const d = build(word("a", "x"));
    const t = d.begin();
    expect(t.vocab("a")).toBe(d.vocab("a"));
    t.define(word("a", "y"));
    const snap = t.vocab("a");
    expect([...(snap?.words.keys() ?? [])].sort()).toEqual(["x", "y"]);
    expect(d.vocab("a")?.words.has("y")).toBe(false);
    expect(t.vocab("zzz")).toBeUndefined();
  });
});

describe("unqualified resolution (6.2)", () => {
  const core = word("core", "dup");
  const coreRot = word("core", "rot");
  const demoDup = word("demo", "dup");
  const classicalRot = word("classical", "rot");
  const alphaGreet = word("alpha", "greet");
  const betaGreet = word("beta", "greet");
  const libWho = word("lib", "who");
  const appWho = word("app", "who");
  const d = build(
    core,
    coreRot,
    demoDup,
    classicalRot,
    alphaGreet,
    betaGreet,
    libWho,
    appWho,
    word("lib", "_secret"),
    word("app", "_mine"),
    word("core", "_corehidden"),
  );

  test("current vocabulary", () => {
    expect(d.resolve("who", scope("app"))).toBe(appWho);
  });

  test("imports", () => {
    expect(d.resolve("who", scope("user", "lib"))).toBe(libWho);
  });

  test("core, implicitly", () => {
    expect(d.resolve("dup", scope("user"))).toBe(core);
    expect(d.resolve("dup", scope("user", "lib"))).toBe(core);
  });

  test("current vocabulary shadows core (D28)", () => {
    expect(d.resolve("rot", scope("classical"))).toBe(classicalRot);
    expect(d.resolve("rot", scope("user"))).toBe(coreRot);
    expect(d.resolve("dup", scope("demo"))).toBe(demoDup);
    expect(d.resolve("dup", scope("user"))).toBe(core);
  });

  test("current vocabulary beats an import", () => {
    expect(d.resolve("who", scope("app", "lib"))).toBe(appWho);
  });

  test("imports shadow core", () => {
    expect(d.resolve("rot", scope("user", "classical"))).toBe(classicalRot);
    expect(d.resolve("dup", scope("user", "demo"))).toBe(demoDup);
  });

  test("two imports defining the name are ambiguous, listing candidates in USING order", () => {
    const e = codeOf(() => d.resolve("greet", scope("user", "beta", "alpha")));
    expect(e.code).toBe("E_AMBIGUOUS");
    expect(e.detail).toEqual({ name: "greet", candidates: ["beta:greet", "alpha:greet"] });
    expect(
      codeOf(() => d.resolve("greet", scope("user", "alpha", "beta"))).detail["candidates"],
    ).toEqual(["alpha:greet", "beta:greet"]);
  });

  test("ambiguity never involves the current vocabulary or core", () => {
    expect(d.resolve("greet", scope("alpha", "beta"))).toBe(alphaGreet);
    expect(d.resolve("rot", scope("user", "classical", "core"))).toBe(classicalRot);
  });

  test("a repeated import is not ambiguous with itself; core in USING is ignored", () => {
    expect(d.resolve("greet", scope("user", "alpha", "alpha"))).toBe(alphaGreet);
    expect(d.resolve("dup", scope("user", "core"))).toBe(core);
  });

  test("an import naming a missing vocabulary is skipped", () => {
    expect(d.resolve("greet", scope("user", "ghost", "alpha"))).toBe(alphaGreet);
  });

  test("a current vocabulary that does not exist falls through to imports and core", () => {
    expect(d.resolve("dup", scope("ghost"))).toBe(core);
  });

  test("undefined", () => {
    const e = codeOf(() => d.resolve("nosuch", scope("user", "lib")));
    expect(e.code).toBe("E_UNDEFINED");
    expect(e.detail).toEqual({ name: "nosuch", vocab: "user" });
  });

  test("private words: visible in the current vocabulary only, never via USING or core", () => {
    expect(d.resolve("_mine", scope("app")).qname).toBe("app:_mine");
    expect(d.resolve("_mine", scope("app", "lib")).qname).toBe("app:_mine");
    expect(codeOf(() => d.resolve("_secret", scope("user", "lib"))).code).toBe("E_UNDEFINED");
    expect(codeOf(() => d.resolve("_mine", scope("lib", "app"))).code).toBe("E_UNDEFINED");
    expect(codeOf(() => d.resolve("_corehidden", scope("user"))).code).toBe("E_UNDEFINED");
    expect(d.resolve("_corehidden", scope("core")).qname).toBe("core:_corehidden");
  });

  test("isPrivateName", () => {
    expect(isPrivateName("_x")).toBe(true);
    expect(isPrivateName("x_")).toBe(false);
    expect(isPrivateName("")).toBe(false);
  });
});

describe("qualified resolution (6.3)", () => {
  const pub = word("one", "pub");
  const priv = word("one", "_hidden");
  const d = build(pub, priv, word("core", "dup"));

  test("resolves through exactly the named vocabulary", () => {
    expect(d.resolveQualified("one", "pub", "two")).toBe(pub);
    expect(d.resolveQualified("core", "dup", "one").qname).toBe("core:dup");
  });

  test("private words only from inside their own vocabulary", () => {
    expect(d.resolveQualified("one", "_hidden", "one")).toBe(priv);
    const e = codeOf(() => d.resolveQualified("one", "_hidden", "two"));
    expect(e.code).toBe("E_PRIVATE");
    expect(e.detail).toEqual({ name: "_hidden" });
  });

  test("missing vocabulary and missing word", () => {
    const a = codeOf(() => d.resolveQualified("ghost", "x", "one"));
    expect(a.code).toBe("E_NO_VOCAB");
    expect(a.detail).toEqual({ vocab: "ghost" });
    const b = codeOf(() => d.resolveQualified("one", "nosuch", "one"));
    expect(b.code).toBe("E_UNDEFINED");
    expect(b.detail).toEqual({ name: "nosuch", vocab: "one" });
    // undefined takes precedence over privacy
    expect(codeOf(() => d.resolveQualified("one", "_nosuch", "two")).code).toBe("E_UNDEFINED");
  });

  test("never ambiguous; ignores imports", () => {
    const dd = build(word("alpha", "greet"), word("beta", "greet"));
    expect(dd.resolveQualified("alpha", "greet", "user").qname).toBe("alpha:greet");
  });
});

describe("transactions", () => {
  test("staged definitions are visible in the txn but not in the dictionary until commit", () => {
    const d = createDictionary();
    const t = d.begin();
    const f = word("user", "f");
    expect(t.define(f)).toBeUndefined();
    expect(t.resolve("f", scope("user"))).toBe(f);
    expect(t.resolveQualified("user", "f", "x")).toBe(f);
    expect(t.vocabs()).toContain("user");
    expect(codeOf(() => d.resolve("f", scope("user"))).code).toBe("E_UNDEFINED");
    expect(d.vocab("user")).toBeUndefined();
    t.commit();
    expect(d.resolve("f", scope("user"))).toBe(f);
  });

  test("define creates the target vocabulary if needed", () => {
    const d = createDictionary();
    const t = d.begin();
    t.define(word("fresh", "w"));
    t.commit();
    expect(d.vocab("fresh")?.words.size).toBe(1);
  });

  test("rollback discards definitions, vocabularies, aliases and META", () => {
    const d = build(word("user", "old"));
    const old = d.resolve("old", scope("user"));
    const before = old.meta;
    const t = d.begin();
    const f = word("user", "f");
    t.ensureVocab("brandnew");
    t.define(f);
    t.define(word("user", "old"));
    t.alias(f, "ff");
    t.stageMeta(old, metaOf("changed"));
    t.rollback();
    expect(d.vocabs()).toEqual(["core", "user"]);
    expect([...(d.vocab("user")?.words.keys() ?? [])]).toEqual(["old"]);
    expect(d.resolve("old", scope("user"))).toBe(old);
    expect(old.meta).toBe(before);
  });

  test("a failure mid-unit followed by rollback leaves the dictionary unchanged, including META", () => {
    const d = build(word("user", "a"), word("core", "dup"));
    const a = d.resolve("a", scope("user"));
    const metaBefore = a.meta;
    const snapshot = JSON.stringify([...(d.vocab("user")?.words.keys() ?? [])]);
    const t = d.begin();
    try {
      t.define(word("user", "b"));
      t.stageMeta(a, metaOf("edit"));
      t.define(word("user", "b")); // E_REDEFINED mid-unit
      throw new Error("unreachable");
    } catch (e) {
      expect((e as ForgeError).code).toBe("E_REDEFINED");
      t.rollback();
    }
    expect(JSON.stringify([...(d.vocab("user")?.words.keys() ?? [])])).toBe(snapshot);
    expect(a.meta).toBe(metaBefore);
    expect(d.vocabs()).toEqual(["core", "user"]);
  });

  test("a failed operation does not by itself change what a later commit applies", () => {
    const d = createDictionary();
    const t = d.begin();
    t.define(word("user", "a"));
    expect(codeOf(() => t.define(word("user", "a"))).code).toBe("E_REDEFINED");
    expect(codeOf(() => t.define(word("core", "x"))).code).toBe("E_READONLY");
    t.commit();
    expect(d.vocab("user")?.words.size).toBe(1);
    expect(d.vocab("core")?.words.size).toBe(0);
  });

  test("staged META is applied on commit only, last edit wins", () => {
    const d = build(word("user", "a"));
    const a = d.resolve("a", scope("user"));
    const orig = a.meta;
    const t = d.begin();
    const m1 = metaOf("m1");
    const m2 = metaOf("m2");
    t.stageMeta(a, m1);
    t.stageMeta(a, m2);
    expect(a.meta).toBe(orig);
    t.commit();
    expect(a.meta).toBe(m2);
  });

  test("a closed transaction rejects every mutation", () => {
    const d = createDictionary();
    for (const finish of ["commit", "rollback"] as const) {
      const t = d.begin();
      t[finish]();
      const w = word("user", "w");
      const ops: (() => unknown)[] = [
        () => t.ensureVocab("x"),
        () => t.define(w),
        () => t.alias(w, "ww"),
        () => t.stageMeta(w, metaOf("m")),
        () => t.commit(),
        () => t.rollback(),
      ];
      for (const op of ops) expect(codeOf(op).code).toBe("E_INTERNAL");
    }
  });

  test("two sequential transactions accumulate", () => {
    const d = createDictionary();
    const t1 = d.begin();
    t1.define(word("user", "a"));
    t1.commit();
    const t2 = d.begin();
    t2.define(word("user", "b"));
    expect(t2.vocab("user")?.words.size).toBe(2);
    t2.commit();
    expect(d.vocab("user")?.words.size).toBe(2);
  });
});

describe("redefinition (6.5, D5)", () => {
  test("within one unit: E_REDEFINED, naming the word and vocabulary", () => {
    const t = createDictionary().begin();
    t.define(word("user", "f"));
    const e = codeOf(() => t.define(word("user", "f")));
    expect(e.code).toBe("E_REDEFINED");
    expect(e.detail).toEqual({ name: "f", vocab: "user" });
  });

  test("the same name in different vocabularies is not a redefinition", () => {
    const t = createDictionary().begin();
    t.define(word("a", "f"));
    expect(t.define(word("b", "f"))).toBeUndefined();
  });

  test("across units: allowed, returns the replaced entry, old entry object untouched", () => {
    const d = createDictionary();
    const t1 = d.begin();
    const f1 = word("user", "f", "v1");
    t1.define(f1);
    t1.commit();

    const caller = d.resolve("f", scope("user")); // "compiled" against f1
    const t2 = d.begin();
    const f2 = word("user", "f", "v2");
    expect(t2.define(f2)).toBe(f1);
    t2.commit();

    expect(d.resolve("f", scope("user"))).toBe(f2);
    expect(caller).toBe(f1);
    expect(f1.meta).toMatchObject({ name: "v1" });
    expect(f1.qname).toBe("user:f");
    expect(d.vocab("user")?.words.get("f")).toBe(f2);
  });

  test("console mode (allowRedefine): repeated definition in one txn; replaced is the staged entry", () => {
    const d = createDictionary();
    const t = d.begin();
    const f1 = word("user", "f");
    const f2 = word("user", "f");
    const f3 = word("user", "f");
    expect(t.define(f1, { allowRedefine: true })).toBeUndefined();
    // early binding inside one input: the first segment still sees f1
    const seen = t.resolve("f", scope("user"));
    expect(t.define(f2, { allowRedefine: true })).toBe(f1);
    expect(t.define(f3, { allowRedefine: true })).toBe(f2);
    expect(seen).toBe(f1);
    expect(t.resolve("f", scope("user"))).toBe(f3);
    t.commit();
    expect(d.resolve("f", scope("user"))).toBe(f3);
  });

  test("allowRedefine false is the same as unit mode", () => {
    const t = createDictionary().begin();
    t.define(word("user", "f"), { allowRedefine: false });
    expect(codeOf(() => t.define(word("user", "f"), { allowRedefine: false })).code).toBe(
      "E_REDEFINED",
    );
  });

  test("defining a name that exists only elsewhere is a new shadowing word", () => {
    const d = build(word("core", "dup"));
    const t = d.begin();
    expect(t.define(word("demo", "dup"))).toBeUndefined();
  });

  test("aliases: collisions are E_REDEFINED", () => {
    const t = createDictionary().begin();
    const f = word("user", "f");
    const g = word("user", "g");
    t.define(f);
    t.define(g);
    t.alias(f, "ff");
    expect(t.resolve("ff", scope("user"))).toBe(f);
    expect(codeOf(() => t.alias(g, "ff")).code).toBe("E_REDEFINED");
    expect(codeOf(() => t.alias(g, "f")).detail).toEqual({ name: "f", vocab: "user" });
    expect(codeOf(() => t.define(word("user", "ff"))).code).toBe("E_REDEFINED");
  });

  test("an alias rebinds a name committed by an earlier unit", () => {
    const d = build(word("user", "old"));
    const t = d.begin();
    const f = word("user", "f");
    t.define(f);
    t.alias(f, "old");
    t.commit();
    expect(d.resolve("old", scope("user"))).toBe(f);
  });

  test("aliases map to the same entry and are listed", () => {
    const d = createDictionary();
    const t = d.begin();
    const f = word("user", "f");
    t.define(f);
    t.alias(f, "ff");
    t.commit();
    expect(d.vocab("user")?.words.get("ff")).toBe(f);
    expect(listWords(d, "user")).toEqual(["f", "ff"]);
  });
});

describe("read-only core", () => {
  test("define into core is E_READONLY unless trusted", () => {
    const d = createDictionary();
    const t = d.begin();
    const e = codeOf(() => t.define(word("core", "x")));
    expect(e.code).toBe("E_READONLY");
    expect(e.detail).toEqual({ vocab: "core" });
    expect(codeOf(() => t.define(word("core", "x"), { trusted: false })).code).toBe("E_READONLY");
    expect(codeOf(() => t.define(word("core", "x"), { allowRedefine: true })).code).toBe(
      "E_READONLY",
    );
    const x = word("core", "x");
    expect(t.define(x, { trusted: true })).toBeUndefined();
    t.commit();
    expect(d.resolve("x", scope("user"))).toBe(x);
    expect(d.vocab("core")?.readonly).toBe(true);
  });

  test("trusted loads may redefine core words; the old entry is returned", () => {
    const x1 = word("core", "x");
    const d = build(x1);
    const t = d.begin();
    expect(t.define(word("core", "x"), { trusted: true, allowRedefine: true })).toBe(x1);
  });

  test("aliases in core need the entry to have been defined trusted in this txn", () => {
    const d = createDictionary();
    const t = d.begin();
    const x = word("core", "x");
    expect(codeOf(() => t.alias(x, "xx")).code).toBe("E_READONLY");
    t.define(x, { trusted: true });
    t.alias(x, "xx");
    t.commit();
    expect(d.resolve("xx", scope("user"))).toBe(x);
    const t2 = d.begin();
    expect(codeOf(() => t2.alias(x, "yy")).code).toBe("E_READONLY");
  });

  test("a vocabulary created in a txn is writable and not read-only", () => {
    const t = createDictionary().begin();
    t.ensureVocab("v");
    expect(t.vocab("v")?.readonly).toBe(false);
    expect(t.define(word("v", "w"))).toBeUndefined();
  });
});

describe("listing", () => {
  test("listWords excludes private words and sorts by code point", () => {
    const names = ["b", "_p", "\u{1F600}", "Ａ", "a", "Z", "_q"];
    const d = build(...names.map((n) => word("v", n)));
    expect(listWords(d, "v")).toEqual(["Z", "a", "b", "Ａ", "\u{1F600}"]);
    expect(d.vocab("v")?.words.has("_p")).toBe(true);
  });

  test("listWords works on a transaction and fails on an unknown vocabulary", () => {
    const d = createDictionary();
    const t = d.begin();
    t.define(word("v", "w"));
    expect(listWords(t, "v")).toEqual(["w"]);
    expect(listWords(d, "core")).toEqual([]);
    const e = codeOf(() => listWords(d, "v"));
    expect(e.code).toBe("E_NO_VOCAB");
    expect(e.detail).toEqual({ vocab: "v" });
  });
});

describe("spec examples", () => {
  test("15.3 ambiguity, 15.4 shadowing", () => {
    const d: Dictionary = build(
      word("alpha", "greet"),
      word("beta", "greet"),
      word("core", "dup"),
      word("demo", "dup"),
    );
    const e = codeOf(() => d.resolve("greet", scope("user", "alpha", "beta")));
    expect(e.detail).toEqual({ name: "greet", candidates: ["alpha:greet", "beta:greet"] });
    expect(d.resolveQualified("alpha", "greet", "user").qname).toBe("alpha:greet");
    expect(d.resolve("dup", scope("demo")).qname).toBe("demo:dup");
    expect(d.resolve("dup", scope("user")).qname).toBe("core:dup");
    expect(d.resolveQualified("demo", "dup", "user").qname).toBe("demo:dup");
    expect(d.resolveQualified("core", "dup", "user").qname).toBe("core:dup");
  });

  test("C77: redefinition keeps old references (no forward rebinding of callers)", () => {
    const d = createDictionary();
    const t1: DictionaryTxn = d.begin();
    const f1 = word("user", "f");
    t1.define(f1);
    t1.commit();
    const g = { calls: d.resolve("f", scope("user")) }; // g compiled against f1
    const t2 = d.begin();
    const replaced = t2.define(word("user", "f"));
    t2.commit();
    expect(replaced).toBe(f1);
    expect(g.calls).toBe(f1);
    expect(d.resolve("f", scope("user"))).not.toBe(f1);
  });
});
