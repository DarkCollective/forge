\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ecdsa: ECDSA key pairs, signatures and their formats (CyberChef's Generate ECDSA Key Pair, ECDSA Sign, ECDSA Verify
\ and ECDSA Signature Conversion, plus an EC public key from a private one). The curve arithmetic and RFC 6979 are the
\ private primitives of src/prims/ecdsa.ts over @noble/curves; everything else is FL: the PEM and DER keys (the shared
\ asn1 words: SEC1 "EC PRIVATE KEY", PKCS #8 "PRIVATE KEY" and SPKI "PUBLIC KEY" are read, PKCS #8 and SPKI are written,
\ as CyberChef does), the digest (the md5, sha1 and sha2 words), and the four signature formats (the asn1, json and
\ util words). Curves: P-256, P-384, P-521 (all three are offered for a new key); secp256k1 keys are read too.
\ Signatures are deterministic (RFC 6979); CyberChef (jsrsasign) uses a random k, so its signatures differ on every
\ call, and verification accepts either. A signature is r and s as integers; the formats are
\   asn1-hex   the DER SEQUENCE of two INTEGERs, as hex text
\   p1363-hex  r || s, each as wide as the curve's order, as hex text
\   jws        the same bytes in URL-safe Base64 without padding (RFC 7515 / 7518 section 3.4)
\   raw-json   {"r":"<hex>","s":"<hex>"}, each the hex of its DER INTEGER content (what jsrsasign writes)
IN: ecdsa

USING: asn1 json random md5 sha1 sha2 ;

\ ---- curves ----

\ The OID of the curve named, as dotted text.
: _curve>oid ( curve:str -- str )
  curve "P-256" = [ "1.2.840.10045.3.1.7" ] [
  curve "P-384" = [ "1.3.132.0.34" ] [
  curve "P-521" = [ "1.3.132.0.35" ] [
  "1.3.132.0.10" ] if ] if ] if ;

\ The curve of an OID, E_COERCE when it is not one of the four.
: _oid>curve ( dotted:str -- str )
  dotted "1.2.840.10045.3.1.7" = [ "P-256" ] [
  dotted "1.3.132.0.34" = [ "P-384" ] [
  dotted "1.3.132.0.35" = [ "P-521" ] [
  dotted "1.3.132.0.10" = [ "secp256k1" ] [
  "the curve " dotted asn1:oid-label cat " is not supported (P-256, P-384, P-521 and secp256k1 are)" cat raise:coerce ""
  ] if ] if ] if ] if ;

\ The curve a curve-parameters node names (a named curve; explicit parameters are not read).
: _curve-node ( p:record -- str )
  p "universal" 6 "a named curve (an OBJECT IDENTIFIER, explicit curve parameters are not supported)" asn1:expect
  p asn1:node>oid _oid>curve ;

\ ---- digests ----

\ The digest of data under the hash alg (md5, sha1, sha256, sha384 or sha512).
: _digest ( data:bytes alg:str -- bytes )
  alg "md5" = [ data md5:digest ] [
  alg "sha1" = [ data sha1:digest ] [
  alg "sha256" = [ data "256" sha2:digest ] [
  alg "sha384" = [ data "384" sha2:digest ] [
  data "512" sha2:digest ] if ] if ] if ] if ;

\ ---- keys: reading ----

\ The context-specific [n] children of a node.
: _ctx ( node:record n:int -- list )
  node asn1:children [ n asn1:context? ] filter ;

\ The big-endian private scalar, left-padded with zeros to the size of the curve's order.
: _scalar ( v:bytes curve:str -- bytes )
  curve _size v len -
  dup 0 < [ "the EC private key is longer than the " curve cat " order" cat raise:coerce ] when
  util:zero-bytes v cat ;

\ A key record: private (bool), curve, key (the scalar, or the uncompressed public point).
: _key ( priv:bool curve:str key:bytes -- record )
  { { "private" priv } { "curve" curve } { "key" key } } >record ;

