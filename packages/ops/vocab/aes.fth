\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ aes: AES (FIPS 197) with the modes ECB, CBC, CFB, OFB, CTR (NIST SP 800-38A) and GCM (SP 800-38D),
\ the exemplar of the "Cipher conventions" of packages/ops/README.md. Bytes in and bytes out; the key
\ and the IV are key-type parameters, so hex, UTF-8, Latin-1 and Base64 come for free. The block work
\ is _crypt and _gcm, private primitives over the audited @noble/ciphers (src/prims/aes.ts). Noble has
\ no OFB, so OFB runs on the shared blockmode layer with the raw AES block function _block-enc, which
\ also proves that layer against AES. The parameters and the metadata are FL.
IN: aes

USING: blockmode ;

\ OFB through the shared mode layer; the same call both ways (decryption runs the cipher forwards).
: _ofb ( data:bytes key:bytes iv:bytes -- bytes )
  key _check-key
  data "OFB" iv 16 false [ key _block-enc ] blockmode:encrypt ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|GCM|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" aad:key{hex|utf8|latin1|base64}="" -- bytes )
  "AES encryption (FIPS 197) of the input bytes. The key is 16, 24 or 32 bytes (AES-128, -192, -256); a wrong length is E_RANGE. The IV is 16 bytes for CBC, CFB, OFB and CTR (E_RANGE otherwise), at least 8 bytes for GCM (12 is usual) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 16-byte blocks (E_COERCE); CFB, OFB, CTR and GCM keep the length. GCM authenticates the additional data aad and appends the 16-byte tag to the ciphertext. CTR increments only the last four bytes of the 16-byte counter block, modulo 2^32 with no carry into the rest, as CyberChef's does (node-forge's inc32); it differs from a whole-block counter (SP 800-38A) only after 2^32 blocks. CFB is CFB-128. Chain hex:encode for text." doc
  "Encryption" category
  mode "OFB" =
  [ key iv _ofb ] [
  mode "GCM" =
  [ key iv aad false _gcm ]
  [ key iv mode padding "pkcs7" = false _crypt ] if ] if ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|GCM|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" aad:key{hex|utf8|latin1|base64}="" -- bytes )
  "AES decryption, the inverse of aes:encrypt with the same key, IV, mode, padding and aad. PKCS#7 padding that does not check (usually a wrong key or IV) is E_COERCE, and so is a GCM tag that does not verify (the last 16 bytes of the input are the tag; wrong key, IV, data or aad). A key or IV of the wrong length is E_RANGE. No plaintext is returned when GCM authentication fails." doc
  "Encryption" category
  mode "OFB" =
  [ key iv _ofb ] [
  mode "GCM" =
  [ key iv aad true _gcm ]
  [ key iv mode padding "pkcs7" = true _crypt ] if ] if ;

META: encrypt
  param key "The AES key: 16, 24 or 32 bytes (AES-128, -192 or -256)." ;
  param iv "The initialisation vector or nonce: 16 bytes for CBC, CFB, OFB and CTR, at least 8 for GCM (12 recommended). Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-128), OFB, CTR, GCM (authenticated) or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole blocks). Applies to CBC and ECB only." ;
  param aad "GCM additional authenticated data, covered by the tag but not encrypted. Unused by the other modes." ;
  see-also aes:decrypt hex:encode ;
;

META: decrypt
  param key "The AES key: 16, 24 or 32 bytes (AES-128, -192 or -256)." ;
  param iv "The initialisation vector or nonce used to encrypt." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  param aad "GCM additional authenticated data; it must be the same as when encrypting." ;
  see-also aes:encrypt hex:decode ;
;
