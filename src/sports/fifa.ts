// The `fifa` sport namespace — FIFA World Cup 2026. Owns its own subcommand
// table and help. Other sports (e.g. `nfl`, `nba`) become sibling modules
// under src/sports/ and register in src/index.ts's SPORTS map.

import { c } from "../ansi.ts";
import { today } from "../commands/today.ts";
import { fixtures } from "../commands/fixtures.ts";
import { schedule } from "../commands/schedule.ts";
import { results } from "../commands/results.ts";
import { stats } from "../commands/stats.ts";
import { analyze } from "../commands/analyze.ts";
import { predict } from "../commands/predict.ts";
import { ask, serve } from "../commands/ask.ts";
import { watch } from "../commands/watch.ts";
import { highlights } from "../commands/highlights.ts";
import { teams } from "../commands/teams.ts";
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
  teams,
  table,
  bracket: () => bracket(),
  next,
  scorers: () => scorers(),
  stats,
  analyze,
  predict,
  ask,
  serve,
  watch,
  highlights,
  live,
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
  ${c.green("live")} ${c.dim("[--notify [--quiet]]")} Live scoreboard ${c.dim("(--notify: OS alerts for fav events; --quiet: headless backgroundable alerter)")}
  ${c.green("watch")}  ${c.dim("[team]")}      Open the broadcast ${c.dim("(--wait, --overlay, --provider, --url)")}
         ${c.dim("--wait blocks until the game is live then opens it; no team = the next game")}
  ${c.green("highlights")} ${c.dim("<team>")}   Open a highlights search in your browser
  ${c.green("fixtures")} ${c.dim("[--team X]")} All fixtures, or one team's schedule
  ${c.green("schedule")}           Whole tournament by day ${c.dim("(--mine)")}
  ${c.green("results")}            Finished games, newest first ${c.dim("(--mine)")}
  ${c.green("table")}  ${c.dim("[A-L]")}      Group standings ${c.dim("(optionally one group)")}
  ${c.green("bracket")}            Knockout bracket (Round of 32 → Final)
  ${c.green("teams")}  ${c.dim("[--group X]")} Teams in the tournament ${c.dim("(--json)")}
  ${c.green("scorers")}            Golden Boot race
  ${c.green("stats")}  ${c.dim("<team> [team]")} Match statistics ${c.dim("(--json)")}
  ${c.green("analyze")} ${c.dim("<team> [team]")} AI tactical read of a match ${c.dim("(--prompt)")}
  ${c.green("predict")} ${c.dim("<team> [team]")} AI prediction of an upcoming match ${c.dim("(--prompt)")}
  ${c.green("serve")}              Serve the AI bus from a Claude agent ${c.dim("(use: /loop sportsball serve)")}
  ${c.green("ask")}    ${c.dim("--next|--reply")} Low-level AI-bus plumbing ${c.dim("(serve wraps this)")}
  ${c.green("fav")}    ${c.dim("[add|rm|list]")} Manage favorite teams
  ${c.green("me")}                 Dashboard for your favorite teams
  ${c.green("setup")}  ${c.dim("[key]")}      Add your free football-data.org API key

${b("FILTER")}
  ${c.dim("--mine")} on today/next/fixtures limits results to your favorite teams.

${b("DATA")}
  Live data: football-data.org (free key, World Cup included).
  Without a key, fixtures fall back to the offline openfootball schedule.
  Set FOOTBALL_DATA_API_KEY or run ${b("sportsball fifa setup")}.

${b("AI (analyze / predict / overlay “Ask Claude”)")}
  sportsball never spawns a local Claude — an external Claude agent answers.
  Opening a game is NOT enough for "Ask Claude"; it needs a serve loop too.
  ${b("To watch a game AND use Ask Claude, run both:")}
    ${c.dim("sportsball fifa watch --wait")}   ${c.dim("# (backgrounded) opens the game when live")}
    ${c.dim("/loop sportsball serve")}          ${c.dim("# answers Ask questions + analyze/predict")}
  Without the serve loop, the Ask panel shows “No agent”. The serve loop just
  waits for prompts; each tick prints a question for you to answer + reply.

${b("EXAMPLES")}
  sportsball fifa today
  sportsball fifa next --team USA
  sportsball fifa table B
  sportsball fifa fixtures --team Brazil
  sportsball fifa live
  sportsball fifa watch --wait              ${c.dim("# wait for the next match, open it live (with stats)")}
  sportsball fifa watch USA --wait          ${c.dim("# wait for USA's game, open it the moment it's live")}
`);
}
