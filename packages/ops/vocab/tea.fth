\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ tea: the Tiny Encryption Algorithm (Wheeler and Needham, 1994) with the modes ECB, CBC, CFB, OFB and CTR.
\ Follows the "Cipher conventions" of packages/ops/README.md: the block function is a private primitive
\ pair (src/prims/tea.ts) and the shared blockmode layer supplies the modes and PKCS#7 padding. As in
\ CyberChef, an empty input gives an empty output in every mode, and an empty IV is eight zero bytes.
IN: tea

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "TEA (Tiny Encryption Algorithm) encryption of the input bytes: 64-bit blocks, a 128-bit key (16 bytes, E_RANGE otherwise), 32 cycles (64 rounds), the key and block words read big-endian (CyberChef's order). The IV is 8 bytes for CBC, CFB, OFB and CTR (empty means eight zero bytes; E_RANGE for any other length) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE). CFB is CFB-64 and CTR increments the whole 8-byte counter block. An empty input gives an empty output. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  dup len 0 = [ ] [ mode iv 8 util:iv-or-zeros 8 padding "pkcs7" = [ key _encrypt-block ] blockmode:encrypt ] if ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" -- bytes )
  "TEA decryption, the inverse of tea:encrypt with the same key, IV, mode and padding. PKCS#7 padding that does not check (usually a wrong key or IV) and CBC or ECB input that is not whole blocks are E_COERCE. A key of the wrong length is E_RANGE. An empty input gives an empty output." doc
  "Encryption" category
  key _check-key
  dup len 0 = [ ] [ mode iv 8 util:iv-or-zeros 8 padding "pkcs7" = [ key _encrypt-block ] [ key _decrypt-block ] blockmode:decrypt ] if ;

META: encrypt
  use-when "You have a 16-byte TEA key and data from an old system that uses the Tiny Encryption Algorithm. TEA is weak, so use it for existing data only." ;
  param key "The TEA key: 16 bytes." ;
  param iv "The initialisation vector: 8 bytes for CBC, CFB, OFB and CTR (empty means zeros). Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  see-also tea:decrypt xtea:encrypt hex:encode ;
  inverse decrypt ;
  link "https://en.wikipedia.org/wiki/Tiny_Encryption_Algorithm" "Tiny Encryption Algorithm on Wikipedia" ;
;

META: decrypt
  use-when "You have TEA ciphertext with its key, IV and mode, from an old system, and you want the plaintext. Use it for reading existing data only." ;
  param key "The TEA key used to encrypt." ;
  param iv "The initialisation vector used to encrypt (empty means zeros)." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  see-also tea:encrypt xtea:decrypt hex:decode ;
  inverse encrypt ;
  link "https://en.wikipedia.org/wiki/Tiny_Encryption_Algorithm" "Tiny Encryption Algorithm on Wikipedia" ;
;
