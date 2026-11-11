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
 * Tests for the `id3` vocabulary (vocab/id3.fth): Extract ID3. The samples (src/fixtures/id3.json) come
 * from a small ID3 writer in Python that follows the ID3v2.2, 2.3 and 2.4 and ID3v1 documents (every
 * text encoding, the whole-tag unsynchronisation of 2.3, the extended header, per-frame unsynchronisation
 * and data length indicators of 2.4, padding, APIC and PIC, PRIV, POPM, GEOB, UFID, USLT, a compressed
 * frame) around an MPEG audio stream made by ffmpeg, and from ffmpeg itself (`-id3v2_version 3|4`, with a
 * cover). The text each tag must give was typed from the values that went into the writer, never taken
 * from this op's output. ffprobe 6.1 read the same files and gave the same titles, artists, albums,
 * comments, genres, user text and lyrics (it cannot read a v2.3 tag with whole-tag unsynchronisation:
 * ffmpeg applies the per-frame rule of v2.4 to it; the layout used here is the one of the ID3v2.3.0
 * document, section 5, and of mutagen). The genre table is checked against the strings of libavformat.
 * Also here: every cut point, sizes that lie, empty and short frames, mutated files and 64 KiB tags
 * with the VM step counts.
 */
import { valueHelpers } from "@forge/lang";
import type { Value } from "@forge/lang";
import { describe, expect, test } from "vitest";
import { assembleRuntime } from "./bundle.js";
import fixtures from "./fixtures/id3.json";
import { loadBundleNode } from "./sources-node.js";

const { bytes } = valueHelpers;
const runtime = assembleRuntime(await loadBundleNode(["id3"]));

type Result = Awaited<ReturnType<typeof runtime.call>>;
const top = (r: Result): Value => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.stack[r.stack.length - 1] as Value;
};
const code = (r: Result) => (r.ok ? "ok" : r.error.code);
const msg = (r: Result) => (r.ok ? "" : r.error.message);
const textOf = (r: Result) => (top(r) as { v: string }).v;
const extract = (d: Uint8Array) => runtime.call("id3:extract", [bytes(d)]);
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
const syncsafe = (n: number) =>
  Uint8Array.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const be32 = (n: number) =>
  Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
/** An ID3v2.3 tag with the given frames (id, data), no padding. */
function tag3(frames: [string, Uint8Array][], flags = 0): Uint8Array {
  const body = cat(
    ...frames.map(([id, d]) => cat(text(id), be32(d.length), Uint8Array.from([0, 0]), d)),
  );
  return cat(text("ID3"), Uint8Array.from([3, 0, flags]), syncsafe(body.length), body);
}
const tit2 = (s: string) => cat(Uint8Array.from([0]), text(s));

