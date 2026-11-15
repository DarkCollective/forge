\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ user-agent: Parse User Agent (WP 5.53). CyberChef uses ua-parser-js; Forge has no such dependency (version 2 of the
\ library is AGPL, and version 1.x would put a library full of its own regular expressions behind the regex seam).
\ The parser here is a compact table of rules written in FL over regex:find-all: for each of browser, engine, OS, device
\ and CPU the first rule whose pattern matches the User-Agent string gives the name, and the first group of the pattern
\ gives the version. The table covers the browsers, engines, systems and devices that make up nearly all real traffic;
\ a User-Agent that none of the rules knows shows "unknown", as CyberChef does. The layout is CyberChef's.
IN: user-agent

\ ---- the rule engine ----

\ A rule is { pattern name }. The result is { name version }, or an empty list when no rule matches; the version is the
\ first group of the pattern ("" when the pattern has none or the group did not take part).
: _try-rule ( ua:str rule:list -- list )
  ua rule 0 nth "i" regex:find-all :> hits
  hits len 0 = [ { } exit ] when
  hits 0 nth "groups" get :> groups
  groups len 0 = [ "" ] [ groups 0 nth ] if :> version
  { rule 1 nth version } ;

\ The result of the first rule that matches, or an empty list.
: _first ( ua:str rules:list -- list )
  rules [ ua swap _try-rule len 0 > ] find :> i
  i -1 = [ { } ] [ ua rules i nth _try-rule ] if ;

\ Field i of a found { name version } list, or "unknown" when nothing was found or the field is empty.
: _pick ( found:list i:int -- str )
  {
    [ found len 0 = ] [ "unknown" ]
    [ found i nth len 0 = ] [ "unknown" ]
    [ found i nth ]
  } cond ;

: _name ( found:list -- str )
  found 0 _pick ;

: _version ( found:list -- str )
  found 1 _pick ;

\ ---- browser ----

MEMO: _browser-rules ( -- list )
  {
    { "\\bEdg(?:e|A|iOS)?/([\\d.]+)" "Edge" }
    { "\\bOPR/([\\d.]+)" "Opera" }
    { "Opera Mini/([\\d.]+)" "Opera Mini" }
    { "Opera Mobi.*Version/([\\d.]+)" "Opera Mobi" }
    { "Opera/.*Version/([\\d.]+)" "Opera" }
    { "Opera[ /]([\\d.]+)" "Opera" }
    { "SamsungBrowser/([\\d.]+)" "Samsung Internet" }
    { "UCBrowser/([\\d.]+)" "UCBrowser" }
    { "YaBrowser/([\\d.]+)" "Yandex" }
    { "Vivaldi/([\\d.]+)" "Vivaldi" }
    { "FBAV/([\\d.]+)" "Facebook" }
    { "Instagram ([\\d.]+)" "Instagram" }
    { "MicroMessenger/([\\d.]+)" "WeChat" }
    { "MiuiBrowser/([\\d.]+)" "MIUI Browser" }
    { "FxiOS/([\\d.]+)" "Mobile Firefox" }
    { "^(?=.*\\bMobile\\b).*Firefox/([\\d.]+)" "Mobile Firefox" }
    { "Firefox/([\\d.]+)" "Firefox" }
    { "Electron/([\\d.]+)" "Electron" }
    { "; wv\\).*Chrome/([\\d.]+)" "Chrome WebView" }
    { "CriOS/([\\d.]+)" "Mobile Chrome" }
    { "Chromium/([\\d.]+)" "Chromium" }
    { "Chrome/([\\d.]+)(?=.* Mobile)" "Mobile Chrome" }
    { "Chrome/([\\d.]+)" "Chrome" }
    { "MSIE ([\\d.]+)" "IE" }
    { "Trident/.*rv:([\\d.]+)" "IE" }
    { "Android.*Version/([\\d.]+)" "Android Browser" }
    { "(?:iPhone|iPad|iPod).*Version/([\\d.]+).*Safari" "Mobile Safari" }
    { "Mobile.*Version/([\\d.]+).*Safari" "Mobile Safari" }
    { "Version/([\\d.]+).*Safari" "Safari" }
    { "AppleWebKit/([\\d.]+)" "WebKit" }
  } ;

\ ---- engine ----

MEMO: _engine-rules ( -- list )
  {
    { "Edge/([\\d.]+)" "EdgeHTML" }
    { "Trident/([\\d.]+)" "Trident" }
    { "Presto/([\\d.]+)" "Presto" }
    { "AppleWebKit/537\\.36.*Chrome/(?!27\\.)([\\d.]+)" "Blink" }
    { "(?:AppleWebKit|KHTML)/([\\d.]+)" "WebKit" }
    { "rv:([\\w.]{1,9})\\b.*Gecko" "Gecko" }
    { "Gecko/([\\d.]+)" "Gecko" }
  } ;

