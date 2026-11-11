\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ plist: P-list Viewer, the CyberChef operation of that name, for XML property lists and (an addition) binary
\ "bplist00" ones. The reader and the outline are one private primitive (plist:_view, src/prims/plist.ts; a
\ character scanner is too slow in FL).
IN: plist

: view ( data:bytes -- str )
  "Show an Apple property list as an outline in the layout of CyberChef's P-list Viewer: the first line is plist => and the root, the last is /plist, a dictionary is { ... } with one key => value line per entry, an array is [ ... ] with one index => item line per item (the index counts from 0), one tab per level, and a nested dictionary or array opens on the line of its key or index. Strings are shown in double quotes, numbers in decimal, true and false, dates as ISO 8601 text and data as Base64 text. XML property lists (the plist 1.0 DTD, with comments, CDATA and the usual entities) and, as an addition to CyberChef, binary lists that start with bplist00 are read; a binary date is converted from seconds since 2001-01-01 and a UID is UID(n). Empty input, an unknown element, a key without a value, a mismatched tag, text after the plist, a damaged binary list (offsets, references, counts, cycles) and nesting deeper than 64 levels are E_COERCE with the offset." doc
  "Data format" category
  data plist:_view ;

META: view
;
