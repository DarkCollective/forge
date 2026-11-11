\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ varint: VarInt Encode and VarInt Decode, the CyberChef operations of the same names: the base-128 variable-length
\ integer of Protocol Buffers (7 bits a byte, least significant group first, the high bit set on every byte but the
\ last), up to 64 bits (at most 10 bytes). FL only, on exact big integers. The zigzag form of the signed protobuf
\ types (sint32, sint64) is an added option.
IN: varint

\ ---- encode ----

\ The zigzag form of a signed integer: 0, -1, 1, -2 ... become 0, 1, 2, 3 ...
: _zig ( n:int -- int )
  n 1 shl n 63 shr bxor ;

\ The integer to write: range checked (E_RANGE), zigzag-mapped if asked.
: _value ( n:int zigzag:bool -- int )
  zigzag
  [ n 1 63 shl neg 1 63 shl 1 - "the signed 64-bit value" util:check-int-range n _zig ]
  [ n 0 1 64 shl 1 - "the unsigned 64-bit value" util:check-int-range n ] if ;

\ How many bytes v takes: one, plus one for every power of 128 it reaches.
: _size ( v:int -- int )
  1 10 range [ 7 * 1 swap shl v <= ] filter len 1 + ;

\ v in n groups of 7 bits, the continuation bit set on all but the last.
: _bytes ( v:int n:int -- bytes )
  0 n range [ dup 7 * v swap shr 127 band swap n 1 - < [ 128 bor ] when ] map list>bytes ;

: encode ( data:str zigzag:bool=false -- bytes )
  "Write a whole number given in decimal text as a VarInt (Protocol Buffers base-128), as CyberChef's VarInt Encode does: 7 bits a byte, least significant group first, the high bit set on every byte but the last. White space around the number is ignored. The number is an unsigned 64-bit value (0 to 18446744073709551615); a negative number or one above is E_RANGE (CyberChef refuses negatives and writes any larger number; protobuf int64 writes a negative as 10 bytes, which this op does not). Text that is not a whole number is E_COERCE. With zigzag the number is a signed 64-bit value (-9223372036854775808 to 9223372036854775807) in the ZigZag form of sint32 and sint64 (an addition to CyberChef). The output is bytes: chain To Hex to see them." doc
  "Networking" category
  data [ util:space? ] util:trim-start [ util:space? ] util:trim-end str>int
  zigzag _value dup _size _bytes ;

META: encode
  param zigzag "Treat the number as signed and write its ZigZag form, as protobuf sint32 and sint64 do (an addition to CyberChef)." ;
  see-also varint:decode ;
;

\ ---- decode ----

\ The position of the first byte without the continuation bit in a list of bytes, or -1.
: _last ( head:list -- int )
  0 head len range [ head swap nth 128 < ] filter
  dup len 0 = [ drop -1 ] [ 0 nth ] if ;

\ The value of the n + 1 bytes of d, least significant group first.
: _sum ( d:bytes n:int -- int )
  0 n 1 + range [ dup d swap nth 127 band swap 7 * shl ] map util:sum ;

: _unzig ( v:int -- int )
  v 1 shr v 1 band neg bxor ;

\ ( d n zigzag ): n is the position of the last byte.
: _decode2 ( d:bytes n:int zigzag:bool -- str )
  n 1 + d len <> [
    "the VarInt ends at offset " n int>str cat " but " cat d len n - 1 - int>str cat
    " more bytes follow it (exactly one VarInt is expected)" cat raise:coerce ] when
  d n _sum
  dup 1 64 shl >= [ "the VarInt is " over int>str cat ", which does not fit 64 bits" cat raise:coerce ] when
  zigzag [ _unzig ] when int>str ;

: decode ( data:bytes zigzag:bool=false -- str )
  "Read a VarInt (Protocol Buffers base-128) and write it as decimal text, as CyberChef's VarInt Decode does. The input is exactly one VarInt of 1 to 10 bytes and a value below 2^64; it is read as an unsigned integer, exact. An empty input, a VarInt whose last byte still has the high bit set (truncated), one of more than 10 bytes, one of 64 bits and more, and bytes after the VarInt are E_COERCE (CyberChef reads the first VarInt and ignores the rest, and reads a truncated one as NaN). A non-minimal VarInt (a trailing 0x80 0x00) is accepted, as protobuf parsers do. With zigzag the value is the ZigZag form of a signed integer, as sint32 and sint64 are written (an addition to CyberChef)." doc
  "Networking" category
  data len 0 = [ "no VarInt: the input is empty" raise:coerce ] when
  data 0 data len 10 min slice bytes>list _last
  dup -1 = [
    drop data len 10 < [ "truncated VarInt: the last byte " data data len 1 - nth int>str cat " has the high bit set and nothing follows" cat ]
    [ "the VarInt is longer than 10 bytes" ] if raise:coerce ] when
  data swap zigzag _decode2 ;

META: decode
  param zigzag "Read the value as a ZigZag-encoded signed integer, as protobuf sint32 and sint64 are written (an addition to CyberChef)." ;
  see-also varint:encode ;
;
