// @vitest-environment jsdom
// Markdown-Editor: Vorschau entprellt mit Formeln, Esc übernimmt, Fehler der Vorschau lässt den Text stehen.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MdEditor } from "./MdEditor";

const calls: { source: string; formulas: unknown[] }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (_: string, a: { source: string; formulas: unknown[] }) => {
    calls.push(a);
    return a.source.includes("kaputt") ? Promise.reject(new Error("Satzfehler")) : Promise.resolve(new ArrayBuffer(8));
  },
}));
vi.mock("./math", () => ({ formulas: (s: string) => Promise.resolve(s.includes("$") ? [{ tex: "x" }] : []) }));
URL.createObjectURL = () => "blob:x";
URL.revokeObjectURL = () => {};

test("Vorschau entprellt, Esc übernimmt, Fehler zeigt Meldung", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  const applied: number[] = [];
  const draw = (source: string) =>
    act(() => root.render(<MdEditor title="t" source={source} onChange={() => {}} onApply={() => void applied.push(1)} onCancel={() => {}} />));
  draw("a");
  draw("a $x$");
  await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
  expect(calls).toEqual([{ source: "a $x$", formulas: [{ tex: "x" }], scale: 1.5 }]);
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:x");
  draw("kaputt");
  await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
  expect(host.querySelector("[role=alert]")?.textContent).toContain("Satzfehler");
  expect(host.querySelector("textarea")?.value).toBe("kaputt");
  act(() => void host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(applied).toEqual([1]);
  act(() => root.unmount());
  vi.useRealTimers();
});
