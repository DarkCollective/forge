\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ units: unit conversion (distance, area, mass, speed, data) in exact rational arithmetic, written in
\ FL on the core words; no primitives. Every unit is a ratio to a base unit (metre, square metre,
\ kilogram, metre per second, bit) taken from an exact definition (SI, the international yard and
\ pound of 1959, NIST SP 811 appendix B), so the only rounding is the last one, to a number of
\ significant digits. CyberChef does the same sums in BigNumber; the unit lists here are Forge's own.
IN: units

\ ---- decimal text to a fraction ----

\ An unsigned whole number in digits (str>int does the rest: anything but -?[0-9]+ is E_COERCE).
: _uint ( s:str -- int )
  s "-" util:starts-with? [ "not a number" raise:coerce ] when s str>int ;

: _unsigned ( s:str -- str )
  s "-" util:starts-with? s "+" util:starts-with? or [ s 1 s len slice ] [ s ] if ;

: _sign-of ( s:str -- int )
  s "-" util:starts-with? [ -1 ] [ 1 ] if ;

\ ip and fp are the digits before and after the point; the fraction n/d of the number.
: _frac ( ip:str fp:str -- int int )
  ip fp cat _uint 10 fp len pow ;

: _frac-list ( parts:list -- int int )
  parts len 1 = [ parts 0 nth "" _frac ]
  [ parts len 2 = [ parts 0 nth parts 1 nth _frac ] [ "not a number" raise:coerce 0 0 ] if ] if ;

\ n/d times ten to the power ex.
: _scale ( n:int d:int ex:int -- int int )
  ex 0 >= [ n 10 ex pow * d ] [ n d 10 ex neg pow * ] if ;

: _exponent ( t:str -- int )
  t _unsigned _uint t _sign-of *
  dup abs 400 > [ "the exponent is too large" raise:range ] when ;

: _signed-scaled ( m:str ex:int -- int int )
  m _unsigned "." split _frac-list ex _scale
  swap m _sign-of * swap ;

: _parse-parts ( parts:list -- int int )
  parts len 1 = [ parts 0 nth 0 _signed-scaled ]
  [ parts len 2 = [ parts 0 nth parts 1 nth _exponent _signed-scaled ] [ "not a number" raise:coerce 0 0 ] if ] if ;

: _parse-decimal ( text:str -- int int )
  text [ util:space? ] util:trim-start [ util:space? ] util:trim-end lower "e" split _parse-parts ;

\ ---- a fraction to decimal text ----

\ The e with 10^e <= a/d < 10^(e+1), given l = the digits of a minus the digits of d (a above 0).
: _exp10-from ( a:int d:int l:int -- int )
  l 0 >= [ a d 10 l pow * >= ] [ a 10 l neg pow * d >= ] if
  [ l ] [ l 1 - ] if ;

: _exp10 ( a:int d:int -- int )
  a d a int>str len d int>str len - _exp10-from ;

\ a/d times ten to the power p, rounded to an integer.
: _scaled ( a:int d:int p:int -- int )
  p 0 >= [ a 10 p pow * d ] [ a d 10 p neg pow * ] if util:round-div ;

\ The digits with a decimal point p places from the end (none for p of 0 or less, which adds zeros
\ instead); trailing zeros after the point go.
: _point ( padded:str p:int -- str )
  padded 0 padded len p - slice
  padded padded len p - padded len slice [ 48 = ] util:trim-end
  dup len 0 = [ drop ] [ "." swap cat cat ] if ;

: _place-point ( digits:str p:int -- str )
  p 0 <=
  [ digits "0" p neg util:repeat-str cat ]
  [ "0" p 1 + digits len - 0 max util:repeat-str digits cat p _point ] if ;

: _format-p ( a:int d:int p:int neg:bool -- str )
  a d p _scaled int>str p _place-point
  neg [ "-" swap cat ] when ;

: _format-pos ( a:int d:int sig:int neg:bool -- str )
  a d sig 1 - a d _exp10 - neg _format-p ;

\ n/d as decimal text rounded to sig significant digits (halves away from zero), never in
\ exponent form.
: _format ( n:int d:int sig:int -- str )
  n 0 = [ "0" ] [ n abs d sig n 0 < _format-pos ] if ;

\ ---- the conversion ----

\ The ratio of a unit to the base unit, from a table of "name numerator denominator" entries.
: _factor ( table:str unit:str -- int int )
  table ";" split [ unit " " cat util:starts-with? ] filter
  dup len 1 = not [ "unknown unit" raise:range ] when
  0 nth " " split dup 1 nth str>int swap 2 nth str>int ;

