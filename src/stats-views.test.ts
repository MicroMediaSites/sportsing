import { test, expect } from "bun:test";
// Pure — hand-built LeagueStats; no network, no ~/.config/sportsing.
import { NBA } from "./sports/nba.ts";
import { NHL } from "./sports/nhl.ts";
import { SERIEA } from "./sports/soccer.ts";
import {
  formJson,
  formRow,
  formRows,
  formatForm,
  parseStatsArgs,
  rankingJson,
  recordText,
  renderFormTable,
  renderRanking,
  renderStatList,
  resolveStat,
  seasonNotice,
} from "./stats-views.ts";
import { assignRanks, type LeagueStats, type Outcome, type StatProfile, type TeamResult, type TeamStatLine } from "./stats.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

let n = 0;
const res = (home: boolean, scored: number, conceded: number, outcome?: Outcome): TeamResult => ({
  gameId: String(++n),
  date: new Date(2026, 8, n).toISOString(),
  home,
  opponentId: "x",
  opponent: "XXX",
  scored,
  conceded,
  outcome: outcome ?? (scored > conceded ? "W" : scored === conceded ? "D" : "L"),
});

const line = (id: string, name: string, results: TeamResult[], values: Record<string, number | null> = {}): TeamStatLine => ({
  teamId: id,
  abbreviation: name.slice(0, 3).toUpperCase(),
  name,
  played: results.length,
  values,
  ranks: {},
  results,
  form: results.slice(-5),
});

const league = (profile: StatProfile, teams: TeamStatLine[], kind: LeagueStats["kind"] = "current"): LeagueStats => ({
  sport: "x",
  label: "X",
  profile,
  kind,
  season: 2026,
  seasonName: "2026-27",
  upcoming: "2027-28",
  teams,
});

// ── derivation ──

test("soccer row: points, PPG, home/away splits, clean sheets, failed to score", () => {
  const rs = [res(true, 2, 0), res(false, 0, 0), res(true, 0, 1), res(false, 3, 1), res(true, 1, 1), res(false, 0, 2)];
  const r = formRow(line("1", "Alpha", rs), "wdl");
  expect(r.played).toBe(6);
  expect(r.overall).toEqual({ w: 2, d: 2, l: 2, otl: 0 });
  expect(r.points).toBe(8);
  expect(r.ppg).toBeCloseTo(8 / 6);
  expect(r.winPct).toBeNull();
  expect(recordText(r.home, "wdl")).toBe("1-1-1");
  expect(recordText(r.away, "wdl")).toBe("1-1-1");
  expect(r.scoredPerGame).toBeCloseTo(6 / 6);
  expect(r.concededPerGame).toBeCloseTo(5 / 6);
  expect(r.cleanSheets).toBe(2);
  expect(r.failedToScore).toBe(3);
  expect(r.form).toEqual(["D", "L", "W", "D", "L"]);
});

test("NBA row: win%, W-L splits, no soccer-only columns", () => {
  const rs = [res(true, 110, 100), res(true, 90, 100), res(false, 120, 99), res(false, 101, 100)];
  const r = formRow(line("1", "Alpha", rs), "wl");
  expect(r.winPct).toBeCloseTo(0.75);
  expect(r.ppg).toBeNull();
  expect(r.points).toBeNull();
  expect(recordText(r.home, "wl")).toBe("1-1");
  expect(recordText(r.away, "wl")).toBe("2-0");
  expect(r.cleanSheets).toBeNull();
  expect(r.failedToScore).toBeNull();
});

test("NHL row: OTL counts as its own record column and a standings point", () => {
  const rs = [res(true, 3, 2), res(false, 2, 3, "OTL"), res(true, 1, 4)];
  const r = formRow(line("1", "Alpha", rs), "wl-otl");
  expect(r.points).toBe(3);
  expect(r.winPct).toBeCloseTo(1 / 3);
  expect(recordText(r.home, "wl-otl")).toBe("1-1-0");
  expect(recordText(r.away, "wl-otl")).toBe("0-0-1");
  expect(strip(formatForm(r.form))).toBe("W OTL L");
});

