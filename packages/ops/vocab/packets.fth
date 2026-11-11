\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ packets: the packet layers of CyberChef's Networking group: Parse Ethernet frame, Parse IPv4 header, Strip IPv4
\ header, Parse TCP, Strip TCP header, Parse UDP, Strip UDP header and Parse TLS record. The ops take hex text or raw
\ bytes (format) and return a text report, one "Name: value" line per field, two spaces of indent per level (the
\ strip ops return the payload bytes). The layouts are RFC 791 (IPv4), RFC 9293 (TCP), RFC 768 (UDP), IEEE 802.3 and
\ 802.1Q/802.1ad (Ethernet) and RFC 8446 (TLS, which also reads TLS 1.0 to 1.2 and SSL 3.0 records).
\
\ FL on the core words with one private primitive, _name (src/prims/packets.ts), the lookup of a number in the name
\ tables of src/packets-names.ts (an FL table would be rebuilt on every call), and one private walk, _walk, for the
\ length-prefixed item sequences of TLS (records, handshake messages, extensions, lists), whose offsets each depend
\ on the length before them and which are quadratic to collect in FL.
\
\ The TLS reader is reusable, for WP 5.54 (JA3, JA3S, JA4, JA4S): the public words tls-records, tls-handshakes and
\ tls-hellos give records and lists (tls-hellos has the decoded extension fields). Each has a list parameter, so
\ none is a catalogue op (a word with only UI-typed parameters would be: RECIPES.md section 2.2 checks the
\ parameters after the first input).
IN: packets

USING: tcpip hex ;

\ ---- bytes and text ----

\ E_COERCE unless n bytes are there from offset p; what names the structure.
: _need ( d:bytes p:int n:int what:str -- )
  p n + d len > [
    what " is cut short: " cat n int>str cat " bytes are needed at offset " cat p int>str cat
    ", " cat d len p - 0 max int>str cat " are left" cat raise:coerce ] when ;

\ 0x and the lower-case hex digits of v, padded to at least n digits.
: _hex0x ( v:int n:int -- str )
  "0x" v n util:pad-hex cat ;

: _mac ( d:bytes p:int -- str )
  d p p 6 + slice bytes>list [ util:byte>hex lower ] map ":" join ;

: _ip ( d:bytes p:int -- str )
  d p p 4 + slice bytes>list [ int>str ] map "." join ;

\ The registry name of a number as " (name)", or nothing when it has none.
: _paren ( table:str key:int -- str )
  table key _name dup len 0 = [ drop "" ] [ " (" swap cat ")" cat ] if ;

\ "1 (Set)" or "0 (Not set)" for a bit.
: _flag ( v:int -- str )
  v 0 = [ "0 (Not set)" ] [ "1 (Set)" ] if ;

\ The payload line (a list of one line, or none): hex of d from p up to end.
: _payload ( d:bytes p:int end:int -- list )
  end p > [ { "Payload (" end p - int>str cat " bytes): " cat d p end slice bytes>hex cat } ] [ { } ] if ;

\ The input of an op: hex text (any white space is ignored) or the raw bytes.
: _input ( data:bytes format:str -- bytes )
  format "hex" = [ data hex:decode ] [ data ] if ;

\ ---- Ethernet ----

\ Is there a VLAN tag protocol identifier (0x8100 or 0x88a8) at offset q?
: _tpid? ( d:bytes q:int -- bool )
  q 2 + d len <=
  [ d q 2 util:be-int dup 33024 = swap 34984 = or ] [ false ] if ;

\ How many VLAN tags follow the two addresses (each is a TPID and a tag control field).
: _tag-count ( d:bytes -- int )
  0 [ dup 4 * 12 + d swap _tpid? ] [ 1 + ] while ;

: _vlan2 ( tpid:int tci:int i:int -- str )
  { "VLAN tag " i 1 + int>str cat ":" cat
    "  TPID: " tpid 4 _hex0x cat tpid 33024 = [ " (802.1Q)" ] [ " (802.1ad)" ] if cat
    "  Priority (PCP): " tci 13 shr int>str cat
    "  Drop eligible (DEI): " tci 12 shr 1 band int>str cat
    "  VLAN ID: " tci 4095 band int>str cat } "\n" join ;

: _vlan ( d:bytes i:int -- str )
  d i 4 * 12 + 4 "Ethernet VLAN tag" _need
  d i 4 * 12 + 2 util:be-int  d i 4 * 14 + 2 util:be-int  i _vlan2 ;

\ The EtherType field, or the length of an IEEE 802.3 frame (up to 1500).
: _type-line ( t:int -- str )
  t 1500 <=
  [ "Length: " t int>str cat " (IEEE 802.3 length field, no EtherType)" cat ]
  [ "EtherType: " t 4 _hex0x cat "ethertype" t _paren cat ] if ;

: _ethernet2 ( d:bytes n:int -- list )
  d n 4 * 12 + 2 "Ethernet frame" _need
  { "Destination MAC: " d 0 _mac cat "Source MAC: " d 6 _mac cat }
  n 0 > [ { 0 n range [ d swap _vlan ] map "\n" join } cat ] when
  { d n 4 * 12 + 2 util:be-int _type-line } cat
  d n 4 * 14 + d len _payload cat ;

: _ethernet ( d:bytes -- str )
  d 0 14 "Ethernet frame" _need
  d d _tag-count _ethernet2 "\n" join ;

: parse-ethernet ( data:bytes format:choice{hex|raw}="hex" -- str )
  "Parse an Ethernet frame (Parse Ethernet frame), given as hex text or raw bytes, without the preamble and the frame check sequence: the destination and sender MAC addresses (lower case, colon separated), every VLAN tag (IEEE 802.1Q TPID 0x8100 or 802.1ad 0x88a8, with the priority, the drop eligible bit and the VLAN ID), the EtherType with its name (IPv4, ARP, IPv6, ...; a value up to 1500 is the length of an IEEE 802.3 frame instead), and the payload as hex. A frame shorter than its header, or a VLAN tag cut short, is E_COERCE with the offset; bad hex is E_COERCE. The layout is Forge's own, in CyberChef's field order." doc
  "Networking" category
  data format _input _ethernet ;

