\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ coords: co-ordinate formats and the great-circle distance. Latitude and longitude are held as whole
\ numbers of 10^-12 degree ("pico-degrees"), so the decimal, degrees-minutes and geohash formats
\ convert exactly; only the map projection (UTM, and MGRS which is built on it) uses floating point,
\ with the Kruger series of Karney (2011) on the WGS 84 ellipsoid. The trigonometric functions the
\ core lacks come from two private primitives (src/prims/coords.ts).
IN: coords

\ ---- constants ----

: _p12 ( -- int ) 1000000000000 ;

\ n degrees as pico-degrees.
: _d ( n:int -- int ) n _p12 * ;

: _pi ( -- num ) 3.141592653589793 ;

\ Latitude of a point in radians, from pico-degrees.
: _rad ( pico:int -- num ) pico int>num _pi * 180000000000000.0 / ;

\ ---- numbers in text ----

\ True when s is one or more ASCII digits.
: _digits? ( s:str -- bool )
  s len 0 > s str>codes [ util:dec-digit? ] filter len s len = and ;

\ ip and fp are the digits before and after the point of an unsigned decimal number: its value
\ as a fraction n / 10^(length of fp). str>int refuses anything that is not a digit.
: _nd2 ( ip:str fp:str -- int int )
  ip len fp len + 0 = [ "not a number" raise:coerce ] when
  "0" ip cat fp cat str>int 10 fp len pow ;

: _nd ( t:str -- int int )
  t "." split
  dup len 1 = [ 0 nth "" ]
  [ dup len 2 = [ dup 0 nth swap 1 nth ] [ "not a number" raise:coerce "" "" ] if ] if
  _nd2 ;

\ An unsigned decimal number as a float (E_COERCE when it is not one).
: _decimal-num ( t:str -- num )
  t _nd swap int>num swap int>num / ;

\ An unsigned decimal number as pico-degrees, rounded to the nearest.
: _pico ( t:str -- int ) t _nd swap 1000000000000 * swap util:round-div ;

\ ---- text out ----

\ v, a whole number of 10^-p units, as decimal text with p places (zeros kept).
: _insert-point ( padded:str p:int -- str )
  padded 0 padded len p - slice "." cat padded padded len p - padded len slice cat ;

: _fixed ( v:int p:int -- str )
  p 0 =
  [ v int>str ]
  [ "0" p 1 + v int>str len - 0 max util:repeat-str v int>str cat p _insert-point ] if ;

\ a (pico-degrees, at least 0) times mult, in units of 10^-p, rounded.
: _units ( a:int mult:int p:int -- int )
  a mult * 10 p pow * _p12 2 div + _p12 div ;

: _sign-prefix ( v:int r:int -- str )
  v 0 < r 0 > and [ "-" ] [ "" ] if ;

: _dd ( v:int p:int -- str )
  v v abs 1 p _units _sign-prefix v abs 1 p _units p _fixed cat ;

: _hemisphere ( v:int pos:str neg:str -- str )
  v 0 < [ neg ] [ pos ] if ;

\ m whole minutes-and-fractions (10^-p minute), with the hemisphere letter.
: _dmm-text ( m:int p:int hemi:str -- str )
  m 60 10 p pow * div int>str "\xB0 " cat
  m 60 10 p pow * mod p _fixed cat "' " cat
  hemi cat ;

: _dmm ( v:int p:int pos:str neg:str -- str )
  v abs 60 p _units p v pos neg _hemisphere _dmm-text ;

: _dms-text ( s:int p:int hemi:str -- str )
  s 3600 10 p pow * div int>str "\xB0 " cat
  s 3600 10 p pow * mod 60 10 p pow * div int>str cat "' " cat
  s 60 10 p pow * mod p _fixed cat "\" " cat
  hemi cat ;

: _dms ( v:int p:int pos:str neg:str -- str )
  v abs 3600 p _units p v pos neg _hemisphere _dms-text ;

