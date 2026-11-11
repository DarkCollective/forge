\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ audio-meta: Extract Audio Metadata (CyberChef 11's op): the container metadata of an audio file, without
\ decoding any audio. MP3 (the first MPEG audio frame: version, layer, bit rate, sample rate, channels; the
\ Xing, Info or VBRI header for the frame count; the ID3 tags through id3:extract), FLAC (STREAMINFO, the
\ Vorbis comments and pictures), Ogg (Vorbis, Opus or Speex: the identification packet, the comment packet and
\ the granule position of the last page for the duration), WAV (the fmt chunk, the data size and the LIST INFO
\ tags) and MP4 or M4A (ftyp, mvhd, the sample entry of the audio track and the ilst tags). The container
\ walks are one private primitive (src/prims/audio-meta.ts, with the reason there); the report layout is FL.
IN: audio-meta

USING: id3 ;

: _pair-line ( pair:list -- str )
  pair 0 nth ": " cat pair 1 nth cat "\n" cat ;

: _tag-lines ( lines:list -- str )
  lines len 0 = [ "" ] [ "Tags:\n" lines [ "  " swap cat "\n" cat ] map "" join cat ] if ;

\ The ID3 tags of an MP3 file, indented under a heading; nothing when there are none.
: _id3-block ( data:bytes -- str )
  data id3:extract dup "No ID3 tag found.\n" = [ drop "" ] [
    "\n" split [ len 0 > ] filter [ "  " swap cat "\n" cat ] map "" join "ID3 tags:\n" swap cat ] if ;

: extract ( data:bytes -- str )
  "Extract Audio Metadata: the container metadata of an audio file, read without decoding any audio. MP3: the MPEG version and layer, bit rate, sample rate, channels, the duration (from the Xing, Info or VBRI frame count when there is one, else from the bit rate) and the ID3 tags as Extract ID3 shows them. FLAC: duration, sample rate, channels, bits per sample, sample count, the MD5 of the audio, the encoder vendor, the Vorbis comments and the pictures (type and size). Ogg: Vorbis, Opus or Speex with the sample rate, channels, duration, vendor and comments. WAV: format, sample rate, channels, bits per sample, duration and the LIST INFO tags. MP4 and M4A: brand, codec, sample rate, channels, duration and the ilst tags (title, artist, album, date, genre, track, cover art size). The result is lines of Name: value, then Tags: and the tag lines. Data that is not one of these formats, or a structure that runs past the data, is E_COERCE with the offset." doc
  "Extractors" category
  data _read dup "info" get [ _pair-line ] map "" join
  swap dup "tags" get _tag-lines swap "id3" get [ data _id3-block ] [ "" ] if cat cat ;

META: extract
  see-also id3:extract exif:extract filetype:detect ;
;
