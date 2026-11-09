\ text: operations on text. They take str, so bytes are decoded as strict UTF-8 first.
IN: text

: upper ( str -- str )
  "Convert to upper case." doc
  "Text" category
  core:upper ;

: lower ( str -- str )
  "Convert to lower case." doc
  "Text" category
  core:lower ;

: reverse ( str -- str )
  "Reverse the order of the characters (code points)." doc
  "Text" category
  core:rev ;
