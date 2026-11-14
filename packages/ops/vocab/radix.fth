\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ radix: rewrite an integer of any size from one base to another. Written in FL on top of its big
\ integers (str>int-radix, int>str-radix); the integer limit (maxIntBits, 65 536 bits) caps the size
\ of the number with E_LIMIT_VALUE. E_COERCE comes from the core words on a bad digit.
IN: radix

: convert ( str from:int[2..36]=10 to:int[2..36]=16 -- str )
  "Rewrite an integer from one base (2 to 36) into another. An optional leading - is kept, digits may be in either case, white space is ignored and the result has lower-case digits and no leading zeros. A bad digit is E_COERCE; a number over about 65 000 bits is E_LIMIT_VALUE." doc
  "Encodings" category
  [ util:space? not ] filter from str>int-radix to int>str-radix ;

META: convert
  use-when "You have a whole number written in one base, such as hex or binary, and want it written in another, for example a hex value in decimal." ;
  link "https://en.wikipedia.org/wiki/Radix" "Radix on Wikipedia" ;
  param from "The base of the input text, 2 to 36 (digits 0-9 then a-z)." ;
  param to "The base of the result, 2 to 36." ;
  checks input charset "0-9A-Za-z \t\n\x0b\x0c\r-" ;
  expects "integer text" ;
  checks output charset "0-9a-z-" ;
;
