\ ripemd: RIPEMD-128, RIPEMD-160, RIPEMD-256 and RIPEMD-320 (Dobbertin, Bosselaers, Preneel). One word with
\ a size parameter. The digest is raw bytes; chain hex:encode for text. RIPEMD-160 is ripemd160:digest
\ (over the audited @noble/hashes); the other sizes are _hash, a private primitive (src/prims/ripemd.ts).
IN: ripemd
USING: ripemd160 ;

: digest ( bytes size:choice{"128"|"160"|"256"|"320"}="160" -- bytes )
  "The RIPEMD digest of the input as raw bytes: 16, 20, 32 or 40 bytes by size. Chain hex:encode for hex text." doc
  "Hashing" category
  size "160" = [ ripemd160:digest ] [ size _hash ] if ;

META: digest
  param size "The variant: 128, 160, 256 or 320." ;
;
