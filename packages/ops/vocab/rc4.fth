\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rc4: the RC4 (ARC4) stream cipher. Bytes in, bytes out; the key is a key-type parameter. One word
\ covers CyberChef's two rows: RC4 is drop 0 and RC4 Drop is a drop of 768 bytes (192 dwords, its
\ default), because RC4-drop[n] is RC4 with the first n key stream bytes discarded and the same word
\ both encrypts and decrypts (the cipher XORs a key stream). The state and the generator are one private
\ primitive (src/prims/rc4.ts): RC4 is a 256-byte mutable state, which FL has no fast array for.
IN: rc4

: crypt ( bytes key:key{hex|utf8|latin1|base64} drop:int[0..16777216]=0 -- bytes )
  "RC4 (ARC4) of the input bytes: the input is XORed with the RC4 key stream, so the same word encrypts and decrypts. The key is 1 to 256 bytes (E_RANGE otherwise). drop discards that many key stream bytes first (RC4-drop[n]; the first bytes of the stream leak information about the key): 0 is plain RC4 and 768 (192 dwords) is CyberChef's RC4 Drop default. Chain hex:encode for text. RC4 is broken for most uses; this is for compatibility and analysis." doc
  "Encryption" category
  key drop _crypt ;

META: crypt
  use-when "You have RC4 data and its key from an old protocol or file. RC4 is broken, so use it only for existing data. The same word decrypts." ;
  param key "The RC4 key: 1 to 256 bytes." ;
  param drop "How many key stream bytes to discard before encrypting (RC4-drop). 0 is plain RC4; CyberChef's RC4 Drop discards 192 dwords, which is 768 bytes." ;
  see-also hex:encode ;
  link "https://en.wikipedia.org/wiki/RC4" "RC4 on Wikipedia" ;
  link "https://www.rfc-editor.org/rfc/rfc6229" "RFC 6229: RC4 test vectors" ;
;
