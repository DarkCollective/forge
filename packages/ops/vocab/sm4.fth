\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sm4: the SM4 block cipher (GB/T 32907-2016), on the shared blockmode layer (see "Cipher conventions" in
\ packages/ops/README.md). The single-block primitives and the key check are private TypeScript
\ (src/prims/sm4.ts); every mode and the PKCS#7 padding come from blockmode. CyberChef's CBC/NoPadding and
\ ECB/NoPadding modes are the padding parameter here. Bytes in and bytes out.
IN: sm4

USING: blockmode ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "SM4 encryption (GB/T 32907-2016) of the input bytes, 128-bit blocks. The key is 16 bytes; another length is E_RANGE. The IV is 16 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 16-byte blocks (E_COERCE); CFB (CFB-128), OFB and CTR keep the length. CTR increments the whole 16-byte counter block. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  mode iv 16 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "SM4 decryption, the inverse of sm4:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) is E_COERCE, and so is ciphertext that is not whole 16-byte blocks in CBC or ECB. A key or IV of the wrong length is E_RANGE." doc
  "Encryption" category
  key _check-key
  mode iv 16 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ;

META: encrypt
  param key "The SM4 key: 16 bytes." ;
  param iv "The initialisation vector: 16 bytes for CBC, CFB, OFB and CTR. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-128), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 16-byte blocks). Applies to CBC and ECB only." ;
  see-also sm4:decrypt hex:encode ;
;

META: decrypt
  param key "The SM4 key: 16 bytes." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also sm4:encrypt hex:decode ;
;
