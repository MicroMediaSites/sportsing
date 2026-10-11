// Detect that a stream window is gone, by polling Chrome's CDP /json/list.
//
// Closing the app-mode window on macOS leaves Chrome running with 0 windows, and
// ui-leaf doesn't notice Chrome quitting, so `view.closed` never settles. We watch
// the browser ourselves: "gone" = no page targets for a debounce period (a
// navigation briefly swaps the page target, so a lone empty poll isn't closing),
// or the debug endpoint stops answering (Chrome quit). Pure reducer + a thin
// poller, so the decision logic is unit-testable.

export type Observation = { kind: "pages"; count: number } | { kind: "error" };

export interface WatchState {
  /** A page target has been seen at least once (the window actually came up). */
  seenPage: boolean;
  /** When the page count first dropped to 0 (ms), or null while pages exist. */
  emptySince: number | null;
  /** Consecutive failed polls. */
  errors: number;
}

export type GoneReason = "window-closed" | "chrome-quit";

export const WATCH_DEFAULTS = { debounceMs: 3000, maxErrors: 3 };

export const initialWatchState = (): WatchState => ({ seenPage: false, emptySince: null, errors: 0 });

/** Count page targets in a `/json/list` payload (ignores workers, extensions, devtools). */
export function countPages(targets: unknown): number {
  if (!Array.isArray(targets)) return 0;
  return targets.filter((t) => t && typeof t === "object" && (t as { type?: unknown }).type === "page").length;
}

/** Fold one poll into the state; `gone` is set once the window is judged closed.
 *  Nothing counts before the first page is seen, so a slow-starting Chrome (or one
 *  without a working debug endpoint) never triggers a teardown. */
export function stepWatch(
  state: WatchState,
  obs: Observation,
  now: number,
  opts: { debounceMs?: number; maxErrors?: number } = {},
): { state: WatchState; gone: GoneReason | null } {
  const { debounceMs, maxErrors } = { ...WATCH_DEFAULTS, ...opts };
  if (obs.kind === "error") {
    const next = { ...state, errors: state.errors + 1 };
    return { state: next, gone: state.seenPage && next.errors >= maxErrors ? "chrome-quit" : null };
  }
  if (obs.count > 0) return { state: { seenPage: true, emptySince: null, errors: 0 }, gone: null };
  const emptySince = state.emptySince ?? now;
  const next = { ...state, errors: 0, emptySince };
  return { state: next, gone: state.seenPage && now - emptySince >= debounceMs ? "window-closed" : null };
}

/**
 * Poll `http://127.0.0.1:<port>/json/list` until the window is gone; resolves with
 * why. `stop()` cancels (resolves never). Network errors are observations, not throws.
 */
export function watchWindow(
  port: number,
  opts: { intervalMs?: number; fetchImpl?: typeof fetch } = {},
): { gone: Promise<GoneReason>; stop(): void } {
  const interval = opts.intervalMs ?? 1000;
  const doFetch = opts.fetchImpl ?? fetch;
  let stopped = false;
  const gone = new Promise<GoneReason>((resolve) => {
    void (async () => {
      let state = initialWatchState();
      while (!stopped) {
        let obs: Observation;
        try {
          const res = await doFetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
          obs = { kind: "pages", count: countPages(await res.json()) };
        } catch {
          obs = { kind: "error" };
        }
        if (stopped) return;
        const step = stepWatch(state, obs, Date.now());
        state = step.state;
        if (step.gone) return resolve(step.gone);
        await Bun.sleep(interval);
      }
    })();
  });
  return { gone, stop: () => { stopped = true; } };
}
