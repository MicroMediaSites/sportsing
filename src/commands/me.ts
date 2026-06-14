import { c } from "../ansi.ts";
import { getMatches, getStandings, NoKeyError } from "../api.ts";
import { getFavorites } from "../config.ts";
import { withFallback, sortByDate, matchHasTeam, noFavoritesHint } from "./_lib.ts";
import { matchLine, relativeTime } from "../format.ts";
import type { Match, StandingsTable } from "../types.ts";

// `sportsing fifa me` — a personalized dashboard for your favorite teams:
// last result, next match + countdown, and current group position.
export async function me(_args: string[]): Promise<void> {
  const favorites = await getFavorites();
  if (favorites.length === 0) return noFavoritesHint();

  const matches = await withFallback(
    async () => (await getMatches({})).matches,
    (all) => all,
  );

  // Standings are key-only (no keyless fallback). Skip group position gracefully
  // when there's no API key rather than failing the whole dashboard.
  let standings: StandingsTable[] | null = null;
  try {
    standings = (await getStandings()).standings;
  } catch (e) {
    if (!(e instanceof NoKeyError)) throw e;
  }

  console.log(c.bold(c.cyan("★ My teams")));
  const now = Date.now();

  for (const team of favorites) {
    const needle = team.toLowerCase();
    const games = matches.filter((m) => matchHasTeam(m, needle)).sort(sortByDate);
    const last = [...games].reverse().find((m) => m.status === "FINISHED");
    const upcoming = games.find((m) => new Date(m.utcDate).getTime() >= now && m.status !== "FINISHED");

    console.log("\n" + c.bold(team));
    if (last) console.log("  " + c.dim("last ") + matchLine(last) + c.dim("  FT"));
    if (upcoming)
      console.log("  " + c.dim("next ") + matchLine(upcoming) + c.green("  " + relativeTime(upcoming.utcDate)));
    if (!last && !upcoming) console.log(c.dim("  no matches found for this name"));

    const pos = standings ? groupPosition(standings, needle) : null;
    if (pos) console.log("  " + c.dim(pos));
  }
}

/** Find a team's standing as "Group B · 2nd · 4 pts", or null if not found. */
function groupPosition(standings: StandingsTable[], needle: string): string | null {
  for (const t of standings) {
    if (t.type !== "TOTAL") continue;
    const row = t.table.find((r) => r.team.name?.toLowerCase().includes(needle));
    if (row) {
      const group = t.group ? t.group.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()) : "Group";
      return `${group} · ${ordinal(row.position)} · ${row.points} pts`;
    }
  }
  return null;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
