\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ yaml: YAML to JSON and JSON to YAML, the CyberChef operations of the same names. The reader and the writer are the
\ private primitives yaml:_parse and yaml:_dump (src/prims/yaml.ts, over the `yaml` library: YAML is not a format a
\ short FL loop can read); the JSON side is the shared json words. YAML null is json:null.
IN: yaml

USING: json ;

: to-json ( data:str indent:int[0..32]=4 -- str )
  "Read one YAML 1.2 document (core schema) and write it as JSON text. CyberChef 11.5.0 reads with js-yaml 5, which reads the YAML 1.2 core schema too (checked by running it: yes is a string, 2001-01-01 is a string, 0x1f is an integer); this reads the YAML 1.2 core schema: null (null, ~, an empty value), true and false only in those spellings (yes and no are strings), integers in decimal, 0o octal and 0x hexadecimal (exact, big integers kept), floats, strings; merge keys (<<) work, and timestamps, !!binary, !!set, !!omap and any other tag are not interpreted: the value is kept as the plain text it has (js-yaml 5 fails on !!binary and !!set). A mapping key that is not a string becomes its text (1, true, null); a key that is a collection, two keys that become the same text, and .inf, -.inf and .nan (no JSON form; CyberChef writes null) are E_COERCE. A repeated key is E_COERCE, as in js-yaml. More than one document in the text is E_COERCE too (CyberChef: expected a single document); an empty text is null. Syntax errors are E_COERCE with the offset, line and column. Aliases are shared references; a document that expands past the value limit (a billion-laughs document) is E_LIMIT_VALUE, an alias that refers to a collection that contains it is E_COERCE, and nesting deeper than 512 levels is E_LIMIT_VALUE. The JSON is indented by 4 spaces as CyberChef writes it (indent 0 gives compact text; this parameter is an addition to CyberChef's); floats are written as in the other JSON words (1.0, 1e+21)." doc
  "Data format" category
  data yaml:_parse indent json:stringify ;

META: to-json
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also yaml:from-json ;
;

: from-json ( data:str -- str )
  "Write JSON text as YAML 1.2 in block style with a 2-space indent, as CyberChef's JSON to YAML does (js-yaml with its defaults): single quotes, mappings keep their order, and every string that YAML 1.1 or 1.2 would read as another type (yes, null, 1e3, 2001-01-01, 0x1f, a key with a colon) is quoted. Differences from js-yaml, all cosmetic or safer: a long string is folded as a multi-line plain scalar, not as >- (both read back as the same string); a float with no fraction keeps it (1.0 is written 1.0, js-yaml writes 1 and the reader then sees an integer); strings that only YAML 1.1 reads as another type are quoted, as js-yaml does. The JSON is read by the shared strict parser (a repeated key, a lone surrogate or malformed text is E_COERCE). The text ends with a line break." doc
  "Data format" category
  data json:parse yaml:_dump ;

META: from-json
  see-also yaml:to-json ;
;
