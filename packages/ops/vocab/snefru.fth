\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ snefru: Merkle's Snefru one-way hash (Xerox Secure Hash Function, reference version 2.5a). Output
\ of 128 or 256 bits and 2, 4 or 8 passes. The digest is raw bytes; chain hex:encode for text. The
\ hash itself is _hash, a private primitive (src/prims/snefru.ts); the parameters and the metadata
\ are FL. Derived from the Xerox Secure Hash Function.
IN: snefru

: digest ( bytes size:choice{"128"|"256"}="128" rounds:choice{"2"|"4"|"8"}="8" -- bytes )
  "The Snefru digest (Merkle; derived from the Xerox Secure Hash Function) of the input as 16 or 32 raw bytes by size. Chain hex:encode for hex text. Rounds are the number of passes; 8 is the recommended one, 2 and 4 are broken or weak." doc
  "Hashing" category
  size rounds _hash ;

META: digest
  use-when "You have a Snefru value from an old tool, with its size and number of passes, and want to reproduce it. Eight passes is the recommended setting." ;
  param size "The output size in bits: 128 or 256." ;
  param rounds "The number of passes: 2, 4 or 8." ;
  link "https://en.wikipedia.org/wiki/Snefru" "Snefru on Wikipedia" ;
;
