\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base92: Base92 by thenoviceoof (https://github.com/thenoviceoof/base92, reference implementation in
\ Python and C). The data is a bit stream cut into 13-bit groups; each group is two characters
\ (value div 91, value mod 91). The 91 characters are ! (0), # to _ (1 to 61) and a to } (62 to 90);
\ " ` and ~ are left out and ~ alone is the empty string. A last group of 1 to 6 bits is one character
\ of 6 bits (zero padded); of 7 to 12 bits it is two characters (zero padded to 13 bits). Written in FL
\ with shifts on a three-byte window, so there is no big integer and the cost is linear. Errors come
\ from the raise vocabulary (raise:coerce).
IN: base92

: _alpha ( -- bytes )
  { 33 } 35 96 range cat 97 126 range cat list>bytes ;

\ ---- encode ----

\ The two characters of a 13-bit value.
: _two ( x:int a:bytes -- bytes )
  { } a x 91 div nth append a x 91 mod nth append list>bytes ;

\ The bit offset of the last, partial group, and its length.
: _start ( d:bytes -- int )
  d len 8 * 13 div 13 * ;

: _rest ( d:bytes -- int )
  d len 8 * 13 mod ;

: _tail ( d:bytes a:bytes -- bytes )
  d _rest 0 =
  [ #[ ] ]
  [ d _rest 7 <
    [ { } a d d _start 6 util:bit-field nth append list>bytes ]
    [ d d _start 13 util:bit-field a _two ] if ] if ;

: _group ( d:bytes i:int a:bytes -- bytes )
  d i 13 * 13 util:bit-field a _two ;

: _enc ( d:bytes a:bytes -- bytes )
  0 d len 8 * 13 div range [ d swap a _group ] map #[ ] bjoin
  d a _tail cat ;

: encode ( bytes -- str )
  "Encode bytes as Base92 (thenoviceoof): 13 bits become two of 91 printable characters; empty input is ~." doc
  "Encodings" category
  dup len 0 = [ drop "~" ] [ _alpha _enc bytes>latin1 ] if ;

\ ---- decode ----

\ A 13-bit unit: a pair of characters, or (last, odd) one 6-bit character shifted into 13 bits.
: _unit ( v:bytes k:int -- int )
  k 2 * 1 + v len <
  [ v k 2 * nth 91 * v k 2 * 1 + nth + dup 8191 > [ "a pair of characters is more than 13 bits" raise:coerce ] when ]
  [ v k 2 * nth dup 63 > [ "a last character is more than 6 bits" raise:coerce ] when 7 shl ] if ;

\ The byte j of the bit stream of the units (zero past the end).
: _byte ( us:list j:int -- int )
  us j 8 * 13 div util:byte-at 13 shl us j 8 * 13 div 1 + util:byte-at bor
  18 j 8 * 13 mod - shr 255 band ;

\ bits is the number of data bits in the units; the padding bits after them must be zero.
: _fin ( us:list bits:int -- bytes )
  us bits 8 div _byte 0 <> [ "non-zero bits after the end of the data" raise:coerce ] when
  0 bits 8 div range [ us swap _byte ] map list>bytes ;

: _units ( v:bytes -- bytes )
  0 v len 2 div v len 2 mod + range [ v swap _unit ] map
  v len 2 div 13 * v len 2 mod 6 * + _fin ;

: _table ( -- bytes )
  _alpha bytes>latin1 255 255 util:decode-table ;

: decode ( bytes -- bytes )
  "Decode Base92 text. White space is ignored, ~ alone is the empty string, and a character outside the alphabet (or a ~ among others) is E_COERCE." doc
  "Encodings" category
  [ util:space? not ] filter
  dup "~" str>bytes = [ drop #[ ] ] [ _table util:check-symbols _units ] if ;

META: encode
  see-also base92:decode base85:encode ;
;

META: decode
  see-also base92:encode base85:decode ;
;
