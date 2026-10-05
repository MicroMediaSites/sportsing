// `sportsing <nba|nhl> bracket [--season YYYY]` — the playoff bracket. Once
// the postseason (or the NBA play-in) is under way, the real bracket with
// series scores; before that, a bracket projected from the standings, labelled
// as projected. `--season` shows a past postseason. The data fetching lives
// here; grouping, projection and rendering are pure in src/playoff-bracket.ts.

import { c } from "../ansi.ts";
import { getFavorites } from "../config.ts";
import {
  getLeagueSeason,
  getStandings,
  getTeamPlayoffGames,
  getTeams,
  SEASON_TYPES,
  type EspnTeam,
  type PlayoffGame,
} from "../espn.ts";
import {
  BRACKET_FORMATS,
  buildSeries,
  parseSeasonArg,
  projectNba,
  projectNhl,
  renderBracket,
  renderProjection,
  seasonLabel,
  type BracketFormat,
} from "../playoff-bracket.ts";
import { loadStandingsView } from "../standings.ts";
import { getFlag } from "./_lib.ts";
import type { LeagueConfig } from "./league.ts";

/** Resolves a league's favorites to team ids (league.ts's `favoriteIds`). */
export type FavoriteIdsFn = (cfg: LeagueConfig, teams: EspnTeam[], favs: string[]) => Set<string>;

/** ESPN season types during which the current season's bracket exists:
 *  postseason, off-season (it's finished), play-in. */
const BRACKET_PHASES = new Set([3, 4, 5]);

/** Schedules fetched at once — a bracket reads every team's postseason. */
const CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Every team's postseason (and play-in, if the league has one) games for an
 *  ESPN season year. ESPN only exposes these per team; duplicates (each game
 *  appears on both teams' schedules) are collapsed downstream. */
async function loadPostseason(cfg: LeagueConfig, fmt: BracketFormat, teams: EspnTeam[], season: number): Promise<PlayoffGame[]> {
  const types = fmt.playIn ? [SEASON_TYPES.postseason, SEASON_TYPES.playIn] : [SEASON_TYPES.postseason];
  const jobs = teams.flatMap((t) => types.map((type) => ({ id: t.id, type })));
  const lists = await mapLimit(jobs, CONCURRENCY, (j) => getTeamPlayoffGames(cfg.league, j.id, j.type, season));
  const seen = new Set<string>();
  return lists.flat().filter((pg) => !seen.has(pg.game.id) && !!seen.add(pg.game.id));
}

function title(cfg: LeagueConfig, text: string): void {
  console.log(c.bold(c.cyan(`${cfg.icon} ${cfg.label} — ${text}`)));
}

/** Print the real bracket for `season`; false if ESPN has no postseason games for it. */
async function showPostseason(
  cfg: LeagueConfig,
  fmt: BracketFormat,
  teams: EspnTeam[],
  season: number,
  favIds: ReadonlySet<string>,
): Promise<boolean> {
  const [games, standings] = await Promise.all([
    loadPostseason(cfg, fmt, teams, season),
    getStandings(cfg.league, { season, seasonType: SEASON_TYPES.regular }),
  ]);
  // ESPN's final playoffSeed already reflects the NBA play-in.
  const seeds = new Map<string, string>();
  for (const g of standings.groups)
    for (const e of g.entries) if (Number(e.stats.playoffSeed) > 0) seeds.set(e.teamId, String(Number(e.stats.playoffSeed)));
  const series = buildSeries(games, seeds);
  const playIn = games.filter((pg) => pg.playIn);
  if (series.length === 0 && playIn.length === 0) return false;

  title(cfg, `Playoff Bracket ${standings.seasonName || seasonLabel(season)}`);
  console.log(renderBracket(fmt, series, playIn, favIds));
  return true;
}

/** Print a bracket projected from standings: current ones once the regular
 *  season is under way, else last season's final standings. */
async function showProjection(cfg: LeagueConfig, fmt: BracketFormat, favIds: ReadonlySet<string>): Promise<void> {
  const level = fmt.projection === "nhl" ? "division" : "conference";
  const view = await loadStandingsView((q) => getStandings(cfg.league, q), level);
  if (view.kind === "not-started") {
    title(cfg, `Projected Playoff Bracket${view.upcoming ? ` ${view.upcoming}` : ""}`);
    console.log(c.dim("\nThe regular season hasn't started, and ESPN has no earlier standings to project from."));
    return;
  }
  const groups = view.standings.groups;
  const projected = fmt.projection === "nhl" ? projectNhl(groups, fmt.rankBy) : projectNba(groups, fmt.rankBy);
  title(cfg, `Projected Playoff Bracket ${view.kind === "current" ? view.standings.seasonName : view.upcoming}`.trimEnd());
  if (view.kind === "current") {
    console.log(c.yellow("PROJECTED — the postseason hasn't started; seeded from current standings."));
  } else {
    const last = view.standings.season;
    console.log(
      c.yellow(
        `PROJECTED — the ${view.upcoming || "new"} regular season hasn't started; seeded from last season's (${view.standings.seasonName}) final standings.`,
      ),
    );
    if (last !== null) console.log(c.dim(`Last season's actual bracket: sportsing ${cfg.sport} bracket --season ${last}`));
  }
  if (projected.length === 0) {
    console.log(c.dim("\nNot enough standings data to project a bracket."));
    return;
  }
  console.log(renderProjection(fmt, projected, favIds));
}

/** `bracket [--season YYYY]`. */
export async function leagueBracket(cfg: LeagueConfig, args: string[], favoriteIds: FavoriteIdsFn): Promise<void> {
  const fmt = BRACKET_FORMATS[cfg.league];
  if (!fmt) throw new Error(`No playoff format for ${cfg.label}.`);
  const seasonArg = getFlag(args, "--season");
  const asked = seasonArg === null ? null : parseSeasonArg(seasonArg);
  if (seasonArg !== null && asked === null) {
    throw new Error(`Bad --season "${seasonArg}". Use the year the season ends (2026) or 2025-26.`);
  }

  const [teams, favs] = await Promise.all([getTeams(cfg.league), getFavorites(cfg.sport)]);
  const favIds = favs.length > 0 ? favoriteIds(cfg, teams, favs) : new Set<string>();

  if (asked !== null) {
    if (await showPostseason(cfg, fmt, teams, asked, favIds)) return;
    title(cfg, `Playoff Bracket ${seasonLabel(asked)}`);
    console.log(c.dim(`\nESPN has no ${cfg.label} postseason games for ${seasonLabel(asked)}. Drop --season for a projection.`));
    return;
  }

  const current = await getLeagueSeason(cfg.league);
  if (current && BRACKET_PHASES.has(current.type) && (await showPostseason(cfg, fmt, teams, current.year, favIds))) return;
  await showProjection(cfg, fmt, favIds);
}
