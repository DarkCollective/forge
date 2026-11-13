\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ css: CSS selector, CyberChef's selection of elements from HTML text. The parser, the matcher and the writer are the
\ private primitive css:_select (src/prims/css.ts, htmlparser2, css-select and dom-serializer); the delimiter is read
\ with the shared escape reader of the string-escape vocabulary.
IN: css

USING: string-escape ;

: select ( data:str css-selector:str="" delimiter:str="\\n" -- str )
  "Extract elements from an HTML document with a CSS selector, as CyberChef's CSS selector does: the outer HTML of every matching element, in document order, joined with the delimiter (a match inside another match is listed again, inside it). An empty selector or an empty document gives an empty result. Differences from CyberChef, which parses the HTML as XML with xmldom and matches with nwmatcher: the HTML is read by an HTML parser that repairs unclosed and mis-nested tags and understands void elements and character references (so the document need not be XML and nothing is rejected as invalid HTML), and the matches are written as HTML (<br> and not <br/>, attribute values quoted with double quotes, & < > in text written as entities). The selector language is CSS Selectors level 4 as css-select reads it: type, class, id, attribute (=, ~=, |=, ^=, $=, *=, with the i flag), combinators (descendant, >, +, ~), :not, :is, :where, :has, :nth-child and friends, :first-child, :empty, :root, :contains; a pseudo-element (::before), an unknown pseudo-class and a syntax error are E_COERCE with the message. A selector longer than 4096 characters is E_RANGE; a document nested deeper than 512 levels or with more than 200,000 nodes is E_LIMIT_VALUE; the output is held to the value limit. The delimiter reads the escapes \\n \\r \\t \\xHH \\uHHHH. Nested :has() on a large document can be slow: the host's time limit stops it." doc
  "Extractors" category
  data css-selector css:_select
  delimiter string-escape:unescape join ;

META: select
  use-when "You have an HTML page as text and want the elements that match a CSS selector, such as every item in a list, written out as HTML." ;
  link "https://en.wikipedia.org/wiki/CSS" "CSS on Wikipedia" ;
  param css-selector "The CSS selector, for example div.content > a[href^='https']." ;
  param delimiter "The text put between the matches. Escapes like \\n are read." ;
;
