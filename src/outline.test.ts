import { describe, expect, it } from "vitest";
import { add, indent, type Mark, moveDown, moveUp, outdent, remove } from "./outline";

// A(0) a1(1) a2(1) B(0) b1(1)
const tree = (): Mark[] => [["A", 0], ["a1", 1], ["a2", 1], ["B", 0], ["b1", 1]].map(([t, l]) => ({ title: String(t), page: 0, level: Number(l) }));
const show = (m: Mark[]) => m.map((x) => `${x.title}${x.level}`).join(" ");

describe("Lesezeichen", () => {
  it("verschiebt mit Teilbaum unter Geschwistern", () => {
    const [up, i] = moveUp(tree(), 3);
    expect(show(up)).toBe("B0 b11 A0 a11 a21");
    expect(i).toBe(0);
    const [down, j] = moveDown(tree(), 0);
    expect(show(down)).toBe("B0 b11 A0 a11 a21");
    expect(j).toBe(2);
    // kein Geschwister → unverändert, nicht aus dem Elternteil heraus
    expect(moveUp(tree(), 1)[0]).toEqual(tree());
    expect(moveDown(tree(), 2)[0]).toEqual(tree());
    expect(show(moveDown(tree(), 1)[0])).toBe("A0 a21 a11 B0 b11");
  });

  it("rückt nur gültig ein/aus", () => {
    expect(indent(tree(), 0)).toEqual(tree());
    expect(indent(tree(), 1)).toEqual(tree());
    expect(show(indent(tree(), 2))).toBe("A0 a11 a22 B0 b11");
    expect(show(indent(tree(), 3))).toBe("A0 a11 a21 B1 b12");
    const [o, k] = outdent(tree(), 1);
    expect(show(o)).toBe("A0 a21 a10 B0 b11");
    expect(k).toBe(2);
    expect(show(outdent(tree(), 2)[0])).toBe("A0 a11 a20 B0 b11");
    expect(outdent(tree(), 0)[0]).toEqual(tree());
  });

  it("Löschen hebt Kinder an, Hinzufügen sortiert nach Seite", () => {
    expect(show(remove(tree(), 0))).toBe("a10 a20 B0 b11");
    const m: Mark[] = [{ title: "X", page: 1, level: 0 }, { title: "Y", page: 5, level: 0 }];
    const [r, i] = add(m, "Neu", 3);
    expect(r.map((x) => x.title)).toEqual(["X", "Neu", "Y"]);
    expect(i).toBe(1);
    expect(add(m, "Ende", 9)[1]).toBe(2);
  });
});
