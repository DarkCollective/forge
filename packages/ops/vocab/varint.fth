\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ varint: VarInt Encode and VarInt Decode: the base-128 variable-length
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
  [ n 1 63 shl neg 1 63 shl 1 - "the signed 64-bit value" check-int-range n _zig ]
  [ n 0 1 64 shl 1 - "the unsigned 64-bit value" check-int-range n ] if ;

\ How many bytes v takes: one, plus one for every power of 128 it reaches.
: _size ( v:int -- int )
  1 10 range [ 7 * 1 swap shl v <= ] filter len 1 + ;

\ v in n groups of 7 bits, the continuation bit set on all but the last.
: _bytes ( v:int n:int -- bytes )
  0 n range [ dup 7 * v swap shr 127 band swap n 1 - < [ 128 bor ] when ] map list>bytes ;

\ The number in the text: decimal, or 0x, 0o or 0b followed by digits (what BigInt() reads).
: _parse ( s:str -- int )
  s len 2 < [ s str>int ] [
    s 0 2 slice lower :> prefix
    s 2 s len slice :> digits
    {
      [ prefix "0x" = ] [ digits 16 str>int-radix ]
      [ prefix "0o" = ] [ digits 8 str>int-radix ]
      [ prefix "0b" = ] [ digits 2 str>int-radix ]
      [ s str>int ]
    } cond
  ] if ;

: encode ( data:str zigzag:bool=false -- bytes )
  "Write a whole number given in decimal text (or with a 0x, 0o or 0b prefix) as a VarInt (Protocol Buffers base-128): 7 bits a byte, least significant group first, the high bit set on every byte but the last. White space around the number is ignored. The number is an unsigned 64-bit value (0 to 18446744073709551615); a negative number or one above is E_RANGE (protobuf int64 writes a negative as 10 bytes, which this op does not). Text that is not a whole number is E_COERCE. With zigzag the number is a signed 64-bit value (-9223372036854775808 to 9223372036854775807) in the ZigZag form of sint32 and sint64 The output is bytes: chain To Hex to see them." doc
  "Networking" category
  data [ space? ] trim-start [ space? ] trim-end _parse
  zigzag _value dup _size _bytes ;

META: encode
  use-when "You have a whole number and need its protobuf varint bytes, for example to build a length prefix or a test message." ;
  param zigzag "Treat the number as signed and write its ZigZag form, as protobuf sint32 and sint64 do." ;
  inverse decode ;
  see-also varint:decode ;
  link "https://en.wikipedia.org/wiki/Variable-length_quantity" "Variable-length quantity on Wikipedia" ;
;

\ ---- decode ----

\ The value of the n + 1 bytes of d, least significant group first.
: _sum ( d:bytes n:int -- int )
  0 n 1 + range [ dup d swap nth 127 band swap 7 * shl ] map sum ;

: _unzig ( v:int -- int )
  v 1 shr v 1 band neg bxor ;

: decode ( data:bytes zigzag:bool=false -- str )
  "Read a VarInt (Protocol Buffers base-128) and write it as decimal text. The input is exactly one VarInt of 1 to 10 bytes and a value below 2^64; it is read as an unsigned integer, exact. An empty input, a VarInt whose last byte still has the high bit set (truncated), one of more than 10 bytes, one of 64 bits and more, and bytes after the VarInt are E_COERCE. A non-minimal VarInt (a trailing 0x80 0x00) is accepted, as protobuf parsers do. With zigzag the value is the ZigZag form of a signed integer, as sint32 and sint64 are written." doc
  "Networking" category
  data len 0 = [ "no VarInt: the input is empty" fail-coerce ] when
  data 0 data len 10 min slice [ 128 < ] find :> n
  n -1 = [
    data len 10 <
    [ "truncated VarInt: the last byte " data data len 1 - nth int>str cat " has the high bit set and nothing follows" cat ]
    [ "the VarInt is longer than 10 bytes" ] if fail-coerce
  ] when
  n 1 + data len <> [
    "the VarInt ends at offset " n int>str cat " but " cat data len n - 1 - int>str cat
    " more bytes follow it (exactly one VarInt is expected)" cat fail-coerce
  ] when
  data n _sum :> v
  v 1 64 shl >= [ "the VarInt is " v int>str cat ", which does not fit 64 bits" cat fail-coerce ] when
  zigzag [ v _unzig ] [ v ] if int>str ;

META: decode
  use-when "You have protobuf varint bytes, such as a length prefix or a field key, and want the number they stand for." ;
  param zigzag "Read the value as a ZigZag-encoded signed integer, as protobuf sint32 and sint64 are written." ;
  inverse encode ;
  see-also varint:encode ;
  link "https://en.wikipedia.org/wiki/Variable-length_quantity" "Variable-length quantity on Wikipedia" ;
;
