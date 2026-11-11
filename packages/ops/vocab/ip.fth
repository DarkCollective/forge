\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ ip: IP address ops (WP 5.53): Parse IP range, Parse IPv6 address, IPv6 Transition Addresses, Change IP format, Group IP
\ addresses and Defang IP Addresses. All FL on the core words: an IPv4 address is an int below 2^32, an IPv6 address an int
\ below 2^128 (big integers are first class, so the masks, the totals of a range and the sorting are exact), and the text
\ forms are read and written by the private words at the top. The layouts of the reports follow CyberChef's operation
\ modules; the values were checked against Python's ipaddress and the RFC examples (see ip.test.json).
IN: ip

USING: defang ;

\ ---- text <-> int ----

\ White space off both ends. The end is done on the reversed text, because \s+$ tries every position of a long run of
\ white space (60,000 spaces in the middle of a line took 5 s).
: _trim ( s:str -- str )
  s "^\\s+" "" "" regex:replace rev "^\\s+" "" "" regex:replace rev ;

: _bad ( what:str s:str -- )
  what ": " cat s cat raise:coerce ;

\ A dotted quad of decimal octets of one to three digits (leading zeros read as decimal), each 0 to 255.
: _v4 ( s:str -- int )
  s "^[0-9]{1,3}(?:\\.[0-9]{1,3}){3}$" "" regex:test not [ "not an IPv4 address" s _bad ] when
  s "." split [ str>int ] map
  dup [ 255 > ] filter len 0 > [ "an IPv4 octet is over 255" s _bad ] when
  0 [ swap 256 * + ] reduce ;

: _v4? ( s:str -- bool )
  s "^[0-9]{1,3}(?:\\.[0-9]{1,3}){3}$" "" regex:test ;

: _v4>s ( n:int -- str )
  { 24 16 8 0 } [ n swap shr 255 band int>str ] map "." join ;

: _hextets ( part:str -- list )
  part "" = [ { } ] [ part ":" split ] if ;

: _fold16 ( hs:list -- int )
  hs 0 [ swap 65536 * swap 16 str>int-radix + ] reduce ;

\ The hextet strings of one side of ::, each 1 to 4 hex digits.
: _check-hextets ( hs:list s:str -- )
  hs [ "^[0-9a-f]{1,4}$" "" regex:test not ] filter len 0 > [ "not an IPv6 address" s _bad ] when ;

\ The text with an embedded IPv4 tail (::ffff:192.0.2.1) turned into two hextets.
: _untail ( t:str s:str -- str )
  t "^(.*:)([0-9]{1,3}(?:\\.[0-9]{1,3}){3})$" "" regex:find-all
  dup len 0 = [ "not an IPv6 address" s _bad ] when
  0 nth "groups" get dup 1 nth _v4
  swap 0 nth swap
  dup 16 shr 4 util:pad-hex swap 65535 band 4 util:pad-hex ":" swap cat cat cat ;

: _join ( l:list r:list -- int )
  l _fold16 8 l len - 16 * shl r _fold16 + ;

: _v6 ( s:str -- int )
  s lower
  dup "." split len 1 > [ s _untail ] when
  dup "^[0-9a-f:]+$" "" regex:test not [ "not an IPv6 address" s _bad ] when
  dup ":::" split len 1 > [ "not an IPv6 address" s _bad ] when
  "::" split
  dup len 1 = [
    0 nth _hextets dup s _check-hextets
    dup len 8 <> [ "not an IPv6 address (needs 8 groups, or ::)" s _bad ] when
    _fold16
  ] [
    dup len 2 = not [ "not an IPv6 address (:: twice)" s _bad ] when
    dup 0 nth _hextets swap 1 nth _hextets
    over s _check-hextets dup s _check-hextets
    over len over len + 7 > [ "not an IPv6 address (too many groups)" s _bad ] when
    _join
  ] if ;

\ ---- int -> text ----

: _hextet-list ( n:int -- list )
  0 8 range [ 7 swap - 16 * n swap shr 65535 band ] map ;

