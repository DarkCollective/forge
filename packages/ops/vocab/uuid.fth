\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ uuid: UUIDs (RFC 9562, which replaces RFC 4122): generate versions 1, 3, 4, 5, 6 and 7 and the nil and max UUIDs, and
\ analyse a UUID. Written in FL over `random` (+random), `clock` (+time), md5 and sha1. The builders (_v1, _v6, _v7 and
\ _name-based) take the time and the random bytes as arguments, so the tests can pin them against the examples of the
\ RFC; `generate` only supplies them. A UUID is 16 bytes; the text form is lower-case hex in groups of 8-4-4-4-12.
IN: uuid

USING: random clock md5 sha1 ;

\ ---- text ----

\ The 32 hex digits in groups of 8-4-4-4-12.
: _dashes ( h:str -- str )
  h 0 8 slice "-" cat h 8 12 slice cat "-" cat h 12 16 slice cat "-" cat h 16 20 slice cat "-" cat h 20 32 slice cat ;

: _text ( b:bytes -- str )
  b bytes>hex _dashes ;

\ The text without its surrounding white space, in lower case, without a urn:uuid: prefix or braces, and without hyphens.
: _unwrap ( s:str -- str )
  s "urn:uuid:" starts-with? [ s 9 s len slice ] [ s ] if ;

: _unbrace ( s:str -- str )
  s "{" starts-with? s "}" ends-with? and [ s 1 s len 1 - slice ] [ s ] if ;

: _flat ( s:str -- str )
  s [ space? ] trim-start [ space? ] trim-end lower _unwrap _unbrace "-" split "" join ;

\ The 16 bytes of the text of a UUID (hyphens, braces, a urn:uuid: prefix and either case are accepted); E_COERCE
\ for anything else.
: _parse ( s:str -- bytes )
  s _flat dup len 32 = over str>codes [ hex-digit? ] all? and
  [ hex>bytes ] [ drop "not a UUID: it needs 32 hex digits (hyphens, braces and a urn:uuid: prefix are allowed)" fail-coerce ] if ;

\ ---- the fields ----

\ Version ver in the high nibble of byte 6 and the RFC variant (10) in the top bits of byte 8.
: _stamp ( b:bytes ver:int -- bytes )
  [
    b 0 6 slice emit-all
    b 6 nth 15 band ver 4 shl bor emit
    b 7 nth emit
    b 8 nth 63 band 128 bor emit
    b 9 16 slice emit-all
  ] collect-bytes ;

\ The random node of a version 1 or 6 UUID has the multicast bit (the low bit of its first byte) set (RFC 9562, 6.10);
\ rnd is the clock sequence (2 bytes) and the node (6 bytes).
: _node-bit ( rnd:bytes -- bytes )
  [
    rnd 0 2 slice emit-all
    rnd 2 nth 1 bor emit
    rnd 3 rnd len slice emit-all
  ] collect-bytes ;

\ 100-nanosecond ticks since 1582-10-15 (the Gregorian epoch) of a Unix time in milliseconds.
: _gregorian ( ms:int -- int )
  ms 10000 * 122192928000000000 + ;

: _v1 ( ticks:int rnd:bytes -- bytes )
  ticks 4 int>be-bytes
  ticks 32 shr 2 int>be-bytes cat
  ticks 48 shr 4095 band 2 int>be-bytes cat
  rnd _node-bit cat 1 _stamp ;

: _v6 ( ticks:int rnd:bytes -- bytes )
  ticks 28 shr 4 int>be-bytes
  ticks 12 shr 2 int>be-bytes cat
  ticks 4095 band 2 int>be-bytes cat
  rnd _node-bit cat 6 _stamp ;

\ ms is the Unix time in milliseconds (48 bits); rnd is 10 random bytes.
: _v7 ( ms:int rnd:bytes -- bytes )
  ms 6 int>be-bytes rnd cat 7 _stamp ;

