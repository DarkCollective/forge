\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ascon: the Ascon lightweight family as CyberChef offers it, in the version of NIST SP 800-232:
\ Ascon-Hash256, Ascon-Mac and Ascon-AEAD128, with no variant parameters (CyberChef has none). Bytes in and
\ bytes out; the key and the nonce are key-type parameters. CyberChef's Input and Output menus (raw or
\ hex) are chain steps (hex:decode, hex:encode). The permutation and the modes are _hash, _mac and
\ _aead, private primitives (src/prims/ascon.ts): the permutation is a bit-sliced loop far too slow
\ in FL at 64 KiB. Ascon-Mac is the PRF-based MAC of the Ascon designers' reference code, not a
\ word of SP 800-232 itself.
IN: ascon

: hash ( bytes -- bytes )
  "Ascon-Hash256 (NIST SP 800-232) of the input: 32 raw bytes. Chain hex:encode for hex text." doc
  "Hashing" category
  _hash ;

: mac ( data:bytes key:key{hex|utf8|latin1|base64} -- bytes )
  "Ascon-Mac of the input under a 16-byte key (a key of another length is E_RANGE): a 16-byte tag, as raw bytes. Chain hex:encode for hex text." doc
  "Hashing" category
  data key _mac ;

: encrypt ( data:bytes key:key{hex|utf8|latin1|base64} nonce:key{hex|utf8|latin1|base64} ad:key{hex|utf8|latin1|base64}="" -- bytes )
  "Ascon-AEAD128 authenticated encryption (NIST SP 800-232) of the input. The key and the nonce are 16 bytes each (E_RANGE otherwise); never reuse a nonce under one key. The additional data ad is authenticated but not encrypted, and must be the same when decrypting. The output is the ciphertext followed by the 16-byte tag, as in CyberChef. Chain hex:encode for text." doc
  "Encryption" category
  data key nonce ad false _aead ;

: decrypt ( data:bytes key:key{hex|utf8|latin1|base64} nonce:key{hex|utf8|latin1|base64} ad:key{hex|utf8|latin1|base64}="" -- bytes )
  "Ascon-AEAD128 authenticated decryption (NIST SP 800-232), the inverse of ascon:encrypt with the same key, nonce and additional data. The last 16 bytes of the input are the tag. A tag that does not verify (wrong key, nonce, data or additional data), or an input shorter than the tag, is E_COERCE and returns no plaintext. A key or nonce of the wrong length is E_RANGE." doc
  "Encryption" category
  data key nonce ad true _aead ;

META: mac
  param key "The 16-byte MAC key." ;
  see-also hmac:digest cmac:digest hex:encode ;
;

META: encrypt
  param key "The 16-byte key." ;
  param nonce "The 16-byte nonce; unique for every message under one key." ;
  param ad "Associated data: authenticated, not encrypted. Empty by default." ;
  see-also ascon:decrypt hex:encode ;
;

META: decrypt
  param key "The 16-byte key used to encrypt." ;
  param nonce "The 16-byte nonce used to encrypt." ;
  param ad "The associated data used to encrypt." ;
  see-also ascon:encrypt hex:decode ;
;

META: hash
  see-also ascon:mac sha3:digest hex:encode ;
;
