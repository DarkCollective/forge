\ md4: MD4, RFC 1320. The digest is raw bytes; chain hex:encode for text. The hash itself is _hash, a
\ private primitive (src/prims/md4.ts) written from the RFC; the metadata is FL.
IN: md4

: digest ( bytes -- bytes )
  "The MD4 digest (RFC 1320) of the input as 16 raw bytes. Chain hex:encode for hex text. MD4 is obsolete and broken: do not use it for security." doc
  "Hashing" category
  _hash ;
