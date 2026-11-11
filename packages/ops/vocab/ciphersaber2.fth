\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ciphersaber2: CipherSaber-2, RC4 keyed with the key and a 10-byte IV and a repeated key setup. Encryption
\ draws the IV at random (the +random effect is inferred from _random-iv) and puts it in front of the
\ ciphertext; decryption takes the first 10 bytes as the IV. The key stream is a private primitive
\ (src/prims/ciphersaber2.ts), like RC4's.
IN: ciphersaber2

: encrypt ( bytes key:key{hex|utf8|latin1|base64} rounds:int[1..10000]=20 -- bytes )
  "CipherSaber-2 encryption. A fresh random 10-byte IV is drawn, RC4 is keyed with the key followed by the IV (the key setup repeated rounds times; CipherSaber-1 is 1 round), and the output is the IV followed by the encrypted input. The word is not deterministic; to reproduce a ciphertext, decrypt a known one. Chain hex:encode for text." doc
  "Encryption" category
  _random-iv tuck key swap rounds _crypt cat ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} rounds:int[1..10000]=20 -- bytes )
  "CipherSaber-2 decryption, the inverse of ciphersaber2:encrypt with the same key and rounds: the first 10 bytes of the input are the IV and the rest is decrypted. Input shorter than the 10-byte IV is E_COERCE. A wrong key or round count gives garbage, not an error (there is no check value)." doc
  "Encryption" category
  dup len 10 < [ "the input is shorter than the 10-byte CipherSaber IV" raise:coerce ] when
  dup 0 10 slice swap 10 over len slice
  swap key swap rounds _crypt ;

META: encrypt
  param key "The CipherSaber key (up to 246 bytes by the specification; longer keys work but are not CipherSaber)." ;
  param rounds "How many times the RC4 key setup is repeated (default 20, the CipherSaber-2 value; 1 is CipherSaber-1)." ;
  see-also ciphersaber2:decrypt rc4:crypt hex:encode ;
;

META: decrypt
  param key "The key used to encrypt." ;
  param rounds "The round count used to encrypt." ;
  see-also ciphersaber2:encrypt rc4:crypt hex:decode ;
;
