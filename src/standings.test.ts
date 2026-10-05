import { test, expect } from "bun:test";
// Pure — the standings fetch is a fake; no network, no ~/.config/sportsing.
import {
  STANDINGS_LAYOUTS,
  gamesPlayed,
  groupMatches,
  hasGames,
  loadStandingsView,
  renderStandingsTable,
  sortEntries,
} from "./standings.ts";
import { LEAGUES, SEASON_TYPES, type EspnStandings, type EspnStandingsEntry, type EspnStandingsGroup, type StandingsQuery } from "./espn.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const entry = (teamId: string, team: string, stats: Record<string, string>): EspnStandingsEntry => ({
  teamId,
  team,
  abbreviation: team.slice(0, 3).toUpperCase(),
  stats,
});
const group = (name: string, abbreviation: string, entries: EspnStandingsEntry[]): EspnStandingsGroup => ({
  name,
  abbreviation,
  parent: null,
  entries,
});

test("gamesPlayed: ESPN's gamesPlayed when present, else summed results", () => {
  expect(gamesPlayed(entry("1", "A", { gamesPlayed: "4", wins: "3", losses: "1" }))).toBe(4);
  expect(gamesPlayed(entry("1", "A", { wins: "53", losses: "29" }))).toBe(82);
  expect(gamesPlayed(entry("1", "A", { wins: "-", losses: "" }))).toBe(0);
});

test("hasGames: any team in any table", () => {
  expect(hasGames([group("East", "East", [entry("1", "A", { wins: "0", losses: "0" })])])).toBe(false);
  expect(hasGames([group("East", "East", []), group("West", "West", [entry("2", "B", { wins: "1", losses: "0" })])])).toBe(true);
});

test("sortEntries: rank stat descending, then seed (unseeded last), then name", () => {
  const sorted = sortEntries(
    [
      // Seed 7 after the play-in despite the worse record — record wins.
      entry("22", "Portland", { winPercent: ".512", playoffSeed: "7" }),
      entry("21", "Phoenix", { winPercent: ".549", playoffSeed: "8" }),
      entry("23", "Sacramento", { winPercent: ".268", playoffSeed: "14" }),
      entry("26", "Utah", { winPercent: ".268", playoffSeed: "15" }),
      entry("1", "Unseeded", { winPercent: ".268", playoffSeed: "0" }),
      entry("2", "Alpha", {}),
    ],
    "winPercent",
  );
  expect(sorted.map((e) => e.team)).toEqual(["Phoenix", "Portland", "Sacramento", "Utah", "Unseeded", "Alpha"]);
  const nhl = sortEntries([entry("1", "B", { points: "4", playoffSeed: "5" }), entry("2", "A", { points: "6", playoffSeed: "1" })], "points");
  expect(nhl.map((e) => e.team)).toEqual(["A", "B"]);
});

test("groupMatches: abbreviation, full name, or first word — case-insensitive", () => {
  const west = { name: "Western Conference", abbreviation: "West" };
  const pac = { name: "Pacific Division", abbreviation: "PAC" };
  const nw = { name: "Northwest", abbreviation: "NW" };
  expect(groupMatches(west, "west")).toBe(true);
  expect(groupMatches(west, "Western")).toBe(true);
  expect(groupMatches(west, "western conference")).toBe(true);
  expect(groupMatches(west, "east")).toBe(false);
  expect(groupMatches(pac, "pac")).toBe(true);
  expect(groupMatches(pac, "Pacific")).toBe(true);
  expect(groupMatches(nw, "northwest")).toBe(true);
  expect(groupMatches(nw, " ")).toBe(false);
});

const played = (season: number, seasonName: string): EspnStandings => ({
  season,
  seasonName,
  groups: [group("West", "West", [entry("26", "Utah Jazz", { wins: "22", losses: "60" })])],
});
const empty = (season: number | null, seasonName: string): EspnStandings => ({
  season,
  seasonName,
  groups: [group("West", "West", [entry("26", "Utah Jazz", { wins: "0", losses: "0" })])],
});

function fakeFetch(bySeason: Record<string, EspnStandings>) {
  const calls: StandingsQuery[] = [];
  const fetch = async (q: StandingsQuery) => {
    calls.push(q);
    return bySeason[String(q.season ?? "current")]!;
  };
  return { fetch, calls };
}

test("loadStandingsView: current regular season once games are played", async () => {
  const { fetch, calls } = fakeFetch({ current: played(2027, "2026-27") });
  const view = await loadStandingsView(fetch, "division");
  expect(view.kind).toBe("current");
  expect(calls).toEqual([{ seasonType: SEASON_TYPES.regular, level: "division" }]);
});

test("loadStandingsView: before the regular season, last season's final standings", async () => {
  const { fetch, calls } = fakeFetch({ current: empty(2027, "2026-27"), "2026": played(2026, "2025-26") });
  const view = await loadStandingsView(fetch, "conference");
  expect(view).toMatchObject({ kind: "last-season", upcoming: "2026-27", standings: { seasonName: "2025-26" } });
  expect(calls[1]).toEqual({ season: 2026, seasonType: SEASON_TYPES.regular, level: "conference" });
});

test("loadStandingsView: not started when ESPN has no prior standings either", async () => {
  const both = fakeFetch({ current: empty(2027, "2026-27"), "2026": empty(2026, "2025-26") });
  expect(await loadStandingsView(both.fetch, "conference")).toEqual({ kind: "not-started", upcoming: "2026-27" });
  // No season year to step back from — don't guess.
  const noYear = fakeFetch({ current: empty(null, "") });
  expect(await loadStandingsView(noYear.fetch, "conference")).toEqual({ kind: "not-started", upcoming: "" });
  expect(noYear.calls).toHaveLength(1);
});

test("renderStandingsTable: NBA columns, sorted, favorite starred", () => {
  const west = group("Western Conference", "West", [
    entry("26", "Utah Jazz", { wins: "22", losses: "60", winPercent: ".268", gamesBehind: "42", playoffSeed: "15" }),
    entry("25", "Oklahoma City Thunder", { wins: "64", losses: "18", winPercent: ".780", gamesBehind: "-", playoffSeed: "1" }),
  ]);
  const lines = strip(renderStandingsTable(west, STANDINGS_LAYOUTS[LEAGUES.nba]!, new Set(["26"]))).split("\n");
  expect(lines[0]).toBe("Western Conference");
  expect(lines[1]!.split(/\s+/)).toEqual(["#", "Team", "W", "L", "PCT", "GB"]);
  expect(lines[2]).toContain("Oklahoma City Thunder");
  expect(lines[2]).not.toContain("★");
  expect(lines[3]).toContain("★ Utah Jazz");
  expect(lines[3]!.trim().split(/\s+/).slice(-4)).toEqual(["22", "60", ".268", "42"]);
});

test("renderStandingsTable: NHL columns; a missing stat shows as -", () => {
  const pac = group("Pacific Division", "PAC", [
    entry("129764", "Utah Mammoth", { gamesPlayed: "4", wins: "3", losses: "1", points: "6", playoffSeed: "1" }),
  ]);
  const lines = strip(renderStandingsTable(pac, STANDINGS_LAYOUTS[LEAGUES.nhl]!, new Set())).split("\n");
  expect(lines[1]!.split(/\s+/)).toEqual(["#", "Team", "GP", "W", "L", "OTL", "PTS"]);
  expect(lines[2]!.trim().split(/\s+/).slice(-5)).toEqual(["4", "3", "1", "-", "6"]);
});
