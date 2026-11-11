\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ diff: the differences between two samples of text, as plain text. The edit script is the one private primitive
\ _edits (src/prims/diff.ts: Myers' O(ND) difference in linear space, which FL cannot run at 64 KiB because it has no
\ mutable arrays); the tokens, the keys, the hunks and the text are FL.
\
\ A run is { kind a-start b-start length }: kind 0 equal, 1 deleted from the first sample, 2 inserted from the second.
IN: diff

\ ---- tokens ----

\ The lines of a sample: the text cut at line feeds, where a final line feed ends the last line (it does not start
\ another) and the empty text has no lines.
: _sample-lines ( s:str -- list )
  s len 0 =
  [ { } ]
  [ s "\n" util:ends-with? [ s 0 s len 1 - slice ] [ s ] if "\n" split ]
  if ;

\ The words of a sample: runs of white space (ASCII, as util:space? has it) and runs of anything else, in order, so
\ joining them gives the text back.
: _words ( s:str -- list )
  s "[\t-\r ]+|[^\t-\r ]+" "" util:match-texts ;

: _tokens ( s:str by:str -- list )
  by "line" = [ s _sample-lines ] [ by "word" = [ s _words ] [ s str>codes [ util:cp>str ] map ] if ] if ;

\ What tokens are compared by: the tokens themselves, or with ignore, a line without its white space and a word or
\ character that is white space as the empty text (all white space is equal).
: _keys ( toks:list by:str ignore:bool -- list )
  ignore not
  [ toks ]
  [ by "line" = [ toks [ util:strip-space ] map ] [ toks [ dup str>codes 0 nth util:space? [ drop "" ] when ] map ] if ]
  if ;

\ ---- unified text for lines ----

: _changed? ( runs:list -- bool )
  runs [ 0 nth 0 <> ] core:filter len 0 > ;

\ The last ctx lines of an equal run, and its first ctx lines.
: _ctx-tail ( run:list ctx:int -- list )
  { 0 run 1 nth run 3 nth + ctx - run 2 nth run 3 nth + ctx - ctx } ;

: _ctx-head ( run:list ctx:int -- list )
  { 0 run 1 nth run 2 nth ctx } ;

\ The equal run at the start of the script keeps only its last ctx lines, the one at the end its first ctx lines.
: _clip-run ( run:list i:int n:int ctx:int -- list )
  run 0 nth 0 =
  [ i 0 =
    [ run 3 nth ctx > [ run ctx _ctx-tail ] [ run ] if ]
    [ i n 1 - = [ run 3 nth ctx > [ run ctx _ctx-head ] [ run ] if ] [ run ] if ]
    if ]
  [ run ]
  if ;

\ The places in the script of equal runs, not at an end, that are longer than twice the context: the hunks lie between.
: _gaps ( runs:list ctx:int -- list )
  1 runs len 1 - range
  [ dup runs swap nth dup 0 nth 0 = swap 3 nth ctx 2 * > and nip ] core:filter ;

\ The runs of hunk h: its own part of the script, the end of the gap before it and the start of the gap after it.
: _hunk-runs ( runs:list gaps:list h:int ctx:int -- list )
  h 0 > [ { runs gaps h 1 - nth nth ctx _ctx-tail } ] [ { } ] if
  runs h 0 = [ 0 ] [ gaps h 1 - nth 1 + ] if h gaps len = [ runs len ] [ gaps h nth ] if slice cat
  h gaps len < [ { runs gaps h nth nth ctx _ctx-head } ] [ { } ] if cat
  [ 3 nth 0 > ] core:filter ;

\ The lines covered, counting every run that is not of the kind skip.
: _span ( runs:list skip:int -- int )
  runs [ dup 0 nth skip = [ drop 0 ] [ 3 nth ] if ] map 0 [ + ] reduce ;

