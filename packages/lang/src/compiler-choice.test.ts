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
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { ForgeError } from "./errors.js";
import { WORD_META_SCHEMA } from "./meta.js";
import { createRuntime } from "./runtime.js";
import type { ForgeRuntime, WordMeta } from "./types.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(WORD_META_SCHEMA);

function rt(): ForgeRuntime {
  return createRuntime();
}

function failure(fn: () => unknown): ForgeError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ForgeError);
    return e as ForgeError;
  }
  throw new Error("expected a ForgeError");
}

const PAD =
  'CHOICE: padding\n  option pkcs7 "PKCS#7 padding." ;\n  option none "No padding." ;\n;\n';

describe("CHOICE: the form", () => {
  test("options are words, integers or strings; the text of an integer is the option", () => {
    const r = rt();
    r.load('CHOICE: sizes option 128 ; option 0x10 "hex" ; option "Upper case" ; option abc ; ;');
    r.load(": f ( bytes s:choice<sizes>=128 -- bytes ) ;");
    expect(r.meta("user:f").params[0]?.options).toEqual(["128", "0x10", "Upper case", "abc"]);
    expect(r.meta("user:f").effect.text).toBe(
      '( bytes s:choice{128|0x10|"Upper case"|abc}=128 -- bytes )',
    );
  });

  test("the entry is stored in the vocabulary, with options, help, hash and source", () => {
    const r = rt();
    r.load(`IN: v\n${PAD}`, { unit: "v.fth" });
    const t = r.dictionary.vocab("v")?.choices?.get("padding");
    expect(t?.qname).toBe("v:padding");
    expect(t?.options).toEqual(["pkcs7", "none"]);
    expect(t?.docs).toEqual({ pkcs7: "PKCS#7 padding.", none: "No padding." });
    expect(t?.hash).toBe(sha("{pkcs7|none}"));
    expect(t?.source.unit).toBe("v.fth");
    expect(t?.source.text).toBe(PAD.trimEnd());
  });

  test("a type and a word may share a name", () => {
    const r = rt();
    r.load(`${PAD}: padding ( bytes p:choice<padding> -- bytes ) ;`);
    expect(r.meta("user:padding").params[0]?.options).toEqual(["pkcs7", "none"]);
  });

  test("a type name with < or > is E_NAME; a bad name is E_NAME", () => {
    expect(failure(() => rt().load("CHOICE: a>b option x ; ;")).code).toBe("E_NAME");
    expect(failure(() => rt().load("CHOICE: a<b option x ; ;")).code).toBe("E_NAME");
    expect(failure(() => rt().load("CHOICE: Bad:name option x ; ;")).code).toBe("E_NAME");
    expect(failure(() => rt().load("CHOICE: 12 option x ; ;")).code).toBe("E_NAME");
  });

  test("malformed structure is E_SYNTAX", () => {
    expect(failure(() => rt().load("CHOICE:")).code).toBe("E_SYNTAX");
    expect(failure(() => rt().load("CHOICE: t option a ;")).code).toBe("E_SYNTAX");
    expect(failure(() => rt().load("CHOICE: t pick a ; ;")).code).toBe("E_SYNTAX");
    expect(failure(() => rt().load("CHOICE: t 7 ;")).code).toBe("E_SYNTAX");
    expect(failure(() => rt().load("CHOICE: t option a")).code).toBe("E_SYNTAX");
  });

  test("a bad option clause is E_META with detail.clause option", () => {
    const bad = [
      "CHOICE: t ;",
      "CHOICE: t option ; ;",
      'CHOICE: t option "" ; ;',
      "CHOICE: t option a b ; ;",
      'CHOICE: t option a "x" "y" ; ;',
      "CHOICE: t option 1.5 ; ;",
      "CHOICE: t option true ; ;",
      "CHOICE: t option v:w ; ;",
      "CHOICE: t option [ ; ;",
      "CHOICE: t option a ; option a ; ;",
      'CHOICE: t option 7 ; option "7" ; ;',
      'CHOICE: t option a "line\\nbreak" ; ;',
      `CHOICE: t option a "${"x".repeat(201)}" ; ;`,
      `CHOICE: t option "${"y".repeat(129)}" ; ;`,
    ];
    for (const src of bad) {
      const e = failure(() => rt().load(src));
      expect(e.code, src).toBe("E_META");
      expect(e.detail.clause, src).toBe("option");
    }
  });

  test("the caps: 128 code points per option, 200 for help, 1024 options", () => {
    const r = rt();
    const long = "\u{1F600}".repeat(128);
    r.load(`CHOICE: ok option "${long}" "${"h".repeat(200)}" ; ;`);
    expect(r.dictionary.vocab("user")?.choices?.get("ok")?.options[0]).toBe(long);
    const many = (n: number): string =>
      `CHOICE: m ${Array.from({ length: n }, (_, i) => `option o${i} ;`).join(" ")} ;`;
    r.load(many(1024));
    expect(r.dictionary.vocab("user")?.choices?.get("m")?.options).toHaveLength(1024);
    const e = failure(() => rt().load(many(1025)));
    expect(e.code).toBe("E_META");
    expect(e.detail.clause).toBe("option");
  });

  test("a type twice in one unit is E_REDEFINED; across units it is allowed", () => {
    const r = rt();
    expect(failure(() => r.load("CHOICE: t option a ; ; CHOICE: t option b ; ;")).code).toBe(
      "E_REDEFINED",
    );
    expect(r.dictionary.vocab("user")?.choices?.size ?? 0).toBe(0);
    r.load("CHOICE: t option a ; ;");
    const w = r.load("CHOICE: t option b ; ;");
    expect(w.warnings.map((x) => x.code)).toEqual(["W_REDEFINED"]);
    expect(r.dictionary.vocab("user")?.choices?.get("t")?.options).toEqual(["b"]);
  });

  test("a failed unit leaves no type behind", () => {
    const r = rt();
    expect(failure(() => r.load("CHOICE: t option a ; ; : f ( bytes -- ) nosuch ;")).code).toBe(
      "E_UNDEFINED",
    );
    expect(r.dictionary.vocab("user")?.choices?.get("t")).toBeUndefined();
  });

  test("core is read-only", () => {
    expect(failure(() => rt().load("IN: core CHOICE: t option a ; ;")).code).toBe("E_READONLY");
  });

  test("at the console a type may be redefined; words keep the options they copied", async () => {
    const r = rt();
    expect((await r.run("CHOICE: t option a ; option b ; ;")).ok).toBe(true);
    expect((await r.run(": f ( bytes m:choice<t> -- bytes ) ;")).ok).toBe(true);
    expect((await r.run("CHOICE: t option x ; ;")).ok).toBe(true);
    expect((await r.run(": g ( bytes m:choice<t> -- bytes ) ;")).ok).toBe(true);
    expect(r.meta("user:f").params[0]?.options).toEqual(["a", "b"]);
    expect(r.meta("user:g").params[0]?.options).toEqual(["x"]);
  });

  test("CHOICE: also works in a console input that runs code", async () => {
    const r = rt();
    const out = await r.run(
      'CHOICE: t option a ; ; : f ( s:str m:choice<t>=a -- str ) s ; "x" "a" f',
    );
    expect(out.ok, out.ok ? "" : out.error.message).toBe(true);
  });
});

