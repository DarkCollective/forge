\ text: operations on text. They take str, so bytes are decoded as strict UTF-8 first.
\ replace, split and join are written in FL over the core string and list words.
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

: replace ( str find:str[1..] replacement:str all:bool=true -- str )
  "Replace literal (non-regex) occurrences of find. With all false only the first is replaced." doc
  "Text" category
  find core:split
  all
  [ replacement core:join ]
  [ dup len 1 =
    [ 0 nth ]
    [ dup 0 nth replacement cat swap 1 over len slice find core:join cat ]
    if ]
  if ;

META: replace
  param find "The literal text to look for. It must not be empty." ;
  param replacement "The text to put in place of each match. It is not a pattern: $ has no special meaning." ;
  param all "True replaces every occurrence, false only the first." ;
  see-also regex:replace ;
;

: split ( str separator:str[1..]="\n" -- list )
  "Split the text at every occurrence of the separator (literal, not a pattern)." doc
  "Text" category
  separator core:split ;

META: split
  param separator "The literal separator. The default is a line feed." ;
  see-also regex:split ;
;

: join ( list separator:str="\n" -- str )
  "Join a list of text with the separator. Bytes items are decoded as strict UTF-8." doc
  "Text" category
  [ dup type "bytes" = [ bytes>str ] when ] map
  separator core:join ;

META: join
  param separator "The text placed between the items. The default is a line feed." ;
  see-also text:split ;
;
