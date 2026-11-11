\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ flask-session: the signed session cookie of Flask, which is itsdangerous's URLSafeTimedSerializer, written in FL
\ over hmac:digest and base64. The cookie is payload.timestamp.signature, each part url-safe base64 without
\ padding. The payload is the session's JSON (compact, one line); the timestamp is the signing time in seconds as
\ the shortest big-endian integer (4 bytes today); the signature is the HMAC of "payload.timestamp" under a derived
\ key, itsdangerous's "hmac" derivation as Flask configures it: HMAC(secret, salt) with the salt "cookie-session".
\ The digest is SHA-1 (Flask's default) or SHA-256. Flask compresses a payload with zlib when that is shorter and
\ marks it with a leading "."; Forge has no decompression yet (it arrives with the compression wave), so decode and
\ verify refuse such a cookie with a clear E_COERCE, and sign never compresses. FL has no JSON parser: the payload
\ is handled as text, exactly as the cookie holds it.
IN: flask-session

USING: hmac base64 clock ;

\ The key must not be empty (CyberChef: "Secret key required").
: _need-key ( key:bytes -- )
  key len 0 = [ "the Flask secret key is empty" raise:range ] when ;

\ The salt, with CyberChef's rule that an empty salt means the default cookie-session.
: _salt ( salt:bytes -- bytes )
  salt len 0 = [ "cookie-session" str>bytes ] [ salt ] if ;

\ The cookie signed at the Unix time ts (above 0) for a payload (JSON text).
: _sign ( payload:bytes key:bytes salt:bytes alg:str ts:int -- bytes )
  key _need-key
  ts 1 < [ "the timestamp must be a positive Unix time in seconds" raise:range ] when
  payload false util:b64url-encode "." str>bytes cat
  ts util:int>bytes false util:b64url-encode cat
  dup alg salt _salt alg key hmac:digest hmac:digest
  false util:b64url-encode "." str>bytes swap cat cat ;

\ The three parts of a cookie. Surrounding white space is ignored. A compressed payload (leading dot) makes four.
: _parts ( token:bytes -- list )
  token bytes>str util:strip-space "." split
  dup len 4 = [ dup 0 nth len 0 = [ "this Flask cookie has a zlib-compressed payload (it starts with a dot); decompression comes with the compression vocabulary, so it cannot be read yet" raise:coerce ] when ] when
  dup len 3 <> [ "a Flask session cookie has three parts: payload.timestamp.signature" raise:coerce ] when ;

\ The payload text of the cookie parts.
: _payload ( parts:list -- str )
  parts 0 nth str>bytes util:b64url-decode bytes>str ;

\ The signing time of the cookie parts.
: _time ( parts:list -- int )
  parts 1 nth str>bytes util:b64url-decode 256 util:digits>int ;

\ The cookie parts as JSON text: {"payload":P,"timestamp":T} with the time, or just P without it.
: _decode ( parts:list view:bool -- bytes )
  view
  [ "{\"payload\":" parts _payload cat ",\"timestamp\":" cat parts _time int>str cat "}" cat str>bytes ]
  [ parts _payload str>bytes ] if ;

\ E_COERCE unless the signature part is the HMAC of the first two parts under the derived key.
: _check-sig ( parts:list key:bytes salt:bytes alg:str -- )
  key _need-key
  parts 0 nth "." cat parts 1 nth cat str>bytes alg salt _salt alg key hmac:digest hmac:digest
  parts 2 nth str>bytes util:b64url-decode <>
  [ "the Flask signature does not verify (wrong key, salt or algorithm, or the cookie was altered)" raise:coerce ] when ;

\ {"valid":true,"payload":P} with ,"timestamp":T before the brace when view is set.
: _verify ( parts:list key:bytes salt:bytes alg:str view:bool -- bytes )
  parts key salt alg _check-sig
  "{\"valid\":true,\"payload\":" parts _payload cat
  view [ ",\"timestamp\":" parts _time int>str cat cat ] when
  "}" cat str>bytes ;

: decode ( bytes timestamp:bool=false -- bytes )
  "Reads the payload of a Flask session cookie (itsdangerous) without checking the signature: the session JSON as the cookie holds it. With timestamp, the result is {\"payload\":...,\"timestamp\":N} where N is the signing time in Unix seconds. The cookie must have three dot-separated url-safe base64 parts (E_COERCE otherwise). A cookie whose payload Flask compressed with zlib (it starts with a dot) is E_COERCE for now: decompression arrives with the compression vocabulary. The JSON is not parsed or re-formatted." doc
  "Encryption" category
  _parts timestamp _decode ;

: verify ( bytes key:key{utf8|hex|latin1|base64} salt:key{utf8|hex|latin1|base64}="cookie-session" algorithm:choice{sha1|sha256}="sha1" timestamp:bool=true -- bytes )
  "Verifies a Flask session cookie (itsdangerous URLSafeTimedSerializer with the 'hmac' key derivation): the HMAC of payload.timestamp, under HMAC(key, salt), with SHA-1 or SHA-256, must equal the signature. The result is {\"valid\":true,\"payload\":...} with ,\"timestamp\":N when timestamp is set, as CyberChef. A signature that does not verify, or a malformed cookie, is E_COERCE (CyberChef: Invalid signature); an empty key is E_RANGE; an empty salt means cookie-session, as CyberChef. A zlib-compressed payload (leading dot) is E_COERCE for now: decompression arrives with the compression vocabulary. The age of the cookie is not checked." doc
  "Encryption" category
  _parts key salt algorithm timestamp _verify ;

: sign ( bytes key:key{utf8|hex|latin1|base64} salt:key{utf8|hex|latin1|base64}="cookie-session" algorithm:choice{sha1|sha256}="sha1" timestamp:int=0 -- bytes )
  "Signs a session JSON as a Flask session cookie (itsdangerous URLSafeTimedSerializer, 'hmac' key derivation, salt cookie-session by default): payload.timestamp.signature, url-safe base64 without padding. The input is the JSON text, used as given (Flask writes it compact, with no spaces). The time is the clock unless timestamp (Unix seconds, above 0) pins it; 0 means now, so the word carries the +time effect. The payload is never compressed. An empty key or a negative timestamp is E_RANGE; an empty salt means cookie-session, as CyberChef." doc
  "Encryption" category
  key salt algorithm timestamp dup 0 = [ drop clock:now-s ] when _sign ;

META: decode
  param timestamp "Also return the signing time (Unix seconds): {\"payload\":...,\"timestamp\":N}." ;
  see-also flask-session:verify flask-session:sign base64:decode ;
;

META: verify
  param key "The Flask SECRET_KEY, any length but not empty." ;
  param salt "The salt of the serializer; Flask's session uses cookie-session. Empty means the default." ;
  param algorithm "The digest of the signature: sha1 (Flask's default) or sha256." ;
  param timestamp "Include the signing time in the result." ;
  see-also flask-session:sign flask-session:decode hmac:digest ;
;

META: sign
  param key "The Flask SECRET_KEY, any length but not empty." ;
  param salt "The salt of the serializer; Flask's session uses cookie-session. Empty means the default." ;
  param algorithm "The digest of the signature: sha1 (Flask's default) or sha256." ;
  param timestamp "The signing time in Unix seconds; 0 (the default) uses the clock." ;
  see-also flask-session:verify flask-session:decode hmac:digest ;
;
