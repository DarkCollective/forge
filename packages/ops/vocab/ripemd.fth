\ ripemd: RIPEMD-128, RIPEMD-256 and RIPEMD-320 (Dobbertin, Bosselaers, Preneel). One word with a size
\ parameter. The digest is raw bytes; chain hex:encode for text. The hash itself is _hash, a private
\ primitive (src/prims/ripemd.ts). RIPEMD-160 is the vocabulary ripemd160, which does not exist yet
\ in this tree, so it is not offered here.
IN: ripemd

: digest ( bytes size:choice{"128"|"256"|"320"}="128" -- bytes )
  "The RIPEMD digest of the input as raw bytes: 16, 32 or 40 bytes by size. Chain hex:encode for hex text." doc
  "Hashing" category
  size _hash ;

META: digest
  param size "The variant: 128, 256 or 320." ;
;
