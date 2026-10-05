import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure helpers only — no network, never reads or writes ~/.config/sportsing.
import { NHL } from "./nhl.ts";
import { NBA } from "./nba.ts";
import { gameHasTeam, resolveTeam } from "../commands/league.ts";
import { toGame, SEASON_TYPES, type EspnTeam } from "../espn.ts";
import { gameLine, periodLabel, periodStatus } from "../format.ts";
import type { Game } from "../game.ts";

const fixture = (name: string): any[] =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "espn", name), "utf8")).events;

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const team = (id: string, abbreviation: string, name: string, shortName: string, location: string): EspnTeam => ({
  id,
  abbreviation,
  name,
  shortName,
  location,
});
// As ESPN's /teams lists them (Mammoth = UTAH there, UTA on schedules).
const NHL_TEAMS: EspnTeam[] = [
  team("129764", "UTAH", "Utah Mammoth", "Mammoth", "Utah"),
  team("4", "CHI", "Chicago Blackhawks", "Blackhawks", "Chicago"),
  team("20", "TB", "Tampa Bay Lightning", "Lightning", "Tampa Bay"),
  team("13", "NYR", "New York Rangers", "Rangers", "New York"),
  team("12", "NYI", "New York Islanders", "Islanders", "New York"),
];

function game(over: Partial<Game>): Game {
  return {
    id: "1",
    date: "2026-10-04T23:00Z",
    name: "",
    state: "in",
    detail: "",
    period: 1,
    clock: "",
    seasonType: "regular",
    home: { id: "129764", name: "Utah Mammoth", abbreviation: "UTA", score: "2" },
    away: { id: "4", name: "Chicago Blackhawks", abbreviation: "CHI", score: "1" },
    broadcasts: [],
    ...over,
  };
}

test("NHL is a league config on the shared command set, keyed separately from NBA", () => {
  expect(NHL.sport).toBe("nhl");
  expect(NHL.league).toBe("hockey/nhl");
  expect(NBA.sport).not.toBe(NHL.sport);
});

test("resolveTeam: the Mammoth by UTAH, UTA, id, nickname, full name, location", () => {
  for (const q of ["UTAH", "uta", "129764", "Mammoth", "utah mammoth", "Utah"]) {
    expect(resolveTeam(NHL_TEAMS, q, NHL.aliases)?.id).toBe("129764");
  }
  expect(resolveTeam(NHL_TEAMS, "TBL", NHL.aliases)?.id).toBe("20");
  expect(resolveTeam(NHL_TEAMS, "New York", NHL.aliases)).toBeNull(); // Rangers + Islanders
});

test("a real Mammoth schedule (competitors say UTA) matches the /teams id", () => {
  const games = fixture("nhl-schedule-regular.json").map((e) => toGame(e, SEASON_TYPES.regular));
  const mammoth = new Set([resolveTeam(NHL_TEAMS, "UTAH", NHL.aliases)!.id]);
  expect(games.length).toBeGreaterThan(0);
  expect(games.every((g) => gameHasTeam(g, mammoth))).toBe(true);
  const final = games.find((g) => g.id === "401891828")!;
  expect(strip(gameLine(final, NHL.periods))).toMatch(/^CHI\s+0\s+@\s+UTA\s+6\s+Final$/);
});

test("periodLabel: hockey periods 1st/2nd/3rd, OT, SO; playoff multi-OT", () => {
  const p = NHL.periods!;
  expect(periodLabel({ period: 0, seasonType: "regular" }, p)).toBe("");
  expect([1, 2, 3].map((n) => periodLabel({ period: n, seasonType: "regular" }, p))).toEqual(["1st", "2nd", "3rd"]);
  expect(periodLabel({ period: 4, seasonType: "regular" }, p)).toBe("OT");
  expect(periodLabel({ period: 5, seasonType: "regular" }, p)).toBe("SO");
  expect(periodLabel({ period: 5, seasonType: "preseason" }, p)).toBe("SO");
  expect(periodLabel({ period: 5, seasonType: "postseason" }, p)).toBe("2OT");
  expect(periodLabel({ period: 7, seasonType: "postseason" }, p)).toBe("4OT");
});

test("periodStatus: live clock, intermission, shootout, finals", () => {
  const p = NHL.periods!;
  expect(periodStatus(game({ period: 2, clock: "12:34" }), p)).toBe("12:34 - 2nd");
  expect(periodStatus(game({ period: 1, clock: "0:00" }), p)).toBe("End of 1st");
  expect(periodStatus(game({ period: 4, clock: "3:10" }), p)).toBe("3:10 - OT");
  expect(periodStatus(game({ period: 5, clock: "0:00" }), p)).toBe("SO");
  // No clock from the source: not an intermission — show the source's text.
  expect(periodStatus(game({ period: 2, clock: "", detail: "8:02 - 2nd" }), p)).toBe("8:02 - 2nd");
  expect(periodStatus(game({ period: 2, clock: "", detail: "" }), p)).toBe("2nd");
  expect(periodStatus(game({ state: "post", period: 3 }), p)).toBe("Final");
  expect(periodStatus(game({ state: "post", period: 4 }), p)).toBe("Final/OT");
  expect(periodStatus(game({ state: "post", period: 5 }), p)).toBe("Final/SO");
  expect(periodStatus(game({ state: "post", period: 6, seasonType: "postseason" }), p)).toBe("Final/3OT");
});

test("gameLine with NHL periods: LIVE + hockey clock, POST tag; source text without naming", () => {
  const live = game({ period: 3, clock: "4:21", detail: "source text", seasonType: "postseason" });
  expect(strip(gameLine(live, NHL.periods))).toMatch(/^CHI\s+1\s+@\s+UTA\s+2\s+LIVE\s+4:21 - 3rd POST$/);
  expect(strip(gameLine(live))).toMatch(/LIVE\s+source text POST$/);
  const pre = game({ state: "pre", period: 0, seasonType: "preseason", home: { ...game({}).home, score: "" } });
  expect(strip(gameLine(pre, NHL.periods))).toMatch(/^CHI\s+@\s+UTA\s+\d.*PRE$/);
});