describe("choice<…> references", () => {
  test("unqualified: current vocabulary, then USING: vocabularies", () => {
    const r = rt();
    r.load("IN: shared\nCHOICE: yesno option yes ; option no ; ;");
    r.load("IN: app\nUSING: shared ;\n: ask ( bytes a:choice<yesno>=yes -- bytes ) ;");
    expect(r.meta("app:ask").params[0]?.options).toEqual(["yes", "no"]);
    r.load("IN: app\nCHOICE: yesno option maybe ; ;\n: ask2 ( bytes a:choice<yesno> -- bytes ) ;");
    expect(r.meta("app:ask2").params[0]?.options).toEqual(["maybe"]);
  });

  test("two imports that define the name are E_AMBIGUOUS; qualification resolves it", () => {
    const r = rt();
    r.load("IN: a\nCHOICE: t option 1 ; ;");
    r.load("IN: b\nCHOICE: t option 2 ; ;");
    const e = failure(() => r.load("IN: c\nUSING: a b ;\n: f ( bytes m:choice<t> -- bytes ) ;"));
    expect(e.code).toBe("E_AMBIGUOUS");
    expect(e.detail.kind).toBe("choice");
    r.load("IN: c\nUSING: a b ;\n: f ( bytes m:choice<b:t> -- bytes ) ;");
    expect(r.meta("c:f").params[0]?.options).toEqual(["2"]);
  });

  test("an unqualified name is not found in a vocabulary that is not imported", () => {
    const r = rt();
    r.load("IN: shared\nCHOICE: t option a ; ;");
    const e = failure(() => r.load("IN: app\n: f ( bytes m:choice<t> -- bytes ) ;"));
    expect(e.code).toBe("E_UNDEFINED");
    expect(e.detail).toMatchObject({ kind: "choice", name: "t" });
  });

  test("errors: unknown type, unknown vocabulary, unknown qualified type, private type", () => {
    const r = rt();
    r.load("IN: shared\nCHOICE: _hidden option a ; ;\nCHOICE: pub option a ; ;");
    const code = (header: string): string =>
      failure(() => r.load(`IN: app\n: f ( bytes ${header} -- bytes ) ;`)).code;
    expect(code("m:choice<nosuch>")).toBe("E_UNDEFINED");
    expect(code("m:choice<shared:nosuch>")).toBe("E_UNDEFINED");
    expect(code("m:choice<novocab:pub>")).toBe("E_NO_VOCAB");
    expect(code("m:choice<shared:_hidden>")).toBe("E_PRIVATE");
  });

  test("a private type is usable inside its own vocabulary, also from a private word", () => {
    const r = rt();
    r.load("IN: v\nCHOICE: _t option a ; option b ; ;\n: _h ( bytes m:choice<_t> -- bytes ) ;");
    r.load("IN: v\n: pub ( bytes m:choice<v:_t>=b -- bytes ) ;");
    expect(r.meta("v:pub").params[0]?.options).toEqual(["a", "b"]);
  });

  test("the error is positioned at the header item", () => {
    const e = failure(() => rt().load("\n: f ( bytes\n  m:choice<nosuch> -- bytes ) ;"));
    expect(e.pos).toMatchObject({ line: 3, col: 3 });
    expect(e.word).toBe("user:f");
  });

  test("malformed references are E_HEADER", () => {
    const r = rt();
    r.load("CHOICE: t option a ; ;");
    for (const h of [
      "m:choice<t",
      "m:choice<>",
      "m:choice<a:b:c>",
      "m:choice<:t>",
      "m:choice<1x:t>",
      "m:choice< t>",
      "m:choice<t>x",
    ]) {
      expect(failure(() => r.load(`: f ( bytes ${h} -- bytes ) ;`)).code, h).toBe("E_HEADER");
    }
  });

  test("a default is checked against the options; a constraint is E_HEADER", () => {
    const r = rt();
    r.load("CHOICE: t option a ; option b ; ;");
    r.load(': f ( bytes m:choice<t>="b" -- bytes ) ;');
    expect(r.meta("user:f").params[0]?.default).toBe("b");
    expect(failure(() => r.load(": g ( bytes m:choice<t>=c -- bytes ) ;")).code).toBe("E_HEADER");
    expect(failure(() => r.load(": g ( bytes m:choice<t>[1] -- bytes ) ;")).code).toBe("E_HEADER");
  });

  test("a shared type is not accepted in an output", () => {
    const r = rt();
    r.load("CHOICE: t option a ; ;");
    expect(failure(() => r.load(": g ( bytes -- m:choice<t> ) ;")).code).toBe("E_HEADER");
  });
});

