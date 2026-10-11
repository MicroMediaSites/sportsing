// The shared stats engine: every league declares a StatProfile (which stats
// matter, how to read them, which way is better), and this module turns ESPN's
// per-team season stats (NBA, NHL) or per-match boxscores (club soccer) into
// one shape — per-team averages, league ranks and recent form — that the
// `stats` views build on. Pure aggregation is separate from fetching, so it is
// unit-tested without network; loadLeagueStats takes its fetchers as a
// parameter for the same reason.
//
// ESPN has no xG, and no hits / blocked shots / penalty-kill figures for the
// NHL, so those aren't offered.

import {
  getClubTeamResults,
  getMatchBoxscore,
  getStandings,
  getTeamGames,
  getTeams,
  getTeamStatistics,
  isClubSoccer,
  NotFinishedError,
  SEASON_TYPES,
  type EspnTeam,
  type EspnTeamSeasonStats,
  type League,
  type MatchBoxscore,
  type StandingsQuery,
} from "./espn.ts";
import type { Game } from "./game.ts";
import { loadStandingsView, type StandingsView } from "./standings.ts";
import type { LeagueConfig } from "./commands/league.ts";

// ── Profile ──────────────────────────────────────────────────────────────────

/** How a value prints: "pct" 54.3 → "54.3%", "avg" 1.8 → "1.8", "avg2" 1.84 →
 *  "1.84", "int" 12 → "12". */
export type StatFormat = "pct" | "avg" | "avg2" | "int";

/** How a stat is computed from the source's fields. */
export type StatDerive =
  /** Total ÷ games played (a per-game rate from a season total). */
  | { kind: "perGame"; of: string }
  /** Σ num ÷ Σ den × scale (a percentage from two counts). */
  | { kind: "ratio"; num: string; den: string; scale?: number };

export interface StatDef {
  /** Unique within a profile. Without `derive` it is also the ESPN field read
   *  as-is: the season value for team-stats (e.g. NBA `avgPoints`), the
   *  per-match mean for boxscores (e.g. soccer `totalShots`). */
  key: string;
  label: string;
  /** Column header, e.g. "SOT". */
  short: string;
  /** Which end of the league ranking is best (fouls, goals against: false). */
  higherIsBetter: boolean;
  format: StatFormat;
  derive?: StatDerive;
}

/** How a league's stats are sourced, how its results are read, and what it tracks.
 *  Every LeagueConfig must have one (a registry test enforces it). */
export interface StatProfile {
  /** "team-stats": ESPN's season team statistics, one call per team (NBA,
   *  NHL). "boxscores": aggregated from every finished match's boxscore (club
   *  soccer, whose team statistics are empty). */
  source: "team-stats" | "boxscores";
  /** Result letters for form: W/D/L (soccer), W/L (NBA), W/L/OTL (NHL). */
  form: "wdl" | "wl" | "wl-otl";
  stats: StatDef[];
}

/** Pseudo-fields the engine adds to every source's fields: goals/points scored
 *  and conceded, from the results. Profiles reference them in `derive`. */
export const SCORED = "scored";
export const CONCEDED = "conceded";

/** Display a stat value; "—" when absent. */
export function formatStat(def: Pick<StatDef, "format">, value: number | null): string {
  if (value === null) return "—";
  switch (def.format) {
    case "pct":
      return `${value.toFixed(1)}%`;
    case "avg":
      return value.toFixed(1);
    case "avg2":
      return value.toFixed(2);
    case "int":
      return String(Math.round(value));
  }
}

// ── Results and form ─────────────────────────────────────────────────────────

export type Outcome = "W" | "D" | "L" | "OTL";

/** One finished game from a team's point of view. */
export interface TeamResult {
  gameId: string;
  /** ISO start time. */
  date: string;
  /** True if the team was the home side. */
  home: boolean;
  opponentId: string;
  opponent: string;
  scored: number;
  conceded: number;
  outcome: Outcome;
}

/** Games shown in `form` unless asked otherwise. */
export const FORM_LENGTH = 5;

const OVERTIME = /\b(OT|SO)\b|\d?OT/;

/** The result letter: draws are D (soccer), an overtime/shootout loss is OTL
 *  when the profile tracks it (otherwise a plain L). */