describe("the tags of each version, byte for byte as written", () => {
  for (const name of Object.keys(expected)) {
    test(`${name}`, async () => {
      expect(textOf(await extract(sample(name)))).toBe(expected[name]);
    });
  }

  test("a file with no tag", async () => {
    expect(textOf(await extract(sample("none")))).toBe("No ID3 tag found.\n");
    expect(textOf(await extract(new Uint8Array(0)))).toBe("No ID3 tag found.\n");
    expect(textOf(await extract(text("ID3")))).toBe("No ID3 tag found.\n");
  });

  test("the whole-tag unsynchronisation and the extended header give the same frames as neither", async () => {
    const frames = (s: string) => s.split("\n").slice(1).join("\n");
    const plain = frames(textOf(await extract(sample("v23_full_noext"))));
    expect(frames(textOf(await extract(sample("v23_unsync"))))).toBe(plain);
    expect(frames(textOf(await extract(sample("v23_ext"))))).toBe(plain);
  });

  test("files made by ffmpeg (ID3v2.3 and 2.4, a cover, an ID3v1.1 tag)", async () => {
    for (const name of ["ffmpeg_v23", "ffmpeg_v24"]) {
      const out = textOf(await extract(sample(name)));
      expect(out, name).toContain("TIT2 (Title/songname/content description): Tone ü\n");
      expect(out).toContain("TPE1 (Lead performer(s)/Soloist(s)): Tester\n");
      expect(out).toContain("TALB (Album/Movie/Show title): Lab\n");
      expect(out).toContain("TCON (Content type): Electronic\n");
      expect(out).toContain("TRCK (Track number/Position in set): 2/9\n");
      expect(out).toContain(
        "TXXX (User defined text information frame): comment: made with ffmpeg\n",
      );
      expect(out).toContain(
        'APIC (Attached picture): image/png, Cover (front), 73 bytes, "Album cover"\n',
      );
      expect(out).toContain("\nID3v1.1 tag\n  Title: Tone ü\n");
      expect(out).toContain("  Track: 2\n  Genre: Electronic (52)\n");
    }
  });

  test("ID3v1 genres: the standard 80 and the Winamp extensions", async () => {
    const pad = (n: number) => Uint8Array.from({ length: n }, () => 0);
    const v1 = (g: number) => cat(text("TAG"), pad(30 + 30 + 30 + 4 + 30), Uint8Array.from([g]));
    const want: Record<number, string> = {
      0: "Blues (0)",
      17: "Rock (17)",
      79: "Hard Rock (79)",
      80: "Folk (80)",
      123: "A Cappella (123)",
      147: "Synthpop (147)",
      148: "Unknown (148)",
      191: "Unknown (191)",
      192: "Unknown (192)",
      254: "Unknown (254)",
      255: "not set",
    };
    for (const [g, name] of Object.entries(want)) {
      expect(textOf(await extract(v1(Number(g)))), `genre ${g}`).toContain(`  Genre: ${name}\n`);
    }
  });

  test("TCON references: (17), (17)Rock, 17, several, and text", async () => {
    const run = async (v: string) => textOf(await extract(tag3([["TCON", tit2(v)]])));
    expect(await run("(17)")).toContain("TCON (Content type): Rock (17)\n");
    expect(await run("(17)Hard Rock")).toContain("TCON (Content type): Hard Rock\n");
    expect(await run("13")).toContain("TCON (Content type): Pop (13)\n");
    expect(await run("(13)")).toContain("Pop (13)");
    expect(await run("(RX)")).toContain("TCON (Content type): (RX)\n");
    expect(await run("Bossa Nova")).toContain("TCON (Content type): Bossa Nova\n");
    expect(await run("(17)(0)")).toContain("TCON (Content type): ");
  });
});

describe("empty, short and odd frames", () => {
  test("every frame type with no data or too little data", async () => {
    const ids = [
      "TIT2",
      "TXXX",
      "WXXX",
      "WOAF",
      "COMM",
      "USLT",
      "APIC",
      "PRIV",
      "UFID",
      "POPM",
      "PCNT",
      "GEOB",
      "MCDI",
      "ZZZZ",
    ];
    for (const id of ids) {
      for (const data of [
        new Uint8Array(0),
        Uint8Array.from([0]),
        Uint8Array.from([1]),
        Uint8Array.from([3, 0x65]),
        Uint8Array.from([0, 0, 0, 0, 0]),
      ]) {
        const r = await extract(tag3([[id, data]]));
        expect(code(r), `${id} ${data.length}`).toBe("ok");
        expect(textOf(r)).toContain(`${id}`);
      }
    }
    expect(textOf(await extract(tag3([["TIT2", new Uint8Array(0)]])))).toContain(
      "TIT2 (Title/songname/content description): (empty)\n",
    );
  });

  test("text encodings: ISO-8859-1, UTF-16 with and without a mark, UTF-8, a surrogate pair and a lone surrogate", async () => {
    const run = async (enc: number, payload: number[]) =>
      textOf(await extract(tag3([["TIT2", Uint8Array.from([enc, ...payload])]])));
    expect(await run(0, [0xe9, 0x74, 0xe9])).toContain("): été\n");
    expect(await run(1, [0xff, 0xfe, 0x41, 0x00, 0x3d, 0xd8, 0x00, 0xde])).toContain(
      "): A\u{1F600}\n",
    );
    expect(await run(1, [0xfe, 0xff, 0x00, 0x41, 0xd8, 0x3d, 0xde, 0x00])).toContain(
      "): A\u{1F600}\n",
    );
    expect(await run(2, [0x00, 0x42])).toContain("): B\n");
    expect(await run(3, [0xf0, 0x9f, 0x98, 0x80])).toContain("): \u{1F600}\n");
    expect(await run(1, [0xff, 0xfe, 0x3d, 0xd8, 0x41, 0x00])).toContain("): �A\n");
    expect(await run(1, [0xff, 0xfe, 0x00, 0xde, 0x41, 0x00])).toContain("): �A\n");
    expect(await run(1, [0xff, 0xfe, 0x41])).toContain(
      "TIT2 (Title/songname/content description): \n",
    );
    expect(await run(9, [0x41, 0x42])).toContain("): AB\n");
    expect(await run(0, [0x61, 0, 0x62])).toContain("): a; b\n");
  });
});

