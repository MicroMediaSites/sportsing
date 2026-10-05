// The always-on `sportsing daemon`: a per-user launchd agent that polls every
// sport with a favorite and, when a favorite's game starts, opens it the way
// `<sport> watch` would (or notifies, per `daemon.mode`). Everything here is
// pure — start detection, dedupe, poll cadence, the launchd plist, the
// `launchctl print` parse, and the status/staleness verdict — so it's
// unit-tested without launchd, the real config, or the network. The command
// (src/commands/daemon.ts) does the IO.

import type { Game, GameState } from "./game.ts";
import type { InstallMethod } from "./upgrade.ts";
import { planWatch, watchOf, type WatchContext } from "./watch-route.ts";

/** launchd label, plist basename, and `launchctl … gui/<uid>/<label>` target. */
export const DAEMON_LABEL = "com.sportsing.daemon";

export const DAEMON_MODES = ["open", "notify"] as const;
export type DaemonMode = (typeof DAEMON_MODES)[number];
export const DEFAULT_DAEMON_MODE: DaemonMode = "open";

/** A stored/typed mode, or null when it isn't one. */
export function parseDaemonMode(v: unknown): DaemonMode | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (DAEMON_MODES as readonly string[]).includes(s) ? (s as DaemonMode) : null;
}

/** Stored mode, defaulting to `open` for unset/unknown values. */
export function daemonModeOf(stored: unknown): DaemonMode {
  return parseDaemonMode(stored) ?? DEFAULT_DAEMON_MODE;
}

// ── Games ────────────────────────────────────────────────────────────────────

/** What a game start does, as `<sport> watch` would decide it. */
export type Route =
  /** A stream to open; `note` says which service and why. */
  | { kind: "open"; note: string }
  /** Over the air only — nothing to open; `message` names the channel. */
  | { kind: "tune"; message: string }
  /** Can't be watched (or placed); `message` says why. */
  | { kind: "none"; message: string };

/** One favorite-team game as the daemon sees it, sport-neutral. */
export interface DaemonGame {
  /** `<sport>:<game id>` — the dedupe key. */
  key: string;
  sport: string;
  icon: string;
  /** "DEN @ UTAH" (away @ home). */
  fixture: string;
  /** ISO scheduled start. */
  start: string;
  state: GameState;
  /** argv (after the sportsing executable) that opens it with no TTY. */
  openArgs: string[];
  /** argv for an interactive `watch` (click-to-watch, in a Terminal window). */
  clickArgs: string[];
  route: Route;
}

/**
 * How an ESPN-league game start is routed — the same decision `<sport> watch`
 * makes: with subscriptions, the watchability resolver (Fubo / League Pass
 * open, over-the-air names the channel, unwatchable says why); without them,
 * the configured / league-default provider, if any.
 */
export function leagueRoute(g: Game, watch: WatchContext | null, fallback: string | null): Route {
  if (!watch) {
    return fallback
      ? { kind: "open", note: `${fallback} (no subscriptions set)` }
      : { kind: "none", message: "no streaming provider — run `sportsing subscriptions set …`" };
  }
  const plan = planWatch(watchOf(g, watch), fallback);
  return plan.kind === "open" ? { kind: "open", note: plan.note } : plan;
}

/** The daemon's view of an ESPN-league game; `favIds` picks the team `watch` follows. */
export function leagueDaemonGame(
  sport: string,
  icon: string,
  g: Game,
  favIds: ReadonlySet<string>,
  route: Route,
): DaemonGame {
  // Either favorite's id finds the same game; prefer home, as `watch` does.
  const team = [g.home, g.away].find((t) => favIds.has(t.id))?.id ?? g.home.id;
  return {
    key: `${sport}:${g.id}`,
    sport,
    icon,
    fixture: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
    start: g.date,
    state: g.state,
    openArgs: [sport, "watch", team, "--supervised"],
    clickArgs: [sport, "watch", team],
    route,
  };
}

/** Short "where it'll open" text for status lines. */
export function routeWhere(r: Route, mode: DaemonMode): string {
  if (r.kind === "open") return mode === "open" ? `opens ${r.note}` : `notifies (click to open ${r.note})`;
  if (r.kind === "tune") return `notifies: ${r.message}`;
  return `notifies: ✗ ${r.message}`;
}

// ── Cadence ──────────────────────────────────────────────────────────────────

/** Poll interval when no favorite game is close. */
export const SPARSE_POLL_MS = 10 * 60_000;
/** Poll interval from LEAD_MS before a scheduled start until it goes live. */
export const TIGHT_POLL_MS = 30_000;
/** How long before a scheduled start polling tightens. */
export const LEAD_MS = 15 * 60_000;
/** How long past its scheduled start a not-yet-live game is still awaited
 *  (delayed starts, a lagging feed) — matches `watch`'s START_GRACE_MS. */
export const START_GRACE_MS = 3 * 60 * 60_000;

