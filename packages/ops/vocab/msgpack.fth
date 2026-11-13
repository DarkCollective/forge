\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ msgpack: MessagePack, the CyberChef operations To MessagePack and From MessagePack. The encoder takes JSON text and
\ writes bytes, the decoder reads bytes and writes JSON text (CyberChef's shape). The object walk is two private
\ primitives (msgpack:_decode and msgpack:_encode, src/prims/msgpack.ts; a node-by-node reader in FL costs several
\ hundred VM steps an element); the JSON text side is the shared json words, and the parameters are FL.
IN: msgpack

USING: json ;

: decode ( data:bytes indent:int=4 -- str )
  "Read one MessagePack object and write it as JSON text, as CyberChef's From MessagePack does. Every format of the specification is read: nil, booleans, fixints and the 8 to 64-bit integers (exact), float 32 and 64, str (strict UTF-8), bin, arrays, maps and the extension types. A binary string is shown as {\"type\":\"Buffer\",\"data\":[...]} (what JSON.stringify makes of a Buffer); the timestamp extension (type -1, 4, 8 or 12 bytes) is shown as ISO 8601 text, with three fractional digits (more only when the nanoseconds need them); any other extension is {\"ext\":N,\"data\":{\"type\":\"Buffer\",...}}. NaN and the infinities are null, as JSON.stringify writes them. A map key that is not text is written as the text of an integer, float, boolean or nil (any other key is E_COERCE) and a repeated key is E_COERCE. The input must be exactly one object: empty input, bytes after it, a truncated object, the unused code 0xc1, invalid UTF-8, a bad timestamp and nesting deeper than 64 levels are E_COERCE with the offset. indent is the spaces per level (default 4; 0 gives compact text)." doc
  "Data format" category
  data msgpack:_decode indent json:stringify ;

META: decode
  use-when "You have MessagePack bytes from a cache, a message queue or an RPC call, and want to read them as JSON." ;
  checks input binary ;
  expects "MessagePack data" ;
  param indent "Spaces per level; 0 writes compact JSON." ;
  see-also msgpack:encode ;
  inverse encode ;
  link "https://msgpack.org/" "MessagePack home page" ;
  link "https://en.wikipedia.org/wiki/MessagePack" "MessagePack on Wikipedia" ;
;

: encode ( data:str typed-objects:bool=false -- bytes )
  "Write JSON text as MessagePack, as CyberChef's To MessagePack does, each value in the shortest format that holds it: positive integers as uint, negative as int (from -2^63 to 2^64-1, else E_COERCE), numbers with a fraction or exponent as float 64 (as CyberChef and Python write them), text as fixstr, str 8, 16 or 32, arrays and maps in the order given, null as nil. With typed-objects on, the shapes the decoder writes are read back: {\"type\":\"Buffer\",\"data\":[...]} is a bin value, {\"ext\":N,\"data\":{\"type\":\"Buffer\",...}} an extension of type N, and {\"timestamp\":\"2020-01-02T03:04:05.678Z\"} the shortest timestamp extension (32, 64 or 96 bits). Text that is not JSON, or nesting deeper than 64 levels, is E_COERCE." doc
  "Data format" category
  data json:parse typed-objects msgpack:_encode ;

META: encode
  use-when "You have JSON data and need MessagePack bytes, for example to send a test payload to a service that expects MessagePack." ;
  param typed-objects "Write {\"type\":\"Buffer\",\"data\":[...]} as bin, {\"ext\":N,\"data\":...} as an extension and {\"timestamp\":\"...\"} as a timestamp, instead of as maps." ;
  see-also msgpack:decode ;
  inverse decode ;
  link "https://msgpack.org/" "MessagePack home page" ;
  link "https://en.wikipedia.org/wiki/MessagePack" "MessagePack on Wikipedia" ;
;