export function outcomeOf(scored: number, conceded: number, detail: string, form: StatProfile["form"]): Outcome {
  if (scored > conceded) return "W";
  if (scored === conceded) return "D";
  return form === "wl-otl" && OVERTIME.test(detail) ? "OTL" : "L";
}

/** `teamId`'s finished games with scores, oldest first. Unfinished, unscored or
 *  unrelated games are skipped; each game counts once. */
export function teamResults(games: Game[], teamId: string, form: StatProfile["form"]): TeamResult[] {
  const seen = new Set<string>();
  const out: TeamResult[] = [];
  for (const g of games) {
    if (g.state !== "post" || seen.has(g.id)) continue;
    const home = g.home.id === teamId;
    if (!home && g.away.id !== teamId) continue;
    const mine = home ? g.home : g.away;
    const theirs = home ? g.away : g.home;
    const scored = mine.score === "" ? NaN : Number(mine.score);
    const conceded = theirs.score === "" ? NaN : Number(theirs.score);
    if (!Number.isFinite(scored) || !Number.isFinite(conceded)) continue;
    seen.add(g.id);
    out.push({
      gameId: g.id,
      date: g.date,
      home,
      opponentId: theirs.id,
      opponent: theirs.abbreviation,
      scored,
      conceded,
      outcome: outcomeOf(scored, conceded, g.detail, form),
    });
  }
  return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

// ── Aggregation (pure) ───────────────────────────────────────────────────────

/** What a stat reads from: `fields` for plain keys, `totals` for derived ones. */
export interface StatSample {
  played: number;
  fields: Record<string, number>;
  totals: Record<string, number>;
}

/** Totals of the results' scored/conceded. */
function resultTotals(results: TeamResult[]): Record<string, number> {
  return {
    [SCORED]: results.reduce((n, r) => n + r.scored, 0),
    [CONCEDED]: results.reduce((n, r) => n + r.conceded, 0),
  };
}

/** A team's sample from ESPN season team statistics (the fields are already the
 *  season's averages and totals) plus its results for scored/conceded. */
export function sampleFromTeamStats(stats: EspnTeamSeasonStats, results: TeamResult[]): StatSample {
  const merged = { ...stats.values, ...resultTotals(results) };
  return { played: stats.games ?? 0, fields: merged, totals: merged };
}

/** Per-team samples from finished-match boxscores: plain fields are per-match
 *  means, totals are sums (so ratios weight by volume). Keyed by ESPN team id. */
export function samplesFromBoxscores(boxes: MatchBoxscore[]): Map<string, StatSample> {
  const acc = new Map<string, { played: number; sums: Record<string, number>; counts: Record<string, number> }>();
  const add = (side: MatchBoxscore["home"], conceded: number) => {
    let t = acc.get(side.teamId);
    if (!t) acc.set(side.teamId, (t = { played: 0, sums: {}, counts: {} }));
    t.played++;
    for (const [k, v] of Object.entries({ ...side.stats, [SCORED]: side.score, [CONCEDED]: conceded })) {
      t.sums[k] = (t.sums[k] ?? 0) + v;
      t.counts[k] = (t.counts[k] ?? 0) + 1;
    }
  };
  for (const b of boxes) {
    add(b.home, b.away.score);
    add(b.away, b.home.score);
  }
  const out = new Map<string, StatSample>();
  for (const [id, t] of acc) {
    const fields: Record<string, number> = {};
    for (const [k, sum] of Object.entries(t.sums)) fields[k] = sum / t.counts[k]!;
    out.set(id, { played: t.played, fields, totals: t.sums });
  }
  return out;
}

/** One stat's value from a sample; null when the sample lacks the inputs. */
export function statValue(def: StatDef, sample: StatSample): number | null {
  const d = def.derive;
  if (!d) return sample.fields[def.key] ?? null;
  if (d.kind === "perGame") {
    const total = sample.totals[d.of];
    return total === undefined || sample.played <= 0 ? null : total / sample.played;
  }
  const num = sample.totals[d.num];
  const den = sample.totals[d.den];
  return num === undefined || den === undefined || den === 0 ? null : (num / den) * (d.scale ?? 1);
}

/** Every profile stat for a sample, by key. */
export function profileValues(profile: StatProfile, sample: StatSample): Record<string, number | null> {
  return Object.fromEntries(profile.stats.map((def) => [def.key, statValue(def, sample)]));
}

const sameValue = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Standard competition ranks (1, 2, 2, 4): best first, ties share a rank.
 *  Null values get null. Returned in input order. */
export function assignRanks(values: (number | null)[], higherIsBetter: boolean): (number | null)[] {
  const ranked = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null)
    .sort((a, b) => (higherIsBetter ? b.v - a.v : a.v - b.v));
  const out: (number | null)[] = values.map(() => null);
  ranked.forEach((x, pos) => {
    const prev = ranked[pos - 1];
    out[x.i] = prev && sameValue(prev.v, x.v) ? out[prev.i]! : pos + 1;
  });
  return out;
}

