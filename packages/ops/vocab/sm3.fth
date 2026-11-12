\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sm3: the SM3 cryptographic hash, GB/T 32905-2016 (the Chinese national standard, also
\ draft-sca-cfrg-sm3). The digest is 32 raw bytes; chain hex:encode for text. The hash itself is
\ _hash, a private primitive (src/prims/sm3.ts) written from the specification; the metadata is FL.
IN: sm3

: digest ( bytes -- bytes )
  "The SM3 digest (GB/T 32905-2016) of the input as 32 raw bytes. Chain hex:encode for hex text. Only the standard 64 rounds and the full 256-bit output exist." doc
  "Hashing" category
  _hash ;

META: digest
  use-when "You need an SM3 digest, the Chinese standard GB/T 32905-2016, to match a value from a system that uses it, such as Chinese national cryptography." ;
;
