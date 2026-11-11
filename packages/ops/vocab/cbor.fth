\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ cbor: CBOR (RFC 8949) Encode and Decode, the CyberChef operations of the same names. The encoder takes JSON text and
\ writes bytes, the decoder reads bytes and writes JSON text (CyberChef's shape). The data item walk is two private
\ primitives (cbor:_decode and cbor:_encode, src/prims/cbor.ts; a node-by-node reader in FL costs several hundred VM
\ steps an element); the JSON text side is the shared json words, and the parameters and checks are FL.
IN: cbor

USING: json ;

: decode ( data:bytes indent:int=4 -- str )
  "Read one CBOR data item (RFC 8949) and write it as JSON text, as CyberChef's CBOR Decode does. All major types are read, with indefinite lengths, half, single and double floats, and big integers (tags 2 and 3 are exact integers). A byte string is shown as {\"type\":\"Buffer\",\"data\":[...]} (what JSON.stringify makes of the Buffer CyberChef decodes to); tags 0 and 1 are dates, shown as ISO 8601 text with three fractional digits; every other tag is {\"tag\":N,\"value\":V}; a simple value other than false, true, null and undefined is {\"simple\":N}; undefined, NaN and the infinities are null, as JSON.stringify writes them. A map key that is not text is written as the text of an integer, float, boolean or null (any other key is E_COERCE) and a repeated key is E_COERCE. Floats stay floats (1.0 is written 1.0). The input must be exactly one data item: empty input, bytes after it, a truncated item, invalid UTF-8, a reserved head, a break outside an indefinite item and nesting deeper than 64 levels are E_COERCE with the offset. indent is the spaces per level (default 4; 0 gives compact text)." doc
  "Data format" category
  data cbor:_decode indent json:stringify ;

META: decode
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also cbor:encode ;
;

: encode ( data:str typed-objects:bool=false -- bytes )
  "Write JSON text as CBOR (RFC 8949), as CyberChef's CBOR Encode does, in the deterministic form of section 4.2.1: integers and lengths in the shortest head, a float in the shortest of half, single and double that holds the value exactly, definite lengths only, and map keys sorted bytewise by their encoding. An integer outside -2^64 to 2^64-1 becomes a bignum (tag 2 or 3); a number written with a fraction or an exponent is a float (1.0 is f93c00); null is null; text is UTF-8 text. With typed-objects on, the shapes the decoder writes are read back: {\"type\":\"Buffer\",\"data\":[...]} is a byte string, {\"tag\":N,\"value\":V} is a tag and {\"simple\":N} is a simple value (CyberChef writes them as maps; dates cannot round trip because their text is a plain string). Text that is not JSON, or nesting deeper than 64 levels, is E_COERCE." doc
  "Data format" category
  data json:parse typed-objects cbor:_encode ;

META: encode
  param typed-objects "Write {\"type\":\"Buffer\",\"data\":[...]} as a byte string, {\"tag\":N,\"value\":V} as a tag and {\"simple\":N} as a simple value, instead of as maps." ;
  see-also cbor:decode ;
;
