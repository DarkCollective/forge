\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ colour: a colour code in one notation written in all the others. Written in FL on the core words;
\ no primitives. Colours are 8-bit sRGB channels plus an 8-bit alpha, as in CSS Color Level 4; hue,
\ saturation, lightness and the CMYK of the print trade are derived from them.
IN: colour

\ ---- reading ----

: _pct? ( t:str -- bool ) t "%" util:ends-with? ;

: _strip-unit ( t:str -- str )
  t "%" util:ends-with? [ t 0 t len 1 - slice ]
  [ t "deg" util:ends-with? [ t 0 t len 3 - slice ] [ t ] if ] if ;

\ The digits before and after the point of an unsigned number: the value times 1000 (three
\ decimals are read; str>int refuses anything that is not a digit).
: _milli-parts ( parts:list -- int )
  parts len 1 = parts len 2 = or not [ "not a number" raise:coerce ] when
  "0" parts 0 nth cat str>int 1000 *
  parts len 2 = [ "0" parts 1 nth cat "000" cat 0 4 slice str>int + ] when ;

: _milli-signed ( u:str neg:bool -- int )
  u "-" util:starts-with? u "+" util:starts-with? or [ 1 u len slice ] [ u ] if
  "." split _milli-parts neg [ neg ] when ;

\ A number with an optional sign and an optional % or deg, times 1000.
: _milli ( t:str -- int ) t _strip-unit dup "-" util:starts-with? _milli-signed ;

: _clamp255 ( v:int -- int )
  v 0 < v 255 > or [ "a channel is 0 to 255" raise:range ] when v ;

\ A red, green or blue channel: 0 to 255, or a percentage.
: _channel ( t:str -- int )
  t _milli int>num t _pct? [ 255.0 * 100000.0 / ] [ 1000.0 / ] if round _clamp255 ;

\ An alpha: 0 to 1 or a percentage, as 0 to 255.
: _alpha ( t:str -- int )
  t _milli int>num t _pct? [ 255.0 * 100000.0 / ] [ 255.0 * 1000.0 / ] if round _clamp255 ;

: _unit>255 ( x:num -- int ) x 255.0 * round 0 max 255 min ;

\ f(n) of the CSS Color 4 algorithm: l - a max(-1, min(k - 3, 9 - k, 1)) with k = (n + h / 30) mod 12.
: _hsl-k ( n:int h:num -- num )
  n int>num h 30.0 / + dup 12.0 / floor int>num 12.0 * - ;

: _hsl-f2 ( k:num l:num a:num -- num )
  k 3.0 - 9.0 k - min 1.0 min -1.0 max a * l swap - ;

: _hsl-f ( n:int h:num l:num a:num -- int )
  n h _hsl-k l a _hsl-f2 _unit>255 ;

: _hsl-rgb2 ( h:num l:num a:num -- int int int )
  0 h l a _hsl-f 8 h l a _hsl-f 4 h l a _hsl-f ;

\ Hue in degrees, saturation and lightness as fractions.
: _hsl-rgb ( h:num s:num l:num -- int int int )
  h l s l 1.0 l - min * _hsl-rgb2 ;

: _hsl-args ( args:list -- int int int )
  args 0 nth _milli int>num 1000.0 /
  args 1 nth _milli int>num 100000.0 /
  args 2 nth _milli int>num 100000.0 / _hsl-rgb ;

: _cmyk-channel ( c:num k:num -- int ) 1.0 c - 1.0 k - * _unit>255 ;

: _cmyk-rgb ( c:num m:num y:num k:num -- int int int )
  c k _cmyk-channel m k _cmyk-channel y k _cmyk-channel ;

: _cmyk-args ( args:list -- int int int )
  args len 4 = not [ "cmyk() takes four values" raise:coerce ] when
  args 0 nth _milli int>num 100000.0 /
  args 1 nth _milli int>num 100000.0 /
  args 2 nth _milli int>num 100000.0 /
  args 3 nth _milli int>num 100000.0 / _cmyk-rgb ;

: _rgb-args ( args:list -- int int int )
  args 0 nth _channel args 1 nth _channel args 2 nth _channel ;

\ The tokens after the opening bracket: commas, slashes and spaces all separate.
: _args ( rest:str -- list )
  rest ")" util:ends-with? not [ "a colour function ends with a closing bracket" raise:coerce ] when
  rest 0 rest len 1 - slice str>codes [ dup 44 = over 47 = or [ drop 32 ] when ] map codes>str
  " " split [ len 0 > ] filter ;

: _alpha-of ( args:list -- int ) args len 4 = [ args 3 nth _alpha ] [ 255 ] if ;

: _check-three-or-four ( args:list -- )
  args len 3 = args len 4 = or not [ "this colour function takes three values and an optional alpha" raise:coerce ] when ;

: _func-colour ( name:str args:list -- int int int int )
  name "rgb" = name "rgba" = or
  [ args _check-three-or-four args _rgb-args args _alpha-of ]
  [ name "hsl" = name "hsla" = or
    [ args _check-three-or-four args _hsl-args args _alpha-of ]
    [ name "cmyk" = [ args _cmyk-args 255 ]
      [ "unknown colour function (use rgb, rgba, hsl, hsla or cmyk)" raise:coerce 0 0 0 0 ] if ] if ] if ;

: _call-colour ( t:str -- int int int int )
  t "(" split dup 0 nth [ util:space? ] util:trim-end swap 1 nth _args _func-colour ;

: _hex ( s:str -- int )
  s str>codes [ util:hex-digit? ] filter len s len = s len 0 > and not
  [ "not a hex digit" raise:coerce ] when
  s 16 str>int-radix ;

