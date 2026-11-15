\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ binary: binary text, one 0 or 1 digit per bit, eight digits per byte. The words are FL and
\ need no primitive; E_COERCE is raised with the core word fail-coerce.
IN: binary

: _byte-bits ( b:int -- str )
  b 256 + 2 int>str-radix 1 9 slice ;

: _bit ( b:int -- int )
  {
    [ b 48 = ] [ 0 ]
    [ b 49 = ] [ 1 ]
    [ "a binary digit is 0 or 1" fail-coerce ]
  } cond ;

: _byte-of ( bits:list i:int -- int )
  bits i 8 * dup 8 + slice list>bytes 2 digits>int ;

: _bits-bytes ( bits:list -- bytes )
  bits len 8 mod 0 = not [ "binary digits come in groups of eight" fail-coerce ] when
  bits len 8 div 0 swap range [ bits swap _byte-of ] map list>bytes ;

: encode ( bytes delimiter:choice{space|none|comma|newline}=space -- str )
  "Each byte as eight binary digits, most significant bit first, separated by the delimiter." doc
  "Encodings" category
  bytes>list [ _byte-bits ] map delimiter util:separator join ;

META: encode
  use-when "You want to see the bits of some bytes as 0 and 1 digits, for example to check a flag byte or a bit mask." ;
  param delimiter "What to put between the bytes: a space, nothing, a comma or a newline." ;
  inverse decode ;
  link "https://en.wikipedia.org/wiki/Binary_number" "Binary number on Wikipedia" ;
  checks output charset "01 ,\n" ;
;

: decode ( bytes -- bytes )
  "Decode 0 and 1 digits, eight per byte. ASCII white space and commas are ignored." doc
  "Encodings" category
  bytes>list [ util:space-or-comma? not ] filter [ _bit ] map _bits-bytes ;

META: decode
  use-when "You have a string of 0 and 1 digits, such as a bit pattern copied from a specification, and want the bytes it stands for." ;
  inverse encode ;
  link "https://en.wikipedia.org/wiki/Binary_number" "Binary number on Wikipedia" ;
  checks input charset "01, \t\n\x0b\x0c\r" ;
  expects "binary digits" ;
;
