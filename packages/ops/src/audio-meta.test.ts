/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Tests for the `audio-meta` vocabulary (vocab/audio-meta.fth, one primitive in src/prims/audio-meta.ts):
 * Extract Audio Metadata. The samples (src/fixtures/audio-meta.json) were made by ffmpeg 6.1 (libmp3lame
 * in CBR with an Info header, VBR with a Xing header and CBR without either, FLAC with a picture, Vorbis,
 * Opus, AAC in M4A with cover art, PCM in WAV, all with title, artist, album, date and track tags) and
 * the sample rate, channel count and duration of each were compared with `ffprobe -show_streams
 * -show_format` while the vectors were made (the table below is ffprobe's answer, typed). Opus: ffprobe
 * counts the pre-skip in the duration (0.1565 s); the Opus specification subtracts it (0.150 s, the
 * length of the audio that went in). The hand-built files below test what ffmpeg does not write: lying
 * sizes, lacing tables, 64-bit boxes, Ogg pages of several packets, every cut point and mutations.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import fixtures from "./fixtures/audio-meta.json";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["audio-meta", "id3"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const textOf = (r: Result) => (top(r) as { v: string }).v;
const extract = (d: Uint8Array) => runtime.call("audio-meta:extract", [bytes(d)]);
const fx = fixtures as unknown as Record<string, string | Record<string, string>>;
const sample = (name: string) =>
  Uint8Array.from(((fx[name] as string).match(/../g) ?? []).map((x) => parseInt(x, 16)));
const expected = fx.expected as Record<string, string>;
const text = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const le32 = (n: number) =>
  Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const be32 = (n: number) =>
  Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const indexOfBytes = (d: Uint8Array, n: Uint8Array): number => {
  for (let i = 0; i + n.length <= d.length; i++) if (n.every((b, k) => d[i + k] === b)) return i;
  return -1;
};
const line = (out: string, key: string) => new RegExp(`^${key}: (.*)$`, "m").exec(out)?.[1];

describe("the samples", () => {
  for (const name of Object.keys(expected)) {
    test(`${name}: the report`, async () => {
      expect(textOf(await extract(sample(name)))).toBe(expected[name]);
    });
  }

  // ffprobe's answers: [container line, sample rate, channels, duration in seconds]
  const ffprobe: Record<string, [string, string, string, string]> = {
    mp3_cbr: ["MPEG audio (MP3)", "16000 Hz", "1 (mono)", "0.252"],
    mp3_vbr: ["MPEG audio (MP3)", "16000 Hz", "1 (mono)", "0.252"],
    mp3_noxing: ["MPEG audio (MP3)", "16000 Hz", "1 (mono)", "0.252"],
    mp3_stereo: ["MPEG audio (MP3)", "44100 Hz", "2 (stereo)", "0.235"],
    flac: ["FLAC", "16000 Hz", "1", "0.150"],
    ogg: ["Ogg", "16000 Hz", "1", "0.150"],
    opus: ["Ogg", "48000 Hz (input; Opus decodes at 48000 Hz)", "2", "0.150"],
    m4a: ["MPEG-4 (brand M4A)", "16000 Hz", "1", "0.150"],
    wav: ["WAV (RIFF)", "16000 Hz", "1", "0.150"],
    wav8: ["WAV (RIFF)", "8000 Hz", "2", "0.100"],
  };
  for (const [name, [container, rate, channels, duration]] of Object.entries(ffprobe)) {
    test(`${name}: container, sample rate, channels and duration are ffprobe's`, async () => {
      const out = textOf(await extract(sample(name)));
      expect(line(out, "Container")).toBe(container);
      expect(line(out, "Sample rate")).toBe(rate);
      expect(line(out, "Channels")).toBe(channels);
      expect(line(out, "Duration")).toBe(`${duration} s`);
    });
  }

  test("tags", async () => {
    for (const name of ["flac", "ogg", "opus"]) {
      const out = textOf(await extract(sample(name)));
      expect(out, name).toContain("  title: Tone ü\n");
      expect(out, name).toContain("  artist: Tester\n");
      expect(out, name).toContain("  album: Lab\n");
      expect(out, name).toContain("  date: 2024\n");
      expect(out, name).toContain("  TRACKNUMBER: 2/9\n");
    }
    const m4a = textOf(await extract(sample("m4a")));
    expect(m4a).toContain("  Title: Tone ü\n  Artist: Tester\n  Album: Lab\n  Date: 2024\n");
    expect(m4a).toContain("  Track: 2/9\n");
    expect(m4a).toContain("  Cover art: image/png, 73 bytes\n");
    const wav = textOf(await extract(sample("wav")));
    expect(wav).toContain("  Title: Tone ü\n");
    expect(wav).toContain("  Track: 2/9\n");
    const flac = textOf(await extract(sample("flac")));
    expect(flac).toContain("  Picture: image/png, Other, 73 bytes\n");
    expect(line(flac, "Samples")).toBe("2400");
    expect(line(flac, "Audio MD5")).toMatch(/^[0-9a-f]{32}$/);
    for (const name of ["mp3_cbr", "mp3_vbr", "mp3_stereo"]) {
      const out = textOf(await extract(sample(name)));
      expect(out === undefined).toBe(false);
    }
    const mp3 = textOf(await extract(sample("mp3_cbr")));
    expect(mp3).toContain("ID3 tags:\n  ID3v2.4.0 tag:");
    expect(mp3).toContain("TIT2 (Title/songname/content description): Tone ü\n");
  });

  test("MP3 bit rates: CBR is the constant, VBR the average", async () => {
    expect(line(textOf(await extract(sample("mp3_noxing"))), "Bit rate")).toBe(
      "32 kbit/s (constant)",
    );
    expect(line(textOf(await extract(sample("mp3_vbr"))), "Bit rate")).toMatch(
      /^\d+ kbit\/s \(average, from the Xing header\)$/,
    );
    expect(line(textOf(await extract(sample("mp3_cbr"))), "Bit rate")).toMatch(
      /from the Info header/,
    );
  });

  test("an MP3 behind junk bytes, and an MP3 with an ID3v2 tag and an ID3v1 tag", async () => {
    const mp3 = sample("mp3_noxing");
    const tagged = cat(
      text("ID3"),
      Uint8Array.from([3, 0, 0, 0, 0, 0, 20]),
      new Uint8Array(20),
      mp3,
    );
    expect(line(textOf(await extract(tagged)), "Duration")).toBe("0.252 s");
    const v1 = cat(mp3, text("TAG"), new Uint8Array(125));
    expect(line(textOf(await extract(v1)), "Duration")).toBe("0.252 s");
  });
});

describe("what is not audio", () => {
  test("text, empty data, other formats and an MPEG frame header alone", async () => {
    for (const d of [
      text("hello, world"),
      new Uint8Array(0),
      text("GIF89a"),
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      Uint8Array.from([0xff, 0xfb]),
    ]) {
      expect(code(await extract(d))).toBe("E_COERCE");
    }
    expect(msg(await extract(text("hello, world")))).toContain("not a supported audio file");
    expect(
      msg(await extract(cat(Uint8Array.from([0xff, 0xfb, 0xf0, 0x64]), new Uint8Array(100)))),
    ).toContain("no MPEG audio frame");
  });
});

describe("cut-short and hostile files", () => {
  test(
    "every cut point of every sample is a result or E_COERCE",
    { timeout: 300_000 },
    async () => {
      for (const name of ["flac", "ogg", "opus", "m4a", "wav8", "mp3_vbr", "mp3_noxing"]) {
        const d = sample(name);
        const step = d.length > 2500 ? 3 : 1;
        for (let k = 0; k < d.length; k += step) {
          const r = await extract(d.subarray(0, k));
          expect(["ok", "E_COERCE"], `${name} cut at ${k}`).toContain(code(r));
          if (k < 4) expect(code(r), `${name} cut at ${k}`).toBe("E_COERCE");
        }
      }
    },
  );

  test("sizes and counts that lie allocate nothing", async () => {
    const t0 = Date.now();
    const cases: [string, Uint8Array][] = [
      [
        "FLAC block length 16 MiB",
        cat(text("fLaC"), Uint8Array.from([0x80, 0xff, 0xff, 0xff]), new Uint8Array(40)),
      ],
      ["FLAC streaminfo of 3 bytes", cat(text("fLaC"), Uint8Array.from([0x80, 0, 0, 3, 1, 2, 3]))],
      ["FLAC with no streaminfo", cat(text("fLaC"), Uint8Array.from([0x81, 0, 0, 2, 1, 2]))],
      [
        "FLAC comment lengths 2^32-1",
        cat(
          text("fLaC"),
          Uint8Array.from([0x04, 0, 0, 38]),
          new Uint8Array(34),
          Uint8Array.from([0x84, 0, 0, 12]),
          le32(0xffffffff),
          le32(1),
          le32(0xffffffff),
        ),
      ],
      [
        "Ogg 255 lacing values",
        cat(
          text("OggS"),
          Uint8Array.from([
            0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255,
          ]),
          new Uint8Array(255).fill(255),
          new Uint8Array(100),
        ),
      ],
      [
        "WAV chunk 4 GiB",
        cat(text("RIFF"), le32(100), text("WAVEfmt "), le32(0xffffffff), new Uint8Array(40)),
      ],
      [
        "WAV data chunk 4 GiB",
        cat(
          text("RIFF"),
          le32(0xffffffff),
          text("WAVEfmt "),
          le32(16),
          Uint8Array.from([1, 0, 1, 0, 0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0]),
          text("data"),
          le32(0xffffffff),
          new Uint8Array(8),
        ),
      ],
      [
        "MP4 box 4 GiB",
        cat(
          be32(0x14),
          text("ftypM4A "),
          new Uint8Array(8),
          be32(0xffffffff),
          text("moov"),
          new Uint8Array(40),
        ),
      ],
      [
        "MP4 64-bit box over 2^53",
        cat(
          be32(0x14),
          text("ftypM4A "),
          new Uint8Array(8),
          be32(1),
          text("moov"),
          Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        ),
      ],
      [
        "MP4 moov with nothing",
        cat(be32(0x14), text("ftypM4A "), new Uint8Array(8), be32(8), text("moov")),
      ],
    ];
    for (const [name, d] of cases) {
      const r = await extract(d);
      expect(["ok", "E_COERCE"], name).toContain(code(r));
    }
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(msg(await extract(cases[0]?.[1] as Uint8Array))).toContain(
      "runs past the end of the data",
    );
    expect(msg(await extract(cases[1]?.[1] as Uint8Array))).toContain("STREAMINFO");
    expect(msg(await extract(cases[2]?.[1] as Uint8Array))).toContain("no STREAMINFO");
  });

  test("an Xing header with a huge frame count is a number, not an allocation", async () => {
    const d = sample("mp3_vbr").slice();
    const at = indexOfBytes(d, text("Xing"));
    expect(at).toBeGreaterThan(0);
    d.set(be32(0xffffffff), at + 8);
    const r = await extract(d);
    expect(code(r)).toBe("ok");
    expect(textOf(r)).toContain("Duration: ");
  });

  test("Ogg: a comment packet that spans several pages, and a stream with a granule of -1", async () => {
    const page = (
      seq: number,
      flags: number,
      granule: Uint8Array,
      lace: number[],
      body: Uint8Array,
      serial = 7,
    ) =>
      cat(
        text("OggS"),
        Uint8Array.from([0, flags]),
        granule,
        le32(serial),
        le32(seq),
        le32(0),
        Uint8Array.from([lace.length, ...lace]),
        body,
      );
    const ident = cat(
      text("\x01vorbis"),
      le32(0),
      Uint8Array.from([2]),
      le32(44100),
      le32(0),
      le32(128000),
      le32(0),
      Uint8Array.from([0xb8, 1]),
    );
    const comment = (n: number) => {
      const entry = text(`NOTE=${"x".repeat(n)}`);
      return cat(
        text("\x03vorbis"),
        le32(4),
        text("test"),
        le32(1),
        le32(entry.length),
        entry,
        Uint8Array.from([1]),
      );
    };
    const c = comment(800);
    const laceOf = (n: number) => [
      ...Array.from({ length: Math.floor(n / 255) }, () => 255),
      n % 255,
    ];
    // the comment packet split over two pages: 255 + 255 + the rest on the first page, the continuation on the second
    const first = c.subarray(0, 510);
    const second = c.subarray(510);
    const g0 = new Uint8Array(8);
    const gEnd = Uint8Array.from([0x44, 0xac, 0, 0, 0, 0, 0, 0]);
    const stream = cat(
      page(0, 2, g0, [ident.length], ident),
      page(1, 0, new Uint8Array(8).fill(0xff), [255, 255], first),
      page(2, 1, g0, laceOf(second.length), second),
      page(3, 4, gEnd, [1], Uint8Array.from([0])),
    );
    const out = textOf(await extract(stream));
    expect(out).toContain("Codec: Vorbis\n");
    expect(line(out, "Sample rate")).toBe("44100 Hz");
    expect(line(out, "Channels")).toBe("2");
    expect(line(out, "Duration")).toBe("1.000 s");
    expect(out).toContain("Encoder vendor: test\n");
    expect(out).toContain(`  NOTE: ${"x".repeat(800)}\n`);
    const unknown = stream.slice();
    unknown.set(new Uint8Array(8).fill(0xff), stream.length - 29 + 6);
    expect(textOf(await extract(unknown))).not.toContain("Duration");
  });

  test("MP4 with 64-bit box sizes and a box that runs to the end of the data", async () => {
    const latin1 = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
    const box = (type: string, payload: Uint8Array) =>
      cat(be32(payload.length + 8), latin1(type), payload);
    const big = (type: string, payload: Uint8Array) =>
      cat(be32(1), latin1(type), be32(0), be32(payload.length + 16), payload);
    const mvhd = box("mvhd", cat(new Uint8Array(12), be32(1000), be32(2500), new Uint8Array(80)));
    const item = (type: string, value: string) =>
      box(type, box("data", cat(be32(1), be32(0), text(value))));
    const ilst = box("ilst", cat(item("\xa9nam", "Name"), item("\xa9alb", "Disc")));
    const meta = box("meta", cat(new Uint8Array(4), ilst));
    const moov = big("moov", cat(mvhd, box("udta", meta)));
    const file = cat(
      box("ftyp", cat(text("M4A "), new Uint8Array(8))),
      moov,
      cat(be32(0), text("mdat"), new Uint8Array(10)),
    );
    const out = textOf(await extract(file));
    expect(line(out, "Duration")).toBe("2.500 s");
    expect(out).toContain("  Title: Name\n  Album: Disc\n");
  });

  test("WAV: a data chunk longer than the file, an odd chunk, no LIST", async () => {
    const fmt = cat(
      text("fmt "),
      le32(16),
      Uint8Array.from([1, 0, 1, 0]),
      le32(8000),
      le32(16000),
      Uint8Array.from([2, 0, 16, 0]),
    );
    const odd = cat(text("junk"), le32(3), Uint8Array.from([1, 2, 3, 0]));
    const wav = cat(
      text("RIFF"),
      le32(1000000),
      text("WAVE"),
      odd,
      fmt,
      text("data"),
      le32(0x7fffffff),
      new Uint8Array(32000),
    );
    const out = textOf(await extract(wav));
    expect(line(out, "Duration")).toBe("2.000 s");
    expect(line(out, "Codec")).toBe("PCM");
  });

  test("mutated files give a report or E_COERCE, nothing else", { timeout: 120_000 }, async () => {
    let seed = 21;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (const name of ["flac", "ogg", "opus", "m4a", "wav8", "mp3_vbr", "mp3_stereo"]) {
      const base = sample(name);
      for (let k = 0; k < 80; k++) {
        const d = base.slice();
        for (let j = 0; j < 3; j++) d[next() % d.length] = next() & 0xff;
        const r = await extract(d);
        expect(["ok", "E_COERCE"], `${name} ${k}`).toContain(code(r));
        if (r.ok) expect(textOf(r).length).toBeLessThan(200_000);
      }
    }
  });
});

describe("cost", () => {
  test("a 64 KiB FLAC file whose comment block holds 2,000 comments", async () => {
    const entries = Array.from({ length: 3000 }, (_, i) => text(`K${i}=value ${i}`));
    const block = cat(
      le32(4),
      text("test"),
      le32(entries.length),
      ...entries.map((e) => cat(le32(e.length), e)),
    );
    const info = new Uint8Array(34);
    info.set([0x10, 0x00, 0x10, 0x00]);
    info.set([0x0a, 0xc4, 0x42, 0xf0, 0x00, 0x00, 0x00, 0x64], 10);
    const hdr = (t: number, last: boolean, n: number) =>
      Uint8Array.from([(last ? 0x80 : 0) | t, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
    const flac = cat(text("fLaC"), hdr(0, false, 34), info, hdr(4, true, block.length), block);
    expect(flac.length).toBeLessThan(70_000);
    const t0 = Date.now();
    const r = await extract(flac);
    const out = textOf(r);
    expect(out).toContain("  K1999: value 1999\n");
    expect(out).not.toContain("K2000:");
    expect(Date.now() - t0).toBeLessThan(5000);
    // one VM step to read it and about 30 to lay out each comment
    expect(r.ok && r.steps).toBeLessThan(200_000);
  });

  test("Ogg of 64 KiB made of small pages: only the first packets are read", async () => {
    const page = (seq: number, body: Uint8Array) =>
      cat(
        text("OggS"),
        Uint8Array.from([0, 0]),
        new Uint8Array(8),
        le32(1),
        le32(seq),
        le32(0),
        Uint8Array.from([1, body.length]),
        body,
      );
    const ident = cat(
      text("\x01vorbis"),
      le32(0),
      Uint8Array.from([1]),
      le32(8000),
      le32(0),
      le32(0),
      le32(0),
      Uint8Array.from([0xb8, 1]),
    );
    const comment = cat(text("\x03vorbis"), le32(1), text("v"), le32(0), Uint8Array.from([1]));
    const pages = [
      page(0, ident),
      page(1, comment),
      ...Array.from({ length: 1500 }, (_, i) => page(2 + i, new Uint8Array(20))),
    ];
    const file = cat(...pages);
    expect(file.length).toBeGreaterThan(60_000);
    const r = await extract(file);
    expect(textOf(r)).toContain("Codec: Vorbis\n");
    expect(r.ok && r.steps).toBeLessThan(1_000);
  });
});
