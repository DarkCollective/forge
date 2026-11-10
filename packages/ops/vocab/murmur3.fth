\ murmur3: MurmurHash3 x86_32 (Austin Appleby, SMHasher, public domain). Written in FL; there are no
\ primitives. All arithmetic is on 32-bit values held in ints: a product of two 32-bit values can
\ exceed 2^53, which ints promote to bigints exactly, and band 0xffffffff brings it back.
IN: murmur3

\ a * b modulo 2^32.
: _mul ( a:int b:int -- int )
  a b * 0xffffffff band ;

\ x rotated left by r bits, as a 32-bit value.
: _rotl ( x:int r:int -- int )
  x r shl x 32 r - shr bor 0xffffffff band ;

\ The key-mixing step: k * c1, rotl 15, * c2.
: _mixk ( k:int -- int )
  k 0xcc9e2d51 _mul 15 _rotl 0x1b873593 _mul ;

\ The little-endian 32-bit word number i of the data.
: _word ( data:bytes i:int -- int )
  data i 4 * nth
  data i 4 * 1 + nth 8 shl bor
  data i 4 * 2 + nth 16 shl bor
  data i 4 * 3 + nth 24 shl bor ;

\ One full block: h xor mixk(k), rotl 13, * 5 + 0xe6546b64.
: _round ( h:int k:int -- int )
  h k _mixk bxor 13 _rotl 5 * 0xe6546b64 + 0xffffffff band ;

\ The state after all the whole 4-byte blocks.
: _blocks ( data:bytes seed:int -- int )
  0 data len 4 div range seed [ data swap _word _round ] reduce ;

\ The r trailing bytes (1 to 3), starting at base, as a little-endian word.
: _tail-word ( data:bytes base:int r:int -- int )
  0 r range [ dup data swap base + nth swap 8 * shl ] map 0 [ bor ] reduce ;

\ h with the trailing bytes mixed in (unchanged when the length is a multiple of 4).
: _tail ( data:bytes h:int -- int )
  data len 4 mod 0 =
  [ h ]
  [ h data data len 4 div 4 * data len 4 mod _tail-word _mixk bxor ]
  if ;

\ The final avalanche.
: _fmix ( h:int -- int )
  h h 16 shr bxor 0x85ebca6b _mul
  dup 13 shr bxor 0xc2b2ae35 _mul
  dup 16 shr bxor ;

: digest ( data:bytes seed:int[0..4294967295]=0 -- bytes )
  "The MurmurHash3 x86_32 hash (Austin Appleby, SMHasher) of the input, a non-cryptographic 32-bit hash, as 4 raw bytes in big-endian order: the bytes of the 32-bit value as it is usually written in hex (SMHasher prints it that way; its own byte buffer holds the same value little-endian). Chain hex:encode for hex text. CyberChef shows the same value as an unsigned decimal. The seed is a 32-bit unsigned integer (default 0). Not for security." doc
  "Hashing" category
  data seed _blocks data swap _tail data len bxor _fmix 4 util:int>be-bytes ;

META: digest
  param seed "The 32-bit seed, 0 to 4294967295." ;
;
