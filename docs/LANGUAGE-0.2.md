# FL v0.2, additive wave: specification proposal

Status: **proposal for owner review** (WP 6.2). Nothing in this document is implemented, and no text of [LANGUAGE.md](LANGUAGE.md), [RECIPES.md](RECIPES.md) or [TOOLKIT.md](TOOLKIT.md) has been changed. LANGUAGE.md stays "v0.1, frozen" until the owner accepts this proposal; the implementation work packages of section 15 then amend it.

The owner has approved a narrow unfreeze: **additive changes only**, in `packages/lang` and `packages/ops` (not `packages/recipe` or `packages/worker`), each with its spec. Existing FL code, vectors and word hashes keep working unchanged. Out of scope, and left in [TOOLKIT.md](TOOLKIT.md) §11 for later: breaking fixes (group L-E), the mutable buffer, the kernel tier, the `ext` tag, friend visibility, forward declarations, record literals, JSON words.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. Section references of the form "§5.9" mean LANGUAGE.md unless a file is named.

## Contents

0. How to read this document
1. `use-when` and `link`
2. `inverse`
3. The "not an operation" marker
4. Shared `choice` types
5. Reserved: `checks` for Magic
6. Examples on test vectors
7. `help.json`
8. Mid-body local binding
9. Memoised zero-input words
10. Linear builders
11. Control and lookup words
12. Maths and `str>num`
13. Promoted `util` words and typed failure words
14. Bug fix: `ForgeError.frames`
15. Implementation work packages
16. Tooling affected
17. Open questions for the owner
18. Decisions proposed
19. What this wave does not do

---

## 0. How to read this document

### 0.1 Summary

| # | Item | Mechanism | New syntax | Hash of existing words | New error code |
|---|---|---|---|---|---|
| 1 | `use-when`, `link` | two `META:` clauses; `WordMeta.discovery` | none beyond clause names | unchanged (META is not hashed, §12.4) | none (`E_META`) |
| 2 | `inverse` | one `META:` clause, same vocabulary only, checked at the end of the unit | clause name | unchanged | none |
| 3 | not an operation | `helper ;` clause sets `WordMeta.op` to `false` | clause name | unchanged | none |
| 4 | shared `choice` types | `CHOICE:` form, `choice<name>` in headers, option help | `CHOICE:`, `choice<…>` | unchanged for existing words; a word that uses a shared type hashes the type too | none |
| 5 | `checks` | **reserved**, shape only | clause name reserved | unchanged | none |
| 6 | examples | optional `"example"` key on a vector | none (JSON) | not applicable | none |
| 7 | `help.json` | new `@forge/ops` build output and export | none | `catalogue.json` unchanged byte for byte | none |
| 8 | mid-body locals | `:> name` | `:>` | unchanged | none (`E_REDEFINED`, `E_SYNTAX`, `E_UNDEFINED`) |
| 9 | memoised zero-input words | `MEMO:` defining form, evaluated on first use or by `warm()` | `MEMO:` | unchanged | none (`E_FORBIDDEN`, `E_LIMIT_*`) |
| 10 | linear builders | `collect`, `collect-bytes`, `collect-str` with `emit`, `emit-all` | none (words) | unchanged | none (`E_EFFECT`) |
| 11 | control and lookup | `cond case has-key? sort sort-by find any? all? exit` | none (words) | unchanged | none |
| 12 | maths, parsing | `ln log2 log10 exp sin cos tan asin acos atan atan2 sinh cosh tanh fpow pi str>num` | none (words) | unchanged | none |
| 13 | promotions, failure words | 20 `util` words copied into `core` by an FL prelude; `fail-coerce`, `fail-range` | none (words) | unchanged (the `util` and `raise` words stay as they are) | none |
| 14 | `ForgeError.frames` | keep the 32 outermost and 32 innermost frames | none | unchanged | none |

**No new error code** is introduced: the list stays at the 34 codes of §11.1. **No word, token or header form that is valid today changes meaning.** Section 0.3 lists the two observable differences (new `W_SHADOW` warnings, and the `core` word count).

### 0.2 Corpus figures, re-measured

TOOLKIT.md §2.5 measured the corpus when it had 150 `.fth` files. It has grown. The figures below were re-measured on 2026-11-12 in the worktree of WP 6.2 with throwaway scripts over `packages/ops/vocab/*.fth` (comments of the form `\ …` removed before counting tokens; a colon word is a line `: name ( … )`). They are labelled **current**; "TOOLKIT" is the figure printed there. Every item cites the current figure.

| Measure | TOOLKIT §2.5 | Current (2026-11-12) |
|---|---|---|
| `.fth` files, lines | 150, 16,792 | 208, 25,380 |
| Colon words (public, private) | 1,853 (439, 1,414) | 3,238 (617, 2,621) |
| TypeScript primitive modules, `definePrimitive(` calls | 70 modules, 119 primitives | 112 modules, 210 calls |
| Vector files, vectors | not stated (4,488 in §11.5) | 200 files, 7,302 vectors |
| Zero-input colon words | 101 | 152 |
| `CONSTANT` uses | 3 | 7 |
| `VARIABLE` uses | 106 | 106 |
| `choice{}` headers, distinct lists | 237, 116 | 311, 152 |
| Header `choice{}` occurrences whose list occurs at least twice | "70% copies" | 223 of 311 (72%), in 64 lists |
| Most repeated lists | `pkcs7\|none` 24, delimiter list 23, block modes 20 | the same: `pkcs7\|none` 24, delimiter list 23, `CBC\|CFB\|OFB\|CTR\|ECB` 20 |
| Qualified `raise:coerce` or `raise:range` calls | 253 | 517 (49 in `rsa.fth`, 27 in `ecdsa.fth`, 23 in `packets.fth`) |
| Public `util` words | 82 | 99 |
| Qualified `util:` calls, distinct words called | not stated | 1,092 calls to 92 words from outside `util.fth` (12 files also write `USING: util`) |

Not re-measured (kept from TOOLKIT, to be treated as stale lower bounds): else-if chains (234, 96 at depth 3 or more), single-use helpers (984 private words called once, 84 closure-binding helpers, 221 small single-use helpers), stack-shuffling density, and the measured FL step costs of TEA, SHA-1 and RC4. The WP that adds `npm run corpus-stats -w @forge/ops` (TOOLKIT L1) should refresh them.

Top qualified `util:` words by calls and by number of calling `.fth` files (current): `between?` 67 in 23 files, `cp>str` 61 in 26, `int>be-bytes` 48 in 24, `space?` 42 in 20, `starts-with?` 36 in 14, `repeat-str` 29 in 14, `pad-hex` 29 in 11, `check-int-range` 28 in 12, `digits>int` 25 in 19, `contains?` 24 in 12, `strip-space` 23 in 15, `trim-end` 22 in 16, `zero-bytes` 22 in 10, `trim-start` 17 in 13, `ends-with?` 18 in 10, `count-leading` 16 in 8, `dec-digit?` 18 in 8, `hex-digit?` 15 in 9.

### 0.3 Compatibility rules and the two observable differences

This proposal obeys five rules; every item restates how it meets them.

1. **No valid token changes meaning.** New tokens are drawn from forms that are `E_LEX` today (`:>`, `MEMO:`, `CHOICE:`; verified against `read()` in the worktree: each fails with "bad qualified name", see reader.ts line 401). New header syntax (`choice<…>`) is `E_HEADER` today. New `META:` clause names are `E_META` today (meta.ts line 960, "is not a known clause"; compiler.ts line 1209 for a clause that is not a word).
2. **No new reserved word.** `RESERVED_WORDS` (meta.ts line 70) is unchanged. `exit`, `emit`, `case` and the rest are ordinary `core` words. Name resolution (§6.2) puts the current vocabulary and imports before `core`, so any vocabulary that already defines or imports a word of the same name keeps resolving to its own word. A name that was `E_UNDEFINED` yesterday may resolve to a `core` word today; nothing else changes.
3. **Hashes.** §12.4 hashes `source.text` plus callee hashes. No existing source text changes, no existing callee changes, so no existing hash changes. Where a new form must be covered by the hash (a word that uses a shared `choice` type), the extra input is appended only for such words (item 4), so the hash string of every other word is byte-identical.
4. **Catalogue.** `catalogue.json` is byte-identical for an unchanged bundle: `CatalogueOp` gains nothing and `format` stays 1 (item 7). So `catalogue.version` and every recipe's recorded `catalogue` stay valid.
5. **Limits.** Every new construct is bounded by the existing §10.8 limits; the two that evaluate or collect (items 9 and 10) say how.

The two observable differences:

- **New `W_SHADOW` warnings.** A local that has the name of a *newly visible* `core` word now warns (§7, D45). Measured on the current corpus against the new `core` names of items 10 to 13: 16 header names in 6 `.fth` files (`sort` 10 times in 2 files, `case` 2, `exp` 2, `cond` 1, `find` 1). They are warnings, never errors; `@forge/ops` and the worker do not consult `LoadResult.warnings` (checked: no use outside tests); the FL console shows the warnings of the user's own input as info lines (apps/web/src/console/controller.ts line 188).
- **The `core` word count** (§13, "Total: 102 words", and the assertion `toHaveLength(102)` at runtime.test.ts line 74) grows. Items 10 to 13 add words; the exact total is fixed by section 15, WP 6.4 and later.

### 0.4 Conformance cases in this document

LANGUAGE.md §16 is read by the test harness (`packages/lang/test/conformance/parse.ts` line 923 reads `docs/LANGUAGE.md` only). Cases for features that do not exist yet must not go there, so the proposed cases below are fenced with the info string **`fl-proposed`**, in the §16.1 format, and numbered in a reserved range **C201 and up**. The first implementation WP (6.3) teaches the harness to read `docs/LANGUAGE-0.2.md` as well; each later WP changes the fence of *its own* cases from `fl-proposed` to `fl-test` when its feature lands. The final documentation WP folds the sections into LANGUAGE.md and keeps the numbers. Cases that use a fixture (`fx:now`) rely on the fixtures of §16.1.

A few behaviours cannot be asserted by the harness (step counts, which are excluded by §8; `warm()`; the shape of `ForgeError.frames`). Those are listed as unit tests to write in the named files.

---

## Group 1: discovery metadata

These items feed the help, reference and suggestion features of the UI. All of them are metadata: they add nothing to `source.text`, nothing to a hash and nothing to the catalogue, except item 4 where the header itself changes.

### 1. `use-when` and `link` clauses

