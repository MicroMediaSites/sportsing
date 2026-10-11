import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure helpers only — no network; the cache and ~/.config/sportsing are never touched.
import { SERIEA } from "./sports/soccer.ts";
import { parseMatchBoxscore, type EspnStandings, type EspnTeam, type MatchBoxscore } from "./espn.ts";
import type { Game } from "./game.ts";
import {
  averagePosition,
  betterSide,
  buildAheadRow,
  buildComparison,
  meetings,
  recordOf,
  renderAhead,
  renderComparison,
  sortHardestFirst,
  tablePlaces,
  upcomingOpponents,
  type AheadReport,
  type AheadRow,
  type TablePlace,
} from "./stats-compare.ts";
import { buildTeamLines, samplesFromBoxscores, teamResults, type LeagueStats } from "./stats.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8"));

// ── Better side ──────────────────────────────────────────────────────────────

test("betterSide: respects higherIsBetter, ties, and missing values", () => {
  expect(betterSide({ higherIsBetter: true }, 54, 46)).toBe("a");
  expect(betterSide({ higherIsBetter: true }, 40, 46)).toBe("b");
  expect(betterSide({ higherIsBetter: false }, 14, 9)).toBe("b"); // fewer fouls is better
  expect(betterSide({ higherIsBetter: false }, 8, 9)).toBe("a");
  expect(betterSide({ higherIsBetter: true }, 3, 3)).toBe("tie");
  expect(betterSide({ higherIsBetter: false }, null, 3)).toBeNull();
  expect(betterSide({ higherIsBetter: true }, 3, null)).toBeNull();
});

// ── Meetings ─────────────────────────────────────────────────────────────────

const game = (id: string, date: string, home: [string, string, string], away: [string, string, string], state: Game["state"] = "post"): Game => ({
  id,
  date,
  name: `${away[1]} at ${home[1]}`,
  state,
  detail: state === "post" ? "FT" : "",
  period: 0,
  clock: "",
  seasonType: "regular",
  home: { id: home[0], name: home[1], abbreviation: home[1], score: home[2] },
  away: { id: away[0], name: away[1], abbreviation: away[1], score: away[2] },
  broadcasts: [],
});

test("meetings: only finished games against that opponent, a's point of view", () => {
  const games = [
    game("1", "2026-09-01T18:00Z", ["A", "AAA", "2"], ["B", "BBB", "1"]),
    game("2", "2026-09-08T18:00Z", ["C", "CCC", "0"], ["A", "AAA", "0"]),
    game("3", "2026-09-15T18:00Z", ["B", "BBB", "3"], ["A", "AAA", "3"]),
    game("4", "2026-12-01T18:00Z", ["A", "AAA", ""], ["B", "BBB", ""], "pre"),
  ];
  const results = teamResults(games, "A", "wdl");
  const met = meetings({ results }, "B");
  expect(met.map((m) => m.gameId)).toEqual(["1", "3"]);
  expect(met.map((m) => [m.home, m.scored, m.conceded, m.outcome])).toEqual([
    [true, 2, 1, "W"],
    [false, 3, 3, "D"],
  ]);
  expect(meetings({ results }, "Z")).toEqual([]);
});

// ── Table places ─────────────────────────────────────────────────────────────

const entry = (teamId: string, stats: Record<string, string>) => ({ teamId, team: teamId, abbreviation: teamId, stats });

test("tablePlaces: merges conferences and orders league-wide; NBA shows no points", () => {
  const standings: EspnStandings = {
    season: 2026,
    seasonName: "2025-26",
    groups: [
      { name: "East", abbreviation: "E", parent: null, entries: [entry("e1", { wins: "50", losses: "32", winPercent: "0.610", points: "9" }), entry("e2", { wins: "60", losses: "22", winPercent: "0.732" })] },
      { name: "West", abbreviation: "W", parent: null, entries: [entry("w1", { wins: "55", losses: "27", winPercent: "0.671" })] },
    ],
  };
  const places = tablePlaces(standings, "wl", { rankBy: "winPercent" });
  expect([...places].map(([id, p]) => [id, p.position])).toEqual([["e2", 1], ["w1", 2], ["e1", 3]]);
  expect(places.get("e1")).toEqual({ position: 3, record: "50-32", points: null });
});