test("a team with no games gets null rates and sorts last", () => {
  const stats = league(SERIEA.statProfile, [line("1", "Zed", []), line("2", "Beta", [res(true, 1, 0)])]);
  expect(formRow(stats.teams[0]!, "wdl").ppg).toBeNull();
  expect(formRows(stats).map((r) => r.name)).toEqual(["Beta", "Zed"]);
});

test("soccer table order: points, then goal difference, then goals for", () => {
  const stats = league(SERIEA.statProfile, [
    line("1", "A", [res(true, 1, 0), res(true, 1, 0)]),
    line("2", "B", [res(true, 3, 0), res(true, 1, 0)]),
    line("3", "C", [res(true, 0, 0), res(true, 0, 0)]),
  ]);
  expect(formRows(stats).map((r) => r.name)).toEqual(["B", "A", "C"]);
});

test("form table renders letters, favorites star and the right columns per sport", () => {
  const soccer = league(SERIEA.statProfile, [line("1", "Alpha", [res(true, 0, 0)]), line("2", "Beta", [res(true, 2, 0)])]);
  const out = strip(renderFormTable(soccer, new Set(["1"])));
  expect(out).toContain("PPG");
  expect(out).toContain("FTS");
  expect(out).toMatch(/★ Alpha/);
  expect(out).not.toMatch(/★ Beta/);
  const nba = strip(renderFormTable(league(NBA.statProfile, [line("1", "Alpha", [res(true, 100, 90)])]), new Set()));
  expect(nba).toContain("W%");
  expect(nba).not.toContain("FTS");
  expect(nba).toContain("100.0%");
  expect(strip(renderFormTable(league(NHL.statProfile, [line("1", "Alpha", [res(true, 3, 2)])]), new Set()))).toContain("PTS");
});

test("last-season stats carry a notice; current ones don't", () => {
  expect(seasonNotice(league(NBA.statProfile, [], "last-season"))).toContain("2027-28 regular season hasn't started");
  expect(seasonNotice(league(NBA.statProfile, []))).toBeNull();
});

// ── --by resolution ──

test("resolveStat: key, short or label, case-insensitive; unknown is null", () => {
  const p = NBA.statProfile;
  expect(resolveStat(p, "threePointPct")?.key).toBe("threePointPct");
  expect(resolveStat(p, "THREEPOINTPCT")?.key).toBe("threePointPct");
  expect(resolveStat(p, "3P%")?.key).toBe("threePointPct");
  expect(resolveStat(p, "3p")?.key).toBe("threePointPct");
  expect(resolveStat(p, "Three-point %")?.key).toBe("threePointPct");
  expect(resolveStat(p, "points allowed")?.key).toBe("pointsAllowed");
  expect(resolveStat(p, "xg")).toBeNull();
  expect(resolveStat(p, "")).toBeNull();
});

test("resolveStat: an exact short beats a looser match (Pass vs Pass%)", () => {
  expect(resolveStat(SERIEA.statProfile, "pass")?.key).toBe("totalPasses");
  expect(resolveStat(SERIEA.statProfile, "pass%")?.key).toBe("passAccuracy");
});

test("stat list names every stat with its direction", () => {
  const out = strip(renderStatList(NBA.statProfile));
  for (const s of NBA.statProfile.stats) expect(out).toContain(s.short);
  expect(out).toContain("lower is better");
});

// ── ranking ──

function withStat(profile: StatProfile, key: string, rows: [string, string, number | null][]): LeagueStats {
  const lines = rows.map(([id, name, v]) => line(id, name, [res(true, 1, 0)], { [key]: v }));
  const def = profile.stats.find((s) => s.key === key)!;
  const ranks = assignRanks(lines.map((l) => l.values[key] ?? null), def.higherIsBetter);
  lines.forEach((l, i) => (l.ranks[key] = ranks[i]!));
  return league(profile, lines);
}