\ A range of a hunk header: the first line number (the line before when the range is empty) and the count unless 1.
: _range ( s:int count:int -- str )
  count 0 = [ s ] [ s 1 + ] if int>str
  count 1 <> [ "," count int>str cat cat ] when ;

\ The lines of a run, each behind the sign.
: _block ( run:list a:list b:list -- str )
  run 0 nth 0 = [ a run 1 nth run 1 nth run 3 nth + slice "\n " join " " swap cat ] [
  run 0 nth 1 = [ a run 1 nth run 1 nth run 3 nth + slice "\n-" join "-" swap cat ]
                 [ b run 2 nth run 2 nth run 3 nth + slice "\n+" join "+" swap cat ] if ] if ;

: _hunk-text ( hr:list a:list b:list -- str )
  "@@ -" hr 0 nth 1 nth hr 2 _span _range cat
  " +" cat hr 0 nth 2 nth hr 1 _span _range cat " @@" cat
  hr [ a b _block ] map "\n" join
  "\n" swap cat cat ;

: _unified-hunks ( a:list b:list cl:list gaps:list ctx:int -- str )
  0 gaps len 1 + range [ cl gaps rot ctx _hunk-runs a b _hunk-text ] map "\n" join
  "--- sample 1\n+++ sample 2\n" swap cat ;

: _unified-clipped ( a:list b:list cl:list ctx:int -- str )
  a b cl cl ctx _gaps ctx _unified-hunks ;

: _unified ( a:list b:list runs:list ctx:int -- str )
  runs _changed?
  [ a b runs [ runs len ctx _clip-run ] mapi ctx _unified-clipped ]
  [ "" ]
  if ;

\ ---- inline text for words and characters ----

: _piece ( run:list a:list b:list -- str )
  run 0 nth 0 = [ a run 1 nth run 1 nth run 3 nth + slice "" join ] [
  run 0 nth 1 = [ "[-" a run 1 nth run 1 nth run 3 nth + slice "" join cat "-]" cat ]
                 [ "{+" b run 2 nth run 2 nth run 3 nth + slice "" join cat "+}" cat ] if ] if ;

: _inline ( a:list b:list runs:list -- str )
  runs [ a b _piece ] map "" join ;

: _diff-samples ( a:str b:str by:str ignore:bool context:int -- str )
  a by _tokens b by _tokens
  over by ignore _keys over by ignore _keys
  _edits
  by "line" = [ context _unified ] [ _inline ] if ;

: compare ( data:str sample-delimiter:str[1..]="\n\n" by:choice{line|word|character}="line" ignore-whitespace:bool=false context:int[0..1000]=3 -- str )
  "Compare two samples of text, written one after the other in the input and cut apart at the sample delimiter (exactly two samples, else E_COERCE). by line gives a unified-style text: the header --- sample 1 and +++ sample 2, then hunks, each @@ -first,count +first,count @@ and its lines behind a space (kept), - (only in sample 1) or + (only in sample 2), with context lines around the changes; samples that do not differ give the empty text. A final line feed ends the last line. by word and by character give the second sample's text with the changes marked in line, [-deleted-] and {+inserted+}, with no context (words are runs of white space and runs of anything else, so the text reads as it was). With ignore-whitespace, lines are compared without their white space and for words and characters all white space is equal; the text shown for a kept part is the first sample's. The difference is a shortest one (Myers); on very different inputs the search stops after 60 million steps and the rest is reported as one deletion and one insertion." doc
  "Utils" category
  data sample-delimiter split
  dup len 2 <> [ "the input must hold exactly two samples separated by the sample delimiter" raise:coerce ] when
  dup 0 nth swap 1 nth
  by ignore-whitespace context _diff-samples ;

META: compare
  param sample-delimiter "The text that separates the two samples in the input." ;
  param by "Compare lines, words or single characters." ;
  param ignore-whitespace "Treat differences in white space as no difference." ;
  param context "For lines: how many unchanged lines to show around each change." ;
  see-also lines:sort ;
;
