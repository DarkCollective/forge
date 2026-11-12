\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ripemd160: RIPEMD-160 (Dobbertin, Bosselaers and Preneel, 1996). The word with no size parameter, used
\ by hmac; ripemd:digest offers it with the other sizes (128, 256, 320). The digest is raw bytes; chain
\ hex:encode for text. The hash itself is _hash, a private primitive (src/prims/ripemd160.ts)
\ over the audited @noble/hashes library.
IN: ripemd160

: digest ( bytes -- bytes )
  "The RIPEMD-160 digest of the input as 20 raw bytes. Chain hex:encode for hex text." doc
  "Hashing" category
  _hash ;

META: digest
  use-when "You need a RIPEMD-160 digest, as Bitcoin uses it in address derivation, or a value from another system that names it." ;
  see-also sha1:digest md5:digest ;
  link "https://en.wikipedia.org/wiki/RIPEMD" "RIPEMD on Wikipedia" ;
;
