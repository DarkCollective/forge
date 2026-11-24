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
// The viewer registry and host (UI-TOOLKIT.md section 1.2 to 1.5), in node: the document is a stand-in
// that records what a viewer builds, so the tests can see that text goes in through textContent only.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  extBytesOps,
  extCopyText,
  extDownloadFile,
  extShape,
  extSummary,
  extTypeText,
  fallbackSentence,
  fallbackViewer,
  getViewer,
  kindNoun,
  kindRepairs,
  onViewersChanged,
  registerViewer,
  registerViewerLoader,
  renderExt,
  resetViewers,
  viewerState,
} from "./viewers.js";
import type { DocumentLike, ExtOutput, Viewer, ViewerContext } from "./viewers.js";

/** The one kind of element the host builds: enough of the DOM to see structure and text. */
class FakeEl {
  readonly nodeType = 1;
  className = "";
  tabIndex = -1;
  textContent: string | null = null;
  readonly attrs = new Map<string, string>();
  readonly children: FakeEl[] = [];
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
}

const doc: DocumentLike = {
  createElement: (tag: string) => new FakeEl(tag) as unknown as HTMLElement,
};

const out = (patch: Partial<ExtOutput> = {}): ExtOutput => ({
  kind: "ext",
  extKind: "grid",
  text: "a,b\n1,2",
  truncated: false,
  view: { rows: 1 },
  ...patch,
});

const ctx: ViewerContext = {
  place: "output",
  compact: false,
  signal: new AbortController().signal,
};

const fake = (n: HTMLElement): FakeEl => n as unknown as FakeEl;

function viewer(patch: Partial<Viewer> = {}): Viewer {
  return {
    kind: "grid",
    noun: "grid",
    render: () => {
      const el = new FakeEl("div");
      el.textContent = "drawn";
      return el as unknown as HTMLElement;
    },
    ...patch,
  };
}

beforeEach(() => resetViewers());
afterEach(() => resetViewers());

describe("the registry", () => {
  test("registration is idempotent and the last one wins", () => {
    const first = viewer({ noun: "first" });
    const second = viewer({ noun: "second" });
    registerViewer(first);
    registerViewer(first);
    expect(getViewer("grid")).toBe(first);
    registerViewer(second);
    expect(getViewer("grid")).toBe(second);
    expect(kindNoun("grid")).toBe("second");
  });

  test("a bad kind name is a programmer error", () => {
    expect(() => registerViewer(viewer({ kind: "Grid" }))).toThrow(TypeError);
    expect(() => registerViewer(viewer({ kind: "" }))).toThrow(TypeError);
    expect(() => registerViewerLoader("a b", () => Promise.resolve())).toThrow(TypeError);
  });

  test("noun, type text and repairs", () => {
    expect(extTypeText("grid")).toBe("ext{grid}");
    expect(kindNoun("grid")).toBe("grid extension value");
    expect(kindRepairs("grid")).toEqual([]);
    registerViewer(viewer({ repairs: [{ from: "bytes", op: "csv:parse", label: "Parse CSV" }] }));
    expect(kindNoun("grid")).toBe("grid");
    expect(kindRepairs("grid")).toEqual([{ from: "bytes", op: "csv:parse", label: "Parse CSV" }]);
  });

  test("listeners hear about a registration and can stop listening", () => {
    let heard = 0;
    const stop = onViewersChanged(() => heard++);
    registerViewer(viewer());
    expect(heard).toBe(1);
    stop();
    registerViewer(viewer());
    expect(heard).toBe(1);
  });
});

describe("renderExt", () => {
  test("a registered viewer draws the output", () => {
    registerViewer(viewer());
    expect(fake(renderExt(out(), ctx, { doc })).textContent).toBe("drawn");
  });

  test("an unknown kind falls back to the text form with its sentence", () => {
    const node = fake(renderExt(out(), ctx, { doc }));
    expect(node.className).toBe("ext-fallback");
    expect(node.attrs.get("data-ext-kind")).toBe("grid");
    const [note, pre] = node.children as [FakeEl, FakeEl];
    expect(note.textContent).toBe("No viewer for grid is loaded. Showing the text form.");
    expect(pre.tag).toBe("pre");
    expect(pre.textContent).toBe("a,b\n1,2");
    expect(pre.tabIndex).toBe(0);
  });

  test("the kinds of the language have no sentence", () => {
    for (const extKind of ["null", "array"]) {
      const node = fake(renderExt(out({ extKind, text: "null" }), ctx, { doc }));
      expect(node.children).toHaveLength(1);
      expect(node.children[0]?.textContent).toBe("null");
    }
  });

  test("a viewer with no view in the output shows the text form as the normal look", () => {
    registerViewer(viewer());
    const noView: ExtOutput = { kind: "ext", extKind: "grid", text: "a,b\n1,2", truncated: false };
    const node = fake(renderExt(noView, ctx, { doc }));
    expect(node.children).toHaveLength(1);
    expect(node.children[0]?.textContent).toBe("a,b\n1,2");
  });

  test("a viewer that throws never hides the value, and the failure is announced once", () => {
    registerViewer(
      viewer({
        render: () => {
          throw new Error("boom");
        },
      }),
    );
    const said: string[] = [];
    const announce = (t: string): void => void said.push(t);
    const o = out();
    for (let i = 0; i < 3; i++) {
      const node = fake(renderExt(o, ctx, { doc, announce }));
      expect(node.children[0]?.textContent).toBe(
        "The viewer for grid failed. Showing the text form.",
      );
      expect(node.children[1]?.textContent).toBe("a,b\n1,2");
    }
    expect(said).toEqual(["The viewer for grid failed. Showing the text form."]);
    renderExt(out(), ctx, { doc, announce });
    expect(said).toHaveLength(2); // another output announces again
  });

  test("a viewer that returns something that is not an element fails the same way", () => {
    for (const bad of [null, undefined, "text", 42, {}, { nodeType: 3 }]) {
      registerViewer(viewer({ render: () => bad as never }));
      const node = fake(renderExt(out(), ctx, { doc }));
      expect(node.children[0]?.textContent, String(bad)).toMatch(/failed/);
      expect(node.children[1]?.textContent).toBe("a,b\n1,2");
    }
  });

  test("the text is set as text, never parsed: hostile text stays one string", () => {
    const hostile = "<img src=x onerror=alert(1)></script>‮\ud800";
    const node = fake(renderExt(out({ text: hostile, extKind: "x-hostile" }), ctx, { doc }));
    expect(node.children[1]?.textContent).toBe(hostile);
    expect(node.children.every((c) => c.tag === "p" || c.tag === "pre")).toBe(true);
  });

  test("a cut text says how much is shown", () => {
    const cut = out({ truncated: true, text: "x".repeat(4000), extKind: "x-cut" });
    expect(fallbackSentence(cut, "none")).toBe("Showing the first 4,000 characters.");
    expect(fallbackSentence(cut, "unknown")).toBe(
      "No viewer for x-cut is loaded. Showing the text form. Showing the first 4,000 characters.",
    );
    expect(fallbackSentence(out(), "none")).toBe("");
    const node = fake(fallbackViewer(cut, "none", doc));
    expect(node.children[0]?.textContent).toBe("Showing the first 4,000 characters.");
  });
});