: _sec1-key ( node:record curve:str -- record )
  true curve node 1 asn1:child "value" get curve _scalar _key ;

\ An ECPrivateKey (RFC 5915): SEQUENCE { INTEGER 1, OCTET STRING key, [0] parameters, [1] publicKey }. outer is the
\ curve named by a PKCS #8 wrapper, or "" for a bare SEC1 key, whose own [0] must then name it.
: _sec1 ( node:record outer:str -- record )
  node "universal" 16 "an ECPrivateKey (a SEQUENCE)" asn1:expect
  node asn1:children len 2 < [ "the EC private key has fewer than 2 fields" raise:coerce ] when
  node 0 asn1:child asn1:node>int 1 <> [ "the ECPrivateKey version is not 1" raise:coerce ] when
  node 1 asn1:child "universal" 4 "the private key (an OCTET STRING)" asn1:expect
  node 0 _ctx
  dup len 0 > [ 0 nth 0 asn1:child _curve-node ] [ drop outer ] if
  dup len 0 = [ "the EC private key does not name its curve" raise:coerce ] when
  node swap _sec1-key ;

\ The AlgorithmIdentifier of an EC key: id-ecPublicKey and the curve ("" when the parameters are absent).
: _algid ( node:record -- str )
  node "universal" 16 "an AlgorithmIdentifier (a SEQUENCE)" asn1:expect
  node asn1:children len 1 < [ "the AlgorithmIdentifier is empty" raise:coerce ] when
  node 0 asn1:child asn1:node>oid
  dup "1.2.840.10045.2.1" <> [ "this is not an EC key, its algorithm is " swap asn1:oid-label cat raise:coerce ] [ drop ] if
  node asn1:children len 2 < [ "" ] [ node 1 asn1:child _curve-node ] if ;

\ A PKCS #8 PrivateKeyInfo: SEQUENCE { INTEGER 0, AlgorithmIdentifier, OCTET STRING ECPrivateKey }.
: _pkcs8 ( node:record -- record )
  node "universal" 16 "a PrivateKeyInfo (a SEQUENCE)" asn1:expect
  node asn1:children len 3 < [ "the PrivateKeyInfo has fewer than 3 fields" raise:coerce ] when
  node 1 asn1:child _algid
  node 2 asn1:child "universal" 4 "the private key (an OCTET STRING)" asn1:expect
  node 2 asn1:child "value" get asn1:parse swap _sec1 ;

: _spki-key ( curve:str point:bytes -- record )
  false curve curve point _uncompressed _key ;

\ A SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING point }.
: _spki ( node:record -- record )
  node "universal" 16 "a SubjectPublicKeyInfo (a SEQUENCE)" asn1:expect
  node asn1:children len 2 <> [ "the SubjectPublicKeyInfo must have 2 fields" raise:coerce ] when
  node 0 asn1:child _algid
  dup len 0 = [ "the EC public key does not name its curve" raise:coerce ] when
  node 1 asn1:child asn1:node>bits 0 <> [ "the public key has unused bits" raise:coerce ] when
  _spki-key ;

: _is-key-block ( b:record -- bool )
  { "EC PRIVATE KEY" "PRIVATE KEY" "PUBLIC KEY" } b "label" get util:contains? ;

\ The first PEM block that holds an EC key (an EC PARAMETERS block in front, as `openssl ecparam -genkey` writes it, is skipped).
: _first-key-block ( blocks:list -- record )
  blocks [ _is-key-block ] filter
  dup len 0 = [
    "no EC key found: expected a PEM block EC PRIVATE KEY, PRIVATE KEY or PUBLIC KEY, the text has "
    blocks len 0 = [ "no PEM block" ] [ blocks [ "label" get ] map ", " join ] if cat
    raise:coerce ] when
  0 nth ;

