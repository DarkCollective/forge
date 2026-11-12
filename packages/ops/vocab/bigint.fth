\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bigint: unsigned big-endian integers as bytes, and as decimal text. Written in FL over the core
\ words and util. The integer limit of the language (limits.maxIntBits, default 65 536 bits, so 8192
\ bytes of significant data) applies: a larger value raises E_LIMIT_VALUE.
IN: bigint

: from-bytes ( bytes -- str )
  "Read the bytes as one unsigned big-endian integer and give its decimal text. Empty input is 0, and leading zero bytes have no effect. The language integer limit applies: more than 8192 significant bytes (65 536 bits) raises E_LIMIT_VALUE." doc
  "Encodings" category
  256 util:digits>int int>str ;

: _parse ( s:str -- int )
  s str>int dup 0 < [ "a negative number has no unsigned byte form" raise:coerce ] when ;

\ The big-endian bytes of v, as many as its hex digits need.
: _be ( v:int -- bytes )
  v 0 = [ #[ 00 ] ] [ v util:int>bytes ] if ;

: to-bytes ( str -- bytes )
  "Parse decimal text (digits only, white space ignored; no sign) and give the unsigned big-endian bytes, as few as possible and at least one, so 0 is the single byte 00. Anything else raises E_COERCE. The language integer limit applies (E_LIMIT_VALUE)." doc
  "Encodings" category
  util:strip-space _parse _be ;

META: to-bytes
  use-when "You have a whole number in decimal and need its unsigned big-endian bytes, for example for a field in a binary format. Negative numbers are refused." ;
  link "https://en.wikipedia.org/wiki/Endianness" "Endianness on Wikipedia" ;
  inverse from-bytes ;
  see-also bigint:from-bytes ;
;

META: from-bytes
  use-when "You have a big-endian number as bytes, such as a key, a hash or a field from a binary format, and want its value in decimal." ;
  link "https://en.wikipedia.org/wiki/Endianness" "Endianness on Wikipedia" ;
  inverse to-bytes ;
;
