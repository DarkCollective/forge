\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ arith: arithmetic over a delimited list of numbers (Sum, Subtract, Multiply, Divide, MOD, Mean, Median, Standard
\ Deviation) and over big integers (Extended GCD, Modular Exponentiation, Modular Inverse). All FL, no primitives.
\
\ Decimals are exact. A number is read as a pair { m s }, the value m / 10^s, with m a big integer (so 0.1 + 0.2 is 3 / 10
\ plus 1 / 10 with no float noise). Sum, subtract, multiply, MOD, median and the order of the digits are exact for any
\ size; divide, mean and standard deviation round half away from zero to 20 decimal places (the BigNumber defaults
\ CyberChef uses), each fold step on its own. Results are written in plain decimal notation with no trailing zeros.
\ The integer limit of the language (maxIntBits, 65 536 bits) caps the size of a number (E_LIMIT_VALUE).
IN: arith

: _p10 ( n:int -- int )
  10 n pow ;

: _short ( t:str -- str )
  t len 40 > [ t 0 40 slice "..." cat ] [ t ] if ;

\ True for text of decimal digits only. str>int does the check (it also takes a leading -, which is excluded).
: _digits? ( s:str -- bool )
  s len 0 > [ [ s str>int drop s 0 1 slice "-" <> ] [ drop false ] try ] [ false ] if ;

\ The sign of a number in text: ( s -- negative? rest ). A leading + or - is taken off.
: _unsign ( s:str -- bool str )
  s len 0 > [
    s 0 1 slice dup "-" =
    [ drop true s 1 s len slice ]
    [ "+" = [ false s 1 s len slice ] [ false s ] if ] if
  ] [ false s ] if ;

: _bad ( t:str -- )
  "not a number: " t _short cat raise:coerce ;

\ The value of an exponent in a number such as 1.5e-3 (at most 5000 either way).
: _exp-val ( minus:bool rest:str t:str -- int )
  rest _digits? not [ t _bad ] when
  rest str>int minus [ neg ] when
  dup abs 5000 > [ "the exponent of a number must be between -5000 and 5000" raise:range ] when ;

\ A number { m s } in lowest terms: trailing zeros of m are moved out of the scale s.
: _trim0 ( m:int s:int k:int -- list )
  { m k _p10 div s k - } ;

: _norm ( m:int s:int -- list )
  s 0 = [ { m 0 } ] [
    m 0 = [ { 0 0 } ]
    [ m s m int>str str>codes rev [ 48 = ] util:count-leading s min _trim0 ] if ] if ;

: _build ( ip:str fp:str minus:bool exp:int t:str -- list )
  ip fp cat _digits? not [ t _bad ] when
  ip fp cat str>int minus [ neg ] when
  fp len exp -
  dup 0 < [ neg _p10 * 0 ] when
  _norm ;

: _parse2 ( mant:str exp:int t:str -- list )
  mant _unsign "." split
  dup len 1 = [ 0 nth "" ] [ dup len 2 = [ dup 0 nth swap 1 nth ] [ t _bad "" "" ] if ] if
  rot exp t _build ;

\ A number as { m s }: sign, digits with an optional point, optional exponent. Nothing else (no hex, no NaN).
: _parse-slow ( t:str -- list )
  t lower "e" split
  dup len 1 = [ 0 nth 0 ] [
    dup len 2 = [ dup 0 nth swap 1 nth _unsign t _exp-val ] [ t _bad ] if ] if
  t _parse2 ;

\ A piece of the input as a number; a whole number (the common case) takes the quick way through str>int. A piece
\ of white space only gives the empty list, which _numbers drops.
: _parse ( t:str -- list )
  [ { t str>int 0 } ] [ drop t [ util:space? ] util:trim-start [ util:space? ] util:trim-end dup len 0 = [ drop { } ] [ _parse-slow ] if ] try ;

\ ---- exact decimal arithmetic on { m s } ----

: _neg ( d:list -- list )
  { d 0 nth neg d 1 nth } ;

\ The mantissa of d written at scale s (s at least the scale of d).
: _scale-to ( d:list s:int -- int )
  d 0 nth s d 1 nth - _p10 * ;

: _smax ( a:list b:list -- int )
  a 1 nth b 1 nth max ;

: _add2 ( a:list b:list s:int -- list )
  a s _scale-to b s _scale-to + s _norm ;

: _add ( a:list b:list -- list )
  a b a b _smax _add2 ;

