\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ md5: MD5, RFC 1321. One word, no parameter. The digest is raw bytes; chain hex:encode for text.
\ MD5 is broken for collisions and is here for formats that still use it. The hash itself is _hash,
\ a private primitive (src/prims/md5.ts) over the audited @noble/hashes library.
IN: md5

: digest ( bytes -- bytes )
  "The MD5 digest (RFC 1321) of the input as 16 raw bytes. MD5 is broken for collisions: use it only where a format requires it. Chain hex:encode for hex text." doc
  "Hashing" category
  _hash ;

META: digest
  see-also sha1:digest sha2:digest ;
;
