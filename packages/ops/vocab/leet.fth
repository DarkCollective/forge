\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ leet: leet speak ("1337"), to and from, with one fixed character for each letter so that it can be read back. The
\ table is Forge's own: the basic table is the digits that look like letters, the extended one adds a few symbols.
\ Only ASCII is looked at; any other character is left alone. Written in FL.
IN: leet

\ The letters that have a leet character and the characters, in the same order. The first nine are the basic table.
: _letters ( style:str -- str )
  style "extended" = [ "abegiostzcdhlqx" ] [ "abegiostz" ] if ;

: _symbols ( style:str -- str )
  style "extended" = [ "483610572()#|9%" ] [ "483610572" ] if ;

\ The code that c is replaced by: the entry of its position in from (letters are looked up in lower case) in to, or c.
: _entry ( c:int from:str to:str -- int )
  from c 65 90 util:between? [ c 32 + ] [ c ] if util:cp>str split
  dup len 2 = [ 0 nth len to str>codes swap nth ] [ drop c ] if ;

\ The 128 replacement codes of ASCII.
: _table ( from:str to:str -- bytes )
  0 128 range [ from to _entry ] map list>bytes ;

: _apply ( s:str table:bytes -- str )
  s str>codes [ dup 128 < [ table swap nth ] [ ] if ] map codes>str ;

: convert ( str direction:choice{to|from}="to" style:choice{basic|extended}="basic" -- str )
  "Leet speak. To: each letter (either case) that has a leet character is replaced by it: basic is a 4, b 8, e 3, g 6, i 1, o 0, s 5, t 7 and z 2; extended also c (, d ), h #, l |, q 9 and x %. Other characters are unchanged. From: the leet characters become lower-case letters again. The conversion loses the case of letters and cannot tell a leet 1 from a real 1, so from is a best-effort reading, not an inverse for text with digits." doc
  "Language" category
  direction "to" =
  [ style _letters style _symbols _table ]
  [ style _symbols style _letters _table ] if _apply ;

META: convert
  param direction "to: letters to leet characters. from: leet characters to letters." ;
  param style "basic: nine letters, all digits. extended: six more, with symbols." ;
;
