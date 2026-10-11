// The shared squad engine: every league declares a PlayerStatProfile (which
// player stats matter, how to read them, which positions group together), and
// this module turns ESPN's roster payloads into one Player shape with an
// optional season stat line. The `roster` / `teams` commands build on it.
// Pure parsing is separate from fetching, so it is unit-tested against
// recorded payloads without network; loadSquad takes its fetchers as a
// parameter for the same reason (as loadLeagueStats does).
//
// ESPN shapes (observed 2026-10-11):
//   roster, NBA/soccer  `athletes: [player…]`, flat
//   roster, NHL         `athletes: [{position: "Centers", items: [player…]}…]`
//   soccer players carry `statistics.splits.categories[].stats[]` (no extra call)
//   NBA/NHL stats       `athletes/statistics` → `results[]` categories, each
//                       with `leaders[]` = every rostered player + their stats
// No minutes or clean sheets exist for soccer players; NBA/NHL rosters carry no
// `citizenship`, so nationality falls back to the birth country.

import {
  getStandings,
  getTeamAthleteStatisticsRaw,
  getTeamRosterRaw,
  LEAGUES,
  type EspnTeam,
  type League,
  type StandingsQuery,
} from "./espn.ts";
import { loadStandingsView } from "./standings.ts";
import { seasonOf, type LeagueStats } from "./stats.ts";
import type { LeagueConfig } from "./commands/league.ts";

// ── Profile ──────────────────────────────────────────────────────────────────

/** How a player stat prints: "int" 12 → "12", "avg" 1.84 → "1.8", "avg2" →
 *  "1.84", "pct" 47.7 → "47.7%", "ratio3" 0.907 → ".907", "signed" -2 → "-2" /
 *  3 → "+3", "clock" 1120 (seconds) → "18:40". */
export type PlayerStatFormat = "int" | "avg" | "avg2" | "pct" | "ratio3" | "signed" | "clock";

/** How a stat is computed from ESPN's fields rather than read as-is. */
export type PlayerStatDerive =
  /** `a` − `b` (soccer starts = appearances − sub appearances). */
  | { kind: "diff"; a: string; b: string }
  /** `num` ÷ `den` × scale (a percentage from two counts); undefined when den is 0. */
  | { kind: "ratio"; num: string; den: string; scale?: number };

export interface PlayerStatDef {
  /** Unique within a variant; what `--by` accepts. Without `field`/`derive` it
   *  is also the ESPN stat name read as-is. */
  key: string;
  label: string;
  /** Column header, e.g. "SOT". */
  short: string;
  /** Which end of a ranking is best (cards, goals against: false). */
  higherIsBetter: boolean;
  format: PlayerStatFormat;
  /** ESPN stat name to read when it differs from `key`. */
  field?: string;
  derive?: PlayerStatDerive;
}

/** A position group a roster is split into, in display order. */
export interface PositionGroup {
  /** Group code shown and accepted by `--pos`: "GK", "DEF", "C", "LW"… */
  key: string;
  /** Plural heading: "Goalkeepers". */
  label: string;
  /** ESPN position abbreviations that belong to it ("G", "D", "LW"…). */
  abbreviations: string[];
}

/** The stats a variant (e.g. goalies) shows instead of the default set. */
export interface GoalieVariant {
  /** The position group it applies to (a `PositionGroup.key`). */
  group: string;
  stats: PlayerStatDef[];
  /** NBA/NHL: the `athletes/statistics` result category holding these players. */
  category?: string;
}

/** What a league's player stats are, where they come from, and how a squad is
 *  grouped. Every LeagueConfig must have one (a registry test enforces it). */
export interface PlayerStatProfile {
  /** "roster": each athlete in the roster payload carries `statistics` (soccer).
   *  "athlete-statistics": a separate per-team call, joined by athlete id
   *  (NBA, NHL). */
  source: "roster" | "athlete-statistics";
  positionGroups: PositionGroup[];
  /** The default stat line (outfield players, skaters, every NBA player). */
  stats: PlayerStatDef[];
  /** `athletes/statistics` result category of the default stat line (NHL: "team"). */
  category?: string;
  /** A separate stat line for goalkeepers / goalies, where the sport has one. */
  goalie?: GoalieVariant;
}

/** What the squad engine needs of a league: a LeagueConfig, or FIFA's stand-in. */
export type SquadLeague = Pick<LeagueConfig, "sport" | "label" | "league" | "playerStatProfile">;

/** The stat definitions that apply to `player` (the goalie variant for goalies). */
export function statDefsFor(profile: PlayerStatProfile, player: Pick<Player, "positionGroup">): PlayerStatDef[] {
  return profile.goalie && player.positionGroup === profile.goalie.group ? profile.goalie.stats : profile.stats;
}

