import { c } from "../ansi.ts";
import { findEvent, getMatchStats, type EspnEvent, type EspnTeamStats } from "../espn.ts";
import { runClaude, ClaudeNotFoundError } from "../agent.ts";

// `sportsball fifa analyze <team> [team] [--prompt]` — fetch a match's stats and
// have a local Claude agent write a tactical read. --prompt prints the assembled
// prompt instead of calling Claude (transparent + testable; also lets you pipe
// it elsewhere).
export async function analyze(args: string[]) {
  const promptOnly = args.includes("--prompt");
  const terms = args.filter((a) => !a.startsWith("--"));
  if (terms.length === 0) {
    console.error(c.red("Usage: sportsball fifa analyze <team> [team] [--prompt]"));
    process.exitCode = 1;
    return;
  }

  const ev = await findEvent(terms, { playedOnly: true });
  if (!ev) {
    console.log(c.dim(`No played match found for "${terms.join(" ")}". Analysis needs a match that has kicked off.`));
    return;
  }

  const teams = await getMatchStats(ev.id);
  if (teams.length < 2) {
    console.log(c.dim("No statistics available for this match yet — nothing to analyze."));
    return;
  }

  const prompt = buildPrompt(ev, teams);
  if (promptOnly) {
    console.log(prompt);
    return;
  }

  if (!Bun.which("claude")) {
    console.error(c.yellow("Local analysis needs the `claude` CLI (Claude Code) on your PATH."));
    console.error(c.dim("Install it, or run with --prompt to get the prompt and analyze elsewhere."));
    process.exitCode = 1;
    return;
  }

  process.stderr.write(c.dim("Analyzing with local Claude…\n"));
  try {
    const analysis = await runClaude(prompt);
    console.log(c.bold(c.cyan(`⚽ ${ev.name} — analysis`)) + "  " + c.dim(ev.detail) + "\n");
    console.log(analysis);
  } catch (e) {
    if (e instanceof ClaudeNotFoundError) {
      console.error(c.yellow("`claude` CLI not found. Run with --prompt to analyze elsewhere."));
    } else {
      console.error(c.red("Analysis failed: " + (e instanceof Error ? e.message : String(e))));
    }
    process.exitCode = 1;
  }
}

function buildPrompt(ev: EspnEvent, teams: EspnTeamStats[]): string {
  const home = ev.competitors.find((t) => t.homeAway === "home");
  const away = ev.competitors.find((t) => t.homeAway === "away");
  const score = home && away ? `${home.name} ${home.score}–${away.score} ${away.name}` : ev.name;
  return [
    "You are a concise football (soccer) analyst. Analyze this FIFA World Cup 2026 match",
    "using only the statistics provided. Do not invent events you can't see in the data.",
    "",
    `Match: ${score} (${ev.detail})`,
    "",
    "Per-team statistics (JSON):",
    JSON.stringify(teams, null, 2),
    "",
    "Write a 4–6 sentence tactical read: who controlled the match and why, the most",
    "telling stat differentials, and the story the numbers tell. Plain prose, no preamble.",
  ].join("\n");
}
