\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bech32: Bech32 (BIP-173) and Bech32m (BIP-350). The result is hrp, the separator 1, the data in 5-bit
\ symbols of the charset qpzry9x8gf2tvdw0s3jn54khce6mua7l, and a six-symbol BCH checksum. The data
\ bytes are regrouped from 8 to 5 bits (zero padded), as the BIPs' convertbits does. encode writes
\ lower case; decode takes all lower or all upper case. The regrouping uses shifts on a window of
\ bytes (no big integers). Errors come from the raise vocabulary (raise:coerce, raise:range).
IN: bech32

: _charset ( -- bytes )
  "qpzry9x8gf2tvdw0s3jn54khce6mua7l" str>bytes ;

: _gen ( -- list )
  { 0x3b6a57b2 0x26508e6d 0x1ea119fa 0x3d4233dd 0x2a1462b3 } ;

\ ---- checksum ----

\ chk with the generator words of the set bits of b mixed in.
: _mix ( chk:int b:int -- int )
  0 5 range chk
  [ dup b swap shr 1 band 1 = [ _gen swap nth bxor ] [ drop ] if ] reduce ;

: _poly-step ( chk:int v:int -- int )
  chk 25 shr chk 0x1ffffff band 5 shl v bxor swap _mix ;

: _polymod ( vals:bytes -- int )
  vals 1 [ _poly-step ] reduce ;

\ The hrp expanded to 5-bit values: the high bits, a zero, the low bits.
: _expand ( hrp:bytes -- bytes )
  hrp [ 5 shr ] map #[ 00 ] cat hrp [ 31 band ] map cat ;

: _const ( variant:str -- int )
  variant "bech32m" = [ 0x2bc830a3 ] [ 1 ] if ;

\ ---- encode ----

: _five ( d:bytes -- bytes )
  0 d len 8 * 4 + 5 div range [ 5 * d swap 5 util:bit-field ] map list>bytes ;

\ The checksum value of hrp and the 5-bit data: the polymod with the variant's constant removed.
: _pm ( hrp:bytes five:bytes variant:str -- int )
  hrp _expand five cat #[ 00 00 00 00 00 00 ] cat _polymod variant _const bxor ;

\ The six checksum symbols of the value pm.
: _sum ( pm:int -- bytes )
  0 6 range [ 5 swap - 5 * pm swap shr 31 band ] map list>bytes ;

: _build ( five:bytes h:bytes variant:str -- str )
  h bytes>latin1 "1" cat
  five h five variant _pm _sum cat [ _charset swap nth ] map bytes>latin1 cat ;

: encode ( bytes hrp:str[1..83,/[!-~]+/] variant:choice{bech32|bech32m}=bech32 -- str )
  "Encode bytes as Bech32 or Bech32m (BIP-173, BIP-350): the human-readable part (written in lower case), 1, the data as 5-bit characters and a six-character checksum. A result over 90 characters is E_RANGE." doc
  "Encodings" category
  _five dup len hrp len + 7 + 90 > [ "the result is over 90 characters" raise:range ] when
  hrp lower str>bytes variant _build ;

\ ---- decode ----

\ The byte j of the 5-bit values regrouped to 8 bits (zero past the end).
: _byte ( v:bytes j:int -- int )
  v j 8 * 5 div util:byte-at 10 shl v j 8 * 5 div 1 + util:byte-at 5 shl bor v j 8 * 5 div 2 + util:byte-at bor
  7 j 8 * 5 mod - shr 255 band ;

\ The 8-bit data of the 5-bit values; the padding must be under 5 bits, all zero.
: _regroup ( v:bytes -- bytes )
  v len 5 * 8 mod 4 > [ "too many padding bits" raise:coerce ] when
  v v len 5 * 8 div _byte 0 <> [ "non-zero padding bits" raise:coerce ] when
  0 v len 5 * 8 div range [ v swap _byte ] map list>bytes ;

\ A string of 8 to 90 printable ASCII characters, not in mixed case.
: _check-chars ( d:bytes -- )
  d len 8 < d len 90 > or [ "a Bech32 string is 8 to 90 characters" raise:coerce ] when
  d [ dup 33 < swap 126 > or ] filter len 0 <>
  [ "a character outside ASCII 33 to 126" raise:coerce ] when
  d [ dup 97 >= swap 122 <= and ] filter len 0 <>
  d [ dup 65 >= swap 90 <= and ] filter len 0 <> and
  [ "mixed upper and lower case" raise:coerce ] when ;

\ The index of the last 1, which separates the hrp from the data.
: _sep ( s:bytes -- int )
  0 s len range [ s swap nth 49 = ] filter
  dup len 0 = [ "no separator 1" raise:coerce ] when
  dup len 1 - nth ;

: _vtable ( -- bytes )
  _charset bytes>latin1 255 255 util:decode-table ;

: _verify ( hrp:bytes vals:bytes -- )
  hrp _expand vals cat _polymod dup 1 <> swap 0x2bc830a3 <> and
  [ "the checksum is wrong" raise:coerce ] when ;

: _finish ( hrp:bytes vals:bytes part:str -- bytes )
  hrp vals _verify
  part "hrp" = [ hrp ] [ vals 0 vals len 6 - slice _regroup ] if ;

: _parse ( s:bytes part:str -- bytes )
  s _sep 1 < [ "the human-readable part is empty" raise:coerce ] when
  s len s _sep - 7 < [ "fewer than six checksum characters" raise:coerce ] when
  s 0 s _sep slice s s _sep 1 + s len slice _vtable util:check-symbols part _finish ;

: decode ( bytes part:choice{data|hrp}=data -- bytes )
  "Decode a Bech32 or Bech32m string (BIP-173, BIP-350) and return its data bytes, or with part hrp the human-readable part. Both checksum variants are accepted. All lower or all upper case; length 8 to 90, a wrong checksum, a bad character, mixed case, or padding that is not zero and under 5 bits is E_COERCE." doc
  "Encodings" category
  dup _check-chars bytes>latin1 lower latin1>bytes part _parse ;

META: encode
  use-when "You need bytes as a bech32 string with a readable prefix, such as a Bitcoin SegWit address (bc1...), where a checksum catches typing errors." ;
  link "https://en.wikipedia.org/wiki/Bech32" "Bech32 on Wikipedia" ;
  inverse decode ;
  param hrp "The human-readable part, 1 to 83 printable ASCII characters (lower-cased)." ;
  param variant "bech32 (BIP-173) or bech32m (BIP-350)." ;
  see-also bech32:decode base32:encode ;
;

META: decode
  use-when "You have a bech32 or bech32m string, such as a bc1... address, and want its data bytes, or its prefix with part hrp. The checksum is checked." ;
  link "https://en.wikipedia.org/wiki/Bech32" "Bech32 on Wikipedia" ;
  inverse encode ;
  param part "What to return: the data bytes, or the human-readable part." ;
  see-also bech32:encode base32:decode ;
;
