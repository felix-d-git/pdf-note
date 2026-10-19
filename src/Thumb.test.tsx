// @vitest-environment jsdom
// Miniaturen: Strg/Umschalt-Klick markiert mehrere, Rechtsklick meldet sich (Menü in DocView).
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { thumbPick } from "./ink";
import { Thumb } from "./PageView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));

test("Strg/Umschalt-Klick markiert mehrere Miniaturen, Rechtsklick meldet den Index", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  const menu: number[] = [];
  function Strip() {
    const [sel, setSel] = useState<number[]>([]);
    const [anchor, setAnchor] = useState(0);
    return [0, 1, 2, 3].map((i) => (
      <Thumb key={i} doc={1} index={i} size={[100, 100]} version={0} active={false} selected={sel.includes(i)}
        onPointerDown={() => {}} onContextMenu={() => void menu.push(i)}
        onClick={(e) => (setSel(thumbPick(sel, anchor, i, e.ctrlKey, e.shiftKey)), e.shiftKey || setAnchor(i))} />
    ));
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Strip />));
  const btn = (i: number) => host.querySelector<HTMLElement>(`[data-thumb="${i}"]`) ?? document.body;
  const picked = () => [0, 1, 2, 3].filter((i) => btn(i).getAttribute("aria-selected") === "true");
  const click = (i: number, o: MouseEventInit = {}) => act(() => void btn(i).dispatchEvent(new MouseEvent("click", { bubbles: true, ...o })));
  click(1);
  click(3, { ctrlKey: true });
  expect(picked()).toEqual([1, 3]);
  click(2, { shiftKey: true });
  expect(picked()).toEqual([2, 3]);
  act(() => void btn(2).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(menu).toEqual([2]);
  act(() => root.unmount());
});
