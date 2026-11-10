\ endian: byte-order swapping of whole words. Written in FL; there are no primitives. The op is
\ named swap, which shadows the core swap inside this file, so no word below uses the core swap.
IN: endian

\ Word i of the data, reversed.
: _word ( data:bytes i:int width:int -- bytes )
  data i width * i 1 + width * slice rev ;

: _words ( data:bytes width:int -- bytes )
  0 data len width div range [ data swap width _word ] map #[ ] bjoin ;

\ The data, a whole number of words long: zero-padded at the end if pad is set, else E_RANGE.
: _fit ( data:bytes width:int pad:bool -- bytes )
  data len width mod 0 =
  [ data ]
  [ pad
    [ data width data len width mod - util:zero-bytes cat ]
    [ "the length is not a multiple of the word width" raise:range data ]
    if ]
  if ;

: swap ( bytes width:int[2|4|8]=4 pad:bool=false -- bytes )
  "Reverse the byte order of every word of width bytes (2, 4 or 8), converting between big-endian and little-endian data. The input must be a whole number of words (E_RANGE); with pad, a final partial word is first zero-padded at the end, so those zero bytes come out at the start of the last word." doc
  "Bitwise" category
  width pad _fit width _words ;

META: swap
  param width "The size of a word in bytes: 2, 4 or 8." ;
  param pad "Zero-pad a final partial word at the end instead of raising an error." ;
;
