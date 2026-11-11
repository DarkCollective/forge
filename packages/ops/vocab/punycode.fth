\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ punycode: Bootstring with the Punycode parameters, RFC 3492 (base 36, tmin 1, tmax 26, skew 38,
\ damp 700, initial bias 72, initial n 128, delimiter "-"). Section numbers below are RFC 3492's.
\ In domain mode a label with a non-ASCII character is written as xn-- plus its Punycode (RFC 3490
\ ACE prefix); no case folding or other IDNA mapping is applied. The words are FL and need no
\ primitive. Both directions keep the algorithm's state in variables (it is a sequential state
\ machine); E_COERCE comes from the raise vocabulary (raise:coerce). Cost is quadratic in the length
\ of one label, as the algorithm is, which is why domain mode works label by label.
IN: punycode

0 VARIABLE _n
0 VARIABLE _delta
0 VARIABLE _bias
0 VARIABLE _h
0 VARIABLE _b
"" VARIABLE _acc
0 VARIABLE _i
0 VARIABLE _oldi
0 VARIABLE _w
0 VARIABLE _k
0 VARIABLE _in
"" VARIABLE _out

\ Threshold t(k) of section 3.3 (digit-weight range tmin 1 to tmax 26 around the bias).
: _t ( k:int bias:int -- int )
  k bias <= [ 1 ] [ k bias 26 + >= [ 26 ] [ k bias - ] if ] if ;

: _adapt2 ( d:int k:int -- int )
  d 455 > [ d 35 div k 36 + recurse ] [ k 36 d * d 38 + div + ] if ;

\ Bias adaptation, section 6.1.
: _adapt ( delta:int numpoints:int first:bool -- int )
  first [ delta 700 div ] [ delta 2 div ] if
  dup numpoints div +
  0 _adapt2 ;

\ Digit value 0 to 35 as a lower-case letter or digit (a to z are 0 to 25, 0 to 9 are 26 to 35).
: _digit-char ( d:int -- str )
  d 26 < [ d 97 + ] [ d 22 + ] if util:cp>str ;

\ The variable-length integer q of section 6.3, the digit string for threshold weights from k.
: _vi2 ( q:int k:int bias:int t:int -- str )
  q t <
  [ q _digit-char ]
  [ t q t - 36 t - mod + _digit-char
    q t - 36 t - div k 36 + bias k 36 + bias _t recurse cat ] if ;

: _vi ( q:int bias:int -- str )
  q 36 bias 36 bias _t _vi2 ;

\ One code point of the input during the pass for _n (section 6.3 inner loop).
: _each-cp ( c:int -- str )
  c _n < [ _delta 1 + _delta! ] when
  c _n =
  [ _delta _bias _vi
    _delta _h 1 + _h _b = _adapt _bias!
    0 _delta!
    _h 1 + _h! ]
  [ "" ] if ;

\ The Punycode of a list of code points (no prefix).
: _encode-label ( cps:list -- str )
  128 _n! 0 _delta! 72 _bias!
  cps [ 128 < ] filter len dup _b! _h!
  cps [ 128 < ] filter codes>str _acc!
  _b 0 > [ _acc "-" cat _acc! ] when
  [ _h cps len < ]
  [ cps [ _n >= ] filter 1114112 [ min ] reduce
    dup _n - _h 1 + * _delta + _delta! _n!
    _acc cps [ _each-cp ] map "" join cat _acc!
    _delta 1 + _delta!
    _n 1 + _n! ] while
  _acc ;

: _ascii? ( s:str -- bool )
  s str>codes [ 127 > ] filter len 0 = ;

: _encode-dom-label ( label:str -- str )
  label _ascii? [ label ] [ "xn--" label str>codes _encode-label cat ] if ;

: encode ( str mode:choice{label|domain}=domain -- str )
  "Punycode (RFC 3492 Bootstring). label: the whole text is one Punycode string, ASCII code points first, then a - and the digits for the rest (an all-ASCII text just gets a trailing -). domain: split at dots, and each label with a non-ASCII character becomes xn-- plus its Punycode; other labels are unchanged. No case mapping or normalisation is done." doc
  "Encodings" category
  mode "label" = [ str>codes _encode-label ] [ "." split [ _encode-dom-label ] map "." join ] if ;

META: encode
  param mode "label: raw Punycode of the whole text. domain: per dot-separated label, with the xn-- prefix on labels that need it." ;
;

\ ---- decode ----

: _digit-val ( c:int -- int )
  c 97 >= c 122 <= and [ c 97 - ]
  [ c 65 >= c 90 <= and [ c 65 - ]
    [ c 48 >= c 57 <= and [ c 22 - ] [ "not a Punycode digit (letters and digits only)" raise:coerce 0 ] if ] if ] if ;

\ After a digit d with threshold t: keep reading (true) with the next weight, or stop (false).
: _adv ( d:int t:int -- bool )
  d t < [ false ] [ _w 36 t - * _w! _k 36 + _k! true ] if ;

\ Read one digit of the current number (section 6.2); true while more digits follow.
: _step ( cps:list -- bool )
  _in cps len >= [ "truncated Punycode: a number is incomplete" raise:coerce ] when
  cps _in nth _digit-val
  _in 1 + _in!
  dup _w * _i + _i!
  _k _bias _t _adv ;

\ The index of the last - in the list of code points, or -1.
: _last-dash ( cps:list -- int )
  0 cps len range [ cps swap nth 45 = ] filter
  dup len 0 > [ dup len 1 - nth ] [ drop -1 ] if ;

: _insert ( n:int -- )
  n 1114111 > n 55296 >= n 57343 <= and or
  [ "the Punycode decodes to an invalid code point" raise:coerce ] when
  _out 0 _i slice n util:cp>str cat
  _out _i _out len slice cat _out! ;

\ Decode a list of code points (no prefix) to text.
: _decode-label ( cps:list -- str )
  128 _n! 0 _i! 72 _bias! 0 _in!
  cps _last-dash dup 0 >=
  [ dup 1 + _in!
    cps swap 0 swap slice dup [ 127 > ] filter len 0 >
    [ "a character before the last - is not ASCII" raise:coerce ] when
    codes>str _out! ]
  [ drop "" _out! ] if
  [ _in cps len < ]
  [ _i _oldi! 1 _w! 36 _k!
    [ cps _step ] loop
    _i _oldi - _out len 1 + _oldi 0 = _adapt _bias!
    _n _i _out len 1 + div + _n!
    _i _out len 1 + mod _i!
    _n _insert
    _i 1 + _i! ]
  while
  _out ;

: _decode-dom-label ( label:str -- str )
  label len 4 >= [ label 0 4 slice lower "xn--" = ] [ false ] if
  [ label 4 label len slice str>codes _decode-label ] [ label ] if ;

: decode ( str mode:choice{label|domain}=domain -- str )
  "Decode Punycode (RFC 3492). label: the whole text is one Punycode string. domain: split at dots, and each label that starts with xn-- (any case) is decoded; other labels are unchanged. The digits are read in either case. Truncated or invalid Punycode, a non-ASCII character in the Punycode, or a result that is not a Unicode scalar value is E_COERCE." doc
  "Encodings" category
  mode "label" = [ str>codes _decode-label ] [ "." split [ _decode-dom-label ] map "." join ] if ;

META: decode
  param mode "label: the whole text is raw Punycode. domain: decode each xn-- label of a dotted name." ;
;
