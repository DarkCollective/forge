\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ html-text: the readable text of an HTML document. Written in FL over the regex words and html:decode. It is a
\ pattern-based tag stripper, not an HTML parser: it does not build a tree, repair bad markup or run anything, so the
\ result is the text that a person would read, in the order of the source. It is meant for looking at the text of a
\ page or an e-mail, never for sanitising HTML.
IN: html-text

\ The elements whose start and end tags are line breaks. Tags are matched by name, in either case, up to the next >.
: _blocks ( -- str )
  "</?(?:address|article|aside|blockquote|body|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|html|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|title|tr|ul)\\b[^>]*>" ;

: to-text ( str -- str )
  "The text of HTML: comments, script and style elements (with their content, and to the end if never closed) and the DOCTYPE are dropped; br and the tags of block-level elements (p, div, li, tr, h1 to h6, and so on) become a line feed; every other tag is dropped; then character references are decoded (html:decode, so &amp;lt; stays the text &lt;) and runs of three or more line feeds are cut to two and the text is trimmed. It is not a parser and does not repair markup: a < that does not start a tag stays, and a > inside a quoted attribute value ends the tag early. Never use it to sanitise HTML." doc
  "Language" category
  "<!--[\\s\\S]*?(?:-->|$)" "" "" regex:replace
  "<(script|style)\\b[^>]*>[\\s\\S]*?(?:</\\1\\s*>|$)" "" "i" regex:replace
  "<br\\b[^>]*>" "\n" "i" regex:replace
  _blocks "\n" "i" regex:replace
  "<[!?][^>]*>" "" "" regex:replace
  "</?[A-Za-z][^>]*>" "" "" regex:replace
  html:decode
  "\n{3,}" "\n\n" "" regex:replace
  [ util:space? ] util:trim-start [ util:space? ] util:trim-end ;

META: to-text
  use-when "You have an HTML page or snippet and want only its readable text, such as the words of an email, without the tags." ;
  link "https://en.wikipedia.org/wiki/HTML" "HTML on Wikipedia" ;
  see-also html:decode regex:replace ;
;
