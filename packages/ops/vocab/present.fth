\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ present: the PRESENT ultra-lightweight block cipher (CHES 2007, ISO/IEC 29192-2) with an 80-bit or 128-bit key
\ and the modes ECB and CBC that CyberChef offers (the shared blockmode layer also gives CFB, OFB and CTR, which
\ are offered too). The block function is a private primitive pair (src/prims/present.ts). As in CyberChef, the
\ key is 10 or 16 bytes, written as the paper writes it (most significant byte first).
IN: present

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "PRESENT encryption of the input bytes: 64-bit blocks, 31 rounds, a key of 10 bytes (80 bits) or 16 bytes (128 bits), E_RANGE for any other length. Block and key are big-endian, as in the vectors of the CHES 2007 paper. The IV is 8 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE). CyberChef offers only ECB and CBC; CFB (CFB-64), OFB and CTR come from the shared mode layer. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  mode iv 8 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "PRESENT decryption, the inverse of present:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) and CBC or ECB input that is not whole blocks are E_COERCE. A key of the wrong length is E_RANGE." doc
  "Encryption" category
  key _check-key
  mode iv 8 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ;

META: encrypt
  use-when "You need PRESENT, the 64-bit lightweight block cipher of ISO/IEC 29192-2, with an 80 or 128-bit key, for a device or a test vector." ;
  param key "The PRESENT key: 10 bytes (80 bits) or 16 bytes (128 bits)." ;
  param iv "The initialisation vector: 8 bytes for CBC, CFB, OFB and CTR. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  see-also present:decrypt hex:encode ;
  inverse decrypt ;
;

META: decrypt
  use-when "You have PRESENT ciphertext in 64-bit blocks with its key, from a device or a test vector, and you want the plaintext back." ;
  param key "The PRESENT key used to encrypt." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also present:encrypt hex:decode ;
  inverse encrypt ;
;
