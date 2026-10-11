// The `nhl` sport namespace — NHL via ESPN's free API, preseason through
// playoffs. All behavior lives in the shared league command set
// (src/commands/league.ts); this module is the NHL's configuration.

import { LEAGUES } from "../espn.ts";
import { leagueNamespace, type LeagueConfig } from "../commands/league.ts";
import type { StatProfile } from "../stats.ts";
import type { PlayerStatProfile } from "../squad.ts";

// ESPN `teams/{id}/statistics` gives season totals for most of these, so the
// per-game figures are derived. ESPN lists no hits, blocked shots, power-play
// opportunities or penalty kill for the NHL, so only power-play goals are here.
const NHL_STATS: StatProfile = {
  source: "team-stats",
  form: "wl-otl",
  scatter: { x: "goalsPerGame", y: "avgGoalsAgainst" },
  stats: [
    { key: "goalsPerGame", label: "Goals for", short: "GF/G", higherIsBetter: true, format: "avg2", derive: { kind: "perGame", of: "goals" } },
    { key: "avgGoalsAgainst", label: "Goals against", short: "GA/G", higherIsBetter: false, format: "avg2" },
    { key: "shotsPerGame", label: "Shots for", short: "SF/G", higherIsBetter: true, format: "avg", derive: { kind: "perGame", of: "shotsTotal" } },
    { key: "shotsAgainstPerGame", label: "Shots against", short: "SA/G", higherIsBetter: false, format: "avg", derive: { kind: "perGame", of: "shotsAgainst" } },
    { key: "shootingPct", label: "Shooting %", short: "SH%", higherIsBetter: true, format: "pct" },
    { key: "savePct", label: "Save %", short: "SV%", higherIsBetter: true, format: "pct", derive: { kind: "ratio", num: "saves", den: "shotsAgainst", scale: 100 } },
    { key: "powerPlayGoalsPerGame", label: "Power-play goals", short: "PPG/G", higherIsBetter: true, format: "avg2", derive: { kind: "perGame", of: "powerPlayGoals" } },
    { key: "faceoffPercent", label: "Faceoff win %", short: "FO%", higherIsBetter: true, format: "pct" },
    { key: "penaltyMinutesPerGame", label: "Penalty minutes", short: "PIM/G", higherIsBetter: false, format: "avg", derive: { kind: "perGame", of: "penaltyMinutes" } },
  ],
};

// ESPN `teams/{id}/athletes/statistics`: skaters are in the "team" category,
// goalies in "goalkeeping". Season totals, except time on ice (seconds per
// game) and the goalie rates. savePct is a 0-1 ratio.
const NHL_PLAYER_STATS: PlayerStatProfile = {
  source: "athlete-statistics",
  category: "team",
  positionGroups: [
    { key: "C", label: "Centers", abbreviations: ["C"] },
    { key: "LW", label: "Left wings", abbreviations: ["LW"] },
    { key: "RW", label: "Right wings", abbreviations: ["RW"] },
    { key: "D", label: "Defensemen", abbreviations: ["D"] },
    { key: "G", label: "Goalies", abbreviations: ["G"] },
  ],
  stats: [
    { key: "games", label: "Games played", short: "GP", higherIsBetter: true, format: "int" },
    { key: "goals", label: "Goals", short: "G", higherIsBetter: true, format: "int" },
    { key: "assists", label: "Assists", short: "A", higherIsBetter: true, format: "int" },
    { key: "points", label: "Points", short: "PTS", higherIsBetter: true, format: "int" },
    { key: "plusMinus", label: "Plus/minus", short: "+/-", higherIsBetter: true, format: "signed" },
    { key: "penaltyMinutes", label: "Penalty minutes", short: "PIM", higherIsBetter: false, format: "int" },
    { key: "timeOnIcePerGame", label: "Time on ice per game", short: "TOI", higherIsBetter: true, format: "clock" },
  ],
  goalie: {
    group: "G",
    category: "goalkeeping",
    stats: [
      { key: "games", label: "Games played", short: "GP", higherIsBetter: true, format: "int" },
      { key: "wins", label: "Wins", short: "W", higherIsBetter: true, format: "int" },
      { key: "losses", label: "Losses", short: "L", higherIsBetter: false, format: "int" },
      { key: "avgGoalsAgainst", label: "Goals against average", short: "GAA", higherIsBetter: false, format: "avg2" },
      { key: "savePct", label: "Save %", short: "SV%", higherIsBetter: true, format: "ratio3" },
    ],
  },
};

export const NHL: LeagueConfig = {
  sport: "nhl",
  league: LEAGUES.nhl,
  label: "NHL",
  icon: "🏒",
  // NHL.com-style codes where ESPN's /teams differ (ESPN: LA, NJ, SJ, TB, UTAH).
  // UTA matters most: ESPN's own schedules call the Mammoth UTA, /teams UTAH.
  aliases: { LAK: "LA", NJD: "NJ", SJS: "SJ", TBL: "TB", UTA: "UTAH" },
  periods: { regulation: 3, shootout: true },
  statProfile: NHL_STATS,
  playerStatProfile: NHL_PLAYER_STATS,
};

/** Dispatch a `sportsing nhl <command>` invocation. Args are everything after `nhl`. */
export const nhl = leagueNamespace(NHL);
