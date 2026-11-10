\ whirlpool: the Whirlpool hash, ISO/IEC 10118-3 (the final, third version). 512-bit digest. The digest
\ is 64 raw bytes; chain hex:encode for text. The hash itself is _hash, a private primitive
\ (src/prims/whirlpool.ts); the metadata is FL. The earlier Whirlpool-0 and Whirlpool-T variants are
\ not offered.
IN: whirlpool

: digest ( bytes -- bytes )
  "The Whirlpool digest (ISO/IEC 10118-3, final version) of the input as 64 raw bytes. Chain hex:encode for hex text. Only the standard 10 rounds exist." doc
  "Hashing" category
  _hash ;
