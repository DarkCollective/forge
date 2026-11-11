\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ chacha: the ChaCha stream cipher (Bernstein; RFC 8439 for the 12-byte nonce), the exemplar of the stream
\ ciphers of packages/ops/README.md. A stream cipher XORs a keystream over the data, so one word does both
\ directions. The keystream is _crypt, a private primitive over the audited @noble/ciphers (src/prims/chacha.ts).
\ The parameters and the metadata are FL.
IN: chacha

: encrypt ( bytes key:key{hex|utf8|latin1|base64} nonce:key{hex|utf8|latin1|base64}="" counter:int[0..]=0 rounds:choice{"20"|"12"|"8"}="20" -- bytes )
  "ChaCha stream cipher (Bernstein; RFC 8439 for the 12-byte nonce). Encryption and decryption are the same operation: the keystream is XORed over the bytes. The key is 16 or 32 bytes. The nonce is 12 bytes (RFC 8439: a 4-byte block counter, 20, 12 or 8 rounds, and a 32-byte key) or 8 bytes (the original layout: a 64-bit block counter, 20 rounds, a 16- or 32-byte key); the nonce is required (E_RANGE when empty). The counter is the first block's number, from 0. A 16-byte key with a 12-byte nonce, and reduced rounds with an 8-byte nonce, are E_RANGE. Chain hex:encode for text." doc
  "Encryption" category
  key nonce counter rounds _crypt ;

META: encrypt
  param key "The ChaCha key: 32 bytes (RFC 8439), or 16 or 32 bytes with an 8-byte nonce." ;
  param nonce "The nonce: 12 bytes (RFC 8439) or 8 bytes (the original layout). Never reuse a nonce under one key." ;
  param counter "The block counter of the first block, from 0. Four bytes with a 12-byte nonce, eight with an 8-byte one." ;
  param rounds "The round count: 20 (the standard), 12 or 8. Reduced rounds need the 12-byte nonce." ;
  see-also hex:encode ;
;
