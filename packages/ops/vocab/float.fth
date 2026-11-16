\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ float: IEEE 754 binary32 and binary64 numbers as bytes, and as decimal text (IEEE 754-2019,
\ clauses 3.4 and 5.12). The splitting, looping and parameters are FL; the conversion of one number
\ is done by the private primitives _pack and _unpack (src/prims/float.ts), because the core cannot
\ reinterpret float bits, parse decimal text to a float, or hold NaN and the infinities.
\
\ Convention for several values: the text is numbers separated by white space and/or commas; the bytes
\ are the numbers one after another, each size/8 bytes.
IN: float

\ The width of a number: binary32 or binary64.
CHOICE: _float-size
  option 32 ;
  option 64 ;
;

\ The byte order of a number.
CHOICE: _byte-order
  option big ;
  option little ;
;

: encode ( str size:choice<_float-size>=64 endian:choice<_byte-order>=big -- bytes )
  "Convert decimal numbers to IEEE 754 bytes (binary32 or binary64). The text is numbers separated by white space and/or commas, with an optional sign, a decimal point and a power-of-ten exponent (1.5, -2e-3, .5), or NaN, Infinity and -Infinity (any case, inf also accepted); the result is the numbers one after another, 4 or 8 bytes each in the chosen byte order. Negative zero (-0) is kept. A finite number too large for the format, or any other text, raises E_COERCE. Empty text gives empty bytes. Binary32 values are rounded to nearest (through binary64 first)." doc
  "Encodings" category
  util:number-tokens
  [ size str>int endian "little" = _pack ] map
  #[ ] bjoin ;

\ The numbers of the data, w bytes each, as text separated by single spaces.
: _numbers ( data:bytes w:int little:bool -- str )
  0 data len w div range
  [ w * :> s data s s w + slice little _unpack ] map
  " " join ;

: decode ( bytes size:choice<_float-size>=64 endian:choice<_byte-order>=big -- str )
  "Convert IEEE 754 bytes (binary32 or binary64, in the chosen byte order) to decimal text: the shortest text that reads back as the same number, one number per 4 or 8 bytes, separated by single spaces (JavaScript number notation, so large and small values use e notation). NaN, Infinity, -Infinity and -0 are written as such (NaN payloads are not kept). A length that is not a whole number of values raises E_COERCE. Empty input gives empty text." doc
  "Encodings" category
  dup len size str>int 8 div mod 0 <>
  [ "the length is not a whole number of values" fail-coerce ] when
  size str>int 8 div endian "little" = _numbers ;

META: encode
  use-when "You have decimal numbers and need their IEEE 754 bytes, for example to write a float field into a binary file or to see the bit pattern of a value." ;
  param size "Bits per number: 32 (binary32) or 64 (binary64)." ;
  param endian "Byte order of each number." ;
  inverse decode ;
  link "https://en.wikipedia.org/wiki/IEEE_754" "IEEE 754 on Wikipedia" ;
;

META: decode
  use-when "You have IEEE 754 bytes, such as a float field from a binary file or a sensor record, and want the decimal numbers they hold." ;
  param size "Bits per number: 32 (binary32) or 64 (binary64)." ;
  param endian "Byte order of each number." ;
  inverse encode ;
  see-also float:encode ;
  link "https://en.wikipedia.org/wiki/IEEE_754" "IEEE 754 on Wikipedia" ;
;
