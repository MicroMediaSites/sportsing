import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure helpers only — no network, never reads or writes ~/.config/sportsing.
// Club-soccer shared-layer behavior, exercised with a local LeagueConfig (the
// epl/seriea/ligue1 namespaces are separate).
import { SOCCER_NEXT_SCAN_DAYS, firstUpcoming, mergeGames, scanDays, scanForNext, type LeagueConfig } from "../commands/league.ts";
import { LEAGUES, isClubSoccer, parseStandingsResponse, toGame } from "../espn.ts";
import { SOCCER_PERIODS, gameLine, isDraw, periodLabel, periodStatus, soccerStatus } from "../format.ts";
import type { Game } from "../game.ts";
import { teamForm } from "../league-ai.ts";
import { EPL as REAL_EPL } from "./soccer.ts";
import { STANDINGS_LAYOUTS, hasGames, renderStandingsTable } from "../standings.ts";

const raw = (name: string): any =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "espn", name), "utf8"));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const EPL: LeagueConfig = {
  sport: "epl",
  league: LEAGUES.epl,
  label: "Premier League",
  icon: "⚽",
  aliases: {},
  periods: SOCCER_PERIODS,
  nextScanDays: SOCCER_NEXT_SCAN_DAYS,
  statProfile: REAL_EPL.statProfile,
};

const board = raw("soccer-scoreboard-matchday.json").events.map((e: any) => toGame(e)) as Game[];
const byName = (name: string): Game => board.find((g) => g.name === name)!;

function game(over: Partial<Game>): Game {
  return {
    id: "1",
    date: "2026-10-11T16:00Z",
    name: "",
    state: "in",
    detail: "",
    period: 1,
    clock: "",
    seasonType: "regular",
    home: { id: "1", name: "Home", abbreviation: "HOM", score: "0" },
    away: { id: "2", name: "Away", abbreviation: "AWY", score: "0" },
    broadcasts: [],
    ...over,
  };
}

test("league keys map to ESPN's club-soccer paths", () => {
  expect([LEAGUES.epl, LEAGUES.seriea, LEAGUES.ligue1]).toEqual(["soccer/eng.1", "soccer/ita.1", "soccer/fra.1"]);
  expect(isClubSoccer(LEAGUES.ligue1)).toBe(true);
  expect(isClubSoccer(LEAGUES.nhl)).toBe(false);
  expect(isClubSoccer(LEAGUES.fifa)).toBe(false);
});

test("soccer events parse as regular-season games (league-specific season type ids are ignored)", () => {
  const live = byName("AC Milan at Sassuolo");
  expect(live).toMatchObject({ state: "in", period: 2, clock: "77'", detail: "77'", seasonType: "regular" });
  expect(live.home.score).toBe("1");
  const fixtures = raw("soccer-schedule-fixtures.json").events.map((e: any) => toGame(e));
  expect(fixtures.map((g: Game) => [g.state, g.seasonType, g.home.score])).toEqual([
    ["pre", "regular", ""],
    ["pre", "regular", ""],
    ["pre", "regular", ""],
  ]);
});

test("draws: a level full-time score is a draw, rendered without a winner", () => {
  const draw = byName("Everton at Hull City");
  const win = byName("Manchester City at Liverpool");
  expect(isDraw(draw)).toBe(true);
  expect(isDraw(win)).toBe(false);
  const line = strip(gameLine(draw, SOCCER_PERIODS));
  expect(line).toContain("EVE     2");
  expect(line).toContain("HUL     2");
  expect(line).toContain("FT · draw");
  expect(strip(gameLine(win, SOCCER_PERIODS))).not.toContain("draw");
});

test("isDraw: only finished games with both scores level", () => {
  expect(isDraw(game({ state: "post", home: { id: "1", name: "H", abbreviation: "H", score: "0" }, away: { id: "2", name: "A", abbreviation: "A", score: "0" } }))).toBe(true);
  expect(isDraw(game({ state: "in" }))).toBe(false); // level but still live
  expect(isDraw(game({ state: "pre", home: { id: "1", name: "H", abbreviation: "H", score: "" }, away: { id: "2", name: "A", abbreviation: "A", score: "" } }))).toBe(false);
});

test("teamForm: a draw is a D, not dropped or counted as a loss", () => {
  const results = raw("soccer-schedule-results.json").events.map((e: any) => toGame(e)) as Game[];
  const draw = game({
    id: "9",
    date: "2026-09-01T14:00Z",
    state: "post",
    home: { id: "382", name: "Manchester City", abbreviation: "MNC", score: "1" },
    away: { id: "5", name: "Other", abbreviation: "OTH", score: "1" },
  });
  const form = teamForm([...results, draw], "382");
  expect(form.find((f) => f.date === "2026-09-01")).toMatchObject({ result: "D", for: 1, against: 1 });
  expect(form.filter((f) => f.result !== "D").every((f) => f.result === "W" && f.for > f.against)).toBe(true);
});

