import { c } from "../ansi.ts";
import { findEvent } from "../espn.ts";
import { openInBrowser } from "../stream.ts";

// `sportsing fifa highlights <team> [team]` — open a YouTube highlights search
// for the team's most recent played match in the default browser. (No clean
// highlights API exists; a search lands on the official FIFA/broadcaster reels.)
export async function highlights(args: string[]) {
  const terms = args.filter((a) => !a.startsWith("--"));
  if (terms.length === 0) {
    console.error(c.red("Usage: sportsing fifa highlights <team> [team]"));
    process.exitCode = 1;
    return;
  }

  const ev = await findEvent(terms, { playedOnly: true });
  if (!ev) {
    console.error(c.yellow(`No played match found for "${terms.join(" ")}". Highlights need a finished match.`));
    process.exitCode = 1;
    return;
  }

  const home = ev.competitors.find((t) => t.homeAway === "home");
  const away = ev.competitors.find((t) => t.homeAway === "away");
  const matchup = home && away ? `${home.name} vs ${away.name}` : ev.name;
  const query = `${matchup} highlights World Cup 2026`;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  console.log(c.bold(c.cyan(`⚽ Highlights — ${matchup}`)));
  console.log(c.dim(`Opening a YouTube search in your browser…`));
  openInBrowser(url);
}