\ ---- geohash ----
\ The cell of a geohash is an index along each axis: the bits of the characters alternate longitude,
\ latitude, longitude, ... starting with longitude. Integer arithmetic keeps it exact.

: _gh-alphabet ( -- str ) "0123456789bcdefghjkmnpqrstuvwxyz" ;

: _gh-value ( c:str -- int )
  _gh-alphabet c split dup len 2 = not [ "not a geohash character" raise:coerce ] when 0 nth len ;

: _gh-bit ( vals:list i:int -- int )
  vals i 5 div nth 4 i 5 mod - shr 1 band ;

\ The index along one axis: start 0 takes the even bits (longitude), 1 the odd bits (latitude).
: _gh-axis ( vals:list total:int start:int -- int )
  0 total range [ 2 mod start = ] filter
  0 [ swap 2 * vals rot _gh-bit + ] reduce ;

\ The pico-degrees of the middle of cell idx of 2^bits equal cells that span range from lo.
: _gh-centre ( idx:int bits:int range:int lo:int -- int )
  idx 2 * 1 + range * 2 bits 1 + pow div lo + ;

: _gh-decode-total ( vals:list total:int -- int int )
  vals total 1 _gh-axis total 2 div 180 _d 90 _d neg _gh-centre
  vals total 0 _gh-axis total 1 + 2 div 360 _d 180 _d neg _gh-centre ;

\ A geohash as latitude and longitude of the middle of its cell.
: _gh-decode ( text:str -- int int )
  text [ util:space? ] util:trim-start [ util:space? ] util:trim-end lower
  dup len 1 < over len 12 > or [ "a geohash has 1 to 12 characters" raise:coerce ] when
  str>codes [ util:cp>str _gh-value ] map dup len 5 * _gh-decode-total ;

: _ge-bit ( i:int lonidx:int latidx:int blon:int blat:int -- int )
  i 2 mod 0 =
  [ lonidx blon 1 - i 2 div - shr 1 band ]
  [ latidx blat 1 - i 1 - 2 div - shr 1 band ] if ;

: _ge-char ( c:int lonidx:int latidx:int blon:int blat:int -- str )
  0 5 range 0 [ swap 2 * swap c 5 * + lonidx latidx blon blat _ge-bit + ] reduce
  dup 1 + _gh-alphabet -rot slice ;

: _gh-encode-from ( lonidx:int latidx:int blon:int blat:int n:int -- str )
  0 n range [ lonidx latidx blon blat _ge-char ] map "" join ;

\ The index of v (pico-degrees) among 2^bits cells over span, offset by off.
: _gh-index ( v:int off:int span:int bits:int -- int )
  v off + 2 bits pow * span div 2 bits pow 1 - min ;

: _gh-encode-total ( lat:int lon:int n:int total:int -- str )
  lon 180 _d 360 _d total 1 + 2 div _gh-index
  lat 90 _d 180 _d total 2 div _gh-index
  total 1 + 2 div total 2 div n _gh-encode-from ;

: _gh-encode ( lat:int lon:int n:int -- str )
  lat lon n n 5 * _gh-encode-total ;

\ ---- degrees, minutes, seconds in text ----

\ A letter or a number of the text: every character that is not a digit, point, minus sign or one
\ of the hemisphere letters N S E W (any case) separates; the letters stand apart.
: _spread ( acc:list c:int -- list )
  c util:dec-digit? c 46 = or c 45 = or
  [ acc c append ]
  [ c 78 = c 83 = or c 69 = or c 87 = or
    [ acc 32 append c append 32 append ]
    [ acc 32 append ] if ] if ;

: _tokens ( text:str -- list )
  text upper str>codes { } [ _spread ] reduce codes>str " " split [ len 0 > ] filter ;

: _letter? ( t:str -- bool )
  t len 1 = t "N" = t "S" = or t "E" = or t "W" = or and ;

