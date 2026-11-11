\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ colossus: a Forge-native counting machine in the manner of Colossus, the electronic computer
\ that Bletchley Park built in 1943-44 to find the chi wheel settings of Lorenz traffic. Given
\ the ciphertext (ITA2 in Bletchley Park notation, as lorenz:encrypt writes it) and the chi
\ patterns, it counts, for every start position of two chosen chi wheels, how often a Boolean
\ condition holds, and lists the best settings: the highest counts, those that reach a set total.
\
\ The condition. A sum (exclusive or, written +) of terms, each one of
\   z1 .. z5    impulse 1 to 5 of the ciphertext character       (Z)
\   dz1 .. dz5  the same, added to the next character            (delta Z)
\   x1 .. x5    the cell of chi wheel 1 to 5 at the position     (chi)
\   dx1 .. dx5  the same, added to the cell of the next position (delta chi)
\ and a target, dot (0) or cross (1). The classic first run, "the 1+2 break-in" of the General
\ Report, counts dz1 + dz2 + dx1 + dx2 = dot over the 41 x 31 = 1271 settings of chi1 and chi2: the
\ plain text and psi stream mostly repeat from one character to the next (dots in delta P and
\ delta psi'), so the right setting scores clearly above half the positions. That is the
\ default. After chi1 and chi2 are found, give their start positions (chi1-start, chi2-start)
\ and search chi3 and chi4 with a condition such as dz3+dz4+dx3+dx4+dz1+dx1 ... or, as the
\ historical wheel-setting runs did, with terms of the known wheels in the sum (a known wheel is
\ one whose start position is given; the two searched wheels are wheel-a and wheel-b).
\ Not supported: runs over three wheels at once (the chi3 chi4 chi5 run of the General Report),
\ and the psi wheels and motors: those were separate runs of the real machine.
\
\ How it counts. Colossus compared every setting with the whole tape. Here the count is the same
\ number found without that scan: a chi cell depends only on the position modulo the wheel
\ length, and the lengths of the chi wheels are prime to each other, so the +1/-1 values of the
\ ciphertext part of the condition are first folded into one sum per residue modulo
\ (length a x length b); the sums of all settings then come from two small matrix products over
\ those residues (about 100,000 operations whatever the length of the message). The result is
\ cross-checked in the tests against a direct count over the tape.
\
\ Output: a table of the best settings, sorted by count, then by start positions. count is
\ the number of positions where the condition holds; bias is count minus failures (twice the
\ count less the number of positions); sigma is bias divided by the square root of the number of
\ positions, the usual yardstick: for a wrong setting it is about 0 give or take 3. The start
\ positions are counted as in lorenz (the cell at the first character, from 1), so they can be
\ passed straight to lorenz:decrypt.
\
\ Sources: "General Report on Tunny" (1945), Part 3 chapter on the Colossus runs and chapter 11 for
\ the differencing and the chi and psi streams; Tony Sale's Codes and Ciphers pages on the
\ Colossus; the published messages used in the tests are the ciphertexts of Tony Sale's Virtual
\ Colossus. Written in FL, no primitive: the work is the folding loop (one pass over the
\ message) and a few hundred thousand steps of arithmetic.
IN: colossus
USING: lorenz ;


\ ---- the condition ----

\ k is the letter (z or x), w the digit, d 1 for a differenced term; the code is 16 d + 8 x + w.
: _term3 ( k:int w:int d:int -- int )
  k 122 <> k 120 <> and w 1 5 util:between? not or
  [ "a term is z1, dz1, x1 or dx1 (impulse or wheel 1 to 5), terms joined by +" raise:range ] when
  d 16 * k 120 = [ 8 ] [ 0 ] if + w + ;

: _term2 ( c:list d:int -- int )
  c len 2 <> [ "a term is z1, dz1, x1 or dx1 (impulse or wheel 1 to 5), terms joined by +" raise:range ] when
  c 0 nth c 1 nth 48 - d _term3 ;

: _term1 ( c:list -- int )
  c len 0 = [ "an empty term in the condition" raise:range ] when
  c 0 nth 100 =
  [ c 1 c len slice 1 _term2 ]
  [ c 0 _term2 ]
  if ;

: _terms ( s:str -- list )
  s str>codes [ 32 <> ] filter codes>str "+" split [ str>codes _term1 ] map ;

: _default ( a:int b:int -- str )
  "dz" a int>str cat "+dz" cat b int>str cat "+dx" cat a int>str cat "+dx" cat b int>str cat ;

\ ---- the streams of the ciphertext part ----

\ Impulse w (1 to 5) of every code, as a 0/1 byte.
: _bits ( z:bytes w:int -- bytes )
  z 0 256 range [ w 1 - shr 1 band ] map list>bytes translate ;

\ A ciphertext term over m positions (m is one less than the message when a term is differenced).
: _zstream ( z:bytes w:int d:int m:int -- bytes )
  z w _bits
  d 0 = [ 0 m slice ] [ dup 0 m slice swap 1 m 1 + slice bxor ] if ;

\ The cells of a chi wheel, or their sum with the next cell when d is 1.
: _arr ( pat:bytes d:int -- bytes )
  d 0 = [ pat ] [ pat pat 1 pat len slice pat 0 1 slice cat bxor ] if ;

: _xstream ( pat:bytes d:int start:int m:int -- bytes )
  pat d _arr start 1 - m util:cycle-bytes ;

: _need ( pat:bytes w:int -- bytes )
  pat len 0 = [ "chi" w int>str cat " has no pattern: choose KH, ZMUG or BREAM, or give the custom pattern" cat raise:range ] when
  pat ;

\ One term of the sum that does not depend on the searched settings (a ciphertext term or a
\ term of a known chi wheel); a term of a searched wheel gives zeros here.
: _stream-of ( c:int z:bytes pats:list starts:list a:int b:int m:int -- bytes )
  c 8 band 0 =
  [ z c 7 band c 4 shr 1 band m _zstream ]
  [ c 7 band a = c 7 band b = or
    [ m util:zero-bytes ]
    [ starts c 7 band 1 - nth 0 =
      [ "a chi wheel in the condition that is not searched needs its start position (chiN-start)" raise:range ] when
      pats c 7 band 1 - nth c 7 band _need c 4 shr 1 band starts c 7 band 1 - nth m _xstream ]
    if ]
  if ;

: _zpart ( terms:list z:bytes pats:list starts:list a:int b:int m:int -- bytes )
  terms [ z pats starts a b m _stream-of ] map
  m util:zero-bytes [ bxor ] reduce ;

\ The values 1 where zp is not the target and 0 where it is.
: _zt ( zp:bytes target:int -- bytes )
  zp 0 256 range [ target bxor ] map list>bytes translate ;

\ ---- the searched wheels ----

\ The sum, over the terms of chi wheel w, of its cells (or their differences).
: _fn ( terms:list pat:bytes w:int -- bytes )
  terms [ dup 8 band 0 > swap 7 band w = and ] filter
  pat len util:zero-bytes
  [ 4 shr 1 band pat swap _arr bxor ] reduce ;

\ +1 for a dot and -1 for a cross, over two turns of the wheel.
: _sigma2 ( f:bytes -- list )
  f f cat bytes>list [ 2 * 1 swap - ] map ;

\ ---- folding the message and the two products ----

\ The sum of +1 (zt = 0) and -1 (zt = 1) over the positions r, r + l, r + 2l ... below m.
: _dsum ( zt:bytes r:int l:int m:int -- int )
  0 m r - l + 1 - l div range 0 [ l * r + zt swap nth 2 * 1 swap - + ] reduce ;

: _dlist ( zt:bytes l:int m:int -- list )
  0 l range [ zt swap l m _dsum ] map ;

\ The residue (modulo la x lb) with remainders i and j.
: _cell ( j:int i:int d:list e1:int e2:int l:int -- int )
  i e1 * j e2 * + l mod d swap nth ;

: _drow ( i:int d:list lb:int e1:int e2:int l:int -- list )
  0 lb range [ i d e1 e2 l _cell ] map ;

: _drows ( d:list la:int lb:int -- list )
  0 la range [ d lb lb la invmod lb * la lb invmod la * la lb * _drow ] map ;

\ sum over j below n of row[j] * sig[j + s].
: _dot ( row:list sig:list s:int n:int -- int )
  0 n range 0 [ dup row swap nth swap s + sig swap nth * + ] reduce ;

: _gcol ( sb:int rows:list sigb:list la:int lb:int -- list )
  0 la range [ rows swap nth sigb sb lb _dot ] map ;

: _gs ( rows:list sigb:list la:int lb:int -- list )
  0 lb range [ rows sigb la lb _gcol ] map ;

: _srow ( sa:int g:list siga:list la:int lb:int -- list )
  0 lb range [ g swap nth siga sa la _dot ] map ;

\ The sum of +1/-1 over the positions for every setting, the first wheel's start major.
: _scores ( g:list siga:list la:int lb:int -- list )
  0 la range [ g siga la lb _srow ] map { } [ cat ] reduce ;

0 VARIABLE _m
0 VARIABLE _la
0 VARIABLE _lb

: _sums ( z:bytes terms:list pats:list starts:list a:int b:int target:int -- list )
  terms [ 16 band 0 > ] filter len 0 > [ z len 1 - ] [ z len ] if _m!
  _m 1 < [ "the message is too short for a differenced term" raise:range ] when
  pats a 1 - nth a _need len _la!
  pats b 1 - nth b _need len _lb!
  terms z pats starts a b _m _zpart target _zt
  _la _lb * _m _dlist
  _la _lb _drows
  terms pats b 1 - nth b _fn _sigma2 _la _lb _gs
  terms pats a 1 - nth a _fn _sigma2 _la _lb _scores ;

\ ---- the table ----

: _cells ( cells:list -- str )
  cells { 4 6 6 7 7 6 } zip [ dup 0 nth swap 1 nth util:pad-left ] map "  " join ;

: _tenth ( s:int -- str )
  s 0 < [ "-" ] [ "" ] if s abs 10 div int>str cat "." cat s abs 10 mod int>str cat ;

\ A row: rank, the start positions of the two wheels, count, bias and sigma (bias per square
\ root of the positions, in tenths).
: _row3 ( rank:int sa:int sb:int cnt:int bias:int -- str )
  { rank int>str sa int>str sb int>str cnt int>str bias int>str bias 10 * _m sqrt / round _tenth } _cells ;

: _row2 ( idx:int cnt:int rank:int lb:int -- str )
  rank idx lb div 1 + idx lb mod 1 + cnt cnt 2 * _m - _row3 ;

\ k packs the count (k div 4096) and the number of the setting (4095 minus k mod 4096).
: _row ( k:int rank:int lb:int -- str )
  4095 k 4096 mod - k 4096 div rank lb _row2 ;

0 VARIABLE _prev
"" VARIABLE _ct

\ The largest key below _prev, which then becomes _prev; -1 when none is left.
: _next ( keys:list -- int )
  keys [ _prev < ] filter dup len 0 =
  [ drop -1 ] [ dup 0 nth [ max ] reduce ] if
  dup _prev! ;

\ The n largest keys (the keys are all different), largest first.
: _top ( keys:list n:int -- list )
  1000000000 _prev!
  0 n range [ drop keys _next ] map [ 0 >= ] filter ;

: _head ( a:int b:int tt:str -- str )
  "colossus: " _ct cat " = " cat tt cat ", chi" cat a int>str cat " x chi" cat b int>str cat
  ", " cat _la _lb * int>str cat " settings, " cat _m int>str cat " positions compared" cat ;

: _colhead ( a:int b:int -- str )
  { "rank" "chi" a int>str cat "chi" b int>str cat "count" "bias" "sigma" } _cells ;

: _table ( keys:list a:int b:int tt:str total:int -- str )
  { a b tt _head a b _colhead }
  keys [ 1 + _lb _row ] mapi cat
  keys len 0 = [ { "(no setting reached the set total of " total int>str cat ")" cat } cat ] when
  "\n" join ;

\ ---- the word ----

: _go ( z:bytes ctext:str a:int b:int t:int pattern:str custom:list starts:list top:int total:int -- str )
  ctext _ct!
  z ctext _terms
  lorenz:pattern-sets pattern get 0 5 slice custom lorenz:merge-patterns
  [ str>bytes lorenz:cam-table translate ] map
  starts a b t _sums
  [ swap _m + 2 div 4096 * swap 4095 swap - + ] mapi
  [ 4096 div total >= ] filter top _top
  a b t 0 = [ "dot" ] [ "cross" ] if total _table ;

: _colossus ( cipher:str a:int b:int cond:str target:str pattern:str custom:list starts:list top:int total:int -- str )
  a b = [ "wheel-a and wheel-b must be two different chi wheels" raise:range ] when
  cipher util:from-bp dup len 0 = [ "the ciphertext is empty" raise:range ] when
  cond len 0 = [ a b _default ] [ cond util:strip-space lower ] if
  a b target "cross" = [ 1 ] [ 0 ] if pattern custom starts top total _go ;

: count ( cipher:str wheel-a:int[1..5]=1 wheel-b:int[1..5]=2 condition:str[0..64,/[dDzZxX1-5+]*/]="" target:choice{dot|cross}=dot pattern:choice{KH|ZMUG|BREAM|custom}=KH chi1:str[0|41,/[x.]*/]="" chi2:str[0|31,/[x.]*/]="" chi3:str[0|29,/[x.]*/]="" chi4:str[0|26,/[x.]*/]="" chi5:str[0|23,/[x.]*/]="" chi1-start:int[0..41]=0 chi2-start:int[0..31]=0 chi3-start:int[0..29]=0 chi4-start:int[0..26]=0 chi5-start:int[0..23]=0 top:int[1..100]=10 set-total:int[0..]=0 -- str )
  "Count, over every start position of two chi wheels, how often a Boolean condition on the ciphertext and the chi cells holds (a Colossus run), and list the best settings. The ciphertext is Lorenz ITA2 text in Bletchley Park notation. The default is the 1+2 break-in: dz1+dz2+dx1+dx2 = dot over chi1 and chi2. The table shows the start positions (as lorenz:decrypt takes them), the count, the bias (count minus failures) and sigma." doc
  "Cipher machines" category
  cipher wheel-a wheel-b condition target pattern
  { chi1 chi2 chi3 chi4 chi5 }
  { chi1-start chi2-start chi3-start chi4-start chi5-start }
  top set-total _colossus ;

META: count
  param wheel-a "The first chi wheel whose start position is searched, 1 to 5." ;
  param wheel-b "The second chi wheel searched, 1 to 5, not the same as wheel-a." ;
  param condition "Terms joined by +: z1..z5, dz1..dz5 (ciphertext), x1..x5, dx1..dx5 (chi cells). Empty means dz+dz+dx+dx of the two wheels." ;
  param target "dot (0) or cross (1): the value the sum of the terms must have to count." ;
  param pattern "Published chi patterns KH, ZMUG or BREAM, or custom (chi patterns of the searched and known wheels are then required)." ;
  param chi1 "Custom pattern of chi 1, 41 characters x or . in order of use; empty keeps the published one." ;
  param chi2 "Custom pattern of chi 2, 31 characters x or . in order of use; empty keeps the published one." ;
  param chi3 "Custom pattern of chi 3, 29 characters x or . in order of use; empty keeps the published one." ;
  param chi4 "Custom pattern of chi 4, 26 characters x or . in order of use; empty keeps the published one." ;
  param chi5 "Custom pattern of chi 5, 23 characters x or . in order of use; empty keeps the published one." ;
  param chi1-start "Known start cell of chi 1 (1 to 41) for terms of a wheel that is not searched; 0 when not known." ;
  param chi2-start "Known start cell of chi 2 (1 to 31) for terms of a wheel that is not searched; 0 when not known." ;
  param chi3-start "Known start cell of chi 3 (1 to 29) for terms of a wheel that is not searched; 0 when not known." ;
  param chi4-start "Known start cell of chi 4 (1 to 26) for terms of a wheel that is not searched; 0 when not known." ;
  param chi5-start "Known start cell of chi 5 (1 to 23) for terms of a wheel that is not searched; 0 when not known." ;
  param top "How many settings to list at most, 1 to 100." ;
  param set-total "List only settings whose count is at least this (the set total of a Colossus run); 0 lists all." ;
  see-also lorenz:encrypt lorenz:decrypt ;
;
