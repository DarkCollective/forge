\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ asn1: the shared ASN.1 / DER layer of wave 7 (X.509, CSR, CRL, SSH keys, RSA, ECDSA, JWK). This vocabulary is
\ internal (it is in INTERNAL_VOCABS): its words are callable from every vocabulary (asn1:parse, or USING: asn1)
\ and are never listed in the catalogue. The ops on top of it are asn1-dump:parse, oid:from-hex, oid:to-hex,
\ pem:to-hex and pem:from-hex. See "Wave 7 conventions" in packages/ops/README.md for the table of words.
\
\ Reading. parse-in (a primitive, src/prims/asn1.ts) turns DER bytes into a tree of node records:
\   class ("universal" "application" "context" "private"), constructed (bool), tag (int), offset and hlen (where the
\   element and its content start in the data), len (content bytes), value (the content of a primitive element,
\   empty for a constructed one) and children (list of nodes, empty for a primitive one).
\ parse-all and parse are FL over it; the node>... words read a node as a typed value; raw and content give the
\ bytes of an element out of the original data (for example the TBSCertificate whose signature is checked).
\ Writing. der-length, tlv, tlv-tagged and the tlv-... words build DER; every length is minimal and every INTEGER
\ the shortest two's complement form, so what they write is DER.
\ Object identifiers (oid-decode, oid-encode, the name table oid-name, oid-short, oid-find) and PEM (pem-decode,
\ pem-encode) are here too.
\ Errors: malformed data is E_COERCE (truncated, indefinite length, deeper than max-depth, not the expected type);
\ a bad argument is E_RANGE.
IN: asn1

USING: base64 ;

\ ---- reading ----

: max-depth ( -- int )
  "The deepest nesting the reader accepts: 64 levels, counting the top level as 1 (a certificate needs about 10)." doc
  64 ;

: parse-all ( data:bytes -- list )
  "Every top-level element of the DER bytes as a list of node records (see the vocabulary comment), in order; empty data gives an empty list. Bytes that do not form whole elements are E_COERCE (cut short, indefinite length, nesting deeper than max-depth). Shared word." doc
  data 0 data len max-depth parse-in ;

: parse ( data:bytes -- record )
  "The one element that is the whole of the DER bytes, as a node record; no element, or bytes after it, is E_COERCE. Shared word." doc
  data parse-all
  dup len 1 <> [
    "expected one ASN.1 element, found " over len int>str cat raise:coerce ] when
  0 nth ;

: _where ( node:record -- str )
  " at offset " node "offset" get int>str cat ;

: is? ( node:record class:str tag:int -- bool )
  "True when the node has this class (universal, application, context or private) and tag number. Shared word." doc
  node "class" get class = node "tag" get tag = and ;

: universal? ( node:record tag:int -- bool )
  "True when the node is the universal type with this tag number (2 INTEGER, 6 OBJECT IDENTIFIER, 16 SEQUENCE, ...). Shared word." doc
  node "universal" tag is? ;

: context? ( node:record n:int -- bool )
  "True when the node is the context-specific [n] (constructed or not). Shared word." doc
  node "context" n is? ;

: expect ( node:record class:str tag:int what:str -- )
  "E_COERCE unless the node has this class and tag number; the message names what was expected and the offset. Shared word." doc
  node class tag is? not [
    "expected " what cat node _where cat ", found " cat node "class" get cat " " cat node "tag" get int>str cat
    raise:coerce ] when ;

: children ( node:record -- list )
  "The child nodes of a node (empty for a primitive element). Shared word." doc
  node "children" get ;

: child ( node:record i:int -- record )
  "Child number i (from 0) of a node; E_COERCE when the node has fewer children. Shared word." doc
  node "children" get len i <= [
    "the element" node _where cat " has " cat node "children" get len int>str cat " children, not " cat i 1 + int>str cat
    raise:coerce ] when
  node "children" get i nth ;

: raw ( data:bytes node:record -- bytes )
  "The whole element (identifier, length and content) of a node, cut from the data it was read from. Shared word." doc
  data node "offset" get node "offset" get node "hlen" get + node "len" get + slice ;

: content ( data:bytes node:record -- bytes )
  "The content bytes of a node, also for a constructed one, cut from the data it was read from. Shared word." doc
  data node "offset" get node "hlen" get + dup node "len" get + slice ;

\ ---- typed readers ----

