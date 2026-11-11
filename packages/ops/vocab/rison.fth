\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rison: Rison Encode and Rison Decode, the CyberChef operations of the same names, with Rison, O-Rison and A-Rison as the
\ mode (CyberChef's Encode, Encode Object and Encode Array). The scanner and the writer are two private primitives
\ (rison:_encode and rison:_decode, src/prims/rison.ts; a character loop in FL costs 5.5 VM steps a character
\ before any state); the JSON text side is the shared json words, and the parameters are FL.
IN: rison

USING: json ;

: encode ( data:str mode:choice{rison|o-rison|a-rison}=rison -- str )
  "Write JSON text as Rison (the compact JSON-in-URLs syntax of rison.js), as CyberChef's Rison Encode does. null is !n, true and false are !t and !f, an array is !(1,2), an object is (a:1,b:2) with its keys sorted, a string is bare when it is an identifier (it does not start with - or a digit and holds none of space ' ! : ( ) , * @ $) and otherwise in single quotes with ' and ! escaped by !, and a number is written as JavaScript prints it without the + of an exponent (an integer in full digits; 1.0 is 1). Mode o-rison writes an object without its outer parentheses and a-rison an array without !( and ), as CyberChef's Encode Object and Encode Array do; a value of the wrong kind is E_COERCE. Text that is not JSON and nesting deeper than 64 levels are E_COERCE." doc
  "Data format" category
  data json:parse mode rison:_encode ;

META: encode
  param mode "rison for any value, o-rison for an object without its parentheses, a-rison for an array without !( and )." ;
  see-also rison:decode ;
;

: decode ( data:str mode:choice{rison|o-rison|a-rison}=rison indent:int=4 -- str )
  "Read Rison text and write it as JSON text, as CyberChef's Rison Decode does. Mode o-rison reads the members of an object without its parentheses (a:1,b:2) and a-rison the items of an array without !( and ) (1,2,3), as CyberChef's Decode Object and Decode Array do. Numbers without a fraction or an exponent are exact integers. White space is not allowed inside the text (only around it). A repeated key, an unknown ! form, a bad number, an unterminated string or list, text after the value and nesting deeper than 64 levels are E_COERCE with the offset. indent is the spaces per level (default 4; 0 gives compact text)." doc
  "Data format" category
  data mode rison:_decode indent json:stringify ;

META: decode
  param mode "rison for any value, o-rison for the members of an object, a-rison for the items of an array." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also rison:encode ;
;
