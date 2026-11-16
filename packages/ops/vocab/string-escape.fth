\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ string-escape: write text as the body of a JavaScript-style string literal, and read it back. Written in FL;
\ unescape uses regex:find-all to cut the text into escapes and plain runs. Escapes work on code points, not bytes.
IN: string-escape

\ ---- escape ----
\ The rules follow the escaper CyberChef uses, which was found by comparing outputs, not by reading its code: a code
\ point is written with one of a few short escapes, with a number, or as it is, depending on the level.

\ A surrogate pair written as two \u escapes.
: _pair ( cp:int up:bool -- str )
  "\\u" cp 65536 - 10 shr 55296 + 4 pad-hex up [ upper ] when cat
  "\\u" cat cp 65536 - 1023 band 56320 + 4 pad-hex up [ upper ] when cat ;

\ A code point written with a number: \xHH below 256 (not with json, which has no \x), \uHHHH below 65536, else
\ \u{H} with es6 or a pair of \u without it.
: _numeric ( cp:int json:bool es6:bool up:bool -- str )
  {
    [ cp 256 < json not and ] [ "\\x" cp 2 pad-hex up [ upper ] when cat ]
    [ cp 65536 < ] [ "\\u" cp 4 pad-hex up [ upper ] when cat ]
    [ es6 ] [ "\\u{" cp 1 pad-hex up [ upper ] when cat "}" cat ]
    [ cp up _pair ]
  } cond ;

\ The backspace, tab, line feed, form feed and carriage return have a letter (the vertical tab does not).
: _named? ( cp:int -- bool )
  cp 8 13 between? cp 11 <> and ;

: _named ( cp:int -- str )
  "\\" "btn?fr" cp 8 - dup 1 + slice cat ;

\ The spaces beyond ASCII that the minimal level writes with a number: U+00A0, U+1680, U+2000 to U+200A, U+2028,
\ U+2029, U+202F, U+205F and U+3000. Kept private: it only resembles url:_unreserved? (see the ops README, Justified exceptions).
: _space? ( cp:int -- bool )
  cp 160 = cp 5760 = or cp 8192 8202 between? or cp 8232 = or cp 8233 = or cp 8239 = or cp 8287 = or cp 12288 = or ;

\ nxt is the next code point, or -1 at the end: a NUL before a digit is \x00, because \0 followed by a digit would
\ read as an octal escape.
: _esc-cp ( cp:int nxt:int level:str q:int json:bool es6:bool up:bool -- str )
  {
    [ cp 92 = ] [ "\\\\" ]
    [ cp q = ] [ "\\" cp cp>str cat ]
    [ level "everything" = cp 34 = cp 39 = or cp 96 = or and ] [ "\\" cp cp>str cat ]
    [ cp _named? ] [ cp _named ]
    [ cp 0 = json not and nxt 48 < nxt 57 > or and ] [ "\\0" ]
    [ level "everything" = ] [ cp json es6 up _numeric ]
    [ level "special" = ] [ cp 32 < cp 126 > or [ cp json es6 up _numeric ] [ cp cp>str ] if ]
    [ cp _space? ] [ cp json es6 up _numeric ]
    [ cp cp>str ]
  } cond ;

: _escape-list ( codes:list level:str q:int json:bool es6:bool up:bool -- str )
  codes codes 1 codes len slice { -1 } cat zip
  [ dup 0 nth swap 1 nth level q json es6 up _esc-cp ] map "" join
  json [ q cp>str swap cat q cp>str cat ] when ;

: _quote-cp ( quote:str -- int )
  quote { "single" [ 39 ] "double" [ 34 ] [ 96 ] } case ;

: _escape-with ( data:str level:str q:int json:bool es6:bool up:bool -- str )
  data str>codes :> codes
  {
    [ codes len 0 = json and ] [ q cp>str dup cat ]
    [ codes len 0 = ] [ "" ]
    [ codes level q json es6 up _escape-list ]
  } cond ;

