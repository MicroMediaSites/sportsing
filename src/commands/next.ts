import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, fmtDate, relativeTime, stageLabel } from "../format.ts";
import { withFallback, sortByDate, matchHasTeam, applyMine, noFavoritesHint, getFlag } from "./_lib.ts";

export async function next(args: string[]) {
  const team = getFlag(args, "--team")?.toLowerCase() ?? null;

  const fetched = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  const mine = await applyMine(fetched, args);
  if (mine === "no-favorites") return noFavoritesHint();

  const now = Date.now();
  let upcoming = mine
    .filter((m) => new Date(m.utcDate).getTime() >= now && m.status !== "FINISHED")
    .sort(sortByDate);

  if (team) {
    upcoming = upcoming.filter((m) => matchHasTeam(m, team));
  }

  const m = upcoming[0];
  if (!m) {
    const scope = team ? `"${team}"` : args.includes("--mine") ? "your favorites" : null;
    console.log(c.dim(scope ? `No upcoming matches for ${scope}.` : "No upcoming matches."));
    return;
  }

  const stage = stageLabel(m);

  console.log(c.bold(c.cyan("⚽ Next Match")));
  console.log("\n  " + matchLine(m));
  console.log(c.dim(`  ${stage}`));
  console.log(`  ${c.bold(fmtDate(m.utcDate))}  ${c.green("— kicks off " + relativeTime(m.utcDate))}`);
  if (m.venue) console.log(c.dim(`  📍 ${m.venue}`));
}
