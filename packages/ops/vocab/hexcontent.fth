\ hexcontent: the Snort and Suricata rule "content" form, where bytes are written as literal
\ text with |41 42| sections of hex digits. The words are FL and need no primitive; E_COERCE comes
\ from the raise vocabulary (raise:coerce).
IN: hexcontent

: _char ( b:int -- str )
  { b } list>bytes bytes>latin1 ;

\ The characters a rule must escape or write in hex: | (toggles hex), " and ; (end the option), \.
: _special? ( b:int -- bool )
  b 124 = b 34 = or b 59 = or b 92 = or ;

: _hex? ( b:int scope:str -- bool )
  scope "all" = b 32 < or b 126 > or b _special? or ;

: _hex-byte ( b:int -- str )
  "|" b 256 + 16 int>str-radix 1 3 slice upper cat "|" cat ;

: _piece ( b:int scope:str -- str )
  b scope _hex? [ b _hex-byte ] [ b _char ] if ;

: encode ( bytes scope:choice{non-printable|all}=non-printable -- str )
  "Snort/Suricata content text. non-printable writes bytes outside 0x20 to 0x7E, and the characters | \" ; \\, as upper-case hex in |41 42| sections and everything else as literal text. all writes every byte in hex. Empty input gives empty text." doc
  "Encodings" category
  bytes>list [ scope _piece ] map "" join "||" split " " join ;

META: encode
  param scope "non-printable: hex only where a rule needs it. all: a single hex section for the whole input." ;
;

\ In literal text \\ \" and \; stand for \ " and ; ; any other backslash is kept as written.
: _unescape ( p:str -- str )
  p "\\\\" split [ "\\\"" split "\"" join "\\;" split ";" join ] map "\\" join ;

: _literal ( p:str -- bytes )
  p _unescape str>bytes ;

: _section ( p:str -- bytes )
  p hex>bytes ;

: _parts>bytes ( parts:list -- bytes )
  parts len 2 mod 0 =
  [ "a | opens a hex section that is never closed" raise:coerce ] when
  parts [ 2 mod 0 = [ _literal ] [ _section ] if ] mapi #[ ] bjoin ;

: decode ( str -- bytes )
  "Read Snort/Suricata content text. Text outside | is UTF-8 literal (with \\\\, \\\" and \\; unescaped); a |...| section holds hex digit pairs, with or without white space. An unclosed |, odd digits or a non-hex character is E_COERCE." doc
  "Encodings" category
  "|" split _parts>bytes ;
