\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ md4: MD4, RFC 1320. The digest is raw bytes; chain hex:encode for text. The hash itself is _hash, written in
\ FL from the RFC over core words. It costs about 29 interpreter steps a byte, so 64 KiB takes about 1.9 million
\ steps (the web app allows 5 million).
IN: md4

\ The message, padded as RFC 1320 sections 3.1 and 3.2 say: a 1 bit, zeros to 56 mod 64, the bit length as 8 bytes.
: _pad ( data:bytes -- bytes )
  data len :> n
  55 n - 64 mod :> zeros
  [ data emit-all 128 emit zeros zero-bytes emit-all n 8 * 8 int>le-bytes emit-all ] collect-bytes ;

\ One entry per step: the message word index in the high bits, the shift in the low five.
: _schedule ( ks:list ss:list -- list )
  ks [ :> j :> k k 5 shl ss j 3 band nth bor ] mapi ;

\ The steps of the three rounds (section 3.4): the word order and the four shifts that repeat.
MEMO: _round1 ( -- list )
  0 16 range { 3 7 11 19 } _schedule ;

MEMO: _round2 ( -- list )
  { 0 4 8 12 1 5 9 13 2 6 10 14 3 7 11 15 } { 3 5 9 13 } _schedule ;

MEMO: _round3 ( -- list )
  { 0 8 4 12 2 10 6 14 1 9 5 13 3 11 7 15 } { 3 9 11 15 } _schedule ;

MEMO: _indices ( -- list )
  0 16 range ;

\ The 16 little-endian words of the 64-byte block that starts at offset o.
: _words ( msg:bytes o:int -- list )
  _indices [ 4 * o + :> p msg p 4 le-bytes>int ] map ;

\ The MD4 digest (16 bytes) of data. A step rotates the state (a b c d) to (d t b c), where t is the rotated sum
\ of a, the round function, the message word and the round constant. The three rounds differ only in the
\ function (F, G, H) and the constant. After a block the state is added into the chaining value, mod 2^32.
: _hash ( data:bytes -- bytes )
  data _pad :> msg
  0x67452301 0xefcdab89 0x98badcfe 0x10325476
  0 msg len 6 shr range [
    :> i :> d0 :> c0 :> b0 :> a0
    msg i 6 shl _words :> w
    a0 b0 c0 d0
    _round1 [
      :> e :> d :> c :> b :> a
      a c d bxor b band d bxor + w e 5 shr nth + 0xffffffff band :> u
      d u e 31 band 32 rotl b c
    ] each
    _round2 [
      :> e :> d :> c :> b :> a
      a b c band d b c bor band bor + w e 5 shr nth + 0x5a827999 + 0xffffffff band :> u
      d u e 31 band 32 rotl b c
    ] each
    _round3 [
      :> e :> d :> c :> b :> a
      a b c bxor d bxor + w e 5 shr nth + 0x6ed9eba1 + 0xffffffff band :> u
      d u e 31 band 32 rotl b c
    ] each
    :> nd :> nc :> nb :> na
    na a0 + 0xffffffff band nb b0 + 0xffffffff band nc c0 + 0xffffffff band nd d0 + 0xffffffff band
  ] each
  :> rd :> rc :> rb :> ra
  [ ra 4 int>le-bytes emit-all rb 4 int>le-bytes emit-all
    rc 4 int>le-bytes emit-all rd 4 int>le-bytes emit-all ] collect-bytes ;

: digest ( bytes -- bytes )
  "The MD4 digest (RFC 1320) of the input as 16 raw bytes. Chain hex:encode for hex text. MD4 is obsolete and broken: do not use it for security." doc
  "Hashing" category
  _hash ;

META: digest
  use-when "You need to reproduce an MD4 value from an old system, such as the base of the NT hash, to compare it. MD4 is broken, so not for new security." ;
  link "https://www.rfc-editor.org/rfc/rfc1320" "RFC 1320: the MD4 algorithm" ;
  link "https://en.wikipedia.org/wiki/MD4" "MD4 on Wikipedia" ;
;
