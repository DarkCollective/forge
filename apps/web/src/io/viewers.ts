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
 * X0 SPIKE (throwaway): the viewer registry for extension values (TOOLKIT.md section 6.2). A viewer is a
 * function from an `ext` output to a DOM node, built with DOM APIs only. A kind with no viewer is shown as
 * its text form by the output pane (the `fallbackViewer`).
 */
import type { OutputValue } from "@forge/worker";

export type ExtOutput = Extract<OutputValue, { readonly kind: "ext" }>;

export interface ExtViewer {
  /** The kind this viewer shows, as in `ext{kind}`. */
  readonly kind: string;
  /** Build the node. Must not use innerHTML; text goes in through textContent. */
  render(output: ExtOutput): HTMLElement;
}

const viewers = new Map<string, ExtViewer>();

export function registerViewer(viewer: ExtViewer): void {
  viewers.set(viewer.kind, viewer);
}

export function getViewer(kind: string): ExtViewer | undefined {
  return viewers.get(kind);
}

/** The node for an ext output: the registered viewer, or the text form when there is none or it throws. */
export function renderExt(output: ExtOutput): HTMLElement {
  const viewer = viewers.get(output.extKind);
  if (viewer !== undefined && output.view !== undefined) {
    try {
      return viewer.render(output);
    } catch {
      // fall through to the text form: a broken viewer must not hide the value
    }
  }
  return fallbackViewer(output);
}

export function fallbackViewer(output: ExtOutput): HTMLElement {
  const pre = document.createElement("pre");
  // `text scalar` are the classes the output pane already styles for a plain text value.
  pre.className = "text scalar";
  pre.tabIndex = 0;
  pre.dataset["kind"] = output.extKind;
  pre.textContent = output.text;
  return pre;
}
