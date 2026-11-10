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
import { describe, expect, it } from "vitest";
import {
  autoFragmentFor,
  classifyHash,
  describeEncodeError,
  describeShareError,
  describeWarnings,
  fragmentOf,
  shareUrl,
  urlWithFragment,
} from "./url.js";

describe("classifyHash", () => {
  it("ignores empty hashes and plain anchors", () => {
    expect(classifyHash("", null)).toBe("none");
    expect(classifyHash("#", null)).toBe("none");
    expect(classifyHash("#about", null)).toBe("none");
  });
  it("recognises its own writes", () => {
    expect(classifyHash("#v=1&r=abc", "v=1&r=abc")).toBe("own");
    expect(classifyHash("#v=1&r=abd", "v=1&r=abc")).toBe("decode");
  });
  it("decodes anything with a key=value pair, even hostile", () => {
    expect(classifyHash("#v=1&r=0e30", null)).toBe("decode");
    expect(classifyHash("#r=0e30", null)).toBe("decode");
  });
});

describe("fragments and URLs", () => {
  it("strips one leading #", () => {
    expect(fragmentOf("#a=b")).toBe("a=b");
    expect(fragmentOf("a=b")).toBe("a=b");
  });
  it("builds the replaceState URL, keeping path and query", () => {
    const loc = { pathname: "/app/", search: "?x=1" };
    expect(urlWithFragment(loc, "v=1&r=a")).toBe("/app/?x=1#v=1&r=a");
    expect(urlWithFragment(loc, null)).toBe("/app/?x=1");
  });
  it("builds the share URL from origin and path", () => {
    expect(shareUrl({ origin: "https://forge.example", pathname: "/" }, "v=1&r=a")).toBe(
      "https://forge.example/#v=1&r=a",
    );
  });
});

describe("autoFragmentFor", () => {
  it("sets a clean recipe fragment", () => {
    expect(autoFragmentFor({ ok: true, fragment: "v=1&r=a", warnings: [] })).toEqual({
      action: "set",
      fragment: "v=1&r=a",
    });
  });
  it("keeps secrets out of the address bar", () => {
    const secret = {
      code: "secret-in-url",
      severity: "warning",
      path: "/steps/0/params/key",
      message: "key",
    } as const;
    expect(autoFragmentFor({ ok: true, fragment: "v=1&r=a", warnings: [secret] })).toEqual({
      action: "clear",
    });
  });
  it("leaves the address alone when the recipe cannot be encoded", () => {
    expect(
      autoFragmentFor({ ok: false, error: { code: "invalid-recipe", message: "bad" } }),
    ).toEqual({ action: "keep" });
  });
});

describe("messages", () => {
  it("describes decode errors with their issues", () => {
    const notice = describeShareError({
      code: "invalid-recipe",
      message: "bad",
      issues: [
        { code: "unknown-op", severity: "error", path: "/steps/0/op", message: "no such op" },
      ],
    });
    expect(notice.severity).toBe("error");
    expect(notice.summary).toContain("invalid-recipe");
    expect(notice.details).toEqual(["unknown-op at /steps/0/op: no such op"]);
  });
  it("caps long detail lists", () => {
    const issues = Array.from({ length: 30 }, (_, i) => ({
      code: "bad-value" as const,
      severity: "error" as const,
      path: `/steps/${i}`,
      message: "x",
    }));
    const notice = describeShareError({ code: "invalid-recipe", message: "bad", issues });
    expect(notice.details).toHaveLength(13);
    expect(notice.details.at(-1)).toBe("…and 18 more");
  });
  it("describes warnings, or nothing", () => {
    expect(describeWarnings([])).toBeNull();
    const n = describeWarnings([
      { code: "alias-used", severity: "warning", path: "/steps/0/op", message: "alias" },
    ]);
    expect(n?.severity).toBe("warning");
    expect(n?.summary).toBe("The link was opened with 1 warning.");
  });
  it("explains encode failures", () => {
    expect(
      describeEncodeError({ code: "fragment-too-long", message: "70000 characters" }),
    ).toContain("too long");
    expect(describeEncodeError({ code: "input-too-large", message: "2 MiB" })).toContain("input");
  });
});