test("recordOf: W-D-L for soccer, W-L-OTL for the NHL", () => {
  expect(recordOf({ wins: "3", ties: "1", losses: "1" }, "wdl")).toBe("3-1-1");
  expect(recordOf({ wins: "4", losses: "2", otLosses: "1" }, "wl-otl")).toBe("4-2-1");
});

// ── Ahead ────────────────────────────────────────────────────────────────────

const places = (...pairs: [string, number][]): Map<string, TablePlace> =>
  new Map(pairs.map(([id, position]) => [id, { position, record: "", points: null }]));

test("averagePosition: mean of the known positions, null when none", () => {
  expect(averagePosition([1, 2, 6])).toBe(3);
  expect(averagePosition([1, null, 2])).toBe(1.5);
  expect(averagePosition([null])).toBeNull();
  expect(averagePosition([])).toBeNull();
});

test("upcomingOpponents: next unplayed games in date order, home/away and position, capped", () => {
  const games = [
    game("9", "2026-10-30T18:00Z", ["X", "XXX", ""], ["B", "BBB", ""], "pre"),
    game("1", "2026-10-01T18:00Z", ["X", "XXX", "1"], ["Y", "YYY", "0"]), // already played
    game("3", "2026-10-20T18:00Z", ["C", "CCC", ""], ["X", "XXX", ""], "pre"),
    game("2", "2026-10-10T18:00Z", ["X", "XXX", ""], ["Y", "YYY", ""], "pre"),
    game("2", "2026-10-10T18:00Z", ["X", "XXX", ""], ["Y", "YYY", ""], "pre"), // duplicate listing
    game("5", "2026-10-12T18:00Z", ["P", "PPP", ""], ["Q", "QQQ", ""], "pre"), // not X's
  ];
  const opps = upcomingOpponents(games, "X", places(["Y", 4], ["C", 12]), 2);
  expect(opps.map((o) => [o.id, o.home, o.position])).toEqual([["Y", true, 4], ["C", false, 12]]);
  expect(upcomingOpponents(games, "X", places(), 5).map((o) => o.position)).toEqual([null, null, null]);
});

test("sortHardestFirst: lowest average opponent position first, unknown last", () => {
  const row = (name: string, avg: number | null): AheadRow => ({
    team: { id: name, abbreviation: name, name, favorite: false, position: null },
    next: [],
    avgOpponentPosition: avg,
  });
  const sorted = sortHardestFirst([row("Easy", 14.2), row("None", null), row("Hard", 7), row("Also hard", 7)]);
  expect(sorted.map((r) => r.team.name)).toEqual(["Also hard", "Hard", "Easy", "None"]);
});

test("buildAheadRow + renderAhead: averages, away marker, last-season note", () => {
  const games = [
    game("1", "2026-10-20T18:00Z", ["X", "XXX", ""], ["Y", "YYY", ""], "pre"),
    game("2", "2026-10-27T18:00Z", ["C", "CCC", ""], ["X", "XXX", ""], "pre"),
  ];
  const row = buildAheadRow({ id: "X", abbreviation: "XXX", name: "Xs" }, games, places(["X", 5], ["Y", 2], ["C", 10]), true);
  expect(row.avgOpponentPosition).toBe(6);
  expect(row.team).toMatchObject({ favorite: true, position: 5 });
  const report: AheadReport = { league: "NBA", sport: "nba", kind: "last-season", tableSeason: "2025-26", teams: [row] };
  const list = strip(renderAhead(report, false));
  expect(list).toContain("★ Xs");
  expect(list).toContain("YYY 2  @CCC 10");
  expect(list).toContain("2025-26's final table");
  expect(strip(renderAhead(report, true))).toContain("Average opponent position 6.0");
  expect(strip(renderAhead({ ...report, kind: "current" }, false))).not.toContain("final table");
});

// ── Compare render, from the real Serie A boxscore fixture ───────────────────

const teams: EspnTeam[] = [
  { id: "111", abbreviation: "JUV", name: "Juventus", shortName: "Juventus", location: "Juventus" },
  { id: "105", abbreviation: "ATA", name: "Atalanta", shortName: "Atalanta", location: "Atalanta" },
  { id: "999", abbreviation: "FAR", name: "Faraway", shortName: "Faraway", location: "Faraway" },
];
const boxes: MatchBoxscore[] = fixture("soccer-summaries-seriea.json").map((s: any) => parseMatchBoxscore(s)!);

