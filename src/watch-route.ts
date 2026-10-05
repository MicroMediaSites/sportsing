// Where-to-watch for the ESPN-backed leagues, on top of the pure resolver in
// watchability.ts: the WATCH column in today/next/schedule, and the decision
// `<sport> watch` acts on (open a provider, name an over-the-air channel, or
// explain why there's nothing to open).
//
// Pure: no IO, no config reads. Callers load subscriptions + home market from
// config.ts and pass them in as a WatchContext.

import { c, pad, visibleLen } from "./ansi.ts";
import type { Game } from "./game.ts";
import { resolveWatch, type Subscription, type Watchability, type WatchSport } from "./watchability.ts";

export function isWatchSport(sport: string): sport is WatchSport {
  return sport === "nba" || sport === "nhl";
}

/** What the resolver needs besides the game. */
export interface WatchContext {
  sport: WatchSport;
  subscriptions: readonly Subscription[];
  homeMarket: string;
}

/** Shown in place of the WATCH column when no subscriptions are configured. */
export const SUBSCRIPTIONS_HINT = "Where to watch: run `sportsing subscriptions set fubo nba-league-pass local-ota` (whichever you have).";

export function watchOf(g: Game, ctx: WatchContext): Watchability {
  return resolveWatch(g, ctx.subscriptions, ctx.homeMarket, ctx.sport);
}

/**
 * The WATCH cell for a game: the service or over-the-air channel, `✗` when it
 * can't be watched, `?` when it can't be told. Finished games get "" — there's
 * nothing left to watch live.
 */
export function watchCell(g: Game, ctx: WatchContext): string {
  if (g.state === "post") return "";
  const w = watchOf(g, ctx);
  if (w.watchable === true) return c.green(w.via ?? "?");
  return w.watchable === false ? c.red("✗") : c.dim("?");
}

/**
 * Append `cells` to `lines` as one aligned column (lines padded to the widest
 * visible width, then two spaces). Lines with an empty cell are left as-is.
 * Returns the column's start offset for a heading — null, with the lines
 * untouched, when every cell is empty (e.g. only finished games).
 */
export function withWatchColumn(lines: string[], cells: string[]): { lines: string[]; column: number | null } {
  if (!cells.some(Boolean)) return { lines, column: null };
  const column = Math.max(0, ...lines.map(visibleLen)) + 2;
  return { lines: lines.map((l, i) => (cells[i] ? pad(l, column) + cells[i] : l)), column };
}

/** `text` padded out to the WATCH column, then the column heading. */
export function watchHeading(text: string, column: number): string {
  return pad(text, column) + c.dim("WATCH");
}

/** One-line explanation for a single game, e.g. "Fubo — on KJZZ-TV",
 *  "Utah 16 — over the air", "✗ ESPN+ exclusive — no subscription". */
export function watchSummary(w: Watchability): string {
  if (w.watchable === true) return w.service === "local-ota" ? w.note : `${w.via} — ${w.note}`;
  return `${w.watchable === false ? "✗" : "?"} ${w.note}`;
}

/** Streaming-provider key (stream.ts PROVIDERS) for each openable subscription. */
export const SERVICE_PROVIDER: Record<Exclude<Subscription, "local-ota">, string> = {
  fubo: "fubo",
  "nba-league-pass": "nba-league-pass",
};

/** What `watch` does with a game. */
export type WatchPlan =
  /** Open `provider`'s hub; `note` says why that one. */
  | { kind: "open"; provider: string; note: string }
  /** Over the air only — nothing to open; tell the user the channel. */
  | { kind: "tune"; message: string }
  /** Can't be watched (or can't be told and there's no provider to try). */
  | { kind: "none"; message: string };

/**
 * Turn a resolved Watchability into the `watch` action. A game the resolver
 * can't place (`unknown` — e.g. no broadcasts listed yet) falls back to
 * `fallback` (the configured / league-default provider) when there is one:
 * opening the usual hub beats refusing on missing data.
 */
export function planWatch(w: Watchability, fallback: string | null): WatchPlan {
  const service = w.watchable === true ? w.service : null;
  if (service === "local-ota") return { kind: "tune", message: w.note };
  if (service) return { kind: "open", provider: SERVICE_PROVIDER[service], note: watchSummary(w) };
  if (w.watchable === false) return { kind: "none", message: w.note };
  if (fallback) return { kind: "open", provider: fallback, note: `can't tell where it airs (${w.note}) — trying ${fallback}` };
  return { kind: "none", message: `Can't tell where it airs — ${w.note}.` };
}