: _hex-colour ( h:str -- int int int int )
  h len 3 = h len 4 = or
  [ h 0 1 slice _hex 17 * h 1 2 slice _hex 17 * h 2 3 slice _hex 17 *
    h len 4 = [ h 3 4 slice _hex 17 * ] [ 255 ] if ]
  [ h len 6 = h len 8 = or
    [ h 0 2 slice _hex h 2 4 slice _hex h 4 6 slice _hex
      h len 8 = [ h 6 8 slice _hex ] [ 255 ] if ]
    [ "a hex colour has 3, 4, 6 or 8 digits" raise:coerce 0 0 0 0 ] if ] if ;

: _parse-colour ( t:str -- int int int int )
  t "#" util:starts-with? [ t 1 t len slice _hex-colour ]
  [ t "(" split len 2 = [ t _call-colour ] [ t _hex-colour ] if ] if ;

\ ---- writing ----

\ 100 a / b, rounded to a whole number (halves up; the quotients are exact in floating point at the ties).
: _pct-of ( a:int b:int -- int ) a int>num 100.0 * b int>num / round ;

: _hex2 ( n:int -- str ) n 16 int>str-radix dup len 1 = [ "0" swap cat ] when ;

: _hex-text ( r:int g:int b:int a:int -- str )
  "#" r _hex2 cat g _hex2 cat b _hex2 cat a 255 = not [ a _hex2 cat ] when ;

\ An alpha of 0 to 255 as a decimal of 0 to 1 with at most two places.
: _alpha-text ( a:int -- str )
  a 255 _pct-of
  dup 100 = [ drop "1" ]
  [ dup 0 = [ drop "0" ]
    [ dup 10 mod 0 = [ 10 div int>str "0." swap cat ]
      [ dup 10 < [ int>str "0.0" swap cat ] [ int>str "0." swap cat ] if ] if ] if ] if ;

: _hue ( r:int g:int b:int d:int mx:int -- int )
  r mx = [ g b - 60 * ]
  [ g mx = [ b r - 60 * 120 d * + ] [ r g - 60 * 240 d * + ] if ] if
  d 360 * + int>num d int>num / round 360 mod ;

: _hsl2 ( r:int g:int b:int mx:int mn:int -- int int int )
  mx mn =
  [ 0 0 mx mn + 510 _pct-of ]
  [ r g b mx mn - mx _hue
    mx mn - 255 mx mn + 255 - abs - _pct-of
    mx mn + 510 _pct-of ] if ;

\ Hue in degrees, saturation and lightness in percent, rounded.
: _hsl ( r:int g:int b:int -- int int int )
  r g b r g max b max r g min b min _hsl2 ;

: _cmyk-pct ( x:int mx:int -- int ) mx x - mx _pct-of ;

: _cmyk2 ( r:int g:int b:int mx:int -- int int int int )
  mx 0 =
  [ 0 0 0 100 ]
  [ r mx _cmyk-pct g mx _cmyk-pct b mx _cmyk-pct 255 mx - 255 _pct-of ] if ;

\ Cyan, magenta, yellow and key (black) in percent, rounded.
: _cmyk ( r:int g:int b:int -- int int int int )
  r g b r g max b max _cmyk2 ;

: _rgb-text ( r:int g:int b:int -- str )
  "rgb(" r int>str cat ", " cat g int>str cat ", " cat b int>str cat ")" cat ;

: _rgba-text ( r:int g:int b:int a:int -- str )
  "rgba(" r int>str cat ", " cat g int>str cat ", " cat b int>str cat ", " cat a _alpha-text cat ")" cat ;

: _hsl-text ( h:int s:int l:int -- str )
  "hsl(" h int>str cat ", " cat s int>str cat "%, " cat l int>str cat "%)" cat ;

: _hsla-text ( h:int s:int l:int a:int -- str )
  "hsla(" h int>str cat ", " cat s int>str cat "%, " cat l int>str cat "%, " cat a _alpha-text cat ")" cat ;

: _cmyk-text ( c:int m:int y:int k:int -- str )
  "cmyk(" c int>str cat "%, " cat m int>str cat "%, " cat y int>str cat "%, " cat k int>str cat "%)" cat ;

: _report ( r:int g:int b:int a:int -- str )
  "Hex:   " r g b a _hex-text cat "\n" cat
  "RGB:   " cat r g b _rgb-text cat "\n" cat
  "RGBA:  " cat r g b a _rgba-text cat "\n" cat
  "HSL:   " cat r g b _hsl _hsl-text cat "\n" cat
  "HSLA:  " cat r g b _hsl a _hsla-text cat "\n" cat
  "CMYK:  " cat r g b _cmyk _cmyk-text cat ;

: parse ( data:str -- str )
  "A colour code written in every notation. The input is a CSS-style colour: hex (#f80, #ff8800, #ff880080 or #f808, with or without the #), rgb(255, 136, 0) or rgba(...) with channels 0 to 255 or percentages, hsl(32, 100%, 50%) or hsla(...), or cmyk(0%, 47%, 100%, 0%) with percentages; spaces or commas separate, an alpha of 0 to 1 or a percentage may follow, and case does not matter. Numbers have up to three decimals. The output has one line each for hex, RGB, RGBA, HSL, HSLA and CMYK, with the channels rounded to whole numbers (hue in degrees, the rest in percent). Colour names are not read." doc
  "Conversions" category
  data [ util:space? ] util:trim-start [ util:space? ] util:trim-end lower _parse-colour _report ;

META: parse
;
