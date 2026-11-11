\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ yara: YARA Rules (CyberChef's op), a documented subset of YARA 4 run by Forge's own engine (no libyara,
\ no WASM). The rule parser, the string matchers (text with modifiers, hex strings, regular expressions
\ through the regex seam) and the condition evaluator are one private primitive (src/prims/yara.ts, with
\ the reason there: a bare FL loop costs 5.5 VM steps a character before any state). The options and the
\ report layout are FL. The subset is listed in the README ("YARA Rules (WP 5.58)"); anything outside it
\ is E_COERCE with the line and column of the rules.
IN: yara

\ ` [key: value, key: value]` or nothing.
: _meta-text ( meta:list -- str )
  meta len 0 = [ "" ] [
    " [" meta [ dup "key" get ": " cat swap "value" get cat ] map ", " join cat "]" cat
  ] if ;

\ One match line: "    Pos 12, length 5, data: "abc"" with the parts that are switched on.
: _match-line ( m:record lengths:bool strings:bool -- str )
  "    Pos " m "offset" get int>str cat
  lengths [ ", length " cat m "length" get int>str cat ] when
  strings [ ", data: \"" cat m "text" get cat "\"" cat ] when
  "\n" cat ;

\ The pattern block of one string: its header and, with strings or lengths, one line per match.
: _pattern ( s:record counts:bool lengths:bool strings:bool -- str )
  "  Pattern " s "id" get cat
  counts [ ", count: " cat s "count" get int>str cat ] when
  "\n" cat
  strings lengths or [
    s "matches" get [ lengths strings _match-line ] map "" join cat
  ] when ;

\ The report of one matching rule.
: _rule ( r:record strings:bool lengths:bool metadata:bool counts:bool -- str )
  "Input matches rule \"" r "name" get cat "\"" cat
  metadata [ r "meta" get _meta-text cat ] when
  ".\n" cat
  strings lengths or counts or [
    r "strings" get [ counts lengths strings _pattern ] map "" join cat
  ] when ;

: scan ( data:bytes rules:str="" show-strings:bool=false show-string-lengths:bool=false show-metadata:bool=false show-counts:bool=false -- str )
  "YARA Rules: scan the input with YARA rules, a documented subset of the YARA 4 language run by Forge's own engine (no libyara). Supported: rule names, tags, private and global rules; meta (strings, integers, booleans); text strings with the modifiers ascii, wide, nocase, fullword, private, xor (and xor(n-m)) and base64 / base64wide (with an alphabet); hex strings with wildcards (??, X?, ?X, ~XX), jumps [n], [n-m], [n-] and [-], and alternatives (A | B), nested; regular expressions /.../ with the flags i and s (the classes, \\w \\d \\s \\b, groups, | and the quantifiers * + ? {n} {n,} {,m} {n,m} with lazy forms; no back references or look-around); and conditions with and, or, not, true, false, filesize, $a, #a, @a[i], !a[i], $a at e, $a in (lo..hi), #a in (lo..hi), N of / any of / all of / none of / N% of (them, ($a, $b*)) with at and in, for ... of ... : ( ... ), for ... i in (lo..hi) : ( ... ), int8 to uint32 reads with the be forms, 64-bit integer arithmetic (+ - * \\ % & | ^ ~ << >>), comparisons, hex numbers, KB and MB, and references to earlier rules. No modules (import is E_COERCE naming the module), no include, floating point numbers, string operators (matches, contains, ...) or regular expression strings with wide. The result lists each matching rule as Input matches rule \"name\"; Show metadata adds [key: value, ...]; Show strings, Show string lengths and Show counts add the matched strings of the rule (Pattern $a, count: n, and Pos offset, length n, data: \"...\" per match). When no rule matches the result is No rules matched. A string has at most 100,000 matches and a scan at most 200,000,000 byte steps (E_LIMIT_VALUE); input is limited to 4 MiB." doc
  "Forensics" category
  data rules show-strings show-string-lengths or _scan
  dup len 0 = [ drop "No rules matched." ] [
    [ show-strings show-string-lengths show-metadata show-counts _rule ] map "" join
  ] if ;

META: scan
  param rules "YARA rules in the supported subset, one or more rules." ;
  param show-strings "Show each match of each matched string: offset and the bytes." ;
  param show-string-lengths "Show the length of each match." ;
  param show-metadata "Show the meta section of each matching rule." ;
  param show-counts "Show the number of matches of each matched string." ;
  see-also filetype:scan ;
;
