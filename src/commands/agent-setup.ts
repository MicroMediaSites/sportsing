import { c } from "../ansi.ts";
import { isServing } from "../ask-bus.ts";
import { isWatchAlive, readWatchPid } from "../liveness.ts";

// `sportsball fifa agent-setup` — the discoverable front door for an agent-driven
// watch session. It does NOT spawn a model or any background process; its only
// job is to point at the `/loop agent-setup` supervisor skill, which is the one
// blessed way to set sportsball up so a Claude agent can follow a live game AND
// answer the overlay's "Ask Claude" + "Get caught up" (catchup).
//
//   agent-setup            print the setup guidance (also --help)
//   agent-setup --check    fast machine-readable status (JSON) for the loop
export async function agentSetup(args: string[] = []): Promise<void> {
  if (args.includes("--check")) return printCheck();
  printGuide();
}

/**
 * Machine-readable status for the supervisor loop (AGT-548) to branch on each
 * tick — no prose parsing. Fast: just reads the pidfile + the bus heartbeat; it
 * never spawns a model, opens a window, or blocks. Exit code is 0 only when the
 * session is fully up (watcher alive AND an answerer serving), so the loop can
 * gate on either the JSON fields or `$?`.
 */
async function printCheck(): Promise<void> {
  const status = {
    watchAlive: isWatchAlive(),
    watchPid: readWatchPid(),
    serving: await isServing(),
  };
  console.log(JSON.stringify(status));
  process.exitCode = status.watchAlive && status.serving ? 0 : 1;
}

function printGuide(): void {
  const b = c.bold;
  console.log(`${b(c.cyan("⚽ sportsball agent-setup"))} — set up an agent-driven watch session

${b("DO THIS")}  In a Claude session, drop this into the prompt:

    ${b("/loop agent-setup")}

${b("WHAT THE LOOP DOES")}
  One supervisor loop that keeps a live-game session running for you:
  • waits for your game and opens it the moment it goes live ${c.dim("(watch --wait)")}
  • keeps that stream alive, relaunching it if it dies
  • serves the AI bus so the overlay's ${c.dim('"Ask Claude"')} and ${c.dim('"Get caught up"')}
    ${c.dim("(catchup)")} are actually answered — opening a game is ${b("not")} enough on its own.

${c.yellow("Why a loop?")} sportsball never spawns a local model. The overlay relays
questions to a file bus; ${b("an external agent must be serving")} or the Ask /
catchup panels just show ${c.dim('"○ no agent"')}. The supervisor loop is that agent.

${c.dim("This command only prints these instructions — it starts nothing itself.")}
`);
}
