\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ luhn: the Luhn check digit (ISO/IEC 7812-1 annex B; Luhn mod N for an even radix), written in FL on
\ the core words; no primitives. CyberChef's Luhn Checksum prints the sum, the check digit and
\ the input with the digit appended, and never says whether an input is valid. Here the two
\ questions a user has are two words: the check digit, and a validity flag.
IN: luhn

: _check-radix ( radix:int -- )
  radix 2 mod 0 <> [ "the radix must be even" raise:range ] when ;

\ The value of the digit with character code c, or -1 when c is not a digit or letter.
: _value ( c:int -- int )
  c 48 57 util:between? [ c 48 - ]
  [ c 97 122 util:between? [ c 87 - ] [ c 65 90 util:between? [ c 55 - ] [ -1 ] if ] if ] if ;

\ The digit values of the text, most significant first; a character that is not a digit of the
\ radix is E_COERCE.
: _values ( digits:str radix:int -- list )
  digits str>codes [
    _value dup 0 < over radix >= or
    [ "a character is not a digit in this radix" raise:coerce ] when
  ] map ;

\ The Luhn sum, modulo the radix. Counting from the right, the digits at positions p with
\ (p + shift) odd are doubled, and a doubled digit is replaced by the sum of its digits.
: _sum ( vals:list radix:int shift:int -- int )
  vals rev [
    shift + 2 mod 1 = [ 2 * dup radix div swap radix mod + ] when
  ] mapi util:sum radix mod ;

: check-digit ( digits:str radix:int[2..36]=10 -- str )
  "The Luhn check digit for the digits, as one character (0-9, then a-z for radix above 10): append it to make a valid number. Digits are case-insensitive. The radix must be even. The empty input gives the empty text." doc
  "Hashing" category
  radix _check-radix
  digits len 0 =
  [ "" ]
  [ digits radix _values radix 1 _sum radix swap - radix mod radix int>str-radix ]
  if ;

: validate ( digits:str radix:int[2..36]=10 -- bool )
  "True when the digits, including their last digit as the check digit, pass the Luhn test. The empty input is not valid. A character that is not a digit of the radix is an error. The radix must be even." doc
  "Hashing" category
  radix _check-radix
  digits len 0 = [ false ] [ digits radix _values radix 0 _sum 0 = ] if ;

META: check-digit
  use-when "You are making a card, account or serial number and need the Luhn check digit to append, so that the whole number passes the Luhn test." ;
  param radix "The number base, an even number from 2 to 36. 10 for decimal." ;
  see-also luhn:validate ;
  link "https://en.wikipedia.org/wiki/Luhn_algorithm" "Luhn algorithm on Wikipedia" ;
;

META: validate
  use-when "You have a card, account or serial number with its check digit and want to see whether it passes the Luhn test. A pass is not proof the number is real." ;
  param radix "The number base, an even number from 2 to 36. 10 for decimal." ;
  see-also luhn:check-digit ;
  link "https://en.wikipedia.org/wiki/Luhn_algorithm" "Luhn algorithm on Wikipedia" ;
;
