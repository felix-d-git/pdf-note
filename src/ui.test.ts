import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { pwProblem } from "./ui";

describe("pwProblem", () => {
  it("prüft wie das Backend: 1–127 Byte, gleiche Wiederholung", () => {
    expect(pwProblem("geheim", "geheim")).toBeUndefined();
    expect(pwProblem("")).toBe(T.pwRule);
    expect(pwProblem("a".repeat(127))).toBeUndefined();
    expect(pwProblem("ä".repeat(64))).toBe(T.pwRule); // 128 Byte UTF-8
    expect(pwProblem("a\0b")).toBe(T.pwRule);
    expect(pwProblem("geheim", "geheimx")).toBe(T.pwMismatch);
  });
});