**Motivation.** The catalogue has one free-text field per op, `doc`, which both explains what the op does and (when the author remembers) when to use it. The UI feature "help with examples, reference pages, suggestions" needs two separate, short, machine-usable facts: a one-line "reach for this when…" for the suggestion list, and links to the standard or article that defines the format. Today the corpus keeps such links in prose: `html.fth` carries the WHATWG URL in a `\` comment (lines 6 to 9), and 358 `see-also` clauses and 974 `param` clauses already show that authors use `META:` for exactly this kind of fact (current counts of clause lines in `vocab/*.fth`). `doc` is capped at 2000 code points and is rendered as text (§12.1), so a URL inside it is not a link. TOOLKIT §11 has no such item; this is new with WP 6.2.

**Grammar** (additions to §5.1 `meta-clause`):

```ebnf
meta-clause  = …
             | "use-when" , string , ";"
             | "link" , string , [ string ] , ";" ;
```

The first string of `link` is the URL, the optional second the label.

**Semantics.**

- `use-when`: singular, like `doc` (a second one is `E_META`, as `'doc' is already set`, meta.ts line 844). One line of plain text: no U+000A, U+000D or other C0 control character, no leading or trailing space. At most **160 code points** (shorter than the 200 of `category` and `version` because it is shown in a list row). Plain text only; the UI MUST NOT render it as HTML or Markdown.
- `link`: repeatable, in order. At most **8** per word. The URL MUST satisfy the grammar below and be at most **300 code points** (the §5.9 cap of 200 is too short for a Wikipedia path with percent escapes). The label is optional, at most **80 code points**, one line, plain text. A URL that occurs twice on one word (compared as written) is `E_META`. A word with no label is shown by the UI with the host as its label.

```ebnf
url        = "https://" , host , [ ":" , port ] , [ tail ] ;
host       = label , "." , label , { "." , label } ;      (* at least two labels *)
label      = alnum , { alnum | "-" } , ? last character not "-" ? ;   (* 1 to 63 characters, ASCII *)
port       = digit , { digit } ;                           (* 1 to 5 digits, 1 to 65535 *)
tail       = ( "/" | "?" | "#" ) , { url-char | pct } ;
url-char   = alnum | "-" | "." | "_" | "~" | ":" | "/" | "?" | "#" | "@" | "!" | "$"
           | "&" | "'" | "(" | ")" | "*" | "+" | "," | ";" | "=" ;
pct        = "%" , hexdigit , hexdigit ;
alnum      = ascii-letter | digit ;
```

Consequences, each a rule rather than an accident: the scheme is `https` only (no `http`, `javascript:`, `data:`, `mailto:`); there is no user-info (`@` is allowed only after the host); the last label MUST contain an ASCII letter (so a dotted-decimal IPv4 address is refused, and so is `localhost`); internationalised hosts are written in their `xn--` form and non-ASCII path characters are percent-encoded; the characters space, `"`, `<`, `>`, `\`, `^`, `` ` ``, `{`, `|`, `}`, `[`, `]` are refused everywhere. A violation is `E_META` with `detail.clause = "link"` and `detail.reason`.

The check is a syntax check. It does not fetch anything and does not restrict the host to a list; the UI decides how to present a link (it MUST use `rel="noopener noreferrer"`, show the host, and treat links from non-bundle units as untrusted; the CSP of UI.md §4 is unaffected because a link is navigation, not a load). See open question Q3 on whether `link` should be accepted at all in a user unit.

**Types.** `WordMeta` gains one optional member (the single place all of items 1, 2 and 4 write to):

```ts
export interface MetaLink {
  readonly url: string;
  readonly label: string | null;
}

/** Discovery metadata (items 1, 2, 4). Absent from WordMeta when nothing is set. */
export interface WordDiscovery {
  /** `use-when`. */
  readonly useWhen?: string;
  /** `link` clauses, in order. Omitted when empty. */
  readonly links?: readonly MetaLink[];
  /** `inverse`, a qualified name in the same vocabulary (item 2). */
  readonly inverse?: string;
  /** Per parameter name, per option, the help of a shared `choice` type (item 4). */
  readonly optionDocs?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface WordMeta {
  /* … all v0.1 members unchanged … */
  readonly discovery?: WordDiscovery;
}
```

`discovery` is **omitted** (not `{}`) when empty, and each member is omitted when unset. So the JSON of every existing word is byte-identical to today's, every `toEqual` in the existing tests still holds, and `meta.schema.json` gains an optional `$defs/discovery` (the schema keeps `additionalProperties: false`).

`WordMetaBuilder` (meta.ts) gets the clauses in `clauseFromArgs` (the `switch (keyword)` at lines 941 to 961) and in the `MetaClause` union. The `help` text (`renderHelp`, §12.5) gains two lines when present: `use when: <text>` after `category:`, and `links: <url> (<label>), …` before `effects:`. Both are optional and the existing `help` output is unchanged for words without them.

**Errors.** `E_META` for: a second `use-when`; a string longer than its cap or containing a line break; a link that fails the grammar, exceeds 8, or repeats; wrong arity (`use-when` takes exactly one string; `link` one or two); a private word (existing rule, meta.ts line 863). No other code.

**Before and after.** Today `base64.fth` documents only parameters:

```forth
META: decode
  param alphabet "The alphabet of the text: standard (+ /) or url (- _)." ;
;
```

After:

```forth
META: decode
  param alphabet "The alphabet of the text: standard (+ /) or url (- _)." ;
  use-when "Text that looks like letters, digits, plus and slash, ending in = signs." ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-4" "RFC 4648, section 4" ;
  link "https://en.wikipedia.org/wiki/Base64" ;
;
```

**Amends.** LANGUAGE.md §5.1 (`meta-clause`), §5.9 (clause list, caps), §12.1 (record), §12.2 (desugaring step 6), §12.5 (`help`), §17 (decision). RECIPES.md: none (the catalogue is unchanged; see item 7). Code: `packages/lang/src/types.ts`, `meta.ts`, `meta.schema.json`, `meta.test.ts`; `compiler.ts` needs no change for these two clauses (the clause loop at lines 1204 to 1229 already passes strings and words to `clauseFromArgs`).

**Compatibility.** Both names are unknown `META:` clauses today and fail with `E_META`, so no valid unit uses them. Hashes: §12.4 excludes META. Catalogue: untouched. `help` output: changes only for words that set the clauses.

**Conformance cases (proposed).**

```fl-test
# C201 use-when and link surface in the metadata
@unit
: f ( bytes -- bytes ) ;
META: f
  use-when "You have text that looks like Base64 and want the bytes." ;
  link "https://www.rfc-editor.org/rfc/rfc4648" "RFC 4648" ;
  link "https://en.wikipedia.org/wiki/Base64" ;
;
@meta
user:f discovery.useWhen = "You have text that looks like Base64 and want the bytes."
user:f discovery.links[0].url = "https://www.rfc-editor.org/rfc/rfc4648"
user:f discovery.links[0].label = "RFC 4648"
user:f discovery.links[1].label = null
```

```fl-test
# C202 a link must be https
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  link "http://example.com/a" ;
;
```

```fl-test
# C203 no user-info, no spaces, no address literals
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  link "https://user@example.com/a" ;
;
```

```fl-test
# C204 a host needs a letter in its last label
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  link "https://192.168.0.1/a" ;
;
```

```fl-test
# C205 use-when is one line
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  use-when "first line\nsecond line" ;
;
```

```fl-test
# C206 use-when may be set once
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  use-when "one" ;
  use-when "two" ;
;
```

```fl-test
# C207 more than eight links
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  link "https://a.example/1" ; link "https://a.example/2" ; link "https://a.example/3" ;
  link "https://a.example/4" ; link "https://a.example/5" ; link "https://a.example/6" ;
  link "https://a.example/7" ; link "https://a.example/8" ; link "https://a.example/9" ;
;
```

```fl-test
# C208 the new clauses do not change the hash
@unit
IN: v1
: w ( bytes -- bytes ) ;
META: w
  use-when "to compare hashes" ;
;
@unit
IN: v2
: w ( bytes -- bytes ) ;
@hash-eq
v1:w v2:w
```

**Alternative considered.** Reuse `see-also` with URLs, or allow URLs in `doc`. Rejected: `see-also` names words (it qualifies and validates them as names, meta.ts lines 908 to 918), and a URL in `doc` cannot be told from prose, so the UI would need a heuristic and a sanitiser. A second alternative, a `references` JSON side file per vocabulary, was rejected because it separates the link from the word it describes and cannot be checked at load time.

---

### 2. `inverse`

**Motivation.** Encoding ops come in pairs (`base64:encode` and `base64:decode`, `hex:encode` and `hex:decode`, `url:encode` and `url:decode`, `deflate` compress and inflate). The UI wants to suggest the partner ("add the inverse") and show it on the help page. `see-also` is not enough: it is symmetric only by hand, it does not say *which* related op undoes this one, and it accumulates (358 clauses today), so the UI cannot pick one.

**Grammar.**

```ebnf
meta-clause  = …
             | "inverse" , ( qname | word-name ) , ";" ;
```

**Semantics.** Compare `see-also` (§5.9), which accepts one or more names, qualifies unqualified names with the current vocabulary, does not require the target to exist and accumulates:

| | `see-also` | `inverse` |
|---|---|---|
| Names per clause | one or more | exactly one |
| Repeats | accumulate | singular: a second `inverse` on one word is `E_META` |
| Unqualified name | current vocabulary | current vocabulary |
| Qualified name | any vocabulary | **only the current vocabulary**; another vocabulary is `E_META` |
| Must exist | no | **yes**, in the same vocabulary, public, by the end of the unit (below) |
| Stored | `seeAlso`, fully qualified, deduplicated | `discovery.inverse`, a qualified name |
| May name itself | yes | **yes** (an involution: `classical:atbash`, a bit flip) |

- **Same vocabulary only.** The `@forge/ops` scanner derives unit dependencies from the vocabulary of every `qword` token (RECIPES.md §2.4, "Scanner" step 2), and a META clause is token text like any other. A cross-vocabulary `inverse` would therefore create the dependency cycles that PLAN §7 records as a gap for `see-also` (waves 2, 3 and 6). Restricting `inverse` to the vocabulary removes the problem; a pair that spans two vocabularies keeps using `see-also`. In the current corpus every encode/decode pair is within one vocabulary.
- **Existence.** A `META:` block may precede the target's definition (it may come "at any distance", §5.9), so the check is made in a pass after the whole unit has compiled (and, at the console, after the input has compiled, before it is committed). The target MUST be defined in the same vocabulary, in the unit's transaction or already committed, public, and not equal to a private name. An alias name is resolved to the canonical entry, so `inverse rot13` is stored as `classical:rot`. A missing target is `E_META` at the position of the clause, with `detail.clause = "inverse"` and `detail.name`. The runtime does not know what a catalogue op is, so "the target is an op" is not checked here; `buildHelp` checks it (item 7).
- **Symmetry is computed, not stored.** The runtime stores only the direction that was declared. `buildHelp` (item 7) produces the symmetric closure: if `A` declares `B` and `B` declares nothing, `B` gets `A`; if `B` declares `A` too, nothing changes; if `B` declares `C` other than `A`, or two words declare the same target and the target declares nothing, the build fails with a message naming the words. Declarations always win over implied entries. This keeps META local (a word never needs to know who points at it) and keeps one source of truth.

**Types.** `WordDiscovery.inverse?: string` (section 1). `WordMetaInit` needs no new member; `WordMetaBuilder.clause` gains `{ kind: "inverse"; name: string }`. The end-of-unit pass is `compiler.ts`'s, because only it holds the transaction.

**Errors.** `E_META`: wrong arity, a second `inverse`, a qualified name in another vocabulary, a target that does not exist or is private (end of unit), a private word with the clause. Reuses the existing code; `E_NAME` is not used because `see-also` does not use it either.

**Before and after.** Today the only link between the two words is a `see-also` that someone must remember to write twice. After:

```forth
IN: base64
META: decode
  inverse encode ;
;
```

`base64:encode` needs no clause; `help.json` lists `base64:decode` as its inverse.

**Amends.** LANGUAGE.md §5.1, §5.9 (clause list, the end-of-unit check, new paragraph "inverse"), §12.1 and §12.2. RECIPES.md §2.3 (a sentence: the catalogue does not carry `inverse`, see item 7). Code: `types.ts`, `meta.ts`, `meta.schema.json`, `compiler.ts` (the end-of-unit pass; the clause loop is unchanged), their tests.

**Compatibility.** `inverse` is an unknown clause (`E_META`) today. No hash or catalogue effect.

**Conformance cases (proposed).**

```fl-test
# C209 inverse is stored as declared, not made symmetric by the language
@unit
: enc ( bytes -- bytes ) ;
: dec ( bytes -- bytes ) ;
META: enc
  inverse dec ;
;
@meta
user:enc discovery.inverse = "user:dec"
```

```fl-test
# C210 inverse may come before the target is defined
@unit
: a ( bytes -- bytes ) ;
META: a
  inverse b ;
;
: b ( bytes -- bytes ) ;
@meta
user:a discovery.inverse = "user:b"
```

```fl-test
# C211 inverse must exist by the end of the unit
@unit-fails E_META
: a ( bytes -- bytes ) ;
META: a
  inverse nosuch ;
;
```

```fl-test
# C212 inverse stays inside the vocabulary
@unit
IN: other
: b ( bytes -- bytes ) ;
@unit-fails E_META
IN: user
: a ( bytes -- bytes ) ;
META: a
  inverse other:b ;
;
```

```fl-test
# C213 a word may be its own inverse; an alias resolves to the canonical word
@unit
: flip ( bytes -- bytes ) ;
META: flip
  alias flop ;
  inverse flop ;
;
@meta
user:flip discovery.inverse = "user:flip"
```

```fl-test
# C214 inverse is singular
@unit-fails E_META
: a ( bytes -- bytes ) ;
: b ( bytes -- bytes ) ;
META: a
  inverse b ;
  inverse a ;
;
```

**Alternative considered.** Make `inverse` automatically symmetric in the language (the clause on `A` also writes `B`'s record). Rejected: it makes a `META:` block edit another word's metadata, which breaks the rule that `META:` attaches to the word named in the block (§5.9), needs the target to exist when the clause is read (forcing definition order), and has no good answer when the two words are in different units. A second alternative, `inverse` accepting a list (a word with several inverses), was rejected as there is no corpus case: where an op has two partners (for example a checksum and its verifier) the relation is not an inverse.

---

### 3. A "public but not an operation" marker

**Motivation.** A public word with at least one input is an op (`WordMeta.op`, §5.7); RECIPES.md §2.2 then lists it in the catalogue if its parameters are UI types. Shared helpers that take inputs therefore had to live in internal vocabularies: `INTERNAL_VOCABS` in `packages/ops/src/types.ts` now holds eight names (`recipe bake util blockmode random list json asn1`), and `util` alone has 99 public words, 1,092 qualified calls and no category. PLAN §7 records the gap twice: wave 2 ("a public word whose params are all UI types becomes a catalogue op, so shared data needs zero-input words") and wave 5 ("no way to mark a public word with inputs as 'not an op'"); wave 7 adds that RECIPES §2.2 checks only the parameters after the first input. TOOLKIT §11.2 lists the marker together with friend visibility; this proposal takes the marker only.

**Grammar.**

```ebnf
meta-clause  = …
             | "helper" , ";" ;
```

**Semantics.** `helper ;` sets `WordMeta.op` to `false`. `exported` stays `true`: the word is public, found by `USING:`, listed by `words`, callable from other vocabularies, and shown by `help`. It simply is not an operation, so `isCatalogueOp` (catalogue.ts line 34, which tests `meta.op` first) excludes it, a recipe cannot name it (a step must be chainable, §2.2), and the UI does not list it. The clause takes no arguments; a repeat is harmless (idempotent); on a word with no input `op` is already false and the clause is accepted.

The builder already receives `op` through `WordMetaInit.op` (the compiler passes `base.op`, compiler.ts line 1192), so `helper` is a one-line change to `build`.

`INTERNAL_VOCABS` is **not** changed by this wave. Moving an existing helper vocabulary out of it is possible later, but the other effect of that list (a user unit cannot define into it) is also given by the bundle-vocabulary rule of `assembleRuntime` (`E_READONLY`, RECIPES.md §2.4), and removing a name is a catalogue-visible change that belongs to a content WP, not to the language.

**Types.** None (`op` exists). **Errors.** `E_META` for arguments to the clause, and for a private word (existing rule).

**Before and after.** `cmac` and `lmhash` exist only because "private words are not callable across vocabularies" (TOOLKIT §2.5, "Other 10"); the shared helper must be public but must not become an op. After the marker a shared word can live in the vocabulary that owns it:

```forth
IN: mac
: hex-block ( data:bytes size:int -- list )
  "Cut data into size-byte pieces." doc
  "Utilities" category
  … ;
META: hex-block
  helper ;
;
```

The word is callable as `mac:hex-block` from every vocabulary and is absent from `catalogue.json`. (Illustrative: the migration of `cmac` and `lmhash` is a content WP, section 15, WP 6.11.)

**Amends.** LANGUAGE.md §5.7 (a sentence), §5.9, §12.1 (`op`). RECIPES.md §2.2 (rule 1 reads: "`meta.op` is true", now with the explicit remark that a `helper` word has it false). Code: `meta.ts`, `meta.test.ts`, `catalogue.test.ts` (a `helper` word with typed parameters is absent from the catalogue).

**Compatibility.** `helper` is an unknown clause today. A word without the clause is unchanged.

**Conformance cases (proposed).**

```fl-test
# C215 helper makes a public word with inputs a non-operation
@unit
: shared ( bytes n:int -- bytes ) ;
META: shared
  helper ;
;
@meta
user:shared op = false
user:shared exported = true
```

```fl-test
# C216 a helper is still callable from another vocabulary
@unit
IN: lib
: twice ( n:int -- int ) n 2 * ;
META: twice
  helper ;
;
@unit
IN: app
: four ( -- int ) 2 lib:twice ;
@run
app:four .
@out
4
```

```fl-test
# C217 helper takes no argument
@unit-fails E_META
: f ( bytes n:int -- bytes ) ;
META: f
  helper now ;
;
```

**Alternative considered.** A header marker (`( bytes n:int -- bytes ) helper`) or a leading declaration (`"" helper`). Rejected: the declaration list is deliberately limited to `doc` and `category` (§5.2), and anything in the header would be in `source.text` and so change the hash of the word when only its visibility changed. A name-based rule (a leading `+` or a vocabulary suffix) was rejected as it would be a new naming convention that the 3,238 existing words would have to be audited against.

---

### 4. Shared named `choice` types

**Motivation.** A `choice{…}` list is written out in every header that uses it. Current corpus: 311 headers carry a `choice{}`, with 152 distinct lists, and 223 of the 311 (72%) are copies of a list that occurs at least twice (TOOLKIT §2.5 had 237 and 70%). The same list repeated: `pkcs7|none` 24 times, the delimiter list 23 times, the block-mode list `CBC|CFB|OFB|CTR|ECB` 20 times. PLAN §7 records it in wave 5 (datetime repeats a 14-option preset list in five ops) and wave 6 (Zip, Tar, LZ4). Each copy can drift, and none can carry help text: `param` help is limited to 200 code points per *parameter*, and nothing explains the individual options.

**Deliberate difference from TOOLKIT §11.2.** TOOLKIT says "shared named `choice` types with an optional value mapping". This proposal gives each option an optional **help text** and no value mapping. A mapping (display label to value) is a presentation concern of the UI and the recipe layer, the `choice` value reaching the word stays the option string (§5.6, D16), and a mapping would add a second thing to hash. Open question Q5 asks whether the owner still wants it.

**Grammar.** A new top-level form, and a new `ptype`:

```ebnf
form         = … | choice-form ;
choice-form  = "CHOICE:" , word-name , { choice-clause } , ";" ;
choice-clause = "option" , ( word-name | integer | string ) , [ string ] , ";" ;

ptype        = …
             | "choice" , "{" , option , { "|" , option } , "}"        (* v0.1, unchanged *)
             | "choice" , "<" , type-ref , ">" ;                       (* new *)
type-ref     = [ vocab-name , ":" ] , word-name ;
```

`CHOICE:` is a new keyword token (reader rule 9, see section 8 for the token change). The clause `option` follows `META:`'s shape (a clause ends with `;`, the block ends with an empty `;`). The option is a bare word, an integer token (its text is the option, so `128` is the option `"128"`), or a string literal; the optional second string is the help.

**Semantics.**

- **Definition.** `CHOICE: name …` defines a *choice type* in the current vocabulary. It lives in its own namespace, separate from words (a type `padding` and a word `padding` do not clash). Names follow `word-name`; a name starting with `_` is private to the vocabulary, as for words (§5.7). `core` is read-only as ever (`E_READONLY`). Defining a type twice in one unit is `E_REDEFINED`; across units and at the console redefinition is allowed with the §6.5 rules (old words keep the options they copied).
- **Options.** One or more `option` clauses, in order; the order is the order of the choice. Option validity is exactly that of an inline option (§5.4 `option`): non-empty, and not a duplicate (`E_META`, `detail.clause = "option"`). At most **1024** options per type and **128** code points per option (the inline form has no stated limit; the cap is new, see Q9). Help text: at most 200 code points (`TEXT_MAX`), one line, plain text, optional.
- **Use.** `m:choice<padding>` in a header refers to the type. Resolution mirrors §6.2 for types only: the current vocabulary; then the `USING:` vocabularies (`E_AMBIGUOUS` if two define it); `core` does not define types. `choice<v:padding>` resolves through exactly vocabulary `v` (`E_NO_VOCAB`, `E_UNDEFINED`, `E_PRIVATE` as in §6.3). An unresolved reference is `E_UNDEFINED` with `detail.kind = "choice"`. There are no forward references: the type must be defined before the header that mentions it.
- **Expansion.** At compile time the reference is replaced by the type's options. The resulting `StackSlot` is exactly the slot that `choice{pkcs7|none}` would give: `type: "choice"`, `options: ["pkcs7","none"]`. `effect.text` renders the expanded form (`m:choice{pkcs7|none}=pkcs7`), so **the canonical text, the catalogue `effect` string and the catalogue `params` of a word that is moved from an inline list to the same shared list are identical**; only `source.text` (and so the hash) differs. A default (`=pkcs7`) is checked against the expanded options as for an inline choice (`E_HEADER`). A constraint on a `choice` is `E_HEADER` as ever.
- **Option help.** The slot is unchanged, so the help travels in `WordMeta.discovery.optionDocs[paramName][option]` (section 1). Options without help are omitted. `optionDocs` is built by `WordMetaBuilder.build` from the types the header referenced.
- **Primitive headers.** A primitive's `effect` string is parsed without a scope (§5.8), so `choice<…>` there is `E_HEADER` ("type references need a source unit"). Primitive parameters are documented by `META:` as today.
- **The hash.** A shared type is part of the meaning of a word that uses it: if the options change, the values the word accepts change. §12.4 hashes only `source.text` and callee hashes, so without a rule an edit to the type would leave the user's hash unchanged and defeat pins (RECIPES.md R8). The rule: let `T` be the distinct `typehash` values of the types referenced by the word's header, sorted in code-point order; the hashed text becomes `ownText + "\n" + lines` as now, where `lines` is the dependency lines of §12.4 followed, **only when `T` is not empty**, by one line `choice <typehash>` per entry of `T`, all joined by `"\n"`. `typehash` is the SHA-256 (hex) of the UTF-8 canonical option rendering `{a|b|c}` (§12.3). So the options and their order are part of the identity of a word that uses the type, while the type's name, its option help and its `doc` are not (a word dependency line is `vocab:name hash`; a type line is the word `choice`, a space and a 64-digit hash, a shape no qualified name can have). A word with no type reference has `T` empty and its hash string is **byte-identical to today's**.
- **Scanner.** `scanVocab` derives dependencies from `qword` tokens and `USING:` only. A `header` token carries its text raw, so `choice<util:padding>` would be invisible and the units could be loaded in the wrong order. The scanner MUST also extract `choice<vocab:name>` references from `header` tokens (a regular expression over `headerText` is enough) and treat them as dependencies of that unit (RECIPES.md §2.4, "Scanner" step 2).

**Types.**

```ts
/** A shared choice type (item 4), the value of Vocabulary.choices. */
export interface ChoiceTypeEntry {
  readonly qname: string;                       // vocab:name
  readonly name: string;
  readonly vocab: string;
  readonly options: readonly string[];
  /** Option to help text, only for options that have help. */
  readonly docs: Readonly<Record<string, string>>;
  /** SHA-256 (hex) of the canonical option rendering `{a|b|c}`; the only part of the type that enters a word's hash. */
  readonly hash: string;
  readonly source: SourceInfo;
}

export interface Vocabulary {
  /* … unchanged … */
  readonly choices?: ReadonlyMap<string, ChoiceTypeEntry>;
}

// DictionaryView gains: resolveChoice(name: string, scope: Scope): ChoiceTypeEntry;
//                       resolveChoiceQualified(vocab: string, name: string, from: string): ChoiceTypeEntry;
// DictionaryTxn gains:  defineChoice(entry: ChoiceTypeEntry, opts?): void;

// HeaderParseFn (and parseHeader) gain an optional fourth parameter:
export type ChoiceResolver = (ref: string, pos: SourcePos) => ChoiceTypeEntry;
```

`parseHeader(text, pos, mode, limits, resolve?)` calls `resolve` for a `choice<…>` item; without a resolver such an item is `E_HEADER`. All existing calls omit the argument and are unchanged.

**Errors.** `E_SYNTAX` (malformed form), `E_NAME` (bad type name), `E_REDEFINED` (duplicate in a unit), `E_META` (bad `option` clause: duplicate, empty, over a cap), `E_READONLY` (`core`), `E_UNDEFINED`, `E_AMBIGUOUS`, `E_NO_VOCAB`, `E_PRIVATE` (resolution), `E_HEADER` (default not an option, reference in a primitive header).

**Before and after.** `aes.fth` line 17 (the same two lists occur in `blowfish.fth`, `des.fth`, `rc2.fth` and others, 24 times for the padding list):

```forth
: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|GCM|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" aad:key{hex|utf8|latin1|base64}="" -- bytes )
```

After, with `util.fth` (or any vocabulary that loads first) declaring:

```forth
IN: util
CHOICE: padding
  option pkcs7 "PKCS#7 padding (RFC 5652, section 6.3): the last block is filled with the count of the filling bytes." ;
  option none "No padding: the input length must already be a multiple of the block size." ;
;
```

the header becomes `padding:choice<util:padding>="pkcs7"`. The mode list gets the same treatment per cipher (the lists differ between ciphers, so the shared types are `block-modes` for the 20 identical copies and one type per distinct list).

**Amends.** LANGUAGE.md §2.3 rule 9 and §2.11 (keyword), §5.1 (grammar), §5.4 (header grammar), §5.6, §6 (a paragraph "Choice types"), §12.1 (`optionDocs`), §12.3 (canonical text unchanged: a sentence), §12.4 (hash), §17. RECIPES.md §2.4 (scanner), §2.3 (a sentence: `params[].options` is unchanged). Code: `reader.ts` (keyword), `types.ts`, `dictionary.ts` (`defineChoice`, resolution), `meta.ts` (`parseHeader` resolver, `computeHash` lines, `build` for `optionDocs`), `compiler.ts` (the `CHOICE:` form and the resolver passed to `parseHeader`), `meta.schema.json`; in ops: `src/scan.ts`.

**Compatibility.** `CHOICE:` is `E_LEX` today and `choice<` is `E_HEADER` today. `choice{a|b}` is unchanged. Words that do not use the new form: same source text, same hash, same `WordMeta`. A type reference needs `<` directly after `choice`, and the inline form needs `{`, so the two cannot be confused.

**Conformance cases (proposed).**

```fl-test
# C218 a shared choice type expands like an inline choice and carries option help
@unit
CHOICE: padding
  option pkcs7 "PKCS#7 padding." ;
  option none "No padding." ;
;
: pad ( bytes p:choice<padding>=pkcs7 -- bytes ) ;
@meta
user:pad params[0].options = ["pkcs7","none"]
user:pad params[0].default = "pkcs7"
user:pad effect.text = "( bytes p:choice{pkcs7|none}=pkcs7 -- bytes )"
user:pad discovery.optionDocs.p.none = "No padding."
@run
#[ 01 ] "none" pad bytes>hex .
#[ 01 ] "zzz" pad
@out
01
@error
E_PARAM_INVALID detail.param=p
```

```fl-test
# C219 a default must be one of the options
@unit-fails E_HEADER
CHOICE: padding
  option pkcs7 ;
  option none ;
;
: pad ( bytes p:choice<padding>=zero -- bytes ) ;
```

```fl-test
# C220 an unknown type
@unit-fails E_UNDEFINED
: pad ( bytes p:choice<nosuch> -- bytes ) ;
```

```fl-test
# C221 a type from another vocabulary is reached by qualification
@unit
IN: shared
CHOICE: yesno
  option yes ;
  option no ;
;
@unit
IN: app
: ask ( bytes a:choice<shared:yesno>=yes -- bytes ) ;
@meta
app:ask params[0].options = ["yes","no"]
```

```fl-test
# C222 a private type is not visible from another vocabulary
@unit
IN: shared
CHOICE: _hidden
  option a ;
;
@unit-fails E_PRIVATE
IN: app
: ask ( bytes a:choice<shared:_hidden> -- bytes ) ;
```

```fl-test
# C223 a word's hash covers the options of its type
@unit
IN: v1
CHOICE: t
  option a ;
  option b ;
;
: w ( bytes m:choice<t> -- bytes ) ;
@unit
IN: v2
CHOICE: t
  option a ;
  option c ;
;
: w ( bytes m:choice<t> -- bytes ) ;
@hash-ne
v1:w v2:w
```

```fl-test
# C224 the help text of an option does not change the hash
@unit
IN: v1
CHOICE: t
  option a "first wording" ;
;
: w ( bytes m:choice<t> -- bytes ) ;
@unit
IN: v2
CHOICE: t
  option a "second wording" ;
;
: w ( bytes m:choice<t> -- bytes ) ;
@hash-eq
v1:w v2:w
```

```fl-test
# C225 duplicate type in one unit; duplicate option
@unit-fails E_REDEFINED
CHOICE: t
  option a ;
;
CHOICE: t
  option b ;
;
```

```fl-test
# C226 a duplicate option
@unit-fails E_META
CHOICE: t
  option a ;
  option a ;
;
```

```fl-test
# C227 an inline choice is unchanged
@unit
: m ( str c:choice{x|y}=x -- str ) ;
@meta
user:m params[0].options = ["x","y"]
```

**Alternative considered.** (a) A header-level name for the list written as an option (`choice{@padding}`): rejected because an option beginning with `@` is valid today (`parseHeader` accepts any run without whitespace or `{}"`), so it would change the meaning of existing text, against rule 1. (b) A table in `package.json` or a JSON side file: rejected, it would be outside the source unit, not hashed, and invisible to `see`. (c) A macro-like textual `DEFINE-CHOICE` that pastes into the header: rejected because the header would then no longer be the reader's raw `header` token. (d) Putting `optionDocs` on `StackSlot`: rejected because `CatalogueOp.params` is `WordMeta.params` unchanged (RECIPES.md §2.3), so every op that used a shared type would grow in the lean catalogue; keeping the help in `discovery` keeps it in `help.json`.

---

### 5. Reserved: `checks` for Magic auto-detection

**Status: reserved, not implemented in this wave.** This section fixes the *shape* so that the Phase 6 Magic feature (PLAN §7, Phase 6: "declarative `checks` in META, depth-limited search") needs no further grammar change. Nothing here is built now except one thing: the clause name `checks` becomes a *named reserved clause*.

**Motivation.** Magic needs, for each op, cheap declarative facts: "this op can apply to data that looks like X" and "its output looks like Y when it worked". Content sniffing code must not live in the runtime or the UI per op; it belongs next to the op.

**Reserved grammar.**

```ebnf
meta-clause  = …
             | "checks" , scope , test , { check-arg } , ";" ;     (* reserved *)
scope        = "input" | "output" ;
test         = "regex" | "charset" | "entropy" | "magic-bytes" | "utf8" | "printable" ;
check-arg    = string ;                                              (* all arguments are strings; see below *)
```

One test per clause; the clause repeats and accumulates in order (like `link`). The shape of the tests:

| test | arguments | meaning |
|---|---|---|
| `regex` | pattern, optional flags | the data, read as Latin-1 text, matches (same dialect and caps as a `str[/…/]` constraint, §5.5) |
| `charset` | characters, minimum share as decimal text (`"0.9"`) | at least that share of the bytes are in the set |
| `entropy` | minimum, maximum (decimal text, bits per byte) | Shannon entropy in range |
| `magic-bytes` | hex string, optional offset (decimal text) | the bytes at the offset equal the hex |
| `utf8` | none | the data is well-formed UTF-8 |
| `printable` | minimum share (decimal text) | at least that share is printable ASCII, tab or line break |

Arguments are strings because `META:` clauses take strings and words only today (compiler.ts lines 1218 to 1226 reject a number token with `E_META`), and a later release may relax that; the shape does not depend on it. Example (not valid yet):

```forth
META: decode
  checks input regex "^[A-Za-z0-9+/\s]+=*$" ;
  checks input charset "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n" "0.95" ;
  checks output utf8 ;
;
```

**What is built now.** The clause parser (`clauseFromArgs`, meta.ts line 941) recognises `checks` and raises `E_META` with the message "`checks` is reserved for a later release". That is the same code the unknown-clause path gives, so no behaviour changes; the point is that the name is documented, spent and highlighted by tooling. The type below is **not** added to `types.ts` in this wave:

```ts
// Reserved shape (not in types.ts): WordDiscovery.checks, set only when the clause is implemented.
export type MagicTest =
  | { kind: "regex"; pattern: string; flags: string }
  | { kind: "charset"; chars: string; minShare: number }
  | { kind: "entropy"; min: number; max: number }
  | { kind: "magic-bytes"; hex: string; offset: number }
  | { kind: "utf8" }
  | { kind: "printable"; minShare: number };
export interface MagicCheck { readonly scope: "input" | "output"; readonly test: MagicTest }
// WordDiscovery.checks?: readonly MagicCheck[]
```

Limits to apply when it is built: at most 8 checks per word, each argument at most 1024 code points, regex limited by `maxRegexLength`; the search itself (depth, branching, time) is a property of the Magic engine, not of META, and must run under the same untrusted-code discipline (an op's checks are data, not FL).

**Amends (now).** LANGUAGE.md §5.9 (one sentence), §17.1 (the "`checks` clause for Magic" item stays, now with a pointer to this shape). Code: `meta.ts` and `meta.test.ts` (the message). **Compatibility.** The name is an unknown clause (`E_META`) today.

**Conformance case (proposed).**

```fl-test
# C228 checks is reserved
@unit-fails E_META
: f ( bytes -- bytes ) ;
META: f
  checks input utf8 ;
;
```

**Alternative considered.** (a) Leave the name unreserved and design later: rejected by the brief; the cost is one message string. (b) A `checks` clause holding a nested list of tests separated by `,`: rejected because `,` is a valid word name (§2.11), so it would be a token with a meaning only inside one clause. (c) JSON in a string (`checks "[{…}]"`): rejected, it would be opaque to the metadata schema and the hover/tooling, and double-escaping regexes in JSON in an FL string is a trap.

---

### 6. Examples on test vectors

**Motivation.** A reference page needs worked examples. `packages/ops/vocab/<v>.test.json` already holds 7,302 vectors (current) with input, parameters and expected output, run by the vector runner on every test run (RECIPES.md §9.3), so they are correct by construction. Writing separate example text would duplicate them and let them rot. An *example* is simply a vector that someone chose to show.

**Design.** An optional key `example` on a vector:

```json
{
  "name": "encode RFC 4648 §10 \"foobar\"",
  "ref": "RFC 4648 §10",
  "op": "base64:encode",
  "params": {},
  "input": { "value": "foobar", "enc": "utf8" },
  "expect": { "value": "Zm9vYmFy", "enc": "utf8" },
  "example": {
    "title": "Encode plain text",
    "note": "Four characters of output for every three bytes of input; = pads the end."
  }
}
```

Schema change in `packages/ops/vocab/vectors.schema.json` (inside `$defs/vector/properties`; `required` unchanged, `additionalProperties: false` kept):

```json
"example": {
  "type": "object",
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 80 },
    "note": { "type": "string", "maxLength": 400 }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

Rules, enforced by `buildHelp` (item 7) and `vectors.test.ts`:

1. A vector with `example` is an ordinary vector in every other respect. The runner (`runOpVectors`, `packages/worker/src/vectors.ts`) reads the fields it knows by name (checked: it does no key validation; only the schema test does), so the extra key is invisible to it, and `OpTestVector` (a TypeScript type outside this wave's scope) needs no change.
2. At most **3** examples per op. `input.value` and each `params` encoded value and `expect.value` of an example at most **2048** characters (so `help.json` stays small; big cases stay plain vectors).
3. `title` is unique among one op's examples. Plain text; the UI renders text.
4. An example may be an error vector (`expect: { "error": … }`); the title says so ("Invalid input is rejected").
5. Order: the order in the vector file.
6. `ref` is carried to the help page as the source line of the example.

The `ref` length limit of 200 characters (a recorded gap, PLAN wave 3) is not changed by this wave.

**Types.** In `packages/ops/src/types.ts` (the `OpVector` shape is not defined there today; the help builder defines its own reader type, section 7).

**Errors.** Build-time only: `buildHelp` throws an `Error` naming file and index for a violation of 2, 3, or an example on a vector whose `op` is not a catalogue op. No FL error code.

**Before and after.** See the JSON above; before, the same vector without the `example` key.

**Amends.** RECIPES.md §9.1 (schema listing, the vector definition, one bullet) and §9.2 (rule 5: "an example is chosen from the vectors, never written separately"). Code: `packages/ops/vocab/vectors.schema.json`, `vocab/vectors.test.ts` (checks 2 and 3 on the files), `README.md` ("Running the vectors").

**Compatibility.** No existing vector has the key, so every file still validates; the old schema rejected the key (`additionalProperties: false`), so no old file contains it.

**Conformance.** Not an FL change. Proposed unit tests (in `vocab/vectors.test.ts`): a file with an `example` validates; a file with an example without `title` fails; a fourth example for one op fails the builder test.

**Alternative considered.** A separate `<v>.examples.json`. Rejected: a second file the runner does not run. A `"example": true` flag with the title taken from `name`: rejected because `name` is a test label ("encode RFC 4648 §10 \"foobar\"") not a title, and there is no place for the note.

---

### 7. `help.json`, the lazy help document

**Motivation.** Items 1 to 6 produce per-op data the operations list does not need: it is read when a user opens a help page or asks for a suggestion. `catalogue.json` is loaded at start-up and its `version` is stored in every recipe (RECIPES.md §2.3, `catalogue`), so adding bulk to it costs every page load and invalidates every stored recipe's `catalogue` field. A second file, loaded lazily, avoids both.

**Design: what is added to the catalogue.** **Nothing.** `CatalogueOp` gets no new member, `Catalogue.format` stays `1`, and `Catalogue.version` is unchanged for an unchanged bundle (it is the hash of `JSON.stringify(ops)`; `buildCatalogue` builds each op from explicit fields, catalogue.ts lines 77 to 93, and `params` is `WordMeta.params` which gains no member; the new `WordMeta.discovery` is not copied). The golden check for the implementation WP: the SHA-256 of `dist/catalogue.json` before and after the change is identical (and `version` is still `dc2ccf85cbd779d4` on the same vocabularies). The `inverse` is not needed by the operations list itself (it is needed after an op is chosen), so it is not added; the question is recorded as Q4 in case the owner wants an "inverse" badge in the list.

**Design: the new output.** `@forge/ops` builds `dist/help.json` next to `dist/catalogue.json` and exports it:

```json
"./help.json": "./dist/help.json",
"./help.schema.json": "./dist/help.schema.json"
```

(additions to `exports` in `packages/ops/package.json`), and the package index exports the builder and the types.

```ts
export const HELP_FORMAT = 1 as const;

export interface HelpLink {
  readonly url: string;
  readonly label: string | null;
}

/** One example: a vector chosen with "example" (item 6). */
export interface HelpExample {
  readonly title: string;
  readonly note: string | null;
  /** The vector's `ref`, or null. */
  readonly ref: string | null;
  /** The vector's `params`, as written (omitted parameters take the catalogue defaults). */
  readonly params: Readonly<Record<string, unknown>>;
  readonly input: { readonly value: string; readonly enc: string };
  /** The vector's `expect`, as written: a value, an `{ error }` or a `{ json }`. */
  readonly expect: unknown;
}

/** What the help page knows about one op. Ops with nothing to say are absent from the document. */
export interface HelpOp {
  readonly qname: string;                    // a catalogue op
  readonly useWhen: string | null;
  readonly links: readonly HelpLink[];
  /** After the symmetric closure of item 2. */
  readonly inverse: string | null;
  /** Item 4: parameter to option to help. Omitted when empty. */
  readonly optionDocs?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly examples: readonly HelpExample[];
}

export interface HelpDoc {
  readonly format: typeof HELP_FORMAT;
  /** `Catalogue.version` of the catalogue this document was built against. */
  readonly catalogue: string;
  /** First 16 hex digits of SHA-256 over `JSON.stringify(ops)`. */
  readonly version: string;
  /** Sorted by `qname` in code-point order. */
  readonly ops: readonly HelpOp[];
}

export interface VectorFile { readonly vocab: string; readonly vectors: readonly unknown[] }

export type BuildHelpFn = (
  runtime: ForgeRuntime,
  catalogue: Catalogue,
  vectorFiles: readonly VectorFile[],
) => HelpDoc;
```

Key order inside a `HelpOp` is the order of the interface; arrays keep their order; so the file is deterministic and `version` is a content id like the catalogue's.

**`buildHelp` algorithm.**

1. For each catalogue op, read `runtime.meta(qname).discovery`.
2. `useWhen`, `links`, `optionDocs`: copied.
3. `inverse`: the symmetric closure of section 2 over catalogue ops. A declared target that is not a catalogue op is a build error (`"base64:decode: inverse base64:encode is not an operation"`). Conflicts are build errors naming both words.
4. `examples`: from the vector files, vectors with `example`, grouped by `op` (alias names resolved to the canonical op through the catalogue). A vector whose `op` is not a catalogue op is a build error (the vector test already requires it). Checks of section 6.
5. Keep an op iff it has `useWhen`, a link, an inverse, `optionDocs` or an example.
6. `catalogue` is `catalogue.version`; assert the runtime that built `help` is the one that built the catalogue (the same `version`), as the worker does for `InitInfo` (RECIPES.md §9.3).

A coverage report (not a failure) lists ops with no `use-when` and no example, so content can be added wave by wave without a big-bang change. A ratchet test (the count may only go up) is proposed for the content WP.

**Build.** `packages/ops/scripts/help.ts` (new; mirrors `scripts/catalogue.ts`) loads the bundle, builds the catalogue, reads `vocab/*.test.json` with `node:fs`, runs `buildHelp`, validates the result with Ajv against `help.schema.json`, and writes `dist/help.json`. The `build` script of `package.json` gets `&& node dist-scripts/help.js` after the catalogue step. `help.schema.json` (draft 2020-12, `$id: urn:forge:schema:help:1`, `additionalProperties: false` throughout, URL `pattern` as in section 1, caps as in sections 1 and 6) is copied to `dist/` as `catalogue.schema.json` is.

**Size.** The cost is data, not code. The catalogue has 458 operations today (`npm run build -w @forge/ops`, 2026-11-12, `version` `dc2ccf85cbd779d4` at commit 548420e). Order of magnitude: 3 examples at about 300 bytes plus a `use-when` line of 100 bytes for every one of them is below 500 KB raw. A size budget test fails the build above **1.5 MiB** raw (the bundler gzips it); the file can be split per vocabulary later without a format change by adding a `help/<vocab>.json` index (not proposed now).

**Web app (not in this wave).** The consumer loads it with a dynamic `import("@forge/ops/help.json")` after the user opens help, and checks `help.catalogue === catalogue.version`; on a mismatch it ignores the document. That is a `apps/web` change owned by a UI WP (section 15, WP 6.12), outside the scope of the lang/ops unfreeze.

**Amends.** RECIPES.md §2.3 (a new paragraph "Help document" after the catalogue rules, including the statement that the catalogue is unchanged), §2.4 (scanner; providers unchanged), §9 (examples), the table of exports in §11 if present; PLAN §3.5 mentions nothing. Code: `packages/ops/src/help.ts` (new), `src/types.ts`, `src/index.ts`, `scripts/help.ts` (new), `src/help.schema.json` (new), `package.json`, `README.md`, tests `src/help.test.ts` (new).

**Compatibility.** Additive file and exports. `catalogue.json`, `catalogue.schema.json`, `CatalogueOp`, `Catalogue.format`, `Catalogue.version`: unchanged.

**Tests (unit; no FL cases).** `buildHelp` on a small fixture runtime: copies `use-when` and links; symmetric closure; conflict error; non-op target error; example ordering; fourth example error; oversize example error; the document validates; the catalogue bytes are unchanged by the presence of `discovery`.

**Alternative considered.** (a) Put `useWhen`, `links` and `inverse` into `CatalogueOp` and bump `format` to 2: rejected, it changes the catalogue `version` of every build, makes every start-up download bigger, and requires every consumer of `format: 1` to change. (b) Put the data into `WordMeta` only and let the UI call the worker for it: rejected, the worker boundary is for baking, and the data is static. (c) One `help` file per vocabulary from the start: deferred, one file is simpler to cache-bust with the catalogue `version`.

---
## Group 2: additive language features

These items close gaps recorded in PLAN §7 and TOOLKIT §11. Each is a new form or word; none changes a v0.1 program.

### 8. Mid-body local binding: `:>`

**Motivation.** Locals come only from headers (§7), and `{ … }` is the list literal (D10), so a value computed in the middle of a body can be named only by passing it to a new word. The corpus pays for that in helpers: TOOLKIT §2.5 measured 984 private words called exactly once, 221 small single-use named helpers and 84 helpers that only bind a closure variable (stale figures, section 0.2; the current corpus has 2,621 private words). PLAN §7 wave 5 records it ("locals come only from headers, so code splits into many small helpers"). The clearest current case is `util:civil-from-days` (util.fth lines 514 to 529): four private helpers `_civil1` to `_civil4`, each with a header that exists only to name values.

**Grammar** (addition to the `item` production of §5.1):

```ebnf
item         = … | bind ;
bind         = ":>" , bind-name ;
bind-name    = word-name ;       (* an unqualified word token, not reserved, not a qualified name *)
```

`:>` is a new keyword token (reader rule 9; today `:>` is `E_LEX`, "bad qualified name"). It must be a standalone token. Exactly one name per `:>`; to bind several values, bind the upper one first (`:> b :> a` binds `b` to the top and `a` to the value below it).

**Semantics.**

- `:> x` pops the top of the data stack (above the floor; `E_STACK_UNDERFLOW` otherwise) into a new local `x`. The name is visible from the next token to the end of the **innermost enclosing body**: the colon or `MEMO:` body, or the `[ … ]` quotation that contains the `:>`. It is not visible after that body ends (a use there is `E_UNDEFINED` or resolves to a word, as for any name). Locals stay immutable (§7).
- `:>` is `E_SYNTAX` outside a definition (console code has no locals, §9) and inside a `{ … }` list literal (the literal collects stack values above a mark, and a binding there would silently shorten it).
- **Names.** A bind name that equals a local already visible in the word (a header name or an earlier `:>` whose scope is still open) is `E_REDEFINED` with `detail.name`. A bind name that equals a visible word, `core` included, hides it and emits `W_SHADOW` (D45), as for header names. Sibling scopes may reuse a name. A reserved word (§2.11) is `E_NAME`; a token that is not a word (a number, a string, a qualified name) is `E_SYNTAX`.
- **Slots.** Bound locals get the next slot numbers after the header locals, one fresh slot per `:>`, never reused. `CompiledWord.nlocals` is the header locals plus the bound slots. The VM builds the locals array of `nlocals` entries on entry as now, filling only the header locals from the inputs (`namedInputs.length` of them; vm.ts lines 1022 to 1026 loop to `made.length` today and MUST loop to `namedInputs.length`); bound slots start empty and are written by `bind` before any read (the compiler guarantees no read precedes the write, because a name is visible only after its `:>`).
- **Quotations and closures.** Rule 3 of §7 says a quotation runs with its own captured `env`, the locals array of the call that created it, shared by reference. A bound slot written inside a quotation that runs many times (a `map` body) would be overwritten by each run, and a closure created in one run would then see the next run's value. So **a quotation that directly contains a `:>` (not counting nested quotations) is marked `own`: every call of it starts from a fresh copy of its captured `env`** (`env.slice()`), and the `bind` writes into the copy. A closure created inside then captures the copy, and each run has its own. Cost: one array copy per call of such a quotation, `nlocals` entries; quotations without `:>` are unchanged. Because the outer locals are immutable and every slot a quotation can read was written before the quotation was created (a name is visible only after its `:>`), the copy always holds the values the quotation can see.
- **Lowering (§8).** The lowering of `if`, `when` and `unless` into inline jumps stays valid: the branches run once per activation, so their bound slots are written once. The lowering of `while` and `loop` re-runs a body in the same frame, which would overwrite a slot that a closure from an earlier iteration captured. So a literal quotation that directly contains `:>` is **not lowered** when its combinator is `while` or `loop` (it takes the intrinsic path, where it is `own`). Lowering is "MAY, unobservable" in §8; this adds one case where the compiler MUST NOT lower, to keep it unobservable.
- **Metadata and hash.** `source.text` contains the `:>` text, so the hash covers it. `WordMeta` is unchanged; `localNames` of the compiled word includes the bound names after the header names.

**Types.**

```ts
// Instruction gains one member:
//   | { readonly op: "bind"; readonly slot: number }          // ( v -- ), writes locals[slot]
// The quot instruction gains an optional flag:
//   | { readonly op: "quot"; readonly end: number; readonly own?: true }
// Quotation gains the same optional flag, copied from the instruction:
export interface Quotation {
  readonly code: CompiledWord;
  readonly start: number;
  readonly env: readonly Value[];
  readonly own?: true;
}
// CompiledWord: namedInputs.length is the number of header locals; nlocals may be larger.
```

**Errors.** `E_SYNTAX`, `E_NAME`, `E_REDEFINED`, `E_UNDEFINED` (use after the scope), `E_STACK_UNDERFLOW` (run time). No new code. **Limits.** None new: `bind` is one step; the copy is not metered (it holds references to existing values and is bounded by `nlocals`, at most the number of names in the source).

**Before and after** (`util:civil-from-days`, util.fth lines 514 to 529; the logic is unchanged):

```forth
: _civil4 ( mp:int doy:int y0:int -- int int int )
  y0 mp 2 + 12 div + mp 2 + 12 mod 1 + doy 153 mp * 2 + 5 div - 1 + ;
: _civil3 ( doy:int y0:int -- int int int )
  doy 5 * 2 + 153 div doy y0 _civil4 ;
: _civil2 ( yoe:int era:int doe:int -- int int int )
  doe 365 yoe * yoe 4 div + yoe 100 div - - yoe era 400 * + _civil3 ;
: _civil1 ( era:int doe:int -- int int int )
  doe doe 1460 div - doe 36524 div + doe 146096 div - 365 div era doe _civil2 ;
: civil-from-days ( days:int -- int int int )
  "The year, month …" doc
  days 719468 + dup 146097 div swap 146097 mod _civil1 ;
```

After (one word, no helpers):

```forth
: civil-from-days ( days:int -- int int int )
  "The year, month …" doc
  days 719468 + :> z
  z 146097 div :> era
  z 146097 mod :> doe
  doe doe 1460 div - doe 36524 div + doe 146096 div - 365 div :> yoe
  doe 365 yoe * yoe 4 div + yoe 100 div - - :> doy
  yoe era 400 * + :> y0
  doy 5 * 2 + 153 div :> mp
  y0 mp 2 + 12 div +  mp 2 + 12 mod 1 +  doy 153 mp * 2 + 5 div - 1 + ;
```

(The text changes, so the hash of `util:civil-from-days` changes if a content WP rewrites it; no existing word is rewritten by this wave. The equivalence of the two is a vector test over a range of day counts.)

**Amends.** LANGUAGE.md §2.3 rule 9 and §2.12 (keyword), §5.1 (`item`), a new §7.1 "Mid-body locals" (including the `own` quotation rule, which amends §7 rule 3), §8 "Lowering" (the exception), §10.2 (`CompiledWord`), §10.3 (instruction `bind`, `quot`/`callq` `own`), §11.1 (no change to the table), §17. Code: `reader.ts` (`COLON_KEYWORDS`, line 48), `compiler.ts` (`parseItem`/`wordItem`, locals scope as a stack, `genItems`, `lower`), `vm.ts` (`bind`, `own` copy in `callq` and in every combinator that calls a quotation, the entry loop), `types.ts`, and tests.

**Compatibility.** `:>` is `E_LEX` today and appears in no `.fth` file (checked by grep over `vocab/*.fth`). A word without `:>` compiles to the same instructions as before. The only change to existing programs is none.

**Conformance cases (proposed).**

```fl-test
# C229 a mid-body binding names the top of the stack
@unit
: sq ( int -- int ) :> x x x * ;
@run
7 sq .
@out
49
```

```fl-test
# C230 the upper value is bound first
@unit
: f ( -- int ) 1 2 :> b :> a a 10 * b + ;
@run
f .
@out
12
```

```fl-test
# C231 the scope ends with the enclosing quotation
@unit-fails E_UNDEFINED
: h ( int -- int ) [ :> y y ] call y ;
```

```fl-test
# C232 a name already visible as a local is a redefinition
@unit-fails E_REDEFINED
: f ( a:int -- int ) 1 :> a a ;
```

```fl-test
# C233 a bound name that hides a word warns
@unit
: f ( int -- int ) :> len len ;
@warnings
W_SHADOW
```

```fl-test
# C234 every run of a quotation has its own bound locals
@unit
: mk ( n:int -- list ) 0 n range [ :> i [ i ] ] map ;
@run
3 mk [ call ] map .
@out
{ 0 1 2 }
```

```fl-test
# C235 a binding needs a definition
@run
1 :> x x
@error
E_SYNTAX
```

```fl-test
# C236 a binding pops the stack like any word
@unit
: f ( -- int ) :> x x ;
@run
f
@error
E_STACK_UNDERFLOW
```

```fl-test
# C237 not inside a list literal
@unit-fails E_SYNTAX
: f ( -- list ) 1 { :> x x } ;
```

```fl-test
# C238 a reserved word cannot be bound
@unit-fails E_NAME
: f ( int -- int ) :> recurse ;
```

**Alternatives considered.** (a) `:> a b c` with several names: rejected because nothing marks the end of the names, so the next word of the body would be taken as a name; a terminator token would be a second new token. (b) Reuse `{ x }` or a second bracket form: rejected, `{ }` is the list literal (D10) and any bracket pair costs a new reader rule. (c) Factor's `[| a b | … ]` lambda form: rejected, it needs a quotation per binding site and does not help the top-level of a word, which is where the 4-helper chains are. (d) Mutable locals or `to`: rejected, locals are immutable by design (§7, `VARIABLE` exists for state).

---

### 9. Memoised zero-input words: `MEMO:`

**Motivation.** A zero-input word used as a table is rebuilt on every call. PLAN §7 records it three times (waves 1, 3, 7): `html:decode` rebuilds its 2,231-entry entity record at about 5 ms per call, the CRC preset table (171 lines of text) is parsed on each call and a 256-entry table costs about 20,000 steps, `charset:decode` rebuilds its tables per call, and `mime` works around it. Current corpus: 152 zero-input colon words, only 7 `CONSTANT`s (D4 allows a `CONSTANT` only to hold one literal, so a computed table cannot be one). TOOLKIT §11.2 proposes "computed load-time constants and memoised zero-input words, run under a load budget".

**One mechanism, not two.** This proposal gives the memoised word only, and runs it **on first use or by an explicit `warm()`**, not inside `load()`. Reasons: §1 says "compilation never executes user code", D23 says `load()` is synchronous and atomic, and PLAN §3.4 says there is one async code path. Evaluating a body at load time would need a second, synchronous evaluator. First-use evaluation reuses the ordinary call path. The "load budget" is `warm()` (below). Evidence that the cache lives long enough to matter: the worker's baker creates the runtime once per `init` and reuses it for every bake (`packages/worker/src/core.ts` lines 224 to 233, `ready = { runtime, … }`), so a table built by the first bake serves all the later ones, with no change to the worker.

**Grammar.**

```ebnf
form         = … | memo-form ;
memo-form    = "MEMO:" , name , header , { decl } , body , ";" ;     (* header has no inputs and one output *)
```

`MEMO:` is a new keyword token (reader rule 9; today `MEMO:` alone is `E_LEX`). Everything else is the colon definition of §5.2: a header is mandatory, `decl`s and a `META:` block are allowed, the word goes into the current vocabulary at the `;`, and a private name (`_table`) is allowed.

**Semantics.**

- **Header.** Exactly `( -- T )`: no input, exactly one output, `T` a concrete type name other than `quot` (a cached quotation would pin a code reference and its env), and not `..`. Anything else is `E_HEADER`. The word has kind `"fl"`; it is never an op (no inputs).
- **Purity** (checked at compile time). The body, and every word it calls transitively, MUST have no effect label (`+async`, `+random`, `+time`, §10.10) and MUST NOT read or write a `VARIABLE` or call `help`, `see`, `words`, `vocabs`, `current-vocab` (they depend on the session). A violation is `E_FORBIDDEN` at compile time with `detail.effect` set to the label, or to `"state"` for variables and the session words. `recurse` is `E_SYNTAX`. The compiler computes a boolean `stateful` per compiled word, propagated through `deps` like `effects`; it is internal (an additive field of `CompiledWord`), not in `WordMeta`, so it cannot change a catalogue or a hash.
- **Evaluation.** A call of a memo word (instruction `memo`) pushes the cached value if there is one (one step, nothing metered: the value already exists). Otherwise it calls the body exactly like a zero-input colon word, in the **current run**: same limits, same step counter, same deadline, same breakpoints and trace. At the body's `ret` (after the normal exit check of §10.5) the top value is stored in the cache of the word's entry and left on the stack. An error leaves nothing cached and propagates normally (`E_DIV_ZERO`, `E_LIMIT_STEPS`, and so on); a later call tries again. So the first caller pays the steps and bytes of the build and later callers do not. A run that fails with `E_LIMIT_STEPS` cold may succeed warm; step counts are not part of the language's observable results (§8), and untrusted code cannot get a build for free, because the build is charged to the run that triggers it.
- **Cache.** The cache is a field of the word entry, so it belongs to one runtime (one `ForgeRuntime`; a new runtime has an empty cache), is shared by all runs of it, and is replaced by a redefinition (a new entry, §6.5). Values are immutable (§3.1), so sharing is safe. The total size of cached values per runtime is capped by `RuntimeOptions.memoCacheBytes` (default **256 MiB**, measured with `sizeOf`); a value that would exceed it is returned but not cached, so a hostile unit can only lose the speed-up, never exhaust memory by defining many memo words. A secret mark is not preserved (a memo value is never bound to a `key` slot).
- **`warm`.** `ForgeRuntime.warm(options?: { words?: string[] }): Promise<WarmReport>` evaluates every memo word of the runtime, or the listed ones, in definition order, each in its own run with the limits `RuntimeOptions.memoLimits` (default `{ maxSteps: 2_000_000, maxMillis: 5_000 }` merged over the runtime limits; a build that does not fit is reported, not thrown). It never rejects for language errors. This is the "load budget": a host calls it after `assembleRuntime` if it wants the cost up front; nothing requires it.
- **Hash.** `ownText` is `source.text`, which starts with `MEMO:`, so a memo word and a colon word with the same body have different hashes; callers' hashes include the memo word's as for any callee (§12.4). The cache is not part of identity.

**Types.**

```ts
// Instruction gains: | { readonly op: "memo"; readonly entry: FlWordEntry }
export interface FlWordEntry /* extends WordEntryBase */ {
  readonly kind: "fl";
  code: CompiledWord | null;
  /** Set for a MEMO: word. `value` is undefined until the first successful evaluation. */
  readonly memo?: { value?: Value };
}
// CompiledWord gains: readonly stateful?: boolean   (true if it reads a variable or a session word, directly or through a callee)

export interface RuntimeOptions {
  /* … */
  readonly memoLimits?: Partial<Limits>;     // used by warm()
  readonly memoCacheBytes?: number;          // default 268_435_456
}

export interface WarmReport {
  readonly built: readonly string[];                     // qualified names now cached
  readonly failed: readonly { readonly qname: string; readonly error: ForgeErrorShape }[];
}
// ForgeRuntime gains: warm(options?: { readonly words?: readonly string[] }): Promise<WarmReport>;
```

**Errors.** `E_HEADER` (shape), `E_FORBIDDEN` (impurity), `E_SYNTAX` (`recurse`), `E_REDEFINED` (two definitions in a unit), and at run time whatever the body raises. No new code.

**Before and after** (`html.fth` lines 2290 to 2291; the same one-word change applies to the CRC presets and the `charset` tables):

```forth
: _table ( -- record )
  _entities "\n" split [ "=" split ] map >record ;
```

```forth
MEMO: _table ( -- record )
  _entities "\n" split [ "=" split ] map >record ;
```

`html:decode` then builds the record once per runtime (about 5 ms once, instead of per call).

**Amends.** LANGUAGE.md §2.3 rule 9, §5.1, a new §5.12 "`MEMO:`", §10.1 (nothing: no new frame kind), §10.3 (instruction `memo`), §10.13 (`warm`, options), §10.8 (a note that the build is charged to the run), §12.2 (kind), §17 (D4 gets a pointer: `CONSTANT` still takes one literal). RECIPES.md §2.4 rule 3 of the `.fth` rules: no change (a memo word is "a definition"). Code: `reader.ts`, `compiler.ts` (a `memo` form built on `colon()`; purity propagation), `vm.ts` (`memo` instruction and the store at `ret`), `runtime.ts` (`warm`, options), `types.ts`.

**Compatibility.** `MEMO:` is `E_LEX` today; `MEMO:foo` (no space) remains the qualified name `MEMO:foo`. Existing zero-input words and `CONSTANT`s are unchanged. No hash changes.

**Conformance cases (proposed).** (Caching itself is not observable without step counts, so it is a unit test in `vm.test.ts` with an evaluation counter, plus a `warm()` test in `runtime.test.ts`.)

```fl-proposed
# C239 a memoised word returns its value on every call
@unit
MEMO: squares ( -- list ) 0 5 range [ dup * ] map ;
@run
squares . squares len .
@out
{ 0 1 4 9 16 }
5
```

```fl-proposed
# C240 a memo word takes no input
@unit-fails E_HEADER
MEMO: f ( int -- int ) 1 ;
```

```fl-proposed
# C241 a memo word may not read a variable
@unit-fails E_FORBIDDEN
0 VARIABLE counter
MEMO: f ( -- int ) counter ;
```

```fl-proposed
# C242 a memo word may not call a clock word
@unit-fails E_FORBIDDEN
MEMO: f ( -- int ) fx:now ;
```

```fl-proposed
# C243 a failing body fails at the first use, not at load
@unit
MEMO: bad ( -- int ) 1 0 div ;
@run
bad
@error
E_DIV_ZERO
```

```fl-proposed
# C244 the build is charged to the run and is bounded by its limits
@limits
maxSteps=1000
@unit
MEMO: spin ( -- int ) [ true ] loop 0 ;
@run
spin
@error
E_LIMIT_STEPS
```

```fl-proposed
# C245 no recurse in a memo word
@unit-fails E_SYNTAX
MEMO: f ( -- int ) recurse ;
```

```fl-proposed
# C246 the output is checked like any word's
@unit
MEMO: f ( -- int ) "x" ;
@run
f
@error
E_TYPE detail.where=output
```

```fl-proposed
# C247 a memo word has a metadata record like any word
@unit
MEMO: t ( -- list ) { 1 2 } ;
@meta
user:t kind = "fl"
user:t effect.text = "( -- list )"
user:t op = false
```

**Alternatives considered.** (a) `CONSTANT:` evaluated inside `load()` ("load-time constant"): rejected for the reasons above (a synchronous second evaluator; code running during load), and because first-use evaluation gives the same speed-up. (b) Allow an expression before `CONSTANT` (`3 4 + CONSTANT x`): rejected, D4 and §9 keep a unit free of executable top-level code. (c) A `memo` marker as a leading declaration (`"" memo`): rejected because it hides a semantic difference in an item the hash does not distinguish; a distinct defining keyword changes `source.text`. (d) Per-call caching keyed by arguments: rejected, it needs value hashing and an eviction policy, and the corpus need (101 to 152 zero-input words) is a table with no arguments.

---

### 10. Linear list and bytes builders: `collect`, `emit`

**Motivation.** Growing a list one element at a time copies it each time. `append`, `cat` and `put` each build a new value (§3.1, immutable), and the allocation meter (`maxTotalBytes`, §10.8) counts every copy, so n appends cost O(n²) bytes against the 1 GiB limit. PLAN §7 records it in waves 1, 5 and 7 ("`cobs` needed a primitive for that reason"; "`util:list-flatten` exhausts the total-allocation budget at about 3,800 small lists"; "a record built with one `put` per item copies itself each time"). TOOLKIT §11.3 proposes a linear builder; its stateful-loop primitives (9, 727 lines) are the target of the bigger mutable-buffer item, which is out of scope here. Current corpus: `util:list-flatten` is called from 6 vocabularies (10 calls) and is a `reduce` over `cat`.

**Design: a collector frame, not a new value.** No new tag (D11 keeps nine). A new combinator creates an *accumulator inside the VM*, in a return-stack frame, runs a quotation, and builds the result once:

| word | effect | meaning |
|---|---|---|
| `collect` | `( quot -- list )` | run `quot`; return the list of everything it emitted |
| `collect-bytes` | `( quot -- bytes )` | the same for bytes |
| `collect-str` | `( quot -- str )` | the same for a string |
| `emit` | `( any -- )` | append one element to the innermost active collector |
| `emit-all` | `( any -- )` | append every element of a sequence to the innermost active collector |

**Semantics.**

- `collect*` pops the quotation, pushes a `collect` frame (it counts toward `maxReturnDepth`) holding a growing JS array or byte buffer, and runs the quotation. The quotation body has the `d` rule of §8 (**stack-neutral**: the depth after it equals the depth before, else `E_EFFECT`). When it returns, the frame is popped and **one** result value is created, measured with `sizeOf`, checked against `maxValueBytes` (`E_LIMIT_VALUE`) and counted once against `maxTotalBytes`.
- **Element kinds.** For `collect`: `emit` takes any value, `emit-all` takes a `list`. For `collect-bytes`: `emit` takes an `int` 0 to 255 (`E_TYPE` for a non-int, `E_RANGE` outside, as in §8 `map` over bytes), `emit-all` takes `bytes`. For `collect-str`: `emit` takes an `int` that is a valid non-surrogate code point (as `codes>str`), `emit-all` takes a `str`. Any other tag is `E_TYPE`.
- **Which collector.** `emit` and `emit-all` act on the **innermost active collector in the dynamic extent**: the nearest `collect` frame on the return stack, whichever word the `emit` is in. A callee may therefore emit into its caller's collector (helper words are possible), a nested `collect` captures its own emits, and a quotation that escapes its `collect` and is called later emits into whatever collector is active then. With no active collector the instruction raises `E_EFFECT` with `detail.reason = "emit outside collect"` (the nearest existing code for a violated control-flow contract; Q8).
- **Bounds.** Every `emit` is one instruction (one step); `emit-all` is one step (as `cat` is). The running size of the collector is checked at **each** `emit` and `emit-all` against `maxValueBytes` (`E_LIMIT_VALUE` as the value grows, not at the end), using incremental accounting of the appended elements, so memory is bounded by the value limit, and the cost of the copy in `emit-all` is bounded by it too. `maxTotalBytes` is charged once for the final value. A collector abandoned by an error is dropped with its frame; a `try` unwinding through it discards it.
- `E_LIMIT_RETURN` applies to the frame as to any other.

**Types.**

```ts
// CombinatorName gains: "collect" | "collect-bytes" | "collect-str"
// IntrinsicName gains the same three, and "emit" | "emit-all"
// Instruction gains:
//   | { readonly op: "emit"; readonly all: boolean }
// The return-stack frame kinds (§10.1) gain `collect`.
```

**Errors.** `E_EFFECT`, `E_TYPE`, `E_RANGE`, `E_LIMIT_VALUE`, `E_LIMIT_TOTAL`, `E_LIMIT_RETURN`.

**Before and after** (`util:list-flatten`, util.fth line 300):

```forth
: list-flatten ( ll:list -- list )
  "The elements of a list of lists …" doc
  ll { } [ cat ] reduce ;
```

```forth
: list-flatten ( ll:list -- list )
  "The elements of a list of lists …" doc
  [ ll [ emit-all ] each ] collect ;
```

Total bytes: the `reduce` form meters the sum of all the intermediate lists (quadratic); the `collect` form meters the result once.

**Amends.** LANGUAGE.md §8 (the table of combinators and a new paragraph "Collectors"), §10.1 (frame kind), §10.3 (instruction `emit`), §10.8 (note on incremental accounting), §13.6 (core table: five new rows), §17. Code: `vm.ts`, `compiler.ts` (intrinsic table), `types.ts`, `vocab/core.ts` (`CORE_INTRINSIC_WORDS`), tests.

**Compatibility.** The five names are not defined by any v0.1 `core` word. A vocabulary that defines `collect` or `emit` keeps its own (current vocabulary first). In the current corpus none does (checked: no definition and no local of these names).

**Conformance cases (proposed).**

```fl-test
# C248 collect builds a list
@run
[ 1 emit 2 emit { 3 4 } emit-all ] collect .
@out
{ 1 2 3 4 }
```

```fl-test
# C249 byte and string collectors
@run
[ 255 emit #[ 01 02 ] emit-all ] collect-bytes .
[ 104 emit 105 emit "!" emit-all ] collect-str .
@out
#[ ff 01 02 ]
hi!
```

```fl-test
# C250 a collector body is stack-neutral
@run
[ 1 ] collect
@error
E_EFFECT
```

```fl-test
# C251 emit needs a collector
@run
1 emit
@error
E_EFFECT
```

```fl-test
# C252 the innermost collector gets the element
@run
[ 1 emit [ 2 emit ] collect emit ] collect .
@out
{ 1 { 2 } }
```

```fl-test
# C253 a byte must be 0 to 255
@run
[ 256 emit ] collect-bytes
@error
E_RANGE
```

```fl-test
# C254 a helper word can emit into its caller's collector
@unit
: put2 ( int -- ) dup emit 2 * emit ;
@run
[ 3 put2 4 put2 ] collect .
@out
{ 3 6 4 8 }
```

```fl-test
# C255 building is linear in the allocation meter
@limits
maxTotalBytes=2000000
@run
[ 0 20000 range [ emit ] each ] collect len .
@out
20000
```

```fl-test
# C256 the value limit is enforced while the collector grows
@limits
maxValueBytes=1000
@run
[ 1000 [ 1 emit ] times ] collect
@error
E_LIMIT_VALUE
```

**Alternatives considered.** (a) Lexically scoped `emit` (legal only inside the literal `collect` quotation): rejected, it forbids splitting a parser into helper words, which is exactly where the corpus needs it; the price of dynamic extent is that a helper's stack effect does not show that it emits (documented, and the `emit` runtime check catches misuse). (b) A builder value (`new-list`, `list-add`): rejected, it is a new mutable value tag and breaks D44's purity and aliasing rules, which belong to the out-of-scope buffer item. (c) A bulk-only word (`flat-map`, `join`-like): rejected as the only mechanism, because the quadratic loops in the corpus are state machines that emit from a `while`; kept as a possible convenience later. (d) Making `append` and `cat` amortised through hidden sharing: rejected, `values.ts` copy semantics are part of D44 (no aliasing).

---

### 11. Control and lookup words

**Motivation.** Evidence (TOOLKIT §2.5, stale lower bounds; PLAN §7): 234 else-if chains, 96 at depth 3 or more; `try` used as control flow (current corpus: at most 39 `try` tokens, each about 1 ms per caught error; `set:_has?` is a `try` around `get`); no early exit (waves 1, 3 and 5: `util:count-leading` is a fold over everything, `ssdeep:_common7?` maps every window and ors the results); no sort in the core (`list:sort`, `list:sort-by` and `lines:sort` exist as helpers, three TypeScript sort and shuffle primitives); no multi-way branch (wave 7). PLAN wave 5: "there is no `pick`, case or dispatch, early exit". Nine words close these.

#### 11.1 `cond` and `case`

```ebnf
(* cond: a list of alternating test and action quotations, with an optional final default *)
cond-list  = "{" , { quot , quot } , [ quot ] , "}" ;
(* case: a list of alternating value and action quotation, with an optional final default *)
case-list  = "{" , { value , quot } , [ quot ] , "}" ;
```

| word | effect | meaning |
|---|---|---|
| `cond` | `( list -- .. )` | run each test in order; at the first that leaves `true`, run its action |
| `case` | `( x list -- .. )` | compare `x` with each value by `=` (§3.1, `int` and `num` compare exactly); run the action of the first match |

- **`cond`.** The list holds quotations only. Pairs are (test, action); a final unpaired quotation is the default. Each test runs under the `while` condition rule of §8 (the depth after it is `d + 1`, a `bool`; `E_EFFECT` or `E_TYPE` otherwise). The action runs with no depth requirement (variadic, as `if`). No match and no default is `E_RANGE`. A non-quotation in the list is `E_TYPE`, checked for the whole list **before** any test runs, so the error does not depend on the data.
- **`case`.** `x` is consumed. The list is alternating (value, action quotation); an odd length means a final default quotation. A value that is a quotation is `E_TYPE` (equality of quotations is identity, §3.1, so it could never match). An action position that is not a quotation is `E_TYPE`, checked up front. No match and no default is `E_RANGE`. The matched action and the default run with `x` removed; they do not receive it (bind it first when needed).
- **Cost.** Each test or comparison tried is one extra step, as a combinator iteration (§10.3).
- **Lowering.** When the argument is a literal list built from literal quotations immediately before `cond`/`case`, a compiler MAY lower it to the inline jump chain used for `if` (§8, with `dmark`/`dcheck` around each test), with the same unobservability rule.

#### 11.2 `has-key?`

`has-key? ( record key:str -- bool )` (P): whether the record has the key. It replaces `[ rec key get drop true ] [ drop false ] try`. (A non-record is `E_TYPE`.)

#### 11.3 `sort` and `sort-by`

| word | effect | meaning |
|---|---|---|
| `sort` | `( list -- list )` | a new list, stable ascending |
| `sort-by` | `( list quot -- list )` | `quot ( elem -- key )` is called once per element, in order, under the `map` depth rule; the elements are ordered stably by their keys |

Ordering: all numbers (`int` and `num` mixed, exact, `bigint` included), or all `str` (code point order, §3.1), or all `bytes` (lexicographic). The empty and one-element lists are always valid. Any other mixture, or any other tag (`list`, `record`, `bool`, `quot`, `file`), is `E_TYPE`. For `sort-by` the rule applies to the keys. This is the order of `list:sort` (list.fth lines 1 to 12), except that `list:sort` reports a mixture as `E_COERCE`; the core words report `E_TYPE`, as `<` does (§13.2). **`list:sort-by ( items keys -- list )` takes a parallel list of keys, the core `sort-by` takes a quotation**; the names do not collide (`list:` is a vocabulary), and a vocabulary with `USING: list` keeps resolving `sort-by` to its import (imports shadow `core`, §6.2), so existing code is unaffected. The sort runs in the host and is not interruptible by the VM, like every primitive (§10.7); it is bounded by `maxValueBytes` on its input (64 MiB of list elements is at most about 8 million entries).

#### 11.4 `find`, `any?`, `all?`

| word | effect | meaning |
|---|---|---|
| `find` | `( seq quot -- int )` | index of the first element for which `quot` leaves `true`; `-1` if none |
| `any?` | `( seq quot -- bool )` | whether some element does |
| `all?` | `( seq quot -- bool )` | whether every element does (`true` for an empty sequence) |

`seq` is a list, bytes or str, with the element rules of §8 (bytes give ints, str gives code points; the index of `find` for a str counts code points). The quotation runs under the `filter` depth rule (`d + 1`, a `bool`). **They stop at the decisive element**: the rest of the sequence is not visited and costs no steps. There is no null value in FL, so `find` returns an index; the element is `nth`.

#### 11.5 `exit`

`exit ( .. -- .. )` leaves the current word at once. The exit check of §10.5 runs as at a normal `ret`: the depth must equal `base + outputs`, else `E_EFFECT`; then the output tags. `exit` is an ordinary `core` word (an intrinsic), not a reserved one, so a vocabulary's own `exit` shadows it.

It is valid only where it can be compiled as a jump: **in the word body, or inside a literal quotation that is lowered inline** (§8 Lowering) by `if`, `when`, `unless`, `while` or `loop`, at any nesting of those. In any other quotation (an argument of `each`, `map`, `try`, `cond`, `case`, a quotation stored or returned) and in a `{ }` list literal it is `E_SYNTAX` at the `exit` ("`exit` is only allowed where it compiles to a jump"). For that to be well defined, a literal quotation that contains `exit` MUST be lowered (the "MAY" of §8 becomes "MUST" for them). Inside lowered `while`/`loop` bodies the compiler emits `exit` with the count of `mark` frames (`dmark`) that are open at that point, and the VM pops them before returning.

Why not exit from inside `each` or `map`? That is a non-local return through combinator frames, and a quotation can outlive its word (§7 rule 5), so the target frame may be gone. `find`, `any?` and `all?` cover the early-exit scans of the corpus; a general escape is left to a later version.

**Types.**

```ts
// CombinatorName gains: "cond" | "case" | "sort-by" | "find" | "any?" | "all?"
// IntrinsicName gains the same, and "exit".
// Instruction gains: | { readonly op: "exit"; readonly marks: number }   // pops `marks` mark frames, then behaves as `ret`
// has-key? and sort are primitives (kind P) in vocab/core.ts.
```

**Errors.** As above: `E_TYPE`, `E_RANGE`, `E_EFFECT`, `E_SYNTAX`, `E_STACK_UNDERFLOW`. No new code.

**Before and after.** (1) A multi-way branch, `util:delimiter` (util.fth line 58), nine nested `if`s:

```forth
: delimiter ( choice:str -- str )
  "The text for a delimiter choice …" doc
  choice "space" = [ " " ] [
  choice "comma" = [ "," ] [
  choice "semicolon" = [ ";" ] [
  …
  choice "none" = [ "" ] [
  "unknown delimiter choice (use space, comma, …)" raise:range ""
  ] if ] if ] if ] if ] if ] if ] if ] if ] if ;