\ ---- operating system ----

MEMO: _windows-names ( -- list )
  {
    { "10.0" "10" } { "6.4" "10" } { "6.3" "8.1" } { "6.2" "8" } { "6.1" "7" } { "6.0" "Vista" } { "5.2" "XP" }
    { "5.1" "XP" } { "5.0" "2000" } { "4.0" "NT 4.0" }
  } ;

\ Windows NT version to the name of the release.
: _windows-name ( v:str -- str )
  _windows-names [ 0 nth v = ] filter { { v v } } cat 0 nth 1 nth ;

MEMO: _os-rules ( -- list )
  {
    { "Windows Phone (?:OS )?([\\d.]+)" "Windows Phone" }
    { "Windows NT ([\\d.]+)" "Windows" }
    { "CPU (?:iPhone )?OS ([\\d_]+) like Mac OS X" "iOS" }
    { "(?:iPhone|iPad|iPod).*? OS ([\\d_]+)" "iOS" }
    { "Android[ /-]?([\\d.]+)" "Android" }
    { "CrOS \\S+ ([\\d.]+)" "Chrome OS" }
    { "Mac OS X ([\\d_.]+)" "macOS" }
    { "Macintosh|Mac_PowerPC" "macOS" }
    { "Ubuntu/?([\\d.]*)" "Ubuntu" }
    { "Debian/?([\\d.]*)" "Debian" }
    { "Fedora/?([\\d.]*)" "Fedora" }
    { "FreeBSD" "FreeBSD" }
    { "OpenBSD" "OpenBSD" }
    { "NetBSD" "NetBSD" }
    { "SunOS" "Solaris" }
    { "PlayStation ([\\d.]+)" "PlayStation" }
    { "Web0S|webOS" "webOS" }
    { "Tizen[ /]?([\\d.]*)" "Tizen" }
    { "KaiOS/([\\d.]+)" "KaiOS" }
    { "Linux" "Linux" }
  } ;

\ The version as people write it: iOS and macOS use _ in the User-Agent; Windows names the release.
: _os-version ( found:list -- str )
  found _version
  found _name "Windows" = [ _windows-name ] when
  "_" split "." join ;

\ ---- device ----

\ A rule is { pattern vendor type model }; with an empty model the first group of the pattern is the model.
: _try-device ( ua:str rule:list -- list )
  ua rule 0 nth "i" regex:find-all :> hits
  hits len 0 = [ { } exit ] when
  hits 0 nth "groups" get :> groups
  groups len 0 = [ "" ] [ groups 0 nth ] if :> version
  rule 3 nth :> fixed
  fixed len 0 = [ version ] [ fixed ] if :> model
  { rule 1 nth rule 2 nth model } ;

MEMO: _device-rules ( -- list )
  {
    { "iPod" "Apple" "mobile" "iPod touch" }
    { "iPhone" "Apple" "mobile" "iPhone" }
    { "iPad" "Apple" "tablet" "iPad" }
    { "Macintosh" "Apple" "" "Macintosh" }
    { "\\b(SM-[TPX]\\w+)" "Samsung" "tablet" "" }
    { "\\b(SM-\\w+|GT-\\w+|SCH-\\w+|SHV-\\w+)" "Samsung" "mobile" "" }
    { "\\b(Pixel(?: [0-9]+[a-z]*)?(?: (?:XL|Pro|Fold))*)(?=[;) ])" "Google" "mobile" "" }
    { "(Nexus 6P)" "Huawei" "mobile" "" }
    { "\\b(Nexus [0-9]+X?)\\b" "Google" "mobile" "" }
    { "(Lumia [0-9]+)" "Microsoft" "mobile" "" }
    { "\\bHUAWEI ([\\w-]+)" "Huawei" "mobile" "" }
    { "(moto [^;()]+(?:\\([^)]*\\))?)" "Motorola" "mobile" "" }
    { "Android[^;)]*; (Mi [\\w ]+?|Redmi [\\w ]+?|HM [\\w ]+?)(?= Build|[;)])" "Xiaomi" "mobile" "" }
    { "\\bAFT(\\w+)" "Amazon" "smarttv" "" }
    { "CrKey" "Google" "smarttv" "Chromecast" }
    { "(PlayStation [0-9A-Za-z]+)" "Sony" "console" "" }
    { "(Xbox One|Xbox Series [XS]|Xbox)" "Microsoft" "console" "" }
    { "Nintendo ([0-9A-Za-z]+)" "Nintendo" "console" "" }
    { "AppleTV" "Apple" "smarttv" "Apple TV" }
    { "\\bRoku" "Roku" "smarttv" "" }
    { "SMART-TV.*Tizen|Tizen.*SMART-TV|SamsungBrowser.*\\bTV\\b" "Samsung" "smarttv" "" }
    { "SmartTV|SMART-TV|HbbTV|Web0S|NetCast|Tizen.*TV" "" "smarttv" "" }
    { "Android[^;)]*; Mobile; rv:" "" "mobile" "" }
    { "Android[^;)]*; ((?:[^;()]|\\([^()]*\\))+?)(?: Build[^)]*)?\\).*Mobile" "" "mobile" "" }
    { "Android[^;)]*; ((?:[^;()]|\\([^()]*\\))+?)(?: Build[^)]*)?\\)" "" "tablet" "" }
  } ;

