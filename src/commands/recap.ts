import { c } from "../ansi.ts";
import { findCurrentMatch, getLiveMatch } from "../espn.ts";
import { isServing } from "../ask-bus.ts";
import { buildRecapPrompt, hasNotableEvents, requestRecap, type RecapInput } from "../recap.ts";

// `sportsing fifa recap <team> [team] [--prompt]` — a "here's what you missed"
// narrative for a match you're joining mid-stream. Like analyze/predict, the
// narrative is written by an EXTERNAL Claude agent over the ask bus (no local
// model is ever spawned); sportsing only fences the key events + score and
// relays. --prompt prints the assembled prompt instead of posting it.
export async function recap(args: string[]): Promise<void> {
  const promptOnly = args.includes("--prompt");
  const terms = args.filter((a) => !a.startsWith("--"));
  if (terms.length === 0) {
    console.error(c.red("Usage: sportsing fifa recap <team> [team] [--prompt]"));
    process.exitCode = 1;
    return;
  }

  const ev = await findCurrentMatch(terms);
  if (!ev) {
    console.log(c.dim(`No match found for "${terms.join(" ")}".`));
    return;
  }

  const live = await getLiveMatch(ev.id);
  if (!live) {
    console.log(c.dim(`No live data for ${ev.name} yet — nothing to recap.`));
    return;
  }

  const input: RecapInput = {
    fixture: ev.name,
    scoreline: `${live.homeAbbr} ${live.homeScore}–${live.awayScore} ${live.awayAbbr}`,
    detail: live.detail,
    // getLiveMatch emits events newest-first; reverse to chronological so the
    // recap reads kickoff → latest.
    events: (live.events ?? []).slice().reverse(),
  };

  if (promptOnly) {
    console.log(buildRecapPrompt(input));
    return;
  }

  // Only worth the "waiting…" note when we'll actually post (events to recap +
  // an agent listening); requestRecap re-checks both and handles the rest.
  if (hasNotableEvents(input.events) && (await isServing())) {
    process.stderr.write(c.dim("Posted to the ask bus — waiting for your Claude agent to answer…\n"));
  }

  const res = await requestRecap(input);
  if (res.ok) {
    console.log(c.bold(c.cyan(`⚽ ${ev.name} — catch up`)) + "  " + c.dim(input.scoreline + " · " + live.detail) + "\n");
    console.log(res.recap);
    return;
  }
  if (res.reason === "empty") {
    console.log(c.dim(res.message)); // not an error — just nothing notable yet
    return;
  }
  // no-agent / timeout — mirror analyze's fast-fail affordance.
  console.error(c.yellow(res.message));
  console.error(c.dim("Or run with --prompt to get the prompt and recap elsewhere."));
  process.exitCode = 1;
}
