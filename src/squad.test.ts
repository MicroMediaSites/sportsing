import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure parsing and the injected-fetcher loader only — no network; the cache and
// ~/.config/sportsing are never touched. Fixtures are recorded ESPN payloads
// (2026-10-11), trimmed.
import { LEAGUES, parseTeams } from "./espn.ts";
import { NBA } from "./sports/nba.ts";
import { NHL } from "./sports/nhl.ts";
import { EPL } from "./sports/soccer.ts";
import { FIFA_SQUAD } from "./sports/fifa.ts";
import {
  attachStats,
  formatPlayerStat,
  loadSquad,
  parsePlayer,
  parseRoster,
  playerStatLine,
  rosterAthletes,
  sortPlayersBy,
  statDefsFor,
  statsFromAthleteStatistics,
  statsFromRoster,
  athleteStatsSeason,
  type Player,
  type SquadFetchers,
} from "./squad.ts";

const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8"));
const byName = (players: Player[], name: string): Player => players.find((p) => p.name === name)!;

// ── Roster normalization ─────────────────────────────────────────────────────

test("NBA flat roster: one Player shape, squad order, birth country as nationality", () => {
  const players = parseRoster(fixture("nba-roster.json"), NBA.playerStatProfile);
  expect(players).toHaveLength(6);
  // Centers, then forwards, then guards; jersey within a group.
  expect(players.map((p) => p.positionGroup)).toEqual([...players.map((p) => p.positionGroup)].sort((a, b) => "CFG".indexOf(a) - "CFG".indexOf(b)));
  const m = byName(players, "Lauri Markkanen");
  expect(m).toMatchObject({ id: "4066336", position: "F", positionGroup: "F", shortName: "L. Markkanen", status: "Active" });
  expect(m.age).toBeGreaterThan(20);
  expect(m.jersey).toMatch(/^\d+$/);
  expect(m.nationality).toBeTruthy(); // from birthPlace.country (NBA has no citizenship)
  expect(m.stats).toBeUndefined();
});

test("NBA roster: injury status and date are carried, healthy players have none", () => {
  const players = parseRoster(fixture("nba-roster.json"), NBA.playerStatProfile);
  const hurt = players.filter((p) => p.injury !== null);
  expect(hurt.length).toBeGreaterThan(0);
  expect(hurt[0]!.injuryDate).toMatch(/^2026-/);
  expect(["Out", "Day-To-Day", "Injured Reserve", "Suspension"]).toContain(hurt[0]!.injury!);
  expect(players.some((p) => p.injury === null)).toBe(true);
});

test("NHL grouped roster is flattened and grouped C/LW/RW/D/G in order", () => {
  const raw = fixture("nhl-roster.json");
  expect(raw.athletes[0].items).toBeDefined(); // really the grouped shape
  expect(rosterAthletes(raw)).toHaveLength(7);
  const players = parseRoster(raw, NHL.playerStatProfile);
  expect([...new Set(players.map((p) => p.positionGroup))]).toEqual(["C", "LW", "RW", "D", "G"]);
  const cooley = byName(players, "Logan Cooley");
  expect(cooley).toMatchObject({ position: "C", positionGroup: "C", nationality: "USA" });
  expect(byName(players, "Nick DeSimone").injury).toBe("Out");
});

test("soccer roster: citizenship is the nationality, G/D/M/F map to GK/DEF/MID/FWD", () => {
  const players = parseRoster(fixture("soccer-roster-epl.json"), EPL.playerStatProfile);
  expect(players.map((p) => p.positionGroup)).toEqual(["GK", "GK", "DEF", "DEF", "FWD"]);
  expect(byName(players, "David Raya")).toMatchObject({ jersey: "1", nationality: "Spain", position: "G", positionName: "Goalkeeper" });
});

test("FIFA roster (same shape as club soccer)", () => {
  const players = parseRoster(fixture("soccer-roster-fifa.json"), FIFA_SQUAD.playerStatProfile);
  expect(players).toHaveLength(4);
  expect(players[0]!.positionGroup).toBe("GK");
  expect(players.every((p) => p.nationality !== null)).toBe(true);
});

test("an unknown position falls back to its abbreviation and sorts last", () => {
  const prof = NBA.playerStatProfile;
  const odd = parsePlayer({ id: "1", displayName: "X", position: { abbreviation: "PG" } }, prof);
  expect(odd.positionGroup).toBe("PG");
  const sorted = parseRoster({ athletes: [{ id: "1", displayName: "X", position: { abbreviation: "PG" } }, { id: "2", displayName: "Y", position: { abbreviation: "C" } }] }, prof);
  expect(sorted.map((p) => p.id)).toEqual(["2", "1"]);
});

