// The club-soccer namespaces — `sportsing epl | seriea | ligue1` — ESPN's
// eng.1 / ita.1 / fra.1. All behavior lives in the shared league command set
// (src/commands/league.ts); this module is each league's configuration.
//
// ESPN's team abbreviations are odd (Man City is MNC, Man United MAN, Lyon
// LYON, Marseille OLM). resolveTeam already takes an abbreviation, full name,
// ESPN short name ("Man City", "Spurs", "Man United", "Milan", "PSG"…) or a
// unique location, so the aliases here cover only what it can't: the common
// names and codes that match none of those.

import { LEAGUES } from "../espn.ts";
import { SOCCER_PERIODS } from "../format.ts";
import { leagueNamespace, SOCCER_NEXT_SCAN_DAYS, type LeagueConfig } from "../commands/league.ts";

const SOCCER = {
  icon: "⚽",
  periods: SOCCER_PERIODS,
  nextScanDays: SOCCER_NEXT_SCAN_DAYS,
} as const;

export const EPL: LeagueConfig = {
  ...SOCCER,
  sport: "epl",
  league: LEAGUES.epl,
  label: "Premier League",
  shortLabel: "EPL",
  aliases: {
    "Man Utd": "MAN",
    "Man U": "MAN",
    MUFC: "MAN",
    MCI: "MNC",
    MCFC: "MNC",
    Forest: "NFO",
    NOT: "NFO",
    Wolves: "WOL",
    Palace: "CRY",
    Brighton: "BHA",
  },
};

export const SERIEA: LeagueConfig = {
  ...SOCCER,
  sport: "seriea",
  league: LEAGUES.seriea,
  label: "Serie A",
  aliases: {
    Inter: "INT",
    Internazionale: "INT",
    Juve: "JUV",
    "AC Milan": "MIL",
    ACM: "MIL",
  },
};

export const LIGUE1: LeagueConfig = {
  ...SOCCER,
  sport: "ligue1",
  league: LEAGUES.ligue1,
  label: "Ligue 1",
  aliases: {
    OM: "OLM",
    OL: "LYON",
    "Olympique Marseille": "OLM",
    "Olympique Lyonnais": "LYON",
    ASM: "MON",
    "Paris SG": "PSG",
  },
};

/** Dispatch a `sportsing epl | seriea | ligue1 <command>` invocation. Args are everything after the namespace. */
export const epl = leagueNamespace(EPL);
export const seriea = leagueNamespace(SERIEA);
export const ligue1 = leagueNamespace(LIGUE1);
