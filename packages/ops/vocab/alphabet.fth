\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ alphabet: write out the characters of ranges such as a-z. Written in FL over regex:find-all (which cuts the
\ range text into pieces and keeps the pieces in its groups); no primitive.
IN: alphabet

USING: util ;

\ The code point of an atom: a character, or a backslash escape of a minus or a backslash (two characters).
: _atom>cp ( a:str -- int )
  a len 2 = [ a 1 2 slice ] [ a ] if str>codes 0 nth ;

\ The characters lo..hi without the UTF-16 surrogates, which are not characters.
: _span ( lo:int hi:int -- list )
  hi lo < [ "a range must not run backwards" raise:range ] when
  hi lo - 65535 > [ "a range may hold at most 65536 code points" raise:range ] when
  lo hi 1 + range [ util:surrogate? not ] filter [ util:cp>str ] map ;

\ One piece of the text from its three groups: low end and high end of a range, or a single character.
: _item ( g:list -- list )
  g 0 nth ""  =
  [ { } g 2 nth _atom>cp util:cp>str append ]
  [ g 0 nth _atom>cp g 1 nth _atom>cp _span ]
  if ;

\ A range is atom - atom (groups 1 and 2), else a single atom (group 3).
: _with-atom ( atom:str -- str )
  "(" atom cat ")-(" cat atom cat ")|(" cat atom cat ")" cat ;

\ An atom is an escaped minus or backslash, a character that is not a backslash, or a backslash that does not start an escape.
: _range-pattern ( -- str )
  "\\\\[\\\\-]|[^\\\\]|\\\\(?![\\\\-])" _with-atom ;

: _join-all ( pieces:list d:str -- str )
  pieces [ d join ] map [ len 0 > ] filter d join ;

: expand ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab|none}="none" -- str )
  "Write out the characters of the ranges in the text. A range is two characters with a minus between them, from the first to the second by code point: a-z gives a b c ... z, and a-cx0-2 gives a b c x 0 1 2. A character that is not part of a range stays as it is; to use a minus or a backslash as a plain character, or as an end of a range, write \\- or \\\\. The result is the list of characters joined by the delimiter (none by default, as CyberChef's empty delimiter: the characters are joined without a gap; space, comma and the others put that text between them). A range that runs backwards (z-a), or that holds more than 65,536 code points, is E_RANGE; the UTF-16 surrogates inside a range are skipped." doc
  "Text" category
  data _range-pattern "" regex:find-all [ "groups" get _item ] map
  delimiter util:delimiter _join-all ;

META: expand
  use-when "You have a range such as a-z or 0-9 from a settings box, and want every character in it written out, for example as a charset for a brute-force run." ;
  param delimiter "What is written between the characters." ;
  see-also charcode:encode ;
;
