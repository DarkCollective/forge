\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ uri: Parse URI (WP 5.53): the parts of a URI (RFC 3986) printed in CyberChef's layout: protocol, auth, host name,
\ port, path, the query arguments decoded one per line, and the fragment. All FL over the regex words.
IN: uri

\ The text of a URI component with its %XX escapes decoded as UTF-8; text that is not valid UTF-8 or has a bare % is
\ kept as it is (what URLSearchParams does with the bytes it cannot read). plus: read + as a space.
: _decode ( s:str plus:bool -- str )
  [ s str>bytes plus url:decode bytes>str ]
  [ drop plus [ s "+" split " " join ] [ s ] if ] try ;

: _key ( piece:str -- str )
  piece "=" split 0 nth true _decode ;

: _val ( piece:str -- str )
  piece "=" split dup len 1 > [ 1 over len slice "=" join true _decode ] [ drop "" ] if ;

\ An argument given twice shows its values joined by commas, in the order of the first time its name appeared. This is
\ done with two stable sorts, not a record filled one argument at a time (every put copies the record: 8,000 distinct
\ names took 8 s): sort the positions by name, cut the sorted names into runs, put the runs back in order of position.

\ The positions in the sorted names where a new name starts. prevs is -1 and then the names: prevs[i] is the name before
\ skeys[i], and the first has none (a number is never equal to a name).
: _run-starts ( skeys:list prevs:list -- list )
  0 skeys len range [ dup skeys swap nth swap prevs swap nth <> ] filter ;

: _ends ( starts:list n:int -- list )
  starts 1 starts len slice n append ;

: _group-values ( order:list vs:list from:int to:int -- str )
  order from to slice [ vs swap nth ] map "," join ;

\ A run: { first position, name, values joined }.
: _make-run ( order:list ks:list vs:list from:int to:int -- list )
  { order from nth ks order from nth nth order vs from to _group-values } ;

: _run-of ( pair:list order:list ks:list vs:list -- list )
  order ks vs pair 0 nth pair 1 nth _make-run ;

: _runs ( order:list ks:list vs:list -- list )
  order [ ks swap nth ] map
  dup { -1 } swap cat _run-starts
  dup order len _ends zip
  [ order ks vs _run-of ] map ;

: _arg-line ( run:list width:int -- str )
  "\t" run 1 nth cat " " width run 1 nth len - util:repeat-str cat
  run 2 nth dup len 0 > [ " = " swap cat cat ] [ drop ] if "\n" cat ;

: _lines ( sorted:list width:int -- str )
  sorted [ width _arg-line ] map "" join ;

: _args-text ( runs:list -- str )
  runs runs [ 0 nth ] map list:sort-by
  runs [ 1 nth len ] map 0 [ max ] reduce
  _lines ;

: _arguments2 ( ks:list vs:list -- str )
  0 ks len range ks list:sort-by ks vs _runs _args-text ;

: _arguments ( query:str -- str )
  query "&" split [ len 0 > ] filter
  dup len 0 = [ drop "" ] [ dup [ _key ] map swap [ _val ] map _arguments2 ] if ;

\ ---- the parts of a URI ----

: _nofrag ( s:str -- str )
  s "#" split 0 nth ;

: _frag-present? ( s:str -- bool )
  s "#" split len 1 > ;

: _frag ( s:str -- str )
  s "#" split dup len 1 > [ 1 over len slice "#" join ] [ drop "" ] if ;

: _noquery ( s:str -- str )
  s _nofrag "?" split 0 nth ;

: _query ( s:str -- str )
  s _nofrag "?" split dup len 1 > [ 1 over len slice "?" join ] [ drop "" ] if ;

: _scheme ( s:str -- str )
  s _noquery "^([A-Za-z][A-Za-z0-9+.-]*):" "" regex:find-all
  dup len 0 = [ drop "" ] [ 0 nth "groups" get 0 nth ] if ;

: _after-scheme ( s:str -- str )
  s _noquery s _scheme dup len 0 = [ drop 0 ] [ len 1 + ] if s _noquery len slice ;

