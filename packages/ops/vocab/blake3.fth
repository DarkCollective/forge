\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ blake3: BLAKE3, with an output length (an extendable output: any length, the first bytes of a longer
\ output are the shorter one) and an optional 32-byte key for the keyed mode. The digest is raw bytes;
\ chain hex:encode for text. The hash itself is _hash, a private primitive (src/prims/blake3.ts) over the
\ audited @noble/hashes library; the parameters and the metadata are FL.
IN: blake3

: digest ( bytes length:int[1..65536]=32 key:key{utf8|hex|latin1|base64}[0|32]="" -- bytes )
  "The BLAKE3 digest of the input as raw bytes: length bytes (1 to 65536, 32 by default). A key of exactly 32 bytes makes the keyed mode; the empty key is the unkeyed hash. Chain hex:encode for hex text." doc
  "Hashing" category
  length key _hash ;

META: digest
  use-when "You need a BLAKE3 value, with a length of your choice or a 32-byte key, to match one from a system that names BLAKE3." ;
  param length "The output length in bytes, 1 to 65536 (32 by default)." ;
  param key "The 32-byte key for the keyed mode. Empty (the default) for the unkeyed hash." ;
;
