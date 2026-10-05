import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure helpers only — no network, never reads or writes ~/.config/sportsing.
import {
  resolveTeam,
  gameHasTeam,
  mergeGames,
  espnDate,
  firstUpcoming,
  finishedNewestFirst,
  watchTarget,
  easternScoreboardDate,
} from "./league.ts";
import { NBA } from "../sports/nba.ts";
import { toGame, SEASON_TYPES, type EspnTeam } from "../espn.ts";
import { gameLine, phaseTag } from "../format.ts";
import type { Game } from "../game.ts";

const fixture = (name: string): any[] =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "espn", name), "utf8")).events;

const team = (id: string, abbreviation: string, name: string, shortName: string, location: string): EspnTeam => ({
  id,
  abbreviation,
  name,
  shortName,
  location,
});
const NBA_TEAMS: EspnTeam[] = [
  team("26", "UTAH", "Utah Jazz", "Jazz", "Utah"),
  team("7", "DEN", "Denver Nuggets", "Nuggets", "Denver"),
  team("9", "GS", "Golden State Warriors", "Warriors", "Golden State"),
  team("12", "LAC", "LA Clippers", "Clippers", "LA"),
  team("13", "LAL", "Los Angeles Lakers", "Lakers", "LA"),
];

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function game(over: Partial<Game> & { id: string }): Game {
  return {
    date: "2026-10-04T23:00Z",
    name: "",
    state: "pre",
    detail: "",
    period: 0,
    clock: "",
    seasonType: "regular",
    home: { id: "7", name: "Denver Nuggets", abbreviation: "DEN", score: "" },
    away: { id: "26", name: "Utah Jazz", abbreviation: "UTAH", score: "" },
    broadcasts: [],
    ...over,
  };
}

test("resolveTeam: abbreviation, id, nickname, full name, case-insensitive", () => {
  for (const q of ["UTAH", "utah", "26", "Jazz", "utah jazz"]) {
    expect(resolveTeam(NBA_TEAMS, q, NBA.aliases)?.id).toBe("26");
  }
});

test("resolveTeam: league aliases map NBA.com codes to ESPN's", () => {
  expect(resolveTeam(NBA_TEAMS, "UTA", NBA.aliases)?.id).toBe("26");
  expect(resolveTeam(NBA_TEAMS, "gsw", NBA.aliases)?.id).toBe("9");
  // Without the alias table, UTA is unknown (ESPN's /teams says UTAH).
  expect(resolveTeam(NBA_TEAMS, "UTA")).toBeNull();
});

test("resolveTeam: an ambiguous location resolves to nothing; unknown/blank → null", () => {
  expect(resolveTeam(NBA_TEAMS, "Denver", NBA.aliases)?.id).toBe("7"); // unique location
  expect(resolveTeam(NBA_TEAMS, "LA", NBA.aliases)).toBeNull(); // Clippers + Lakers share "LA"
  expect(resolveTeam(NBA_TEAMS, "LAC", NBA.aliases)?.id).toBe("12");
  expect(resolveTeam(NBA_TEAMS, "XYZ", NBA.aliases)).toBeNull();
  expect(resolveTeam(NBA_TEAMS, "  ", NBA.aliases)).toBeNull();
});

test("gameHasTeam matches by competitor id, not abbreviation (Mammoth UTAH vs UTA)", () => {
  const g = game({ id: "1", away: { id: "129764", name: "Utah Mammoth", abbreviation: "UTA", score: "" } });
  expect(gameHasTeam(g, new Set(["129764"]))).toBe(true);
  expect(gameHasTeam(g, new Set(["26"]))).toBe(false);
});

test("mergeGames dedupes by id and sorts by start time", () => {
  const a = game({ id: "a", date: "2026-10-06T01:00Z" });
  const b = game({ id: "b", date: "2026-10-04T23:00Z" });
  expect(mergeGames([[a, b], [a]]).map((g) => g.id)).toEqual(["b", "a"]);
});

test("firstUpcoming skips started/finished games and past start times", () => {
  const now = Date.parse("2026-10-05T00:00Z");
  const games = [
    game({ id: "done", date: "2026-10-04T23:00Z", state: "post" }),
    game({ id: "stale", date: "2026-10-04T22:00Z", state: "pre" }),
    game({ id: "next", date: "2026-10-07T01:00Z", state: "pre" }),
  ];
  expect(firstUpcoming(mergeGames([games]), now)?.id).toBe("next");
  expect(firstUpcoming([], now)).toBeNull();
});

