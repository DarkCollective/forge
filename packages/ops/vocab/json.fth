\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ json: the shared JSON words (RFC 8259) between JSON text and FL values. This vocabulary is internal (it is in
\ INTERNAL_VOCABS): its words are callable from every vocabulary (json:parse, or USING: json) and are never
\ listed in the catalogue. parse, stringify, null and null? are primitives (src/prims/json.ts); compact and pretty
\ are FL.
\
\   json:parse ( text:str -- any )            strict JSON text to a value (object -> record, array -> list, integer -> int,
\                                             other number -> num, null -> json:null)
\   json:stringify ( value:any indent:int -- str )  a value to JSON text, compact for indent 0
\   json:compact ( value:any -- str )         stringify with indent 0
\   json:pretty ( value:any -- str )          stringify with indent 2
\   json:null ( -- record )                   the value standing for JSON null (FL has no null)
\   json:null? ( any -- bool )                is it that value
\
\ See packages/ops/README.md, "JSON values (WP 5.48)", for the rules (null, numbers, bytes, duplicate keys, limits).
IN: json

: compact ( value:any -- str )
  "A value as compact JSON text (no white space). Shared word: call it qualified from any vocabulary." doc
  value 0 json:stringify ;

: pretty ( value:any -- str )
  "A value as JSON text indented by two spaces per level. Shared word: call it qualified from any vocabulary." doc
  value 2 json:stringify ;
