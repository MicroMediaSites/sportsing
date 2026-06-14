import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, fmtDayHeader, stageLabel } from "../format.ts";
import { withFallback, localDateOf, applyMine, noFavoritesHint } from "./_lib.ts";
import type { Match } from "../types.ts";

// `sportsing fifa results [--mine]` — finished games, newest first, grouped by
// local day. (Scores need an API key; the keyless schedule has no results.)
export async function results(args: string[]) {
  const fetched = await withFallback(
    async () => (await getMatches({ status: "FINISHED" })).matches,
    (all) => all.filter((m) => m.status === "FINISHED"),
  );

  const mine = await applyMine(fetched, args);
  if (mine === "no-favorites") return noFavoritesHint();

  const matches = mine
    .filter((m) => m.status === "FINISHED")
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());

  console.log(c.bold(c.cyan(`⚽ World Cup 2026 — Results (${matches.length})`)));
  if (matches.length === 0) {
    console.log(c.dim("\nNo finished matches yet.") + c.dim(" (Live scores need an API key — run `sportsing fifa setup`.)"));
    return;
  }

  let currentDay = "";
  for (const m of matches) {
    const day = localDateOf(m.utcDate);
    if (day !== currentDay) {
      currentDay = day;
      console.log("\n" + c.bold(fmtDayHeader(m.utcDate)));
    }
    console.log(`  ${matchLine(m)}  ${c.dim(stageLabel(m))}`);
  }
}
