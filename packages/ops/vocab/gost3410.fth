\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ gost3410: the GOST R 34.10-2012 digital signature (RFC 7091) with the Streebog hash (GOST R 34.11-2012, the
\ `streebog` words: 256 bits for the 256-bit curves, 512 bits for the 512-bit ones). Added in WP 5.51 as the
\ public key signature of the GOST family. NOTE: CyberChef's "GOST Sign" and "GOST Verify" are not this: they are
\ the MAC modes of the GOST 28147-89, Magma and Kuznyechik block ciphers (see the vocabulary gost-mac). The curve
\ arithmetic is the private primitives of src/prims/gost3410.ts over @noble/curves (it is not ECDSA: s = r*d + k*e);
\ the hash, the random nonce k (random:bytes-of, with the standard's retry when r or s is 0) and the text forms are FL.
\ A private key d and a public point x || y are big-endian numbers as wide as the curve (32 or 64 bytes), written as
\ hex; the signature is r || s as hex, as RFC 7091 writes ζ. The digest bytes of the streebog words are the little-endian
\ bytes of the number RFC 6986 prints, and the number alpha of RFC 7091 section 6 is that number.
IN: gost3410

USING: streebog random ;

\ The Streebog digest that goes with the curve: 256 bits for a 32-byte curve, 512 for a 64-byte one.
: _digest ( data:bytes curve:str -- bytes )
  curve _size 32 = [ data "256" streebog:digest ] [ data "512" streebog:digest ] if ;

\ v as bytes that must be exactly n bytes (the numbers of the curve are as wide as it, a public point twice as wide).
: _exact ( v:bytes what:str n:int curve:str -- bytes )
  v len n <> [
    "the " what cat " must be " cat n int>str cat " bytes (" cat n 2 * int>str cat " hex digits) for the curve " cat curve cat raise:range ] when
  v ;

\ A random nonce k from 1 to q - 1, as wide as the curve.
: _random-k ( curve:str -- bytes )
  1 curve _order 1 - random:between curve _size util:int>be-bytes ;

\ The signature r || s as hex; the nonce is replaced (as the standard asks) when r or s is 0.
: _sign-digest ( curve:str d:bytes digest:bytes -- str )
  curve d digest curve _random-k _sign
  dup len 0 = [ drop curve d digest recurse ] [ bytes>hex ] if ;

: sign ( data:bytes private-key:bytes="" curve:choice{cryptopro-a|cryptopro-b|cryptopro-c|tc26-512-a|test-256|test-512}="cryptopro-a" -- str )
  "Sign the input with a GOST R 34.10-2012 private key (RFC 7091). The input is hashed with Streebog (256 bits for the 256-bit curves, 512 bits for the 512-bit ones) and the signature is r followed by s, big-endian, each as wide as the curve (32 or 64 bytes), as lower-case hex. The private key is hex, as wide as the curve, from 1 to the order minus 1 (E_RANGE otherwise). k is random from the host's cryptographic generator (never Math.random; the word carries the +random effect), so the signature differs on every call and any verifier accepts all of them. The curves: cryptopro-a, cryptopro-b, cryptopro-c (the 256-bit CryptoPro sets of RFC 4357), tc26-512-a (the 512-bit set A of RFC 7836) and the RFC 7091 test curves test-256 and test-512." doc
  "Public Key" category
  curve private-key "private key" curve _size curve _exact
  data curve _digest _sign-digest ;

: verify ( signature:str public-key:bytes="" curve:choice{cryptopro-a|cryptopro-b|cryptopro-c|tc26-512-a|test-256|test-512}="cryptopro-a" message:toggle{utf8|hex|base64|latin1}="" -- str )
  "Verify a GOST R 34.10-2012 signature (RFC 7091) of a message. The input is the signature r || s as hex (white space is ignored); the public key is the point x || y as hex, as wide as the curve twice (E_RANGE otherwise; a point not on the curve is E_COERCE); the message is read as UTF-8 text, hex, Base64 or Latin-1 per the toggle and hashed with Streebog as sign does. The answer is Verified OK or Verification Failure; a signature of the wrong length or with r or s outside 1 to the order minus 1 is a failure, not an error." doc
  "Public Key" category
  curve public-key "public key" curve _size 2 * curve _exact
  message curve _digest
  signature util:strip-space hex>bytes
  _verify
  [ "Verified OK" ] [ "Verification Failure" ] if ;

: public-key ( data:str curve:choice{cryptopro-a|cryptopro-b|cryptopro-c|tc26-512-a|test-256|test-512}="cryptopro-a" -- str )
  "The public key of a GOST R 34.10-2012 private key: the point x followed by y, big-endian, each as wide as the curve, as lower-case hex. The input is the private key as hex, as wide as the curve (E_RANGE otherwise)." doc
  "Public Key" category
  curve data util:strip-space hex>bytes "private key" curve _size curve _exact _public-key bytes>hex ;

META: sign
  use-when "You have a GOST R 34.10-2012 private key in hex and a message, and you need a signature for a Russian standard test or protocol." ;
  param private-key "The private key d as hex, as wide as the curve: 32 bytes (64 hex digits) or 64 bytes." ;
  param curve "The parameter set: cryptopro-a, cryptopro-b, cryptopro-c, tc26-512-a, or the RFC 7091 test curves test-256 and test-512." ;
  see-also gost3410:verify gost3410:public-key streebog:digest ;
  link "https://www.rfc-editor.org/rfc/rfc7091" "RFC 7091: GOST R 34.10-2012 signatures" ;
  link "https://www.rfc-editor.org/rfc/rfc6986" "RFC 6986: the Streebog hash" ;
;

META: verify
  use-when "You have a GOST R 34.10-2012 signature (r then s, in hex), the public point and the message, and you want to check that the signature is genuine." ;
  param public-key "The public point x || y as hex (128 hex digits for a 256-bit curve, 256 for a 512-bit one)." ;
  param curve "The parameter set the key is on." ;
  param message "The signed message, read as UTF-8 text, hex, Base64 or Latin-1." ;
  see-also gost3410:sign gost3410:public-key ;
  inverse sign ;
  link "https://www.rfc-editor.org/rfc/rfc7091" "RFC 7091: GOST R 34.10-2012 signatures" ;
  link "https://www.rfc-editor.org/rfc/rfc6986" "RFC 6986: the Streebog hash" ;
;

META: public-key
  use-when "You have a GOST R 34.10-2012 private key in hex and need the public point x then y, to check signatures or to publish the key." ;
  param curve "The parameter set." ;
  see-also gost3410:sign gost3410:verify ;
  link "https://www.rfc-editor.org/rfc/rfc7091" "RFC 7091: GOST R 34.10-2012 signatures" ;
;
