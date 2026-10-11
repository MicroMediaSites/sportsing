import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure helpers only — no network; the cache and ~/.config/sportsing are never touched.
import { NBA } from "./sports/nba.ts";
import { NHL } from "./sports/nhl.ts";
import { SERIEA } from "./sports/soccer.ts";
import { parseMatchBoxscore, parseTeamStatistics, NotFinishedError, type EspnTeam, type MatchBoxscore } from "./espn.ts";
import type { Game } from "./game.ts";
import {
  assignRanks,
  buildTeamLines,
  formatStat,
  loadLeagueStats,
  outcomeOf,
  profileValues,
  rankBy,
  samplesFromBoxscores,
  sampleFromTeamStats,
  teamResults,
  type StatsFetchers,
  type StatProfile,
} from "./stats.ts";

const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8"));
const stat = (profile: StatProfile, key: string) => profile.stats.find((s) => s.key === key)!;

// ── Soccer: two Serie A summaries (Juventus 2-0 Atalanta, Atalanta 1-2 Cagliari) ──

const boxes = (): MatchBoxscore[] => fixture("soccer-summaries-seriea.json").map((s: any) => parseMatchBoxscore(s)!);

test("parseMatchBoxscore: finished match → scores and numeric stats per team", () => {
  const [juveAta] = boxes();
  expect(juveAta!.id).toBe("401874757");
  expect(juveAta!.home).toMatchObject({ teamId: "111", score: 2 });
  expect(juveAta!.away).toMatchObject({ teamId: "105", score: 0 });
  expect(typeof juveAta!.home.stats.possessionPct).toBe("number");
  expect(juveAta!.home.stats.totalShots).toBeGreaterThan(0);
});

test("parseMatchBoxscore: unfinished or empty summaries are null", () => {
  const raw = fixture("soccer-summaries-seriea.json")[0];
  const live = structuredClone(raw);
  live.header.competitions[0].status.type.state = "in";
  expect(parseMatchBoxscore(live)).toBeNull();
  expect(parseMatchBoxscore({})).toBeNull();
  expect(new NotFinishedError("x")).toBeInstanceOf(Error);
});

test("soccer aggregation: per-match means, goals from scores, ratios weight by volume", () => {
  const samples = samplesFromBoxscores(boxes());
  const ata = samples.get("105")!;
  expect(ata.played).toBe(2);
  const [m1, m2] = boxes();
  const ataShots = (m1!.away.stats.totalShots! + m2!.home.stats.totalShots!) / 2;
  const values = profileValues(SERIEA.statProfile, ata);
  expect(values.totalShots).toBeCloseTo(ataShots, 9);
  expect(values.goalsFor).toBeCloseTo(0.5, 9); // 0 and 1
  expect(values.goalsAgainst).toBeCloseTo(2, 9); // 2 and 2
  const acc = m1!.away.stats.accuratePasses! + m2!.home.stats.accuratePasses!;
  const tot = m1!.away.stats.totalPasses! + m2!.home.stats.totalPasses!;
  expect(values.passAccuracy).toBeCloseTo((acc / tot) * 100, 9);
  // Juventus played once: its means are that match's figures.
  expect(profileValues(SERIEA.statProfile, samples.get("111")!).totalShots).toBe(m1!.home.stats.totalShots!);
  expect(samples.size).toBe(3);
});

test("a stat the source lacks is null, not zero", () => {
  const values = profileValues(SERIEA.statProfile, { played: 1, fields: {}, totals: {} });
  expect(Object.values(values).every((v) => v === null)).toBe(true);
});

// ── NBA / NHL: one real team-stats response each ─────────────────────────────

test("NBA team-stats: ESPN averages read as-is; points allowed from the results", () => {
  const parsed = parseTeamStatistics(fixture("nba-team-statistics.json"));
  expect(parsed.games).toBe(82);
  const results = [
    { scored: 100, conceded: 90 },
    { scored: 110, conceded: 120 },
  ].map((r, i) => ({ gameId: String(i), date: "", home: true, opponentId: "", opponent: "", outcome: "W" as const, ...r }));
  const values = profileValues(NBA.statProfile, sampleFromTeamStats(parsed, results));
  expect(values.avgPoints).toBeCloseTo(117.585365, 5);
  expect(values.fieldGoalPct).toBeCloseTo(46.713, 3);
  expect(values.threePointPct).toBeCloseTo(34.464, 2);
  expect(values.avgSteals).toBeCloseTo(8.890244, 5);
  expect(values.avgBlocks).toBeCloseTo(3.768293, 5);
  expect(values.pointsAllowed).toBeCloseTo(210 / 82, 9); // results total ÷ games from the stats
  expect(Object.values(values).every((v) => v !== null)).toBe(true);
});

