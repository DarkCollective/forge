\ binary: binary text, one 0 or 1 digit per bit, eight digits per byte. The words are FL and
\ need no primitive; E_COERCE comes from the raise vocabulary (raise:coerce).
IN: binary

: _byte-bits ( b:int -- str )
  b 256 + 2 int>str-radix 1 9 slice ;

: _bit ( b:int -- int )
  b 48 = [ 0 ] [ b 49 = [ 1 ] [ "a binary digit is 0 or 1" raise:coerce ] if ] if ;

: _byte-of ( bits:list i:int -- int )
  bits i 8 * dup 8 + slice 0 [ swap 2 * + ] reduce ;

: _bits-bytes ( bits:list -- bytes )
  bits len 8 mod 0 = not [ "binary digits come in groups of eight" raise:coerce ] when
  bits len 8 div 0 swap range [ bits swap _byte-of ] map list>bytes ;

: encode ( bytes delimiter:choice{space|none|comma|newline}=space -- str )
  "Each byte as eight binary digits, most significant bit first, separated by the delimiter." doc
  "Encodings" category
  bytes>list [ _byte-bits ] map delimiter util:separator join ;

: decode ( bytes -- bytes )
  "Decode 0 and 1 digits, eight per byte. ASCII white space and commas are ignored." doc
  "Encodings" category
  bytes>list [ util:space-or-comma? not ] filter [ _bit ] map _bits-bytes ;

META: encode
  param delimiter "What to put between the bytes: a space, nothing, a comma or a newline." ;
;