\ Eight groups of four hex digits (CyberChef's longhand).
: _long ( n:int -- str )
  n _hextet-list [ 4 util:pad-hex ] map ":" join ;

\ The first of the longest runs of two or more zero groups of the plain form, as a match, or an empty list.
: _zero-run ( text:str -- list )
  { 8 7 6 5 4 3 2 } { } [
    swap dup len 0 > [ nip ] [
      drop 1 - int>str "(?<![0-9a-f])0(?::0){" swap cat "}(?![0-9a-f])" cat text swap "" regex:find-all
    ] if
  ] reduce ;

\ The text with the zero groups from start to end (exclusive) squeezed to ::.
: _squash ( text:str start:int end:int -- str )
  text 0 start 0 > [ start 1 - ] [ 0 ] if slice
  "::" cat
  text end text len < [ end 1 + ] [ text len ] if text len slice cat ;

\ The shorthand of RFC 5952: no leading zeros, the first longest run of zero groups (two or more) as ::.
: _short ( n:int -- str )
  n _hextet-list [ 16 int>str-radix ] map ":" join
  dup _zero-run
  dup len 0 = [ drop ] [ 0 nth dup "start" get swap "end" get _squash ] if ;

\ ---- masks, prefixes ----

\ The mask of a prefix of cidr bits in an address of bits bits.
: _mask ( cidr:int bits:int -- int )
  1 bits shl 1 bits cidr - shl - ;

\ The "address/prefix" text as the address text and the prefix length (a number of 0 to max, digits only).
: _split-cidr ( s:str max:int -- str int )
  s "/" split
  dup len 2 = not [ "not an address with a prefix length (address/bits)" s _bad ] when
  dup 1 nth "^[0-9]{1,3}$" "" regex:test not [ "the prefix length is not a number" s _bad ] when
  dup 1 nth str>int
  dup max > [ "the prefix length is over " max int>str cat " in" cat s _bad ] when
  swap 0 nth swap ;

: _addr ( s:str bits:int -- int )
  bits 32 = [ s _v4 ] [ s _v6 ] if ;

: _ones ( bits:int -- int )
  1 bits shl 1 - ;

\ The first and last address of the network that holds a, for a prefix of cidr bits.
: _net-bounds ( a:int cidr:int bits:int -- int int )
  a cidr bits _mask band dup cidr bits _mask bits _ones bxor bor ;

\ One line of a list: an address, or address/prefix; the first and last address it covers.
: _line ( s:str bits:int -- int int )
  s "/" split len 1 >
  [ s bits _split-cidr swap bits _addr swap bits _net-bounds ]
  [ s bits _addr dup ] if ;

\ ---- Parse IP range ----

: _bits-of ( first:str -- int )
  first ":" split len 1 > [ 128 ] [ 32 ] if ;

: _count ( lo:int hi:int -- str )
  hi lo - 1 + int>str ;

: _nums256 ( -- str )
  0 256 range [ int>str ] map "\n" join ;

\ The text of one /24 prefix as "a.b.c." for the 24-bit number b.
: _prefix ( b:int -- str )
  { 16 8 0 } [ b swap shr 255 band int>str ] map "." join "." cat ;

\ A whole /24 with prefix text p: the 256 numbers, each with p in front.
: _full ( p:str nums:str -- str )
  p nums "\n" split "\n" p cat join cat ;

: _part ( p:str from:int to:int nums:str -- str )
  nums "\n" split from to slice [ p swap cat ] map "\n" join ;

\ The addresses b.from to b.(to - 1) of one /24, one per line.
: _block ( b:int from:int to:int nums:str -- str )
  b _prefix
  from 0 = to 256 = and
  [ nums _full ] [ from to nums _part ] if ;

\ All the addresses from lo to hi, one per line (in blocks of 256: a few steps for each block, not for each address).
: _enum-blocks ( lo:int hi:int nums:str -- str )
  lo 8 shr hi 8 shr 1 + range
  [ dup lo 8 shr = [ lo 255 band ] [ 0 ] if
    over hi 8 shr = [ hi 255 band 1 + ] [ 256 ] if
    nums _block ] map
  "\n" join ;

: _enumerate ( lo:int hi:int -- str )
  lo hi _nums256 _enum-blocks ;

\ The enumeration of an IPv4 range, or nothing when it is switched off; more than 65,536 addresses needs allow
\ (and no range may pass 1,048,576).
: _listing ( lo:int hi:int enum:bool allow:bool -- str )
  enum not [ "" ] [
    hi lo - 1 +
    dup allow [ 1048576 ] [ 65536 ] if >
    [ "the range holds " swap int>str cat " addresses; listing them is limited to 65,536 (1,048,576 with Allow large queries)" cat raise:range ]
    [ drop lo hi _enumerate ] if
  ] if ;

: _cidr4 ( lo:int hi:int cidr:int info:bool enum:bool allow:bool -- str )
  info
  [ { "Network: " lo _v4>s "\nCIDR: " cidr int>str "\nMask: " cidr 32 _mask _v4>s
      "\nRange: " lo _v4>s " - " hi _v4>s "\nTotal addresses in range: " lo hi _count "\n\n" } "" join ]
  [ "" ] if
  lo hi enum allow _listing cat ;

: _info4b ( ip1:int ip2:int cidr:int slo:int shi:int -- str )
  { "Minimum subnet required to hold this range:\n\tNetwork: " slo _v4>s "\n\tCIDR: " cidr int>str
    "\n\tMask: " cidr 32 _mask _v4>s "\n\tSubnet range: " slo _v4>s " - " shi _v4>s
    "\n\tTotal addresses in subnet: " slo shi _count "\n\nRange: " ip1 _v4>s " - " ip2 _v4>s
    "\nTotal addresses in range: " ip1 ip2 _count "\n\n" } "" join ;

: _info4 ( ip1:int ip2:int cidr:int -- str )
  ip1 ip2 cidr ip1 cidr 32 _net-bounds _info4b ;

\ The hyphenated range of IPv4 addresses (and the list, reduced to its lowest and highest address).
: _range4 ( ip1:int ip2:int info:bool enum:bool allow:bool -- str )
  ip2 ip1 < [ "the second address is below the first" raise:range ] when
  info [ ip1 ip2 32 ip1 ip2 bxor util:bit-length - _info4 ] [ "" ] if
  ip1 ip2 enum allow _listing cat ;

: _cidr6 ( lo:int hi:int cidr:int info:bool -- str )
  info
  [ { "Network: " lo _long "\nShorthand: " lo _short "\nCIDR: " cidr int>str "\nMask: " cidr 128 _mask _long
      "\nRange: " lo _long " - " hi _long "\nTotal addresses in range: " lo hi _count "\n\n" } "" join ]
  [ "" ] if ;

: _range6 ( ip1:int ip2:int info:bool -- str )
  ip2 ip1 < [ "the second address is below the first" raise:range ] when
  info
  [ { "Range: " ip1 _long " - " ip2 _long "\nShorthand range: " ip1 _short " - " ip2 _short
      "\nTotal addresses in range: " ip1 ip2 _count "\n\n" } "" join ]
  [ "" ] if ;

\ The lowest and the highest address of a list of lines (addresses and networks).
: _bounds ( lines:list bits:int -- int int )
  lines [ bits _line drop ] map dup 0 nth [ min ] reduce
  lines [ bits _line nip ] map dup 0 nth [ max ] reduce ;

: _hyphen-bounds ( s:str bits:int -- int int )
  s "-" split
  dup len 2 = not [ "not a range (address - address)" s _bad ] when
  dup 0 nth _trim bits _addr swap 1 nth _trim bits _addr ;

: _hyphen-final ( lo:int hi:int bits:int info:bool enum:bool allow:bool -- str )
  bits 32 = [ lo hi info enum allow _range4 ] [ lo hi info _range6 ] if ;

: _parse-range ( lines:list bits:int info:bool enum:bool allow:bool -- str )
  lines len 1 = lines 0 nth "/" split len 1 > and
  [ lines 0 nth bits _line lines 0 nth bits _split-cidr nip
    bits 32 = [ info enum allow _cidr4 ] [ info _cidr6 ] if ]
  [ lines len 1 = lines 0 nth "-" split len 1 > and
    [ lines 0 nth bits _hyphen-bounds ] [ lines bits _bounds ] if
    bits info enum allow _hyphen-final ]
  if ;

: parse-range ( data:str include-network-info:bool=true enumerate:bool=true allow-large:bool=false -- str )
  "Network information and the addresses of an IP range, IPv4 or IPv6. The input is a CIDR range (10.0.0.0/24), a hyphenated range (10.0.0.0 - 10.0.1.0) or a list of addresses and CIDR ranges, one per line (the list is read as the range from its lowest to its highest address); empty lines are ignored. For a CIDR range the report gives the network, prefix length, mask, first and last address and the number of addresses (for IPv6 also the shorthand); for a hyphenated range or a list it gives the smallest subnet that holds the range (IPv4) and the range with its number of addresses, as CyberChef does. With enumerate, IPv4 ranges list every address, one per line; IPv6 ranges are never listed. A range of more than 65,536 addresses is E_RANGE unless allow-large is on, and none of more than 1,048,576 is listed. Anything that is not an address or range is E_COERCE, a prefix length over 32 (IPv4) or 128 (IPv6) is E_COERCE, a range whose second address is below the first is E_RANGE." doc
  "Networking" category
  data "\n" split [ _trim ] map [ len 0 > ] filter
  dup len 0 = [ "no address or range in the input" raise:coerce ] when
  dup 0 nth _bits-of include-network-info enumerate allow-large _parse-range ;

META: parse-range
  param include-network-info "Start with the network information (network, prefix length, mask, range, count)." ;
  param enumerate "List every address of an IPv4 range, one per line (IPv6 ranges are never listed)." ;
  param allow-large "Allow listing more than 65,536 addresses (never more than 1,048,576)." ;
  see-also ip:group ip:parse-ipv6 ;
;

\ ---- Parse IPv6 address ----

\ The top `bits` bits of an IPv6 address.
: _top ( n:int bits:int -- int )
  n 128 bits - shr ;

: _in ( n:int value:int bits:int -- bool )
  n bits _top value = ;

\ The IPv4 address in the low 32 bits.
: _low4 ( n:int -- str )
  n 4294967295 band _v4>s ;

: _bin ( v:int w:int -- str )
  "0" w v 2 int>str-radix len - util:repeat-str v 2 int>str-radix cat ;

: _scope-name ( k:int -- str )
  k 1 = [ "Interface Local" ] [
  k 2 = [ "Link Local" ] [
  k 3 = [ "Realm Local" ] [
  k 4 = [ "Admin Local" ] [
  k 5 = [ "Site Local" ] [
  k 8 = [ "Organisation Local" ] [
  k 14 = [ "Global" ] [ "" ] if ] if ] if ] if ] if ] if ] if ;

\ Each detector gives the text of the reserved range an address is in (starting with a line feed), or nothing.
: _d-unspecified ( n:int -- str )
  n 0 = [ "\nUnspecified address corresponding to 0.0.0.0/32 in IPv4.\nUnspecified address range: ::/128" ] [ "" ] if ;

: _d-loopback ( n:int -- str )
  n 1 = [ "\nLoopback address to the local host corresponding to 127.0.0.1/8 in IPv4.\nLoopback addresses range: ::1/128" ] [ "" ] if ;

: _d-mapped ( n:int -- str )
  n 32 shr 65535 =
  [ "\nIPv4-mapped IPv6 address detected. IPv6 clients will be handled natively by default, and IPv4 clients appear as IPv6 clients at their IPv4-mapped IPv6 address.\nMapped IPv4 address: " n _low4 cat "\nIPv4-mapped IPv6 addresses range: ::ffff:0:0/96" cat ]
  [ "" ] if ;

: _d-translated ( n:int -- str )
  n 32 shr 0xffff0000 =
  [ "\nIPv4-translated address detected. Used by Stateless IP/ICMP Translation (SIIT). See RFCs 6145 and 6052 for more details.\nTranslated IPv4 address: " n _low4 cat "\nIPv4-translated addresses range: ::ffff:0:0:0/96" cat ]
  [ "" ] if ;

: _d-discard ( n:int -- str )
  n 0x0100_0000_0000_0000 64 _in
  [ "\nDiscard prefix detected. This is used when forwarding traffic to a sinkhole router to mitigate the effects of a denial-of-service attack. See RFC 6666 for more details.\nDiscard range: 100::/64" ]
  [ "" ] if ;

: _d-nat64 ( n:int -- str )
  n 0x0064_ff9b_0000_0000_0000_0000 96 _in
  [ "\n'Well-Known' prefix for IPv4/IPv6 translation detected. See RFC 6052 for more details.\nTranslated IPv4 address: " n _low4 cat "\n'Well-Known' prefix range: 64:ff9b::/96" cat ]
  [ n 0x0064_ff9b_0001 48 _in
    [ "\nLocal-use prefix for IPv4/IPv6 translation detected (RFC 8215). The IPv4 address is embedded as RFC 6052 describes for the prefix length in use.\nLocal-use prefix range: 64:ff9b:1::/48" ]
    [ "" ] if ] if ;

: _d-bmwg ( n:int -- str )
  n 0x2001_0002_0000 48 _in
  [ "\nAssigned to the Benchmarking Methodology Working Group (BMWG) for benchmarking IPv6. Corresponds to 198.18.0.0/15 for benchmarking IPv4. See RFC 5180 for more details.\nBMWG range: 2001:2::/48" ]
  [ "" ] if ;

: _d-orchid1 ( n:int -- str )
  n 0x2001001 28 _in
  [ "\nDeprecated, previously ORCHIDv1 (Overlay Routable Cryptographic Hash Identifiers).\nORCHIDv1 range: 2001:10::/28\nORCHIDv2 now uses 2001:20::/28." ]
  [ "" ] if ;

: _d-orchid2 ( n:int -- str )
  n 0x2001002 28 _in
  [ "\nORCHIDv2 (Overlay Routable Cryptographic Hash Identifiers).\nThese are non-routed IPv6 addresses used for Cryptographic Hash Identifiers.\nORCHIDv2 range: 2001:20::/28" ]
  [ "" ] if ;

: _d-documentation ( n:int -- str )
  n 0x2001_0db8 32 _in
  [ "\nThis is a documentation IPv6 address. This range should be used whenever an example IPv6 address is given or to model networking scenarios. Corresponds to 192.0.2.0/24, 198.51.100.0/24, and 203.0.113.0/24 in IPv4.\nDocumentation range: 2001:db8::/32" ]
  [ "" ] if ;

: _d-6to4 ( n:int -- str )
  n 0x2002 16 _in
  [ "\n6to4 transition IPv6 address detected. See RFC 3056 for more details.\n6to4 prefix range: 2002::/16\n\nEncapsulated IPv4 address: "
    n 80 shr 4294967295 band _v4>s cat
    "\nSLA ID: " cat n 64 shr 65535 band int>str cat
    "\nInterface ID (base 16): " cat n 18446744073709551615 band 16 util:pad-hex cat
    "\nInterface ID (base 10): " cat n 18446744073709551615 band int>str cat ]
  [ "" ] if ;

: _d-ula ( n:int -- str )
  n 0x7e 7 _in
  [ "\nThis is a unique local address comparable to the IPv4 private addresses 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16. See RFC 4193 for more details.\nUnique local addresses range: fc00::/7" ]
  [ "" ] if ;

: _d-link-local ( n:int -- str )
  n 0x3fa 10 _in
  [ "\nThis is a link-local address comparable to the auto-configuration addresses 169.254.0.0/16 in IPv4.\nLink-local addresses range: fe80::/10" ]
  [ "" ] if ;

\ Teredo (RFC 4380, flags as RFC 5991): the server address, the flags, and the client address and port, which are
\ stored with every bit inverted.
: _teredo-verdict ( r:int ug:int random1:int random2:int -- str )
  r 0 = ug 0 = and random1 0 <> and random2 0 <> and
  [ "\n\nThis is a valid Teredo address which complies with RFC 4380 and RFC 5991." ]
  [ r 0 = ug 0 = and
    [ "\n\nThis is a valid Teredo address which complies with RFC 4380, however it does not comply with RFC 5991 (Teredo Security Updates) as there are no randomised bits in the flag field." ]
    [ "\n\nThis is an invalid Teredo address." ] if ] if ;

: _cone-text ( cone:int -- str )
  cone 0 = [ " (Client is not behind a cone NAT)" ] [ " (Client is behind a cone NAT)" ] if ;

: _r-text ( r:int -- str )
  r 0 = [ "" ] [ " Error: This flag should be set to 0. See RFC 5991 and RFC 4380." ] if ;

: _ug-text ( ug:int -- str )
  ug 0 = [ "" ] [ " Error: This flag should be set to 00. See RFC 4380." ] if ;

: _teredo ( n:int -- str )
  { "\nTeredo tunneling IPv6 address detected\n"
    "\nServer IPv4 address: " n 64 shr 4294967295 band _v4>s
    "\nClient IPv4 address: " n 4294967295 band 4294967295 bxor _v4>s
    "\nClient UDP port:     " n 32 shr 65535 band 65535 bxor int>str
    "\nObfuscated client address and port (every bit inverted, RFC 4380): "
      n 4294967295 band _v4>s " and " n 32 shr 65535 band int>str
    "\nFlags:\n\tCone:    " n 63 shr 1 band int>str n 63 shr 1 band _cone-text
    "\n\tR:       " n 62 shr 1 band int>str n 62 shr 1 band _r-text
    "\n\tRandom1: " n 58 shr 15 band 4 _bin
    "\n\tUG:      " n 56 shr 3 band 2 _bin n 56 shr 3 band _ug-text
    "\n\tRandom2: " n 48 shr 255 band 8 _bin
    n 62 shr 1 band n 56 shr 3 band n 58 shr 15 band n 48 shr 255 band _teredo-verdict
    "\n\nTeredo prefix range: 2001::/32" } "" join ;

: _d-teredo ( n:int -- str )
  n 0x2001_0000 32 _in [ n _teredo ] [ "" ] if ;

\ Table lookup: the text paired with key in a list of { key text } pairs, or nothing.
: _assoc ( table:list key:int -- str )
  table [ 0 nth key = ] filter
  dup len 0 = [ drop "" ] [ 0 nth 1 nth ] if ;

: _mc-name ( h6:int h7:int -- str )
  h6 1 =
  [ { { 2 "All DHCP Servers and Relay Agents (defined in RFC3315)" } { 3 "All LLMNR Hosts (defined in RFC4795)" } } h7 _assoc ]
  [ { { 1 "All nodes" } { 2 "All routers" } { 5 "OSPFv3 - All OSPF routers" } { 6 "OSPFv3 - All Designated Routers" }
      { 8 "IS-IS for IPv6 Routers" } { 9 "RIP Routers" } { 10 "EIGRP Routers" } { 12 "Simple Service Discovery Protocol" }
      { 13 "PIM Routers" } { 22 "MLDv2 Reports (defined in RFC3810)" } { 107 "Precision Time Protocol v2 Peer Delay Measurement Messages" }
      { 251 "Multicast DNS" } { 257 "Network Time Protocol" } { 264 "Network Information Service" } { 276 "Experiments" }
      { 385 "Precision Time Protocol v2 Messages (exc. Peer Delay)" } } h7 _assoc ] if ;

: _d-multicast ( n:int -- str )
  n 0xff 8 _in
  [ "\nThis is a reserved multicast address.\nMulticast addresses range: ff00::/8"
    n 112 shr 15 band _scope-name dup len 0 = [ drop "" ] [ "\n\nReserved Multicast Block for " swap cat " Scope" cat ] if cat
    n 16 shr 65535 band n 65535 band _mc-name dup len 0 = [ drop "" ] [ "\nReserved Multicast Address for '" swap cat "'" cat ] if cat ]
  [ "" ] if ;

: _detectors ( -- list )
  { [ _d-unspecified ] [ _d-loopback ] [ _d-mapped ] [ _d-translated ] [ _d-discard ] [ _d-nat64 ] [ _d-teredo ] [ _d-bmwg ]
    [ _d-orchid1 ] [ _d-orchid2 ] [ _d-documentation ] [ _d-6to4 ] [ _d-ula ] [ _d-link-local ] [ _d-multicast ] } ;

\ The text of the first reserved range that holds the address.
: _reserved ( n:int -- str )
  _detectors "" [ over len 0 = [ nip n swap call ] [ drop ] if ] reduce ;

\ ISATAP (RFC 5214): the interface identifier is 0000:5efe or 0200:5efe followed by an IPv4 address.
: _isatap ( n:int -- str )
  n 32 shr 65535 band 0x5efe = n 48 shr 65535 band 0xfdff band 0 = and
  [ "\n\nISATAP interface identifier detected (RFC 5214): the low 32 bits are an IPv4 address.\nEmbedded IPv4 address: " n _low4 cat ]
  [ "" ] if ;

: _hex2 ( v:int -- str )
  v 255 band 2 util:pad-hex ;

\ The MAC address of a modified EUI-64: bytes 0 to 2 and 5 to 7 of the interface identifier, universal/local bit flipped.
: _mac-bytes ( n2:int -- str )
  { 56 48 40 16 8 0 } [ n2 swap shr _hex2 ] map ":" join ;

: _mac-of ( n:int -- str )
  n 2 56 shl bxor _mac-bytes ;

\ A modified EUI-64 interface identifier (the bytes ff fe in the middle) and the MAC address it came from.
: _eui64 ( n:int -- str )
  n 32 shr 255 band 255 = n 24 shr 255 band 254 = and
  [ "\n\nThis IPv6 address contains a modified EUI-64 address, identified by the presence of FF:FE in the 12th and 13th octets.\nInterface identifier: "
    { 56 48 40 32 24 16 8 0 } [ n swap shr _hex2 ] map ":" join cat
    "\nMAC address:          " cat n _mac-of cat ]
  [ "" ] if ;

\ The address text of an input: the brackets of [2001:db8::1] are taken off.
: _unbracket ( s:str -- str )
  s "^\\[(.*)\\]$" "$1" "" regex:replace ;

: _report ( n:int zone:str -- str )
  { "Longhand:  " n _long "\nShorthand: " n _short "\n"
    zone len 0 > [ "Zone ID:   " zone cat "\n" cat ] [ "" ] if
    n _reserved n _isatap n _eui64 } "" join ;

: _zone-split ( s:str -- str str )
  s "%" split
  dup len 2 > [ "an IPv6 address has one % at most" s _bad ] when
  dup len 2 =
  [ dup 1 nth "^[0-9A-Za-z._~-]+$" "" regex:test not [ "the zone ID of the IPv6 address is not valid" s _bad ] when
    dup 0 nth swap 1 nth ]
  [ 0 nth "" ] if ;

: parse-ipv6 ( data:str -- str )
  "The longhand and shorthand forms of an IPv6 address, and what its range is for: unspecified, loopback, IPv4-mapped, IPv4-translated (SIIT), discard, the NAT64 well-known and local-use prefixes, Teredo (server, client address and port with the bit inversion undone, and the flags, checked against RFC 4380 and RFC 5991), the benchmarking, ORCHID and documentation ranges, 6to4 (the IPv4 address, SLA ID and interface identifier), unique local, link-local and multicast (with its scope); and whether the interface identifier is ISATAP (RFC 5214, with its IPv4 address) or a modified EUI-64 (with the MAC address it came from). The input is one address, compressed or not, with or without an IPv4 tail, optionally in [brackets] and with a %zone (shown as Zone ID). The layout is CyberChef's. Anything else is E_COERCE (CyberChef answers Invalid IPv6 address)." doc
  "Networking" category
  data _trim _unbracket _zone-split
  swap _v6 swap _report ;

META: parse-ipv6
  see-also ip:transition ip:parse-range ;
;

\ ---- IPv6 Transition Addresses ----

: _label ( rh:bool label:str -- str )
  rh [ "" ] [ label ] if ;

: _t4b ( x:str y:str s48:str sp:str rh:bool -- str )
  { rh "6to4: " _label "2002:" x ":" y s48 "\n"
    rh "IPv4 Mapped: " _label "::ffff:" x ":" y sp "\n"
    rh "IPv4 Translated: " _label "::ffff:0:" x ":" y sp "\n"
    rh "Nat 64: " _label "64:ff9b::" x ":" y sp "\n" } "" join ;

\ The transition forms of an IPv4 address (a /24 range keeps its first three octets).
: _t4 ( n:int range:bool rh:bool -- str )
  n 16 shr 65535 band 4 util:pad-hex
  range
  [ n 8 shr 255 band _hex2 "00" cat "::/40" "/120" ]
  [ n 65535 band 4 util:pad-hex "::/48" "" ] if
  rh _t4b ;

: _eui-text ( e:int rh:bool -- str )
  rh "EUI-64 Interface ID: " _label
  { 48 32 16 0 } [ e swap shr 65535 band 4 util:pad-hex ] map ":" join cat "\n" cat ;

\ A MAC address (colons) to the modified EUI-64 interface identifier of RFC 4291 appendix A.
: _t-mac ( s:str rh:bool -- str )
  s ":" split "" join 16 str>int-radix
  dup 24 shr 40 shl swap 16777215 band bor 0xfffe_00_0000 bor 2 56 shl bxor
  rh _eui-text ;

\ The IPv4 or MAC address an IPv6 transition address holds, or a note that it holds none.
: _un4 ( n:int rh:bool -- str )
  rh "IPv4: " _label n _low4 cat "\n" cat ;

: _t6 ( n:int rh:bool s:str -- str )
  n 0x2002 16 _in
  [ rh "IPv4: " _label n 80 shr 4294967295 band _v4>s cat "\n" cat ]
  [ n 32 shr 65535 =
    n 32 shr 0xffff0000 = or
    n 0x0064_ff9b_0000_0000_0000_0000 96 _in or
    n _isatap len 0 > or
    [ n rh _un4 ]
    [ n _eui64 len 0 >
      [ rh "Mac Address: " _label n _mac-of upper cat "\n" cat ]
      [ s ": no IPv4 or MAC address is embedded in this IPv6 address\n" cat ] if ] if ] if ;

: _t-line ( s:str ignore:bool rh:bool -- str )
  ignore s "/" split len 1 > and
  [ "" ]
  [ s _v4? [ s _v4 false rh _t4 ] [
    s "^([0-9]{1,3}(?:\\.[0-9]{1,3}){3})/24$" "" regex:find-all dup len 0 > [ 0 nth "groups" get 0 nth _v4 true rh _t4 ] [
    drop s "/" split len 1 > [ "only /24 ranges of IPv4 addresses can be converted" s _bad ] when
    s "^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$" "" regex:test [ s rh _t-mac ] [
    [ s _v6 true ] [ drop 0 false ] try
    [ rh s _t6 ] [ drop "Enter a compressed or expanded IPv6 address, an IPv4 address or a MAC address" s _bad "" ] if
    ] if ] if ] if ] if ;

: transition ( data:str ignore-ranges:bool=true remove-headers:bool=false -- str )
  "Converts between IPv4 addresses and their IPv6 transition forms, line by line. An IPv4 address gives its 6to4 prefix (2002:XXXX:XXXX::/48), IPv4-mapped (::ffff:XXXX:XXXX), IPv4-translated (::ffff:0:XXXX:XXXX) and NAT64 well-known (64:ff9b::XXXX:XXXX) forms; a 192.0.2.0/24 range gives the same with /40 and /120 prefixes (other prefix lengths are E_COERCE). A MAC address with colons gives its modified EUI-64 interface identifier, to append to an IPv6 /64 prefix. An IPv6 address of one of those transition forms (or an ISATAP address) gives the IPv4 address in it, and an address with a modified EUI-64 identifier the MAC address. ignore-ranges skips lines that hold a / (CyberChef's default); remove-headers leaves out the labels so the values can be copied. Empty lines are skipped. A line that is none of these is E_COERCE (CyberChef overwrites the output with a message); an IPv6 address with no embedded address gets a line saying so. The text is CyberChef's, one value per line, each line ended by a line feed." doc
  "Networking" category
  data "\n" split [ _trim ] map [ len 0 > ] filter
  [ ignore-ranges remove-headers _t-line ] map "" join ;

META: transition
  param ignore-ranges "Skip the lines that contain a / (ranges)." ;
  param remove-headers "Leave out the labels (6to4: and so on) so the values can be copied." ;
  see-also ip:parse-ipv6 ip:change-format ;
;

\ ---- Change IP format ----

: _from-number ( s:str radix:int pattern:str what:str -- int )
  s pattern "" regex:test not [ what s _bad ] when
  s radix str>int-radix
  dup 4294967295 > [ "the number is over 4294967295 (it does not fit 32 bits)" s _bad ] when ;

: _read-ip ( s:str fmt:str -- int )
  fmt "dotted-decimal" = [ s _v4 ] [
  fmt "decimal" = [ s 10 "^[0-9]{1,10}$" "not a decimal IPv4 number" _from-number ] [
  fmt "octal" = [ s 8 "^[0-7]{1,12}$" "not an octal IPv4 number" _from-number ] [
  s "^0[xX]" "" "" regex:replace 16 "^[0-9a-fA-F]{1,8}$" "not a hex IPv4 number" _from-number ] if ] if ] if ;

: _write-ip ( n:int fmt:str -- str )
  fmt "dotted-decimal" = [ n _v4>s ] [
  fmt "decimal" = [ n int>str ] [
  fmt "octal" = [ "0" n 8 int>str-radix cat ] [
  n 8 util:pad-hex ] if ] if ] if ;

: change-format ( data:str input-format:choice{dotted-decimal|decimal|octal|hex}="dotted-decimal" output-format:choice{dotted-decimal|decimal|octal|hex}="dotted-decimal" -- str )
  "Converts IPv4 addresses, one per line, between dotted decimal (192.168.0.1), decimal (3232235521), octal (030052000001, written with a leading 0) and hex (c0a80001, eight digits, a 0x prefix is read and not written). The octal, decimal and hex forms are one 32-bit number; octal reads with or without the leading 0 and hex with or without 0x. Empty lines are dropped. A line that is not an address in the input format (a dotted octet over 255, a number over 4294967295, a wrong digit) is E_COERCE where CyberChef gives a wrong answer; when both formats are the same the address is still checked and written in canonical form." doc
  "Networking" category
  data "\n" split [ _trim ] map [ len 0 > ] filter
  [ input-format _read-ip output-format _write-ip ] map "\n" join ;

META: change-format
  param input-format "How the addresses are written in the input." ;
  param output-format "How to write them." ;
  see-also ip:transition ip:parse-range ;
;

\ ---- Group IP addresses ----

: _two128 ( -- int )
  1 128 shl ;

\ The sort key of an address: IPv4 as the number, IPv6 as the number plus 2^128 (so IPv4 comes first).
: _key-of ( s:str cidr:int -- int )
  s _v4?
  [ cidr 32 > [ "the prefix length is over 32, which an IPv4 address cannot have" s _bad ] when s _v4 ]
  [ s _v6 _two128 + ] if ;

: _net-of ( key:int cidr:int -- int )
  key _two128 >=
  [ key _two128 - cidr 128 _mask band _two128 + ]
  [ key cidr 32 _mask band ] if ;

: _show ( key:int -- str )
  key _two128 >= [ key _two128 - _short ] [ key _v4>s ] if ;

: _group-text ( key:int new:bool first:bool cidr:int only:bool -- str )
  { new first not and only not and [ "\n" ] [ "" ] if
    new [ key cidr _net-of _show "/" cidr int>str "\n" ] [ "" ] if
    only [ "" ] [ "  " key _show "\n" ] if } "" join ;

: _group-item ( key:int i:int nets:list prevs:list cidr:int only:bool -- str )
  key nets i nth prevs i nth <> i 0 = cidr only _group-text ;

: _group-run ( keys:list nets:list prevs:list cidr:int only:bool -- str )   \ prevs: -1 and then the networks, so prevs[i] is the network before nets[i]
  keys [ nets prevs cidr only _group-item ] mapi "" join
  only not [ "\n" cat ] when ;

: group ( data:str delimiter:choice{newline|crlf|space|comma|semicolon}="newline" cidr:int[0..128]=24 only-subnets:bool=false -- str )
  "Groups a list of IPv4 and IPv6 addresses into subnets of the given prefix length (default 24): each subnet as network/prefix on a line, then its addresses indented by two spaces and in ascending order, and a blank line. IPv4 subnets come first, then IPv6 (written in shorthand), each in ascending order. With only-subnets only the networks are listed. The addresses are cut at the delimiter (newline, CRLF, space, comma or semicolon) and white space around them is dropped; empty pieces are skipped, a piece that is not an address is E_COERCE (CyberChef ignores it), and a prefix length over 32 meeting an IPv4 address is E_COERCE (CyberChef takes it as 32 and prints the longer number). The addresses are written in canonical form (shorthand for IPv6), repeats are kept. Unlike CyberChef the IPv6 networks and addresses are sorted, and the IPv4 ones by number, not as text." doc
  "Networking" category
  data delimiter util:delimiter split [ _trim ] map [ len 0 > ] filter
  dup len 0 = [ drop "" ] [
    [ cidr _key-of ] map list:sort
    dup [ cidr _net-of ] map dup { -1 } swap cat cidr only-subnets _group-run
  ] if ;

META: group
  param delimiter "What separates the addresses in the input." ;
  param cidr "The prefix length of the subnets (0 to 32 for IPv4, up to 128 for IPv6)." ;
  param only-subnets "List only the networks, not the addresses in them." ;
  see-also ip:parse-range ip:change-format ;
;

\ ---- Defang IP Addresses ----

\ A run of hex digits, colons and dots with at least two colons: the candidate for an IPv6 address.
: _v6-candidate-pattern ( -- str )
  "(?<![0-9A-Fa-f:.])[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*" ;

: _octet-pattern ( -- str )
  "(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])" ;

: _v4-defang-pattern ( -- str )
  "(?<![0-9.])" _octet-pattern cat "\\." cat _octet-pattern cat "\\." cat _octet-pattern cat "\\." cat _octet-pattern cat
  "(?![0-9])(?!\\.[0-9])(/[0-9]{1,2})?" cat ;

: _valid-v6? ( s:str -- bool )
  [ s _v6 drop true ] [ drop false ] try ;

: _plain-defang ( s:str -- str )
  s ":" split "[:]" join "." split "[.]" join ;

\ s without its tail t... t is s with the trailing dots and colons taken off.
: _defang-tail ( s:str t:str -- str )
  t _valid-v6? [ t _plain-defang s t len s len slice cat ] [ s ] if ;

\ A candidate is an IPv6 address when it parses; one that ends in a . or a : that belongs to the sentence is tried without it.
\ No address is longer than 45 characters (ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255), so a longer run is left alone.
: _defang-v6 ( s:str -- str )
  s len 45 >
  [ s ]
  [ s _valid-v6? [ s _plain-defang ] [ s s "[.:]+$" "" "" regex:replace _defang-tail ] if ] if ;

: defang ( data:str -- str )
  "Makes the IPv4 and IPv6 addresses in the text harmless: every . of an IPv4 address (with an optional /prefix) is written [.], and every : (and . of an IPv4 tail) of an IPv6 address [:] (192[.]0[.]2[.]1, 2001[:]db8[:][:]1). IPv6 addresses are found as runs of hex digits, colons and dots with at least two colons that read as an address in any of the forms of RFC 4291, in either case; an IPv4 address is four numbers from 0 to 255 not inside a longer dotted or numeric run (CyberChef would defang the first four numbers of 1.2.3.4.5). Everything else in the text is kept." doc
  "Networking" category
  data data _v6-candidate-pattern "" regex:find-all [ _defang-v6 ] defang:rewrite
  _v4-defang-pattern "$1[.]$2[.]$3[.]$4$5" "" regex:replace ;

META: defang
  see-also defang:defang-url ip:parse-range extract:ip-addresses ;
;
