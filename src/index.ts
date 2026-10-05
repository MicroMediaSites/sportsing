#!/usr/bin/env bun
import { c } from "./ansi.ts";
import { ApiError } from "./api.ts";
import { fifa } from "./sports/fifa.ts";
import { nba } from "./sports/nba.ts";
import { nhl } from "./sports/nhl.ts";
import { subscriptions } from "./commands/subscriptions.ts";

const VERSION = "0.1.0";

// Sport namespaces. Add a new sport by writing src/sports/<sport>.ts with a
// dispatcher `(args: string[]) => unknown` and registering it here.
const SPORTS: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  fifa,
  nba,
  nhl,
};

function help() {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsing"))} — sports in your terminal  ${c.dim("v" + VERSION)}

${b("USAGE")}
  sportsing <sport> <command> [options]

${b("SPORTS")}
  ${c.green("fifa")}               FIFA World Cup 2026 ${c.dim("— sportsing fifa help")}
  ${c.green("nba")}                NBA, preseason through playoffs ${c.dim("— sportsing nba help")}
  ${c.green("nhl")}                NHL, preseason through playoffs ${c.dim("— sportsing nhl help")}

${b("SETTINGS")}
  ${c.green("subscriptions")}      What you can watch with + home market ${c.dim("— alias: subs")}

${b("NOTE")}
  During the World Cup, the ${b("fifa")} prefix is optional —
  ${c.dim("sportsing today")} is shorthand for ${c.dim("sportsing fifa today")}.

${b("EXAMPLES")}
  sportsing fifa today
  sportsing fifa next --team USA
  sportsing nba schedule --team UTAH
  sportsing nhl next --team UTAH
  sportsing today              ${c.dim("(= sportsing fifa today)")}
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

  // Back-compat: while FIFA is the only sport, a bare `sportsing <command>`
  // runs as a FIFA command (`sportsing today` == `sportsing fifa today`).
  // An unknown token surfaces as "Unknown fifa command". Delete this line when
  // a second sport lands so bare commands require an explicit sport prefix.
  await fifa([first, ...rest]);
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