\ ---- IPv4 ----

\ The header length in bytes, after the checks: 20 bytes, version 4, IHL of 5 or more, the whole header there.
: _ipv4-hl2 ( d:bytes hl:int -- int )
  hl 20 < [ "IPv4 header length (IHL) is " hl 4 div int>str cat ", below the minimum of 5" cat raise:coerce ] when
  d 0 hl "IPv4 header" _need
  hl ;

: _ipv4-hl ( d:bytes -- int )
  d 0 20 "IPv4 header" _need
  d 0 nth 4 shr 4 <> [
    "not an IPv4 header: the version is " d 0 nth 4 shr int>str cat ", expected 4" cat raise:coerce ] when
  d d 0 nth 15 band 4 * _ipv4-hl2 ;

\ The length a header-and-payload bytes slice ends at: the total length when it is set and the data holds that many
\ bytes (anything after it is link padding), else the end of the data (a header alone, or a cut-short capture).
: _end ( total:int hl:int n:int -- int )
  total hl >= total n <= and total 0 > and [ total ] [ n ] if ;

\ The length of an option from its length byte, checked: 2 or more and inside the option area.
: _opt-len ( d:bytes p:int end:int what:str -- int )
  p 1 + end >= [ what " option (kind " cat d p nth int>str cat ") at offset " cat p int>str cat
    " has no length byte" cat raise:coerce ] when
  d p 1 + nth
  dup 2 < over p + end > or [
    what " option (kind " cat d p nth int>str cat ") at offset " cat p int>str cat
    " has the length " cat over int>str cat ", which is below 2 or runs past the options" cat raise:coerce ] when ;

\ "  name (kind), length L: hex" for an option with a length byte and data.
: _opt-body ( table:str d:bytes p:int n:int -- str )
  table d p nth _name dup len 0 = [ drop "Unknown" ] when
  "  " swap cat " (" cat d p nth int>str cat "), length " cat n int>str cat
  n 2 > [ ": " cat d p 2 + p n + slice bytes>hex cat ] when ;

: _opt-generic ( table:str d:bytes p:int end:int what:str -- str )
  table d p d p end what _opt-len _opt-body ;

\ The IPv4 options from p up to end, one line each; the walk stops at End of Option List.
: _ip-opts ( d:bytes p:int end:int -- list )
  p end >= [ { } ] [
    d p nth
    dup 0 = [ drop { "  End of Option List (0)" } ] [
    dup 1 = [ drop { "  No Operation (1)" } d p 1 + end recurse cat ] [
    drop { "ip-option" d p end "IPv4" _opt-generic } d p d p 1 + nth + end recurse cat ] if ] if ] if ;

\ "  name: 0 (Not set)" for a named bit.
: _bit-line ( name:str v:int -- str )
  "  " name cat ": " cat v _flag cat ;

: _ipv4-checksum ( d:bytes hl:int -- str )
  d 0 hl slice tcpip:checksum bytes>hex "0000" =
  [ " (valid)" ]
  [ d 0 10 slice #[ 00 00 ] cat d 12 hl slice cat tcpip:checksum bytes>hex
    " (invalid, it should be 0x" swap cat ")" cat ] if ;

: _frag ( v:int -- str )
  v int>str " (" cat v 8 * int>str cat " bytes)" cat ;

: _ipv4-lines ( d:bytes hl:int -- list )
  { "Version: 4"
    "Internet Header Length (IHL): " hl 4 div int>str cat " (" cat hl int>str cat " bytes)" cat
    "Differentiated Services Code Point (DSCP): " d 1 nth 2 shr int>str cat
    "Explicit Congestion Notification (ECN): " d 1 nth 3 band int>str cat
    "Total length: " d 2 2 util:be-int int>str cat " bytes" cat
    "Identification: " d 4 2 util:be-int 4 _hex0x cat " (" cat d 4 2 util:be-int int>str cat ")" cat
    "Flags: " d 6 nth 5 shr 1 _hex0x cat
    "Reserved bit" d 6 nth 7 shr 1 band _bit-line
    "Don't fragment" d 6 nth 6 shr 1 band _bit-line
    "More fragments" d 6 nth 5 shr 1 band _bit-line
    "Fragment offset: " d 6 2 util:be-int 8191 band _frag cat
    "Time-To-Live: " d 8 nth int>str cat
    "Protocol: " d 9 nth int>str cat "ip-protocol" d 9 nth _paren cat
    "Header checksum: " d 10 2 util:be-int 4 _hex0x cat d hl _ipv4-checksum cat
    "Source IP address: " d 12 _ip cat
    "Destination IP address: " d 16 _ip cat }
  hl 20 > [ { "Options:" } cat d 20 hl _ip-opts cat ] when ;

: parse-ipv4 ( data:bytes format:choice{hex|raw}="hex" -- str )
  "Parse an IPv4 header (Parse IPv4 header), given as hex text or raw bytes (the header alone, or the whole datagram, of which only the header is read): version, header length (IHL), DSCP and ECN, total length, identification, the flags (reserved, don't fragment, more fragments) and the fragment offset, time to live, the protocol with its name, the header checksum with a check of it (valid, or invalid with the value it should have), both addresses and, when the header is longer than 20 bytes, the options (end of option list, no operation, and any other with its name, kind, length and data in hex). A header shorter than 20 bytes or than its IHL, a version other than 4, an IHL below 5 and an option whose length byte is missing, below 2 or past the header are E_COERCE. CyberChef shows the same fields; the layout is Forge's own." doc
  "Networking" category
  data format _input dup _ipv4-hl _ipv4-lines "\n" join ;

: _strip-ipv4 ( d:bytes hl:int -- bytes )
  d hl d 2 2 util:be-int hl d len _end slice ;

