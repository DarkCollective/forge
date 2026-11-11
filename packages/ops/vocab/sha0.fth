\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sha0: SHA-0, the original Secure Hash Standard (FIPS 180, 1993). The digest is raw bytes; chain
\ hex:encode for text. The hash itself is _hash, a private primitive (src/prims/sha0.ts); the
\ metadata is FL.
IN: sha0

: digest ( bytes -- bytes )
  "The SHA-0 digest (FIPS 180, 1993: SHA-1 without the rotation in the message schedule) of the input as 20 raw bytes. Chain hex:encode for hex text. Only the standard 80 rounds exist. SHA-0 is broken: do not use it for security." doc
  "Hashing" category
  _hash ;
