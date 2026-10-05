import { c } from "../ansi.ts";
import { NoKeyError, getOpenFootballMatches } from "../api.ts";
import { getFavorites } from "../config.ts";
import { matchHasTeam } from "../match-util.ts";
import type { Match } from "../types.ts";

// Re-exported so existing `from "./_lib.ts"` importers (next/fixtures/me) keep
// working; the canonical definition now lives in src/match-util.ts so pure
// modules (events.ts) can share it without depending on the command layer.
export { matchHasTeam };

export function ymd(d = new Date()): string {
  // Local calendar date (not UTC) so "today" matches the user's wall clock.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local calendar date (YYYY-MM-DD) for a match's UTC timestamp. */
export function localDateOf(utcDate: string): string {
  return ymd(new Date(utcDate));
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Run a fetch that needs an API key; on NoKeyError, fall back to the keyless
 * openfootball schedule via `fallback`, with a one-line notice.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: (matches: Match[]) => T,
): Promise<T> {
  try {
    return await primary();
  } catch (e) {
    if (e instanceof NoKeyError) {
      console.error(
        c.yellow(
          "No API key set — showing the offline schedule (no live scores/tables).\n" +
            "Run `sportsing setup` for live data.",
        ) + "\n",
      );
      const matches = await getOpenFootballMatches();
      return fallback(matches);
    }
    throw e;
  }
}

export function sortByDate(a: Match, b: Match): number {
  return new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime();
}

/** Value of a `--flag value` pair, or null if the flag is absent.
 *  Throws if the flag is present but has no value (e.g. `--team` at end). */
export function getFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const val = args[i + 1];
  if (!val || val.startsWith("--")) {
    throw new Error(`Flag ${flag} requires a value.`);
  }
  return val;
}

/**
 * The favorites `--mine` should filter by for `sport`: null when `--mine` is
 * absent, the literal `"no-favorites"` when it was asked for but that sport has
 * none set (so the caller can show a hint), else that sport's favorite names.
 */
export async function mineFavorites(args: string[], sport: string): Promise<string[] | null | "no-favorites"> {
  if (!args.includes("--mine")) return null;
  const favs = await getFavorites(sport);
  return favs.length === 0 ? "no-favorites" : favs;
}

/**
 * If `--mine` is present in args, narrow football-data `matches` (the FIFA
 * shape) to games involving a FIFA favorite. Returns `"no-favorites"` when
 * `--mine` was asked for but none are set. Without `--mine`, returns the list
 * unchanged. ESPN-league commands filter `Game`s by team id instead (league.ts).
 */
export async function applyMine(matches: Match[], args: string[]): Promise<Match[] | "no-favorites"> {
  const favs = await mineFavorites(args, "fifa");
  if (favs === null) return matches;
  if (favs === "no-favorites") return favs;
  const needles = favs.map((f) => f.toLowerCase());
  return matches.filter((m) => needles.some((n) => matchHasTeam(m, n)));
}

/** Example team for "add a favorite" hints, per sport. */
export const EXAMPLE_TEAM: Record<string, string> = { fifa: "USA", nba: "UTAH", nhl: "UTAH" };

/** Shared message for `--mine` with no favorites configured for `sport`. */
export function noFavoritesHint(sport = "fifa"): void {
  const example = EXAMPLE_TEAM[sport] ?? "<team>";
  console.log(c.dim("No favorite teams yet — add one with ") + c.bold(`sportsing ${sport} fav add ${example}`));
}
