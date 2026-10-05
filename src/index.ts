#!/usr/bin/env bun
import { c } from "./ansi.ts";
import { ApiError } from "./api.ts";
import { SPORTS as REGISTRY, bare } from "./commands/cross.ts";
import { subscriptions } from "./commands/subscriptions.ts";
import pkg from "../package.json" with { type: "json" };

// Single source of truth: package.json (a hardcoded copy drifted to a stale
// 0.1.0 while the package shipped 0.1.2). The JSON import is inlined by
// `bun build --compile`, and npm always ships package.json.
const VERSION: string = pkg.version;

// Sport namespaces. Add a new sport by writing src/sports/<sport>.ts and
// registering it in SPORTS in src/commands/cross.ts (which also makes the bare
// cross-sport commands include it).
const SPORTS = Object.fromEntries(REGISTRY.map((s) => [s.key, s.run]));

function help() {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsing"))} — sports in your terminal  ${c.dim("v" + VERSION)}

${b("USAGE")}
  sportsing <sport> <command> [options]
  sportsing <today|next|me>          ${c.dim("your favorite teams, every sport")}
  sportsing live --notify [--quiet]  ${c.dim("alerts for your teams, every sport")}

${b("SPORTS")}
  ${c.green("fifa")}               FIFA World Cup 2026 ${c.dim("— sportsing fifa help")}
  ${c.green("nba")}                NBA, preseason through playoffs ${c.dim("— sportsing nba help")}
  ${c.green("nhl")}                NHL, preseason through playoffs ${c.dim("— sportsing nhl help")}

${b("YOUR TEAMS")} ${c.dim("(favorites across every sport, each row tagged with its sport)")}
  ${c.green("today")}              Your teams' games today ${c.dim("(--tomorrow, --yesterday, --offset N)")}
  ${c.green("next")}               Each team's next game + countdown
  ${c.green("me")}                 Dashboard: last result + next game per team
  ${c.green("live --notify")}      OS alerts for every sport with a favorite ${c.dim("(--quiet: no log; run with &)")}
  ${c.dim("Add favorites per sport: sportsing nba fav add UTAH")}

${b("SETTINGS")}
  ${c.green("subscriptions")}      What you can watch with + home market ${c.dim("— alias: subs")}

${b("EXAMPLES")}
  sportsing fifa today
  sportsing fifa next --team USA
  sportsing nba schedule --team UTAH
  sportsing nhl next --team UTAH
  sportsing today              ${c.dim("(your teams, every sport)")}
`);
}

async function dispatch(): Promise<void> {
  const [, , first, ...rest] = process.argv;

  if (!first || first === "help" || first === "--help" || first === "-h") return help();
  if (first === "--version" || first === "-v") {
    console.log("sportsing " + VERSION);
    return;
  }

  // Explicit sport namespace: `sportsing fifa <command>`.
  const sport = SPORTS[first];
  if (sport) {
    await sport(rest);
    return;
  }

  // Cross-sport settings (not tied to any one sport's namespace).
  if (first === "subscriptions" || first === "subs") {
    await subscriptions(rest);
    return;
  }

  // Bare `today`/`next`/`me`/`live` run across every sport; anything else gets a hint.
  await bare(first, rest);
}

async function main() {
  try {
    await dispatch();
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
