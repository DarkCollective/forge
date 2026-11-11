\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ shake: SHAKE128 and SHAKE256, FIPS 202: extendable-output functions, so the length is a parameter. The
\ output is raw bytes; chain hex:encode for text. The length is in bytes, not bits: CyberChef's Shake
\ takes bits (default 512), so its 512 is 64 here. The hash itself is _hash, a private primitive
\ (src/prims/shake.ts) over the audited @noble/hashes library; the parameters and the metadata are FL.
IN: shake

: digest ( bytes variant:choice{"128"|"256"}="256" length:int[1..65536]=64 -- bytes )
  "The SHAKE digest (FIPS 202) of the input: length bytes of SHAKE128 (variant 128) or SHAKE256 (variant 256). The length is in bytes, from 1 to 65536; the output of a shorter length is a prefix of a longer one. Chain hex:encode for hex text." doc
  "Hashing" category
  variant length _hash ;

META: digest
  param variant "The security strength: 128 for SHAKE128, 256 for SHAKE256." ;
  param length "The output length in bytes (1 to 65536)." ;
;
