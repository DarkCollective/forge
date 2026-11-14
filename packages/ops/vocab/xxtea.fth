\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ xxtea: XXTEA (Corrected Block TEA). It is a variable-length block cipher: the whole message is one block of
\ n >= 2 32-bit words, so it does not use the blockmode layer and has no mode, IV or padding parameter. The
\ cipher and CyberChef's length-word convention are private primitives (src/prims/xxtea.ts).
IN: xxtea

: encrypt ( bytes key:key{hex|utf8|latin1|base64} -- bytes )
  "XXTEA (Corrected Block TEA) encryption. The key is at most 16 bytes, zero-padded (E_RANGE if longer). The input is zero-padded to whole 32-bit words, its byte length is appended as one more little-endian word, and the whole thing is enciphered as one block, so the output is 4 bytes longer than the input rounded up to words. This is CyberChef's convention and the usual XXTEA library one; XXTEA itself has no padding rule. An empty input gives an empty output. Chain hex:encode for text." doc
  "Encryption" category
  key _encrypt ;

: decrypt ( bytes key:key{hex|utf8|latin1|base64} -- bytes )
  "XXTEA decryption, the inverse of xxtea:encrypt: the input must be whole 4-byte words, at least two (E_COERCE), and the length word found after decryption must fit the data (E_COERCE otherwise, which usually means a wrong key). An empty input gives an empty output." doc
  "Encryption" category
  key _decrypt ;

META: encrypt
  use-when "You have an XXTEA key of up to 16 bytes and data from a system that uses the corrected block TEA, and you need its output. Use it for existing data only." ;
  param key "The XXTEA key: up to 16 bytes, zero-padded." ;
  see-also xxtea:decrypt tea:encrypt hex:encode ;
  inverse decrypt ;
;

META: decrypt
  use-when "You have XXTEA ciphertext of whole 32-bit words with its key, and you want the plaintext. A wrong key usually shows up as an error." ;
  param key "The key used to encrypt." ;
  see-also xxtea:encrypt hex:decode ;
  inverse encrypt ;
  checks input binary ;
  expects "encrypted data" ;
;
