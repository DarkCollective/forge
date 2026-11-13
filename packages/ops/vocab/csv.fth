\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ csv: CSV (RFC 4180) to JSON and JSON to CSV, the CyberChef operations of the same names. The scan of the CSV text
\ and its writer are the private primitives csv:_parse and csv:_write (src/prims/csv.ts; a per-character FL scanner
\ is far too slow at 64 KiB); the header rules, the mapping between rows and JSON values and the checks are FL over the
\ shared json words. Every CSV cell is a string; JSON values that are not strings are written as their JSON text
\ (a null as an empty cell).
IN: csv

USING: json list ;

\ ---- CSV to JSON ----

\ A header must not repeat a name: the objects would silently lose a column.
: _check-header ( header:list -- )
  header list:unique len header len <> [ "the header row repeats a column name, so the objects would lose a column" raise:coerce ] when ;

\ Row n of the CSV (counting the header as row 1) as an object keyed by the header.
: _record ( row:list n:int header:list -- record )
  row len header len <> [
    "CSV row " n 1 + int>str cat " has " cat row len int>str cat " cells but the header has " cat header len int>str cat raise:coerce
  ] when
  header row zip >record ;

: _dicts ( rows:list -- list )
  rows len 0 = [ { } ] [
    rows 0 nth _check-header
    1 rows len range [ dup rows swap nth swap rows 0 nth _record ] map
  ] if ;

: to-json ( data:str cell-delimiter:str="," row-delimiter:str="\\r\\n" format:choice{array-of-dictionaries|array-of-arrays}="array-of-dictionaries" indent:int=4 -- str )
  "Read CSV (RFC 4180) and write it as JSON text, as CyberChef's CSV to JSON does. Each character of the cell delimiter ends a cell and each character of the row delimiter ends a row (CyberChef's delimiters are sets of characters: the default row delimiter accepts CRLF, LF and CR); both read the escapes \\r \\n \\t \\\\ and \\xHH. A cell that starts with a double quote runs to the closing quote and may hold delimiters and line breaks, a doubled quote in it is one quote, and a quote inside an unquoted cell is kept; an unterminated quote or text after a closing quote is E_COERCE with the position. Empty lines are skipped and the last row needs no row end. Every value is a JSON string. array-of-arrays gives the rows as they are (they may differ in length); array-of-dictionaries takes the first row as the header and writes one object per later row with its keys in header order. A repeated header name, or a row whose cell count differs from the header, is E_COERCE (CyberChef drops the extra cells and the missing keys silently). A header with no rows gives []. A byte order mark at the start is dropped, as CyberChef does. indent is the spaces per level (default 4, the indent of CyberChef's JSON output; 0 gives compact text); this parameter is an addition to CyberChef's." doc
  "Data format" category
  data cell-delimiter row-delimiter csv:_parse
  format "array-of-dictionaries" = [ _dicts ] when
  indent json:stringify ;

META: to-json
  use-when "You have CSV text from a spreadsheet or an export, with a header row, and want each row as a JSON object keyed by the headers." ;
  param cell-delimiter "The characters that end a cell; each one counts. Escapes like \\t are read." ;
  param row-delimiter "The characters that end a row; each one counts, and a CR followed by an LF is one. Escapes like \\r\\n are read." ;
  param format "An array of objects keyed by the header row, or an array of arrays of the rows as they are." ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also csv:from-json ;
  inverse from-json ;
  link "https://www.rfc-editor.org/rfc/rfc4180" "RFC 4180: CSV format" ;
  link "https://en.wikipedia.org/wiki/Comma-separated_values" "Comma-separated values on Wikipedia" ;
;

\ ---- JSON to CSV ----

\ A cell: a string as it is, null as nothing, anything else as its JSON text (a number, true or false, an array, an object).
: _cell ( v:any -- str )
  v type "str" = [ v ] [ v json:null? [ "" ] [ v json:compact ] if ] if ;

\ True for an object that is not the null sentinel.
: _object? ( v:any -- bool )
  v type "record" = v json:null? not and ;

: _need-all ( items:list pred:quot what:str -- )
  items pred filter len items len <> [ "a JSON array to convert must hold only " what cat raise:coerce ] when ;

\ The cell of key k in an object, or an empty cell when it has no such key.
: _field ( r:any k:str -- str )
  r keys k util:contains? [ r k get _cell ] [ "" ] if ;

: _dict-row ( r:any header:list -- list )
  r keys header = [ header [ r swap get _cell ] map ] [ header [ r swap _field ] map ] if ;

\ The header (all the keys, in order of first appearance) and then one row per object.
: _dict-table ( items:list header:list -- list )
  { } header append
  items [ header _dict-row ] map cat ;

: _dicts-out ( items:list -- list )
  items [ _object? ] "objects" _need-all
  items items [ keys ] map util:list-flatten list:unique _dict-table ;

: _arrays-out ( items:list -- list )
  items [ type "list" = ] "arrays" _need-all
  items [ [ _cell ] map ] map ;

\ The rows of a JSON array: of objects (with a header row) or of arrays.
: _items-table ( items:list -- list )
  items len 0 = [ { } ] [
    items 0 nth _object? [ items _dicts-out ] [
      items 0 nth type "list" = [ items _arrays-out ] [
        "a JSON array to convert must hold objects or arrays" raise:coerce { }
      ] if
    ] if
  ] if ;

: _table ( v:any -- list )
  v _object? [ { } v append _dicts-out ] [
    v type "list" = [ v _items-table ] [
      "the JSON to convert must be an array of objects, an array of arrays, or one object" raise:coerce { }
    ] if
  ] if ;

: from-json ( data:str cell-delimiter:str="," row-delimiter:str="\\r\\n" -- str )
  "Write JSON text as CSV (RFC 4180), as CyberChef's JSON to CSV does. The input is an array of objects, an array of arrays, or one object (one row). For objects the first row is the header, the keys of all the objects in order of first appearance (CyberChef takes the keys of the first object), and an object without a key gives an empty cell; for arrays there is no header row. A string is written as it is, null as an empty cell (CyberChef writes the word null), and a number, true, false, an array or an object as its JSON text (CyberChef: a nested value makes it flatten the keys to a.b names). A cell is quoted when it holds the cell or the row delimiter, a double quote, a CR or an LF. The cell and row delimiters are used as written (both read the escapes \\r \\n \\t \\\\ and \\xHH; the default row delimiter is CRLF), and a row delimiter follows every row, the last one too, as CyberChef writes it. An empty array gives empty text (CyberChef fails). Anything else, an array that mixes objects and arrays or holds other values, a repeated key, or text that is not JSON is E_COERCE." doc
  "Data format" category
  data json:parse _table cell-delimiter row-delimiter csv:_write ;

META: from-json
  use-when "You have JSON text as an array of objects, such as an export from an API, and need CSV for a spreadsheet." ;
  param cell-delimiter "The text put between the cells. Escapes like \\t are read." ;
  param row-delimiter "The text put between the rows. Escapes like \\r\\n are read." ;
  see-also csv:to-json ;
  inverse to-json ;
  link "https://www.rfc-editor.org/rfc/rfc4180" "RFC 4180: CSV format" ;
  link "https://en.wikipedia.org/wiki/Comma-separated_values" "Comma-separated values on Wikipedia" ;
;