: _has-authority? ( s:str -- bool )
  s _after-scheme "//" util:starts-with? ;

\ The authority, between // and the next / (empty when the URI has none).
: _authority ( s:str -- str )
  s _has-authority?
  [ s _after-scheme 2 s _after-scheme len slice "/" split 0 nth ]
  [ "" ] if ;

: _path ( s:str -- str )
  s _has-authority?
  [ s _after-scheme 2 s _authority len + s _after-scheme len slice ]
  [ s _after-scheme ] if ;

: _userinfo ( a:str -- str )
  a "@" split dup len 1 > [ 0 over len 1 - slice "@" join ] [ drop "" ] if ;

: _hostport ( a:str -- str )
  a "@" split dup len 1 - nth ;

\ The host name and the port of host:port or [v6]:port.
: _host-port ( hp:str -- str str )
  hp "^\\[([^\\]]*)\\](?::(.*))?$" "" regex:find-all
  dup len 0 > not [ drop hp "^([^:]*)(?::(.*))?$" "" regex:find-all ] when
  dup len 0 = [ "not a host and port" hp cat raise:coerce ] when
  0 nth "groups" get dup 0 nth lower swap 1 nth
  dup "^[0-9]*$" "" regex:test not [ "the port is not a number: " swap cat raise:coerce ] when ;

: _line ( label:str value:str -- str )
  label value cat "\n" cat value len 0 = [ drop "" ] when ;

: _proto ( s:str -- str )
  s _scheme lower dup len 0 = not [ ":" cat ] when ;

\ http, https, ftp, gopher, file, ws and wss have a path of at least "/" when they have a host.
: _path-name ( s:str host:str -- str )
  s _path
  dup len 0 =
  [ host len 0 > s _scheme lower { "http" "https" "ftp" "gopher" "file" "ws" "wss" } swap util:contains? and
    [ drop "/" ] when ] when ;

: _query-text ( s:str -- str )
  s _query dup len 0 = [ drop "" ] [ _arguments "Arguments:\n" swap cat ] if ;

: _report ( s:str host:str port:str -- str )
  { "Protocol:\t" s _proto _line
    "Auth:\t\t" s _authority _userinfo false _decode _line
    "Hostname:\t" host _line
    "Port:\t\t" port _line
    "Path name:\t" s host _path-name _line
    s _query-text
    "Hash:\t\t" s _frag-present? [ "#" s _frag cat ] [ "" ] if _line } "" join ;

: parse ( data:str -- str )
  "The parts of a URI (RFC 3986) in CyberChef's layout, one per line and only those that are there: Protocol (the scheme and a colon, lower case), Auth (the user information before the last @, percent-decoded), Hostname (lower case, without the brackets of an IPv6 address), Port, Path name, Arguments (the query: one line per argument, the names padded to the longest, = and the value decoded as URLSearchParams does, + as a space and %XX as UTF-8; an argument given twice shows its values joined by a comma; one without a value shows only its name) and Hash (the fragment with its #). White space around the URI is dropped, and empty input gives empty output. The authority is read when the part after the scheme starts with //; a URI without one (mailto:a@b.example, a path alone) has no host. A port that is not digits is E_COERCE. For http, https, ftp, gopher, file, ws and wss with a host and no path the path is /. This is the RFC 3986 reading with the output of Node's legacy url.parse that CyberChef prints; escapes in the path are not changed, as that parser would for spaces." doc
  "Networking" category
  data "^\\s+" "" "" regex:replace rev "^\\s+" "" "" regex:replace rev
  dup len 0 = [ drop "" ] [
    dup _authority dup len 0 = [ drop "" "" ] [ _hostport _host-port ] if
    _report ] if ;

META: parse
  use-when "You have a URL and want its scheme, user, host, port, path, query arguments and fragment set out one per line." ;
  see-also url:decode extract:urls defang:defang-url ;
  link "https://www.rfc-editor.org/rfc/rfc3986" "RFC 3986: URI generic syntax" ;
  link "https://en.wikipedia.org/wiki/Uniform_Resource_Identifier" "Uniform Resource Identifier on Wikipedia" ;
;
