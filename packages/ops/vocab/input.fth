\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ input: the core source that reads an input tab of the bake as raw bytes (RECIPES-1.2.md section 7, RELIX.md 3.2.1).
\ It works with no pack enabled. The one primitive (src/prims/input.ts) asks the named inputs of the bake, which the
\ baker provides (src/input-host.ts); the word and its documentation are FL.
\
\   input:tab ( any tab:str -- bytes )   the bytes of the tab with this exact name; the data above it is ignored
\
\ relix:input is FL over input:tab: there is one reader of tabs.
IN: input

: tab ( any tab:str -- bytes )
  "Read an input tab of the bake as raw bytes, exactly as the page holds them: no decoding, no byte order mark handling and no line ending change. It starts a recipe or a lane and ignores the data above it. The name is matched exactly (capitals count, nothing is trimmed). A name the bake does not have is E_PARAM_INVALID, and the error lists the names that are available. Use it first when the tab needs byte steps before it is parsed, such as Base64, decompression or another character set." doc
  "Input" category
  drop tab input:_read ;

META: tab
  use-when "The recipe starts from a named tab and the tab needs byte steps first (Base64, decompression, another character set) before it is parsed." ;
  param tab "The exact name of an input tab of the bake." ;
  expects "Any data, which is ignored" ;
;
