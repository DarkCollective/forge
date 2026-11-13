\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lorem: placeholder text, "Lorem ipsum", over the shared `random` vocabulary (host CSPRNG, +random). The word list is
\ Forge's own: the 182 distinct words of the two passages of Cicero's De finibus bonorum et malorum (45 BC), book 1,
\ sections 32 and 33 ("Sed ut perspiciatis ..." and "At vero eos ..."), the public-domain Latin that the classic
\ Lorem ipsum text was cut from, sorted. A sentence has 5 to 14 words, the first with a capital, an optional comma,
\ and a full stop; a paragraph has 3 to 8 sentences. The traditional opening sentence (not from the list) can start
\ the text. The output is random, so it has no fixed vectors except the opening.
IN: lorem

USING: random ;

: _list ( -- list )
  "a ab accusamus accusantium ad adipisci alias aliquam aliquid amet animi aperiam architecto
asperiores aspernatur assumenda at atque aut autem beatae blanditiis commodi consectetur consequatur
consequuntur corporis corrupti culpa cum cumque cupiditate debitis delectus deleniti deserunt dicta
dignissimos distinctio dolor dolore dolorem doloremque dolores doloribus dolorum ducimus ea eaque
earum eius eligendi enim eos error esse est et eum eveniet ex excepturi exercitationem expedita
explicabo facere facilis fuga fugiat fugit harum hic id illo illum impedit in incidunt inventore
ipsa ipsam ipsum iste itaque iure iusto labore laboriosam laborum laudantium libero magnam magni
maiores maxime minima minus modi molestiae molestias mollitia nam natus necessitatibus nemo neque
nesciunt nihil nisi nobis non nostrum nulla numquam occaecati odio odit officia officiis omnis optio
pariatur perferendis perspiciatis placeat porro possimus praesentium provident quae quaerat quam
quas quasi qui quia quibusdam quidem quis quisquam quo quod quos ratione recusandae reiciendis rem
repellat repellendus reprehenderit repudiandae rerum saepe sapiente sed sequi similique sint sit
soluta sunt suscipit tempora tempore temporibus tenetur totam ullam unde ut vel velit veniam
veritatis vero vitae voluptas voluptate voluptatem voluptates voluptatibus voluptatum" "\n" split " " join " " split ;

\ The traditional first sentence (it is not made from the list: lorem, adipiscing and elit are not in Cicero's text).
: _opening ( -- str )
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit." ;

: _opening-words ( -- list )
  "lorem ipsum dolor sit amet consectetur adipiscing elit" " " split ;

: _pick ( words:list -- str )
  words words len random:below nth ;

: _cap ( s:str -- str )
  s 0 1 slice upper s 1 s len slice cat ;

\ n random words.
: _some ( words:list n:int -- list )
  0 n range [ drop words _pick ] map ;

\ The word at index p followed by a comma.
: _comma ( ws:list p:int -- list )
  ws [ p = [ "," cat ] [ ] if ] mapi ;

\ A sentence of 5 to 14 words; one in two of those with 8 words or more has a comma after a word from the third to the
\ third from last.
: _sentence ( words:list -- str )
  words 5 14 random:between _some
  dup len 8 >= 0 1 random:between 1 = and
  [ dup len 3 - 2 swap random:between _comma ] when
  " " join _cap "." cat ;

\ A paragraph of 3 to 8 sentences; the first one is the opening when first is true.
: _paragraph ( words:list first:bool -- str )
  0 3 8 random:between range [ 0 = first and [ _opening ] [ words _sentence ] if ] map " " join ;

: _paragraphs ( words:list n:int opening:bool -- str )
  0 n range [ 0 = opening and words swap _paragraph ] map "\n\n" join ;

: _sentences ( words:list n:int opening:bool -- str )
  0 n range [ 0 = opening and [ _opening ] [ words _sentence ] if ] map " " join ;

\ n words in lower case, space-separated, without punctuation; the first has a capital. The opening supplies the first
\ eight.
: _words ( words:list n:int opening:bool -- str )
  0 n range [ dup 8 < opening and [ _opening-words swap nth ] [ drop words _pick ] if ] map " " join _cap ;

\ The first n characters of running text (sentences with spaces between).
: _bytes ( words:list n:int opening:bool -- str )
  opening [ _opening ] [ words _sentence ] if
  [ dup len n < ] [ " " cat words _sentence cat ] while
  0 n slice ;

: _check ( length:int unit:str -- )
  unit "paragraphs" = length 500 > and [ "at most 500 paragraphs" raise:range ] when
  unit "sentences" = length 5000 > and [ "at most 5,000 sentences" raise:range ] when ;

: generate ( bytes length:int[1..65536]=3 unit:choice{paragraphs|sentences|words|bytes}="paragraphs" opening:bool=true -- str )
  "Placeholder text, Lorem ipsum: length paragraphs (at most 500; 3 to 8 sentences each, separated by a blank line), sentences (at most 5,000), words (at most 65,536; lower case, space-separated, no punctuation, the first with a capital) or bytes (at most 65,536; running text cut to exactly that many bytes, all of it ASCII). The words are Latin from Cicero's De finibus, chosen at random from the host's cryptographic random generator (never Math.random), so the output differs on every call (the word carries the +random effect). With opening true the text starts with the traditional Lorem ipsum dolor sit amet, consectetur adipiscing elit., which is the one fixed part of the output. The input is ignored." doc
  "Generators" category
  drop
  length unit _check
  unit "paragraphs" = [ _list length opening _paragraphs ] [
  unit "sentences" = [ _list length opening _sentences ] [
  unit "words" = [ _list length opening _words ] [
  _list length opening _bytes
  ] if ] if ] if ;

META: generate
  use-when "You need placeholder text of a set length, in paragraphs, sentences, words or bytes, to fill a layout or a test." ;
  link "https://en.wikipedia.org/wiki/Lorem_ipsum" "Lorem ipsum on Wikipedia" ;
  param length "How many paragraphs, sentences, words or bytes." ;
  param unit "paragraphs, sentences, words or bytes: what length counts." ;
  param opening "Start with the traditional Lorem ipsum dolor sit amet, consectetur adipiscing elit." ;
  see-also prng:bytes ;
;
