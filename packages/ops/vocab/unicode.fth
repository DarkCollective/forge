\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ unicode: escaping and unescaping code points (\uXXXX, U+XXXX, %uXXXX, \x{...}, &#x...;), Unicode
\ normalisation (UAX #15) and the replacement of typographic ("smart") characters by ASCII. All
\ the words are FL; the one primitive is the private _normalize (src/prims/unicode.ts), because the
\ core has no normalisation tables. E_COERCE does not arise here: text that is not an escape is
\ simply left alone.
IN: unicode

\ ---- escape ----

\ v in hex, left-padded with zeros to at least n digits.
: _hex ( v:int n:int up:bool -- str )
  v n util:pad-hex up [ upper ] when ;

\ A UTF-16 code unit as pre + 4 hex digits.
: _unit ( v:int pre:str up:bool -- str )
  pre v 4 up _hex cat ;

\ A code point as one or two (a surrogate pair, above U+FFFF) code units.
: _utf16 ( c:int pre:str up:bool -- str )
  c 65535 >
  [ 55296 c 65536 - 10 shr + pre up _unit
    56320 c 65536 - 1023 band + pre up _unit cat ]
  [ c pre up _unit ] if ;

\ nh says the next character is a hex digit, so U+ gets 6 digits to keep the number unambiguous.
: _esc ( c:int format:str up:bool nh:bool -- str )
  format "u" = [ c "\\u" up _utf16 ]
  [ format "%u" = [ c "%u" up _utf16 ]
    [ format "U+" = [ "U+" c nh [ 6 ] [ 4 ] if up _hex cat ]
      [ format "x{}" = [ "\\x{" c 2 up _hex cat "}" cat ]
        [ "&#x" c 1 up _hex cat ";" cat ] if ] if ] if ] if ;

: _hex-next? ( cps:list j:int -- bool )
  j cps len < [ cps j nth util:hex-digit? ] [ false ] if ;

: _piece ( c:int i:int cps:list format:str up:bool scope:str -- str )
  scope "all" = c 127 > or
  [ c format up cps i 1 + _hex-next? _esc ]
  [ c util:cp>str ] if ;

: _escape ( cps:list format:str up:bool scope:str -- str )
  cps [ cps format up scope _piece ] mapi "" join ;

: escape ( str format:choice{u|U+|%u|"x{}"|html}=u case:choice{upper|lower}=upper scope:choice{non-ascii|all}=non-ascii -- str )
  "Write code points as escapes. u: \\uXXXX (a surrogate pair, two escapes, above U+FFFF). U+: U+XXXX (4 digits, 6 if a hex digit follows). %u: %uXXXX as JavaScript escape() writes it. x{}: \\x{X...}. html: &#xX...; numeric reference. scope non-ascii escapes only code points above 0x7F; all escapes every code point. case sets the hex digit case." doc
  "Encodings" category
  str>codes format case "upper" = scope _escape ;

META: escape
  use-when "You need text with non-ASCII characters written as Unicode escape codes, for a source file, a log or a bug report." ;
  link "https://en.wikipedia.org/wiki/UTF-16" "UTF-16 on Wikipedia" ;
  inverse unescape ;
  param format "u: \\uXXXX. U+: U+XXXX. %u: %uXXXX. x{}: \\x{X}. html: &#xX;." ;
  param case "Case of the hex digits." ;
  param scope "non-ascii: escape only code points above 0x7F. all: escape every code point." ;
;

\ ---- unescape ----

\ Number of leading characters of s (at most max) for which pred holds.
: _run ( s:str max:int pred:quot -- int )
  s str>codes dup len max min 0 swap slice pred util:count-leading ;

: _valid-cp? ( v:int -- bool )
  v 1114111 <= v 55296 >= v 57343 <= and not and ;

\ The value of the 4 hex digits after the u that starts s, or -1.
: _u-unit ( s:str -- int )
  s len 5 >= [ s 0 1 slice "u" = ] [ false ] if
  [ s 1 2 slice "-" = [ -1 ] [ [ s 1 5 slice 16 str>int-radix ] [ drop -1 ] try ] if ]
  [ -1 ] if ;

: _high? ( v:int -- bool )
  v 55296 56319 util:between? ;

: _low? ( v:int -- bool )
  v 56320 57343 util:between? ;

\ The pair of two units as a code point.
: _pair ( hi:int lo:int -- int )
  hi 55296 - 10 shl lo 56320 - + 65536 + ;

\ A parser takes ( piece prev next ) and gives ( decoded rest ok ): piece is the text after an
\ introducer, prev and next the neighbouring pieces. ok false means piece is not an escape.
: _u-parse2 ( v:int piece:str prev:str next:str -- str str bool )
  v 0 <
  [ "" piece false ]
  [ v _high?
    [ piece len 5 = next _u-unit _low? and
      [ v next _u-unit _pair util:cp>str "" true ] [ "" piece false ] if ]
    [ v _low?
      [ prev len 5 = prev _u-unit _high? and
        [ "" piece 5 piece len slice true ] [ "" piece false ] if ]
      [ v util:cp>str piece 5 piece len slice true ] if ] if ] if ;

: _u-parse ( piece:str prev:str next:str -- str str bool )
  piece _u-unit piece prev next _u-parse2 ;

: _x-emit ( v:int piece:str cut:int -- str str bool )
  v _valid-cp? [ v util:cp>str piece cut piece len slice true ] [ "" piece false ] if ;

\ k is the number of hex digits after the x{ of piece.
: _x-parse2 ( piece:str k:int -- str str bool )
  k 0 > piece len 3 k + >= and
  [ piece 2 k + 3 k + slice "}" =
    [ piece 2 2 k + slice 16 str>int-radix piece 3 k + _x-emit ]
    [ "" piece false ] if ]
  [ "" piece false ] if ;

: _x-parse ( piece:str -- str str bool )
  piece len 3 >= [ piece 0 2 slice "x{" = ] [ false ] if
  [ piece piece 2 piece len slice 8 [ util:hex-digit? ] _run _x-parse2 ]
  [ "" piece false ] if ;

: _bs-parse ( piece:str prev:str next:str -- str str bool )
  piece len 0 = [ "" piece false ]
  [ piece 0 1 slice "u" = [ piece prev next _u-parse ] [ piece _x-parse ] if ] if ;

\ The longest run of 4 to k hex digits at the start of s that is a valid code point, else 0.
: _pick ( s:str k:int -- int )
  k 4 < [ 0 ]
  [ s 0 k slice 16 str>int-radix _valid-cp? [ k ] [ s k 1 - recurse ] if ] if ;

: _plus-emit ( piece:str k:int -- str str bool )
  k 0 = [ "" piece false ]
  [ piece 0 k slice 16 str>int-radix util:cp>str piece k piece len slice true ] if ;

: _plus-parse ( piece:str prev:str next:str -- str str bool )
  piece dup piece 6 [ util:hex-digit? ] _run _pick _plus-emit ;

\ A numeric reference body: digits from start in the radix, then a ;.
: _ref-emit ( v:int piece:str cut:int -- str str bool )
  v _valid-cp? [ v util:cp>str piece cut piece len slice true ] [ "" piece false ] if ;

: _ref2 ( piece:str start:int radix:int k:int -- str str bool )
  k 0 > piece len start k + 1 + >= and
  [ piece start k + start k + 1 + slice ";" =
    [ piece start start k + slice radix str>int-radix piece start k + 1 + _ref-emit ]
    [ "" piece false ] if ]
  [ "" piece false ] if ;

: _html-parse ( piece:str prev:str next:str -- str str bool )
  piece len 0 = [ "" piece false ]
  [ piece 0 1 slice lower "x" =
    [ piece 1 16 piece 1 piece len slice 8 [ util:hex-digit? ] _run _ref2 ]
    [ piece 0 10 piece 8 [ util:dec-digit? ] _run _ref2 ] if ] if ;

\ One level of unescaping: cut text at intro, give each piece to parse with its neighbours, and
\ run next over all the text that is not part of an escape (so decoded characters are never read
\ again, and an escape never contains the introducer of another form).
: _finish ( decoded:str rest:str ok:bool piece:str intro:str next:any -- str )
  ok [ rest len 0 = [ decoded ] [ decoded rest next call cat ] if ]
  [ intro piece next call cat ] if ;

: _emit-piece ( piece:str i:int parts:list intro:str parse:any next:any -- str )
  i 0 =
  [ piece next call ]
  [ piece
    i 1 = [ "" ] [ parts i 1 - nth ] if
    i 1 + parts len < [ parts i 1 + nth ] [ "" ] if
    parse call
    piece intro next _finish ] if ;

: _level2 ( parts:list intro:str parse:any next:any -- str )
  parts [ parts intro parse next _emit-piece ] mapi "" join ;

: _level ( text:str intro:str parse:any next:any -- str )
  text intro split dup len 1 = [ drop text next call ] [ intro parse next _level2 ] if ;

: _l-html ( s:str -- str )
  s "&#" [ _html-parse ] [ ] _level ;

: _l-plus ( s:str -- str )
  s "U+" [ _plus-parse ] [ _l-html ] _level ;

: _l-pct ( s:str -- str )
  s "%" [ _u-parse ] [ _l-plus ] _level ;

: unescape ( str -- str )
  "Read escapes back to text: \\uXXXX (a high and low surrogate pair together make one code point), \\x{X...}, %uXXXX, U+XXXX (4 to 6 hex digits, the longest that is a valid code point) and the numeric references &#xX...; and &#N;. Anything else, including an escape of a lone surrogate or a value above U+10FFFF, is left as written. Escapes are not nested and a backslash is not special on its own." doc
  "Encodings" category
  "\\" [ _bs-parse ] [ _l-pct ] _level ;

\ ---- normalisation ----

: normalize ( str form:choice{nfc|nfd|nfkc|nfkd}=nfc -- str )
  "Unicode normalisation (UAX #15): nfc composes, nfd decomposes, nfkc and nfkd also replace compatibility characters (ligatures, full-width forms, superscripts)." doc
  "Encodings" category
  form _normalize ;

META: normalize
  use-when "You have text that looks the same but is stored differently, such as é as one character or as e plus an accent, and need one form to compare or search." ;
  link "https://www.unicode.org/reports/tr15/" "UAX #15: Unicode Normalization Forms" ;
  link "https://en.wikipedia.org/wiki/Unicode_equivalence" "Unicode equivalence on Wikipedia" ;
  param form "nfc: canonical composition. nfd: canonical decomposition. nfkc, nfkd: with compatibility mappings." ;
;

\ ---- smart characters ----

\ { character replacement } pairs; names are those of the Unicode character database.
: _smart-pairs ( -- list )
  { { "\u{2018}" "'" }     \ LEFT SINGLE QUOTATION MARK
    { "\u{2019}" "'" }     \ RIGHT SINGLE QUOTATION MARK
    { "\u{201A}" "'" }     \ SINGLE LOW-9 QUOTATION MARK
    { "\u{201B}" "'" }     \ SINGLE HIGH-REVERSED-9 QUOTATION MARK
    { "\u{201C}" "\"" }    \ LEFT DOUBLE QUOTATION MARK
    { "\u{201D}" "\"" }    \ RIGHT DOUBLE QUOTATION MARK
    { "\u{201E}" "\"" }    \ DOUBLE LOW-9 QUOTATION MARK
    { "\u{201F}" "\"" }    \ DOUBLE HIGH-REVERSED-9 QUOTATION MARK
    { "\u{2013}" "-" }     \ EN DASH
    { "\u{2014}" "--" }    \ EM DASH
    { "\u{2026}" "..." }   \ HORIZONTAL ELLIPSIS
    { "\u{00A0}" " " } } ; \ NO-BREAK SPACE

: _apply ( acc:str pair:list -- str )
  acc pair 0 nth split pair 1 nth join ;

: smart-to-ascii ( str -- str )
  "Replace typographic characters by ASCII: the single quotes U+2018 U+2019 U+201A U+201B by ', the double quotes U+201C U+201D U+201E U+201F by \", EN DASH U+2013 by -, EM DASH U+2014 by --, HORIZONTAL ELLIPSIS U+2026 by ... and NO-BREAK SPACE U+00A0 by a space. Everything else is unchanged." doc
  "Text" category
  _smart-pairs swap [ _apply ] reduce ;

META: unescape
  use-when "You have text with Unicode escape codes or numeric references, such as U+1F600 or &#233;, from a source file or a log, and want the characters they stand for." ;
  link "https://en.wikipedia.org/wiki/UTF-16" "UTF-16 on Wikipedia" ;
  inverse escape ;
;

META: smart-to-ascii
  use-when "You have text copied from a word processor or web page with curly quotes, dashes or an ellipsis, and need plain ASCII punctuation." ;
;
