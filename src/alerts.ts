// Ambient favorite-team alerts, sport-neutral. Each sport turns successive
// score polls into `Alert`s (FIFA: events.ts; NBA/NHL: league-alerts.ts); an
// `Alerter` wraps that with its own fetch so bare `sportsing live --notify`
// can poll every sport with a favorite from one process.

import { notify, type NotifyOptions } from "./notify.ts";

/** How often `live` refreshes and alerters poll. */
export const LIVE_REFRESH_MS = 60_000;

/** One OS notification to raise. */
export interface Alert {
  title: string;
  body: string;
  options: NotifyOptions;
}

/** One sport's favorite-team alerter. */
export interface Alerter {
  /** Sport label, e.g. "NBA". */
  label: string;
  /** The favorite teams it alerts for, for the startup line. */
  teams: string[];
  /** Fetch the latest scores and return the new alerts since the previous
   *  poll. The first poll only sets the baseline (a game already under way
   *  when you start raises no start alert). */
  poll: () => Promise<Alert[]>;
}

/** Raise an alert as a desktop notification. */
export function raise(a: Alert): void {
  notify(a.title, a.body, a.options);
}

/**
 * Poll every alerter once, concurrently. A sport whose poll fails is handed to
 * `onError` and contributes nothing this round; the others' alerts still come
 * back, in alerter order.
 */
export async function pollAlerters(alerters: Alerter[], onError: (a: Alerter, e: unknown) => void): Promise<Alert[]> {
  const settled = await Promise.allSettled(alerters.map((a) => a.poll()));
  return settled.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    onError(alerters[i]!, r.reason);
    return [];
  });
}