\ One minutes or seconds component, in pico-degrees: the text divided by d (60 or 3600), rounded; it
\ must be below 60 of its own unit.
: _minor ( t:str d:int -- int )
  t _pico dup 60 _d >= [ "minutes and seconds must be below 60" raise:range ] when
  d 2 div + d div ;

\ One co-ordinate from its tokens (degrees, then minutes, then seconds): pico-degrees with the sign
\ of the first token.
: _half ( toks:list -- int )
  toks 0 nth dup "-" util:starts-with? [ 1 over len slice ] when _pico
  toks len 1 > [ toks 1 nth 60 _minor + ] when
  toks len 2 > [ toks 2 nth 3600 _minor + ] when
  toks 0 nth "-" util:starts-with? [ neg ] when ;

\ The numbers of the text split into a latitude half and a longitude half of h tokens each; the
\ letters S and W make the value negative.
: _halves ( nums:list letters:list h:int -- int int )
  nums 0 h slice _half letters "S" util:contains? [ abs neg ] when
  nums h nums len slice _half letters "W" util:contains? [ abs neg ] when ;

\ How many numbers each format has (0 for auto).
: _expected ( from:str -- int )
  from "decimal-degrees" = [ 2 ]
  [ from "degrees-decimal-minutes" = [ 4 ]
    [ from "degrees-minutes-seconds" = [ 6 ] [ 0 ] if ] if ] if ;

: _check-count ( k:int from:str -- )
  from _expected 0 =
  [ k 2 = k 4 = or k 6 = or ]
  [ k from _expected = ] if
  not [ "the number of values does not fit the format (2 for decimal degrees, 4 for degrees and decimal minutes, 6 for degrees, minutes and seconds)" raise:coerce ] when ;

: _check-range ( lat:int lon:int -- int int )
  lat abs 90 _d > [ "the latitude is beyond 90 degrees" raise:range ] when
  lon abs 180 _d > [ "the longitude is beyond 180 degrees" raise:range ] when
  lat lon ;

\ The latitude and longitude of the numbers and letters in the tokens.
: _parse-tokens ( toks:list from:str -- int int )
  toks [ _letter? not ] filter toks [ _letter? ] filter
  over len from _check-count
  dup len 2 > [ "too many hemisphere letters" raise:coerce ] when
  over len 2 div _halves _check-range ;

\ ---- the Transverse Mercator projection (UTM) ----
\ Karney, "Transverse Mercator with an accuracy of a few nanometers" (2011), the series in the
\ third flattening n to the fourth order (below a millimetre on the ellipsoid for every zone).

: _a ( -- num ) 6378137.0 ;
: _f ( -- num ) 1.0 298.257223563 / ;
: _n ( -- num ) _f 2.0 _f - / ;
: _e ( -- num ) _f 2.0 _f - * sqrt ;
: _k0 ( -- num ) 0.9996 ;

\ The polynomial with coefficients lowest power first (Horner).
: _poly ( coefs:list x:num -- num )
  coefs rev 0.0 [ swap x * + ] reduce ;

: _alpha-coefs ( -- list )
  { { 0.0 0.5 -0.6666666666666666 0.3125 0.22777777777777777 } { 0.0 0.0 0.2708333333333333 -0.6 0.38680555555555557 } { 0.0 0.0 0.0 0.25416666666666665 -0.7357142857142858 } { 0.0 0.0 0.0 0.0 0.30729786706349205 } } ;

: _beta-coefs ( -- list )
  { { 0.0 0.5 -0.6666666666666666 0.3854166666666667 -0.002777777777777778 } { 0.0 0.0 0.020833333333333332 0.06666666666666667 -0.3034722222222222 } { 0.0 0.0 0.0 0.035416666666666666 -0.04404761904761905 } { 0.0 0.0 0.0 0.0 0.02726314484126984 } } ;

: _delta-coefs ( -- list )
  { { 0.0 2.0 -0.6666666666666666 -2.0 2.577777777777778 } { 0.0 0.0 2.3333333333333335 -1.6 -5.044444444444444 } { 0.0 0.0 0.0 3.7333333333333334 -3.8857142857142857 } { 0.0 0.0 0.0 0.0 6.792063492063492 } } ;

