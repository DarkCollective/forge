\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ jwk: PEM to JWK and JWK to PEM (CyberChef's two ops), between PEM keys (SubjectPublicKeyInfo "PUBLIC KEY", PKCS #8
\ "PRIVATE KEY", PKCS #1 "RSA PRIVATE KEY" and "RSA PUBLIC KEY", SEC 1 "EC PRIVATE KEY", and the public key of a
\ "CERTIFICATE") and JSON Web Keys (RFC 7517, RFC 7518 sections 6.2 and 6.3, RFC 8037) for RSA, EC (P-256, P-384, P-521,
\ secp256k1) and OKP (Ed25519, X25519, Ed448, X448) keys. DER is read and written with the shared asn1 words, JSON with
\ the shared json words, base64url with util. The only primitives are jwk:_public (the public key of a private key)
\ and jwk:_on-curve (a point check), over @noble/curves, see src/prims/jwk.ts.
\ The JWK members are base64url without padding of the unsigned big-endian integers or fixed-length byte strings; the
\ members of the objects are written in the order of RFC 7518 (kty, n, e, d, p, q, dp, dq, qi; kty, crv, x, y, d).
IN: jwk

USING: asn1 json sha2 ;

\ crv oid size kind. The curves of JWK that have a PEM form.
"P-256 1.2.840.10045.3.1.7 32 EC\nP-384 1.3.132.0.34 48 EC\nP-521 1.3.132.0.35 66 EC\nsecp256k1 1.3.132.0.10 32 EC\nEd25519 1.3.101.112 32 OKP\nX25519 1.3.101.110 32 OKP\nEd448 1.3.101.113 57 OKP\nX448 1.3.101.111 56 OKP" CONSTANT _curves

: _rows ( -- list )
  _curves "\n" split [ " " split ] map ;

: _bad ( msg:str -- )
  msg raise:coerce ;

\ The row (name oid size kind) of a curve by its JWK name, else E_COERCE.
: _by-name ( name:str -- list )
  _rows [ 0 nth name = ] filter
  dup len 0 = [ "unsupported curve '" name cat "'" cat _bad ] when
  0 nth ;

\ The row of a curve by its OID.
: _by-oid ( oid:str -- list )
  _rows [ 1 nth oid = ] filter
  dup len 0 = [ "unsupported curve " oid cat _bad ] when
  0 nth ;

: _size ( row:list -- int )
  row 2 nth str>int ;

\ The JWK name of the Ed25519, X25519, Ed448 or X448 algorithm OID, else the empty string.
: _okp-name ( oid:str -- str )
  _rows [ 1 nth oid = ] filter
  dup len 0 = [ drop "" ] [ 0 nth 0 nth ] if ;

: _b64u ( b:bytes -- str )
  b false util:b64url-encode bytes>latin1 ;

\ ---- PEM to JWK ----

: _pair ( name:str i:int k:record -- list )
  { name k i asn1:child asn1:node>int util:int>b64url } ;

\ The members names[i] from the INTEGER children base + i of k, as { name value } pairs.
: _int-members ( k:record names:list base:int -- list )
  names [ base + k _pair ] mapi ;

: _rsa-public-jwk ( k:record -- record )
  k "universal" 16 "RSAPublicKey" asn1:expect
  k asn1:children len 2 <> [ "an RSAPublicKey has 2 INTEGERs" _bad ] when
  { { "kty" "RSA" } } k { "n" "e" } 0 _int-members cat >record ;

: _rsa-private-jwk ( k:record -- record )
  k "universal" 16 "RSAPrivateKey" asn1:expect
  k asn1:children len 9 <> [ "an RSAPrivateKey has 9 INTEGERs (multi-prime keys are not supported)" _bad ] when
  k 0 asn1:child asn1:node>int 0 <> [ "an RSAPrivateKey must have version 0" _bad ] when
  { { "kty" "RSA" } } k { "n" "e" "d" "p" "q" "dp" "dq" "qi" } 1 _int-members cat >record ;