: strip-ipv4 ( data:bytes format:choice{hex|raw}="hex" -- bytes )
  "Remove the IPv4 header (Strip IPv4 header) and give the payload as bytes: everything after the header, which is IHL times 4 bytes long, up to the total length when that is set and the data holds that many bytes (so link padding after the datagram is dropped; a total length of 0, as with TCP segmentation offload, or one beyond the data, keeps all that is there). The input is hex text or raw bytes. A header cut short, a version other than 4 or an IHL below 5 is E_COERCE." doc
  "Networking" category
  data format _input dup _ipv4-hl _strip-ipv4 ;

\ ---- TCP ----

: _tcp-hl2 ( d:bytes hl:int -- int )
  hl 20 < [ "TCP data offset is " hl 4 div int>str cat ", below the minimum of 5" cat raise:coerce ] when
  d 0 hl "TCP header" _need
  hl ;

\ The header length in bytes, after the checks: 20 bytes, data offset of 5 or more, the whole header there.
: _tcp-hl ( d:bytes -- int )
  d 0 20 "TCP header" _need
  d d 12 nth 4 shr 4 * _tcp-hl2 ;

\ E_COERCE unless an option of a known kind has the length its definition fixes.
: _tcp-fix ( p:int len:int want:int name:str -- )
  len want <> [
    "TCP option " name cat " at offset " cat p int>str cat " has the length " cat len int>str cat
    ", expected " cat want int>str cat raise:coerce ] when ;

: _ws-text ( s:int -- str )
  "shift " s int>str cat s 30 <= [ " (multiplier " cat 1 s shl int>str cat ")" cat ] when ;

: _sack-block ( d:bytes q:int -- str )
  d q 4 util:be-int int>str "-" cat d q 4 + 4 util:be-int int>str cat ;

\ The SACK blocks: left and right edge, 8 bytes each, from p + 2.
: _sack-blocks ( d:bytes p:int len:int -- str )
  len 10 < len 2 - 8 mod 0 <> or [
    "TCP option SACK at offset " p int>str cat " has the length " cat len int>str cat
    ", which is not 2 plus a multiple of 8" cat raise:coerce ] when
  0 len 2 - 8 div range [ 8 * p + 2 + d swap _sack-block ] map ", " join ;

\ One option of a known kind (or the generic line) from its position and checked length.
: _tcp-opt-line ( d:bytes p:int len:int -- str )
  d p nth
  dup 2 = [ drop p len 4 "Maximum Segment Size" _tcp-fix
    "  Maximum Segment Size (2): " d p 2 + 2 util:be-int int>str cat ] [
  dup 3 = [ drop p len 3 "Window Scale" _tcp-fix
    "  Window Scale (3): " d p 2 + nth _ws-text cat ] [
  dup 4 = [ drop p len 2 "SACK Permitted" _tcp-fix "  SACK Permitted (4)" ] [
  dup 5 = [ drop "  SACK (5): " d p len _sack-blocks cat ] [
  dup 8 = [ drop p len 10 "Timestamps" _tcp-fix
    "  Timestamps (8): TSval " d p 2 + 4 util:be-int int>str cat ", TSecr " cat d p 6 + 4 util:be-int int>str cat ] [
  drop "tcp-option" d p len _opt-body ] if ] if ] if ] if ] if ;

: _tcp-step2 ( lines:list p:int d:bytes len:int -- list int )
  lines d p len _tcp-opt-line append p len + ;

\ One option at p: ( lines p ) in, ( lines p ) out; the End of Option List moves p to end.
: _tcp-step ( lines:list p:int d:bytes end:int -- list int )
  d p nth
  dup 0 = [ drop lines "  End of Option List (0)" append end ] [
  dup 1 = [ drop lines "  No-Operation (1)" append p 1 + ] [
  drop lines p d d p end "TCP" _opt-len _tcp-step2 ] if ] if ;

\ The TCP options from p up to end, one line each.
: _tcp-opts ( d:bytes p:int end:int -- list )
  { } p [ dup end < ] [ d end _tcp-step ] while drop ;

: _flag-name ( name:str i:int f:int -- str )
  f 8 i - shr 1 band 1 = [ name ] [ "" ] if ;

: _flags-text ( f:int -- str )
  { "NS" "CWR" "ECE" "URG" "ACK" "PSH" "RST" "SYN" "FIN" } [ f _flag-name ] mapi [ len 0 > ] filter
  dup len 0 = [ drop "none" ] [ ", " join ] if ;

: _tcp-bit ( name:str f:int i:int -- str )
  name f 8 i - shr 1 band _bit-line ;

: _tcp-flag-lines ( f:int -- list )
  { "Flags: " f 3 _hex0x cat " (" cat f _flags-text cat ")" cat
    "NS" f 0 _tcp-bit "CWR" f 1 _tcp-bit "ECE" f 2 _tcp-bit "URG" f 3 _tcp-bit "ACK" f 4 _tcp-bit
    "PSH" f 5 _tcp-bit "RST" f 6 _tcp-bit "SYN" f 7 _tcp-bit "FIN" f 8 _tcp-bit } ;

: _tcp-lines ( d:bytes hl:int -- list )
  { "Source port: " d 0 2 util:be-int int>str cat
    "Destination port: " d 2 2 util:be-int int>str cat
    "Sequence number: " d 4 4 util:be-int int>str cat
    "Acknowledgement number: " d 8 4 util:be-int int>str cat
    "Data offset: " hl 4 div int>str cat " (" cat hl int>str cat " bytes)" cat
    "Reserved bits: " d 12 nth 1 shr 7 band int>str cat }
  d 12 nth 1 band 256 * d 13 nth + _tcp-flag-lines cat
  { "Window size: " d 14 2 util:be-int int>str cat
    "Checksum: " d 16 2 util:be-int 4 _hex0x cat
    "Urgent pointer: " d 18 2 util:be-int int>str cat } cat
  hl 20 > [ { "Options:" } cat d 20 hl _tcp-opts cat ] when
  d hl d len _payload cat ;