```

```forth
: delimiter ( choice:str -- str )
  "The text for a delimiter choice …" doc
  choice
  { "space" [ " " ]  "comma" [ "," ]  "semicolon" [ ";" ]  "colon" [ ":" ]
    "newline" [ "\n" ]  "crlf" [ "\r\n" ]  "cr" [ "\r" ]  "tab" [ "\t" ]  "none" [ "" ]
    [ "unknown delimiter choice (use space, comma, …)" fail-range "" ] } case ;
```

(2) Early return and `case`, `util:ordinal-suffix` (util.fth line 126, with `between?` from item 13):

```forth
: ordinal-suffix ( n:int -- str )
  n 100 mod dup 11 >= swap 13 <= and
  [ "th" ]
  [ n 10 mod dup 1 = [ drop "st" ] [ dup 2 = [ drop "nd" ] [ 3 = [ "rd" ] [ "th" ] if ] if ] if ] if ;
```

```forth
: ordinal-suffix ( n:int -- str )
  n 100 mod 11 13 between? [ "th" exit ] when
  n 10 mod { 1 [ "st" ] 2 [ "nd" ] 3 [ "rd" ] [ "th" ] } case ;
```

(3) `has-key?`, `set:_has?` (set.fth line 21):

```forth
: _has? ( rec:record key:str -- bool )
  [ rec key get drop true ] [ drop false ] try ;