: _mul ( a:list b:list -- list )
  a 0 nth b 0 nth * a 1 nth b 1 nth + _norm ;

\ n / d for d, n of any sign, rounded half away from zero (both non-negative here).
: _rdiv2 ( n:int d:int -- int )
  n d div n d core:mod 2 * d >= [ 1 + ] when ;

: _rdiv ( n:int d:int -- int )
  n abs d abs _rdiv2 n 0 < d 0 < <> [ neg ] when ;

: _zero-divisor ( -- )
  1 0 div drop ;

\ a / b to 20 decimal places, half away from zero (E_DIV_ZERO for b = 0).
: _div ( a:list b:list -- list )
  b 0 nth 0 = [ _zero-divisor ] when
  a 0 nth b 1 nth 20 + _p10 *
  b 0 nth a 1 nth _p10 *
  _rdiv 20 _norm ;

: _rem2 ( a:list b:list s:int -- list )
  a s _scale-to dup abs b s _scale-to abs core:mod swap 0 < [ neg ] when s _norm ;

\ The remainder of a / b with the sign of a (the BigNumber default, and JavaScript's %).
: _rem ( a:list b:list -- list )
  b 0 nth 0 = [ _zero-divisor ] when
  a b a b _smax _rem2 ;

: _pad ( digits:str s:int -- str )
  digits len s 1 + < [ "0" s 1 + digits len - util:repeat-str digits cat ] [ digits ] if ;

: _point2 ( digits:str p:int -- str )
  digits 0 p slice "." cat digits p digits len slice cat ;

: _point ( digits:str s:int -- str )
  s 0 = [ digits ] [ digits digits len s - _point2 ] if ;

\ Plain decimal text of { m s }.
: _fmt ( d:list -- str )
  d 0 nth abs int>str d 1 nth _pad d 1 nth _point
  d 0 nth 0 < [ "-" swap cat ] when ;

\ The integer square root (the largest r with r * r <= n) by Newton's method; n is not negative.
: _isqrt ( n:int -- int )
  n 0 = [ 0 ] [
    1 n 2 int>str-radix len 1 + 2 div shl
    [ dup n over div + 2 div over < ] [ dup n swap div + 2 div ] while
  ] if ;

\ The square root of x, rounded half up, given r = its integer part (x > r * r + r means the root is past r + 1/2).
: _round-root ( x:int r:int -- int )
  x r r * r + > [ r 1 + ] [ r ] if ;

\ The square root of a non-negative { m s } (s up to 40) to 20 decimal places, half up.
: _sqrt ( d:list -- list )
  d 0 nth 40 d 1 nth - _p10 * dup _isqrt _round-root 20 _norm ;

\ ---- lists of numbers ----

\ The numbers of the text as { m s } pairs: cut at the delimiter, each piece trimmed, blank pieces skipped.
: _numbers ( data:str delimiter:str -- list )
  delimiter util:delimiter dup "" = [ "a delimiter is needed" raise:range ] when
  data swap split [ len 0 > ] filter
  [ _parse ] map [ len 0 > ] filter
  dup len 0 = [ "there are no numbers in the input" raise:range ] when ;

\ Fold the list with q ( acc item -- acc ), starting from the first number (divide and mod).
: _fold ( ds:list q:quot -- list )
  ds 1 ds len slice ds 0 nth q reduce ;

\ The largest scale among the numbers.
: _scale-of ( ds:list -- int )
  ds 0 [ 1 nth max ] reduce ;

: _aligned ( ds:list s:int -- list )
  ds [ s _scale-to ] map ;

: _total2 ( ds:list s:int -- list )
  ds s _aligned 0 [ + ] reduce s _norm ;

\ The exact sum { m s } of the numbers: all written at the largest scale, then added as integers.
: _total ( ds:list -- list )
  ds ds _scale-of _total2 ;

: _mean ( ds:list -- list )
  ds _total { ds len 0 } _div ;

: _sq-sum2 ( ints:list m:int s:int -- list )
  ints 0 [ m - dup * + ] reduce s 2 * _norm ;

: _sq-sum3 ( ds:list mean:list s:int -- list )
  ds s _aligned mean s _scale-to s _sq-sum2 ;

\ The sum of the squares of the distances to the mean (exact: the numbers and the mean at one scale).
: _sq-sum ( ds:list mean:list -- list )
  ds mean ds _scale-of mean 1 nth max _sq-sum3 ;

: _sd ( ds:list mean:list n:int -- list )
  ds mean _sq-sum { n 0 } _div _sqrt ;

: _median3 ( ints:list s:int -- list )
  ints len 2 core:mod 1 =
  [ ints ints len 2 div nth s _norm ]
  [ { ints ints len 2 div 1 - nth s } { ints ints len 2 div nth s } _add { 2 0 } _div ] if ;

: _median2 ( ds:list s:int -- list )
  ds s _aligned list:sort s _median3 ;

: _median ( ds:list -- list )
  ds ds _scale-of _median2 ;

\ ---- the operations ----

: sum ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Add the numbers of the input. The input is a list of numbers cut at the delimiter (white space around a number and blank pieces are ignored). Numbers may have a sign, a decimal point and an exponent (-12.5, .5, 1e3); the arithmetic is exact decimal arithmetic, so 0.1 + 0.2 is 0.3, and integers of any size are exact (up to the 65,536-bit limit). The result is plain decimal text with no trailing zeros. A piece that is not a number is E_COERCE (CyberChef ignores it); no numbers at all is E_RANGE." doc
  "Arithmetic" category
  data delimiter _numbers _total _fmt ;

: subtract ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Subtract the numbers of the input from the first one, left to right (a - b - c). Same input rules and exact decimal arithmetic as sum. One number alone is its own result." doc
  "Arithmetic" category
  data delimiter _numbers [ 0 > [ _neg ] when ] mapi _total _fmt ;

: multiply ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Multiply the numbers of the input together. Same input rules and exact decimal arithmetic as sum (the product of 1.5 and 2.5 is 3.75, and integers of any size are exact up to the 65,536-bit limit)." doc
  "Arithmetic" category
  data delimiter _numbers { 1 0 } [ _mul ] reduce _fmt ;

: divide ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Divide the first number by the others, left to right (a / b / c). Each division is rounded half away from zero to 20 decimal places (the BigNumber defaults CyberChef uses), so 1 / 3 is 0.33333333333333333333; a division that ends sooner is exact (1 / 8 is 0.125). Dividing by zero is E_DIV_ZERO. Same input rules as sum." doc
  "Arithmetic" category
  data delimiter _numbers [ _div ] _fold _fmt ;

: _mod-all ( ds:list m:list -- list )
  m len 0 = [ "the modulus is not a number" raise:coerce ] when
  ds [ m _rem ] map ;

: mod ( data:str modulus:str="2" delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Every number of the input modulo the modulus, as in CyberChef's MOD: 15 4 7 with the modulus 3 gives 0 1 1. The modulus is text (2 by default), a decimal of any size; the numbers are cut at the delimiter. Each remainder has the sign of the dividend, like the % operator of JavaScript and the BigNumber default (-7 mod 3 is -1), and is exact for decimals (5.5 mod 2 is 1.5). The remainders are joined by a single space whatever the delimiter is, which is what CyberChef writes. A zero modulus is E_DIV_ZERO; a modulus that is not a number is E_COERCE. Same input rules as sum." doc
  "Arithmetic" category
  data delimiter _numbers modulus _parse _mod-all [ _fmt ] map " " join ;

: mean ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "The arithmetic mean of the numbers of the input: their exact sum divided by how many there are, rounded half away from zero to 20 decimal places. Same input rules as sum." doc
  "Arithmetic" category
  data delimiter _numbers _mean _fmt ;

: median ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "The median of the numbers of the input: the middle one of the sorted numbers, or, for an even count, the mean of the two middle ones (rounded half away from zero to 20 decimal places). Same input rules as sum." doc
  "Arithmetic" category
  data delimiter _numbers _median _fmt ;

: standard-deviation ( data:str kind:choice{population|sample}="population" delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "The standard deviation of the numbers of the input: the square root of the mean squared distance from the mean. population divides by the count n (CyberChef's choice); sample divides by n - 1 and needs at least two numbers (E_RANGE otherwise). The mean, the variance and the root are each rounded half away from zero to 20 decimal places. Same input rules as sum." doc
  "Arithmetic" category
  data delimiter _numbers dup _mean
  kind "sample" =
  [ over len 1 - dup 0 = [ "a sample standard deviation needs at least two numbers" raise:range ] when ]
  [ over len ] if
  _sd _fmt ;

META: sum
  param delimiter "The text between the numbers." ;
  see-also arith:mean ;
;

META: subtract
  param delimiter "The text between the numbers." ;
  see-also arith:sum ;
;

META: multiply
  param delimiter "The text between the numbers." ;
  see-also arith:sum ;
;

META: divide
  param delimiter "The text between the numbers." ;
  see-also arith:mod ;
;

META: mod
  param modulus "The number every input number is divided by (2 by default); a decimal of any size." ;
  param delimiter "The text between the numbers." ;
  see-also arith:divide ;
;

META: mean
  param delimiter "The text between the numbers." ;
  see-also arith:median arith:standard-deviation ;
;

META: median
  param delimiter "The text between the numbers." ;
  see-also arith:mean ;
;

META: standard-deviation
  param kind "population divides by n, sample by n - 1." ;
  param delimiter "The text between the numbers." ;
  see-also arith:mean ;
;

\ ---- big integers ----

\ The integer in text (surrounding white space and a sign allowed; digits only), or E_COERCE naming what.
: _int2 ( minus:bool rest:str what:str -- int )
  rest _digits? not [ what " is not an integer: " cat rest _short cat raise:coerce ] when
  rest str>int minus [ neg ] when ;

: _int ( s:str what:str -- int )
  s [ util:space? ] util:trim-start [ util:space? ] util:trim-end _unsign what _int2 ;

: _egcd-next ( r0:int r1:int s0:int s1:int t0:int t1:int q:int -- list )
  { r1 r0 q r1 * - s1 s0 q s1 * - t1 t0 q t1 * - } ;

: _egcd-step ( st:list -- list )
  st 0 nth st 1 nth st 2 nth st 3 nth st 4 nth st 5 nth st 0 nth st 1 nth div _egcd-next ;

: _egcd-out ( st:list a:int b:int -- list )
  { st 0 nth st 2 nth a 0 < [ neg ] when st 4 nth b 0 < [ neg ] when } ;

\ { gcd x y } with a * x + b * y = gcd: the extended Euclidean algorithm on the absolute values, the signs put back.
: _egcd ( a:int b:int -- list )
  { a abs b abs 1 0 0 1 } [ dup 1 nth 0 <> ] [ _egcd-step ] while
  a b _egcd-out ;

: _egcd-report ( r:list -- str )
  "gcd: " r 0 nth int>str cat "\n\nBezout coefficients:\nx = " cat r 1 nth int>str cat
  "\ny = " cat r 2 nth int>str cat "\n\n" cat ;

: ext-gcd ( data:str b:str -- str )
  "The extended Euclidean algorithm on two integers of any size: the input is a, the parameter is b. The output is CyberChef's report: gcd: g, a blank line, Bezout coefficients: and the lines x = and y = , each ending in a line feed, with a * x + b * y = g, where g is the greatest common divisor (never negative). The coefficients are the ones of the standard iterative algorithm on the absolute values, with the signs of a and b put back, so the identity holds for negative a or b too (CyberChef's coefficients are the same for a and b of 0 or more, but do not satisfy it when b is negative); they are not unique, but they are the same on every run. The gcd of 0 and 0 is 0. A value that is not an integer is E_COERCE." doc
  "Arithmetic" category
  data "the input" _int b "b" _int _egcd _egcd-report ;

: mod-pow ( data:str exponent:str modulus:str -- str )
  "Modular exponentiation: the input (the base) raised to the exponent, modulo the modulus, as a number from 0 up to the modulus minus 1. All three are integers of any size; the base may be negative. A negative exponent or a modulus below 1 is E_RANGE, and a value that is not an integer is E_COERCE." doc
  "Arithmetic" category
  data "the input" _int exponent "the exponent" _int modulus "the modulus" _int powmod int>str ;

: mod-inverse ( data:str modulus:str -- str )
  "The modular inverse of the input modulo the modulus: the number x from 0 up to the modulus minus 1 with input * x = 1 (mod modulus). Both are integers of any size. A modulus below 1, or an input that shares a factor with the modulus (no inverse exists), is E_RANGE; a value that is not an integer is E_COERCE." doc
  "Arithmetic" category
  data "the input" _int modulus "the modulus" _int invmod int>str ;

META: ext-gcd
  param b "The second integer (the input is the first)." ;
  see-also arith:mod-inverse ;
;

META: mod-pow
  param exponent "The exponent, a non-negative integer." ;
  param modulus "The modulus, an integer of 1 or more." ;
  see-also arith:mod-inverse ;
;

META: mod-inverse
  param modulus "The modulus, an integer of 1 or more." ;
  see-also arith:ext-gcd arith:mod-pow ;
;
