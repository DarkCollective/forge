\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ lines: operations on text cut into lines (or into pieces at any delimiter): sort, shuffle, unique, filter, head,
\ tail, line numbers, padding, wrapping and tables. All ops take str and give str (see the Wave 5 conventions of the
\ ops README); the text is cut at the delimiter, the pieces are worked on as a list and joined again with the
\ same delimiter. The words are FL over the core words and the shared `list` words; the one place that uses a
\ pattern is the removal of line numbers and the filter, which call the `regex` words.
\
\ The words that cut the text offer the delimiter choices of the wave 5 header form without `none` (splitting at
\ nothing is not defined). `filter` is defined last because it shadows the core combinator of the same name inside
\ this vocabulary; the other words call `core:filter` anyway.
IN: lines

\ ---- sort ----

\ A parsed number is { valid numerator fraction-length }: the digits of the integer and of the fraction together make the
\ numerator, so the value is numerator / radix^fraction-length. Text that has no number is { false 0 0 }.
: _number-parts ( ints:list frac:list minus:bool -- list )
  ints len frac len + 0 >
  [ { true ints frac cat codes>str str>int minus [ neg ] when frac len } ]
  [ { false 0 0 } ]
  if ;

\ The digits after the point, as code points: nothing unless a point follows the integer digits (n1 of them).
: _frac-codes ( body:list n1:int -- list )
  body len n1 > [ body n1 nth 46 = ] [ false ] if
  [ body n1 1 + body len slice dup [ util:dec-digit? ] util:count-leading 0 swap slice ]
  [ { } ]
  if ;

: _decimal-int ( body:list n1:int minus:bool -- list )
  body 0 n1 slice
  body n1 _frac-codes dup len 1000 min 0 swap slice
  minus _number-parts ;

: _signed ( codes:list lead:int -- list )
  lead 45 = lead 43 = or
  [ codes 1 codes len slice ] [ codes ] if
  dup [ util:dec-digit? ] util:count-leading
  lead 45 = _decimal-int ;

\ The code points of a line without its leading white space.
: _start ( s:str -- list )
  s str>codes dup len 0 > [ dup 0 nth util:space? ] [ false ] if
  [ drop s [ util:space? ] util:trim-start str>codes ] when ;

: _number-start? ( c:int -- bool )
  c util:dec-digit? c 43 = or c 45 = or c 46 = or ;

\ The number at the start of a line, as parseFloat reads it: white space, a sign, digits, a point and digits. No
\ exponent. The fraction is cut at 1000 digits. Text that cannot start a number is refused at once.
: _parse-decimal-slow ( s:str -- list )
  s _start dup len 0 > [ dup 0 nth ] [ 0 ] if
  dup _number-start? [ _signed ] [ drop drop { false 0 0 } ] if ;

\ A line of the form -12.5 (a sign and digits, a point, digits) is read from its two halves: left holds the sign and
\ the integer digits, right the fraction digits.
: _point-parts ( left:str right:str s:str -- list )
  right util:digits? right len 1000 <= and
  left "-" util:starts-with? [ left 1 left len slice ] [ left ] if
  dup len 0 = swap util:digits? or and
  [ { true left right cat str>int right len } ]
  [ s _parse-decimal-slow ]
  if ;

: _parse-point ( s:str -- list )
  s "." split dup len 2 =
  [ dup 0 nth swap 1 nth s _point-parts ]
  [ drop s _parse-decimal-slow ]
  if ;

\ A line that is only digits, or a plain decimal, is read at once.
: _parse-decimal ( s:str -- list )
  s len 0 =
  [ { false 0 0 } ]
  [ s util:digits? [ { true s str>int 0 } ] [ s _parse-point ] if ]
  if ;

\ The text starts with 0x or 0X.
: _has-0x ( body:list -- bool )
  body len 1 > [ body 0 nth 48 = body 1 nth 120 = body 1 nth 88 = or and ] [ false ] if ;

: _hex-parts ( digits:list minus:bool -- list )
  digits len 0 >
  [ { true digits codes>str 16 str>int-radix minus [ neg ] when 0 } ]
  [ { false 0 0 } ]
  if ;

