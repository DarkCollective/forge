\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ fernet: Fernet tokens (github.com/fernet/spec), written in FL over aes:encrypt, aes:decrypt, hmac:digest and
\ base64. A token is url-safe base64 (with padding) of: version 0x80, an 8-byte big-endian Unix time, a 16-byte IV,
\ the AES-128-CBC ciphertext with PKCS#7 padding, and an HMAC-SHA256 over everything before it. The 32-byte key is
\ the signing key (its first 16 bytes) then the encryption key (its last 16). The clock (clock:now-s, +time) and the random
\ IV (16 random:bytes-of, +random) are the shared words. _seal and _open take the IV and the time as arguments,
\ so tests pin them; encrypt and decrypt just supply them.
IN: fernet

USING: aes hmac base64 random clock ;

\ The 32 raw key bytes. A key that is 32 bytes long is taken as it is; otherwise it is read as the url-safe base64
\ text of the key (the form Fernet libraries print, 43 or 44 characters), which must decode to 32 bytes.
: _check-key-len ( k:bytes -- bytes )
  k len 32 <> [ "the Fernet key must be 32 bytes, or their url-safe base64 text" raise:range ] when k ;

: _raw-key ( key:bytes -- bytes )
  key len 32 =
  [ key ]
  [ key len 43 < key len 44 > or [ "the Fernet key must be 32 bytes, or their url-safe base64 text" raise:range ] when
    key util:b64url-decode _check-key-len ] if ;

\ The signing key (first 16 bytes) and the encryption key (last 16 bytes).
: _signing ( key:bytes -- bytes )
  key _raw-key 0 16 slice ;

: _encryption ( key:bytes -- bytes )
  key _raw-key 16 32 slice ;

\ The payload with its HMAC appended, as url-safe base64 text with padding.
: _finish ( payload:bytes key:bytes -- bytes )
  payload dup "sha256" key _signing hmac:digest cat true util:b64url-encode ;

\ The token for data with the given IV (16 bytes) and Unix time.
: _seal ( data:bytes key:bytes iv:bytes ts:int -- bytes )
  #[ 80 ] ts 8 util:int>be-bytes cat iv cat
  data key _encryption iv "CBC" "pkcs7" #[ ] aes:encrypt cat
  key _finish ;

\ True when the HMAC at the end of the raw token matches the rest of it.
: _mac-ok? ( raw:bytes key:bytes -- bool )
  raw 0 raw len 32 - slice "sha256" key _signing hmac:digest
  raw raw len 32 - raw len slice = ;

\ The age checks of the spec, only when a TTL is set: the token must not be older than ttl seconds, nor more than
\ 60 seconds in the future.
: _age-check ( ts:int ttl:int now:int -- )
  ttl 0 > [
    ts ttl + now < [ "the token has expired (older than the TTL)" raise:coerce ] when
    ts now 60 + > [ "the token's time is too far in the future (clock skew over 60 s)" raise:coerce ] when
  ] when ;

\ The plaintext of an already base64-decoded token.
: _open-raw ( raw:bytes key:bytes ttl:int now:int -- bytes )
  raw len 73 < [ "the token is too short to be a Fernet token" raise:coerce ] when
  raw 0 nth 128 <> [ "the token's version byte is not 0x80" raise:coerce ] when
  raw key _mac-ok? not [ "the token's HMAC does not verify (wrong key, or the token was altered)" raise:coerce ] when
  raw 1 9 slice 256 util:digits>int ttl now _age-check
  raw 25 raw len 32 - slice key _encryption raw 9 25 slice "CBC" "pkcs7" #[ ] aes:decrypt ;

\ The plaintext of a token (url-safe base64 text) at the given time.
: _open ( token:bytes key:bytes ttl:int now:int -- bytes )
  ttl 0 < [ "the TTL cannot be negative" raise:range ] when
  token util:b64url-decode key ttl now _open-raw ;

: encrypt ( bytes key:key{utf8|hex|latin1|base64} -- bytes )
  "Fernet encryption (github.com/fernet/spec): the token, as url-safe base64 text with padding, of the input. The key is 32 bytes (the signing key, then the encryption key), or their url-safe base64 text as Fernet libraries print it (43 or 44 characters, the CyberChef form); any other length is E_RANGE. The IV is 16 random bytes and the time is the clock, so the output differs on every call (the word carries the +random and +time effects)." doc
  "Encryption" category
  key 16 random:bytes-of clock:now-s _seal ;

: decrypt ( bytes key:key{utf8|hex|latin1|base64} ttl:int=0 -- bytes )
  "Fernet decryption: the plaintext of a token (url-safe base64 text). The HMAC is verified before anything is decrypted; a token that is too short, has another version, fails the HMAC, is not whole blocks or has bad padding is E_COERCE, and so is bad base64. ttl is the maximum age in seconds: 0 (the default, as CyberChef) skips the time checks; above 0 the token must be no older than ttl and no more than 60 seconds in the future (E_COERCE). A negative ttl, or a key of the wrong size, is E_RANGE." doc
  "Encryption" category
  key ttl ttl 0 > [ clock:now-s ] [ 0 ] if _open ;

META: encrypt
  param key "The Fernet key: 32 bytes, or their url-safe base64 text (43 or 44 characters)." ;
  see-also fernet:decrypt aes:encrypt hmac:digest ;
;

META: decrypt
  param key "The Fernet key the token was made with." ;
  param ttl "Maximum token age in seconds; 0 means no time check." ;
  see-also fernet:encrypt aes:decrypt hmac:digest ;
;
