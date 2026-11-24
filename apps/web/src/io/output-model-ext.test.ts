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
// The ext branch of the output model: text, description, download, the Copy and Download names, the footer.
import type { OutputValue } from "@forge/worker";
import { describe, expect, test } from "vitest";
import { describeValue as describeForStatus } from "../bake/format.js";
import {
  chooseView,
  copyLabel,
  describeValue,
  downloadBytes,
  downloadLabel,
  downloadSpec,
  outputBytes,
  outputText,
  typeReadout,
} from "./output-model.js";

const ext = (patch: Partial<Extract<OutputValue, { kind: "ext" }>> = {}): OutputValue => ({
  kind: "ext",
  extKind: "table",
  text: "id,name\n1,Ada",
  truncated: false,
  ...patch,
});

describe("an ext output", () => {
  test("has no bytes, and its text is the text form", () => {
    expect(outputBytes(ext())).toBeNull();
    expect(outputText(ext())).toBe("id,name\n1,Ada");
    expect(chooseView(ext(), "hex")).toBe("text");
  });

  test("is described with its kind inside a list, and in the status line", () => {
    expect(describeValue(ext())).toBe("<ext{table}> id,name\n1,Ada");
    expect(describeValue({ kind: "list", items: [ext({ text: "t" })], total: 1 })).toContain(
      "<ext{table}> t",
    );
    expect(describeForStatus(ext({ text: "a\nb" }))).toBe("ext{table}: a b");
    expect(describeForStatus(ext({ text: "x".repeat(100) }), 10)).toBe("ext{table}: xxxxxxxxx…");
  });

  test("downloads as forge-output.txt with the text form", () => {
    expect(downloadSpec(ext())).toEqual({
      filename: "forge-output.txt",
      mime: "text/plain;charset=utf-8",
    });
    expect(new TextDecoder().decode(downloadBytes(ext()))).toBe("id,name\n1,Ada");
  });

  test("Copy and Download say so when the text was cut", () => {
    expect(copyLabel(ext())).toBe("Copy");
    expect(downloadLabel(ext())).toBe("Download");
    expect(copyLabel(null)).toBe("Copy");
    const cut = ext({ truncated: true, text: "x".repeat(4000) });
    expect(copyLabel(cut)).toBe("Copy the first 4,000 characters");
    expect(downloadLabel(cut)).toBe("Download the first 4,000 characters");
    expect(copyLabel({ kind: "str", text: "a" })).toBe("Copy");
  });

  test("the footer names the kind in braces", () => {
    expect(typeReadout(ext())).toBe("ext{table}");
    expect(typeReadout(ext({ extKind: "null", text: "null" }))).toBe("ext{null}");
    expect(typeReadout({ kind: "list", items: [], total: 0 })).toBe("list");
  });
});
