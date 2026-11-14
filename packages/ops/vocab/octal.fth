\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ octal: byte values as octal numbers 0..377 (no leading zeros are written). The words are FL and need
\ no primitive; E_COERCE comes from the raise vocabulary (raise:coerce).
IN: octal

: encode ( bytes delimiter:choice{space|comma|newline}=space -- str )
  "Each byte as an octal number, 0 to 377, separated by the delimiter." doc
  "Encodings" category
  bytes>list [ 8 int>str-radix ] map delimiter util:separator join ;

: decode ( bytes -- bytes )
  "Decode octal numbers 0 to 377 separated by white space and/or commas." doc
  "Encodings" category
  8 "an octal byte is 0 to 377" util:numbers>bytes ;

META: encode
  use-when "You want bytes written as octal numbers from 0 to 377, for example to match the three-digit octal escapes that some languages use in strings." ;
  link "https://en.wikipedia.org/wiki/Octal" "Octal on Wikipedia" ;
  inverse decode ;
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
  see-also octal:decode decimal:encode ;
  checks output charset "0-7 ,\n" ;
;

META: decode
  use-when "You have octal numbers from 0 to 377, separated by spaces or commas, and want the bytes they stand for." ;
  link "https://en.wikipedia.org/wiki/Octal" "Octal on Wikipedia" ;
  inverse encode ;
  see-also octal:encode decimal:decode ;
  checks input charset "0-7, \t\n\x0b\x0c\r" ;
  expects "octal byte values" ;
;
