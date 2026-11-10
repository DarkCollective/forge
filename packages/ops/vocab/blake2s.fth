\ blake2s: BLAKE2s, RFC 7693, with the output sizes of CyberChef's BLAKE2s operation (256, 160 and 128 bits,
\ here in bytes: 32, 20 and 16) and an optional key for the keyed (MAC) mode. The digest is raw bytes;
\ chain hex:encode for text. The hash itself is _hash, a private primitive (src/prims/blake2s.ts) over
\ the audited @noble/hashes library; the parameters and the metadata are FL.
IN: blake2s

: digest ( bytes size:int[16|20|32]=32 key:key{utf8|hex|latin1|base64}[0..32]="" -- bytes )
  "The BLAKE2s digest (RFC 7693) of the input as raw bytes, size bytes long (16, 20 or 32). A non-empty key (up to 32 bytes) makes the keyed MAC mode; the empty key is the unkeyed hash. Chain hex:encode for hex text." doc
  "Hashing" category
  size key _hash ;

META: digest
  param size "The output size in bytes: 16, 20 or 32 (CyberChef's 128, 160 and 256 bits)." ;
  param key "The MAC key, up to 32 bytes. Empty (the default) for the unkeyed hash." ;
  see-also blake2b:digest ;
;
