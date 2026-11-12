\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ md4: MD4, RFC 1320. The digest is raw bytes; chain hex:encode for text. The hash itself is _hash, a
\ private primitive (src/prims/md4.ts) written from the RFC; the metadata is FL.
IN: md4

: digest ( bytes -- bytes )
  "The MD4 digest (RFC 1320) of the input as 16 raw bytes. Chain hex:encode for hex text. MD4 is obsolete and broken: do not use it for security." doc
  "Hashing" category
  _hash ;

META: digest
  use-when "You need to reproduce an MD4 value from an old system, such as the base of the NT hash, to compare it. MD4 is broken, so not for new security." ;
  link "https://www.rfc-editor.org/rfc/rfc1320" "RFC 1320: the MD4 algorithm" ;
  link "https://en.wikipedia.org/wiki/MD4" "MD4 on Wikipedia" ;
;
