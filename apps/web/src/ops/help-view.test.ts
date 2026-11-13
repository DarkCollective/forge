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
import { describe, expect, test } from "vitest";
import {
  SHOW_LIMIT,
  describeLineBreaks,
  exampleInput,
  exampleStep,
  exampleTabName,
  planInput,
  showControls,
  viewExpect,
  viewLink,
  viewParams,
  viewValue,
} from "./help-view.js";

describe("values", () => {
  test("control characters are made visible", () => {
    expect(showControls("a\tb\r\nc\u0000")).toBe("a\\tb\\r\nc\\x00");
    expect(showControls("x‮y")).toBe("x\\u202ey");
  });
  test("text, empty and cut values", () => {
    expect(viewValue("foo", "utf8")).toMatchObject({ text: "foo", label: "text", cut: null });
    expect(viewValue("", "utf8").empty).toBe(true);
    const long = viewValue("x".repeat(SHOW_LIMIT + 20), "utf8");
    expect(long.text).toHaveLength(SHOW_LIMIT);
    expect(long.cut).toContain(String(SHOW_LIMIT + 20));
  });
  test("hex and base64 values get a text reading when they are text", () => {
    expect(viewValue("666f6f", "hex")).toMatchObject({ label: "hex", reading: "foo" });
    expect(viewValue("Zm9v", "base64").reading).toBe("foo");
    expect(viewValue("fbff", "hex").reading).toBeNull();
    expect(viewValue("zz", "hex").reading).toBeNull();
    expect(viewValue("00", "hex").reading).toBeNull();
  });
});

describe("expectations", () => {
  test("value, error, json and anything else", () => {
    expect(viewExpect({ value: "Zg==", enc: "utf8" })).toMatchObject({ kind: "value" });
    expect(viewExpect({ error: "E_COERCE" })).toEqual({ kind: "error", code: "E_COERCE" });
    expect(viewExpect({ json: [1, { a: 2 }] })).toMatchObject({ kind: "json" });
    expect(viewExpect(42)).toMatchObject({ kind: "unknown", text: "42" });
    const big = viewExpect({ json: Array.from({ length: 500 }, (_, i) => i) });
    expect(big.kind === "json" && big.cut).not.toBeNull();
  });
  test("parameters", () => {
    const lines = viewParams({
      alphabet: "url",
      n: 3,
      flag: false,
      key: { value: "00ff", enc: "hex" },
    });
    expect(lines.map((l) => [l.name, l.value.text, l.value.label])).toEqual([
      ["alphabet", "url", "text"],
      ["n", "3", "text"],
      ["flag", "false", "text"],
      ["key", "00ff", "hex"],
    ]);
  });
});

describe("links", () => {
  test("https only, host as the fallback label", () => {
    expect(
      viewLink({ url: "https://www.rfc-editor.org/rfc/rfc4648#section-4", label: "RFC" }),
    ).toEqual({
      href: "https://www.rfc-editor.org/rfc/rfc4648#section-4",
      host: "www.rfc-editor.org",
      label: "RFC",
    });
    expect(viewLink({ url: "https://en.wikipedia.org/wiki/Base64", label: null })?.label).toBe(
      "en.wikipedia.org",
    );
    for (const url of [
      "http://a.org/",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://u:p@a.org/",
      "nope",
    ]) {
      expect(viewLink({ url, label: null }), url).toBeNull();
    }
  });
});

describe("Try it", () => {
  test("the step carries the parameters only when there are some", () => {
    expect(exampleStep("base64:decode", { params: {} })).toEqual({
      kind: "op",
      op: "base64:decode",
    });
    expect(exampleStep("base64:decode", { params: { alphabet: "url" } })).toEqual({
      kind: "op",
      op: "base64:decode",
      params: { alphabet: "url" },
    });
  });
  test("the input in its own encoding", () => {
    const r = exampleInput({ input: { value: "fbff", enc: "hex" } });
    expect(r).toEqual({ ok: true, bytes: new Uint8Array([0xfb, 0xff]), encoding: "hex" });
    expect(exampleInput({ input: { value: "zz", enc: "hex" } }).ok).toBe(false);
    expect(exampleInput({ input: { value: "a", enc: "ebcdic" } }).ok).toBe(false);
  });
  test("input is never overwritten", () => {
    const bytes = new Uint8Array([1]);
    const tabs = [
      { id: "t1", name: "Input 1", bytes: new Uint8Array(0) },
      { id: "t2", name: "Input 2", bytes: new Uint8Array([9]) },
      { id: "t3", name: "Example: A", bytes },
    ];
    expect(planInput(tabs, "t1", "Example: A", bytes)).toEqual({ kind: "fill", id: "t1" });
    expect(planInput(tabs, "t2", "Example: A", bytes)).toEqual({ kind: "select", id: "t3" });
    expect(planInput(tabs, "t2", "Example: B", bytes)).toEqual({ kind: "new", name: "Example: B" });
  });
  test("tab names are short", () => {
    expect(exampleTabName("x".repeat(200))).toHaveLength(80);
  });
});

describe("CR LF in an example (WP 6.18)", () => {
  test("the input is encoded byte for byte, not normalised to LF", () => {
    const r = exampleInput({ input: { value: "a\r\nb\rc\n", enc: "utf8" } });
    expect(r).toEqual({
      ok: true,
      bytes: new Uint8Array([97, 13, 10, 98, 13, 99, 10]),
      encoding: "utf8",
    });
    const l = exampleInput({ input: { value: "\r\n\xe9", enc: "latin1" } });
    expect(l).toEqual({ ok: true, bytes: new Uint8Array([13, 10, 0xe9]), encoding: "latin1" });
    expect(exampleInput({ input: { value: "\ud800", enc: "utf8" } }).ok).toBe(false);
  });
  test("a CR is shown as an escape and the view says which line breaks the text has", () => {
    const v = viewValue("name,age\r\nAda,36\r\n", "utf8");
    expect(v.text).toBe("name,age\\r\nAda,36\\r\n");
    expect(v.lineBreaks).toBe("Line breaks: CR LF. Each CR is shown as \\r.");
    expect(viewValue("a\nb", "utf8").lineBreaks).toBeNull();
    expect(viewValue("0d0a", "hex").lineBreaks).toBeNull();
  });
  test("lone CR and mixed endings are named", () => {
    expect(describeLineBreaks("a\rb")).toBe("Line breaks: CR alone. Each CR is shown as \\r.");
    expect(describeLineBreaks("a\r\nb\n")).toBe(
      "Line breaks: mixed (CR LF, LF alone). Each CR is shown as \\r.",
    );
  });
});
