// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { Help } from "./help";
import { keyText, T } from "./i18n";
import { combos, KEYS } from "./keys";
import { TOOLS } from "./settings";
import { Tour, tourSeen } from "./tour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};

function mount(el: React.ReactElement) {
  const div = document.body.appendChild(document.createElement("div"));
  const root = createRoot(div);
  act(() => root.render(el));
  return { div, unmount: () => act(() => root.unmount()) };
}

test("Hilfe enthält jedes Werkzeug und jedes Kürzel", () => {
  const { div, unmount } = mount(<Help onClose={() => {}} onTour={() => {}} />);
  const text = div.textContent ?? "";
  for (const t of TOOLS) expect(text, t).toContain(T[t]);
  for (const [k, v] of Object.entries(KEYS)) {
    expect(text, k).toContain(T[k as keyof typeof KEYS]);
    for (const c of combos(v)) expect(text, c).toContain(keyText(c));
  }
  unmount();
});

test("Hilfe-Suche findet Kapitel", () => {
  const { div, unmount } = mount(<Help onClose={() => {}} onTour={() => {}} />);
  const input = div.querySelector("input");
  act(() => {
    if (!input) throw new Error("kein Suchfeld");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "space");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const titles = [...div.querySelectorAll("section h2")].map((h) => h.textContent);
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.length).toBeLessThan(10);
  unmount();
});

test("Tour: 6–8 Schritte, jedes Ziel vorhanden, Überspringen merkt gesehen", () => {
  expect(T.tour.length).toBeGreaterThanOrEqual(6);
  expect(T.tour.length).toBeLessThanOrEqual(8);
  localStorage.clear();
  expect(tourSeen()).toBe(false);
  let ended = 0;
  const { div, unmount } = mount(<Tour onEnd={() => ended++} />);
  T.tour.forEach((_, i) => expect(div.querySelector(`[data-tour="${i}"]`), String(i)).not.toBeNull());
  act(() => (div.querySelector(`[aria-label="${T.tourSkip}"]`) as HTMLButtonElement).click());
  expect(ended).toBe(1);
  expect(tourSeen()).toBe(true);
  unmount();
});
