\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ extract: pull the things that look like something out of text or binary data: printable strings, IP addresses,
\ e-mail addresses, MAC addresses, URLs, domain names, file paths and hex hashes. Every word is FL over
\ regex:find-all; the data is read as one character per byte (Latin-1), so binary input never fails and the
\ patterns, which are all ASCII, find their matches in it. The output is one match per line.
\
\ The words share three options, as CyberChef's extractors do: display-total (a "Total found: N" line and a blank
\ line in front), sort (by code point, list:sort) and unique (each match once, in the order of first appearance).
\ Unique comes first, then sort, then the total.
IN: extract

\ ---- shared: matching, unique, output ----

: _finish ( found:list display-total:bool sort:bool unique:bool -- str )
  found unique [ list:unique ] when
  sort [ list:sort ] when
  display-total util:total-text ;

\ ---- strings ----

\ The characters a string may hold: all printable ASCII, or letters, digits and the usual punctuation.
: _class ( match:str -- str )
  match "alphanumeric" =
  [ "[A-Za-z0-9/\\-:.,_$%'\"()\\[\\]<>= !{}@]" ]
  [ "[ -~]" ]
  if ;

\ Single bytes: n or more characters.
: _single ( c:str n:str term:bool -- str )
  c "{" cat n cat ",}" cat
  term [ "(?=\\x00)" cat ] when ;

\ UTF-16LE: n or more characters, each followed by a zero byte.
: _le ( c:str n:str term:bool -- str )
  "(?:" c cat "\\x00){" cat n cat ",}" cat
  term [ "(?=\\x00\\x00)" cat ] when ;

\ UTF-16BE: n or more characters, each preceded by a zero byte.
: _be ( c:str n:str term:bool -- str )
  "(?:\\x00" c cat "){" cat n cat ",}" cat
  term [ "(?=\\x00\\x00)" cat ] when ;

: _strings-regex ( encoding:str c:str n:str term:bool -- str )
  encoding "single" = [ c n term _single ] [
  encoding "utf16le" = [ c n term _le ] [
  encoding "utf16be" = [ c n term _be ] [
    c n term _single "|" cat c n term _le cat "|" cat c n term _be cat
  ] if ] if ] if ;