\ The private key d, left-padded with zeros to the size of the curve (RFC 7518 section 6.2.2.1).
: _pad-d ( d:bytes size:int -- bytes )
  d len size > [ "a private key of " d len int>str cat " bytes is longer than the " cat size int>str cat " bytes of the curve" cat _bad ] when
  size d len - util:zero-bytes d cat ;

: _ec-parts ( crv:str point:bytes d:bytes size:int -- record )
  point len size 2 * 1 + <> [
    "the " crv cat " public key is not an uncompressed point of " cat size 2 * 1 + int>str cat " bytes" cat _bad ] when
  point 0 nth 4 <> [ "the " crv cat " public key point does not start with 04 (compressed points are not supported)" cat _bad ] when
  { { "kty" "EC" } { "crv" crv } { "x" point 1 1 size + slice _b64u } { "y" point 1 size + point len slice _b64u } }
  d len 0 > [ { { "d" d size _pad-d _b64u } } cat ] when
  >record ;

\ An EC JWK from the curve name, the uncompressed point (04, x, y) and the private key (empty for a public key).
: _ec-jwk ( crv:str point:bytes d:bytes -- record )
  crv point d crv _by-name _size _ec-parts ;

: _okp-parts ( crv:str x:bytes d:bytes size:int -- record )
  x len size <> [ "the " crv cat " public key is " cat size int>str cat " bytes, not " cat x len int>str cat cat _bad ] when
  d len 0 > d len size <> and [ "the " crv cat " private key is " cat size int>str cat " bytes, not " cat d len int>str cat cat _bad ] when
  { { "kty" "OKP" } { "crv" crv } { "x" x _b64u } }
  d len 0 > [ { { "d" d _b64u } } cat ] when
  >record ;

: _okp-jwk ( crv:str x:bytes d:bytes -- record )
  crv x d crv _by-name _size _okp-parts ;

\ The curve named by the parameters of an id-ecPublicKey AlgorithmIdentifier.
: _alg-curve ( alg:record -- str )
  alg asn1:children len 2 < [ "the EC key names no curve" _bad ] when
  alg 1 asn1:child "universal" 6 "a named curve (OBJECT IDENTIFIER)" asn1:expect
  alg 1 asn1:child asn1:node>oid _by-oid 0 nth ;

