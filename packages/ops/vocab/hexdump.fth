\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ hexdump: bytes as an xxd-style hex dump, and back. Written in FL; there are no primitives.
\
\ Layout written by encode, one line per width bytes, lines joined by a line feed (no final line feed):
\   OOOOOOOO: HHHH HHHH ... <two spaces> ASCII
\ OOOOOOOO is the offset of the line's first byte as 8 hex digits; then a colon and a space; then the
\ bytes as hex, grouped two bytes (four digits) to a group with one space between groups (a final
\ group of one byte has two digits); then, when ascii is set, the hex field of a short last line is
\ padded with spaces to the width of a full line, two more spaces, and the ASCII column: each byte
\ 0x20 to 0x7e as itself and every other byte as a full stop. The case parameter sets the case of the
\ hex digits; the offset is always lowercase (as in xxd -u). Empty input gives empty text.
\ Example, width 16: "00000000: 4865 6c6c 6f2c 2077 6f72 6c64 210a       Hello, world!."
IN: hexdump

\ ---- encode ----

\ The offset as 8 lowercase hex digits.
: _offset ( v:int -- str )
  v 8 util:pad-hex ;

\ Hex digits in groups of four (two bytes), separated by a space.
: _group ( h:str -- str )
  h 4 util:str-chunks " " join ;

\ The characters of the hex field of n bytes (n at least 1).
: _field-len ( n:int -- int )
  n 2 * n 1 + 2 div + 1 - ;

\ Byte b as the ASCII column shows it: itself from 0x20 to 0x7e, else a full stop.
: _ascii-table ( -- bytes )
  0 256 range [ dup 32 < over 126 > or [ drop 46 ] when ] map list>bytes ;

\ One line. chunk is the bytes of the line and text the same bytes as the ASCII column shows them.
: _line ( chunk:bytes text:bytes off:int width:int up:bool with-ascii:bool -- str )
  off _offset ": " cat
  chunk bytes>hex up [ upper ] when _group cat
  with-ascii
  [ width _field-len chunk len _field-len - " " swap util:repeat-str cat
    "  " cat
    text bytes>latin1 cat ]
  when ;

: _row ( data:bytes text:bytes i:int width:int up:bool with-ascii:bool -- str )
  data i width * i 1 + width * data len min slice
  text i width * i 1 + width * data len min slice
  i width * width up with-ascii _line ;

: _rows ( data:bytes text:bytes width:int up:bool with-ascii:bool -- str )
  0 data len width + 1 - width div range
  [ data text rot width up with-ascii _row ] map
  "\n" join ;

: _encode ( data:bytes width:int up:bool with-ascii:bool -- str )
  data data _ascii-table translate width up with-ascii _rows ;

: encode ( bytes width:int[1..64]=16 case:choice{lower|upper}=lower ascii:bool=true -- str )
  "Encode bytes as an xxd-style hex dump, one line per width bytes: an 8-digit hex offset, a colon and a space, the bytes as hex in groups of two bytes separated by a space, then (with ascii) padding so the columns line up, two spaces and the ASCII column (bytes 0x20 to 0x7e as themselves, others as a full stop). Lines are separated by a line feed with none at the end. Case sets the case of the hex digits; the offset is always lowercase, as in xxd -u. Empty input gives empty text." doc
  "Encodings" category
  width case "upper" = ascii _encode ;

META: encode
  param width "Bytes per line, 1 to 64." ;
  param case "Case of the hex digits (the offset is always lowercase)." ;
  param ascii "Add the ASCII column." ;
;

\ ---- decode ----

\ True when the text has a character other than a space.
: _blank? ( s:str -- bool )
  s " " split [ len 0 > ] filter len 0 = ;

\ True when the token ends in a colon (xxd and this vocabulary's own layout).
: _colon? ( t:str -- bool )
  t ":" util:ends-with? ;

\ The token without a trailing colon.
\ Kept private: it only resembles case:_body (see the ops README, Justified exceptions).
: _uncolon ( t:str -- str )
  t _colon?
  [ t 0 t len 1 - slice ]
  [ t ]
  if ;

\ The hex field of a line body (the text after the offset) in the xxd form: the first piece that
\ is not blank when the body is split at runs of two spaces.
: _field ( body:str -- str )
  body "  " split [ _blank? not ] filter
  dup len 0 = [ drop "" ] [ 0 nth ] if ;

\ The bytes of a line whose offset token is tok. The offset is checked to be hex digits and ignored.
\ An offset with a colon (xxd and this vocabulary's own layout) is followed by a hex field closed by
\ the first run of two spaces. An offset without one (hexdump -C) is followed by a hex field closed
\ by a vertical bar, if there is one. The ASCII column is ignored.
: _from-token ( line:str tok:str -- bytes )
  tok _uncolon 16 str>int-radix drop
  line tok len line len slice
  dup "|" split len 1 > tok _colon? not and
  [ "|" split 0 nth ]
  [ _field ]
  if
  hex>bytes ;

: _line-bytes ( line:str -- bytes )
  line line " " split 0 nth _from-token ;

: decode ( str -- bytes )
  "Decode a hex dump to bytes. Accepts this vocabulary's layout, xxd output (any width and grouping) and hexdump -C output: each line is an offset (hex digits, optionally followed by a colon), the bytes as hex, and an ASCII column. Offsets and the ASCII column are ignored and blank lines are skipped. A line with no valid offset, a non-hex or odd-length hex field, or a * line that hexdump uses to squeeze repeated lines (use hexdump -v) raises E_COERCE. Empty input gives empty bytes." doc
  "Encodings" category
  "\r" split "" join "\n" split
  [ [ 32 = ] util:trim-start ] map [ _blank? not ] filter
  [ _line-bytes ] map #[ ] bjoin ;

META: decode
  see-also hexdump:encode ;
;

