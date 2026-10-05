import { test, expect, afterEach, spyOn } from "bun:test";
// Pure helpers + the commands over fake sports — no network, never reads or
// writes ~/.config/sportsing.
import { SPORTS, bareHint, lastAndNext, matchState, me, next, nextPerTeam, noFavoritesHint, tagged, today, type Row, type Sport } from "./cross.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const HOUR = 3_600_000;
const NOW = Date.now(); // next/me compare against the real clock
const at = (h: number) => new Date(NOW + h * HOUR).toISOString();
const row = (id: string, h: number, state: Row["state"]): Row => ({ id, start: at(h), state, line: `game ${id}` });

function sport(key: string, over: Partial<Sport> = {}): Sport {
  return {
    key,
    label: key.toUpperCase(),
    icon: "*",
    run: () => {},
    has: () => false,
    favoritesOn: async () => null,
    favoriteTeams: async () => null,
    ...over,
  };
}

/** Capture console.log/error lines (ANSI stripped) while `fn` runs. */
async function capture(fn: () => Promise<void>): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(strip(a.join(" "))));
  const error = spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(strip(a.join(" "))));
  try {
    await fn();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { out, err };
}

afterEach(() => {
  process.exitCode = 0;
});

test("the registry is fifa, nba, nhl — each routable and with its own command table", () => {
  expect(SPORTS.map((s) => s.key)).toEqual(["fifa", "nba", "nhl"]);
  expect(SPORTS.every((s) => s.has("today") && s.has("fav"))).toBe(true);
  expect(SPORTS.find((s) => s.key === "fifa")!.has("bracket")).toBe(true);
  expect(SPORTS.find((s) => s.key === "nba")!.has("bracket")).toBe(false);
  expect(SPORTS.some((s) => s.has("toString"))).toBe(false);
});

test("matchState maps football-data statuses to pre/in/post", () => {
  expect(matchState({ status: "IN_PLAY" })).toBe("in");
  expect(matchState({ status: "PAUSED" })).toBe("in");
  expect(matchState({ status: "FINISHED" })).toBe("post");
  expect(matchState({ status: "AWARDED" })).toBe("post");
  expect(matchState({ status: "TIMED" })).toBe("pre");
  expect(matchState({ status: "POSTPONED" })).toBe("pre");
});

test("lastAndNext: latest finished game and first unstarted one at/after now", () => {
  const rows = [row("c", 30, "pre"), row("a", -30, "post"), row("b", -5, "post"), row("live", -1, "in"), row("stale", -2, "pre")];
  const { last, next } = lastAndNext(rows, NOW);
  expect(last?.id).toBe("b");
  expect(next?.id).toBe("c");
  expect(lastAndNext([], NOW)).toEqual({ last: null, next: null });
});

test("nextPerTeam: one next game per team, a shared game once, soonest first", () => {
  const shared = row("shared", 48, "pre");
  const rows = nextPerTeam(
    [
      { team: "Jazz", rows: [shared] },
      { team: "Nuggets", rows: [row("x", 72, "pre"), shared] },
      { team: "Mammoth", rows: [row("m", 3, "pre")] },
      { team: "Idle", rows: [row("old", -3, "post")] },
    ],
    NOW,
  );
  expect(rows.map((r) => r.id)).toEqual(["m", "shared"]);
});

test("tagged prefixes the sport's icon and label", () => {
  expect(strip(tagged({ icon: "🏀", label: "NBA" }, "UTAH @ DEN"))).toBe("🏀 NBA   UTAH @ DEN");
});

test("bareHint names the sports that have a command, keeps args, else says unknown", () => {
  const sports = [sport("fifa", { has: (c) => c === "standings" || c === "next" }), sport("nba", { has: (c) => c === "standings" || c === "next" }), sport("nhl")];
  expect(bareHint("standings", [], sports)).toEqual([
    "`standings` needs a sport:",
    "  sportsing fifa standings · sportsing nba standings",
  ]);
  expect(bareHint("next", ["--team", "USA"], sports, true)).toEqual([
    "Bare `next` takes no options — add a sport:",
    "  sportsing fifa next --team USA · sportsing nba next --team USA",
  ]);
  expect(bareHint("nope", [], sports)[0]).toBe("Unknown command: nope");
});

test("noFavoritesHint points at `sportsing <sport> fav add <team>` with an example per sport", () => {
  const [hint, eg] = noFavoritesHint(SPORTS).map(strip);
  expect(hint).toContain("sportsing <sport> fav add <team>");
  expect(eg).toContain("sportsing fifa fav add USA · sportsing nba fav add UTAH · sportsing nhl fav add UTAH");
});

test("today with no favorites anywhere prints the add-a-favorite hint", async () => {
  const { out } = await capture(() => today([sport("nba"), sport("nhl")], []));
  expect(out.join("\n")).toContain("sportsing <sport> fav add <team>");
  expect(out.join("\n")).not.toContain("Your teams");
});

test("today merges every sport's favorite games by start time, each tagged", async () => {
  const sports = [
    sport("nba", { icon: "🏀", favoritesOn: async () => [row("jazz", 2, "pre")] }),
    sport("nhl", { icon: "🏒", favoritesOn: async () => [row("mammoth", 1, "in")] }),
    sport("fifa", { icon: "⚽" }), // no favorites: skipped silently
  ];
  const { out, err } = await capture(() => today(sports, []));
  const lines = out.filter((l) => l.startsWith("  "));
  expect(lines).toEqual(["  🏒 NHL   game mammoth", "  🏀 NBA   game jazz"]);
  expect(out[0]).toMatch(/^★ Your teams — Today \(\d{4}-\d{2}-\d{2}\)$/);
  expect(err).toEqual([]);
});

test("a sport that fails is reported, the rest still print, exit code is non-zero", async () => {
  const sports = [
    sport("nba", { favoritesOn: async () => [row("jazz", 2, "pre")] }),
    sport("nhl", { favoritesOn: async () => Promise.reject(new Error("ESPN down")) }),
  ];
  const { out, err } = await capture(() => today(sports, ["--tomorrow"]));
  expect(err).toEqual(["Couldn't load NHL: ESPN down"]);
  expect(out[0]).toContain("Tomorrow");
  expect(out).toContain("  * NBA   game jazz");
  expect(process.exitCode).toBe(1);
});

test("next lists each favorite's next game across sports, soonest first", async () => {
  const sports = [
    sport("nba", { favoriteTeams: async () => [{ team: "Utah Jazz", rows: [row("j0", -20, "post"), row("j1", 50, "pre")] }] }),
    sport("nhl", { favoriteTeams: async () => [{ team: "Utah Mammoth", rows: [row("m1", 5, "pre")] }] }),
  ];
  const { out } = await capture(() => next(sports));
  const games = out.filter((l) => l.includes("game "));
  expect(games.map((l) => l.trim())).toEqual(["* NHL   game m1", "* NBA   game j1"]);
});

test("me shows last + next per team, grouped by sport", async () => {
  const sports = [
    sport("nba", { favoriteTeams: async () => [{ team: "Utah Jazz", rows: [row("j0", -20, "post"), row("j1", 50, "pre")] }] }),
    sport("nhl", { favoriteTeams: async () => [{ team: "Utah Mammoth", rows: [] }] }),
  ];
  const { out } = await capture(() => me(sports));
  const text = out.join("\n");
  expect(text).toContain("* Utah Jazz NBA");
  expect(text).toContain("  last game j0");
  expect(text).toMatch(/ {2}next game j1 {2}in 2d/);
  expect(text).toContain("* Utah Mammoth NHL\n  no games found");
});
