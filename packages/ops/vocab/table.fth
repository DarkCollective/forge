\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ table: the table value (TOOLKIT.md section 7): columnar, typed columns (str, int, num, bool) and a null mask, held as
\ the ext kind `table` (src/table/). The kind, the typed storage and the JSON and CSV writers are TypeScript
\ (src/prims/table.ts, src/table/): FL cannot build a typed column, and a list of records per row would cost far more
\ than the table. What is FL here is the metadata, the parameter checks and the words that only combine others.
\
\   table:from-rows ( names:list rows:list -- table )   a table from column names and a list of rows (lists of cells)
\   table:from-records ( records:list -- table )        a table from records; its columns are every key, first seen first
\   table:from-text ( text:str -- table )               a table from its text form (what ext>text writes)
\   table:from-json ( data header -- table )            JSON text: an array of records, an array of arrays or one record
\   table:from-ndjson ( data header -- table )          one record or array on each line (NDJSON, JSON Lines)
\   table:columns ( t -- list )                         the column names
\   table:types ( t -- list )                           the column types: str, int, num or bool
\   table:rows ( t -- list )                            the rows, each a list of cells (null for a null cell)
\   table:records ( t -- list )                         the rows as records keyed by the column names
\   table:column ( t name:str -- list )                 the cells of one column
\   table:count ( t -- int )                            the number of rows
\   table:to-json ( t indent:int -- str )               a JSON array of objects, null cells as null
\   table:to-csv ( t cell-delimiter row-delimiter -- str ) RFC 4180 text with a header row, null cells empty
\
\ A cell is a str, an int (within 64 bits), a num, a bool or null (the FL `null`, which is not the empty string).
\ A table is also read from CSV (csv:parse), from JSON (table:from-json) and from NDJSON (table:from-ndjson).
IN: table

USING: list ;

\ ---- build ----

: from-rows ( names:list rows:list -- ext{table} )
  "Build a table from the column names (strings, none repeated) and a list of rows, each a list with one cell per column. A cell is a str, an int within 64 bits, a num, a bool or null. A column takes the one type its cells have: ints and nums together make a num, and a column of nulls only is a str column. A column that mixes other types, an int beyond 64 bits, a repeated name or a row of the wrong length is E_COERCE." doc
  names rows table:_from-rows ;

META: from-rows
  helper ;
;

\ The value of a field of a record, null when the record has no such key.
: _field ( record:record name:str -- any )
  record name has-key? [ record name get ] [ null ] if ;

\ Every key of every record, each once, in the order they are first seen.
: _names ( records:list -- list )
  records { } [ keys cat ] reduce list:unique ;

: from-records ( records:list -- ext{table} )
  "Build a table from a list of records. The columns are every key of every record, each once, in the order they are first seen; a record that lacks a key has null there. The types are those of from-rows." doc
  records _names :> names
  names records [ :> r names [ r swap _field ] map ] map
  table:_from-rows ;

META: from-records
  helper ;
;

: from-text ( text:str -- ext{table} )
  "Read a table from its text form: JSON with a column header, for example {\"columns\":[{\"name\":\"id\",\"type\":\"int\"}],\"rows\":[[1],[null]]}. The text keeps nulls apart from empty strings and ints from nums; an int beyond 2^53 is written as a string of digits. Anything else is E_COERCE with the offset of a syntax error." doc
  "Data format" category
  text table:_from-text ;

META: from-text
  use-when "You have the text form of a table, as written by ext>text or saved from a table output, and want the table back." ;
  expects "The text form of a table: JSON with a column header and rows" ;
  see-also to-json ;
;

: from-json ( data:str header:bool=true -- ext{table} )
  "Read JSON text into a table. The text is an array of records (an object each), an array of arrays or one record (one row). For records the columns are every key, each once, in the order they are first seen, and a record that lacks a key has null there; header is not used. For arrays the first array is the header row of column names when header is on, and without it the columns are c1, c2 and so on; every array must have as many cells as the first. A JSON null is a null cell. A column takes the one type its cells have: ints, nums, bools or strs, an int and a num together make a num, and a column of nulls only is a str column. A column that mixes any other types, an integer beyond 64 bits, a nested array or record in a cell, a repeated column name or text that is not JSON is E_COERCE." doc
  "Data format" category
  data header table:_from-json ;

