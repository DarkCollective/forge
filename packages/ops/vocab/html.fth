\ html: HTML character references. The words are FL and need no primitive.
IN: html

: _special? ( cp:int -- bool )
  cp 38 = cp 60 = or cp 62 = or cp 34 = or cp 39 = or ;

: _escape? ( cp:int scope:str -- bool )
  scope "all" = cp _special? or scope "non-ascii" = cp 126 > and or ;

: _named ( cp:int -- str )
  cp 38 = [ "&amp;" ] [ cp 60 = [ "&lt;" ] [ cp 62 = [ "&gt;" ] [ cp 34 = [ "&quot;" ] [ "&apos;" ] if ] if ] if ] if ;

: _numeric ( cp:int format:str -- str )
  format "hex" = [ "&#x" cp 16 int>str-radix cat ";" cat ] [ "&#" cp int>str cat ";" cat ] if ;

: _ref ( cp:int format:str -- str )
  format "named" = cp _special? and [ cp _named ] [ cp format _numeric ] if ;

: _char-of ( cp:int scope:str format:str -- str )
  cp scope _escape? [ cp format _ref ] [ { } cp append codes>str ] if ;

: _dec-digit? ( c:int -- bool )
  c 48 >= c 57 <= and ;

: _hex-digit? ( c:int -- bool )
  c 48 >= c 57 <= and c 97 >= c 102 <= and or c 65 >= c 70 <= and or ;

: _digit-in? ( c:int radix:int -- bool )
  radix 16 = [ c _hex-digit? ] [ c _dec-digit? ] if ;

: _digits-ok? ( s:str radix:int -- bool )
  s len 0 > [ s str>codes [ radix _digit-in? ] filter len s len = ] [ false ] if ;

: _cp-of ( v:int -- int )
  v 0 = v 1114111 > or v 55296 >= v 57343 <= and or [ 65533 ] [ v ] if ;

: _ref-of ( digits:str radix:int -- str )
  digits radix _digits-ok? [ digits radix str>int-radix _cp-of { } swap append codes>str ] [ "" ] if ;

: _num-ref ( body:str -- str )
  body 1 2 slice "x" = body 1 2 slice "X" = or
  [ body 2 body len slice 16 _ref-of ] [ body 1 body len slice 10 _ref-of ] if ;

: _numeric-ref ( body:str -- str )
  body len 2 < [ "" ] [ body 0 1 slice "#" = [ body _num-ref ] [ "" ] if ] if ;

: _named-ref ( name:str -- str )
  name "amp" = [ "&" ] [ name "lt" = [ "<" ] [ name "gt" = [ ">" ] [ name "quot" = [ "\"" ] [ name "apos" = [ "'" ] [ name "nbsp" = [ { 160 } codes>str ] [ "" ] if ] if ] if ] if ] if ] if ;

: _ref-body ( body:str -- str )
  body _named-ref dup len 0 = [ drop body _numeric-ref ] when ;

: _tail ( parts:list -- str )
  parts 1 parts len slice ";" join ;

: _resolve ( parts:list -- str )
  parts len 2 < [ "&" parts ";" join cat ] [ parts 0 nth _ref-body dup len 0 = [ drop "&" parts ";" join cat ] [ parts _tail cat ] if ] if ;

: _decode-pieces ( pieces:list -- str )
  pieces 0 nth
  pieces 1 pieces len slice [ ";" split _resolve ] map "" join cat ;

: encode ( str scope:choice{minimal|non-ascii|all}=minimal format:choice{named|decimal|hex}=named -- str )
  "Escape & < > \" ' (minimal), also every code point above 0x7E (non-ascii), or every code point (all). named uses the five named entities and decimal references otherwise." doc
  "Encodings" category
  str>codes [ scope format _char-of ] map "" join ;

: decode ( str -- str )
  "Decode &#NN; and &#xHH; references and the named entities amp lt gt quot apos nbsp. Unknown or malformed references pass through; references to 0, surrogates or values above 0x10FFFF become U+FFFD." doc
  "Encodings" category
  "&" split _decode-pieces ;

META: encode
  param scope "minimal: & < > \" '. non-ascii: those plus every code point above 0x7E. all: every code point." ;
  param format "named: the five named entities, decimal references otherwise. decimal or hex: numeric references only." ;
;
