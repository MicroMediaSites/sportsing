import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, fmtTimeOnly, fmtDayHeader, groupName, STAGE_LABELS } from "../format.ts";
import { withFallback, sortByDate, localDateOf, applyMine, noFavoritesHint } from "./_lib.ts";

// `sportsball fifa schedule [--mine]` — the whole tournament in kickoff order,
// grouped by local calendar day, times in local time. (`fixtures` groups by
// stage; this groups by day.)
export async function schedule(args: string[]) {
  const fetched = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  const mine = await applyMine(fetched, args);
  if (mine === "no-favorites") return noFavoritesHint();
  const matches = mine.sort(sortByDate);

  console.log(c.bold(c.cyan(`⚽ World Cup 2026 — Schedule (${matches.length})`)));
  if (matches.length === 0) {
    console.log(c.dim("\nNo matches to show."));
    return;
  }

  let currentDay = "";
  for (const m of matches) {
    const day = localDateOf(m.utcDate);
    if (day !== currentDay) {
      currentDay = day;
      console.log("\n" + c.bold(fmtDayHeader(m.utcDate)));
    }
    const stage = m.stage === "GROUP_STAGE" ? groupName(m.group) : STAGE_LABELS[m.stage];
    console.log(`  ${c.cyan(fmtTimeOnly(m.utcDate).padEnd(8))} ${matchLine(m)}  ${c.dim(stage)}`);
  }
}
