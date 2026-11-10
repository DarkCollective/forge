\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ streebog: the GOST R 34.11-2012 hash "Streebog" (RFC 6986), with 256- or 512-bit output. The digest
\ is raw bytes: the little-endian byte string of the number the RFC prints (the reverse of the RFC's
\ printed hex); chain hex:encode for text. The hash itself is _hash, a private primitive
\ (src/prims/streebog.ts); the parameter and the metadata are FL.
IN: streebog

: digest ( bytes size:choice{"256"|"512"}="256" -- bytes )
  "The Streebog (GOST R 34.11-2012, RFC 6986) digest of the input as 32 or 64 raw bytes by size. Chain hex:encode for hex text." doc
  "Hashing" category
  size _hash ;

META: digest
  param size "The output size in bits: 256 or 512." ;
;
