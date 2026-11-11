\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ otp: one-time passwords, HOTP (RFC 4226) and TOTP (RFC 6238), written in FL over `hmac:digest` and base32. The secret
\ is the Base32 text that authenticator apps use (the input of the op, as in CyberChef); an empty input makes a random
\ secret from the host CSPRNG (`random`, +random). TOTP reads the clock (`clock`, +time) unless a time is given, so the
\ vectors of RFC 6238 appendix B can be pinned. The output is the otpauth:// URI of the secret and the password, in
\ the form CyberChef prints them.
IN: otp

USING: hmac base32 url random clock ;

\ The secret bytes: the Base32 text of the input (white space and the case are ignored), or size random bytes when
\ the input is empty. A character outside the Base32 alphabet is E_COERCE.
: _secret ( text:str size:int -- bytes )
  text util:strip-space upper dup len 0 =
  [ drop size random:bytes-of ]
  [ str>bytes "standard" base32:decode ] if ;

\ The password from the HMAC: the 31-bit dynamic truncation at the offset in the low nibble of the last byte
\ (RFC 4226 section 5.3), reduced to the number of digits. 10^digits + code starts with a 1 followed by the code padded with
\ zeros to the number of digits.
: _dt ( off:int mac:bytes digits:int -- str )
  10 digits pow dup mac off off 4 + slice 256 util:digits>int 2147483647 band swap mod + int>str 1 digits 1 + slice ;

: _truncate ( mac:bytes digits:int -- str )
  mac mac len 1 - nth 15 band mac digits _dt ;

\ The HOTP value of a secret for a counter (an unsigned 64-bit integer).
: _hotp ( key:bytes counter:int alg:str digits:int -- str )
  counter 0 < counter 1 64 shl >= or [ "the counter must fit in 64 bits" raise:range ] when
  counter 8 util:int>be-bytes alg key hmac:digest digits _truncate ;

\ The otpauth:// URI (key URI format of the Google Authenticator project).
: _uri ( kind:str name:str key:bytes alg:str digits:int extra:str -- str )
  "otpauth://" kind cat "/" cat name str>bytes "component" url:encode cat
  "?secret=" cat key "standard" false base32:encode cat
  "&algorithm=" cat alg upper cat "&digits=" cat digits int>str cat extra cat ;

: _report ( uri:str code:str -- str )
  "URI: " uri cat "\n\nPassword: " cat code cat ;

: _hotp-report ( key:bytes name:str alg:str digits:int counter:int -- str )
  "hotp" name key alg digits "&counter=" counter int>str cat _uri
  key counter alg digits _hotp _report ;

: hotp ( secret:str name:str="Account" algorithm:choice{sha1|sha256|sha512}="sha1" digits:int[1..10]=6 counter:int[0..]=0 key-size:int[1..256]=20 -- str )
  "HOTP (RFC 4226). The input is the secret as Base32 text, as authenticator apps show it (white space and lower case are ignored); an empty input makes a random secret of key-size bytes from the host's cryptographic random generator, so then the output differs on every call (the word carries the +random effect). The result is the otpauth:// URI of the secret and the password for the counter, in the form CyberChef prints: URI: <uri>, a blank line, Password: <digits>. The password has digits decimal digits (1 to 10) from the HMAC-SHA1 (the default, as in the RFC), HMAC-SHA256 or HMAC-SHA512 of the 8-byte counter. A secret that is not Base32 is E_COERCE; a counter of 2 to the power 64 or more is E_RANGE." doc
  "Generators" category
  secret key-size _secret name algorithm digits counter _hotp-report ;

META: hotp
  param name "The label of the account in the URI (percent-encoded there)." ;
  param algorithm "The HMAC hash: sha1 (the RFC and the default of authenticator apps), sha256 or sha512." ;
  param digits "The length of the password, 1 to 10 decimal digits (apps use 6 to 8)." ;
  param counter "The counter value to make the password for." ;
  param key-size "The size in bytes of the random secret made when the input is empty." ;
  see-also otp:totp hmac:digest base32:decode ;
;

\ The Unix time in seconds to use: the given time, or the clock when it is -1.
: _when ( time:int -- int )
  time -1 = [ clock:now-s ] [ time ] if ;

\ The time step number: whole periods since the epoch offset.
: _counter ( t:int epoch:int period:int -- int )
  t epoch < [ "the time is before the epoch offset" raise:range ] when
  t epoch - period div ;

: _totp-report ( key:bytes name:str alg:str digits:int period:int epoch:int time:int -- str )
  "totp" name key alg digits "&period=" period int>str cat _uri
  key time _when epoch period _counter alg digits _hotp _report ;

: totp ( secret:str name:str="Account" algorithm:choice{sha1|sha256|sha512}="sha1" digits:int[1..10]=6 period:int[1..]=30 epoch:int[0..]=0 key-size:int[1..256]=20 time:int[-1..]=-1 -- str )
  "TOTP (RFC 6238). The input is the secret as Base32 text, as authenticator apps show it (white space and lower case are ignored); an empty input makes a random secret of key-size bytes from the host's cryptographic random generator. The password is the HOTP value of the time step number, the whole number of periods (seconds, 30 by default) since the epoch offset (0, the Unix epoch, by default). time is the Unix time in seconds to make the password for; -1 (the default) means now, from the host clock, so the output changes every period (the word carries the +time and +random effects). The result is the otpauth:// URI and the password, in the form CyberChef prints: URI: <uri>, a blank line, Password: <digits>. A secret that is not Base32 is E_COERCE; a time before the epoch offset is E_RANGE." doc
  "Generators" category
  secret key-size _secret name algorithm digits period epoch time _totp-report ;

META: totp
  param name "The label of the account in the URI (percent-encoded there)." ;
  param algorithm "The HMAC hash: sha1 (the RFC and the default of authenticator apps), sha256 or sha512." ;
  param digits "The length of the password, 1 to 10 decimal digits (apps use 6 to 8)." ;
  param period "The length of a time step in seconds." ;
  param epoch "The Unix time in seconds at which counting starts (T0 of the RFC)." ;
  param key-size "The size in bytes of the random secret made when the input is empty." ;
  param time "The Unix time in seconds to make the password for, or -1 for the current time." ;
  see-also otp:hotp hmac:digest base32:decode ;
;
