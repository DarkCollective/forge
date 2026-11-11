\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ adler32: the Adler-32 checksum of RFC 1950. The per-byte loop is one private primitive, _adler
\ (src/prims/adler32.ts): in FL it needed the whole input as a list of integers (about 13 VM steps a byte,
\ and a list of 16 bytes per byte under the value limit), which capped it near 750 KB. The word, its
\ documentation and the four big-endian bytes of the result are FL.
IN: adler32

: checksum ( data:bytes -- bytes )
  "The Adler-32 checksum (RFC 1950, as used by zlib) as four big-endian bytes: b in the high 16 bits, a in the low 16. The empty input gives 00000001. Check value: Adler-32 of 123456789 is 091e01de." doc
  "Hashing" category
  data _adler 4 util:int>be-bytes ;

META: checksum
  see-also fletcher:checksum ;
;
