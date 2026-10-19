import { expect, test } from "vitest";
import { targetAt, urlsIn, webUrl } from "./weblinks";

test("URL-Erkennung im Text", () => {
  expect(urlsIn("Siehe https://example.org/a?b=1, und www.test.de.")).toEqual([
    [6, 31, "https://example.org/a?b=1"], [37, 48, "https://www.test.de/"],
  ]);
  expect(urlsIn("http://a.de) ftp://x.de javascript:alert(1) file:///c")).toEqual([[0, 11, "http://a.de/"]]);
  expect(urlsIn("keine Adresse")).toEqual([]);
});

test("webUrl: nur http/https", () => {
  expect(webUrl("www.a.de/x y")).toBe("https://www.a.de/x%20y");
  for (const s of ["javascript:alert(1)", "file:///C:/x", "mailto:a@b.de", "a.de", "https://"]) expect(webUrl(s)).toBeUndefined();
});

test("targetAt: Annotation vor Text, Sprung ohne Adresse", () => {
  const chars = [{ text: "x www.a.de", boxes: Array.from({ length: 10 }, (_, i): [number, number, number, number] => [i * 10, 0, i * 10 + 10, 10]) }];
  const anchors = [
    { rect: [0, 0, 20, 10] as [number, number, number, number], page: 3, y: 50 },
    { rect: [0, 20, 20, 30] as [number, number, number, number], page: -1, y: 0, uri: "https://b.de" },
    { rect: [0, 40, 20, 50] as [number, number, number, number], page: -1, y: 0, uri: "file:///x" },
  ];
  expect(targetAt(anchors, chars, undefined, 5, 5)).toEqual({ page: 3, y: 50 });
  expect(targetAt(anchors, chars, undefined, 5, 25)).toEqual({ url: "https://b.de/" });
  expect(targetAt(anchors, chars, undefined, 5, 45)).toBeUndefined();
  expect(targetAt([], chars, undefined, 55, 5)).toEqual({ url: "https://www.a.de/" });
  expect(targetAt([], chars, undefined, 5, 5)).toBeUndefined();
  expect(targetAt([], chars, "Mehr: www.c.de", 999, 999)).toEqual({ url: "https://www.c.de/" });
});
