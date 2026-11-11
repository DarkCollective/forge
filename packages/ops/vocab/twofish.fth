\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ twofish: the Twofish block cipher (Schneier et al., 1998), on the shared blockmode layer (see "Cipher
\ conventions" in packages/ops/README.md). The single-block primitives and the key check are private
\ TypeScript (src/prims/twofish.ts); every mode and the PKCS#7 padding come from blockmode. Bytes in and
\ bytes out.
IN: twofish

USING: blockmode ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "Twofish encryption of the input bytes, 128-bit blocks, little-endian words. The key is 16, 24 or 32 bytes (128, 192 or 256 bits); another length is E_RANGE. The IV is 16 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 16-byte blocks (E_COERCE); CFB (CFB-128), OFB and CTR keep the length. CTR reads the 16-byte counter block as a little-endian integer (first byte least significant) and adds one per block, as CyberChef's Twofish does; a big-endian CTR (as for AES) gives a different key stream after the first block. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  mode "CTRLE" blockmode:ctr-as iv 16 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "Twofish decryption, the inverse of twofish:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) is E_COERCE, and so is ciphertext that is not whole 16-byte blocks in CBC or ECB. A key or IV of the wrong length is E_RANGE." doc
  "Encryption" category
  key _check-key
  mode "CTRLE" blockmode:ctr-as iv 16 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ;

META: encrypt
  param key "The Twofish key: 16, 24 or 32 bytes." ;
  param iv "The initialisation vector: 16 bytes for CBC, CFB, OFB and CTR. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-128), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 16-byte blocks). Applies to CBC and ECB only." ;
  see-also twofish:decrypt hex:encode ;
;

META: decrypt
  param key "The Twofish key: 16, 24 or 32 bytes." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also twofish:encrypt hex:decode ;
;
