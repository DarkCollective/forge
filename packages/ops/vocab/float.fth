\ float: IEEE 754 binary32 and binary64 numbers as bytes, and as decimal text (IEEE 754-2019,
\ clauses 3.4 and 5.12). The splitting, looping and parameters are FL; the conversion of one number
\ is done by the private primitives _pack and _unpack (src/prims/float.ts), because the core cannot
\ reinterpret float bits, parse decimal text to a float, or hold NaN and the infinities.
\
\ Convention for several values: the text is numbers separated by white space and/or commas; the bytes
\ are the numbers one after another, each size/8 bytes.
IN: float

: encode ( str size:choice{32|64}=64 endian:choice{big|little}=big -- bytes )
  "Convert decimal numbers to IEEE 754 bytes (binary32 or binary64). The text is numbers separated by white space and/or commas, with an optional sign, a decimal point and a power-of-ten exponent (1.5, -2e-3, .5), or NaN, Infinity and -Infinity (any case, inf also accepted); the result is the numbers one after another, 4 or 8 bytes each in the chosen byte order. Negative zero (-0) is kept. A finite number too large for the format, or any other text, raises E_COERCE. Empty text gives empty bytes. Binary32 values are rounded to nearest (through binary64 first)." doc
  "Encodings" category
  str>codes [ dup util:space-or-comma? [ drop 32 ] when ] map codes>str
  " " split [ len 0 > ] filter
  [ size str>int endian "little" = _pack ] map
  #[ ] bjoin ;

\ The numbers of the data, w bytes each, as text separated by single spaces.
: _numbers ( data:bytes w:int little:bool -- str )
  0 data len w div range
  [ w * dup w + data -rot slice little _unpack ] map
  " " join ;

: decode ( bytes size:choice{32|64}=64 endian:choice{big|little}=big -- str )
  "Convert IEEE 754 bytes (binary32 or binary64, in the chosen byte order) to decimal text: the shortest text that reads back as the same number, one number per 4 or 8 bytes, separated by single spaces (JavaScript number notation, so large and small values use e notation). NaN, Infinity, -Infinity and -0 are written as such (NaN payloads are not kept). A length that is not a whole number of values raises E_COERCE. Empty input gives empty text." doc
  "Encodings" category
  dup len size str>int 8 div mod 0 <>
  [ "the length is not a whole number of values" raise:coerce ] when
  size str>int 8 div endian "little" = _numbers ;

META: encode
  param size "Bits per number: 32 (binary32) or 64 (binary64)." ;
  param endian "Byte order of each number." ;
;

META: decode
  param size "Bits per number: 32 (binary32) or 64 (binary64)." ;
  param endian "Byte order of each number." ;
  see-also float:encode ;
;
