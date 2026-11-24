\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ json-table: JSON and NDJSON text into a table (D1, T55). The JSON is read by the one JSON reader of core (json>value)
\ and the cells go straight into typed columns (src/prims/json-table.ts, src/table/builder.ts), by the same rule as
\ table:from-rows: a column takes the one type its cells have. The CSV reader is csv:parse; the writers are table:to-json
\ and table:to-csv.
\
\   json-table:parse ( data header -- table )          an array of records, an array of arrays or one record
\   json-table:parse-ndjson ( data header -- table )   one record or array on each line
IN: json-table

: parse ( data:str header:bool=true -- ext{table} )
  "Read JSON text into a table. The text is an array of records (an object each), an array of arrays or one record (one row). For records the columns are every key, each once, in the order they are first seen, and a record that lacks a key has null there; header is not used. For arrays the first array is the header row of column names when header is on, and without it the columns are c1, c2 and so on; every array must have as many cells as the first. A JSON null is a null cell. A column takes the one type its cells have: ints, nums, bools or strs, an int and a num together make a num, and a column of nulls only is a str column. A column that mixes any other types, an integer beyond 64 bits, a nested array or record in a cell, a repeated column name or text that is not JSON is E_COERCE." doc
  "Data format" category
  data header json-table:_parse ;

META: parse
  use-when "You have JSON text, such as an export from an API with one object for each row, and want a table with typed columns." ;
  param header "For an array of arrays, read the first array as the column names; off, the columns are c1, c2 and so on. Records name their own columns." ;
  expects "JSON text: an array of objects, an array of arrays or one object" ;
  checks input utf8 ;
  see-also parse-ndjson ;
;

: parse-ndjson ( data:str header:bool=true -- ext{table} )
  "Read newline-delimited JSON (NDJSON, JSON Lines) into a table: one JSON value on each line, an object or an array, with blank lines skipped. The lines are read as the elements of json-table:parse, so the columns, the header option and the column types are the same; a line that is not JSON is E_COERCE and names its line number." doc
  "Data format" category
  data header json-table:_parse-ndjson ;

META: parse-ndjson
  use-when "You have a log or an export with one JSON object on each line and want a table with typed columns." ;
  param header "For lines that are arrays, read the first line as the column names; off, the columns are c1, c2 and so on." ;
  expects "NDJSON text: one JSON object or array on each line" ;
  checks input utf8 ;
  see-also parse ;
;
