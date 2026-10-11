import { describe, expect, test } from "bun:test";
import { guiSessionProblem, NO_GUI_SESSION_WARNING } from "./gui-session.ts";

describe("guiSessionProblem", () => {
  test("local Terminal (Aqua, no ssh) is fine", () => {
    expect(guiSessionProblem({}, "darwin", "Aqua")).toBeNull();
  });
  test("ssh env without a managername is a problem", () => {
    expect(guiSessionProblem({ SSH_CONNECTION: "1 2 3 4" }, "darwin", null)).toBe(NO_GUI_SESSION_WARNING);
    expect(guiSessionProblem({ SSH_TTY: "/dev/ttys001" }, "darwin", null)).toBe(NO_GUI_SESSION_WARNING);
  });
  test("Background / System with no ssh env is a problem (tmux over ssh)", () => {
    expect(guiSessionProblem({}, "darwin", "Background")).toBe(NO_GUI_SESSION_WARNING);
    expect(guiSessionProblem({}, "darwin", "System")).toBe(NO_GUI_SESSION_WARNING);
  });
  test("a known Aqua session wins over stray SSH vars", () => {
    expect(guiSessionProblem({ SSH_CONNECTION: "x" }, "darwin", "Aqua")).toBeNull();
  });
  test("nothing known and no ssh env is fine", () => {
    expect(guiSessionProblem({}, "darwin", null)).toBeNull();
  });
  test("non-darwin is never flagged", () => {
    expect(guiSessionProblem({ SSH_CONNECTION: "x" }, "linux", "Background")).toBeNull();
    expect(guiSessionProblem({ SSH_TTY: "x" }, "win32", null)).toBeNull();
  });
  test("warning text explains the cause and fix", () => {
    expect(NO_GUI_SESSION_WARNING).toContain("isn't attached to the Mac's desktop session");
    expect(NO_GUI_SESSION_WARNING).toContain("not over ssh");
  });
});
