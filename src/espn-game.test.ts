import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toGame, getScoreboardGames, LEAGUES, SEASON_TYPES } from "./espn.ts";

// Real ESPN responses captured 2026-10-04 (trimmed of logos/leaders/links),
// under fixtures/espn/. Pure parsing only — no network, no config.
const fixture = (name: string): any[] =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8")).events;
const byId = (events: any[], id: string) => events.find((e) => e.id === id);

const nbaSchedule = fixture("nba-schedule-preseason.json");
const nbaScoreboard = fixture("nba-scoreboard-preseason-final.json");
const nhlSchedule = fixture("nhl-schedule-regular.json");

test("NBA preseason final (team schedule): Jazz @ Nuggets", () => {
  const g = toGame(byId(nbaSchedule, "401914127"), SEASON_TYPES.preseason);
  expect(g).toEqual({
    id: "401914127",
    date: "2026-10-04T23:00Z",
    name: "Utah Jazz at Denver Nuggets",
    state: "post",
    detail: "Final",
    period: 4,
    clock: "",
    seasonType: "preseason",
    home: { id: "7", name: "Denver Nuggets", abbreviation: "DEN", score: "97" },
    away: { id: "26", name: "Utah Jazz", abbreviation: "UTAH", score: "109" },
    broadcasts: [{ name: "NBA TV", market: "national" }],
  });
});

test("NBA preseason scheduled game: pre state, no score, period 0, no broadcasts yet", () => {
  const g = toGame(byId(nbaSchedule, "401914128"), SEASON_TYPES.preseason);
  expect(g.state).toBe("pre");
  expect(g.seasonType).toBe("preseason");
  expect(g.period).toBe(0);
  expect(g.clock).toBe("");
  expect(g.detail).toBe("10/6 - 9:00 PM EDT");
  expect(g.home).toEqual({ id: "26", name: "Utah Jazz", abbreviation: "UTAH", score: "" });
  expect(g.away.score).toBe("");
  expect(g.broadcasts).toEqual([]);
});

test("scoreboard shape maps to the same Game as the team-schedule shape", () => {
  // Scoreboard: string scores, `season.type`, condensed `broadcasts` + `geoBroadcasts`.
  const fromSb = toGame(byId(nbaScoreboard, "401914127"));
  const fromSched = toGame(byId(nbaSchedule, "401914127"), SEASON_TYPES.preseason);
  expect(fromSb).toEqual(fromSched);
});

test("scoreboard's condensed broadcasts are used when geoBroadcasts is absent", () => {
  const e = structuredClone(byId(nbaScoreboard, "401914127"));
  delete e.competitions[0].geoBroadcasts;
  expect(toGame(e).broadcasts).toEqual([{ name: "NBA TV", market: "national" }]);
});

test("NHL regular season with broadcasts: Mammoth @ Rangers on Utah 16 (Away)", () => {
  const g = toGame(byId(nhlSchedule, "401892443"), SEASON_TYPES.regular);
  expect(g.seasonType).toBe("regular");
  expect(g.state).toBe("post");
  expect(g.period).toBe(3);
  expect(g.home).toEqual({ id: "13", name: "New York Rangers", abbreviation: "NYR", score: "4" });
  expect(g.away).toEqual({ id: "129764", name: "Utah Mammoth", abbreviation: "UTA", score: "2" });
  expect(g.broadcasts).toEqual([
    { name: "ESPN+", market: "national" },
    { name: "MSG", market: "home" },
    { name: "Utah 16", market: "away" },
  ]);
});

test("NHL home game: Utah 16 is the Home feed; national-only game has no local feed", () => {
  const home = toGame(byId(nhlSchedule, "401892500"), SEASON_TYPES.regular);
  expect(home.state).toBe("pre");
  expect(home.home.abbreviation).toBe("UTA");
  expect(home.broadcasts).toContainEqual({ name: "Utah 16", market: "home" });

  const national = toGame(byId(nhlSchedule, "401891828"), SEASON_TYPES.regular);
  expect(national.broadcasts.every((b) => b.market === "national")).toBe(true);
  expect(national.broadcasts.map((b) => b.name)).toEqual(["Disney+", "ESPN+", "Hulu"]);
});

test("a live game carries period + clock", () => {
  // No game was live at capture time: the real final, flipped to in-progress.
  const e = structuredClone(byId(nhlSchedule, "401892443"));
  e.competitions[0].status = {
    clock: 261,
    displayClock: "4:21",
    period: 2,
    type: { state: "in", shortDetail: "4:21 - 2nd" },
  };
  const g = toGame(e, SEASON_TYPES.regular);
  expect(g.state).toBe("in");
  expect(g.period).toBe(2);
  expect(g.clock).toBe("4:21");
  expect(g.detail).toBe("4:21 - 2nd");
});

test("season type: event wins over the requested type; requested is the fallback", () => {
  const e = structuredClone(byId(nbaSchedule, "401914127"));
  expect(toGame(e, SEASON_TYPES.postseason).seasonType).toBe("preseason");
  delete e.seasonType;
  delete e.season;
  expect(toGame(e, SEASON_TYPES.postseason).seasonType).toBe("postseason");
  expect(toGame(e).seasonType).toBe("regular");
  e.seasonType = { type: 5 }; // NBA play-in
  expect(toGame(e).seasonType).toBe("postseason");
});

test("unknown broadcast markets and duplicates are dropped, not guessed", () => {
  const e = structuredClone(byId(nhlSchedule, "401892443"));
  const bc = e.competitions[0].broadcasts;
  bc.push({ market: { type: "Regional" }, media: { shortName: "Mystery" } });
  bc.push(structuredClone(bc[0]));
  bc.push({ market: { type: "Home" }, media: {} });
  expect(toGame(e).broadcasts).toHaveLength(3);
});

test("a malformed event degrades to placeholders instead of throwing", () => {
  const g = toGame({ id: 1 });
  expect(g.id).toBe("1");
  expect(g.state).toBe("pre");
  expect(g.home).toEqual({ id: "", name: "TBD", abbreviation: "", score: "" });
  expect(g.broadcasts).toEqual([]);
});

test("getScoreboardGames rejects date ranges before any request", async () => {
  await expect(getScoreboardGames(LEAGUES.nba, "20261004-20261005")).rejects.toThrow("YYYYMMDD");
});
