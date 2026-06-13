import { c } from "../ansi.ts";
import { NoKeyError, getOpenFootballMatches } from "../api.ts";
import type { Match } from "../types.ts";

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
            "Run `sportsball setup` for live data.",
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
