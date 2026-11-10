\ url: percent-encoding (RFC 3986 section 2.1). The words are FL and need no primitive;
\ E_COERCE comes from the raise vocabulary (raise:coerce).
IN: url

: _between ( b:int lo:int hi:int -- bool )
  b lo >= b hi <= and ;

: _unreserved? ( b:int -- bool )
  b 65 90 _between b 97 122 _between or b 48 57 _between or
  b 45 = or b 46 = or b 95 = or b 126 = or ;

: _char ( b:int -- str )
  b { } swap append codes>str ;

: _pct ( b:int -- str )
  "%" b 256 + 16 int>str-radix 1 3 slice upper cat ;

: _url-piece ( b:int all:bool -- str )
  b _unreserved? all not and [ b _char ] [ b _pct ] if ;

: _pct-piece ( p:str -- bytes )
  p len 2 < [ "a percent sign must be followed by two hex digits" raise:coerce ] when
  p 0 1 slice 16 str>int-radix 16 *
  p 1 2 slice 16 str>int-radix +
  { } swap append list>bytes
  p 2 p len slice latin1>bytes cat ;

: _url-decode ( pieces:list -- bytes )
  pieces 0 nth latin1>bytes
  pieces 1 pieces len slice [ _pct-piece ] map #[ ] bjoin cat ;

: encode ( bytes mode:choice{component|all}=component -- str )
  "Percent-encode bytes. component leaves A-Z a-z 0-9 - . _ ~ as they are; all encodes every byte. Upper-case hex." doc
  "Encodings" category
  bytes>list [ mode "all" = _url-piece ] map "" join ;

: decode ( bytes plus-as-space:bool=false -- bytes )
  "Decode %XX (either case) to a byte. A percent sign not followed by two hex digits is E_COERCE." doc
  "Encodings" category
  bytes>latin1 plus-as-space [ "+" split " " join ] when "%" split _url-decode ;

META: encode
  param mode "component: encode everything but the RFC 3986 unreserved characters. all: encode every byte." ;
;

META: decode
  param plus-as-space "Read + as a space (form encoding) rather than a literal plus." ;
;
