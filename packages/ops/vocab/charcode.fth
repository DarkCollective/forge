\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ charcode: Unicode code points as numbers in a chosen base. The words are FL and need no
\ primitive; E_COERCE comes from the raise vocabulary (raise:coerce).
IN: charcode

: _cp-text ( cp:int base:int -- str )
  cp util:surrogate? [ "a lone surrogate is not a code point" raise:coerce ] when
  cp base int>str-radix ;

: _cp-value ( t:str base:int -- int )
  t 0 1 slice "-" = [ "a code point is not negative" raise:coerce ] when
  t base str>int-radix
  dup 1114111 > [ "a code point is at most 0x10FFFF" raise:coerce ] when
  dup util:surrogate? [ "a surrogate is not a code point" raise:coerce ] when ;

: encode ( str base:int[2..36]=16 delimiter:choice{space|comma|newline}=space -- str )
  "One number per code point (not UTF-16 unit), in the base, lower-case digits, separated by the delimiter." doc
  "Encodings" category
  str>codes [ base _cp-text ] map delimiter util:separator join ;

: decode ( str base:int[2..36]=16 -- str )
  "Decode numbers in the base separated by white space and/or commas, one code point each." doc
  "Encodings" category
  util:number-tokens [ base _cp-value ] map codes>str ;

META: encode
  use-when "You have text and want the Unicode code point of each character as numbers, such as 1f600 for an emoji, to look up or compare." ;
  link "https://en.wikipedia.org/wiki/Code_point" "Code point on Wikipedia" ;
  inverse decode ;
  param base "The number base, 2 to 36." ;
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
;

META: decode
  use-when "You have Unicode code points as numbers, such as 48 69 or 1F600 from a table, and want the characters they stand for." ;
  link "https://en.wikipedia.org/wiki/Code_point" "Code point on Wikipedia" ;
  inverse encode ;
  param base "The number base, 2 to 36." ;
;
