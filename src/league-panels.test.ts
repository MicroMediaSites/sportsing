import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEAGUES, parseGameSummary, type EspnGameSummary } from "./espn.ts";
import {
  LEAGUE_PANELS,
  NBA_REGULATION_TIMEOUTS,
  SPECIAL_PANELS,
  currentPeriod,
  panelDefaults,
  periodFouls,
  shortName,
  timeoutsUsed,
} from "./league-panels.ts";
import { leagueBootstrap, snapshotOf } from "./league-overlay.ts";
import { snapshotAtDelay } from "./overlay.ts";

// Real ESPN `summary` responses captured 2026-10-04/05 (trimmed), under
// fixtures/espn/. Pure parsing only — no network, no config.
const summary = (name: string): EspnGameSummary =>
  parseGameSummary(JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8")))!;

const nba = LEAGUE_PANELS[LEAGUES.nba]!;
const nhl = LEAGUE_PANELS[LEAGUES.nhl]!;

test("play-by-play counts (NBA): timeouts per team; this period's team fouls, offensive/technical excluded", () => {
  const s = summary("nba-summary-overlay.json");
  expect(currentPeriod(s)).toBe(4); // header has none once final — taken from the plays
  expect([timeoutsUsed(s, "26"), timeoutsUsed(s, "7")]).toEqual([5, 5]);
  expect([periodFouls(s, "26", 4), periodFouls(s, "7", 4)]).toEqual([6, 4]);
});

test("shortName: first initial + the rest", () => {
  expect(shortName("Lauri Markkanen")).toBe("L. Markkanen");
  expect(shortName("Marvin Bagley III")).toBe("M. Bagley III");
  expect(shortName("Nenê")).toBe("Nenê");
});

test("NBA panels: FG%/3P%, PTS/REB/AST leaders, fouls, timeouts — away left, home right", () => {
  const rows = nba.rows(summary("nba-summary-overlay.json"));
  expect(rows.shooting).toEqual([
    { label: "FG", away: "39-93 · 42%", home: expect.stringMatching(/^\d+-\d+ · \d+%$/) },
    { label: "3PT", away: "15-45 · 33%", home: expect.stringMatching(/^\d+-\d+ · \d+%$/) },
  ]);
  expect(rows.leaders).toEqual([
    { label: "PTS", away: "L. Markkanen 17", home: "J. Strawther 14" },
    { label: "REB", away: "M. Bamba 7", home: "M. Bagley III 7" },
    { label: "AST", away: "I. Collier 4", home: "N. Jokic 7" },
  ]);
  expect(rows.fouls).toEqual([
    { label: "total", away: "25", home: "23" },
    { label: "this period", away: "6", home: "4" },
  ]);
  expect(rows.timeouts).toEqual([
    { label: "used", away: "5", home: "5" },
    { label: "left", away: String(NBA_REGULATION_TIMEOUTS - 5), home: String(NBA_REGULATION_TIMEOUTS - 5) },
  ]);
});

test("NBA timeouts: no rules-derived 'left' in overtime", () => {
  const g = summary("nba-summary-overlay.json");
  expect(nba.rows({ ...g, period: 5 }).timeouts!.map((r) => r.label)).toEqual(["used"]);
});

test("NHL panels: shots on goal, power plays, faceoff %, goalie saves", () => {
  const rows = nhl.rows(summary("nhl-summary-overlay.json"));
  expect(rows.shots).toEqual([{ label: "SOG", away: "31", home: "18" }]);
  expect(rows.powerplay).toEqual([
    { label: "PP", away: "3/4", home: "0/2" },
    { label: "PIM", away: "4", home: "8" },
  ]);
  expect(rows.faceoffs).toEqual([{ label: "FO%", away: "44.3%", home: "55.7%" }]);
  expect(rows.goalies).toEqual([{ label: "saves", away: "S. Cossa 17/18 .944", home: "J. Greaves 27/31 .871" }]);
});

test("panels before any stats: placeholders, no crash", () => {
  const g = parseGameSummary({ header: { competitions: [{ competitors: [{ homeAway: "home", team: { id: "1" } }, { homeAway: "away", team: { id: "2" } }] }] } })!;
  expect(nba.rows(g).shooting).toEqual([
    { label: "FG", away: "—", home: "—" },
    { label: "3PT", away: "—", home: "—" },
  ]);
  expect(nhl.rows(g).powerplay![0]).toEqual({ label: "PP", away: "—", home: "—" });
  expect(nhl.rows(g).goalies).toEqual([]);
});

test("panel specs: the ticket's panels, all off by default (just the gear)", () => {
  expect(nba.panels.map(([k]) => k)).toEqual(["score", "shooting", "leaders", "fouls", "timeouts", "catchup"]);
  expect(nhl.panels.map(([k]) => k)).toEqual(["score", "shots", "powerplay", "faceoffs", "goalies", "catchup"]);
  expect(panelDefaults(nhl)).toEqual({ score: false, shots: false, powerplay: false, faceoffs: false, goalies: false, catchup: false });
  // every non-score panel has rows
  const g = summary("nba-summary-overlay.json");
  for (const spec of [nba, nhl]) {
    expect(Object.keys(spec.rows(g)).sort()).toEqual(spec.panels.map(([k]) => k).filter((k) => !SPECIAL_PANELS.includes(k)).sort());
  }
});

test("leagueBootstrap: valid JS carrying the league's panels", () => {
  for (const [spec, icon] of [[nba, "🏀"], [nhl, "🏒"]] as const) {
    const js = leagueBootstrap(spec, icon);
    expect(() => new Function(js)).not.toThrow(); // parses; not executed (no DOM here)
    expect(js).toContain("var PANELS=" + JSON.stringify(spec.panels) + ";");
    expect(js).toContain(icon + " live");
    expect(js).toContain("catchupResult:function"); // "Get caught up" output hook
  }
});

test("snapshotOf: score line fields and panel rows from a summary", () => {
  const snap = snapshotOf(nhl, summary("nhl-summary-overlay.json"));
  expect(snap).toMatchObject({ away: "UTA", home: "CBJ", awayScore: "4", homeScore: "1", detail: "Final" });
  expect(snap.rows.shots).toEqual([{ label: "SOG", away: "31", home: "18" }]);
});

test("snapshotAtDelay: newest at/before the cutoff, else the oldest; null when empty", () => {
  const buf = [10_000, 20_000, 30_000].map((t) => ({ t, data: t }));
  expect(snapshotAtDelay([], 5, 40_000)).toBeNull();
  expect(snapshotAtDelay(buf, 0, 40_000)).toBe(30_000);
  expect(snapshotAtDelay(buf, 15, 40_000)).toBe(20_000);
  expect(snapshotAtDelay(buf, 60, 40_000)).toBe(10_000);
});
