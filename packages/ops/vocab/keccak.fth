\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ keccak: Keccak as submitted to the SHA-3 competition, with the original padding (0x01) rather than the
\ FIPS 202 domain padding (0x06), so its digests differ from sha3:digest. CyberChef's Keccak operation
\ is this. One word with a size parameter. The digest is raw bytes; chain hex:encode for text. The hash
\ itself is _hash, a private primitive (src/prims/keccak.ts) over the audited @noble/hashes library.
IN: keccak

: digest ( bytes size:choice{"224"|"256"|"384"|"512"}="512" -- bytes )
  "The Keccak digest of the input as raw bytes: 28, 32, 48 or 64 bytes by size, with the original Keccak padding (not FIPS 202 SHA-3). Chain hex:encode for hex text." doc
  "Hashing" category
  size _hash ;

META: digest
  param size "The output size in bits: 224, 256, 384 or 512." ;
  see-also shake:digest ;
;
