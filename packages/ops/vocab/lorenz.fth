\ lorenz: the Lorenz SZ40/SZ42 teleprinter cipher attachment ("Tunny"), which enciphered German
\ high command traffic from 1941 to 1945. The key is the sum of the characters of 12 wheels:
\ five chi wheels (41 31 29 26 23 cams), five psi wheels (43 47 51 53 59) and two motor wheels
\ (mu37 and mu61). Every wheel is a ring of cams, a cross (x) when raised and a dot (.) when not.
\ The words work on the five-bit teleprinter alphabet ITA2, either as raw characters in the
\ Bletchley Park notation (the 32 characters are the 26 letters, 3 for carriage return, 4 for
\ line feed, 5 for figure shift, 8 for letter shift, 9 for space and / for null; + and - are
\ read as figure and letter shift too) or as ordinary text, with the shift characters added and
\ followed automatically.
\
\ How a character is enciphered (General Report on Tunny, 1945, chapter 11B and 11C):
\   - the chi wheels all step after every character; the key letter is chi + psi' (the five
\     chi cells and the five psi cells at the active positions, impulse 1 first);
\   - mu61 steps after every character; when its active cell is a cross, mu37 steps too; the
\     active cell of mu37 is the basic motor (BM);
\   - the psi wheels all step after the character when the total motor (TM) is a cross, where
\     TM = BM unless BM is a dot and the limitation is a cross, when TM is a dot;
\   - SZ40 (1940-41): no limitation, TM = BM. SZ42a (1942-): limitation = chi2 of the previous
\     character ("chi2 one back"). SZ42b (1942-): limitation = chi2 + psi1' of the previous
\     character. Either 42 model may add the P5 attachment: the limitation is also summed with
\     impulse 5 of the plain text two characters back (an autoclave: the key depends on the
\     plain text, so decrypting must take that bit from its own output). Before the first
\     character the "previous" cells are the cells before the start position of the wheel (for
\     chi2) and a dot (for psi1', P5).
\ The machine is reciprocal: adding the key twice gives the plain text again (without P5 both
\ directions are the same operation; with P5 the direction matters, so there are two words).
\
\ Wheel patterns are strings of x and . in the order in which the wheel presents its cells to
\ successive characters; a start position is the cell (1 to the wheel length) presented to the
\ first character. These are the wheel numbers of the German wheel windows and of the published
\ examples. The patterns of the published settings KH (the settings of the 1942 depth of
\ messages), ZMUG and BREAM (named after the links and the codeword of those days) are kept as
\ words (kh-patterns, ...) so that colossus can use them; they follow the data of the Virtual
\ Colossus and Virtual Tunny simulators of Tony Sale, reversed to presentation order.
\ Not modelled: the switch-on routine of the machine (the General Report, 11B(k), says the
\ wheels move in a special way before the second and third letters) and the sound and timing of
\ the real teleprinter.
\
\ Sources: "General Report on Tunny" (Good, Michie and Timms, Bletchley Park, 1945; chapter 11,
\ the stepping rules, the limitations and the worked examples reproduced in lorenz.test.json);
\ Tony Sale, Codes and Ciphers (codesandciphers.org.uk) and his Virtual Colossus, whose examples
\ with their wheel settings supply the other vectors; W. T. Tutte's wheel names (chi, psi, mu).
\ Written in FL; no primitive is needed (the key streams are built with the byte words of core
\ and the only per-character loop is a mapi over the data).
IN: lorenz

\ ---- the alphabet, wheel sizes and published patterns ----

: ita2-alphabet ( -- str )
  "The 32 teleprinter characters in Bletchley Park notation, ordered by their five-bit code (impulse 1 is bit 0): / null, E, 4 line feed, A, 9 space, S, I, U, 3 carriage return, D, R, J, N, F, C, K, T, Z, L, W, H, Y, P, Q, O, B, G, 5 figure shift, M, X, V, 8 letter shift." doc
  "/E4A9SIU3DRJNFCKTZLWHYPQOBG5MXV8" ;

: wheel-lengths ( -- list )
  "The cams of the twelve wheels in the order chi1 to chi5, psi1 to psi5, mu37, mu61." doc
  { 41 31 29 26 23 43 47 51 53 59 37 61 } ;

: cam-table ( -- bytes )
  "A 256-byte table for translate: x becomes 1, . becomes 0 and any other byte 255." doc
  0 256 range [ dup 120 = [ drop 1 ] [ 46 = [ 0 ] [ 255 ] if ] if ] map list>bytes ;

\ The twelve patterns of a setting, in the order chi1 to chi5, psi1 to psi5, mu37, mu61.
: kh-patterns ( -- list )
  "The wheel patterns of the KH setting (the 1942 depth), as twelve strings of x and ., in the order chi1 to chi5, psi1 to psi5, mu37, mu61, each in the order of use." doc
  { "..xxxx.xx....xxx..x.x...x.xxxx.x.xxx...x."
    "..xx.xx..x..xx..xxxx.x...xxx..x"
    ".xx.xx..xx...xx...xxx.x..xx.."
    "..x....xxx.xx..xxxx..x..xx"
    "..x.x..x.xxxx....xx..xx"
    "x.xx.x..x.x.x.x.x.xxxx.x.x.xxx..x.x.xx...x."
    "x..x.x.x.xx.x....x.xxx.x.xx.x..x.x.x..xxx.x.xx."
    "x.x.x..xx.x.x..x.x.xxx..x.x.x.xx.x.x....xxx..x.x.x."
    ".x.x.x.x.x.x..x.xx.x.x..x.x.xx.x...xx.x.x.xxxxx...xx."
    ".x..x.xx...x.x.xxxx..xx.x.x.x.x.x.x.x.x...x.xx.x..x.xx...xx"
    "....x.x...x.x.x...x.x.x...x.x.x.x.x.x"
    "...xxxx.xxx.xxxx.xxxx.xxxx.xxxx.xxx....xx.xxxx.xxx.xxxx.xxxx." } ;

: zmug-patterns ( -- list )
  "The wheel patterns of the ZMUG setting, as twelve strings of x and ., in the order chi1 to chi5, psi1 to psi5, mu37, mu61, each in the order of use." doc
  { ".xx..xxx....xxx..xxx....x..xx.xx...xx.xx."
    "...xx..xx...x.xxxx.xxx....xx.xx"
    ".xxxx.xx...xxx...xx...xx..x.."
    "x.x..xxx.x..xx...xx..x.x.x"
    "x.x....xxx.x...xxxx..x."
    "...xxx..xxx..xxxx...xx...xx..xxx...xx..x.xx"
    "xx.x..xxx..xxx..xx...xxxx...xxx..xx..xxx...x..."
    "xxx..xx...xx...xxx...x...xxxx...x..xxx..xxx..xx..x."
    "x.xxx..xx...xx..x..xxx..xx...x...xxxx..xxx..xx..xxx.."
    ".xx...x..xxx..xx..xxx..xx...xxxx..x..xxx..xxxx...x...xxx..x"
    "xxx.xxx.xxx.x.xx.xxx.xxx.xx.x.xx.x.x."
    "x.x.x.xxxx.x.x.xxx.xxx.xxx.xx.xx.xx.xx.xxx.x.x.xxx.xxx.x.xx.x" } ;

: bream-patterns ( -- list )
  "The wheel patterns of the BREAM setting, as twelve strings of x and ., in the order chi1 to chi5, psi1 to psi5, mu37, mu61, each in the order of use." doc
  { "...xxxx....xx....x.xx..x..xx.x.xx.x.xxxx."
    "xx..xxx.xx...x.x.xx...x....xxx."
    "..xxx.xx..x....xxx..xx.xx..xx"
    "..xx..x.xx..x..xx..x..xxxx"
    ".x...x.xx..x...xxx.xxx."
    "..x.x.x.x.x..x..x.xx.xx.x.x..xx.xxx..xxx..."
    "..x.xx.x.x.x.x.x.xx..xx.x..x.xxxx.....xxx..x.xx"
    "x.x.x.x.x.x.x..x..xx.x.x.xxxx....xxx...xxx.xx..x..x"
    "x.x..xx.x.x.x.x.x.xx.x....xx..xx..xx.xxxxx.x..x....x."
    ".x.x.x.x.xx...x.x..xxx.xxxx.xx.x....x...x..xx.xx..xx..x.x.x"
    "x.xxx.x.x.x.x..x.x.xxx.x.x.x.x.x.x.x."
    "xxx.x.xx..xx..xx...xxxx.x.xx.xx...xx....xxxx.xx..xx...xx....x" } ;

\ ---- teleprinter characters ----

\ The letter row and the figure row of the 32 codes (ITA2); \u{100} marks a code with no
\ character (null and the two shifts, which are handled before the rows are looked at). In the
\ figure row D is ENQ (who are you), J is BEL, and F, G and H are the national positions, here
\ ! & #.
: _letter-row ( -- str )
  "\u{100}E\nA SIU\rDRJNFCKTZLWHYPQOBG\u{100}MXV\u{100}" ;

: _figure-row ( -- str )
  "\u{100}3\n- '87\r\x054\x07,!:(5+)2#6019?&\u{100}./=\u{100}" ;

\ The code of a Bletchley Park character: u is the upper-case byte, tbl the alphabet table;
\ + and - are figure and letter shift. 254 stands for white space and 255 for anything else.
\ util-candidate: ita2-code
: _ita2-code ( u:int tbl:bytes -- int )
  u 43 = [ 27 ] [ u 45 = [ 31 ] [ tbl u nth ] if ] if ;

\ util-candidate: ita2-entry
: _ita2-entry ( b:int base:bytes -- int )
  b 97 122 util:between? [ b 32 - ] [ b ] if base _ita2-code ;

\ util-candidate: ita2-table2
: _ita2-table2 ( base:bytes -- bytes )
  0 256 range [ base _ita2-entry ] map list>bytes ;

\ util-candidate: ita2-table
: _ita2-table ( -- bytes )
  ita2-alphabet 254 255 util:decode-table _ita2-table2 ;

\ The codes of text in Bletchley Park notation (either case, white space ignored).
\ util-candidate: from-bp
: _from-bp ( s:str -- bytes )
  s str>bytes _ita2-table translate
  dup [ 255 = ] filter len 0 <>
  [ "not an ITA2 character: use the letters, 3 4 5 8 9 / (and + and -); white space is ignored" raise:coerce ] when
  [ 254 <> ] filter ;

: _bp-table2 ( alpha:list -- bytes )
  0 256 range [ dup 32 < [ alpha swap nth ] [ drop 0 ] if ] map list>bytes ;

: _to-bp ( codes:bytes -- str )
  codes ita2-alphabet str>codes _bp-table2 translate bytes>str ;

\ ---- text to codes and back ----

\ The shift state of the text being converted: 0 letters (where every message starts), 1 figures.
0 VARIABLE _st

\ sh then c, with sh sent reps times.
: _shift-piece ( sh:int c:int reps:int -- bytes )
  0 reps range [ drop sh ] map { c } cat list>bytes ;

\ The codes of one character with the code lc in the letter row and fc in the figure row (255 when
\ it has none there); a shift character is put in front when the other row is current.
: _enc-char ( lc:int fc:int reps:int -- bytes )
  lc 255 = fc 255 = and
  [ "the character has no ITA2 code (letters, digits, . , : - ? ' ( ) + = / ! & # space and line ends are supported)" raise:coerce ] when
  lc 255 <> fc 255 <> and
  [ { lc } list>bytes ]
  [ lc 255 <>
    [ _st 0 = [ { lc } list>bytes ] [ 0 _st! 31 lc reps _shift-piece ] if ]
    [ _st 1 = [ { fc } list>bytes ] [ 1 _st! 27 fc reps _shift-piece ] if ]
    if ]
  if ;

: _upper-table ( -- bytes )
  0 256 range [ dup 97 122 util:between? [ 32 - ] when ] map list>bytes ;

: _text>codes ( s:str reps:int lt:bytes ft:bytes -- bytes )
  0 _st!
  s str>bytes _upper-table translate bytes>list
  [ dup lt swap nth swap ft swap nth reps _enc-char ] map #[ ] bjoin ;

: _from-text ( s:str reps:int -- bytes )
  s reps _letter-row 255 255 util:decode-table _figure-row 255 255 util:decode-table _text>codes ;

: _dec-char ( c:int -- str )
  c 31 = [ 0 _st! "" ]
  [ c 27 = [ 1 _st! "" ]
    [ c 0 = [ "" ] [ _st 1 = [ _figure-row ] [ _letter-row ] if c nth ] if ] if ] if ;

: _to-text ( codes:bytes -- str )
  0 _st! codes bytes>list [ _dec-char ] map "" join ;

\ ---- the key streams ----

\ The cams of a pattern string as bytes: w for x and 0 for . (the pattern is already checked).
: _cams ( s:str w:int -- bytes )
  s str>bytes cam-table translate
  0 256 range [ 1 = [ w ] [ 0 ] if ] map list>bytes translate ;

\ n bytes of the endless repetition of pat, the first being pat[start] (start counted from 0).
\ util-candidate: cycle-bytes
: _cyc ( pat:bytes start:int n:int -- bytes )
  pat [ dup len start n + < ] [ dup cat ] while
  start start n + slice ;

\ Wheel i (0 to 4) of a group of five as a stream of n bytes: its cams weighted by 2^i, from its
\ start position.
: _wheel-stream ( i:int pats:list starts:list n:int -- bytes )
  pats i nth 1 i shl _cams starts i nth 1 - n _cyc ;

\ The sum of the five wheel streams of a group (chi or psi): the key, impulse 1 in bit 0.
: _group-key ( pats:list starts:list n:int -- bytes )
  0 5 range [ pats starts n _wheel-stream ] map
  dup 0 nth swap 1 5 slice swap [ bxor ] reduce ;

\ The basic motor stream. mu37 is read through weights of 32 (bit 5 of the control byte), mu61 as
\ 0 or 1. a and b are the 0-based start cells of mu61 and mu37. The motor pair repeats every
\ 61 * 37 = 2257 characters.
0 VARIABLE _ma
0 VARIABLE _mn

: _motor-step ( m61:bytes m37:bytes -- int )
  m37 _mn nth
  m61 _ma nth 0 > [ _mn 1 + 37 mod _mn! ] when
  _ma 1 + 61 mod _ma! ;

: _motor ( m61:bytes m37:bytes a:int b:int n:int -- bytes )
  a _ma! b _mn!
  0 n 2257 min range [ drop m61 m37 _motor-step ] map list>bytes
  dup len n < [ 0 n _cyc ] when ;

\ ---- the cipher loop ----

\ State of the loop: the number of psi steps made so far (the psi key is looked up there), the
\ psi1' bit of the previous character, the P5 bits of the previous two characters, and the flags
\ of the model.
0 VARIABLE _cum
0 VARIABLE _pb
0 VARIABLE _h1
0 VARIABLE _h2
0 VARIABLE _mb
0 VARIABLE _mp
0 VARIABLE _dec
#[ ] VARIABLE _pk
#[ ] VARIABLE _cc

\ Finish one character: the total motor from the control byte cc (bit 5 the basic motor, bit 6
\ chi2 one back) and the state, then the update of the state. Gives z, the character enciphered.
: _finish ( z:int pk:int d:int cc:int -- int )
  cc 6 shr 1 band
  _pb _mb band bxor
  _h2 _mp band bxor
  1 swap - cc 5 shr 1 band bor
  _cum + _cum!
  pk 1 band _pb!
  _h1 _h2!
  _dec 1 = [ z ] [ d ] if 4 shr 1 band _h1!
  z ;

: _char ( d:int cc:int -- int )
  _pk _cum nth dup d bxor cc 31 band bxor swap d cc _finish ;

\ Build the key streams for n characters and reset the state. The control byte of a character
\ holds its chi key (bits 0 to 4), the basic motor (bit 5) and chi2 one back (bit 6, always a
\ cross on SZ40 so that the limitation never stops the psi wheels).
: _prepare ( n:int pats:list starts:list model:str p5:bool dec:bool -- )
  0 _cum! 0 _pb! 0 _h1! 0 _h2!
  model "SZ42b" = [ 1 ] [ 0 ] if _mb!
  p5 [ 1 ] [ 0 ] if _mp!
  dec [ 1 ] [ 0 ] if _dec!
  pats 5 10 slice starts 5 10 slice n 1 + _group-key _pk!
  pats 0 5 slice starts 0 5 slice n _group-key
  pats 11 nth 1 _cams pats 10 nth 32 _cams starts 11 nth 1 - starts 10 nth 1 - n _motor bxor
  model "SZ40" =
  [ "x" 64 _cams 0 n _cyc ]
  [ pats 1 nth 64 _cams starts 1 nth 29 + 31 mod n _cyc ]
  if bxor _cc! ;

\ Encipher (or decipher) a list of codes. With P5 the plain text bit comes from the input when
\ enciphering and from the result when deciphering.
: _crypt ( codes:bytes pats:list starts:list model:str p5:bool dec:bool -- bytes )
  codes len 0 =
  [ codes ]
  [ codes len pats starts model p5 dec _prepare
    codes [ _cc swap nth _char ] mapi ]
  if ;

\ ---- wheel sets and the words ----

\ The published sets by name; custom is twelve empty patterns.
: pattern-sets ( -- record )
  "The wheel pattern sets by name: KH, ZMUG and BREAM (see kh-patterns) and custom, which is twelve empty strings." doc
  { { "KH" kh-patterns } { "ZMUG" zmug-patterns } { "BREAM" bream-patterns }
    { "custom" { "" "" "" "" "" "" "" "" "" "" "" "" } } } >record ;

: merge-patterns ( base:list custom:list -- list )
  "The wheels of base (a list of pattern strings), each replaced by the string of custom in the same place when that is not empty. custom has as many strings as base." doc
  0 base len range [ dup custom swap nth len 0 > [ custom swap nth ] [ base swap nth ] if ] map ;

: _wheels ( name:str custom:list -- list )
  pattern-sets name get custom merge-patterns
  dup [ len 0 = ] filter len 0 >
  [ "pattern custom needs all twelve wheel patterns (chi1 to chi5, psi1 to psi5, mu37, mu61)" raise:range ] when ;

: _lorenz ( data:str model:str p5:bool pattern:str custom:list starts:list input:str output:str shifts:str dec:bool -- str )
  p5 model "SZ40" = and [ "the P5 limitation needs the SZ42a or SZ42b model" raise:range ] when
  data input "ita2" = [ _from-bp ] [ shifts "double" = [ 2 ] [ 1 ] if _from-text ] if
  pattern custom _wheels starts model p5 dec _crypt
  output "ita2" = [ _to-bp ] [ _to-text ] if ;

: encrypt ( data:str model:choice{SZ40|SZ42a|SZ42b}=SZ42a p5:bool=false pattern:choice{KH|ZMUG|BREAM|custom}=KH input:choice{text|ita2}=text output:choice{ita2|text}=ita2 shifts:choice{auto|double}=auto chi1:str[0|41,/[x.]*/]="" chi2:str[0|31,/[x.]*/]="" chi3:str[0|29,/[x.]*/]="" chi4:str[0|26,/[x.]*/]="" chi5:str[0|23,/[x.]*/]="" psi1:str[0|43,/[x.]*/]="" psi2:str[0|47,/[x.]*/]="" psi3:str[0|51,/[x.]*/]="" psi4:str[0|53,/[x.]*/]="" psi5:str[0|59,/[x.]*/]="" mu37:str[0|37,/[x.]*/]="" mu61:str[0|61,/[x.]*/]="" chi1-start:int[1..41]=1 chi2-start:int[1..31]=1 chi3-start:int[1..29]=1 chi4-start:int[1..26]=1 chi5-start:int[1..23]=1 psi1-start:int[1..43]=1 psi2-start:int[1..47]=1 psi3-start:int[1..51]=1 psi4-start:int[1..53]=1 psi5-start:int[1..59]=1 mu37-start:int[1..37]=1 mu61-start:int[1..61]=1 -- str )
  "Encipher with the Lorenz SZ40/SZ42 cipher attachment. The plain text is ordinary text (letters, digits, some punctuation, space and line ends; shift characters are added where the case changes) or ITA2 characters in Bletchley Park notation; the result is ITA2 characters (or text). The twelve wheels take a published pattern set or custom patterns and a start position each (the cell of the wheel at the first character, from 1). The cipher is reciprocal; the P5 attachment makes the key depend on the plain text." doc
  "Cipher machines" category
  data model p5 pattern
  { chi1 chi2 chi3 chi4 chi5 psi1 psi2 psi3 psi4 psi5 mu37 mu61 }
  { chi1-start chi2-start chi3-start chi4-start chi5-start psi1-start psi2-start psi3-start psi4-start psi5-start mu37-start mu61-start }
  input output shifts false _lorenz ;

META: encrypt
  param model "SZ40: no limitation. SZ42a: limitation chi2 one back. SZ42b: chi2 and psi1' one back." ;
  param p5 "Add the P5 attachment (plain text impulse 5, two back) to the limitation: SZ42a or SZ42b only." ;
  param pattern "Published wheel patterns KH, ZMUG or BREAM, or custom (all twelve patterns below are then required)." ;
  param input "text: ordinary text. ita2: characters in Bletchley Park notation (/ for null, 3 4 5 8 9 and the letters)." ;
  param output "ita2: Bletchley Park notation. text: ordinary text, with the shift characters followed." ;
  param shifts "auto: a shift character is sent when the case changes. double: it is sent twice, as many operators did." ;
  param chi1 "Custom pattern of the chi 1 wheel, 41 characters x or . in order of use; empty keeps the published one." ;
  param chi2 "Custom pattern of the chi 2 wheel, 31 characters x or . in order of use; empty keeps the published one." ;
  param chi3 "Custom pattern of the chi 3 wheel, 29 characters x or . in order of use; empty keeps the published one." ;
  param chi4 "Custom pattern of the chi 4 wheel, 26 characters x or . in order of use; empty keeps the published one." ;
  param chi5 "Custom pattern of the chi 5 wheel, 23 characters x or . in order of use; empty keeps the published one." ;
  param psi1 "Custom pattern of the psi 1 wheel, 43 characters x or . in order of use; empty keeps the published one." ;
  param psi2 "Custom pattern of the psi 2 wheel, 47 characters x or . in order of use; empty keeps the published one." ;
  param psi3 "Custom pattern of the psi 3 wheel, 51 characters x or . in order of use; empty keeps the published one." ;
  param psi4 "Custom pattern of the psi 4 wheel, 53 characters x or . in order of use; empty keeps the published one." ;
  param psi5 "Custom pattern of the psi 5 wheel, 59 characters x or . in order of use; empty keeps the published one." ;
  param mu37 "Custom pattern of the mu37 motor wheel, 37 characters x or . in order of use; empty keeps the published one." ;
  param mu61 "Custom pattern of the mu61 motor wheel, 61 characters x or . in order of use; empty keeps the published one." ;
  param chi1-start "Cell of chi 1 at the first character, 1 to 41." ;
  param chi2-start "Cell of chi 2 at the first character, 1 to 31." ;
  param chi3-start "Cell of chi 3 at the first character, 1 to 29." ;
  param chi4-start "Cell of chi 4 at the first character, 1 to 26." ;
  param chi5-start "Cell of chi 5 at the first character, 1 to 23." ;
  param psi1-start "Cell of psi 1 at the first character, 1 to 43." ;
  param psi2-start "Cell of psi 2 at the first character, 1 to 47." ;
  param psi3-start "Cell of psi 3 at the first character, 1 to 51." ;
  param psi4-start "Cell of psi 4 at the first character, 1 to 53." ;
  param psi5-start "Cell of psi 5 at the first character, 1 to 59." ;
  param mu37-start "Cell of mu37 at the first character, 1 to 37." ;
  param mu61-start "Cell of mu61 at the first character, 1 to 61." ;
  alias tunny ;
  see-also lorenz:decrypt ;
;

: decrypt ( data:str model:choice{SZ40|SZ42a|SZ42b}=SZ42a p5:bool=false pattern:choice{KH|ZMUG|BREAM|custom}=KH input:choice{ita2|text}=ita2 output:choice{text|ita2}=text shifts:choice{auto|double}=auto chi1:str[0|41,/[x.]*/]="" chi2:str[0|31,/[x.]*/]="" chi3:str[0|29,/[x.]*/]="" chi4:str[0|26,/[x.]*/]="" chi5:str[0|23,/[x.]*/]="" psi1:str[0|43,/[x.]*/]="" psi2:str[0|47,/[x.]*/]="" psi3:str[0|51,/[x.]*/]="" psi4:str[0|53,/[x.]*/]="" psi5:str[0|59,/[x.]*/]="" mu37:str[0|37,/[x.]*/]="" mu61:str[0|61,/[x.]*/]="" chi1-start:int[1..41]=1 chi2-start:int[1..31]=1 chi3-start:int[1..29]=1 chi4-start:int[1..26]=1 chi5-start:int[1..23]=1 psi1-start:int[1..43]=1 psi2-start:int[1..47]=1 psi3-start:int[1..51]=1 psi4-start:int[1..53]=1 psi5-start:int[1..59]=1 mu37-start:int[1..37]=1 mu61-start:int[1..61]=1 -- str )
  "Decipher Lorenz SZ40/SZ42 traffic. The same machine as lorenz:encrypt; only the defaults differ (ITA2 in, text out) and, with the P5 attachment, the plain text bit that enters the limitation is taken from the result instead of the input. Without P5 the two words give the same key." doc
  "Cipher machines" category
  data model p5 pattern
  { chi1 chi2 chi3 chi4 chi5 psi1 psi2 psi3 psi4 psi5 mu37 mu61 }
  { chi1-start chi2-start chi3-start chi4-start chi5-start psi1-start psi2-start psi3-start psi4-start psi5-start mu37-start mu61-start }
  input output shifts true _lorenz ;

META: decrypt
  param model "SZ40: no limitation. SZ42a: limitation chi2 one back. SZ42b: chi2 and psi1' one back." ;
  param p5 "The message was enciphered with the P5 attachment: SZ42a or SZ42b only." ;
  param pattern "Published wheel patterns KH, ZMUG or BREAM, or custom (all twelve patterns below are then required)." ;
  param input "ita2: characters in Bletchley Park notation (/ for null, 3 4 5 8 9 and the letters). text: ordinary text." ;
  param output "text: ordinary text, with the shift characters followed. ita2: Bletchley Park notation." ;
  param shifts "Only for text input: auto sends a shift character when the case changes, double sends it twice." ;
  param chi1 "Custom pattern of the chi 1 wheel, 41 characters x or . in order of use; empty keeps the published one." ;
  param chi2 "Custom pattern of the chi 2 wheel, 31 characters x or . in order of use; empty keeps the published one." ;
  param chi3 "Custom pattern of the chi 3 wheel, 29 characters x or . in order of use; empty keeps the published one." ;
  param chi4 "Custom pattern of the chi 4 wheel, 26 characters x or . in order of use; empty keeps the published one." ;
  param chi5 "Custom pattern of the chi 5 wheel, 23 characters x or . in order of use; empty keeps the published one." ;
  param psi1 "Custom pattern of the psi 1 wheel, 43 characters x or . in order of use; empty keeps the published one." ;
  param psi2 "Custom pattern of the psi 2 wheel, 47 characters x or . in order of use; empty keeps the published one." ;
  param psi3 "Custom pattern of the psi 3 wheel, 51 characters x or . in order of use; empty keeps the published one." ;
  param psi4 "Custom pattern of the psi 4 wheel, 53 characters x or . in order of use; empty keeps the published one." ;
  param psi5 "Custom pattern of the psi 5 wheel, 59 characters x or . in order of use; empty keeps the published one." ;
  param mu37 "Custom pattern of the mu37 motor wheel, 37 characters x or . in order of use; empty keeps the published one." ;
  param mu61 "Custom pattern of the mu61 motor wheel, 61 characters x or . in order of use; empty keeps the published one." ;
  param chi1-start "Cell of chi 1 at the first character, 1 to 41." ;
  param chi2-start "Cell of chi 2 at the first character, 1 to 31." ;
  param chi3-start "Cell of chi 3 at the first character, 1 to 29." ;
  param chi4-start "Cell of chi 4 at the first character, 1 to 26." ;
  param chi5-start "Cell of chi 5 at the first character, 1 to 23." ;
  param psi1-start "Cell of psi 1 at the first character, 1 to 43." ;
  param psi2-start "Cell of psi 2 at the first character, 1 to 47." ;
  param psi3-start "Cell of psi 3 at the first character, 1 to 51." ;
  param psi4-start "Cell of psi 4 at the first character, 1 to 53." ;
  param psi5-start "Cell of psi 5 at the first character, 1 to 59." ;
  param mu37-start "Cell of mu37 at the first character, 1 to 37." ;
  param mu61-start "Cell of mu61 at the first character, 1 to 61." ;
  alias untunny ;
  see-also lorenz:encrypt ;
;