: _hex-body ( codes:list lead:int -- list )
  lead 45 = lead 43 = or
  [ codes 1 codes len slice ] [ codes ] if
  dup _has-0x [ dup len 2 swap slice ] when
  dup [ util:hex-digit? ] util:count-leading 0 swap slice
  lead 45 = _hex-parts ;

: _hex-start? ( c:int -- bool )
  c util:hex-digit? c 43 = or c 45 = or ;

: _parse-hex-slow ( s:str -- list )
  s _start dup len 0 > [ dup 0 nth ] [ 0 ] if
  dup _hex-start? [ _hex-body ] [ drop drop { false 0 0 } ] if ;

\ The integer at the start of a line, as parseInt(s, 16) reads it: white space, a sign, an optional 0x, hex digits.
\ A line that is only hex digits is read at once.
: _parse-hex ( s:str -- list )
  s len 0 =
  [ { false 0 0 } ]
  [ s str>bytes [ util:hex-digit? not ] core:filter len 0 =
    [ { true s 16 str>int-radix 0 } ] [ s _parse-hex-slow ] if ]
  if ;

\ The value of a valid parsed number scaled by radix^scale, as an integer.
: _scaled ( p:list radix:int scale:int -- int )
  p 1 nth radix scale p 2 nth - pow * ;

\ raw are the scaled values (0 for text with no number), parsed the parsed numbers: the key of text with no number
\ becomes lo, which is below every value.
: _fill-invalid ( raw:list parsed:list lo:int -- list )
  raw parsed zip [ dup 0 nth swap 1 nth 0 nth [ drop lo ] unless ] map ;

\ The sort keys of parsed numbers: the scaled values, and for text that parseFloat and parseInt read as NaN one less
\ than the smallest of them, so it comes first and keeps its order.
: _keys-at ( parsed:list radix:int scale:int -- list )
  parsed [ radix scale _scaled ] map
  parsed over dup 0 nth [ min ] reduce 1 - _fill-invalid ;

: _scaled-keys ( parsed:list radix:int -- list )
  parsed radix parsed 0 [ 2 nth max ] reduce _keys-at ;

: _octet ( s:str -- int )
  s len 1 3 util:between? s util:digits? and
  [ s str>int dup 255 > [ drop -1 ] when ] [ -1 ] if ;

\ The IPv4 address as one integer, or 2^32 for text that is not four decimal fields of 0 to 255.
: _ip-key ( s:str -- int )
  s "." split
  dup len 4 =
  [ [ _octet ] map dup [ 0 < ] core:filter len 0 = [ 0 [ swap 256 * + ] reduce ] [ drop 4294967296 ] if ]
  [ drop 4294967296 ]
  if ;

: _ordered ( items:list order:str -- list )
  order "alphabetical" = [ items list:sort ] [
  order "case-insensitive" = [ items items [ lower ] map list:sort-by ] [
  order "length" = [ items items [ len ] map list:sort-by ] [
  order "ip-address" = [ items list:sort dup [ _ip-key ] map list:sort-by ] [
  order "numeric" = [ items list:sort dup [ _parse-decimal ] map 10 _scaled-keys list:sort-by ]
                    [ items list:sort dup [ _parse-hex ] map 16 _scaled-keys list:sort-by ] if ] if ] if ] if ] if ;

: sort ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" reverse:bool=false order:choice{alphabetical|case-insensitive|ip-address|numeric|hexadecimal|length}="alphabetical" -- str )
  "Sort the pieces of the text (lines by default). alphabetical compares by code point, case-insensitive by the lower-case text, ip-address by the IPv4 value (text that is not four decimal fields of 0 to 255 comes after the addresses, in code point order), numeric by the number at the start of the piece (white space, a sign, digits and a fraction; no exponent; pieces with no number come first), hexadecimal by the hex number at the start (an optional 0x; pieces with none come first), and length by the number of characters. Pieces that tie on the number (or have none) are in code point order for numeric and hexadecimal, as in ip-address; for the other orders the sort is stable; reverse reverses the sorted list. The pieces are joined with the same delimiter." doc
  "Utils" category
  data delimiter util:delimiter split order _ordered
  reverse [ rev ] when
  delimiter util:delimiter join ;

