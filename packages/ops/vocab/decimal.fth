\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ decimal: byte values as decimal numbers 0..255. The words are FL and need no primitive;
\ E_COERCE comes from the raise vocabulary (raise:coerce).
IN: decimal

: encode ( bytes delimiter:choice{space|comma|newline}=space -- str )
  "Each byte as a decimal number, 0 to 255, separated by the delimiter." doc
  "Encodings" category
  bytes>list [ int>str ] map delimiter util:separator join ;

: decode ( bytes -- bytes )
  "Decode decimal numbers 0 to 255 separated by white space and/or commas." doc
  "Encodings" category
  10 "a decimal byte is 0 to 255" util:numbers>bytes ;

META: encode
  use-when "You have bytes or text and want each byte as a decimal number from 0 to 255, for example 65 66 for the letters AB." ;
  link "https://en.wikipedia.org/wiki/ASCII" "ASCII on Wikipedia" ;
  inverse decode ;
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
  checks output charset "0-9 ,\n" ;
;

META: decode
  use-when "You have decimal numbers from 0 to 255, separated by spaces or commas, and want the bytes they stand for." ;
  link "https://en.wikipedia.org/wiki/ASCII" "ASCII on Wikipedia" ;
  inverse encode ;
  checks input charset "0-9, \t\n\x0b\x0c\r" ;
  expects "decimal byte values" ;
;
