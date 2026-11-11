\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ bits: bitwise operations on bytes. Written in FL on the core words; there are no primitives.
IN: bits

\ Key byte i of a key that repeats over the data.
: _key-at ( key:bytes i:int -- int )
  key i key len mod nth ;

\ A 256-byte lookup table from a quotation over 0..255; per-byte ops apply it with translate.
: _table ( quot -- bytes )
  0 256 range swap map list>bytes ;

: xor ( bytes key:key{hex|utf8|latin1|base64}[1..4096] -- bytes )
  "Exclusive-or every byte with the key, which repeats over the data." doc
  "Bitwise" category
  key bxor ;

: and ( bytes key:key{hex|utf8|latin1|base64}[1..4096] -- bytes )
  "Bitwise AND of every byte with the key, which repeats over the data." doc
  "Bitwise" category
  [ key swap _key-at band ] mapi ;

: or ( bytes key:key{hex|utf8|latin1|base64}[1..4096] -- bytes )
  "Bitwise OR of every byte with the key, which repeats over the data." doc
  "Bitwise" category
  [ key swap _key-at bor ] mapi ;

: add ( bytes key:key{hex|utf8|latin1|base64}[1..4096] -- bytes )
  "Add the key to every byte, modulo 256. The key repeats over the data." doc
  "Bitwise" category
  [ key swap _key-at + 256 mod ] mapi ;

: sub ( bytes key:key{hex|utf8|latin1|base64}[1..4096] -- bytes )
  "Subtract the key from every byte, modulo 256 (data minus key). The key repeats over the data." doc
  "Bitwise" category
  [ key swap _key-at - 256 mod ] mapi ;

: not ( bytes -- bytes )
  "Invert every bit of every byte." doc
  "Bitwise" category
  #[ ff ] bxor ;

: shift-left ( bytes amount:int[1..7]=1 -- bytes )
  "Shift every byte left, within the byte, filling with zero bits. Bits shifted out are lost." doc
  "Bitwise" category
  [ amount shl 255 band ] _table translate ;

: shift-right ( bytes amount:int[1..7]=1 -- bytes )
  "Shift every byte right, within the byte, filling with zero bits. Bits shifted out are lost." doc
  "Bitwise" category
  [ amount shr ] _table translate ;

: rotate-left ( bytes amount:int[1..7]=1 -- bytes )
  "Rotate the bits of every byte left, within the byte; bits shifted out come back in on the right." doc
  "Bitwise" category
  [ dup amount shl 255 band swap 8 amount - shr bor ] _table translate ;

: rotate-right ( bytes amount:int[1..7]=1 -- bytes )
  "Rotate the bits of every byte right, within the byte; bits shifted out come back in on the left." doc
  "Bitwise" category
  [ dup amount shr swap 8 amount - shl 255 band bor ] _table translate ;

\ The n-th key of the given length, big-endian: 0x00 .. 0xff, or 0x0000 .. 0xffff.
: _brute-key ( n:int length:int -- bytes )
  length 1 =
  [ { n } list>bytes ]
  [ { n 256 div n 256 mod } list>bytes ]
  if ;

\ True when the crib is empty or the data xor key contains it. Both are viewed as Latin-1 text
\ so that the search is a byte search; the crib is the UTF-8 encoding of its text.
: _has-crib ( data:bytes key:bytes crib:str -- bool )
  crib len 0 =
  [ true ]
  [ data key bxor bytes>latin1 crib str>bytes bytes>latin1 split len 1 > ]
  if ;

: _candidate ( data:bytes n:int length:int -- record )
  { { "key" n length _brute-key bytes>hex } { "output" data n length _brute-key bxor } }
  >record ;

: xor-brute ( data:bytes key-length:int[1..2]=1 crib:str="" -- list )
  "Try every key of 1 or 2 bytes (256 or 65536 keys, in numeric order) and list the candidates as records with key (hex text) and output (bytes). With a crib, keep only candidates whose output contains the crib's UTF-8 bytes. Without one, 2-byte keys exceed the allocation limits on input over a few KiB; use a crib." doc
  "Bitwise" category
  0 key-length 1 = [ 256 ] [ 65536 ] if range
  [ key-length _brute-key data swap crib _has-crib ] filter
  [ data swap key-length _candidate ] map ;

META: xor
  param key "The key; it repeats over the data. One to 4096 bytes." ;
  see-also bits:and bits:or bits:add bits:not ;
;

META: and
  param key "The key; it repeats over the data. One to 4096 bytes." ;
  see-also bits:or bits:xor bits:not ;
;

META: or
  param key "The key; it repeats over the data. One to 4096 bytes." ;
  see-also bits:and bits:xor bits:not ;
;

META: add
  param key "The key; it repeats over the data. One to 4096 bytes." ;
  see-also bits:sub bits:xor ;
;

META: sub
  param key "The key; it repeats over the data. One to 4096 bytes." ;
  see-also bits:add bits:xor ;
;

META: not
  see-also bits:xor bits:and ;
;

META: shift-left
  param amount "How many bit positions to shift, 1 to 7." ;
  see-also bits:shift-right bits:rotate-left ;
;

META: shift-right
  param amount "How many bit positions to shift, 1 to 7." ;
  see-also bits:shift-left bits:rotate-right ;
;

META: rotate-left
  param amount "How many bit positions to rotate, 1 to 7." ;
  see-also bits:rotate-right bits:shift-left ;
;

META: rotate-right
  param amount "How many bit positions to rotate, 1 to 7." ;
  see-also bits:rotate-left bits:shift-right ;
;

META: xor-brute
  param key-length "Length of the keys to try: 1 byte (256 keys) or 2 bytes (65 536 keys)." ;
  param crib "Text expected in the output (matched as UTF-8 bytes). Empty keeps every candidate." ;
  see-also bits:xor ;
;
