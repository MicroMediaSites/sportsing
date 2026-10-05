// League standings for ESPN-backed leagues (NBA, NHL): which table and columns
// each league shows, choosing the season to show, filtering, sorting, and
// rendering. Pure — the fetch is injected — so it's unit-tested without network.
//
// Layouts are keyed by ESPN league path rather than living on LeagueConfig:
// they name ESPN stat fields (`otLosses`, `gamesBehind`), i.e. they describe
// the data source's per-league shape, the same way src/espn.ts's LEAGUES does.

import { c, pad } from "./ansi.ts";
import { LEAGUES, SEASON_TYPES, type EspnStandings, type EspnStandingsEntry, type EspnStandingsGroup, type League, type StandingsQuery } from "./espn.ts";

export type StandingsLevel = NonNullable<StandingsQuery["level"]>;

export interface StandingsColumn {
  /** ESPN stat name, e.g. "wins". */
  stat: string;
  /** Header label, e.g. "W". */
  label: string;
  width: number;
}

export interface StandingsLayout {
  /** The table level shown when no filter is given. */
  level: StandingsLevel;
  /** ESPN stat a table is ranked by, descending (NBA win%, NHL points). */
  rankBy: string;
  columns: StandingsColumn[];
}

export const STANDINGS_LAYOUTS: Partial<Record<League, StandingsLayout>> = {
  [LEAGUES.nba]: {
    level: "conference",
    rankBy: "winPercent",
    columns: [
      { stat: "wins", label: "W", width: 4 },
      { stat: "losses", label: "L", width: 4 },
      { stat: "winPercent", label: "PCT", width: 6 },
      { stat: "gamesBehind", label: "GB", width: 6 },
    ],
  },
  [LEAGUES.nhl]: {
    level: "division",
    rankBy: "points",
    columns: [
      { stat: "gamesPlayed", label: "GP", width: 4 },
      { stat: "wins", label: "W", width: 4 },
      { stat: "losses", label: "L", width: 4 },
      { stat: "otLosses", label: "OTL", width: 5 },
      { stat: "points", label: "PTS", width: 5 },
    ],
  },
};

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Games a team has played: ESPN's `gamesPlayed` (NHL) when present, else the
 *  sum of its result columns (NBA has only wins/losses). */
export function gamesPlayed(e: EspnStandingsEntry): number {
  if (e.stats.gamesPlayed !== undefined) return num(e.stats.gamesPlayed);
  return num(e.stats.wins) + num(e.stats.losses) + num(e.stats.ties) + num(e.stats.otLosses);
}

/** True if any team in any table has played a game. */
export function hasGames(groups: EspnStandingsGroup[]): boolean {
  return groups.some((g) => g.entries.some((e) => gamesPlayed(e) > 0));
}

/** Table order: the layout's rank stat descending, then ESPN's playoff seed
 *  (it encodes the league's tiebreakers; 0/absent = unseeded, last), then name.
 *  Seed isn't the primary key — after the play-in it no longer follows the
 *  record. ESPN returns entries in no useful order. */
export function sortEntries(entries: EspnStandingsEntry[], rankBy: string): EspnStandingsEntry[] {
  const seed = (e: EspnStandingsEntry) => num(e.stats.playoffSeed) || Infinity;
  return [...entries].sort(
    (a, b) => num(b.stats[rankBy]) - num(a.stats[rankBy]) || seed(a) - seed(b) || a.team.localeCompare(b.team),
  );
}

export type StandingsView =
  | { kind: "current"; standings: EspnStandings }
  /** The regular season hasn't started; `standings` is last season's final table. */
  | { kind: "last-season"; standings: EspnStandings; upcoming: string }
  | { kind: "not-started"; upcoming: string };

/**
 * Pick what to show: the current season's regular-season standings once any
 * game has been played; before that, last season's final regular-season
 * standings; and "not started" if ESPN has neither. Regular season is asked for
 * explicitly — ESPN's default during preseason is a preseason table.
 */
export async function loadStandingsView(
  fetch: (q: StandingsQuery) => Promise<EspnStandings>,
  level: StandingsLevel,
): Promise<StandingsView> {
  const regular = SEASON_TYPES.regular;
  const current = await fetch({ seasonType: regular, level });
  if (hasGames(current.groups)) return { kind: "current", standings: current };
  const upcoming = current.seasonName;
  if (current.season === null) return { kind: "not-started", upcoming };
  const last = await fetch({ season: current.season - 1, seasonType: regular, level });
  return hasGames(last.groups) ? { kind: "last-season", standings: last, upcoming } : { kind: "not-started", upcoming };
}

/** Does user input name this group? Case-insensitive match on the abbreviation
 *  ("West", "PAC"), the full name ("Western Conference"), or its first word
 *  ("western", "pacific"). */
export function groupMatches(g: { name: string; abbreviation: string }, input: string): boolean {
  const q = input.trim().toLowerCase();
  if (!q) return false;
  const name = g.name.toLowerCase();
  return g.abbreviation.toLowerCase() === q || name === q || name.split(/\s+/)[0] === q;
}

/** Render one table: rank, team, the layout's columns; favorites marked ★ and
 *  highlighted. */
export function renderStandingsTable(g: EspnStandingsGroup, layout: StandingsLayout, favoriteIds: ReadonlySet<string>): string {
  const TEAM_W = 26;
  const { columns } = layout;
  const header = c.dim(pad("#", 3) + pad("Team", TEAM_W) + columns.map((col) => pad(col.label, col.width, "right")).join(""));
  const rows = sortEntries(g.entries, layout.rankBy).map((e, i) => {
    const fav = favoriteIds.has(e.teamId);
    const name = fav ? c.bold(c.yellow(`★ ${e.team}`)) : `  ${e.team}`;
    const stats = columns.map((col) => pad(e.stats[col.stat] ?? "-", col.width, "right")).join("");
    return pad(c.dim(String(i + 1)), 3) + pad(name, TEAM_W) + (fav ? c.bold(stats) : stats);
  });
  return [c.bold(c.cyan(g.name)), header, ...rows].join("\n");
}
