#!/usr/bin/env bun
import { c } from "./ansi.ts";
import { ApiError } from "./api.ts";
import { today } from "./commands/today.ts";
import { fixtures } from "./commands/fixtures.ts";
import { table } from "./commands/table.ts";
import { bracket } from "./commands/bracket.ts";
import { next } from "./commands/next.ts";
import { scorers } from "./commands/scorers.ts";
import { live } from "./commands/live.ts";
import { setup } from "./commands/setup.ts";

const VERSION = "0.1.0";

function help() {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsball"))} — FIFA World Cup 2026 in your terminal  ${c.dim("v" + VERSION)}

${b("USAGE")}
  sportsball <command> [options]

${b("COMMANDS")}
  ${c.green("today")}              Matches today  ${c.dim("(--tomorrow, --yesterday, --offset N)")}
  ${c.green("next")}   ${c.dim("[--team X]")} Next upcoming match + countdown
  ${c.green("live")}               Auto-refreshing live scoreboard
  ${c.green("fixtures")} ${c.dim("[--team X]")} All fixtures, or one team's schedule
  ${c.green("table")}  ${c.dim("[A-L]")}      Group standings ${c.dim("(optionally one group)")}
  ${c.green("bracket")}            Knockout bracket (Round of 32 → Final)
  ${c.green("scorers")}            Golden Boot race
  ${c.green("setup")}  ${c.dim("[key]")}      Add your free football-data.org API key
  ${c.green("help")}               This screen

${b("DATA")}
  Live data: football-data.org (free key, World Cup included).
  Without a key, fixtures fall back to the offline openfootball schedule.
  Set FOOTBALL_DATA_API_KEY or run ${b("sportsball setup")}.

${b("EXAMPLES")}
  sportsball today
  sportsball next --team USA
  sportsball table B
  sportsball fixtures --team Brazil
  sportsball live
`);
}

const ROUTES: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  today,
  fixtures,
  table,
  bracket: () => bracket(),
  next,
  scorers: () => scorers(),
  live: () => live(),
  setup,
};

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return help();
  if (cmd === "--version" || cmd === "-v") return console.log("sportsball " + VERSION);

  const aliases: Record<string, string> = {
    t: "today",
    n: "next",
    f: "fixtures",
    standings: "table",
    tables: "table",
    knockout: "bracket",
  };
  const route = ROUTES[cmd] ?? ROUTES[aliases[cmd] ?? ""];
  if (!route) {
    console.error(c.red(`Unknown command: ${cmd}`));
    console.error(c.dim("Run `sportsball help` for usage."));
    process.exitCode = 1;
    return;
  }

  try {
    await route(args);
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(c.red(`API error (${e.status}): ${e.message}`));
    } else {
      console.error(c.red("Error: " + (e instanceof Error ? e.message : String(e))));
    }
    process.exitCode = 1;
  }
}

main();
