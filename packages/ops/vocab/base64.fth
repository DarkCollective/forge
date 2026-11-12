\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ base64: Base64 as in RFC 4648. The words are TypeScript primitives (src/prims/base64.ts);
\ this unit only adds the parameter help.
IN: base64

META: decode
  param alphabet "The alphabet of the text: standard (+ /) or url (- _)." ;
  use-when "You have text of letters, digits, plus and slash, often ending in =, and want the bytes it stands for." ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-4" "RFC 4648, section 4: Base 64 encoding" ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-5" "RFC 4648, section 5: the URL-safe alphabet" ;
  link "https://en.wikipedia.org/wiki/Base64" ;
  inverse encode ;
;

META: encode
  param alphabet "The alphabet to use: standard (+ /) or url (- _)." ;
  param padding "Append = padding to a multiple of four characters." ;
  use-when "You need to carry binary data through a channel that only takes plain text, such as an email, a URL or JSON." ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-4" "RFC 4648, section 4: Base 64 encoding" ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-5" "RFC 4648, section 5: the URL-safe alphabet" ;
  link "https://en.wikipedia.org/wiki/Base64" ;
  inverse decode ;
;
