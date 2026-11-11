\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rsa: RSA (RFC 8017) on the bigints of the language, no library: Generate RSA Key Pair, RSA Sign, RSA Verify, RSA
\ Encrypt, RSA Decrypt and Public Key from Private Key (the RSA case; an elliptic curve key is E_RANGE until WP 5.51).
\ Keys are PEM text, read and written with the shared asn1 words: public keys as RSAPublicKey (RSA PUBLIC KEY) or
\ SubjectPublicKeyInfo (PUBLIC KEY), private keys as RSAPrivateKey (RSA PRIVATE KEY) or PKCS#8 (PRIVATE KEY), and
\ encrypted private keys (the legacy Proc-Type/DEK-Info form with AES-CBC or Triple DES or DES, and PKCS#8 PBES2 with
\ PBKDF2 and AES-CBC or Triple DES or DES). A key record is { n e } (public) or { n e d p q dp dq qi } (private),
\ all ints; a PEM text with several blocks (the output of Generate RSA Key Pair holds two) gives the first block of
\ the right kind.
\ The padding is FL over the digest words (md5, sha1, sha2) and MGF1: RSAES-PKCS1-v1_5, RSAES-OAEP (the label is
\ empty and the MGF1 hash is the OAEP hash, as in OpenSSL and node-forge), raw RSA, RSASSA-PKCS1-v1_5 and RSASSA-PSS.
\ The private operation uses the Chinese remainder theorem over powmod and checks its result with the public
\ exponent. The prime search of key generation is the primitive _prime (src/prims/rsa.ts); the random bytes of
\ every operation come from random:bytes-of, so an op that needs them carries +random.
\ A failed decryption is always the one E_COERCE message "decryption error": the reason (padding, hash, length,
\ range) is never reported.
IN: rsa

USING: asn1 random md5 sha1 sha2 evp pbkdf2 aes triple-des des json ;

\ ---- digests ----

: _hlen ( alg:str -- int )
  alg "MD5" = [ 16 ] [
  alg "SHA-1" = [ 20 ] [
  alg "SHA-256" = [ 32 ] [
  alg "SHA-384" = [ 48 ] [
  alg "SHA-512" = [ 64 ] [
  "the digest must be SHA-1, MD5, SHA-256, SHA-384 or SHA-512" raise:range 0
  ] if ] if ] if ] if ] if ;

: _digest ( data:bytes alg:str -- bytes )
  alg "MD5" = [ data md5:digest ] [
  alg "SHA-1" = [ data sha1:digest ] [
  alg "SHA-256" = [ data "256" sha2:digest ] [
  alg "SHA-384" = [ data "384" sha2:digest ] [
  alg "SHA-512" = [ data "512" sha2:digest ] [
  "the digest must be SHA-1, MD5, SHA-256, SHA-384 or SHA-512" raise:range #[ ]
  ] if ] if ] if ] if ] if ;

\ The OID of the digest in a DigestInfo (RFC 8017 section 9.2, note 1).
: _hash-oid ( alg:str -- str )
  alg "MD5" = [ "1.2.840.113549.2.5" ] [
  alg "SHA-1" = [ "1.3.14.3.2.26" ] [
  alg "SHA-256" = [ "2.16.840.1.101.3.4.2.1" ] [
  alg "SHA-384" = [ "2.16.840.1.101.3.4.2.2" ] [
  "2.16.840.1.101.3.4.2.3"
  ] if ] if ] if ] if ;

\ MGF1 (RFC 8017 appendix B.2.1): n bytes of Hash(seed || counter) for the counters 0, 1, ...
: _mgf1 ( seed:bytes n:int alg:str -- bytes )
  0 n alg _hlen util:ceil-div range [ 4 util:int>be-bytes seed swap cat alg _digest ] map
  #[ ] bjoin 0 n slice ;

\ ---- integers and bytes ----

: _os2ip ( data:bytes -- int )
  data len 0 = [ 0 ] [ data bytes>hex 16 str>int-radix ] if ;

\ The k big-endian bytes of v; E_RANGE when v needs more.
: _i2osp ( v:int k:int -- bytes )
  v util:int>bytes
  dup len k > [ "an integer does not fit in " k int>str cat " bytes" cat raise:range ] when
  k over len - util:zero-bytes swap cat ;

\ The number of bytes and of bits of the modulus.
: _k ( n:int -- int )
  n util:int>bytes len ;

: _bits ( n:int -- int )
  n 2 int>str-radix len ;

: _fail ( -- )
  "decryption error" raise:coerce ;

\ ---- keys: reading ----

: _rsa-oid ( -- str )
  "1.2.840.113549.1.1.1" ;

\ E_RANGE for a well-formed key of another algorithm (an EC key until WP 5.51 adds them).
: _check-oid ( oid:str -- )
  oid _rsa-oid <> [
    "the key is not an RSA key: its algorithm is " oid asn1:oid-label cat
    oid "1.2.840.10045.2.1" = [ " (elliptic curve keys are not supported yet)" cat ] when
    raise:range ] when ;

\ The AlgorithmIdentifier of a key names rsaEncryption (its parameters are NULL or absent).
: _check-alg ( alg:record -- )
  alg "universal" 16 "an AlgorithmIdentifier" asn1:expect
  alg 0 asn1:child asn1:node>oid _check-oid ;

: _int-at ( node:record i:int -- int )
  node i asn1:child asn1:node>int ;

: _count ( node:record n:int what:str -- )
  node "universal" 16 what asn1:expect
  node asn1:children len n <> [
    what " has " cat node asn1:children len int>str cat " elements, not " cat n int>str cat raise:coerce ] when ;

