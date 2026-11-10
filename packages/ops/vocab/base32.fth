\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base32: Base32 as in RFC 4648 section 6 (standard) and section 7 (extended hex). Written in FL:
\ five data bytes are one 40-bit integer and eight 5-bit symbols. Errors come from the
\ raise vocabulary (raise:coerce).
IN: base32

: _alphabet ( alphabet:str -- str )
  alphabet "hex" =
  [ "0123456789ABCDEFGHIJKLMNOPQRSTUV" ]
  [ "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" ] if ;

\ ---- encode ----

\ The eight alphabet bytes of a 40-bit group.
: _chars ( v:int alpha:bytes -- bytes )
  0 8 range [ 7 swap - 5 * v swap shr 31 band alpha swap nth ] map list>bytes ;

: _group ( p:bytes g:int alpha:bytes -- bytes )
  p g 5 * g 5 * 5 + slice 256 util:digits>int alpha _chars ;

: _groups ( p:bytes alpha:bytes ng:int -- bytes )
  0 ng range [ p swap alpha _group ] map #[ ] bjoin ;

: _encode ( data:bytes alpha:bytes padding:bool -- str )
  data { 0 0 0 0 } list>bytes 0 5 data len 5 mod - 5 mod slice cat
  alpha data len 4 + 5 div _groups
  0 data len 8 * 4 + 5 div slice bytes>latin1
  padding [ dup len 8 mod 8 swap - 8 mod "========" 0 rot slice cat ] when ;

: encode ( bytes alphabet:choice{standard|hex}=standard padding:bool=true -- str )
  "Encode bytes as Base32 text (RFC 4648 sections 6 and 7)." doc
  "Encodings" category
  alphabet _alphabet str>bytes padding _encode ;

\ ---- decode ----

\ The decode table: 255 for a byte outside the alphabet, 254 for ASCII white space, 253 for =, else the
\ symbol value.
: _table ( alpha:str -- bytes )
  alpha 254 253 util:decode-table ;

\ s is the symbols and padding; core only the symbols. The padding must come last.
: _check-pad ( s:bytes core:bytes -- bytes int )
  core s len core len -
  s 0 core len slice core = not [ "data after the padding" raise:coerce ] when ;

: _rest-ok ( r:int -- bool )
  r 1 <> r 3 <> and r 6 <> and ;

: _ungroup ( p:bytes g:int -- bytes )
  p g 8 * g 8 * 8 + slice 32 util:digits>int 5 util:int>be-bytes ;

\ Not classical:_cb-enc: both map a helper over an index range and join, but over different per-group words, so there is no shared body.
: _ungroups ( p:bytes ng:int -- bytes )
  0 ng range [ p swap _ungroup ] map #[ ] bjoin ;

: _finish ( core:bytes p:int -- bytes )
  core len 8 mod _rest-ok not [ "a length of that kind cannot end Base32 data" raise:coerce ] when
  p 0 > p 8 core len 8 mod - 8 mod <> and [ "incorrect padding" raise:coerce ] when
  core len 5 * 8 mod 0 >
  [ core core len 1 - nth 1 core len 5 * 8 mod shl 1 - band 0 <>
    [ "non-zero bits after the end of the data" raise:coerce ] when ] when
  core { 0 0 0 0 0 0 0 } list>bytes 0 8 core len 8 mod - 8 mod slice cat
  core len 7 + 8 div _ungroups
  0 core len 5 * 8 div slice ;

: _decode ( data:bytes table:bytes -- bytes )
  data table util:check-symbols [ 254 <> ] filter
  dup [ 253 < ] filter _check-pad _finish ;

: decode ( bytes alphabet:choice{standard|hex}=standard -- bytes )
  "Decode Base32 text (RFC 4648). White space is ignored, padding is optional and upper case is required." doc
  "Encodings" category
  alphabet _alphabet _table _decode ;

META: encode
  param alphabet "The alphabet: standard (A-Z 2-7) or hex (0-9 A-V, base32hex)." ;
  param padding "Append = padding to a multiple of eight characters." ;
;

META: decode
  param alphabet "The alphabet of the text: standard (A-Z 2-7) or hex (0-9 A-V, base32hex)." ;
;
