import { c, pad } from "../ansi.ts";
import { getScorers, NoKeyError } from "../api.ts";
import { teamLabel } from "../format.ts";

export async function scorers() {
  let list;
  try {
    list = (await getScorers()).scorers;
  } catch (e) {
    if (e instanceof NoKeyError) {
      console.error(c.yellow("Top scorers need live data. Run `sportsball setup` to add a free API key."));
      return;
    }
    throw e;
  }

  console.log(c.bold(c.cyan("⚽ World Cup 2026 — Top Scorers")));
  if (!list || list.length === 0) {
    console.log(c.dim("\nNo goals yet — the Golden Boot race starts at kickoff."));
    return;
  }

  console.log(
    c.dim("\n" + pad("#", 3) + pad("Player", 24) + pad("Team", 8) + pad("G", 4, "right") + pad("A", 4, "right")),
  );
  list.forEach((s, i) => {
    console.log(
      pad(c.dim(String(i + 1)), 3) +
        pad(c.bold(s.player.name), 24) +
        pad(teamLabel(s.team), 8) +
        pad(c.green(String(s.goals ?? 0)), 4, "right") +
        pad(c.dim(String(s.assists ?? 0)), 4, "right"),
    );
  });
}
