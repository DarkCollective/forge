\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ protobuf: Protobuf Decode, the CyberChef operation of the same name, without a schema. The wire walk is the private
\ primitive protobuf:_decode (src/prims/protobuf.ts; a field-by-field reader in FL costs several hundred VM steps a
\ field); the JSON text is the shared json words, and the parameters and checks are FL. Protobuf Encode needs a .proto
\ schema to know the types and is not done (see the README).
IN: protobuf

USING: json ;

: decode ( data:bytes show-types:bool=false indent:int=4 -- str )
  "Read the fields of a Protocol Buffers message without a schema and write them as JSON text keyed by field number, as CyberChef's Protobuf Decode does when it has no .proto schema (a schema, Show Unknown Fields and Protobuf Encode are not supported). Varints (up to 64 bits), fixed64 and fixed32 values are exact unsigned integers, so the type of the data (signed, zigzag, float, bool) is not known and nothing is converted. A field that appears more than once becomes an array of its values in wire order. A length-delimited field is read as a nested message if its bytes parse completely as one (an empty field is an empty object); otherwise as text if the bytes are valid UTF-8 (CyberChef shows the bytes as Latin-1 characters), otherwise as their hex digits. The keys are in ascending field number, as CyberChef's JSON output has them. Show types writes each key as field #N: and CyberChef's wire type label (VarInt, 64-Bit, L-delim, 32-Bit). Differences from CyberChef: field number 0 is refused (a nested guess fails on it, CyberChef reads it); a varint of more than 64 bits, a truncated field, a length past the data and the group wire types 3 and 4 and the reserved types 6 and 7 are E_COERCE with the offset at the top level (CyberChef reads a truncated varint as NaN or throws), and make a nested guess fail; nesting is tried to 64 levels. indent is the spaces per level (default 4, CyberChef's; 0 is compact)." doc
  "Networking" category
  data show-types protobuf:_decode indent json:stringify ;

META: decode
  param show-types "Write each key as field #N: and the wire type (VarInt, 64-Bit, L-delim or 32-Bit) instead of the bare field number." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also varint:decode varint:encode ;
;