: der>int ( content:bytes -- int )
  "The signed big-endian two's complement integer of INTEGER content bytes (any size). No bytes is E_COERCE. Shared word." doc
  content len 0 = [ "an INTEGER has no content bytes" raise:coerce ] when
  content 256 util:digits>int
  content 0 nth 127 > [ 1 content len 8 * shl - ] when ;

: node>int ( node:record -- int )
  "The value of an INTEGER or ENUMERATED node (signed, any size); another type is E_COERCE. Shared word." doc
  node "universal" 2 is? node "universal" 10 is? or not [
    "expected an INTEGER" node _where cat raise:coerce ] when
  node "value" get der>int ;

: node>bool ( node:record -- bool )
  "The value of a BOOLEAN node (any non-zero byte is true); another type or length is E_COERCE. Shared word." doc
  node "universal" 1 "a BOOLEAN" expect
  node "len" get 1 <> [ "a BOOLEAN must be one byte" node _where cat raise:coerce ] when
  node "value" get 0 nth 0 <> ;

: node>oid ( node:record -- str )
  "The dotted text of an OBJECT IDENTIFIER node; another type is E_COERCE. Shared word." doc
  node "universal" 6 "an OBJECT IDENTIFIER" expect
  node "value" get oid-decode ;

: node>bits ( node:record -- bytes int )
  "The bytes and the number of unused bits (0 to 7) of a BIT STRING node; another type, or a bad count, is E_COERCE. Shared word." doc
  node "universal" 3 "a BIT STRING" expect
  node "len" get 1 < [ "a BIT STRING has no unused-bits byte" node _where cat raise:coerce ] when
  node "value" get 0 nth
  dup 7 > [ "a BIT STRING declares more than 7 unused bits" node _where cat raise:coerce ] when
  dup 0 > node "len" get 1 = and [ "an empty BIT STRING declares unused bits" node _where cat raise:coerce ] when
  node "value" get 1 node "len" get slice swap ;

: node>text ( node:record -- str )
  "The text of a string node (UTF8String as UTF-8, BMPString as UTF-16BE, UniversalString as UTF-32BE, PrintableString, IA5String, NumericString, VisibleString, TeletexString and the like as one character per byte, also UTCTime and GeneralizedTime); another type, or bytes the type cannot hold, is E_COERCE. Shared word." doc
  { 12 18 19 20 21 22 23 24 25 26 27 28 30 } node "tag" get util:contains?
  node "class" get "universal" = and not [ "expected a string type" node _where cat raise:coerce ] when
  node "tag" get node "value" get _string ;

\ ---- object identifiers ----

: oid-label ( dotted:str -- str )
  "The name of a known OID, else the dotted text itself. Shared word." doc
  dotted oid-name dup len 0 = [ drop dotted ] when ;

\ ---- writing (DER) ----

: der-length ( n:int -- bytes )
  "The DER length octets for a content of n bytes: one byte below 128, else 0x80 plus the count and the big-endian length without leading zeros. A negative n is E_RANGE. Shared word." doc
  n 0 < [ "a DER length cannot be negative" raise:range ] when
  n 128 < [ n 1 util:int>be-bytes ] [
    n util:int>bytes dup len 126 > [ "a DER length of more than 126 bytes is not supported" raise:range ] when
    dup len 128 + 1 util:int>be-bytes swap cat ] if ;

: tlv ( id:int content:bytes -- bytes )
  "One DER element: the identifier octet id (0 to 255, for tag numbers below 31: 48 is SEQUENCE, 49 SET, 2 INTEGER, 4 OCTET STRING, 160 is [0] constructed), the minimal length and the content. Shared word." doc
  id 0 255 "the identifier octet" util:check-int-range
  id 1 util:int>be-bytes content len der-length cat content cat ;

: _groups ( v:int cont:int -- bytes )
  v 128 <
  [ v cont bor 1 util:int>be-bytes ]
  [ v 128 div 128 recurse v 128 mod cont bor 1 util:int>be-bytes cat ] if ;

: tlv-tagged ( class:str constructed:bool tag:int content:bytes -- bytes )
  "One DER element of any class and tag number, including tag numbers of 31 and over (the high-tag form). class is universal, application, context or private (E_RANGE otherwise); a negative tag is E_RANGE. Shared word." doc
  tag 0 < [ "a tag number cannot be negative" raise:range ] when
  class "universal" = [ 0 ] [ class "application" = [ 64 ] [ class "context" = [ 128 ] [
    class "private" = [ 192 ] [ "the class must be universal, application, context or private" raise:range 0 ] if ] if ] if ] if
  constructed [ 32 + ] when
  tag 31 <
  [ tag + 1 util:int>be-bytes ]
  [ 31 + 1 util:int>be-bytes tag 0 _groups cat ] if
  content len der-length cat content cat ;