describe("a moved-to-shared header", () => {
  const inline = ": pad ( bytes p:choice{pkcs7|none}=pkcs7 q:int=1 -- bytes ) ;";
  const shared = `${PAD}: pad ( bytes p:choice<padding>=pkcs7 q:int=1 -- bytes ) ;`;

  test("effect text, effect and params are identical; source and hash differ", () => {
    const a = rt();
    const b = rt();
    a.load(inline);
    b.load(shared);
    const ma = a.meta("user:pad");
    const mb = b.meta("user:pad");
    expect(mb.effect.text).toBe(ma.effect.text);
    expect(JSON.stringify(mb.effect)).toBe(JSON.stringify(ma.effect));
    expect(JSON.stringify(mb.params)).toBe(JSON.stringify(ma.params));
    expect(mb.source.text).not.toBe(ma.source.text);
    expect(mb.hash).not.toBe(ma.hash);
    expect(ma.discovery).toBeUndefined();
    expect(mb.discovery?.optionDocs).toEqual({
      p: { pkcs7: "PKCS#7 padding.", none: "No padding." },
    });
  });

  test("the moved word gains exactly one `choice <typehash>` line", () => {
    const b = rt();
    b.load(shared);
    const m = b.meta("user:pad");
    const typeHash = sha("{pkcs7|none}");
    expect(m.hash).toBe(sha(`${m.source.text}\nchoice ${typeHash}`));
  });

  test("a word without a type reference hashes as before: source text, newline, dependencies", () => {
    const r = rt();
    r.load(": a ( bytes p:choice{x|y}=x -- bytes ) ;\n: b ( bytes -- bytes ) a ;");
    const a = r.meta("user:a");
    const b = r.meta("user:b");
    expect(a.hash).toBe(sha(`${a.source.text}\n`));
    expect(b.hash).toBe(sha(`${b.source.text}\nuser:a ${a.hash}`));
  });

  test("dependency lines come first, then the type lines sorted; a type used twice counts once", () => {
    const r = rt();
    r.load(`${PAD}CHOICE: other option q ; ;\n: dep ( bytes -- bytes ) ;`);
    r.load(
      ": w ( bytes a:choice<padding>=pkcs7 b:choice<other> c:choice<padding>=none -- bytes ) dep ;",
    );
    const m = r.meta("user:w");
    const lines = [sha("{pkcs7|none}"), sha("{q}")].sort().map((h) => `choice ${h}`);
    expect(m.hash).toBe(
      sha(`${m.source.text}\nuser:dep ${r.meta("user:dep").hash}\n${lines.join("\n")}`),
    );
  });

  test("option help, the type name and the order of definition do not change the hash; options do", () => {
    const h = (src: string): string => {
      const r = rt();
      r.load(src);
      return r.meta("user:w").hash;
    };
    const word = ": w ( bytes m:choice<t> -- bytes ) ;";
    const base = h(`CHOICE: t option a ; option b ; ;\n${word}`);
    expect(h(`CHOICE: t option a "help" ; option b "more" ; ;\n${word}`)).toBe(base);
    expect(h(`CHOICE: t option b ; option a ; ;\n${word}`)).not.toBe(base);
    expect(h(`CHOICE: t option a ; option b ; option c ; ;\n${word}`)).not.toBe(base);
    expect(h(`CHOICE: t option 1 ; option b ; ;\n${word}`)).not.toBe(base);
  });

  test("a word that calls a word with a type depends on that word's hash", () => {
    const h = (opts: string): string => {
      const r = rt();
      r.load(
        `CHOICE: t ${opts} ;\n: inner ( bytes m:choice<t> -- bytes ) ;\n: outer ( bytes -- bytes ) inner ;`,
      );
      return r.meta("user:outer").hash;
    };
    expect(h("option a ;")).not.toBe(h("option a ; option b ;"));
  });
});

