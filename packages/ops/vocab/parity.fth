\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ parity: add or check a parity bit on a string of binary digits (CyberChef's Parity Bit), written
\ in FL on the core words; no primitives. The input is text of 0 and 1 characters (and spaces,
\ which are kept and ignored), optionally in blocks separated by a delimiter, each block with
\ its own parity bit.
IN: parity

\ The number of 1 characters in the text.
: _ones ( s:str -- int )
  s "1" split len 1 - ;

\ E_COERCE unless the block holds only 0, 1 and space.
: _check-chars ( block:str -- )
  block "0" split "" join "1" split "" join " " split "" join
  dup len 0 > [ str>codes 0 nth util:cp>str "unexpected character " swap cat raise:coerce ] [ drop ] if ;

: _bit ( block:str mode:str -- str )
  block _check-chars
  block _ones mode "odd" = [ 1 + ] when 2 mod int>str ;

: _encode-block ( block:str mode:str position:str -- str )
  block mode _bit
  position "end" = [ block swap cat ] [ block cat ] if ;

: _decode-block ( block:str mode:str position:str verify:bool -- str )
  block len 0 = [ "no parity bit to remove" raise:coerce ] when
  verify [
    block _check-chars
    block _ones 2 mod mode "odd" = [ 1 ] [ 0 ] if <>
    [ "parity check failed" raise:coerce ] when
  ] when
  position "end" = [ block 0 block len 1 - slice ] [ block 1 block len slice ] if ;

\ Apply the quotation to the whole text, or to each block when there is a delimiter.
: _blocks ( text:str delimiter:str f:quot -- str )
  text len 0 =
  [ text ]
  [ delimiter len 0 = [ text f call ] [ text delimiter split f map delimiter join ] if ]
  if ;

: encode ( bits:str mode:choice{even|odd}=even position:choice{start|end}=end delimiter:str[0..16]="" -- str )
  "Add a parity bit to a string of binary digits. Even parity makes the number of 1 bits, parity bit included, even; odd parity makes it odd. With a delimiter, the text is split at it and each block gets its own parity bit. Spaces are kept and not counted; any other character that is not 0 or 1 is an error. The empty input gives the empty text." doc
  "Hashing" category
  bits delimiter [ mode position _encode-block ] _blocks ;

: decode ( bits:str mode:choice{even|odd}=even position:choice{start|end}=end delimiter:str[0..16]="" verify:bool=true -- str )
  "Remove the parity bit from a string of binary digits (from each block, with a delimiter). With verify on, the parity of every block is checked against the mode and a mismatch is an error; CyberChef removes the bit without checking." doc
  "Hashing" category
  bits delimiter [ mode position verify _decode-block ] _blocks ;

META: encode
  use-when "You have a string of 0 and 1 digits, such as bits from an old serial link, and need a parity bit added to each block so the count of 1 bits is even or odd." ;
  inverse decode ;
  param mode "even: the total number of 1 bits becomes even. odd: it becomes odd." ;
  param position "Put the parity bit at the start or at the end of each block." ;
  param delimiter "Separates blocks that each get a parity bit. Empty: the whole input is one block." ;
  see-also parity:decode ;
  link "https://en.wikipedia.org/wiki/Parity_bit" "Parity bit on Wikipedia" ;
;

META: decode
  use-when "You have bits with a parity bit on each block, from an old serial or tape format, and want the data bits back, with the parity checked." ;
  inverse encode ;
  param mode "The parity the data was encoded with: even or odd." ;
  param position "Where the parity bit is: at the start or at the end of each block." ;
  param delimiter "Separates the blocks. Empty: the whole input is one block." ;
  param verify "Check each block's parity and fail on a mismatch." ;
  see-also parity:encode ;
  link "https://en.wikipedia.org/wiki/Parity_bit" "Parity bit on Wikipedia" ;
;
