import { beforeEach, describe, expect, it } from "vitest";
import { forgetRecentFile, getRecentFiles, rememberRecent } from "../app/recentFiles";

describe("recent files", () => {
  beforeEach(() => localStorage.clear());

  it("deduplicates paths and keeps newest first", () => {
    rememberRecent([{ path: "C:\\a.pdf", name: "a.pdf" }]);
    const list = rememberRecent([
      { path: "C:\\b.pdf", name: "b.pdf" },
      { path: "C:\\a.pdf", name: "a.pdf" },
    ]);
    expect(list.map((entry) => entry.name)).toEqual(["b.pdf", "a.pdf"]);
    expect(getRecentFiles()).toHaveLength(2);
  });

  it("ignores demo documents and caps the list", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ path: `C:\\${index}.pdf`, name: `${index}.pdf` }));
    const list = rememberRecent([{ path: "pdfreader://demo", name: "demo" }, ...entries]);
    expect(list).toHaveLength(8);
    expect(list.some((entry) => entry.path.startsWith("pdfreader://"))).toBe(false);
  });

  it("forgets a missing recent file", () => {
    rememberRecent([{ path: "C:\\a.pdf", name: "a.pdf" }, { path: "C:\\b.pdf", name: "b.pdf" }]);
    expect(forgetRecentFile("C:\\a.pdf").map((entry) => entry.name)).toEqual(["b.pdf"]);
  });
});
