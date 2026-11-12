\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ nthash: the Windows NT password hash (NTOWFv1, MS-NLMP section 3.3.1): MD4 of the password as UTF-16LE.
\ Written in FL over charset:encode and md4:digest, so it needs no primitive. It is its own
\ vocabulary (not a word of md4) because its input is text, not bytes, and it is a distinct
\ operation with its own name.
IN: nthash

: digest ( text:str -- bytes )
  "The NT hash of a password: the MD4 digest of the text encoded as UTF-16LE (MS-NLMP NTOWFv1), 16 raw bytes. Chain hex:encode for hex text. Do not use it to store passwords." doc
  "Hashing" category
  text "utf-16le" charset:encode md4:digest ;

META: digest
  use-when "You have a Windows password and want its NT hash, the value NTLM uses, to compare with a stored NT hash. Do not use it to store passwords." ;
;
