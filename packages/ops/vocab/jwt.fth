\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ jwt: JSON Web Tokens in the compact form (RFC 7519 over RFC 7515), written in FL over hmac:digest and base64.
\ Only the HMAC algorithms HS256, HS384 and HS512 are signed and verified (RFC 7518 section 3.2); the public-key
\ ones (RS, ES, PS) belong to the public-key wave, and "none" (an unsigned token) is never signed or accepted.
\ FL has no JSON parser, so the JSON is handled as text: the header and payload are taken and returned exactly as
\ the token holds them (so the signed bytes are never re-serialised), they must look like JSON objects, and the
\ header's alg is found as the one "alg" key (a header with that text twice is refused as ambiguous). The
\ expiry claims (exp, nbf) are not checked: that needs a JSON parser and a clock; verify is a signature check.
IN: jwt

USING: hmac base64 ;

\ The text without its leading and trailing ASCII white space.
: _trim ( s:str -- str )
  s [ util:space? ] util:trim-start [ util:space? ] util:trim-end ;

\ The HMAC hash for an algorithm name. Anything else is E_RANGE, with a reason for the usual suspects.
: _hash ( alg:str -- str )
  alg "HS256" = [ "sha256" ] [
  alg "HS384" = [ "sha384" ] [
  alg "HS512" = [ "sha512" ] [
  alg "none" = [ "the JWT algorithm none (an unsigned token) is never signed or accepted" raise:range "" ] [
  "the JWT algorithm '" alg 0 alg len 24 min slice cat "' is not supported: only HS256, HS384 and HS512 (RS, ES and PS are public-key algorithms and come later)" cat raise:range ""
  ] if ] if ] if ] if ;

\ E_COERCE unless the text is a JSON object by its first and last characters. what names the part.
: _check-object ( text:str what:str -- )
  text _trim "{" util:starts-with? text _trim "}" util:ends-with? and not
  [ "the JWT " what cat " is not a JSON object" cat raise:coerce ] when ;

\ The key must not be empty.
: _need-key ( key:bytes -- )
  key len 0 = [ "the JWT key is empty" raise:range ] when ;

\ The dot-separated parts of a compact token. Surrounding white space is ignored; it must be three parts.
: _parts ( token:bytes -- list )
  token bytes>str util:strip-space "." split
  dup len 5 = [ "this looks like an encrypted JWT (five parts); only signed tokens (three parts) are read" raise:coerce ] when
  dup len 3 <> [ "a JWT has three parts separated by dots" raise:coerce ] when ;

\ Part i of the token decoded from url-safe base64 to text, which must be a JSON object.
: _part ( parts:list i:int what:str -- str )
  parts i nth str>bytes util:b64url-decode bytes>str
  dup what _check-object ;

\ The alg of a header: the value of the one "alg" key.
: _alg ( header:str -- str )
  header "\"alg\"" split
  dup len 2 <> [ "the JWT header must have exactly one alg" raise:coerce ] when
  1 nth "\"" split
  dup len 3 < [ "the JWT header's alg is not a string" raise:coerce ] when
  dup 0 nth util:strip-space ":" <> [ "the JWT header's alg is not a string" raise:coerce ] when
  1 nth ;

\ The algorithm of a token, checked: it must be an HMAC one, and be want unless want is auto.
: _pick ( alg:str want:str -- str )
  alg _hash drop
  want "auto" <> alg want <> and [ "the token's alg is not the expected one" raise:coerce ] when
  alg ;

\ E_COERCE unless the signature (part 3) is the HMAC of the first two parts.
: _check-sig ( parts:list key:bytes alg:str -- )
  parts 0 nth "." cat parts 1 nth cat str>bytes alg _hash key hmac:digest
  parts 2 nth str>bytes util:b64url-decode <>
  [ "the JWT signature does not verify (wrong key, or the token was altered)" raise:coerce ] when ;

\ The payload of a token whose signature checks out.
: _verify ( parts:list key:bytes want:str -- bytes )
  key _need-key
  parts key parts 0 "header" _part _alg want _pick _check-sig
  parts 1 "payload" _part str>bytes ;

\ The extra header members: the text between the braces of a JSON object, or empty.
: _extra ( extra:str -- str )
  extra _trim dup len 0 =
  [ drop "" ]
  [ dup "header" _check-object dup 1 swap len 1 - slice _trim ] if ;

\ The header JSON: alg first, typ JWT unless the extra members set it, then the extra members.
: _compose ( alg:str inner:str -- str )
  inner "\"alg\"" split len 1 > [ "the extra header must not set alg; it comes from the alg parameter" raise:range ] when
  "{\"alg\":\"" alg cat "\"" cat
  inner "\"typ\"" split len 1 > [ "" ] [ ",\"typ\":\"JWT\"" ] if cat
  inner len 0 = [ "" ] [ "," inner cat ] if cat
  "}" cat ;