test("NHL team-stats: per-game rates and percentages derived from totals", () => {
  const parsed = parseTeamStatistics(fixture("nhl-team-statistics.json"));
  expect(parsed.games).toBe(6);
  const values = profileValues(NHL.statProfile, sampleFromTeamStats(parsed, []));
  expect(values.goalsPerGame).toBeCloseTo(22 / 6, 9);
  expect(values.shotsPerGame).toBeCloseTo(191 / 6, 9);
  expect(values.shotsAgainstPerGame).toBeCloseTo(135 / 6, 9);
  expect(values.savePct).toBeCloseTo((120 / 135) * 100, 9);
  expect(values.powerPlayGoalsPerGame).toBeCloseTo(10 / 6, 9);
  expect(values.penaltyMinutesPerGame).toBeCloseTo(80 / 6, 9);
  expect(values.faceoffPercent).toBeCloseTo(53.168, 3);
  expect(values.shootingPct).toBeCloseTo(11.518, 3);
  expect(values.avgGoalsAgainst).toBeCloseTo(2.5, 9);
});

test("a preseason response (no stats yet) gives zero games and null values", () => {
  const parsed = parseTeamStatistics({ status: "success", season: { year: 2027 } });
  expect(parsed.games).toBeNull();
  const values = profileValues(NBA.statProfile, sampleFromTeamStats(parsed, []));
  expect(values.avgPoints).toBeNull();
});

// ── Ranking ──────────────────────────────────────────────────────────────────

test("assignRanks: best first, ties share a rank, nulls unranked", () => {
  expect(assignRanks([10, 30, 30, 20, null], true)).toEqual([4, 1, 1, 3, null]);
  expect(assignRanks([10, 30, 30, 20, null], false)).toEqual([1, 3, 3, 2, null]);
  expect(assignRanks([], true)).toEqual([]);
});

const PROFILE: StatProfile = {
  source: "boxscores",
  form: "wdl",
  stats: [
    { key: "good", label: "Good", short: "G", higherIsBetter: true, format: "avg" },
    { key: "bad", label: "Bad", short: "B", higherIsBetter: false, format: "int" },
  ],
};
const T = (id: string, name: string): EspnTeam => ({ id, abbreviation: name.slice(0, 3).toUpperCase(), name, shortName: name, location: name });

test("rankBy: respects higherIsBetter, shares tied ranks, skips teams without a value", () => {
  const teams = [T("1", "Ajax"), T("2", "Bari"), T("3", "Cesena"), T("4", "Derby")];
  const sample = (good: number, bad: number) => ({ played: 3, fields: { good, bad }, totals: {} });
  const samples = new Map([
    ["1", sample(5, 2)],
    ["2", sample(7, 2)],
    ["3", sample(7, 9)],
  ]);
  const lines = buildTeamLines(PROFILE, teams, samples, new Map());
  const stats = { sport: "x", label: "X", profile: PROFILE, kind: "current" as const, season: 2026, seasonName: "2026-27", upcoming: "", teams: lines };
  expect(rankBy(stats, "good").map((r) => [r.team.name, r.rank, r.value])).toEqual([
    ["Bari", 1, 7],
    ["Cesena", 1, 7],
    ["Ajax", 3, 5],
  ]);
  expect(rankBy(stats, "bad").map((r) => [r.team.name, r.rank])).toEqual([["Ajax", 1], ["Bari", 1], ["Cesena", 3]]);
  const derby = lines.find((l) => l.name === "Derby")!;
  expect(derby).toMatchObject({ played: 0, ranks: { good: null, bad: null } });
  expect(() => rankBy(stats, "nope")).toThrow(/Unknown stat/);
});

// ── Results and form ─────────────────────────────────────────────────────────

const game = (id: string, date: string, home: [string, string], away: [string, string], detail = "FT", state: Game["state"] = "post"): Game => ({
  id,
  date,
  name: "",
  state,
  detail,
  period: 0,
  clock: "",
  seasonType: "regular",
  home: { id: home[0], name: home[0], abbreviation: `T${home[0]}`, score: home[1] },
  away: { id: away[0], name: away[0], abbreviation: `T${away[0]}`, score: away[1] },
  broadcasts: [],
});