function leagueStats(extra: Game[]): LeagueStats {
  const games = [
    game("401874757", "2026-09-13T16:00Z", ["111", "JUV", "2"], ["105", "ATA", "0"]),
    ...extra,
  ];
  const results = new Map(teams.map((t) => [t.id, teamResults(games, t.id, "wdl")]));
  return {
    sport: "seriea",
    label: "Serie A",
    profile: SERIEA.statProfile,
    kind: "current",
    season: 2026,
    seasonName: "2026-27",
    upcoming: "",
    teams: buildTeamLines(SERIEA.statProfile, teams, samplesFromBoxscores(boxes), results),
  };
}

const juvPlaces = new Map<string, TablePlace>([
  ["111", { position: 3, record: "1-0-0", points: 3 }],
  ["105", { position: 12, record: "0-0-1", points: 0 }],
]);

test("compare render: header, stat rows with the better side marked, meeting listed", () => {
  const stats = leagueStats([]);
  const [a, b] = [stats.teams.find((t) => t.teamId === "111")!, stats.teams.find((t) => t.teamId === "105")!];
  const cmp = buildComparison(stats, a, b, juvPlaces, new Set(["111"]));
  expect(cmp.stats).toHaveLength(SERIEA.statProfile.stats.length);
  expect(cmp.meetings).toEqual([{ date: "2026-09-13T16:00Z", home: "a", a: 2, b: 0, winner: "a" }]);

  const out = strip(renderComparison(cmp));
  const lines = out.split("\n");
  expect(lines[0]).toContain("★ Juventus");
  expect(lines[0]).toContain("1-0-0, 3 pts");
  expect(lines[0]).toContain("#3 in the table");
  expect(lines[0]).toContain("form W");
  expect(lines[1]).toContain("Atalanta");
  expect(lines[1]).not.toContain("★");
  expect(lines[1]).toContain("#12 in the table");

  // The ✓ sits in the better side's cell: A is cols 26-40, B the rest. Goals
  // for: higher is better; goals against: lower is better. Juventus won 2-0.
  const row = (label: string) => lines.find((l) => l.startsWith(label))!;
  const sideOf = (label: string) => (row(label).slice(26, 41).includes("✓") ? "a" : row(label).slice(41).includes("✓") ? "b" : null);
  expect(cmp.stats.find((s) => s.key === "goalsFor")!.better).toBe("a");
  expect(cmp.stats.find((s) => s.key === "goalsAgainst")!.better).toBe("a");
  expect(sideOf("Goals for")).toBe("a");
  expect(sideOf("Goals against")).toBe("a");
  expect(row("Goals against").match(/✓/g)).toHaveLength(1);

  expect(out).toContain("Meetings this season (2026-27)");
  expect(out).toContain("JUV 2-0 ATA");
  expect(out).toContain("JUV home, JUV won");
});

test("compare render: teams that haven't met say so", () => {
  const stats = leagueStats([]);
  const a = stats.teams.find((t) => t.teamId === "111")!;
  const far = stats.teams.find((t) => t.teamId === "999")!;
  const cmp = buildComparison(stats, a, far, juvPlaces);
  expect(cmp.meetings).toEqual([]);
  const out = strip(renderComparison(cmp));
  expect(out).toContain("JUV and FAR haven't met this season.");
  expect(out).not.toContain("Meetings this season");
  // Faraway has no data: its cells are blank dashes and nothing is marked for it.
  expect(out).toContain("—");
  expect(cmp.stats.every((s) => s.better === null)).toBe(true);
  expect(cmp.teams.b).toMatchObject({ record: null, position: null, played: 0, form: [] });
});

test("compare JSON is a plain object", () => {
  const stats = leagueStats([]);
  const a = stats.teams.find((t) => t.teamId === "111")!;
  const b = stats.teams.find((t) => t.teamId === "105")!;
  const cmp = buildComparison(stats, a, b, juvPlaces);
  expect(JSON.parse(JSON.stringify(cmp))).toEqual(cmp);
  expect(cmp.stats[0]).toMatchObject({ key: expect.any(String), format: expect.any(String), better: expect.any(String) });
});

test("compare render: preseason (last-season) says whose figures these are", () => {
  const stats = { ...leagueStats([]), kind: "last-season" as const, seasonName: "2025-26" };
  const [a, b] = [stats.teams[0]!, stats.teams[1]!];
  expect(strip(renderComparison(buildComparison(stats, a, b, new Map())))).toContain("figures and table are 2025-26's");
});