describe("discovery.optionDocs", () => {
  const src = `${PAD}CHOICE: plain option a ; option b ; ;
: enc ( bytes p:choice<padding>=pkcs7 q:choice<plain>=a r:choice<padding> -- bytes ) ;
: bare ( bytes q:choice<plain>=a -- bytes ) ;`;

  test("per parameter name and option; options and parameters without help are omitted", () => {
    const r = rt();
    r.load(src);
    expect(r.meta("user:enc").discovery?.optionDocs).toEqual({
      p: { pkcs7: "PKCS#7 padding.", none: "No padding." },
      r: { pkcs7: "PKCS#7 padding.", none: "No padding." },
    });
    expect(r.meta("user:bare").discovery).toBeUndefined();
  });

  test("a later META: block keeps optionDocs next to the discovery clauses", () => {
    const r = rt();
    r.load(src);
    r.load('META: enc use-when "Pad data." ; param p "The padding scheme." ; ;');
    const d = r.meta("user:enc").discovery;
    expect(d?.useWhen).toBe("Pad data.");
    expect(d?.optionDocs?.p?.none).toBe("No padding.");
    r.load('META: enc doc "Second block." ; ;');
    expect(r.meta("user:enc").discovery?.optionDocs?.r?.pkcs7).toBe("PKCS#7 padding.");
    expect(r.meta("user:enc").doc).toBe("Second block.");
  });

  test("the metadata validates against meta.schema.json", () => {
    const r = rt();
    r.load(src);
    const meta: WordMeta = r.meta("user:enc");
    const json = JSON.parse(JSON.stringify(meta)) as unknown;
    expect(validateSchema(json), ajv.errorsText(validateSchema.errors)).toBe(true);
  });

  test("an option named __proto__ is kept as an own key", () => {
    const r = rt();
    r.load(
      'CHOICE: t option "__proto__" "odd" ; option b ; ;\n: w ( bytes m:choice<t> -- bytes ) ;',
    );
    const docs = r.meta("user:w").discovery?.optionDocs?.m;
    expect(Object.keys(docs ?? {})).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(docs, "__proto__")?.value).toBe("odd");
  });
});

describe("compatibility", () => {
  test("choice{a|b} headers parse exactly as before", () => {
    const r = rt();
    r.load(': m ( str c:choice{x|y}="y" -- str ) ;');
    expect(r.meta("user:m").params[0]).toMatchObject({ options: ["x", "y"], default: "y" });
    expect(r.meta("user:m").discovery).toBeUndefined();
  });

  test("choice<…> is E_HEADER when the parser has no resolver (primitive headers)", () => {
    expect(() =>
      createRuntime({
        primitives: [
          {
            vocab: "px",
            name: "p",
            effect: "( x:bytes m:choice<t> -- bytes )",
            fn: () => undefined,
          },
        ],
      }),
    ).toThrow(/type references need a source unit/);
  });
});
