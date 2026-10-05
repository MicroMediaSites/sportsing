import { test, expect } from "bun:test";
import { inTerminal, selfInvocation, shQuote, watchCommand } from "./click-to-watch.ts";

test("shQuote: one safe shell word, apostrophes escaped", () => {
  expect(shQuote("USA")).toBe("'USA'");
  expect(shQuote("Côte d'Ivoire")).toBe(`'Côte d'\\''Ivoire'`);
});

test("selfInvocation: the binary when compiled, else bun + the entry script", () => {
  expect(selfInvocation("/$bunfs/root/sportsing", "/usr/local/bin/sportsing")).toEqual(["/usr/local/bin/sportsing"]);
  expect(selfInvocation("B:/~BUN/root/sportsing.exe", "C:/sportsing.exe")).toEqual(["C:/sportsing.exe"]);
  expect(selfInvocation("/opt/lib/sportsing/src/index.ts", "/opt/bin/bun")).toEqual(["/opt/bin/bun", "/opt/lib/sportsing/src/index.ts"]);
});

test("watchCommand: quoted argv, then `<sport> watch <team>`", () => {
  expect(watchCommand(["/opt/bin/bun", "/a b/index.ts"], "nba", "26")).toBe(`'/opt/bin/bun' '/a b/index.ts' nba watch '26'`);
});

/** Run `cmd` under sh with osascript stubbed to print its argv, one per line. */
function osascriptArgs(cmd: string): string[] {
  const r = Bun.spawnSync(["sh", "-c", `osascript() { printf '%s\\n' "$@"; }; ${cmd}`]);
  return r.stdout.toString().trimEnd().split("\n");
}

test("inTerminal: osascript runs the exact command in a new Terminal window, then focuses it", () => {
  const cmd = watchCommand(["/usr/local/bin/sportsing"], "nhl", `Côte d'Ivoire "x" \\ y`);
  const args = osascriptArgs(inTerminal(cmd));
  expect(args[0]).toBe("-e");
  expect(args[2]).toBe("-e");
  expect(args[3]).toBe('tell application "Terminal" to activate');
  // The AppleScript string literal unescapes back to the original command.
  const m = /^tell application "Terminal" to do script "(.*)"$/.exec(args[1]!);
  expect(m).not.toBeNull();
  expect(m![1]!.replace(/\\(["\\])/g, "$1")).toBe(cmd);
});