: _combine ( fn:int fd:int tn:int td:int vn:int vd:int -- int int )
  vn fn * td * vd fd * tn * ;

: _convert ( value:str from:str to:str table:str digits:int -- str )
  table from _factor
  table to _factor
  value _parse-decimal
  _combine digits _format ;

: _distance ( -- str )
  "picometre 1 1000000000000;nanometre 1 1000000000;micrometre 1 1000000;millimetre 1 1000;centimetre 1 100;metre 1 1;kilometre 1000 1;angstrom 1 10000000000;thou 254 10000000;inch 254 10000;foot 3048 10000;yard 9144 10000;mile 1609344 1000;nautical-mile 1852 1;furlong 201168 1000;fathom 18288 10000;astronomical-unit 149597870700 1;light-year 9460730472580800 1" ;

: _area ( -- str )
  "square-millimetre 1 1000000;square-centimetre 1 10000;square-metre 1 1;are 100 1;hectare 10000 1;square-kilometre 1000000 1;square-inch 64516 100000000;square-foot 9290304 100000000;square-yard 83612736 100000000;acre 40468564224 10000000;square-mile 2589988110336 1000000" ;

: _mass ( -- str )
  "microgram 1 1000000000;milligram 1 1000000;gram 1 1000;kilogram 1 1;tonne 1000 1;carat 1 5000;grain 6479891 100000000000;ounce 45359237 1600000000;pound 45359237 100000000;stone 635029318 100000000;short-ton 90718474 100000;long-ton 101604690880 100000000;troy-ounce 311034768 10000000000" ;

: _speed ( -- str )
  "centimetre-per-second 1 100;metre-per-second 1 1;kilometre-per-second 1000 1;kilometre-per-hour 5 18;mile-per-hour 44704 100000;knot 463 900;foot-per-second 3048 10000;speed-of-light 299792458 1" ;

: _data ( -- str )
  "bit 1 1;nibble 4 1;byte 8 1;kilobit 1000 1;megabit 1000000 1;gigabit 1000000000 1;terabit 1000000000000 1;kibibit 1024 1;mebibit 1048576 1;gibibit 1073741824 1;tebibit 1099511627776 1;kilobyte 8000 1;megabyte 8000000 1;gigabyte 8000000000 1;terabyte 8000000000000 1;petabyte 8000000000000000 1;exabyte 8000000000000000000 1;kibibyte 8192 1;mebibyte 8388608 1;gibibyte 8589934592 1;tebibyte 8796093022208 1;pebibyte 9007199254740992 1;exbibyte 9223372036854775808 1" ;

: convert-distance ( value:str from:choice{picometre|nanometre|micrometre|millimetre|centimetre|metre|kilometre|angstrom|thou|inch|foot|yard|mile|nautical-mile|furlong|fathom|astronomical-unit|light-year}="metre" to:choice{picometre|nanometre|micrometre|millimetre|centimetre|metre|kilometre|angstrom|thou|inch|foot|yard|mile|nautical-mile|furlong|fathom|astronomical-unit|light-year}="kilometre" digits:int[1..60]=20 -- str )
  "A length converted from one unit to another. The value is decimal text (an optional sign, digits with an optional point, an optional exponent such as 1.5e3); anything else is an error. The sum is exact (the units are defined as exact ratios of the metre: the inch is 0.0254 m, the nautical mile 1852 m, the astronomical unit 149,597,870,700 m, the light year 9,460,730,472,580,800 m), and the result is rounded half away from zero to the given number of significant digits (20 by default) and written in plain decimal form with no trailing zeros." doc
  "Conversions" category
  value from to _distance digits _convert ;

: convert-area ( value:str from:choice{square-millimetre|square-centimetre|square-metre|are|hectare|square-kilometre|square-inch|square-foot|square-yard|acre|square-mile}="square-metre" to:choice{square-millimetre|square-centimetre|square-metre|are|hectare|square-kilometre|square-inch|square-foot|square-yard|acre|square-mile}="hectare" digits:int[1..60]=20 -- str )
  "An area converted from one unit to another. The value is decimal text (an optional sign, digits with an optional point, an optional exponent); anything else is an error. The sum is exact (the international inch, foot and yard give the square inch 0.00064516 m2, the acre 4046.8564224 m2 and the square mile 2,589,988.110336 m2), and the result is rounded half away from zero to the given number of significant digits (20 by default) and written in plain decimal form with no trailing zeros." doc
  "Conversions" category
  value from to _area digits _convert ;