describe("a viewer in a lazy chunk", () => {
  test("shows the text form while it loads, then the viewer", async () => {
    let loaded = 0;
    registerViewerLoader("grid", async () => {
      loaded++;
      registerViewer(viewer());
    });
    let heard = 0;
    onViewersChanged(() => heard++);
    const first = fake(renderExt(out(), ctx, { doc }));
    expect(first.children[0]?.textContent).toBe(
      "Loading the viewer for grid. Showing the text form.",
    );
    expect(viewerState("grid")).toBe("loading");
    renderExt(out(), ctx, { doc }); // asking again does not load it again
    await new Promise((r) => setTimeout(r, 0));
    expect(loaded).toBe(1);
    expect(viewerState("grid")).toBe("ready");
    expect(heard).toBeGreaterThan(0);
    expect(fake(renderExt(out(), ctx, { doc })).textContent).toBe("drawn");
  });

  test("a loader that fails, or that never registers, gives the failure sentence", async () => {
    registerViewerLoader("grid", () => Promise.reject(new Error("offline")));
    renderExt(out(), ctx, { doc });
    await new Promise((r) => setTimeout(r, 0));
    expect(viewerState("grid")).toBe("failed");
    expect(fake(renderExt(out(), ctx, { doc })).children[0]?.textContent).toBe(
      "The viewer for grid failed. Showing the text form.",
    );
    resetViewers();
    registerViewerLoader("grid", () => Promise.resolve());
    renderExt(out(), ctx, { doc });
    await new Promise((r) => setTimeout(r, 0));
    expect(viewerState("grid")).toBe("failed");
  });

  test("a kind with no loader is missing", () => {
    expect(viewerState("grid")).toBe("missing");
  });
});

describe("Copy, Download, Convert to bytes and the summary", () => {
  test("by default Copy and Download use the text form", () => {
    expect(extCopyText(out())).toBe("a,b\n1,2");
    const file = extDownloadFile(out());
    expect(file.filename).toBe("forge-output.txt");
    expect(file.mime).toBe("text/plain;charset=utf-8");
    expect(new TextDecoder().decode(file.bytes)).toBe("a,b\n1,2");
    expect(extBytesOps(out())).toEqual([]);
  });

  test("a viewer can say what Copy and Download give", () => {
    registerViewer(
      viewer({
        copyText: () => "csv text",
        download: () => ({ filename: "t.csv", mime: "text/csv", bytes: new Uint8Array([1]) }),
        bytesOps: [{ op: "table:to-csv", label: "Table to CSV" }],
      }),
    );
    expect(extCopyText(out())).toBe("csv text");
    expect(extDownloadFile(out())).toEqual({
      filename: "t.csv",
      mime: "text/csv",
      bytes: new Uint8Array([1]),
    });
    expect(extBytesOps(out())).toEqual([{ op: "table:to-csv", label: "Table to CSV" }]);
  });

  test("a viewer that fails when asked, or has nothing to download, gives the text form", () => {
    registerViewer(
      viewer({
        copyText: () => {
          throw new Error("no");
        },
        download: () => null,
      }),
    );
    expect(extCopyText(out())).toBe("a,b\n1,2");
    expect(extDownloadFile(out()).filename).toBe("forge-output.txt");
    registerViewer(
      viewer({
        download: () => {
          throw new Error("no");
        },
      }),
    );
    expect(extDownloadFile(out()).filename).toBe("forge-output.txt");
  });

  test("summary: the noun and the shape the viewer states", () => {
    expect(extSummary(out())).toBe("grid extension value");
    expect(extShape(out())).toBeNull();
    registerViewer(viewer({ summary: () => "3 columns" }));
    expect(extShape(out())).toBe("3 columns");
    expect(extSummary(out())).toBe("grid, 3 columns");
    registerViewer(viewer({ summary: () => "" }));
    expect(extSummary(out())).toBe("grid");
    registerViewer(
      viewer({
        summary: () => {
          throw new Error("no");
        },
      }),
    );
    expect(extSummary(out())).toBe("grid");
  });
});
