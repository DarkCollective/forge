\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ de-bruijn: the de Bruijn sequence B(k, n), the shortest cyclic sequence over k symbols that contains every word of
\ n symbols exactly once. It is the concatenation, in lexicographic order, of the Lyndon words over the alphabet whose
\ length divides n (Fredricksen, Kessler and Maiorana), made here by Duval's iterative generation of Lyndon words.
\ This is the lexicographically least sequence, which is the one the usual algorithm gives (B(2, 3) is 00010111).
IN: de-bruijn

\ w repeated to n symbols: symbol i is symbol i mod (length of w) of w.
: _extend ( w:list n:int -- list )
  0 n range [ w len mod w swap nth ] map ;

\ w without its trailing symbols equal to k - 1.
: _trim ( w:list k:int -- list )
  w 0 w len w rev [ k 1 - = ] util:count-leading - slice ;

\ A symbol value as its character: 0-9 then a-z.
: _char ( v:int -- int )
  v 10 < [ v 48 + ] [ v 87 + ] if ;

\ The output is built as pieces of about 512 characters in a list, so that no step copies the whole output so far
\ (appending to one long string or list would cost far more than the limits allow for 65,536 symbols).
: _flush ( chunks:list cur:str -- list str )
  cur len 512 >= [ chunks cur append "" ] [ chunks cur ] if ;

: _emit ( chunks:list cur:str w:list -- list str )
  chunks cur w [ _char ] map codes>str cat _flush ;

\ One step of Duval's generation from the non-empty word w, whose last symbol has already been increased: if the word
\ is a Lyndon word whose length divides n it is output; then it is extended periodically to n symbols and the trailing
\ largest symbols are dropped.
: _step2 ( chunks:list cur:str w:list k:int n:int -- list str list )
  n w len mod 0 = [ chunks cur w _emit ] [ chunks cur ] if
  w n _extend k _trim ;

: _step ( chunks:list cur:str w:list k:int n:int -- list str list )
  chunks cur w 0 w len 1 - slice w w len 1 - nth 1 + append k n _step2 ;

\ The text of the Lyndon words over k symbols whose length divides n, in lexicographic order.
: _words ( k:int n:int -- str )
  { } "" { -1 } [ dup len 0 > ] [ k n _step ] while drop append "" join ;

: generate ( bytes k:int[2..36]=2 n:int[1..16]=3 -- str )
  "The de Bruijn sequence B(k, n): a cyclic sequence over an alphabet of k symbols in which every word of n symbols appears exactly once, k to the power n symbols long, written with the digits 0-9 and then the letters a-z (k up to 36). It is the lexicographically least one, the concatenation of the Lyndon words whose length divides n: B(2, 3) is 00010111 and B(3, 2) is 001021122. k to the power n may be at most 65,536 (E_RANGE). The input is ignored." doc
  "Generators" category
  drop
  k n pow 65536 > [ "k to the power n is more than 65,536 symbols" raise:range ] when
  k n _words ;

META: generate
  use-when "You need a sequence of symbols that holds every short word over an alphabet exactly once, for example as a test pattern or a cyclic counter." ;
  link "https://en.wikipedia.org/wiki/De_Bruijn_sequence" "De Bruijn sequence on Wikipedia" ;
  param k "The size of the alphabet, 2 to 36." ;
  param n "The length of the words that must each appear once, 1 to 16." ;
;
