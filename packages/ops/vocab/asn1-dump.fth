\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ asn1-dump: Parse ASN.1 hex string (CyberChef's op). The result is TEXT, an indented outline in the shape of
\ jsrsasign's dump that CyberChef prints: one element per line, two spaces per level, the type name and then the
\ value. The tree behind it (records) is the shared reader asn1:parse-all, which FL code uses directly. The
\ outline is text, not a record tree, because it is meant to be read and copied (the output pane shows a tree
\ at most 6 levels deep and 1,000 items wide, and an X.509 certificate nests deeper once the OCTET STRINGs of its
\ extensions are opened), and because CyberChef's op gives text.
IN: asn1-dump

USING: asn1 ;

\ Hex of at most max bytes (0 = all), then "..." when it was cut.
: _hex ( v:bytes max:int -- str )
  max 0 > v len max > and
  [ v 0 max slice bytes>hex "..." cat ]
  [ v bytes>hex ] if ;

\ No control characters (below 32 or 127 to 159): safe to print between quotes.
: _printable? ( s:str -- bool )
  s str>codes [ dup 32 < swap dup 127 >= swap 159 <= and or ] filter len 0 = ;

: _ascii? ( v:bytes -- bool )
  v len 0 > v [ 32 126 util:between? ] filter len v len = and ;

: _quoted ( s:str -- str )
  "'" s cat "'" cat ;

: _universal-names ( -- list )
  { "EOC" "BOOLEAN" "INTEGER" "BITSTRING" "OCTETSTRING" "NULL" "ObjectIdentifier" "ObjectDescriptor" "EXTERNAL"
    "REAL" "ENUMERATED" "EMBEDDED PDV" "UTF8String" "RELATIVE-OID" "TIME" "reserved" "SEQUENCE" "SET"
    "NumericString" "PrintableString" "TeletexString" "VideotexString" "IA5String" "UTCTime" "GeneralizedTime"
    "GraphicString" "VisibleString" "GeneralString" "UniversalString" "CHARACTER STRING" "BMPString" } ;

: _tag-name ( node:record -- str )
  node "class" get "universal" =
  [ node "tag" get dup 31 <
    [ _universal-names swap nth ]
    [ "[UNIVERSAL " swap int>str cat "]" cat ] if ]
  [ node "class" get "context" =
    [ "[" node "tag" get int>str cat "]" cat ]
    [ "[" node "class" get upper cat " " cat node "tag" get int>str cat "]" cat ] if ] if ;

: _generic ( node:record trunc:int -- str )
  node "value" get dup _ascii? [ bytes>latin1 _quoted ] [ trunc _hex ] if ;

: _bool-text ( node:record trunc:int -- str )
  node "len" get 1 =
  [ node "value" get 0 nth 0 = [ "FALSE" ] [ "TRUE" ] if ]
  [ node "value" get trunc _hex ] if ;

: _oid-line ( dotted:str -- str )
  dotted asn1:oid-name dup len 0 = [ drop "" ] [ " " cat ] if
  "(" cat dotted "." split " " join cat ")" cat ;

: _oid-text ( node:record trunc:int -- str )
  [ node "value" get asn1:oid-decode _oid-line ]
  [ drop node "value" get trunc _hex ] try ;

: _string-text ( node:record trunc:int -- str )
  [ node asn1:node>text dup _printable? [ _quoted ] [ drop node "value" get trunc _hex ] if ]
  [ drop node "value" get trunc _hex ] try ;

: _bits-text ( node:record trunc:int -- str )
  [ node asn1:node>bits dup 0 > [ " (" swap int>str cat " unused)" cat ] [ drop "" ] if
    swap trunc _hex swap cat ]
  [ drop node "value" get trunc _hex ] try ;

: _universal ( node:record trunc:int -- str )
  node "tag" get
  dup 1 = [ drop node trunc _bool-text ] [
  dup 2 = over 10 = or [ drop node "value" get bytes>hex ] [
  dup 3 = [ drop node trunc _bits-text ] [
  dup 5 = [ drop "" ] [
  dup 6 = [ drop node trunc _oid-text ] [
  { 12 18 19 20 21 22 23 24 25 26 27 28 30 } over util:contains? [ drop node trunc _string-text ] [
  drop node "value" get trunc _hex ] if ] if ] if ] if ] if ] if ;

\ The text after the type name of a primitive element.
: _value-text ( node:record trunc:int -- str )
  node "class" get "universal" = [ node trunc _universal ] [ node trunc _generic ] if ;

\ The line of an element without its indent. kids are the child nodes that are shown below it.
: _text ( kids:list node:record trunc:int -- str )
  node _tag-name
  node "constructed" get kids len 0 > or not [
    node trunc _value-text dup len 0 = [ drop ] [ " " swap cat cat ] if ] when ;

\ Where the content of an OCTET STRING or BIT STRING starts when it may hold a nested element, else -1.
: _nest-start ( node:record -- int )
  node "class" get "universal" = not [ -1 ] [
    node "tag" get 4 = node "len" get 0 > and
    [ node "offset" get node "hlen" get + ]
    [ node "tag" get 3 = node "len" get 1 > and
      [ node "value" get 0 nth 0 = [ node "offset" get node "hlen" get + 1 + ] [ -1 ] if ]
      [ -1 ] if ] if ] if ;

\ The elements an OCTET STRING or BIT STRING holds when its whole content reads as DER (within the depth that is
\ left), else an empty list.
: _nested ( data:bytes node:record level:int -- list )
  node _nest-start 0 < level 62 > or
  [ { } ]
  [ [ data node _nest-start node "offset" get node "hlen" get + node "len" get + 63 level - parse-in ]
    [ drop { } ] try ] if ;

\ The child nodes to show below a node: its children, or what its string content holds.
: _kids ( data:bytes node:record level:int -- list )
  node "constructed" get
  [ node "children" get ]
  [ data node level _nested ] if ;

: _indent ( level:int -- str )
  "  " level util:repeat-str ;

: _join ( line:str parts:list -- str )
  parts len 0 = [ line ] [ line "\n" cat parts "\n" join cat ] if ;

: _dump ( data:bytes node:record level:int trunc:int -- str )
  data node level _kids
  dup node trunc _text
  level _indent swap cat
  swap [ data swap level 1 + trunc recurse ] map _join ;

: _run ( d:bytes start:int trunc:int -- str )
  start 0 d len "the start index" util:check-int-range
  trunc 0 1000000000 "the truncation length" util:check-int-range
  d start d len asn1:max-depth parse-in
  [ d swap 0 trunc _dump ] map "\n" join ;

: parse ( data:str start:int=0 truncate:int=32 -- str )
  "An outline of the ASN.1 structure written as hex digits (Parse ASN.1 hex string): one element per line, two spaces of indent per level, the type name and the value. INTEGER shows its hex, OBJECT IDENTIFIER its name and arcs (ObjectIdentifier sha256WithRSAEncryption (1 2 840 113549 1 1 11)), strings their text in quotes, an OCTET STRING or BIT STRING whose content is itself DER is opened like a constructed element, and any other value is hex, cut after truncate bytes with ... (0 turns the cut off). Context tags print as [0], [1], .... start is the byte where reading begins; every element from there to the end of the data is shown, one after the other. Bad hex, a cut-short or indefinite-length element or nesting deeper than 64 levels is E_COERCE; a start beyond the data or a negative truncate is E_RANGE. CyberChef counts the start in hex characters and shows only the first element; the layout follows its jsrsasign dump but is not guaranteed to match it character for character." doc
  "Public Key" category
  data hex>bytes start truncate _run ;

META: parse
  param start "The byte offset at which to start reading (CyberChef counts hex characters)." ;
  param truncate "Show at most this many bytes of an OCTET STRING, BIT STRING or other value, then ... (0: show all)." ;
;