: parse-tcp ( data:bytes format:choice{hex|raw}="hex" -- str )
  "Parse a TCP segment (Parse TCP), given as hex text or raw bytes: sender and receiver port, sequence and acknowledgement number, the data offset (the header length in 32-bit words), the reserved bits, the nine flags (NS, CWR, ECE, URG, ACK, PSH, RST, SYN, FIN, with their names in the summary), window size, checksum (as stored: it is not checked, which needs the IP addresses), urgent pointer, the options decoded (maximum segment size, window scale, SACK permitted, SACK blocks, timestamps, No-Operation, End of Option List; any other kind with its name when known, its kind, length and data in hex) and the payload as hex. A header shorter than 20 bytes or than its data offset, a data offset below 5 and an option with a missing, short or overlong length byte, or a known kind with the wrong length, are E_COERCE with the offset. The layout is Forge's own, in CyberChef's field order." doc
  "Networking" category
  data format _input dup _tcp-hl _tcp-lines "\n" join ;

: _strip-tcp ( d:bytes hl:int -- bytes )
  d hl d len slice ;

: strip-tcp ( data:bytes format:choice{hex|raw}="hex" -- bytes )
  "Remove the TCP header (Strip TCP header) and give the payload as bytes: everything after the header, which is the data offset times 4 bytes long. The input is hex text or raw bytes. A header cut short or a data offset below 5 is E_COERCE." doc
  "Networking" category
  data format _input dup _tcp-hl _strip-tcp ;

\ ---- UDP ----

\ The UDP length field, after the checks: 8 bytes there, and a length of 0 (a jumbogram) or at least 8.
: _udp-length ( d:bytes -- int )
  d 0 8 "UDP header" _need
  d 4 2 util:be-int
  dup 0 <> over 8 < and [ "UDP length is " over int>str cat ", below the 8-byte header" cat raise:coerce ] when ;

: _udp-lines ( d:bytes length:int -- list )
  { "Source port: " d 0 2 util:be-int int>str cat
    "Destination port: " d 2 2 util:be-int int>str cat
    "Length: " length int>str cat " bytes" cat
    length d len > [ " (only " cat d len int>str cat " are present)" cat ] when
    "Checksum: " d 6 2 util:be-int 4 _hex0x cat }
  d 8 length 8 d len _end _payload cat ;

: parse-udp ( data:bytes format:choice{hex|raw}="hex" -- str )
  "Parse a UDP datagram (Parse UDP), given as hex text or raw bytes: sender and receiver port, the length (header and data; a length beyond the data is shown with the number of bytes that are present, and a length of 0 means up to the end), the checksum as stored (it is not checked, which needs the IP addresses) and the payload as hex, up to the length. A header shorter than 8 bytes or a length between 1 and 7 is E_COERCE. The layout is Forge's own, in CyberChef's field order." doc
  "Networking" category
  data format _input dup _udp-length _udp-lines "\n" join ;

: _strip-udp ( d:bytes length:int -- bytes )
  d 8 length 8 d len _end slice ;

: strip-udp ( data:bytes format:choice{hex|raw}="hex" -- bytes )
  "Remove the UDP header (Strip UDP header) and give the payload as bytes: the 8-byte header is dropped, and so is anything after the length the header declares (link padding); a length of 0 or beyond the data keeps all that is there. The input is hex text or raw bytes. A header shorter than 8 bytes or a length between 1 and 7 is E_COERCE." doc
  "Networking" category
  data format _input dup _udp-length _strip-udp ;

\ ---- TLS records and handshake messages (RFC 8446 section 5 and 4; the same layouts for TLS 1.0 to 1.2 and SSL 3.0) ----
\ A record is { type version length offset fragment }, a handshake message { type length offset complete body }.

\ The most a record may hold: 2^14 plus the 2048 bytes of expansion that TLS 1.2 allows (TLS 1.3 allows 256).
: _tls-max ( -- int )
  18432 ;

\ E_COERCE unless the five header bytes at p look like a TLS record: a content type of 20 to 24, a version of 3.x
\ and a length that fits.
: _tls-check ( data:bytes p:int -- )
  data p nth 20 24 util:between? not [
    "not a TLS record: the content type is " data p nth int>str cat " at offset " cat p int>str cat
    " (expected 20 to 24)" cat raise:coerce ] when
  data p 1 + nth 3 <> [
    "not a TLS record: the version at offset " p 1 + int>str cat " is " cat data p 1 + 2 util:be-int 4 _hex0x cat
    " (expected 0x03xx)" cat raise:coerce ] when
  data p 3 + nth 72 > [
    "the TLS record at offset " p int>str cat " declares " cat data p 3 + 2 util:be-int int>str cat
    " bytes, above the limit of " cat _tls-max int>str cat raise:coerce ] when
  data p 3 + nth 72 = data p 4 + nth 0 > and [
    "the TLS record at offset " p int>str cat " declares " cat data p 3 + 2 util:be-int int>str cat
    " bytes, above the limit of " cat _tls-max int>str cat raise:coerce ] when ;

: _tls-record3 ( data:bytes p:int n:int -- record )
  { { "type" data p nth }
    { "version" data p 1 + 2 util:be-int }
    { "length" n }
    { "offset" p }
    { "fragment" data p 5 + dup n + slice } } >record ;

: _tls-record ( data:bytes p:int -- record )
  data p _tls-check
  data p data p 3 + 2 util:be-int _tls-record3 ;

: _records ( data:bytes -- list )
  data len 0 =
  [ { } ]
  [ data 0 5 "TLS record header" _need
    data 0 _tls-check
    data 0 data len 3 2 false "TLS record" _walk
    [ data swap _tls-record ] map ] if ;

\ The elements of items whose key is one of the numbers in wanted (all of them when wanted is empty).
: _keep ( items:list key:str wanted:list -- list )
  wanted len 0 = [ items ] [ items [ key get wanted swap util:contains? ] filter ] if ;

