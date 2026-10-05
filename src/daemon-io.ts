// The daemon's IO edge: where its files live, its state file (written
// atomically), and launchd. Kept apart from src/commands/daemon.ts so the
// bare today/next/me footer and `sportsing upgrade` can use it without pulling
// in the sport registry. launchctl is behind the `Launchd` interface so tests
// and smokes use fakes — nothing in the test suite ever talks to launchd.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { CACHE_DIR } from "./config.ts";
import {
  DAEMON_LABEL,
  evaluateStatus,
  footerLine,
  parseDaemonState,
  parseLaunchctlPrint,
  type DaemonState,
  type DaemonStatus,
  type ServiceInfo,
} from "./daemon.ts";
import { pidAlive } from "./liveness.ts";

export const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
export const LOG_DIR = join(homedir(), "Library", "Logs", "sportsing");
export const LOG_FILE = join(LOG_DIR, "daemon.log");
export const STATE_FILE = join(CACHE_DIR, "daemon-state.json");

/** The daemon's state file, or null if absent/malformed. */
export function readState(file = STATE_FILE): DaemonState | null {
  try {
    return parseDaemonState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Write the state file atomically (temp file + rename), so a reader never
 *  sees a half-written file and a crash mid-write leaves the old one. */
export function writeState(s: DaemonState, file = STATE_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file);
}

/** launchctl, injectable. All calls target the `gui/<uid>` domain. */
export interface Launchd {
  /** The job's launchd info, or `{ loaded: false }` when it isn't loaded. */
  print(label: string): ServiceInfo;
  /** Load and start a plist. Throws on failure. */
  bootstrap(plistPath: string): void;
  /** Unload a job. Throws on failure. */
  bootout(label: string): void;
  /** Kill and restart a loaded job. Throws on failure. */
  kickstart(label: string): void;
}

function launchctl(args: string[]): { code: number; out: string } {
  const r = Bun.spawnSync(["launchctl", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? 1, out: r.stdout.toString() + r.stderr.toString() };
}

function must(args: string[]): void {
  const r = launchctl(args);
  if (r.code !== 0) throw new Error(`launchctl ${args.join(" ")} failed (${r.code}): ${r.out.trim()}`);
}

/** The real launchctl. */
export function systemLaunchd(uid = process.getuid?.() ?? 501): Launchd {
  const domain = `gui/${uid}`;
  return {
    print(label) {
      const r = launchctl(["print", `${domain}/${label}`]);
      return r.code === 0 ? parseLaunchctlPrint(r.out) : { loaded: false };
    },
    bootstrap: (plistPath) => must(["bootstrap", domain, plistPath]),
    bootout: (label) => must(["bootout", `${domain}/${label}`]),
    kickstart: (label) => must(["kickstart", "-k", `${domain}/${label}`]),
  };
}

/** The daemon's status. With `launchd`, it's the authority on whether the job
 *  runs; without it (the cheap footer) the state file's pid is probed. */
export function gatherStatus(launchd: Launchd | null, now = Date.now()): DaemonStatus {
  const state = readState();
  const installed = existsSync(PLIST_PATH);
  let service: ServiceInfo;
  if (launchd) service = launchd.print(DAEMON_LABEL);
  else service = state && pidAlive(state.pid) ? { loaded: true, pid: state.pid } : { loaded: false };
  return evaluateStatus({ installed, service, state, now });
}

/** The one-line footer for bare today / next / me. Never throws. */
export function daemonFooter(): string | null {
  try {
    return footerLine(gatherStatus(null), Date.now());
  } catch {
    return null;
  }
}

/**
 * After `sportsing upgrade`: restart a loaded daemon so it runs the new code.
 * Returns what happened, for the upgrade's output.
 */
export function restartDaemonIfLoaded(launchd: Launchd): "restarted" | "not-loaded" | { error: string } {
  if (!launchd.print(DAEMON_LABEL).loaded) return "not-loaded";
  try {
    launchd.kickstart(DAEMON_LABEL);
    return "restarted";
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
