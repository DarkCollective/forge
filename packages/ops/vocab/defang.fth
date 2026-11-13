\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ defang: Defang URL, Fang URL and Defang IP Addresses (WP 5.53): write URLs and IP addresses so that they are no
\ longer links or addresses (hxxp://example[.]com, 192[.]0[.]2[.]1), and undo it. All FL over the regex words. Defang IP
\ Addresses is ip:defang (it needs the address parser of the ip vocabulary). Where an operation has to rewrite each
\ match of a pattern, rewrite puts the pieces together from the positions that regex:find-all gives (regex:replace has
\ no function to call for each match); ip:defang uses it too.
IN: defang

\ ---- rewriting each match ----

\ The text between the end of the match before m (or the start) and m, and then m rewritten by fn.
: _piece ( m:record i:int ms:list text:str fn:quot -- str )
  text i 0 = [ 0 ] [ ms i 1 - nth "end" get ] if m "start" get slice
  m "text" get fn call cat ;

\ The text with each match of ms (from regex:find-all on the same text) replaced by fn applied to its text. Public
\ because ip:defang uses it; not an op (a list and a quotation are not parameter types of ops).
: rewrite ( text:str ms:list fn:quot -- str )
  ms [ ms text fn _piece ] mapi "" join
  text ms len 0 = [ 0 ] [ ms ms len 1 - nth "end" get ] if text len slice cat ;

: _map-matches ( text:str pattern:str flags:str fn:quot -- str )
  text text pattern flags regex:find-all fn rewrite ;

\ ---- Defang URL and Fang URL ----

\ CyberChef's patterns (the lookbehinds are added: a match cannot start inside a run of letters (that changes nothing:
\ the leftmost match already starts at the front of the run) and a domain cannot start after a dot or a hyphen that
\ follows a letter or digit, so a long run of labels is read once and not once from every position, which took
\ seconds at 64 KiB. The cross-check of WP 5.59b found the first version of the domain lookbehind, which also
\ refused a start after a dot or hyphen that follows something else, skipped ".example.com" and "*.example.com"): a full URL (scheme in capital letters or not, ://, a host with at least one dot, an optional
\ port, an optional path that does not end in . ! , or ?) and a domain name (labels of 1 to 63 characters).
: _url-pattern ( -- str )
  "(?<![A-Z])[A-Z]+://[-\\w]+(?:\\.\\w[-\\w]*)+(?::\\d+)?(?:/[^.!,?\"<>\\[\\]{}\\s\\x7F-\\xFF]*(?:[.!,?]+[^.!,?\"<>\\[\\]{}\\s\\x7F-\\xFF]+)*)?" ;

: _domain-pattern ( -- str )
  "(?<![a-z0-9]|[a-z0-9][.-])\\b(?:(?=[a-z0-9-]{1,63}\\.)(?:xn--)?[a-z0-9]+(?:-[a-z0-9]+)*\\.)+[a-z]{2,63}\\b" ;

\ Dots, then http, then ://.
: _defang-one ( url:str dots:bool http:bool slashes:bool -- str )
  url
  dots [ "." split "[.]" join ] when
  http [ "http" "hxxp" "i" regex:replace ] when
  slashes [ "://" split "[://]" join ] when ;

: defang-url ( data:str escape-dots:bool=true escape-http:bool=true escape-slashes:bool=true process:choice{valid-domains-and-full-urls|only-full-urls|everything}="valid-domains-and-full-urls" -- str )
  "Makes URLs harmless to click (hxxp[://]example[.]com/a): escape-dots writes every . as [.], escape-http writes http (any letter case) as hxxp, and escape-slashes writes :// as [://]. process says what is changed: only the full URLs (a scheme and ://, a host with a dot, an optional port and path, as CyberChef finds them), the full URLs and then the domain names in the text (a name of dot-separated labels ending in two to 63 letters), or everything, the whole input as one URL. The patterns are CyberChef's." doc
  "Networking" category
  process "everything" =
  [ data escape-dots escape-http escape-slashes _defang-one ]
  [ data _url-pattern "i" [ escape-dots escape-http escape-slashes _defang-one ] _map-matches
    process "only-full-urls" = not
    [ _domain-pattern "i" [ escape-dots escape-http escape-slashes _defang-one ] _map-matches ] when ] if ;

META: defang-url
  use-when "You have a URL or a domain copied from a phishing mail or a log, and want to write it so that it cannot be clicked by mistake." ;
  param escape-dots "Write every . as [.]." ;
  param escape-http "Write http as hxxp (any letter case)." ;
  param escape-slashes "Write :// as [://]." ;
  param process "valid-domains-and-full-urls: URLs, then domain names; only-full-urls: URLs; everything: the whole input." ;
  see-also defang:fang-url defang:defang-ip extract:urls ;
  inverse fang-url ;
;

: fang-url ( data:str restore-dots:bool=true restore-http:bool=true restore-slashes:bool=true -- str )
  "Undoes Defang URL: [.] becomes ., hxxp becomes http (lower case only, as written by Defang URL) and [://] becomes ://, wherever they are in the input; each part can be switched off." doc
  "Networking" category
  data
  restore-dots [ "[.]" split "." join ] when
  restore-http [ "hxxp" split "http" join ] when
  restore-slashes [ "[://]" split "://" join ] when ;

META: fang-url
  use-when "You have a defanged URL, with [.] and hxxp in it, from a report or a chat, and want the live form back." ;
  param restore-dots "Write [.] as ." ;
  param restore-http "Write hxxp as http." ;
  param restore-slashes "Write [://] as ://." ;
  see-also defang:defang-url ;
  inverse defang-url ;
;
