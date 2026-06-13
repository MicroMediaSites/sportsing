import { c } from "../ansi.ts";
import { getMatches } from "../api.ts";
import { matchLine, fmtDate, stageLabel, heading } from "../format.ts";
import { withFallback, sortByDate, matchHasTeam, applyMine, noFavoritesHint } from "./_lib.ts";
import type { Match } from "../types.ts";

export async function fixtures(args: string[]) {
  const team = getFlag(args, "--team");

  const fetched = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  const mine = await applyMine(fetched, args);
  if (mine === "no-favorites") return noFavoritesHint();
  let matches = mine.sort(sortByDate);

  if (team) {
    const needle = team.toLowerCase();
    matches = matches.filter((m) => matchHasTeam(m, needle));
    if (matches.length === 0) {
      console.log(c.yellow(`No fixtures found for "${team}".`));
      return;
    }
    console.log(c.bold(c.cyan(`⚽ Fixtures — ${teamHeading(matches, needle)}`)));
    for (const m of matches) {
      console.log(`  ${c.dim(fmtDate(m.utcDate).padEnd(20))} ${matchLine(m)}  ${c.dim(stageLabel(m))}`);
    }
    return;
  }

  console.log(c.bold(c.cyan(`⚽ World Cup 2026 — All Fixtures (${matches.length})`)));
  const byStage = new Map<string, Match[]>();
  for (const m of matches) {
    const key = stageLabel(m);
    (byStage.get(key) ?? byStage.set(key, []).get(key)!).push(m);
  }
  for (const [name, ms] of byStage) {
    console.log(heading(name));
    for (const m of ms) console.log(`  ${c.dim(fmtDate(m.utcDate).padEnd(20))} ${matchLine(m)}`);
  }
}

function teamHeading(matches: Match[], needle: string): string {
  for (const m of matches) {
    if (m.homeTeam.name?.toLowerCase().includes(needle)) return m.homeTeam.name!;
    if (m.awayTeam.name?.toLowerCase().includes(needle)) return m.awayTeam.name!;
  }
  return needle;
}

export function getFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const val = args[i + 1];
  if (!val || val.startsWith("--")) {
    throw new Error(`Flag ${flag} requires a value.`);
  }
  return val;
}