```

```forth
: _has? ( rec:record key:str -- bool )
  rec key has-key? ;
```

(4) An early-exit scan, `util:count-leading` (util.fth lines 167 to 174), a fold with a sentinel accumulator and a helper:

```forth
: count-leading ( items pred:quot -- int )
  items 0 [ pred _lead-step ] reduce
  dup 0 < [ neg 1 - ] when ;
```

```forth
: count-leading ( items pred:quot -- int )
  items [ pred call not ] find dup 0 < [ drop items len ] when ;
```

(5) `util:contains?` (util.fth line 140): `items [ x = ] filter len 0 >` becomes `items [ x = ] any?`, which stops at the first hit.

**Amends.** LANGUAGE.md §8 (table, a paragraph each for `cond`/`case`, the finders and `exit`, and the Lowering paragraph), §10.3 (instruction `exit`), §13.4 and §13.6 (rows), §17, §17.1 (the "`exit`/early return" item is removed). RECIPES.md: none. Code: `vm.ts`, `compiler.ts` (intrinsic table, `lower`, an exit-context check at generation time), `types.ts`, `vocab/core.ts`, tests.

**Compatibility.** Nine new `core` names. A vocabulary defining one (the current corpus defines `sort` in `lines.fth`, `sum` in `arith.fth` and none of the others) keeps its own, because the current vocabulary is searched first; an import of the same name (`USING: list` and `sort-by`) wins over `core`. Locals named like a new word now emit `W_SHADOW` (section 0.3). Hashes: none changes.

**Conformance cases (proposed).**

```fl-test
# C257 cond with a default
@unit
: kind ( n:int -- str ) { [ n 0 < ] [ "negative" ] [ n 0 = ] [ "zero" ] [ "positive" ] } cond ;
@run
-3 kind . 0 kind . 9 kind .
@out
negative
zero
positive
```

```fl-test
# C258 cond with no match and no default
@run
{ [ false ] [ 1 ] } cond
@error
E_RANGE
```

```fl-test
# C259 case compares with = and consumes the key
@unit
: digit-name ( n:int -- str ) n { 0 [ "zero" ] 1 [ "one" ] [ "many" ] } case ;
@run
0 digit-name . 1 digit-name . 5 digit-name .
1.0 { 1 [ "one" ] [ "other" ] } case .
depth .
@out
zero
one
many
one
0
```

```fl-test
# C260 case checks the whole list before it matches
@run
1 { 1 2 } case
@error
E_TYPE
```

```fl-test
# C261 has-key?
@run
{ { "a" 1 } } >record "a" has-key? .
{ { "a" 1 } } >record "b" has-key? .
@out
true
false
```

```fl-test
# C262 sort numbers and strings
@run
{ 3 1.5 2 } sort .
{ "b" "a" "ab" } sort .
{ } sort .
@out
{ 1.5 2 3 }
{ "a" "ab" "b" }
{ }
```

```fl-test
# C263 sort refuses a mixture
@run
{ 1 "a" } sort
@error
E_TYPE
```

```fl-test
# C264 sort-by is stable
@run
{ "ccc" "a" "bb" } [ len ] sort-by .
{ "bb" "aa" "c" } [ len ] sort-by .
@out
{ "a" "bb" "ccc" }
{ "c" "bb" "aa" }
```

```fl-test
# C265 find
@run
{ 1 2 3 4 } [ 2 > ] find .
{ 1 2 } [ 5 > ] find .
"abc" [ 98 = ] find .
#[ 05 06 ] [ 6 = ] find .
@out
2
-1
1
1
```

```fl-test
# C266 any? and all? on the empty sequence, and short circuit
@run
{ } [ true ] any? .
{ } [ false ] all? .
{ 1 2 3 } [ dup . 2 = ] any? .
@out
false
true
1
2
true
```

```fl-test
# C267 exit leaves the word at once
@unit
: sign ( n:int -- str ) n 0 < [ "negative" exit ] when n 0 = [ "zero" exit ] when "positive" ;
@run
-5 sign . 0 sign . 7 sign .
@out
negative
zero
positive
```

```fl-test
# C268 exit from a lowered loop pops its marks
@unit
: first-over ( limit:int -- int ) 0 [ true ] [ dup limit > [ exit ] when 1 + ] while ;
@run
3 first-over .
@out
4
```

```fl-test
# C269 exit is not allowed in an each body
@unit-fails E_SYNTAX
: f ( list -- ) [ drop exit ] each ;
```

```fl-test
# C270 exit still runs the exit check
@unit
: f ( -- int ) 1 2 exit ;
@run
f
@error
E_EFFECT
```

```fl-test
# C271 a vocabulary's own word shadows a new core word
@unit
IN: demo
: find ( -- str ) "mine" ;
: t ( -- str ) find ;
@run
demo:t .
@out
mine
```

```fl-test
# C272 an import wins over core
@unit
IN: other
: find ( -- str ) "imported" ;
@run
USING: other ;
find .
@out
imported
```

**Alternatives considered.** (a) Syntax for multi-way branches (`CASE: … ;`): rejected, D7 and D8 keep control flow as combinators and the reader context-free; a list of quotations works with existing parsing and lowering. (b) `cond` only: rejected, the dominant corpus shape is an equality test on a `choice:str`, and without `case` each branch repeats `dup … =`. (c) `find` returning the element and a flag: rejected, two outputs complicate the combinator depth rules for little gain. (d) A general non-local `exit` or `return-from`: rejected for the reasons above. (e) Generic `sort` with a comparison quotation: rejected, it runs user code O(n log n) times; `sort-by` plus a key gives the common orderings.

---

### 12. Maths and `str>num`

**Motivation.** The core has no logarithm, exponential or trigonometry (§17.1, "floating-point transcendental functions"). The corpus works around it with private primitives: `analysis:_log2` (analysis.fth line 3, "the core has no logarithm"; used for entropy), `coords:_math` and `coords:_atan2` (coords.ts calls `Math.*` ten times; coords.fth lines 237 to 250). PLAN §7 wave 5 lists "no trigonometric or hyperbolic functions, no str>num parse"; TOOLKIT §2.5 counts 7 missing core maths primitives. FL has no way to read a decimal number from text except by hand.

**Words** (all P, in `vocab/core.ts` or a new `vocab/numeric.ts` for the table):

| word | effect | meaning |
|---|---|---|
| `ln` | `( number -- num )` | natural logarithm; `x <= 0` is `E_RANGE` |
| `log2`, `log10` | `( number -- num )` | base 2 and base 10 logarithms; `x <= 0` is `E_RANGE` |
| `exp` | `( number -- num )` | e to the x; an infinite result is `E_RANGE` (§3.2) |
| `sin`, `cos`, `tan` | `( number -- num )` | radians |
| `asin`, `acos` | `( number -- num )` | `|x| > 1` is `E_RANGE` |
| `atan` | `( number -- num )` | |
| `atan2` | `( y:number x:number -- num )` | angle of the point (x, y); deepest is `y` |
| `sinh`, `cosh`, `tanh` | `( number -- num )` | an infinite result is `E_RANGE` |
| `fpow` | `( base:number exp:number -- num )` | power on floats; a NaN or infinite result (a negative base with a fractional exponent, zero to a negative power, overflow) is `E_RANGE`. (`pow` stays the exact integer power.) |
| `pi` | `( -- num )` | 3.141592653589793 |
| `str>num` | `( str -- num )` | see below |

As for `sqrt`, an `int` argument is converted to `num` (a `bigint` beyond ±(2^53-1) is `E_COERCE`, §3.2) and the result is always `num`, never NaN or infinite (§3.2: `E_RANGE`). Names follow the C and ECMAScript names; `fpow` avoids `**` and a clash with `pow`.

**`str>num`.** Parses the *whole* string, no trimming, with the grammar

```ebnf
num-text   = [ "-" ] , digits , [ "." , digits ] , [ exponent ] ;     (* digits, exponent as §2.5; "_" is NOT allowed *)
```

so `"12"`, `"-0.5"`, `"1.5e3"`, `"2E-2"` are valid and give a `num` (`"12"` gives `12.0`; use `str>int` for an `int`). No leading `+`, no `.5` or `5.`, no hex, no `NaN`/`Infinity`, no spaces. A string that does not match, or whose value overflows to infinity (`"1e999"`), is `E_COERCE` (the precedent is `str>int`, §13.5). `-0` parses to `-0.0` as the literal `-0.0` does (§2.5).

**Determinism.** The transcendental words call the host's `Math` functions. ECMAScript does not require them to be bit-identical across engines; V8, SpiderMonkey and JavaScriptCore may differ in the last digit for `sin`, `exp`, `tanh` and others, whereas `sqrt` and the arithmetic operators are exact (IEEE). So a recipe that prints the result of `sin` can differ in the last digit between browsers. This is documented in the word's `doc`, vectors use only values that are exact on every engine (`0 exp`, `8 log2`, `100 log10`, `0 sin`, `0 cos`) or round the result, and the choice to ship a bundled implementation (an fdlibm port, about 600 lines, pure TypeScript) instead is Q6.

**Errors.** `E_RANGE` (domain and non-finite), `E_COERCE` (bigint argument; `str>num` parse failure). No new code.

**Before and after.** `analysis.fth` line 18 (entropy):

```forth
[ count total / dup _log2 0.0 swap - * ]
```

```forth
[ count total / dup log2 0.0 swap - * ]
```

and the private primitive `analysis:_log2` and the coordinates helpers `coords:_math`/`_atan2` can go (a content WP; each rewrite changes the hash of the word, so it is done at a wave boundary).

**Amends.** LANGUAGE.md §13.2 and §13.5 (rows), §3.2 (a sentence: transcendental results follow the host), §17.1 (the "floating-point transcendental functions" item is removed). Code: `vocab/core.ts` (or new `vocab/numeric.ts`), `vocab/core.test.ts`, `runtime.test.ts` (count).

**Compatibility.** New names only; `pow`, `sqrt` and the float rules are unchanged. The corpus defines none of these names in a vocabulary and has two locals called `exp` (W_SHADOW, section 0.3).

**Conformance cases (proposed).**

```fl-test
# C273 exact values
@run
0 exp . 1 ln . 8 log2 . 100 log10 . 0 sin . 0 cos . 0 atan .
@out
1.0
0.0
3.0
2.0
0.0
1.0
0.0
```

```fl-test
# C274 atan2 takes y then x
@run
1 1 atan2 .
0 -1 atan2 pi = .
@out
0.7853981633974483
true
```

```fl-test
# C275 domain errors are E_RANGE
@run
0 ln
@error
E_RANGE
```

```fl-test
# C276 a float result must be finite
@run
1000 exp
@error
E_RANGE
```

```fl-test
# C277 asin domain
@run
2 asin
@error
E_RANGE
```

```fl-test
# C278 str>num
@run
"1.5e3" str>num .
"-2" str>num .
"0.25" str>num .
@out
1500.0
-2.0
0.25
```

```fl-test
# C279 str>num is strict
@run
" 1" str>num
@error
E_COERCE
```

```fl-test
# C280 str>num refuses non-finite and non-decimal text
@run
"1e999" str>num
@error
E_COERCE
```

**Alternatives considered.** (a) A single `math` word with a `choice` name (`1 "sin" math`): rejected, a choice is a string compared at run time and hides the arity (`atan2` takes two). (b) Return `NaN`/`Infinity`: rejected by §3.2 (`num` is finite) and by the missing literal. (c) A separate `math` vocabulary: rejected, the vocabulary would be imported by almost everything that uses `sqrt`, and a name like `ln` is unambiguous. (d) Exact (correctly rounded) implementations: costly, see Q6.

---

### 13. Promoted `util` words and typed failure words

**Motivation.** `util` is internal and not in `core`: `USING: util` or `util:` is needed for 1,092 qualified calls in the current corpus (92 words; section 0.2). Twenty-nine words are called from six or more vocabularies, twenty of them generic. The failure words have the larger count: 517 qualified `raise:coerce`/`raise:range` calls (TOOLKIT: 253), and PLAN §7 wave 4 records that `USING: raise` shadows the core word `range`, so the calls must be written qualified. TOOLKIT §11.1 proposes both promotions.

**Failure words.** Two new primitives in `core`, named with the `fail-` prefix that `fail` already uses and that cannot clash with `range`:

| word | effect | meaning |
|---|---|---|
| `fail-coerce` | `( reason:str -- )` | raise `E_COERCE`: the data cannot be read as the format |
| `fail-range` | `( reason:str -- )` | raise `E_RANGE`: an argument has a bad value |

They raise **exactly the errors that `raise:coerce` and `raise:range` raise today** (same code, message and `detail`: `fail-coerce` builds `cannot convert str to bytes: <reason>` with `detail { from: "str", to: "bytes", reason }`, `fail-range` the reason as the message with empty `detail`; see `coerceFailure` and `rangeFailure`, prim-util.ts lines 25 to 36), so a later rewrite of a call site changes no vector. Only `ForgeError.word` differs (`core:fail-range` instead of `raise:range`), which no vector checks. `raise:coerce` and `raise:range` stay, unchanged and with their present hashes.

**Promoted words.** Twenty `util` words are copied into `core`, with the same name, effect and behaviour. They are written in **FL**, in a prelude unit that `createRuntime` loads with `trusted: true` into `core` (`IN: core` is allowed for a trusted load, §5.3, §6.5), as **verbatim copies of the `util` bodies**, with `raise:range` replaced by `fail-range`. So there is nothing to port and equivalence is by construction; the cost is the load of about 20 small words per runtime, to be measured (budget: under 1 ms). A native implementation of the hottest few can replace the FL copy later without changing the contract.

| word | effect (unchanged) | calls in files (current) |
|---|---|---|
| `between?` | `( n:int lo:int hi:int -- bool )` | 67 in 23 |
| `cp>str` | `( cp:int -- str )` | 61 in 26 |
| `int>be-bytes` | `( v:int n:int -- bytes )` | 48 in 24 |
| `space?` | `( b:int -- bool )` | 42 in 20 |
| `starts-with?` | `( s:str prefix:str -- bool )` | 36 in 14 |
| `repeat-str` | `( s:str n:int -- str )` | 29 in 14 |
| `pad-hex` | `( v:int n:int -- str )` | 29 in 11 |
| `check-int-range` | `( n:int lo:int hi:int what:str -- )` | 28 in 12 |
| `digits>int` | `( vals:bytes radix:int -- int )` | 25 in 19 |
| `contains?` | `( items:list x:any -- bool )` | 24 in 12 |
| `strip-space` | `( s:str -- str )` | 23 in 15 |
| `trim-end` | `( s:str pred:quot -- str )` | 22 in 16 |
| `zero-bytes` | `( n:int -- bytes )` | 22 in 10 |
| `trim-start` | `( s:str pred:quot -- str )` | 17 in 13 |
| `ends-with?` | `( s:str suffix:str -- bool )` | 18 in 10 |
| `count-leading` | `( items pred:quot -- int )` | 16 in 8 |
| `dec-digit?` | `( c:int -- bool )` | 18 in 8 |
| `hex-digit?` | `( c:int -- bool )` | 15 in 9 |
| `sum` | `( xs:list -- int )` | 8 in 7 |
| `ceil-div` | `( n:int d:int -- int )` | 7 in 6 |

The cut is **generic words called from at least six vocabularies** (counted as qualified `util:` calls in `vocab/*.fth` outside `util.fth`; 29 words pass the count). The other nine are domain words and stay in `util`: `decode-table` and `check-symbols` (alphabet codecs), `b64url-encode`, `number-tokens` and `match-texts` (text and regex helpers), `delimiter` (it maps the UI choices and belongs with the shared `choice` types of item 4), `list-flatten` (item 10 turns it into a one-line `collect`), `str-chunks` and `int>bytes` (candidates for a later promotion, Q7). Deliberate differences from TOOLKIT §11.1: `index-of` is not promoted (`util:index-of` is a bytes-only permutation word with no external caller in the corpus; a general `index-of` is `find`), `tdiv` is not (one call, in one file), `zero-pad` and `letter?` are not (four vocabularies each), and `repeat` is named `repeat-str` as in `util`. `util:delimiter` and `util:separator` are not promoted: they map the UI choices and belong with the shared `choice` types (item 4).

**Nothing existing changes.** The `util` and `raise` words are not touched. `util:between?` has the same text, so the same hash, as today; the new `core:between?` is a different word with its own hash. Resolution is unaffected: in `IN: util` code and in code with `USING: util`, the unqualified `between?` still resolves to `util:between?` (current vocabulary, then imports, then `core`); in other code it was `E_UNDEFINED` and is now `core:between?`. So **no caller changes behaviour and no hash changes**. Moving callers from `util:between?` to `between?` is a corpus codemod at a wave boundary (it changes hashes and the catalogue version, TOOLKIT §11.5 "Migration"); it is a separate work package (section 15, WP 6.11), and Q7 asks whether it should run at all.

**Equivalence test** (in `packages/ops`, which has both vocabularies: `src/core-promotion.test.ts`): for each of the twenty words, run the `util` and the `core` version over a table of arguments, including every error case, and require the same results and the same error codes and messages.

**Types.** None beyond item 12's primitives. **Errors.** None new. **Limits.** The prelude's words are ordinary FL under the usual limits.

**Before and after.** Today:

```forth
\ rsa.fth, one of 49 calls in that file
… "the digest must be SHA-1, MD5, SHA-256, SHA-384 or SHA-512" raise:range
```

After (when a content WP migrates it):

```forth
… "the digest must be SHA-1, MD5, SHA-256, SHA-384 or SHA-512" fail-range
```

and `1 2 util:between?`/`USING: util ; … between?` become `between?` anywhere.

**Amends.** LANGUAGE.md §13 (a subsection 13.8 "Prelude words" for kind **F**, the twenty rows and the two failure rows in §13.6; the "Total" line), §5.3 (a sentence: the runtime loads one trusted unit into `core` at construction), §17; PLAN §3.5 (the paragraph on `raise` and `util` gets a pointer). Code: `vocab/core.ts` (failure words), `vocab/prelude.ts` (new; the FL source as a string constant, so no file-loading infrastructure is needed), `runtime.ts` (load the prelude in `createRuntime`), `vocab/core.test.ts`, `runtime.test.ts` (the `toHaveLength(102)` assertion), and in ops `src/core-promotion.test.ts`.

**Compatibility.** As above. The current corpus has no local named like one of the twenty words (they would emit `W_SHADOW`), and `arith.fth` defines its own public `sum`, which keeps shadowing `core:sum` inside `arith`.

**Conformance cases (proposed).**

```fl-test
# C281 fail-range and fail-coerce raise the typed errors
@run
[ "bad" fail-range ] [ "code" get ] try .
[ "bad" fail-coerce ] [ "code" get ] try .
@out
E_RANGE
E_COERCE
```

```fl-test
# C282 fail-coerce carries the reason
@run
"bad-bytes" fail-coerce
@error
E_COERCE detail.reason=bad-bytes
```

```fl-test
# C283 promoted words behave as their util twins
@run
5 1 10 between? . 11 1 10 between? .
"abc" "ab" starts-with? . "abc" "bc" ends-with? .
255 4 pad-hex .
"xxab" [ 'x' = ] trim-start .
{ 1 2 3 } sum . 7 2 ceil-div .
@out
true
false
true
true
00ff
ab
6
4
```

```fl-test
# C284 check-int-range raises E_RANGE with the documented message
@run
12 0 9 "the level" check-int-range
@error
E_RANGE
```

```fl-test
# C285 a vocabulary's own word shadows a promoted word
@unit
IN: demo
: between? ( n:int -- bool ) n 0 > ;
: t ( -- bool ) 5 between? ;
@run
demo:t .
@out
true
```

**Alternatives considered.** (a) Make the `util` words aliases of the core words: rejected, an alias shares the target's hash (§12.4), which would change the hash of every `util` word. (b) Implement all twenty natively in TypeScript: rejected as the first step: verbatim FL is zero-risk and the equivalence test proves it; native versions are an optimisation. (c) Move `util` into `core` and delete it: rejected, it would break `util:…` calls, `USING: util` and 1,092 call sites. (d) A single `fail ( code:str reason:str -- )` taking a code name: rejected, it would let untrusted code raise `E_INTERNAL`, `E_FORBIDDEN` or a limit code and so forge the uncatchable errors (§8, D19); a closed pair of words cannot.

---

### 14. Bug fix: `ForgeError.frames` loses the outermost frames

**The bug.** `ForgeError.frames` keeps "the top 16 return-stack word frames, innermost first" (§11). The VM collects them from the top of the return stack and stops at 16 (vm.ts line 646, `frames.length < 16`), and the constructor slices to 16 again (errors.ts line 248, `slice(0, MAX_SNAPSHOT)`). An error raised more than 16 word and quotation frames deep therefore has no frame for the recipe's compiled word, which is at the **bottom** of the stack. The recipe layer attributes an error to a recipe step with `attributeError(word, frames, map)` (packages/recipe/src/stepmap.ts line 82), which finds the first frame whose word is `bake:main`; called from `packages/worker/src/core.ts` line 462. When the frame is missing it returns `null` and the error has no step path (RECIPES.md R12). PLAN §7 wave 7 records that the packet and fingerprint words validate in a shallow pass first to avoid this, and that the fix "belongs in the frozen core … and is a candidate for a bug fix". It is the one change in this document that fixes a defect rather than adds a feature, and the unfreeze allows it.

**Design.** Keep the stack snapshot at 16 values (`MAX_SNAPSHOT`, unchanged). Raise the frame limit to **64**, split as **the 32 innermost and the 32 outermost** word and quotation frames when there are more than 64:

- `MAX_FRAMES = 64` (new constant in errors.ts; `MAX_SNAPSHOT` stays 16 and is used only for values).
- VM `enrich` (vm.ts lines 630 to 665): collect all `K_WORD`/`K_QUOT` frames; if there are at most 64 keep them all; otherwise keep the first 32 from the top and the last 32 from the bottom, in the same innermost-first order.
- `ForgeError` gains `framesSkipped: number` (0 when nothing was dropped): the number of frames between the two kept runs. `ForgeErrorInit.framesSkipped?: number`, `ForgeErrorShape.framesSkipped: number`, `toJSON()` includes it. The constructor keeps at most `MAX_FRAMES` entries of `init.frames` (it no longer cuts to 16).
- The innermost-first order and every field of a frame are unchanged, so `frames[0]` is still the innermost and `frames.find(f => f.word === w)` still finds the innermost match.

**Why 32 + 32.** A recipe is compiled to one word `bake:main` whose container steps add quotation frames of the same word and `recipe:*` words; RECIPES.md §3 limits the nesting depth to 8, so the recipe's own frames occupy about 3 frames per level, at most about 27 near the bottom. 32 outermost frames therefore always contain every frame of `bake:main`, whatever happens above them, including the 10,000-frame recursion limit. The innermost 32 keep the error's own context (today's 16 are a subset). `attributeError` needs no change and `packages/recipe` and `packages/worker` are not touched.

**Behaviour change, stated.** Errors raised 17 to 64 frames deep now report all their frames instead of the first 16 (a longer array); errors deeper than 64 report 64 with `framesSkipped > 0`. The existing tests `errors.test.ts` line 88 ("keeps the top 16 snapshot values and the first 16 frames") and `vm.test.ts` line 971 ("the snapshot is the top 16 values and the frames the first 16"; its recursion is 20 deep) change their frame expectations; the snapshot expectations stay. Nothing reads `frames.length` outside tests.

**Types.**

```ts
export interface ForgeErrorInit {
  /* … */
  readonly frames?: readonly ErrorFrame[];      // at most 64 are kept
  /** Frames dropped between the kept innermost and outermost runs. Default 0. */
  readonly framesSkipped?: number;
}
export interface ForgeErrorShape extends Error {
  /* … */
  readonly frames: readonly ErrorFrame[];
  readonly framesSkipped: number;
}
```

**Errors/limits.** No new code. Memory: 64 small objects per error, created once at the error. The 16-value snapshot is untouched.

**Amends.** LANGUAGE.md §11 (the `frames` row: "the innermost 32 and the outermost 32 return-stack word frames, innermost first, and `framesSkipped`"; the constructor note). RECIPES.md R12: a clause that attribution relies on the outermost frames being kept. Code: `packages/lang/src/errors.ts`, `vm.ts` (`enrich` only), `types.ts`, `errors.test.ts`, `vm.test.ts`; and one integration test in `packages/ops/src/` (which may import the worker's in-process baker as other ops tests do) that bakes an op whose error is raised more than 64 frames below `bake:main` and checks the step path.

**Compatibility.** Additive field; `frames` still innermost-first; the first 16 entries of any error are what they were. Hashes and metadata unaffected.

**Tests (unit; the §16 harness has no `frames` assertion).** (1) 20-deep recursion: 22 frames, `framesSkipped` 0. (2) 200-deep recursion: 64 frames, `framesSkipped` > 0, the last frame is `<console>`, the first is the raising word. (3) A deep error under a compiled recipe-like word: the `main` frame is present. (4) `toJSON().framesSkipped`. (5) `with()` preserves `framesSkipped`.

**Alternatives considered.** (a) Raise the cap to 16 + k only at the outer end (always keep the outermost 4): rejected, the deepest `bake:main` quotation frame may be anywhere in the bottom 30 frames. (b) Record the recipe-step attribution inside the VM: rejected, the VM does not know recipes (D34). (c) Have the worker keep its own frame chain through `onStep`: rejected, it costs a hook call per instruction (R12 chose "no per-instruction cost"), and it is a change in a package outside the unfreeze. (d) Remove the cap: rejected, a 10,000-deep `E_LIMIT_RETURN` would produce a 10,000-element array in every error and in its JSON.

---
## 15. Implementation work packages

Ids are proposed as 6.3 to 6.14 (6.1 and 6.2 are taken); renumber freely. Each package follows CLAUDE.md: its own `wp/<id>` branch and worktree, explicit file ownership, a self-contained brief, no AI attribution trailers, no push without the owner's go-ahead, every new source file with the Apache-2.0 header. The orchestrator verifies each result (diff, files, merge) and re-runs `npm run lint && npm run typecheck && npm test && npm run build`, `npm run e2e` and `npm run size`; at the end it also runs `npm run gate2:browser -w @forge/worker` and the production-header check of the built app.

### 15.1 The hash guard (applies to every package)

Rule 3 of section 0.3 (no existing hash changes) and rule 4 (the catalogue is byte-identical) are checked mechanically. WP 6.3 adds `packages/ops/scripts/hash-snapshot.ts`, which loads the full bundle and prints one line `qname hash` for every word of every vocabulary (core included) followed by the SHA-256 of `dist/catalogue.json`. The "done when" of **every** package below includes: *run the snapshot on the merge base and on the branch; the diff is empty* (except WP 6.4, where the diff is exactly the added `core` words, and WP 6.12b, which is a deliberate migration). This is a script and a comparison, not a committed fixture, so unrelated vocabulary work does not break it.

### 15.2 Packages

**WP 6.3, frames fix, harness and hash guard** (item 14; section 0.4; 15.1).

- Owns: `packages/lang/src/errors.ts`, `errors.test.ts`; `packages/lang/src/vm.ts` (the `enrich` function only) and `vm.test.ts`; `packages/lang/src/types.ts` (the `ForgeErrorInit`/`ForgeErrorShape` members only); `packages/lang/test/conformance.test.ts`, `test/conformance/parse.ts` and `parse.test.ts` (read `docs/LANGUAGE-0.2.md` in addition to LANGUAGE.md; `fl-test` blocks of both files form one suite; case ids are unique across the two files); `packages/ops/scripts/hash-snapshot.ts`; `packages/ops/src/frames-attribution.test.ts` (new).
- Depends on: nothing. Agent: Sonnet (small, spec-critical).
- Done when: the five frames tests of item 14 pass; the existing worker and recipe tests pass unchanged; the integration test shows a step path for an error raised 70 frames below `bake:main`; a block in LANGUAGE-0.2.md with the `fl-test` info string is picked up by the harness and one with `fl-proposed` is not; the hash snapshot of the branch equals the base.

**WP 6.4, core words and the prelude** (items 12 and 13; `has-key?` and `sort` of item 11).

- Owns: `packages/lang/src/vocab/core.ts`, `vocab/core.test.ts`; new `vocab/numeric.ts` and `numeric.test.ts` (the maths table); new `vocab/prelude.ts` and `prelude.test.ts` (the FL source of the twenty promoted words as a string constant); `packages/lang/src/runtime.ts` (load the prelude in `createRuntime`, trusted, into `core`; nothing else) and `runtime.test.ts` (the word count); `packages/ops/src/core-promotion.test.ts` (new).
- Depends on: nothing (parallel with 6.3). Agent: Sonnet (prelude and equivalence); the maths table may be briefed to Haiku.
- Done when: C-cases of items 12 and 13 and of `has-key?`/`sort` flip to `fl-test` and pass; the equivalence test passes for all twenty words (results, error codes and messages); `fail-coerce`/`fail-range` raise errors equal to `raise:coerce`/`raise:range` in code, message and `detail`; the `core` count in `runtime.test.ts` and in LANGUAGE.md's "Total" line is updated; `createRuntime` takes less than 1 ms longer (measured, reported); the hash snapshot differs only by the added `core` words.

**WP 6.5, discovery metadata clauses** (items 1, 2, 3, 5).

- Owns: `packages/lang/src/meta.ts` (`WordMetaBuilder`, `clauseFromArgs`, `renderHelp`), `meta.test.ts`, `meta.schema.json`; `packages/lang/src/types.ts` (the `WordMeta`/`WordDiscovery`/`MetaLink` members only); `packages/lang/src/compiler.ts` (the `metaForm` function and the end-of-unit pass for `inverse`) and `compiler.test.ts` (META tests).
- Depends on: 6.3 (the `types.ts` hand-over). Agent: Sonnet.
- Done when: cases C201 to C217 and C228 pass as `fl-test`; the JSON of every existing word is byte-identical (`discovery` absent), shown by the existing `meta.test.ts` unchanged; `help` output unchanged for words without the clauses; `meta.schema.json` validates every `WordMeta` the bundle produces; the hash snapshot is identical.

**WP 6.6, vector examples, `buildHelp` and `help.json`** (items 6 and 7).

- Owns: `packages/ops/src/help.ts`, `help.test.ts`, `help.schema.json` (new); `packages/ops/scripts/help.ts` (new); `packages/ops/src/types.ts`, `src/index.ts`; `packages/ops/package.json` (exports, `build` script); `packages/ops/vocab/vectors.schema.json`, `vocab/vectors.test.ts`; `packages/ops/README.md`.
- Depends on: 6.5 (it reads `WordMeta.discovery`; it may start earlier against the TypeScript type of section 1 and merge after). Agent: Sonnet.
- Done when: `npm run build -w @forge/ops` writes `dist/help.json` that validates against `help.schema.json` and is under the 1.5 MiB budget; the SHA-256 of `dist/catalogue.json` is identical before and after; `buildHelp` tests (section 7) pass; a vector with `example` validates and a fourth example for one op fails the builder; the vector runner still passes all 7,302 vectors; `@forge/ops/help.json` and `help.schema.json` resolve through `exports`.

**WP 6.7, mid-body locals and `exit`** (item 8; `exit` of item 11).

- Owns: `packages/lang/src/reader.ts`, `reader.test.ts` (the `COLON_KEYWORDS` set, line 48, gets `:>`); `compiler.ts` (locals scope as a stack, `bind`, the exit-context check, `lower` exceptions) and `compiler.test.ts`; `vm.ts` (`bind`, `exit`, the `own` copy at `callq` and in the combinators, the entry loop of lines 1022 to 1026) and `vm.test.ts`; `types.ts` (`Instruction`, `Quotation`, `CompiledWord` members only).
- Depends on: 6.3 and 6.5 (the same files). Agent: Sonnet.
- Done when: the cases of item 8 and the `exit` cases pass; every existing conformance case passes unchanged; the compiled instruction arrays of all bundle words are identical to before (a test compares `code` for the whole bundle against the base); a closure test proves per-run locals in a `map` body and a lowered `while`; the hash snapshot is identical.

**WP 6.8, collectors and the iteration combinators** (item 10; `cond`, `case`, `sort-by`, `find`, `any?`, `all?` of item 11).

- Owns: `vm.ts`, `compiler.ts` (intrinsic table, optional lowering of `cond`/`case`), `types.ts` (`CombinatorName`, `IntrinsicName`, `Instruction`), `packages/lang/src/vocab/core.ts` (`CORE_INTRINSIC_WORDS` list only) and their tests.
- Depends on: 6.4 (core.ts) and 6.7 (vm.ts, compiler.ts). Agent: Sonnet.
- Done when: cases of items 10 and 11 pass; the linear-meter case passes; `list-flatten`-style code with 4,000 small lists no longer exhausts `maxTotalBytes`; the Performance requirement of §10.4 still holds (10^6 simple steps in under 200 ms, measured before and after); step counts of existing words unchanged.

**WP 6.9, shared choice types** (item 4).

- Owns: `packages/lang/src/dictionary.ts`, `dictionary.test.ts`; `meta.ts` (header parser resolver, `computeHash` type lines, `build` for `optionDocs`) and tests; `reader.ts` (the `CHOICE:` keyword); `compiler.ts` (the `CHOICE:` form and passing the resolver to `parseHeader`); `types.ts`; `meta.schema.json`; `packages/ops/src/scan.ts` and `scan.test.ts` (header references as dependencies).
- Depends on: 6.5 and 6.7. Agent: Sonnet.
- Done when: cases C218 to C227 pass; a word without a type reference has an identical hash; a moved-to-shared header gives an identical catalogue `effect` and `params`; the scanner orders a unit that uses `choice<util:padding>` after `util`.

**WP 6.10, `MEMO:`** (item 9).

- Owns: `reader.ts` (the `MEMO:` keyword), `compiler.ts` (the memo form, `stateful` propagation), `vm.ts` (`memo` instruction, store at `ret`), `runtime.ts` (`warm`, `memoLimits`, `memoCacheBytes`), `types.ts`, and tests.
- Depends on: 6.8, 6.9 (same files, one at a time). Agent: Sonnet.
- Done when: cases of item 9 pass; the evaluation-counter test shows one build for any number of calls and one build per runtime; the cache cap test shows a value over the cap is returned and not cached; `warm()` reports built and failed words; `html:_table` rewritten as `MEMO:` in a scratch copy builds the 2,231-entry record once (measured, reported; the rewrite itself is WP 6.12b).

**WP 6.11, specification fold-in.**

- Owns: `docs/LANGUAGE.md`, `docs/RECIPES.md`, `docs/PLAN.md` (the §3.5 pointer and the Phase 6 entry), `docs/LANGUAGE-0.2.md` (becomes a short historical note, or is deleted, as the owner prefers).
- Depends on: all of 6.3 to 6.10. Agent: Sonnet.
- Done when: every section named in an "Amends" paragraph is updated; the cases are in LANGUAGE.md §16 with their C2xx numbers; §17 has the decisions of section 18; §17.1 no longer lists the items now present (transcendental functions, `exit`) and keeps `checks` with a pointer to section 5; LANGUAGE.md's status line says "v0.2"; the harness reads one file again; `npm run lint` and `npm test` pass.

**WP 6.12a, content: discovery data for the bundle** (optional, any time after 6.6, no hash change).

- Owns, per brief: the `META:` blocks of the `.fth` files and the `.test.json` of one group of vocabularies each (parallel agents; no two own the same vocabulary), plus a ratchet test in `packages/ops/src/help.test.ts`. Adds `use-when`, `link`, `inverse` and chooses examples from existing vectors. Agent: Haiku with a Sonnet review of the first group.
- Done when: the hash snapshot is identical and `catalogue.json` is byte-identical (META is neither hashed nor catalogued), `help.json` grows, the coverage count does not go down.

**WP 6.12b, content: adopting the new forms** (optional, a deliberate migration, owner approval and a wave boundary).

- Replaces `raise:` calls with `fail-*`, `util:` calls with promoted words, repeated `choice{…}` lists with shared types, helper chains with `:>`, else-if chains with `case`, table words with `MEMO:`, and removes the primitives made redundant (`analysis:_log2`, parts of `coords`, the three sort/shuffle helpers where applicable). **Hashes change and the catalogue version changes**, so this is TOOLKIT §11.5's codemod question; see Q7. Not part of this proposal's scope unless the owner says so.

**WP 6.13, UI consumption** (apps/web; a continuation of WP 6.1's line, outside the lang/ops unfreeze).

- Lazy `import("@forge/ops/help.json")`, the `help.catalogue === catalogue.version` check, the help page with examples and links (rendered as text, `rel="noopener noreferrer"`), the inverse suggestion, option help in the parameter form. Depends on 6.6.

**WP 6.14, update the IntelliJ plugin** (**owned by the owner, outside this repository**).

- A follow-up to be scheduled by the owner once the syntax packages land. Input: section 16 of this document (the language surface to support), and the final LANGUAGE.md. It depends on 6.5 (META clauses), 6.7 (`:>`), 6.9 (`CHOICE:`, `choice<…>`), 6.10 (`MEMO:`), and 6.4 and 6.8 (new `core` words for completion). Nothing in this repository is changed by it, and this document says nothing about how the plugin is built.

### 15.3 Order and dependencies

```
6.3 ──┬─> 6.5 ──┬─> 6.6 ──> 6.12a ──> 6.13
      │         ├─> 6.7 ──> 6.8 ──> 6.9 ──> 6.10 ──┐