test("finishedNewestFirst keeps only finals, newest first", () => {
  const games = [
    game({ id: "old", date: "2026-10-03T23:00Z", state: "post" }),
    game({ id: "live", date: "2026-10-04T23:30Z", state: "in" }),
    game({ id: "new", date: "2026-10-04T23:00Z", state: "post" }),
  ];
  expect(finishedNewestFirst(games).map((g) => g.id)).toEqual(["new", "old"]);
});

test("espnDate formats a local calendar day as YYYYMMDD", () => {
  expect(espnDate(new Date(2026, 9, 4, 22, 30))).toBe("20261004");
});

test("phaseTag: preseason PRE, postseason POST, regular season untagged", () => {
  expect(phaseTag(game({ id: "1", seasonType: "preseason" }))).toBe("PRE");
  expect(phaseTag(game({ id: "1", seasonType: "postseason" }))).toBe("POST");
  expect(phaseTag(game({ id: "1", seasonType: "regular" }))).toBe("");
});

test("gameLine renders a real preseason final away @ home with scores and PRE", () => {
  const ev = fixture("nba-schedule-preseason.json").find((e) => e.id === "401914127");
  const line = strip(gameLine(toGame(ev, SEASON_TYPES.preseason)));
  expect(line).toMatch(/^UTAH\s+109\s+@\s+DEN\s+97\s+Final\s+PRE$/);
});

test("gameLine: scheduled games show no score; live games show LIVE + clock", () => {
  expect(strip(gameLine(game({ id: "1" })))).toMatch(/^UTAH\s+@\s+DEN\s+\d/);
  const live = game({
    id: "2",
    state: "in",
    detail: "4:21 - 3rd",
    seasonType: "postseason",
    home: { id: "7", name: "Denver Nuggets", abbreviation: "DEN", score: "70" },
    away: { id: "26", name: "Utah Jazz", abbreviation: "UTAH", score: "72" },
  });
  expect(strip(gameLine(live))).toMatch(/^UTAH\s+72\s+@\s+DEN\s+70\s+LIVE\s+4:21 - 3rd POST$/);
});

// ── watch ────────────────────────────────────────────────────────────────────

const H = 60 * 60_000;
const T0 = Date.parse("2026-10-04T23:00Z");

test("watchTarget: a live game wins over an earlier-listed upcoming one", () => {
  const games = [game({ id: "a", date: "2026-10-04T22:00Z" }), game({ id: "b", state: "in" })];
  expect(watchTarget(games, T0)?.id).toBe("b");
});

test("watchTarget: else the first game that hasn't started; finished games skipped", () => {
  const games = [
    game({ id: "old", state: "post", date: "2026-10-01T23:00Z" }),
    game({ id: "next", date: "2026-10-06T01:00Z" }),
    game({ id: "later", date: "2026-10-08T01:00Z" }),
  ];
  expect(watchTarget(games, T0)?.id).toBe("next");
  expect(watchTarget([game({ id: "old", state: "post" })], T0)).toBeNull();
});

test("watchTarget: a game past its start but not yet live is still the target (late tip-off)", () => {
  const games = [game({ id: "late", date: new Date(T0 - 20 * 60_000).toISOString() }), game({ id: "tomorrow", date: new Date(T0 + 24 * H).toISOString() })];
  expect(watchTarget(games, T0)?.id).toBe("late");
  // …but not forever: well past the grace window it moves on.
  expect(watchTarget(games, T0 + 4 * H)?.id).toBe("tomorrow");
});

test("easternScoreboardDate: ESPN's US-Eastern day, not UTC", () => {
  // 01:00Z on the 5th is 9 PM EDT on the 4th — a late Jazz tip-off.
  expect(easternScoreboardDate("2026-10-05T01:00Z")).toBe("20261004");
  expect(easternScoreboardDate("2026-10-04T23:00Z")).toBe("20261004");
  expect(easternScoreboardDate("2026-10-05T05:00Z")).toBe("20261005");
});

test("NBA watches on Fubo by default", () => {
  expect(NBA.watchProvider).toBe("fubo");
});