: tls-records ( data:bytes types:list -- list )
  "The TLS records in data, in order, as a list of records with the keys type (the content type, 20 to 24), version (the number: 0x0301 is TLS 1.0), length, offset (of the record header in data) and fragment (the bytes after the header). types is a list of the content types to keep (22 is Handshake), empty to keep every record. Empty data gives an empty list. A header that is not a TLS record (a content type outside 20 to 24, a major version other than 3, a length above 18432), one that is cut short and a record whose fragment is cut short are E_COERCE with the offset. Nothing is allocated from a length. A shared word of the packets vocabulary, for WP 5.54 (JA3 and JA4); it has a list parameter so that it is not a catalogue op." doc
  data _records "type" types _keep ;

\ A handshake message of the fragment f at p with the length n from its header: { type length offset complete body }.
: _hs3 ( f:bytes p:int n:int -- record )
  { { "type" f p nth }
    { "length" n }
    { "offset" p }
    { "complete" p 4 + n + f len <= }
    { "body" f p 4 + p 4 + n + f len min slice } } >record ;

: _hs-record ( f:bytes p:int -- record )
  p 4 + f len >
  [ { { "type" -1 } { "length" 0 } { "offset" p } { "complete" false } { "body" f p f len slice } } >record ]
  [ f p f p 1 + 3 util:be-int _hs3 ] if ;

: _handshakes ( f:bytes -- list )
  f 0 f len 1 3 true "handshake message" _walk [ f swap _hs-record ] map ;

: tls-handshakes ( rec:record types:list -- list )
  "The handshake messages in the fragment of a TLS record of content type 22 (a record from tls-records), in order, as records with the keys type (the handshake type; -1 for fewer than four bytes of a header at the end), length (the declared length), offset (in the fragment), complete (the message is wholly in this fragment) and body (the bytes of it that are in the fragment). types is a list of the handshake types to keep (1 ClientHello, 2 ServerHello), empty to keep every message. A message that goes on in the next record is the last one and has complete false; a record that continues such a message is read as new messages (messages are not joined across records). A record of another content type is E_RANGE. A shared word of the packets vocabulary, for WP 5.54." doc
  rec "type" get 22 <> [ "tls-handshakes needs a record of content type 22 (Handshake)" raise:range ] when
  rec "fragment" get _handshakes "type" types _keep ;

\ ---- hello messages ----

\ The vector at p with a length prefix of w bytes: ( data next-offset ).
: _vec3 ( b:bytes p:int w:int n:int what:str -- bytes int )
  b p w + n what _need
  b p w + dup n + slice p w + n + ;

: _vec ( b:bytes p:int w:int what:str -- bytes int )
  b p w what _need
  b p w b p w util:be-int what _vec3 ;

: _put2 ( r:record key:str data:any q:int -- record int )
  r key data put q ;

\ ( r p ) in, ( r q ) out: the vector at p, stored under key.
: _step-vec ( r:record p:int key:str b:bytes w:int what:str -- record int )
  r key b p w what _vec _put2 ;

\ A vector of 16-bit numbers as a list (the length must be even).
: _u16-list ( data:bytes what:str -- list )
  data len 2 mod 0 <> [ what ": a list of 16-bit numbers has the odd length " cat data len int>str cat raise:coerce ] when
  0 data len 2 div range [ 2 * data swap 2 util:be-int ] map ;

: _step-u16s ( r:record p:int key:str b:bytes what:str -- record int )
  r key b p 2 what _vec swap what _u16-list swap _put2 ;

: _step-u8s ( r:record p:int key:str b:bytes what:str -- record int )
  r key b p 1 what _vec swap bytes>list swap _put2 ;

\ One extension: { type data offset }.
: _ext ( b:bytes p:int -- record )
  { { "type" b p 2 util:be-int }
    { "data" b p 4 + dup b p 2 + 2 util:be-int + slice }
    { "offset" p } } >record ;

: _exts3 ( r:record b:bytes p:int el:int -- record )
  p 2 + el + b len <> [
    "the extensions block at offset " p int>str cat " declares " cat el int>str cat " bytes but "
    cat b len p - 2 - int>str cat " follow it in the message" cat raise:coerce ] when
  r "extensions" b p 2 + dup el + 2 2 false "extension" _walk [ b swap _ext ] map put
  "has-extensions" true put ;

\ ( r p ) in, the finished record out: the extensions block if the message goes on.
: _step-exts ( r:record p:int b:bytes -- record )
  p b len =
  [ r "extensions" { } put "has-extensions" false put ]
  [ b p 2 "hello message" _need
    r b p b p 2 util:be-int _exts3 ] if ;

: _hrr-random ( -- bytes )
  #[ cf 21 ad 74 e5 9a 61 11 be 1d 8c 02 1e 65 b8 91 c2 a2 11 16 7a bb 8c 5e 07 9e 09 e2 c8 a8 33 9c ] ;

\ version, random, session ID (up to 32 bytes) of both hellos: ( record next-offset ).
: _hello-head ( b:bytes kind:str -- record int )
  b 0 35 kind _need
  b 34 nth 32 > [ kind ": the session ID length is " cat b 34 nth int>str cat ", above 32" cat raise:coerce ] when
  { { "kind" kind } { "version" b 0 2 util:be-int } { "random" b 2 34 slice }
    { "hrr" b 2 34 slice _hrr-random = kind "server_hello" = and } } >record
  34 "session-id" b 1 kind _step-vec ;

: _client ( b:bytes -- record )
  b "client_hello" _hello-head
  "ciphers" b "ClientHello cipher suites" _step-u16s
  "compression" b "ClientHello compression methods" _step-u8s
  b _step-exts ;

: _step-cipher ( r:record p:int b:bytes -- record int )
  b p 3 "ServerHello" _need
  r "ciphers" { b p 2 util:be-int } put "compression" { b p 2 + nth } put p 3 + ;

: _server ( b:bytes -- record )
  b "server_hello" _hello-head b _step-cipher b _step-exts ;