: _series ( coefs:list -- list ) coefs [ _n _poly ] map ;

\ The scale of the projection: k0 times the rectifying radius A = a / (1 + n) (1 + n^2/4 + n^4/64 + n^6/256).
: _scale ( -- num )
  _k0 _a 1.0 _n + / { 1.0 0.0 0.25 0.0 0.015625 0.0 0.00390625 } _n _poly * * ;

: _hyp ( x:num -- num ) x x * 1.0 + sqrt ;

\ sinh(e atanh(e tau / sqrt(1 + tau^2))) for tau = tan(latitude).
: _sigma ( tau:num -- num )
  _e tau * tau _hyp / "atanh" _math _e * "sinh" _math ;

: _tp ( tau:num sigma:num -- num )
  tau sigma _hyp * sigma tau _hyp * - ;

\ The conformal tau' of tau.
: _tau-prime ( tau:num -- num ) tau tau _sigma _tp ;

: _fwd2 ( tp:num lam:num -- num num )
  tp lam "cos" _math _atan2
  lam "sin" _math tp tp * lam "cos" _math dup * + sqrt / "asinh" _math ;

: _xi-term ( a:num k:num x:num y:num -- num )
  a k x * "sin" _math * k y * "cosh" _math * ;

: _eta-term ( a:num k:num x:num y:num -- num )
  a k x * "cos" _math * k y * "sinh" _math * ;

: _xi-sum ( x:num y:num coefs:list -- num )
  coefs [ 1 + 2 * int>num x y _xi-term ] mapi 0.0 [ + ] reduce ;

: _eta-sum ( x:num y:num coefs:list -- num )
  coefs [ 1 + 2 * int>num x y _eta-term ] mapi 0.0 [ + ] reduce ;

\ xi and eta from xi' and eta' (Karney eq. 11 and 12).
: _series-fwd ( x:num y:num alphas:list -- num num )
  x x y alphas _xi-sum + y x y alphas _eta-sum + ;

: _to-en ( xi:num eta:num -- num num )
  eta _scale * 500000.0 + xi _scale * ;

\ Latitude and longitude from the central meridian, in radians, to the (easting, northing) of the
\ zone (false easting 500 km, no false northing).
: _project ( phi:num lam:num -- num num )
  phi "tan" _math _tau-prime lam _fwd2 _alpha-coefs _series _series-fwd _to-en ;

\ xi' and eta' from xi and eta (Karney eq. 15 and 16).
: _inv-prime ( xi:num eta:num -- num num )
  xi xi eta _beta-coefs _series _xi-sum -
  eta xi eta _beta-coefs _series _eta-sum - ;

: _chi-lam ( xi:num eta:num -- num num )
  xi "sin" _math eta "cosh" _math / "asin" _math
  eta "sinh" _math xi "cos" _math _atan2 ;

: _delta-sum ( chi:num coefs:list -- num )
  coefs [ 1 + 2 * int>num chi * "sin" _math * ] mapi 0.0 [ + ] reduce ;

\ The (easting, northing) in the northern frame to latitude and longitude from the central
\ meridian, in radians.
: _unproject ( e:num n:num -- num num )
  n _scale / e 500000.0 - _scale / _inv-prime _chi-lam
  swap dup _delta-coefs _series _delta-sum + swap ;

\ Radians to pico-degrees.
: _unrad ( x:num -- int ) x 180000000000000.0 * _pi / round ;

\ ---- zones, bands and the text of UTM ----

: _plain-zone ( lon:int -- int ) lon 180 _d + 6 _d div 1 + 60 min ;

: _svalbard-zone ( lon:int -- int )
  lon 9 _d < [ 31 ] [ lon 21 _d < [ 33 ] [ lon 33 _d < [ 35 ] [ 37 ] if ] if ] if ;