: _block>key ( b:record -- record )
  b "headers" get keys len 0 > [ "encrypted PEM keys are not supported" raise:coerce ] when
  b "label" get "EC PRIVATE KEY" = [ b "data" get asn1:parse "" _sec1 ] [
  b "label" get "PRIVATE KEY" = [ b "data" get asn1:parse _pkcs8 ] [
  b "data" get asn1:parse _spki ] if ] if ;

\ The first EC key in a text of PEM blocks.
: _read-key ( text:str -- record )
  text str>bytes asn1:pem-decode _first-key-block _block>key ;

\ The key in the text, which must be a private one (a public key, or no key at all, is refused).
: _need-private ( text:str -- record )
  text util:strip-space len 0 = [ "please enter a private key" raise:range ] when
  text _read-key
  dup "private" get not [ "the provided key is not a private key" raise:coerce ] when ;

: _need-public ( text:str -- record )
  text util:strip-space len 0 = [ "please enter a public key" raise:range ] when
  text _read-key
  dup "private" get [ "the provided key is not a public key" raise:coerce ] when ;

\ ---- keys: writing ----

\ AlgorithmIdentifier { id-ecPublicKey, the curve }.
: _algid-der ( curve:str -- bytes )
  { "1.2.840.10045.2.1" asn1:tlv-oid curve _curve>oid asn1:tlv-oid } asn1:tlv-seq ;

\ SubjectPublicKeyInfo of an uncompressed point.
: _spki-der ( curve:str pub:bytes -- bytes )
  { curve _algid-der pub 0 asn1:tlv-bits } asn1:tlv-seq ;

