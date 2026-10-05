// The `nhl` sport namespace — NHL via ESPN's free API, preseason through
// playoffs. All behavior lives in the shared league command set
// (src/commands/league.ts); this module is the NHL's configuration.

import { LEAGUES } from "../espn.ts";
import { leagueNamespace, type LeagueConfig } from "../commands/league.ts";

export const NHL: LeagueConfig = {
  sport: "nhl",
  league: LEAGUES.nhl,
  label: "NHL",
  icon: "🏒",
  // NHL.com-style codes where ESPN's /teams differ (ESPN: LA, NJ, SJ, TB, UTAH).
  // UTA matters most: ESPN's own schedules call the Mammoth UTA, /teams UTAH.
  aliases: { LAK: "LA", NJD: "NJ", SJS: "SJ", TBL: "TB", UTA: "UTAH" },
  periods: { regulation: 3, shootout: true },
};

/** Dispatch a `sportsing nhl <command>` invocation. Args are everything after `nhl`. */
export const nhl = leagueNamespace(NHL);
