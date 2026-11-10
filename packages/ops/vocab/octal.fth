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
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
  see-also octal:decode decimal:encode ;
;

META: decode
  see-also octal:encode decimal:decode ;
;