/** Display a player stat value; "–" when absent (never 0). */
export function formatPlayerStat(def: Pick<PlayerStatDef, "format">, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "–";
  switch (def.format) {
    case "int":
      return String(Math.round(value));
    case "avg":
      return value.toFixed(1);
    case "avg2":
      return value.toFixed(2);
    case "pct":
      return `${value.toFixed(1)}%`;
    case "ratio3":
      return value.toFixed(3).replace(/^0(?=\.)/, "");
    case "signed":
      return value > 0 ? `+${Math.round(value)}` : String(Math.round(value));
    case "clock": {
      const s = Math.round(value);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }
}

// ── Player shape ─────────────────────────────────────────────────────────────

export interface Player {
  /** ESPN athlete id. */
  id: string;
  /** As ESPN prints it (a string; null for players without a number). */
  jersey: string | null;
  name: string;
  /** "L. Markkanen". */
  shortName: string;
  /** ESPN position abbreviation: "G", "D", "M", "F" (soccer); "C", "F", "G"
   *  (NBA); "C", "LW", "RW", "D", "G" (NHL). */
  position: string;
  /** "Goalkeeper", "Left Wing"… */
  positionName: string;
  /** PositionGroup.key from the profile: "GK", "DEF", "MID", "FWD" (soccer); "C",
   *  "F", "G" (NBA); "C", "LW", "RW", "D", "G" (NHL). The ESPN abbreviation when
   *  the profile doesn't know it. */
  positionGroup: string;
  age: number | null;
  /** Citizenship (soccer); the birth country for NBA/NHL, where ESPN has no citizenship. */
  nationality: string | null;
  /** ESPN roster status, e.g. "Active". */
  status: string;
  /** The first listed injury's status ("Out", "Day-To-Day", "Injured Reserve",
   *  "Suspension"); null when healthy. ESPN gives no body part. */
  injury: string | null;
  /** ISO timestamp of that injury report. */
  injuryDate: string | null;
  /** Season stat line by profile key. Absent when stats weren't loaded; a key
   *  is absent (never 0) when ESPN has no figure for that player. */
  stats?: Record<string, number | undefined>;
}

const str = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** Normalize one ESPN athlete (the same shape in flat and grouped rosters). */
export function parsePlayer(raw: any, profile: PlayerStatProfile): Player {
  const abbr = String(raw?.position?.abbreviation ?? "");
  const group = profile.positionGroups.find((g) => g.abbreviations.includes(abbr))?.key ?? abbr;
  const injury = Array.isArray(raw?.injuries) ? raw.injuries[0] : undefined;
  const age = Number(raw?.age);
  return {
    id: String(raw?.id ?? ""),
    jersey: str(raw?.jersey),
    name: String(raw?.displayName ?? raw?.fullName ?? "?"),
    shortName: String(raw?.shortName ?? raw?.displayName ?? "?"),
    position: abbr,
    positionName: String(raw?.position?.displayName ?? raw?.position?.name ?? abbr),
    positionGroup: group,
    age: Number.isFinite(age) && raw?.age != null ? age : null,
    nationality: str(raw?.citizenship) ?? str(raw?.birthPlace?.country),
    status: String(raw?.status?.name ?? raw?.status?.abbreviation ?? ""),
    injury: str(injury?.status),
    injuryDate: str(injury?.date),
  };
}

/** The athletes of a roster payload: flat (`athletes: [player]`) or grouped
 *  (NHL `athletes: [{position, items: [player]}]`). */
export function rosterAthletes(raw: any): any[] {
  const list = Array.isArray(raw?.athletes) ? raw.athletes : [];
  return list.flatMap((a: any) => (Array.isArray(a?.items) ? a.items : [a]));
}

const jerseyNum = (p: Player) => (p.jersey !== null && /^\d+$/.test(p.jersey) ? Number(p.jersey) : Infinity);

/** Squad order: profile position-group order, then jersey number, then name. */
export function sortPlayers(players: Player[], profile: PlayerStatProfile): Player[] {
  const order = (p: Player) => {
    const i = profile.positionGroups.findIndex((g) => g.key === p.positionGroup);
    return i === -1 ? profile.positionGroups.length : i;
  };
  return [...players].sort((a, b) => order(a) - order(b) || jerseyNum(a) - jerseyNum(b) || a.name.localeCompare(b.name));
}

/** Parse a roster payload into players in squad order (no stats). */
export function parseRoster(raw: any, profile: PlayerStatProfile): Player[] {
  return sortPlayers(rosterAthletes(raw).map((a) => parsePlayer(a, profile)), profile);
}

// ── Player stats (pure) ──────────────────────────────────────────────────────

/** ESPN stat name → number, for one player's `categories[].stats[]`. A stat
 *  without a numeric `value` falls back to a numeric `displayValue`; anything
 *  else (clock strings, blanks) is dropped. */
function flattenCategories(categories: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of Array.isArray(categories) ? categories : []) {
    for (const s of Array.isArray(cat?.stats) ? cat.stats : []) {
      if (typeof s?.name !== "string") continue;
      const v = typeof s.value === "number" ? s.value : str(s.displayValue) === null ? NaN : Number(s.displayValue);
      if (Number.isFinite(v)) out[s.name] = v;
    }
  }
  return out;
}