: strings ( data:bytes encoding:choice{single|utf16le|utf16be|all}="single" min-length:int[1..100000]=4 match:choice{printable|alphanumeric}="alphanumeric" null-terminated:bool=false display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The runs of printable characters in the data, like the Unix strings tool, one per line. encoding single reads one byte per character, utf16le and utf16be two bytes per character (a printable ASCII character with a zero byte next to it, after it for little-endian and before it for big-endian; the zero bytes are removed from the output), and all looks for the three kinds together. min-length is how many characters make a string. match printable takes the characters from space to tilde (U+0020 to U+007E); alphanumeric (the default, as CyberChef's Alphanumeric + punctuation) takes the letters, digits and the punctuation / - : . , _ $ % ' \" ( ) [ ] < > = ! { } @ and the space. With null-terminated a string counts only when a zero byte follows it (two zero bytes in UTF-16). Only ASCII characters are found. The input is read as bytes, so any binary file will do. With display-total the output starts with Total found: N and a blank line, with sort the strings are sorted by code point, with unique each is kept once (first appearance)." doc
  "Extractors" category
  data bytes>latin1
  encoding match _class min-length int>str null-terminated _strings-regex
  "" util:match-texts
  [ [ 0 <> ] filter ] map
  display-total sort unique _finish ;

META: strings
  param encoding "single: one byte per character. utf16le and utf16be: two. all: all three." ;
  param min-length "How many characters a run needs to count as a string." ;
  param match "alphanumeric: letters, digits, space and common punctuation only (the default). printable: any character from space to tilde." ;
  param null-terminated "Keep only the strings that a zero byte (two for UTF-16) follows." ;
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the strings by code point." ;
  param unique "Keep each string once, in the order of first appearance." ;
  see-also extract:urls hexdump:encode ;
;

\ ---- IP addresses ----

\ One decimal octet, leading zeros allowed.
: _octet ( -- str )
  "(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)" ;

\ Four octets, no surrounding checks.
: _quad ( -- str )
  _octet "(?:\\." cat _octet cat "){3}" cat ;

: _v4-pattern ( -- str )
  "(?<!\\d)(?<!\\d\\.)" _quad cat "(?!\\d)(?!\\.\\d)" cat ;

\ The IPv6 forms of RFC 4291 section 2.2: full, with :: for a run of zero groups, and with an embedded IPv4 tail.
\ H is a group of 1 to 4 hex digits and Q an IPv4 address; the guard after the alternatives makes the engine
\ back into a longer form when a shorter one is followed by more address.
: _v6-forms ( -- str )
  "(?:H:){6}Q|::(?:H:){0,5}Q|(?:H:){1,4}:(?:H:){0,3}Q|(?:H:){7}H|(?:H:){1,7}:|(?:H:){1,6}:H|(?:H:){1,5}(?::H){1,2}|(?:H:){1,4}(?::H){1,3}|(?:H:){1,3}(?::H){1,4}|(?:H:){1,2}(?::H){1,5}|H:(?::H){1,6}|:(?:(?::H){1,7}|:)"
  "H" split "[0-9a-f]{1,4}" join
  "Q" split _quad join ;

: _v6-pattern ( -- str )
  "(?<![\\w:.])(?:" _v6-forms cat ")(?![\\w:])(?!\\.\\d)" cat ;

\ Private and loopback IPv4: 10/8, 172.16/12, 192.168/16 and 127/8 (CyberChef's local addresses; 169.254/16 stays).
: _local? ( ip:str -- bool )
  ip "^(?:10\\.|127\\.|192\\.168\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.)" "" regex:test ;

: _ip-pattern ( ipv4:bool ipv6:bool -- str )
  ipv6
  [ ipv4 [ _v6-pattern "|" cat _v4-pattern cat ] [ _v6-pattern ] if ]
  [ _v4-pattern ]
  if ;

: ip-addresses ( data:bytes ipv4:bool=true ipv6:bool=false remove-local:bool=false display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The IP addresses in the data, one per line. ipv4 finds dotted-quad addresses (four decimal numbers from 0 to 255, leading zeros allowed, not part of a longer dotted number); ipv6 finds the forms of RFC 4291 section 2.2 (full, with :: and with an IPv4 tail), in either letter case. A :: standing alone is found as well. remove-local drops the IPv4 addresses in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (private) and 127.0.0.0/8 (loopback), the local addresses CyberChef removes; 169.254.0.0/16 (link-local) is kept. With both ipv4 and ipv6 off nothing is found. With display-total the output starts with Total found: N and a blank line, with sort the addresses are sorted as text (by code point, so 10.0.0.9 comes after 10.0.0.10), with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  ipv4 ipv6 or
  [ ipv4 ipv6 _ip-pattern "i" util:match-texts remove-local [ [ _local? not ] filter ] when ]
  [ drop { } ]
  if
  display-total sort unique _finish ;

META: ip-addresses
  param ipv4 "Find IPv4 addresses." ;
  param ipv6 "Find IPv6 addresses." ;
  param remove-local "Leave out the private and loopback IPv4 addresses." ;
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the addresses as text (by code point)." ;
  param unique "Keep each address once, in the order of first appearance." ;
  see-also extract:mac-addresses extract:domains ;
;

\ ---- e-mail addresses ----

: emails ( data:bytes display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The e-mail addresses in the data, one per line: a local part of letters, digits and the characters ! # $ % & ' * + / = ? ^ _ ` { | } ~ - with single dots between its pieces (found from its first character, so a dot before it does not count), an @, and a host name of two or more dot-separated labels (letters, digits and inner hyphens). Quoted local parts and internationalised (non-ASCII) names are not found; a dot after the last label is not part of the address. With display-total the output starts with Total found: N and a blank line, with sort the addresses are sorted by code point, with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  "(?<![A-Za-z0-9!#$%&'*+/=?^_`{|}~-])(?<![A-Za-z0-9!#$%&'*+/=?^_`{|}~-]\\.)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
  "" util:match-texts
  display-total sort unique _finish ;

META: emails
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the addresses by code point." ;
  param unique "Keep each address once, in the order of first appearance." ;
  see-also extract:domains extract:urls ;
;

\ ---- MAC addresses ----

: mac-addresses ( data:bytes display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The MAC addresses in the data, one per line: six pairs of hex digits joined by colons or by hyphens (00:1a:2b:3c:4d:5e, 00-1A-2B-3C-4D-5E), or three groups of four joined by dots (001a.2b3c.4d5e, the Cisco form), in either letter case. A match inside a longer run of hex pairs (an IPv6 address, a 64-bit identifier) is not found. With display-total the output starts with Total found: N and a blank line, with sort the addresses are sorted by code point, with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  "(?<![0-9A-Fa-f])(?<![0-9A-Fa-f][:.-])(?:[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}|[0-9A-Fa-f]{4}(?:\\.[0-9A-Fa-f]{4}){2})(?![0-9A-Fa-f])(?![:.-][0-9A-Fa-f])"
  "" util:match-texts
  display-total sort unique _finish ;

META: mac-addresses
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the addresses by code point." ;
  param unique "Keep each address once, in the order of first appearance." ;
  see-also extract:ip-addresses ;
;

\ ---- URLs ----

: urls ( data:bytes display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The URLs in the data, one per line: a scheme (letters, digits, + - .) and ://, optional user information, a host (a name, an IPv4 address or an IPv6 address in brackets), an optional port, and an optional path, query and fragment that runs up to white space or one of \" < > [ ] { } | \\ ^ ` and non-ASCII bytes. Round brackets are part of the URL only in pairs, and a . , ; : ! ? or ' at the very end is left out, so a URL at the end of a sentence or in brackets is found without the full stop or the bracket. With display-total the output starts with Total found: N and a blank line, with sort the URLs are sorted by code point, with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  "(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*://(?:[^\\s/?#@\"<>\\[\\]{}|\\\\^`\\x7f-\\xff]+@)?(?:[\\w-]+(?:\\.[\\w-]+)*|\\[[0-9A-Fa-f:.]+\\])(?::\\d+)?(?:[/?#](?:(?:[^\\s\"<>\\[\\]{}|\\\\^`()\\x7f-\\xff]|\\([^\\s\"<>\\[\\]{}|\\\\^`()\\x7f-\\xff]*\\))*(?:[^\\s\"<>\\[\\]{}|\\\\^`()\\x7f-\\xff.,;:!?']|\\([^\\s\"<>\\[\\]{}|\\\\^`()\\x7f-\\xff]*\\)))?)?"
  "" util:match-texts
  display-total sort unique _finish ;

META: urls
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the URLs by code point." ;
  param unique "Keep each URL once, in the order of first appearance." ;
  see-also extract:domains extract:emails ;
;

\ ---- domain names ----

: _domain-pattern ( underscore:bool -- str )
  underscore [ "_" ] [ "" ] if
  dup "(?<![\\w.-])(?:[A-Za-z0-9" swap cat "](?:[A-Za-z0-9" cat over cat "-]{0,61}[A-Za-z0-9" cat over cat "])?\\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})(?![\\w-])(?!\\.\\w)" cat nip ;

: domains ( data:bytes display-total:bool=false sort:bool=false unique:bool=false underscore:bool=false -- str )
  "The domain names in the data, one per line: two or more dot-separated labels (letters, digits, inner hyphens and, with underscore, _; at most 63 characters each) ending in a top-level label of two or more letters, or an xn-- label. The shape is all that is checked: the top-level label is not looked up in a list, so a file name such as report.txt is found as well (CyberChef's option to keep only valid top-level domains is not offered; its Underscore option is: with underscore on, names such as _dmarc.example.com are found whole, with it off, the default, a name with an underscore in a label is not found). A name inside a longer word or after a hyphen or dot is read from its start. With display-total the output starts with Total found: N and a blank line, with sort the names are sorted by code point, with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  underscore _domain-pattern
  "" util:match-texts
  display-total sort unique _finish ;

META: domains
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the names by code point." ;
  param unique "Keep each name once, in the order of first appearance." ;
  param underscore "Allow _ in the labels of a name (_dmarc.example.com, _domainkey)." ;
  see-also extract:urls extract:emails extract:ip-addresses ;
;

\ ---- file paths ----

\ A Windows path: a drive letter, a colon and a backslash, then folders (a single space may be inside a folder
\ name) each ending in a backslash, and a last name with no space.
: _windows-path ( -- str )
  "(?<![\\w])[A-Za-z]:\\\\(?:[\\w.$~@#%&()+,;=!'\\[\\]{}^-]+(?: [\\w.$~@#%&()+,;=!'\\[\\]{}^-]+)*\\\\)*[\\w.$~@#%&()+,;=!'\\[\\]{}^-]*" ;

\ A UNIX path: a slash, then one or more names each after a slash, and an optional last slash; it may not start
\ in the middle of a word or of a URL, and does not end with a dot or a comma.
: _unix-path ( -- str )
  "(?<![\\w/.:~-])(?:/[\\w.~+@%=,-]+)+(?<![.,])/?" ;

: _paths-pattern ( windows:bool unix:bool -- str )
  unix
  [ windows [ _windows-path "|" cat _unix-path cat ] [ _unix-path ] if ]
  [ _windows-path ]
  if ;

: file-paths ( data:bytes windows:bool=true unix:bool=true display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The file paths in the data, one per line. windows finds C:\\folder\\file paths: a drive letter, then names joined by backslashes; a folder name may hold single spaces (C:\\Program Files\\App\\app.exe) but the last name stops at the first space. unix finds /folder/file paths: names joined by slashes, ending at white space; a path is not found inside a word, a URL or a relative path (a/b/c), and a trailing full stop or comma is left out. With both off nothing is found. With display-total the output starts with Total found: N and a blank line, with sort the paths are sorted by code point, with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  windows unix or
  [ windows unix _paths-pattern "" util:match-texts ]
  [ drop { } ]
  if
  display-total sort unique _finish ;

META: file-paths
  param windows "Find Windows paths (C:\\dir\\file)." ;
  param unix "Find UNIX paths (/dir/file)." ;
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the paths by code point." ;
  param unique "Keep each path once, in the order of first appearance." ;
  see-also extract:urls ;
;

\ ---- hashes ----

\ The digest lengths in hex digits that are found with all: 4 (CRC-16), 8 (CRC-32, Adler-32), 16 (64-bit),
\ 32 (MD5), 40 (SHA-1), 48 (192-bit), 56 (SHA-224), 64 (SHA-256), 80 (RIPEMD-320), 96 (SHA-384) and 128 (SHA-512).
: _digest-lengths ( -- list )
  { 4 8 16 32 40 48 56 64 80 96 128 } ;

: _of-length ( found:list n:int -- list )
  found [ len n = ] filter ;

\ With all: the values of each usual length together, the shortest length first, each in the order of the text (the
\ order CyberChef writes them in).
: _by-length ( found:list -- list )
  _digest-lengths [ found swap _of-length ] map { } [ cat ] reduce ;

: hashes ( data:bytes length:int[1..128]=40 all:bool=false display-total:bool=false sort:bool=false unique:bool=false -- str )
  "The hexadecimal hash values in the data, one per line: runs of exactly length hex digits (40 by default, the size of SHA-1) that are not part of a longer run of letters, digits or underscores. With all the length is ignored and runs of the usual digest sizes are found instead: 4, 8, 16, 32, 40, 48, 56, 64, 80, 96 and 128 digits (CRC-16 up to SHA-512), the values of each length together, the shortest length first. Either letter case is found, and the match is output as written. The length is only a pattern: any run of hex digits of that size counts, hash or not. With display-total the output starts with Total found: N and a blank line, with sort the values are sorted by code point, with unique each is kept once (first appearance). The data is read byte by byte, so binary data will do." doc
  "Extractors" category
  data bytes>latin1
  "(?<![0-9A-Za-z_])[0-9a-f]{" all [ "4,128" ] [ length int>str ] if cat "}(?![0-9A-Za-z_])" cat
  "i" util:match-texts
  all [ _by-length ] when
  display-total sort unique _finish ;

META: hashes
  param length "How many hex digits a hash has (32 MD5, 40 SHA-1, 64 SHA-256, 128 SHA-512)." ;
  param all "Ignore length and find every usual digest size instead." ;
  param display-total "Put Total found: N and a blank line in front of the output." ;
  param sort "Sort the values by code point." ;
  param unique "Keep each value once, in the order of first appearance." ;
  see-also hash-analysis:analyse ;
;
