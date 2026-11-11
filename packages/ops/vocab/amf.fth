\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ amf: Action Message Format 0 and 3, the CyberChef operations AMF Encode and AMF Decode. The encoder takes JSON text and
\ writes bytes, the decoder reads bytes and writes JSON text (CyberChef's shape). The value walk, with the reference
\ tables of AMF3, is two private primitives (amf:_decode and amf:_encode, src/prims/amf.ts); the JSON text side is
\ the shared json words, and the parameters are FL.
IN: amf

USING: json ;

: decode ( data:bytes format:choice{AMF0|AMF3}=AMF0 indent:int=4 -- str )
  "Read one AMF0 or AMF3 value (Adobe's specifications) and write it as JSON text, as CyberChef's AMF Decode does. A whole number of at most 2^53 is an integer, any other number a float, NaN and the infinities null; undefined and null are null; a date is ISO 8601 text; a typed object, an ECMA array and an AMF3 array with named keys are objects (the class name is dropped; the dense items of such an array get the keys 0, 1, ...); a byte array is {\"type\":\"Buffer\",\"data\":[...]}; the AMF3 vectors are arrays and the dictionary an object. An AMF0 value may switch to AMF3 (the avmplus marker). References to earlier objects and strings are followed and copied; a cycle is E_COERCE because JSON cannot show it. Only one value is read: an AMF packet with headers and messages is not. The movieclip, recordset and externalizable markers, a bad reference, a truncated value, bytes after the value, invalid UTF-8, a repeated key and nesting deeper than 64 levels are E_COERCE with the offset. indent is the spaces per level (default 4; 0 gives compact text)." doc
  "Data format" category
  data format amf:_decode indent json:stringify ;

META: decode
  param format "AMF0 or AMF3: the format of the value." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also amf:encode ;
;

: encode ( data:str format:choice{AMF0|AMF3}=AMF0 -- bytes )
  "Write JSON text as one AMF0 or AMF3 value, as CyberChef's AMF Encode does. AMF0: every number as a double, text as a string (a long string above 65535 bytes), an array as a strict array, an object as an anonymous object, null as null. AMF3: integers from -2^28 to 2^28-1 as AMF3 integers, other numbers as doubles, text as a string, an array as a dense array, an object as a dynamic anonymous object, null as null. No reference tables are written, and bytes have no JSON form, so a byte array cannot be written. An empty property name (not writable in AMF0 and AMF3 objects), a length that does not fit, text that is not JSON and nesting deeper than 64 levels are E_COERCE." doc
  "Data format" category
  data json:parse format amf:_encode ;

META: encode
  param format "AMF0 or AMF3: the format to write." ;
  see-also amf:decode ;
;
