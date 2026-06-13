#!/usr/bin/env bun
import { c } from "./ansi.ts";
import { ApiError } from "./api.ts";
import { fifa, FIFA_COMMANDS } from "./sports/fifa.ts";

const VERSION = "0.1.0";

// Sport namespaces. Add a new sport by writing src/sports/<sport>.ts with a
// dispatcher `(args: string[]) => unknown` and registering it here.
const SPORTS: Record<string, (args: string[]) => unknown | Promise<unknown>> = {
  fifa,
};

// While FIFA is the only sport, a bare `sportsball <command>` is treated as a
// `fifa` command so existing usage keeps working. Remove the fallback (or make
// it configurable) once a second sport lands.
const DEFAULT_SPORT = "fifa";

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
  if (first === "--version" || first === "-v") return void console.log("sportsball " + VERSION);

  // Explicit sport namespace: `sportsball fifa <command>`.
  const sport = SPORTS[first];
  if (sport) return void (await sport(rest));

  // Back-compat: `sportsball <fifa-command>` → run it under the default sport.
  if (FIFA_COMMANDS.has(first)) return void (await SPORTS[DEFAULT_SPORT]!([first, ...rest]));

  console.error(c.red(`Unknown command: ${first}`));
  console.error(c.dim("Run `sportsball help` for sports, or `sportsball fifa help` for World Cup commands."));
  process.exitCode = 1;
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
