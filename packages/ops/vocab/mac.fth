\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ mac: Format MAC addresses (WP 5.53). A MAC address is read as twelve hex digits (colons, hyphens and dots between
\ them are dropped) and written in the notations CyberChef offers: plain, hyphens, colons, Cisco dots and the
\ modified EUI-64 interface identifier of an IPv6 address. All FL.
IN: mac

\ The twelve hex digits of a MAC address, lower case, from any of the usual notations.
: _clean ( s:str -- str )
  s lower "[:.-]" "" "" regex:replace
  dup "^[0-9a-f]{12}$" "" regex:test not [ "not a MAC address (12 hex digits): " s cat raise:coerce ] when ;

: _chunks ( s:str n:int sep:str -- str )
  s n util:str-chunks sep join ;

\ The EUI-64 interface identifier: ff fe in the middle, the universal/local bit of the first byte flipped (RFC 4291 appendix A).
: _interface-id ( clean:str -- str )
  clean 0 6 slice "fffe" cat clean 6 12 slice cat
  dup 0 2 slice 16 str>int-radix 2 bxor 2 util:pad-hex swap 2 16 slice cat
  4 ":" _chunks ;

\ The enabled notations of one address, in the order plain, hyphens, colons, Cisco, IPv6.
: _notations ( clean:str none:bool dash:bool colon:bool cisco:bool v6:bool -- list )
  { clean clean 2 "-" _chunks clean 2 ":" _chunks clean 4 "." _chunks clean _interface-id }
  { none dash colon cisco v6 }
  zip [ 1 nth ] filter [ 0 nth ] map ;

: _both ( f:str -- list )
  { f f upper } ;

\ Both cases (lower, then upper), upper only, or lower only.
: _cased ( forms:list letters:str -- list )
  letters "both" =
  [ forms [ _both ] map util:list-flatten ]
  [ letters "upper" = [ forms [ upper ] map ] [ forms ] if ] if ;

: _one ( s:str letters:str none:bool dash:bool colon:bool cisco:bool v6:bool -- str )
  s _clean none dash colon cisco v6 _notations letters _cased
  dup len 0 = [ drop "" ] [ "\n" join "\n" cat ] if ;

: format ( data:str output-case:choice{both|upper|lower}="both" no-delimiter:bool=true dash-delimiter:bool=true colon-delimiter:bool=true cisco-style:bool=false ipv6-interface-id:bool=false -- str )
  "Shows each MAC address in several notations. The input is addresses separated by commas, white space or line feeds (empty pieces are skipped), each as twelve hex digits with or without colons, hyphens or dots between them. For each address the output lists the chosen notations one per line, in this order: plain (001a2b3c4d5e), hyphens (00-1a-2b-3c-4d-5e), colons (00:1a:2b:3c:4d:5e), Cisco dots (001a.2b3c.4d5e) and the IPv6 interface identifier (021a:2bff:fe3c:4d5e: ff fe in the middle and the universal/local bit flipped, RFC 4291 appendix A); with output-case both every notation is given in lower case and then in upper case. A blank line ends each address, so the output ends with a line feed. Text that is not a MAC address is E_COERCE (CyberChef has no checks). Empty input gives empty output." doc
  "Networking" category
  data "[,\\s]+" "" regex:split [ len 0 > ] filter
  [ output-case no-delimiter dash-delimiter colon-delimiter cisco-style ipv6-interface-id _one ] map
  "\n" join ;

META: format
  use-when "You have a MAC address written one way, such as a switch's dotted form, and want it in the other common notations." ;
  param output-case "Which letter case to show: both (lower then upper), upper or lower." ;
  param no-delimiter "Show the plain twelve digits." ;
  param dash-delimiter "Show 00-1a-2b-3c-4d-5e." ;
  param colon-delimiter "Show 00:1a:2b:3c:4d:5e." ;
  param cisco-style "Show the Cisco notation 001a.2b3c.4d5e." ;
  param ipv6-interface-id "Show the modified EUI-64 interface identifier for an IPv6 address." ;
  see-also extract:mac-addresses ip:transition ;
  link "https://en.wikipedia.org/wiki/MAC_address" "MAC address on Wikipedia" ;
;
