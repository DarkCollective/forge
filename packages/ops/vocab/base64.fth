\ base64: Base64 as in RFC 4648. The words are TypeScript primitives (src/prims/base64.ts);
\ this unit only adds the parameter help.
IN: base64

META: decode
  param alphabet "The alphabet of the text: standard (+ /) or url (- _)." ;
;

META: encode
  param alphabet "The alphabet to use: standard (+ /) or url (- _)." ;
  param padding "Append = padding to a multiple of four characters." ;
;
