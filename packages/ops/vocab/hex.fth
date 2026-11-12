\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ hex: hexadecimal text. The words are TypeScript primitives (src/prims/hex.ts);
\ this unit only adds the parameter help.
IN: hex

META: encode
  use-when "You have bytes or text and want to see or send them as hex digits, for example to read a binary value or to write a fingerprint as aa:bb:cc." ;
  inverse decode ;
  param delimiter "What to put between the bytes: nothing, a space or a colon." ;
  param case "Digits a-f in lower case, or A-F in upper case." ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-8" "RFC 4648, section 8: Base16" ;
  link "https://en.wikipedia.org/wiki/Hexadecimal" "Hexadecimal on Wikipedia" ;
;

META: decode
  use-when "You have hex digits, with or without spaces, and want the bytes or text they stand for, for example from a hex dump or a copied key." ;
  inverse encode ;
  link "https://www.rfc-editor.org/rfc/rfc4648#section-8" "RFC 4648, section 8: Base16" ;
  link "https://en.wikipedia.org/wiki/Hexadecimal" "Hexadecimal on Wikipedia" ;
;
