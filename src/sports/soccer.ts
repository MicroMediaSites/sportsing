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
import { CONCEDED, SCORED, type StatProfile } from "../stats.ts";

// Per-match means of ESPN's summary boxscore, aggregated over the season (club
// soccer's team statistics endpoint is empty). Goals come from the scores. No xG.
const SOCCER_STATS: StatProfile = {
  source: "boxscores",
  form: "wdl",
  stats: [
    { key: "goalsFor", label: "Goals for", short: "GF", higherIsBetter: true, format: "avg2", derive: { kind: "perGame", of: SCORED } },
    { key: "goalsAgainst", label: "Goals against", short: "GA", higherIsBetter: false, format: "avg2", derive: { kind: "perGame", of: CONCEDED } },
    { key: "possessionPct", label: "Possession", short: "Poss", higherIsBetter: true, format: "pct" },
    { key: "totalShots", label: "Shots", short: "Sh", higherIsBetter: true, format: "avg" },
    { key: "shotsOnTarget", label: "Shots on target", short: "SoT", higherIsBetter: true, format: "avg" },
    { key: "passAccuracy", label: "Pass accuracy", short: "Pass%", higherIsBetter: true, format: "pct", derive: { kind: "ratio", num: "accuratePasses", den: "totalPasses", scale: 100 } },
    { key: "totalPasses", label: "Passes", short: "Pass", higherIsBetter: true, format: "int" },
    { key: "wonCorners", label: "Corners", short: "Crn", higherIsBetter: true, format: "avg" },
    { key: "effectiveTackles", label: "Tackles won", short: "Tkl", higherIsBetter: true, format: "avg" },
    { key: "interceptions", label: "Interceptions", short: "Int", higherIsBetter: true, format: "avg" },
    { key: "saves", label: "Saves", short: "Sv", higherIsBetter: true, format: "avg" },
    { key: "foulsCommitted", label: "Fouls", short: "Fls", higherIsBetter: false, format: "avg" },
    { key: "offsides", label: "Offsides", short: "Off", higherIsBetter: false, format: "avg" },
    { key: "yellowCards", label: "Yellow cards", short: "YC", higherIsBetter: false, format: "avg2" },
    { key: "redCards", label: "Red cards", short: "RC", higherIsBetter: false, format: "avg2" },
  ],
};

const SOCCER = {
  icon: "⚽",
  periods: SOCCER_PERIODS,
  nextScanDays: SOCCER_NEXT_SCAN_DAYS,
  statProfile: SOCCER_STATS,
} as const;

export const EPL: LeagueConfig = {
  ...SOCCER,
  sport: "epl",
  league: LEAGUES.epl,
  label: "Premier League",
  shortLabel: "EPL",
  watchProvider: "peacock",
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
  watchProvider: "paramount-plus",
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
  watchProvider: "fubo",
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
