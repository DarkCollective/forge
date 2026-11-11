\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ blowfish: the Blowfish block cipher (Schneier, 1993), on the shared blockmode layer (see "Cipher
\ conventions" in packages/ops/README.md). The single-block primitives and the key check are private
\ TypeScript (src/prims/blowfish.ts, whose key schedule is also what bcrypt builds on); every mode and the
\ PKCS#7 padding come from blockmode. Bytes in and bytes out.
IN: blowfish

USING: blockmode ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "Blowfish encryption of the input bytes, 64-bit blocks, big-endian words. The key is 4 to 56 bytes (32 to 448 bits, CyberChef's range); another length is E_RANGE. The IV is 8 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE); CFB (full-block CFB-64), OFB and CTR keep the length. CTR increments the whole 8-byte counter block. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  mode iv 8 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "Blowfish decryption, the inverse of blowfish:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) is E_COERCE, and so is ciphertext that is not whole 8-byte blocks in CBC or ECB. A key or IV of the wrong length is E_RANGE." doc
  "Encryption" category
  key _check-key
  mode iv 8 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ;

META: encrypt
  param key "The Blowfish key: 4 to 56 bytes." ;
  param iv "The initialisation vector: 8 bytes for CBC, CFB, OFB and CTR. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  see-also blowfish:decrypt hex:encode ;
;

META: decrypt
  param key "The Blowfish key: 4 to 56 bytes." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also blowfish:encrypt hex:decode ;
;
