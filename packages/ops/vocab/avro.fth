\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ avro: Avro to JSON, the CyberChef operation of that name, for Avro Object Container Files. The container is walked
\ by avro:_header (magic, metadata, blocks, sync markers) and the data of a block by avro:_decode, both private
\ primitives in src/prims/avro.ts (a node-by-node reader in FL costs several hundred VM steps an element). The codec
\ choice, the deflate codec (the deflate words), the joining of the blocks and the JSON text are FL.
IN: avro

USING: json deflate ;

\ The codecs that are read; the others are named in the error.
: _check-codec ( codec:str -- )
  codec "null" = codec "deflate" = or not [
    "the Avro codec " codec cat " is not supported (only null and deflate are)" cat raise:coerce
  ] when ;

: _block-bytes ( data:bytes codec:str -- bytes )
  codec "deflate" = [ data 0 deflate:inflate ] [ data ] if ;

: _block ( acc:list b:record schema:str codec:str -- list )
  acc  b "data" get codec _block-bytes  schema  b "count" get  avro:_decode  cat ;

: _all ( schema:str codec:str blocks:list -- list )
  codec _check-codec
  blocks { } [ schema codec _block ] reduce ;

: to-json ( data:bytes force-valid-json:bool=true indent:int=4 -- str )
  "Read an Avro Object Container File (Apache Avro 1.11) and write its records as JSON text, as CyberChef's Avro to JSON does: the schema comes from the file header, the codec is null or deflate (any other, such as snappy, zstandard, bzip2 or xz, is E_COERCE naming it), the sync markers are checked. With force-valid-json on (the default, as in CyberChef) the records are one JSON array indented by indent spaces (CyberChef writes a file with a single record as that object alone, not as an array of one; Forge always writes the array, so that the type of the result does not depend on the number of records); with it off each record is one line of compact JSON, every line ending with a line break (CyberChef's layout). A long is an exact integer, float and double are numbers, bytes and fixed are {\"type\":\"Buffer\",\"data\":[...]} (what JSON.stringify makes of the Buffer CyberChef decodes to), an enum is its symbol, a union is the value of its branch (not wrapped in {\"type\":value}), a map is an object, logical types are shown as their underlying values. A file with no records gives empty text (or [] when forcing). A file that is not Avro, a cut-short or damaged block, a wrong sync marker, an invalid schema or datum, bytes after the last block and nesting deeper than 64 levels are E_COERCE with the offset. indent is the spaces per level of the array (default 4, as CyberChef writes it; 0 gives compact text; it is not used with force-valid-json off); this parameter is an addition to CyberChef's." doc
  "Data format" category
  data avro:_header _all
  force-valid-json [ indent json:stringify ] [ [ 0 json:stringify "\n" cat ] map "" join ] if ;

META: to-json
  param force-valid-json "Write the records as one JSON array; off writes one line of JSON per record." ;
  param indent "Spaces per level of the array; 0 writes compact JSON. Not used when force-valid-json is off." ;
;
