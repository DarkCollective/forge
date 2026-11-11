\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sha2: the SHA-2 family, FIPS 180-4 (SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/224, SHA-512/256).
\ One word with a size parameter. The digest is raw bytes; chain hex:encode for text. The hash itself
\ is _hash, a private primitive (src/prims/sha2.ts) over the audited @noble/hashes library; the
\ parameter and the metadata are FL.
IN: sha2

: digest ( bytes size:choice{"224"|"256"|"384"|"512"|"512/224"|"512/256"}="512" -- bytes )
  "The SHA-2 digest (FIPS 180-4) of the input as raw bytes: 28, 32, 48 or 64 bytes by size. Chain hex:encode for hex text. Only the standard round counts are supported (64 for 224 and 256, 80 for the others)." doc
  "Hashing" category
  size _hash ;

META: digest
  param size "The variant: 224, 256, 384, 512, 512/224 or 512/256 (SHA-512 truncated)." ;
;