META: sort
  param delimiter "What separates the pieces to sort, and joins them again." ;
  param reverse "Reverse the order after sorting." ;
  param order "How to compare the pieces." ;
  see-also lines:shuffle lines:unique ;
;

\ ---- shuffle ----

: shuffle ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Put the pieces of the text (lines by default) in a random order: a uniform random permutation (Fisher-Yates) drawn from the host's cryptographic random generator, never Math.random. The pieces are joined with the same delimiter. The output differs on every call (the word carries the +random effect)." doc
  "Utils" category
  data delimiter util:delimiter split list:shuffle delimiter util:delimiter join ;

META: shuffle
  param delimiter "What separates the pieces to shuffle, and joins them again." ;
  see-also lines:sort ;
;

\ ---- unique ----

\ The positions in a sorted list of keys where a new key starts.
: _group-starts ( skeys:list -- list )
  0 skeys len range
  [ dup 0 = [ drop true ] [ dup skeys swap nth swap 1 - skeys swap nth <> ] if ] core:filter ;

\ The texts, counts and first positions of the groups, as sorted-by-first-position texts, or "count text" lines.
: _emit ( texts:list counts:list firsts:list show-count:bool -- list )
  texts firsts list:sort-by
  counts firsts list:sort-by
  show-count [ zip [ dup 1 nth int>str " " cat swap 0 nth cat ] map ] [ drop ] if ;

\ sidx are the positions of the pieces in the order of the stable sort, skeys the sorted pieces, starts where each
\ group of equal pieces starts in them, n the number of pieces.
: _unique-groups ( sidx:list skeys:list starts:list n:int show-count:bool -- list )
  starts [ skeys swap nth ] map
  starts 1 starts len slice { n } cat starts zip [ dup 0 nth swap 1 nth - ] map
  starts [ sidx swap nth ] map
  show-count _emit ;

: _unique-from ( items:list sidx:list show-count:bool -- list )
  sidx sidx [ items swap nth ] map
  dup _group-starts
  items len show-count _unique-groups ;

: _unique ( items:list show-count:bool -- list )
  items 0 items len range items list:sort-by show-count _unique-from ;

: unique ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" show-count:bool=false -- str )
  "Remove the repeated pieces of the text (lines by default), keeping the first of each in its place. With show-count each piece is written as its count, a space and the piece, the pieces in the order of their first appearance. The pieces are joined with the same delimiter." doc
  "Utils" category
  data delimiter util:delimiter split show-count _unique delimiter util:delimiter join ;

META: unique
  param delimiter "What separates the pieces, and joins them again." ;
  param show-count "Write the number of times each piece occurs in front of it." ;
  see-also lines:sort ;
;

\ ---- head and tail ----

: head ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" number:int=10 -- str )
  "Keep the first number pieces of the text (lines by default). A negative number keeps all but the last |number| pieces. More than there are keeps them all." doc
  "Utils" category
  data delimiter util:delimiter split
  dup len
  number 0 >= [ number min ] [ number + 0 max ] if
  0 swap slice
  delimiter util:delimiter join ;

META: head
  param delimiter "What separates the pieces, and joins them again." ;
  param number "How many pieces to keep from the start; negative drops that many from the end." ;
  see-also lines:tail ;
;

: tail ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" number:int=10 -- str )
  "Keep the last number pieces of the text (lines by default). A negative number keeps all but the first |number| pieces. More than there are keeps them all; 0 keeps none." doc
  "Utils" category
  data delimiter util:delimiter split
  dup len dup
  number 0 >= [ number - 0 max ] [ number neg min ] if
  swap slice
  delimiter util:delimiter join ;

META: tail
  param delimiter "What separates the pieces, and joins them again." ;
  param number "How many pieces to keep from the end; negative drops that many from the start." ;
  see-also lines:head ;
