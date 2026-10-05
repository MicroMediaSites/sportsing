import { test, expect } from "bun:test";
import type { EspnTeam } from "./espn.ts";
import type { Game } from "./game.ts";
import { gameBetween, teamsFromTitle } from "./league-detect.ts";

const team = (id: string, abbreviation: string, name: string, shortName: string, location: string): EspnTeam => ({
  id,
  abbreviation,
  name,
  shortName,
  location,
});

// Shapes as ESPN's /teams returns them (Jazz and Mammoth are both UTAH there).
const NBA = [
  team("26", "UTAH", "Utah Jazz", "Jazz", "Utah"),
  team("7", "DEN", "Denver Nuggets", "Nuggets", "Denver"),
  team("12", "LAC", "LA Clippers", "Clippers", "LA"),
  team("13", "LAL", "Los Angeles Lakers", "Lakers", "Los Angeles"),
  team("18", "NY", "New York Knicks", "Knicks", "New York"),
  team("17", "BKN", "Brooklyn Nets", "Nets", "Brooklyn"),
  team("14", "MIA", "Miami Heat", "Heat", "Miami"),
];
const NBA_ALIASES = { GSW: "GS", NYK: "NY", UTA: "UTAH" };
const NHL = [
  team("129764", "UTAH", "Utah Mammoth", "Mammoth", "Utah"),
  team("29", "CBJ", "Columbus Blue Jackets", "Blue Jackets", "Columbus"),
  team("13", "NYR", "New York Rangers", "Rangers", "New York"),
  team("12", "NYI", "New York Islanders", "Islanders", "New York"),
  team("10", "MTL", "Montreal Canadiens", "Canadiens", "Montreal"),
];

const pair = (title: string, teams: EspnTeam[], aliases = {}) => teamsFromTitle(title, teams, aliases)?.slice().sort() ?? null;

test("teamsFromTitle: full names, any separator, provider suffix", () => {
  expect(pair("Utah Jazz at Denver Nuggets - Fubo", NBA)).toEqual(["26", "7"]);
  expect(pair("Denver Nuggets vs. Utah Jazz | fubo.tv", NBA)).toEqual(["26", "7"]);
  expect(pair("Utah Mammoth @ Columbus Blue Jackets", NHL)).toEqual(["129764", "29"]);
});

test("teamsFromTitle: nicknames and unique locations, inside a longer program title", () => {
  expect(pair("NBA Preseason Basketball: Jazz at Nuggets", NBA)).toEqual(["26", "7"]);
  expect(pair("Utah v. Denver", NBA)).toEqual(["26", "7"]);
  expect(pair("Knicks vs Nets", NBA)).toEqual(["17", "18"]);
  expect(pair("Montréal Canadiens at Utah Mammoth", NHL)).toEqual(["10", "129764"]); // accents
});

test("teamsFromTitle: abbreviations and league aliases as uppercase tokens", () => {
  expect(pair("UTA @ DEN", NBA, NBA_ALIASES)).toEqual(["26", "7"]);
  expect(pair("LAL vs LAC", NBA)).toEqual(["12", "13"]);
  // lowercase words are never codes ("den" isn't Denver)
  expect(pair("jazz in the den", NBA)).toBeNull();
});

test("teamsFromTitle: a location two teams share isn't evidence; their nicknames are", () => {
  expect(pair("New York Rangers vs. New York Islanders", NHL)).toEqual(["12", "13"]);
  expect(pair("New York at Columbus", NHL)).toBeNull();
});

test("teamsFromTitle: not exactly two teams → null; loose extras defer to full names", () => {
  expect(pair("NBA - Fubo", NBA)).toBeNull();
  expect(pair("Utah Jazz Basketball", NBA)).toBeNull();
  expect(pair("", NBA)).toBeNull();
  // "Heat" would make three teams; full names decide
  expect(pair("Heat check: Utah Jazz at Denver Nuggets", NBA)).toEqual(["26", "7"]);
  // only one league's teams count
  expect(pair("Utah Jazz at Denver Nuggets", NHL)).toBeNull();
});

const game = (id: string, home: string, away: string, state: Game["state"], date: string): Game => ({
  id,
  date,
  name: `${away} at ${home}`,
  state,
  detail: "",
  period: 0,
  clock: "",
  seasonType: "regular",
  home: { id: home, name: home, abbreviation: home, score: "" },
  away: { id: away, name: away, abbreviation: away, score: "" },
  broadcasts: [],
});

test("gameBetween: either home/away order; live wins; else closest to now; null if they don't meet", () => {
  const now = Date.parse("2026-10-10T02:00Z");
  const games = [
    game("a", "7", "26", "post", "2026-10-04T23:00Z"),
    game("b", "26", "7", "pre", "2026-10-10T03:00Z"),
    game("c", "17", "18", "in", "2026-10-10T01:00Z"),
  ];
  expect(gameBetween(games, ["26", "7"], now)?.id).toBe("b");
  expect(gameBetween(games, ["7", "26"], Date.parse("2026-10-05T00:00Z"))?.id).toBe("a");
  expect(gameBetween([...games, game("d", "7", "26", "in", "2026-10-09T01:00Z")], ["26", "7"], now)?.id).toBe("d");
  expect(gameBetween(games, ["26", "18"], now)).toBeNull();
});
