\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sha3: SHA-3, FIPS 202 (SHA3-224, SHA3-256, SHA3-384, SHA3-512). One word with a size parameter. The
\ digest is raw bytes; chain hex:encode for text. The hash itself is _hash, a private primitive
\ (src/prims/sha3.ts) over the audited @noble/hashes library; the parameter and the metadata are FL.
IN: sha3

: digest ( bytes size:choice{"224"|"256"|"384"|"512"}="512" -- bytes )
  "The SHA3 digest (FIPS 202) of the input as raw bytes: 28, 32, 48 or 64 bytes by size. Chain hex:encode for hex text. This is SHA-3 with the FIPS 202 domain padding; original Keccak padding is the keccak vocabulary." doc
  "Hashing" category
  size _hash ;

META: digest
  param size "The output size in bits: 224, 256, 384 or 512." ;
  see-also keccak:digest shake:digest ;
;