test("soccerStatus: halves with the match minute, HT, extra time, penalties, finals", () => {
  expect(soccerStatus(game({ period: 1, clock: "23'", detail: "23'" }))).toBe("23' - 1st half");
  expect(soccerStatus(game({ period: 1, clock: "45'+2'", detail: "45'+2'" }))).toBe("45'+2' - 1st half");
  expect(soccerStatus(game({ period: 1, clock: "45'", detail: "HT" }))).toBe("HT");
  expect(soccerStatus(game({ period: 2, clock: "67'", detail: "67'" }))).toBe("67' - 2nd half");
  expect(soccerStatus(game({ period: 3, clock: "96'", detail: "96'" }))).toBe("96' - 1st ET");
  expect(soccerStatus(game({ period: 4, clock: "112'", detail: "112'" }))).toBe("112' - 2nd ET");
  expect(soccerStatus(game({ period: 3, clock: "105'", detail: "Break" }))).toBe("Break");
  expect(soccerStatus(game({ period: 5, clock: "120'", detail: "Penalties" }))).toBe("Pens");
  expect(soccerStatus(game({ period: 2, clock: "", detail: "Delayed" }))).toBe("Delayed");
  expect(soccerStatus(game({ period: 2, clock: "", detail: "" }))).toBe("2nd half");
  expect(soccerStatus(game({ period: 0, detail: "Scheduled" }))).toBe("Scheduled");
  expect(soccerStatus(game({ state: "post", period: 2 }))).toBe("FT");
  expect(soccerStatus(game({ state: "post", period: 4 }))).toBe("AET");
  expect(soccerStatus(game({ state: "post", period: 5 }))).toBe("FT/Pens");
});

test("periodStatus / periodLabel dispatch on the soccer naming; the live fixture renders LIVE + minute", () => {
  expect(periodStatus(game({ period: 2, clock: "67'" }), SOCCER_PERIODS)).toBe("67' - 2nd half");
  expect([1, 2, 3, 4, 5].map((p) => periodLabel({ period: p, seasonType: "regular" }, SOCCER_PERIODS))).toEqual([
    "1st half",
    "2nd half",
    "1st ET",
    "2nd ET",
    "Pens",
  ]);
  expect(strip(gameLine(byName("AC Milan at Sassuolo"), SOCCER_PERIODS))).toContain("LIVE  77' - 2nd half");
});

test("standings: one points table, ESPN's rank order, P W D L GF GA GD Pts", () => {
  const data = parseStandingsResponse(raw("soccer-standings.json"));
  expect(data.season).toBe(2026);
  expect(data.groups).toHaveLength(1);
  expect(hasGames(data.groups)).toBe(true);
  const layout = STANDINGS_LAYOUTS[LEAGUES.epl]!;
  expect(layout.singleTable).toBe(true);
  expect(STANDINGS_LAYOUTS[LEAGUES.seriea]).toBe(layout);
  expect(STANDINGS_LAYOUTS[LEAGUES.ligue1]).toBe(layout);

  const out = strip(renderStandingsTable(data.groups[0]!, layout, new Set(["359"]))).split("\n");
  expect(out[1]).toMatch(/#\s+Team\s+P\s+W\s+D\s+L\s+GF\s+GA\s+GD\s+Pts$/);
  const rows = out.slice(2);
  expect(rows[0]).toMatch(/^1\s+Manchester City\s+6\s+6\s+0\s+0\s+16\s+5\s+\+11\s+18$/);
  expect(rows[1]).toMatch(/^2\s+★ Arsenal\s/); // favorite marked
  expect(rows.map((r) => Number(r.trim().split(/\s+/).at(-1))).every((p, i, a) => i === 0 || p <= a[i - 1]!)).toBe(true);
});

test("standings: rows tied on points keep ESPN's rank order (not alphabetical)", () => {
  const data = parseStandingsResponse(raw("soccer-standings.json"));
  const layout = STANDINGS_LAYOUTS[LEAGUES.epl]!;
  const e = data.groups[0]!.entries;
  const shuffled = { ...data.groups[0]!, entries: [e[3]!, e[0]!, e[2]!, e[1]!, e[5]!, e[4]!] };
  const names = strip(renderStandingsTable(shuffled, layout, new Set())).split("\n").slice(2);
  expect(names.map((r) => r.trim().split(/\s{2,}/)[1])).toEqual(e.map((x) => x.team));
});

test("next across an international break: a longer scan reaches the first match back", async () => {
  const now = Date.parse("2026-10-11T18:00Z");
  const restart = game({ id: "r", state: "pre", date: "2026-10-24T14:00Z" });
  // Nothing scheduled until 13 days out (a two-week break), then the restart.
  const gamesOn = async (i: number) => (i === 13 ? [restart] : []);
  expect(await scanForNext(14, now, async (i) => (i === 13 ? [restart] : []))).toBe(restart);
  expect(await scanForNext(10, now, gamesOn)).toBeNull(); // a short window misses it
  expect(scanDays(EPL)).toBe(28);
  expect(scanDays({})).toBe(14); // NBA/NHL default unchanged
  expect(await scanForNext(scanDays(EPL), now, async (i) => (i === 17 ? [restart] : []))).toBe(restart);
  expect(await scanForNext(scanDays({}), now, async (i) => (i === 17 ? [restart] : []))).toBeNull();
});

test("a team's next match: fixtures are listed apart from results, and merge in order", () => {
  const results = raw("soccer-schedule-results.json").events.map((e: any) => toGame(e));
  const fixtures = raw("soccer-schedule-fixtures.json").events.map((e: any) => toGame(e));
  const season = mergeGames([results, fixtures]);
  const next = firstUpcoming(season, Date.parse("2026-10-12T00:00Z"));
  expect(next?.name).toBe("Ipswich Town at Manchester City");
  expect(season.at(-1)?.state).toBe("pre");
});