\ The UTM zone of a point, with the exceptions for south-west Norway and Svalbard.
: _zone-of ( lat:int lon:int -- int )
  lat 56 _d >= lat 64 _d < and lon 3 _d >= and lon 12 _d < and
  [ 32 ]
  [ lat 72 _d >= lon 0 >= and lon 42 _d < and
    [ lon _svalbard-zone ]
    [ lon _plain-zone ] if ] if ;

: _bands ( -- str ) "CDEFGHJKLMNPQRSTUVWX" ;

: _band-index ( lat:int -- int ) lat 80 _d + 8 _d div 19 min ;

: _band ( lat:int -- str ) _bands lat _band-index dup 1 + slice ;

: _check-utm-range ( lat:int lon:int -- int int )
  lat 80 _d neg < lat 84 _d > or [ "UTM and MGRS cover latitudes 80 S to 84 N" raise:range ] when
  lat lon ;

\ The easting and northing in metres of a point in the zone (the southern false northing of
\ 10,000 km is added south of the equator).
: _utm-en ( lat:int lon:int zone:int -- num num )
  lat _rad lon zone 6 * 183 - _d - _rad _project
  lat 0 < [ 10000000.0 + ] when ;

: _utm-fmt ( lat:int lon:int zone:int -- str )
  zone int>str lat _band cat " " cat
  lat lon zone _utm-en
  round int>str swap round int>str swap " " swap cat cat cat ;

\ UTM text: zone number, latitude band, easting and northing in whole metres.
: _utm ( lat:int lon:int -- str )
  lat lon _check-utm-range lat lon _zone-of _utm-fmt ;

\ ---- MGRS ----

: _pad2 ( n:int -- str ) "0" 2 n int>str len - 0 max util:repeat-str n int>str cat ;

: _pad5 ( n:int -- str ) "0" 5 n int>str len - 0 max util:repeat-str n int>str cat ;

: _col-set ( zone:int -- str )
  zone 1 - 3 mod dup 0 = [ drop "ABCDEFGH" ] [ 1 = [ "JKLMNPQR" ] [ "STUVWXYZ" ] if ] if ;

: _row-set ( -- str ) "ABCDEFGHJKLMNPQRSTUV" ;

: _row-offset ( zone:int -- int ) zone 2 mod 0 = [ 5 ] [ 0 ] if ;

: _mgrs-tail-int ( ei:int ni:int zone:int -- str )
  zone _col-set ei 100000 div 1 - dup 1 + slice
  _row-set ni 100000 div zone _row-offset + 20 mod dup 1 + slice cat
  ei 100000 mod _pad5 cat ni 100000 mod _pad5 cat ;

: _mgrs-tail ( e:num n:num zone:int -- str )
  e floor n floor zone _mgrs-tail-int ;

: _mgrs-fmt ( lat:int lon:int zone:int -- str )
  zone _pad2 lat _band cat
  lat lon zone _utm-en zone _mgrs-tail cat ;

\ MGRS text (WGS 84, 1 m): zone, band, the 100 km square, then easting and northing within it.
: _mgrs ( lat:int lon:int -- str )
  lat lon _check-utm-range lat lon _zone-of _mgrs-fmt ;

\ ---- reading MGRS and UTM ----

\ The position of the one-character text c in set, E_COERCE when it is not there.
: _index-in ( set:str c:str -- int )
  set c split dup len 2 < [ "not a valid letter in this position" raise:coerce ] when 0 nth len ;

\ The smallest northing of each latitude band C to X, in metres.
: _band-min-northing ( -- list )
  { 1100000 2000000 2800000 3700000 4600000 5500000 6400000 7300000 8200000 9100000 0 800000 1700000 2600000 3500000 4400000 5300000 6200000 7000000 7900000 } ;

\ The northing of the 100 km row n100 (0 to 19) in a band: the smallest at or above the band's
\ lowest northing, as the rows repeat every 2000 km.
: _row-northing ( n100:int minn:int -- int )
  n100 100000 * dup minn swap - 1999999 + 2000000 div 0 max 2000000 * + ;

