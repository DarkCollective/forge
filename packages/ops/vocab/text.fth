\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
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
  use-when "You have text with a fixed phrase in it, and want that phrase swapped for another one, without any pattern matching." ;
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
  use-when "You have a text with items on separate lines or joined by a character, such as a comma, and want it cut into a list of items." ;
  inverse join ;
  param separator "The literal separator. The default is a line feed." ;
  see-also regex:split ;
;

: join ( list separator:str="\n" -- str )
  "Join a list of text with the separator. Bytes items are decoded as strict UTF-8." doc
  "Text" category
  [ dup type "bytes" = [ bytes>str ] when ] map
  separator core:join ;

META: join
  use-when "You have a list of text items, such as the output of a split, and want them put back into one text with a separator between them." ;
  inverse split ;
  param separator "The text placed between the items. The default is a line feed." ;
  see-also text:split ;
;

META: lower
  use-when "You have text in upper case, such as a shouted title or a code, and want it in lower case, for example before a comparison." ;
  link "https://en.wikipedia.org/wiki/Letter_case" "Letter case on Wikipedia" ;
;

META: reverse
  use-when "You have text you want written backwards, for example to check a palindrome or to solve a reversed-word puzzle." ;
;

META: upper
  use-when "You have text in lower case and want it in upper case, for example to match a code or to make a heading stand out." ;
  link "https://en.wikipedia.org/wiki/Letter_case" "Letter case on Wikipedia" ;
;
