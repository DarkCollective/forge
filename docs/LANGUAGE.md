# FL language specification, v0.1

Status: **v0.1, frozen for Phase 1 implementation** (WP 1.1). Source of truth for WPs 1.2 to 1.9. The TypeScript type contracts that go with this document are in [`packages/lang/src/types.ts`](../packages/lang/src/types.ts). Where this document and PLAN.md disagree, PLAN.md §9 decisions and §3 design choices win, and the disagreement is a bug in this document. Where this document is silent, the behaviour is unspecified and implementers must ask rather than guess.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. "Error `E_X`" means a `ForgeError` with that `code` (§11).

## Contents

1. Overview
2. Lexical grammar
3. Values
4. Coercion and validation
5. Defining forms
6. Name resolution
7. Parameters as locals
8. Control flow
9. Top-level code
10. Execution model
11. Errors
12. Metadata
13. The `core` vocabulary
14. Recipe compilation (summary)
15. Worked examples
16. Conformance
17. Design decisions

---

## 1. Overview

FL ("Forge language") is a Forth-like, stack-based language. A program is a sequence of whitespace-delimited tokens. Words operate on a **data stack** of tagged values. Words are grouped in **vocabularies**, and a name resolves lexically per source unit (§6).

There are two ways source text reaches the system:

| Mode | API | Allowed content | Effect |
|---|---|---|---|
| **Source unit** | `runtime.load(src)` | Definitions only (§5, §9) | Compiles and registers words. Atomic: any error registers nothing. Runs no code. |
| **Console** | `runtime.run(src)` | Definitions and executable code | Compiles the whole input, registers its definitions, then executes the executable code. |

Compilation never executes user code. Execution is a separate step, always through the VM (§10).

Module map (which WP implements what):

| Spec section | Module | WP |
|---|---|---|
| §2 | `reader.ts` | 1.2 |
| §3, §4, §11 | `values.ts`, `errors.ts` | 1.3 |
| §6 | `dictionary.ts` | 1.4 |
| §5, §7, §8, §9 | `compiler.ts` | 1.5 |
| §10 | `vm.ts` | 1.6 |
| §13 and the primitive FFI | `primitives.ts`, `vocab/core.ts` | 1.7 |
| §5.8 header parser, §12 | `meta.ts`, `meta.schema.json`, `sha256.ts` | 1.8 |
| facade | `runtime.ts` | integration |

---

## 2. Lexical grammar

### 2.1 Source text

Source is a JavaScript string (UTF-16). A leading U+FEFF is skipped. A source longer than `limits.maxSourceChars` (default 1 048 576 UTF-16 code units) is rejected with `E_LIMIT_SOURCE` before reading.

**Whitespace** is exactly these six characters: U+0020, U+0009 (tab), U+000A (LF), U+000D (CR), U+000B, U+000C. Nothing else is whitespace. Any character of Unicode general category Zs, Zl, Zp or Cf (for example U+00A0, U+2028, U+200B, U+FEFF) that appears inside a token (outside a string literal, char literal, or comment) is `E_LEX` at that character; they are neither separators nor name characters.

**Line breaks** are LF, CRLF and lone CR; each counts as one line.

### 2.2 Positions

Every token carries `pos` (start) and `end` (exclusive end), each a `SourcePos`:

- `offset`: 0-based index into the UTF-16 source string.
- `line`: 1-based.
- `col`: 1-based, counted in UTF-16 code units from the start of the line. A tab counts as 1.

`end` is the position just after the last character of the token. Errors raised by the reader and compiler carry the `pos` of the start of the offending token (or of the offending character inside a string, see §2.6).

### 2.3 Tokens and token boundaries

A token is a maximal run of non-whitespace characters, with these exceptions, in which the token extends further (string, char) or is replaced by another construct (comments, header, byte array):

Each token start is classified by the first matching rule below. "Standalone" means the token is exactly the given text, preceded by whitespace or start of input and followed by whitespace or end of input.

