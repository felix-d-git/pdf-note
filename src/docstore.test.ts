// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { dropDoc, useDoc } from "./docstore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("zwei Ansichten derselben PDF teilen den Zustand, Schließen vergisst ihn", () => {
  let inc: (f: (n: number) => number) => void = () => {};
  const View = ({ k }: { k: string }) => {
    const [n, set] = useDoc(7, () => 1);
    if (k === "a") inc = set;
    return createElement("i", { id: k }, n);
  };
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render([createElement(View, { k: "a", key: "a" }), createElement(View, { k: "b", key: "b" })]));
  expect(el.textContent).toBe("11");
  act(() => inc((n) => n + 1));
  expect(el.textContent).toBe("22");
  act(() => root.unmount());
  dropDoc(7);
  act(() => createRoot(el).render(createElement(View, { k: "b" })));
  expect(el.textContent).toBe("1");
});
