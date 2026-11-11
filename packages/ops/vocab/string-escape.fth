\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ string-escape: write text as the body of a JavaScript-style string literal, and read it back. Written in FL;
\ unescape uses regex:find-all to cut the text into escapes and plain runs. Escapes work on code points, not bytes.
IN: string-escape

USING: util ;

\ ---- escape ----

\ A surrogate pair written as two \u escapes.
: _pair ( cp:int up:bool -- str )
  "\\u" cp 65536 - 10 shr 55296 + 4 util:pad-hex up [ upper ] when cat
  "\\u" cat cp 65536 - 1023 band 56320 + 4 util:pad-hex up [ upper ] when cat ;

\ A code point written with a number: \xHH below 256, \uHHHH below 65536, else \u{H} (or a pair of \u when json
\ is set or es6 is not). JSON has no \x, so json always uses \uHHHH.
: _numeric ( cp:int json:bool es6:bool up:bool -- str )
  cp 256 < json not and
  [ "\\x" cp 2 util:pad-hex up [ upper ] when cat ]
  [ cp 65536 <
    [ "\\u" cp 4 util:pad-hex up [ upper ] when cat ]
    [ json es6 not or
      [ cp up _pair ]
      [ "\\u{" cp 1 util:pad-hex up [ upper ] when cat "}" cat ] if ] if ]
  if ;

\ The backspace, tab, line feed, vertical tab (not in JSON), form feed and carriage return have a letter.
: _named? ( cp:int json:bool -- bool )
  cp 8 13 util:between? cp 11 = json and not and ;

: _named ( cp:int -- str )
  "\\" "btnvfr" cp 8 - dup 1 + slice cat ;

\ Control characters, DEL, the line and paragraph separators, and (special level) anything beyond ASCII.
: _numeric? ( cp:int level:str -- bool )
  cp 32 < cp 127 = or cp 8232 = or cp 8233 = or
  level "special" = cp 126 > and or ;

: _esc-cp ( cp:int level:str q:int json:bool es6:bool up:bool -- str )
  level "everything" =
  [ cp json es6 up _numeric ]
  [ cp 32 >= cp 126 <= and cp 92 <> and cp q <> and
    [ cp util:cp>str ]
    [ cp 92 =
      [ "\\\\" ]
      [ cp q =
        [ "\\" cp util:cp>str cat ]
        [ cp json _named?
          [ cp _named ]
          [ cp level _numeric? [ cp json es6 up _numeric ] [ cp util:cp>str ] if ]
          if ]
        if ]
      if ]
    if ]
  if ;

: _quote-cp ( quote:str json:bool -- int )
  json [ 34 ] [ quote "single" = [ 39 ] [ quote "double" = [ 34 ] [ 96 ] if ] if ] if ;

: _escape-with ( data:str level:str q:int json:bool es6:bool up:bool -- str )
  data str>codes [ level q json es6 up _esc-cp ] map "" join ;

: escape ( data:str level:choice{special|everything|minimal}="special" quote:choice{single|double|backtick}="single" json:bool=false es6:bool=true uppercase:bool=false -- str )
  "Escape text so that it can sit inside a JavaScript string literal (no quotes are added). Every code point is one unit, not a UTF-8 byte: the backslash and the chosen quote get a backslash; the backspace, tab, line feed, vertical tab, form feed and carriage return are written \\b \\t \\n \\v \\f \\r; the other control characters, DEL and U+2028/U+2029 as \\xHH or \\uHHHH. Level minimal stops there; special (the default) also writes every character beyond ASCII as \\xHH (below 256), \\uHHHH or, with es6, \\u{H...}; everything writes every character, the printable ASCII ones too, with numeric escapes only. With es6 off, or with json on, a character above U+FFFF is two \\u escapes (a surrogate pair). Json forces the double quote and uses only \\uHHHH (no \\x, no \\v, no \\u{}) so the result is valid inside a JSON string. Uppercase writes the hex digits in capitals. NUL is \\x00, never \\0, so a digit after it is not misread." doc
  "Text" category
  data level quote json _quote-cp json es6 uppercase _escape-with ;

\ ---- unescape ----

: _cp ( v:int -- str )
  v 1114111 > v util:surrogate? or
  [ "an escape is not a Unicode scalar value" raise:coerce ] when
  v util:cp>str ;

: _simple ( c:str -- str )
  c "n" = [ "\n" ] [
  c "t" = [ "\t" ] [
  c "r" = [ "\r" ] [
  c "b" = [ 8 util:cp>str ] [
  c "f" = [ 12 util:cp>str ] [
  c "v" = [ 11 util:cp>str ] [
  c ] if ] if ] if ] if ] if ] if ;

\ One piece, from its seven groups: u{H}, the high and low half of a pair, uHHHH, xHH, octal, a letter.
: _unesc ( g:list text:str -- str )
  g 0 nth "" <>
  [ g 0 nth 16 str>int-radix _cp ]
  [ g 1 nth "" <>
    [ g 1 nth 16 str>int-radix 55296 - 10 shl g 2 nth 16 str>int-radix 56320 - + 65536 + _cp ]
    [ g 3 nth "" <>
      [ g 3 nth 16 str>int-radix _cp ]
      [ g 4 nth "" <>
        [ g 4 nth 16 str>int-radix _cp ]
        [ g 5 nth "" <>
          [ g 5 nth 8 str>int-radix _cp ]
          [ g 6 nth "" <> [ g 6 nth _simple ] [ text ] if ]
          if ]
        if ]
      if ]
    if ]
  if ;

: unescape ( data:str -- str )
  "Read the escapes of a JavaScript string literal body back into characters: \\n \\t \\r \\b \\f \\v, \\' \\\" \\` \\\\ and \\/, \\xHH, \\uHHHH (a high and a low surrogate escape in a row make one character), \\u{H} with one to six hex digits, and octal escapes of up to three digits (\\0 to \\377). An escape that is not one of these (\\q, a backslash at the end, \\x with fewer than two hex digits) is kept as written, and so is all the text outside the escapes. A lone surrogate escape, or a value above U+10FFFF, is E_COERCE. The inverse of escape for every level." doc
  "Text" category
  data
  "\\\\(?:u\\{([0-9A-Fa-f]{1,6})\\}|u([dD][89abAB][0-9A-Fa-f]{2})\\\\u([dD][c-fC-F][0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4})|x([0-9A-Fa-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|([bfnrtv'\"\\\\`/]))|[^\\\\]+|[\\s\\S]"
  "" regex:find-all
  [ dup "groups" get swap "text" get _unesc ] map "" join ;

META: escape
  param level "special writes every character beyond ASCII with an escape, everything writes every character, minimal only what a string literal needs." ;
  param quote "Which quote gets a backslash: single ('), double (\") or backtick (`). Json overrides this with the double quote." ;
  param json "Produce JSON-compatible escapes: the double quote, \\uHHHH only." ;
  param es6 "Write characters above U+FFFF as \\u{H...} (otherwise as two \\u escapes)." ;
  param uppercase "Write the hex digits of escapes in capitals." ;
  see-also string-escape:unescape ;
;

META: unescape
  see-also string-escape:escape ;
;