test("a sparse athlete gets nulls, not crashes", () => {
  const p = parsePlayer({ id: 7, displayName: "Nobody", position: { abbreviation: "G" } }, EPL.playerStatProfile);
  expect(p).toMatchObject({ id: "7", jersey: null, age: null, nationality: null, injury: null, injuryDate: null });
});

test("parseTeams reads every league's /teams shape (shared team list)", () => {
  const teams = parseTeams(fixture("soccer-teams-epl.json"));
  expect(teams.length).toBeGreaterThan(5);
  expect(teams.every((t) => t.id && t.abbreviation && t.name)).toBe(true);
});

// ── Stats: soccer from the roster payload ────────────────────────────────────

test("soccer: stats come off the roster payload; derived starts", () => {
  const raw = fixture("soccer-roster-epl.json");
  const prof = EPL.playerStatProfile;
  const players = attachStats(parseRoster(raw, prof), prof, statsFromRoster(raw));
  const saka = byName(players, "Bukayo Saka");
  expect(saka.stats).toMatchObject({ appearances: 6, starts: 6, totalGoals: 3, totalShots: 17, shotsOnTarget: 10, yellowCards: 0 });
  // Goalkeepers use the goalie variant: saves / goals conceded / save %, no goals or shots.
  const raya = byName(players, "David Raya");
  expect(Object.keys(raya.stats!)).toContain("saves");
  expect(Object.keys(raya.stats!)).not.toContain("totalGoals");
  expect(statDefsFor(prof, raya).map((d) => d.short)).toEqual(["APP", "ST", "SV", "GC", "YC", "RC"]);
  const konsa = byName(players, "Ezri Konsa");
  expect(konsa.stats!.starts).toBe(konsa.stats!.appearances! - 1); // one sub-in
});

test("soccer: a player ESPN has no statistics for has an empty line, never zeros", () => {
  const raw = fixture("soccer-roster-epl.json");
  const prof = EPL.playerStatProfile;
  const saliba = byName(attachStats(parseRoster(raw, prof), prof, statsFromRoster(raw)), "William Saliba");
  expect(saliba.stats).toEqual({});
  expect(formatPlayerStat(prof.stats[2]!, saliba.stats!.totalGoals)).toBe("–");
});

test("soccer: a keeper's real zeros are kept (a backup with no minutes shows 0 saves)", () => {
  const raw = fixture("soccer-roster-epl.json");
  const prof = EPL.playerStatProfile;
  const kepa = byName(attachStats(parseRoster(raw, prof), prof, statsFromRoster(raw)), "Kepa Arrizabalaga");
  expect(kepa.stats).toMatchObject({ appearances: 0, saves: 0, goalsConceded: 0 });
});

test("derive: ratio is undefined for a zero or missing denominator, diff needs both inputs", () => {
  const def = { key: "k", label: "K", short: "K", higherIsBetter: true, format: "pct" as const };
  const ratio = { ...def, derive: { kind: "ratio" as const, num: "a", den: "b", scale: 100 } };
  expect(playerStatLine([ratio], { a: 3, b: 4 })).toEqual({ k: 75 });
  expect(playerStatLine([ratio], { a: 3, b: 0 })).toEqual({});
  expect(playerStatLine([ratio], { a: 3 })).toEqual({});
  const diff = { ...def, derive: { kind: "diff" as const, a: "a", b: "b" } };
  expect(playerStatLine([diff], { a: 3 })).toEqual({});
  expect(playerStatLine([diff], { a: 3, b: 1 })).toEqual({ k: 2 });
});

// ── Stats: NBA / NHL athletes/statistics join ────────────────────────────────

test("NBA: athletes/statistics joins to the roster by athlete id; missing players have no stats", () => {
  const prof = NBA.playerStatProfile;
  const players = attachStats(parseRoster(fixture("nba-roster.json"), prof), prof, statsFromAthleteStatistics(fixture("nba-athlete-statistics.json")));
  const m = byName(players, "Lauri Markkanen");
  expect(m.stats!.avgPoints).toBeCloseTo(26.74, 1);
  expect(m.stats!.gamesPlayed).toBe(42);
  expect(m.stats!.threePointPct).toBeCloseTo(35.49, 1);
  expect(Object.keys(m.stats!).sort()).toEqual(prof.stats.map((d) => d.key).sort());
  const none = players.filter((p) => Object.keys(p.stats!).length === 0);
  expect(none.map((p) => p.name).sort()).toEqual(["Darryn Peterson", "Josh Okogie"]);
});