// ── League shape ─────────────────────────────────────────────────────────────

export interface TeamStatLine {
  /** ESPN team id — unique only within a league. */
  teamId: string;
  abbreviation: string;
  name: string;
  /** Games the figures cover — show it next to averages; early-season numbers swing. */
  played: number;
  /** Stat value by profile key; null when the team has no data for it. */
  values: Record<string, number | null>;
  /** League rank by profile key (1 = best; ties share); null with no value. */
  ranks: Record<string, number | null>;
  /** Every finished game of the season, oldest first. */
  results: TeamResult[];
  /** The last FORM_LENGTH results, oldest first. */
  form: TeamResult[];
}

export interface LeagueStats {
  sport: string;
  label: string;
  profile: StatProfile;
  /** "current": this season has games; "last-season": the regular season
   *  hasn't started so last season's figures are shown; "not-started": ESPN
   *  has neither (teams is empty). */
  kind: "current" | "last-season" | "not-started";
  /** ESPN season year the figures cover (NBA 2026 = 2025-26 ends; soccer 2026
   *  = 2026-27 starts); null for "not-started". */
  season: number | null;
  /** Display name of the season shown, e.g. "2025-26". */
  seasonName: string;
  /** The upcoming season's name when `kind` is "last-season" or "not-started". */
  upcoming: string;
  teams: TeamStatLine[];
}

export interface RankedTeam {
  /** 1 = best; ties share a rank. */
  rank: number;
  team: TeamStatLine;
  value: number;
}

/** The league's teams ordered by one stat, best first (respecting the stat's
 *  higherIsBetter), with ranks; ties share a rank and sort by name. Teams
 *  without a value are left out. Throws on a key the profile doesn't have. */