/** Soccer: each roster athlete's `statistics.splits.categories`, flattened, by
 *  athlete id. Athletes without a `statistics` object are left out. */
export function statsFromRoster(raw: any): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const a of rosterAthletes(raw)) {
    const cats = a?.statistics?.splits?.categories;
    if (a?.id != null && Array.isArray(cats)) out.set(String(a.id), flattenCategories(cats));
  }
  return out;
}

/** One athlete's stats by `athletes/statistics` result category. */
export type AthleteStatsByCategory = Map<string, Record<string, Record<string, number>>>;

/** NBA/NHL: the `results[].leaders[]` of an `athletes/statistics` payload, by
 *  athlete id then result category (NBA "game"; NHL "team", "goalkeeping"). */
export function statsFromAthleteStatistics(raw: any): AthleteStatsByCategory {
  const out: AthleteStatsByCategory = new Map();
  for (const result of Array.isArray(raw?.results) ? raw.results : []) {
    for (const leader of Array.isArray(result?.leaders) ? result.leaders : []) {
      const id = leader?.athlete?.id;
      if (id == null) continue;
      const byCat = out.get(String(id)) ?? {};
      byCat[String(result.name)] = flattenCategories(leader.statistics);
      out.set(String(id), byCat);
    }
  }
  return out;
}

/** The season an `athletes/statistics` payload actually covers: its
 *  `requestedSeason` (ESPN year, name), else `season`. */
export function athleteStatsSeason(raw: any): { year: number | null; name: string } {
  const s = raw?.requestedSeason ?? raw?.season;
  const year = Number(s?.year);
  return { year: Number.isInteger(year) && year > 0 ? year : null, name: String(s?.displayName ?? "") };
}

/** One stat's value from a player's ESPN fields; undefined if inputs are missing. */
export function playerStatValue(def: PlayerStatDef, fields: Record<string, number>): number | undefined {
  const d = def.derive;
  if (!d) return fields[def.field ?? def.key];
  if (d.kind === "diff") {
    const a = fields[d.a];
    const b = fields[d.b];
    return a === undefined || b === undefined ? undefined : a - b;
  }
  const num = fields[d.num];
  const den = fields[d.den];
  return num === undefined || den === undefined || den === 0 ? undefined : (num / den) * (d.scale ?? 1);
}

/** The profile stat line for a player from its ESPN fields; keys with no value
 *  are omitted. */
export function playerStatLine(defs: PlayerStatDef[], fields: Record<string, number>): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const def of defs) {
    const v = playerStatValue(def, fields);
    if (v !== undefined && Number.isFinite(v)) out[def.key] = v;
  }
  return out;
}

/** Players sorted by one stat, best first (respecting higherIsBetter); players
 *  with no value go last, ties and the unranked keep squad order. */
export function sortPlayersBy(players: Player[], def: PlayerStatDef): Player[] {
  const val = (p: Player) => p.stats?.[def.key];
  return players
    .map((p, i) => ({ p, i, v: val(p) }))
    .sort((a, b) => {
      if (a.v === undefined || b.v === undefined) return a.v === b.v ? a.i - b.i : a.v === undefined ? 1 : -1;
      return (def.higherIsBetter ? b.v - a.v : a.v - b.v) || a.i - b.i;
    })
    .map((x) => x.p);
}

/** Attach stat lines to players. `source` is soccer's flat per-athlete fields,
 *  or NBA/NHL's by-category fields; a player with none keeps `stats` = {}. */
export function attachStats(
  players: Player[],
  profile: PlayerStatProfile,
  source: Map<string, Record<string, number>> | AthleteStatsByCategory,
): Player[] {
  return players.map((p) => {
    const found = source.get(p.id);
    const isGoalie = profile.goalie !== undefined && p.positionGroup === profile.goalie.group;
    const category = isGoalie ? profile.goalie!.category : profile.category;
    let fields: Record<string, number> | undefined;
    if (profile.source === "roster") fields = found as Record<string, number> | undefined;
    else {
      const byCat = found as Record<string, Record<string, number>> | undefined;
      fields = byCat && (category !== undefined ? byCat[category] : Object.values(byCat)[0]);
    }
    return { ...p, stats: fields ? playerStatLine(statDefsFor(profile, p), fields) : {} };
  });
}

