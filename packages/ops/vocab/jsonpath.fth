\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ jsonpath: JPath expression, CyberChef's JSONPath query over JSON text. The query engine is the private primitive
\ jsonpath:_query (src/prims/jsonpath.ts, the json-p3 library, RFC 9535); the JSON text is read and the matches are
\ written by the shared json words, joined with the delimiter.
IN: jsonpath

USING: json string-escape ;

: query ( data:str query:str="" result-delimiter:str="\\n" -- str )
  "Extract values from JSON text with a JSONPath query and write each match as compact JSON text (a string keeps its quotes), joined with the result delimiter, as CyberChef's JPath expression does. The dialect is the standard one, RFC 9535, not the older Goessner dialect of CyberChef's jsonpath-plus library: $ is the root, @ the current node, a name is .name or ['name'], * selects all children, .. descends, [0] [-1] [1:3] [0,2] pick elements, [?@.price<10] and [?(@.price<10)] filter (comparisons, && || !, existence tests, and the functions length, count, match, search and value), and a query that selects nothing gives an empty result. Script expressions such as [(@.length-1)], the ^ and ~ operators and the @path and @property variables do not exist in the RFC and are E_COERCE with the position of the error. The JSON is read by the shared strict parser (a repeated key or malformed text is E_COERCE); a number that is written with a fraction but has an integral value (12.0) is written as 12, as JSON.stringify does; an integer beyond 2^53 is selected and written exactly, but a filter that compares one never matches (JSONPath numbers are doubles). The delimiter reads the escapes \\n \\r \\t \\xHH \\uHHHH. A query longer than 4096 characters is E_RANGE; nesting deeper than 512 levels is E_LIMIT_VALUE. A very expensive query on a large document is stopped by the host's time limit." doc
  "Extractors" category
  data json:parse query jsonpath:_query
  [ json:compact ] map
  result-delimiter string-escape:unescape join ;

META: query
  param query "The JSONPath query, for example $.store.book[*].author or $..book[?@.price<10]. An empty query is E_COERCE." ;
  param result-delimiter "The text put between the matches. Escapes like \\n are read." ;
;