\ The digits from index from up to to as a number (0 when there are none).
: _digits-int ( digits:str from:int to:int -- int )
  from to = [ 0 ] [ digits from to slice str>int ] if ;

\ The middle of the cell named by the digits (p of easting then p of northing) in the 100 km square
\ whose easting is e100 hundred km and whose northing starts at nbase; cell is its size in metres.
: _cell-en-c ( e100:int nbase:int digits:str p:int cell:int -- num num )
  e100 100000 * digits 0 p _digits-int cell * + int>num cell int>num 2.0 / +
  nbase digits p p p + _digits-int cell * + int>num cell int>num 2.0 / + ;

: _cell-en ( e100:int nbase:int digits:str -- num num )
  e100 nbase digits digits len 2 div dup 5 swap - 10 swap pow _cell-en-c ;

\ Easting and northing in a zone to latitude and longitude in pico-degrees.
: _from-utm ( e:num n:num zone:int south:bool -- int int )
  e n south [ 10000000.0 - ] when _unproject
  _unrad swap _unrad swap
  zone 6 * 183 - _d + _check-range ;

: _mgrs-build2 ( zone:int bi:int col:str row:str digits:str -- int int )
  zone _col-set col _index-in 1 +
  _row-set row _index-in zone _row-offset - 20 mod _band-min-northing bi nth _row-northing
  digits _cell-en
  zone bi 10 < _from-utm ;

: _mgrs-build ( zone:int band:str col:str row:str digits:str -- int int )
  zone _bands band _index-in col row digits _mgrs-build2 ;

: _check-mgrs-digits ( digits:str -- )
  digits len 0 = digits _digits? or digits len 2 mod 0 = and digits len 10 <= and
  not [ "the digits of an MGRS reference come in pairs, at most 5 for each of easting and northing" raise:coerce ] when ;

\ c is the reference upper-cased without spaces; z is the length of its zone number.
: _mgrs-split ( c:str z:int -- int int )
  c len z 3 + < [ "an MGRS reference is a zone, a band letter and two square letters, then digits" raise:coerce ] when
  c 0 z slice str>int dup 1 < over 60 > or [ "the zone is 1 to 60" raise:range ] when
  c z z 1 + slice c z 1 + z 2 + slice c z 2 + z 3 + slice c z 3 + c len slice
  dup _check-mgrs-digits _mgrs-build ;

: _mgrs-parse-c ( c:str -- int int )
  c [ util:dec-digit? ] util:count-leading
  dup 1 < over 2 > or [ "an MGRS reference starts with a zone number of one or two digits" raise:coerce ] when
  c swap _mgrs-split ;

\ An MGRS reference (any case, spaces allowed) as the latitude and longitude of the middle of its cell.
: _mgrs-parse ( text:str -- int int )
  text upper util:strip-space _mgrs-parse-c ;

: _utm-tokens ( text:str -- list )
  text str>codes [ dup 44 = [ drop 32 ] when ] map codes>str upper " " split [ len 0 > ] filter ;

\ The zone-and-band, easting and northing texts of 3 tokens (31T E N) or 4 (31 T E N).
: _utm-fields ( toks:list -- str str str )
  toks len 3 = [ toks 0 nth toks 1 nth toks 2 nth ]
  [ toks len 4 = [ toks 0 nth toks 1 nth cat toks 2 nth toks 3 nth ]
    [ "a UTM reference is a zone and band, an easting and a northing" raise:coerce "" "" "" ] if ] if ;

: _utm-build2 ( zb:str z:int e:str n:str -- int int )
  zb len z 1 + = z 1 >= and z 2 <= and
  not [ "the UTM zone is a number of one or two digits followed by a latitude band letter" raise:coerce ] when
  zb 0 z slice str>int dup 1 < over 60 > or [ "the zone is 1 to 60" raise:range ] when
  e _decimal-num n _decimal-num
  rot
  _bands zb z zb len slice _index-in 10 < _from-utm ;

