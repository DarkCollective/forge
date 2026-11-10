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
// Pointer drag and drop shared by the operations pane (source) and the recipe pane (source and
// target), UI.md section 3.3. It works across shadow roots, needs no HTML5 DnD (which has no touch
// support and poor keyboard story), and never moves the real element: a ghost label follows the
// pointer. Keyboard users do not use this module; each pane offers its own keyboard route.
import type { StepPath } from "./recipe-ops.js";

export type DragPayload =
  { readonly type: "op"; readonly op: string } | { readonly type: "step"; readonly path: StepPath };

export interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

export interface DropTarget {
  /** Hit-testing uses this element's box. Targets deeper in the tree win. */
  readonly element: Element;
  accepts(payload: DragPayload): boolean;
  /** Pointer is over the target (called on every move). Show the drop indicator here. */
  onOver?(payload: DragPayload, at: PointerPosition): void;
  /** Pointer left the target, or the drag ended or was cancelled. Hide the indicator. */
  onLeave?(): void;
  onDrop(payload: DragPayload, at: PointerPosition): void;
}

const targets = new Set<DropTarget>();
let active: { payload: DragPayload } | null = null;
const listeners = new Set<(payload: DragPayload | null) => void>();

export function registerDropTarget(target: DropTarget): () => void {
  targets.add(target);
  return () => {
    targets.delete(target);
  };
}

/** The payload being dragged, or null. */
export function activeDrag(): DragPayload | null {
  return active?.payload ?? null;
}

/** Be told when a drag starts (payload) and ends (null), e.g. to highlight possible drop zones. */
export function onDragChange(listener: (payload: DragPayload | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Elements under a point, innermost first, looking through open shadow roots. */
export function deepElementsFromPoint(
  x: number,
  y: number,
  start: Document | ShadowRoot = document,
): Element[] {
  const out: Element[] = [];
  // Chromium's `ShadowRoot.elementsFromPoint` returns the shadow host itself, which would recurse
  // forever: visit each root once and list each element once.
  const seen = new Set<Node>();
  const visit = (root: Document | ShadowRoot): void => {
    if (seen.has(root)) return;
    seen.add(root);
    for (const el of root.elementsFromPoint(x, y)) {
      if (el.shadowRoot !== null) visit(el.shadowRoot);
      if (!out.includes(el)) out.push(el);
    }
  };
  visit(start);
  return out;
}

export interface BeginDragOptions {
  /** Pixels the pointer must travel before a click becomes a drag. Default 5. */
  threshold?: number;
  /** Called once when the drag really starts (after the threshold). */
  onStart?(): void;
  /** Called when it ends, dropped or not. */
  onEnd?(dropped: boolean): void;
}

/**
 * Call from a `pointerdown` handler on the draggable. If the pointer moves past the threshold the
 * drag starts; otherwise the gesture stays an ordinary click. Escape cancels.
 */
export function beginPointerDrag(
  event: PointerEvent,
  payload: DragPayload,
  label: string,
  options: BeginDragOptions = {},
): void {
  if (event.button !== 0 || active !== null) return;
  const threshold = options.threshold ?? 5;
  const startX = event.clientX;
  const startY = event.clientY;
  let started = false;
  let ghost: HTMLElement | null = null;
  let over: DropTarget | null = null;

  const pick = (x: number, y: number): DropTarget | null => {
    const stack = deepElementsFromPoint(x, y);
    for (const el of stack) {
      for (const t of targets) if (t.element === el && t.accepts(payload)) return t;
    }
    return null;
  };

  const move = (e: PointerEvent): void => {
    if (!started) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return;
      started = true;
      active = { payload };
      ghost = document.createElement("div");
      ghost.className = "forge-drag-ghost";
      ghost.textContent = label;
      ghost.setAttribute("aria-hidden", "true");
      document.body.append(ghost);
      document.body.classList.add("forge-dragging");
      options.onStart?.();
      for (const l of listeners) l(payload);
    }
    ghost?.style.setProperty("transform", `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`);
    const next = pick(e.clientX, e.clientY);
    if (next !== over) {
      over?.onLeave?.();
      over = next;
    }
    over?.onOver?.(payload, { x: e.clientX, y: e.clientY });
  };

  const finish = (e: PointerEvent | null, cancelled: boolean): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    let dropped = false;
    if (started) {
      ghost?.remove();
      document.body.classList.remove("forge-dragging");
      const target = over;
      over = null;
      target?.onLeave?.();
      if (!cancelled && target !== null && e !== null) {
        target.onDrop(payload, { x: e.clientX, y: e.clientY });
        dropped = true;
      }
      active = null;
      for (const l of listeners) l(null);
      options.onEnd?.(dropped);
      // The click that follows pointerup must not activate the dragged element.
      window.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
    }
  };
  const up = (e: PointerEvent): void => finish(e, false);
  const cancel = (): void => finish(null, true);
  const key = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish(null, true);
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}
