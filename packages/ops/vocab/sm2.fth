\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ sm2: SM2 public key encryption (GB/T 32918.4-2017, CyberChef's SM2 Encrypt and SM2 Decrypt) on the 256-bit
\ recommended curve sm2p256v1 (GB/T 32918.5-2017). The point arithmetic is the private primitives of
\ src/prims/sm2.ts over @noble/curves; the rest is FL: the hash is SM3 (the sm3 words), the key derivation function
\ is the standard's (SM3 of the shared point and a 32-bit counter, GB/T 32918.4 section 5.4.3), and the random k comes
\ from random:bytes-of (+random). The ciphertext is C1, C2 and C3 with C1 = k*G, C2 = the message xor the KDF output
\ and C3 = SM3(x2 || message || y2); the order of the parts is the choice C1C3C2 (the standard's current order) or
\ C1C2C3 (the 2010 draft's). As CyberChef writes it, C1 is x || y without the 04 byte of the uncompressed point and
\ the ciphertext is hex text; decryption also accepts the 04 byte (the form GB/T 32918.4 and OpenSSL's inner values
\ use), which it finds by checking that the 65 bytes are a point on the curve.
IN: sm2

USING: sm3 random ;

\ ---- the key derivation function ----

\ The blocks 1 to n of the KDF, each SM3(z || counter as 32 bits big-endian), joined.
: _kdf-blocks ( z:bytes n:int -- bytes )
  1 n 1 + range [ z swap 4 util:int>be-bytes cat sm3:digest ] map #[ ] bjoin ;

\ klen bytes of key material for the shared point bytes z = x2 || y2.
: _kdf ( z:bytes klen:int -- bytes )
  klen 0 = [ #[ ] ] [ z klen 31 + 32 div _kdf-blocks 0 klen slice ] if ;

\ True when t has bytes and all are zero (the standard asks for a new k then).
: _zero-key? ( t:bytes -- bool )
  t len 0 > t [ 0 <> ] filter len 0 = and ;

\ ---- keys ----

: _coord ( v:bytes what:str -- bytes )
  v len 32 <> [ "Invalid " what cat " - ensure it is 32 bytes in size and in hex" cat raise:range ] when
  v ;

: _public-point ( px:bytes py:bytes -- bytes )
  #[ 04 ] px "Public Key X" _coord cat py "Public Key Y" _coord cat ;

\ ---- the parts of a ciphertext ----

\ C2: the message xor the key material (empty for an empty message, which bxor does not take).
: _c2 ( msg:bytes t:bytes -- bytes )
  msg len 0 = [ #[ ] ] [ msg t bxor ] if ;

\ C3: SM3(x2 || message || y2) for the shared point p2 (04 || x2 || y2).
: _c3 ( msg:bytes p2:bytes -- bytes )
  p2 1 33 slice msg cat p2 33 65 slice cat sm3:digest ;

\ The ciphertext from its parts in the order of format.
: _layout ( c1:bytes c2:bytes c3:bytes format:str -- bytes )
  format "C1C3C2" = [ c1 c3 cat c2 cat ] [ c1 c2 cat c3 cat ] if ;

\ ---- encrypt ----

: _finish ( msg:bytes c1:bytes p2:bytes format:str -- bytes )
  p2 1 65 slice msg len _kdf
  dup _zero-key? [ drop #[ ] ] [ c1 swap msg swap _c2 msg p2 _c3 format _layout ] if ;

\ The ciphertext of the message for the public point, with the scalar k (the public word supplies a random one): C1
\ as x || y, then C3 and C2 in the order of format. Empty when the key material is all zero (k is then unusable).
: _encrypt-k ( msg:bytes pub:bytes k:bytes format:str -- bytes )
  msg k _mul-base 1 65 slice pub k _mul format _finish ;

: _random-k ( -- bytes )
  1 _order 1 - random:between 32 util:int>be-bytes ;

: _encrypt-random ( msg:bytes pub:bytes format:str -- bytes )
  msg pub _random-k format _encrypt-k
  dup len 0 = [ drop msg pub format recurse ] when ;

: encrypt ( data:bytes public-key-x:bytes="" public-key-y:bytes="" output-format:choice{C1C3C2|C1C2C3}="C1C3C2" curve:choice{sm2p256v1}="sm2p256v1" -- str )
  "Encrypt the input with an SM2 public key (GB/T 32918.4, CyberChef's SM2 Encrypt) on the curve sm2p256v1. The public key is its two coordinates X and Y, 32 bytes each as hex (E_RANGE otherwise); a point that is not on the curve is E_COERCE. The output is hex text, lower case: C1 (the point k*G as x then y, 64 bytes, without the 04 byte of the uncompressed form, as CyberChef writes it), then C3 (the SM3 check, 32 bytes) and C2 (the message xor the key stream, as long as the message) for C1C3C2, or C2 then C3 for C1C2C3. k is random from the host's cryptographic generator (never Math.random; the word carries the +random effect), so the output differs on every call. The input may be empty." doc
  "Public Key" category
  data public-key-x public-key-y _public-point output-format _encrypt-random bytes>hex ;

\ ---- decrypt ----

\ C1 as the 65-byte point and the rest of the ciphertext. C1 may be written with or without the 04 byte; the 65 bytes
\ are taken as C1 when the first byte is 04 and they are a point on the curve, else C1 is x || y.
: _c1-split ( ct:bytes -- bytes bytes )
  ct len 96 < [ "the SM2 ciphertext is too short: C1 and C3 alone are 96 bytes" raise:coerce ] when
  ct len 97 >= ct 0 nth 4 = and
  [ ct 0 65 slice _valid-point ] [ false ] if
  [ ct 0 65 slice ct 65 ct len slice ] [ #[ 04 ] ct 0 64 slice cat ct 64 ct len slice ] if ;

\ C2 and C3 from what follows C1.
: _unlayout ( rest:bytes format:str -- bytes bytes )
  rest len 32 < [ "the SM2 ciphertext is too short: C3 is 32 bytes" raise:coerce ] when
  format "C1C3C2" = [ rest 32 rest len slice rest 0 32 slice ]
  [ rest 0 rest len 32 - slice rest rest len 32 - rest len slice ] if ;

: _open ( c1:bytes c2:bytes c3:bytes d:bytes -- bytes )
  c1 d _mul
  dup 1 65 slice c2 len _kdf
  dup _zero-key? [ "the SM2 key material is all zero (a ciphertext of a bad k)" raise:coerce ] when
  c2 swap _c2
  dup2 swap _c3
  c3 <> [ "Decryption Error -- Computed Hashes Do Not Match" raise:coerce ] when
  nip ;

: _decrypt ( ct:bytes d:bytes format:str -- bytes )
  ct _c1-split
  format _unlayout
  d _open ;

: decrypt ( data:str private-key:bytes="" input-format:choice{C1C3C2|C1C2C3}="C1C3C2" curve:choice{sm2p256v1}="sm2p256v1" -- bytes )
  "Decrypt an SM2 ciphertext with the private key (GB/T 32918.4, CyberChef's SM2 Decrypt) on the curve sm2p256v1. The input is the ciphertext as hex text (white space is ignored) in the order named: C1C3C2 or C1C2C3. C1 may be x || y (64 bytes, as CyberChef writes it) or the uncompressed point with its 04 byte (65 bytes, as other SM2 libraries write it). The private key is 32 bytes as hex. A ciphertext that is cut short, whose C1 is not a point on the curve, or whose C3 check does not match (a wrong key, a wrong order or damaged data) is E_COERCE; a key outside 1 to the order minus 1 is E_RANGE. The output is the message as bytes." doc
  "Public Key" category
  data hex>bytes private-key "Private Key" _coord input-format _decrypt ;

META: encrypt
  use-when "You have an SM2 public key as its X and Y coordinates (32 bytes each, in hex) and a message, for the key's owner to decrypt the ciphertext." ;
  param public-key-x "The X coordinate of the public key: 32 bytes as hex." ;
  param public-key-y "The Y coordinate of the public key: 32 bytes as hex." ;
  param output-format "The order of the parts: C1C3C2 (the standard's) or C1C2C3." ;
  param curve "The curve: sm2p256v1, the only one." ;
  see-also sm2:decrypt sm3:digest ;
  inverse decrypt ;
  checks output charset "0-9a-f" ;
;

META: decrypt
  use-when "You have an SM2 ciphertext in hex and its 32-byte private key, and you want the plaintext. SM2 is the Chinese national public-key standard." ;
  param private-key "The private key: 32 bytes as hex." ;
  param input-format "The order of the parts of the ciphertext: C1C3C2 or C1C2C3." ;
  param curve "The curve: sm2p256v1, the only one." ;
  see-also sm2:encrypt sm3:digest ;
  inverse encrypt ;
  checks input regex "^[0-9a-fA-F\\s]+$" ;
  expects "SM2 ciphertext as hex" ;
;
