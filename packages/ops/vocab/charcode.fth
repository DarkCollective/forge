\ charcode: Unicode code points as numbers in a chosen base. The words are FL and need no
\ primitive; E_COERCE comes from the raise vocabulary (raise:coerce).
IN: charcode

: _surrogate? ( cp:int -- bool )
  cp 55296 >= cp 57343 <= and ;

: _cp-text ( cp:int base:int -- str )
  cp _surrogate? [ "a lone surrogate is not a code point" raise:coerce ] when
  cp base int>str-radix ;

: _cp-value ( t:str base:int -- int )
  t 0 1 slice "-" = [ "a code point is not negative" raise:coerce ] when
  t base str>int-radix
  dup 1114111 > [ "a code point is at most 0x10FFFF" raise:coerce ] when
  dup _surrogate? [ "a surrogate is not a code point" raise:coerce ] when ;

: encode ( str base:int[2..36]=16 delimiter:choice{space|comma|newline}=space -- str )
  "One number per code point (not UTF-16 unit), in the base, lower-case digits, separated by the delimiter." doc
  "Encodings" category
  str>codes [ base _cp-text ] map delimiter util:separator join ;

: decode ( str base:int[2..36]=16 -- str )
  "Decode numbers in the base separated by white space and/or commas, one code point each." doc
  "Encodings" category
  str>codes [ dup util:space-or-comma? [ drop 32 ] when ] map codes>str " " split
  [ len 0 > ] filter [ base _cp-value ] map codes>str ;

META: encode
  param base "The number base, 2 to 36." ;
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
;

META: decode
  param base "The number base, 2 to 36." ;
;
