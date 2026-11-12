\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ md6: the MD6 hash function (Rivest et al., the MD6 report submitted to NIST, 2008). The digest is
\ raw bytes; chain hex:encode for text. The hash itself is _hash, a private primitive
\ (src/prims/md6.ts); the parameters and the metadata are FL.
IN: md6

: digest ( bytes size:int[8..512]=256 levels:int[0..64]=64 key:str="" -- bytes )
  "The MD6 digest of the input as size/8 raw bytes. size is the digest length in bits (a multiple of 8). levels is the tree height L of the mode of operation (64 is the default of the report; 0 is fully sequential). key is an optional key of up to 64 bytes (UTF-8); with a key the round count is at least 80. The round count is the report's default, 40 + size/4. Chain hex:encode for hex text." doc
  "Hashing" category
  size levels key _hash ;

META: digest
  use-when "You need an MD6 value with a chosen size and tree height, to match a value that names MD6, a SHA-3 competition candidate that few systems use." ;
  param size "The digest length in bits, a multiple of 8 from 8 to 512." ;
  param levels "The number of parallel tree levels L (0 to 64) before the mode turns sequential." ;
  param key "An optional key, UTF-8 text of at most 64 bytes." ;
  link "https://en.wikipedia.org/wiki/MD6" "MD6 on Wikipedia" ;
;
