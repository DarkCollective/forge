\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ xtea: XTEA, the eXtended TEA (Needham and Wheeler, 1997), with a configurable cycle count and the modes
\ ECB, CBC, CFB, OFB and CTR. Same shape as tea: a private block primitive pair (src/prims/xtea.ts) and the
\ shared blockmode layer. As in CyberChef, an empty input gives an empty output and an empty IV is zeros.
IN: xtea

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" rounds:int[1..255]=32 -- bytes )
  "XTEA encryption of the input bytes: 64-bit blocks, a 128-bit key (16 bytes, E_RANGE otherwise), rounds cycles (32 is the standard 64 rounds; each cycle is two Feistel rounds), the key and block words read big-endian (CyberChef's order). The IV is 8 bytes for CBC, CFB, OFB and CTR (empty means eight zero bytes; E_RANGE for any other length) and unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole 8-byte blocks (E_COERCE). CFB is CFB-64 and CTR increments the whole 8-byte counter block. An empty input gives an empty output. Chain hex:encode for text." doc
  "Encryption" category
  key _check-key
  dup len 0 = [ ] [ mode iv 8 util:iv-or-zeros 8 padding "pkcs7" = [ key rounds _encrypt-block ] blockmode:encrypt ] if ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" rounds:int[1..255]=32 -- bytes )
  "XTEA decryption, the inverse of xtea:encrypt with the same key, IV, mode, padding and rounds. PKCS#7 padding that does not check (usually a wrong key or IV) and CBC or ECB input that is not whole blocks are E_COERCE. A key of the wrong length is E_RANGE. An empty input gives an empty output." doc
  "Encryption" category
  key _check-key
  dup len 0 = [ ] [ mode iv 8 util:iv-or-zeros 8 padding "pkcs7" = [ key rounds _encrypt-block ] [ key rounds _decrypt-block ] blockmode:decrypt ] if ;

META: encrypt
  use-when "You have an XTEA key of 16 bytes and data from an old system or test that uses XTEA, and you need the output. XTEA is for existing data only." ;
  param key "The XTEA key: 16 bytes." ;
  param iv "The initialisation vector: 8 bytes for CBC, CFB, OFB and CTR (empty means zeros). Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (CFB-64), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole 8-byte blocks). Applies to CBC and ECB only." ;
  param rounds "The number of cycles (each is two rounds); 32 is the standard." ;
  see-also xtea:decrypt hex:encode ;
  inverse decrypt ;
  link "https://en.wikipedia.org/wiki/XTEA" "XTEA on Wikipedia" ;
  link "https://en.wikipedia.org/wiki/Tiny_Encryption_Algorithm" "Tiny Encryption Algorithm on Wikipedia" ;
;

META: decrypt
  use-when "You have XTEA ciphertext with its key, IV and cycle count, and you want the plaintext back. Use it for reading existing data only." ;
  param key "The XTEA key used to encrypt." ;
  param iv "The initialisation vector used to encrypt (empty means zeros)." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  param rounds "The number of cycles used to encrypt." ;
  see-also xtea:encrypt hex:decode ;
  inverse encrypt ;
  link "https://en.wikipedia.org/wiki/XTEA" "XTEA on Wikipedia" ;
  link "https://en.wikipedia.org/wiki/Tiny_Encryption_Algorithm" "Tiny Encryption Algorithm on Wikipedia" ;
;