\ An ECPrivateKey that carries the public point (as OpenSSL writes it, without the curve, which PKCS #8 names).
: _ec-private-der ( d:bytes pub:bytes -- bytes )
  { 1 asn1:tlv-int d asn1:tlv-octets 1 pub 0 asn1:tlv-bits asn1:tlv-explicit } asn1:tlv-seq ;

\ PKCS #8 PrivateKeyInfo around it.
: _pkcs8-der ( curve:str d:bytes pub:bytes -- bytes )
  { 0 asn1:tlv-int curve _algid-der d pub _ec-private-der asn1:tlv-octets } asn1:tlv-seq ;

: _public-pem ( curve:str pub:bytes -- str )
  "PUBLIC KEY" curve pub _spki-der asn1:pem-encode ;

\ ---- signatures: integers, formats ----

\ A signature value as exactly w bytes.
: _fixed ( v:int w:int -- bytes )
  v 1 w 8 * shl >= [ "a signature value does not fit " w int>str cat " bytes" cat raise:coerce ] when
  v w util:int>be-bytes ;

: _p1363 ( r:int s:int w:int -- bytes )
  r w _fixed s w _fixed cat ;

: _der ( r:int s:int -- bytes )
  { r asn1:tlv-int s asn1:tlv-int } asn1:tlv-seq ;

: _der-hex ( v:int -- str )
  v asn1:int>der bytes>hex ;

\ The signature written in a format; w is the byte width for the two fixed-width formats.
: _write-sig ( r:int s:int w:int format:str -- str )
  format "asn1-hex" = [ r s _der bytes>hex ] [
  format "p1363-hex" = [ r s w _p1363 bytes>hex ] [
  format "jws" = [ r s w _p1363 false util:b64url-encode bytes>str ] [
  { { "r" r _der-hex } { "s" s _der-hex } } >record json:compact ] if ] if ] if ;

\ r and s from the two halves of r || s, h bytes each.
: _split2 ( b:bytes h:int -- int int )
  b 0 h slice 256 util:digits>int b h b len slice 256 util:digits>int ;

: _halves ( b:bytes -- int int )
  b len 2 mod 0 <> b len 0 = or [ "a P1363 signature is r || s, two values of the same, non-zero, width" raise:coerce ] when
  b b len 2 div _split2 ;

: _int ( n:record -- int )
  n "universal" 2 "an INTEGER" asn1:expect
  n asn1:node>int dup 0 < [ "an ECDSA signature value is negative" raise:coerce ] when ;

: _from-der ( der:bytes -- int int )
  der asn1:parse
  dup "universal" 16 "an ECDSA signature (a SEQUENCE)" asn1:expect
  dup asn1:children len 2 <> [ "an ECDSA signature holds two INTEGERs, r and s" raise:coerce ] when
  dup 0 asn1:child _int swap 1 asn1:child _int ;

: _hex-int ( s:str what:str -- int )
  s len 0 = [ "No \"" what cat "\" value in the signature JSON" cat raise:coerce ] when
  s str>codes [ util:hex-digit? not ] filter len 0 <>
  [ "the \"" what cat "\" value in the signature JSON is not hex" cat raise:coerce ] when
  s 16 str>int-radix ;

: _json-field ( obj:record name:str -- int )
  obj keys name util:contains? not [ "No \"" name cat "\" value in the signature JSON" cat raise:coerce ] when
  obj name get
  dup type "str" <> [ "the \"" name cat "\" value in the signature JSON is not a text" cat raise:coerce ] when
  name _hex-int ;

: _from-json ( text:str -- int int )
  text json:parse
  dup type "record" <> [ "the signature JSON must be an object with r and s" raise:coerce ] when
  dup "r" _json-field swap "s" _json-field ;

\ r and s of the text of a signature in a format other than auto.
: _read-sig ( text:str format:str -- int int )
  format "asn1-hex" = [ text util:strip-space hex>bytes _from-der ] [
  format "p1363-hex" = [ text util:strip-space hex>bytes _halves ] [
  format "jws" = [ text util:strip-space str>bytes util:b64url-decode _halves ] [
  text _from-json ] if ] if ] if ;

\ ---- format detection (CyberChef's order: JSON, hex, Base64url) ----

: _json-object? ( text:str -- bool )
  [ text json:parse type "record" = ] [ drop false ] try ;

: _hex-text? ( t:str -- bool )
  t len 2 >= t len 2 mod 0 = and t str>codes [ util:hex-digit? not ] filter len 0 = and ;

: _der-text? ( t:str -- bool )
  t "30" util:starts-with? [ [ t hex>bytes asn1:parse drop true ] [ drop false ] try ] [ false ] if ;

: _b64url? ( t:str -- bool )
  [ t str>bytes util:b64url-decode drop true ] [ drop false ] try ;

: _detect-plain ( t:str -- str )
  t _hex-text? [ t _der-text? [ "asn1-hex" ] [ "p1363-hex" ] if ] [
  t len 0 > t _b64url? and [ "jws" ] [ "the signature format could not be detected" raise:coerce "" ] if ] if ;

: _detect ( text:str -- str )
  text _json-object? [ "raw-json" ] [ text util:strip-space _detect-plain ] if ;

\ r and s of a signature text, detecting the format when it is auto.
: _parse-sig ( text:str format:str -- int int )
  format "auto" = [ text text _detect ] [ text format ] if _read-sig ;

\ ---- generate key pair ----

: _b64u ( b:bytes -- str )
  b false util:b64url-encode bytes>str ;

\ The JWK of a key (RFC 7517 / 7518 section 6.2), with the key_ops and kid CyberChef adds.
: _jwk ( curve:str d:bytes pub:bytes priv:bool -- record )
  { { "kty" "EC" } { "crv" curve }
    { "x" pub 1 curve _size 1 + slice _b64u }
    { "y" pub curve _size 1 + pub len slice _b64u } } >record
  priv
  [ "d" d _b64u put "key_ops" { "sign" } put "kid" "PrivateKey" put ]
  [ "key_ops" { "verify" } put "kid" "PublicKey" put ] if ;

: _pem-pair ( curve:str d:bytes pub:bytes -- str )
  curve pub _public-pem "\n" cat
  "PRIVATE KEY" curve d pub _pkcs8-der asn1:pem-encode cat ;

: _jwk-pair ( curve:str d:bytes pub:bytes -- str )
  { { "keys" { curve d pub true _jwk curve d pub false _jwk } } } >record 4 json:stringify ;

: _generate-with ( curve:str d:bytes format:str -- str )
  curve d _public-key
  format "PEM" = [ curve d rot _pem-pair ] [
  format "DER" = [ drop d bytes>hex ] [
  curve d rot _jwk-pair ] if ] if ;

\ The key pair that a seed gives (the public word supplies random bytes).
: _generate ( curve:str seed:bytes format:str -- str )
  curve seed _keygen curve swap format _generate-with ;

: generate-key-pair ( data:bytes curve:choice{P-256|P-384|P-521}="P-256" format:choice{PEM|DER|JWK}="PEM" -- str )
  "Generate an ECDSA key pair on P-256, P-384 or P-521 (CyberChef's Generate ECDSA Key Pair). The private scalar is made from random bytes of the host's cryptographic random generator (never Math.random; the word carries the +random effect), mapped into 1 to the order minus 1 as FIPS 186-5 appendix A.2 does. Output as in CyberChef, the public key first and then the private key, a blank line apart. PEM: the SubjectPublicKeyInfo (PUBLIC KEY) and the PKCS #8 PrivateKeyInfo (PRIVATE KEY, which carries the public point). DER: CyberChef's name for the private key alone as hex (the raw scalar, not DER). JWK: {\"keys\": [private, public]} with 4 spaces of indent, each with key_ops and kid as CyberChef adds. The input is ignored." doc
  "Public Key" category
  curve curve _seed-length random:bytes-of format _generate ;

\ ---- sign, verify, convert, public key ----

: _write-rs ( rs:bytes w:int format:str -- str )
  rs w _split2 w format _write-sig ;

: _sign-with ( data:bytes curve:str d:bytes digest:str format:str -- str )
  curve d data digest _digest digest _sign curve _size format _write-rs ;

: sign ( data:bytes private-key:str="" digest:choice{sha256|sha384|sha512|sha1|md5}="sha256" format:choice{asn1-hex|p1363-hex|jws|raw-json}="asn1-hex" -- str )
  "Sign the input with an ECDSA private key (CyberChef's ECDSA Sign). The key is PEM, either SEC1 (EC PRIVATE KEY) or PKCS #8 (PRIVATE KEY) on P-256, P-384, P-521 or secp256k1. The input bytes are hashed with the digest and the digest is signed. The signature is deterministic (RFC 6979, with the HMAC of the same hash), where CyberChef's uses a random k: the same key and message give the same signature here, and every ECDSA verifier accepts it. The s value is not forced to the low half. Formats: asn1-hex (the DER SEQUENCE of r and s as hex), p1363-hex (r then s, each as wide as the curve's order, as hex), jws (those bytes in URL-safe Base64 without padding) and raw-json ({\"r\":\"hex\",\"s\":\"hex\"})." doc
  "Public Key" category
  private-key _need-private
  dup "curve" get swap "key" get
  data -rot digest format _sign-with ;

: _verify-rs ( curve:str pub:bytes r:int s:int h:bytes hash:str -- bool )
  1 curve _size 8 * shl dup r > swap s > and
  [ curve pub h r s curve _size _p1363 hash _verify ] [ false ] if ;

: verify ( signature:str input-format:choice{auto|asn1-hex|p1363-hex|jws|raw-json}="auto" digest:choice{sha256|sha384|sha512|sha1|md5}="sha256" public-key:str="" message:toggle{utf8|hex|base64|latin1}="" -- str )
  "Verify a signature of a message with an ECDSA public key (CyberChef's ECDSA Verify). The input is the signature in the format named (auto detects JSON, then hex, then URL-safe Base64, as CyberChef does; a hex signature that starts 30 and parses as DER is asn1-hex, any other hex is p1363-hex); the message is a parameter, read as UTF-8 text, hex, Base64 or Latin-1 per the toggle. The key is a PUBLIC KEY (SubjectPublicKeyInfo) PEM on P-256, P-384, P-521 or secp256k1. The answer is Verified OK or Verification Failure; a signature of any s (high or low) and of any k (random or RFC 6979) is accepted. A key that is not an EC public key, or not on its curve, or a signature that cannot be read, is an error." doc
  "Public Key" category
  public-key _need-public
  dup "curve" get swap "key" get
  signature input-format _parse-sig
  message digest _digest digest _verify-rs
  [ "Verified OK" ] [ "Verification Failure" ] if ;

: _guess-width ( r:int s:int -- int )
  r s max util:int>bytes len
  dup 32 <= [ drop 32 ] [ dup 48 <= [ drop 48 ] [ drop 66 ] if ] if ;

: convert-signature ( signature:str input-format:choice{auto|asn1-hex|p1363-hex|jws|raw-json}="auto" output-format:choice{asn1-hex|p1363-hex|jws|raw-json}="asn1-hex" -- str )
  "Convert an ECDSA signature between the DER SEQUENCE (asn1-hex), r then s (p1363-hex), the URL-safe Base64 of r then s (jws) and {\"r\",\"s\"} in hex (raw-json) (CyberChef's ECDSA Signature Conversion). The curve is not known, so the width of r and s in p1363-hex and jws is the smallest of 32, 48 and 66 bytes (P-256 and secp256k1, P-384, P-521) that holds the larger of the two (CyberChef cannot write a P-521 signature this way). auto detects the input as in ECDSA Verify. A value over 66 bytes cannot be written in those two formats." doc
  "Public Key" category
  signature input-format _parse-sig
  dup2 _guess-width output-format _write-sig ;

: public-key ( data:str -- str )
  "The public key of an EC private key, as a PUBLIC KEY (SubjectPublicKeyInfo) PEM. The input is the private key as PEM, SEC1 (EC PRIVATE KEY) or PKCS #8 (PRIVATE KEY), on P-256, P-384, P-521 or secp256k1. This is the elliptic curve half of CyberChef's Public Key from Private Key." doc
  "Public Key" category
  data _need-private
  dup "curve" get swap "key" get
  over swap _public-key _public-pem ;

META: generate-key-pair
  param curve "The curve: P-256, P-384 or P-521." ;
  param format "PEM (public key, then PKCS #8 private key), DER (the private scalar as hex, CyberChef's name) or JWK." ;
  see-also ecdsa:sign ecdsa:public-key ;
;

META: sign
  param private-key "The private key as PEM: SEC1 (EC PRIVATE KEY) or PKCS #8 (PRIVATE KEY)." ;
  param digest "The hash applied to the input before signing: sha256, sha384, sha512, sha1 or md5." ;
  param format "asn1-hex (DER), p1363-hex (r then s), jws (URL-safe Base64 of r then s) or raw-json." ;
  see-also ecdsa:verify ecdsa:convert-signature ;
;

META: verify
  param input-format "The signature format, or auto to detect it." ;
  param digest "The hash applied to the message: sha256, sha384, sha512, sha1 or md5." ;
  param public-key "The public key as PEM (PUBLIC KEY)." ;
  param message "The signed message, read as UTF-8 text, hex, Base64 or Latin-1." ;
  see-also ecdsa:sign ecdsa:convert-signature ;
;

META: convert-signature
  param input-format "The format of the signature, or auto to detect it." ;
  param output-format "asn1-hex, p1363-hex, jws or raw-json." ;
  see-also ecdsa:sign ecdsa:verify ;
;

META: public-key
  see-also ecdsa:generate-key-pair ecdsa:sign ;
;
