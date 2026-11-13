\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ des: the Data Encryption Standard (FIPS 46-3), one of the block ciphers on the shared blockmode layer
\ (see "Cipher conventions" in packages/ops/README.md). The single-block primitives _encrypt-block and
\ _decrypt-block and the key check _check-key are private TypeScript (src/prims/des.ts); every mode and
\ the PKCS#7 padding come from blockmode, so nothing here is a mode. Bytes in and bytes out; the key and
\ the IV are key-type parameters, so hex, UTF-8, Latin-1 and Base64 come for free.
IN: des

USING: blockmode ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "DES encryption (FIPS 46-3) of the input bytes, 64-bit blocks. The key is 8 bytes (56 bits plus parity, which is not checked); another length is E_RANGE. The IV is 8 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE); CFB (full-block CFB-64), OFB and CTR keep the length. CTR increments only the last four bytes of the 8-byte counter block, modulo 2^32 with no carry into the rest, as CyberChef's does (node-forge's inc32); it differs from a whole-block counter only after 2^32 blocks. DES is broken by exhaustive search; use it only for compatibility. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  mode "CTR32" blockmode:ctr-as iv 8 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "DES decryption, the inverse of des:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) is E_COERCE, and so is ciphertext that is not whole 8-byte blocks in CBC or ECB. A key or IV of the wrong length is E_RANGE." doc
  "Encryption" category
  key _check-key
  mode "CTR32" blockmode:ctr-as iv 8 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ;

META: encrypt
  use-when "You have a DES key of 8 bytes and data from an old protocol or file, and you need to reproduce its output. DES is broken, so use it for existing data only." ;
  param key "The DES key: 8 bytes (the least significant bit of each byte is a parity bit and is ignored)." ;
  param iv "The initialisation vector: 8 bytes for CBC, CFB, OFB and CTR. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  see-also des:decrypt hex:encode ;
  inverse decrypt ;
  link "https://en.wikipedia.org/wiki/Data_Encryption_Standard" "Data Encryption Standard on Wikipedia" ;
  link "https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation" "Block cipher mode of operation on Wikipedia" ;
;

META: decrypt
  use-when "You have DES ciphertext from an old system, with its key, IV and mode, and you want the plaintext. DES is broken, so use it for existing data only." ;
  param key "The DES key: 8 bytes." ;
  param iv "The initialisation vector used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also des:encrypt hex:decode ;
  inverse encrypt ;
  link "https://en.wikipedia.org/wiki/Data_Encryption_Standard" "Data Encryption Standard on Wikipedia" ;
;
