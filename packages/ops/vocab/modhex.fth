\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ modhex: Yubico ModHex, a hexadecimal whose digits 0 to f are the keyboard-layout-independent
\ letters cbdefghijklnrtuv (Yubico "Modhex" documentation). The words are FL; E_COERCE comes from
\ the raise vocabulary (raise:coerce).
IN: modhex

: _alpha ( -- str )
  "cbdefghijklnrtuv" ;

: encode ( bytes delimiter:choice{none|space}=none -- str )
  "Each byte as two ModHex letters (cbdefghijklnrtuv for 0 to f), optionally separated by spaces." doc
  "Encodings" category
  bytes>list [ dup 16 div _alpha swap nth swap 15 band _alpha swap nth cat ] map
  delimiter util:separator join ;

\ 255 for a byte outside the alphabet, 254 for ASCII white space, else the digit value.
: _table ( -- bytes )
  _alpha 254 255 util:decode-table ;

: _pack ( nib:bytes -- bytes )
  nib len 2 mod 1 = [ "an odd number of ModHex letters" raise:coerce ] when
  0 nib len 2 div range [ nib swap util:nibbles>byte ] map list>bytes ;

: decode ( bytes -- bytes )
  "Decode ModHex text to bytes. White space is ignored and upper case is accepted; an odd number of letters is E_COERCE." doc
  "Encodings" category
  bytes>latin1 lower latin1>bytes _table util:check-symbols [ 254 <> ] filter _pack ;

META: encode
  use-when "You have bytes or hex digits and need them as ModHex letters, for example to write the public ID of a YubiKey." ;
  link "https://www.yubico.com/" "Yubico, the makers of the YubiKey" ;
  inverse decode ;
  param delimiter "What to put between the bytes: nothing or a space." ;
  see-also modhex:decode hex:encode ;
  checks output charset "cbdefghijklnrtuv " ;
;

META: decode
  use-when "You have ModHex letters, such as the part of a YubiKey one-time password that is ModHex, and want the bytes they stand for." ;
  link "https://www.yubico.com/" "Yubico, the makers of the YubiKey" ;
  inverse encode ;
  see-also modhex:encode hex:decode ;
  checks input charset "cbdefghijklnrtuvCBDEFGHIJKLNRTUV \t\n\x0b\x0c\r" ;
  expects "ModHex text" ;
;