/** The not-yet-started game the daemon is waiting for: the earliest `pre`
 *  game that's upcoming or still within START_GRACE_MS of its start. */
export function nextUp(games: DaemonGame[], now: number): DaemonGame | null {
  return (
    games
      .filter((g) => g.state === "pre" && Date.parse(g.start) >= now - START_GRACE_MS)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null
  );
}

/**
 * How long to sleep before the next poll: tight (30s) from LEAD_MS before the
 * next game's scheduled start until it flips live — including past the start
 * for a delayed one — else sparse, waking early enough to be tight by LEAD_MS.
 */
export function pollDelayMs(games: DaemonGame[], now: number): number {
  const n = nextUp(games, now);
  if (!n) return SPARSE_POLL_MS;
  const untilLead = Date.parse(n.start) - LEAD_MS - now;
  if (untilLead <= 0) return TIGHT_POLL_MS;
  return Math.min(SPARSE_POLL_MS, Math.max(TIGHT_POLL_MS, untilLead));
}

// ── State ────────────────────────────────────────────────────────────────────

export interface NextGame {
  key: string;
  icon: string;
  fixture: string;
  start: string;
  /** routeWhere() text. */
  where: string;
}

export interface LastAction {
  at: string;
  key: string;
  icon: string;
  fixture: string;
  /** What was done: "opened", "notified", "dry-run", "failed". */
  did: string;
  detail: string;
}

/** The daemon's persisted state (heartbeat, dedupe set, what it's doing). */
export interface DaemonState {
  pid: number;
  startedAt: string;
  version: string;
  mode: DaemonMode;
  /** Last completed poll. */
  heartbeat: string | null;
  /** The sleep chosen after that poll. */
  pollMs: number;
  next: NextGame | null;
  lastAction: LastAction | null;
  /** Game key → when it was acted on. A game is acted on at most once. */
  acted: Record<string, string>;
  /** Sport label → error from the last poll (that sport was skipped). */
  errors: Record<string, string>;
}

/** How long acted-on keys are remembered (well past any game's length). */
export const ACTED_TTL_MS = 7 * 24 * 60 * 60_000;

/** Acted-on keys younger than ACTED_TTL_MS. */
export function pruneActed(acted: Record<string, string>, now: number): Record<string, string> {
  return Object.fromEntries(Object.entries(acted).filter(([, at]) => now - Date.parse(at) < ACTED_TTL_MS));
}

/** Live favorite games not yet acted on — what this poll should open. */
export function startsToAct(games: DaemonGame[], acted: Record<string, string>): DaemonGame[] {
  const seen = new Set<string>();
  return games.filter((g) => {
    if (g.state !== "in" || Object.hasOwn(acted, g.key) || seen.has(g.key)) return false;
    seen.add(g.key);
    return true;
  });
}

