\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base85: Ascii85 (Adobe) and Z85 (ZeroMQ RFC 32). Written in FL: four data bytes are one 32-bit
\ integer and five base-85 digits. Errors are raised with the core
\ words fail-coerce and fail-range.
IN: base85

\ The variant of Base85 text.
CHOICE: base85-variant
  option ascii85 "Ascii85 (Adobe): z for four zero bytes, optional <~ ~> delimiters, a short final group." ;
  option z85 "Z85 (ZeroMQ RFC 32): the length is a multiple of 4 bytes (5 characters)." ;
;

MEMO: _a85-str ( -- str )
  33 118 range codes>str ;

MEMO: _z85-str ( -- str )
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#" ;

\ ---- encode ----

: _digits ( v:int alpha:bytes -- bytes )
  { v 52200625 div v 614125 div 85 mod v 7225 div 85 mod v 85 div 85 mod v 85 mod }
  [ alpha swap nth ] map list>bytes ;

\ One group: its five digits, or z for an all-zero group (ascii85, full groups only).
: _group ( p:bytes g:int alpha:bytes zmode:bool nfull:int -- bytes )
  p g 4 * g 4 * 4 + slice 256 digits>int
  dup 0 = zmode and g nfull < and
  [ drop { 122 } list>bytes ]
  [ alpha _digits ] if ;

: _groups ( p:bytes alpha:bytes zmode:bool nfull:int ng:int -- bytes )
  [ 0 ng range [ p swap alpha zmode nfull _group emit-all ] each ] collect-bytes ;

: _encode ( data:bytes alpha:bytes zmode:bool -- bytes )
  data { 0 0 0 } list>bytes 0 4 data len 4 mod - 4 mod slice cat
  alpha zmode data len 4 div data len 3 + 4 div _groups
  dup len 4 data len 4 mod - 4 mod - 0 swap slice ;

: encode ( bytes variant:choice<base85-variant>=ascii85 delimiters:bool=false -- str )
  "Encode bytes as Ascii85 (z for a group of four zero bytes, optional <~ ~> delimiters) or as Z85 (ZeroMQ RFC 32, length a multiple of 4 or E_RANGE)." doc
  "Encodings" category
  variant "z85" =
  [ dup len 4 mod 0 <> [ "Z85 needs a length that is a multiple of 4" fail-range ] when
    _z85-str str>bytes false _encode ]
  [ _a85-str str>bytes true _encode ] if
  bytes>latin1
  delimiters variant "z85" <> and [ "<~" swap cat "~>" cat ] when ;

META: encode
  use-when "You have binary data and need printable text for a PostScript or PDF file (ASCII85), or for a ZeroMQ message (Z85)." ;
  param variant "ascii85 (Adobe, digits ! to u) or z85 (ZeroMQ RFC 32)." ;
  param delimiters "Wrap the output in <~ and ~> (ascii85 only; ignored for z85)." ;
  inverse decode ;
  link "https://en.wikipedia.org/wiki/Ascii85" "Ascii85 on Wikipedia" ;
;

\ ---- decode ----

\ The decode table: 255 for a byte outside the alphabet, else the digit value.
: _table ( alpha:str -- bytes )
  alpha 255 255 util:decode-table ;

\ Removes a leading <~ and a trailing ~> (neither can be data: ~ is outside the alphabet).
: _strip-delims ( b:bytes -- bytes )
  b len 2 >= [ b 0 2 slice "<~" str>bytes = ] [ false ] if
  [ b 2 b len slice ] [ b ] if
  dup len 2 >= [ dup dup len 2 - over len slice "~>" str>bytes = ] [ false ] if
  [ dup len 2 - 0 swap slice ] when ;

\ z is a group of five zero digits and may only stand between groups.
: _expand-z ( b:bytes -- bytes )
  b bytes>latin1 "z" split :> parts
  parts 0 parts len 1 - slice [ len 5 mod 0 <> ] any?
  [ "z is only allowed between groups" fail-coerce ] when
  parts "!!!!!" join latin1>bytes ;

: _ugroup ( p:bytes g:int -- int )
  p g 5 * g 5 * 5 + slice 85 digits>int ;

: _ugroups ( p:bytes -- bytes )
  0 p len 5 div range [ p swap _ugroup ] map :> us
  us [ 4294967295 > ] any? [ "a group is larger than 32 bits" fail-coerce ] when
  [ us [ 4 int>be-bytes emit-all ] each ] collect-bytes ;

\ padn digits of u (84) complete the last group; as many bytes are then dropped.
: _finish ( s:bytes partial:bool -- bytes )
  s len 5 mod :> r
  r 1 = [ "a single digit cannot end a group" fail-coerce ] when
  r 0 <> partial not and [ "Z85 text must be a multiple of 5 characters" fail-coerce ] when
  5 r - 5 mod :> padn
  s { 84 84 84 84 } list>bytes 0 padn slice cat
  _ugroups dup len padn - 0 swap slice ;

: decode ( bytes variant:choice<base85-variant>=ascii85 -- bytes )
  "Decode Ascii85 (optional <~ ~> delimiters, z groups, a short final group) or Z85. White space is ignored." doc
  "Encodings" category
  [ space? not ] filter
  variant "z85" =
  [ _z85-str _table util:check-symbols false _finish ]
  [ _strip-delims _expand-z _a85-str _table util:check-symbols true _finish ] if ;

META: decode
  use-when "You have ASCII85 text, such as a block inside a PostScript or PDF file, or Z85 text, and want the bytes it stands for." ;
  param variant "ascii85 (Adobe, digits ! to u) or z85 (ZeroMQ RFC 32)." ;
  inverse encode ;
  link "https://en.wikipedia.org/wiki/Ascii85" "Ascii85 on Wikipedia" ;
  checks input charset "!-~ \t\n\x0b\x0c\r" ;
  expects "Ascii85 or Z85 text" ;
;
