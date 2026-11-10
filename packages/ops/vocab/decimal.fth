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
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
;