: _make-public ( n:int e:int -- record )
  n 3 < [ "the RSA modulus is too small" raise:coerce ] when
  e 3 < [ "the RSA public exponent is too small" raise:coerce ] when
  { { "n" n } { "e" e } } >record ;

\ { n e } of an RSAPublicKey SEQUENCE.
: _pkcs1-public ( seq:record -- record )
  seq 2 "an RSAPublicKey" _count
  seq 0 _int-at seq 1 _int-at _make-public ;

\ { n e } of a SubjectPublicKeyInfo SEQUENCE.
: _spki-public ( seq:record -- record )
  seq 2 "a SubjectPublicKeyInfo" _count
  seq 0 asn1:child _check-alg
  seq 1 asn1:child asn1:node>bits 0 <> [ "the public key BIT STRING has unused bits" raise:coerce ] when
  asn1:parse _pkcs1-public ;

: _public-der ( der:bytes -- record )
  der asn1:parse
  dup asn1:children len 0 = [ "the public key SEQUENCE is empty" raise:coerce ] when
  dup 0 asn1:child "universal" 16 asn1:is? [ _spki-public ] [ _pkcs1-public ] if ;

: _make-private ( n:int e:int d:int p:int q:int dp:int dq:int qi:int -- record )
  n 3 < e 3 < or d 1 < or [ "the RSA private key is damaged (modulus, exponents)" raise:coerce ] when
  p 0 > q 0 > and [ p q * n <> [ "the RSA private key is damaged (p times q is not the modulus)" raise:coerce ] when ] when
  { { "n" n } { "e" e } { "d" d } { "p" p } { "q" q } { "dp" dp } { "dq" dq } { "qi" qi } } >record ;

\ The key of an RSAPrivateKey SEQUENCE (version 0; 1 is multi-prime, which is not supported).
: _pkcs1-private ( seq:record -- record )
  seq "universal" 16 "an RSAPrivateKey" asn1:expect
  seq asn1:children len 9 < [ "an RSAPrivateKey needs 9 INTEGERs" raise:coerce ] when
  seq 0 _int-at dup 1 = [ "multi-prime RSA keys are not supported" raise:range ] when
  0 <> [ "an RSAPrivateKey must have version 0" raise:coerce ] when
  seq 1 _int-at seq 2 _int-at seq 3 _int-at seq 4 _int-at seq 5 _int-at seq 6 _int-at seq 7 _int-at seq 8 _int-at
  _make-private ;

\ The key of a PKCS#8 PrivateKeyInfo SEQUENCE.
: _pkcs8-private ( seq:record -- record )
  seq "universal" 16 "a PrivateKeyInfo" asn1:expect
  seq asn1:children len 3 < [ "a PrivateKeyInfo needs a version, an algorithm and a key" raise:coerce ] when
  seq 1 asn1:child _check-alg
  seq 2 asn1:child dup "universal" 4 "an OCTET STRING" asn1:expect
  "value" get asn1:parse _pkcs1-private ;

: _private-der ( der:bytes -- record )
  der asn1:parse
  dup asn1:children len 3 >= [ dup 1 asn1:child "universal" 16 asn1:is? ] [ false ] if
  [ _pkcs8-private ] [ _pkcs1-private ] if ;

\ ---- keys: finding the PEM block ----

\ The first block whose label is in labels. None is E_RANGE, naming what was expected and the labels found.
: _find-block ( blocks:list labels:list what:str -- record )
  blocks [ "label" get labels swap util:contains? ] filter
  dup len 0 = [
    blocks len 0 =
    [ "no PEM block found: " what cat " is expected (-----BEGIN ...-----)" cat raise:range ]
    [ blocks [ "label" get ] map ", " join
      "the PEM text has no " what cat " (found: " cat swap cat ")" cat
      blocks [ "label" get "EC PRIVATE KEY" = ] filter len 0 > [ " (elliptic curve keys are not supported yet)" cat ] when
      raise:range ] if ] when
  0 nth ;

: _public-key ( pem:str -- record )
  pem str>bytes asn1:pem-decode { "PUBLIC KEY" "RSA PUBLIC KEY" } "PUBLIC KEY or RSA PUBLIC KEY block" _find-block
  "data" get _public-der ;

\ ---- keys: encrypted private keys ----

: _no-password ( password:str -- )
  password len 0 = [ "the private key is encrypted: give its password" raise:range ] when ;

: _bad-password ( -- )
  "cannot decrypt the private key: the password is wrong or the key is damaged" raise:coerce ;

\ ( data key iv kind:str -- bytes ): CBC with PKCS#7 padding for aes, 3des or des.
: _cbc-decrypt ( data:bytes key:bytes iv:bytes kind:str -- bytes )
  kind "aes" = [ data key iv "CBC" "pkcs7" #[ ] aes:decrypt ] [
  kind "3des" = [ data key iv "CBC" "pkcs7" triple-des:decrypt ]
  [ data key iv "CBC" "pkcs7" des:decrypt ] if ] if ;

\ The decrypted DER must be a SEQUENCE; anything else means a wrong password.
: _check-plain ( plain:bytes -- bytes )
  plain len 2 < [ _bad-password ] when
  plain 0 nth 48 <> [ _bad-password ] when
  plain ;


