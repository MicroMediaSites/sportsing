// Liveness primitive for a running `watch --wait`: a pidfile so a supervisor
// (the agent-setup --check status + the /loop agent-setup skill) can tell whether
// the watcher is alive and restart it after a silent death. Zero-dep — plain fs
// over the sportsing cache dir.

import { mkdirSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { CACHE_DIR } from "./config.ts";

/** Stable, documented pidfile path for a `watch --wait` process. Other commands
 *  (e.g. `agent-setup --check`) locate the watcher here without guessing:
 *  `~/.cache/sportsing/watch-wait.pid` (CACHE_DIR/watch-wait.pid). */
export const WATCH_PIDFILE = join(CACHE_DIR, "watch-wait.pid");

/** True if `pid` names a process that currently exists. Uses signal 0, which does
 *  no actual signalling — it only probes existence (throws ESRCH if gone). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH (no such process) → not alive
  }
}

/**
 * Record this process's PID in the watch pidfile and arrange its removal on a
 * clean exit and on SIGINT/SIGTERM. Call once at the start of a `watch --wait`.
 * Writes nothing to stdout (preserves the backgroundable `--quiet &` contract).
 */
export function writeWatchPidfile(): void {
  mkdirSync(dirname(WATCH_PIDFILE), { recursive: true });
  writeFileSync(WATCH_PIDFILE, String(process.pid));

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    try {
      unlinkSync(WATCH_PIDFILE);
    } catch {
      /* already gone */
    }
  };
  process.on("exit", cleanup); // covers normal return + any process.exit()

  // Remove the pidfile on signals too. We must NOT process.exit() here when
  // another handler is already registered (the overlay installs a SIGINT handler
  // that closes the Chrome window before exiting) — exiting first would orphan
  // that window. So: clean up the pidfile, and only when we're the sole listener
  // (the pre-overlay wait phase) re-raise the signal to terminate normally.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      cleanup();
      if (process.listenerCount(sig) <= 1) {
        process.removeListener(sig, handler);
        process.kill(process.pid, sig);
      }
    };
    process.on(sig, handler);
  }
}

/** The PID recorded in the pidfile, or null if absent/malformed. */
export function readWatchPid(): number | null {
  try {
    const pid = Number(readFileSync(WATCH_PIDFILE, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Whether a `watch --wait` is currently alive: the pidfile must exist AND name a
 *  live process. A stale pidfile (process gone) reports false — never a false
 *  "running". Scope: only `watch --wait` writes the pidfile, so a live *non*-wait
 *  `watch` (e.g. a one-shot hub open) correctly reports false here. */
export function isWatchAlive(): boolean {
  const pid = readWatchPid();
  return pid != null && pidAlive(pid);
}
