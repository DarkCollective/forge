\ decimal: byte values as decimal numbers 0..255. The words are FL and need no primitive;
\ E_COERCE comes from the raise vocabulary (raise:coerce).
IN: decimal

: _sep ( d:str -- str )
  d "comma" = [ "," ] [ d "newline" = [ "\n" ] [ " " ] if ] if ;

: _sep-byte? ( b:int -- bool )
  b 32 = b 44 = or b 9 >= b 13 <= and or ;

: _dec-value ( t:str -- int )
  t 0 1 slice "-" = [ "a decimal byte is 0 to 255" raise:coerce ] when
  t str>int
  dup 255 > [ "a decimal byte is 0 to 255" raise:coerce ] when ;

: encode ( bytes delimiter:choice{space|comma|newline}=space -- str )
  "Each byte as a decimal number, 0 to 255, separated by the delimiter." doc
  "Encodings" category
  bytes>list [ int>str ] map delimiter _sep join ;

: decode ( bytes -- bytes )
  "Decode decimal numbers 0 to 255 separated by white space and/or commas." doc
  "Encodings" category
  [ dup _sep-byte? [ drop 32 ] when ] map bytes>latin1 " " split
  [ len 0 > ] filter [ _dec-value ] map list>bytes ;

META: encode
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
;
