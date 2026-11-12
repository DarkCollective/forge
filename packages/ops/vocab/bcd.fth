\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bcd: binary-coded decimal. Written in FL; there are no primitives. Each decimal digit is a 4-bit
\ code (a nibble) in one of four schemes; the digits are packed two to a byte, most significant first,
\ or kept one per byte.
\
\ Digit codes (Wikipedia, "Binary-coded decimal"; the weights are listed per scheme):
\   8421      natural BCD: the digit as a 4-bit binary number.
\   7421      weights 7, 4, 2, 1: digits 0 to 6 as in 8421, then 7 = 1000, 8 = 1001, 9 = 1010.
\   4221      weights 4, 2, 2, 1, in the self-complementary assignment (the code of 9 - d is the bit
\             complement of the code of d): 0 to 3 as in 8421, then 4 = 1000, 5 = 0111, 6 = 1100,
\             7 = 1101, 8 = 1110, 9 = 1111. (The article lists more than one 4221 assignment; this is
\             the self-complementary one.)
\   excess-3  the digit plus 3 as a 4-bit number (Stibitz code): 0 = 0011 .. 9 = 1100.
\ Sign nibble of signed packed decimal (the same article, section on packed decimal, and IBM z/Architecture
\ Principles of Operation, "Decimal-number formats"): C = plus, D = minus on output; on input
\ A, C, E and F are plus and B and D are minus. F also marks unsigned data in IBM formats.
IN: bcd

\ ---- tables ----