: int>der ( n:int -- bytes )
  "The INTEGER content bytes of n: shortest big-endian two's complement (0 is 00, 128 is 0080, -1 is ff, -129 is ff7f). Any size. Shared word." doc
  n 0 >=
  [ n util:int>bytes dup len 0 = [ drop #[ 00 ] ] when
    dup 0 nth 127 > [ #[ 00 ] swap cat ] when ]
  [ n bnot util:int>bytes dup len 0 = [ drop #[ 00 ] ] when
    dup 0 nth 127 > [ #[ 00 ] swap cat ] when
    #[ ff ] bxor ] if ;

: tlv-int ( n:int -- bytes )
  "An INTEGER element of n (any size, DER minimal). Shared word." doc
  2 n int>der tlv ;

: tlv-oid ( dotted:str -- bytes )
  "An OBJECT IDENTIFIER element from dotted text (E_COERCE when it is not an OID). Shared word." doc
  6 dotted oid-encode tlv ;

: tlv-null ( -- bytes )
  "A NULL element (05 00). Shared word." doc
  #[ 05 00 ] ;

: tlv-bool ( b:bool -- bytes )
  "A BOOLEAN element: ff for true, 00 for false (DER). Shared word." doc
  1 b [ #[ ff ] ] [ #[ 00 ] ] if tlv ;

: tlv-octets ( data:bytes -- bytes )
  "An OCTET STRING element holding the bytes. Shared word." doc
  4 data tlv ;

: tlv-bits ( data:bytes unused:int -- bytes )
  "A BIT STRING element: the count of unused bits (0 to 7, 0 for empty data), then the bytes. Shared word." doc
  unused 0 7 "the unused bits" util:check-int-range
  unused 0 > data len 0 = and [ "an empty BIT STRING has no unused bits" raise:range ] when
  3 unused 1 util:int>be-bytes data cat tlv ;

: tlv-seq ( items:list -- bytes )
  "A SEQUENCE element whose content is the concatenation of the item elements (a list of bytes), in the order given. Shared word." doc
  48 items #[ ] bjoin tlv ;

: tlv-set ( items:list -- bytes )
  "A SET element whose content is the item elements in the order given. DER requires a SET OF to be in ascending order of its encodings: the caller sorts when that matters. Shared word." doc
  49 items #[ ] bjoin tlv ;

: tlv-utf8 ( s:str -- bytes )
  "A UTF8String element. Shared word." doc
  12 s str>bytes tlv ;

: tlv-explicit ( n:int content:bytes -- bytes )
  "An explicit context tag [n] (constructed) around an element. Shared word." doc
  "context" true n content tlv-tagged ;

\ ---- PEM ----

: _pem-block ( b:record -- record )
  { { "label" b "label" get }
    { "headers" b "headers" get }
    { "data" b "body" get "standard" base64:decode } } >record ;

: pem-decode ( data:bytes -- list )
  "The PEM blocks of a text (RFC 7468) as records with label (str), headers (record of the RFC 1421 header lines such as Proc-Type and DEK-Info, empty for modern PEM) and data (the decoded bytes), in order. Text outside the blocks is ignored, so no block gives an empty list. A block with no END line, a different END label, a nested BEGIN or bad Base64 is E_COERCE. Shared word." doc
  data _pem-scan [ _pem-block ] map ;

: _check-label ( label:str -- )
  label len 0 = [ "the PEM label cannot be empty" raise:range ] when
  label str>codes [ 32 126 util:between? not ] filter len 0 <>
  [ "the PEM label must be printable ASCII on one line" raise:range ] when
  label "-----" split len 1 > [ "the PEM label cannot contain five hyphens" raise:range ] when ;

: pem-encode ( label:str data:bytes -- str )
  "A PEM block: the BEGIN line for the label, the Base64 of the data in lines of 64 characters, the END line, each ended by a line feed (RFC 7468; empty data gives no body lines). A label that is empty, not printable ASCII or holds five hyphens is E_RANGE. Shared word." doc
  label _check-label
  "-----BEGIN " label cat "-----\n" cat
  data len 0 = [ "" ] [ data "standard" true base64:encode 64 util:str-chunks "\n" join "\n" cat ] if cat
  "-----END " cat label cat "-----\n" cat ;