: _device ( ua:str -- list )
  _device-rules :> rules
  rules [ ua swap _try-device len 0 > ] find :> i
  i -1 = [ { } ] [ ua rules i nth _try-device ] if ;

\ ---- CPU ----

MEMO: _cpu-rules ( -- list )
  {
    { "\\b(?:aarch64|arm64|armv8)" "arm64" }
    { "\\barm(?:v[1-7])?(?:hf|l|el)?\\b" "arm" }
    { "\\b(?:amd64|x86[_-]64|x64|wow64|win64)" "amd64" }
    { "\\b(?:i[3-6]86|x86|ia32)\\b" "ia32" }
    { "\\bia64\\b" "ia64" }
    { "\\b(?:ppc|powerpc)(?:64)?\\b" "ppc" }
    { "\\bmips(?:64)?\\b" "mips" }
    { "\\bsparc(?:64)?\\b|\\bsun4\\w" "sparc" }
  } ;

\ ---- the report ----

: _field ( label:str value:str -- str )
  "    " label cat ": " cat value cat ;

: _section ( title:str fields:list -- str )
  title "\n" cat fields "\n" join cat ;

: _or-unknown ( s:str -- str )
  s len 0 = [ "unknown" ] [ s ] if ;

: _clean ( s:str -- str )
  s "^\\s*(?:User-Agent:)?\\s*" "" "i" regex:replace rev "^\\s+" "" "" regex:replace rev
  dup len 4096 > [ "a User-Agent of more than 4,096 characters is not parsed" fail-range ] when ;

: _dev-field ( d:list i:int -- str )
  d len 0 = [ "unknown" ] [ d i nth _or-unknown ] if ;

: _assemble ( b:list e:list o:list d:list c:list -- str )
  { "Browser" { "Name" b _name _field "Version" b _version _field } _section
    "Device" { "Model" d 2 _dev-field _field "Type" d 1 _dev-field _field "Vendor" d 0 _dev-field _field } _section
    "Engine" { "Name" e _name _field "Version" e _version _field } _section
    "OS" { "Name" o _name _field "Version" o _os-version _or-unknown _field } _section
    "CPU" { "Architecture" c _name _field } _section } "\n" join ;

: _report ( ua:str -- str )
  ua _browser-rules _first ua _engine-rules _first ua _os-rules _first ua _device ua _cpu-rules _first _assemble ;

: parse ( data:str -- str )
  "Browser, device, engine, operating system and CPU architecture of a User-Agent string, in CyberChef's layout (Browser Name and Version; Device Model, Type and Vendor; Engine Name and Version; OS Name and Version; CPU Architecture), with unknown for what the rules do not find. CyberChef uses the ua-parser-js library; Forge uses its own table of rules (about 70 patterns: Chrome, Chromium, Edge, Firefox, Safari and Mobile Safari, Opera, Samsung Internet, UC, Yandex, Vivaldi, IE, the Android browser and a few apps; the Blink, WebKit, Gecko, Trident, EdgeHTML and Presto engines; Windows with the release name (NT 10.0 is 10), macOS, iOS, Android, Chromium OS, Ubuntu, Debian, Fedora, the BSDs, Solaris, Tizen and Linux; Apple, Samsung and Google devices, the model from Android build strings, consoles and smart TVs; the amd64, ia32, arm, arm64, ia64, ppc, mips and sparc CPUs), so a rare or new agent can come out differently. The first rule of each kind that matches wins. A leading User-Agent: label is ignored, and white space around the string is dropped. An agent of more than 4,096 characters is E_RANGE." doc
  "Networking" category
  data _clean _report ;

META: parse
  use-when "You have a User-Agent string from a web server log and want the browser, device, engine and operating system it names." ;
  see-also extract:urls uri:parse ;
  link "https://en.wikipedia.org/wiki/User_agent" "User agent on Wikipedia" ;
;
