\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ x509: Parse X.509 certificate, Parse X.509 certificate bundles, Parse X.509 CRL, Parse CSR and Public Key from
\ Certificate (CyberChef's five operations), and Parse SSH Host Key (the same kind of text report, for the keys of SSH;
\ it shares the hex, text and bit-length helpers, so it lives here), over the shared DER reader of the internal asn1
\ vocabulary. The results
\ are TEXT reports (README, "How a parser reports"): CyberChef's layout of labels and sections (Version, Serial
\ number, Algorithm ID, Validity, Issuer, Subject, Public Key, Certificate Signature, Extensions), with the values of
\ the extensions written as OpenSSL's `x509 -text` writes them so that every value can be checked against it.
\ No primitive: the reader is asn1:parse-all and the node words; the text is FL.
\
\ Structure read (RFC 5280, RFC 2986):
\   Certificate  ::= SEQUENCE { tbs, signatureAlgorithm, signature BIT STRING }
\   tbs          ::= SEQUENCE { [0] version, serial, signature alg, issuer, validity, subject, spki,
\                               [1] issuerUID, [2] subjectUID, [3] extensions }
\   CRL          ::= SEQUENCE { tbs { [version], alg, issuer, thisUpdate, [nextUpdate], [revoked], [0] extensions },
\                               alg, signature }
\   CSR          ::= SEQUENCE { info { version, subject, spki, [0] attributes }, alg, signature }
\ A malformed structure is E_COERCE with the offset (from asn1:expect and asn1:child). An extension whose value does
\ not read as its type is shown as hex, with the reason, and does not fail the report.
IN: x509

USING: asn1 base64 md5 sha2 ;

\ ---- small text helpers ----

\ Lower-case hex octets separated by colons: aa:bb:cc.
: _octets ( b:bytes -- str )
  b len 0 = [ "" ] [ b bytes>hex 2 util:str-chunks ":" join ] if ;

