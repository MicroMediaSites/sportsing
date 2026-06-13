// The `fifa` sport namespace — FIFA World Cup 2026. Owns its own subcommand
// table and help. Other sports (e.g. `nfl`, `nba`) become sibling modules
// under src/sports/ and register in src/index.ts's SPORTS map.

import { c } from "../ansi.ts";
import { today } from "../commands/today.ts";
import { fixtures } from "../commands/fixtures.ts";
import { schedule } from "../commands/schedule.ts";
import { results } from "../commands/results.ts";
import { stats } from "../commands/stats.ts";
import { table } from "../commands/table.ts";
import { bracket } from "../commands/bracket.ts";
import { next } from "../commands/next.ts";
import { scorers } from "../commands/scorers.ts";
import { live } from "../commands/live.ts";
import { setup } from "../commands/setup.ts";
import { fav } from "../commands/fav.ts";
import { me } from "../commands/me.ts";

const ROUTES: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  today,
  fixtures,
  schedule,
  results,
  table,
  bracket: () => bracket(),
  next,
  scorers: () => scorers(),
  stats,
  live: () => live(),
  fav,
  me,
  setup,
};

const ALIASES: Record<string, string> = {
  t: "today",
  n: "next",
  f: "fixtures",
  standings: "table",
  tables: "table",
  knockout: "bracket",
};

/** Dispatch a `sportsball fifa <command>` invocation. Args are everything after `fifa`. */
export async function fifa(args: string[]): Promise<void> {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return fifaHelp();

  const route = ROUTES[cmd] ?? ROUTES[ALIASES[cmd] ?? ""];
  if (!route) {
    console.error(c.red(`Unknown fifa command: ${cmd}`));
    console.error(c.dim("Run `sportsball fifa help` for usage."));
    process.exitCode = 1;
    return;
  }
  await route(rest);
}

function fifaHelp(): void {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsball fifa"))} — FIFA World Cup 2026

${b("USAGE")}
  sportsball fifa <command> [options]
  ${c.dim("(during the World Cup, the `fifa` prefix is optional — `sportsball today` works too)")}

${b("COMMANDS")}
  ${c.green("today")}              Matches today  ${c.dim("(--tomorrow, --yesterday, --offset N)")}
  ${c.green("next")}   ${c.dim("[--team X]")} Next upcoming match + countdown
  ${c.green("live")}               Auto-refreshing live scoreboard
  ${c.green("fixtures")} ${c.dim("[--team X]")} All fixtures, or one team's schedule
  ${c.green("schedule")}           Whole tournament by day ${c.dim("(--mine)")}
  ${c.green("results")}            Finished games, newest first ${c.dim("(--mine)")}
  ${c.green("table")}  ${c.dim("[A-L]")}      Group standings ${c.dim("(optionally one group)")}
  ${c.green("bracket")}            Knockout bracket (Round of 32 → Final)
  ${c.green("scorers")}            Golden Boot race
  ${c.green("stats")}  ${c.dim("<team> [team]")} Match statistics ${c.dim("(--json)")}
  ${c.green("fav")}    ${c.dim("[add|rm|list]")} Manage favorite teams
  ${c.green("me")}                 Dashboard for your favorite teams
  ${c.green("setup")}  ${c.dim("[key]")}      Add your free football-data.org API key

${b("FILTER")}
  ${c.dim("--mine")} on today/next/fixtures limits results to your favorite teams.

${b("DATA")}
  Live data: football-data.org (free key, World Cup included).
  Without a key, fixtures fall back to the offline openfootball schedule.
  Set FOOTBALL_DATA_API_KEY or run ${b("sportsball fifa setup")}.

${b("EXAMPLES")}
  sportsball fifa today
  sportsball fifa next --team USA
  sportsball fifa table B
  sportsball fifa fixtures --team Brazil
  sportsball fifa live
`);
}