;

\ ---- line numbers ----

: _join-numbered ( pairs:list sp:str width:int -- list )
  pairs [ dup 0 nth swap 1 nth dup len width swap - 0 max sp swap 0 swap slice swap cat " " cat swap cat ] map ;

: _numbered ( items:list nums:list width:int -- list )
  items nums zip " " width util:repeat-str width _join-numbered ;

: add-numbers ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" offset:int=0 -- str )
  "Put a line number in front of every piece of the text (lines by default): the number, right-aligned with spaces to the width of the count of pieces (the width of 10 pieces is 2, so 1 is written ' 1'), then a space. The width does not grow with the offset, as in CyberChef: a number that is wider than that is written in full. The first piece is number 1 plus the offset." doc
  "Utils" category
  data delimiter util:delimiter split
  dup 0 swap len range [ offset + 1 + int>str ] map
  over len int>str len
  _numbered
  delimiter util:delimiter join ;

META: add-numbers
  param delimiter "What separates the pieces, and joins them again." ;
  param offset "Added to every number (the first line is 1 plus the offset)." ;
  see-also lines:remove-numbers ;
;

: remove-numbers ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" -- str )
  "Remove a line number from the start of every piece of the text (lines by default): up to 5 spaces or tabs, one or more digits, then one white space character or one of : | - , . ) ] (the numbers add-numbers writes, and the usual ones of listings), as CyberChef does: only that one separator goes, so two spaces after the number leave one. A piece with digits but no separator after them is left as it is." doc
  "Utils" category
  data delimiter util:delimiter split
  [ "^[ \t]{0,5}[0-9]+[\\s:|\\-,.)\\]]" "" "" regex:replace ] map
  delimiter util:delimiter join ;

META: remove-numbers
  param delimiter "What separates the pieces, and joins them again." ;
  see-also lines:add-numbers ;
;

\ ---- pad ----

\ items with the padding text added at the start or the end.
: _pad-items ( items:list fill:str position:str -- list )
  items [ position "start" = [ fill swap cat ] [ fill cat ] if ] map ;

: pad ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" position:choice{start|end}="start" length:int[0..65536]=5 character:str[1..]=" " -- str )
  "Add length characters of padding to every piece of the text (lines by default), at the start or at the end, as CyberChef's Pad lines does: the length is how many characters are added, not the length to pad to, so every piece grows by length code points whatever its own length. A character of several code points is repeated and cut to length, as JavaScript's padStart does." doc
  "Utils" category
  data delimiter util:delimiter split
  character length character len div 1 + util:repeat-str 0 length slice
  position _pad-items
  delimiter util:delimiter join ;

META: pad
  param delimiter "What separates the pieces, and joins them again." ;
  param position "Add the padding in front of the piece (start) or behind it (end)." ;
  param length "How many characters of padding to add to every piece." ;
  param character "The padding. Several characters are repeated in order and cut to fit." ;
;

\ ---- wrap ----

: wrap ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" width:int[1..65536]=64 -- str )
  "Cut every piece of the text (lines by default) into pieces of at most width characters (code points), counting characters, not words, and put the delimiter between them. Empty pieces stay empty." doc
  "Utils" category
  data delimiter util:delimiter split
  [ dup len 0 > [ width util:str-chunks delimiter util:delimiter join ] when ] map
  delimiter util:delimiter join ;

META: wrap
  param delimiter "What separates the lines, and is put where a line is cut." ;
  param width "The most characters on a line." ;
;

\ ---- to table ----

\ The cells of one row. Without a double quote the row is cut at the cell delimiter. A cell that starts with a quote
\ runs to the quote that closes it (a doubled quote inside is one quote), so it may hold the delimiter.
: _unquote ( cur:str -- str )
  cur "\"" util:starts-with? cur "\"" util:ends-with? and cur len 2 >= and
  [ cur 1 cur len 1 - slice "\"\"" split "\"" join ] [ cur ] if ;

