\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ tlv: Parse TLV, the CyberChef operation of that name. The walk over the elements is the private primitive tlv:_parse
\ (src/prims/tlv.ts; the result list would grow quadratically in FL); the range checks and the JSON text are FL.
IN: tlv

USING: json ;

: parse ( data:bytes tag-bytes:int=1 length-bytes:int=1 ber:bool=false indent:int=4 -- str )
  "Read a run of tag-length-value elements and write them as JSON text, as CyberChef's Parse TLV does: an array with one object per element, with the tag bytes as hex (type), the length (an integer) and the value bytes as hex (value). The tag is tag-bytes bytes (1 to 16) and the length length-bytes bytes (1 to 8), big-endian; with ber on the length is read in the BER/DER form of X.690 instead (a byte below 128, or 128 plus the number of length bytes that follow, up to 6; the indefinite form and the reserved byte 255 are E_COERCE) and length-bytes is not used. Elements are not opened: a constructed value stays hex. Empty input gives []. A header or a value that runs past the end of the data is E_COERCE with the offset. indent is the spaces per level (default 4; 0 gives compact text)." doc
  "Data format" category
  tag-bytes 1 16 "the tag width" util:check-int-range
  length-bytes 1 8 "the length width" util:check-int-range
  data tag-bytes length-bytes ber tlv:_parse indent json:stringify ;

META: parse
  param tag-bytes "How many bytes the tag of an element has." ;
  param length-bytes "How many bytes the length of an element has (big-endian); not used with BER lengths." ;
  param ber "Read the length in the BER/DER form (short form below 128, long form 128 plus a byte count)." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
;