: escape ( data:str level:choice{special|everything|minimal}="special" quote:choice{single|double|backtick}="single" json:bool=false es6:bool=true uppercase:bool=false -- str )
  "Escape text so that it can sit inside a JavaScript string literal, with the rules of the escaper CyberChef uses (so the same recipe gives the same text). Every code point is one unit, not a UTF-8 byte. Every level writes the backslash as \\\\, the chosen quote with a backslash in front, the backspace, tab, line feed, form feed and carriage return as \\b \\t \\n \\f \\r, and a NUL as \\0 (as \\x00 or \\u0000 when a digit follows or json is on). Level special (the default) writes the other control characters, DEL and every character beyond ASCII as \\xHH (below 256), \\uHHHH or, with es6, \\u{H...} (without es6 a character above U+FFFF is two \\u escapes); the vertical tab is \\x0b, not \\v. Level everything writes every other character that way too, the printable ASCII ones included, and puts a backslash before all three quotes. Level minimal writes only what the first sentence names plus the Unicode spaces (U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000); other control characters and DEL stay as they are. Json writes \\uHHHH instead of \\xHH and no \\0, and, as CyberChef does, puts the chosen quote around the result (so it is only valid JSON with the double quote, at the special level, and with es6 off, because \\u{H}, \\' and \\` are not JSON). Uppercase writes the hex digits in capitals." doc
  "Text" category
  data level quote _quote-cp json es6 uppercase _escape-with ;

META: escape
  use-when "You have text that must sit inside a JavaScript string literal, with quotes, line breaks or non-ASCII characters, and want it written safely as escapes." ;
  param level "special writes every character beyond ASCII with an escape, everything writes every character, minimal only what a string literal needs." ;
  param quote "Which quote gets a backslash: single ('), double (\") or backtick (`). With json it is also the quote put around the result." ;
  param json "Produce JSON-style escapes (\\uHHHH, no \\x, no \\0) and put the chosen quote around the result, as CyberChef does." ;
  param es6 "Write characters above U+FFFF as \\u{H...} (otherwise as two \\u escapes)." ;
  param uppercase "Write the hex digits of escapes in capitals." ;
  inverse unescape ;
  see-also string-escape:unescape ;
;

\ ---- unescape ----

: _cp ( v:int -- str )
  v 1114111 > v util:surrogate? or
  [ "an escape is not a Unicode scalar value" fail-coerce ] when
  v cp>str ;

: _simple ( c:str -- str )
  c {
    "n" [ "\n" ]
    "t" [ "\t" ]
    "r" [ "\r" ]
    "b" [ 8 cp>str ]
    "f" [ 12 cp>str ]
    "v" [ 11 cp>str ]
    "a" [ 7 cp>str ]
    [ c ]
  } case ;

\ One piece, from its seven groups: u{H}, the high and low half of a pair, uHHHH, xHH, octal, a letter.
: _unesc ( g:list text:str -- str )
  {
    [ g 0 nth "" <> ] [ g 0 nth 16 str>int-radix _cp ]
    [ g 1 nth "" <> ] [ g 1 nth 16 str>int-radix 55296 - 10 shl g 2 nth 16 str>int-radix 56320 - + 65536 + _cp ]
    [ g 3 nth "" <> ] [ g 3 nth 16 str>int-radix _cp ]
    [ g 4 nth "" <> ] [ g 4 nth 16 str>int-radix _cp ]
    [ g 5 nth "" <> ] [ g 5 nth 8 str>int-radix _cp ]
    [ g 6 nth "" <> ] [ g 6 nth _simple ]
    [ text ]
  } cond ;

: unescape ( data:str -- str )
  "Read the escapes of a JavaScript string literal body back into characters: \\n \\t \\r \\b \\f \\v \\a (the bell, U+0007, as in CyberChef), \\' \\\" \\` \\\\ and \\/, \\xHH, \\uHHHH (a high and a low surrogate escape in a row make one character), \\u{H} with one to six hex digits, and octal escapes of up to three digits (\\0 to \\377). An escape that is not one of these (\\q, a backslash at the end, \\x with fewer than two hex digits) is kept as written, and so is all the text outside the escapes. A lone surrogate escape, or a value above U+10FFFF, is E_COERCE. The inverse of escape for every level." doc
  "Text" category
  data
  "\\\\(?:u\\{([0-9A-Fa-f]{1,6})\\}|u([dD][89abAB][0-9A-Fa-f]{2})\\\\u([dD][c-fC-F][0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4})|x([0-9A-Fa-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|([abfnrtv'\"\\\\`/]))|[^\\\\]+|[\\s\\S]"
  "" regex:find-all
  [ dup "groups" get swap "text" get _unesc ] map "" join ;

META: unescape
  use-when "You have a string copied from JavaScript source or a log, with escapes such as a newline or a Unicode escape, and want the real characters." ;
  inverse escape ;
  see-also string-escape:escape ;
;
