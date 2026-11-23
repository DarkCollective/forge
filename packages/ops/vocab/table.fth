\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ table: X0 spike. The columnar table value (ext kind `table`) and the relix-expr parameter kind. The primitives
\ are in src/prims/table.ts; the words, their documentation and metadata are FL.
IN: table

: from-csv ( data:str -- t:ext{table} )
  "Read CSV text (RFC 4180, comma and CRLF, LF or CR rows) into a table. The first row names the columns. A column whose cells are all numbers is num, all true or false is bool, anything else is str; an empty cell is null. Prototype: a header that repeats a name, or a row with more cells than the header, is E_COERCE." doc
  "Data format" category
  data _from-csv ;

META: from-csv
  use-when "You have CSV text with a header row and want to look at it as a table, or filter and convert it." ;
  expects "CSV text" ;
  see-also table:to-json table:to-csv csv:to-json ;
;

: to-json ( t:ext{table} indent:int=2 -- str )
  "Write a table as a JSON array of objects. A num is a JSON number, a bool a JSON boolean, a null is null." doc
  "Data format" category
  t indent _to-json ;

META: to-json
  use-when "You have a table and want it as JSON." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also table:from-csv ;
;

: to-csv ( t:ext{table} -- str )
  "Write a table as CSV with a plain header row. A null is an empty cell." doc
  "Data format" category
  t _to-csv ;

META: to-csv
  use-when "You have a table and want it as CSV text." ;
  see-also table:from-csv ;
;

: filter ( t:ext{table} expr:ext{relix-expr} -- ext{table} )
  "Keep the rows for which a comparison holds. The expression is column op value, joined by and or or: age > 30 and name <> \"Bob\". Operators are = <> < <= > >=; a value is a number, a quoted string, true, false or null. A column name that is not in the table is E_PARAM_INVALID." doc
  "Data format" category
  t expr _where ;

META: filter
  use-when "You have a table and want only the rows that match a condition on its columns." ;
  param expr "A condition such as age > 30 and city = \"Oslo\"; column names are completed from the table." ;
  see-also table:from-csv ;
;

: to-expr ( text:str -- e:ext{relix-expr} )
  "Check a condition such as age > 30 and keep it as a relix-expr value. Prototype: it shows the fallback viewer, because the kind has none, and what an ext parameter looks like as data." doc
  "Data format" category
  text _to-expr ;

META: to-expr
  use-when "You want to check a condition on table columns before using it, or to see an expression as a value." ;
  see-also table:filter ;
;