\ The ten digit codes of a scheme.
: _codes ( scheme:str -- bytes )
  scheme "8421" =
  [ #[ 00 01 02 03 04 05 06 07 08 09 ] ]
  [ scheme "7421" =
    [ #[ 00 01 02 03 04 05 06 08 09 0a ] ]
    [ scheme "4221" =
      [ #[ 00 01 02 03 08 07 0c 0d 0e 0f ] ]
      [ #[ 03 04 05 06 07 08 09 0a 0b 0c ] ]
      if ]
    if ]
  if ;

\ The digit whose code is n, or 255.
: _digit-of ( codes:bytes n:int -- int )
  0 10 range [ codes swap nth n = ] filter
  dup len 0 = [ drop 255 ] [ 0 nth ] if ;

\ Sixteen entries: nibble value to digit, 255 for a nibble that is no digit of the scheme.
: _decode-table ( codes:bytes -- bytes )
  0 16 range [ codes swap _digit-of ] map list>bytes ;

\ ---- encode ----

: _clean ( text:str -- list )
  text util:strip-space str>codes ;

: _has-sign ( cs:list signed:bool -- bool )
  signed cs len 0 > and
  [ cs 0 nth dup 43 = swap 45 = or ]
  [ false ]
  if ;

\ The digits (character codes) without a leading sign, and whether the sign is a minus.
: _split-sign ( cs:list signed:bool -- list bool )
  cs signed _has-sign
  [ cs 1 cs len slice cs 0 nth 45 = ]
  [ cs false ]
  if ;

: _check-digits ( digits:list -- )
  digits len 0 = [ "a number needs at least one digit" raise:coerce ] when
  digits [ dup 48 < swap 57 > or ] filter len 0 >
  [ "not a decimal digit" raise:coerce ] when ;

\ The nibbles of the digits, followed by the sign nibble when signed.
: _nibbles ( digits:list codes:bytes neg:bool signed:bool -- list )
  digits [ 48 - codes swap nth ] map
  signed [ { neg [ 13 ] [ 12 ] if } cat ] when ;

\ Two nibbles to a byte, most significant first.
: _pack ( l:list -- bytes )
  0 l len 2 div range [ l swap util:nibbles>byte ] map list>bytes ;

\ A leading zero digit code when the number of nibbles is odd.
: _even ( l:list zero:int -- list )
  l len 2 mod 1 = [ { zero } l cat ] [ l ] if ;

\ One digit nibble per byte; with a sign, it is the high nibble of the last byte.
: _unpack ( l:list signed:bool -- bytes )
  signed
  [ l 0 l len 2 - slice list>bytes
    { l l len 2 - nth l l len 1 - nth 4 shl bor } list>bytes cat ]
  [ l list>bytes ]
  if ;

: _encode ( digits:list neg:bool scheme:str packed:bool signed:bool -- bytes )
  digits _check-digits
  digits scheme _codes neg signed _nibbles
  packed
  [ scheme _codes 0 nth _even _pack ]
  [ signed _unpack ]
  if ;

: encode ( str scheme:choice{8421|7421|4221|excess-3}=8421 packed:bool=true signed:bool=false -- bytes )
  "Encode decimal digits as binary-coded decimal. Schemes: 8421 (natural BCD), 7421, 4221 (self-complementary) and excess-3. Packed gives two digits per byte, most significant first, with a leading zero digit if the count is odd; unpacked gives one digit per byte (high nibble 0). Signed accepts an optional + or - and adds a sign nibble, C for plus and D for minus: the last nibble of packed data, or the high nibble of the last byte when unpacked. White space is ignored; a character that is not a digit (or a sign when not signed) raises E_COERCE. Empty text gives empty bytes." doc
  "Encodings" category
  _clean dup len 0 =
  [ drop #[ ] ]
  [ signed _split-sign scheme packed signed _encode ]
  if ;

META: encode
  use-when "You have decimal digits and need them as binary-coded decimal bytes, for example a packed number in a mainframe or COBOL record, or a code such as excess-3." ;
  link "https://en.wikipedia.org/wiki/Binary-coded_decimal" "Binary-coded decimal on Wikipedia" ;
  inverse decode ;
  param scheme "The digit code: 8421, 7421, 4221 or excess-3." ;
  param packed "Two digits per byte (otherwise one digit per byte)." ;
  param signed "Accept a leading + or - and add a sign nibble (C plus, D minus)." ;
;

\ ---- decode ----

: _nib-at ( data:bytes i:int -- int )
  data i 2 div nth i 2 mod 0 = [ 4 shr ] [ 15 band ] if ;

\ The nibbles of the data: both halves of every byte, or the low half of every byte.
: _nibs ( data:bytes packed:bool -- list )
  packed
  [ 0 data len 2 * range [ data swap _nib-at ] map ]
  [ data bytes>list [ 15 band ] map ]
  if ;

\ Unpacked data: every high nibble is 0, except the last one when signed (the sign).
: _check-zones ( data:bytes signed:bool -- )
  data bytes>list [ 4 shr ] map
  signed [ dup len 1 - 0 swap slice ] when
  [ 0 <> ] filter len 0 >
  [ "an unpacked byte has a non-zero high nibble" raise:coerce ] when ;

\ The sign nibble: the last nibble of packed data, or the high nibble of the last byte.
: _sign-nibble ( data:bytes packed:bool -- int )
  packed [ data data len 1 - nth 15 band ] [ data data len 1 - nth 4 shr ] if ;

\ True for a minus sign nibble (B, D), false for a plus (A, C, E, F); any other nibble raises E_COERCE.
: _minus? ( s:int -- bool )
  s 13 = s 11 = or
  [ true ]
  [ s 10 = s 12 = or s 14 = s 15 = or or
    [ false ]
    [ "the sign nibble is not a sign (A to F)" raise:coerce false ]
    if ]
  if ;

\ The digit nibbles: all nibbles, but the last one of packed signed data (the sign).
: _digit-nibs ( nibs:list packed:bool signed:bool -- list )
  packed signed and
  [ nibs 0 nibs len 1 - slice ]
  [ nibs ]
  if ;

: _digits-text ( ds:list table:bytes -- str )
  ds [ table swap nth ] map
  dup [ 255 = ] filter len 0 > [ "a nibble is not a digit of the scheme" raise:coerce ] when
  [ 48 + ] map codes>str ;

: _decode ( data:bytes scheme:str packed:bool signed:bool -- str )
  packed not [ data signed _check-zones ] when
  signed [ data packed _sign-nibble _minus? ] [ false ] if
  data packed _nibs packed signed _digit-nibs scheme _codes _decode-table _digits-text
  swap [ "-" swap cat ] when ;

: decode ( bytes scheme:choice{8421|7421|4221|excess-3}=8421 packed:bool=true signed:bool=false -- str )
  "Decode binary-coded decimal to digits, the inverse of encode. Packed data is two digits per byte, most significant first (so an odd digit count shows as a leading 0); unpacked is one digit per byte with a zero high nibble. Signed data ends in a sign nibble (A, C, E, F plus; B, D minus; the result starts with - for a minus). A nibble that is no digit of the scheme, a sign nibble that is not A to F, or a non-zero high nibble in unpacked data raises E_COERCE. Empty input gives empty text." doc
  "Encodings" category
  dup len 0 =
  [ drop "" ]
  [ scheme packed signed _decode ]
  if ;

META: decode
  use-when "You have binary-coded decimal bytes, such as a packed number from a mainframe or COBOL record, and want the digits they stand for." ;
  link "https://en.wikipedia.org/wiki/Binary-coded_decimal" "Binary-coded decimal on Wikipedia" ;
  inverse encode ;
  param scheme "The digit code: 8421, 7421, 4221 or excess-3." ;
  param packed "Two digits per byte (otherwise one digit per byte)." ;
  param signed "The data ends in a sign nibble (C plus, D minus; A to F accepted)." ;
  see-also bcd:encode ;
;

