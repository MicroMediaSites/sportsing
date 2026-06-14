import { c } from "../ansi.ts";

// `sportsball fifa agent-setup` — the discoverable front door for an agent-driven
// watch session. It does NOT spawn a model or any background process; its only
// job is to point at the `/loop agent-setup` supervisor skill, which is the one
// blessed way to set sportsball up so a Claude agent can follow a live game AND
// answer the overlay's "Ask Claude" + "Get caught up" (catchup). Both bare and
// `--help` print the same guidance.
export function agentSetup(_args: string[] = []): void {
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
