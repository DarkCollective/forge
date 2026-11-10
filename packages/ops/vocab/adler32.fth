\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ adler32: the Adler-32 checksum of RFC 1950, written in FL on the core words; no primitives.
\ With a = 1 + sum of the bytes and b = n + sum over i of (n - i) * byte i (the sums the RFC
\ updates one byte at a time), a and b need reducing only once at the end, so the whole checksum
\ is three linear passes. 65536 bytes take about 0.85 million steps (default limit: 10 million).
IN: adler32

: checksum ( data:bytes -- bytes )
  "The Adler-32 checksum (RFC 1950, as used by zlib) as four big-endian bytes: b in the high 16 bits, a in the low 16. The empty input gives 00000001. Check value: Adler-32 of 123456789 is 091e01de." doc
  "Hashing" category
  data bytes>list [ data len swap - * ] mapi 0 [ + ] reduce data len + 65521 mod
  data bytes>list 0 [ + ] reduce 1 + 65521 mod
  swap 65536 * + 4 util:int>be-bytes ;

META: checksum
  see-also fletcher:checksum ;
;
