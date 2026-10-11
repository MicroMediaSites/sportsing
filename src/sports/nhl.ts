// The `nhl` sport namespace — NHL via ESPN's free API, preseason through
// playoffs. All behavior lives in the shared league command set
// (src/commands/league.ts); this module is the NHL's configuration.

import { LEAGUES } from "../espn.ts";
import { leagueNamespace, type LeagueConfig } from "../commands/league.ts";
import type { StatProfile } from "../stats.ts";

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
};

/** Dispatch a `sportsing nhl <command>` invocation. Args are everything after `nhl`. */
export const nhl = leagueNamespace(NHL);
