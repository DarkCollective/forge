\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rc2: the RC2 block cipher (RFC 2268), on the shared blockmode layer (see "Cipher conventions" in
\ packages/ops/README.md). The single-block primitives and the key check are private TypeScript
\ (src/prims/rc2.ts); the modes and PKCS#7 padding come from blockmode. CyberChef's RC2 offers only ECB
\ and CBC (CBC when an IV is given, ECB when it is blank) and no effective-key-bits setting; here the mode
\ is explicit, and the effective key bits of RFC 2268 are a parameter whose default, 128, is the one
\ CyberChef's library uses whatever the key length. Bytes in and bytes out.
IN: rc2

USING: blockmode ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" effective-bits:int[1..1024]=128 -- bytes )
  "RC2 encryption (RFC 2268) of the input bytes, 64-bit blocks. The key is 1 to 128 bytes (E_RANGE otherwise). effective-bits (1 to 1024, default 128) is the effective key length T1 of the RFC key expansion; 64 and 40 are the common export-grade values, and the RFC 2268 test vectors use 63 to 129. The IV is 8 bytes for CBC (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to both modes: with none the input must be whole 8-byte blocks (E_COERCE). Chain hex:encode for text." doc
  "Encryption" category
  key effective-bits _check-key
  mode iv 8 padding "pkcs7" = [ key effective-bits _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" effective-bits:int[1..1024]=128 -- bytes )
  "RC2 decryption, the inverse of rc2:encrypt with the same key, IV, mode, padding and effective-bits. PKCS#7 padding that does not check (usually a wrong key, IV or effective-bits) is E_COERCE, and so is ciphertext that is not whole 8-byte blocks. A key or IV of the wrong length is E_RANGE." doc
  "Encryption" category
  key effective-bits _check-key
  mode iv 8 padding "pkcs7" = [ key effective-bits _encrypt-block ] [ key effective-bits _decrypt-block ] blockmode:decrypt ;

META: encrypt
  use-when "You have RC2 data from an older protocol or file, with its key, effective key bits and mode. RC2 is weak, so use it for existing data only." ;
  param key "The RC2 key: 1 to 128 bytes." ;
  param iv "The initialisation vector: 8 bytes for CBC. Ignored for ECB." ;
  param mode "The mode of operation: CBC or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks)." ;
  param effective-bits "The effective key length in bits (T1 of RFC 2268), 1 to 1024." ;
  see-also rc2:decrypt hex:encode ;
  inverse decrypt ;
  link "https://www.rfc-editor.org/rfc/rfc2268" "RFC 2268: the RC2 cipher" ;
  link "https://en.wikipedia.org/wiki/RC2" "RC2 on Wikipedia" ;
;

META: decrypt
  use-when "You have RC2 ciphertext from an old system, with its key, IV and effective key bits, and you want the plaintext. RC2 is weak, so use it for existing data only." ;
  param key "The RC2 key: 1 to 128 bytes." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none." ;
  param effective-bits "The effective key length in bits used to encrypt." ;
  see-also rc2:encrypt hex:decode ;
  inverse encrypt ;
  link "https://www.rfc-editor.org/rfc/rfc2268" "RFC 2268: the RC2 cipher" ;
  link "https://en.wikipedia.org/wiki/RC2" "RC2 on Wikipedia" ;
  checks input binary ;
  expects "encrypted data" ;
;