\ State is { cells open-text open? }.
: _quote-next ( state:list cur:str -- list )
  cur "\"" split len 1 - 2 mod 1 = cur "\"" util:starts-with? and
  [ { state 0 nth cur true } ]
  [ { state 0 nth cur _unquote append "" false } ]
  if ;

: _quote-step ( state:list piece:str cell:str -- list )
  state state 2 nth [ state 1 nth cell cat piece cat ] [ piece ] if
  _quote-next ;

: _parse-row ( row:str cell:str -- list )
  row "\"" split len 1 =
  [ row cell split ]
  [ row cell split { { } "" false } [ cell _quote-step ] reduce
    dup 2 nth [ dup 0 nth swap 1 nth append ] [ 0 nth ] if ]
  if ;

: _pad-row ( cells:list n:int -- list )
  cells n cells len - dup 0 > [ 0 swap range [ drop "" ] map cat ] [ drop ] if ;

: _col-width ( rows:list j:int -- int )
  rows [ j nth len ] map 0 [ max ] reduce ;

: _widths ( rows:list n:int least:int -- list )
  0 n range [ rows swap _col-width least max ] map ;

\ A row as text, each cell padded with sp to its width.
: _line ( cells:list widths:list sp:str -- str )
  cells widths zip [ dup 0 nth swap 1 nth over len - sp swap 0 swap slice cat ] map
  " | " join "| " swap cat " |" cat ;

: _rule ( widths:list dash:str -- str )
  widths [ 2 + dash swap 0 swap slice ] map "+" join "+" swap cat "+" cat ;

: _ascii-out ( lines:list rule:str header:bool -- str )
  header
  [ { rule lines 0 nth rule } lines 1 lines len slice cat { rule } cat ]
  [ { rule } lines cat { rule } cat ]
  if
  "\n" join "\n" cat ;

\ The box of CyberChef: a rule above, under the header row (when there is one) and below, no rule between the rows.
: _ascii ( rows:list widths:list header:bool -- str )
  rows [ widths " " widths 0 [ max ] reduce util:repeat-str _line ] map
  widths "-" widths 0 [ max ] reduce 2 + util:repeat-str _rule
  header
  _ascii-out ;

: _markdown-table ( head:list body:list widths:list sp:str dash:str -- str )
  { head widths sp _line widths [ dash swap 0 swap slice ] map widths sp _line }
  body [ widths sp _line ] map cat "\n" join ;

\ A pipe table: like CyberChef's, the first row is always the header (the dashes under it are as wide as the column).
: _markdown ( rows:list widths:list -- str )
  rows 0 nth rows 1 rows len slice widths
  " " widths 0 [ max ] reduce util:repeat-str
  "-" widths 0 [ max ] reduce util:repeat-str
  _markdown-table "\n" cat ;

: _render ( rows:list header:bool format:str n:int -- str )
  format "markdown" =
  [ rows rows n 1 _widths _markdown ]
  [ rows rows n 0 _widths header _ascii ]
  if ;

: _table-n ( rows:list header:bool format:str n:int -- str )
  rows [ n _pad-row ] map
  format "markdown" = [ [ [ "|" split "\\|" join ] map ] map ] when
  header format n _render ;

: _table ( rows:list header:bool format:str -- str )
  rows header format rows [ len ] map 0 [ max ] reduce _table-n ;

: _table-rows ( data:str row-choice:str cell:str -- list )
  data row-choice util:delimiter split
  dup len 1 > [ dup dup len 1 - nth "" = [ dup len 1 - 0 swap slice ] when ] when
  row-choice "newline" = [ [ dup "\r" util:ends-with? [ dup len 1 - 0 swap slice ] when ] map ] when
  [ cell _parse-row ] map ;

