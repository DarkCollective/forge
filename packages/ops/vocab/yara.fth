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

\ One match line, in CyberChef's layout: "Pos 12, length 5, identifier $a, data: "abc"" with the parts that are switched on.
: _match-line ( m:record id:str lengths:bool strings:bool -- str )
  "Pos " m "offset" get int>str cat ", " cat
  lengths [ "length " cat m "length" get int>str cat ", " cat ] when
  "identifier " cat id cat
  strings [ ", data: \"" cat m "text" get cat "\"" cat ] when
  "\n" cat ;

\ The lines of all the matches of one string.
: _string-lines ( s:record lengths:bool strings:bool -- str )
  s "matches" get [ s "id" get lengths strings _match-line ] map "" join ;

\ The number of matches of all the strings of a rule.
: _total ( r:record -- int )
  r "strings" get 0 [ "count" get + ] reduce ;

\ " (3 times)" for the counts switch, nothing when the rule has no string match.
: _count-text ( total:int counts:bool -- str )
  total 0 = counts not or [ "" ] [ " (" total int>str cat total 1 > [ " times)" ] [ " time)" ] if cat ] if ;

\ The report of a rule from its pieces: name, metadata text, count text and, when the matches are listed, their lines.
: _report ( r:record meta:str counts:str detail:bool lengths:bool strings:bool -- str )
  detail
  [ "Rule \"" r "name" get cat "\"" cat meta cat " matches" cat counts cat ":\n" cat
    r "strings" get [ lengths strings _string-lines ] map "" join cat ]
  [ "Input matches rule \"" r "name" get cat "\"" cat meta cat counts cat ".\n" cat ]
  if ;

\ The report of one matching rule, as CyberChef's YARA Rules writes it (it writes two spaces before the count of the
\ short form; Forge writes one).
: _rule2 ( r:record strings:bool lengths:bool metadata:bool counts:bool total:int -- str )
  r
  metadata [ r "meta" get _meta-text ] [ "" ] if
  total counts _count-text
  total 0 > strings lengths or and
  lengths strings _report ;

: _rule ( r:record strings:bool lengths:bool metadata:bool counts:bool -- str )
  r strings lengths metadata counts r _total _rule2 ;

: scan ( data:bytes rules:str="" show-strings:bool=false show-string-lengths:bool=false show-metadata:bool=false show-counts:bool=true -- str )
  "YARA Rules: scan the input with YARA rules, a documented subset of the YARA 4 language run by Forge's own engine (no libyara). Supported: rule names, tags, private and global rules; meta (strings, integers, booleans); text strings with the modifiers ascii, wide, nocase, fullword, private, xor (and xor(n-m)) and base64 / base64wide (with an alphabet); hex strings with wildcards (??, X?, ?X, ~XX), jumps [n], [n-m], [n-] and [-], and alternatives (A | B), nested; regular expressions /.../ with the flags i and s (the classes, \\w \\d \\s \\b, groups, | and the quantifiers * + ? {n} {n,} {,m} {n,m} with lazy forms; no back references or look-around); and conditions with and, or, not, true, false, filesize, $a, #a, @a[i], !a[i], $a at e, $a in (lo..hi), #a in (lo..hi), N of / any of / all of / none of / N% of (them, ($a, $b*)) with at and in, for ... of ... : ( ... ), for ... i in (lo..hi) : ( ... ), int8 to uint32 reads with the be forms, 64-bit integer arithmetic (+ - * \\ % & | ^ ~ << >>), comparisons, hex numbers, KB and MB, and references to earlier rules. No modules (import is E_COERCE naming the module), no include, floating point numbers, string operators (matches, contains, ...) or regular expression strings with wide. The result is in the layout of CyberChef's report: each matching rule as Input matches rule \"name\" (3 times). (the number is the matches of all its strings; Show counts, on by default); Show metadata adds [key: value, ...]; with Show strings or Show string lengths a rule is Rule \"name\" matches (3 times): and one line Pos offset, length n, identifier $a, data: \"...\" per match. When no rule matches the result is empty, as in CyberChef. CyberChef also has Show rule warnings and Show console module messages; Forge has no modules and no warnings. A string has at most 100,000 matches and a scan at most 200,000,000 byte steps (E_LIMIT_VALUE); input is limited to 4 MiB." doc
  "Forensics" category
  data rules show-strings show-string-lengths or _scan
  [ show-strings show-string-lengths show-metadata show-counts _rule ] map "" join ;

META: scan
  param rules "YARA rules in the supported subset, one or more rules." ;
  param show-strings "Show each match of each matched string: offset and the bytes." ;
  param show-string-lengths "Show the length of each match." ;
  param show-metadata "Show the meta section of each matching rule." ;
  param show-counts "Show the number of matches of each matched string." ;
  see-also filetype:scan ;
;
