\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rc6: the RC6-w/r/b block cipher (Rivest, Robshaw, Sidney, Yin, 1998), on the shared blockmode layer (see
\ "Cipher conventions" in packages/ops/README.md). The single-block primitives and the key check are
\ private TypeScript (src/prims/rc6.ts); every mode and the PKCS#7 padding come from blockmode. Like
\ CyberChef, the word size w (a multiple of 8, 8 to 256) and the rounds r are parameters, the block is
\ w / 2 bytes (16 for the AES submission, w = 32 and r = 20), and a blank IV is taken as all zero bytes.
\ Bytes in and bytes out.
IN: rc6

USING: blockmode util ;

: encrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" word-size:int[8..256]=32 rounds:int[1..255]=20 -- bytes )
  "RC6-w/r encryption of the input bytes. The block is w / 2 bytes (16 for the standard word-size 32), made of four little-endian w-bit words; word-size is a multiple of 8 from 8 to 256 and rounds is 1 to 255 (the AES submission is 32 and 20); the key is at most 255 bytes, and a wrong value of any of these is E_RANGE. The IV is one block long for CBC, CFB, OFB and CTR, and an empty IV means all zero bytes (as in CyberChef); another length is E_RANGE. It is unused for ECB. padding (PKCS#7 or none) applies to CBC and ECB only: with none the input must be whole blocks (E_COERCE); CFB, OFB and CTR keep the length. CTR reads the block as a little-endian integer (first byte least significant) and adds one per block, as CyberChef's RC6 does. CyberChef's ZERO, RANDOM and BIT paddings are not offered. Sizes other than 32 run on BigInt arithmetic and are slow. Chain hex:encode for text." doc
  "Encryption" category
  key word-size rounds _check-key
  mode "CTRLE" blockmode:ctr-as iv word-size 2 div util:iv-or-zeros word-size 2 div padding "pkcs7" = [ key word-size rounds _encrypt-block ] blockmode:encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} iv:key{hex|utf8|latin1|base64}="" mode:choice{CBC|CFB|OFB|CTR|ECB}="CBC" padding:choice{pkcs7|none}="pkcs7" word-size:int[8..256]=32 rounds:int[1..255]=20 -- bytes )
  "RC6-w/r decryption, the inverse of rc6:encrypt with the same key, IV, mode, padding, word-size and rounds. PKCS#7 padding that does not check (usually a wrong key, IV or parameter) is E_COERCE, and so is ciphertext that is not whole blocks in CBC or ECB. A key, IV, word-size or rounds of the wrong value is E_RANGE." doc
  "Encryption" category
  key word-size rounds _check-key
  mode "CTRLE" blockmode:ctr-as iv word-size 2 div util:iv-or-zeros word-size 2 div padding "pkcs7" = [ key word-size rounds _encrypt-block ] [ key word-size rounds _decrypt-block ] blockmode:decrypt ;

META: encrypt
  param key "The RC6 key: at most 255 bytes (16, 24 or 32 for the AES submission)." ;
  param iv "The initialisation vector: one block (word-size / 2 bytes) for CBC, CFB, OFB and CTR; empty means zeros. Ignored for ECB." ;
  param mode "The mode of operation: CBC, CFB (full-block), OFB, CTR or ECB (no IV; leaks patterns)." ;
  param padding "PKCS#7 padding, or none (the input must then be whole blocks). Applies to CBC and ECB only." ;
  param word-size "The word size w in bits, a multiple of 8 from 8 to 256; 32 is the standard." ;
  param rounds "The number of rounds r, 1 to 255; 20 is the standard for w = 32." ;
  see-also rc6:decrypt hex:encode ;
;

META: decrypt
  param key "The RC6 key: at most 255 bytes." ;
  param iv "The initialisation vector used to encrypt; empty means zeros." ;
  param mode "The mode of operation used to encrypt." ;
  param padding "PKCS#7 padding, or none. Applies to CBC and ECB only." ;
  param word-size "The word size w used to encrypt." ;
  param rounds "The number of rounds used to encrypt." ;
  see-also rc6:encrypt hex:decode ;
;