test("ranking: ties share a rank, higherIsBetter is honored, missing values omitted", () => {
  const high = withStat(NBA.statProfile, "avgAssists", [["1", "A", 20], ["2", "B", 25], ["3", "C", 20], ["4", "D", 10], ["5", "E", null]]);
  const def = resolveStat(NBA.statProfile, "avgAssists")!;
  const j = rankingJson(high, def, new Set(["2"]));
  expect(j.teams.map((t) => [t.name, t.rank])).toEqual([["B", 1], ["A", 2], ["C", 2], ["D", 4]]);
  expect(j.teams[0]!.favorite).toBe(true);
  const low = withStat(NBA.statProfile, "avgTurnovers", [["1", "A", 14], ["2", "B", 12], ["3", "C", 12]]);
  const lj = rankingJson(low, resolveStat(NBA.statProfile, "avgTurnovers")!, new Set());
  expect(lj.teams.map((t) => [t.name, t.rank])).toEqual([["B", 1], ["C", 1], ["A", 3]]);
});

test("ranking table: rank, team, formatted value and matches played", () => {
  const s = withStat(NBA.statProfile, "threePointPct", [["1", "A", 36.25], ["2", "B", 38]]);
  const out = strip(renderRanking(s, resolveStat(NBA.statProfile, "3p")!, new Set(["1"])));
  expect(out).toMatch(/1\s+B\s+38\.0%\s+1/);
  expect(out).toMatch(/2\s+★ A\s+36\.3%\s+1/);
  expect(out).toContain("higher is better");
});

// ── --json shape ──

test("form --json shape", () => {
  const stats = league(SERIEA.statProfile, [line("7", "Alpha", [res(true, 2, 0), res(false, 0, 1)])]);
  const j = formJson(stats, new Set(["7"]));
  expect(Object.keys(j)).toEqual(["sport", "label", "kind", "season", "seasonName", "teams"]);
  expect(j.teams[0]).toEqual({
    position: 1,
    teamId: "7",
    abbreviation: "ALP",
    name: "Alpha",
    favorite: true,
    played: 2,
    form: ["W", "L"],
    points: 3,
    pointsPerGame: 1.5,
    winPct: null,
    overall: { w: 1, d: 0, l: 1, otl: 0, text: "1-0-1" },
    home: { w: 1, d: 0, l: 0, otl: 0, text: "1-0-0" },
    away: { w: 0, d: 0, l: 1, otl: 0, text: "0-0-1" },
    scoredPerGame: 1,
    concededPerGame: 0.5,
    cleanSheets: 1,
    failedToScore: 1,
  });
  expect(JSON.parse(JSON.stringify(j))).toEqual(j);
});

test("ranking --json shape", () => {
  const s = withStat(NBA.statProfile, "threePointPct", [["1", "A", 36.25]]);
  const j = rankingJson(s, resolveStat(NBA.statProfile, "3p")!, new Set());
  expect(j.stat).toEqual({ key: "threePointPct", label: "Three-point %", short: "3P%", higherIsBetter: true, format: "pct" });
  expect(j.teams[0]).toEqual({ rank: 1, teamId: "1", abbreviation: "A", name: "A", favorite: false, value: 36.25, formatted: "36.3%", played: 1 });
});

// ── args ──

test("parseStatsArgs: modes and errors", () => {
  expect(parseStatsArgs([])).toEqual({ mode: "form", json: false });
  expect(parseStatsArgs(["--json"])).toEqual({ mode: "form", json: true });
  expect(parseStatsArgs(["--list"])).toEqual({ mode: "list", json: false });
  expect(parseStatsArgs(["--by", "shots", "on", "target", "--json"])).toEqual({ mode: "by", stat: "shots on target", json: true });
  expect(parseStatsArgs(["Juventus", "Roma"])).toEqual({ mode: "compare", a: "Juventus", b: "Roma", json: false });
  expect(parseStatsArgs(["--ahead"])).toEqual({ mode: "ahead", team: null, json: false });
  expect(parseStatsArgs(["--ahead", "Juventus", "--json"])).toEqual({ mode: "ahead", team: "Juventus", json: true });
  expect(() => parseStatsArgs(["--by"])).toThrow(/requires a stat/);
  expect(() => parseStatsArgs(["--nope"])).toThrow(/Unknown option/);
  expect(() => parseStatsArgs(["--by", "x", "--list"])).toThrow(/one of/);
  expect(() => parseStatsArgs(["only-one"])).toThrow(/Usage/);
});
