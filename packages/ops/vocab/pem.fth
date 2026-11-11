\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ pem: PEM to Hex and Hex to PEM (CyberChef's two ops) over the shared PEM codec of the internal asn1
\ vocabulary (asn1:pem-decode, asn1:pem-encode, RFC 7468). Both work on hex text, as CyberChef's do; to get the
\ bytes themselves, put From Hex or To Hex next to them.
IN: pem

USING: asn1 ;

: _hex-of ( block:record -- str )
  block "data" get bytes>hex ;

: to-hex ( data:str -- str )
  "The hex digits (lower case) of the decoded body of each PEM block in the text (PEM to Hex), one block per line, in order: -----BEGIN CERTIFICATE----- ... -----END CERTIFICATE----- gives the hex of the DER certificate. Text outside the blocks is ignored. No PEM block in the input is E_COERCE (CyberChef returns nothing); so is a block that is not closed, closed with another label, nested, or whose Base64 is damaged. The label and the RFC 1421 header lines of old encrypted keys are not part of the output." doc
  "Public Key" category
  data str>bytes asn1:pem-decode
  dup len 0 = [ "no PEM block (-----BEGIN ...-----) found in the input" raise:coerce ] when
  [ _hex-of ] map "\n" join ;

: from-hex ( data:str header:str="CERTIFICATE" -- str )
  "A PEM block of the bytes written as hex digits (Hex to PEM): the line -----BEGIN header-----, the Base64 in lines of 64 characters, and the line -----END header-----, each ended by a line feed. header is the label (CERTIFICATE by default; PUBLIC KEY, PRIVATE KEY, CERTIFICATE REQUEST, ...). Hex is read as in From Hex; empty input gives a block with no body. A header that is empty, not printable ASCII or holds five hyphens is E_RANGE; bad hex is E_COERCE." doc
  "Public Key" category
  header data hex>bytes asn1:pem-encode ;

META: to-hex
  see-also pem:from-hex asn1-dump:parse ;
;

META: from-hex
  param header "The label of the block, between BEGIN and END (CERTIFICATE, PUBLIC KEY, PRIVATE KEY, ...)." ;
  see-also pem:to-hex asn1-dump:parse ;
;