test("NHL: skaters read the team category, goalies the goalkeeping one", () => {
  const prof = NHL.playerStatProfile;
  const raw = fixture("nhl-athlete-statistics.json");
  const players = attachStats(parseRoster(fixture("nhl-roster.json"), prof), prof, statsFromAthleteStatistics(raw));
  const cooley = byName(players, "Logan Cooley");
  expect(Object.keys(cooley.stats!).sort()).toEqual(["assists", "games", "goals", "penaltyMinutes", "plusMinus", "points", "timeOnIcePerGame"]);
  expect(cooley.stats!.timeOnIcePerGame).toBeGreaterThan(600); // seconds per game
  const vejmelka = byName(players, "Karel Vejmelka");
  expect(Object.keys(vejmelka.stats!).sort()).toEqual(["avgGoalsAgainst", "games", "losses", "savePct", "wins"]);
  expect(formatPlayerStat(prof.goalie!.stats[4]!, vejmelka.stats!.savePct)).toMatch(/^\.\d{3}$/);
  // On the roster but not in any category (no games): no stats, not zeros.
  expect(byName(players, "Liam O'Brien").stats).toEqual({});
});

test("a stat ESPN lists without a numeric value falls back to its displayValue", () => {
  const m = statsFromAthleteStatistics({
    results: [{ name: "team", leaders: [{ athlete: { id: "1" }, statistics: [{ name: "x", stats: [{ name: "shootoutGoals", displayValue: "0" }, { name: "timeOnIce", displayValue: "112:00" }, { name: "blank", displayValue: "" }] }] }] }],
  });
  expect(m.get("1")!.team).toEqual({ shootoutGoals: 0 });
});

test("athleteStatsSeason reports the season the numbers cover (NBA preseason → last season)", () => {
  expect(athleteStatsSeason(fixture("nba-athlete-statistics.json"))).toEqual({ year: 2026, name: "2025-26" });
  expect(athleteStatsSeason(fixture("nhl-athlete-statistics.json"))).toEqual({ year: 2027, name: "2026-27" });
  expect(athleteStatsSeason({})).toEqual({ year: null, name: "" });
});

// ── Formatting and sorting ───────────────────────────────────────────────────

test("formatPlayerStat: every format, and – for missing", () => {
  const f = (format: any, v: number | undefined) => formatPlayerStat({ format }, v);
  expect(f("int", 12)).toBe("12");
  expect(f("avg", 26.738)).toBe("26.7");
  expect(f("avg2", 2.127)).toBe("2.13");
  expect(f("pct", 35.494)).toBe("35.5%");
  expect(f("ratio3", 0.907)).toBe(".907");
  expect(f("ratio3", 1)).toBe("1.000");
  expect(f("signed", 3)).toBe("+3");
  expect(f("signed", -2)).toBe("-2");
  expect(f("signed", 0)).toBe("0");
  expect(f("clock", 1120)).toBe("18:40");
  expect(f("int", undefined)).toBe("–");
  expect(f("avg", NaN)).toBe("–");
});

test("playerStatLine omits keys it cannot compute", () => {
  const defs = EPL.playerStatProfile.stats;
  expect(playerStatLine(defs, { appearances: 3 })).toEqual({ appearances: 3 });
});

test("sortPlayersBy: best first by higherIsBetter, players with no value last, ties keep squad order", () => {
  const prof = NBA.playerStatProfile;
  const players = attachStats(parseRoster(fixture("nba-roster.json"), prof), prof, statsFromAthleteStatistics(fixture("nba-athlete-statistics.json")));
  const pts = prof.stats.find((d) => d.key === "avgPoints")!;
  const sorted = sortPlayersBy(players, pts);
  expect(sorted[0]!.name).toBe("Lauri Markkanen");
  expect(sorted.slice(-2).map((p) => p.stats!.avgPoints)).toEqual([undefined, undefined]);
  const tov = { ...pts, higherIsBetter: false };
  expect(sortPlayersBy(players, tov)[0]!.stats!.avgPoints).toBe(Math.min(...players.map((p) => p.stats!.avgPoints).filter((v): v is number => v !== undefined)));
});

// ── loadSquad: season choice and fetch plan ──────────────────────────────────

const standings = (kind: "current" | "last" | "none") => async (_league: unknown, q: any) => {
  const played = kind === "current" || (kind === "last" && q.season === 2026);
  return {
    season: kind === "none" ? null : q.season ?? 2027,
    seasonName: kind === "none" ? "" : `${(q.season ?? 2027) - 1}-${String(q.season ?? 2027).slice(2)}`,
    groups: [{ name: "x", abbreviation: "x", entries: [{ teamId: "1", team: "T", abbreviation: "T", stats: { gamesPlayed: played ? "5" : "0", wins: played ? "5" : "0" } }] }],
  } as any;
};

