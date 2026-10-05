import { test, expect } from "bun:test";
// Pure — standings are hand-built fixtures; no network, no ~/.config/sportsing.
import { PLAYOFF_FORMATS, ordinal, raceLine, renderSeasonSummary, seedStatus, split, summarizeSeason, wildcardStatus, type SeedsFormat, type WildcardFormat } from "./season.ts";
import { STANDINGS_LAYOUTS } from "./standings.ts";
import { LEAGUES, type EspnStandingsEntry, type EspnStandingsGroup } from "./espn.ts";

const SEEDS: SeedsFormat = { kind: "seeds", playoffs: 6, playIn: 10 };
const WILDCARD: WildcardFormat = { kind: "wildcard", perDivision: 3, wildcards: 2 };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const NBA_LAYOUT = STANDINGS_LAYOUTS[LEAGUES.nba]!;
const NHL_LAYOUT = STANDINGS_LAYOUTS[LEAGUES.nhl]!;
const NBA_FORMAT = PLAYOFF_FORMATS[LEAGUES.nba]!;
const NHL_FORMAT = PLAYOFF_FORMATS[LEAGUES.nhl]!;

const entry = (teamId: string, team: string, stats: Record<string, string>): EspnStandingsEntry => ({
  teamId,
  team,
  abbreviation: team.slice(0, 3).toUpperCase(),
  stats,
});
const division = (name: string, conference: string, entries: EspnStandingsEntry[]): EspnStandingsGroup => ({
  name,
  abbreviation: name.slice(0, 3).toUpperCase(),
  parent: { name: conference, abbreviation: conference.split(" ")[0]! },
  entries,
});

// NHL West, end of 2025-26 (ESPN data, trimmed): the Mammoth took the first
// wildcard on the tiebreak-free 92 pts; LA the second at 90.
const nhl = (id: string, team: string, points: number, seed: number, extra: Record<string, string> = {}) =>
  entry(id, team, { points: String(points), playoffSeed: String(seed), ...extra });
const NHL_WEST = [
  division("Central Division", "Western Conference", [
    nhl("17", "Colorado Avalanche", 121, 1),
    nhl("9", "Dallas Stars", 112, 2),
    nhl("30", "Minnesota Wild", 104, 3),
    nhl("129764", "Utah Mammoth", 92, 6, {
      wins: "43",
      losses: "33",
      otLosses: "6",
      streak: "W2",
      "Last Ten Games": "6-3-1, 0 PTS",
      Home: "24-14-3",
      Road: "19-19-3",
    }),
    nhl("19", "St. Louis Blues", 86, 9),
  ]),
  division("Pacific Division", "Western Conference", [
    nhl("37", "Vegas Golden Knights", 95, 4),
    nhl("6", "Edmonton Oilers", 93, 5),
    nhl("25", "Anaheim Ducks", 92, 7),
    nhl("8", "Los Angeles Kings", 90, 8),
    nhl("18", "San Jose Sharks", 86, 11),
    nhl("22", "Vancouver Canucks", 58, 16),
  ]),
];
const NHL_EAST = [division("Atlantic Division", "Eastern Conference", [nhl("2", "Buffalo Sabres", 109, 2)])];

// NBA West, end of 2025-26 (trimmed).
const nba = (id: string, team: string, pct: string, seed: number, extra: Record<string, string> = {}) =>
  entry(id, team, { winPercent: pct, playoffSeed: String(seed), ...extra });
const NBA_WEST = [
  division("Northwest", "Western Conference", [
    nba("25", "Oklahoma City Thunder", ".780", 1),
    nba("7", "Denver Nuggets", ".659", 3),
    nba("22", "Portland Trail Blazers", ".512", 7),
    nba("26", "Utah Jazz", ".268", 15, {
      wins: "22",
      losses: "60",
      streak: "L4",
      "Last Ten Games": "2-8",
      Home: "13-28",
      Road: "9-32",
    }),
  ]),
  division("Pacific", "Western Conference", [nba("21", "Phoenix Suns", ".549", 8), nba("9", "Golden State Warriors", ".451", 10)]),
];

test("split: drops NHL's trailing points, dashes missing values", () => {
  expect(split("6-3-1, 0 PTS")).toBe("6-3-1");
  expect(split("31-9")).toBe("31-9");
  expect(split(undefined)).toBe("-");
  expect(split("")).toBe("-");
});

test("ordinal", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
  ]);
});

test("seedStatus: playoffs through 6, play-in 7–10, out after", () => {
  expect(seedStatus(6, SEEDS)).toEqual({ kind: "playoffs", seed: 6 });
  expect(seedStatus(7, SEEDS)).toEqual({ kind: "play-in", seed: 7 });
  expect(seedStatus(10, SEEDS)).toEqual({ kind: "play-in", seed: 10 });
  expect(seedStatus(11, SEEDS)).toEqual({ kind: "out", seed: 11 });
});