: to-table ( data:str cell-delimiter:choice{space|comma|semicolon|colon|tab}="comma" row-delimiter:choice{newline|crlf|cr}="newline" first-row-header:bool=false format:choice{ascii|markdown}="ascii" -- str )
  "Lay delimited text out as a table, in the layouts of CyberChef's To Table. The text is cut into rows at the row delimiter (a trailing empty row is dropped; with newline a carriage return before the line feed is dropped too) and each row into cells at the cell delimiter. A cell that starts with a double quote runs to the closing quote and may hold the delimiter (a doubled quote is one quote); a quoted cell cannot hold a row delimiter. Short rows are filled with empty cells (CyberChef draws them short). ascii draws a box: a rule of + and - above the rows, one under the header row when first-row-header is on and one below the last row, with | between the cells and no rule between the rows; markdown writes a pipe table whose header is always the first row, as in CyberChef (first-row-header does not change it), with the dashes under the header as wide as the column and | in cells escaped. Every line ends with a line feed. Column widths are counted in characters. An empty input gives an empty output; CyberChef's HTML format is not offered." doc
  "Utils" category
  data "" =
  [ "" ]
  [ data row-delimiter cell-delimiter util:delimiter _table-rows first-row-header format _table ]
  if ;

META: to-table
  param cell-delimiter "What separates the cells of a row." ;
  param row-delimiter "What separates the rows. newline also accepts a carriage return before the line feed." ;
  param first-row-header "ascii: draw a rule under the first row. markdown always treats the first row as the header." ;
  param format "The drawing: an ASCII box or a Markdown pipe table." ;
;

\ ---- file tree ----

\ The parts of a path: cut at the separator, and a first empty part (a leading separator) is dropped. Other empty
\ parts stay, as in CyberChef's File Tree.
: _tree-parts ( path:str separator:str -- list )
  path separator split
  dup len 0 > [ dup 0 nth "" = [ 1 over len slice ] when ] when ;

\ The line of the part at index j: the first part as it is, the others behind a bar for every level above them
\ minus one and the arrow |---.
: _tree-line ( parts:list j:int -- str )
  j 0 =
  [ parts 0 nth ]
  [ "|   " j 1 - util:repeat-str "|---" cat parts j nth cat ]
  if ;

\ For every part of a path "key line": the key is the parts up to it joined with a slash (the node of the tree), the
\ line is what is drawn for it.
: _tree-entries ( parts:list -- list )
  1 parts len 1 + range
  [ dup parts swap 0 swap slice "/" join "\0" cat swap 1 - parts swap _tree-line cat ] map ;

: file-tree ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" separator:str[1..]="/" -- str )
  "Draw a list of paths (one per line by default) as a tree, in CyberChef's style: the paths are made unique and sorted by code point, and each path writes a line for every part of it that has not been written yet. A first part is written as it is, a deeper part behind |   for every level above it minus one and the arrow |---, so a/b/c and a/d give a, |---b, |   |---c and |---d. A leading separator is ignored (one only); other empty parts are kept. There is no line for the root. The output is always cut at line feeds, whatever the delimiter. An empty input gives an empty output." doc
  "Utils" category
  data delimiter util:delimiter split list:unique list:sort
  [ separator _tree-parts _tree-entries ] map
  { } [ cat ] reduce
  list:unique
  [ "\0" split dup 1 swap len slice "\0" join ] map
  "\n" join ;

META: file-tree
  param delimiter "What separates the paths in the input." ;
  param separator "What separates the parts of a path." ;
;

\ ---- filter (last: it shadows the core combinator inside this vocabulary) ----

: filter ( data:str delimiter:choice{space|comma|semicolon|colon|newline|crlf|cr|tab}="newline" pattern:regex flags:str[0..3,/[ims]*/]="" invert:bool=false -- str )
  "Keep the pieces of the text (lines by default) where the pattern matches anywhere (an ECMAScript regular expression, always with the u flag). With invert keep the pieces where it does not match. The pieces are joined with the same delimiter. An empty pattern matches every piece." doc
  "Utils" category
  data delimiter util:delimiter split
  [ pattern flags regex:test invert <> ] core:filter
  delimiter util:delimiter join ;

META: filter
  param delimiter "What separates the pieces, and joins them again." ;
  param pattern "The regular expression to look for in each piece." ;
  param flags "Any of i (ignore case), m (multi-line), s (dot matches line breaks)." ;
  param invert "Keep the pieces that do not match instead." ;
  see-also regex:test lines:head ;
;
