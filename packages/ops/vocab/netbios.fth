\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ netbios: Encode NetBIOS Name and Decode NetBIOS Name (WP 5.53), the first-level encoding of RFC 1001 section 14.1:
\ a NetBIOS name is 16 bytes (padded with spaces), and each byte becomes two bytes, one for each half byte (nibble),
\ written as the nibble plus an offset (65, the letter A, in the RFC). All FL.
IN: netbios

: _check-offset ( offset:int -- )
  offset 0 240 "offset" util:check-int-range ;

\ The 16 bytes of a name, padded with spaces; more than 16 bytes is E_RANGE.
: _padded ( name:bytes -- bytes )
  name len 16 > [ "a NetBIOS name is at most 16 bytes, not " name len int>str cat raise:range ] when
  name "                " str>bytes 0 16 name len - slice cat ;

: encode ( name:bytes offset:int=65 -- bytes )
  "The first-level encoding of a NetBIOS name (RFC 1001 section 14.1): the name is padded with spaces to 16 bytes, and every byte is written as two bytes, the high half byte plus offset and then the low half byte plus offset, 32 bytes in all. With offset 65 (the default) the result is the letters A to P; FRED gives EGFCEFEECACACACACACACACACACACACA. A name of more than 16 bytes is E_RANGE (CyberChef answers nothing); offset must be 0 to 240 so that every byte fits. The second level (the compressed DNS form) is not done." doc
  "Networking" category
  offset _check-offset
  name _padded bytes>list
  [ dup 4 shr offset + util:cp>str swap 15 band offset + util:cp>str cat ] map
  "" join latin1>bytes ;

\ Two nibbles (the bytes minus offset) to a byte; a byte that is not offset to offset + 15 is E_COERCE.
: _nibble ( b:int offset:int -- int )
  b offset -
  dup 0 15 util:between? not [ "byte " b int>str cat " is not offset plus a half byte (offset to offset + 15)" cat raise:coerce ] when ;

: _pair ( nibbles:list i:int -- int )
  nibbles i 2 * nth 4 shl nibbles i 2 * 1 + nth + ;

: _pairs ( nibbles:list -- bytes )
  0 nibbles len 2 div range [ nibbles swap _pair ] map list>bytes ;

\ Trailing spaces off, but never the first byte.
: _unpad ( b:bytes -- bytes )
  b len 0 =
  [ b ]
  [ b bytes>latin1 [ 32 = ] util:trim-end dup len 0 = [ drop " " ] when latin1>bytes ] if ;

: decode ( name:bytes offset:int=65 -- bytes )
  "Undoes the first-level encoding of RFC 1001 section 14.1: every two bytes become one, (first minus offset) times 16 plus (second minus offset), and trailing spaces (the padding) are removed. The input is up to 32 bytes and an even number of them; a byte that is not offset to offset + 15 is E_COERCE, so is an odd or longer input (CyberChef answers nothing). offset is 65 by default and must be 0 to 240. The decoded name keeps at least its first byte, so a name of only spaces decodes to one space." doc
  "Networking" category
  offset _check-offset
  name len 2 mod 0 <> name len 32 > or
  [ "a first-level encoded NetBIOS name is 32 bytes (an even number, at most 32), not " name len int>str cat raise:coerce ] when
  name bytes>list [ offset _nibble ] map _pairs _unpad ;

META: encode
  param offset "Added to each half byte: 65 (the letter A) in RFC 1001." ;
  see-also netbios:decode ;
;

META: decode
  param offset "Subtracted from each byte: 65 (the letter A) in RFC 1001." ;
  see-also netbios:encode ;
;
