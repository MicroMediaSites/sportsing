// The `nba` sport namespace — NBA via ESPN's free API, preseason through
// playoffs. All behavior lives in the shared league command set
// (src/commands/league.ts); this module is the NBA's configuration.

import { LEAGUES } from "../espn.ts";
import { leagueNamespace, type LeagueConfig } from "../commands/league.ts";
import { CONCEDED, type StatProfile } from "../stats.ts";

// ESPN `teams/{id}/statistics` season averages (the avg* fields are per game
// already). Points allowed comes from the results, not the endpoint.
const NBA_STATS: StatProfile = {
  source: "team-stats",
  form: "wl",
  scatter: { x: "avgPoints", y: "pointsAllowed" },
  stats: [
    { key: "avgPoints", label: "Points", short: "PTS", higherIsBetter: true, format: "avg" },
    { key: "pointsAllowed", label: "Points allowed", short: "OPP", higherIsBetter: false, format: "avg", derive: { kind: "perGame", of: CONCEDED } },
    { key: "fieldGoalPct", label: "Field goal %", short: "FG%", higherIsBetter: true, format: "pct" },
    { key: "threePointPct", label: "Three-point %", short: "3P%", higherIsBetter: true, format: "pct" },
    { key: "freeThrowPct", label: "Free throw %", short: "FT%", higherIsBetter: true, format: "pct" },
    { key: "avgRebounds", label: "Rebounds", short: "REB", higherIsBetter: true, format: "avg" },
    { key: "avgOffensiveRebounds", label: "Offensive rebounds", short: "OREB", higherIsBetter: true, format: "avg" },
    { key: "avgAssists", label: "Assists", short: "AST", higherIsBetter: true, format: "avg" },
    { key: "avgTurnovers", label: "Turnovers", short: "TOV", higherIsBetter: false, format: "avg" },
    { key: "avgSteals", label: "Steals", short: "STL", higherIsBetter: true, format: "avg" },
    { key: "avgBlocks", label: "Blocks", short: "BLK", higherIsBetter: true, format: "avg" },
    { key: "avgFouls", label: "Fouls", short: "PF", higherIsBetter: false, format: "avg" },
  ],
};

export const NBA: LeagueConfig = {
  sport: "nba",
  league: LEAGUES.nba,
  label: "NBA",
  icon: "🏀",
  // NBA.com-style codes where ESPN's differ (ESPN: GS, NO, NY, SA, UTAH, WSH).
  aliases: { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" },
  // Jazz local broadcasts (and the national NBA games) stream on Fubo.
  watchProvider: "fubo",
  statProfile: NBA_STATS,
};

/** Dispatch a `sportsing nba <command>` invocation. Args are everything after `nba`. */
export const nba = leagueNamespace(NBA);
