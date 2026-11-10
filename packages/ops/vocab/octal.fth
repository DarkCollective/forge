\ octal: byte values as octal numbers 0..377 (no leading zeros are written). The words are FL and need
\ no primitive; E_COERCE comes from the raise vocabulary (raise:coerce).
IN: octal

: _oct-value ( t:str -- int )
  t 0 1 slice "-" = [ "an octal byte is 0 to 377" raise:coerce ] when
  t 8 str>int-radix
  dup 255 > [ "an octal byte is 0 to 377" raise:coerce ] when ;

: encode ( bytes delimiter:choice{space|comma|newline}=space -- str )
  "Each byte as an octal number, 0 to 377, separated by the delimiter." doc
  "Encodings" category
  bytes>list [ 8 int>str-radix ] map delimiter util:separator join ;

: decode ( bytes -- bytes )
  "Decode octal numbers 0 to 377 separated by white space and/or commas." doc
  "Encodings" category
  [ dup util:space-or-comma? [ drop 32 ] when ] map bytes>latin1 " " split
  [ len 0 > ] filter [ _oct-value ] map list>bytes ;

META: encode
  param delimiter "What to put between the numbers: a space, a comma or a newline." ;
  see-also octal:decode decimal:encode ;
;

META: decode
  see-also octal:encode decimal:decode ;
;
