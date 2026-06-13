#!/usr/bin/env bun
import { c } from "./ansi.ts";
import { ApiError } from "./api.ts";
import { fifa } from "./sports/fifa.ts";

const VERSION = "0.1.0";

// Sport namespaces. Add a new sport by writing src/sports/<sport>.ts with a
// dispatcher `(args: string[]) => unknown` and registering it here.
const SPORTS: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  fifa,
};

function help() {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsball"))} — sports in your terminal  ${c.dim("v" + VERSION)}

${b("USAGE")}
  sportsball <sport> <command> [options]

${b("SPORTS")}
  ${c.green("fifa")}               FIFA World Cup 2026 ${c.dim("— sportsball fifa help")}

${b("NOTE")}
  During the World Cup, the ${b("fifa")} prefix is optional —
  ${c.dim("sportsball today")} is shorthand for ${c.dim("sportsball fifa today")}.

${b("EXAMPLES")}
  sportsball fifa today
  sportsball fifa next --team USA
  sportsball today              ${c.dim("(= sportsball fifa today)")}
`);
}

async function dispatch(): Promise<void> {
  const [, , first, ...rest] = process.argv;

  if (!first || first === "help" || first === "--help" || first === "-h") return help();
  if (first === "--version" || first === "-v") {
    console.log("sportsball " + VERSION);
    return;
  }

  // Explicit sport namespace: `sportsball fifa <command>`.
  const sport = SPORTS[first];
  if (sport) {
    await sport(rest);
    return;
  }

  // Back-compat: while FIFA is the only sport, a bare `sportsball <command>`
  // runs as a FIFA command (`sportsball today` == `sportsball fifa today`).
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