export function rankBy(stats: LeagueStats, key: string): RankedTeam[] {
  const def = stats.profile.stats.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown stat "${key}". Known: ${stats.profile.stats.map((s) => s.key).join(", ")}.`);
  const ranked: RankedTeam[] = [];
  for (const team of stats.teams) {
    const value = team.values[key];
    const rank = team.ranks[key];
    if (value !== null && value !== undefined && rank !== null && rank !== undefined) ranked.push({ rank, team, value });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.team.name.localeCompare(b.team.name));
}

/** Assemble the league shape from per-team samples and results. Teams with no
 *  sample (no games yet) are kept with null values. */
export function buildTeamLines(
  profile: StatProfile,
  teams: EspnTeam[],
  samples: Map<string, StatSample>,
  resultsByTeam: Map<string, TeamResult[]>,
  formLength = FORM_LENGTH,
): TeamStatLine[] {
  const lines = teams.map((t): TeamStatLine => {
    const sample = samples.get(t.id) ?? { played: 0, fields: {}, totals: {} };
    const results = resultsByTeam.get(t.id) ?? [];
    return {
      teamId: t.id,
      abbreviation: t.abbreviation,
      name: t.name,
      played: sample.played,
      values: profileValues(profile, sample),
      ranks: {},
      results,
      form: results.slice(-formLength),
    };
  });
  for (const def of profile.stats) {
    const ranks = assignRanks(lines.map((l) => l.values[def.key] ?? null), def.higherIsBetter);
    lines.forEach((l, i) => (l.ranks[def.key] = ranks[i]!));
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** The network calls loadLeagueStats makes — replaceable in tests. */
export interface StatsFetchers {
  standings: (league: League, q: StandingsQuery) => ReturnType<typeof getStandings>;
  teams: (league: League) => Promise<EspnTeam[]>;
  teamStatistics: (league: League, teamId: string, season: number, ttlMs: number) => Promise<EspnTeamSeasonStats>;
  /** A team's finished-or-not regular-season games for the season. */
  teamGames: (league: League, teamId: string, season: number, ttlMs: number) => Promise<Game[]>;
  boxscore: (league: League, eventId: string) => Promise<MatchBoxscore>;
}

export const ESPN_FETCHERS: StatsFetchers = {
  standings: (league, q) => getStandings(league, q),
  teams: (league) => getTeams(league),
  teamStatistics: (league, id, season, ttl) => getTeamStatistics(league, id, season, ttl),
  teamGames: (league, id, season, ttl) =>
    isClubSoccer(league)
      ? getClubTeamResults(league, id, season, ttl)
      : getTeamGames(league, id, SEASON_TYPES.regular, ttl, season),
  boxscore: (league, id) => getMatchBoxscore(league, id),
};

/** Parallel calls per fetch stage: modest, so ESPN isn't hammered. */
export const CONCURRENCY = 8;

/** Map with at most `limit` calls in flight; results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** What to show, mirroring `standings`: this season's regular season once any
 *  game has been played, else last season's. */
export function seasonOf(view: StandingsView): { kind: LeagueStats["kind"]; season: number | null; seasonName: string; upcoming: string } {
  switch (view.kind) {
    case "current":
      return { kind: "current", season: view.standings.season, seasonName: view.standings.seasonName, upcoming: "" };
    case "last-season":
      return { kind: "last-season", season: view.standings.season, seasonName: view.standings.seasonName, upcoming: view.upcoming };
    case "not-started":
      return { kind: "not-started", season: null, seasonName: "", upcoming: view.upcoming };
  }
}

const HOUR_MS = 60 * 60_000;

/**
 * Load a league's stats: choose the season (as `standings` does), fetch the
 * source, and aggregate. NBA/NHL: team statistics + schedule per team.
 * Club soccer: every team's played matches, then each distinct finished
 * match's boxscore (cached on disk forever, so only new matches are fetched).
 */
export async function loadLeagueStats(
  cfg: LeagueConfig,
  fetchers: StatsFetchers = ESPN_FETCHERS,
  formLength = FORM_LENGTH,
): Promise<LeagueStats> {
  const sp = cfg.statProfile;
  const view = await loadStandingsView((q) => fetchers.standings(cfg.league, q), "conference");
  const chosen = seasonOf(view);
  const base = { sport: cfg.sport, label: cfg.label, profile: sp, ...chosen };
  if (chosen.season === null) return { ...base, teams: [] };
  const season = chosen.season;
  // A finished season never changes; the one in progress refreshes.
  const ttl = chosen.kind === "last-season" ? 24 * HOUR_MS : 30 * 60_000;

  const teams = await fetchers.teams(cfg.league);
  const games = await mapLimit(teams, CONCURRENCY, (t) => fetchers.teamGames(cfg.league, t.id, season, ttl));
  const resultsByTeam = new Map(teams.map((t, i) => [t.id, teamResults(games[i]!, t.id, sp.form)]));

  let samples = new Map<string, StatSample>();
  if (sp.source === "team-stats") {
    const all = await mapLimit(teams, CONCURRENCY, (t) => fetchers.teamStatistics(cfg.league, t.id, season, ttl));
    teams.forEach((t, i) => samples.set(t.id, sampleFromTeamStats(all[i]!, resultsByTeam.get(t.id) ?? [])));
  } else {
    const ids = new Set(teams.map((t) => t.id));
    const finished = new Map<string, Game>();
    for (const list of games) for (const g of list) if (g.state === "post" && ids.has(g.home.id) && ids.has(g.away.id)) finished.set(g.id, g);
    const boxes = await mapLimit([...finished.keys()], CONCURRENCY, async (id) => {
      try {
        return await fetchers.boxscore(cfg.league, id);
      } catch (e) {
        if (e instanceof NotFinishedError) return null;
        throw e;
      }
    });
    samples = samplesFromBoxscores(boxes.filter((b): b is MatchBoxscore => b !== null));
  }
  return { ...base, teams: buildTeamLines(sp, teams, samples, resultsByTeam, formLength) };
}
