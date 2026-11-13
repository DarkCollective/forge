\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ xpath: XPath expression, CyberChef's XPath 1.0 query over XML text. The parser and the evaluator are the private
\ primitive xpath:_query (src/prims/xpath.ts, @xmldom/xmldom and xpath); the delimiter is read with the shared
\ escape reader of the string-escape vocabulary.
IN: xpath

USING: string-escape ;

: query ( data:str xpath:str="" result-delimiter:str="\\n" -- str )
  "Extract information from an XML document with an XPath 1.0 expression, as CyberChef's XPath expression does: every selected node is written as markup (an element with its content, an attribute as name=\"value\", a text node as its text with < > & escaped, a comment as <!--...-->), in document order, joined with the result delimiter. A name with no prefix matches any namespace (so //item finds items in a document with a default namespace). An expression that gives a number, a string or a boolean (count(//a), string(//a), 1 = 1) writes that value as one text (3, the text, true); CyberChef fails on these. The XML must be well formed (E_COERCE with the parser's message and line); entities declared in a document type are not expanded and external entities are never read. Deliberate limits: an expression longer than 4096 characters is E_RANGE, a document nested deeper than 512 levels or with more than 200,000 nodes is E_LIMIT_VALUE, and the output is held to the value limit. The delimiter reads the escapes \\n \\r \\t \\xHH \\uHHHH. Some expressions are expensive on a large document (a chain of ancestor:: and descendant:: steps took ten seconds on 64 KiB): the host's time limit stops them." doc
  "Extractors" category
  data xpath xpath:_query
  result-delimiter string-escape:unescape join ;

META: query
  use-when "You have an XML document and want the elements, attributes or values that an XPath expression picks out, for example every title or a count of books." ;
  link "https://en.wikipedia.org/wiki/XPath" "XPath on Wikipedia" ;
  link "https://en.wikipedia.org/wiki/XML" "XML on Wikipedia" ;
  param xpath "The XPath 1.0 expression, for example //book[price>10]/title." ;
  param result-delimiter "The text put between the results. Escapes like \\n are read." ;
;