META: from-json
  use-when "You have JSON text, such as an export from an API with one object for each row, and want a table with typed columns." ;
  param header "For an array of arrays, read the first array as the column names; off, the columns are c1, c2 and so on. Records name their own columns." ;
  expects "JSON text: an array of objects, an array of arrays or one object" ;
  checks input utf8 ;
  see-also from-ndjson ;
;

: from-ndjson ( data:str header:bool=true -- ext{table} )
  "Read newline-delimited JSON (NDJSON, JSON Lines) into a table: one JSON value on each line, an object or an array, with blank lines skipped. The lines are read as the elements of table:from-json, so the columns, the header option and the column types are the same; a line that is not JSON is E_COERCE and names its line number." doc
  "Data format" category
  data header table:_from-ndjson ;

META: from-ndjson
  use-when "You have a log or an export with one JSON object on each line and want a table with typed columns." ;
  param header "For lines that are arrays, read the first line as the column names; off, the columns are c1, c2 and so on." ;
  expects "NDJSON text: one JSON object or array on each line" ;
  checks input utf8 ;
  see-also from-json ;
;

\ ---- inspect ----

: columns ( t:ext{table} -- list )
  "The column names of a table, in order." doc
  t table:_columns ;

META: columns
  helper ;
;

: types ( t:ext{table} -- list )
  "The column types of a table, in order: str, int, num or bool." doc
  t table:_types ;

META: types
  helper ;
;

: rows ( t:ext{table} -- list )
  "The rows of a table, each a list with one cell per column. A null cell is null, which is not the empty string." doc
  t table:_rows ;

META: rows
  helper ;
;

: records ( t:ext{table} -- list )
  "The rows of a table as records keyed by the column names." doc
  t table:_columns :> names
  t table:_rows [ names swap zip >record ] map ;

META: records
  helper ;
;

: column ( t:ext{table} name:str -- list )
  "The cells of one column, in row order. An unknown column name is E_RANGE." doc
  t name table:_column ;

META: column
  helper ;
;

: count ( t:ext{table} -- int )
  "The number of rows of a table." doc
  t table:_count ;

META: count
  helper ;
;

\ ---- export ----

: to-json ( t:ext{table} indent:int[0..16]=2 -- str )
  "Write a table as JSON text: an array with an object for each row, keyed by the column names. A null cell is null, an int is written with all its digits and a num as a JSON number. indent is the spaces per level (default 2; 0 gives compact text). A table with no rows gives []." doc
  "Data format" category
  t indent table:_to-json ;

META: to-json
  use-when "You have a table, for example parsed from a CSV file, and want it as JSON for another tool or for reading." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  expects "A table" ;
  checks output utf8 ;
  checks output printable ;
  see-also to-csv ;
;

: to-csv ( t:ext{table} cell-delimiter:str="," row-delimiter:str="\\r\\n" -- str )
  "Write a table as CSV text (RFC 4180): a header row of the column names, then a row for each row, each ending with the row delimiter. A null cell is empty and an empty string is written as two double quotes, so a reader that can tell them apart gets the table back. A cell is quoted when it holds a delimiter, a double quote or a line break. Both delimiters read the escapes \\r \\n \\t \\\\ and \\xHH." doc
  "Data format" category
  t cell-delimiter row-delimiter table:_to-csv ;

META: to-csv
  use-when "You have a table and want a CSV file for a spreadsheet or another tool." ;
  param cell-delimiter "The text that ends a cell. Escapes like \\t are read." ;
  param row-delimiter "The text that ends a row. Escapes like \\r\\n are read." ;
  expects "A table" ;
  checks output utf8 ;
  checks output printable ;
  see-also to-json ;
;