function fetchers(kind: "current" | "last" | "none", log: string[]): SquadFetchers {
  return {
    standings: standings(kind),
    roster: async (league, id, _ttl, season) => {
      log.push(`roster ${id}${season === undefined ? "" : ` ${season}`}`);
      if (league === LEAGUES.nba) return fixture("nba-roster.json");
      if (league === LEAGUES.nhl) return fixture("nhl-roster.json");
      if (league === LEAGUES.fifa) return fixture("soccer-roster-fifa.json");
      return fixture(season === undefined ? "soccer-roster-epl.json" : "soccer-roster-epl-last-season.json");
    },
    athleteStatistics: async (league, id, season) => {
      log.push(`athlete-stats ${id} ${season}`);
      return fixture(league === LEAGUES.nba ? "nba-athlete-statistics.json" : "nhl-athlete-statistics.json");
    },
  };
}
const T = { id: "26", abbreviation: "UTAH", name: "Utah Jazz" };

test("loadSquad without stats makes only the roster call", async () => {
  const log: string[] = [];
  const squad = await loadSquad(NBA, T, {}, fetchers("current", log));
  expect(log).toEqual(["roster 26"]);
  expect(squad.season).toBeNull();
  expect(squad.players[0]!.stats).toBeUndefined();
  expect(squad.team).toEqual(T);
});

test("loadSquad NBA in the preseason: last season's stats, flagged", async () => {
  const log: string[] = [];
  const squad = await loadSquad(NBA, T, { stats: true }, fetchers("last", log));
  expect(squad.season).toMatchObject({ kind: "last-season", season: 2026, seasonName: "2025-26" });
  expect(log).toEqual(["roster 26", "athlete-stats 26 2026"]);
  expect(byName(squad.players, "Lauri Markkanen").stats!.gamesPlayed).toBe(42);
});

test("loadSquad NHL in season: current stats", async () => {
  const log: string[] = [];
  const squad = await loadSquad(NHL, { id: "129764", abbreviation: "UTAH", name: "Utah Mammoth" }, { stats: true }, fetchers("current", log));
  expect(squad.season).toMatchObject({ kind: "current", season: 2027 });
  expect(log).toEqual(["roster 129764", "athlete-stats 129764 2027"]);
  expect(byName(squad.players, "Logan Cooley").stats!.games).toBeGreaterThan(0);
});

test("loadSquad soccer in season: no extra call, stats from the roster payload", async () => {
  const log: string[] = [];
  const squad = await loadSquad(EPL, { id: "359", abbreviation: "ARS", name: "Arsenal" }, { stats: true }, fetchers("current", log));
  expect(log).toEqual(["roster 359"]);
  expect(squad.season!.kind).toBe("current");
  expect(byName(squad.players, "Bukayo Saka").stats!.totalGoals).toBe(3);
});

test("loadSquad soccer in the offseason: today's players with last season's stats", async () => {
  const log: string[] = [];
  const squad = await loadSquad(EPL, { id: "359", abbreviation: "ARS", name: "Arsenal" }, { stats: true }, fetchers("last", log));
  expect(squad.season).toMatchObject({ kind: "last-season", season: 2026 });
  expect(log).toEqual(["roster 359", "roster 359 2026"]);
  const saka = byName(squad.players, "Bukayo Saka");
  expect(saka.stats!.appearances).toBeGreaterThan(6); // last season's full-year figure
});

test("loadSquad when ESPN has no season at all: roster only, no stats", async () => {
  const squad = await loadSquad(NBA, T, { stats: true }, fetchers("none", []));
  expect(squad.season!.kind).toBe("not-started");
  expect(squad.players[0]!.stats).toBeUndefined();
});

test("loadSquad FIFA: no standings or season call, stats off the roster payload", async () => {
  const log: string[] = [];
  const f = fetchers("current", log);
  f.standings = async () => {
    throw new Error("FIFA must not ask for standings");
  };
  const squad = await loadSquad(FIFA_SQUAD, { id: "660", abbreviation: "USA", name: "United States" }, { stats: true }, f);
  expect(log).toEqual(["roster 660"]);
  expect(squad.season).toMatchObject({ kind: "current", season: 2026, seasonName: "2026 FIFA World Cup" });
  expect(squad.players.every((p) => p.stats !== undefined)).toBe(true);
});
