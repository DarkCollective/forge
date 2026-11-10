\ has160: the HAS-160 hash, TTAS.KO-12.0011/R2 (the Korean standard, used with KCDSA). 160 bits, 512-bit
\ blocks, 80 steps. The digest is 20 raw bytes; chain hex:encode for text. The hash itself is _hash,
\ a private primitive (src/prims/has160.ts); the metadata is FL.
IN: has160

: digest ( bytes -- bytes )
  "The HAS-160 digest (TTAS.KO-12.0011/R2) of the input as 20 raw bytes. Chain hex:encode for hex text. Only the standard 80 steps exist." doc
  "Hashing" category
  _hash ;
