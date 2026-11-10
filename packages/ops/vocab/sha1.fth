\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sha1: SHA-1, FIPS 180-4. One word, no parameter. The digest is raw bytes; chain hex:encode for text.
\ SHA-1 is broken for collisions and is here for formats that still use it. The hash itself is _hash,
\ a private primitive (src/prims/sha1.ts) over the audited @noble/hashes library.
IN: sha1

: digest ( bytes -- bytes )
  "The SHA-1 digest (FIPS 180-4) of the input as 20 raw bytes. SHA-1 is broken for collisions: use it only where a format requires it. Chain hex:encode for hex text." doc
  "Hashing" category
  _hash ;

META: digest
  see-also sha2:digest ;
;
