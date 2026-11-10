\ base85: Ascii85 (Adobe) and Z85 (ZeroMQ RFC 32). Written in FL: four data bytes are one 32-bit
\ integer and five base-85 digits. The two primitives (src/prims/base85.ts) only raise E_COERCE and
\ E_RANGE.
IN: base85

: _a85-str ( -- str )
  33 118 range codes>str ;

: _z85-str ( -- str )
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#" ;

: _isspace ( b:int -- bool )
  b 32 = b 9 >= b 13 <= and or ;

\ ---- encode ----

\ The big-endian integer of the elements of b, each taken as 8 bits.
: _pack ( b:bytes -- int )
  b 0 [ swap 8 shl bor ] reduce ;

: _digits ( v:int alpha:bytes -- bytes )
  { v 52200625 div v 614125 div 85 mod v 7225 div 85 mod v 85 div 85 mod v 85 mod }
  [ alpha swap nth ] map list>bytes ;

\ One group: its five digits, or z for an all-zero group (ascii85, full groups only).
: _group ( p:bytes g:int alpha:bytes zmode:bool nfull:int -- bytes )
  p g 4 * g 4 * 4 + slice _pack
  dup 0 = zmode and g nfull < and
  [ drop { 122 } list>bytes ]
  [ alpha _digits ] if ;

: _groups ( p:bytes alpha:bytes zmode:bool nfull:int ng:int -- bytes )
  0 ng range [ p swap alpha zmode nfull _group ] map #[ ] bjoin ;

: _encode ( data:bytes alpha:bytes zmode:bool -- bytes )
  data { 0 0 0 } list>bytes 0 4 data len 4 mod - 4 mod slice cat
  alpha zmode data len 4 div data len 3 + 4 div _groups
  dup len 4 data len 4 mod - 4 mod - 0 swap slice ;

: encode ( bytes variant:choice{ascii85|z85}=ascii85 delimiters:bool=false -- str )
  "Encode bytes as Ascii85 (z for a group of four zero bytes, optional <~ ~> delimiters) or as Z85 (ZeroMQ RFC 32, length a multiple of 4 or E_RANGE)." doc
  "Encodings" category
  variant "z85" =
  [ dup len 4 mod 0 <> [ "Z85 needs a length that is a multiple of 4" _range-fail ] when
    _z85-str str>bytes false _encode ]
  [ _a85-str str>bytes true _encode ] if
  bytes>latin1
  delimiters variant "z85" <> and [ "<~" swap cat "~>" cat ] when ;

\ ---- decode ----

\ 255 for a byte outside the alphabet, else the digit value.
: _code-of ( alpha:str b:int -- int )
  alpha { b } codes>str split dup len 2 = [ 0 nth len ] [ drop 255 ] if ;

: _table ( alpha:str -- bytes )
  0 256 range [ alpha swap _code-of ] map list>bytes ;

: _symbols ( b:bytes table:bytes -- bytes )
  b table translate
  dup [ 255 = ] filter len 0 <> [ "a character is not in the alphabet" _coerce-fail ] when ;

\ Removes a leading <~ and a trailing ~> (neither can be data: ~ is outside the alphabet).
: _strip-delims ( b:bytes -- bytes )
  b len 2 >= [ b 0 2 slice "<~" str>bytes = ] [ false ] if
  [ b 2 b len slice ] [ b ] if
  dup len 2 >= [ dup dup len 2 - over len slice "~>" str>bytes = ] [ false ] if
  [ dup len 2 - 0 swap slice ] when ;

\ z is a group of five zero digits and may only stand between groups.
: _expand-z2 ( parts:list -- bytes )
  parts 0 parts len 1 - slice [ len 5 mod 0 <> ] filter len 0 <>
  [ "z is only allowed between groups" _coerce-fail ] when
  parts "!!!!!" join latin1>bytes ;

: _expand-z ( b:bytes -- bytes )
  b bytes>latin1 "z" split _expand-z2 ;

: _val85 ( b:bytes -- int )
  b 0 [ swap 85 * + ] reduce ;

: _ugroup ( p:bytes g:int -- int )
  p g 5 * g 5 * 5 + slice _val85 ;

: _bytes4 ( v:int -- bytes )
  0 4 range [ 3 swap - 8 * v swap shr 255 band ] map list>bytes ;

: _ugroups ( p:bytes -- bytes )
  0 p len 5 div range [ p swap _ugroup ] map
  dup [ 4294967295 > ] filter len 0 <> [ "a group is larger than 32 bits" _coerce-fail ] when
  [ _bytes4 ] map #[ ] bjoin ;

\ padn digits of u (84) complete the last group; as many bytes are then dropped.
: _finish2 ( s:bytes padn:int -- bytes )
  s { 84 84 84 84 } list>bytes 0 padn slice cat
  _ugroups dup len padn - 0 swap slice ;

: _finish ( s:bytes partial:bool -- bytes )
  s len 5 mod
  dup 1 = [ "a single digit cannot end a group" _coerce-fail ] when
  dup 0 <> partial not and [ "Z85 text must be a multiple of 5 characters" _coerce-fail ] when
  5 swap - 5 mod s swap _finish2 ;

: decode ( bytes variant:choice{ascii85|z85}=ascii85 -- bytes )
  "Decode Ascii85 (optional <~ ~> delimiters, z groups, a short final group) or Z85. White space is ignored." doc
  "Encodings" category
  [ _isspace not ] filter
  variant "z85" =
  [ _z85-str _table _symbols false _finish ]
  [ _strip-delims _expand-z _a85-str _table _symbols true _finish ] if ;

META: encode
  param variant "ascii85 (Adobe, digits ! to u) or z85 (ZeroMQ RFC 32)." ;
  param delimiters "Wrap the output in <~ and ~> (ascii85 only; ignored for z85)." ;
;

META: decode
  param variant "ascii85 (Adobe, digits ! to u) or z85 (ZeroMQ RFC 32)." ;
;