\ The key size in bytes of a legacy DEK-Info cipher name.
: _dek-size ( name:str -- int )
  name "AES-128-CBC" = [ 16 ] [
  name "AES-192-CBC" = [ 24 ] [
  name "AES-256-CBC" = [ 32 ] [
  name "DES-EDE3-CBC" = [ 24 ] [
  name "DES-CBC" = [ 8 ]
  [ "the encrypted key uses an unsupported cipher: " name cat raise:range 0 ] if ] if ] if ] if ] if ;

: _dek-kind ( name:str -- str )
  name "AES" util:starts-with? [ "aes" ] [ name "DES-EDE3-CBC" = [ "3des" ] [ "des" ] if ] if ;

\ The DER of a legacy encrypted PEM body. The key is OpenSSL's EVP_BytesToKey over MD5 with the first 8 bytes of
\ the IV as the salt and one iteration.
: _legacy-open ( data:bytes password:str name:str iv:bytes -- bytes )
  iv len name "AES" util:starts-with? [ 16 ] [ 8 ] if <> [ "the DEK-Info IV has the wrong length" raise:coerce ] when
  [ data password str>bytes name _dek-size 1 "md5" iv 0 8 slice evp:derive iv name _dek-kind _cbc-decrypt _check-plain ]
  [ drop _bad-password #[ ] ] try ;

: _legacy-decrypt ( block:record password:str -- bytes )
  password _no-password
  block "headers" get "DEK-Info" get util:strip-space "," split
  dup len 2 <> [ "the DEK-Info header is not cipher,IV" raise:coerce ] when
  block "data" get password rot dup 0 nth upper swap 1 nth hex>bytes _legacy-open ;

\ ---- PKCS#8 EncryptedPrivateKeyInfo with PBES2 (RFC 8018 appendix A.4) ----
\ SEQUENCE { SEQUENCE { pbes2, SEQUENCE { SEQUENCE { pbkdf2, params }, SEQUENCE { cipher, IV } } }, OCTET STRING }

: _alg ( root:record -- record )
  root 0 asn1:child ;

: _scheme ( root:record -- record )
  root _alg 1 asn1:child ;

: _kdf ( root:record -- record )
  root _scheme 0 asn1:child ;

: _enc ( root:record -- record )
  root _scheme 1 asn1:child ;

: _kdfp ( root:record -- record )
  root _kdf 1 asn1:child ;

\ The key size in bytes of a PBES2 cipher OID.
: _pbes2-size ( oid:str -- int )
  oid "2.16.840.1.101.3.4.1.2" = [ 16 ] [
  oid "2.16.840.1.101.3.4.1.22" = [ 24 ] [
  oid "2.16.840.1.101.3.4.1.42" = [ 32 ] [
  oid "1.2.840.113549.3.7" = [ 24 ] [
  oid "1.3.14.3.2.7" = [ 8 ]
  [ "the encrypted key uses an unsupported cipher: " oid asn1:oid-label cat raise:range 0 ] if ] if ] if ] if ] if ;

: _pbes2-kind ( oid:str -- str )
  oid "1.2.840.113549.3.7" = [ "3des" ] [ oid "1.3.14.3.2.7" = [ "des" ] [ "aes" ] if ] if ;

: _pbes2-hash ( oid:str -- str )
  oid "1.2.840.113549.2.7" = [ "sha1" ] [
  oid "1.2.840.113549.2.9" = [ "sha256" ] [
  oid "1.2.840.113549.2.10" = [ "sha384" ] [
  oid "1.2.840.113549.2.11" = [ "sha512" ]
  [ "the encrypted key uses an unsupported PBKDF2 hash: " oid asn1:oid-label cat raise:range "" ] if ] if ] if ] if ;

\ The PRF of PBKDF2-params: the first SEQUENCE after the salt and the iteration count (an optional key length may
\ stand between), else hmacWithSHA1.
: _pbes2-prf ( root:record -- str )
  root _kdfp asn1:children [ "universal" 16 asn1:is? ] filter
  dup len 0 = [ drop "1.2.840.113549.2.7" ] [ 0 nth 0 asn1:child asn1:node>oid ] if
  _pbes2-hash ;

: _pbes2-oid ( root:record -- str )
  root _enc 0 asn1:child asn1:node>oid ;

\ The structure is checked before any work is done.
: _pbes2-check ( root:record -- )
  root 2 "an EncryptedPrivateKeyInfo" _count
  root 1 asn1:child "universal" 4 "the encrypted data" asn1:expect
  root _alg 2 "an AlgorithmIdentifier" _count
  root _alg 0 asn1:child asn1:node>oid dup "1.2.840.113549.1.5.13" <> [
    "the encrypted key uses an unsupported scheme: " swap asn1:oid-label cat raise:range ] [ drop ] if
  root _scheme 2 "PBES2-params" _count
  root _kdf 2 "the key derivation function" _count
  root _kdf 0 asn1:child asn1:node>oid dup "1.2.840.113549.1.5.12" <> [
    "the encrypted key uses an unsupported key derivation: " swap asn1:oid-label cat raise:range ] [ drop ] if
  root _kdfp "universal" 16 "PBKDF2-params" asn1:expect
  root _kdfp asn1:children len 2 < [ "PBKDF2-params needs a salt and an iteration count" raise:coerce ] when
  root _kdfp 0 asn1:child "universal" 4 "the PBKDF2 salt" asn1:expect
  root _enc 2 "the encryption scheme" _count
  root _enc 1 asn1:child "universal" 4 "the IV" asn1:expect
  root _pbes2-oid _pbes2-size drop
  root _pbes2-prf drop
  root _enc 1 asn1:child "value" get len root _pbes2-oid _pbes2-kind "aes" = [ 16 ] [ 8 ] if <> [
    "the IV of the encrypted key has the wrong length" raise:coerce ] when ;

\ The DER inside an EncryptedPrivateKeyInfo (the root node), with the password.
: _pbes2-open ( root:record password:str -- bytes )
  password _no-password
  root _pbes2-check
  [ password str>bytes root _pbes2-oid _pbes2-size root _kdfp 1 _int-at root _pbes2-prf
      root _kdfp 0 asn1:child "value" get pbkdf2:derive
    root 1 asn1:child "value" get swap root _enc 1 asn1:child "value" get root _pbes2-oid _pbes2-kind
    _cbc-decrypt _check-plain ]
  [ drop _bad-password #[ ] ] try ;

\ ---- keys: private key from PEM ----

\ The DER of the private key in a PEM block, decrypted when it is encrypted.
: _block-der ( block:record password:str -- bytes )
  block "label" get "ENCRYPTED PRIVATE KEY" =
  [ block "data" get asn1:parse password _pbes2-open ]
  [ block "headers" get keys "DEK-Info" util:contains?
    [ block password _legacy-decrypt ] [ block "data" get ] if ] if ;

: _private-key ( pem:str password:str -- record )
  pem str>bytes asn1:pem-decode { "RSA PRIVATE KEY" "PRIVATE KEY" "ENCRYPTED PRIVATE KEY" }
  "PRIVATE KEY, RSA PRIVATE KEY or ENCRYPTED PRIVATE KEY block" _find-block
  password _block-der _private-der ;

\ ---- keys: writing ----

: _der-pkcs1-public ( key:record -- bytes )
  { key "n" get asn1:tlv-int key "e" get asn1:tlv-int } asn1:tlv-seq ;

: _rsa-alg-id ( -- bytes )
  { _rsa-oid asn1:tlv-oid asn1:tlv-null } asn1:tlv-seq ;

\ SubjectPublicKeyInfo.
: _der-public ( key:record -- bytes )
  { _rsa-alg-id key _der-pkcs1-public 0 asn1:tlv-bits } asn1:tlv-seq ;

\ RSAPrivateKey (PKCS#1).
: _der-private ( key:record -- bytes )
  { 0 asn1:tlv-int
    key "n" get asn1:tlv-int key "e" get asn1:tlv-int key "d" get asn1:tlv-int
    key "p" get asn1:tlv-int key "q" get asn1:tlv-int
    key "dp" get asn1:tlv-int key "dq" get asn1:tlv-int key "qi" get asn1:tlv-int } asn1:tlv-seq ;

: _pem-public ( key:record -- str )
  "PUBLIC KEY" key _der-public asn1:pem-encode ;

: _pem-private ( key:record -- str )
  "RSA PRIVATE KEY" key _der-private asn1:pem-encode ;

: _jwk-public ( key:record -- str )
  { { "kty" "RSA" } { "n" key "n" get util:int>b64url } { "e" key "e" get util:int>b64url } } >record 0 json:stringify ;

: _jwk-private ( key:record -- str )
  { { "kty" "RSA" } { "n" key "n" get util:int>b64url } { "e" key "e" get util:int>b64url } { "d" key "d" get util:int>b64url }
    { "p" key "p" get util:int>b64url } { "q" key "q" get util:int>b64url } { "dp" key "dp" get util:int>b64url } { "dq" key "dq" get util:int>b64url }
    { "qi" key "qi" get util:int>b64url } } >record 0 json:stringify ;

\ ---- the RSA functions (RFC 8017 section 5) ----

\ The public operation, m^e mod n.
: _pub-op ( m:int key:record -- int )
  m key "e" get key "n" get powmod ;

: _crt-join ( m1:int m2:int key:record -- int )
  m2 m1 m2 - key "qi" get * key "p" get mod key "q" get * + ;

: _crt ( c:int key:record -- int )
  c key "dp" get key "p" get powmod
  c key "dq" get key "q" get powmod
  key _crt-join ;

\ The private operation, c^d mod n, by the Chinese remainder theorem when the key has its prime factors, checked by
\ the public operation (a damaged key, or a fault, gives a wrong result that would leak the factors in a signature).
: _priv-op ( c:int key:record -- int )
  key "p" get 0 > key "q" get 0 > and
  [ c key _crt ] [ c key "d" get key "n" get powmod ] if
  dup key _pub-op c <> [ "the RSA private key is damaged (the private operation did not invert the public one)" raise:coerce ] when ;

\ ---- RSAES-PKCS1-v1_5 (RFC 8017 section 7.2) ----

\ n random bytes, none of them zero.
: _nonzero ( n:int -- bytes )
  n 0 = [ #[ ] ] [
    n random:bytes-of 0 util:drop-byte
    dup len n < [ n over len - recurse cat ] [ 0 n slice ] if ] if ;

: _too-long ( size:int limit:int what:str -- )
  size limit > [
    "the message is " size int>str cat " bytes; a key of this size encrypts at most " cat limit 0 max int>str cat
    " bytes with " cat what cat raise:range ] when ;

: _v15-enc-em ( data:bytes k:int -- bytes )
  data len k 11 - "RSAES-PKCS1-V1_5" _too-long
  #[ 00 02 ] k data len - 3 - _nonzero cat #[ 00 ] cat data cat ;

: _v15-dec-em ( em:bytes k:int -- bytes )
  k 11 < [ _fail ] when
  em 0 nth 0 <> em 1 nth 2 <> or [ _fail ] when
  em 2 k slice [ 0 <> ] util:count-leading
  dup 8 < over 2 + k >= or [ _fail ] when
  3 + em swap k slice ;

\ ---- RSAES-OAEP (RFC 8017 section 7.1), empty label ----

: _oaep-max ( k:int alg:str -- int )
  k alg _hlen 2 * - 2 - ;

\ 00 || maskedSeed || maskedDB, with maskedSeed = seed xor MGF1(maskedDB, hLen).
: _oaep-assemble ( masked:bytes seed:bytes alg:str -- bytes )
  #[ 00 ] seed masked alg _hlen alg _mgf1 bxor cat masked cat ;

\ The encoded message from the data block DB and the seed: maskedDB = DB xor MGF1(seed, |DB|).
: _oaep-pack ( db:bytes seed:bytes alg:str -- bytes )
  db seed db len alg _mgf1 bxor seed alg _oaep-assemble ;

: _oaep-enc-em ( data:bytes k:int alg:str -- bytes )
  data len k alg _oaep-max "RSAES-OAEP" _too-long
  #[ ] alg _digest
  k alg _oaep-max data len - util:zero-bytes cat #[ 01 ] cat data cat
  alg _hlen random:bytes-of alg _oaep-pack ;

: _oaep-db ( mdb:bytes seed:bytes alg:str -- bytes )
  mdb seed mdb len alg _mgf1 bxor ;

\ DB from maskedSeed and maskedDB.
: _oaep-unmask ( ms:bytes mdb:bytes alg:str -- bytes )
  mdb ms mdb alg _hlen alg _mgf1 bxor alg _oaep-db ;

\ The message after the zero bytes and the 01 of PS || 01 || M.
: _oaep-msg ( rest:bytes -- bytes )
  rest [ 0 = ] util:count-leading
  dup rest len >= [ _fail ] when
  rest over nth 1 <> [ _fail ] when
  1 + rest swap rest len slice ;

\ The message in DB = lHash || PS || 01 || M; every fault is the same error.
: _oaep-unpad ( db:bytes alg:str -- bytes )
  db 0 alg _hlen slice #[ ] alg _digest <> [ _fail ] when
  db alg _hlen db len slice _oaep-msg ;

: _oaep-dec-em ( em:bytes k:int alg:str -- bytes )
  k alg _hlen 2 * 2 + < [ _fail ] when
  em 0 nth 0 <> [ _fail ] when
  em 1 1 alg _hlen + slice
  em 1 alg _hlen + em len slice
  alg _oaep-unmask alg _oaep-unpad ;

\ ---- raw RSA ----

: _raw-enc-em ( data:bytes k:int -- bytes )
  data len k > [ "the message is " data len int>str cat " bytes, longer than the " cat k int>str cat "-byte key" cat raise:range ] when
  data ;

\ ---- encrypt and decrypt ----

\ The k bytes that go through the public operation: the encoded message, or the message itself for RAW.
: _enc-em ( data:bytes k:int scheme:str alg:str -- bytes )
  scheme "RSA-OAEP" = [ data k alg _oaep-enc-em ] [
  scheme "RSAES-PKCS1-V1_5" = [ data k _v15-enc-em ] [
  scheme "RAW" = [ data k _raw-enc-em ]
  [ "the scheme must be RSA-OAEP, RSAES-PKCS1-V1_5 or RAW" raise:range #[ ] ] if ] if ] if ;

: _encrypt ( data:bytes key:record scheme:str alg:str -- bytes )
  key "n" get _k
  dup data swap scheme alg _enc-em _os2ip
  dup key "n" get >= [ "the message, read as a number, is not below the modulus" raise:range ] when
  key _pub-op swap _i2osp ;

: _dec-em ( em:bytes k:int scheme:str alg:str -- bytes )
  scheme "RSA-OAEP" = [ em k alg _oaep-dec-em ] [
  scheme "RSAES-PKCS1-V1_5" = [ em k _v15-dec-em ] [
  scheme "RAW" = [ em ]
  [ "the scheme must be RSA-OAEP, RSAES-PKCS1-V1_5 or RAW" raise:range #[ ] ] if ] if ] if ;

\ The k bytes of the private operation on the ciphertext; a wrong length or a value not below n is the one error.
: _decrypt ( data:bytes key:record scheme:str alg:str -- bytes )
  key "n" get _k
  data len over <> [ _fail ] when
  data _os2ip dup key "n" get >= [ _fail ] when
  key _priv-op over _i2osp swap scheme alg _dec-em ;

\ ---- RSASSA-PKCS1-v1_5 (RFC 8017 section 8.2) ----

: _alg-id ( alg:str -- bytes )
  { alg _hash-oid asn1:tlv-oid asn1:tlv-null } asn1:tlv-seq ;

\ DigestInfo of the message digest.
: _digest-info ( hash:bytes alg:str -- bytes )
  { alg _alg-id hash asn1:tlv-octets } asn1:tlv-seq ;

\ EMSA-PKCS1-v1_5: 00 01 FF ... FF 00 DigestInfo, k bytes; the empty bytes when the key is too small for it.
: _v15-em ( data:bytes alg:str k:int -- bytes )
  data alg _digest alg _digest-info
  dup len 11 + k >
  [ drop #[ ] ]
  [ k over len - 3 - util:zero-bytes #[ ff ] bxor
    #[ 00 01 ] swap cat #[ 00 ] cat swap cat ] if ;

: _v15-sign2 ( em:bytes key:record k:int -- bytes )
  em len 0 = [ "the key is too small for this digest" raise:range ] when
  em _os2ip key _priv-op k _i2osp ;

: _v15-sign ( data:bytes key:record alg:str -- bytes )
  data alg key "n" get _k _v15-em key key "n" get _k _v15-sign2 ;

\ The signature as a number, or -1 when its length is not the key's or its value is not below n.
: _sig-int ( sig:bytes key:record -- int )
  sig len key "n" get _k <> [ -1 ] [ sig _os2ip dup key "n" get >= [ drop -1 ] when ] if ;

: _v15-verify ( sig:bytes key:record alg:str msg:bytes -- bool )
  sig key _sig-int dup 0 <
  [ drop false ]
  [ key _pub-op key "n" get _k _i2osp msg alg key "n" get _k _v15-em = ] if ;

\ ---- RSASSA-PSS (RFC 8017 section 9.1), MGF1 with the same hash ----

\ emLen = ceil((modBits - 1) / 8), and the mask of the bits of the first byte that must be zero.
: _em-len ( n:int -- int )
  n _bits 1 - 7 + 8 div ;

: _top-mask ( n:int -- int )
  255 n _em-len 8 * n _bits 1 - - shr ;

: _clear-top ( data:bytes mask:int -- bytes )
  data 0 nth mask band 1 util:int>be-bytes data 1 data len slice cat ;

\ H = Hash(8 zero bytes || mHash || salt).
: _pss-h ( mhash:bytes salt:bytes alg:str -- bytes )
  8 util:zero-bytes mhash cat salt cat alg _digest ;

: _pss-db ( salt:bytes emlen:int alg:str -- bytes )
  emlen salt len - alg _hlen - 2 - util:zero-bytes #[ 01 ] cat salt cat ;

\ maskedDB || H || 0xbc.
: _pss-finish ( h:bytes salt:bytes emlen:int alg:str mask:int -- bytes )
  salt emlen alg _pss-db h emlen alg _hlen - 1 - alg _mgf1 bxor mask _clear-top h cat #[ bc ] cat ;

\ E_RANGE unless the key has room for a salt of sl bytes with this digest.
: _pss-room ( key:record alg:str sl:int -- )
  sl -1 < [ "the PSS salt length must be -1 (the digest length) or more" raise:range ] when
  key "n" get _em-len alg _hlen sl -1 = [ alg _hlen ] [ sl ] if + 2 + < [
    "the key is too small for this digest and salt length" raise:range ] when ;

: _pss-sign2 ( salt:bytes mhash:bytes key:record alg:str -- bytes )
  mhash salt alg _pss-h
  salt key "n" get _em-len alg key "n" get _top-mask _pss-finish
  _os2ip key _priv-op key "n" get _k _i2osp ;

: _pss-sign ( data:bytes key:record alg:str sl:int -- bytes )
  key alg sl _pss-room
  sl -1 = [ alg _hlen ] [ sl ] if random:bytes-of
  data alg _digest key alg _pss-sign2 ;

\ The emLen bytes of the encoded message (a leading zero byte is dropped when emLen is one less than k).
: _pss-em ( em:bytes n:int -- bytes )
  n _k n _em-len - dup 0 =
  [ drop em ]
  [ 1 = em 0 nth 0 = and [ em 1 em len slice ] [ "bad PSS encoding" raise:coerce #[ ] ] if ] if ;

\ The salt in DB = PS || 01 || salt, or a fault.
: _pss-salt ( db:bytes -- bytes )
  db [ 0 = ] util:count-leading
  dup db len >= [ "bad PSS encoding" raise:coerce ] when
  db over nth 1 <> [ "bad PSS encoding" raise:coerce ] when
  1 + db swap db len slice ;

\ The checks that need the split encoding: maskedDB (mdb) and H.
: _pss-check2 ( mdb:bytes h:bytes mhash:bytes n:int alg:str sl:int -- bool )
  mdb 0 nth 255 n _top-mask bxor band 0 <> [ "bad PSS encoding" raise:coerce ] when
  mdb h mdb len alg _mgf1 bxor n _top-mask _clear-top _pss-salt
  dup len sl <> sl -1 <> and [ "bad PSS encoding" raise:coerce ] when
  mhash swap alg _pss-h h = ;

\ EMSA-PSS-VERIFY after the encoding is cut to emLen bytes: true when it matches, a fault is an error.
: _pss-check ( em:bytes mhash:bytes n:int alg:str sl:int -- bool )
  n _em-len alg _hlen sl 0 max + 2 + < [ "bad PSS encoding" raise:coerce ] when
  em em len 1 - nth 188 <> [ "bad PSS encoding" raise:coerce ] when
  em 0 n _em-len alg _hlen - 1 - slice
  em n _em-len alg _hlen - 1 - n _em-len 1 - slice
  mhash n alg sl _pss-check2 ;

: _pss-verify ( sig:bytes key:record msg:bytes alg:str sl:int -- bool )
  sig key _sig-int dup 0 <
  [ drop false ]
  [ key _pub-op key "n" get _k _i2osp key "n" get _pss-em msg alg _digest key "n" get alg sl _pss-check ] if ;

\ ---- sign and verify ----

: _sign ( data:bytes key:record alg:str scheme:str sl:int -- bytes )
  scheme "RSASSA-PSS" = [ data key alg sl _pss-sign ] [ data key alg _v15-sign ] if ;

\ Any fault in a signature (length, range, padding, hash) is a failed verification, not an error.
: _verify ( sig:bytes key:record msg:bytes alg:str scheme:str sl:int -- bool )
  [ scheme "RSASSA-PSS" = [ sig key msg alg sl _pss-verify ] [ sig key alg msg _v15-verify ] if ]
  [ drop false ] try ;

\ ---- key generation ----

\ One try at a prime: a pool of random candidates (about 128 of 2048 bits) and the bytes of the Miller-Rabin bases.
: _try-prime ( bits:int -- int )
  32768 random:bytes-of bits 192 random:bytes-of _prime ;

\ A probable prime of the given size. The search ends after 200 pools, which a working random source never needs.
: _gen-prime ( bits:int tries:int -- int )
  tries 0 = [ "no prime found in 200 pools of random candidates: the random source is broken" fail 0 ] [
    bits _try-prime dup 0 = [ drop bits tries 1 - recurse ] when ] if ;

\ A second prime of the same size, not close to p (FIPS 186-5 B.3.3: |p - q| above 2^(half - 100)).
: _gen-other ( p:int half:int -- int )
  half 200 _gen-prime
  dup p - abs 1 half 100 - shl <= [ drop p half recurse ] when ;

\ The private exponent: the inverse of e modulo lcm(p - 1, q - 1).
: _exponent ( p:int q:int -- int )
  65537 p 1 - q 1 - * p 1 - q 1 - gcd div invmod ;

: _assemble ( p:int q:int d:int -- record )
  { { "n" p q * } { "e" 65537 } { "d" d } { "p" p } { "q" q } { "dp" d p 1 - mod } { "dq" d q 1 - mod }
    { "qi" q p invmod } } >record ;

\ p above q, as PKCS#1 writers conventionally have it.
: _ordered ( p:int q:int -- record )
  p q < [ q p ] [ p q ] if dup2 _exponent _assemble ;

: _generate ( bits:int -- record )
  bits 2 div
  dup 200 _gen-prime dup rot _gen-other
  _ordered ;

: _key-pair-text ( key:record format:str -- str )
  format "JWK" =
  [ key _jwk-public "\n" cat key _jwk-private cat "\n" cat ]
  [ key _pem-public "\n" cat key _pem-private cat ] if ;

\ ---- the ops ----

: _public-out ( key:record format:str -- bytes )
  format "PEM" = [ key _pem-public str>bytes ] [ format "DER" = [ key _der-public ] [ key _jwk-public str>bytes ] if ] if ;

: generate-key-pair ( bytes size:choice{1024|2048|4096}="2048" format:choice{PEM|JWK}="PEM" -- str )
  "A new RSA key pair (Generate RSA Key Pair): size bits (1024, 2048 or 4096), public exponent 65537, two probable primes of size/2 bits with their top two bits set (so the modulus has exactly size bits), found by trial division by the primes below 65536 and 13 rounds of Miller-Rabin (base 2 and 12 random bases; far beyond the 2^-100 error that FIPS 186-5 asks for), and a distance of more than 2^(size/2 - 100) between them. The result is the public key as a PUBLIC KEY (SubjectPublicKeyInfo) PEM block followed by the private key as an RSA PRIVATE KEY (PKCS#1) PEM block, the order and the formats of CyberChef, but with line feeds where CyberChef (node-forge) writes CRLF; with the JWK format, the public key and then the private key as one line of JSON each. The input is ignored. All random bytes come from the host's cryptographic random generator (the word carries the +random effect), so the output differs on every call. The search is random, so the time varies: 1024 bits take about 0.04 s, 2048 bits 0.25 s and 4096 bits 1.8 s on average (the slowest of twelve runs was 3.4 s), far inside the 30 second limit; a search that does not end after 200 pools of candidates stops with an error." doc
  "Public Key" category
  drop size str>int _generate format _key-pair-text ;

: sign ( data:bytes key:str password:str="" digest:choice{SHA-1|MD5|SHA-256|SHA-384|SHA-512}="SHA-1" scheme:choice{RSASSA-PKCS1-V1_5|RSASSA-PSS}="RSASSA-PKCS1-V1_5" salt-length:int=-1 -- bytes )
  "The RSA signature (RSA Sign) of the input bytes under a PEM private key, as raw bytes of the length of the modulus. The digest is hashed first (SHA-1 by default, as in CyberChef). The scheme is RSASSA-PKCS1-v1_5 (what CyberChef does, and deterministic) or RSASSA-PSS (random salt of salt-length bytes, -1 for the digest length; MGF1 with the same digest). The key is a PEM block of kind RSA PRIVATE KEY (PKCS#1), PRIVATE KEY (PKCS#8) or ENCRYPTED PRIVATE KEY, or the legacy encrypted PEM with Proc-Type and DEK-Info headers; the password decrypts an encrypted key (AES-CBC, Triple DES or DES, PBKDF2 with SHA-1 or SHA-2, or OpenSSL's MD5 key derivation). Of several blocks the first private key is used. A key that is not RSA (an EC key) or has no PEM block, a missing password and a key too small for the digest are E_RANGE; a damaged key or a wrong password is E_COERCE. PSS signatures differ on every call (the word carries +random)." doc
  "Public Key" category
  data key password _private-key digest scheme salt-length _sign ;

: verify ( data:bytes key:str message:key{utf8|hex|latin1|base64}="" digest:choice{SHA-1|MD5|SHA-256|SHA-384|SHA-512}="SHA-1" scheme:choice{RSASSA-PKCS1-V1_5|RSASSA-PSS}="RSASSA-PKCS1-V1_5" salt-length:int=-1 -- str )
  "Verifies the input, a signature (RSA Verify), against the message and a PEM public key (PUBLIC KEY or RSA PUBLIC KEY block; the first one is used). The message is a parameter, as in CyberChef (UTF-8 text by default; hex, Latin-1 or Base64 for bytes), hashed with the digest. The result is the text Verified OK or Verification failure; any fault in the signature (wrong length, value, padding or digest) is a failed verification and not an error. With RSASSA-PSS, salt-length is the salt size the signature must have (-1 accepts any size). A key that is not an RSA public key is E_RANGE, a damaged one E_COERCE." doc
  "Public Key" category
  data key _public-key message digest scheme salt-length _verify
  [ "Verified OK" ] [ "Verification failure" ] if ;

: encrypt ( data:bytes key:str scheme:choice{RSA-OAEP|RSAES-PKCS1-V1_5|RAW}="RSA-OAEP" digest:choice{SHA-1|MD5|SHA-256|SHA-384|SHA-512}="SHA-1" -- bytes )
  "RSA encryption (RSA Encrypt) of the input bytes under a PEM public key (PUBLIC KEY or RSA PUBLIC KEY block; the first one is used), as raw bytes of the length of the modulus. RSA-OAEP (the default, as in CyberChef) uses the digest for the label hash and MGF1, with an empty label: a message may have at most key bytes - 2 x digest - 2 bytes. RSAES-PKCS1-V1_5 allows key bytes - 11. RAW is textbook RSA with no padding: the message as a big-endian number must be below the modulus. A message that is too long, or a key that is not an RSA public key, is E_RANGE. OAEP and v1.5 use random bytes (the word carries +random), so the output differs on every call; RAW is deterministic." doc
  "Public Key" category
  data key _public-key scheme digest _encrypt ;

: decrypt ( data:bytes key:str password:str="" scheme:choice{RSA-OAEP|RSAES-PKCS1-V1_5|RAW}="RSA-OAEP" digest:choice{SHA-1|MD5|SHA-256|SHA-384|SHA-512}="SHA-1" -- bytes )
  "RSA decryption (RSA Decrypt) of the input bytes under a PEM private key (see RSA Sign for the key forms and the password). The input must be as long as the modulus. Every failure of the decryption itself (length, value, padding, hash) is the one E_COERCE message decryption error, so the error is no oracle for the padding. RAW returns the modulus-length block with its leading zero bytes. A key that is not an RSA private key or lacks a password is E_RANGE, a damaged key or a wrong password E_COERCE." doc
  "Public Key" category
  data key password _private-key scheme digest _decrypt ;

: public-key ( key:str format:choice{PEM|DER|JWK}="PEM" password:str="" -- bytes )
  "The public key of a PEM private key (Public Key from Private Key): as a PUBLIC KEY (SubjectPublicKeyInfo) PEM block, as its DER bytes, or as a JWK (kty, n and e). The key may be RSA PRIVATE KEY (PKCS#1), PRIVATE KEY (PKCS#8) or encrypted, with the password. Only RSA keys are supported so far; an elliptic curve key is E_RANGE (CyberChef reads those too)." doc
  "Public Key" category
  key password _private-key format _public-out ;

META: generate-key-pair
  param size "The key size in bits: 1024, 2048 or 4096." ;
  param format "PEM: the public key (PUBLIC KEY) then the private key (RSA PRIVATE KEY); JWK: one line of JSON each." ;
  see-also rsa:public-key rsa:sign rsa:encrypt pem:to-hex prime:generate ;
;

META: sign
  param key "The PEM private key: RSA PRIVATE KEY, PRIVATE KEY, ENCRYPTED PRIVATE KEY or an old-style encrypted PEM." ;
  param password "The password of an encrypted key (empty when the key is not encrypted)." ;
  param digest "The message digest: SHA-1, MD5, SHA-256, SHA-384 or SHA-512." ;
  param scheme "RSASSA-PKCS1-V1_5 (deterministic, CyberChef's) or RSASSA-PSS (randomised)." ;
  param salt-length "RSASSA-PSS only: the salt size in bytes; -1 is the digest length." ;
  see-also rsa:verify rsa:decrypt rsa:generate-key-pair ;
;

META: verify
  param key "The PEM public key: PUBLIC KEY or RSA PUBLIC KEY." ;
  param message "The message that was signed (UTF-8 text unless the encoding says otherwise)." ;
  param digest "The message digest: SHA-1, MD5, SHA-256, SHA-384 or SHA-512." ;
  param scheme "RSASSA-PKCS1-V1_5 or RSASSA-PSS." ;
  param salt-length "RSASSA-PSS only: the salt size the signature must have; -1 accepts any." ;
  see-also rsa:sign rsa:encrypt ;
;

META: encrypt
  param key "The PEM public key: PUBLIC KEY or RSA PUBLIC KEY." ;
  param scheme "RSA-OAEP, RSAES-PKCS1-V1_5 or RAW (no padding)." ;
  param digest "RSA-OAEP only: the digest of the label hash and of MGF1." ;
  see-also rsa:decrypt rsa:verify ;
;

META: decrypt
  param key "The PEM private key: RSA PRIVATE KEY, PRIVATE KEY, ENCRYPTED PRIVATE KEY or an old-style encrypted PEM." ;
  param password "The password of an encrypted key (empty when the key is not encrypted)." ;
  param scheme "RSA-OAEP, RSAES-PKCS1-V1_5 or RAW (no padding)." ;
  param digest "RSA-OAEP only: the digest of the label hash and of MGF1." ;
  see-also rsa:encrypt rsa:sign ;
;

META: public-key
  param format "PEM (PUBLIC KEY), DER (the bytes) or JWK." ;
  param password "The password of an encrypted key (empty when the key is not encrypted)." ;
  see-also rsa:generate-key-pair pem:to-hex asn1-dump:parse ;
;