// ── Fetching ─────────────────────────────────────────────────────────────────

export interface SquadTeam {
  id: string;
  abbreviation: string;
  name: string;
}

export interface SquadSeason {
  /** "current": this season has games (or the league has no seasons: FIFA);
   *  "last-season": the regular season hasn't started so last season's figures
   *  are used; "not-started": ESPN has neither, so no stats. */
  kind: LeagueStats["kind"];
  /** ESPN season year the figures cover; null for "not-started". */
  season: number | null;
  /** Display name of the season shown, e.g. "2025-26". */
  seasonName: string;
  /** The upcoming season's name when `kind` is "last-season" or "not-started". */
  upcoming: string;
}

export interface Squad {
  sport: string;
  label: string;
  team: SquadTeam;
  profile: PlayerStatProfile;
  /** Squad order: position group, jersey, name. */
  players: Player[];
  /** Which season the stats cover; null when stats weren't requested. */
  season: SquadSeason | null;
}

/** The network calls loadSquad makes — replaceable in tests. */
export interface SquadFetchers {
  standings: (league: League, q: StandingsQuery) => ReturnType<typeof getStandings>;
  roster: (league: League, teamId: string, ttlMs: number, season?: number) => Promise<any>;
  athleteStatistics: (league: League, teamId: string, season: number, ttlMs: number) => Promise<any>;
}

export const ESPN_SQUAD_FETCHERS: SquadFetchers = {
  standings: (league, q) => getStandings(league, q),
  roster: (league, id, ttl, season) => getTeamRosterRaw(league, id, ttl, season),
  athleteStatistics: (league, id, season, ttl) => getTeamAthleteStatisticsRaw(league, id, season, ttl),
};

const MIN_MS = 60_000;
/** The current roster (injuries move daily) and in-season stats refresh often. */
export const SQUAD_TTL_MS = 30 * MIN_MS;
/** A finished season's figures never change. */
export const LAST_SEASON_TTL_MS = 24 * 60 * MIN_MS;

/**
 * Load a team's squad. The roster is always today's; with `opts.stats` each
 * player also gets a season stat line, for the season `stats` and `standings`
 * would show: this season once games are played, else last season's (flagged
 * in `season.kind`), else none. Soccer reads the stats off the roster payload
 * (a second `?season=` roster call only when showing last season); NBA/NHL
 * make the one `athletes/statistics` call and join by athlete id. FIFA has no
 * seasons, so its stats are the roster payload's.
 */
export async function loadSquad(
  cfg: SquadLeague,
  team: Pick<EspnTeam, "id" | "abbreviation" | "name">,
  opts: { stats?: boolean } = {},
  fetchers: SquadFetchers = ESPN_SQUAD_FETCHERS,
): Promise<Squad> {
  const profile = cfg.playerStatProfile;
  const base = { sport: cfg.sport, label: cfg.label, team: { id: team.id, abbreviation: team.abbreviation, name: team.name }, profile };
  const raw = await fetchers.roster(cfg.league, team.id, SQUAD_TTL_MS);
  const players = parseRoster(raw, profile);
  if (!opts.stats) return { ...base, players, season: null };

  // FIFA has no regular season or standings tables: the roster's stats are the tournament's.
  if (cfg.league === LEAGUES.fifa) {
    const year = Number(raw?.season?.year);
    const season: SquadSeason = {
      kind: "current",
      season: Number.isInteger(year) ? year : null,
      seasonName: String(raw?.season?.displayName ?? ""),
      upcoming: "",
    };
    return { ...base, players: attachStats(players, profile, statsFromRoster(raw)), season };
  }

  const season = seasonOf(await loadStandingsView((q) => fetchers.standings(cfg.league, q), "conference"));
  if (season.season === null) return { ...base, players, season };
  const ttl = season.kind === "last-season" ? LAST_SEASON_TTL_MS : SQUAD_TTL_MS;
  if (profile.source === "roster") {
    const statsRaw = season.kind === "current" ? raw : await fetchers.roster(cfg.league, team.id, ttl, season.season);
    return { ...base, players: attachStats(players, profile, statsFromRoster(statsRaw)), season };
  }
  const statsRaw = await fetchers.athleteStatistics(cfg.league, team.id, season.season, ttl);
  return { ...base, players: attachStats(players, profile, statsFromAthleteStatistics(statsRaw)), season };
}
