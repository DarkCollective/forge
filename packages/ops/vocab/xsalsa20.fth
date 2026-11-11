\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ xsalsa20: the XSalsa20/20 stream cipher (Salsa20 with a 192-bit nonce: HSalsa20 derives the subkey, the
\ keystream is Salsa20/20 over it), a stream cipher like salsa20, from the audited @noble/ciphers
\ (src/prims/xsalsa20.ts). Noble takes a 32-byte key only, so there is no 16-byte key here.
IN: xsalsa20

\ util-candidate: xor-stream
: encrypt ( bytes key:key{hex|utf8|latin1|base64} nonce:key{hex|utf8|latin1|base64}="" counter:int[0..]=0 -- bytes )
  "XSalsa20/20 stream cipher (Salsa20 with a 24-byte nonce, the construction of NaCl's secretbox). Encryption and decryption are the same operation: the keystream is XORed over the bytes. The key is 32 bytes (E_RANGE otherwise); the nonce is 24 bytes (E_RANGE otherwise, so an empty nonce is an error); the counter is the 64-bit block counter of the first block, from 0. Only 20 rounds exist here. Chain hex:encode for text." doc
  "Encryption" category
  key nonce counter _crypt ;

META: encrypt
  param key "The XSalsa20 key: 32 bytes (256 bits)." ;
  param nonce "The 24-byte nonce, long enough to pick at random. Never reuse a nonce under one key." ;
  param counter "The 64-bit block counter of the first block, from 0." ;
  see-also hex:encode ;
;