: _hello ( msg:record -- record )
  msg "complete" get not [
    "the handshake message at offset " msg "offset" get int>str cat " is not wholly in this record (" cat
    msg "body" get len int>str cat " of " cat msg "length" get int>str cat " bytes)" cat raise:coerce ] when
  msg "type" get dup 1 =
  [ drop msg "body" get _client ]
  [ 2 = [ msg "body" get _server ] [ "not a ClientHello or ServerHello" raise:coerce ] if ] if ;

\ The extensions of a hello with this type number, in order.
: _exts-of ( h:record type:int -- list )
  h "extensions" get [ "type" get type = ] filter ;

: _ext-what ( ext:record -- str )
  "the " "tls-extension" ext "type" get _name dup len 0 = [ drop "unknown" ] when cat " extension (type " cat
  ext "type" get int>str cat ") at offset " cat ext "offset" get int>str cat ;

\ The vector in the data of an extension, after the length prefix of w bytes (w of 0: no prefix).
: _ext-vec2 ( ext:record d:bytes w:int -- bytes )
  w 0 = [ d ] [
    d 0 w util:be-int d len w - <> [ ext _ext-what ": the length prefix does not match the data" cat raise:coerce ] when
    d w d len slice ] if ;

: _ext-vec ( ext:record w:int -- bytes )
  ext "data" get len w < [ ext _ext-what " is cut short" cat raise:coerce ] when
  ext ext "data" get w _ext-vec2 ;

\ The 16-bit numbers of an extension: a vector with a length prefix of prefix bytes (0: none, the data are the numbers).
: _u16s ( ext:record prefix:int -- list )
  ext prefix _ext-vec ext _ext-what _u16-list ;

: _u8s ( ext:record prefix:int -- list )
  ext prefix _ext-vec bytes>list ;

: _alpn-name ( v:bytes p:int -- str )
  v p nth 0 = [ "an application_layer_protocol_negotiation protocol name at offset " p int>str cat " is empty" cat raise:coerce ] when
  v p 1 + dup v p nth + slice bytes>latin1 ;

: _alpn ( v:bytes -- list )
  v 0 v len 0 1 false "protocol name" _walk [ v swap _alpn-name ] map ;

: _ext-alpn ( ext:record -- list )
  ext 2 _ext-vec _alpn ;

: _sni-name ( v:bytes p:int -- str )
  v p 3 + dup v p 1 + 2 util:be-int + slice bytes>latin1 ;

: _sni ( v:bytes -- list )
  v 0 v len 1 2 false "server name" _walk [ v swap nth 0 = ] filter [ v swap _sni-name ] map ;

