// The `nba` sport namespace — NBA via ESPN's free API, preseason through
// playoffs. All behavior lives in the shared league command set
// (src/commands/league.ts); this module is the NBA's configuration.

import { LEAGUES } from "../espn.ts";
import { leagueNamespace, type LeagueConfig } from "../commands/league.ts";

export const NBA: LeagueConfig = {
  sport: "nba",
  league: LEAGUES.nba,
  label: "NBA",
  icon: "🏀",
  // NBA.com-style codes where ESPN's differ (ESPN: GS, NO, NY, SA, UTAH, WSH).
  aliases: { GSW: "GS", NOP: "NO", NYK: "NY", SAS: "SA", UTA: "UTAH", WAS: "WSH" },
};

/** Dispatch a `sportsing nba <command>` invocation. Args are everything after `nba`. */
export const nba = leagueNamespace(NBA);
