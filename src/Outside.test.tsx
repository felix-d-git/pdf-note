// @vitest-environment jsdom
// Popover: Tipp daneben schließt nur (erreicht nichts darunter), Tipp auf den Auslöser schließt statt neu zu öffnen.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { useOutside } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hits = 0;
function Pop() {
  const [open, setOpen] = useState(false);
  useOutside(open, (t) => !!t.closest("#pop"), () => setOpen(false));
  return (
    <>
      <button id="trigger" onClick={() => setOpen((o) => !o)} />
      <button id="below" onPointerDown={() => hits++} onClick={() => hits++} />
      {open && <div id="pop"><button id="in" /></div>}
    </>
  );
}

const tap = (el: Element) => {
  act(() => void el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })));
  act(() => void el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true })));
  act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
};

test("Tipp daneben schließt ohne Nebenwirkung, Auslöser schaltet um", () => {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<Pop />));
  const $ = (s: string) => host.querySelector(s) as Element;
  tap($("#trigger"));
  expect($("#pop")).not.toBeNull();
  tap($("#in"));
  expect($("#pop")).not.toBeNull();
  tap($("#below"));
  expect($("#pop")).toBeNull();
  expect(hits).toBe(0);
  tap($("#below"));
  expect(hits).toBe(2);
  tap($("#trigger"));
  tap($("#trigger"));
  expect($("#pop")).toBeNull();
});
