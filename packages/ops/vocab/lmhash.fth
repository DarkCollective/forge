\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lmhash: the LAN Manager password hash (MS-NLMP 3.3.1 LMOWFv1). The text is upper-cased, encoded as
\ ISO 8859-1, zero-padded or truncated to 14 bytes, and the constant "KGS!@#$%" is DES-encrypted under
\ each 7-byte half. Upper-casing comes before the truncation, as CyberChef's "LM Hash" does. The DES
\ work is the public des:encrypt, used for one block in ECB with no padding. Its own vocabulary, like
\ nthash, because its input is text.
IN: lmhash

\ Group i of the 56 bits of the bytes b (a zero byte is added so the last group can read two bytes): the
\ 7 bits that start at bit 7 i, most significant bit first, in a 16-bit window over bytes k and k + 1.
: _group ( b:list i:int -- int )
  i 7 * :> p
  p 8 div :> k
  b k nth 256 * b k 1 + nth + 9 p 8 mod - shr 127 band ;

\ The 8-byte DES key of 7 bytes (56 bits): eight 7-bit groups, each in the high bits of a byte. The parity
\ bit is left clear, and DES ignores it.
: _des-key ( h:bytes -- bytes )
  h #[ 00 ] cat bytes>list :> b
  0 8 range [ b swap _group 1 shl ] map list>bytes ;

\ "KGS!@#$%" encrypted under the key made of a 7-byte half.
: _half ( h:bytes -- bytes )
  #[ 4b 47 53 21 40 23 24 25 ] h _des-key #[ ] "ECB" "none" des:encrypt ;

: digest ( text:str -- bytes )
  "The LM hash of a password: the text is upper-cased, encoded as ISO 8859-1, zero-padded or cut to 14 bytes, and the constant KGS!@#$% is DES-encrypted under each 7-byte half; 16 raw bytes. Chain hex:encode for hex text. A very weak legacy hash: do not use it to store passwords." doc
  "Hashing" category
  text upper "iso-8859-1" charset:encode 14 zero-bytes cat 0 14 slice :> padded
  padded 0 7 slice _half padded 7 14 slice _half cat ;

META: digest
  use-when "You have a LAN Manager hash from an old Windows store and want to reproduce it from a password, to compare them. Do not use it to store passwords." ;
  see-also nthash:digest hex:encode ;
  link "https://en.wikipedia.org/wiki/LAN_Manager" "LAN Manager on Wikipedia" ;
;
