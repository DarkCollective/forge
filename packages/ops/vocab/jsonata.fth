\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ jsonata: Jsonata Query, CyberChef's JSONata query and transform over JSON text. The language is the private
\ primitive jsonata:_query (src/prims/jsonata.ts, the jsonata library; asynchronous); the JSON text is read and the
\ result written by the shared json words.
IN: jsonata

USING: json ;

: query ( data:str query:str="string" -- str )
  "Query and transform JSON text with a JSONata expression (https://docs.jsonata.org) and write the result as compact JSON text, as CyberChef's Jsonata Query does: a path such as Account.Order.Product.Price, a filter [Price > 30], a function such as $sum(Account.Order.Product.Price), an object or array constructor, $map, $filter, $reduce, $eval and the rest of the language. A query that selects nothing gives the empty string \"\" (JSON text of an empty string, as CyberChef). The JSON is read by the shared strict parser (a repeated key or malformed text is E_COERCE); integers beyond 2^53 lose precision, as JavaScript numbers do. Deliberate differences from CyberChef: $random, $shuffle, $now and $millis raise an error (Forge ops are deterministic: randomness and time come only from the random and clock vocabularies), $pad is limited to 1,000,000 characters, and evaluation is counted: more than 3,000,000 evaluation steps is E_LIMIT_STEPS, nesting past 1,000 levels and sequences past 1,000,000 items are E_LIMIT_VALUE. A syntax or evaluation error is E_COERCE with the JSONata code, message and position. A result that is a function is E_COERCE. A very expensive regular expression in the query is stopped by the host's time limit." doc
  "Extractors" category
  data json:parse query jsonata:_query json:compact ;

META: query
  use-when "You have a block of JSON and want to pick out or reshape values with a JSONata expression, for example a filtered list or a total written as one line." ;
  link "https://en.wikipedia.org/wiki/JSON" "JSON on Wikipedia" ;
  param query "The JSONata expression. The default, string, selects the field named string; it is CyberChef's default." ;
;
