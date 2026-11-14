\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ url: percent-encoding (RFC 3986 section 2.1). The words are FL and need no primitive;
\ E_COERCE comes from the raise vocabulary (raise:coerce).
IN: url

\ Not classical:_text-printable?: a different set of bytes (the RFC 3986 unreserved characters).
: _unreserved? ( b:int -- bool )
  b 65 90 util:between? b 97 122 util:between? or b 48 57 util:between? or
  b 45 = or b 46 = or b 95 = or b 126 = or ;

: _url-piece ( b:int all:bool -- str )
  b _unreserved? all not and [ b util:cp>str ] [ "%" b util:byte>hex cat ] if ;

: encode ( bytes mode:choice{component|all}=component -- str )
  "Percent-encode bytes. component leaves A-Z a-z 0-9 - . _ ~ as they are; all encodes every byte. Upper-case hex." doc
  "Encodings" category
  bytes>list [ mode "all" = _url-piece ] map "" join ;

: decode ( bytes plus-as-space:bool=false -- bytes )
  "Decode %XX (either case) to a byte. A percent sign not followed by two hex digits is E_COERCE." doc
  "Encodings" category
  bytes>latin1 plus-as-space [ "+" split " " join ] when "%" "a percent sign must be followed by two hex digits" util:hex-unescape ;

META: encode
  use-when "You have a value, such as a query parameter or a path segment, that contains spaces, slashes or non-ASCII characters and must be written safely in a URL." ;
  link "https://www.rfc-editor.org/rfc/rfc3986" "RFC 3986: Uniform Resource Identifier (URI) syntax" ;
  link "https://en.wikipedia.org/wiki/Percent-encoding" "Percent-encoding on Wikipedia" ;
  inverse decode ;
  param mode "component: encode everything but the RFC 3986 unreserved characters. all: encode every byte." ;
  checks output charset "A-Za-z0-9%._~-" ;
;

META: decode
  use-when "You have a percent-encoded part of a URL, such as a query value with %20 or %C3%A9, and want the text it stands for." ;
  link "https://www.rfc-editor.org/rfc/rfc3986" "RFC 3986: Uniform Resource Identifier (URI) syntax" ;
  link "https://en.wikipedia.org/wiki/Percent-encoding" "Percent-encoding on Wikipedia" ;
  inverse encode ;
  param plus-as-space "Read + as a space (form encoding) rather than a literal plus." ;
;