describe("cut-short and hostile tags", () => {
  test("every cut point of the tags: no tag, or E_COERCE inside it, or the whole tag", async () => {
    for (const name of ["v22_full", "v24_full", "v23_ext"]) {
      const d = sample(name);
      const tagSize = d.length - sample("none").length;
      for (let k = 0; k <= tagSize; k++) {
        const r = await extract(d.subarray(0, k));
        expect(["ok", "E_COERCE"], `${name} cut at ${k}`).toContain(code(r));
        if (k >= 10 && k < tagSize) expect(code(r), `${name} cut at ${k}`).toBe("E_COERCE");
        if (k < 10) expect(textOf(r), `${name} cut at ${k}`).toBe("No ID3 tag found.\n");
      }
    }
  }, 60_000);

  test("a tag size or a frame size that lies allocates nothing and fails with the offset", async () => {
    const big = cat(
      text("ID3"),
      Uint8Array.from([3, 0, 0]),
      syncsafe(0x0fffffff),
      text("TIT2"),
      be32(5),
      Uint8Array.from([0, 0, 0, 65]),
    );
    const r1 = await extract(big);
    expect(code(r1)).toBe("E_COERCE");
    expect(msg(r1)).toContain("declares 268435455 bytes after its header but only");
    const lie3 = tag3([["TIT2", tit2("x")]]);
    lie3.set(be32(0xffffffff), 10 + 4);
    const r2 = await extract(lie3);
    expect(code(r2)).toBe("E_COERCE");
    expect(msg(r2)).toContain("the ID3v2 frame TIT2 at offset 0 declares 4294967295 bytes");
    const lie4 = cat(
      text("ID3"),
      Uint8Array.from([4, 0, 0]),
      syncsafe(20),
      text("TIT2"),
      syncsafe(0x0fffffff),
      Uint8Array.from([0, 0]),
      new Uint8Array(6),
    );
    expect(code(await extract(lie4))).toBe("E_COERCE");
    // a size that is not syncsafe in v2.4 is read as a plain number (some writers do that)
    const plain4 = cat(
      text("ID3"),
      Uint8Array.from([4, 0, 0]),
      syncsafe(13),
      text("TIT2"),
      be32(3),
      Uint8Array.from([0, 0]),
      Uint8Array.from([3, 0x41, 0x42]),
    );
    expect(textOf(await extract(plain4))).toContain("): AB\n");
  });

  test("an extended header that lies, padding in the middle and garbage after the frames", async () => {
    const e = tag3([["TIT2", tit2("x")]], 0x40);
    expect(["ok", "E_COERCE"]).toContain(code(await extract(e)));
    const extBody = cat(
      be32(0x7fffffff),
      Uint8Array.from([0, 0, 0, 0, 0, 0]),
      text("TIT2"),
      be32(2),
      Uint8Array.from([0, 0, 0, 0x41]),
    );
    const ext = cat(text("ID3"), Uint8Array.from([3, 0, 0x40]), syncsafe(extBody.length), extBody);
    expect(textOf(await extract(ext))).toContain(
      "ID3v2.3.0 tag: 32 bytes, 0 frames (extended header)",
    );
    const pad = cat(tag3([["TIT2", tit2("a")]]).subarray(0, 10 + 11), new Uint8Array(30));
    const fixed = pad.slice();
    fixed.set(syncsafe(11 + 30), 6);
    expect(textOf(await extract(fixed))).toContain("1 frame\n");
    const junk = tag3([["TIT2", tit2("a")]], 0);
    const withJunk = cat(junk.subarray(0, 10 + 11), text("zz!!zz!!zz!!"));
    withJunk.set(syncsafe(11 + 12), 6);
    expect(textOf(await extract(withJunk))).toContain("1 frame\n");
  });

  test("a v2.2 tag with the compression flag is named, not decoded", async () => {
    const body = text("xxxxxxxxxxxxxxxxxxxx");
    const t = cat(text("ID3"), Uint8Array.from([2, 0, 0x40]), syncsafe(body.length), body);
    const out = textOf(await extract(t));
    expect(out).toContain("ID3v2.2.0 tag: 30 bytes, 0 frames (compression)\n");
    expect(out).toContain("the tag is compressed and is not decoded");
  });

  test("mutated files give a result or E_COERCE, nothing else", async () => {
    let seed = 5;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    for (const name of ["v23_full", "v24_full", "v22_full", "ffmpeg_v24", "v1_only"]) {
      const base = sample(name);
      const limit = name === "v1_only" ? base.length : 600;
      for (let k = 0; k < 80; k++) {
        const d = base.slice();
        for (let j = 0; j < 3; j++) d[next() % Math.min(limit, d.length)] = next() & 0xff;
        if (name === "v1_only")
          for (let j = 0; j < 3; j++) d[d.length - 1 - (next() % 128)] = next() & 0xff;
        const r = await extract(d);
        expect(["ok", "E_COERCE"], `${name} ${k}`).toContain(code(r));
        if (r.ok) expect(textOf(r).length).toBeLessThan(200_000);
      }
    }
  }, 60_000);
});

