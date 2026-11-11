\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ oid: Hex to Object Identifier and Object Identifier to Hex (CyberChef's two ops), over the shared codec of the
\ internal asn1 vocabulary (asn1:oid-decode, asn1:oid-encode). The hex is the content bytes of an OBJECT
\ IDENTIFIER, without the tag and length (2a864886f70d010101, not 06092a864886f70d010101).
IN: oid

USING: asn1 ;

: from-hex ( data:str -- str )
  "The dotted object identifier of the hex digits of its DER content bytes (Hex to Object Identifier): 2a864886f70d010101 is 1.2.840.113549.1.1.1. Hex is read as in From Hex (white space ignored); the tag and length bytes are not part of the input. Arcs may be any size (the 2.25.<UUID> arcs are 128 bits). Bad hex, empty input, a cut-short or non-minimal sub-identifier is E_COERCE." doc
  "Public Key" category
  data hex>bytes asn1:oid-decode ;

: to-hex ( data:str -- str )
  "The hex digits (lower case, no separators) of the DER content bytes of a dotted object identifier (Object Identifier to Hex): 1.2.840.113549.1.1.1 is 2a864886f70d010101; the tag and length bytes are not written. Surrounding white space is ignored. Fewer than two arcs, a first arc above 2, a second arc of 40 or more under 0 or 1, or anything but digits is E_COERCE." doc
  "Public Key" category
  data asn1:oid-encode bytes>hex ;

META: from-hex
  see-also oid:to-hex asn1-dump:parse ;
;

META: to-hex
  see-also oid:from-hex asn1-dump:parse ;
;
