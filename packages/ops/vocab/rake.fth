\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ rake: Rapid Automatic Keyword Extraction (Rose, Engel, Cramer and Cowley, "Automatic Keyword Extraction from
\ Individual Documents", in Text Mining: Applications and Theory, Wiley 2010). The text is cut into candidate
\ phrases at the stop words and at punctuation; every word gets the score deg(w) / freq(w), where freq is how often
\ it occurs in the candidates and deg how many words it stands next to, itself included (the sum of the lengths of
\ the candidates it occurs in); a phrase scores the sum of the scores of its words. All of it is FL: the counts come
\ from list:sort, so a long text costs a number of steps linear in its words.
IN: rake

\ ---- the stop words ----

\ Forge's own list of English function words: articles, pronouns, prepositions, conjunctions, auxiliary and modal
\ verbs, and a few very common adverbs. It was written for this word, not copied from another list. A word with an
\ apostrophe is written with the ASCII apostrophe.
: _stop-words ( -- str )
  "a about above after again against all almost also although always am among an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each either else even ever every few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've if in into is isn't it it's its itself just let's may me might more most much must mustn't my myself neither no nor not of off on once only or other ought our ours ourselves out over own per rather same shall shan't she she'd she'll she's should shouldn't since so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those though through thus to too under until up upon us very via was wasn't we we'd we'll we're we've were weren't what what's when when's where where's whether which while who who's whom whose why why's will with within without won't would wouldn't yet you you'd you'll you're you've your yours yourself yourselves" ;

\ ---- helpers ----

\ The text of every match of the pattern, in order.
: _texts ( text:str pattern:str -- list )
  text pattern "" regex:find-all [ "text" get ] map ;

\ A word: letters, digits and marks, with ' or - between pieces. Every other character that is not white space is a
\ token of its own (punctuation).
: _token-pattern ( -- str )
  "[\\p{L}\\p{N}\\p{M}]+(?:['\\-][\\p{L}\\p{N}\\p{M}]+)*|[^\\s\\p{L}\\p{N}\\p{M}]" ;

: _word? ( t:str -- bool )
  t "^[\\p{L}\\p{N}\\p{M}]" "" regex:test ;

\ For each token: is it a break (punctuation or a stop word)? table has every token as a key.
: _flags ( tokens:list table:record -- list )
  tokens [ dup _word? [ table swap get ] [ drop true ] if ] map ;

: _breaks ( tokens:list stops:list -- list )
  tokens tokens [ drop false ] map zip
  stops stops [ drop true ] map zip cat >record
  tokens swap _flags ;

\ The candidate phrases, in order: runs of words with no break between, each word separated by one space.
: _phrases ( tokens:list stops:list -- list )
  tokens stops _breaks
  tokens swap zip
  [ dup 1 nth [ drop "|" ] [ 0 nth ] if ] map
  " " join
  "[^|\\s](?:[^|]*[^|\\s])?" _texts ;

\ s written n times, separated by spaces.
: _times ( s:str n:int -- str )
  0 n range [ drop s ] map " " join ;

\ ---- counting runs of a sorted list ----

\ Is position i of the sorted list the start of a run of equal items?
: _new? ( i:int s:list -- bool )
  i 0 =
  [ true ]
  [ s i nth s i 1 - nth <> ]
  if ;

: _starts ( sorted:list -- list )
  0 sorted len range [ sorted _new? ] filter ;

\ The item at each start.
: _heads ( sorted:list starts:list -- list )
  starts [ sorted swap nth ] map ;

\ The length of each run: the next start (or n) minus the start.
: _lengths ( starts:list n:int -- list )
  starts 1 starts len slice { n } cat
  starts zip [ dup 0 nth swap 1 nth - ] map ;

\ ---- scores ----

\ The distinct items of a sorted list and the length of the run of each.
: _runs ( sorted:list -- list list )
  sorted _starts
  dup sorted swap _heads
  swap sorted len _lengths ;

\ deg(w) / freq(w) for every distinct word of the candidate phrases, as a record word -> score. The words are all
\ the words of the candidates (their count is freq); the degree words have each candidate written once for every
\ word it holds, so that a word is counted once per word it stands with, itself included (their count is deg).
: _word-scores ( phrases:list -- record )
  phrases " " join " " split list:sort _runs
  phrases [ dup " " split len _times ] map " " join " " split list:sort _runs
  nip swap
  zip [ dup 0 nth swap 1 nth / ] map
  zip >record ;

\ The score of each distinct phrase: the sum of the scores of its words.
: _phrase-scores ( uniq:list table:record -- list )
  uniq [ " " split [ table swap get ] map 0.0 [ + ] reduce ] map ;

\ { phrase score } pairs, highest score first; equal scores stay in the (alphabetical) order of uniq.
: _zip-ordered ( uniq:list scores:list keys:list -- list )
  uniq keys list:sort-by
  scores keys list:sort-by
  zip ;

: _pad2 ( n:int -- str )
  n 10 < [ "0" n int>str cat ] [ n int>str ] if ;

\ A score with two decimals (rounded half away from zero).
: _fmt ( x:num -- str )
  x 100 * round
  dup 100 div int>str "." cat swap 100 mod _pad2 cat ;

: _line ( pair:list -- str )
  pair 1 nth _fmt ": " cat pair 0 nth cat ;

: _ranked ( phrases:list -- list )
  phrases list:sort
  dup _starts _heads
  dup phrases _word-scores _phrase-scores
  dup [ neg ] map
  _zip-ordered
  [ _line ] map ;

: _take ( lines:list limit:int -- list )
  limit 0 =
  [ lines ]
  [ lines 0 limit lines len min slice ]
  if ;

: keywords ( data:str max-words:int[1..30]=3 stop-words:str="" limit:int[0..]=0 -- str )
  "The key phrases of a text by RAKE (Rapid Automatic Keyword Extraction, Rose et al. 2010), one per line as the score, a colon, a space and the phrase in lower case, the highest score first (equal scores in alphabetical order). The text is cut into candidate phrases at punctuation and at stop words; the words of a candidate are those with letters, digits and marks, with an apostrophe or hyphen inside (don't, state-of-the-art). A word scores its degree divided by its frequency, the degree being the sum of the lengths of the candidates it occurs in; a phrase scores the sum of its words, shown with two decimals. Candidates of more than max-words words are dropped before the counting (3 is the usual value). stop-words is a list of words separated by white space or commas that replaces the built-in list of English function words; leave it empty for the built-in list. limit keeps only that many phrases, 0 keeps them all. A text with no candidate gives an empty output. The text is read as UTF-8." doc
  "Extractors" category
  data lower "\u{2019}" split "'" join _token-pattern _texts
  stop-words lower "[^\\s,]+" _texts
  dup len 0 = [ drop _stop-words "[^\\s,]+" _texts ] when
  _phrases
  [ " " split len max-words <= ] filter
  dup len 0 =
  [ drop "" ]
  [ _ranked limit _take "\n" join ]
  if ;

META: keywords
  param max-words "The longest phrase to keep, in words (1 to 30)." ;
  param stop-words "Words that end a phrase, separated by white space or commas. Empty uses the built-in English list." ;
  param limit "How many phrases to output (0 for all of them)." ;
  see-also analysis:frequency extract:strings ;
;
