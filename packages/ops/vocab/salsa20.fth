\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ salsa20: the Salsa20/20 stream cipher (Bernstein, eSTREAM), a stream cipher like chacha, with the Salsa20
\ keystream from the audited @noble/ciphers (src/prims/salsa20.ts). Noble runs 20 rounds only, so there is
\ no rounds parameter (CyberChef's 12 and 8 are not offered; see docs/coverage/stream-ciphers.json).
IN: salsa20

\ util-candidate: xor-stream
: encrypt ( bytes key:key{hex|utf8|latin1|base64} nonce:key{hex|utf8|latin1|base64}="" counter:int[0..]=0 -- bytes )
  "Salsa20/20 stream cipher (Bernstein, eSTREAM). Encryption and decryption are the same operation: the keystream is XORed over the bytes. The key is 16 or 32 bytes (E_RANGE otherwise); the nonce is 8 bytes (E_RANGE otherwise, so an empty nonce is an error); the counter is the 64-bit block counter of the first block, from 0. Only 20 rounds exist here. Chain hex:encode for text." doc
  "Encryption" category
  key nonce counter _crypt ;

META: encrypt
  param key "The Salsa20 key: 16 or 32 bytes (128 or 256 bits)." ;
  param nonce "The 8-byte nonce. Never reuse a nonce under one key." ;
  param counter "The 64-bit block counter of the first block, from 0." ;
  see-also hex:encode ;
;
