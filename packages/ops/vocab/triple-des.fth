\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ triple-des: Triple DES (TDEA, NIST SP 800-67) in encrypt-decrypt-encrypt form, a block cipher on the
\ shared blockmode layer (see "Cipher conventions" in packages/ops/README.md). The single-block primitives
\ are private TypeScript (src/prims/triple-des.ts, composed from the DES block of src/prims/des.ts, never
\ from the modes); every mode and the PKCS#7 padding come from blockmode. Bytes in and bytes out.
IN: triple-des

USING: blockmode ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "Triple DES encryption (EDE, NIST SP 800-67) of the input bytes, 64-bit blocks. The key is 24 bytes (three independent DES keys) or 16 bytes (two-key Triple DES: the third key is the first), as in CyberChef; another length is E_RANGE. The IV is 8 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE); CFB (full-block CFB-64), OFB and CTR keep the length. CTR increments only the last four bytes of the 8-byte counter block, modulo 2^32 with no carry into the rest, as CyberChef's does (node-forge's inc32); it differs from a whole-block counter only after 2^32 blocks. With three equal keys it is single DES. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  mode "CTR32" blockmode:ctr-as iv 8 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "Triple DES decryption, the inverse of triple-des:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) is E_COERCE, and so is ciphertext that is not whole 8-byte blocks in CBC or ECB. A key or IV of the wrong length is E_RANGE." doc
  "Encryption" category
  key _check-key
  mode "CTR32" blockmode:ctr-as iv 8 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ;

META: encrypt
  param key "The Triple DES key: 24 bytes (K1, K2, K3), or 16 bytes (K1, K2, with K3 = K1)." ;
  param iv "The initialisation vector: 8 bytes for CBC, CFB, OFB and CTR. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  see-also triple-des:decrypt des:encrypt hex:encode ;
;

META: decrypt
  param key "The Triple DES key: 24 bytes, or 16 bytes (K3 = K1)." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also triple-des:encrypt hex:decode ;
;
