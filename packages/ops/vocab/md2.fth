\ md2: MD2, RFC 1319. The digest is raw bytes; chain hex:encode for text. The hash itself is _hash, a
\ private primitive (src/prims/md2.ts) written from the RFC; the metadata is FL.
IN: md2

: digest ( bytes -- bytes )
  "The MD2 digest (RFC 1319) of the input as 16 raw bytes. Chain hex:encode for hex text. Only the standard 18 rounds exist. MD2 is obsolete and broken: do not use it for security." doc
  "Hashing" category
  _hash ;
