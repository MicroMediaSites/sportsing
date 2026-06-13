import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, stageLabel, heading } from "../format.ts";
import { ymd, addDays, localDateOf, withFallback, sortByDate, applyMine, noFavoritesHint } from "./_lib.ts";
import type { Match } from "../types.ts";

export async function today(args: string[]) {
  const offset = parseOffset(args);
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const date = ymd(day);

  // A local calendar day straddles two UTC days, so query ±1 day and then
  // filter to matches whose *local* date is the one we want. The API filters
  // by UTC date, which would otherwise pull in late games from the day before.
  const fetched = await withFallback(
    async () =>
      (await getMatches({ dateFrom: ymd(addDays(day, -1)), dateTo: ymd(addDays(day, 1)) })).matches.filter(
        (m) => localDateOf(m.utcDate) === date,
      ),
    (all) => all.filter((m) => localDateOf(m.utcDate) === date),
  );

  const mine = await applyMine(fetched, args);
  if (mine === "no-favorites") return noFavoritesHint();
  const matches = mine;

  const label =
    offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : date;
  console.log(c.bold(c.cyan(`⚽ World Cup 2026 — ${label} (${date})`)));

  if (matches.length === 0) {
    console.log(c.dim("\nNo matches scheduled."));
    return;
  }
  printGrouped(matches);
}

/** Group matches by stage/group and print, sorted by kickoff. */
export function printGrouped(matches: Match[]) {
  const buckets = new Map<string, Match[]>();
  for (const m of matches) {
    const key = stageLabel(m);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m);
  }
  for (const [name, ms] of buckets) {
    console.log(heading(name));
    for (const m of ms.sort(sortByDate)) console.log("  " + matchLine(m));
  }
}

function parseOffset(args: string[]): number {
  if (args.includes("--tomorrow")) return 1;
  if (args.includes("--yesterday")) return -1;
  const i = args.indexOf("--offset");
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1]!, 10) || 0;
  return 0;
}
