// The `intl` namespace — national teams in every competition: the Nations
// Leagues, qualifiers, continental tournaments, friendlies (and the World Cup,
// which `sportsing fifa` covers in depth).
//
// National teams have no league. `LEAGUES.intl` is ESPN's international-
// friendlies "league", used only for its /teams list (every national team);
// the games come from ESPN's cross-competition team schedule, like a club's
// cup and European ties (see "Other competitions" in src/commands/league.ts).
// So this is a teams-only LeagueConfig: every command is about one team
// (`--team X`) or the favorites — which are the `fifa` favorites, not a
// second list.

import { c } from "../ansi.ts";
import { LEAGUES } from "../espn.ts";
import { SOCCER_PERIODS } from "../format.ts";
import { leagueNamespace, SOCCER_NEXT_SCAN_DAYS, type GameFilter, type LeagueConfig } from "../commands/league.ts";
import { SOCCER_PLAYER_STATS, SOCCER_STATS } from "./soccer.ts";

/** ESPN's slug for the World Cup. */
export const WORLD_CUP = "fifa.world";

/** National-team games outside the World Cup. The cross-sport views and the
 *  daemon use this: `sportsing fifa` already follows the World Cup itself, and
 *  a match must not be listed (or opened) twice. */
export const notWorldCup: GameFilter = (g) => g.competition?.slug !== WORLD_CUP;

function help(): void {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsing intl"))} — national teams, every competition

${b("USAGE")}
  sportsing intl <command> [--team X]
  ${c.dim("No --team = your national-team favorites (the same list as `sportsing fifa fav`).")}

${b("COMMANDS")}
  ${c.green("next")}               Next game + countdown
  ${c.green("today")}              Games today  ${c.dim("(--tomorrow, --yesterday, --offset N)")}
  ${c.green("schedule")}           Played and upcoming games, by day
  ${c.green("results")}            Finished games, newest first
  ${c.green("watch")}  ${c.dim("[team]")}      Open the stream where you can watch it ${c.dim("(--wait, --provider, --url, --smoke)")}
  ${c.green("teams")}              Every national team: code for --team, name ${c.dim("(--json)")}
  ${c.green("fav")}    ${c.dim("[add|rm|list]")} Manage favorite national teams ${c.dim("(shared with `sportsing fifa fav`)")}

${b("WHAT IT COVERS")}
  Nations Leagues, World Cup and continental qualifiers, continental
  tournaments and friendlies — each game is labelled with its competition.
  Your favorites' games show up in bare ${c.dim("sportsing today | next | me")} and the
  daemon opens them. For the World Cup itself use ${c.dim("sportsing fifa")}.
  There are no tables or stats here: those belong to each competition.

${b("DATA")}
  ESPN's free (unofficial) API — no key needed. Times are local.

${b("EXAMPLES")}
  sportsing intl next --team Italy
  sportsing intl schedule --team France
  sportsing intl results --team USA
  sportsing intl today
`);
}

export const INTL: LeagueConfig = {
  sport: "intl",
  league: LEAGUES.intl,
  label: "International",
  shortLabel: "Intl",
  icon: "⚽",
  periods: SOCCER_PERIODS,
  nextScanDays: SOCCER_NEXT_SCAN_DAYS,
  // Required of every LeagueConfig; `stats` and `roster` aren't among this
  // namespace's commands, so the club-soccer profiles are never read.
  statProfile: SOCCER_STATS,
  playerStatProfile: SOCCER_PLAYER_STATS,
  // Fox carries most national-team football in the US (FS1 / FS2).
  watchProvider: "fubo",
  favoritesSport: "fifa",
  teamsOnly: true,
  commands: ["today", "next", "schedule", "results", "watch", "teams", "fav"],
  help,
  aliases: {
    US: "USA",
    USMNT: "USA",
    "United States of America": "USA",
    Holland: "NED",
    Turkey: "TUR", // ESPN lists Türkiye
    Korea: "KOR",
    "Czech Republic": "CZE", // ESPN lists Czechia
  },
};

/** Dispatch a `sportsing intl <command>` invocation. */
export const intl = leagueNamespace(INTL);
