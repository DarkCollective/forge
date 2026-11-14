\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ asn1-dump: Parse ASN.1 hex string (CyberChef's op). The result is TEXT, an indented outline in the layout of
\ jsrsasign's dump that CyberChef prints (checked by running both): one element per line, two spaces per level, the type
\ name and then the value, a line feed after every line. As in CyberChef start counts hex characters and only the
\ element at start is shown (with what is inside it); truncate counts hex characters kept at each end of a long value,
\ which is then written first..(total Nbytes)..last. Where jsrsasign is wrong Forge is not: it opens an OCTET STRING or
\ BIT STRING only when the whole content is exactly one DER element, never guesses at the content of a primitive
\ context tag, and writes ENUMERATED in decimal. The tree behind the text (records) is the shared reader asn1:parse-all,
\ which FL code uses directly. The outline is text, not a record tree, because it is meant to be read and copied (the
\ output pane shows a tree at most 6 levels deep, and an X.509 certificate nests deeper once the OCTET STRINGs of its
\ extensions are opened).
IN: asn1-dump

USING: asn1 ;

\ ---- values ----

\ The hex of v cut like jsrsasign: more than max hex characters at each end (that is, over max bytes) become
\ first..(total Nbytes)..last. max 0 shows everything.
: _cut ( h:str max:int -- str )
  h 0 max slice "..(total " cat h len 2 div int>str cat "bytes).." cat h h len max - h len slice cat ;

: _hex ( v:bytes max:int -- str )
  v bytes>hex dup len max 2 * <= max 0 = or not [ max _cut ] when ;

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

: _http? ( v:bytes -- bool )
  v len 4 >= [ v 0 4 slice #[ 68 74 74 70 ] = ] [ false ] if ;

\ A primitive context tag: hex, in full; text for a value that starts with http and for the dNSName and other [2]
\ names of a subjectAltName extension (san), as jsrsasign does. It never opens the value as DER.
: _context-text ( node:record san:bool -- str )
  node "value" get
  dup _http? san node "tag" get 2 = and or
  over _ascii? and
  [ bytes>latin1 ] [ bytes>hex ] if ;

: _generic ( node:record trunc:int san:bool -- str )
  node "class" get "context" =
  [ node san _context-text ]
  [ node "value" get trunc _hex ] if ;

: _bool-text ( node:record -- str )
  node "value" get bytes>hex "00" = [ "FALSE" ] [ "TRUE" ] if ;

: _oid-line ( dotted:str -- str )
  dotted asn1:oid-name dup len 0 = [ drop "" ] [ " " cat ] if
  "(" cat dotted "." split " " join cat ")" cat ;

: _oid-text ( node:record trunc:int -- str )
  [ node "value" get asn1:oid-decode _oid-line ]
  [ drop node "value" get trunc _hex ] try ;

\ A character string, in quotes (the time types without).
: _string-text ( node:record trunc:int -- str )
  [ node asn1:node>text dup _printable?
    [ node "tag" get dup 23 = swap 24 = or not [ _quoted ] when ]
    [ drop node "value" get trunc _hex ] if ]
  [ drop node "value" get trunc _hex ] try ;

: _enum-text ( node:record trunc:int -- str )
  [ node asn1:node>int int>str ] [ drop node "value" get trunc _hex ] try ;

: _universal ( node:record trunc:int -- str )
  node "tag" get
  dup 1 = [ drop node _bool-text ] [
  dup 2 = [ drop node "value" get trunc _hex ] [
  dup 10 = [ drop node trunc _enum-text ] [
  dup 5 = [ drop "" ] [
  dup 6 = [ drop node trunc _oid-text ] [
  { 12 18 19 20 21 22 23 24 25 26 27 28 30 } over util:contains? [ drop node trunc _string-text ] [
  drop node "value" get trunc _hex ] if ] if ] if ] if ] if ] if ;

\ The text after the type name of a primitive element.
: _value-text ( node:record trunc:int san:bool -- str )
  node "class" get "universal" = [ node trunc _universal ] [ node trunc san _generic ] if ;

\ The line of an element without its indent. kids are the child nodes that are shown below it.
: _text ( kids:list node:record trunc:int san:bool -- str )
  node _tag-name
  node "constructed" get
  [ kids len 0 = node "tag" get 16 = and node "class" get "universal" = and [ " {}" cat ] when ]
  [ kids len 0 >
    [ ", encapsulates" cat ]
    [ node trunc san _value-text dup len 0 = [ drop ] [ " " swap cat cat ] if ] if ] if ;

\ ---- opening OCTET STRINGs and BIT STRINGs ----

\ Where the content of an OCTET STRING or BIT STRING starts when it may hold a nested element, else -1.
: _nest-start ( node:record -- int )
  node "class" get "universal" = not [ -1 ] [
    node "tag" get 4 = node "len" get 0 > and
    [ node "offset" get node "hlen" get + ]
    [ node "tag" get 3 = node "len" get 1 > and
      [ node "value" get 0 nth 0 = [ node "offset" get node "hlen" get + 1 + ] [ -1 ] if ]
      [ -1 ] if ] if ] if ;

\ The one element an OCTET STRING or BIT STRING holds when its whole content reads as exactly one DER element (within
\ the depth that is left), else an empty list.
: _nested ( data:bytes node:record level:int -- list )
  node _nest-start 0 < level 62 > or
  [ { } ]
  [ [ data node _nest-start node "offset" get node "hlen" get + node "len" get + 63 level - parse-in
      dup len 1 = not [ drop { } ] when ]
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

\ The san flag: inside an extension whose OID is subjectAltName. As in jsrsasign it is set by a SEQUENCE of an OID
\ and (after an optional BOOLEAN) an OCTET STRING, and kept for everything below it. _dump works out the flag of a
\ node's children once (open false) and then writes the node (open true), so a node with 1,000 children costs 1,000 reads.
: _ext-shape? ( node:record -- bool )
  node "class" get "universal" = node "tag" get 16 = and
  node "children" get len dup 2 = swap 3 = or and
  [ node "children" get dup 0 nth "tag" get 6 = swap dup len 1 - nth "tag" get 4 = and ] [ false ] if ;

: _san-for ( node:record san:bool -- bool )
  node _ext-shape?
  [ [ node "children" get 0 nth "value" get asn1:oid-decode "2.5.29.17" = ] [ drop false ] try ]
  [ san ] if ;

: _dump ( data:bytes node:record level:int trunc:int san:bool open:bool -- str )
  open not
  [ data node level trunc node san _san-for true recurse ]
  [ data node level _kids
    dup node trunc san _text
    level _indent swap cat
    swap [ data swap level 1 + trunc san false recurse ] map _join ] if ;

\ ---- where the element at start ends ----

: _cut-short ( -- )
  "the ASN.1 element is cut short" raise:coerce ;

\ The position after the identifier octets of the element at p.
: _skip-high ( d:bytes p:int -- int )
  p d len >= [ _cut-short ] when
  d p nth 128 band 0 = [ p 1 + ] [ d p 1 + recurse ] if ;

: _tag-end ( d:bytes p:int -- int )
  p d len >= [ _cut-short ] when
  d p nth 31 band 31 = [ d p 1 + _skip-high ] [ p 1 + ] if ;

\ The end of a long-form length of n bytes that starts at q.
: _long-end ( d:bytes q:int n:int -- int )
  q n + d len > [ _cut-short ] when
  d q q n + slice 256 util:digits>int q n + + ;

\ The end of the element whose length octets start at p.
: _len-end ( d:bytes p:int -- int )
  p d len >= [ _cut-short ] when
  d p nth dup 128 < [ p 1 + + ] [
    127 band
    dup 0 = [ "an indefinite length is not supported" raise:coerce ] when
    dup 4 > [ "the length of the element takes more than 4 bytes" raise:coerce ] when
    d p 1 + rot _long-end ] if ;

: _elem-end ( d:bytes p:int -- int )
  d d p _tag-end _len-end
  dup d len > [ _cut-short ] when ;

\ start is a byte offset here.
: _run ( d:bytes start:int trunc:int -- str )
  start 0 d len "the start index" util:check-int-range
  trunc 0 1000000000 "the truncation length" util:check-int-range
  start d len =
  [ "" ]
  [ d start d start _elem-end asn1:max-depth parse-in
    [ d swap 0 trunc false false _dump ] map "\n" join "\n" cat ] if ;

: parse ( data:str start:int=0 truncate:int=32 -- str )
  "An outline of the ASN.1 structure written as hex digits (Parse ASN.1 hex string), in the layout of CyberChef's jsrsasign dump: one element per line, two spaces of indent per level, the type name and the value, a line feed after every line. INTEGER and ENUMERATED are not alike: INTEGER shows its hex, ENUMERATED its decimal value. OBJECT IDENTIFIER shows its name and arcs (ObjectIdentifier sha256WithRSAEncryption (1 2 840 113549 1 1 11)), character strings their text in single quotes (UTCTime and GeneralizedTime without), BOOLEAN TRUE or FALSE, an empty SEQUENCE SEQUENCE {}, and an OCTET STRING or BIT STRING whose whole content is exactly one DER element is written OCTETSTRING, encapsulates (BITSTRING, encapsulates) with the element below it; other values are hex (a BIT STRING with its unused-bits octet first). A value of more than truncate bytes is shown as its first truncate hex characters, ..(total Nbytes).., and its last truncate hex characters; 0 shows everything. Context tags print as [0], [1], ... with their hex. start is the position of the element to show, counted in hex characters (even, as in CyberChef); only that element is shown, with what it contains, and the bytes after it are not read. Bad hex, a cut-short or indefinite-length element or nesting deeper than 64 levels is E_COERCE; a start beyond the data or odd, or a negative truncate, is E_RANGE." doc
  "Public Key" category
  start 0 < start 2 mod 0 <> or [ "the start index counts hex characters and must be even and not negative" raise:range ] when
  data hex>bytes start 2 div truncate _run ;

META: parse
  use-when "You have DER or BER data as hex, such as a certificate, key or signature, and want to see its nested structure to find a field or check a format." ;
  param start "The position of the element to show, in hex characters (even), as in CyberChef." ;
  param truncate "Show at most this many hex characters at each end of a long value, with ..(total Nbytes).. between (0: show all)." ;
  link "https://en.wikipedia.org/wiki/ASN.1" "ASN.1 on Wikipedia" ;
  link "https://www.itu.int/rec/T-REC-X.690/en" "ITU-T X.690: BER, CER and DER encoding rules" ;
  checks input regex "^[0-9a-fA-F\\s]+$" ;
  expects "ASN.1 DER as hex" ;
;
