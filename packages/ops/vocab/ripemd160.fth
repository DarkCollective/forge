\ ripemd160: RIPEMD-160 (Dobbertin, Bosselaers and Preneel, 1996). One word with a size choice that holds
\ only 160: the other RIPEMD sizes (128, 256, 320) are a separate vocabulary to come. The digest is raw
\ bytes; chain hex:encode for text. The hash itself is _hash, a private primitive (src/prims/ripemd160.ts)
\ over the audited @noble/hashes library.
IN: ripemd160

: digest ( bytes size:choice{"160"}="160" -- bytes )
  "The RIPEMD-160 digest of the input as 20 raw bytes. Chain hex:encode for hex text." doc
  "Hashing" category
  size _hash ;

META: digest
  param size "The output size in bits: only 160 (RIPEMD-160)." ;
  see-also sha1:digest md5:digest ;
;
