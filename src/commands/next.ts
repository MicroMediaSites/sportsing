import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, fmtDate, relativeTime, groupName, STAGE_LABELS } from "../format.ts";
import { withFallback, sortByDate } from "./_lib.ts";
import { getFlag } from "./fixtures.ts";
import type { Match } from "../types.ts";

export async function next(args: string[]) {
  const team = getFlag(args, "--team")?.toLowerCase() ?? null;

  let matches = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  const now = Date.now();
  let upcoming = matches
    .filter((m) => new Date(m.utcDate).getTime() >= now && m.status !== "FINISHED")
    .sort(sortByDate);

  if (team) {
    upcoming = upcoming.filter(
      (m) =>
        m.homeTeam.name?.toLowerCase().includes(team) ||
        m.awayTeam.name?.toLowerCase().includes(team) ||
        m.homeTeam.tla?.toLowerCase().includes(team) ||
        m.awayTeam.tla?.toLowerCase().includes(team),
    );
  }

  const m = upcoming[0];
  if (!m) {
    console.log(c.dim(team ? `No upcoming matches for "${team}".` : "No upcoming matches."));
    return;
  }

  const stage =
    m.stage === "GROUP_STAGE" ? groupName(m.group) : STAGE_LABELS[m.stage];

  console.log(c.bold(c.cyan("⚽ Next Match")));
  console.log("\n  " + matchLine(m));
  console.log(c.dim(`  ${stage}`));
  console.log(`  ${c.bold(fmtDate(m.utcDate))}  ${c.green("— kicks off " + relativeTime(m.utcDate))}`);
  if (m.venue) console.log(c.dim(`  📍 ${m.venue}`));
}
