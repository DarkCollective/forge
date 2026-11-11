\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ datetime: dates and times as text. No date library: the calendar maths, the moment.js-style format tokens (the
\ formatter and the forgiving parser) are FL over exact integers; the only host help is the time zone rules
\ (src/prims/datetime.ts: _zone-offset, _zone-abbr and _zones, over Intl).
\
\ An instant is an integer count of nanoseconds since 1970-01-01T00:00:00Z (FL integers are exact and any size).
\ A zone is "UTC" (also "Z"), a fixed offset such as "+09:00", "+0530" or "-05", or an IANA name such as
\ "Asia/Tokyo" (the host's Intl rules; an unknown name is E_RANGE). The wall clock of a zone is the instant plus
\ the zone's offset. Everything is proleptic Gregorian.
\
\ Format tokens (English, as in moment.js): YYYY YY Y YYYYY YYYYYY, Q Qo, M Mo MM MMM MMMM, D Do DD DDD DDDo DDDD,
\ d do dd ddd dddd, E e, W Wo WW (ISO week), w wo ww (week of the year, Sunday first, the week with 1 January is
\ week 1), GGGG GG GGGGG (ISO week-year), gggg gg ggggg (week-year), H HH h hh k kk, m mm, s ss, S to SSSSSSSSS
\ (fraction of the second, truncated, nine digits are exact), a A, Z ZZ (offset), z zz (zone abbreviation, from the
\ host), X x (Unix seconds, milliseconds), [text] (literal), and the long dates LT LTS L LL LLL LLLL l ll lll llll.
\ Any other character is copied.
IN: datetime

\ ---- calendar maths (days since 1970-01-01, proleptic Gregorian) ----

\ Days from civil, once the year is counted from 1 March (Hinnant's algorithm).
: _days-adj ( y:int m:int d:int -- int )
  y 400 div 146097 *
  y 400 mod dup 365 * over 4 div + swap 100 div -
  +
  m 9 + 12 mod 153 * 2 + 5 div d + 1 - +
  719468 - ;

\ Days since 1970-01-01 of year y, month m (1 to 12), day d (the day may run past the month).
: _days ( y:int m:int d:int -- int )
  y m 2 <= [ 1 ] [ 0 ] if - m d _days-adj ;

: _civil-mp ( mp:int doy:int y:int -- list )
  { y mp 10 >= [ 1 ] [ 0 ] if +
    mp 10 < [ mp 3 + ] [ mp 9 - ] if
    doy mp 153 * 2 + 5 div - 1 + } ;

: _civil-doy ( doy:int y:int -- list )
  doy 5 * 2 + 153 div doy y _civil-mp ;

: _civil-yoe ( yoe:int era:int doe:int -- list )
  doe yoe 365 * yoe 4 div + yoe 100 div - -
  yoe era 400 * + _civil-doy ;

: _civil-era ( era:int doe:int -- list )
  doe doe 1460 div - doe 36524 div + doe 146096 div - 365 div
  era doe _civil-yoe ;

\ { year month day } of a day count (days since 1970-01-01).
: _civil ( z:int -- list )
  z 719468 + dup 146097 div swap 146097 mod _civil-era ;

: _leap? ( y:int -- bool )
  y 4 mod 0 = y 100 mod 0 <> y 400 mod 0 = or and ;

: _diy ( y:int -- int )
  y _leap? [ 366 ] [ 365 ] if ;

: _dim ( y:int m:int -- int )
  m 2 = [ y _leap? [ 29 ] [ 28 ] if ] [ { 31 28 31 30 31 30 31 31 30 31 30 31 } m 1 - nth ] if ;

\ Day of the week of a day count: 0 is Sunday (1970-01-01 was a Thursday).
: _dow-days ( z:int -- int )
  z 4 + 7 mod ;

\ ---- weeks (moment.js rules: a week starts on day fdow, and week 1 holds day fdoy of January) ----

: _fwo2 ( fwd:int year:int fdow:int -- int )
  7 year 1 fwd _days _dow-days + fdow - 7 mod
  neg fwd + 1 - ;

\ The offset of the first day of week 1 from 1 January.
: _fwo ( year:int fdow:int fdoy:int -- int )
  7 fdow + fdoy - year fdow _fwo2 ;

: _wiy ( y:int fdow:int fdoy:int -- int )
  y _diy y fdow fdoy _fwo - y 1 + fdow fdoy _fwo + 7 div ;

: _week-fix ( week:int y:int fdow:int fdoy:int -- list )
  week 1 <
  [ { week y 1 - fdow fdoy _wiy + y 1 - } ]
  [ week y fdow fdoy _wiy >
    [ { week y fdow fdoy _wiy - y 1 + } ]
    [ { week y } ] if ] if ;

\ { week week-year } of day-of-year doy in year y.
: _week-of ( y:int doy:int fdow:int fdoy:int -- list )
  doy y fdow fdoy _fwo - 1 - 7 div 1 + y fdow fdoy _week-fix ;

: _fix-doy ( raw:int year:int -- list )
  raw 0 <=
  [ { year 1 - year 1 - _diy raw + } ]
  [ raw year _diy >
    [ { year 1 + raw year _diy - } ]
    [ { year raw } ] if ] if ;

\ { year day-of-year } of week `week` of week-year `year`, day `weekday` (0 Sunday to 6, 7 is Sunday too).
: _from-weeks ( year:int week:int weekday:int fdow:int fdoy:int -- list )
  1 week 1 - 7 * +
  7 weekday + fdow - 7 mod +
  year fdow fdoy _fwo +
  year _fix-doy ;

\ ---- time zones ----

: _utc? ( zone:str -- bool )
  zone "UTC" = zone "Z" = or zone "utc" = or ;

: _fixed? ( zone:str -- bool )
  zone "^[+-]\\d\\d(?::?\\d\\d)?$" "" regex:test ;

\ Seconds east of UTC of a fixed-offset zone name (+HH, +HHMM or +HH:MM; up to 23:59).
: _fixed-offset ( zone:str -- int )
  zone ":" "" "" regex:replace
  dup 1 3 slice str>int dup 23 > [ "a fixed offset is at most 23:59" raise:range ] when 3600 *
  over len 3 > [ over 3 5 slice str>int dup 59 > [ "a fixed offset is at most 23:59" raise:range ] when 60 * + ] when
  swap 0 nth "-" = [ neg ] when ;

: _fixed-abbr ( zone:str -- str )
  zone ":" "" "" regex:replace
  dup len 3 > [ dup 3 5 slice "00" = [ 0 3 slice ] when ] when ;

\ Seconds east of UTC of a zone at the instant ms (Unix milliseconds).
: _offset ( zone:str ms:int -- int )
  zone _utc? [ 0 ]
  [ zone _fixed? [ zone _fixed-offset ] [ zone ms _zone-offset ] if ] if ;

: _abbr ( zone:str ms:int -- str )
  zone _utc? [ "UTC" ]
  [ zone _fixed? [ zone _fixed-abbr ] [ zone ms _zone-abbr ] if ] if ;

\ A candidate instant is right when the zone's offset at that instant is the offset it was computed with.
: _valid? ( cand:int zone:str off:int -- bool )
  zone cand 1000000 div _offset off = ;

: _pick3 ( ca:int cb:int va:bool vb:bool -- int )
  va vb and [ ca cb min ] [ vb [ cb ] [ ca ] if ] if ;

: _pick2 ( ca:int cb:int zone:str a:int b:int -- int )
  ca cb ca zone a _valid? cb zone b _valid? _pick3 ;

: _l2i ( local:int zone:str a:int b:int -- int )
  a b =
  [ local a 1000000000 * - ]
  [ local a 1000000000 * - local b 1000000000 * - zone a b _pick2 ] if ;

\ The instant (ns) of a wall-clock reading (local, ns as if UTC) in a zone. A time that occurs twice (the clocks
\ go back) is the first of the two; a time that does not exist (the clocks go forward) is moved forward by the gap.
: _local>instant ( local:int zone:str -- int )
  local zone
  zone local 1000000 div 86400000 - _offset
  zone local 1000000 div 86400000 + _offset
  _l2i ;

\ ---- the fields of an instant ----

: _fields-ymd ( ns:int zone:str off:int loc:int ymd:list -- record )
  { { "ns" ns }
    { "zone" zone }
    { "off" off }
    { "y" ymd 0 nth }
    { "mo" ymd 1 nth }
    { "d" ymd 2 nth }
    { "h" loc 86400000000000 mod 3600000000000 div }
    { "mi" loc 3600000000000 mod 60000000000 div }
    { "s" loc 60000000000 mod 1000000000 div }
    { "frac" loc 1000000000 mod }
    { "dow" loc 86400000000000 div _dow-days }
    { "doy" loc 86400000000000 div ymd 0 nth 1 1 _days - 1 + } }
  >record ;

: _fields-local ( ns:int zone:str off:int loc:int -- record )
  ns zone off loc loc 86400000000000 div _civil _fields-ymd ;

\ The record of the calendar and clock fields of the instant ns (nanoseconds since the epoch) as seen in a zone.
: _fields ( ns:int zone:str -- record )
  ns zone zone ns 1000000 div _offset dup 1000000000 * ns + _fields-local ;

\ ---- names ----

: _months ( -- list )
  { "January" "February" "March" "April" "May" "June" "July" "August" "September" "October" "November" "December" } ;

: _weekdays ( -- list )
  { "Sunday" "Monday" "Tuesday" "Wednesday" "Thursday" "Friday" "Saturday" } ;

\ ---- formatting ----

\ n (not negative) written with at least w digits (w up to 9).
\ util-candidate: zero-pad
: _zpad ( n:int w:int -- str )
  "000000000" 0 w n int>str len - 0 max slice n int>str cat ;

\ util-candidate: ordinal-suffix
: _ord-suffix ( n:int -- str )
  n 100 mod dup 11 >= swap 13 <= and
  [ "th" ]
  [ n 10 mod dup 1 = [ drop "st" ] [ dup 2 = [ drop "nd" ] [ 3 = [ "rd" ] [ "th" ] if ] if ] if ] if ;

: _ord ( n:int -- str )
  n int>str n _ord-suffix cat ;

\ A year with a minus sign when negative and at least w digits.
: _year ( y:int w:int -- str )
  y 0 < [ "-" ] [ "" ] if y abs w _zpad cat ;

\ "+" or "-" and the digits of the offset (seconds east of UTC), with or without a colon.
: _off-str ( off:int colon:bool -- str )
  off 0 < [ "-" ] [ "+" ] if
  off abs 3600 div 2 _zpad cat
  colon [ ":" ] [ "" ] if cat
  off abs 60 div 60 mod 2 _zpad cat ;

: _hour12 ( h:int -- int )
  h 12 mod dup 0 = [ drop 12 ] when ;

: _quarter ( f:record -- int )
  f "mo" get 1 - 3 div 1 + ;

: _iso-dow ( f:record -- int )
  f "dow" get dup 0 = [ drop 7 ] when ;

\ { week week-year } of the record's date: the ISO week (fdow 1, fdoy 4) or the locale week (0 and 6).
: _fweek ( f:record fdow:int fdoy:int -- list )
  f "y" get f "doy" get fdow fdoy _week-of ;

\ True for an ordinal token (Mo, Do, DDDo, do, Qo, Wo, wo).
: _tok-ordinal? ( tok:str -- bool )
  tok len 1 > tok tok len 1 - nth "o" = and ;

: _fmt-y ( tok:str f:record -- str )
  tok len 2 =
  [ f "y" get 100 mod 2 _zpad ]
  [ tok len 4 <=
    [ f "y" get 9999 > [ "+" f "y" get int>str cat ] [ tok len 1 = [ f "y" get int>str ] [ f "y" get 4 _year ] if ] if ]
    [ f "y" get 0 < [ "-" ] [ "+" ] if f "y" get abs tok len _zpad cat ] if ] if ;

: _fmt-m ( tok:str f:record -- str )
  tok "M" = [ f "mo" get int>str ] [
  tok "MM" = [ f "mo" get 2 _zpad ] [
  tok "Mo" = [ f "mo" get _ord ] [
  tok "MMM" = [ _months f "mo" get 1 - nth 0 3 slice ] [
  _months f "mo" get 1 - nth ] if ] if ] if ] if ;

: _fmt-d ( tok:str f:record -- str )
  tok "D" = [ f "d" get int>str ] [
  tok "DD" = [ f "d" get 2 _zpad ] [
  tok "Do" = [ f "d" get _ord ] [
  tok "DDD" = [ f "doy" get int>str ] [
  tok "DDDo" = [ f "doy" get _ord ] [
  f "doy" get 3 _zpad ] if ] if ] if ] if ] if ;

: _fmt-wd ( tok:str f:record -- str )
  tok "d" = [ f "dow" get int>str ] [
  tok "do" = [ f "dow" get _ord ] [
  tok "dd" = [ _weekdays f "dow" get nth 0 2 slice ] [
  tok "ddd" = [ _weekdays f "dow" get nth 0 3 slice ] [
  _weekdays f "dow" get nth ] if ] if ] if ] if ;

\ ISO week (W) or locale week (w) of the year.
: _fmt-week ( tok:str f:record fdow:int fdoy:int -- str )
  f fdow fdoy _fweek 0 nth
  tok _tok-ordinal? [ _ord ] [ tok len 2 = [ 2 _zpad ] [ int>str ] if ] if ;

\ Week-year: GG gg (two digits), GGGG gggg (four), GGGGG ggggg (five, with a sign).
: _fmt-wyear ( tok:str f:record fdow:int fdoy:int -- str )
  f fdow fdoy _fweek 1 nth
  tok len 2 = [ 100 mod 2 _zpad ] [ tok len 4 = [ 4 _year ] [ dup 0 < [ "-" ] [ "+" ] if swap abs 5 _zpad cat ] if ] if ;

: _fmt-h ( tok:str f:record -- str )
  tok "H" = [ f "h" get int>str ] [
  tok "HH" = [ f "h" get 2 _zpad ] [
  tok "h" = [ f "h" get _hour12 int>str ] [
  tok "hh" = [ f "h" get _hour12 2 _zpad ] [
  tok "k" = [ f "h" get dup 0 = [ drop 24 ] when int>str ] [
  f "h" get dup 0 = [ drop 24 ] when 2 _zpad ] if ] if ] if ] if ] if ;

: _fmt-z ( tok:str f:record -- str )
  tok "Z" = [ f "off" get true _off-str ] [
  tok "ZZ" = [ f "off" get false _off-str ] [
  f "zone" get f "ns" get 1000000 div _abbr ] if ] if ;

: _fmt-by ( c:str tok:str f:record -- str )
  c "Y" = [ tok f _fmt-y ] [
  c "M" = [ tok f _fmt-m ] [
  c "D" = [ tok f _fmt-d ] [
  c "H" = c "h" = or c "k" = or [ tok f _fmt-h ] [
  c "m" = [ tok "m" = [ f "mi" get int>str ] [ f "mi" get 2 _zpad ] if ] [
  c "s" = [ tok "s" = [ f "s" get int>str ] [ f "s" get 2 _zpad ] if ] [
  c "S" = [ f "frac" get 9 _zpad 0 tok len 9 min slice ] [
  c "a" = [ f "h" get 12 < [ "am" ] [ "pm" ] if ] [
  c "A" = [ f "h" get 12 < [ "AM" ] [ "PM" ] if ] [
  c "Z" = c "z" = or [ tok f _fmt-z ] [
  c "d" = [ tok f _fmt-wd ] [
  c "E" = [ f _iso-dow int>str ] [
  c "e" = [ f "dow" get int>str ] [
  c "Q" = [ tok "Q" = [ f _quarter int>str ] [ f _quarter _ord ] if ] [
  c "W" = [ tok f 1 4 _fmt-week ] [
  c "w" = [ tok f 0 6 _fmt-week ] [
  c "G" = [ tok f 1 4 _fmt-wyear ] [
  c "g" = [ tok f 0 6 _fmt-wyear ] [
  c "X" = [ f "ns" get 1000000000 div int>str ] [
  c "x" = [ f "ns" get 1000000 div int>str ] [
  tok ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

: _bracket? ( tok:str -- bool )
  tok len 1 > tok 0 nth "[" = and ;

: _fmt-token ( tok:str f:record -- str )
  tok _bracket?
  [ tok 1 tok len 1 - slice ]
  [ tok 0 nth tok f _fmt-by ] if ;

\ The tokens of a format: [literals], the format tokens and every other character on its own.
: _tokens ( fmt:str -- list )
  fmt "\\[[^\\]]*\\]|YYYYYY|YYYYY|YYYY|YY|Y|Qo|Q|MMMM|MMM|MM|Mo|M|DDDD|DDDo|DDD|DD|Do|D|dddd|ddd|dd|do|d|E|e|WW|Wo|W|ww|wo|w|GGGGG|GGGG|GG|ggggg|gggg|gg|HH|H|hh|h|kk|k|mm|m|ss|s|S+|a|A|ZZ|Z|zz|z|X|x|LTS|LT|LLLL|LLL|LL|L|llll|lll|ll|l|[\\s\\S]"
  "" regex:find-all [ "text" get ] map ;

: _expand-token ( tok:str -- str )
  tok "LT" = [ "h:mm A" ] [
  tok "LTS" = [ "h:mm:ss A" ] [
  tok "L" = [ "MM/DD/YYYY" ] [
  tok "LL" = [ "MMMM D, YYYY" ] [
  tok "LLL" = [ "MMMM D, YYYY h:mm A" ] [
  tok "LLLL" = [ "dddd, MMMM D, YYYY h:mm A" ] [
  tok "l" = [ "M/D/YYYY" ] [
  tok "ll" = [ "MMM D, YYYY" ] [
  tok "lll" = [ "MMM D, YYYY h:mm A" ] [
  tok "llll" = [ "ddd, MMM D, YYYY h:mm A" ] [
  tok ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ The format with its long-date tokens (LT, L, LL, ...) written out.
: _expand ( fmt:str -- str )
  fmt _tokens [ _expand-token ] map "" join ;

: _format-with ( fmt:str f:record -- str )
  fmt _expand _tokens [ f _fmt-token ] map "" join ;

\ The instant ns written in the format, as seen in the zone.
: _format ( fmt:str ns:int zone:str -- str )
  fmt ns zone _fields _format-with ;

\ ---- parsing ----
\ A forgiving parse, in the manner of moment.js without strict mode: the format is cut into tokens; for each token
\ the first match of its pattern is looked for in the rest of the text and the text up to the end of the match is
\ used up. A token with no match is skipped. A literal of the format (a character that is not a token, or [text])
\ is used up only when it is the next text; otherwise it is ignored (moment.js would skip ahead to its next
\ occurrence, which can swallow the fields after it). A text where no token matched at all is E_COERCE. Fields the format does not name are 1970, January, the 1st and midnight (moment.js
\ would use today; FL has no clock unless asked, and a conversion must not depend on the day it runs).

: _months-abbr ( -- list )
  { "jan" "feb" "mar" "apr" "may" "jun" "jul" "aug" "sep" "oct" "nov" "dec" } ;

: _month-no ( txt:str -- int )
  0 12 range [ _months-abbr swap nth txt lower 0 3 slice = ] filter 0 nth 1 + ;

\ The digits of a text as an integer, with a minus sign if the text starts with one.
: _sint ( txt:str -- int )
  txt "\\d+" "" regex:find-all 0 nth "text" get str>int
  txt "-" util:starts-with? [ neg ] when ;

\ A two-digit year: 69 to 99 are 1969 to 1999, 00 to 68 are 2000 to 2068.
: _year2 ( v:int -- int )
  v 68 > [ v 1900 + ] [ v 2000 + ] if ;

: _pattern-by ( c:str tok:str -- str )
  c "Y" = [ tok len 2 = [ "\\d{1,2}" ] [ tok len 4 = [ "\\d{1,4}" ] [ tok len 1 = [ "[+-]?\\d+" ] [ "[+-]?\\d{1,6}" ] if ] if ] if ] [
  c "M" = [ tok len 3 < [ "\\d{1,2}" ] [ "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec" ] if ] [
  c "D" = [ tok len 3 < [ "\\d{1,2}" ] [ "\\d{1,3}" ] if ] [
  c "H" = c "h" = or c "k" = or c "m" = or c "s" = or c "W" = or c "w" = or [ "\\d{1,2}" ] [
  c "S" = [ "\\d+" ] [
  c "a" = c "A" = or [ "[ap]\\.?m?\\.?" ] [
  c "Z" = [ "Z|[+-]\\d\\d(?::?\\d\\d)?" ] [
  c "z" = [ "[A-Za-z]{1,6}(?:[+-]\\d{1,2}(?::?\\d\\d)?)?|[+-]\\d{1,2}(?::?\\d\\d)?" ] [
  c "d" = [ tok len 1 = [ "\\d" ] [ "sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|su|mo|tu|we|th|fr|sa" ] if ] [
  c "E" = c "e" = or c "Q" = or [ "\\d" ] [
  c "G" = c "g" = or [ tok len 2 = [ "\\d{1,2}" ] [ tok len 4 = [ "\\d{1,4}" ] [ "[+-]?\\d{1,6}" ] if ] if ] [
  c "X" = [ "[+-]?\\d+(?:\\.\\d+)?" ] [
  c "x" = [ "[+-]?\\d+" ] [
  "" ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ The pattern that finds the value of a format token, or "" for a token that is only text.
: _tok-pattern ( tok:str -- str )
  tok _tok-ordinal? [ tok "DDDo" = [ "\\d{1,3}(?:st|nd|rd|th)" ] [ "\\d{1,2}(?:st|nd|rd|th)" ] if ]
  [ tok 0 nth tok _pattern-by ] if ;

\ The sign, integer part and fraction of a decimal amount (g, from _amount-ns) as nanoseconds, scale per unit.
: _amount-groups ( g:list scale:int -- int )
  g 1 nth str>int scale *
  scale 1 = [ 0 ] [ g 2 nth "000000000" cat 0 scale int>str len 1 - slice str>int ] if +
  g 0 nth "-" = [ neg ] when ;

\ A decimal amount of some unit as an integer count of nanoseconds, scale = nanoseconds per unit. The fraction is
\ cut (towards zero) at the nanosecond.
: _amount-ns ( txt:str scale:int -- int )
  txt "^\\s*([+-]?)(\\d+)(?:\\.(\\d+))?\\s*$" "" regex:find-all dup len 0 =
  [ "not a number" raise:coerce ]
  [ 0 nth "groups" get scale _amount-groups ] if ;

: _two-year ( txt:str -- int )
  txt len 2 = [ txt _sint _year2 ] [ txt _sint ] if ;

: _put-off ( acc:record txt:str -- record )
  acc "off" txt upper "Z" =
  [ 0 ]
  [ txt "\\D" "" "" regex:replace
    dup 0 2 slice str>int 3600 *
    over len 2 > [ over 2 4 slice str>int 60 * + ] when nip
    txt 0 nth "-" = [ neg ] when ] if
  put ;

: _store-by ( acc:record c:str tok:str txt:str -- record )
  c "Y" = [ acc "Y" tok len 2 = tok len 4 = or [ txt _two-year ] [ txt _sint ] if put ] [
  c "M" = [ acc "M" tok len 3 < [ txt _sint ] [ txt _month-no ] if put ] [
  c "D" = [ acc tok len 3 < [ "D" ] [ "doy" ] if txt _sint put ] [
  c "H" = c "h" = or [ acc "H" txt _sint put ] [
  c "k" = [ acc "H" txt _sint dup 24 = [ drop 0 ] when put ] [
  c "m" = [ acc "m" txt _sint put ] [
  c "s" = [ acc "s" txt _sint put ] [
  c "S" = [ acc "frac" txt "000000000" cat 0 9 slice str>int put ] [
  c "a" = c "A" = or [ acc "mer" txt lower 0 nth "p" = [ "pm" ] [ "am" ] if put ] [
  c "Z" = [ acc txt _put-off ] [
  c "X" = [ acc "X" txt 1000000000 _amount-ns put ] [
  c "x" = [ acc "X" txt 1000000 _amount-ns put ] [
  c "Q" = [ acc "Q" txt _sint put ] [
  c "W" = [ acc "W" txt _sint put ] [
  c "w" = [ acc "w" txt _sint put ] [
  c "E" = [ acc "E" txt _sint put ] [
  c "e" = [ acc "e" txt _sint put ] [
  c "G" = [ acc "G" txt _two-year put ] [
  c "g" = [ acc "g" txt _two-year put ] [
  c "d" = tok len 1 = and [ acc "d" txt _sint put ] [
  acc ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ] if ;

\ Record the value of a token (acc is the state of the parse).
: _store ( acc:record tok:str txt:str -- record )
  acc "hits" acc "hits" get 1 + put tok 0 nth tok txt _store-by ;

: _new-acc ( rest:str -- record )
  { { "rest" rest } { "hits" 0 } { "Y" false } { "Q" false } { "M" false } { "D" false } { "doy" false }
    { "H" false } { "m" false } { "s" false } { "frac" false } { "mer" false } { "off" false } { "X" false }
    { "W" false } { "w" false } { "G" false } { "g" false } { "E" false } { "e" false } { "d" false } }
  >record ;

: _set-rest ( acc:record rest:str -- record )
  acc "rest" rest put ;

: _skip-rest ( acc:record rest:str lit:str -- record )
  rest lit util:starts-with?
  [ acc rest lit len rest len slice _set-rest ]
  [ acc ] if ;

: _skip ( acc:record lit:str -- record )
  lit len 0 = [ acc ] [ acc acc "rest" get lit _skip-rest ] if ;

: _match2 ( m:record acc:record tok:str -- record )
  acc "rest" acc "rest" get m "end" get acc "rest" get len slice put
  tok m "groups" get 0 nth _store ;

\ The first match of the token's pattern anywhere in the rest of the text. The search is anchored and skips lazily
\ (^[\s\S]*?(pattern)), so at most one match is built, however many the text holds.
: _match ( acc:record tok:str pat:str -- record )
  acc "rest" get "^[\\s\\S]*?(" pat cat ")" cat "i" regex:find-all dup len 0 =
  [ drop acc ]
  [ 0 nth acc tok _match2 ] if ;

: _parse-pat ( acc:record tok:str pat:str -- record )
  pat len 0 = [ acc tok _skip ] [ acc tok pat _match ] if ;

: _parse-step ( acc:record tok:str -- record )
  tok _bracket?
  [ acc tok 1 tok len 1 - slice _skip ]
  [ acc tok tok _tok-pattern _parse-pat ] if ;

\ ---- from fields to an instant ----

: _get-or ( acc:record key:str dflt:any -- any )
  acc key get dup false = [ drop dflt ] when ;

: _set? ( acc:record key:str -- bool )
  acc key get false = not ;

: _ymd ( y:int m:int d:int -- int )
  m 1 12 util:between? not [ "the month is not between 1 and 12" raise:coerce ] when
  d 1 y m _dim util:between? not [ "the day does not exist in that month" raise:coerce ] when
  y m d _days ;

: _days-doy ( y:int doy:int -- int )
  doy 1 y _diy util:between? not [ "the day of the year does not exist in that year" raise:coerce ] when
  y 1 1 _days doy + 1 - ;

: _month-of ( acc:record -- int )
  acc "M" _set? [ acc "M" get ]
  [ acc "Q" _set? [ acc "Q" get 1 - 3 * 1 + ] [ 1 ] if ] if ;

: _days-calendar ( acc:record -- int )
  acc "Y" 1970 _get-or
  acc "doy" _set?
  [ acc "doy" get _days-doy ]
  [ acc _month-of acc "D" 1 _get-or _ymd ] if ;

\ The day count of a week date; yk, wk are the keys of the week-year and the week.
: _weekdate ( acc:record yk:str wk:str fdow:int fdoy:int weekday:int -- int )
  acc yk acc "Y" 1970 _get-or _get-or
  acc wk 1 _get-or
  weekday fdow fdoy _from-weeks
  dup 0 nth 1 1 _days swap 1 nth + 1 - ;

: _days-of ( acc:record -- int )
  acc "M" _set? not acc "D" _set? not and acc "doy" _set? not and
  [ acc "W" _set? acc "G" _set? or acc "E" _set? or
    [ acc "G" "W" 1 4 acc "E" 1 _get-or _weekdate ]
    [ acc "w" _set? acc "g" _set? or acc "e" _set? or acc "d" _set? or
      [ acc "g" "w" 0 6 acc "d" _set? [ acc "d" get ] [ acc "e" 0 _get-or ] if _weekdate ]
      [ acc _days-calendar ] if ] if ]
  [ acc _days-calendar ] if ;

: _mer ( h:int mer:any -- int )
  mer "pm" = [ h 12 < [ h 12 + ] [ h ] if ]
  [ mer "am" = [ h 12 = [ 0 ] [ h ] if ] [ h ] if ] if ;

: _tod2 ( h:int m:int s:int frac:int -- int )
  h 0 24 util:between? not [ "the hour is not between 0 and 24" raise:coerce ] when
  m 0 59 util:between? not [ "the minute is not between 0 and 59" raise:coerce ] when
  s 0 59 util:between? not [ "the second is not between 0 and 59" raise:coerce ] when
  h 24 = m s + frac + 0 > and [ "an hour of 24 must be exactly 24:00:00" raise:coerce ] when
  h 3600000000000 * m 60000000000 * + s 1000000000 * + frac + ;

: _tod ( acc:record -- int )
  acc "H" 0 _get-or acc "mer" get _mer
  acc "m" 0 _get-or acc "s" 0 _get-or acc "frac" 0 _get-or _tod2 ;

: _resolve ( acc:record zone:str -- int )
  acc "X" _set?
  [ acc "X" get ]
  [ acc _days-of 86400000000000 * acc _tod +
    acc "off" _set? [ acc "off" get 1000000000 * - ] [ zone _local>instant ] if ] if ;

\ The instant (ns) of a text read with a format, in a zone (an offset in the text wins over the zone).
: _parse ( text:str fmt:str zone:str -- int )
  fmt _expand _tokens text _new-acc [ _parse-step ] reduce
  dup "hits" get 0 = [ "the text does not match the format" raise:coerce ] when
  zone _resolve ;

\ ---- format presets ----

: _preset-format ( preset:str -- str )
  { { "Standard date and time" "DD/MM/YYYY HH:mm:ss" }
    { "American-style date and time" "MM/DD/YYYY HH:mm:ss" }
    { "International date and time" "YYYY-MM-DD HH:mm:ss" }
    { "ISO 8601 date and time" "YYYY-MM-DD[T]HH:mm:ssZ" }
    { "Verbose date and time" "dddd Do MMMM YYYY HH:mm:ss Z z" }
    { "Standard date" "DD/MM/YYYY" }
    { "American-style date" "MM/DD/YYYY" }
    { "International date" "YYYY-MM-DD" }
    { "Verbose date" "dddd Do MMMM YYYY" }
    { "Time" "HH:mm:ss" }
    { "Time (12-hour)" "hh:mm:ss A" }
    { "UNIX timestamp" "X" }
    { "UNIX timestamp (milliseconds)" "x" } }
  >record preset get ;

\ The format a preset names, or the custom format for the preset Custom (which must not be empty).
: _preset ( preset:str custom:str -- str )
  preset "Custom" =
  [ custom len 0 = [ "the custom format is empty" raise:range ] when custom ]
  [ preset _preset-format ] if ;

\ ---- reports and units ----

: _dst? ( f:record -- bool )
  f "off" get
  f "y" get 1 1 _days 86400000000000 * f "zone" get _local>instant 1000000 div f "zone" get swap _offset
  f "y" get 6 1 _days 86400000000000 * f "zone" get _local>instant 1000000 div f "zone" get swap _offset
  min > ;

: _tf ( b:bool -- str )
  b [ "true" ] [ "false" ] if ;

: _fmtf ( fmt:str f:record -- str )
  fmt f _format-with ;

: _report ( f:record -- str )
  { "Date: " "dddd Do MMMM YYYY" f _fmtf cat
    "Time: " "HH:mm:ss" f _fmtf cat
    "Period: " "A" f _fmtf cat
    "Timezone: " "z" f _fmtf cat
    "UTC offset: " "ZZ" f _fmtf cat
    ""
    "Daylight Saving Time: " f _dst? _tf cat
    "Leap year: " f "y" get _leap? _tf cat
    "Days in this month: " f "y" get f "mo" get _dim int>str cat
    ""
    "Day of year: " f "doy" get int>str cat
    "Week number: " "W" f _fmtf cat
    "Quarter: " f _quarter int>str cat }
  "\n" join ;

\ Nanoseconds in one of the Unix time units.
: _unit-scale ( unit:str -- int )
  unit "seconds" = [ 1000000000 ] [
  unit "milliseconds" = [ 1000000 ] [
  unit "microseconds" = [ 1000 ] [ 1 ] if ] if ] if ;

\ The Unix timestamp text of an instant: whole units, rounded down, and with show the instant in UTC after it.
: _unix-text ( ns:int unit:str show:bool -- str )
  ns unit _unit-scale div int>str
  show [ " (" cat "ddd D MMMM YYYY HH:mm:ss" ns "UTC" _format cat " UTC)" cat ] when ;

\ Integer division that rounds towards zero.
\ util-candidate: tdiv
: _tdiv ( a:int b:int -- int )
  a 0 < [ a neg b div neg ] [ a b div ] if ;

\ 100-nanosecond ticks between 1601-01-01 (the Windows file time epoch) and 1970-01-01.
116444736000000000 CONSTANT _filetime-epoch

\ The number a file time text holds: decimal digits, hex digits (most significant first) or hex bytes in
\ little-endian order.
: _filetime-read ( txt:str input:str -- int )
  input "decimal" =
  [ txt "^\\s*(\\d+)\\s*$" "" regex:find-all dup len 0 = [ "not a decimal number" raise:coerce ] when
    0 nth "groups" get 0 nth str>int ]
  [ txt "^\\s*(?:0x)?([0-9a-fA-F]+)\\s*$" "" regex:find-all dup len 0 = [ "not a hexadecimal number" raise:coerce ] when
    0 nth "groups" get 0 nth
    input "hex-le" =
    [ hex>bytes rev 256 util:digits>int ]
    [ 16 str>int-radix ] if ] if ;

\ A file time (ticks since 1601) written as decimal, as 16 hex digits, or as the 8 bytes in little-endian order.
: _filetime-write ( ft:int output:str -- str )
  ft 0 < ft 18446744073709551615 > or
  [ "the file time is outside 1601-01-01 to 30828-09-14 (a 64-bit value)" raise:range ] when
  output "decimal" = [ ft int>str ] [
  output "hex-be" = [ ft 16 util:pad-hex ] [ ft 8 util:int>be-bytes rev bytes>hex ] if ] if ;

\ ---- the operations ----

: zones ( -- list )
  "The time zone names this host knows (IANA names such as Asia/Tokyo, with UTC always present), sorted. Any of them can be written in the zone parameters of the datetime operations, besides UTC and fixed offsets such as +09:00, -0530 or +05." doc
  _zones ;

: parse ( data:str preset:choice{"Standard date and time"|"American-style date and time"|"International date and time"|"ISO 8601 date and time"|"Verbose date and time"|"Standard date"|"American-style date"|"International date"|"Verbose date"|"Time"|"Time (12-hour)"|"UNIX timestamp"|"UNIX timestamp (milliseconds)"|Custom}="Standard date and time" format:str="DD/MM/YYYY HH:mm:ss" zone:str="UTC" -- str )
  "Read a date and time in a known format and describe it: the date, the time, AM or PM, the time zone and its offset from UTC, whether daylight saving time is in force, leap year, the length of the month, the day of the year, the ISO week and the quarter. The format is one of the presets or, with the preset Custom, the format string, written with moment.js-style tokens (YYYY MM DD HH mm ss Z and so on; see the datetime vocabulary). The reading is forgiving: text between the fields is skipped, and a field the format names that the text lacks is left out. A date the format does not name is 1 January 1970. The zone says where the time was read (an offset written in the text, with Z, wins); it is UTC, a fixed offset like +09:00, or an IANA name like Asia/Tokyo. Text that does not fit the format, or a date that does not exist, is E_COERCE; an unknown zone is E_RANGE." doc
  "Date/Time" category
  data preset format _preset zone _parse zone _fields _report ;

: translate ( data:str in-preset:choice{"Standard date and time"|"American-style date and time"|"International date and time"|"ISO 8601 date and time"|"Verbose date and time"|"Standard date"|"American-style date"|"International date"|"Verbose date"|"Time"|"Time (12-hour)"|"UNIX timestamp"|"UNIX timestamp (milliseconds)"|Custom}="Standard date and time" in-format:str="DD/MM/YYYY HH:mm:ss" in-zone:str="UTC" out-preset:choice{"Standard date and time"|"American-style date and time"|"International date and time"|"ISO 8601 date and time"|"Verbose date and time"|"Standard date"|"American-style date"|"International date"|"Verbose date"|"Time"|"Time (12-hour)"|"UNIX timestamp"|"UNIX timestamp (milliseconds)"|Custom}="Verbose date and time" out-format:str="dddd Do MMMM YYYY HH:mm:ss Z z" out-zone:str="UTC" -- str )
  "Read a date and time in one format and time zone and write it in another. Each format is one of the presets or, with the preset Custom, a format string written with moment.js-style tokens (YYYY MM DD HH mm ss Z z and so on; see the datetime vocabulary). The reading is forgiving, as in datetime:parse. A zone is UTC, a fixed offset like +09:00, or an IANA name like Asia/Tokyo; the instant is the same, only its wall clock changes. Text that does not fit the input format is E_COERCE; an unknown zone is E_RANGE." doc
  "Date/Time" category
  out-preset out-format _preset
  data in-preset in-format _preset in-zone _parse
  out-zone _format ;

: from-unix ( data:str unit:choice{seconds|milliseconds|microseconds|nanoseconds}="seconds" zone:str="UTC" format:str="ddd D MMMM YYYY HH:mm:ss z" -- str )
  "Write a Unix timestamp (the time since 1970-01-01T00:00:00Z in the chosen unit, a whole or decimal number, negative for earlier times) as a date and time. The default format gives text like Wed 11 November 2026 12:34:56 UTC; the zone and the moment.js-style format string are yours to change (see the datetime vocabulary for the tokens). A fraction finer than a nanosecond is cut. Text that is not a number is E_COERCE; an unknown zone is E_RANGE." doc
  "Date/Time" category
  format data unit _unit-scale _amount-ns zone _format ;

: to-unix ( data:str unit:choice{seconds|milliseconds|microseconds|nanoseconds}="seconds" preset:choice{"Standard date and time"|"American-style date and time"|"International date and time"|"ISO 8601 date and time"|"Verbose date and time"|"Standard date"|"American-style date"|"International date"|"Verbose date"|"Time"|"Time (12-hour)"|"UNIX timestamp"|"UNIX timestamp (milliseconds)"|Custom}="International date and time" format:str="YYYY-MM-DD HH:mm:ss" zone:str="UTC" show-parsed:bool=true -- str )
  "Read a date and time and give its Unix timestamp: the time since 1970-01-01T00:00:00Z in the chosen unit, rounded down to a whole number. The date is read with a preset or a custom moment.js-style format (forgiving, as in datetime:parse, so an ISO 8601 text such as 2026-11-11T12:34:56Z is read by the default) in the given zone (an offset in the text wins). With show-parsed the instant is also written out in UTC after the number, like 1794400496 (Wed 11 November 2026 12:34:56 UTC); turn it off to chain the number into other operations. Text that does not fit the format is E_COERCE; an unknown zone is E_RANGE." doc
  "Date/Time" category
  data preset format _preset zone _parse unit show-parsed _unix-text ;

: filetime-to-unix ( data:str input:choice{decimal|hex-be|hex-le}="decimal" unit:choice{seconds|milliseconds|microseconds|nanoseconds}="seconds" -- str )
  "Convert a Windows file time (100-nanosecond intervals since 1601-01-01T00:00:00Z) to a Unix timestamp in the chosen unit. The input is decimal digits, hex digits most significant first (hex-be, an optional 0x in front), or hex bytes in little-endian order (hex-le, as the 8 bytes sit in memory). Seconds, milliseconds and microseconds are rounded towards zero; nanoseconds are exact. Text that is not a number of that kind is E_COERCE." doc
  "Date/Time" category
  data input _filetime-read _filetime-epoch -
  unit "nanoseconds" = [ 100 * ] [
  unit "microseconds" = [ 10 _tdiv ] [
  unit "milliseconds" = [ 10000 _tdiv ] [ 10000000 _tdiv ] if ] if ] if
  int>str ;

: unix-to-filetime ( data:str unit:choice{seconds|milliseconds|microseconds|nanoseconds}="seconds" output:choice{decimal|hex-be|hex-le}="decimal" -- str )
  "Convert a Unix timestamp (a whole or decimal number in the chosen unit) to a Windows file time, the number of 100-nanosecond intervals since 1601-01-01T00:00:00Z. The output is decimal digits, 16 hex digits (hex-be) or the 8 bytes in little-endian order as 16 hex digits (hex-le). A fraction finer than 100 nanoseconds is cut towards zero. Text that is not a number is E_COERCE; a time before 1601 or past the 64-bit range is E_RANGE." doc
  "Date/Time" category
  data unit _unit-scale _amount-ns 100 _tdiv _filetime-epoch + output _filetime-write ;

: _shift ( ns:int zone:str sign:int days:int elapsed:int -- int )
  days 0 =
  [ ns ]
  [ ns zone ns 1000000 div _offset 1000000000 * + sign days * 86400000000000 * + zone _local>instant ] if
  sign elapsed * + ;

: delta ( data:str preset:choice{"Standard date and time"|"American-style date and time"|"International date and time"|"ISO 8601 date and time"|"Verbose date and time"|"Standard date"|"American-style date"|"International date"|"Verbose date"|"Time"|"Time (12-hour)"|"UNIX timestamp"|"UNIX timestamp (milliseconds)"|Custom}="Standard date and time" format:str="DD/MM/YYYY HH:mm:ss" zone:str="UTC" operation:choice{add|subtract}="add" days:int=0 hours:int=0 minutes:int=0 seconds:int=0 milliseconds:int=0 -- str )
  "Add a length of time to a date and time, or subtract it, and write the result in the same format. The date is read with a preset or a custom moment.js-style format (forgiving, as in datetime:parse) in the given zone, and written back in that zone. Days are calendar days (the wall clock keeps its time across a daylight saving change); hours, minutes, seconds and milliseconds are elapsed time. Each amount may be negative. Text that does not fit the format is E_COERCE; an unknown zone is E_RANGE." doc
  "Date/Time" category
  preset format _preset
  data preset format _preset zone _parse
  zone operation "add" = [ 1 ] [ -1 ] if days
  hours 3600000000000 * minutes 60000000000 * + seconds 1000000000 * + milliseconds 1000000 * +
  _shift zone _format ;

: _pair ( k:str -- list )
  { k true } ;

\ The distinct items, each at its first position (a record keeps the first position of a key).
\ util-candidate: distinct
: _distinct ( items:list -- list )
  items [ _pair ] map >record keys ;

: _date-pattern ( -- str )
  "\\b(?:(?:19|20)\\d\\d[-/. ](?:0?[1-9]|1[0-2])[-/. ](?:0?[1-9]|[12]\\d|3[01])|(?:0?[1-9]|[12]\\d|3[01])[-/. ](?:0?[1-9]|1[0-2])[-/. ](?:19|20)\\d\\d|(?:0?[1-9]|1[0-2])[-/. ](?:1[3-9]|2\\d|3[01])[-/. ](?:19|20)\\d\\d)\\b" ;

: _total-text ( items:list total:bool -- str )
  items "\n" join
  total [ "Total found: " items len int>str cat "\n\n" cat swap cat ] when ;

: extract-dates ( data:str display-total:bool=false sort:bool=false unique:bool=false -- str )
  "Find the dates in the text and list them, one per line, in the order they appear. A date is a year, month and day written yyyy-mm-dd, a day, month and year written dd/mm/yyyy, or a month, day and year written mm/dd/yyyy (the day is more than 12 there, so it cannot be a month), with a hyphen, slash, full stop or space between the parts, one or two digits for the month and day and a year from 1900 to 2099. The match is by pattern only: a date that does not exist, like 2026-02-30, is still listed. With sort the dates are in code point order; with unique each is listed once (at its first position, or sorted); with display-total the first line says how many dates are listed, then a blank line." doc
  "Date/Time" category
  data _date-pattern "" regex:find-all [ "text" get ] map
  unique [ _distinct ] when
  sort [ list:sort ] when
  display-total _total-text ;

META: parse
  param preset "A known format to read the date and time with, or Custom to use the format string." ;
  param format "The format string for the preset Custom, in moment.js-style tokens (YYYY MM DD HH mm ss SSS Z A and so on; [text] is copied as it is)." ;
  param zone "Where the time was read: UTC, a fixed offset like +09:00, or an IANA time zone like Asia/Tokyo." ;
  see-also datetime:translate datetime:to-unix datetime:zones ;
;

META: translate
  param in-preset "A known format to read the date and time with, or Custom to use the input format string." ;
  param in-format "The input format string for the preset Custom, in moment.js-style tokens." ;
  param in-zone "Where the time was read: UTC, a fixed offset like +09:00, or an IANA time zone like Asia/Tokyo." ;
  param out-preset "A known format to write the date and time in, or Custom to use the output format string." ;
  param out-format "The output format string for the preset Custom, in moment.js-style tokens." ;
  param out-zone "The time zone to write the time in: UTC, a fixed offset like +09:00, or an IANA time zone." ;
  see-also datetime:parse datetime:delta datetime:zones ;
;

META: from-unix
  param unit "What the number counts: seconds, milliseconds, microseconds or nanoseconds since 1970-01-01T00:00:00Z." ;
  param zone "The time zone to write the time in: UTC, a fixed offset like +09:00, or an IANA time zone." ;
  param format "The output format string, in moment.js-style tokens." ;
  see-also datetime:to-unix datetime:unix-to-filetime ;
;

META: to-unix
  param unit "What to count since 1970-01-01T00:00:00Z: seconds, milliseconds, microseconds or nanoseconds." ;
  param preset "A known format to read the date and time with, or Custom to use the format string." ;
  param format "The format string for the preset Custom, in moment.js-style tokens." ;
  param zone "Where the time was read: UTC, a fixed offset like +09:00, or an IANA time zone like Asia/Tokyo." ;
  param show-parsed "Add the time as it was read, in UTC, after the number." ;
  see-also datetime:from-unix datetime:parse ;
;

META: filetime-to-unix
  param input "How the file time is written: decimal digits, hex digits (hex-be), or hex bytes in little-endian order (hex-le)." ;
  param unit "The unit of the Unix timestamp to give." ;
  see-also datetime:unix-to-filetime datetime:from-unix ;
;

META: unix-to-filetime
  param unit "The unit of the Unix timestamp that is given." ;
  param output "How to write the file time: decimal digits, 16 hex digits (hex-be), or the 8 bytes in little-endian order (hex-le)." ;
  see-also datetime:filetime-to-unix datetime:to-unix ;
;

META: delta
  param preset "A known format to read and write the date and time with, or Custom to use the format string." ;
  param format "The format string for the preset Custom, in moment.js-style tokens." ;
  param zone "The time zone of the date and time: UTC, a fixed offset like +09:00, or an IANA time zone." ;
  param operation "Add the time, or subtract it." ;
  param days "Calendar days." ;
  param hours "Hours of elapsed time." ;
  param minutes "Minutes of elapsed time." ;
  param seconds "Seconds of elapsed time." ;
  param milliseconds "Milliseconds of elapsed time." ;
  see-also datetime:translate datetime:parse ;
;

META: extract-dates
  param display-total "Write the number of dates found on the first line." ;
  param sort "List the dates in code point order." ;
  param unique "List each date once." ;
  see-also datetime:parse regex:find-all ;
;
