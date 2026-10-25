// @vitest-environment jsdom
// Fehlermeldung als Toast: ✕ schließt, nach 6 s von selbst weg, verschwindet, sobald der Fehlerzustand weg ist (Strg+Z setzt msg zurück).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { T } from "./i18n";
import { Toast } from "./ui";

test("Toast: ✕ schließt, 6 s Auto-Schließen, ohne Meldung leer", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const close = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  const show = (msg?: string) => act(() => root.render(<Toast msg={msg} onClose={close} />));

  show("Hinweis: Absatz läuft über");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("läuft über");
  act(() => void host.querySelector<HTMLElement>(`[aria-label="${T.close}"]`)?.click());
  expect(close).toHaveBeenCalledTimes(1);

  act(() => void vi.advanceTimersByTime(5999));
  expect(close).toHaveBeenCalledTimes(1);
  act(() => void vi.advanceTimersByTime(1));
  expect(close).toHaveBeenCalledTimes(2);

  // Strg+Z/Y bzw. nächste erfolgreiche Aktion setzt die Meldung zurück → Toast weg, kein Timer mehr
  show(undefined);
  expect(host.querySelector('[role="status"]')).toBeNull();
  act(() => void vi.advanceTimersByTime(10000));
  expect(close).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
  vi.useRealTimers();
});
