# Forge core language: prior art and design options

Status: research notes. Items marked (verified) were checked against the linked page on 2026-11-09. Items marked (from memory) are well-known but were not re-checked, so confirm them before depending on them.

## 1. Forth wordlists and the search order

Source: [Forth-2012 Search-Order word set](https://forth-standard.org/standard/search) (verified).

A **wordlist** is an unordered name-to-definition table. Two global pieces of state decide what a name means:

- The **search order**: a stack of wordlist ids. Lookup (`FIND`, and the text interpreter) tries each list from the top down and uses the first hit.
- The **compilation wordlist** (`GET-CURRENT` / `SET-CURRENT`): the list that new definitions go into.

The words:

| Word | Set | Effect |
|---|---|---|
| `WORDLIST` | core | make a new empty list and return its id |
| `GET-ORDER` / `SET-ORDER` | core | read or replace the whole search order |
| `DEFINITIONS` | core | make the top of the search order the compilation list |
| `SEARCH-WORDLIST` | core | look one name up in one specific list |
| `FORTH-WORDLIST`, `GET-CURRENT`, `SET-CURRENT`, `FIND` | core | as the names suggest |
| `ALSO` | extension | duplicate the top of the search order |
| `ONLY` | extension | reset the order to a minimal default set |
| `PREVIOUS` | extension | pop the top of the order |
| `FORTH`, `ORDER` | extension | put the Forth list on top, or print the order |

`VOCABULARY` is not in the standard set. It is a common system word, a named wordlist that replaces the top of the order when invoked (from memory). The usual idiom is `ALSO crypto DEFINITIONS`, then `PREVIOUS DEFINITIONS` to undo it.

**Problems for Forge.** The search order is mutable global state. The meaning of a source file depends on whatever order was active when it was read. There is no qualified lookup in standard Forth, so a name in a hidden list can be reached only by editing the order. Shadowing is silent. None of that suits shared recipes.

**What to borrow.** Keep the data structure, a wordlist per vocabulary, and make resolution lexical and per-compilation-unit.

- Each module header declares what it imports: `USING: crypto encoding ;`.
- A qualified token `crypto:xor` resolves through one vocabulary and never consults the order.
- An unqualified name searches the module's own vocabulary first, then its imports in declared order. If two imports supply the same name, it is a compile error ("ambiguous: xor in crypto, bitwise"), not a silent pick.
- `:` is the vocabulary separator, matching the `crypto:xor` form in the brief. The alternative, `::`, avoids clashing with the Forth `:` definer, but the tokenizer can tell them apart: `:` followed by whitespace is a definition, while `:` inside a token is a separator.
- Keep a `forge.core` vocabulary that is always visible, equivalent to `ONLY FORTH`.
- Skip `ALSO`, `PREVIOUS` and `ONLY` entirely. Expose `GET-ORDER` only as a reflection call for tooling.

Factor's loader works along these lines. I could not confirm the exact Factor semantics of `USING:`, `IN:` and `QUALIFIED:` from the doc pages I fetched. The [vocabularies page](https://docs.factorcode.org/content/article-vocabularies.html) (verified) only says vocabularies are named collections of words held in one global dictionary, with specifiers by name, object or link. From memory: `IN:` sets the current vocabulary, `USING:` lists imports, and Factor reports ambiguity at parse time. That matches the proposal above.

## 2. Prior art

### Factor
- Stack effects are mandatory on `:` definitions: `( x y -- z )`, top at right. Quotation parameters carry nested effects (`pred: ( ..a -- ..b ? )`), and `..a` is a row variable. Names in effects are documentation only. For non-inline words the compiler checks only input and output counts. See [stack effects](https://docs.factorcode.org/content/article-effects.html) (verified).
- Built-in documentation attaches to words and is searchable and cross-referenced ([help system](https://docs.factorcode.org/content/article-help.html), verified). The detailed `HELP:` mechanics are from memory. Docs live next to the code but as separate declarations, not inside the definition.
- Quotations `[ ... ]` are first-class and used for control flow (`each`, `if`).
- Lesson: the declared-effect-with-names idea is exactly what Forge needs for parameters. Factor treats the names as comments, and Forge can make them meaningful.

### Joy and Cat
- Joy is purely functional and concatenative. Programs are lists, and a quotation is a data list that can be run. Cat adds static type inference for stack effects (from memory). Lesson: quotations as plain data make a recipe trivially serialisable, and inferred effects let the UI check that op N's output type fits op N+1's input.

### Kitten
- [kittenlang.org](https://kittenlang.org/) (verified): concatenative, statically typed with Hindley-Milner inference, with a permission/effect system (`+IO`). Lesson: tracking an effect label such as `+async` or `+random` on words is cheap. Forge could use it to mark words that need WebCrypto or randomness, which matters for determinism and sandboxing.

### PostScript
From memory. Stack values are typed objects (integer, real, string, array, name, dict, procedure). There is a **dictionary stack**, and names resolve through it at run time. `{ ... }` is an executable array (a quotation). Errors are named (`stackunderflow`, `typecheck`) and dispatched through `errordict`. Lesson: typed runtime values and named errors give clear failures, and a dictionary stack is a dynamic cousin of the search order. Avoid dynamic scoping in Forge.

### Retro Forth and jonesforth
From memory. Retro is a minimalist Forth with quotations and a small VM image. jonesforth is an educational x86 Forth using indirect threaded code with a classic linked dictionary. Dictionary entries hold a name, flags (immediate, hidden) and a code pointer. Lesson: a minimal bootstrap kernel plus most words defined in the language works well, and the flags-on-entry model is a natural home for extra metadata.

### Forth in JS/TS
- [WAForth](https://github.com/remko/waforth) (verified): the interpreter and compiler are hand-written WebAssembly. It generates Wasm modules on the fly, calls compiled words through indirect calls, and emits debug info so words can be stepped. JS interop is via `bind` (synchronous function popping and pushing the stack, with helpers like `popString`) and `bindAsync` (takes an execution token called back when the promise settles). Size is about 14 KB. Lesson: the async bridge is a real, tested precedent. But a Wasm core costs a lot in debuggability and typed values, and Forge's cells are not integers.
- [thi-ng/charlie](https://github.com/thi-ng/charlie) is a TypeScript Forth-like VM with a REPL (listed by search, not inspected). [Forthic](https://www.npmjs.com/package/@forthic/interp) (LinkedIn, now at forthix/forthic-ts) is a Forth-inspired TypeScript interpreter built around data-pipeline "modules" (search snippet only, not inspected). Forthic's module idea is the closest match to Forge's problem and is worth reading before implementing. I did not find a mature TS Forth with typed values and metadata, so Forge will largely be bespoke.

## 3. Design options and recommendations

### a. Value model

Options: raw cells (classic Forth) versus tagged values.

**Recommend tagged values.** A stack slot is a discriminated union:
`bytes (Uint8Array) | string | number | bigint | bool | list | quote | record`.

CyberChef's central abstraction is that data flows as bytes and ops are lenient about it. Reproduce that with explicit rules instead of implicit magic:

- **Bytes is the canonical interchange type.** A string is a UTF-8 view of bytes. An op declares input and output types in its effect (`bytes -- bytes`, `str -- str`).
- The runtime owns a small **coercion table**, applied only at word boundaries where the declared input type differs from the actual top of stack. Examples: `str -> bytes` (UTF-8 encode), `bytes -> str` (UTF-8 decode, with a replacement-character policy), `number -> bigint`, `list<byte-ish> -> bytes`. Anything else is a type error.
- Make coercions visible. A recipe's trace records "coerced str to bytes before XOR", and the UI can show a small badge. Make lossy ones (`bytes -> str` on invalid UTF-8) configurable per recipe, with a strict default.
- Bytes are immutable by convention. Copy-on-write avoids defensive copies, and large inputs can be transferred to Workers.
- Add a `record` (string-keyed map) for structured outputs and for parameter bags. This is a small cost and pays off for later features.

### b. Execution

Options: tree-walking over tokens, compiled closures, bytecode VM.

**Recommend a compact bytecode or flat-instruction VM with an explicit data stack and return stack.** The reasons are the requirements:

- **Step and breakpoint debugging** needs a program counter you can pause on. Closures hide that state in the JS call stack.
- **Cancellation and resource limits** (max steps, stack depth, max output size, wall clock) are a counter check in the dispatch loop.
- **Async words** (WebCrypto, `fetch`-free ops only) work in a VM by letting a primitive return a Promise. The run loop awaits it and resumes, so the whole VM state is plain data. A closure compiler would need async everywhere or colored functions.
- **Worker execution**: the VM state is serialisable and message-passing is simple.

A tree-walker is fastest to build and fine for a first prototype. Closures are faster but lose all the above. Because CyberChef-style workloads are dominated by a few heavy primitives over large buffers, VM dispatch overhead is irrelevant. The primitive does the work.

Concrete shape: a `run(program, state, {maxSteps, signal})` loop that yields to the event loop every N steps (or on each async primitive) and checks an `AbortSignal`. Run it in a dedicated Worker, and terminate the Worker as the hard backstop for runaway primitives such as a pathological regex or a huge allocation.

### c. Parameter metadata

Three sketches. Illustrative syntax, not a spec.

**1. Factor-style header with typed, defaulted, constrained parameters.**
```
: rot13 ( str  amount:int[1..25]=13  -- str )
  "Rotate letters by a fixed amount." doc
  "Encoding" category
  ... ;
```
Pros: one place, close to Factor's quotation-parameter syntax, and the signature doubles as the stack effect. Cons: the header grammar grows. Choices, help per parameter and validation messages crowd it.

**2. Separate metadata block after the signature.**
```
: rot13 ( str -- str )
  META{
    category: "Encoding"
    description: "Rotate letters by a fixed amount."
    param amount { type: int  min: 1  max: 25  default: 13  help: "Shift" }
    param mode   { type: choice  options: ["encode","decode"]  default: "encode" }
  }
  amount @ ... ;
```
Pros: extensible, easy to serialise to JSON, and room for help text. Cons: more verbose. The parameters appear in the body as named bindings, which is a decision to make explicitly.

**3. TypeScript-side metadata with a bare word body.**
```ts
defineOp({ name: "rot13", vocab: "crypto",
  params: [{ name: "amount", type: "int", min: 1, max: 25, default: 13 }],
  in: "str", out: "str", category: "Encoding", help: "..." })
```
```
: rot13 ( str amount -- str ) ... ;
```
Pros: type-checked in TS and trivial UI generation. Cons: the metadata and the word can drift, and user-defined ops cannot carry metadata unless they also go through TS.

**Recommendation: sketch 1 for the common case, desugaring into sketch 2's data.** The parser turns the header into a metadata record (`{params, in, out}`) stored on the word entry. A trailing optional `META{ ... }` block adds category, help, choices and per-parameter docs. Stored metadata is plain JSON, so the TS-side registry (sketch 3) and the language are two views of the same record. Parameters become ordinary stack inputs in the body, in declaration order. A recipe supplies them by pushing literals before the call, with no hidden binding machinery.

### d. Primitives versus language words

**Recommend a thin TS kernel and everything else in the language.**

- TS primitives: stack and control words, arithmetic, byte buffer operations, and the heavy codecs and ciphers (Base64, hashing, AES via WebCrypto, compression). These are where performance and correctness matter.
- Language words: composition, wrappers that set defaults, aliases, recipes, and simple transformations.
- FFI boundary: a primitive is registered as `{name, vocab, effect, fn(args) -> results | Promise<results>}`. The runtime pops the declared inputs, applies the coercion table, calls `fn` with typed JS values, validates outputs, and pushes them. A primitive never touches the stack directly, so a stack-discipline bug cannot corrupt the VM, and it is easy to unit-test as a pure function. This is a stricter version of WAForth's `bind` / `bindAsync` ([README](https://github.com/remko/waforth)).
- Every op in the UI is then either a primitive or a language word, with identical metadata.

### e. Recipes as words

A recipe is a list of steps `(opRef, params)`. Compile it to a word by emitting, per step, the literals for bound parameters followed by the op call:

```
: my-recipe ( bytes -- bytes )
  "base64" "alphabet" 'standard' crypto:from-base64
  13 text:rot13 ;
```

**Round-trip requirement.** Don't parse arbitrary source back into a pipeline. Make the canonical form a **restricted subset** that the UI can always regenerate and read back:

- Canonical recipe source is a sequence of `<literal>* <qualified-word>` steps, with no control flow, produced only by the serialiser.
- Alongside the source, store the recipe as JSON: `{version, steps:[{op:"crypto:from-base64", params:{...}, disabled?:bool}]}`. The word is derived from the JSON by compiling, and the UI edits only the JSON. Hand-written words that fall outside the subset still run and appear in the UI as a single opaque "custom word" step.
- Always store fully qualified names plus a content-hash or version for each referenced op, so a recipe does not change meaning when a vocabulary updates.
- Include "breakpoint" and "disable" flags in the step data, and make "disable" compile to omission.

Sharing a recipe is then a short JSON document (or its URL-fragment encoding), which is the thing the security model below has to treat as untrusted.

### f. Security of loading shared code

Threats: infinite loops, memory exhaustion, access to the page, exfiltration, and crafted metadata (XSS via help text).

- **No ambient capability in the language.** There is no eval, DOM access, `fetch` or storage word. The only way out is the registered primitive table, and shared code can call only what is registered.
- **Run in a Worker** with no DOM, hold the capability table inside, and `terminate()` on timeout. For stronger isolation, serve the Worker from a sandboxed iframe or a separate origin with a restrictive CSP (`default-src 'none'`, no `connect-src`), which also blocks network exfiltration from the Worker (the CSP part is from memory; verify against current browser behaviour).
- **Resource limits** enforced in the VM loop: max steps, max stack and return-stack depth, max recursion, max bytes per value and in total, and a wall-clock deadline. Reject over-limit with a named error.
- **Treat metadata as data.** Render help text and names as text (or sanitised Markdown), never as HTML. Validate parameter definitions against a schema before showing a form, and bound regex-shaped validators.
- **Trust levels.** Built-in vocabularies are trusted. A recipe from a URL can reference only existing registered ops and cannot define new primitives. Loading a user vocabulary containing new language words is allowed, because words cannot exceed the capabilities of the primitives they call. Show the user what a shared recipe imports before running it.
- **Determinism option**: forbid `+random`/`+time`-style effect-labelled words in a "reproducible" mode (Kitten-like effect labels, above).

## 4. Summary of recommendations

1. Vocabulary = wordlist, but resolution is per-module and lexical: `USING:` imports, qualified `vocab:word` tokens, ambiguity is an error, no `ALSO`/`ONLY`/`PREVIOUS`.
2. Tagged stack values with bytes as the canonical type and a small, visible, strict-by-default coercion table.
3. A bytecode VM with explicit stacks, step counting and an AbortSignal, running in a Worker, with async primitives returning Promises.
4. Factor-style typed header with defaults and ranges, desugared to a JSON metadata record, with an optional `META{}` block for the rest.
5. A thin TS kernel for heavy primitives, called through a typed registry that pops, coerces and validates around the function.
6. Recipes stored as JSON of qualified op steps, compiled to a word, with a restricted canonical subset so the UI round-trips.
7. Capability-by-registry, Worker isolation, hard resource limits, and metadata treated as untrusted text.

## Sources
- [Forth-2012 search-order word set](https://forth-standard.org/standard/search)
- [Factor: vocabularies](https://docs.factorcode.org/content/article-vocabularies.html), [stack effects](https://docs.factorcode.org/content/article-effects.html), [help system](https://docs.factorcode.org/content/article-help.html)
- [Kitten](https://kittenlang.org/)
- [WAForth](https://github.com/remko/waforth)
- [thi-ng/charlie](https://github.com/thi-ng/charlie), [Forthic (npm)](https://www.npmjs.com/package/@forthic/interp)
- Not fetched, from memory: Joy, Cat, PostScript Language Reference, Retro Forth, jonesforth.