: _spki-by-oid ( oid:str alg:record bits:bytes -- record )
  oid "1.2.840.113549.1.1.1" = [ bits asn1:parse _rsa-public-jwk ] [
  oid "1.2.840.10045.2.1" = [ alg _alg-curve bits #[ ] _ec-jwk ] [
  oid _okp-name dup len 0 = [ "unsupported public key algorithm " oid asn1:oid-label cat _bad ] when
  bits #[ ] _okp-jwk ] if ] if ;

: _spki-jwk ( spki:record -- record )
  spki "universal" 16 "SubjectPublicKeyInfo" asn1:expect
  spki 0 asn1:child "universal" 16 "an AlgorithmIdentifier" asn1:expect
  spki 0 asn1:child asn1:children len 0 = [ "the AlgorithmIdentifier is empty" _bad ] when
  spki 0 asn1:child 0 asn1:child asn1:node>oid
  spki 0 asn1:child
  spki 1 asn1:child asn1:node>bits drop
  _spki-by-oid ;

\ The public point of an ECPrivateKey: its [1] publicKey, else derived from the private key d.
: _ec-point ( crv:str ec:record d:bytes -- bytes )
  ec asn1:children [ 1 asn1:context? ] filter
  dup len 0 = [ drop crv d jwk:_public ] [ 0 nth 0 asn1:child asn1:node>bits drop ] if ;

: _ec-private-d ( crv:str ec:record d:bytes -- record )
  crv crv ec d _ec-point d _ec-jwk ;

: _ec-private-jwk ( crv:str ec:record -- record )
  ec "universal" 16 "ECPrivateKey" asn1:expect
  ec asn1:children len 2 < [ "an ECPrivateKey has a version and a private key" _bad ] when
  ec 0 asn1:child asn1:node>int 1 <> [ "an ECPrivateKey must have version 1" _bad ] when
  ec 1 asn1:child "universal" 4 "the private key (OCTET STRING)" asn1:expect
  crv ec ec 1 asn1:child "value" get crv _by-name _size _pad-d _ec-private-d ;

: _okp-private-jwk ( crv:str inner:record -- record )
  inner "universal" 4 "the private key (OCTET STRING)" asn1:expect
  crv inner "value" get dup crv swap jwk:_public swap _okp-jwk ;

: _pkcs8-by-oid ( oid:str alg:record priv:bytes -- record )
  oid "1.2.840.113549.1.1.1" = [ priv asn1:parse _rsa-private-jwk ] [
  oid "1.2.840.10045.2.1" = [ alg _alg-curve priv asn1:parse _ec-private-jwk ] [
  oid _okp-name dup len 0 = [ "unsupported private key algorithm " oid asn1:oid-label cat _bad ] when
  priv asn1:parse _okp-private-jwk ] if ] if ;

: _pkcs8-jwk ( k:record -- record )
  k "universal" 16 "PrivateKeyInfo" asn1:expect
  k asn1:children len 3 < [ "a PrivateKeyInfo has a version, an algorithm and a key" _bad ] when
  k 0 asn1:child asn1:node>int dup 0 <> swap 1 <> and [ "a PrivateKeyInfo must have version 0 or 1" _bad ] when
  k 1 asn1:child "universal" 16 "an AlgorithmIdentifier" asn1:expect
  k 2 asn1:child "universal" 4 "the private key (OCTET STRING)" asn1:expect
  k 1 asn1:child 0 asn1:child asn1:node>oid
  k 1 asn1:child
  k 2 asn1:child "value" get
  _pkcs8-by-oid ;

\ SEC 1: the curve is in the [0] parameters.
: _sec1-jwk ( k:record -- record )
  k "universal" 16 "ECPrivateKey" asn1:expect
  k asn1:children [ 0 asn1:context? ] filter
  dup len 0 = [ "the EC private key names no curve ([0] parameters); use PKCS #8" _bad ] when
  0 nth 0 asn1:child
  dup "universal" 6 "a named curve (OBJECT IDENTIFIER)" asn1:expect
  asn1:node>oid _by-oid 0 nth
  k _ec-private-jwk ;

: _cert-jwk ( cert:record -- record )
  cert "universal" 16 "Certificate" asn1:expect
  cert 0 asn1:child dup "universal" 16 "TBSCertificate" asn1:expect
  dup 0 asn1:child 0 asn1:context? [ 6 ] [ 5 ] if asn1:child _spki-jwk ;

: _der ( b:record -- record )
  b "data" get asn1:parse ;

: _block-jwk ( b:record -- record )
  b "headers" get keys len 0 > [ "the PEM block '" b "label" get cat "' is encrypted (it has header lines); decrypt it first" cat _bad ] when
  b "label" get
  dup "PUBLIC KEY" = [ drop b _der _spki-jwk ] [
  dup "PRIVATE KEY" = [ drop b _der _pkcs8-jwk ] [
  dup "RSA PRIVATE KEY" = [ drop b _der _rsa-private-jwk ] [
  dup "RSA PUBLIC KEY" = [ drop b _der _rsa-public-jwk ] [
  dup "EC PRIVATE KEY" = [ drop b _der _sec1-jwk ] [
  dup "CERTIFICATE" = over "X509 CERTIFICATE" = or [ drop b _der _cert-jwk ] [
  "unsupported PEM block '" swap cat "' (expected PUBLIC KEY, PRIVATE KEY, RSA PRIVATE KEY, RSA PUBLIC KEY, EC PRIVATE KEY or CERTIFICATE)" cat _bad
  b ] if ] if ] if ] if ] if ] if ;

\ Blocks that carry no key and are skipped (the openssl ecparam files hold one next to the key).
: _key-block? ( b:record -- bool )
  b "label" get dup "EC PARAMETERS" = swap "DH PARAMETERS" = or not ;

: _thumb-members ( jwk:record -- record )
  jwk "kty" get "RSA" =
  [ { { "e" jwk "e" get } { "kty" "RSA" } { "n" jwk "n" get } } >record ] [
  jwk "kty" get "EC" =
  [ { { "crv" jwk "crv" get } { "kty" "EC" } { "x" jwk "x" get } { "y" jwk "y" get } } >record ]
  [ { { "crv" jwk "crv" get } { "kty" "OKP" } { "x" jwk "x" get } } >record ] if ] if ;

\ The JWK Thumbprint of RFC 7638: SHA-256 of the required members in lexicographic order as compact JSON, in
\ base64url without padding.
: _thumbprint ( jwk:record -- str )
  jwk _thumb-members json:compact str>bytes "256" sha2:digest _b64u ;

: _with-kid ( jwk:record -- record )
  jwk "kid" jwk _thumbprint put ;

: from-pem ( data:str set-kid:bool=false indent:int=0 -- str )
  "Convert PEM keys to JSON Web Keys (PEM to JWK, RFC 7517). The input is PEM text with PUBLIC KEY (SubjectPublicKeyInfo), PRIVATE KEY (PKCS #8), RSA PRIVATE KEY and RSA PUBLIC KEY (PKCS #1), EC PRIVATE KEY (SEC 1, with its curve) blocks, or CERTIFICATE blocks (the key of the certificate). RSA keys give kty, n, e (and d, p, q, dp, dq, qi for a private key); EC keys on P-256, P-384, P-521 and secp256k1 give kty, crv, x, y (and d); Ed25519, X25519, Ed448 and X448 keys give kty OKP, crv, x (and d, RFC 8037). Numbers and keys are base64url without padding, the coordinates and the private key at the full size of the curve. A private key that carries no public key (every OKP key, and an EC key written without it) has it derived. As in CyberChef each key is one line of compact JSON and several keys are several lines; set-kid adds the kid member, the RFC 7638 JWK Thumbprint (SHA-256, base64url) of the key, as CyberChef's option does. indent (Forge's addition, default 0 for CyberChef's compact text) is the spaces per level within each key's JSON. Encrypted keys, compressed EC points, multi-prime RSA keys, other algorithms and other PEM labels (EC PARAMETERS excepted) are E_COERCE; no key block is E_COERCE." doc
  "Public Key" category
  data str>bytes asn1:pem-decode [ _key-block? ] filter
  dup len 0 = [ "no PEM key block (-----BEGIN ...-----) found in the input" _bad ] when
  [ _block-jwk set-kid [ _with-kid ] when indent json:stringify ] map
  "\n" join ;

META: from-pem
  use-when "You have a public or private key in PEM and need it as a JSON Web Key, for example for a JWKS endpoint or a JOSE library." ;
  param set-kid "Add kid, the RFC 7638 thumbprint of the key (SHA-256, base64url)." ;
  param indent "Spaces per level in each key's JSON; 0 (the default, CyberChef's) writes compact JSON." ;
  see-also jwk:to-pem pem:to-hex ;
  link "https://www.rfc-editor.org/rfc/rfc7517" "RFC 7517: JSON Web Key" ;
  link "https://www.rfc-editor.org/rfc/rfc8037" "RFC 8037: Ed25519 and X25519 keys in JOSE" ;
  link "https://www.rfc-editor.org/rfc/rfc7638" "RFC 7638: JWK Thumbprint" ;
;

\ ---- JWK to PEM ----

: _need ( jwk:record name:str -- )
  jwk keys name util:contains? not [ "the JWK has no '" name cat "' member" cat _bad ] when ;

: _str-member ( jwk:record name:str -- str )
  jwk name _need
  jwk name get dup type "str" = not [ "the '" name cat "' member must be a string" cat _bad ] when ;

\ A member holding base64url text, as bytes.
: _bytes-member ( jwk:record name:str -- bytes )
  [ jwk name _str-member str>bytes util:b64url-decode ]
  [ drop "the '" name cat "' member is not base64url" cat _bad #[ ] ] try ;

: _int-member ( jwk:record name:str -- int )
  jwk name _bytes-member 256 util:digits>int ;

\ ---- DER pieces ----

: _alg-id ( oid:str params:bytes -- bytes )
  { oid asn1:tlv-oid params } asn1:tlv-seq ;

: _alg-id1 ( oid:str -- bytes )
  { oid asn1:tlv-oid } asn1:tlv-seq ;

\ SubjectPublicKeyInfo of an AlgorithmIdentifier and the public key bytes.
: _spki ( alg:bytes key:bytes -- bytes )
  { alg key 0 asn1:tlv-bits } asn1:tlv-seq ;

\ PrivateKeyInfo (PKCS #8, version 0) of an AlgorithmIdentifier and the algorithm's private key bytes.
: _pkcs8 ( alg:bytes inner:bytes -- bytes )
  { 0 asn1:tlv-int alg inner asn1:tlv-octets } asn1:tlv-seq ;

\ ---- RSA ----

: _rsa-alg ( -- bytes )
  "1.2.840.113549.1.1.1" asn1:tlv-null _alg-id ;

: _rsa-der ( jwk:record -- bytes )
  jwk "n" _int-member 0 <= jwk "e" _int-member 0 <= or
  [ "the RSA modulus n and exponent e must be positive" _bad ] when
  jwk keys "d" util:contains?
  [ { 0 asn1:tlv-int }
    { "n" "e" "d" "p" "q" "dp" "dq" "qi" } [ jwk swap _int-member asn1:tlv-int ] map cat
    asn1:tlv-seq
    _rsa-alg swap _pkcs8 ]
  [ _rsa-alg
    { jwk "n" _int-member asn1:tlv-int jwk "e" _int-member asn1:tlv-int } asn1:tlv-seq _spki ] if ;

\ ---- EC and OKP ----

\ The private key d of a JWK, checked: the size of the curve, and the public key it gives is the one of x and y.
: _check-d ( jwk:record row:list expected:bytes -- bytes )
  jwk "d" _bytes-member
  dup len row _size <> [ "the d of a " row 0 nth cat " key is " cat row _size int>str cat " bytes" cat _bad ] when
  dup row 0 nth swap jwk:_public expected <> [ "the d of the JWK does not belong to its public key" _bad ] when ;

: _ec-der3 ( jwk:record row:list point:bytes -- bytes )
  "1.2.840.10045.2.1" row 1 nth asn1:tlv-oid _alg-id
  jwk keys "d" util:contains?
  [ jwk row point _check-d point asn1:tlv-ec-private _pkcs8 ]
  [ point _spki ] if ;

: _ec-der2 ( jwk:record row:list x:bytes y:bytes -- bytes )
  x len row _size <> y len row _size <> or
  [ "the x and y of a " row 0 nth cat " key are " cat row _size int>str cat " bytes each" cat _bad ] when
  row 0 nth #[ 04 ] x cat y cat jwk:_on-curve not
  [ "the point (x, y) is not on the curve " row 0 nth cat _bad ] when
  jwk row #[ 04 ] x cat y cat _ec-der3 ;

: _ec-der ( jwk:record row:list -- bytes )
  jwk row jwk "x" _bytes-member jwk "y" _bytes-member _ec-der2 ;

: _okp-der2 ( jwk:record row:list x:bytes -- bytes )
  x len row _size <> [ "the x of a " row 0 nth cat " key is " cat row _size int>str cat " bytes" cat _bad ] when
  row 1 nth _alg-id1
  jwk keys "d" util:contains?
  [ jwk row x _check-d asn1:tlv-octets _pkcs8 ]
  [ x _spki ] if ;

: _okp-der ( jwk:record row:list -- bytes )
  jwk row jwk "x" _bytes-member _okp-der2 ;

\ The DER of an EC or OKP JWK; kty must agree with the kind of the curve.
: _curve-der ( jwk:record kty:str -- bytes )
  jwk "crv" _str-member _by-name
  dup 3 nth kty <> [ "the curve '" jwk "crv" get cat "' cannot be used with kty " cat kty cat _bad ] when
  kty "EC" = [ jwk swap _ec-der ] [ jwk swap _okp-der ] if ;

\ One JWK as a PEM block: PUBLIC KEY, or PRIVATE KEY when the JWK has d.
: _key-pem ( jwk:any -- str )
  jwk type "record" = jwk json:null? not and not [ "each key must be a JSON object" _bad ] when
  jwk "kty" _str-member
  dup "RSA" = [ drop jwk _rsa-der ] [
  dup "EC" = over "OKP" = or [ jwk swap _curve-der ] [
  "oct" = [ "a symmetric key (kty oct) has no PEM form" _bad #[ ] ] [ "unsupported key type (kty); expected RSA, EC or OKP" _bad #[ ] ] if ] if ] if
  jwk keys "d" util:contains? [ "PRIVATE KEY" ] [ "PUBLIC KEY" ] if swap asn1:pem-encode ;

\ The keys of a JWK, a JWK Set ({"keys": [...]}) or an array of JWKs.
: _keys ( v:any -- list )
  v type "list" = [ v ] [
    v type "record" = v json:null? not and not [ "a JWK is a JSON object, a JWK Set an object with a keys array, or an array of JWKs" _bad ] when
    v keys "keys" util:contains?
    [ v "keys" get dup type "list" = not [ "the keys member of a JWK Set must be an array" _bad ] when ]
    [ { } v append ] if ] if ;

: to-pem ( data:str -- str )
  "Convert JSON Web Keys to PEM (JWK to PEM, RFC 7517). The input is one JWK, a JWK Set ({\"keys\": [...]}) or a JSON array of JWKs. A public key gives -----BEGIN PUBLIC KEY----- (SubjectPublicKeyInfo) and a key with a private part d gives -----BEGIN PRIVATE KEY----- (PKCS #8), one block per key. RSA keys need n and e, and for a private key d, p, q, dp, dq and qi (multi-prime keys and a private key without the CRT members are E_COERCE). EC keys (P-256, P-384, P-521, secp256k1) need crv, x and y at the full size of the curve and the point must lie on the curve; OKP keys (Ed25519, X25519, Ed448, X448, RFC 8037) need crv and x. A private part d is checked to belong to the public key, so a JWK with a wrong d is refused. Other members (use, kid, alg, key_ops) are ignored; the symmetric kty oct, other key types, other curves, base64url that is damaged and text that is not JSON are E_COERCE." doc
  "Public Key" category
  data json:parse _keys
  dup len 0 = [ "the input holds no key" _bad ] when
  [ _key-pem ] map "" join ;

META: to-pem
  use-when "You have a JSON Web Key or a JWKS and need PEM keys that openssl or a web server can read." ;
  inverse from-pem ;
  see-also jwk:from-pem pem:from-hex ;
  link "https://www.rfc-editor.org/rfc/rfc7517" "RFC 7517: JSON Web Key" ;
  link "https://www.rfc-editor.org/rfc/rfc8037" "RFC 8037: Ed25519 and X25519 keys in JOSE" ;
;