: _utm-build ( zb:str e:str n:str -- int int )
  zb zb [ util:dec-digit? ] util:count-leading e n _utm-build2 ;

: _utm-parse ( text:str -- int int )
  text _utm-tokens _utm-fields _utm-build ;

\ ---- finding out which format a text is in ----

: _decimal? ( t:str -- bool )
  t len 0 > t str>codes [ dup util:dec-digit? swap 46 = or ] filter len t len = and ;

: _geohash? ( text:str -- bool )
  text [ util:space? ] util:trim-start [ util:space? ] util:trim-end
  dup len 1 >= over len 12 <= and swap
  str>codes [ util:cp>str _gh-alphabet swap split len 2 = ] filter len
  text [ util:space? ] util:trim-start [ util:space? ] util:trim-end len = and ;

: _mgrs-shape? ( c:str z:int -- bool )
  c len z 3 + >= z 1 >= and z 2 <= and
  [ c z z 3 + slice str>codes [ 65 90 util:between? ] filter len 3 =
    c z 3 + c len slice dup len 0 = swap _digits? or and ]
  [ false ] if ;

: _mgrs? ( text:str -- bool )
  text upper util:strip-space dup [ util:dec-digit? ] util:count-leading _mgrs-shape? ;

: _zone-band? ( zb:str -- bool )
  zb [ util:dec-digit? ] util:count-leading
  dup 1 >= over 2 <= and swap zb len swap 1 + = and
  _bands zb zb len 1 - zb len slice split len 2 = and ;

: _utm-fields-ok? ( zb:str e:str n:str -- bool )
  zb _zone-band? e _decimal? and n _decimal? and ;

: _utm-shape? ( toks:list -- bool )
  toks len 3 = toks len 4 = or
  [ toks _utm-fields _utm-fields-ok? ] [ false ] if ;

: _utm? ( text:str -- bool ) text _utm-tokens _utm-shape? ;

\ The format of the text: from when given, otherwise geohash, mgrs, utm, or auto for numbers.
: _kind ( text:str from:str -- str )
  from "auto" = not
  [ from ]
  [ text _geohash? [ "geohash" ]
    [ text _mgrs? [ "mgrs" ] [ text _utm? [ "utm" ] [ "auto" ] if ] if ] if ] if ;

: _dispatch ( text:str kind:str -- int int )
  kind "geohash" = [ text _gh-decode ]
  [ kind "mgrs" = [ text _mgrs-parse ]
    [ kind "utm" = [ text _utm-parse ] [ text _tokens kind _parse-tokens ] if ] if ] if ;

: _parse ( text:str from:str -- int int )
  text text from _kind _dispatch ;

\ ---- writing a format ----

: _format-out ( lat:int lon:int to:str p:int -- str )
  to "decimal-degrees" = [ lat p _dd ", " cat lon p _dd cat ]
  [ to "degrees-decimal-minutes" = [ lat p "N" "S" _dmm ", " cat lon p "E" "W" _dmm cat ]
    [ to "degrees-minutes-seconds" = [ lat p "N" "S" _dms ", " cat lon p "E" "W" _dms cat ]
      [ to "geohash" = [ lat lon p _gh-encode ]
        [ to "utm" = [ lat lon _utm ] [ lat lon _mgrs ] if ] if ] if ] if ] if ;