6.4 ──┴─────────┴─────────────────^                 ├─> 6.11
                                                    └─> 6.14 (owner)
                                 6.12b (optional, wave boundary, after 6.11)
```

Parallel from the start: 6.3 and 6.4 (disjoint files). After 6.3: 6.5. After 6.5: 6.6 and 6.7 in parallel (ops and lang are disjoint). Then the lang compiler/VM chain 6.7, 6.8, 6.9, 6.10 is **sequential** because all four edit `compiler.ts`, `vm.ts` and `types.ts` and two edit `reader.ts`. To shorten the chain each package should put its new code in new files (`compiler-choice.ts`, `compiler-memo.ts`, `vm-collect.ts`, and so on) and touch the shared files only for a hook of a few lines; that keeps rebases trivial but does not remove the ordering rule.

Shared-file table (who owns it in which order):

| File | Owners in merge order |
|---|---|
| `packages/lang/src/types.ts` | 6.3, 6.5, 6.7, 6.8, 6.9, 6.10 |
| `packages/lang/src/compiler.ts` | 6.5, 6.7, 6.8, 6.9, 6.10 |
| `packages/lang/src/vm.ts` | 6.3 (`enrich`), 6.7, 6.8, 6.10 |
| `packages/lang/src/reader.ts` | 6.7, 6.9, 6.10 |
| `packages/lang/src/meta.ts` | 6.5, 6.9 |
| `packages/lang/src/vocab/core.ts` | 6.4, 6.8 |
| `packages/lang/src/runtime.ts` | 6.4, 6.10 |
| `docs/LANGUAGE-0.2.md` | each package edits only the fences of its own cases; 6.11 last |

---

## 16. Tooling affected

An editor plugin for FL (the IntelliJ plugin, which lives outside this repository and is maintained by the owner) must be updated when the syntax changes. This section lists, per item, **what the language accepts**; it does not describe, and does not guess at, how the plugin is built. No FL highlighter, parser or completion source exists in this repository (checked: nothing under `apps/web/src` tokenises FL; the console passes source to the runtime).

Summary of the token-level change: the keyword set of reader rule 9 (`COLON_KEYWORDS`, reader.ts line 48) grows from `: ; IN: USING: META:` to also contain **`:>`**, **`MEMO:`** and **`CHOICE:`**. No reserved word is added (§2.11 list unchanged). `IN:foo`-style glued forms keep lexing as qualified names (`MEMO:foo` is the qualified name `MEMO:foo`).

| # | What the plugin must learn |
|---|---|
| 1 | In a `META:` block: clause `use-when <string> ;` and clause `link <string> [<string>] ;`. The first `link` string is a URL (`https` only, section 1): highlight it as a link and optionally validate it with the section 1 grammar. |
| 2 | Clause `inverse <name> ;` (one name, qualified only with the current vocabulary). Name completion from the current vocabulary's public words; a go-to-definition target. |
| 3 | Clause `helper ;` (no arguments). A word with it is public but not an operation. |
| 4 | A new top-level block `CHOICE: <name> { option <word | integer | string> [<string>] ; } ;`: starts at `CHOICE:`, each `option` clause ends at `;`, the block ends at the empty `;` (the shape of `META:`); the clause keyword `option` is valid only inside it. A new header type `choice<name>` and `choice<vocab:name>` (next to `choice{…}`), valid as a `ptype` in a header and nowhere else, with name completion over choice types, go-to-definition to the `CHOICE:` block and an unknown name reported. Header scanning must not break on `<` and `>` in `choice<…>`. The `=default` after it is checked against the options. |
| 5 | The word `checks` is a **reserved** `META:` clause name (not implemented in this wave): highlight as a reserved keyword, do not offer completion for its arguments. |
| 6 | None (vector JSON is not FL). |
| 7 | None for the language. Optional: the plugin may read `help.json` for hover documentation. |
| 8 | The token `:>` followed by one word: it **declares a local** named by that word, visible from the next token to the end of the enclosing `[ … ]` or definition. References to it resolve as locals (go-to-definition, rename, highlighting like a header parameter); a duplicate of a visible local is an error; `:>` is invalid inside `{ … }` and outside a definition. |
| 9 | A new defining form `MEMO: name ( -- type ) … ;` with the structure of `: name ( … ) … ;`: same header, leading `"…" doc` and `"…" category` declarations, body, `;`. Folding, structure view and word indexing treat it like `:`. The header must have no inputs and one output. |
| 10 | New core words `collect collect-bytes collect-str` (each takes a quotation) and `emit emit-all`. Optional inspection: `emit` and `emit-all` are only meaningful while a `collect*` is active (a runtime rule, not decidable from the text of one word). |
| 11 | New core words `cond case has-key? sort sort-by find any? all? exit`. `cond` and `case` take a list of quotations; completion may template them. Inspection: `exit` is a compile error inside a quotation that is not an argument of `if`, `when`, `unless`, `while` or `loop`, and inside `{ }`. |
| 12 | New core words `ln log2 log10 exp sin cos tan asin acos atan atan2 sinh cosh tanh fpow pi str>num`. |
| 13 | New core words `fail-coerce fail-range` and the twenty promoted words (`between? cp>str int>be-bytes space? starts-with? ends-with? repeat-str pad-hex check-int-range digits>int contains? strip-space trim-start trim-end count-leading dec-digit? hex-digit? zero-bytes sum ceil-div`). The old `util:` and `raise:` forms stay valid. |
| 14 | None. |

Completion data for core words: `"core" words` at the console, or the table in LANGUAGE.md §13 after WP 6.11. Word effects come from the stack-effect headers.

---

## 17. Open questions for the owner

Each has a recommendation; the design above assumes the recommendation.

1. **Spelling of the new tokens.** `:>` (bind), `MEMO:` (memoised word), `CHOICE:` (shared type) with `option` clauses, `choice<name>` in headers, and the clause names `use-when`, `link`, `inverse`, `helper`, `checks`. The IntelliJ plugin must follow whatever is chosen, so changing a spelling is cheapest now. *Recommendation: keep.*
2. **One name per `:>`.** The alternative is `:> a b c` with a terminator token. *Recommendation: one name; it needs no second token (section 8).*
3. **`link` in user units.** The clause is syntax-checked in every unit; `help.json` is built from the bundle only, so a user's links never reach it. The alternative is `E_UNTRUSTED` for `link` outside trusted loads. *Recommendation: accept everywhere, and have the UI treat links from non-bundle units as untrusted.*
4. **Should `CatalogueOp` carry `inverse`?** Only if the operations list itself shows an "has inverse" badge. *Recommendation: no; keep the catalogue unchanged (format 1, same version) and load `help.json` lazily.*
5. **Option value mapping** (TOOLKIT §11.2 "optional value mapping"). This proposal gives option *help* and no mapping. *Recommendation: help only; add `option value "label" "help"` later if the form needs display labels (it is additive).*
6. **Cross-engine determinism of `sin`, `exp` and the rest.** Host `Math` can differ in the last digit between browsers; an fdlibm port (about 600 lines) would remove that. *Recommendation: host `Math` now, documented; port only if share-URL reproducibility of float output across browsers becomes a stated requirement.*
7. **Migration of the corpus** (WP 6.12b): rewriting 517 `raise:` calls, 1,092 `util:` calls, repeated `choice` lists, helper chains and table words changes hashes and bumps the catalogue version (TOOLKIT §11.5). Also whether to promote the remaining nine generic-ish `util` words (`str-chunks`, `int>bytes`, and so on). *Recommendation: not in this wave; ship the features, keep `raise:` and `util:` working indefinitely, and run one codemod at a wave boundary only after the features have been used in new vocabularies.*
8. **Error code for `emit` outside `collect`.** `E_EFFECT` (reused; a violated control-flow contract), or a new code, which would change the "exactly 34 codes" sentence and the schema. *Recommendation: `E_EFFECT`.*
9. **The caps**: `use-when` 160, link URL 300, label 80, 8 links, option help 200, 1024 options of 128 code points, 3 examples of 2,048 characters, `help.json` 1.5 MiB, memo cache 256 MiB, 64 frames, `warm` limits 2 M steps and 5 s. *Recommendation: as proposed; each is one constant.*
10. **`exit` only where it compiles to a jump.** No exit from inside `each` or `map`. *Recommendation: yes; `find`, `any?` and `all?` cover the scans, and a general escape needs a frame-liveness rule.*
11. **Promoted words as an FL prelude** (one trusted unit loaded into `core` at `createRuntime`) rather than native TypeScript. *Recommendation: FL prelude, measured; native for the hottest few later.*
12. **`sort` of a mixture raises `E_TYPE`**, whereas `list:sort` raises `E_COERCE`. *Recommendation: `E_TYPE`, consistent with `<`.*
13. **`inverse` only within a vocabulary.** *Recommendation: yes; cross-vocabulary relations stay `see-also`, which avoids the scanner cycles of PLAN §7.*
14. **Conformance workflow.** Proposed cases use `fl-proposed` fences in this file, C201 and up; the harness reads both files during the wave (WP 6.3) and WP 6.11 folds them into LANGUAGE.md. *Recommendation: yes.*
15. **`INTERNAL_VOCABS`.** With `helper` the internal vocabularies could shrink later (`list`, `json`, `asn1`, `random`). *Recommendation: leave it for a content WP; nothing in the language depends on it.*
16. **Calling `warm()` from the worker.** Should the worker's baker call `warm()` after `init` so the first bake does not pay for table builds? That is a `packages/worker` change, outside the unfreeze. *Recommendation: no; first-use evaluation is enough (the baker keeps the runtime across bakes, so the cost is paid once); revisit if first-bake latency is measured to matter.*

---

## 18. Decisions proposed

Numbered to continue LANGUAGE.md §17 (D1 to D49). Each is "proposed" until the owner accepts this document.

| # | Decision | Rationale |
|---|---|---|
| D50 | This wave adds no reserved word and no error code; every new token or form is one that is `E_LEX`, `E_HEADER` or `E_META` today. | Existing programs cannot change meaning (section 0.3). |
| D51 | Discovery metadata lives in an optional `WordMeta.discovery`, omitted when empty. | Existing JSON and tests are byte-identical. |
| D52 | `inverse` names one public word of the same vocabulary, checked at the end of the unit; symmetry is computed by `buildHelp`, not stored. | No cross-vocabulary dependency cycles; `META:` edits only its own word. |
| D53 | `helper ;` sets `WordMeta.op` to `false`; `INTERNAL_VOCABS` is unchanged. | The smallest way to be public but not an operation. |
| D54 | Shared `choice` types are a separate namespace, expanded at compile time; a word's hash includes the type's option hash only when it uses one. | Pins notice a changed option list; other hashes are untouched. |
| D55 | `help.json` is a separate lazily loaded build output; `catalogue.json`, `CatalogueOp` and `format` do not change. | A lean start-up and stable recipe `catalogue` versions. |
| D56 | `:>` binds one name; a quotation that contains it gets a fresh copy of its environment per call; such bodies are not lowered in `while`/`loop`. | Closures stay correct without mutable shared slots. |
| D57 | `MEMO:` words are evaluated on first use inside the calling run (so the caller's limits are the budget), cached per entry, and must be pure; `warm()` is the explicit load budget. | One async path; `load()` stays free of user code (§1, D23). |
| D58 | `collect*` creates a collector frame; `emit` acts on the innermost active collector; the value is metered once. | Linear time and allocation without a mutable value (D44). |
| D59 | `cond` and `case` take lists of quotations; `find` returns an index or -1; `exit` is only valid where it compiles to a jump. | No new syntax (D7, D8); no null value (§3.1). |
| D60 | Transcendental functions follow the host; `str>num` is strict and returns `num`. | Smallest implementation; documented non-guarantee. |
| D61 | Promoted `util` words are verbatim FL copies in a trusted prelude; `util` and `raise` stay unchanged; `fail-coerce`/`fail-range` raise the same errors as `raise:*`. | No hash or behaviour change; equivalence by construction. |
| D62 | `ForgeError.frames` keeps the 32 innermost and 32 outermost frames and reports `framesSkipped`. | Recipe step attribution needs the outermost frames. |
| D63 | `checks` is a reserved clause with a fixed shape; not implemented. | Phase 6 Magic needs no further grammar change. |
| D64 | Proposed conformance cases use `fl-proposed` fences and numbers C201 and up. | The harness runs only what exists. |

---

## 19. What this wave does not do

Left in [TOOLKIT.md](TOOLKIT.md) §11 or the PLAN §7 gap lists for later:

- **Breaking fixes** (group L-E): `reduce` argument order, `/` beyond 2^53, header-constraint error codes, `runtime.call` defaults, the `raise`/`range` clash, regex parameters with spaces, `\f`, help and `ref` caps (200), generic arithmetic.
- **The mutable buffer, 32-bit word intrinsics, `charge` and the kernel tier**, and the stateful-loop primitives they would replace.
- **The `ext` tag**, tagged literals, generic words.
- **Friend visibility** for private words, forward declarations and mutual recursion, `VARIABLE` with any initial value, a record literal, JSON words.
- **Value mapping for `choice`** (Q5), a null value, `first`/`second`/`last`/`divmod`, float bit packing, a general non-local `exit`.
- **Adopting any of the new features in the existing vocabularies** (WP 6.12b): this wave changes the language and the build outputs, not the 208 `.fth` files.
- **Magic itself**: only the shape of `checks` is fixed (section 5).