/** Parse a state file's JSON; null for anything malformed. */
export function parseDaemonState(raw: unknown): DaemonState | null {
  const s = raw as Partial<DaemonState> | null;
  if (!s || typeof s !== "object" || typeof s.pid !== "number" || typeof s.startedAt !== "string") return null;
  return {
    pid: s.pid,
    startedAt: s.startedAt,
    version: typeof s.version === "string" ? s.version : "?",
    mode: daemonModeOf(s.mode),
    heartbeat: typeof s.heartbeat === "string" ? s.heartbeat : null,
    pollMs: typeof s.pollMs === "number" && s.pollMs > 0 ? s.pollMs : SPARSE_POLL_MS,
    next: s.next ?? null,
    lastAction: s.lastAction ?? null,
    acted: s.acted && typeof s.acted === "object" ? s.acted : {},
    errors: s.errors && typeof s.errors === "object" ? s.errors : {},
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

/** A heartbeat older than this means the loop is wedged: ~3 poll intervals,
 *  never under 3 minutes (a tight-poll fetch can legitimately take a while). */
export function staleAfterMs(pollMs: number): number {
  return Math.max(3 * pollMs, 3 * 60_000);
}

export interface ServiceInfo {
  /** launchd has the job loaded. */
  loaded: boolean;
  /** Its running process, if any. */
  pid?: number;
}

export type DaemonLevel =
  /** Not installed (no plist, nothing loaded). */
  | "off"
  /** Installed, but no process is running it. */
  | "down"
  /** Running, but it hasn't completed a poll yet. */
  | "starting"
  /** Running, heartbeat stale. */
  | "stuck"
  /** Running and polling. */
  | "on";

export interface DaemonStatus {
  level: DaemonLevel;
  installed: boolean;
  pid: number | null;
  state: DaemonState | null;
  /** ms since the last heartbeat, when there is one. */
  heartbeatAgeMs: number | null;
}

/**
 * The daemon's health. `service` comes from launchd (`daemon status`) or, for
 * the cheap footer, from probing the state file's pid. The state only counts
 * when it belongs to the running process.
 */
export function evaluateStatus(o: { installed: boolean; service: ServiceInfo; state: DaemonState | null; now: number }): DaemonStatus {
  const pid = o.service.pid ?? null;
  const base = { installed: o.installed, pid, state: o.state, heartbeatAgeMs: null as number | null };
  if (!o.installed && !o.service.loaded) return { ...base, level: "off" };
  if (pid === null) return { ...base, level: "down" };
  const mine = o.state && o.state.pid === pid ? o.state : null;
  if (!mine?.heartbeat) {
    const since = mine ? o.now - Date.parse(mine.startedAt) : 0;
    return { ...base, level: since > staleAfterMs(TIGHT_POLL_MS) ? "stuck" : "starting" };
  }
  const age = o.now - Date.parse(mine.heartbeat);
  return { ...base, heartbeatAgeMs: age, level: age > staleAfterMs(mine.pollMs) ? "stuck" : "on" };
}

/** `daemon status` exits 0 only for this. */
export function isHealthy(s: DaemonStatus): boolean {
  return s.level === "on";
}

/** "7:00 PM" today, else "Sat 7:00 PM" (local time). */
export function whenLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const time = d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleString(undefined, { weekday: "short" })} ${time}`;
}

/** "45s", "12m", "3h 5m", "2d 4h". */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** The one-line footer under bare today / next / me. */
export function footerLine(s: DaemonStatus, now: number): string {
  switch (s.level) {
    case "off":
      return "daemon: off — sportsing daemon install";
    case "down":
      return "daemon: down — installed but not running (sportsing daemon status)";
    case "starting":
      return "daemon: starting — sportsing daemon status";
    case "stuck": {
      const age = s.heartbeatAgeMs === null ? "no poll yet" : `last poll ${fmtDuration(s.heartbeatAgeMs)} ago`;
      return `daemon: stuck — ${age} (sportsing daemon logs)`;
    }
    case "on": {
      const n = s.state?.next;
      return n ? `daemon: on — waiting for ${n.fixture} ${whenLabel(n.start, now)}` : "daemon: on — no favorite games coming up";
    }
  }
}

/** Pull `state` and `pid` out of `launchctl print gui/<uid>/<label>`. */
export function parseLaunchctlPrint(out: string): ServiceInfo & { state?: string } {
  const state = out.match(/^\s*state = (.+)$/m)?.[1]?.trim();
  const pidStr = out.match(/^\s*pid = (\d+)/m)?.[1];
  const pid = pidStr ? Number(pidStr) : undefined;
  return { loaded: true, ...(state ? { state } : {}), ...(pid && state === "running" ? { pid } : {}) };
}

// ── launchd agent ────────────────────────────────────────────────────────────

/**
 * ProgramArguments for `sportsing daemon run`, pinned to the stable paths of
 * how this copy was installed — so the agent keeps working across
 * `sportsing upgrade` (which reinstalls into the same prefix). The bin is a
 * Bun script, so it's run by an absolute Bun (launchd's PATH has no Bun):
 * the bun-global install's own, else the `bun` on the installing shell's PATH
 * (a stable shim like ~/.bun/bin/bun), else the running one. Null for
 * installs with no stable path (npx/bunx caches, unrecognised).
 */
export function daemonProgram(
  m: InstallMethod,
  o: { execPath: string; bunOnPath: string | null; exists: (p: string) => boolean },
): string[] | null {
  const bun = o.bunOnPath ?? o.execPath;
  const run = ["daemon", "run"];
  switch (m.kind) {
    case "npm-global":
      return [bun, `${m.prefix}/bin/sportsing`, ...run];
    case "bun-global": {
      const own = `${m.bunInstall}/bin/bun`;
      return [o.exists(own) ? own : bun, `${m.bunInstall}/bin/sportsing`, ...run];
    }
    case "source":
      return [bun, `${m.root}/src/index.ts`, ...run];
    case "compiled":
      return [o.execPath, ...run];
    default:
      return null;
  }
}

/** PATH for the agent: the installing shell's PATH (so terminal-notifier,
 *  osascript and Chrome resolve as they do for you), plus the system dirs,
 *  de-duplicated in order. */
export function agentPath(shellPath: string | undefined, extra: string[] = []): string {
  const sys = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const parts = [...extra, ...(shellPath ?? "").split(":"), ...sys].filter(Boolean);
  return [...new Set(parts)].join(":");
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The LaunchAgent plist: run at login, restart if it exits (throttled), log
 * stdout+stderr to `logPath`. AbandonProcessGroup keeps a game window the
 * daemon opened alive across a daemon restart (e.g. after an upgrade).
 */
export function launchAgentPlist(o: { label: string; program: string[]; logPath: string; path: string; home: string }): string {
  const args = o.program.map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xml(o.home)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(o.path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(o.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(o.logPath)}</string>
</dict>
</plist>
`;
}