test("wildcardStatus: division top three, then wildcards, else points back of the last wildcard", () => {
  expect(wildcardStatus(NHL_WEST, "points", "9", WILDCARD)).toEqual({ kind: "division", place: 2 });
  // Anaheim (92, 3rd in the Pacific) holds a division spot; Utah (92) is WC1 on seed.
  expect(wildcardStatus(NHL_WEST, "points", "25", WILDCARD)).toEqual({ kind: "division", place: 3 });
  expect(wildcardStatus(NHL_WEST, "points", "129764", WILDCARD)).toEqual({ kind: "wildcard", slot: 1 });
  expect(wildcardStatus(NHL_WEST, "points", "8", WILDCARD)).toEqual({ kind: "wildcard", slot: 2 });
  expect(wildcardStatus(NHL_WEST, "points", "19", WILDCARD)).toEqual({ kind: "chasing", pointsBack: 4 });
  expect(wildcardStatus(NHL_WEST, "points", "22", WILDCARD)).toEqual({ kind: "chasing", pointsBack: 32 });
});

test("summarizeSeason (NHL): record with OTL + points, splits, positions, race — conference only, not the East", () => {
  const s = summarizeSeason([...NHL_EAST, ...NHL_WEST], "129764", NHL_LAYOUT, NHL_FORMAT)!;
  expect(s).toMatchObject({
    team: "Utah Mammoth",
    record: "43-33-6",
    points: "92",
    lastTen: "6-3-1",
    streak: "W2",
    home: "24-14-3",
    away: "19-19-3",
    // Colorado, Dallas, Minnesota, Vegas, Edmonton above; Anaheim level, ranked below on seed.
    conference: { name: "Western Conference", position: 6, of: 11 },
    division: { name: "Central Division", position: 4, of: 5 },
    race: { kind: "wildcard", slot: 1 },
  });
});

test("summarizeSeason (NBA): W-L record, no points, status from ESPN's seed", () => {
  const s = summarizeSeason(NBA_WEST, "26", NBA_LAYOUT, NBA_FORMAT)!;
  expect(s).toMatchObject({
    record: "22-60",
    points: null,
    lastTen: "2-8",
    streak: "L4",
    home: "13-28",
    away: "9-32",
    conference: { name: "Western Conference", position: 6, of: 6 },
    division: { name: "Northwest", position: 4, of: 4 },
    race: { kind: "out", seed: 15 },
  });
  // Portland: 7th seed after the play-in even though Phoenix has the better record.
  expect(summarizeSeason(NBA_WEST, "22", NBA_LAYOUT, NBA_FORMAT)!.race).toEqual({ kind: "play-in", seed: 7 });
});

test("summarizeSeason: falls back to conference position when ESPN has no seed", () => {
  const groups = [division("Northwest", "Western Conference", [entry("1", "A", { winPercent: ".700" }), entry("2", "B", { winPercent: ".600" })])];
  expect(summarizeSeason(groups, "2", NBA_LAYOUT, NBA_FORMAT)!.race).toEqual({ kind: "playoffs", seed: 2 });
});

test("summarizeSeason: null for a team not in the standings", () => {
  expect(summarizeSeason(NBA_WEST, "999", NBA_LAYOUT, NBA_FORMAT)).toBeNull();
});

test("raceLine: every status reads", () => {
  expect(strip(raceLine({ kind: "playoffs", seed: 3 }))).toBe("Playoff spot — 3rd seed");
  expect(strip(raceLine({ kind: "play-in", seed: 9 }))).toBe("Play-in — 9th seed");
  expect(strip(raceLine({ kind: "out", seed: 15 }))).toBe("Out of the playoff picture — 15th seed");
  expect(strip(raceLine({ kind: "division", place: 1 }))).toBe("Playoff spot — 1st in division");
  expect(strip(raceLine({ kind: "wildcard", slot: 2 }))).toBe("Playoff spot — wildcard 2");
  expect(strip(raceLine({ kind: "chasing", pointsBack: 1 }))).toBe("Out — 1 pt back of the last wildcard");
  expect(strip(raceLine({ kind: "chasing", pointsBack: 0 }))).toContain("losing the tiebreak");
});

test("renderSeasonSummary: every AC field on its own line", () => {
  const out = strip(renderSeasonSummary(summarizeSeason(NHL_WEST, "129764", NHL_LAYOUT, NHL_FORMAT)!));
  expect(out).toContain("Utah Mammoth");
  expect(out).toContain("Record      43-33-6  92 pts");
  expect(out).toContain("Last 10     6-3-1   Streak W2");
  expect(out).toContain("Home / Away 24-14-3 / 19-19-3");
  expect(out).toContain("6th of 11 in the Western Conference");
  expect(out).toContain("4th of 5 in the Central Division");
  expect(out).toContain("Playoff spot — wildcard 1");
});