: convert-mass ( value:str from:choice{microgram|milligram|gram|kilogram|tonne|carat|grain|ounce|pound|stone|short-ton|long-ton|troy-ounce}="kilogram" to:choice{microgram|milligram|gram|kilogram|tonne|carat|grain|ounce|pound|stone|short-ton|long-ton|troy-ounce}="pound" digits:int[1..60]=20 -- str )
  "A mass converted from one unit to another. The value is decimal text (an optional sign, digits with an optional point, an optional exponent); anything else is an error. The sum is exact (the international pound is 0.45359237 kg, the ounce a sixteenth of it, the stone 14 pounds, the short ton 2000 and the long ton 2240 pounds, the grain 64.79891 mg, the metric carat 200 mg, the troy ounce 31.1034768 g), and the result is rounded half away from zero to the given number of significant digits (20 by default) and written in plain decimal form with no trailing zeros." doc
  "Conversions" category
  value from to _mass digits _convert ;

: convert-speed ( value:str from:choice{centimetre-per-second|metre-per-second|kilometre-per-second|kilometre-per-hour|mile-per-hour|knot|foot-per-second|speed-of-light}="metre-per-second" to:choice{centimetre-per-second|metre-per-second|kilometre-per-second|kilometre-per-hour|mile-per-hour|knot|foot-per-second|speed-of-light}="kilometre-per-hour" digits:int[1..60]=20 -- str )
  "A speed converted from one unit to another. The value is decimal text (an optional sign, digits with an optional point, an optional exponent); anything else is an error. The sum is exact (the mile per hour is 0.44704 m/s, the knot 1852 m per hour, the speed of light 299,792,458 m/s), and the result is rounded half away from zero to the given number of significant digits (20 by default) and written in plain decimal form with no trailing zeros. Mach is not offered: it depends on the air." doc
  "Conversions" category
  value from to _speed digits _convert ;

: convert-data ( value:str from:choice{bit|nibble|byte|kilobit|megabit|gigabit|terabit|kibibit|mebibit|gibibit|tebibit|kilobyte|megabyte|gigabyte|terabyte|petabyte|exabyte|kibibyte|mebibyte|gibibyte|tebibyte|pebibyte|exbibyte}="byte" to:choice{bit|nibble|byte|kilobit|megabit|gigabit|terabit|kibibit|mebibit|gibibit|tebibit|kilobyte|megabyte|gigabyte|terabyte|petabyte|exabyte|kibibyte|mebibyte|gibibyte|tebibyte|pebibyte|exbibyte}="bit" digits:int[1..60]=20 -- str )
  "An amount of data converted from one unit to another. The value is decimal text (an optional sign, digits with an optional point, an optional exponent); anything else is an error. The decimal units (kilo, mega, giga, tera, peta, exa) are powers of 1000 and the binary units (kibi, mebi, gibi, tebi, pebi, exbi: IEC 80000-13) powers of 1024; a byte is 8 bits and a nibble 4. The sum is exact and the result is rounded half away from zero to the given number of significant digits (20 by default) and written in plain decimal form with no trailing zeros." doc
  "Conversions" category
  value from to _data digits _convert ;

META: convert-distance
  param from "The unit the value is in." ;
  param to "The unit to convert to." ;
  param digits "How many significant digits to keep (1 to 60)." ;
  see-also units:convert-area units:convert-mass units:convert-speed units:convert-data ;
;

META: convert-area
  param from "The unit the value is in." ;
  param to "The unit to convert to." ;
  param digits "How many significant digits to keep (1 to 60)." ;
  see-also units:convert-distance units:convert-mass units:convert-speed units:convert-data ;
;

META: convert-mass
  param from "The unit the value is in." ;
  param to "The unit to convert to." ;
  param digits "How many significant digits to keep (1 to 60)." ;
  see-also units:convert-distance units:convert-area units:convert-speed units:convert-data ;
;

META: convert-speed
  param from "The unit the value is in." ;
  param to "The unit to convert to." ;
  param digits "How many significant digits to keep (1 to 60)." ;
  see-also units:convert-distance units:convert-area units:convert-mass units:convert-data ;
;

META: convert-data
  param from "The unit the value is in." ;
  param to "The unit to convert to." ;
  param digits "How many significant digits to keep (1 to 60)." ;
  see-also units:convert-distance units:convert-area units:convert-mass units:convert-speed ;
;