\ The compact token for a payload under a header text (the pieces of sign, which also lets a test pin the header).
: _sign ( payload:bytes key:bytes alg:str header:str -- bytes )
  key _need-key
  payload bytes>str "payload" _check-object
  header str>bytes false util:b64url-encode "." str>bytes cat payload false util:b64url-encode cat
  dup alg _hash key hmac:digest false util:b64url-encode
  "." str>bytes swap cat cat ;

: decode ( bytes part:choice{payload|header}="payload" -- bytes )
  "Reads a compact JWT without checking its signature (use jwt:verify for that): the payload, or the header, as the JSON text the token holds, exactly as written (not re-formatted). The token must have three dot-separated parts (an encrypted JWT with five is E_COERCE), url-safe base64 parts, and the part read must be a JSON object by its first and last character (E_COERCE otherwise: Forge has no JSON parser, so the text is not checked further)." doc
  "Encryption" category
  _parts part "header" = [ 0 "header" _part ] [ 1 "payload" _part ] if str>bytes ;

: verify ( bytes key:key{utf8|hex|latin1|base64} alg:choice{auto|HS256|HS384|HS512}="auto" -- bytes )
  "Verifies a compact JWT signed with an HMAC (HS256, HS384 or HS512) under the key, and returns its payload as the JSON text the token holds. A signature that does not verify, a malformed token, or an alg other than the expected one is E_COERCE; an alg that is none (never accepted) or is not an HMAC one (RS, ES, PS: public-key algorithms, a later wave) is E_RANGE, and so is an empty key. alg auto trusts the token's own header to choose among the three HMAC algorithms (safe here, since only a shared secret is accepted); naming one pins it. This is a signature check only: the exp and nbf claims are not examined." doc
  "Encryption" category
  _parts key alg _verify ;

: sign ( bytes key:key{utf8|hex|latin1|base64} alg:choice{HS256|HS384|HS512}="HS256" header:str="{}" -- bytes )
  "Signs the input, a JSON object, as a compact JWT with an HMAC (HS256, HS384 or HS512) under the key. The payload text is signed exactly as given. The header is {\"alg\":...,\"typ\":\"JWT\"} followed by the members of the header parameter, a JSON object (typ in it replaces the default; alg in it is E_RANGE). An empty key is E_RANGE and an input that is not a JSON object by its first and last character is E_COERCE. Unsigned (none) tokens and the public-key algorithms are not offered." doc
  "Encryption" category
  key alg alg header _extra _compose _sign ;

META: decode
  use-when "You have a token of three dot-separated parts that starts with eyJ and want to read its claims or header. This does not prove the token is genuine." ;
  param part "payload: the claims; header: the JOSE header." ;
  see-also jwt:verify base64:decode ;
  link "https://www.rfc-editor.org/rfc/rfc7519" "RFC 7519: JSON Web Token" ;
  link "https://www.rfc-editor.org/rfc/rfc7515" "RFC 7515: JSON Web Signature" ;
  link "https://jwt.io/" "jwt.io: token debugger" ;
;

META: verify
  use-when "You have a JWT signed with a shared secret (HS256, HS384 or HS512) and want to check the signature before you trust the claims." ;
  inverse sign ;
  param key "The shared secret, any length but not empty." ;
  param alg "auto: the HMAC algorithm named in the token's header; or pin HS256, HS384 or HS512." ;
  see-also jwt:sign jwt:decode hmac:digest ;
  link "https://www.rfc-editor.org/rfc/rfc7519" "RFC 7519: JSON Web Token" ;
  link "https://www.rfc-editor.org/rfc/rfc7518#section-3.2" "RFC 7518, section 3.2: HMAC signatures" ;
;

META: sign
  use-when "You need a test or hand-made JWT signed with a shared secret (HS256, HS384 or HS512), for example to try an API or to reproduce a token." ;
  param key "The shared secret, any length but not empty." ;
  param alg "The HMAC algorithm: HS256 (SHA-256), HS384 or HS512." ;
  param header "Extra members for the header, as a JSON object. {} (the default) adds none." ;
  see-also jwt:verify jwt:decode hmac:digest ;
  link "https://www.rfc-editor.org/rfc/rfc7519" "RFC 7519: JSON Web Token" ;
  link "https://www.rfc-editor.org/rfc/rfc7518#section-3.2" "RFC 7518, section 3.2: HMAC signatures" ;
;