: convert ( data:str from:choice{auto|decimal-degrees|degrees-decimal-minutes|degrees-minutes-seconds|geohash|utm|mgrs}="auto" to:choice{decimal-degrees|degrees-decimal-minutes|degrees-minutes-seconds|geohash|utm|mgrs}="decimal-degrees" precision:int[1..12]=6 -- str )
  "A position (latitude first) converted from one co-ordinate format to another. Formats: decimal degrees (48.856670, 2.352220), degrees and decimal minutes, degrees minutes and seconds (48 51 24 N, 2 21 7 E), geohash, UTM (31T 448251 5411932) and MGRS (31UDQ4825111932), the last two on WGS 84 and between 80 S and 84 N. The input is read in the format from; with auto, one lower-case word of geohash characters is a geohash, a zone with band letter and two numbers is UTM, an upper-case zone, band and square letters then digits is MGRS, and 2, 4 or 6 numbers are decimal degrees, degrees and minutes, or degrees minutes and seconds. Numbers may be separated by anything that is not a digit, point, minus sign or one of the letters N S E W (so write the units as degree, minute and second marks or leave them out: the s of 24s would be read as south); the letters S and W (or a minus sign) make a value negative. Output: precision is the number of decimals of degrees, minutes or seconds, and the number of characters of a geohash (1 to 12); UTM and MGRS ignore it (whole metres; MGRS cuts to the metre, UTM rounds). Reading a geohash or MGRS gives the middle of its cell. Degrees are exact to 10^-12; UTM and MGRS go through floating point (Karney series, sub-millimetre). The Ordnance Survey National Grid is not offered." doc
  "Conversions" category
  data from _parse to precision _format-out ;

\ ---- the great-circle distance ----

: _sq ( x:num -- num ) x x * ;

: _hav-a ( p1:num p2:num dl:num -- num )
  p1 p2 - 2.0 / "sin" _math _sq
  p1 "cos" _math p2 "cos" _math * dl 2.0 / "sin" _math _sq * + ;

\ The central angle from the haversine a.
: _hav-c ( a:num -- num )
  a 1.0 min 0.0 max sqrt 1.0 a - 0.0 max sqrt _atan2 2.0 * ;

: _hav ( lat1:int lon1:int lat2:int lon2:int radius:num -- str )
  lat1 _rad lat2 _rad lon2 lon1 - _rad _hav-a _hav-c radius 1000000.0 * * round 3 _fixed ;

\ The four numbers of CyberChef's one-line input "lat1, lng1, lat2, lng2" as two positions.
: _split4 ( t:list -- list )
  { t 0 nth "," cat t 1 nth cat  t 2 nth "," cat t 3 nth cat } ;

: _two-lines ( data:str -- list )
  data "\n" split [ [ util:space? ] util:trim-start [ util:space? ] util:trim-end ] map [ len 0 > ] filter
  dup len 1 =
  [ dup 0 nth "^-?\\d+(?:\\.\\d+)?, ?-?\\d+(?:\\.\\d+)?, ?-?\\d+(?:\\.\\d+)?, ?-?\\d+(?:\\.\\d+)?$" "" regex:test
    [ 0 nth "-?\\d+(?:\\.\\d+)?" "" util:match-texts _split4 ] when ]
  when ;

: haversine ( data:str radius:num=6371 -- str )
  "The great-circle distance between two positions, from the haversine formula on a sphere of the given radius in kilometres (6371, the mean radius of the earth, by default). The input is the two positions on two lines, each in any format convert reads with auto, or CyberChef's one line of four decimal degrees, lat1, lng1, lat2, lng2 (comma and an optional space between) (decimal degrees, degrees and minutes, degrees minutes and seconds, geohash, UTM or MGRS); the result is in metres, to the millimetre, as decimal text. Like CyberChef it treats the earth as a sphere, so it can differ from the geodesic on the ellipsoid by up to about 0.5 percent." doc
  "Conversions" category
  radius 0.0 > not [ "the radius must be above 0" raise:range ] when
  data _two-lines dup len 2 = not [ "give exactly two positions, one on each line" raise:coerce ] when
  dup 0 nth "auto" _parse rot 1 nth "auto" _parse radius _hav ;

META: convert
  param from "The format of the input, or auto to detect it." ;
  param to "The format to write." ;
  param precision "Decimals of degrees, minutes or seconds; the characters of a geohash (1 to 12)." ;
  see-also coords:haversine units:convert-distance ;
;

META: haversine
  param radius "The radius of the sphere in kilometres." ;
  see-also coords:convert units:convert-distance ;
;
