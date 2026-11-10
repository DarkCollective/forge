\ blake2b: BLAKE2b, RFC 7693, with the output sizes of CyberChef's BLAKE2b operation (512, 384, 256, 160
\ and 128 bits, here in bytes: 64, 48, 32, 20 and 16) and an optional key for the keyed (MAC) mode. The
\ digest is raw bytes; chain hex:encode for text. The hash itself is _hash, a private primitive
\ (src/prims/blake2b.ts) over the audited @noble/hashes library; the parameters and the metadata are FL.
IN: blake2b

: digest ( bytes size:int[16|20|32|48|64]=64 key:key{utf8|hex|latin1|base64}[0..64]="" -- bytes )
  "The BLAKE2b digest (RFC 7693) of the input as raw bytes, size bytes long (16, 20, 32, 48 or 64). A non-empty key (up to 64 bytes) makes the keyed MAC mode; the empty key is the unkeyed hash. Chain hex:encode for hex text." doc
  "Hashing" category
  size key _hash ;

META: digest
  param size "The output size in bytes: 16, 20, 32, 48 or 64 (CyberChef's 128, 160, 256, 384 and 512 bits)." ;
  param key "The MAC key, up to 64 bytes. Empty (the default) for the unkeyed hash." ;
  see-also blake3:digest ;
;