| # | Rule | Result |
|---|---|---|
| 1 | standalone `\` | line comment: everything up to (not including) the next line break is discarded |
| 2 | standalone `(` | header if directly after `:` name (§2.8), else block comment (§2.9) |
| 3 | token starts with `"` | string literal (§2.6) |
| 4 | token starts with `'` | char literal (§2.7) |
| 5 | standalone `#[` | byte-array literal (§2.10) |
| 6 | standalone `[`, `]`, `{`, `}` | punctuation tokens `lbracket`, `rbracket`, `lbrace`, `rbrace` |
| 7 | token starts with a digit, or with `-` followed by a digit | number (§2.4, §2.5); if it does not match the number grammar: `E_LEX` |
| 8 | token is `true` or `false` | `bool` literal |
| 9 | token is `:`, `;`, `IN:`, `USING:` or `META:` | `word` token (syntactic keyword; the compiler recognises it by text) |
| 10 | token contains `:` | qualified name (§2.11) |
| 11 | otherwise | unqualified word name (§2.11) |

Any other use of the characters `\ ( ) [ ] { } " ' # ;` inside a token is `E_LEX` ("`[` and `]` must be separated by whitespace", and so on). In particular `[1 2]`, `foo;` and `a(b` are errors, not tokens.

A string or char literal MUST be followed by whitespace or end of input; `"a""b"` is `E_LEX`.

The reader emits a final `eof` token. Comments produce no tokens.

### 2.4 Integers

```ebnf
digit      = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
hexdigit   = digit | "a" | "b" | "c" | "d" | "e" | "f" | "A" | "B" | "C" | "D" | "E" | "F" ;
bindigit   = "0" | "1" ;
dec-int    = [ "-" ] digit { [ "_" ] digit } ;
hex-int    = [ "-" ] "0x" hexdigit { [ "_" ] hexdigit } ;
bin-int    = [ "-" ] "0b" bindigit { [ "_" ] bindigit } ;
integer    = hex-int | bin-int | dec-int ;
```

- The prefixes `0x` and `0b` are lowercase only. There is no octal form and no leading `+`.
- `_` is a digit separator, allowed only between two digits. `1__0`, `1_`, `0x_1` are `E_LEX`.
- `-0` is the integer 0 (an `int` is never negative zero; every operation that could produce `-0` returns `+0`).
- **Bigint promotion**: an integer literal whose absolute value is at most `Number.MAX_SAFE_INTEGER` (2^53 − 1) becomes an `int` whose payload is a JS `number`. A larger literal becomes an `int` whose payload is a JS `bigint`. This invariant (**normal form**) holds for every `int` value everywhere: *payload is `number` iff the value is a safe integer; otherwise it is `bigint`*. Arithmetic MUST normalise its results (§3.2).
- The reader returns the numeric value in `Token.value` (`number | bigint`, in normal form).

### 2.5 Floats

```ebnf
digits     = digit { [ "_" ] digit } ;
exponent   = ( "e" | "E" ) [ "+" | "-" ] digits ;
float      = [ "-" ] digits "." digits [ exponent ]
           | [ "-" ] digits exponent ;
```

A float literal always has tag `num`, even when integral (`1.0`, `1e3`). Forms `.5` and `5.` are not numbers (`.5` and `5.` are not valid words either: `5.` starts with a digit and is `E_LEX`; `.5` is an unknown word). There is no `NaN`/`Infinity` literal. A float literal that overflows to infinity (`1e999`) is `E_LEX`. `-0.0` is negative zero.

### 2.6 String literals

```ebnf
string     = '"' , { str-char | str-escape } , '"' ;
str-char   = ? any code point except '"' and '\' ? ;      (* raw line breaks are allowed *)
str-escape = '\' , ( "n" | "r" | "t" | "0" | '\' | '"'
                   | "x" , hexdigit , hexdigit
                   | "u" , "{" , hexdigit , { hexdigit } , "}" ) ;
```

- `\n` U+000A, `\r` U+000D, `\t` U+0009, `\0` U+0000, `\\`, `\"`.
- `\xHH` is the code point U+00HH (so `"\xe9"` is `é`, **not** a byte).
- `\u{H…}` has 1 to 6 hex digits, a value in 0..0x10FFFF, and MUST NOT be a surrogate (U+D800..U+DFFF); otherwise `E_LEX`.
- Any other escape, an unterminated string, or an invalid escape is `E_LEX`. The error position for a bad escape is the position of its backslash; for an unterminated string it is the position of the opening quote.
- Raw line breaks inside a string are part of the string and advance `line`. CRLF inside a string is kept as written (two characters).
- Value: tag `str`. Source text that contains lone surrogates (invalid UTF-16) is accepted as written; such a string fails strict UTF-8 encoding later (§4).

### 2.7 Char literals

```ebnf
char        = "'" , ( char-char | char-escape ) , "'" ;
char-char   = ? any code point except "'", "\", LF, CR ? ;
char-escape = "\" , ( "n" | "r" | "t" | "0" | "\" | "'" | '"'
                    | "x" , hexdigit , hexdigit
                    | "u" , "{" , hexdigit , { hexdigit } , "}" ) ;
```

A char literal is **one code point** and produces an `int` holding that code point: `'a'` is 97. There is no `char` tag. `'ab'` and `''` are `E_LEX`. A space is allowed: `' '` is 32.

### 2.8 Header (stack effect)

The sequence `:` `name` `(` is special. When the reader meets a standalone `(` and the two previously emitted tokens are the `word` token `:` and a `word` or `qword` token (comments between them do not count as tokens), it does not treat the `(` as a block comment. It scans forward and emits **one `header` token** whose `headerText` is the raw text strictly between the opening `(` and the closing `)`. (The token's own `text` is the whole slice from `(` through `)`, inclusive.)

The closing `)` is the first standalone `)` that is outside a string literal. While scanning, the reader tracks `"…"` strings (with backslash escapes) so that `)` inside a default string value does not end the header. Regex constraints (§5.5) therefore MUST NOT contain a `"` or whitespace (write `\x22` and `\s`). An unterminated header is `E_LEX`.

The header token's `pos` is the position of `(`; `headerTextPos` is the position of the first character of `headerText`. The header grammar is §5.4 and is parsed by `parseHeader` (WP 1.8), not by the reader.

### 2.9 Block comments

Any other standalone `(` starts a block comment that ends at the first standalone `)` (no nesting). An unterminated block comment is `E_LEX` at the position of its `(`.

**Rationale for this form** (decision D1): Forth programmers expect `( … )`, so it is kept; the stack-effect header uses the same parentheses, and the two are told apart purely by position (immediately after `: name`). That needs only two tokens of lookbehind in the reader and no new syntax. A comment can never legally sit between `: name` and its header, because a header is mandatory (§5.2). Everywhere else `( … )` is a comment. The line comment `\` is the recommended form for anything longer.

### 2.10 Byte-array literals

```ebnf
bytes-lit  = "#[" , { hex-byte } , "]" ;      (* "#[" and "]" are standalone tokens; hex-bytes are whitespace-separated *)
hex-byte   = hexdigit , hexdigit ;
```

`#[ de ad be ef ]` is a `bytes` value. Each element is exactly two hex digits (either case). `#[ ]` is the empty byte array. A malformed element (`d`, `0xde`, `zz`, `dead`) is `E_LEX` at that element. Comments are not allowed inside. The reader emits **one** `bytes` token spanning `#[` to `]`.

### 2.11 Names

```ebnf
letter      = "a".."z" | "A".."Z" | ? any non-ASCII code point not in categories Zs, Zl, Zp, Cc, Cf ? ;
vocab-name  = ascii-letter , { ascii-letter | digit | "_" | "-" } ;          (* 1 to 64 code points *)
symbol      = "!" | "$" | "%" | "&" | "*" | "+" | "," | "." | "/"
            | "<" | "=" | ">" | "?" | "@" | "^" | "|" | "~" ;
name-start  = letter | "_" | "-" | symbol ;
name-char   = letter | digit | "_" | "-" | symbol ;
word-name   = name-start , { name-char } ;                                   (* 1 to 128 code points *)
qname       = vocab-name , ":" , word-name ;
```

- A word name never contains `:`. Names are **case-sensitive**; lower-kebab-case is the convention (`base64`, `see-also`).
- A name that starts with a digit, or with `-` followed by a digit, is a number or `E_LEX` (rule 7), never a word. So `1+` is `E_LEX`, `-` and `-rot` and `>str` and `.s` and `<>` are words.
- Rule 10: a token containing `:` that is not one of the keywords of rule 9 is a **qualified name** and MUST have exactly one `:`, with a `vocab-name` before it and a `word-name` after it. Anything else (`a:b:c`, `:x`, `x:`, `a b:c` is two tokens) is `E_LEX`. The `qword` token carries `vocab` and `name`.
- **A word whose name contains `:` cannot be defined** (decision D2). This removes every ambiguity between `vocab:word`, the keywords `:`, `;`, `IN:`, `USING:`, `META:`, and header items `name:type`.
- Names starting with `_` are **private** (§5.7).
- **Reserved words** (cannot be defined as words, constants, variables or aliases, and cannot be parameter names): `: ; IN: USING: META: VOCAB CONSTANT VARIABLE PRIMITIVE recurse true false`. Attempting to define one is `E_NAME`.

### 2.12 Token kinds

| kind | payload | notes |
|---|---|---|
| `int` | `value: number \| bigint` (normal form) | |
| `float` | `value: number` | |
| `str` | `value: string` | |
| `char` | `value: number` (code point) | compiler treats it as `int` |
| `bytes` | `value: Uint8Array` | |
| `bool` | `value: boolean` | |
| `word` | `text` | includes the keywords `:` `;` `IN:` `USING:` `META:` and the reserved `VOCAB` `CONSTANT` `VARIABLE` `PRIMITIVE` `recurse` |
| `qword` | `vocab`, `name` | |
| `lbracket` `rbracket` `lbrace` `rbrace` | | `[ ] { }` |
| `header` | `headerText`, `headerTextPos` | §2.8 (`text` is the whole `( … )` slice) |
| `eof` | | always last |

Every token also has `text` (the exact source slice), `pos` and `end`.

### 2.13 Reader contract

`read(source: string, opts?: { maxSourceChars?: number; maxIntBits?: number }): Token[]` is a pure function. It throws `ForgeError` with `E_LEX` on the first lexical error, with `E_LIMIT_SOURCE` if the source is longer than `maxSourceChars`, and with `E_LIMIT_VALUE` (at the token) for an integer literal (decimal, hex or binary) whose magnitude needs more than `maxIntBits` bits. Defaults are those of `DEFAULT_LIMITS`. It never looks at the dictionary. Examples are in §16 (C09 to C14, C115).

---

## 3. Values

A value is a tagged pair. The runtime representation is `{ tag, v }` (see `Value` in `types.ts`).

### 3.1 Tags

| tag | JS payload `v` | Equality `=` | Printed (`.s`, nested) |
|---|---|---|---|
| `bytes` | `Uint8Array` | same length and bytes | `#[ de ad ]` lowercase, `#[ ]` if empty |
| `str` | `string` | same code units | `"…"` quoted with escapes; raw when printed alone by `.` |
| `int` | `number` (safe integer) or `bigint` (otherwise), always normal form | numeric equality | decimal, `-` sign |
| `num` | `number` (finite) | numeric equality | see §3.3 |
| `bool` | `boolean` | `===` | `true` / `false` |
| `list` | `Value[]` | same length, elementwise `=` | `{ 1 2 "a" }` / `{ }` |
| `quot` | `Quotation` (code ref + captured locals) | identity | `<quot>` |
| `record` | `Map<string, Value>` | same key set, values `=` (insertion order ignored) | `record{ "a": 1 "b": 2 }` |
| `file` | `{ name: string; type: string; bytes: Uint8Array }` | name, type and bytes equal | `<file "name" "type" N bytes>` |

`file` is reserved: v0.1 has no literal and no `core` word that creates or consumes one; the tag exists so that types and metadata can mention it.

There is **no null/nil/unit value**. A word that cannot produce a value raises an error instead.

**String order.** Wherever FL compares or sorts strings (`<`, `>`, `<=`, `>=`, `words`, `vocabs`, the `sort` of metadata lists) it uses **code point order**, not JavaScript's default comparison, which orders by UTF-16 code unit and differs for characters above U+FFFF. Lengths and indices are in code points too.

A `bytes` value may additionally carry a `secret` mark (§10.14); it is not part of the value's identity. Values are immutable. No `core` word mutates a `bytes`, `list` or `record` in place; "modifying" words return a new value. (Implementations MAY share structure.)

### 3.2 Integers and floats

- `int + int`, `int - int`, `int * int` and every other `int` operation is **exact**. When either operand is a `bigint`, or the `number` result is not a safe integer, the operation is recomputed in `bigint` and the result normalised.
- An `int` is never negative zero: results that would be `-0` (`0 neg`, `0 -1 *`) are `+0`. Primitive results that are `bigint` inside the safe range are normalised to `number` by the VM, and a non-integer result in an `int` slot is `E_TYPE` (§10.5). `div` is exact for operands of any size, and comparisons between `int` and `num` (including `bigint` against a float) compare exact mathematical values.
- `int` magnitude is limited to `limits.maxIntBits` bits (default 65 536). A result beyond it is `E_LIMIT_VALUE`.
- Mixed `int`/`num` arithmetic converts the `int` to `num` (if the `int` is a `bigint`, this is `E_COERCE`, exactly as in §4) and yields `num`. `num` results MUST be finite; an infinite or NaN result is `E_RANGE`.
- `/` is float division: both operands are converted to `num`, the result is `num`. `div` and `mod` are floor division and floor modulo on `int` only.

### 3.3 Printing

Two forms exist: **display** (used by `.` for the top-level value) and **repr** (used inside lists and records, and by `.s`).

| tag | display | repr |
|---|---|---|
| `str` | the raw text | `"` + text with escapes + `"`. Escapes: `\\` `\"` `\n` `\r` `\t` `\0`, other code points below U+0020 and U+007F as `\xHH`; everything else raw |
| `int` | decimal | decimal |
| `num` | JS `String(n)`; if the result matches `^-?\d+$` append `.0`; negative zero is `-0.0` | same |
| `bool` | `true`/`false` | same |
| `bytes` | `#[ de ad be ef ]` | same |
| `list` | `{ ` + reprs separated by one space + ` }`; empty is `{ }` | same |
| `record` | `record{ ` + `repr(key): repr(value)` pairs separated by one space + ` }`; empty is `record{ }` | same |
| `quot` | `<quot>` | same |
| `file` | `<file "name" "type" N bytes>` | same |

`.` pops one value, appends its display form followed by `\n` to the run output. `.s` appends `<n>` followed, for each stack item from bottom to top, by one space and its repr, then `\n`; it does not change the stack. In `.s`, a repr longer than 80 code points is cut to its first 77 code points followed by `...`. An empty stack prints `<0>`.

---

## 4. Coercion and validation

### 4.1 When coercion happens

Coercion happens **only at word boundaries, against declared input types**:

1. when an FL word is called (the `call` instruction), for each declared input slot;
2. when a primitive is called (the `prim` instruction), for each declared input slot.

It never happens anywhere else: not in `=`, not between two words that are both `any`, not on outputs, not for locals after entry. Output slots are **validated** (the value's tag must equal the declared output type; `any` accepts anything) but never coerced; a mismatch is `E_TYPE`.

Primitives with polymorphic behaviour (`len`, `cat`, `=`) declare `any` and check tags themselves.

Every coercion that changes a value's tag is appended to `RunResult.coercions` (`step`, `word`, slot index, slot name, `from`, `to`) and, in trace mode, to the trace entry of that step. The record is bounded by `limits.maxTraceEntries`.

### 4.2 Coercion table

Rows are the tag of the value on the stack. Columns are the **declared input type** of the slot (its runtime type, §5.6). "ok" means no change. A dash means no coercion exists and the result is `E_TYPE`. "co" means a coercion exists and may fail with `E_COERCE`.

| value \ declared | `bytes` | `str` | `int` | `num` | `bool` | `list` | `quot` | `record` | `file` | `number` | `any` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `bytes` | ok | co | - | - | - | - | - | - | - | - | ok |
| `str` | co | ok | - | - | - | - | - | - | - | - | ok |
| `int` | - | - | ok | co | - | - | - | - | - | ok | ok |
| `num` | - | - | co | ok | - | - | - | - | - | ok | ok |
| `bool` | - | - | - | - | ok | - | - | - | - | - | ok |
| `list` | - | - | - | - | - | ok | - | - | - | - | ok |
| `quot` | - | - | - | - | - | - | ok | - | - | - | ok |
| `record` | - | - | - | - | - | - | - | ok | - | - | ok |
| `file` | - | - | - | - | - | - | - | - | ok | - | ok |

The four coercions, with their rules and strict failure behaviour:

| from → to | rule | fails with `E_COERCE` when |
|---|---|---|
| `str` → `bytes` | UTF-8 encoding | the string contains a lone surrogate (cannot be encoded strictly) |
| `bytes` → `str` | UTF-8 decoding, **strict**, BOM not stripped (U+FEFF is kept) | the bytes are not well-formed UTF-8 (overlong forms, surrogates, truncated sequences). **Never** U+FFFD replacement |
| `int` → `num` | exact conversion to a JS number | the `int` is a `bigint` (outside ±(2^53−1)) |
| `num` → `int` | exact | the number is not integral. (A finite integral JS number beyond the safe range converts to a `bigint` `int`.) |

Declared types that are refinements (`choice`, `toggle`, `regex`, `charset`, `key`) coerce according to their runtime type (§5.6) and are then validated (§4.3).

Not coercions, by design: `str`↔`int` (use `str>int`, `int>str`), `bool`↔anything, `list`↔`bytes` (use `list>bytes`, `bytes>list`), `int`→`str`. These are explicit words (§13).

### 4.3 Validation

After coercion, the value is validated against the slot's constraint (§5.5, §5.6), if any. A violation is `E_PARAM_INVALID` with `detail.param` (the slot name, or its index if unnamed), `detail.constraint` (the canonical constraint text) and `detail.value` (the repr, cut to 80 code points). The same check is applied to primitive inputs by the registry.

The order for each input slot is: tag check/coercion (`E_TYPE`/`E_COERCE`), then constraint (`E_PARAM_INVALID`). All input slots are processed deepest-first; the first failure is raised.

### 4.4 Primitive plain-JS conversion

When the registry calls a primitive's `fn`, each argument is the plain JS payload for slots of type `bytes str int num bool list quot record file` (and the refinements `choice toggle regex charset key`), and the **tagged `Value`** for slots of type `any` and `number` (because `int` vs `num` is not recoverable from a JS number). Results follow the same rule: a plain JS payload for typed output slots, a tagged `Value` for `any`/`number` slots. An `int` payload follows the normal form. A mismatched result is `E_TYPE` with `detail.where = "result"`. A primitive with k outputs returns `undefined` (k = 0), the value (k = 1) or an array of exactly k results (k ≥ 2).

---

## 5. Defining forms

### 5.1 Overview

```ebnf
unit         = { form } , eof ;
form         = definition | in-form | using-form | vocab-form
             | const-form | var-form | prim-form | meta-form ;      (* + code, console only, §9 *)
definition   = ":" , name , header , { decl } , body , ";" ;
name         = word ;                                               (* an unqualified word token *)
decl         = string , ( "doc" | "category" ) ;
body         = { item } ;
item         = int | float | char | string | bytes | bool
             | word | qword | "recurse"
             | "[" , body , "]"                                     (* quotation *)
             | "{" , body , "}" ;                                   (* list literal *)
in-form      = "IN:" , vocab-name ;
using-form   = "USING:" , { vocab-name } , ";" ;
vocab-form   = "VOCAB" , vocab-name ;                               (* console only *)
const-form   = literal , "CONSTANT" , word-name ;
var-form     = literal , "VARIABLE" , word-name ;
literal      = int | float | char | string | bytes | bool ;
prim-form    = "PRIMITIVE" , word-name ;
meta-form    = "META:" , word-name , { meta-clause } , ";" ;
meta-clause  = "doc" , string , ";"
             | "category" , string , ";"
             | "version" , string , ";"
             | "param" , pname , string , ";"
             | "alias" , word-name , { word-name } , ";"
             | "see-also" , ( qname | word-name ) , { qname | word-name } , ";" ;
```

(Here `word`, `qword`, `int`, … name token kinds; `vocab-name`, `word-name`, `qname` are the §2.11 productions, and a `vocab-name` / `word-name` position accepts an unqualified `word` token whose text matches.)

A definition cannot nest inside another definition, quotation or list literal: a `:` there is `E_SYNTAX`. Unbalanced `[ ]` / `{ }` or a missing `;` is `E_SYNTAX` at the offending token (or at `eof`).

### 5.2 Colon definitions

```forth
: name ( inputs -- outputs )
  "documentation" doc
  "Category" category
  body ;
```

- The header is **mandatory** on every colon definition (decision D3). Its absence (`: f 1 ;`) is `E_HEADER`.
- The name MUST be an unqualified word name and not reserved: otherwise `E_NAME`.
- `decl`s (`"…" doc`, `"…" category`) are recognised **only** directly after the header and before the first body item. Each produces no instruction. They are shorthand for the `doc` and `category` clauses of `META:` (§5.9). A string followed by `doc` or `category` anywhere else is not a declaration: `doc` and `category` are then ordinary words, almost certainly undefined (`E_UNDEFINED`).
- The word becomes visible to later code **at the `;`**, as in Forth. Inside its own body its unqualified name refers to whatever that name meant before the definition (possibly nothing). Use `recurse` for self-calls (§6.6).
- A definition goes into the **current vocabulary** (§6.1).

### 5.3 `IN:`, `USING:`, `VOCAB`

- `IN: v` sets the current vocabulary for the rest of the source unit (or, at the console, for the session). If vocabulary `v` does not exist it is created empty. Allowed any number of times. `IN: core` is `E_READONLY` unless the load is trusted.
- `USING: a b c ;` **appends** the named vocabularies to the unit's import list, in order, ignoring names already present. Every name MUST exist (`E_NO_VOCAB`). `core` may be listed; it is accepted and ignored (core is always implicitly last). `USING: ;` is a no-op.
- `VOCAB v` is the console form of `IN:`. In a source unit it is `E_SYNTAX`. At the console `IN:` is also accepted.
- The state set by these forms is **lexical to the source unit**: a unit starts with current vocabulary `user` and no imports unless the caller passes a scope; nothing leaks to the next unit. At the console the state is the session's and persists between `run` calls.

### 5.4 Header grammar

The header text is the `headerText` of the `header` token (§2.8). Items are separated by whitespace **at nesting depth 0** (outside `[…]`, `{…}` and `"…"`); `--` is a separate item.

```ebnf
header      = [ ".." ] , { in-item } , "--" , ( ".." | { out-item } ) ;   (* leading ".." only in lenient mode *)
in-item     = param | bare ;
out-item    = pname , ":" , type-name | type-name | label ;
bare        = type-name | label ;
type-name   = "any" | "bytes" | "str" | "int" | "num" | "number" | "bool"
            | "list" | "quot" | "record" | "file" | "regex" | "charset" ;
label       = pname ;                              (* a name that is not a type-name; type any *)

param       = pname , ":" , ptype , [ constraint ] , [ "=" , default ] ;
pname       = lower , { lower | digit | "-" } ;    (* lower = "a".."z"; not reserved *)

ptype       = type-name
            | "choice" , "{" , option , { "|" , option } , "}"
            | "toggle" , [ "{" , enc , { "|" , enc } , "}" ]
            | "key"    , [ "{" , enc , { "|" , enc } , "}" ] ;
option      = string | bare-option ;
bare-option = ? 1 or more characters, none of: whitespace  |  {  }  " ? ;       (* a string option may contain spaces and any of | { } *)
enc         = "hex" | "utf8" | "latin1" | "base64" ;

constraint  = "[" , cpart , { "," , cpart } , "]" ;
cpart       = interval | set | pattern ;
interval    = [ number ] , ".." , [ number ]       (* at least one bound *)
            | number ;                              (* a single value: same as a set of one *)
set         = number , "|" , number , { "|" , number } ;
pattern     = "/" , ? regex source: no whitespace, no '"', '/' written as \/ ? , "/" ;
number      = integer | float ;                     (* §2.4, §2.5 *)

default     = integer | float | string | "true" | "false" | option ;
```

Semantics:

- **Order.** Items are listed deepest-first: the first input is the deepest on the stack (it is the **data input**); the last input is on top. A recipe step is therefore `<data already on stack> <param literals in order> word`.
- **Bare items** (no `:`): a bare `type-name` is an **anonymous input** of that type (it stays on the stack, §7). A bare `label` is a **named input of type `any`** (it is bound as a local, §7), e.g. `( a b -- c )`. `str` always means the type: you cannot name something `str` (write `s:str`).
- **Named items** (`pname:ptype…`): a **named input**. It is bound as a local (§7).
- **Data input** = the first input, if there is one. It may be bare or named. Its `ptype` may not carry a default (`E_HEADER`).
- **Parameters** = inputs 1, 2, 3, …. In a **public** word (§5.7) every parameter MUST be a named item with a `ptype` (otherwise `E_HEADER`). In a private word and in a primitive header the strict rule is relaxed ("lenient mode"): bare items are allowed anywhere.
- **Variadic input** (`..` as the first item, e.g. `( .. -- )`, `( .. n:int -- )`): allowed in lenient mode only (so for intrinsics and primitives). It means "any number of further values below the fixed inputs"; the word's fixed inputs are the items after `..`, and no arity check is made for the part below them. The effect records `variadicInput: true`. It is used by the intrinsic stack words (`clear`, `.s`).
- **Outputs.** `type-name` or `pname:type-name` (the name is documentation only) or a `label` (`any`). Outputs may not carry constraints or defaults (`E_HEADER`). The special form `-- ..` declares an **unchecked output** (variadic): the word's input arity is still checked, its output depth is not (§10.5). `..` must be the only item after `--`.
- A **default** applies only to parameters (index ≥ 1) and only for these types:

| ptype | default literal | runtime type |
|---|---|---|
| `int` | integer | `int` |
| `num` | float or integer | `num` |
| `str` | string | `str` |
| `bool` | `true` / `false` | `bool` |
| `choice{…}` | one of the options (as a string literal, or bare if the option is a bare option) | `str` |
| `toggle{…}`, `key{…}` | string, interpreted in the **first-listed encoding** | `bytes` |
| `bytes` | string of hex digit pairs; whitespace ignored | `bytes` |
| `regex`, `charset` | string | `str` |
| `any`, `number`, `list`, `quot`, `record`, `file` | none allowed | |

- **Defaults are metadata only.** The VM never supplies a missing argument. The recipe compiler (Phase 2) and the UI push the default literal when a parameter is not supplied. A parameter without a default is **required** (`required: true` in the metadata).
- A default MUST satisfy its own constraint, and a `choice` default MUST be one of the options: otherwise `E_HEADER` (a static error, not `E_PARAM_INVALID`).
- Duplicate names among the named items of one header, a reserved name, or an unknown type is `E_HEADER`.

Examples of well-formed headers:

```
( str amount:int[1..25]=13 -- str )
( text:str -- str )
( bytes key:key{hex|utf8}[16|24|32] iv:toggle{hex}[16] mode:choice{cbc|ctr|gcm}=cbc -- bytes )
( str style:choice{"Upper case"|"Lower case"}="Upper case" -- str )   \ quoted options may contain spaces
( -- int )
( a b -- c )                       \ private or primitive only: b is a bare label
( quot -- .. )
```

### 5.5 Constraint forms

A constraint is checked at every word boundary where the slot is an input (§4.3), and its canonical text is stored in the metadata.

| ptype | `cpart` allowed | meaning |
|---|---|---|
| `int` | `interval`, `set` of integers | the **value** lies in the closed interval, or is one of the set |
| `num` | `interval` of integers/floats | the value lies in the closed interval |
| `str`, `charset` | `interval`/`set` of non-negative integers, and (`str` only) one `pattern` | the **length in code points** lies in the interval or set; the **whole string** matches the pattern |
| `bytes`, `key`, `toggle` | `interval`/`set` of non-negative integers | the **byte length** lies in the interval or set |
| `list` | `interval`/`set` of non-negative integers | the **element count** |
| `bool`, `choice`, `regex`, `any`, `number`, `quot`, `record`, `file` | none (a constraint is `E_HEADER`) | |

At most one length/range part and at most one `pattern` part may appear per constraint. `lo > hi`, a negative length, or `..` with no bounds is `E_HEADER`. Bounds of `int` constraints MUST be safe integers.

`pattern` is a JavaScript regular expression source compiled with the `u` flag and tested as `^(?:source)$`. It MUST compile (else `E_HEADER`) and be at most `limits.maxRegexLength` (default 1024) code points. Patterns are evaluated by the host regex engine. **Risk**: a JavaScript regex can backtrack catastrophically, and a synchronous `RegExp.test` cannot be interrupted by the VM (§10.7). v0.1 only bounds the pattern length; real time-boxing of user-supplied regexes (a restricted engine or a step budget) is Phase 5 work, and primitives that run user regexes against input SHOULD NOT be exposed to untrusted recipes before then.

### 5.6 Parameter types: runtime type and validation

| ptype | runtime tag | extra validation (after coercion) |
|---|---|---|
| `any` | any | none |
| `bytes` `str` `int` `num` `bool` `list` `quot` `record` `file` | same | constraint (§5.5) |
| `number` | `int` or `num` | none (accepts both, no coercion) |
| `choice{a\|b\|c}` | `str` | value is exactly one of the options (case-sensitive) |
| `toggle{enc…}` | `bytes` | byte-length constraint. The **listed encodings** are metadata for the UI/recipe layer (how a user may type the value); the word receives decoded bytes. Bare `toggle` means `{utf8\|hex\|latin1\|base64}`. |
| `key{enc…}` | `bytes` | as `toggle`; additionally marks the value as secret key material (UI may mask it). Bare `key` means `{utf8\|hex\|latin1\|base64}`. |
| `regex` | `str` | at most `limits.maxRegexLength` code points and `new RegExp(source, "u")` compiles |
| `charset` | `str` | non-empty, **no repeated code point**, length constraint if any |

Because `toggle`, `key` and `charset` take their runtime type only, the recipe layer (Phase 2) is responsible for turning a user's `{ value, enc }` into bytes before pushing it (§14). The word never sees an encoding name.

### 5.7 Public and private words

- A word whose name starts with `_` is **private**; all others are **public**.
- A private word is visible only inside its own vocabulary: it is found by unqualified lookup in step 1 of §6.2 when it is in the current vocabulary, and by a qualified reference `v:_name` **only from code compiled with current vocabulary `v`**. Otherwise a reference to it is `E_PRIVATE`. Private words are never found through `USING:`. They are excluded from the catalogue, `words`, and search.
- Headers of private words and primitives use lenient mode (§5.4). A private word may not have a `META:` block (`E_META`) and its leading `doc`/`category` declarations are allowed but not catalogued.
- A public colon word uses strict mode. An **op** (a word the UI lists as an operation) is a public word, not in `core`, with at least one input. (`WordMeta.op`.)

### 5.8 `parseHeader`

WP 1.8 provides `parseHeader(text, pos, mode)` where `mode` is `"strict"` or `"lenient"`. It returns a `StackEffect` (types in `types.ts`) or throws `E_HEADER` with the position of the offending item (computed from `pos`). The compiler calls it for every `header` token (mode by name privacy) and the registry calls it, in lenient mode, for primitive `effect` strings. The canonical text form of a `StackEffect` (`StackEffect.text`) is defined in §12.3.

### 5.9 `META:`

```forth
META: rot
  doc "Rotate each Latin letter by a fixed amount." ;
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;
```

- `META: name` attaches metadata to the word `name` already defined **in the current vocabulary**. Otherwise `E_META`. The block ends at a `;` that appears where a clause would start (an empty clause).
- Clauses (each ends with `;`): `doc <string>`, `category <string>`, `version <string>`, `param <pname> <string>` (help text for that parameter; the parameter MUST exist, `E_META` otherwise), `alias <name>…` (one or more additional names in the same vocabulary; each MUST be a valid unreserved word name that is not already defined in that vocabulary, `E_REDEFINED` otherwise; an alias resolves to the **same** `WordEntry`), `see-also <name>…` (unqualified names are qualified with the current vocabulary; they are not required to exist).
- A singular field (`doc`, `category`, `version`) may be set **once** across the leading declarations and all `META:` blocks; a second set is `E_META`. `param` docs likewise once per parameter. `alias` and `see-also` accumulate.
- Unknown clause words are `E_META`. String lengths are bounded: `doc` at most 2000 code points, everything else at most 200 (`E_META`).
- `META:` may follow the definition at any distance in the same unit, or appear in a later unit.

### 5.10 `CONSTANT` and `VARIABLE`

```forth
256 CONSTANT block-size
0   VARIABLE counter
```

- **Syntax**: exactly one literal token, then `CONSTANT`/`VARIABLE`, then a name (decision D4). If the token before the keyword is not a literal (`3 4 + CONSTANT x` at the console) the error is `E_SYNTAX`; in a unit see §9.
- `CONSTANT n`: defines public word `n` with effect `( -- <type of literal> )`. The compiler inlines it as a `lit` instruction. A `char` literal makes an `int`.
- `VARIABLE n`: defines two words, `n ( -- T )` which pushes the current value and `n! ( T -- )` which sets it, where `T` is the tag of the initial literal. `n!` with a value of another tag is `E_TYPE` (no coercion). Variables are **per-run**: each run starts with every variable at its initial value, unless the caller passes a `vars` store (`RunOptions.vars`, §10.9) that persists across runs (the console does). The store is keyed by a **variable id**, `qname#k`, where `k` is a unique integer assigned when the `VARIABLE` is defined (so a redefined variable has its own cell).
- Both names go into the current vocabulary, subject to §6.5. `META:` may annotate them.

### 5.11 `PRIMITIVE`

```forth
IN: base64
PRIMITIVE decode-raw
```

Binds the word `base64:decode-raw` to the TypeScript primitive registered under vocabulary `base64`, name `decode-raw` (current vocabulary, then the word name). The word's effect and metadata come from the registry (the registered `effect` header is parsed in lenient mode).

**Who binds what.** `createRuntime` binds **every primitive in `RuntimeOptions.primitives`** into the vocabulary named by its `vocab` (creating the vocabulary), and binds the `core` words. A primitive registered afterwards directly through `runtime.registry.define` is *registered but unbound*. `PRIMITIVE` exists for **trusted units** that bind such a registered-but-unbound primitive into the vocabulary of that unit (typically a `.fth` file shipping with an op vocabulary). Never for `core`.

**Check order** (first failure wins): 1. the load is not trusted: `E_UNTRUSTED` (`LoadOptions.trusted`, default **false**; checked before the registry is consulted, so an untrusted unit learns nothing about the registry); 2. nothing registered under `<current vocabulary>:name`: `E_NO_PRIMITIVE`; 3. the name is already defined in the current vocabulary by this unit: `E_REDEFINED`.

---

## 6. Name resolution

### 6.1 Scope

A **scope** has a current vocabulary `C` and an ordered import list `U = [u1 … un]`. A source unit starts with `C = user` and `U = []` (or the scope passed to `load`). `IN:` changes `C`, `USING:` extends `U`. The console has a persistent session scope.

### 6.2 Unqualified lookup of name N

Resolution is **compile-time and early-binding**: the compiler resolves each name once and stores the `WordEntry` in the instruction. Later redefinition does not affect already-compiled callers (as in Forth).

1. **Locals.** If N is the name of a local of the word being compiled, it is a local read (§7).
2. **Current vocabulary.** If `C` defines N (public or private), the result is `C:N`.
3. **Imports.** Otherwise collect every `ui` in `U` that defines **public** N. If exactly one: that entry. If two or more: **`E_AMBIGUOUS`** (the error lists the candidates as qualified names in `U` order; resolve by writing `vocab:N`).
4. **Core.** Otherwise, if `core` defines N, that entry.
5. Otherwise `E_UNDEFINED`.

Consequences: the current vocabulary shadows imports and core; imports shadow core; ambiguity is only ever between two imports (a name in the current vocabulary or in core never causes `E_AMBIGUOUS`).

Core's `rot` (the stack word) and `classical:rot` (the cipher) are a deliberate example: inside `IN: classical`, `rot` means `classical:rot`; write `core:rot` for the stack word.

### 6.3 Qualified lookup

`v:n` resolves through exactly vocabulary `v`: `E_NO_VOCAB` if `v` does not exist, `E_UNDEFINED` if it does not define `n`, `E_PRIVATE` if `n` is private and the current vocabulary is not `v`. The scope's imports are not consulted. A qualified name never raises `E_AMBIGUOUS`.

### 6.4 Console session state

`VOCAB v` / `IN: v` set the session's current vocabulary; `USING:` extends the session imports; both persist for later `run` calls. `current-vocab` pushes the current vocabulary name. `ForgeRuntime.setCurrentVocab(name)` is the programmatic equivalent (creates the vocabulary if needed).

### 6.5 Redefinition (decision D5)

Redefinition is **allowed, with old references keeping the old definition**:

- Defining a name that already exists in the *current vocabulary* creates a new `WordEntry` and rebinds the name. Code compiled earlier still calls the old entry. `LoadResult.warnings` records a `W_REDEFINED` diagnostic.
- **Within one source unit** a second definition of the same name in the same vocabulary is an error, `E_REDEFINED` (it is almost always a mistake there). This also applies to aliases, constants, variables and `n!`.
- Defining a word in `core` is `E_READONLY` (trusted loads excepted). Defining a name that exists only in another vocabulary or in `core` is a new, shadowing word, not a redefinition.
- At the console, redefinition within one input is allowed (it follows the "rebinds the name" rule).
- **Editing a word does not update its callers.** Because calls are bound early, replacing a definition affects only code compiled afterwards. To change a word and have its dependents pick up the change, create a fresh runtime (or reload the dependents' source after the new definition). There is no "forget" or "rebuild dependents" operation in v0.1.

### 6.6 Forward references and recursion (decision D6)

There are no forward references: a word MUST be defined (at its `;`) before another word's body mentions it; otherwise `E_UNDEFINED`. A word calls itself with `recurse`, which compiles to a `call` of the word currently being defined. Mutual recursion is not available in v0.1. There is no tail-call elimination: every call, including `recurse`, uses one return-stack frame (limit `maxReturnDepth`).

### 6.7 Atomicity

Compilation of a source unit is atomic: definitions are staged in a `DictionaryTxn` and committed only if the whole unit compiles. At the console the whole input is compiled first; definitions are committed, then the executable code runs; a **runtime** error does not undo the definitions. A **compile** error at the console rolls back everything the input did, including scope changes (`IN:`, `USING:`, `VOCAB`): the session scope is exactly what it was before the input.

---

## 7. Parameters as locals

- Every **named** input of a colon word (data input or parameter) is a **local**. Locals are numbered 0, 1, … in declaration order.
- On entry (after coercion and validation, §10.5) the VM removes **all** n input values from the data stack, stores the named ones in the word's locals array, and pushes the **anonymous** ones back in their original relative order. So a named input is *consumed*; an anonymous input *stays on the stack*. In `( str amount:int -- str )` the string stays on the stack and `amount` is local; in `( text:str amount:int -- str )` both are locals and the stack is empty at the start of the body.
- A local's name used in the body (or in any quotation inside it) compiles to `local slot`, which pushes the value. **Locals shadow all words** (§6.2 step 1), including those in the current vocabulary and core. A local named like a visible word hides that word in this body (with a `W_SHADOW` warning, no error).
- Locals are **immutable**. There is no assignment. (Mutable state uses `VARIABLE`.)
- **Quotations are closures**, with these exact rules:
  1. Every *call* of a colon word creates a **new** locals array (length `nlocals`, holding only the named inputs; anonymous inputs are excluded and never occupy a slot).
  2. A `quot` instruction captures **that array** (by reference; safe because locals are immutable) as `env`.
  3. A quotation body uses the same slot numbers as the word that contains it, and when it is called (`callq`, or by any combinator) it runs with **its own captured `env`** as `locals`, never the caller's.
  4. A quotation created inside a quotation captures the `env` of the frame that is creating it, which is the outer quotation's `env`; so nested quotations see the same locals.
  5. A quotation may outlive its word (it can be returned, stored in a list, passed to another word).
  6. Console code has no locals, so a quotation created by console code has `env = []`.
- Quotations do not introduce new locals.
- **Shadow warning.** If a local has the same name as a word that would otherwise be visible (resolution of §6.2 steps 2 to 4 finds it), the compiler emits a `W_SHADOW` diagnostic (in `LoadResult.warnings`, with the position of the header item). It is a warning, never an error.
- Bare *labels* (`( a b -- c )`) are named inputs of type `any` and therefore locals; bare *type names* are anonymous.

So `: _add ( a b -- c ) a b + ;` has locals a, b, and an empty stack at the start of the body.

---

## 8. Control flow

There are no `IF … ELSE … THEN`, `DO … LOOP`, `BEGIN … UNTIL`, and **no user-defined parsing or immediate words** in v0.1 (decisions D7, D8). All control flow is combinators over quotations (`[ … ]`). All combinators are `core` words that are VM intrinsics (§10.6).

Quotation: `[ body ]` is a first-class `quot` value. `call ( quot -- .. )` runs it.

| word | effect | semantics |
|---|---|---|
| `if` | `( bool then:quot else:quot -- .. )` | run `then` if true else `else` |
| `when` | `( bool quot -- .. )` | run `quot` if true |
| `unless` | `( bool quot -- .. )` | run `quot` if false |
| `times` | `( n:int quot -- )` | run `quot` n times; n < 0 is `E_RANGE` |
| `each` | `( seq quot -- )` | for each element push it, then run `quot` |
| `map` | `( seq quot -- seq )` | for each element push it, run `quot`, pop exactly one result into the output sequence |
| `mapi` | `( seq quot -- seq )` | like `map`, but the quotation also receives the 0-based index: it sees `( elem index )`, index on top |
| `filter` | `( seq quot -- seq )` | keep elements for which `quot` leaves `true` |
| `reduce` | `( seq init quot -- acc )` | acc := init; for each element push acc and element, run `quot`, pop the new acc |
| `while` | `( cond:quot body:quot -- )` | repeat: run `cond`, pop a bool; if false stop; else run `body` |
| `loop` | `( quot -- )` | repeat: run `quot`, pop a bool; continue while it is true (do-while) |
| `try` | `( body:quot handler:quot -- .. )` | see below |
| `fork` | `( data sep join quot -- data )` | split, map each piece through `quot`, join |
| `call` | `( quot -- .. )` | run the quotation |

**Sequences.** `seq` is a `list`, a `bytes` or a `str`. For a `list` the elements are the list's values. For `bytes` the elements are `int`s 0..255; for `str` the elements are the code points as `int`s (not one-character strings). Results: `each` returns nothing; `map`/`mapi` on a `list` produce a `list` of any values; on `bytes` every result MUST be an `int` in 0..255 (`E_TYPE` if not an `int`, `E_RANGE` if outside) and the result is `bytes`; on `str` every result MUST be an `int` that is a valid non-surrogate code point (`E_TYPE`/`E_RANGE`) and the result is `str`. `filter` on `bytes`/`str` returns the kept elements as `bytes`/`str`. `reduce` accepts any `seq`; `init` and the accumulator are unconstrained.

Rules:

- A condition must be a `bool`. There is **no truthiness**: `0`, `""`, `{ }` are not false; a non-`bool` where a `bool` is required is `E_TYPE` (decision D9).
- **Stack-neutrality of loop bodies.** Let `d` be the data depth before the combinator pushes anything for an iteration. After the quotation returns the depth MUST be: `each` body: `d` (it consumed the pushed element); `map` body: `d + 1` (one result on top, which the combinator pops); `mapi` body: `d + 1` (the element and index having been pushed, the body leaves one result); `filter` body: `d + 1` (a `bool`); `reduce` body: `d + 1` (the new acc, with acc and element having been pushed); `times` body: `d`; `while` cond: `d + 1` (a bool), `while` body: `d`; `loop` body: `d + 1` (a bool). A violation is `E_EFFECT`. `d` for `reduce` is the depth before the acc and element are pushed.
- `if`, `when`, `unless`, `call`, `try` bodies have no depth requirement (variadic). A word that uses them with a fixed output count either declares `-- ..` or must produce a matching depth, else its exit check (`E_EFFECT`) fires.
- **`try`**: pops handler and body, then records a **snapshot** of the data stack (its contents at that moment) and sets a **floor** at that depth (see "Frame floor" in §10.1). Runs body. If body completes, the handler is skipped. If a **catchable** error is raised anywhere during the body, including in callees and primitives: the data stack is restored from the snapshot, the return stack is unwound to `try`'s frame, an error `record` is pushed, and the handler runs (with the same floor). The handler is **not protected** by the `try`: an error raised in the handler propagates outward (to an enclosing `try`, if any). The record has the fields `code`, `message`, `word` (qualified name or `""`), `vocab` (or `""`) as `str`s, and `detail`, a `record` built from the error's `detail`: each value that is a string, integer, float or boolean becomes the matching tag, an array of strings becomes a `list` of `str`, anything else becomes its repr as a `str`. **Catchable**: every code except `E_ABORTED`, every `E_LIMIT_*`, `E_INTERNAL` and `E_FORBIDDEN`. Uncatchable errors propagate straight out of the run. This keeps untrusted code from swallowing a limit or a policy denial. A promise rejected by an async primitive is converted to an error first (a `ForgeError` rejection as is, anything else `E_PRIMITIVE`), and is therefore catchable.
- **`fork`**: `data` is `str` or `bytes`. `sep` and `join` are each `str` or `bytes`; both are coerced to the tag of `data` with the §4.2 rules (so a `str` separator becomes its UTF-8 bytes for `bytes` data; a `bytes` separator must be valid UTF-8 for `str` data, else `E_COERCE`). `sep` MUST be non-empty (`E_RANGE`). The data is split at every non-overlapping occurrence of `sep`, left to right. **An empty `data` gives exactly one empty piece, and a trailing separator gives a trailing empty piece** (`"a,"` split at `","` gives `"a"` and `""`). Each piece (same tag as `data`) is pushed and `quot` runs with depth rule "`d + 1`"; the result is **coerced to the tag of `data` with §4.2** (`E_TYPE`/`E_COERCE` if impossible); results are joined with `join`. `split ( str sep:str -- list )` follows the same piece rules.
- **Metering.** Values created by an intrinsic (the output of `map`, `mapi`, `filter`, `fork`, and list literals) are measured and counted against `maxValueBytes` and `maxTotalBytes` exactly like primitive results (§10.8).

**Lowering.** The compiler MAY, as an optimisation that MUST NOT change observable behaviour except the step count, lower `if`, `when`, `unless`, `while` and `loop` whose quotation arguments are *literal* `[ … ]` immediately before the combinator into inline `jumpf`/`jump` sequences instead of allocating quotations:

```forth
cond [ A ] [ B ] if      →   (cond on stack)  jumpf L1 ; A ; jump L2 ; L1: B ; L2:
cond [ A ] when          →   jumpf L1 ; A ; L1:
[ C ] [ B ] while        →   L0: dmark ; C ; dcheck 1 ; jumpf L1 ; dmark ; B ; dcheck 0 ; jump L0 ; L1:
[ B ] loop               →   L0: dmark ; B ; dcheck 1 ; jumpf L1 ; jump L0 ; L1:
```

(`jumpf` exits when the bool is false; in `loop` the true path jumps back.) `dmark` records the current data depth in a `mark` frame on the return stack; `dcheck n` pops that frame and raises `E_EFFECT` unless the current depth equals the recorded depth plus `n`. Lowered loops therefore perform **exactly the same per-iteration depth check** as the intrinsic loops, and lowered and unlowered code are observably identical (results, errors, output) except for the step count (and for how many return-stack frames are live at a given moment, which only matters at the very edge of `maxReturnDepth`). `times`, `each`, `map`, `filter`, `reduce`, `try`, `fork` and non-literal arguments always use the intrinsic path. Conformance tests (§16) never depend on step counts except for unbounded loops.

---

## 9. Top-level code

| Place | Definitions | Executable code |
|---|---|---|
| Source unit (`load`) | allowed | **`E_TOPLEVEL`** (reported at the first token that is not part of a form) |
| Console (`run`) | allowed | allowed; executed in order, after the whole input compiled |

- A *form* in §5.1 is not "code". A literal that is directly followed by `CONSTANT` or `VARIABLE` belongs to that form. In a unit, any other literal, word, `[`, `{` or `recurse` outside a definition is `E_TOPLEVEL` (so `3 4 + CONSTANT x` in a unit is `E_TOPLEVEL` at the `3`). At the console, a `CONSTANT`/`VARIABLE` whose preceding token is not a literal is `E_SYNTAX`.
- Console input is compiled as a sequence of segments: each definition/`IN:`/… form is processed in order; each maximal run of executable tokens between forms becomes one anonymous word `<console>` with no inputs, `-- ..` (unchecked output). The compiler records, with each segment, the **scope** (current vocabulary and imports) in effect where the segment appears; while that segment executes, `current-vocab`, `help`, `see` and `words` use that recorded scope (`PrimitiveContext.scope`). After the run the session scope is the scope at the end of the input. The segments execute in order on the **same** data stack. Compilation is sequential and early-binding: a segment sees exactly the definitions that precede it in the input (and everything committed earlier). So `: f ( -- int ) 1 ; f .` works in one input, and in `f . : f ( -- int ) 2 ; f .` the first `f` is the old word and the second is the new one. All definitions of the input are committed before the first segment executes.
- `RunOptions.stack` supplies the initial data stack, `RunResult.stack` is the final one, so a REPL threads it between calls. The same two channels (`RunOptions.stack` and `ForgeRuntime.call(name, args)`) are the way to hand a **large parameter value** (a big file, a long key) to a word without embedding it in source text: source is limited by `maxSourceChars`, stack values are not.
- Executable code compiled at the console has no locals and no `recurse`.

---

## 10. Execution model

### 10.1 Machine state

- **Data stack**: `Value[]`.
- **Return stack**: stack of frames. Frame kinds: `word` (an FL word call), `quot` (a quotation call), `loop` (combinator state), `try`, `list` (list-literal mark). Every frame counts toward `maxReturnDepth`.
- A word frame holds: the `WordEntry`, its `CompiledWord`, `ip`, `locals`, and `base` (data depth at call minus the number of inputs). At the console, the data stack at the start of a run has `base = 0`.
- **Frame floor.** At any moment the **floor** is the larger of the `base` of the innermost `word` frame and the depth recorded by the innermost active `try` (§8). Every instruction and every primitive/word entry that would pop the data stack below the floor raises `E_STACK_UNDERFLOW` (`detail.needed`, `detail.available`, where `available` is `depth − floor`) instead of touching the caller's values. A quotation does not set a floor of its own: it runs above the floor of the word frame (or `try`) it executes within. The words `depth` and `clear` are relative to the floor: `depth` pushes `depth − floor`, `clear` removes the values above the floor. (`.s` still prints the whole stack, for diagnostics.)
- Counters: `steps`, `totalBytes`, `outputBytes`; deadline; output buffer.

### 10.2 Compiled word

`CompiledWord` (type in `types.ts`) = `{ qname, effect, localNames, namedInputs, anonInputs, nlocals, code: Instruction[], positions: SourcePos[], effects, deps }`, where `deps` lists every distinct `WordEntry` the body references (calls, primitives, intrinsics, constants, variables), in order of first reference, excluding the word itself; it feeds the hash (§12.4). `code` is a **flat** array; `positions[i]` is the source position of `code[i]`. Quotation bodies and combinator-inlined branches are placed in the same array as the word (bodies of `quot` are skipped over in straight-line flow; control is by index).

### 10.3 Instruction set

`ip` indexes `code`. All `target` operands are absolute indices into the same `code`. Stack effects are `( before -- after )`, top on the right.

| op | operands | stack effect and behaviour |
|---|---|---|
| `lit` | `value` | `( -- v )` push `value` (a literal; constants are inlined here) |
| `local` | `slot` | `( -- v )` push `locals[slot]` |
| `stack` | `word` | one of `dup drop swap over rot -rot nip tuck 2dup 2drop depth clear`, with the effects in §13.1. Underflow (below the floor) is `E_STACK_UNDERFLOW` |
| `call` | `entry` (kind `fl`) | pops the word's inputs, does the entry sequence (§10.5), pushes a `word` frame, sets `ip := 0` of the callee |
| `prim` | `entry` (kind `primitive`) | pops inputs, validates, calls `fn` (awaiting a returned thenable), validates results, pushes them |
| `varGet` | `entry` | `( -- v )` current value of the variable |
| `varSet` | `entry` | `( v -- )` set; `E_TYPE` if the tag differs from the variable's |
| `jump` | `target` | `ip := target` |
| `jumpf` | `target` | `( b -- )` pops a `bool` (`E_TYPE` otherwise); `ip := target` if false |
| `quot` | `end` | `( -- q )` pushes a `quot` value `{ code: this word, start: ip+1, env: current frame locals }` and sets `ip := end` (the index after the body) |
| `callq` | | `( q -- .. )` pops a `quot` (`E_TYPE` otherwise), pushes a `quot` frame with `locals := q.env`, `ip := q.start` |
| `comb` | `name` | the intrinsic combinators of §8: `if when unless times each map mapi filter reduce while loop try fork` |
| `dmark` | | pushes a `mark` frame on the return stack recording the current data depth (used by lowered loops, §8) |
| `dcheck` | `delta` | pops the `mark` frame; `E_EFFECT` unless current depth = recorded depth + `delta` |
| `listOpen` | | pushes a `list` frame recording the current data depth |
| `listClose` | | pops the `list` frame, collects all values above the recorded depth into one `list` (bottom to top), and pushes it; if the depth is below the mark, `E_STACK_UNDERFLOW` |
| `print` | `form` | `value`: `( v -- )` `.`; `stack`: `( -- )` `.s` |
| `ret` | | pops the current frame; for a `word` frame performs the exit check (§10.5) |

`recurse` compiles to `call` of the word's own entry. The code of a word always ends with `ret`. A quotation body also ends with `ret`.

`ret` of a `quot` frame has no checks. `ret` of a combinator-driven quotation returns control to the combinator state held in the `loop` frame beneath it (this is the implementation's concern; observable behaviour is §8).

**Step counting.** A step is one dispatched instruction. Each iteration of a `times/each/map/mapi/filter/reduce/while/loop/fork` combinator costs one additional step. `steps` is incremented before dispatch; `steps > limits.maxSteps` raises `E_LIMIT_STEPS` before the instruction runs.

### 10.4 Run loop requirements

The VM is a single `async` function with a synchronous inner loop. It MUST NOT `await` for non-thenable results (so a primitive that returns a plain value costs no microtask). There is one code path for sync and async primitives, never two (PLAN §3.4).

Performance requirement (PLAN WP 1.6): 10^6 simple steps (`lit`, `stack`, `jump`, `prim` on small ints) in under 200 ms in Node.

### 10.5 Word boundary: entry and exit sequence

**Entry** (`call` and `prim`), where `ins` is the declared input list (length n):

1. If `depth − floor < n`: `E_STACK_UNDERFLOW`. (A variadic input, §5.4, only requires the fixed inputs after the `..`.)
2. For each input slot, **deepest first**: coerce per §4.2, then validate per §4.3, then move on to the next slot; record coercions. Errors carry the **callee** as `word` (not the caller), the slot in `detail.param`, and `ip`/`pos` of the calling instruction. Values bound to a `key` slot are marked secret (§10.14).
3. `prim`: call `fn` with plain payloads (§4.4) followed by a `PrimitiveContext` (`{ signal, limits, scope }`); go to **primitive exit**.
4. `call`: build a **new** `locals` array from the named slots (the *coerced* values), remove all n inputs, push the anonymous ones back **already coerced** (so the body sees the coerced tag), set `base := depth_before_call − n`, push the frame (checking `maxReturnDepth`, `E_LIMIT_RETURN`).

**Exit of an FL word** (`ret` in a `word` frame):

1. Unless the effect is unchecked (`-- ..`): the data depth MUST equal `base + outputs.length`. Otherwise **`E_EFFECT`** with `detail.expected`, `detail.actual`.
2. Only if step 1 passed (or the effect is unchecked, in which case the top `outputs.length` values are checked if that many exist): each of the top `outputs.length` values MUST have the tag of its output slot (`any` accepts all; `number` accepts `int`/`num`). Otherwise `E_TYPE` with `detail.where = "output"`. Output `E_TYPE` is therefore only ever reported after the depth check has succeeded.
3. Pop the frame.

**Primitive exit**: validate the result count and tags (§4.4), meter the result sizes (§10.8), push. An `int` result that is a `bigint` inside the safe range is **normalised** to a `number` by the VM; an `int` result that is not an integer (a fractional or non-finite `number`) is `E_TYPE` with `detail.where = "result"`.

A primitive that throws a `ForgeError` has it re-raised with `word`/`vocab` filled in if absent; any other thrown value, **and any promise rejection that is not a `ForgeError`**, is wrapped in `E_PRIMITIVE` (`message` = the thrown message, `cause` = the thrown value).

**Primitive purity.** A primitive MUST NOT mutate any argument and MUST NOT return an alias of an argument (it returns a fresh value, even for `bytes`). The conformance harness passes frozen copies of every argument and checks results are not identical (`===`) to any argument.

### 10.6 Combinator implementation

Each combinator is implemented in the VM using `loop`/`try` frames on the return stack. Its observable semantics are §8. Iterating combinators check the stack-neutrality rule after every iteration (`E_EFFECT`).

### 10.7 Cancellation and time

- `RunOptions.signal` (an `AbortSignal`) and `RunOptions.abortFlag` (an `Int32Array`; nonzero element 0 means abort, intended to be a `SharedArrayBuffer` view written from another thread) are polled **every 1024 steps** (when `steps & 1023 === 0`), **before the first instruction**, and before and after every awaited primitive. Abort raises `E_ABORTED`.
- The wall-clock deadline (`limits.maxMillis`, measured with `performance.now()` from the start of the run) is checked on the same cadence; exceeding it raises `E_LIMIT_TIME`.
- **Yielding.** So that timers and messages (and therefore `signal` aborts) can run, the VM yields to the event loop with a macrotask every `RunOptions.yieldEvery` steps (default 131 072; 0 disables) and re-checks `signal`/`abortFlag`/deadline after resuming.
- **Async primitives.** When `fn` returns a thenable the VM awaits `Promise.race([thenable, abortSignal, deadline])`. If the abort or deadline wins, the run fails with `E_ABORTED` / `E_LIMIT_TIME`; the primitive's eventual result is discarded. Cooperative primitives SHOULD observe `ctx.signal`.
- **Synchronous primitives cannot be pre-empted.** The checks above run between instructions; a single synchronous primitive call (a long hash, a catastrophic regex) that never returns cannot be interrupted by the VM, and neither can the deadline fire during it. A host that must bound such calls (the Phase 2 Worker host) enforces it from outside: it terminates the Worker (PLAN §3.4, §4 watchdog) and reports `E_LIMIT_TIME` or `E_ABORTED` itself.

### 10.8 Resource limits

`Limits` (type in `types.ts`); every limit can be overridden per run with `RunOptions.limits`; `DEFAULT_LIMITS`:

| field | default | meaning | error |
|---|---|---|---|
| `maxSteps` | 10 000 000 | dispatched steps (§10.3) | `E_LIMIT_STEPS` |
| `maxDataDepth` | 100 000 | data stack length | `E_LIMIT_STACK` |
| `maxReturnDepth` | 10 000 | return stack frames (calls, quotation calls, combinator/try/list frames) | `E_LIMIT_RETURN` |
| `maxValueBytes` | 67 108 864 (64 MiB) | size of one value produced by a primitive, an intrinsic (`map`, `fork`, …) or a list literal | `E_LIMIT_VALUE` |
| `maxTotalBytes` | 1 073 741 824 (1 GiB) | **cumulative** size of all values so produced during one run (an allocation meter, not live size) | `E_LIMIT_TOTAL` |
| `maxIntBits` | 65 536 | bit length of an `int` literal or result (including `pow`, `shl`, `powmod`) | `E_LIMIT_VALUE` |
| `maxMillis` | 30 000 | wall clock per run | `E_LIMIT_TIME` |
| `maxOutputBytes` | 1 048 576 | UTF-8 bytes of accumulated output | `E_LIMIT_OUTPUT` |
| `maxSourceChars` | 1 048 576 | source length | `E_LIMIT_SOURCE` |
| `maxRegexLength` | 1024 | regex source length in constraints and `regex` params | `E_HEADER` / `E_PARAM_INVALID` |
| `maxTraceEntries` | 10 000 | trace and coercion records kept | (truncates, `traceTruncated`) |

**Size of a value** (used by the value and total limits): `bytes`: `byteLength`; `str`: 2 × length; `int`: 8 for a `number`, `ceil(bits/8)` for a `bigint`; `num`: 8; `bool`: 1; `quot`: 16; `list`: 8 per element plus the sizes of the elements; `record`: 16 per entry plus key and value sizes. Sizes are computed at the moment a primitive or intrinsic result, or a list literal, is created.

The checks happen at result creation, so a limit is reported at the instruction that created the oversize value.

### 10.9 Hooks, breakpoints, trace

`RunOptions` fields (see `types.ts`): `onStep`, `stepAll`, `breakpoints`, `trace`, `stack`, `vars`, `deny`, `scope`.

- `breakpoints`: a list of `{ word, ip? }` (`word` a qualified name). A breakpoint is *hit* just before the instruction at `(word, ip)` executes; if `ip` is omitted it is hit on entry to the word (`ip` 0). The debugger maps source lines to `ip` using `CompiledWord.positions`.
- `onStep(event)` is called, after the step is counted and the limit checks, just before an instruction runs, **if** `stepAll` is true (every instruction) or a breakpoint is hit (`event.breakpoint = true`). It may return a promise; the VM awaits it, which is how a UI pauses a run. It may return `"stop"`, which ends the run with `E_ABORTED` (`message: "stopped by hook"`). The `StepEvent.stack` is a live read-only view valid only during the call.
- `trace: true` records, per executed instruction, `{ step, word, ip, op, depth, stack }` (`stack` is a shallow copy of the top 16 values), up to `maxTraceEntries`; the rest are dropped and `RunResult.traceTruncated` is true.
- `vars`: a `Map` keyed by the variable id; `undefined` means a fresh store. Reuse the same map across runs to persist variables.
- `deny`: effect labels (below) that must not run in this run. Calling a primitive that has a denied label raises `E_FORBIDDEN` (a "reproducible mode").

### 10.10 Effect labels

A primitive may declare `effects: ("+async" | "+random" | "+time")[]`. A colon word's `effects` metadata is the union of the labels of every word it calls (including inside quotations), computed at compile time; it cannot be set by hand. `+async` marks a primitive whose `fn` returns a promise; `+random` marks nondeterministic output; `+time` marks dependence on the clock. v0.1 `core` has no labelled word; the labels exist for later vocabularies and for the fixtures in §16.

### 10.11 Output

`.`, `.s`, and nothing else append to the run output (a `string`, `RunResult.output`). `help`, `see`, `words` return strings; they do not print.

### 10.12 `RunResult`

`effects` in the result is the sorted union of the effect labels of the primitives that were **actually called** during the run (a dynamic set, unlike `WordMeta.effects`, which is static and transitive). A run never throws for language errors. It returns `{ ok: true, stack, output, steps, elapsedMs, coercions, effects, trace? }` or `{ ok: false, error, stack, … }` where `stack` is the data stack at the point of failure. Programmer errors (a bad argument to the API) throw. Compile errors during a console `run` are returned the same way, with `steps: 0`.

### 10.13 Runtime facade

`ForgeRuntime` (types in `types.ts`, implemented in `runtime.ts`, created by `createRuntime(options)`): `load(source, opts)`, `run(source, opts)`, `call(name, args, opts)` (run one word with `args` as the initial stack, deepest first), `lookup(name, scope?)` (a `WordEntry`, throws like §6), `meta(name, scope?)`, `currentVocab()`, `setCurrentVocab(name)`, `getScope()`, `setUsing(names)`, plus the `dictionary` and primitive `registry`. A fresh runtime contains `user` (empty) and `core` (all §13 words), plus any primitives passed in `RuntimeOptions`. `load` is **synchronous** (hashes are computed by an in-repo SHA-256, §12.4) and throws a `ForgeError` on failure; `run` and `call` return a promise and never reject for language errors (§10.12).

### 10.14 Secrets

A `bytes` value that is bound to a `key`-typed input slot (§5.6) is marked **secret** (the `secret` flag on the `Value`, preserved by `local` reads, dropped by any operation that creates a new value). A secret value is rendered as the text `<redacted>` by every facility that prints or records values for diagnostics: `ForgeError.detail.value`, `stackSnapshot`, trace entries, `.s`/`.` output and the `help`/`see` machinery. At an entry failure the values destined for `key` slots are replaced in the snapshot by a `str` `<redacted>`. Equality ignores the flag. (Redaction is a safety net for logs and UIs, not a secrecy boundary: a word can still read and transform the bytes.)

---

## 11. Errors

`ForgeError` extends `Error`. Fields (`ForgeErrorInit` in `types.ts`):

| field | type | meaning |
|---|---|---|
| `code` | `ErrorCode` | one of the codes below |
| `message` | `string` | human-readable, plain text (never HTML) |
| `word` | `string \| null` | qualified name of the innermost executing word (or the word being compiled); `null` at top level; for a primitive, its qualified name |
| `vocab` | `string \| null` | its vocabulary |
| `step` | `number \| null` | step counter when raised (`null` for compile/read errors) |
| `ip` | `number \| null` | instruction index in `word` (`null` when not applicable) |
| `pos` | `SourcePos \| null` | source position: the offending token for read/compile errors; the instruction's recorded position for runtime errors |
| `stackSnapshot` | `Value[]` | the top 16 data-stack values at the time, bottom to top (empty for compile errors) |
| `frames` | `{ word: string; ip: number }[]` | the top 16 return-stack word frames, innermost first |
| `detail` | `Record<string, unknown>` | code-specific fields, see table |
| `cause` | `unknown` | wrapped original (for `E_PRIMITIVE`); `Error.cause` |

`name` is `"ForgeError"`. `toJSON()` returns all fields with values replaced by `.s` reprs. Errors are never smuggled into output text.

### 11.0 Malformed forms: which code

For cases that would otherwise have no assigned code: `recurse` outside a colon definition is `E_SYNTAX` at the console and `E_TOPLEVEL` in a unit; `IN:`, `VOCAB` or `USING:` followed by a token that is not a valid `vocab-name` is `E_NAME`; a missing operand (`IN:` at end of input, `CONSTANT` with nothing after it) is `E_SYNTAX`; `CONSTANT`/`VARIABLE`/`:`/alias with an invalid or reserved name (including a `bool` or `qword` token in the name position) is `E_NAME`; a stray `;`, `]` or `}` is `E_SYNTAX`; `META:` with a missing word name is `E_SYNTAX`.

### 11.1 Error codes

| code | when raised | `detail` |
|---|---|---|
| `E_LEX` | lexical error: unterminated string/comment/header/byte array, bad escape, malformed number, bad char literal, bad byte element, invalid character in a token, bad qualified name, a Zs/Zl/Zp/Cf character inside a token | |
| `E_SYNTAX` | structural error: unexpected token, missing `;`, unbalanced `[ ]` `{ }`, nested `:`, `VOCAB` in a unit, bad operand of `CONSTANT`/`VARIABLE`, stray `;` | `expected` |
| `E_TOPLEVEL` | executable code in a source unit (§9) | |
| `E_NAME` | invalid or reserved name in a defining position (§2.11) | `name` |
| `E_HEADER` | missing or malformed header; static header violations (§5.4, §5.5) | `item` |
| `E_META` | malformed or conflicting `META:` clause, or `META:` for an undefined/private word (§5.9) | `clause` |
| `E_UNDEFINED` | name not found (§6) | `name`, `vocab?` |
| `E_AMBIGUOUS` | unqualified name found in two or more `USING:` vocabularies | `name`, `candidates: string[]` |
| `E_PRIVATE` | reference to a private word from outside its vocabulary | `name` |
| `E_NO_VOCAB` | `v:n` or `USING:` names a vocabulary that does not exist | `vocab` |
| `E_REDEFINED` | duplicate definition in one unit (§6.5); alias collision | `name` |
| `E_READONLY` | defining into `core` | `vocab` |
| `E_UNTRUSTED` | `PRIMITIVE` in an untrusted load (checked first, §5.11) | |
| `E_NO_PRIMITIVE` | `PRIMITIVE` names an unregistered primitive | `name` |
| `E_STACK_UNDERFLOW` | a pop that would go below the current floor (§10.1), or fewer values above the floor than a word's inputs | `needed`, `available` |
| `E_TYPE` | value has no coercion path to the required type; non-`bool` condition; operand of the wrong tag; wrong primitive result tag | `expected`, `actual`, `param?`, `where?` |
| `E_COERCE` | a coercion exists but this value fails it (§4.2); `str>int` parse failure | `from`, `to`, `param?` |
| `E_PARAM_INVALID` | a value violates a declared constraint, choice, charset or regex rule (§4.3) | `param`, `constraint`, `value` |
| `E_EFFECT` | a word, or a loop body, left the wrong stack depth (§8, §10.5) | `expected`, `actual` |
| `E_DIV_ZERO` | `/`, `div`, `mod` with a zero divisor | |
| `E_RANGE` | index out of range; negative count; negative shift; missing record key; non-finite float result; byte/code-point value out of range; no modular inverse; bad radix | |
| `E_USER` | raised by `fail` | |
| `E_PRIMITIVE` | a primitive threw something that is not a `ForgeError` | |
| `E_FORBIDDEN` | a primitive with a denied effect label was called (§10.9) | `effect` |
| `E_LIMIT_STEPS` `E_LIMIT_STACK` `E_LIMIT_RETURN` `E_LIMIT_VALUE` `E_LIMIT_TOTAL` `E_LIMIT_TIME` `E_LIMIT_OUTPUT` `E_LIMIT_SOURCE` | the matching limit (§10.8). `E_LIMIT_SOURCE` is raised by `read` (and so by `load` and console `run`) before tokenising. `E_LIMIT_VALUE` also covers an integer literal over `maxIntBits` bits (raised by `read`) | `limit`, `value` |
| `E_ABORTED` | `AbortSignal`/`abortFlag` set, or the step hook returned `"stop"` | |
| `E_INTERNAL` | a violated internal invariant (an implementation bug). Never catchable | |

The complete code list is exactly the 34 codes in this table (`ErrorCode` in `types.ts`).

For code inside a quotation, `word` is the word that lexically contains the quotation; code typed at the console belongs to the word `<console>`. Compile-time errors set `word` to the word being compiled (or `null`), `step`/`ip` to `null`, and `pos` to the offending token.

Precedence when several apply: the earliest failing step of the specified sequence wins. For a word entry that is: (1) underflow for the whole input list; then, **slot by slot, deepest first**, (2a) tag/coercion (`E_TYPE`, `E_COERCE`) and (2b) constraint (`E_PARAM_INVALID`) of that slot, before the next slot is looked at (so a constraint violation in slot 0 is reported before a type error in slot 1); then the body; then at exit (3) depth (`E_EFFECT`) and only then (4) output tags (`E_TYPE`). Within one source text, the **first** error in token order is reported (compilation stops at the first error).

---

## 12. Metadata

### 12.1 The record

Each dictionary entry carries one **JSON-serialisable** `WordMeta` record. It is the only thing the UI, validation, help, search, docs and tests read. Fields (`WordMeta` in `types.ts`):

| field | type | meaning |
|---|---|---|
| `name` | string | unqualified canonical name |
| `vocab` | string | vocabulary |
| `qname` | string | `vocab:name` |
| `kind` | `"fl" \| "primitive" \| "intrinsic" \| "constant" \| "variable"` | what implements it (`variable` covers the getter and `n!`) |
| `exported` | boolean | `true` unless private |
| `op` | boolean | §5.7 |
| `effect` | `StackEffect` | `{ inputs: StackSlot[], outputs: StackSlot[], unchecked: boolean, variadicInput: boolean, text: string }` |
| `params` | `ParamSpec[]` | `effect.inputs[1..]` as parameters (§12.2) |
| `category` | string \| null | |
| `doc` | string \| null | plain text; rendered as text or sanitised Markdown, never HTML |
| `aliases` | string[] | extra names in the same vocabulary |
| `seeAlso` | string[] | qualified names |
| `effects` | `("+async"\|"+random"\|"+time")[]` | sorted, deduplicated (§10.10) |
| `version` | string | default `"1"` |
| `hash` | string | lowercase hex SHA-256 identity of the word and everything it calls (§12.4) |
| `source` | `{ unit: string \| null; text: string \| null; pos: SourcePos \| null }` | |

A **slot** (`StackSlot`) is `{ name: string \| null, type: ParamType, options?: string[], constraint?: Constraint, default?: ParamDefault, doc?: string }`. A **parameter** (`ParamSpec`) is a slot with `name` non-null plus `index` (its input index, ≥ 1) and `required` (`default` absent).

`Constraint` is `{ min?: number; max?: number; oneOf?: number[]; minLength?: number; maxLength?: number; lengthOneOf?: number[]; pattern?: string }` (numeric value constraints use `min/max/oneOf`; length constraints use the `…Length` fields; both are exact finite numbers). `ParamDefault` is `number | string | boolean | { value: string; enc: string }`: for `toggle`/`key` the `{ value, enc }` form is used, with `enc` the first-listed encoding; `bytes` defaults are hex strings. `options` lists `choice` options or `toggle`/`key` encodings.

`meta.schema.json` (WP 1.8) is a JSON Schema (draft 2020-12) for exactly this record with `additionalProperties: false` everywhere, string length bounds as in §5.9, and `qname`/`vocab`/`name` patterns from §2.11. Every `WordMeta` produced by the runtime MUST validate against it.

### 12.2 Desugaring

For a colon word the compiler builds the record as follows.

1. `name`, `vocab`, `qname`, `exported` from the definition; `kind: "fl"`.
2. `effect` from the header (`parseHeader`). `effect.text` is the canonical text (§12.3).
3. `params`: for each input `i ≥ 1`, in order: `{ name, type, options?, constraint?, default?, index: i, required: default === undefined, doc? }`.
4. `category`, `doc`: from the leading `"…" category` / `"…" doc` declarations, then `META:` clauses (§5.9). Default `null`.
5. `params[i].doc` from `META: … param name "…" ;`.
6. `aliases`, `seeAlso` from `META:` (in order, deduplicated, `seeAlso` fully qualified).
7. `effects`: computed (§10.10).
8. `version`: from `META: version`, default `"1"`.
9. `source`: `unit` (the `LoadOptions.unit` name), `text` the verbatim source slice from the `:` token through the closing `;` token (inclusive; comments preserved), `pos` the position of the `:`.
10. `hash`: §12.4.

For a primitive: `kind: "primitive"`, `effect`/`params` from the registered header, `category`/`doc`/`effects`/`version` from the `PrimitiveDef`, then `META:` may add the rest; `source.text` is `null`.

For `CONSTANT`: `kind: "constant"`, effect `( -- T )`, `source.text` is the verbatim text `literal CONSTANT name`. For a variable, the getter has effect `( -- T )`, the setter `( T -- )`, `source.text` as for constants.

For an intrinsic (`core` stack words, combinators, print words): `kind: "intrinsic"`, effect and `doc` from the `core` table (§13).

### 12.3 Canonical text

`StackEffect.text` and `help`/`see` use one canonical rendering:

- slot: `name:` (if named) + type + options + constraint + `=` default (if any). Type is the ptype name; options render as `{a|b|c}`; constraint as `[` + comma-joined parts + `]`, where an interval renders `lo..hi` (open ends omitted: `..hi`, `lo..`), a set `a|b|c`, a single-valued interval as `n`, a pattern as `/source/`; length parts come before a pattern; a default renders as: int/num via §3.3 display, str/regex/charset/toggle/key/bytes as a quoted string (§3.3 repr), `true`/`false`, a `choice` option bare. An anonymous slot renders as its type (a `label` renders as the label).
- effect: `( ` + inputs joined by one space + ` -- ` + outputs joined by one space + ` )`; with no inputs `( -- … )`; unchecked output `( … -- .. )`; variadic input `( .. … -- … )`; no outputs `( … -- )`. A `choice`/`toggle`/`key` option renders bare unless it contains whitespace or any of `| { } "`, in which case it renders as a string literal (§3.3 repr).

So `( str  amount:int[1..25]=13 -- str )` renders `( str amount:int[1..25]=13 -- str )`.

### 12.4 Hash

Hashes are computed **synchronously** with a small SHA-256 implemented in the repository (`sha256.ts`, WP 1.8, written from the FIPS 180-4 description; `sha256(data: Uint8Array | string): string` returns lowercase hex, strings being UTF-8 encoded). No WebCrypto is involved, so `load()` is synchronous.

The hash of a word covers its **own canonical text plus the hashes of the words it calls, transitively**:

- `ownText(entry)`: for an FL word, constant or variable: `source.text`. For a primitive: `primitive <qname> <effect.text> <version>`. For an intrinsic: `intrinsic <qname> <effect.text> <version>` (version `"1"`).
- `hash(entry) = hex( SHA-256( UTF-8( ownText(entry) + "\n" + lines ) ) )` where `lines` is the list `<dep.qname> <dep.hash>` for every distinct entry in `CompiledWord.deps` (all words, primitives, intrinsics, constants and variables the body references, **excluding the word itself**, `recurse` included), sorted by `qname` in code-point order and joined by `"\n"`. A word with no dependencies hashes `ownText + "\n"`.
- Because there are no forward references, every dependency has a hash by the time a word is defined; the transitive property follows from each dependency's own hash covering its dependencies.
- Constants and variables use `ownText` only (a variable's getter and setter share it). Aliases share the hash of the entry they alias.
- The hash does not cover `META:` blocks or `doc`/`category` text outside `source.text` (metadata edits do not change a word's identity), but it does cover any comments and leading declarations inside the verbatim `source.text`.

### 12.5 `help` and `see`

Both take a `str` naming a word (qualified, or unqualified resolved in the session scope; `E_UNDEFINED` otherwise), and **return** a `str` (the REPL prints it). They are `core` words supplied by the runtime because they read the dictionary.

`help ( str -- str )` returns, joined with `\n` and ending with one `\n`, the following lines (a line is omitted when its source is empty):

```
<qname>  <effect.text>
<doc>
category: <category>
aliases: <a>, <b>
see also: <q1>, <q2>
effects: <e1>, <e2>
parameters:
  <slot text>  -- <doc>
```

The `parameters:` section lists one line per parameter in order: two spaces, the canonical slot text, then, if the parameter has a doc, two spaces `-- ` and the doc.

`see ( str -- str )` returns, by kind:

| kind | `see` result |
|---|---|
| `fl` | `source.text` followed by `\n` |
| `primitive` | `\ primitive <qname> <effect.text>` + `\n` |
| `intrinsic` | `\ intrinsic <qname> <effect.text>` + `\n` |
| `constant` / `variable` | the verbatim `source.text` + `\n` |

---

## 13. The `core` vocabulary

`core` is read-only after construction. Effects use the §5.4 header syntax in lenient mode; `seq` below means a `str`, `bytes` or `list` (the effect is written `any`, and the word checks the tag itself: `E_TYPE`); `number` accepts `int` or `num`.

Kinds: **I** = intrinsic (compiled to a dedicated instruction, §10.3), **P** = primitive (typed registry, pure `fn`, §10.5), **R** = runtime-supplied primitive with access to the dictionary (`help see words vocabs current-vocab`). Words marked **P** are implemented in `vocab/core.ts` (WP 1.7); **I** by the compiler and VM (WPs 1.5, 1.6); **R** by the runtime facade.

All ordering and sorting of strings is by **code point** (never JS's default UTF-16 code unit order, which differs for characters above U+FFFF).

### 13.1 Stack

All stack words operate above the current floor (§10.1).

| word | kind | effect | description |
|---|---|---|---|
| `dup` | I | `( a -- a a )` | duplicate the top |
| `drop` | I | `( a -- )` | discard the top |
| `swap` | I | `( a b -- b a )` | exchange the top two |
| `over` | I | `( a b -- a b a )` | copy the second to the top |
| `rot` | I | `( a b c -- b c a )` | rotate the third to the top |
| `-rot` | I | `( a b c -- c a b )` | rotate the top to third |
| `nip` | I | `( a b -- b )` | drop the second |
| `tuck` | I | `( a b -- b a b )` | copy the top below the second |
| `2dup` | I | `( a b -- a b a b )` | duplicate the top pair |
| `2drop` | I | `( a b -- )` | discard the top pair |
| `depth` | I | `( -- int )` | push the number of values above the floor (before the push) |
| `clear` | I | `( .. -- )` | remove all values above the floor |

### 13.2 Arithmetic and comparison

| word | kind | effect | description |
|---|---|---|---|
| `+` | P | `( number number -- number )` | sum |
| `-` | P | `( number number -- number )` | difference (second minus top) |
| `*` | P | `( number number -- number )` | product |
| `/` | P | `( number number -- num )` | float division; zero divisor `E_DIV_ZERO` |
| `div` | P | `( int int -- int )` | exact floor division (correct for any size); zero divisor `E_DIV_ZERO` |
| `mod` | P | `( int int -- int )` | floor modulo (sign of the divisor); zero `E_DIV_ZERO` |
| `pow` | P | `( int int -- int )` | integer power; exponent < 0 `E_RANGE`; result over `maxIntBits` `E_LIMIT_VALUE` |
| `gcd` | P | `( int int -- int )` | greatest common divisor, never negative; `gcd(0,0)` is 0 |
| `invmod` | P | `( a:int m:int -- int )` | modular inverse of a mod m in `[0, m)`; m < 1 or no inverse `E_RANGE` |
| `powmod` | P | `( base:int exp:int mod:int -- int )` | `base^exp mod mod` in `[0, mod)`; exp < 0 or mod < 1 `E_RANGE` |
| `sqrt` | P | `( number -- num )` | square root; negative `E_RANGE` |
| `neg` | P | `( number -- number )` | negation (`0 neg` is the `int` 0, never negative zero) |
| `abs` | P | `( number -- number )` | absolute value |
| `min` | P | `( number number -- number )` | the smaller (tag preserved) |
| `max` | P | `( number number -- number )` | the larger (tag preserved) |
| `=` | P | `( any any -- bool )` | equality per §3.1; different tags are unequal except `int`/`num`, which compare **exactly** |
| `<>` | P | `( any any -- bool )` | negation of `=` |
| `<` `>` `<=` `>=` | P | `( any any -- bool )` | ordering on two numbers (exact, mixed `int`/`num` and `bigint` allowed), two `str` (by code point), or two `bytes` (lexicographic); otherwise `E_TYPE` |

### 13.3 Logic and bitwise

| word | kind | effect | description |
|---|---|---|---|
| `and` | P | `( bool bool -- bool )` | logical and |
| `or` | P | `( bool bool -- bool )` | logical or |
| `not` | P | `( bool -- bool )` | logical not |
| `band` | P | `( int int -- int )` | bitwise and (two's complement, arbitrary width) |
| `bor` | P | `( int int -- int )` | bitwise or |
| `bxor` | P | `( any any -- any )` | two `int`s: bitwise xor. Two `bytes` `( bytes key:bytes -- bytes )`: xor each data byte with the key repeated cyclically; the result has the data's length; an empty key is `E_RANGE`. Mixed or other tags `E_TYPE`. (A `str` is not coerced here; convert with `str>bytes`.) |
| `bnot` | P | `( int -- int )` | bitwise not, `-n-1` |
| `shl` | P | `( int k:int -- int )` | shift left by k ≥ 0 (k < 0 `E_RANGE`); a result over `maxIntBits` bits is `E_LIMIT_VALUE` (checked before computing) |
| `shr` | P | `( int k:int -- int )` | arithmetic shift right by k ≥ 0 (k < 0 `E_RANGE`) |

`true` and `false` are literals, not words.

### 13.4 Sequences, strings, bytes, lists, records

For `len cat slice nth rev` the first operand selects the sequence kind (`str` by code point, `bytes`, `list`).

| word | kind | effect | description |
|---|---|---|---|
| `len` | P | `( any -- int )` | length of a `str` (code points), `bytes` or `list` |
| `cat` | P | `( any any -- any )` | concatenate two of the same kind (`E_TYPE` if kinds differ) |
| `slice` | P | `( any from:int to:int -- any )` | sub-sequence `[from, to)`; need 0 ≤ from ≤ to ≤ len else `E_RANGE` |
| `nth` | P | `( any i:int -- any )` | element i: 1-code-point `str`, byte as `int`, or list element; out of range `E_RANGE` |
| `rev` | P | `( any -- any )` | reverse (by code point for `str`) |
| `split` | P | `( str sep:str -- list )` | split at every occurrence of `sep` into a list of `str`; `""` gives `{ "" }`, a trailing separator gives a trailing `""`; empty `sep` `E_RANGE` |
| `join` | P | `( list sep:str -- str )` | join a list of `str` with `sep`; non-`str` element `E_TYPE` |
| `bjoin` | P | `( list sep:bytes -- bytes )` | join a list of `bytes` with a `bytes` separator; non-`bytes` element `E_TYPE` |
| `upper` | P | `( str -- str )` | `String.prototype.toUpperCase` |
| `lower` | P | `( str -- str )` | `String.prototype.toLowerCase` |
| `translate` | P | `( bytes table:bytes[256] -- bytes )` | replace each byte `b` by `table[b]` (a table that is not exactly 256 bytes is `E_PARAM_INVALID`) |
| `append` | P | `( list any -- list )` | a new list with the element added at the end |
| `zip` | P | `( list list -- list )` | a list of two-element lists `{ a b }`, as long as the shorter input |
| `range` | P | `( from:int to:int -- list )` | `{ from … to-1 }`; empty if `to <= from` |
| `>record` | P | `( list -- record )` | from a list of `{ key value }` pairs (`str` key); later duplicates win |
| `get` | P | `( record key:str -- any )` | the value; missing key `E_RANGE` |
| `put` | P | `( record key:str any -- record )` | a new record with the key set |
| `keys` | P | `( record -- list )` | the keys, in insertion order |

### 13.5 Conversion

| word | kind | effect | description |
|---|---|---|---|
| `type` | P | `( any -- str )` | the tag name: `"int"`, `"num"`, `"str"`, … |
| `int>str` | P | `( int -- str )` | decimal text |
| `str>int` | P | `( str -- int )` | parse `-?[0-9]+`; otherwise `E_COERCE` |
| `int>str-radix` | P | `( int radix:int -- str )` | text in base 2..36, lowercase digits, `-` for negatives; other radix `E_RANGE` |
| `str>int-radix` | P | `( str radix:int -- int )` | parse `-?` then digits of the base (either case), at least one digit; bad digit `E_COERCE`; other radix `E_RANGE`; over `maxIntBits` `E_LIMIT_VALUE` |
| `int>num` | P | `( int -- num )` | to float (`E_COERCE` for a `bigint`) |
| `num>int` | P | `( num -- int )` | to int if integral, else `E_COERCE` |
| `floor` | P | `( number -- int )` | round toward −∞ (an `int` passes through) |
| `ceil` | P | `( number -- int )` | round toward +∞ |
| `round` | P | `( number -- int )` | round to nearest, halves away from zero |
| `str>bytes` | P | `( str -- bytes )` | UTF-8, strict |
| `bytes>str` | P | `( bytes -- str )` | UTF-8, strict |
| `latin1>bytes` | P | `( str -- bytes )` | one byte per code point; a code point above U+00FF is `E_RANGE` |
| `bytes>latin1` | P | `( bytes -- str )` | one code point (U+0000..U+00FF) per byte; never fails |
| `bytes>hex` | P | `( bytes -- str )` | lowercase hex, no separators |
| `hex>bytes` | P | `( str -- bytes )` | ASCII whitespace ignored; odd digit count or non-hex `E_COERCE` |
| `str>codes` | P | `( str -- list )` | list of code points as `int` |
| `codes>str` | P | `( list -- str )` | from a list of code-point `int`s; invalid or surrogate `E_RANGE`; non-int `E_TYPE` |
| `bytes>list` | P | `( bytes -- list )` | list of `int` 0..255 |
| `list>bytes` | P | `( list -- bytes )` | each element an `int` 0..255 (`E_RANGE`/`E_TYPE`) |

Ciphers over text should operate on `bytes` (see §15.1). The Latin-1 pair is the lossless bridge between a byte string and a JS string; UTF-8 is the default everywhere else (§4.2).

### 13.6 Combinators and control

| word | kind | effect | description |
|---|---|---|---|
| `call` | I | `( quot -- .. )` | run a quotation |
| `if` | I | `( bool quot quot -- .. )` | conditional (§8) |
| `when` | I | `( bool quot -- .. )` | run if true |
| `unless` | I | `( bool quot -- .. )` | run if false |
| `times` | I | `( n:int quot -- )` | repeat n times |
| `each` | I | `( any quot -- )` | for each element of a list, bytes or str |
| `map` | I | `( any quot -- any )` | transform each element (bytes results must be 0..255) |
| `mapi` | I | `( any quot -- any )` | like `map`; the quotation sees `( elem index )` |
| `filter` | I | `( any quot -- any )` | keep elements the quotation accepts |
| `reduce` | I | `( any init quot -- acc )` | fold |
| `while` | I | `( quot quot -- )` | pre-test loop |
| `loop` | I | `( quot -- )` | post-test loop |
| `try` | I | `( quot quot -- .. )` | run with a recovery handler |
| `fork` | I | `( any any any quot -- any )` | split, transform each piece, join (`str` or `bytes` data) |
| `fail` | P | `( str -- )` | raise `E_USER` with this message |

### 13.7 Printing and introspection

| word | kind | effect | description |
|---|---|---|---|
| `.` | I | `( any -- )` | print the display form and a newline |
| `.s` | I | `( .. -- .. )` | print the stack without changing it |
| `help` | R | `( str -- str )` | metadata text for a word (§12.5) |
| `see` | R | `( str -- str )` | source or definition of a word (§12.5) |
| `words` | R | `( vocab:str -- list )` | public word names of a vocabulary, sorted by code point, as `str`s; unknown vocabulary `E_NO_VOCAB` |
| `vocabs` | R | `( -- list )` | vocabulary names, sorted by code point |
| `current-vocab` | R | `( -- str )` | the current vocabulary of the executing segment's scope (§9) |

Total: **102** words (12 stack + 21 arithmetic and comparison, counting `< > <= >=` individually + 9 logic and bitwise + 18 sequences and records + 20 conversion + 15 control + 7 printing and introspection).

Recipe-oriented vocabularies (`encoding`, `classical`, …) arrive in Phase 4. Nothing in `core` can reach the network, DOM, storage or clock.

---

## 14. Recipe compilation (summary; implemented in Phase 2)

A recipe step `{ "op": "classical:rot", "params": { "amount": 13 } }` compiles to **literals followed by a qualified word call**, one step per source line:

```
13 classical:rot
```

Rules:

1. The op reference is always fully qualified. The recipe also stores the word's `version`/`hash`; if the dictionary's `hash` differs, the loader reports drift.
2. For each parameter in `meta.params` order: take `params[name]` if present, else `default`, else error. Render it as a literal by runtime type: `int` decimal, `num` with `.0` if integral, `str`/`choice`/`regex`/`charset` string literal with escapes, `bool` `true`/`false`, `bytes`/`toggle`/`key` as a byte-array literal after decoding `{ value, enc }` with the chosen encoding.
3. A disabled step compiles to nothing. A breakpoint step sets `breakpoints` on the `call`'s `ip`, found through `positions` (the step's line).
4. A `fork` step compiles to its separator and joiner string literals, a quotation of its sub-steps, then `fork`: `"\n" "\n" [ 13 classical:rot ] fork`.
5. The whole recipe is one word: `: name ( bytes -- bytes ) <steps…> ;` using `IN:`/`USING:` or qualified names only.
6. Step lines are emitted one per line, so line numbers map to recipe step indices.

---

## 15. Worked examples

### 15.1 `classical:rot` (the Gate 1 example)

Classical ciphers work on **bytes** and act on ASCII letters only; every other byte (digits, punctuation, UTF-8 continuation bytes, arbitrary binary) passes through unchanged. So `rot` is safe on binary input and on UTF-8 text alike. A `str` argument is coerced to `bytes` (UTF-8) at the word boundary.

```forth U-rot
IN: classical

: _rot-code ( code:int amount:int -- int )
  code 65 >= code 90 <= and
  [ code 65 - amount + 26 mod 65 + ]
  [ code 97 >= code 122 <= and
    [ code 97 - amount + 26 mod 97 + ]
    [ code ]
    if ]
  if ;

: rot ( bytes amount:int[0..25]=13 -- bytes )
  "Rotate each ASCII letter by a fixed amount; other bytes pass through." doc
  "Classical ciphers" category
  [ amount _rot-code ] map ;

META: rot
  param amount "Shift (13 = ROT13)" ;
  alias rot13 ;
  see-also classical:atbash ;
;
```

(The harness extracts the block whose info string is `forth U-rot`; `@use U-rot` in §16 loads it.)

Walkthrough of `"Hello" 13 classical:rot`:

1. Stack: `"Hello" 13`. `call classical:rot`: two inputs. Input 0 is bare `bytes` (anonymous), input 1 is `amount:int[0..25]`. Slot 0: `str` → `bytes` by UTF-8 (recorded in `coercions`). Slot 1: 13 is an `int` in 0..25. A new locals array `[13]` is built; the already-coerced anonymous input `#[ 48 65 6c 6c 6f ]` is pushed back; `base = 0`.
2. The quotation `[ amount _rot-code ]` captures that locals array. `map` on `bytes`: for each byte `e` push `e`; `amount` pushes 13; `_rot-code` pops 13 and `e` into its own locals (`code = e`, the deeper one; `amount = 13`) and returns an int; `map` pops it and checks it is in 0..255. Result `#[ 55 72 79 79 62 ]`.
3. Exit check: depth 1 = `base + 1`; the top is `bytes`. Done. `bytes>str .` prints `Uryyb`.

Passing `26` instead: step 1 fails with `E_PARAM_INVALID`, `word = "classical:rot"`, `detail = { param: "amount", constraint: "[0..25]", value: "26" }`, before any body instruction runs. `#[ ff 41 ] 1 classical:rot` gives `#[ ff 42 ]` (the `ff` byte is untouched; it would not even be valid UTF-8).

The metadata record (abridged; JSON):

```json
{
  "name": "rot", "vocab": "classical", "qname": "classical:rot",
  "kind": "fl", "exported": true, "op": true,
  "effect": {
    "inputs": [
      { "name": null, "type": "bytes" },
      { "name": "amount", "type": "int", "constraint": { "min": 0, "max": 25 }, "default": 13, "doc": "Shift (13 = ROT13)" }
    ],
    "outputs": [ { "name": null, "type": "bytes" } ],
    "unchecked": false,
    "variadicInput": false,
    "text": "( bytes amount:int[0..25]=13 -- bytes )"
  },
  "params": [
    { "name": "amount", "type": "int", "index": 1, "required": false,
      "constraint": { "min": 0, "max": 25 }, "default": 13, "doc": "Shift (13 = ROT13)" }
  ],
  "category": "Classical ciphers",
  "doc": "Rotate each ASCII letter by a fixed amount; other bytes pass through.",
  "aliases": ["rot13"],
  "seeAlso": ["classical:atbash"],
  "effects": [],
  "version": "1",
  "hash": "<64 hex digits>",
  "source": { "unit": null, "text": ": rot ( bytes amount:int[0..25]=13 -- bytes ) …", "pos": { "offset": 0, "line": 1, "col": 1 } }
}
```

and `"classical:rot" help` returns:

```
classical:rot  ( bytes amount:int[0..25]=13 -- bytes )
Rotate each ASCII letter by a fixed amount; other bytes pass through.
category: Classical ciphers
aliases: rot13
see also: classical:atbash
parameters:
  amount:int[0..25]=13  -- Shift (13 = ROT13)
```

### 15.2 Locals

```forth
: hyp2 ( a:int b:int -- int )  a a * b b * + ;
3 4 hyp2 .            \ 25: a and b are locals, the stack is empty on entry to the body

: scale ( int k:int -- int )  k * ;
6 7 scale .           \ 42: "int" is anonymous and stays on the stack; k is a local
```

### 15.3 Ambiguity

```forth
IN: alpha
: greet ( -- str ) "alpha" ;
IN: beta
: greet ( -- str ) "beta" ;
```

```
USING: alpha beta ;
greet .
```

→ `E_AMBIGUOUS`, `detail = { name: "greet", candidates: ["alpha:greet", "beta:greet"] }`, raised at compile time with nothing executed. `alpha:greet .` prints `alpha`.

### 15.4 Shadowing

```forth
IN: demo
: dup ( int -- int int )  99 ;     \ shadows core:dup inside the vocabulary demo
```

```
IN: demo  5 dup .s      \ <2> 5 99      (demo:dup wins: current vocabulary first)
IN: user  5 dup .s      \ <2> 5 5       (no demo:dup in scope: core:dup)
5 demo:dup .s           \ <2> 5 99
5 core:dup .s           \ <2> 5 5
```

### 15.5 Limit error

```forth
: spin ( -- )  [ true ] loop ;
```

`spin` with `limits.maxSteps = 1000` fails with `E_LIMIT_STEPS`, `word = "user:spin"` (or `"<console>"` where the instruction is the console's), `step = 1001`, `detail = { limit: 1000, value: 1001 }`; the stack snapshot is whatever was on the stack. Not even `try` can catch it.

---

## 16. Conformance

### 16.1 Test block format

Every test is a fenced block with info string `fl-test`. The first line is `# C<number> <title>`. Lines starting with `@` begin a section; section content is every following line up to the next `@` line (a single trailing newline is dropped). Sections:

| section | meaning |
|---|---|
| `@unit` | source loaded with `load()` before the run (trusted = false). May appear several times; they load in order. |
| `@unit-fails CODE` | like `@unit`, but the load MUST fail with `CODE`, and the test continues (nothing from that unit may be defined) |
| `@use U-rot` | loads the unit of §15.1 (the code block tagged `forth U-rot`: the `classical` vocabulary) before the other units |
| `@trusted` | the previous `@unit` is loaded with `trusted: true` |
| `@run` | console source executed with `run()`. A test may contain several `@run` sections; they execute in order in one console session (the session scope persists; the final data stack of one run is the initial stack of the next) |
| `@stack-in` | the initial data stack of the first run: whitespace-separated literal tokens (§2: ints, floats, strings, chars, bytes, bool), pushed in order via `RunOptions.stack` |
| `@vars shared` | all runs of the test share one variable store (otherwise each run gets a fresh one) |
| `@stack` | expected final data stack of the nearest preceding `@run`, in `.s` format (e.g. `<2> 1 "a"`) |
| `@out` | expected output of the nearest preceding `@run`: the section's lines joined with `\n` plus one final `\n`; an empty or absent section means no output (so a trailing blank line in the block stands for the extra `\n` printed by `.` after a text that already ends in a newline) |
| `@error` | expected failure of the nearest preceding `@run`: `CODE key=value …` (code, then optional `line=`, `col=`, `word=`, or `detail.<field>=` assertions; `a,b` after `candidates=` is a list). If the test has no `@run` at all, the failure is expected from the last `@unit`'s `load()`. Otherwise the `run()` result must have `ok: false`. When an error is expected, `@out` (if present) is the output produced before it. |
| `@limits` | `name=value` pairs (space-separated) overriding `DEFAULT_LIMITS` for every run of the test |
| `@abort` | `<n>ms`: abort the signal this long after each run starts |
| `@deny` | space-separated effect labels for `RunOptions.deny`, for every run |
| `@coercions` | expected `RunResult.coercions` of the nearest preceding `@run`, as lines `word slot from to` |
| `@warnings` | expected diagnostic codes (`W_REDEFINED`, `W_SHADOW`), one per line, in order, of the nearest preceding `@unit` |
| `@break` | `<qname>` or `<qname> <ip>`: add a breakpoint to every run |
| `@hook` | `record` (the harness records every breakpoint hit) or `stop` (the hook returns `"stop"` at the first hit) |
| `@hits` | the recorded breakpoint hits, one line `<word> <ip> <op>` each |
| `@hash-eq` / `@hash-ne` | one line `<qname> <qname>`: the two words' `meta.hash` values must be equal / different |
| `@meta` | lines `<qname> <path> = <json>`: split at the **first** ` = `; after loading, `runtime.meta(qname)` queried at the JSONPath-like `path` (dotted keys and `[i]` indices) must equal the JSON value |

In `@run`, `@unit` and `@stack-in` text the harness replaces `<<U+XXXX>>` (hex digits) by that code point before use, so invisible characters can be tested. Timing tests (`@limits maxMillis=…`, `@abort`) assert only the error code; the harness allows the error to arrive late by up to 5 s, and the program must not finish normally.

Each test starts with a fresh runtime (empty `user`, `core` only, plus the fixture vocabulary below) unless it says otherwise. Each `@run` is a single `run()` call with the session scope (initially current vocabulary `user`, no imports). `@stack`/`@out` are checked only if present; if neither is present the test only asserts success.

**Fixture primitives** (supplied by the harness: `fx:*` through `RuntimeOptions.primitives`, so they are bound; `fz:twice` through `runtime.registry.define`, so it is registered but **unbound**). Every primitive the harness passes arguments to receives frozen copies and the harness fails the test if a result is identical to an argument.

| word | effect | behaviour | labels |
|---|---|---|---|
| `fx:add-async` | `( a:int b:int -- int )` | returns `Promise.resolve(a + b)` after a macrotask | `+async` |
| `fx:sleep` | `( ms:int -- )` | resolves after `ms` ms | `+async` |
| `fx:now` | `( -- int )` | `Date.now()` | `+time` |
| `fx:throw` | `( -- )` | throws `new Error("kaput")` | |
| `fx:bad-result` | `( -- int )` | returns the JS string `"x"` | |
| `fx:bad-int` | `( -- int )` | returns the JS number `1.5` | |
| `fx:small-big` | `( -- int )` | returns the JS bigint `5n` | |
| `fx:reject` | `( -- )` | returns a promise rejected with `new Error("nope")` | `+async` |
| `fz:twice` | `( n:int -- int )` | returns `n * 2` (registered, unbound) | |

### 16.2 Tests

#### Lexical

```fl-test
# C01 integer addition
@run
1 2 + .
@out
3
```

```fl-test
# C02 line and block comments
@run
1 \ line comment ( not a block )
( block
  comment ) 2 + .
@out
3
```

```fl-test
# C03 number forms, separators, negative
@run
0xff 0b101 + 1_000 + -7 + .
@out
1253
```

```fl-test
# C04 bigint promotion and exact arithmetic
@run
9007199254740993 .
9007199254740991 2 * .
@out
9007199254740993
18014398509481982
```

```fl-test
# C05 floats print with .0 when integral
@run
1.5 2 * .
1e3 .
0.1 0.2 + .
@out
3.0
1000.0
0.30000000000000004
```

```fl-test
# C06 string escapes
@run
"A\x42\u{43}\\\"" .
@out
ABC\"
```

```fl-test
# C07 char literals are ints
@run
'a' 'Z' + .
'\n' .
'\'' .
@out
187
10
39
```

```fl-test
# C08 byte-array literals
@run
#[ de AD 00 ] .
#[ ] len .
@out
#[ de ad 00 ]
0
```

```fl-test
# C09 unterminated string reports the opening quote
@run
1 2
  "abc
@error
E_LEX line=2 col=3
```

```fl-test
# C10 bad byte element
@run
#[ de zz ]
@error
E_LEX line=1 col=7
```

```fl-test
# C11 malformed numbers
@run
12abc
@error
E_LEX line=1 col=1
```

```fl-test
# C12 bad string escape reports the backslash
@run
"a\qb"
@error
E_LEX line=1 col=3
```

```fl-test
# C13 unterminated block comment
@run
1 ( never closed
@error
E_LEX line=1 col=3
```

```fl-test
# C14 brackets must be whitespace-separated
@run
[1 ]
@error
E_LEX line=1 col=1
```

#### Stack, arithmetic, logic

```fl-test
# C15 stack shuffling
@run
1 2 3 rot .s clear
1 2 3 -rot .s clear
1 2 tuck .s clear
1 2 nip .s clear
1 2 2dup .s clear
5 6 depth .s
@out
<3> 2 3 1
<3> 3 1 2
<3> 2 1 2
<1> 2
<4> 1 2 1 2
<3> 5 6 2
```

```fl-test
# C16 underflow on drop
@run
drop
@error
E_STACK_UNDERFLOW
```

```fl-test
# C17 underflow on a primitive
@run
1 +
@error
E_STACK_UNDERFLOW
```

```fl-test
# C18 division, floor semantics
@run
7 2 / .
7 2 div .
-7 2 div .
-7 2 mod .
7 -2 mod .
@out
3.5
3
-4
1
-1
```

```fl-test
# C19 division by zero
@run
1 0 div
@error
E_DIV_ZERO
```

```fl-test
# C20 float division by zero
@run
1.5 0 /
@error
E_DIV_ZERO
```

```fl-test
# C21 bigint power
@run
2 100 pow .
@out
1267650600228229401496703205376
```

```fl-test
# C22 negative exponent
@run
2 -1 pow
@error
E_RANGE
```

```fl-test
# C23 mixed int and float
@run
1 2.5 + .
@out
3.5
```

```fl-test
# C24 arithmetic type error
@run
"a" 1 +
@error
E_TYPE
```

```fl-test
# C25 equality never coerces, except int/num
@run
1 1.0 = .
"a" "a" = .
"a" #[ 61 ] = .
{ 1 2 } { 1 2 } = .
1 2 < .
"b" "a" > .
@out
true
true
false
true
true
true
```

```fl-test
# C26 ordering of mixed kinds
@run
1 "a" <
@error
E_TYPE
```

```fl-test
# C27 bitwise
@run
5 3 band .
5 3 bor .
5 3 bxor .
1 8 shl .
-8 1 shr .
0 bnot .
@out
1
7
6
256
-4
-1
```

```fl-test
# C28 logic is bool-only
@run
true false or .
true false and .
true not .
@out
true
false
false
```

```fl-test
# C29 no truthiness
@run
1 [ 1 ] [ 2 ] if
@error
E_TYPE
```

#### Quotations, lists, combinators

```fl-test
# C30 if, when, unless
@run
3 5 < [ "lt" ] [ "ge" ] if .
1 false [ 2 ] when .s clear
1 false [ 2 ] unless .s
@out
lt
<1> 1
<2> 1 2
```

```fl-test
# C31 list literals evaluate their contents
@run
{ 1 2 + 10 } .
{ } len .
{ { 1 } "a" } .
@out
{ 3 10 }
0
{ { 1 } "a" }
```

```fl-test
# C32 map, each, filter, reduce
@run
{ 1 2 3 } [ 2 * ] map .
0 { 1 2 3 } [ + ] each .
{ 1 2 3 4 } [ 2 mod 0 = ] filter .
{ 1 2 3 4 } 0 [ + ] reduce .
@out
{ 2 4 6 }
6
{ 2 4 }
10
```

```fl-test
# C33 times
@run
3 [ "x" . ] times
@out
x
x
x
```

```fl-test
# C34 while and loop
@run
0 [ dup 3 < ] [ 1 + ] while .
0 [ 1 + dup 5 < ] loop .
@out
3
5
```

```fl-test
# C35 loop bodies must be stack-neutral
@run
3 [ 1 ] times
@error
E_EFFECT
```

```fl-test
# C36 negative times
@run
-1 [ ] times
@error
E_RANGE
```

```fl-test
# C37 call and closures that outlive their word
@unit
: adder ( n:int -- quot ) [ n + ] ;
@run
[ 1 2 + ] call .
5 10 adder call .
@out
3
15
```

```fl-test
# C38 try catches and passes an error record
@run
[ 1 0 div ] [ "code" get ] try .
[ 7 ] [ drop 0 ] try .
[ "boom" fail ] [ "message" get ] try .
@out
E_DIV_ZERO
7
boom
```

```fl-test
# C39 try restores the data stack
@run
1 2 [ 3 4 "x" fail ] [ drop ] try .s
@out
<2> 1 2
```

```fl-test
# C40 an uncaught fail
@run
"boom" fail
@error
E_USER
```

```fl-test
# C41 fork on strings
@run
"a,b,c" "," "-" [ upper ] fork .
@out
A-B-C
```

#### Strings, bytes, conversions, records

```fl-test
# C42 string words
@run
"héllo" str>bytes bytes>hex .
"\u{1F600}" len .
"abc" "xyz" cat .
"hello" 1 3 slice .
"abc" 1 nth .
"abc" rev .
"a,b,c" "," split .
{ "a" "b" } "-" join .
"aBc" upper .
@out
68c3a96c6c6f
1
abcxyz
el
b
cba
{ "a" "b" "c" }
a-b
ABC
```

```fl-test
# C43 bytes and list words
@run
#[ de ad ] #[ be ef ] cat bytes>hex .
#[ 01 02 03 ] 1 nth .
#[ 01 02 03 ] bytes>list .
{ 1 2 } list>bytes .
0 3 range .
{ 1 2 } 3 append .
@out
deadbeef
2
{ 1 2 3 }
#[ 01 02 ]
{ 0 1 2 }
{ 1 2 3 }
```

```fl-test
# C44 list>bytes range error
@run
{ 300 } list>bytes
@error
E_RANGE
```

```fl-test
# C45 bytes to str is strict
@run
#[ ff ] bytes>str
@error
E_COERCE
```

```fl-test
# C46 explicit conversions
@run
"42" str>int .
42 int>str "!" cat .
3 int>num .
3.0 num>int .
3.7 floor .
@out
42
42!
3.0
3
3
```

```fl-test
# C47 str>int parse failure
@run
"x" str>int
@error
E_COERCE
```

```fl-test
# C48 records
@run
{ { "a" 1 } { "b" 2 } } >record keys .
{ { "a" 1 } } >record "a" get .
{ } >record "a" 5 put "a" get .
{ } >record "z" get
@out
{ "a" "b" }
1
5
@error
E_RANGE
```

```fl-test
# C49 type names
@run
1 type . 1.0 type . "a" type . #[ ] type . { } type . [ ] type . true type .
@out
int
num
str
bytes
list
quot
bool
```

#### Definitions

```fl-test
# C50 locals: named inputs are consumed, anonymous inputs stay
@unit
: hyp2 ( a:int b:int -- int ) a a * b b * + ;
: scale ( int k:int -- int ) k * ;
@run
3 4 hyp2 .
6 7 scale .
@out
25
42
```

```fl-test
# C51 recursion and bigint results
@unit
: fact ( n:int -- int ) n 2 < [ 1 ] [ n n 1 - recurse * ] if ;
@run
5 fact .
25 fact .
@out
120
15511210043330985984000000
```

```fl-test
# C52 exit check: a word that leaves the wrong depth
@unit
: bad ( int -- int ) drop ;
@run
5 bad
@error
E_EFFECT word=user:bad
```

```fl-test
# C53 exit check: an extra output
@unit
: bad2 ( -- ) 1 ;
@run
bad2
@error
E_EFFECT
```

```fl-test
# C54 output tags are validated
@unit
: lie ( -- int ) "x" ;
@run
lie
@error
E_TYPE
```

```fl-test
# C55 constants and variables, per-run scope
@unit
42 CONSTANT answer
0 VARIABLE counter
@run
answer .
5 counter! counter .
@out
42
5
```

```fl-test
# C56 variables start fresh in every run
@unit
0 VARIABLE counter
@run
5 counter! counter .
@out
5
@run
counter .
@out
0
```

```fl-test
# C57 variables are not coerced
@unit
0 VARIABLE counter
@run
"x" counter!
@error
E_TYPE
```

```fl-test
# C58 CONSTANT needs a single literal before it
@run
3 4 + CONSTANT seven
@error
E_SYNTAX
```

```fl-test
# C59 choice parameters
@unit
: mode ( str m:choice{enc|dec}=enc -- str ) drop m ;
@run
"x" "enc" mode .
"x" "zzz" mode
@out
enc
@error
E_PARAM_INVALID word=user:mode detail.param=m
```

```fl-test
# C60 private words
@unit
: _add ( a b -- c ) a b + ;
: use ( -- int ) 1 2 _add ;
@run
use .
@out
3
```

```fl-test
# C61 private words are not visible from other vocabularies
@unit
IN: one
: _hidden ( -- int ) 1 ;
@unit
IN: two
: peek ( -- int ) one:_hidden ;
@error
E_PRIVATE
```

#### Parameters, coercion, Gate 1

Tests with an `@use U-rot` section first load the Gate 1 unit of §15.1 (verbatim, untrusted).

```fl-test
# C62 classical:rot, the Gate 1 example
@use U-rot
@run
"Hello, World!" 13 classical:rot bytes>str .
"Uryyb, Jbeyq!" 13 classical:rot bytes>str .
"xyz" 3 classical:rot bytes>str .
"abc" 0 classical:rot bytes>str .
@out
Uryyb, Jbeyq!
Hello, World!
abc
abc
```

```fl-test
# C63 parameter upper bound
@use U-rot
@run
"abc" 26 classical:rot
@error
E_PARAM_INVALID word=classical:rot detail.param=amount
```

```fl-test
# C64 parameter lower bound
@use U-rot
@run
"abc" -1 classical:rot
@error
E_PARAM_INVALID detail.param=amount
```

```fl-test
# C65 num to int coercion, and its failure
@use U-rot
@run
"abc" 1.0 classical:rot bytes>str .
"abc" 13.5 classical:rot
@out
bcd
@error
E_COERCE
```

```fl-test
# C66 no coercion path from str to int
@use U-rot
@run
"abc" "x" classical:rot
@error
E_TYPE
```

```fl-test
# C67 str is coerced to bytes at the word boundary, and recorded
@use U-rot
@run
"He" 1 classical:rot bytes>str .
@out
If
@coercions
classical:rot 0 str bytes
```

```fl-test
# C68 binary input passes through untouched
@use U-rot
@run
#[ ff 41 ] 1 classical:rot .
#[ c3 a9 ] 5 classical:rot bytes>hex .
@out
#[ ff 42 ]
c3a9
```

#### Resolution

```fl-test
# C69 the current vocabulary resolves first; imports shadow core
@use U-rot
@run
1 2 3 rot .s clear
IN: classical "abc" 1 rot bytes>str .
IN: user USING: classical ; "abc" 1 rot bytes>str .
1 2 3 core:rot .s
@out
<3> 2 3 1
bcd
bcd
<3> 2 3 1
```

```fl-test
# C70 ambiguity between imports is a compile error and nothing runs
@unit
IN: alpha
: greet ( -- str ) "alpha" ;
@unit
IN: beta
: greet ( -- str ) "beta" ;
@run
"never printed" .
USING: alpha beta ;
greet .
@error
E_AMBIGUOUS detail.name=greet detail.candidates=alpha:greet,beta:greet
```

```fl-test
# C71 qualification resolves an ambiguity
@unit
IN: alpha
: greet ( -- str ) "alpha" ;
@unit
IN: beta
: greet ( -- str ) "beta" ;
@run
USING: alpha beta ;
alpha:greet .
beta:greet .
@out
alpha
beta
```

```fl-test
# C72 shadowing a core word
@unit
IN: demo
: dup ( int -- int int ) 99 ;
@run
IN: demo 5 dup .s clear
IN: user 5 dup .s clear
5 demo:dup .s clear
5 core:dup .s
@out
<2> 5 99
<2> 5 5
<2> 5 99
<2> 5 5
```

```fl-test
# C73 the current vocabulary beats an import
@unit
IN: lib
: who ( -- str ) "lib" ;
@unit
IN: app
: who ( -- str ) "app" ;
@run
IN: app USING: lib ; who .
@out
app
```

```fl-test
# C74 undefined word
@run
nosuch
@error
E_UNDEFINED detail.name=nosuch
```

```fl-test
# C75 qualified lookup of a missing vocabulary
@run
nosuch:word
@error
E_NO_VOCAB
```

```fl-test
# C76 qualified lookup of a missing word
@run
core:nosuch
@error
E_UNDEFINED
```

```fl-test
# C77 redefinition keeps old references
@unit
: f ( -- int ) 1 ;
: g ( -- int ) f ;
@unit
: f ( -- int ) 2 ;
@warnings
W_REDEFINED
@run
f .
g .
@out
2
1
```

```fl-test
# C78 redefinition within one unit is an error
@unit
: f ( -- int ) 1 ;
: f ( -- int ) 2 ;
@error
E_REDEFINED
```

```fl-test
# C79 no forward references
@unit
: a ( -- int ) b ;
: b ( -- int ) 1 ;
@error
E_UNDEFINED detail.name=b
```

```fl-test
# C80 a word's own name inside its body is the previous binding
@unit
: f ( -- int ) f ;
@error
E_UNDEFINED
```

```fl-test
# C81 console VOCAB, current-vocab, definitions go to the current vocabulary
@run
VOCAB demo
: x ( -- int ) 7 ;
x .
current-vocab .
demo:x .
@out
7
demo
7
```

```fl-test
# C82 VOCAB is console-only
@unit
VOCAB demo
@error
E_SYNTAX
```

```fl-test
# C83 core is read-only
@unit
IN: core
: x ( -- int ) 1 ;
@error
E_READONLY
```

```fl-test
# C84 a unit rejects executable code
@unit
: ok ( -- int ) 1 ;
1 2 +
@error
E_TOPLEVEL
```

```fl-test
# C85 loading is atomic
@unit-fails E_UNDEFINED
: ok ( -- int ) 1 ;
: broken ( -- int ) nosuch ;
@run
ok .
@error
E_UNDEFINED
```

#### Headers and metadata

```fl-test
# C86 header is mandatory
@unit
: f 1 ;
@error
E_HEADER
```

```fl-test
# C87 unknown parameter type
@unit
: f ( int p:wat -- int ) ;
@error
E_HEADER
```

```fl-test
# C88 empty range
@unit
: f ( int p:int[5..1] -- int ) ;
@error
E_HEADER
```

```fl-test
# C89 choice default must be an option
@unit
: f ( int p:choice{a|b}=c -- int ) ;
@error
E_HEADER
```

```fl-test
# C90 public words need named, typed parameters
@unit
: f ( int int -- int ) + ;
@error
E_HEADER
```

```fl-test
# C91 a string default may contain a closing paren
@unit
: f ( str sep:str=" ) " -- str ) ;
@run
"ab" " ) " f .
@out
ab
```

```fl-test
# C92 identity word with only anonymous input
@unit
: ident ( str -- str ) ;
@run
"x" ident .
@out
x
```

```fl-test
# C93 META desugars into the metadata record
@use U-rot
@meta
classical:rot effect.text = "( bytes amount:int[0..25]=13 -- bytes )"
classical:rot params[0].name = "amount"
classical:rot params[0].constraint.min = 0
classical:rot params[0].constraint.max = 25
classical:rot params[0].default = 13
classical:rot params[0].doc = "Shift (13 = ROT13)"
classical:rot aliases = ["rot13"]
classical:rot seeAlso = ["classical:atbash"]
classical:rot category = "Classical ciphers"
classical:rot op = true
classical:rot effects = []
```

```fl-test
# C94 an alias is the same entry
@use U-rot
@run
"abc" 1 classical:rot13 bytes>str .
@out
bcd
```

```fl-test
# C95 help
@use U-rot
@run
"classical:rot" help "\n" split .
@out
{ "classical:rot  ( bytes amount:int[0..25]=13 -- bytes )" "Rotate each ASCII letter by a fixed amount; other bytes pass through." "category: Classical ciphers" "aliases: rot13" "see also: classical:atbash" "parameters:" "  amount:int[0..25]=13  -- Shift (13 = ROT13)" "" }
```

```fl-test
# C96 see returns the source text
@unit
: twice ( int -- int ) 2 * ;
@run
"twice" see "\n" split .
@out
{ ": twice ( int -- int ) 2 * ;" "" }
```

```fl-test
# C97 META for an undefined word
@unit
META: nosuch
;
@error
E_META
```

```fl-test
# C98 a singular metadata field may be set once
@unit
: f ( int -- int ) "one" doc ;
META: f
  doc "two" ;
;
@error
E_META
```

#### Limits, cancellation, primitives

```fl-test
# C99 step limit is not catchable
@limits
maxSteps=1000
@run
[ [ true ] loop ] [ drop ] try
@error
E_LIMIT_STEPS
```

```fl-test
# C100 step limit in a word
@unit
: spin ( -- ) [ true ] loop ;
@limits
maxSteps=1000
@run
spin
@error
E_LIMIT_STEPS word=user:spin
```

```fl-test
# C101 return-stack depth limit (default 10 000)
@unit
: down ( n:int -- ) n 0 > [ n 1 - recurse ] when ;
@run
1000000 down
@error
E_LIMIT_RETURN
```

```fl-test
# C102 data-stack depth limit
@unit
: grow ( -- .. ) 1 recurse ;
@limits
maxDataDepth=100
@run
grow
@error
E_LIMIT_STACK
```

```fl-test
# C103 value size limit
@limits
maxValueBytes=1000
@run
"abcdefgh" 10 [ dup cat ] times
@error
E_LIMIT_VALUE
```

```fl-test
# C104 total allocation limit
@limits
maxTotalBytes=100
@run
"abcdefgh" 10 [ dup cat ] times
@error
E_LIMIT_TOTAL
```

```fl-test
# C105 output limit
@limits
maxOutputBytes=10
@run
"hello world" .
@error
E_LIMIT_OUTPUT
```

```fl-test
# C106 wall-clock limit
@limits
maxMillis=50 maxSteps=1000000000000
@run
[ true ] loop
@error
E_LIMIT_TIME
```

```fl-test
# C107 cooperative cancellation
@limits
maxSteps=1000000000000 maxMillis=60000
@abort
20ms
@run
[ true ] loop
@error
E_ABORTED
```

```fl-test
# C108 integer size limit
@limits
maxIntBits=100
@run
2 200 pow
@error
E_LIMIT_VALUE
```

```fl-test
# C109 async primitive
@run
2 3 fx:add-async .
@out
5
```

```fl-test
# C110 denied effect label
@deny
+time
@run
fx:now
@error
E_FORBIDDEN
```

```fl-test
# C111 a primitive that throws a plain Error
@run
fx:throw
@error
E_PRIMITIVE
```

```fl-test
# C112 a primitive returning the wrong tag
@run
fx:bad-result
@error
E_TYPE detail.where=result
```

```fl-test
# C113 effects labels are inferred through callers
@unit
: stamp ( -- int ) fx:now ;
@meta
user:stamp effects = ["+time"]
```

```fl-test
# C114 PRIMITIVE needs a trusted load
@unit
IN: fx
PRIMITIVE sleep
@error
E_UNTRUSTED
```


#### Additional coverage (C115 and up)

```fl-test
# C115 invisible characters inside a token are rejected
@run
ab<<U+200B>>c
@error
E_LEX line=1 col=3
```

```fl-test
# C116 a word cannot pop below its own frame
@unit
: eat ( -- ) drop ;
@run
1 eat
@error
E_STACK_UNDERFLOW word=user:eat
```

```fl-test
# C117 a try body cannot pop below the stack at try entry
@run
1 [ drop ] [ drop ] try .s
@out
<1> 1
```

```fl-test
# C118 depth and clear are relative to the frame floor
@unit
: d ( -- int ) depth ;
: c ( -- ) clear ;
@run
5 6 d .
1 2 c .s
@out
0
<4> 5 6 1 2
```

```fl-test
# C119 unchecked output (-- ..) versus a fixed output
@unit
: apply ( q:quot -- .. ) q call ;
: apply1 ( q:quot -- ) q call ;
@run
[ 1 2 3 ] apply .s clear
[ 1 ] apply1
@out
<3> 1 2 3
@error
E_EFFECT word=user:apply1
```

```fl-test
# C120 nested closures and one locals array per call
@unit
: nest ( a:int b:int -- quot ) [ [ a b + ] call ] ;
: adder ( n:int -- quot ) [ n + ] ;
@run
3 4 nest call .
1 adder 2 adder 10 swap call . 10 swap call .
@out
7
12
11
```

```fl-test
# C121 quotations made by console code
@run
5 [ dup * ] call .
@out
25
```

```fl-test
# C122 a bool token is not a valid word name
@unit
: true ( -- int ) 1 ;
@error
E_NAME
```

```fl-test
# C123 reserved words cannot be constants
@unit
3 CONSTANT recurse
@error
E_NAME
```

```fl-test
# C124 invalid vocabulary name
@unit
IN: bad.name
@error
E_NAME
```

```fl-test
# C125 a qualified name cannot be defined
@unit
: a:b ( -- int ) 1 ;
@error
E_NAME
```

```fl-test
# C126 recurse outside a definition
@run
recurse
@error
E_SYNTAX
```

```fl-test
# C127 PRIMITIVE for a primitive that is not registered
@unit
IN: fz
PRIMITIVE nosuch
@trusted
@error
E_NO_PRIMITIVE
```

```fl-test
# C128 a trusted unit binds a registered, unbound primitive
@unit
IN: fz
PRIMITIVE twice
@trusted
@run
4 fz:twice .
@out
8
```

```fl-test
# C129 an unbound primitive is not visible
@run
4 fz:twice
@error
E_NO_VOCAB
```

```fl-test
# C130 a shared variable store persists across runs
@unit
0 VARIABLE counter
@vars shared
@run
5 counter!
@run
counter .
@out
5
```

```fl-test
# C131 initial stack via RunOptions.stack
@stack-in
7 "x"
@run
.s
@out
<2> 7 "x"
```

```fl-test
# C132 breakpoint hit on word entry
@unit
: f ( int -- int ) 1 + ;
@break user:f
@hook record
@run
1 f .
@out
2
@hits
user:f 0 lit
```

```fl-test
# C133 the hook can stop a run
@unit
: f ( int -- int ) 1 + ;
@break user:f
@hook stop
@run
1 f
@error
E_ABORTED
```

```fl-test
# C134 int has no negative zero
@run
0 neg int>num .
0 neg 0 = .
@out
0.0
true
```

```fl-test
# C135 a denied effect is not catchable
@deny
+time
@run
[ fx:now ] [ drop ] try
@error
E_FORBIDDEN
```

```fl-test
# C136 try inside a word restores that word's stack
@unit
: safe-div ( a:int b:int -- int ) [ a b div ] [ drop 0 ] try ;
@run
10 2 safe-div .
10 0 safe-div .
@out
5
0
```

```fl-test
# C137 fork on bytes
@run
#[ 61 2c 62 ] "," "-" [ ] fork bytes>str .
@out
a-b
```

```fl-test
# C138 empty and trailing pieces
@run
"" "," "-" [ ] fork len .
"a," "," "-" [ ] fork .
"" "," split .
"a," "," split .
@out
0
a-
{ "" }
{ "a" "" }
```

```fl-test
# C139 fork coerces separators and piece results to the data's tag
@run
"a,b" "," "-" [ str>bytes ] fork .
"a,b" #[ 2c ] "-" [ ] fork .
@out
a-b
a-b
```

```fl-test
# C140 sequence combinators on bytes and str
@run
#[ 01 02 03 ] [ 1 + ] map .
"abc" [ 1 + ] map .
#[ 00 00 00 ] [ nip ] mapi .
#[ 01 02 03 04 ] [ 1 band 0 = ] filter .
#[ 01 02 03 ] 0 [ + ] reduce .
"ab" 0 [ + ] reduce .
0 #[ 01 02 03 ] [ + ] each .
@out
#[ 02 03 04 ]
bcd
#[ 00 01 02 ]
#[ 02 04 ]
6
195
6
```

```fl-test
# C141 map over bytes must produce bytes values
@run
#[ 01 ] [ 300 + ] map
@error
E_RANGE
```

```fl-test
# C142 map over bytes with a non-int result
@run
#[ 01 ] [ drop "x" ] map
@error
E_TYPE
```

```fl-test
# C143 latin1 bridge
@run
"é" str>bytes bytes>latin1 len .
"é" latin1>bytes bytes>hex .
@out
2
e9
```

```fl-test
# C144 latin1 rejects code points above U+00FF
@run
"€" latin1>bytes
@error
E_RANGE
```

```fl-test
# C145 bxor with a repeating key
@run
#[ 01 02 03 04 ] #[ ff 0f ] bxor bytes>hex .
@out
fe0dfc0b
```

```fl-test
# C146 bxor with an empty key
@run
#[ 01 ] #[ ] bxor
@error
E_RANGE
```

```fl-test
# C147 translate
@run
#[ 00 01 ff ] 0 256 range [ 255 swap - ] map list>bytes translate bytes>hex .
@out
fffe00
```

```fl-test
# C148 translate needs a 256-byte table
@run
#[ 00 ] #[ 01 ] translate
@error
E_PARAM_INVALID detail.param=table
```

```fl-test
# C149 bjoin and zip
@run
{ #[ 01 ] #[ 02 03 ] } #[ ff ] bjoin bytes>hex .
{ 1 2 3 } { "a" "b" } zip .
@out
01ff0203
{ { 1 "a" } { 2 "b" } }
```

```fl-test
# C150 gcd, invmod, powmod
@run
12 18 gcd .
-12 18 gcd .
0 0 gcd .
3 11 invmod .
2 10 1000 powmod .
4 13 497 powmod .
@out
6
6
0
4
24
445
```

```fl-test
# C151 no modular inverse
@run
4 6 invmod
@error
E_RANGE
```

```fl-test
# C152 sqrt, ceil, round
@run
16 sqrt .
2.5 ceil .
2.5 round .
-2.5 round .
-2.5 ceil .
2.4 round .
@out
4.0
3
3
-3
-2
2
```

```fl-test
# C153 radix conversion
@run
255 16 int>str-radix .
-255 2 int>str-radix .
"FF" 16 str>int-radix .
"zz" 36 str>int-radix .
@out
ff
-11111111
255
1295
```

```fl-test
# C154 radix parse failure
@run
"12" 2 str>int-radix
@error
E_COERCE
```

```fl-test
# C155 radix out of range
@run
5 1 int>str-radix
@error
E_RANGE
```

```fl-test
# C156 exact big arithmetic and mixed comparison
@run
9007199254740993 3 div .
9007199254740993 2 div .
9007199254740993 9007199254740992.0 > .
9007199254740992 9007199254740992.0 = .
@out
3002399751580331
4503599627370496
true
true
```

```fl-test
# C157 shift obeys maxIntBits
@limits
maxIntBits=100
@run
1 200 shl
@error
E_LIMIT_VALUE
```

```fl-test
# C158 an oversize integer literal
@limits
maxIntBits=64
@run
0x1_0000_0000_0000_0000 .
@error
E_LIMIT_VALUE line=1 col=1
```

```fl-test
# C159 a literal of exactly maxIntBits bits is fine
@limits
maxIntBits=64
@run
0xffff_ffff_ffff_ffff .
@out
18446744073709551615
```

```fl-test
# C160 primitive results are normalised and checked
@run
fx:small-big 5 = .
fx:small-big 4 + .
fx:bad-int
@out
true
9
@error
E_TYPE detail.where=result
```

```fl-test
# C161 a rejected promise is a catchable E_PRIMITIVE
@run
[ fx:reject ] [ "code" get ] try .
fx:reject
@out
E_PRIMITIVE
@error
E_PRIMITIVE
```

```fl-test
# C162 the error record carries detail
@run
[ drop ] [ "detail" get "needed" get ] try .
@out
1
```

```fl-test
# C163 the handler is not protected by its own try
@run
[ 1 0 div ] [ drop "x" fail ] try
@error
E_USER
```

```fl-test
# C164 a local that shadows a visible word warns
@unit
: f ( len:int -- int ) len ;
@warnings
W_SHADOW
```

```fl-test
# C165 choice options may be quoted and contain spaces
@unit
: casing ( str m:choice{"Upper case"|"Lower case"}="Upper case" -- str ) drop m ;
@meta
user:casing params[0].options = ["Upper case","Lower case"]
user:casing params[0].default = "Upper case"
@run
"x" "Lower case" casing .
"x" "Other" casing
@out
Lower case
@error
E_PARAM_INVALID detail.param=m
```

```fl-test
# C166 key values are redacted in diagnostics
@unit
: usekey ( bytes k:key{hex}[4] -- bytes ) k bxor ;
@run
"abcd" #[ 01 01 01 01 ] usekey bytes>hex .
@out
60636265
@run
"data" #[ 01 02 ] usekey
@error
E_PARAM_INVALID detail.param=k detail.value=<redacted>
```

```fl-test
# C167 a failed console compile leaves the session scope unchanged
@run
IN: demo nosuch
@error
E_UNDEFINED
@run
current-vocab .
@out
user
```

```fl-test
# C168 source length limit
@limits
maxSourceChars=5
@run
1 2 3 4 5 6
@error
E_LIMIT_SOURCE
```

```fl-test
# C169 a word's hash covers its callees
@unit
IN: v1
: base ( -- int ) 1 ;
: top ( -- int ) base ;
@unit
IN: v2
: base ( -- int ) 2 ;
: top ( -- int ) base ;
@hash-ne
v1:top v2:top
```

```fl-test
# C170 an alias shares its target's hash
@use U-rot
@hash-eq
classical:rot classical:rot13
```

```fl-test
# C171 META: with an unknown clause
@unit
: f ( int -- int ) ;
META: f
  bogus x ;
;
@error
E_META
```

SHA-256 known answers for `sha256.ts` (unit tests, not `fl-test` blocks): `sha256("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; `sha256("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.

---

## 17. Design decisions

Decisions the plan did not fix. Each is final for v0.1.

| # | Decision | Rationale |
|---|---|---|
| D1 | Block comment is `( … )`; the header is the `(` directly after `: name`; line comment `\`. | Forth-compatible, needs 2 tokens of reader lookbehind and no new syntax. |
| D2 | Word names cannot contain `:`; qualified names have exactly one `:`. | Removes every ambiguity between `vocab:word`, `name:type`, `IN:` and `:`. |
| D3 | Every colon definition has a mandatory header; public words use strict header rules, private (`_x`) words and primitives lenient. **This deliberately strengthens PLAN §3.2**, which makes the header mandatory only on exported words. | One uniform rule for the compiler and reader; keeps ops fully described while allowing free-form helpers. |
| D4 | `CONSTANT`/`VARIABLE` take exactly one preceding literal. | No compile-time evaluation engine needed; identical in units and console. |
| D5 | Redefinition allowed across units and at the console with old references bound early; an error within one unit. | Forth semantics for the REPL, but catches copy-paste mistakes in files. |
| D6 | No forward references and no mutual recursion; `recurse` for self-calls; no TCO. | Keeps the compiler single-pass and the return-stack limit meaningful. |
| D7 | No `IF ELSE THEN` / `DO LOOP`; combinators only. | One control-flow model that also covers recipes and the lowering rules. |
| D8 | No user-defined parsing or immediate words. | Keeps the reader context-free except the header rule, and untrusted code unable to change parsing. |
| D9 | No truthiness; `bool` only. | Avoids `0`/`""` surprises in a language for data transformation. |
| D10 | List literal `{ … }` exists and evaluates its contents; there is no record literal. | Needed to build data in tests and recipes; records come from `>record` or primitives. |
| D11 | Char literal produces an `int` (code point); no `char` tag. | Keeps the value model to the nine PLAN tags. |
| D12 | `true`/`false` are reader literals. | Defaults in headers and recipes need them; cannot be shadowed. |
| D13 | Coercion applies to inputs only; outputs are validated, not coerced. | A word's output type is a promise the word must keep. |
| D14 | Named inputs are consumed into locals; anonymous inputs stay on the stack. | Matches the `rot` example (`str` flows through, `amount` is local). |
| D15 | Defaults are metadata; the VM never supplies missing arguments. | Keeps the VM simple and the recipe compiler explicit. |
| D16 | `toggle`/`key` parameters receive decoded `bytes`; the listed encodings are UI metadata. | One stack slot per parameter; the recipe layer owns text-to-bytes. |
| D17 | Stack effects are enforced at runtime on word exit (`E_EFFECT`); `-- ..` opts out of the output check. | Containment without a static checker; combinators stay expressible. |
| D18 | Loop bodies must be stack-neutral per iteration. | Makes loops analysable and error messages local. |
| D19 | `try` takes body and handler quotations; `E_ABORTED`, all `E_LIMIT_*`, `E_FORBIDDEN` and `E_INTERNAL` are uncatchable; the handler gets an error record (including `detail`) and is itself unprotected. | Untrusted code cannot swallow resource limits or policy denials. |
| D20 | `help`/`see`/`words` return strings; only `.` and `.s` write output. | One output channel; the REPL decides what to print. |
| D21 | `META:` ends with an empty clause `;`; `doc`/`category` also work as leading `"…" doc` declarations. | Matches the PLAN example while giving a single canonical metadata path. |
| D22 | A `PRIMITIVE name` form binds to the registry entry `<current-vocab>:name`; no header repeated in FL. | One source of truth for a primitive's signature. |
| D23 | `load()` is synchronous and atomic via `DictionaryTxn`; `hash` is a transitive SHA-256 (own text plus callee hashes) from an in-repo implementation. | Content-addressed identity that survives callee edits, with no async hashing and no dependency. |
| D24 | Limits: 10 M steps, 100 k data, 10 k return, 64 MiB / value, 1 GiB cumulative, 64 Kib ints, 30 s, 1 MiB output. | Safe in a Worker; each is overridable per run. |
| D25 | Total-bytes limit is a cumulative allocation meter. | Cheap and deterministic, unlike tracking live size. |
| D26 | Cancellation: poll every 1024 steps; yield to the event loop every 131 072 steps; optional `Int32Array` abort flag. | `AbortSignal` cannot fire in a synchronous loop; PLAN §10 plans `SharedArrayBuffer` cancellation. |
| D27 | Source positions are UTF-16 based; line/col 1-based. | Match JS string indexing; cheap to compute. |
| D28 | Core's `rot` keeps its Forth name and `classical:rot` shadows it in `classical`. | Names are final in the PLAN; the clash is the canonical shadowing example. |
| D29 | `/` is float division; `div`/`mod` are floor and `int` only. | Predictable with ciphers; no implicit `int`-to-float surprises. |
| D30 | Strings compare, index and measure by **code point**. | Matches user expectation; `\u{…}` and `len` agree. |
| D31 | Variables are `n` / `n!` word pairs, type-fixed by the initial literal. | No `ref` tag or `@`/`!` needed. |
| D32 | Console segments share one stack; definitions are staged first. | Predictable `: f … ; f` on one line. |
| D33 | Hash covers the verbatim source text of the definition only. | Identity of code, not documentation. |
| D34 | `breakpoints` are `{word, ip?}`; the debugger maps lines to `ip` using `positions`. | Keeps VM hooks independent of the recipe layer. |
| D35 | `fork` is a `core` intrinsic over `str`/`bytes`. | PLAN §3.6 compiles recipe forks to it. |
| D36 | A frame floor: a word cannot pop below its own `base`, nor a `try` body below the stack at `try` entry; `depth`/`clear` are floor-relative. | Contains a buggy word's damage to its own frame; makes `E_EFFECT` reliable. |
| D37 | Classical-cipher words take and return `bytes` and touch only ASCII letters. | Binary-safe by construction; text enters through the documented `str`→`bytes` coercion. |
| D38 | `each map mapi filter reduce` accept `list`, `bytes` (elements are ints 0..255) and `str` (elements are code-point ints). | Byte-level ciphers need no list round trip. |
| D39 | `bxor` is polymorphic: two ints (bitwise) or two bytes (repeating-key xor). | One name for the xor everybody expects; int and byte forms cannot be confused (no coercion). |
| D40 | Lowered loops emit `dmark`/`dcheck` so that they check depth exactly like intrinsic loops. | Lowering is unobservable except for step counts. |
| D41 | `fork` pieces follow `split` rules (empty input is one empty piece; trailing separator a trailing empty piece); separator, joiner and results are coerced to the data's tag. | Round-trips (`split` then `join`) are lossless. |
| D42 | `key`-typed values are marked secret and rendered `<redacted>` in diagnostics. | Keys do not leak into logs, traces or shared error reports. |
| D43 | Sync SHA-256 in-repo; the hash covers callees transitively; intrinsics/primitives hash name, effect and version. | A recipe pinned to a hash detects drift anywhere below it. |
| D44 | Primitives must be pure with respect to their arguments (no mutation, no aliased results); the harness enforces it. | Values are shared structurally by the VM. |
| D45 | `W_SHADOW` warns when a local hides a visible word. | Locals shadow words silently otherwise. |
| D46 | An oversize integer literal is `E_LIMIT_VALUE`, raised by the reader. | One code for every over-`maxIntBits` integer. |
| D47 | Console compile errors roll back scope changes; each console segment records its scope. | An erroring line has no effect; `current-vocab` is predictable mid-line. |
| D48 | Unicode Zs/Zl/Zp/Cf characters in a token are `E_LEX`. | No invisible look-alike separators or name characters. |

### 17.1 Items deliberately left out of v0.1

Forward declarations and mutual recursion, `ALSO`/`ONLY`/`PREVIOUS`, user parsing words, tail calls, mutable locals, a record literal, a `file` constructor, floating-point transcendental functions, `exit`/early return, a `checks` clause for Magic (Phase 6), per-word unit tests in `META`.
