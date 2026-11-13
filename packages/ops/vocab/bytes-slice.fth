\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bytes-slice: keep or remove a span of bytes, or every nth byte, of the whole input or of each line. Written in FL
\ over the core slice, range and map words; the per-line form uses the fork combinator on line feeds.
IN: bytes-slice

USING: util ;

\ ---- a span ----

: _take ( d:bytes start:int length:int -- bytes )
  d start d len min dup length + d len min slice ;

: _cut ( d:bytes lo:int hi:int -- bytes )
  d 0 lo slice d hi d len slice cat ;

: _remove ( d:bytes start:int length:int -- bytes )
  d start d len min dup length + d len min _cut ;

: take ( data:bytes start:int[0..]=0 length:int[0..]=5 each-line:bool=false -- bytes )
  "Keep length bytes of the data from the offset start (0 is the first byte); less if the data ends first, none if it starts past the end. With each-line set, every line (the pieces between line feeds, which stay) is cut in the same way. CyberChef's Take bytes, with the same defaults." doc
  "Text" category
  each-line
  [ data #[ 0a ] #[ 0a ] [ start length _take ] fork ]
  [ data start length _take ]
  if ;

: remove ( data:bytes start:int[0..]=0 length:int[0..]=5 each-line:bool=false -- bytes )
  "Remove length bytes from the offset start (0 is the first byte): everything before and after that span stays. Less is removed if the data ends first, and nothing if it starts past the end. With each-line set, the span is removed from every line (the pieces between line feeds, which stay). CyberChef's Drop bytes, with the same defaults." doc
  "Text" category
  each-line
  [ data #[ 0a ] #[ 0a ] [ start length _remove ] fork ]
  [ data start length _remove ]
  if ;

\ ---- every nth byte ----

: _take-nth ( d:bytes n:int start:int -- bytes )
  d len start - 0 max n util:ceil-div
  0 swap range [ n * start + d swap nth ] map list>bytes ;

\ True for the index i that remove-nth removes: start, start + n, start + 2n, ...
: _dropped? ( i:int n:int start:int -- bool )
  i start >= i start - n mod 0 = and ;

: _remove-nth ( d:bytes n:int start:int -- bytes )
  0 d len range [ n start _dropped? not ] filter
  [ d swap nth ] map list>bytes ;

: take-nth ( data:bytes n:int[1..]=4 start:int[0..]=0 each-line:bool=false -- bytes )
  "Keep every nth byte, beginning with the byte at offset start: the bytes at start, start + n, start + 2n, and so on, in order. With each-line set, every line (the pieces between line feeds, which stay) is treated alone, counting from its own first byte. CyberChef's Take nth bytes, with the same defaults." doc
  "Text" category
  each-line
  [ data #[ 0a ] #[ 0a ] [ n start _take-nth ] fork ]
  [ data n start _take-nth ]
  if ;

: remove-nth ( data:bytes n:int[1..]=4 start:int[0..]=0 each-line:bool=false -- bytes )
  "Remove every nth byte, beginning with the byte at offset start: the bytes at start, start + n, start + 2n, and so on; the others stay in order. With each-line set, every line (the pieces between line feeds, which stay) is treated alone, counting from its own first byte. CyberChef's Drop nth bytes, with the same defaults." doc
  "Text" category
  each-line
  [ data #[ 0a ] #[ 0a ] [ n start _remove-nth ] fork ]
  [ data n start _remove-nth ]
  if ;

META: take
  use-when "You have binary data and know where the part you want starts and how long it is, such as a field in a packet, and want only that part." ;
  param start "The offset of the first byte to keep; 0 is the first byte of the data." ;
  param length "How many bytes to keep." ;
  param each-line "Apply to every line separately instead of to the whole input." ;
  see-also bytes-slice:remove ;
;

META: remove
  use-when "You have binary data with a span of bytes you want to drop, such as a header at a known offset, and want the rest of the data in order." ;
  param start "The offset of the first byte to remove; 0 is the first byte of the data." ;
  param length "How many bytes to remove." ;
  param each-line "Apply to every line separately instead of to the whole input." ;
  see-also bytes-slice:take ;
;

META: take-nth
  use-when "You have data with a value in every nth byte, such as one channel of interleaved samples, and want only those bytes in order." ;
  param n "Keep one byte in every n (1 keeps them all)." ;
  param start "The offset of the first byte to keep." ;
  param each-line "Apply to every line separately instead of to the whole input." ;
  see-also bytes-slice:remove-nth ;
;

META: remove-nth
  use-when "You have data where every nth byte is padding or noise, such as a zero every fourth byte, and want the other bytes in order." ;
  param n "Remove one byte in every n (1 removes them all)." ;
  param start "The offset of the first byte to remove." ;
  param each-line "Apply to every line separately instead of to the whole input." ;
  see-also bytes-slice:take-nth ;
;