\ Version 3 (MD5) or 5 (SHA-1) of the namespace bytes followed by the name bytes.
: _name-based ( ns:bytes name:bytes ver:int -- bytes )
  ver 3 = [ ns name cat md5:digest ] [ ns name cat sha1:digest 0 16 slice ] if ver _stamp ;

\ The namespace as 16 bytes: dns, url, oid or x500 (the UUIDs of RFC 9562, appendix B), or any UUID text.
: _namespace ( ns:str -- bytes )
  ns lower {
    "dns" [ "6ba7b8109dad11d180b400c04fd430c8" hex>bytes ]
    "url" [ "6ba7b8119dad11d180b400c04fd430c8" hex>bytes ]
    "oid" [ "6ba7b8129dad11d180b400c04fd430c8" hex>bytes ]
    "x500" [ "6ba7b8149dad11d180b400c04fd430c8" hex>bytes ]
    [ [ ns _parse ] [ drop "the namespace must be dns, url, oid, x500 or a UUID" fail-range ] try ]
  } case ;

: _version-bytes ( nm:bytes version:str namespace:str -- bytes )
  version {
    "nil" [ 16 zero-bytes ]
    "max" [ 16 zero-bytes #[ ff ] bxor ]
    "v4" [ 16 random:bytes-of 4 _stamp ]
    "v1" [ clock:now-ms _gregorian 8 random:bytes-of _v1 ]
    "v6" [ clock:now-ms _gregorian 8 random:bytes-of _v6 ]
    "v7" [ clock:now-ms 10 random:bytes-of _v7 ]
    [ namespace _namespace nm version "v3" = [ 3 ] [ 5 ] if _name-based ]
  } case ;

: generate ( bytes version:choice{v1|v3|v4|v5|v6|v7|nil|max}="v4" namespace:str="1b671a64-40d5-491e-99b0-da01ff1f3341" name:str="" -- str )
  "Generate a UUID (RFC 9562) as lower-case text in the form 8-4-4-4-12. v4: 122 random bits. v1: the time in 100 ns ticks since 1582-10-15 (the clock counts milliseconds, so the finer digits are zero), a random 14-bit clock sequence and a random node with the multicast bit set. v6: the same fields with the time most significant first, so UUIDs sort by time. v7: the Unix time in milliseconds and 74 random bits. v3 (MD5) and v5 (SHA-1): the namespace and the name, no randomness, the same UUID every time. nil is all zero bits and max all one bits. The random bits come from the host's cryptographic random generator (never Math.random) and the time from the host clock, so the output of v1, v4, v6 and v7 differs on every call (the word carries the +random and +time effects). The input is ignored except for v3 and v5, where it is the name when the name parameter is empty (a name parameter wins). The namespace and the name are used only by v3 and v5; the namespace is a UUID as text (1b671a64-40d5-491e-99b0-da01ff1f3341 if you give none) or dns, url, oid or x500. A namespace that is not dns, url, oid, x500 or a UUID is E_RANGE." doc
  "Generators" category
  name len 0 > [ drop name str>bytes ] when
  version namespace _version-bytes _text ;

META: generate
  use-when "You need an ID for a record, or one derived from a name so it is always the same, and want a UUID: random (v4), or from a namespace and name (v3 or v5)." ;
  param version "v1: Gregorian time. v3: MD5 of a namespace and a name. v4: random. v5: SHA-1 of a namespace and a name. v6: Gregorian time, sortable. v7: Unix time, sortable. nil: all zeros. max: all ones." ;
  param namespace "For v3 and v5: any UUID as text (the default is 1b671a64-40d5-491e-99b0-da01ff1f3341), or dns, url, oid, x500 (the namespaces of RFC 9562)." ;
  param name "For v3 and v5: the name to hash, as UTF-8 text; empty uses the input." ;
  see-also uuid:analyse ;
  link "https://www.rfc-editor.org/rfc/rfc9562" "RFC 9562: Universally Unique IDentifiers" ;
  link "https://en.wikipedia.org/wiki/Universally_unique_identifier" "Universally unique identifier on Wikipedia" ;
;

\ ---- analyse ----

\ The Unix time in 100 ns ticks as UTC text with seven fractional digits.
: _iso-ticks ( u:int -- str )
  u 10000 div util:iso-from-ms u 10000 mod 4 util:zero-pad cat "Z" cat ;

\ The tick count of a version 1 UUID (time_low, time_mid, time_hi) and of a version 6 UUID (time_high, time_mid,
\ time_low), minus the Gregorian offset: Unix 100 ns ticks.
: _ticks1 ( b:bytes -- int )
  b 0 4 util:be-int b 4 2 util:be-int 32 shl + b 6 2 util:be-int 4095 band 48 shl + 122192928000000000 - ;

: _ticks6 ( b:bytes -- int )
  b 0 4 util:be-int 28 shl b 4 2 util:be-int 12 shl + b 6 2 util:be-int 4095 band + 122192928000000000 - ;

: _version-name ( v:int -- str )
  v {
    1 [ "Gregorian time and node" ]
    2 [ "DCE security" ]
    3 [ "MD5 of a namespace and a name" ]
    4 [ "random" ]
    5 [ "SHA-1 of a namespace and a name" ]
    6 [ "Gregorian time, sortable" ]
    7 [ "Unix time and random" ]
    8 [ "custom" ]
    [ "unknown" ]
  } case ;

\ The variant from the top bits of byte 8.
: _variant-name ( b:int -- str )
  {
    [ b 128 band 0 = ] [ "NCS (reserved)" ]
    [ b 192 band 128 = ] [ "RFC 9562 (RFC 4122)" ]
    [ b 224 band 192 = ] [ "Microsoft (reserved)" ]
    [ "reserved for the future" ]
  } cond ;

\ The timestamp line of a UUID of version v, or nothing.
: _time-lines ( b:bytes v:int -- list )
  v {
    1 [ { } "Timestamp: " b _ticks1 _iso-ticks cat append ]
    6 [ { } "Timestamp: " b _ticks6 _iso-ticks cat append ]
    7 [ { } "Timestamp: " b 0 6 util:be-int util:iso-from-ms cat "Z" cat append ]
    [ { } ]
  } case ;

: _rfc-report ( b:bytes v:int -- str )
  { } "Version: " v int>str cat " (" cat v _version-name cat ")" cat append
  "Variant: " b 8 nth _variant-name cat append
  b v _time-lines cat "\n" join ;

: _report ( b:bytes -- str )
  b bytes>hex :> h
  {
    [ h "00000000000000000000000000000000" = ] [ "Nil UUID (all bits zero)" ]
    [ h "ffffffffffffffffffffffffffffffff" = ] [ "Max UUID (all bits one)" ]
    [ b 8 nth 192 band 128 = ] [ b b 6 nth 4 shr _rfc-report ]
    [ "Variant: " b 8 nth _variant-name cat ]
  } cond ;

: analyse ( text:str -- str )
  "Analyse a UUID given as text (hyphens, braces, a urn:uuid: prefix and either case are accepted; anything but 32 hex digits is E_COERCE). The report has one line per fact: the version and what it means, the variant and, for versions 1, 6 and 7, the timestamp in UTC (version 1 and 6 count 100 ns ticks, so seven fractional digits; version 7 counts milliseconds, so three). The nil and max UUIDs are reported as such, and a UUID of another variant than RFC 9562 only gets its variant: its version bits mean nothing there." doc
  "Analysis" category
  text _parse _report ;

META: analyse
  use-when "You have a UUID from a log, a database or an API and want its version and variant, and the creation time when it is a version 1, 6 or 7 UUID." ;
  see-also uuid:generate ;
  link "https://www.rfc-editor.org/rfc/rfc9562" "RFC 9562: Universally Unique IDentifiers" ;
  link "https://en.wikipedia.org/wiki/Universally_unique_identifier" "Universally unique identifier on Wikipedia" ;
;