\ The same in upper case (OpenSSL's key identifiers and IPv6 groups).
: _octets-up ( b:bytes -- str )
  b _octets upper ;

\ Hex octets in lines of per octets, a colon at the end of every line but the last; the lines after the first are
\ indented by indent spaces.
: _wrap ( b:bytes per:int indent:int -- str )
  b len 0 = [ "" ] [
    b bytes>hex per 2 * util:str-chunks [ 2 util:str-chunks ":" join ] map
    ":\n" " " indent util:repeat-str cat join
  ] if ;

\ Every line of the text indented by n spaces.
: _indent ( s:str n:int -- str )
  s "\n" split [ " " n util:repeat-str swap cat ] map "\n" join ;

\ Control characters (below 32, DEL and C1) and the line separators written as \xHH or \uHHHH: names and URLs in a
\ certificate are untrusted text, and a report is read line by line.
: _safe-code ( c:int -- str )
  c 32 < c 127 >= c 160 < and or c 8232 = or c 8233 = or
  [ c 255 > [ "\\u" c 4 util:pad-hex cat ] [ "\\x" c 2 util:pad-hex cat ] if ]
  [ c util:cp>str ] if ;

\ Bytes that may start a character that must be escaped: C0 controls, DEL, and the lead bytes of the C1 controls (C2)
\ and of U+2028 and U+2029 (E2). A text without one of them is returned as it is, in a few VM steps.
#[ 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ] CONSTANT _suspect

\ The text with control characters (below 32, DEL, C1) and the line and paragraph separators written as \xHH or \uHHHH.
: _safe ( s:str -- str )
  s str>bytes _suspect translate #[ 01 ] util:contains-bytes?
  [ s str>codes [ _safe-code ] map "" join ] [ s ] if ;

\ The decimal text and the hex of an INTEGER's content bytes: the number as a signed value, and the bytes without
\ the zero that only keeps a positive number positive.
: _strip-zero ( b:bytes -- bytes )
  b len 1 > [ b 0 nth 0 = b 1 nth 127 > and [ b 1 b len slice ] [ b ] if ] [ b ] if ;

: _hex-int ( n:int -- str )
  n 16 int>str-radix ;

\ ---- times ----

\ A UTCTime or GeneralizedTime as YYYY-MM-DD HH:MM:SS UTC. UTCTime years 50 to 99 are 19xx, 00 to 49 are 20xx
\ (RFC 5280 section 4.1.2.5.1). A time that does not have the RFC 5280 form (digits and Z, seconds present) is shown
\ as it is written.
: _time-join ( year:str rest:str -- str )
  year "-" cat rest 0 2 slice cat "-" cat rest 2 4 slice cat " " cat rest 4 6 slice cat ":" cat
  rest 6 8 slice cat ":" cat rest 8 10 slice cat " UTC" cat ;

: _time-rest ( s:str year:str rest:str -- str )
  rest len 11 = [
    rest 10 11 slice "Z" = rest 0 10 slice util:digits? and
    [ year rest _time-join ] [ s ] if
  ] [ s ] if ;

: _utc-year ( s:str -- str )
  s len 2 < [ "" ] [
    s 0 2 slice dup util:digits?
    [ dup str>int 50 < [ "20" ] [ "19" ] if swap cat ]
    [ drop "" ] if
  ] if ;

: _gen-year ( s:str -- str )
  s len 4 < [ "" ] [ s 0 4 slice dup util:digits? [ ] [ drop "" ] if ] if ;

: _time-go ( s:str year:str skip:int -- str )
  year len 0 = [ s ] [ s year s skip s len slice _time-rest ] if ;

: _time-of ( s:str tag:int -- str )
  tag 23 = [ s s _utc-year 2 _time-go ] [ s s _gen-year 4 _time-go ] if ;

: _time ( node:record -- str )
  [ node asn1:node>text ] [ drop "" ] try
  dup len 0 = [ drop "(not a time)" ] [ node "tag" get _time-of ] if ;

\ ---- distinguished names ----

\ The abbreviation of an attribute type (CN, O, emailAddress), else its name, else the dotted text.
: _attr-name ( oid:str -- str )
  oid asn1:oid-short dup len 0 = [ drop oid asn1:oid-label ] when ;

\ The text of an attribute value; a value that is not a string type is shown as #hex of its content.
: _attr-value ( node:record -- str )
  [ node asn1:node>text _safe ] [ drop "#" node "value" get bytes>hex cat ] try ;

\ One AttributeTypeAndValue as { name value }.
: _atv ( atv:record -- list )
  { atv 0 asn1:child asn1:node>oid _attr-name atv 1 asn1:child _attr-value } ;

\ Every attribute of a Name in order, as { name value } pairs (a multi-valued RDN gives one pair per attribute).
: _pairs ( name:record -- list )
  name asn1:children [ asn1:children ] map util:list-flatten [ _atv ] map ;

: _widest ( pairs:list -- int )
  pairs 0 [ 0 nth len max ] reduce ;

\ One line "CN = value": the name padded to w, the whole line indented by n spaces.
: _dn-line ( pair:list w:int n:int -- str )
  " " n util:repeat-str pair 0 nth w util:pad-right cat " = " cat pair 1 nth cat ;

: _dn-lines ( pairs:list n:int w:int -- str )
  pairs len 0 = [ " " n util:repeat-str "(empty)" cat ] [
    pairs [ w n _dn-line ] map "\n" join
  ] if ;

\ The attributes of a Name as lines "CN = value" with the names padded to the widest, each indented by n spaces;
\ (empty) for a Name without attributes.
: _dn ( name:record n:int -- str )
  name "universal" 16 "a Name (SEQUENCE)" asn1:expect
  name _pairs n over _widest _dn-lines ;

\ A Name on one line the way OpenSSL writes a directoryName: /C=DE/O=Org/CN=name.
: _dn-slash ( name:record -- str )
  name "universal" 16 "a Name (SEQUENCE)" asn1:expect
  name _pairs [ dup 0 nth swap 1 nth "=" swap cat cat "/" swap cat ] map "" join ;

\ ---- labelled lines ----

\ One line "  Label:   value": indent spaces, the label and a colon padded so that the values start at column 18 (one
\ space at least).
: _kv ( indent:int label:str value:str -- str )
  " " indent util:repeat-str label cat ":" cat " " 17 indent - label len - 1 max util:repeat-str cat value cat ;

\ ---- public keys ----

: _rsa-text ( n:int e:int -- str )
  { 2 "Algorithm" "RSA" _kv
    2 "Length" n util:bit-length int>str " bits" cat _kv
    2 "Modulus" n util:int>bytes 16 18 _wrap _kv
    2 "Exponent" e int>str " (0x" cat e _hex-int cat ")" cat _kv } "\n" join ;

: _rsa-key ( key:bytes -- str )
  key asn1:parse
  dup "universal" 16 "RSAPublicKey" asn1:expect
  dup 0 asn1:child asn1:node>int swap 1 asn1:child asn1:node>int _rsa-text ;

\ The size of a curve in bits: 521 for secp521r1 (its point is 133 bytes, but the field is 521 bits), else from the
\ length of the uncompressed point (a byte 04 and two coordinates).
: _curve-bits ( name:str point-len:int -- int )
  name "secp521r1" = [ 521 ] [ point-len 1 - 2 div 8 * ] if ;

: _curve-name ( params:record -- str )
  params "universal" 6 asn1:is? [ params asn1:node>oid asn1:oid-label ] [
    params "universal" 16 asn1:is? [ "(explicit parameters)" ] [ "(implicit)" ] if ] if ;

: _ec-lines ( curve:str key:bytes -- str )
  { 2 "Algorithm" "EC" _kv
    2 "Curve Name" curve _kv
    2 "Length" curve key len _curve-bits int>str " bits" cat _kv
    2 "pub" key 16 18 _wrap _kv } "\n" join ;

: _ec-text ( alg:record key:bytes -- str )
  alg asn1:children len 2 < [ "the EC key has no curve parameters" raise:coerce ] when
  alg 1 asn1:child _curve-name key _ec-lines ;

: _dsa-lines ( p:int q:int g:int y:int -- str )
  { 2 "Algorithm" "DSA" _kv
    2 "Length" p util:bit-length int>str " bits" cat _kv
    2 "P" p util:int>bytes 16 18 _wrap _kv
    2 "Q" q util:int>bytes 16 18 _wrap _kv
    2 "G" g util:int>bytes 16 18 _wrap _kv
    2 "pub" y util:int>bytes 16 18 _wrap _kv } "\n" join ;

: _dsa-text ( alg:record key:bytes -- str )
  alg asn1:children len 2 < [ "the DSA key has no parameters" raise:coerce ] when
  alg 1 asn1:child
  dup "universal" 16 "DSA parameters" asn1:expect
  dup 0 asn1:child asn1:node>int swap dup 1 asn1:child asn1:node>int swap 2 asn1:child asn1:node>int
  key asn1:parse asn1:node>int _dsa-lines ;

: _generic-key ( oid:str key:bytes -- str )
  { 2 "Algorithm" oid asn1:oid-label _kv
    2 "Public key" key 16 18 _wrap _kv } "\n" join ;

: _okp-key ( oid:str key:bytes -- str )
  { 2 "Algorithm" oid asn1:oid-label _kv
    2 "Length" key len 8 * int>str " bits" cat _kv
    2 "pub" key 16 18 _wrap _kv } "\n" join ;

: _pk-by-oid ( oid:str alg:record key:bytes -- str )
  oid "1.2.840.113549.1.1.1" = [ key _rsa-key ] [
  oid "1.2.840.10045.2.1" = [ alg key _ec-text ] [
  oid "1.2.840.10040.4.1" = [ alg key _dsa-text ] [
  { "1.3.101.110" "1.3.101.111" "1.3.101.112" "1.3.101.113" } oid util:contains? [ oid key _okp-key ] [
  oid key _generic-key ] if ] if ] if ] if ;

: _pk-try ( oid:str alg:record key:bytes -- str )
  [ oid alg key _pk-by-oid ] [ drop oid key _generic-key ] try ;

\ The "Public Key" lines of a SubjectPublicKeyInfo. A key body that does not read as its algorithm's type is shown
\ as hex.
: _pk-text ( spki:record -- str )
  spki "universal" 16 "SubjectPublicKeyInfo" asn1:expect
  spki 0 asn1:child "universal" 16 "an AlgorithmIdentifier" asn1:expect
  spki 0 asn1:child asn1:children len 0 = [ "the AlgorithmIdentifier is empty" raise:coerce ] when
  spki 0 asn1:child 0 asn1:child asn1:node>oid
  spki 0 asn1:child
  spki 1 asn1:child asn1:node>bits drop
  _pk-try ;

\ ---- names and numbers shown by OpenSSL's names ----

\ oid=text lines: extension headings, key purposes and access methods as OpenSSL writes them.
"2.5.29.9=X509v3 Subject Directory Attributes\n2.5.29.14=X509v3 Subject Key Identifier\n2.5.29.15=X509v3 Key Usage\n2.5.29.16=X509v3 Private Key Usage Period\n2.5.29.17=X509v3 Subject Alternative Name\n2.5.29.18=X509v3 Issuer Alternative Name\n2.5.29.19=X509v3 Basic Constraints\n2.5.29.20=X509v3 CRL Number\n2.5.29.21=X509v3 CRL Reason Code\n2.5.29.24=Invalidity Date\n2.5.29.27=X509v3 Delta CRL Indicator\n2.5.29.28=X509v3 Issuing Distribution Point\n2.5.29.29=X509v3 Certificate Issuer\n2.5.29.30=X509v3 Name Constraints\n2.5.29.31=X509v3 CRL Distribution Points\n2.5.29.32=X509v3 Certificate Policies\n2.5.29.33=X509v3 Policy Mappings\n2.5.29.35=X509v3 Authority Key Identifier\n2.5.29.36=X509v3 Policy Constraints\n2.5.29.37=X509v3 Extended Key Usage\n2.5.29.46=X509v3 Freshest CRL\n2.5.29.54=X509v3 Inhibit Any Policy\n1.3.6.1.5.5.7.1.1=Authority Information Access\n1.3.6.1.5.5.7.1.11=Subject Information Access\n1.3.6.1.5.5.7.1.24=TLS Feature\n1.3.6.1.5.5.7.48.1.5=OCSP No Check\n2.16.840.1.113730.1.1=Netscape Cert Type\n1.3.6.1.4.1.11129.2.4.2=CT Precertificate SCTs\n1.3.6.1.4.1.11129.2.4.3=CT Precertificate Poison\n1.3.6.1.5.5.7.3.1=TLS Web Server Authentication\n1.3.6.1.5.5.7.3.2=TLS Web Client Authentication\n1.3.6.1.5.5.7.3.3=Code Signing\n1.3.6.1.5.5.7.3.4=E-mail Protection\n1.3.6.1.5.5.7.3.8=Time Stamping\n1.3.6.1.5.5.7.3.9=OCSP Signing\n2.5.29.37.0=Any Extended Key Usage\n1.3.6.1.5.5.7.3.5=IPSec End System\n1.3.6.1.5.5.7.3.6=IPSec Tunnel\n1.3.6.1.5.5.7.3.7=IPSec User\n1.3.6.1.4.1.311.10.3.4=Microsoft Encrypted File System\n1.3.6.1.4.1.311.2.1.21=Microsoft Individual Code Signing\n1.3.6.1.4.1.311.2.1.22=Microsoft Commercial Code Signing\n1.3.6.1.5.5.7.48.1=OCSP\n1.3.6.1.5.5.7.48.2=CA Issuers\n1.3.6.1.5.5.7.48.3=AD Time Stamping\n1.3.6.1.5.5.7.48.5=CA Repository" CONSTANT _names

: _after-eq ( line:str -- str )
  line "=" split 1 nth ;

\ The text for a key in the oid=text table, or the empty string.
: _lookup ( key:str -- str )
  _names "\n" split [ key "=" cat util:starts-with? ] filter
  dup len 0 = [ drop "" ] [ 0 nth _after-eq ] if ;

\ The OpenSSL name of an OID when the table has one, else the name of the asn1 table, else the dotted text.
: _oid-title ( oid:str -- str )
  oid _lookup dup len 0 = [ drop oid asn1:oid-label ] when ;

\ ---- bit strings with names ----

: _bit? ( bits:bytes i:int -- bool )
  i 8 div bits len >= [ false ] [ bits i 8 div nth 128 i 8 mod shr band 0 <> ] if ;

\ The names of the bits that are set, separated by commas.
: _bit-names ( bits:bytes names:list -- str )
  0 names len range [ bits swap _bit? ] filter [ names swap nth ] map ", " join ;

: _key-usage-names ( -- list )
  { "Digital Signature" "Non Repudiation" "Key Encipherment" "Data Encipherment" "Key Agreement"
    "Certificate Sign" "CRL Sign" "Encipher Only" "Decipher Only" } ;

: _reason-names ( -- list )
  { "unused" "Key Compromise" "CA Compromise" "Affiliation Changed" "Superseded" "Cessation Of Operation"
    "Certificate Hold" "Privilege Withdrawn" "AA Compromise" } ;

\ ---- general names ----

: _ip4 ( v:bytes -- str )
  v bytes>list [ int>str ] map "." join ;

\ Eight groups of hex digits in upper case, none compressed, as OpenSSL writes IPv6 addresses.
: _ip6 ( v:bytes -- str )
  0 8 range [ 2 * dup v swap 1 + nth swap v swap nth 256 * + 16 int>str-radix upper ] map ":" join ;

: _ip ( v:bytes -- str )
  v len 4 = [ v _ip4 ] [ v len 16 = [ v _ip6 ] [ v _octets-up ] if ] if ;

\ An iPAddress of a GeneralName: an address, or an address and a mask in a name constraint (8 or 32 bytes).
: _ip-name ( v:bytes -- str )
  v len 8 = [ v 0 4 slice _ip4 "/" cat v 4 8 slice _ip4 cat ] [
    v len 32 = [ v 0 16 slice _ip6 "/" cat v 16 32 slice _ip6 cat ] [ v _ip ] if ] if ;

\ The text of a primitive implicitly tagged IA5String.
: _ia5 ( n:record -- str )
  n "value" get bytes>latin1 _safe ;

: _text-or-hex ( n:record -- str )
  [ n asn1:node>text _safe ] [ drop "#" n "value" get bytes>hex cat ] try ;

\ otherName: [0] { type-id OID, [0] EXPLICIT value }.
: _othername ( n:record -- str )
  [ "othername: " n 0 asn1:child asn1:node>oid asn1:oid-label cat "::" cat
    n 1 asn1:child 0 asn1:child _text-or-hex cat ]
  [ drop "othername:<unsupported>" ] try ;

: _gn-tagged ( n:record tag:int -- str )
  tag 1 = [ "email:" n _ia5 cat ] [
  tag 2 = [ "DNS:" n _ia5 cat ] [
  tag 6 = [ "URI:" n _ia5 cat ] [
  tag 7 = [ "IP Address:" n "value" get _ip-name cat ] [
  tag 8 = [ "Registered ID:" n "value" get asn1:oid-decode cat ] [
  tag 4 = [ "DirName:" n 0 asn1:child _dn-slash cat ] [
  tag 0 = [ n _othername ] [
  tag 3 = [ "X400Name:<unsupported>" ] [
  tag 5 = [ "EdiPartyName:<unsupported>" ] [ "<unsupported GeneralName>" ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ One GeneralName, in OpenSSL's words (DNS:, IP Address:, email:, URI:, DirName:, Registered ID:).
: _gn ( n:record -- str )
  n "class" get "context" = [ n n "tag" get _gn-tagged ] [ "<unsupported GeneralName>" ] if ;

\ The GeneralNames that are the children of a node, one per line.
: _gns ( parent:record -- str )
  parent asn1:children [ _gn ] map "\n" join ;

\ ---- extension values (each takes the parsed content of the extnValue OCTET STRING) ----

: _basic ( n:record -- str )
  n "universal" 16 "BasicConstraints" asn1:expect
  n asn1:children [ "universal" 1 asn1:is? ] filter
  dup len 0 = [ drop "CA:FALSE" ] [ 0 nth asn1:node>bool [ "CA:TRUE" ] [ "CA:FALSE" ] if ] if
  n asn1:children [ "universal" 2 asn1:is? ] filter
  dup len 0 = [ drop ] [ 0 nth asn1:node>int int>str ", pathlen:" swap cat cat ] if ;

: _key-usage ( n:record -- str )
  n asn1:node>bits drop _key-usage-names _bit-names ;

: _eku ( n:record -- str )
  n "universal" 16 "ExtKeyUsageSyntax" asn1:expect
  n asn1:children [ asn1:node>oid _oid-title ] map ", " join ;

: _ski ( n:record -- str )
  n "universal" 4 "an OCTET STRING" asn1:expect
  n "value" get _octets-up ;

: _aki ( n:record -- str )
  n "universal" 16 "AuthorityKeyIdentifier" asn1:expect
  n asn1:children [
    dup "tag" get 0 = [ "value" get _octets-up "keyid:" swap cat ] [
    dup "tag" get 1 = [ asn1:children [ _gn ] map "\n" join ] [
    dup "tag" get 2 = [ "value" get _octets-up "serial:" swap cat ] [
    drop "<unknown field>" ] if ] if ] if
  ] map "\n" join ;

\ Reason flags: an implicitly tagged BIT STRING (the first content byte is the number of unused bits).
: _reasons ( f:record -- str )
  f "value" get dup len 0 = [ drop "" ] [ 1 over len slice _reason-names _bit-names ] if ;

\ DistributionPointName: [0] fullName (GeneralNames) or [1] nameRelativeToCRLIssuer (an RDN).
: _dp-name ( f:record -- str )
  f 0 asn1:child
  dup "tag" get 0 = [ asn1:children [ _gn ] map "\n" join "Full Name:\n" swap 2 _indent cat ] [
    asn1:children [ _atv ] map [ dup 0 nth swap 1 nth "=" swap cat cat ] map "," join
    "Relative Name:\n  " swap cat ] if ;

: _dp-field ( f:record -- str )
  f "tag" get 0 = [ f _dp-name ] [
  f "tag" get 1 = [ "Reasons:\n  " f _reasons cat ] [
  f "tag" get 2 = [ "CRL Issuer:\n" f asn1:children [ _gn ] map "\n" join 2 _indent cat ] [
  "<unknown field>" ] if ] if ] if ;

: _crl-dp ( n:record -- str )
  n "universal" 16 "CRLDistributionPoints" asn1:expect
  n asn1:children [ asn1:children [ _dp-field ] map "\n" join ] map "\n" join ;

: _access ( ad:record -- str )
  ad 0 asn1:child asn1:node>oid _oid-title " - " cat ad 1 asn1:child _gn cat ;

: _aia ( n:record -- str )
  n "universal" 16 "AuthorityInfoAccessSyntax" asn1:expect
  n asn1:children [ _access ] map "\n" join ;

\ DisplayText of a user notice: any of the string types.
: _display ( n:record -- str )
  n asn1:node>text _safe ;

: _notice-ref ( ref:record -- str )
  "Organization: " ref 0 asn1:child _display cat
  "\nNumbers: " cat ref 1 asn1:child asn1:children [ asn1:node>int int>str ] map ", " join cat ;

: _user-notice ( n:record -- str )
  n asn1:children [
    dup "universal" 16 asn1:is? [ _notice-ref ] [ _display "Explicit Text: " swap cat ] if
  ] map "\n" join ;

: _qualifier ( q:record -- str )
  q 0 asn1:child asn1:node>oid
  dup "1.3.6.1.5.5.7.2.1" = [ drop "CPS: " q 1 asn1:child asn1:node>text _safe cat ] [
    "1.3.6.1.5.5.7.2.2" = [ "User Notice:\n" q 1 asn1:child _user-notice 2 _indent cat ]
    [ "Unknown Qualifier: " q 0 asn1:child asn1:node>oid cat ] if ] if ;

: _policy ( p:record -- str )
  "Policy: " p 0 asn1:child asn1:node>oid asn1:oid-label cat
  p asn1:children len 1 > [
    "\n" cat p 1 asn1:child asn1:children [ _qualifier ] map "\n" join 2 _indent cat ] when ;

: _policies ( n:record -- str )
  n "universal" 16 "CertificatePolicies" asn1:expect
  n asn1:children [ _policy ] map "\n" join ;

: _subtree ( st:record -- str )
  st 0 asn1:child _gn ;

: _subtrees ( title:str parent:record -- str )
  title "\n" cat parent asn1:children [ _subtree ] map "\n" join 2 _indent cat ;

: _name-constraints ( n:record -- str )
  n "universal" 16 "NameConstraints" asn1:expect
  n asn1:children [
    dup "tag" get 0 = [ "Permitted:" swap _subtrees ] [ "Excluded:" swap _subtrees ] if
  ] map "\n" join ;

: _policy-constraints ( n:record -- str )
  n asn1:children [
    dup "tag" get 0 = [ "value" get 256 util:digits>int int>str "Require Explicit Policy:" swap cat ]
    [ "value" get 256 util:digits>int int>str "Inhibit Policy Mapping:" swap cat ] if
  ] map "\n" join ;

: _policy-mappings ( n:record -- str )
  n asn1:children [
    dup 0 asn1:child asn1:node>oid asn1:oid-label ":" cat
    swap 1 asn1:child asn1:node>oid asn1:oid-label cat
  ] map "\n" join ;

: _int-text ( n:record -- str )
  n asn1:node>int int>str ;

: _crl-reasons ( -- list )
  { "Unspecified" "Key Compromise" "CA Compromise" "Affiliation Changed" "Superseded" "Cessation Of Operation"
    "Certificate Hold" "Unused" "Remove From CRL" "Privilege Withdrawn" "AA Compromise" } ;

: _reason-code ( n:record -- str )
  n asn1:node>int
  dup 0 >= over 10 <= and [ _crl-reasons swap nth ] [ int>str ] if ;

\ issuingDistributionPoint: [0] distributionPoint, [3] onlySomeReasons, and the flags [1], [2], [4] and [5].
: _idp-flag ( f:record -- str )
  f "value" get len 1 = not [ "<bad flag>" ] [
  f "value" get 0 nth 0 = [ "" ] [
  f "tag" get 1 = [ "Only User Certificates" ] [
  f "tag" get 2 = [ "Only CA Certificates" ] [
  f "tag" get 4 = [ "Indirect CRL" ] [
  f "tag" get 5 = [ "Only Attribute Certificates" ] [ "<unknown field>" ] if ] if ] if ] if ] if ] if ;

: _idp-field ( f:record -- str )
  f "tag" get 0 = [ f _dp-name ] [
  f "tag" get 3 = [ "Only Some Reasons:\n  " f _reasons cat ] [ f _idp-flag ] if ] if ;

: _idp ( n:record -- str )
  n "universal" 16 "IssuingDistributionPoint" asn1:expect
  n asn1:children [ _idp-field ] map [ len 0 > ] filter "\n" join ;

: _tls-feature ( n:record -- str )
  n "universal" 16 "TLS Feature" asn1:expect
  n asn1:children [ asn1:node>int dup 5 = [ drop "status_request" ] [ dup 17 = [ drop "status_request_v2" ] [ int>str ] if ] if ] map ", " join ;

: _ns-cert-type ( n:record -- str )
  n asn1:node>bits drop
  { "SSL Client" "SSL Server" "S/MIME" "Object Signing" "Unused" "SSL CA" "S/MIME CA" "Object Signing CA" }
  _bit-names ;

: _generalized ( n:record -- str )
  n _time ;

\ ---- the extensions ----

\ The reason of an error record (what raise:coerce was given), else its message.
: _why ( e:record -- str )
  e "detail" get keys "reason" util:contains? [ e "detail" get "reason" get ] [ e "message" get ] if ;

\ NULL-valued extensions (OCSP No Check, the CT poison) have no text.
: _null-text ( n:record -- str )
  n "universal" 5 "NULL" asn1:expect "" ;

\ Octets of unknown content, 16 to a line.
: _hex-block ( val:bytes -- str )
  val 16 0 _wrap ;

: _ext-decode ( oid:str val:bytes -- str )
  oid "2.5.29.19" = [ val asn1:parse _basic ] [
  oid "2.5.29.15" = [ val asn1:parse _key-usage ] [
  oid "2.5.29.37" = [ val asn1:parse _eku ] [
  oid "2.5.29.17" = oid "2.5.29.18" = oid "2.5.29.29" = or or [ val asn1:parse _gns ] [
  oid "2.5.29.14" = [ val asn1:parse _ski ] [
  oid "2.5.29.35" = [ val asn1:parse _aki ] [
  oid "2.5.29.31" = oid "2.5.29.46" = or [ val asn1:parse _crl-dp ] [
  oid "1.3.6.1.5.5.7.1.1" = oid "1.3.6.1.5.5.7.1.11" = or [ val asn1:parse _aia ] [
  oid "2.5.29.32" = [ val asn1:parse _policies ] [
  oid "2.5.29.30" = [ val asn1:parse _name-constraints ] [
  oid "2.5.29.36" = [ val asn1:parse _policy-constraints ] [
  oid "2.5.29.33" = [ val asn1:parse _policy-mappings ] [
  oid "2.5.29.54" = oid "2.5.29.20" = oid "2.5.29.27" = or or [ val asn1:parse _int-text ] [
  oid "2.5.29.21" = [ val asn1:parse _reason-code ] [
  oid "2.5.29.24" = [ val asn1:parse _time ] [
  oid "2.5.29.28" = [ val asn1:parse _idp ] [
  oid "1.3.6.1.5.5.7.1.24" = [ val asn1:parse _tls-feature ] [
  oid "2.16.840.1.113730.1.1" = [ val asn1:parse _ns-cert-type ] [
  oid "1.3.6.1.5.5.7.48.1.5" = oid "1.3.6.1.4.1.11129.2.4.3" = or [ val asn1:parse _null-text ] [
  val _hex-block ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ The text of an extension value, or its octets with the reason when it does not read as its type.
: _ext-body ( oid:str val:bytes -- str )
  [ oid val _ext-decode ]
  [ _why _safe "(not decoded: " swap cat ")\n" cat val _hex-block cat ] try ;

: _ext-render ( heading:str body:str -- str )
  body len 0 = [ heading ] [ heading "\n" cat body 4 _indent cat ] if ;

: _ext-line ( oid:str crit:bool val:bytes -- str )
  "  " oid _oid-title cat ":" cat crit [ " critical" cat ] when
  oid val _ext-body _ext-render ;

: _ext-value ( ext:record -- bytes )
  ext asn1:children len 1 - ext swap asn1:child
  dup "universal" 4 "the extension value (an OCTET STRING)" asn1:expect "value" get ;

: _ext ( ext:record -- str )
  ext "universal" 16 "an Extension" asn1:expect
  ext asn1:children len dup 2 < swap 3 > or [ "an Extension has 2 or 3 fields" raise:coerce ] when
  ext 0 asn1:child asn1:node>oid
  ext asn1:children len 3 = [ ext 1 asn1:child asn1:node>bool ] [ false ] if
  ext _ext-value _ext-line ;

\ The Extension nodes of a TBSCertificate or TBSCertList: the children of its context tag [n].
: _ext-nodes ( tbs:record n:int -- list )
  tbs asn1:children [ n asn1:context? ] filter
  dup len 0 = [ drop { } ] [ 0 nth 0 asn1:child asn1:children ] if ;

: _ext-section ( exts:list title:str -- str )
  title
  exts len 0 = [ "\n  (none)" cat ] [ "\n" cat exts [ _ext ] map "\n" join cat ] if ;

\ The version as the 1-based number and the value in the DER: 3 (0x02).
: _ver-text ( v:int -- str )
  v 1 + int>str " (0x" cat v 2 util:pad-hex cat ")" cat ;

\ ---- signatures ----

: _sig-hex ( sig:bytes -- str )
  2 "Signature" sig 16 18 _wrap _kv ;

\ A DSA or ECDSA signature: SEQUENCE { r INTEGER, s INTEGER }.
: _rs-lines ( r:int s:int -- str )
  { 2 "r" r util:int>bytes 16 18 _wrap _kv
    2 "s" s util:int>bytes 16 18 _wrap _kv } "\n" join ;

: _rs ( sig:bytes -- str )
  sig asn1:parse
  dup "universal" 16 "a signature (SEQUENCE)" asn1:expect
  dup asn1:children len 2 <> [ "an ECDSA or DSA signature has two INTEGERs" raise:coerce ] when
  dup 0 asn1:child asn1:node>int swap 1 asn1:child asn1:node>int _rs-lines ;

\ ECDSA and DSA signature algorithms hold r and s; everything else is one number or string of octets.
: _rs-alg? ( oid:str -- bool )
  oid "1.2.840.10045.4." util:starts-with? oid "1.2.840.10040.4." util:starts-with? or
  oid "2.16.840.1.101.3.4.3." util:starts-with? or ;

: _sig-lines ( oid:str sig:bytes -- str )
  oid _rs-alg? [ [ sig _rs ] [ drop sig _sig-hex ] try ] [ sig _sig-hex ] if ;

\ The [n] child of a SEQUENCE of RSASSA-PSS parameters, as the node inside the explicit tag, or an empty list.
: _pss-field ( params:record n:int -- list )
  params asn1:children [ n asn1:context? ] filter
  dup len 0 = [ drop { } ] [ 0 nth asn1:children ] if ;

\ The name of the hash algorithm in an AlgorithmIdentifier node, else sha1 (the default of RFC 4055).
: _hash-name ( alg:list -- str )
  alg len 0 = [ "sha1" ] [ alg 0 nth 0 asn1:child asn1:node>oid asn1:oid-label ] if ;

: _pss-text ( params:record -- str )
  params "universal" 16 "RSASSA-PSS-params" asn1:expect
  "hash " params 0 _pss-field _hash-name cat
  ", MGF1 with " cat
  params 1 _pss-field dup len 0 = [ drop "sha1" ] [ 0 nth 1 asn1:child { } swap append _hash-name ] if cat
  ", salt length " cat
  params 2 _pss-field dup len 0 = [ drop "20" ] [ 0 nth asn1:node>int int>str ] if cat ;

: _pss-try ( alg:record -- str )
  [ alg 1 asn1:child _pss-text ] [ drop "parameters not decoded" ] try ;

\ The algorithm name; RSASSA-PSS adds its parameters in brackets.
: _alg-title ( alg:record -- str )
  alg "universal" 16 "an AlgorithmIdentifier" asn1:expect
  alg 0 asn1:child asn1:node>oid dup asn1:oid-label
  swap "1.2.840.113549.1.1.10" = alg asn1:children len 1 > and
  [ " (" alg _pss-try cat cat ")" cat ] when ;

\ The "Algorithm" line and the signature lines.
: _sig-body ( oid:str title:str sig:bytes -- str )
  2 "Algorithm" title _kv "\n" cat oid sig _sig-lines cat ;

\ The section under "Certificate Signature" (or "Signature"): the AlgorithmIdentifier node and the BIT STRING node.
: _sig-section ( alg:record sig:record -- str )
  alg "universal" 16 "an AlgorithmIdentifier" asn1:expect
  alg 0 asn1:child asn1:node>oid
  alg _alg-title
  sig asn1:node>bits drop
  _sig-body ;

\ ---- loading ----

\ The first label is the one the message names.
: _no-block ( labels:list -- )
  "no PEM block (-----BEGIN " labels 0 nth cat "-----) found in the input" cat raise:coerce ;

\ DER of each PEM block whose label is in labels (blocks of other labels, such as a private key in the same file,
\ are ignored); no such block is E_COERCE.
: _pem-ders ( data:bytes labels:list -- list )
  data asn1:pem-decode [ "label" get labels swap util:contains? ] filter
  dup len 0 = [ labels _no-block ] when
  [ "data" get ] map ;

: _der-list ( data:bytes -- list )
  data asn1:parse-all [ data swap asn1:raw ] map
  dup len 0 = [ "no DER element found in the input" raise:coerce ] when ;

\ The DER encodings in the input, one per PEM block (of the labels) or per top-level element.
: _blobs ( data:bytes fmt:str labels:list -- list )
  fmt "pem" = [ data labels _pem-ders ] [
  fmt "der-hex" = [ data bytes>str hex>bytes _der-list ] [
  fmt "base64" = [ data "standard" base64:decode _der-list ] [
  fmt "raw" = [ data _der-list ] [
    "the input format must be pem, der-hex, base64 or raw" raise:range { } ] if ] if ] if ] if ;

: _cert-labels ( -- list )
  { "CERTIFICATE" "X509 CERTIFICATE" } ;

\ ---- a certificate ----

\ Field i of a TBSCertificate counted from the serial number (the optional [0] version is skipped).
: _tbs-field ( tbs:record i:int -- record )
  tbs tbs 0 asn1:child 0 asn1:context? [ 1 ] [ 0 ] if i + asn1:child ;

: _version-text ( tbs:record -- str )
  tbs 0 asn1:child 0 asn1:context?
  [ tbs 0 asn1:child 0 asn1:child asn1:node>int ] [ 0 ] if _ver-text ;

: _serial-text ( serial:record -- str )
  serial "universal" 2 "the serial number (INTEGER)" asn1:expect
  serial asn1:node>int int>str " (0x" cat serial "value" get _strip-zero bytes>hex cat ")" cat ;

: _validity-text ( v:record -- str )
  v "universal" 16 "Validity" asn1:expect
  { 2 "Not Before" v 0 asn1:child _time _kv 2 "Not After" v 1 asn1:child _time _kv } "\n" join ;

: _tbs-report ( tbs:record sig:str -- str )
  { 0 "Version" tbs _version-text _kv
    0 "Serial number" tbs 0 _tbs-field _serial-text _kv
    0 "Algorithm ID" tbs 1 _tbs-field _alg-title _kv
    "Validity" tbs 3 _tbs-field _validity-text
    "Issuer" tbs 2 _tbs-field 2 _dn
    "Subject" tbs 4 _tbs-field 2 _dn
    "Public Key" tbs 5 _tbs-field _pk-text
    "Certificate Signature" sig
    ""
    tbs 3 _ext-nodes "Extensions" _ext-section } "\n" join ;

\ The report of one certificate given as DER.
: _cert-report ( der:bytes -- str )
  der asn1:parse
  dup "universal" 16 "Certificate" asn1:expect
  dup 0 asn1:child
  dup "universal" 16 "TBSCertificate" asn1:expect
  swap dup 1 asn1:child swap 2 asn1:child _sig-section
  _tbs-report ;

\ ---- the operations ----

: parse ( data:bytes input-format:choice{pem|der-hex|base64|raw}="pem" -- str )
  "Parse one X.509 certificate (RFC 5280) and report it as text, in the layout of CyberChef's Parse X.509 certificate: Version, Serial number (decimal and hex), Algorithm ID, Validity (UTC), Issuer and Subject (one attribute per line), Public Key (algorithm, size, modulus and exponent, or curve and point, or the DSA numbers), Certificate Signature and Extensions. input-format is pem (the default; PEM blocks of other kinds, such as a private key in the same file, are ignored), der-hex (hex digits), base64 (of the DER) or raw (the DER bytes). Extension values are written as OpenSSL's x509 -text writes them (Basic Constraints, Key Usage, Extended Key Usage, Subject and Issuer Alternative Name, Subject and Authority Key Identifier, CRL Distribution Points, Authority and Subject Information Access, Certificate Policies, Name Constraints, ...) and any other extension as hex. More than one certificate, none, bytes after the certificate or a malformed structure is E_COERCE; use Parse X.509 certificate bundles for several." doc
  "Public Key" category
  data input-format _cert-labels _blobs
  dup len 1 <> [ "expected one certificate, found " over len int>str cat "; use x509:parse-bundle for several" cat raise:coerce ] when
  0 nth _cert-report ;

: _numbered ( der:bytes n:int total:int -- str )
  "Certificate " n int>str cat " of " cat total int>str cat "\n" cat
  [ der _cert-report ]
  [ _why "certificate " n int>str cat ": " cat swap cat raise:coerce "" ] try cat ;

: _bundle ( blobs:list -- str )
  blobs [ 1 + blobs len _numbered ] mapi "\n\n" join ;

: parse-bundle ( data:bytes input-format:choice{pem|der-hex|base64|raw}="pem" -- str )
  "Parse every certificate of a bundle (a PEM file with several CERTIFICATE blocks, or DER certificates one after the other in der-hex, base64 or raw) and report each as Parse X.509 certificate does, under a heading Certificate N of M, separated by a blank line. input-format is pem (the default), der-hex, base64 or raw. No certificate, or a malformed one, is E_COERCE (the message of a malformed certificate starts with its number). PEM blocks of other kinds in the same file (private keys, CRLs) are ignored." doc
  "Public Key" category
  data input-format _cert-labels _blobs _bundle ;

\ ---- Public Key from Certificate ----

: _spki-pem ( der:bytes -- str )
  der asn1:parse
  dup "universal" 16 "Certificate" asn1:expect
  0 asn1:child 5 _tbs-field
  dup "universal" 16 "SubjectPublicKeyInfo" asn1:expect
  der swap asn1:raw "PUBLIC KEY" swap asn1:pem-encode ;

: public-key ( data:bytes input-format:choice{pem|der-hex|base64|raw}="pem" -- str )
  "The public key of each certificate as a PEM block of its SubjectPublicKeyInfo (Public Key from Certificate): -----BEGIN PUBLIC KEY----- with the Base64 in lines of 64 characters. The key is copied byte for byte from the certificate, whatever its algorithm (RSA, EC, Ed25519, DSA, ...), so it is the same as openssl x509 -pubkey. input-format is pem (the default), der-hex, base64 or raw; the keys of several certificates follow one another. No certificate or a malformed one is E_COERCE." doc
  "Public Key" category
  data input-format _cert-labels _blobs [ _spki-pem ] map "" join ;

\ ---- Parse X.509 CRL ----

\ Where the signature algorithm is in a TBSCertList: 1 after a version INTEGER, else 0.
: _crl-base ( tbs:record -- int )
  tbs 0 asn1:child "universal" 2 asn1:is? [ 1 ] [ 0 ] if ;

: _crl-version ( tbs:record -- str )
  tbs _crl-base 1 = [ tbs 0 asn1:child asn1:node>int ] [ 0 ] if _ver-text ;

: _revoked ( e:record -- str )
  e "universal" 16 "a revoked certificate entry" asn1:expect
  { 2 "Serial number" e 0 asn1:child _serial-text _kv
    4 "Revocation date" e 1 asn1:child _time _kv } "\n" join
  e asn1:children len 2 > [
    "\n" cat e 2 asn1:child asn1:children [ _ext ] map "\n" join 2 _indent cat ] when ;

\ The nodes of a TBSCertList after the issuer and thisUpdate: [nextUpdate] [revoked] [[0] extensions].
: _crl-rest ( tbs:record -- list )
  tbs asn1:children
  dup len tbs _crl-base 3 + < [ "the CRL is cut short: it has no issuer and update times" raise:coerce ] when
  tbs _crl-base 3 + over len slice ;

: _crl-next ( rest:list -- str )
  rest [ dup "universal" 23 asn1:is? swap "universal" 24 asn1:is? or ] filter
  dup len 0 = [ drop "" ] [ 0 nth 0 "Next Update" rot _time _kv ] if ;

: _crl-revoked ( rest:list -- str )
  rest [ "universal" 16 asn1:is? ] filter
  dup len 0 = [ drop "Revoked Certificates: none" ] [
    0 nth asn1:children
    dup len int>str "Revoked Certificates (" swap cat ")" cat "\n" cat
    swap [ _revoked ] map "\n" join cat ] if ;

: _crl-extensions ( rest:list -- list )
  rest [ 0 asn1:context? ] filter
  dup len 0 = [ drop { } ] [ 0 nth 0 asn1:child asn1:children ] if ;

: _crl-lines ( tbs:record rest:list sig:str -- str )
  { 0 "Version" tbs _crl-version _kv
    0 "Algorithm ID" tbs tbs _crl-base asn1:child _alg-title _kv
    "Issuer" tbs tbs _crl-base 1 + asn1:child 2 _dn
    0 "Last Update" tbs tbs _crl-base 2 + asn1:child _time _kv
    rest _crl-next
    rest _crl-extensions dup len 0 = [ drop "" ] [ "Extensions" _ext-section ] if
    rest _crl-revoked
    "Signature" sig }
  [ len 0 > ] filter "\n" join ;

: _crl-report ( der:bytes -- str )
  der asn1:parse
  dup "universal" 16 "CertificateList" asn1:expect
  dup 0 asn1:child
  dup "universal" 16 "TBSCertList" asn1:expect
  swap dup 1 asn1:child swap 2 asn1:child _sig-section
  over _crl-rest swap _crl-lines ;

: parse-crl ( data:bytes input-format:choice{pem|der-hex|base64|raw}="pem" -- str )
  "Parse one X.509 certificate revocation list (RFC 5280) and report it as text: Version, Algorithm ID, Issuer, Last Update and Next Update (UTC), the CRL extensions (CRL Number, Authority Key Identifier, Issuer Alternative Name, ... as OpenSSL writes them), the revoked certificates (serial number in decimal and hex, revocation date and the entry extensions such as the reason code) and the Signature. input-format is pem (the default; the block is X509 CRL), der-hex, base64 or raw. More than one CRL, none, bytes after the CRL or a malformed structure is E_COERCE." doc
  "Public Key" category
  data input-format { "X509 CRL" } _blobs
  dup len 1 <> [ "expected one CRL, found " over len int>str cat raise:coerce ] when
  0 nth _crl-report ;

\ ---- Parse CSR ----

: _attr-values ( set:record -- str )
  set asn1:children [ _text-or-hex ] map ", " join ;

: _csr-attr ( a:record -- str )
  a 0 asn1:child asn1:node>oid
  dup "1.2.840.113549.1.9.14" = [ drop "" ] [
    asn1:oid-label "  " swap cat ": " cat a 1 asn1:child _attr-values cat ] if ;

\ The extension requests of the attributes: SEQUENCE OF Extension inside the SET of the extensionRequest attribute.
: _csr-exts ( attrs:list -- list )
  attrs [ 0 asn1:child asn1:node>oid "1.2.840.113549.1.9.14" = ] filter
  [ 1 asn1:child 0 asn1:child asn1:children ] map util:list-flatten ;

: _csr-attrs ( info:record -- list )
  info asn1:children [ 0 asn1:context? ] filter
  dup len 0 = [ drop { } ] [ 0 nth asn1:children ] if ;

: _csr-attr-section ( attrs:list -- str )
  attrs [ _csr-attr ] map [ len 0 > ] filter
  dup len 0 = [ drop "" ] [ "\n" join "Attributes\n" swap cat ] if ;

: _csr-lines ( info:record attrs:list sig:str -- str )
  { 0 "Version" info 0 asn1:child asn1:node>int _ver-text _kv
    "Subject" info 1 asn1:child 2 _dn
    "Public Key" info 2 asn1:child _pk-text
    "Signature" sig
    attrs _csr-attr-section
    attrs _csr-exts dup len 0 = [ drop "" ] [ "Requested Extensions" _ext-section ] if }
  [ len 0 > ] filter "\n" join ;

: _csr-report ( der:bytes -- str )
  der asn1:parse
  dup "universal" 16 "CertificationRequest" asn1:expect
  dup 0 asn1:child
  dup "universal" 16 "CertificationRequestInfo" asn1:expect
  swap dup 1 asn1:child swap 2 asn1:child _sig-section
  over _csr-attrs swap _csr-lines ;

: parse-csr ( data:bytes input-format:choice{pem|der-hex|base64|raw}="pem" -- str )
  "Parse one PKCS #10 certificate signing request (RFC 2986) and report it as text: Version, Subject, Public Key (as in Parse X.509 certificate), Signature (algorithm and value), the Attributes (challengePassword, unstructuredName, ...) and the Requested Extensions of the extensionRequest attribute, written as OpenSSL writes extensions. input-format is pem (the default; the block is CERTIFICATE REQUEST or NEW CERTIFICATE REQUEST), der-hex, base64 or raw. More than one request, none, bytes after the request or a malformed structure is E_COERCE. The signature is not verified." doc
  "Public Key" category
  data input-format { "CERTIFICATE REQUEST" "NEW CERTIFICATE REQUEST" } _blobs
  dup len 1 <> [ "expected one certificate request, found " over len int>str cat raise:coerce ] when
  0 nth _csr-report ;

\ ---- Parse SSH Host Key ----
\ The SSH public key of an authorized_keys, known_hosts or .pub line, or its Base64 or hex blob, as a text report with the
\ MD5 and SHA256 fingerprints (ssh-keygen -l) and the fields of the key. The blob is the SSH wire format of RFC 4253
\ section 6.6 and RFC 5656 (a string is a 32-bit length and the bytes; an mpint is a string with a signed big-endian
\ number). The words are prefixed _ssh.

\ One line "Label:   value": the label and a colon padded so that the values start at column 22.
: _ssh-kv ( label:str value:str -- str )
  label ":" cat " " 21 label len - 1 max util:repeat-str cat value cat ;

\ ---- reading the blob ----

\ The string (32-bit length, bytes) at pos added to items.
: _ssh-take ( data:bytes pos:int items:list n:int -- list )
  data pos 4 + n "the SSH key blob" util:need-bytes
  { pos 4 + n + items data pos 4 + dup n + slice append } ;

\ One more string from the state { position strings }.
: _ssh-field ( data:bytes acc:list -- list )
  data acc 0 nth 4 "the SSH key blob" util:need-bytes
  data acc 0 nth acc 1 nth data acc 0 nth dup 4 + slice 256 util:digits>int _ssh-take ;

\ The first n strings of the blob; bytes after them are E_COERCE.
: _ssh-read ( data:bytes n:int -- list )
  0 n range { 0 { } } [ drop data swap _ssh-field ] reduce
  dup 0 nth data len <> [ "the SSH key blob has bytes after the key fields" raise:coerce ] when
  1 nth ;

\ The key type, the first string of the blob.
: _ssh-type ( data:bytes -- str )
  data { 0 { } } _ssh-field 1 nth 0 nth bytes>latin1 ;

\ How many strings (the type included) a key of this type holds.
: _ssh-count ( type:str -- int )
  type "ssh-rsa" = [ 3 ] [
  type "ssh-dss" = [ 5 ] [
  type "ssh-ed25519" = type "ssh-ed448" = or [ 2 ] [
  type "ecdsa-sha2-" util:starts-with? [ 3 ] [
  type "sk-ssh-ed25519@openssh.com" = [ 3 ] [
  type "sk-ecdsa-sha2-nistp256@openssh.com" = [ 4 ] [
    "unsupported SSH key type '" type _safe cat "'" cat raise:coerce 0 ] if ] if ] if ] if ] if ] if ;

\ An mpint: a signed big-endian number; no bytes is zero.
: _ssh-mpint ( b:bytes -- int )
  b len 0 = [ 0 ] [ b asn1:der>int ] if ;

\ ---- the fields of each key type ----

: _ssh-num-text ( n:int -- str )
  n util:int>bytes 16 22 _wrap ;

: _ssh-rsa-lines ( e:int n:int -- str )
  { "Length" n util:bit-length int>str " bits" cat _ssh-kv
    "Exponent" e int>str " (0x" cat e 16 int>str-radix cat ")" cat _ssh-kv
    "Modulus" n _ssh-num-text _ssh-kv } "\n" join ;

: _ssh-dss-lines ( p:int q:int g:int y:int -- str )
  { "Length" p util:bit-length int>str " bits" cat _ssh-kv
    "P" p _ssh-num-text _ssh-kv
    "Q" q _ssh-num-text _ssh-kv
    "G" g _ssh-num-text _ssh-kv
    "Y (public)" y _ssh-num-text _ssh-kv } "\n" join ;

\ The field size by curve identifier (nistp521 is 521 bits), else from the uncompressed point.
: _ssh-curve-bits ( id:str point:bytes -- int )
  id "nistp521" = [ 521 ] [ point len 1 - 2 div 8 * ] if ;

: _ssh-ecdsa-lines ( id:str point:bytes -- str )
  { "Curve" id _safe _ssh-kv
    "Length" id point _ssh-curve-bits int>str " bits" cat _ssh-kv
    "Public point" point 16 22 _wrap _ssh-kv } "\n" join ;

: _ssh-ed-lines ( type:str key:bytes -- str )
  { type "ssh-ed25519" = type "sk-ssh-ed25519@openssh.com" = or [ "Length" "256 bits" _ssh-kv ] [ "" ] if
    "Public key" key 16 22 _wrap _ssh-kv } [ len 0 > ] filter "\n" join ;

\ RFC 5656: the curve identifier is the end of the key type (ecdsa-sha2-nistp256 and nistp256).
: _ssh-check-curve ( type:str id:str -- )
  type "ecdsa-sha2-" util:starts-with? type 11 type len slice id <> and
  [ "the curve '" id _safe cat "' does not belong to the key type '" cat type _safe cat "'" cat raise:coerce ] when ;

: _ssh-application ( b:bytes -- str )
  "Application" b bytes>latin1 _safe _ssh-kv ;

: _ssh-details ( type:str f:list -- str )
  type "ssh-rsa" = [ f 1 nth _ssh-mpint f 2 nth _ssh-mpint _ssh-rsa-lines ] [
  type "ssh-dss" = [ f 1 nth _ssh-mpint f 2 nth _ssh-mpint f 3 nth _ssh-mpint f 4 nth _ssh-mpint _ssh-dss-lines ] [
  type "ecdsa-sha2-" util:starts-with? [
    type f 1 nth bytes>latin1 _ssh-check-curve f 1 nth bytes>latin1 f 2 nth _ssh-ecdsa-lines ] [
  type "sk-ecdsa-sha2-nistp256@openssh.com" = [
    f 1 nth bytes>latin1 f 2 nth _ssh-ecdsa-lines "\n" cat f 3 nth _ssh-application cat ] [
  type "sk-ssh-ed25519@openssh.com" = [ type f 1 nth _ssh-ed-lines "\n" cat f 2 nth _ssh-application cat ] [
  type f 1 nth _ssh-ed-lines ] if ] if ] if ] if ] if ;

\ ---- the report ----

: _ssh-sha256 ( blob:bytes -- str )
  blob "256" sha2:digest "standard" false base64:encode bytes>latin1 ;

: _ssh-render ( blob:bytes comment:str type:str f:list -- str )
  { "Key type" type _safe _ssh-kv
    comment len 0 = [ "" ] [ "Comment" comment _safe _ssh-kv ] if
    "Fingerprint (MD5)" "MD5:" blob md5:digest _octets cat _ssh-kv
    "Fingerprint (SHA256)" "SHA256:" blob _ssh-sha256 cat _ssh-kv
    type f _ssh-details } [ len 0 > ] filter "\n" join ;

\ ---- the input ----

: _ssh-words ( line:str -- list )
  line "\t" split " " join " " split [ len 0 > ] filter ;

: _ssh-lines ( text:str -- list )
  text "\r\n" split "\n" join "\r" split "\n" join "\n" split [ _ssh-words len 0 > ] filter ;

: _ssh-type-token? ( t:str -- bool )
  t "ssh-" util:starts-with? t "ecdsa-sha2-" util:starts-with? or t "sk-" util:starts-with? or ;

\ The position of the first word that looks like a key type, or -1.
: _ssh-type-index ( words:list -- int )
  0 words len range [ words swap nth _ssh-type-token? ] filter
  dup len 0 = [ drop -1 ] [ 0 nth ] if ;

: _ssh-hexish? ( s:str -- bool )
  s len 2 mod 0 = s len 0 > and s str>codes [ util:hex-digit? not ] filter len 0 = and ;

: _ssh-decode ( token:str fmt:str -- bytes )
  fmt "hex" = [ token hex>bytes ] [
  fmt "base64" = [ token str>bytes "standard" base64:decode ] [
  token _ssh-hexish? [ token hex>bytes ] [ token str>bytes "standard" base64:decode ] if ] if ] if ;

\ { blob comment type-word } of the key on a line: the word after the key type is the key, the rest is the comment.
: _ssh-line-parts ( words:list ti:int fmt:str -- list )
  words len ti 1 + <= [ "the key type '" words ti nth _safe cat "' is not followed by the key" cat raise:coerce ] when
  { words ti 1 + nth fmt _ssh-decode  words ti 2 + words len slice " " join _safe  words ti nth } ;

\ A key line (one line holding a key type word), or else a bare blob: all the text with white space ignored.
: _ssh-load3 ( words:list ti:int lines:list text:str fmt:str -- list )
  ti 0 < [ { text util:strip-space fmt _ssh-decode "" "" } ] [
    lines len 1 > [ "expected one key, found " lines len int>str cat " lines" cat raise:coerce ] when
    words ti fmt _ssh-line-parts ] if ;

: _ssh-load ( text:str fmt:str -- list )
  text _ssh-lines
  dup len 0 = [ "the input holds no key" raise:coerce ] when
  dup 0 nth _ssh-words dup _ssh-type-index
  rot text fmt _ssh-load3 ;

: _ssh-finish3 ( blob:bytes comment:str tok:str type:str -- str )
  tok len 0 > type tok <> and [
    "the key type in the text ('" tok _safe cat "') differs from the one in the key ('" cat type _safe cat "')" cat
    raise:coerce ] when
  blob comment type blob type _ssh-count _ssh-read _ssh-render ;

: _ssh-finish ( parts:list -- str )
  parts 0 nth
  dup len 0 = [ "the key is empty" raise:coerce ] when
  parts 1 nth parts 2 nth parts 0 nth _ssh-type _ssh-finish3 ;

: parse-ssh-host-key ( data:bytes input-format:choice{auto|base64|hex}="auto" -- str )
  "Parse an SSH public key and report it as text (Parse SSH Host Key): the key type, the comment, the fingerprints and the fields of the key. The input is an OpenSSH public key line (authorized_keys, known_hosts or a .pub file: optional hosts or options, the key type, the Base64 key and an optional comment), the Base64 of the key, or its hex; input-format auto (the default) takes a text with a key-type word (ssh-rsa, ssh-dss, ecdsa-sha2-*, ssh-ed25519, ssh-ed448, sk-...) as a line, a text of only hex digits as hex and anything else as Base64; base64 and hex force how the key is decoded. Fingerprints are written as ssh-keygen -l does: MD5:aa:bb:... (ssh-keygen -E md5) and SHA256:<unpadded Base64> (the default), taken over the whole key blob. Fields: ssh-rsa exponent, modulus and size; ssh-dss p, q, g and y; ecdsa-sha2-* the curve, its size and the public point; ssh-ed25519 and ssh-ed448 the public key; the FIDO sk-ssh-ed25519@openssh.com and sk-ecdsa-sha2-nistp256@openssh.com keys add the application. A certificate key type or any other type, a key cut short, bytes after the key fields, a curve that does not match the type, more than one key line or bad Base64 or hex is E_COERCE." doc
  "Public Key" category
  data bytes>str input-format _ssh-load _ssh-finish ;

META: parse-ssh-host-key
  param input-format "How the key is written: auto (a key line, hex or Base64 as found), base64 or hex." ;
;