\ The host names of a server_name extension (a ServerHello's is empty: no names).
: _ext-sni ( ext:record -- list )
  ext "data" get len 0 = [ { } ] [ ext 2 _ext-vec _sni ] if ;

: _ks-entry ( v:bytes p:int -- record )
  { { "group" v p 2 util:be-int } { "key" v p 4 + dup v p 2 + 2 util:be-int + slice } } >record ;

: _ks-list ( v:bytes -- list )
  v 0 v len 2 2 false "key share entry" _walk [ v swap _ks-entry ] map ;

: _ks-server ( d:bytes -- list )
  d len 2 = [ { { { "group" d 0 2 util:be-int } { "key" #[ ] } } >record } ] [ d _ks-list ] if ;

\ The key shares of a key_share extension: a ClientHello's list, or a ServerHello's single share (two bytes: the
\ group of a HelloRetryRequest, with an empty key).
: _key-shares ( ext:record client:bool -- list )
  client [ ext 2 _ext-vec _ks-list ] [ ext "data" get _ks-server ] if ;

\ The first extension of this type, as a list of zero or one; each field below decodes it.
: _first-of ( h:record type:int -- list )
  h type _exts-of ;

: _f-sni ( h:record -- list )
  h 0 _first-of dup len 0 = [ drop { } ] [ 0 nth _ext-sni ] if ;

: _f-alpn ( h:record -- list )
  h 16 _first-of dup len 0 = [ drop { } ] [ 0 nth _ext-alpn ] if ;

: _f-groups ( h:record -- list )
  h 10 _first-of dup len 0 = [ drop { } ] [ 0 nth 2 _u16s ] if ;

: _f-points ( h:record -- list )
  h 11 _first-of dup len 0 = [ drop { } ] [ 0 nth 1 _u8s ] if ;

: _f-sigs ( h:record -- list )
  h 13 _first-of dup len 0 = [ drop { } ] [ 0 nth 2 _u16s ] if ;

: _f-versions ( h:record -- list )
  h 43 _first-of dup len 0 = [ drop { } ] [
    0 nth h "kind" get "client_hello" = [ 1 ] [ 0 ] if _u16s ] if ;

: _f-psk ( h:record -- list )
  h 45 _first-of dup len 0 = [ drop { } ] [ 0 nth 1 _u8s ] if ;

: _f-shares ( h:record -- list )
  h 51 _first-of dup len 0 = [ drop { } ] [ 0 nth h "kind" get "client_hello" = _key-shares ] if ;

\ The hello record with the fields JA3 and JA4 read, decoded from its extensions.
: _with-fields ( h:record -- record )
  h
  "ext-types" h "extensions" get [ "type" get ] map put
  "sni" h _f-sni put
  "alpn" h _f-alpn put
  "groups" h _f-groups put
  "point-formats" h _f-points put
  "sig-algs" h _f-sigs put
  "versions" h _f-versions put
  "psk-modes" h _f-psk put
  "key-shares" h _f-shares put ;

: _want ( kinds:list -- list )
  kinds len 0 = [ { 1 2 } ] [ kinds ] if ;

: tls-hellos ( data:bytes kinds:list -- list )
  "Every ClientHello or ServerHello in the TLS records of data (bytes), in order, as records. kinds is a list of the handshake types to keep: 1 for ClientHello, 2 for ServerHello, empty for both. The keys are kind (client_hello or server_hello), version (the legacy version number), random (32 bytes), session-id (bytes), ciphers (the cipher suite numbers in order; a ServerHello has the one it chose), compression (the compression method numbers), extensions (records with type, data and offset), has-extensions (false when the message ends after the compression methods, as old hellos do), hrr (true for a ServerHello with the random that marks a HelloRetryRequest), and decoded from the extensions: ext-types (their numbers in order), sni (host names), alpn (protocol names), groups (supported_groups numbers), point-formats (ec_point_formats), sig-algs (signature_algorithms), versions (supported_versions: a ClientHello's list, a ServerHello's selected version), psk-modes and key-shares (records with group and key); each is an empty list when the extension is absent. GREASE values are kept as they are. No hello gives an empty list. A hello that is cut short or goes on in the next record, a session ID over 32 bytes, an odd cipher suite list, extensions that do not fill the rest of the message, bytes after them and a damaged decoded extension are E_COERCE with the offset in the message; so is malformed record data (see tls-records). A shared word of the packets vocabulary, for WP 5.54 (JA3, JA3S, JA4, JA4S); it has a list parameter so that it is not a catalogue op." doc
  data _records [ "type" get 22 = ] filter
  [ "fragment" get _handshakes "type" kinds _want _keep ] map
  [ len 0 > ] filter util:list-flatten
  [ _hello _with-fields ] map ;

\ ---- the report of a TLS record ----

\ Every line of the text s with the text pad in front.
: _ind2 ( s:str pad:str -- str )
  s "\n" split [ pad swap cat ] map "\n" join ;

\ Every line of the text s indented by n levels of two spaces.
: _ind ( s:str n:int -- str )
  s "  " n util:repeat-str _ind2 ;

\ The name of a number in a table, or "unknown", and the number in hex: "TLS_AES_128_GCM_SHA256 (0x1301)".
: _named16 ( table:str v:int -- str )
  table v _name dup len 0 = [ drop "unknown" ] when " (" cat v 4 _hex0x cat ")" cat ;

\ The same for a number of one byte, in decimal: "null (0)".
: _named8 ( table:str v:int -- str )
  table v _name dup len 0 = [ drop "unknown" ] when " (" cat v int>str cat ")" cat ;

: _hex-or-empty ( b:bytes -- str )
  b len 0 = [ "(empty)" ] [ b bytes>hex ] if ;

\ "Label: a, b, c" for a list of strings.
: _list-line ( label:str items:list -- str )
  label items ", " join cat ;

: _u16-line ( label:str table:str ext:record prefix:int -- str )
  label ext prefix _u16s [ table swap _named16 ] map _list-line ;

: _u8-line ( label:str table:str ext:record prefix:int -- str )
  label ext prefix _u8s [ table swap _named8 ] map _list-line ;

: _ks-text ( ks:record -- str )
  "tls-group" ks "group" get _named16 ", key exchange length " cat ks "key" get len int>str cat ;

: _empty-ext ( ext:record -- bool )
  ext "data" get len 0 = ;

\ The key shares of a key_share extension as text.
: _ks-lines ( ext:record client:bool -- str )
  ext client _key-shares [ _ks-text ] map
  client
  [ dup len 0 = [ drop "Key shares: (none)" ] [ [ "  " swap cat ] map "\n" join "Key shares:\n" swap cat ] if ]
  [ ", " join "Key share: " swap cat ] if ;

\ The decoded lines of an extension, one string of lines; client is true in a ClientHello.
: _ext-body2 ( ext:record client:bool t:int -- str )
  t 0 = [ "Server name: " ext _ext-sni ", " join cat ] [
  t 10 = [ "Supported groups: " "tls-group" ext 2 _u16-line ] [
  t 11 = [ "EC point formats: " "tls-point-format" ext 1 _u8-line ] [
  t 13 = t 50 = or [ "Signature algorithms: " "tls-signature" ext 2 _u16-line ] [
  t 16 = [ "Protocols: " ext _ext-alpn _list-line ] [
  t 27 = [ "Certificate compression algorithms: " "tls-cert-compression" ext 1 _u16-line ] [
  t 28 = [ "Record size limit: " ext 0 _u16s 0 nth int>str cat ] [
  t 43 = [
    client
    [ "Supported versions: " "tls-version" ext 1 _u16-line ]
    [ "Selected version: " "tls-version" ext 0 _u16-line ] if ] [
  t 45 = [ "PSK key exchange modes: " "tls-psk-mode" ext 1 _u8-line ] [
  t 51 = [ ext client _ks-lines ] [
  t 21 = [ "Padding: " ext "data" get len int>str cat " bytes" cat ] [
  t 35 = [ "Session ticket: " ext "data" get len int>str cat " bytes" cat ] [
  "Data: " ext "data" get bytes>hex cat ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ "server_name (0), length 11" and the decoded data indented below it.
: _ext-text ( ext:record client:bool -- str )
  "tls-extension" ext "type" get _name dup len 0 = [ drop "unknown" ] when
  " (" cat ext "type" get int>str cat "), length " cat ext "data" get len int>str cat
  ext "data" get len 0 > [ "\n" cat ext client ext "type" get _ext-body2 1 _ind cat ] when ;

: _ciphers-text ( h:record -- str )
  h "kind" get "client_hello" =
  [ "Cipher suites (" h "ciphers" get len int>str cat "):" cat
    h "ciphers" get len 0 > [ "\n" cat h "ciphers" get [ "tls-cipher" swap _named16 ] map "\n" join 1 _ind cat ] when ]
  [ "Cipher suite: " "tls-cipher" h "ciphers" get 0 nth _named16 cat ] if ;

: _compression-text ( h:record -- str )
  h "kind" get "client_hello" =
  [ "Compression methods (" h "compression" get len int>str cat "): " cat
    h "compression" get [ "tls-compression" swap _named8 ] map ", " join cat ]
  [ "Compression method: " "tls-compression" h "compression" get 0 nth _named8 cat ] if ;

: _extensions-text ( h:record -- str )
  h "has-extensions" get not
  [ "Extensions: none" ]
  [ "Extensions (" h "extensions" get len int>str cat "):" cat
    h "extensions" get len 0 > [
      "\n" cat h "extensions" get [ h "kind" get "client_hello" = _ext-text ] map "\n" join 1 _ind cat ] when ] if ;

: _hello-text ( h:record -- str )
  "Version: " "tls-version" h "version" get _named16 cat "\n" cat
  "Random: " h "random" get bytes>hex cat cat
  h "hrr" get [ " (the HelloRetryRequest random: SHA-256 of HelloRetryRequest)" cat ] when "\n" cat
  "Session ID: " h "session-id" get _hex-or-empty cat cat "\n" cat
  h _ciphers-text cat "\n" cat
  h _compression-text cat "\n" cat
  h _extensions-text cat ;

\ A handshake message: its type and length, and for a hello the fields below.
: _hs-head ( m:record -- str )
  m "type" get -1 =
  [ "Handshake: cut short (" m "body" get len int>str cat " bytes of a header)" cat ]
  [ "Handshake: " "tls-handshake" m "type" get _named8 cat ", length " cat m "length" get int>str cat
    m "complete" get not [
      " (only " cat m "body" get len int>str cat " bytes are in this record; the message goes on in the next one)" cat ] when ] if ;

: _hs-text ( m:record -- str )
  m _hs-head
  m "complete" get m "type" get dup 1 = swap 2 = or and
  [ "\n" cat m _hello _hello-text 1 _ind cat ] when ;

: _level ( v:int -- str )
  v 1 = [ "warning (1)" ] [ v 2 = [ "fatal (2)" ] [ "unknown (" v int>str cat ")" cat ] if ] if ;

: _alert-text ( f:bytes -- str )
  f len 2 =
  [ "Alert: " f 0 nth _level cat ", " cat "tls-alert" f 1 nth _named8 cat ]
  [ "Alert: " f len int>str cat " bytes (encrypted, or not a valid alert)" cat ] if ;

: _handshake-text ( f:bytes -- str )
  f _handshakes dup len 0 =
  [ drop "Handshake: an empty fragment" ]
  [ [ _hs-text ] map "\n" join ] if ;

: _fragment-text ( rec:record -- str )
  rec "type" get rec "fragment" get
  over 22 = [ nip _handshake-text ] [
  over 21 = [ nip _alert-text ] [
  over 23 = [ nip len int>str "Application data: " swap cat " bytes (encrypted)" cat ] [
  over 20 = [ nip "Change cipher spec: " swap bytes>hex cat ] [
  nip len int>str "Heartbeat: " swap cat " bytes" cat ] if ] if ] if ] if ;

: _record-text ( rec:record i:int -- str )
  "Record " i 1 + int>str cat
  { "Content type: " "tls-content" rec "type" get _named8 cat
    "Version: " "tls-version" rec "version" get _named16 cat
    "Length: " rec "length" get int>str cat } "\n" join
  "\n" cat rec _fragment-text cat
  1 _ind "\n" swap cat cat ;

: _hello-msg? ( m:record -- bool )
  m "complete" get m "type" get dup 1 = swap 2 = or and ;

\ The hello messages in the records, in order (the handshake records are few, the other records only cost the filter).
: _hello-msgs ( records:list -- list )
  records [ "type" get 22 = ] filter
  [ "fragment" get _handshakes [ _hello-msg? ] filter ] map
  [ len 0 > ] filter util:list-flatten ;

\ Decode every extension of a hello (the report would raise the same errors, but too deep in the call stack: an
\ error reports only its 16 innermost frames, and the recipe step is found from the outermost one).
: _check-ext ( ext:record client:bool -- )
  ext client ext "type" get _ext-body2 drop ;

: _check-hello ( h:record -- )
  h "extensions" get [ h "kind" get "client_hello" = _check-ext ] each ;

: parse-tls ( data:bytes format:choice{hex|raw}="hex" -- str )
  "Parse TLS records (Parse TLS record), one or more in a row, given as hex text or raw bytes: for each record the content type (ChangeCipherSpec, Alert, Handshake, ApplicationData, Heartbeat), the version and the length; an alert with its level and description; a handshake record with each message (type and length) and, for a ClientHello or ServerHello, the version, the random, the session ID, the cipher suites with their registry names, the compression methods and the extensions with their names, and decoded for server_name, supported_groups, ec_point_formats, signature_algorithms, ALPN, supported_versions, psk_key_exchange_modes, key_share, compress_certificate, record_size_limit, padding and session_ticket (any other extension as hex). Records are separated by a blank line. Reads SSL 3.0, TLS 1.0 to 1.3 records; DTLS and SSL 2.0 are not TLS records. Empty input, a header that is not a TLS record (content type outside 20 to 24, a major version other than 3, a length above 18432), a cut-short record, hello or extension are E_COERCE with the offset. Handshake messages are not joined across records: a message that goes on in the next record shows only what is in the first. The layout is Forge's own." doc
  "Networking" category
  data format _input _records
  dup len 0 = [ "no TLS record: the input is empty" raise:coerce ] when
  dup _hello-msgs [ _hello ] map [ _check-hello ] each
  [ _record-text ] mapi "\n\n" join ;

META: parse-ethernet
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:parse-ipv4 packets:parse-tcp packets:parse-udp ;
;

META: parse-ipv4
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:strip-ipv4 packets:parse-tcp packets:parse-udp packets:parse-ethernet ;
;

META: strip-ipv4
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:parse-ipv4 packets:strip-tcp packets:strip-udp ;
;

META: parse-tcp
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:strip-tcp packets:parse-ipv4 packets:parse-tls ;
;

META: strip-tcp
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:parse-tcp packets:strip-ipv4 http:strip-headers ;
;

META: parse-udp
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:strip-udp packets:parse-ipv4 ;
;

META: strip-udp
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:parse-udp packets:strip-ipv4 ;
;

META: parse-tls
  param format "How the input is written: hex text (any white space is ignored) or raw bytes." ;
  see-also packets:parse-tcp ;
;