describe("cost", () => {
  test("a 64 KiB tag of 1,200 small frames: the first 1,000 are read", async () => {
    const frames: [string, Uint8Array][] = Array.from({ length: 1200 }, (_, i) => [
      "TIT2",
      tit2(`title ${i}`),
    ]);
    const t = tag3(frames);
    expect(t.length).toBeLessThan(40_000);
    const t0 = Date.now();
    const r = await extract(t);
    const out = textOf(r);
    expect(out.startsWith("ID3v2.3.0 tag:")).toBe(true);
    expect(out).toContain(", 1000 frames\n");
    expect(out).toContain("title 999\n");
    expect(out).not.toContain("title 1000\n");
    expect(Date.now() - t0).toBeLessThan(10_000);
    // about 1,800 VM steps a frame (the frame loop, the name lookup and the line)
    expect(r.ok && r.steps).toBeLessThan(3_000_000);
  }, 60_000);

  test("a 64 KiB tag with one big picture costs little", async () => {
    const png = cat(
      Uint8Array.from([0]),
      text("image/png"),
      Uint8Array.from([0, 3, 0]),
      new Uint8Array(64_000).fill(7),
    );
    const r = await extract(tag3([["APIC", png]]));
    expect(textOf(r)).toContain("image/png, Cover (front), 64000 bytes");
    expect(r.ok && r.steps).toBeLessThan(8_000);
  });

  test("a 64 KiB tag that is one text frame with a UTF-16 string", async () => {
    const units = new Uint8Array(2 + 2 * 30_000);
    units.set([0xff, 0xfe]);
    for (let i = 0; i < 30_000; i++) units.set([0x41 + (i % 26), 0x00], 2 + 2 * i);
    const t0 = Date.now();
    const r = await extract(tag3([["TIT2", cat(Uint8Array.from([1]), units)]]));
    expect(textOf(r)).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZABC");
    expect(Date.now() - t0).toBeLessThan(10_000);
    // about 80 VM steps a unit (decode, surrogate check, code points)
    expect(r.ok && r.steps).toBeLessThan(3_500_000);
  }, 60_000);
});