test("outcomeOf: W/D/L, and OTL only for overtime losses where the profile tracks it", () => {
  expect(outcomeOf(2, 1, "FT", "wdl")).toBe("W");
  expect(outcomeOf(1, 1, "FT", "wdl")).toBe("D");
  expect(outcomeOf(0, 1, "FT", "wdl")).toBe("L");
  expect(outcomeOf(2, 3, "Final/OT", "wl-otl")).toBe("OTL");
  expect(outcomeOf(2, 3, "Final/SO", "wl-otl")).toBe("OTL");
  expect(outcomeOf(2, 3, "Final", "wl-otl")).toBe("L");
  expect(outcomeOf(100, 101, "Final/OT", "wl")).toBe("L");
});

test("teamResults: finished games only, oldest first, home/away and score from the team's side", () => {
  const games = [
    game("3", "2026-09-20T18:00Z", ["1", "0"], ["2", "0"], "FT", "pre"),
    game("2", "2026-09-13T18:00Z", ["2", "1"], ["1", "1"]),
    game("1", "2026-09-06T18:00Z", ["1", "3"], ["2", "0"]),
    game("1", "2026-09-06T18:00Z", ["1", "3"], ["2", "0"]), // duplicate
    game("9", "2026-09-07T18:00Z", ["5", "1"], ["6", "0"]), // someone else's
  ];
  expect(teamResults(games, "1", "wdl")).toEqual([
    { gameId: "1", date: "2026-09-06T18:00Z", home: true, opponentId: "2", opponent: "T2", scored: 3, conceded: 0, outcome: "W" },
    { gameId: "2", date: "2026-09-13T18:00Z", home: false, opponentId: "2", opponent: "T2", scored: 1, conceded: 1, outcome: "D" },
  ]);
});

// ── Orchestration with fake fetchers ─────────────────────────────────────────

const view = (season: number, played: number) => ({
  season,
  seasonName: `${season - 1}-${season}`,
  groups: [{ name: "T", abbreviation: "T", parent: null, entries: [{ teamId: "1", team: "A", abbreviation: "A", stats: { gamesPlayed: String(played), wins: String(played) } }] }],
});

function fakes(calls: string[], currentGames: number): StatsFetchers {
  return {
    standings: async (_l, q) => (q.season === undefined ? view(2027, currentGames) : view(q.season, 82)),
    teams: async () => [T("1", "Ajax"), T("2", "Bari")],
    teamStatistics: async (_l, id, season) => {
      calls.push(`stats:${id}:${season}`);
      return { games: 2, values: { avgPoints: id === "1" ? 100 : 90 } };
    },
    teamGames: async (_l, id, season) => {
      calls.push(`games:${id}:${season}`);
      return [game("g1", "2026-01-01T00:00Z", ["1", "3"], ["2", "1"])];
    },
    boxscore: async () => {
      throw new Error("not used");
    },
  };
}

test("loadLeagueStats: before the regular season it uses last season, as standings does", async () => {
  const calls: string[] = [];
  const nba = await loadLeagueStats(NBA, fakes(calls, 0));
  expect(nba).toMatchObject({ kind: "last-season", season: 2026, seasonName: "2025-2026" });
  expect(calls).toContain("stats:1:2026");
  expect(rankBy(nba, "avgPoints").map((r) => r.team.abbreviation)).toEqual(["AJA", "BAR"]);
  const ajax = nba.teams.find((t) => t.teamId === "1")!;
  expect(ajax.form).toEqual([expect.objectContaining({ home: true, scored: 3, conceded: 1, outcome: "W" })]);
  expect(ajax.played).toBe(2);
});

test("loadLeagueStats: once games are played it uses the current season", async () => {
  const calls: string[] = [];
  const nba = await loadLeagueStats(NBA, fakes(calls, 6));
  expect(nba).toMatchObject({ kind: "current", season: 2027 });
  expect(calls).toContain("stats:1:2027");
});

test("formatStat", () => {
  expect(formatStat(stat(NBA.statProfile, "fieldGoalPct"), 46.713)).toBe("46.7%");
  expect(formatStat(stat(NHL.statProfile, "goalsPerGame"), 3.6667)).toBe("3.67");
  expect(formatStat(stat(NBA.statProfile, "avgPoints"), 117.585)).toBe("117.6");
  expect(formatStat({ format: "int" }, 543.6)).toBe("544");
  expect(formatStat({ format: "int" }, null)).toBe("—");
});
