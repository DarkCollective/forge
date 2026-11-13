\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ fingerprint: the TLS client and server fingerprints of CyberChef's Networking group: JA3 Fingerprint, JA3S
\ Fingerprint, JA4 Fingerprint and JA4Server Fingerprint. JA3 and JA3S are Salesforce's (MD5 of a text built from the
\ hello; GREASE values of RFC 8701 left out of the lists of the client); JA4 and JA4S are FoxIO's (a readable part and
\ two truncated SHA-256 hashes). All four read the hello with the shared TLS words of the packets vocabulary
\ (packets:tls-hellos), so the hello is parsed and checked in one place; only the rendering is here. FL only, no
\ primitive: the hello has a few dozen numbers and the hashes are the md5 and sha2 words.
IN: fingerprint

USING: packets md5 sha2 hex base64 list ;

\ ---- the input ----

\ TLS records, as the TLS words want them: bytes that start with a bare ClientHello (1) or ServerHello (2) handshake
\ message (what a QUIC CRYPTO frame holds) get a record header in front; anything else is left to be read as records.
: _records ( b:bytes -- bytes )
  b len 0 > [ b 0 nth dup 1 = swap 2 = or ] [ false ] if
  [ b len 18432 > [ "the handshake message is " b len int>str cat " bytes, above the 18432 a TLS record may hold" cat raise:coerce ] when
    #[ 16 03 01 ] b len 2 util:int>be-bytes cat b cat ]
  [ b ] if ;

\ The first hello of a kind (1 ClientHello, 2 ServerHello) in the input; E_COERCE when there is none.
: _hello ( data:bytes format:str kind:int what:str -- record )
  data format util:wire-input _records { kind } packets:tls-hellos
  dup len 0 = [ "the input holds no " what cat " (handshake type " cat kind int>str cat ")" cat raise:coerce ] when
  0 nth ;

\ ---- helpers ----

\ RFC 8701: a GREASE value has both bytes equal and the low nibble of each A (0x0a0a, 0x1a1a, ... 0xfafa).
: _grease? ( v:int -- bool )
  v 3855 band 2570 = v 8 shr v 255 band = and ;

: _no-grease ( items:list -- list )
  items [ _grease? not ] filter ;

: _dash ( items:list sep:str -- str )
  items [ int>str ] map sep join ;

\ ---- JA3 (Salesforce): version,ciphers,extensions,groups,point formats ----

\ The five fields of the JA3 string. GREASE values are left out of the lists, except the point formats (one byte each).
: _ja3-parts ( h:record -- list )
  { h "version" get int>str
    h "ciphers" get _no-grease "-" _dash
    h "ext-types" get _no-grease "-" _dash
    h "groups" get _no-grease "-" _dash
    h "point-formats" get "-" _dash } ;

: _ja3-out ( p:list s:str fmt:str -- str )
  fmt "string" = [ s ] [
    fmt "full" =
    [ "Hash digest:\n" s util:md5-hex cat "\n\nFull JA3 string:\n" cat s cat
      "\n\nTLS Version:\n" cat p 0 nth cat "\nCipher Suites:\n" cat p 1 nth cat
      "\nExtensions:\n" cat p 2 nth cat "\nElliptic Curves:\n" cat p 3 nth cat
      "\nElliptic Curve Point Formats:\n" cat p 4 nth cat ]
    [ s util:md5-hex ] if ] if ;

: ja3 ( data:bytes input-format:choice{hex|base64|raw}="hex" output-format:choice{hash|string|full}="hash" -- str )
  "The JA3 fingerprint (Salesforce) of the TLS ClientHello in the input, as CyberChef's JA3 Fingerprint. The input is a TLS handshake record (hex text, Base64 text or raw bytes; a bare ClientHello message without the record header is read too) and the first ClientHello in it is used. The JA3 string is five fields separated by commas: the legacy client version in decimal, the cipher suites, the extension types, the supported groups (elliptic curves) and the EC point formats, each list in the order of the hello with its numbers in decimal joined by dashes and with GREASE values (RFC 8701) removed; a field the hello does not have is empty. The fingerprint is the MD5 of that string as 32 lower-case hex digits. output-format: hash (the MD5), string (the JA3 string) or full (CyberChef's layout: the hash, the string and the five fields, each under its heading). The input must be a well-formed hello: a record that is not a TLS record, a hello that is cut short or that goes on in the next record, a damaged extension (see Parse TLS record), or no ClientHello at all is E_COERCE with the offset; CyberChef rejects fewer inputs of the first kind and none of the last (it needs exactly one record and does not look inside the extensions it does not decode)." doc
  "Networking" category
  data input-format 1 "ClientHello" _hello _ja3-parts
  dup "," join output-format _ja3-out ;

META: ja3
  use-when "You have a TLS ClientHello from a packet capture, as hex, Base64 or raw bytes, and want its JA3 hash to compare with known clients." ;
  param input-format "How the input is written: hex text (any white space is ignored), Base64 text or raw bytes." ;
  param output-format "The MD5 hash of the JA3 string, the JA3 string, or both with the five fields." ;
  see-also fingerprint:ja3s fingerprint:ja4 packets:parse-tls ;
  link "https://github.com/salesforce/ja3" "JA3 on GitHub (Salesforce)" ;
  link "https://www.rfc-editor.org/rfc/rfc8446" "RFC 8446: TLS 1.3" ;
  link "https://en.wikipedia.org/wiki/Transport_Layer_Security" "Transport Layer Security on Wikipedia" ;
;

\ ---- JA3S: version,cipher,extensions ----

: _ja3s-parts ( h:record -- list )
  { h "version" get int>str
    h "ciphers" get 0 nth int>str
    h "ext-types" get "-" _dash } ;

: _ja3s-out ( p:list s:str fmt:str -- str )
  fmt "string" = [ s ] [
    fmt "full" =
    [ "Hash digest:\n" s util:md5-hex cat "\n\nFull JA3S string:\n" cat s cat
      "\n\nTLS Version:\n" cat p 0 nth cat "\nCipher Suite:\n" cat p 1 nth cat
      "\nExtensions:\n" cat p 2 nth cat ]
    [ s util:md5-hex ] if ] if ;

: ja3s ( data:bytes input-format:choice{hex|base64|raw}="hex" output-format:choice{hash|string|full}="hash" -- str )
  "The JA3S fingerprint (Salesforce) of the TLS ServerHello in the input, as CyberChef's JA3S Fingerprint. The input is a TLS handshake record (hex text, Base64 text or raw bytes; a bare ServerHello message is read too) and the first ServerHello in it is used. The JA3S string is three fields separated by commas: the legacy server version in decimal, the cipher suite the server chose in decimal, and the extension types in the order of the hello joined by dashes (empty when there are none; nothing is removed, as in CyberChef and Salesforce's script). The fingerprint is the MD5 of that string as 32 lower-case hex digits. output-format: hash, string or full (CyberChef's layout: the hash, the string and the three fields under their headings). A malformed hello or no ServerHello is E_COERCE (see JA3 Fingerprint)." doc
  "Networking" category
  data input-format 2 "ServerHello" _hello _ja3s-parts
  dup "," join output-format _ja3s-out ;

META: ja3s
  use-when "You have a TLS ServerHello from a packet capture and want its JA3S fingerprint, to pair with the JA3 of the client that connected." ;
  param input-format "How the input is written: hex text (any white space is ignored), Base64 text or raw bytes." ;
  param output-format "The MD5 hash of the JA3S string, the JA3S string, or both with the three fields." ;
  see-also fingerprint:ja3 fingerprint:ja4s packets:parse-tls ;
  link "https://github.com/salesforce/ja3" "JA3 on GitHub (Salesforce)" ;
  link "https://www.rfc-editor.org/rfc/rfc5246" "RFC 5246: TLS 1.2" ;
;

\ ---- JA4 and JA4S (FoxIO) ----

\ The count as two digits, 99 at most.
: _count2 ( n:int -- str )
  n 99 min 2 util:zero-pad ;

: _alnum? ( c:int -- bool )
  c 48 57 util:between? c 65 90 util:between? or c 97 122 util:between? or ;

\ The i-th (0 or 1) hex digit of a byte, in lower case.
: _hexchar ( b:int i:int -- str )
  b util:byte>hex lower i i 1 + slice ;

\ The first and the last byte of the first ALPN value: the characters when both are letters or digits, else the first
\ hex digit of the first byte and the last of the last.
: _alpn-chars ( f:int l:int -- str )
  f _alnum? l _alnum? and
  [ f util:cp>str l util:cp>str cat ]
  [ f 0 _hexchar l 1 _hexchar cat ] if ;

: _alpn2 ( names:list -- str )
  names len 0 = [ "00" ] [
    names 0 nth str>codes dup 0 nth swap dup len 1 - nth _alpn-chars ] if ;

\ The version: the highest of supported_versions (GREASE ignored) when the hello has it, else the hello's own.
: _top-version ( h:record -- int )
  h "versions" get _no-grease
  dup len 0 = [ drop h "version" get ] [ 0 [ max ] reduce ] if ;

: _ver2 ( v:int -- str )
  v 772 = [ "13" ] [ v 771 = [ "12" ] [ v 770 = [ "11" ] [ v 769 = [ "10" ] [
  v 768 = [ "s3" ] [ v 512 = [ "s2" ] [ v 256 = [ "s1" ] [ "00" ] if ] if ] if ] if ] if ] if ] if ;

\ The first 12 hex digits of the SHA-256 of a text, or twelve zeros for no text (the FoxIO rule for an empty list).
: _h12 ( raw:str -- str )
  raw len 0 = [ "000000000000" ] [ raw str>bytes "256" sha2:digest bytes>hex 0 12 slice ] if ;

: _hex4 ( items:list -- list )
  items [ 4 util:pad-hex ] map ;

\ ---- JA4 ----

\ The readable part a: protocol, version, SNI, number of ciphers, number of extensions, ALPN.
: _ja4-a ( h:record proto:str -- str )
  proto h _top-version _ver2 cat
  h "ext-types" get 0 util:contains? [ "d" ] [ "i" ] if cat
  h "ciphers" get _no-grease len _count2 cat
  h "ext-types" get _no-grease len _count2 cat
  h "alpn" get _alpn2 cat ;

\ The cipher suites as 4 hex digits each, comma separated, sorted or in the order of the hello.
: _cipher-raw ( h:record sorted:bool -- str )
  h "ciphers" get _no-grease sorted [ list:sort ] when _hex4 "," join ;

\ The signature algorithms after an underscore, or nothing when the hello has none.
: _sig-raw ( h:record -- str )
  h "sig-algs" get dup len 0 = [ drop "" ] [ _hex4 "," join "_" swap cat ] if ;

\ The extension types (GREASE out) as 4 hex digits each, then the signature algorithms. Sorted: without server_name
\ (0000) and ALPN (0010). In the original order nothing but GREASE is left out (CyberChef's JA4_o and JA4_ro).
: _ext-raw ( h:record sorted:bool -- str )
  h "ext-types" get _no-grease
  sorted [ [ dup 0 <> swap 16 <> and ] filter list:sort ] when
  _hex4 "," join h _sig-raw cat ;

\ The pieces of the four renderings: a, and the cipher (b) and extension (c) texts, sorted (s) or in the order of the hello (o).
: _ja4-parts ( h:record proto:str -- record )
  { { "a" h proto _ja4-a }
    { "bs" h true _cipher-raw } { "bo" h false _cipher-raw }
    { "cs" h true _ext-raw } { "co" h false _ext-raw } } >record ;

\ a_b_c, with b and c hashed (twelve hex digits each) or as they are.
: _ja4-join ( a:str b:str c:str hashed:bool -- str )
  a "_" cat hashed [ b _h12 ] [ b ] if cat "_" cat hashed [ c _h12 ] [ c ] if cat ;

\ One rendering: the keys of the cipher and extension texts to use.
: _form ( r:record b:str c:str hashed:bool -- str )
  r "a" get r b get r c get hashed _ja4-join ;

: _ja4-pick ( r:record k:int -- str )
  r k 1 band 1 = [ "bo" "co" ] [ "bs" "cs" ] if k 2 < _form ;

: _ja4-all ( r:record -- str )
  "JA4:    " r 0 _ja4-pick cat "\nJA4_o:  " cat r 1 _ja4-pick cat
  "\nJA4_r:  " cat r 2 _ja4-pick cat "\nJA4_ro: " cat r 3 _ja4-pick cat ;

: _ja4-out ( r:record fmt:str -- str )
  fmt "all" = [ r _ja4-all ] [ r fmt "ja4-o" = [ 1 ] [ fmt "ja4-r" = [ 2 ] [ fmt "ja4-ro" = [ 3 ] [ 0 ] if ] if ] if _ja4-pick ] if ;

: _proto ( transport:str -- str )
  transport "quic" = [ "q" ] [ "t" ] if ;

: ja4 ( data:bytes input-format:choice{hex|base64|raw}="hex" output-format:choice{ja4|ja4-o|ja4-r|ja4-ro|all}="ja4" transport:choice{tcp|quic}="tcp" -- str )
  "The JA4 fingerprint (FoxIO) of the TLS ClientHello in the input, as CyberChef's JA4 Fingerprint. The input is a TLS handshake record (hex text, Base64 text or raw bytes; a bare ClientHello message, as a QUIC CRYPTO frame holds it, is read too); the first ClientHello is used. JA4 is a_b_c. a: t (TCP) or q (QUIC), the version (13, 12, 11, 10, s3, s2, s1 or 00: the highest supported_versions value without GREASE, else the hello's version field), d with a server_name extension or i without, the number of cipher suites and of extensions as two digits (GREASE not counted, 99 at most, server_name and ALPN counted), and two characters for the first ALPN value (its first and last character when both are letters or digits, else the first hex digit of its first byte and the last of its last; 00 when none). b: the first 12 hex digits of the SHA-256 of the cipher suites (GREASE out, four lower-case hex digits each, sorted, comma separated). c: the same for the extension types (GREASE, server_name and ALPN out), then an underscore and the signature algorithms in hello order when the hello has them. An empty list hashes to twelve zeros (FoxIO's rule; CyberChef hashes the empty text and always writes the underscore). output-format: ja4; ja4-o (hello order, server_name and ALPN kept, as CyberChef's JA4_o); ja4-r (not hashed); ja4-ro; all (four labelled lines, as CyberChef). transport sets the first character (CyberChef always writes t). A malformed hello or no ClientHello is E_COERCE." doc
  "Networking" category
  data input-format 1 "ClientHello" _hello transport _proto _ja4-parts output-format _ja4-out ;

META: ja4
  use-when "You have a TLS ClientHello from a capture and want its JA4 fingerprint, which keeps readable parts, to compare clients across captures." ;
  param input-format "How the input is written: hex text (any white space is ignored), Base64 text or raw bytes." ;
  param output-format "JA4 (hashed, sorted), JA4_o (hashed, original order), JA4_r (not hashed, sorted), JA4_ro (not hashed, original order) or all four." ;
  param transport "The first character of the fingerprint: t for a hello sent over TCP, q for one carried by QUIC." ;
  see-also fingerprint:ja4s fingerprint:ja3 packets:parse-tls ;
  link "https://github.com/FoxIO-LLC/ja4" "JA4 on GitHub (FoxIO)" ;
  link "https://en.wikipedia.org/wiki/Transport_Layer_Security" "Transport Layer Security on Wikipedia" ;
;

\ ---- JA4S ----

\ JA4S: a (protocol, version, number of extensions, ALPN), the chosen cipher suite and the hash of the extension types in order.
: _ja4s-head ( h:record proto:str -- str )
  proto h _top-version _ver2 cat h "ext-types" get len _count2 cat h "alpn" get _alpn2 cat "_" cat
  h "ciphers" get 0 nth 4 util:pad-hex cat "_" cat ;

: _ja4s-out ( head:str raw:str fmt:str -- str )
  fmt "ja4s" = [ head raw _h12 cat ] [
  fmt "ja4s-r" = [ head raw cat ] [
  "JA4S:   " head raw _h12 cat cat "\nJA4S_r: " cat head raw cat cat ] if ] if ;

: _ja4s-run ( h:record proto:str fmt:str -- str )
  h proto _ja4s-head h "ext-types" get _hex4 "," join fmt _ja4s-out ;

: ja4s ( data:bytes input-format:choice{hex|base64|raw}="hex" output-format:choice{ja4s|ja4s-r|both}="ja4s" transport:choice{tcp|quic}="tcp" -- str )
  "The JA4S fingerprint (JA4Server, FoxIO) of the TLS ServerHello in the input, as CyberChef's JA4Server Fingerprint. The input is a TLS handshake record (hex text, Base64 text or raw bytes; a bare ServerHello message is read too) and the first ServerHello in it is used. JA4S is a_b_c. a is: t or q, the version as two characters (the selected version of the supported_versions extension, else the version field of the hello; see JA4 Fingerprint), the number of extensions as two digits (99 at most) and two characters for the ALPN protocol the server chose (see JA4 Fingerprint; 00 when there is none). b is the chosen cipher suite as four lower-case hex digits. c is the first 12 hex digits of the SHA-256 of the extension types in the order of the hello, as four hex digits each joined by commas (twelve zeros when there are none; nothing is sorted or removed). output-format: ja4s, ja4s-r (c as the list itself) or both (two lines labelled JA4S and JA4S_r, as CyberChef does). transport is q or t for the first character (CyberChef always writes t). A malformed hello or no ServerHello is E_COERCE (see JA3 Fingerprint)." doc
  "Networking" category
  data input-format 2 "ServerHello" _hello transport _proto output-format _ja4s-run ;

META: ja4s
  use-when "You have a TLS ServerHello from a capture and want its JA4S fingerprint, to pair with the JA4 of the client that connected." ;
  param input-format "How the input is written: hex text (any white space is ignored), Base64 text or raw bytes." ;
  param output-format "JA4S, JA4S_r (the extension list not hashed), or both." ;
  param transport "The first character of the fingerprint: t for a hello sent over TCP, q for one carried by QUIC." ;
  see-also fingerprint:ja4 fingerprint:ja3s packets:parse-tls ;
  link "https://github.com/FoxIO-LLC/ja4" "JA4 on GitHub (FoxIO)" ;
;
