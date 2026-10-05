import { test, expect } from "bun:test";
// Pure daemon logic + daemon-io over a fake launchd — never touches launchd,
// ~/.config/sportsing, ~/Library, or the network.
import {
  ACTED_TTL_MS,
  LEAD_MS,
  SPARSE_POLL_MS,
  START_GRACE_MS,
  TIGHT_POLL_MS,
  agentPath,
  daemonModeOf,
  daemonProgram,
  evaluateStatus,
  fmtDuration,
  footerLine,
  isHealthy,
  launchAgentPlist,
  leagueDaemonGame,
  leagueRoute,
  nextUp,
  parseDaemonMode,
  parseDaemonState,
  parseLaunchctlPrint,
  pollDelayMs,
  pruneActed,
  routeWhere,
  staleAfterMs,
  startsToAct,
  type DaemonGame,
  type DaemonState,
} from "./daemon.ts";
import { restartDaemonIfLoaded, type Launchd } from "./daemon-io.ts";
import type { Game } from "./game.ts";

const NOW = Date.parse("2026-10-24T01:00:00Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function game(id: string, startMs: number, state: DaemonGame["state"], over: Partial<DaemonGame> = {}): DaemonGame {
  return {
    key: `nba:${id}`,
    sport: "nba",
    icon: "🏀",
    fixture: "DEN @ UTAH",
    start: iso(startMs),
    state,
    openArgs: ["nba", "watch", "26", "--supervised"],
    clickArgs: ["nba", "watch", "26"],
    route: { kind: "open", note: "Fubo — on KJZZ-TV" },
    ...over,
  };
}

function state(over: Partial<DaemonState> = {}): DaemonState {
  return {
    pid: 4242,
    startedAt: iso(NOW - 60 * MIN),
    version: "0.3.0",
    mode: "open",
    heartbeat: iso(NOW - 20_000),
    pollMs: TIGHT_POLL_MS,
    next: { key: "nba:1", icon: "🏀", fixture: "DEN @ UTAH", start: iso(NOW + 2 * 60 * MIN), where: "opens Fubo" },
    lastAction: null,
    acted: {},
    errors: {},
    ...over,
  };
}

// ── mode ──

test("daemon mode: open by default; open|notify accepted case-insensitively", () => {
  expect(daemonModeOf(undefined)).toBe("open");
  expect(daemonModeOf("bogus")).toBe("open");
  expect(daemonModeOf("NOTIFY")).toBe("notify");
  expect(parseDaemonMode(" open ")).toBe("open");
  expect(parseDaemonMode("auto")).toBeNull();
});

// ── start detection + dedupe ──

test("startsToAct: only live games not already acted on, once each", () => {
  const games = [game("1", NOW - 5 * MIN, "in"), game("2", NOW + 60 * MIN, "pre"), game("3", NOW - 200 * MIN, "post"), game("1", NOW - 5 * MIN, "in")];
  expect(startsToAct(games, {}).map((g) => g.key)).toEqual(["nba:1"]);
  expect(startsToAct(games, { "nba:1": iso(NOW) })).toEqual([]);
});

test("acted-on games survive a restart (state round-trips) so nothing is reopened", () => {
  const s = state({ acted: { "nba:1": iso(NOW - 10 * MIN) } });
  const reloaded = parseDaemonState(JSON.parse(JSON.stringify(s)))!;
  expect(startsToAct([game("1", NOW - 15 * MIN, "in")], reloaded.acted)).toEqual([]);
});

test("pruneActed forgets keys older than the TTL", () => {
  const acted = { old: iso(NOW - ACTED_TTL_MS - 1), fresh: iso(NOW - MIN) };
  expect(Object.keys(pruneActed(acted, NOW))).toEqual(["fresh"]);
});

test("parseDaemonState rejects junk and fills defaults", () => {
  expect(parseDaemonState(null)).toBeNull();
  expect(parseDaemonState({ pid: "x" })).toBeNull();
  const s = parseDaemonState({ pid: 1, startedAt: iso(NOW) })!;
  expect(s.acted).toEqual({});
  expect(s.mode).toBe("open");
  expect(s.pollMs).toBe(SPARSE_POLL_MS);
});

// ── cadence ──

test("nextUp: earliest pre game, including a late one within the start grace", () => {
  const late = game("late", NOW - 20 * MIN, "pre");
  expect(nextUp([game("b", NOW + 3 * 60 * MIN, "pre"), late], NOW)?.key).toBe("nba:late");
  expect(nextUp([game("gone", NOW - START_GRACE_MS - MIN, "pre")], NOW)).toBeNull();
  expect(nextUp([game("live", NOW - MIN, "in")], NOW)).toBeNull();
});

test("pollDelayMs: sparse with nothing near, tight from 15 min before through a delayed start", () => {
  expect(pollDelayMs([], NOW)).toBe(SPARSE_POLL_MS);
  expect(pollDelayMs([game("x", NOW + 5 * 60 * MIN, "pre")], NOW)).toBe(SPARSE_POLL_MS);
  // 20 min out: sleep 5 min so polling is tight by the 15-min lead.
  expect(pollDelayMs([game("x", NOW + 20 * MIN, "pre")], NOW)).toBe(5 * MIN);
  expect(pollDelayMs([game("x", NOW + LEAD_MS, "pre")], NOW)).toBe(TIGHT_POLL_MS);
  expect(pollDelayMs([game("x", NOW + 15 * 1000 + LEAD_MS, "pre")], NOW)).toBe(TIGHT_POLL_MS); // floor
  // Past the scheduled start but not live yet (delayed): stay tight.
  expect(pollDelayMs([game("x", NOW - 40 * MIN, "pre")], NOW)).toBe(TIGHT_POLL_MS);
  // Already live (and acted on): back to sparse.
  expect(pollDelayMs([game("x", NOW - 40 * MIN, "in")], NOW)).toBe(SPARSE_POLL_MS);
});

// ── routing ──

const g: Game = {
  id: "401",
  date: iso(NOW),
  name: "Denver Nuggets at Utah Jazz",
  state: "pre",
  detail: "",
  period: 0,
  clock: "",
  seasonType: "regular",
  home: { id: "26", name: "Utah Jazz", abbreviation: "UTAH", score: "" },
  away: { id: "7", name: "Denver Nuggets", abbreviation: "DEN", score: "" },
  broadcasts: [{ name: "KJZZ-TV", market: "home" }],
};

test("leagueRoute without subscriptions: the fallback provider, else nothing to open", () => {
  expect(leagueRoute(g, null, "fubo")).toEqual({ kind: "open", note: "fubo (no subscriptions set)" });
  expect(leagueRoute(g, null, null).kind).toBe("none");
});

test("leagueRoute with subscriptions follows the watch resolver", () => {
  const r = leagueRoute(g, { sport: "nba", subscriptions: ["local-ota"], homeMarket: "utah" }, null);
  expect(r.kind).not.toBe("open");
});

test("leagueDaemonGame: keyed per sport, watches the favorite's team id, opens supervised", () => {
  const d = leagueDaemonGame("nba", "🏀", g, new Set(["26"]), { kind: "open", note: "Fubo" });
  expect(d.key).toBe("nba:401");
  expect(d.fixture).toBe("DEN @ UTAH");
  expect(d.openArgs).toEqual(["nba", "watch", "26", "--supervised"]);
  expect(d.clickArgs).toEqual(["nba", "watch", "26"]);
});

test("routeWhere describes what a start will do in each mode", () => {
  expect(routeWhere({ kind: "open", note: "Fubo" }, "open")).toBe("opens Fubo");
  expect(routeWhere({ kind: "open", note: "Fubo" }, "notify")).toContain("click to open Fubo");
  expect(routeWhere({ kind: "tune", message: "Utah 16 — over the air" }, "open")).toBe("notifies: Utah 16 — over the air");
  expect(routeWhere({ kind: "none", message: "ESPN+ only" }, "open")).toBe("notifies: ✗ ESPN+ only");
});

// ── status ──

test("evaluateStatus: off when not installed and not loaded", () => {
  const s = evaluateStatus({ installed: false, service: { loaded: false }, state: null, now: NOW });
  expect(s.level).toBe("off");
  expect(isHealthy(s)).toBe(false);
});

test("evaluateStatus: down when installed but no process", () => {
  expect(evaluateStatus({ installed: true, service: { loaded: true }, state: state(), now: NOW }).level).toBe("down");
  expect(evaluateStatus({ installed: true, service: { loaded: false }, state: null, now: NOW }).level).toBe("down");
});

test("evaluateStatus: on with a fresh heartbeat from the running pid", () => {
  const s = evaluateStatus({ installed: true, service: { loaded: true, pid: 4242 }, state: state(), now: NOW });
  expect(s.level).toBe("on");
  expect(isHealthy(s)).toBe(true);
});

test("evaluateStatus: stuck when the heartbeat is older than ~3 intervals", () => {
  const sparse = state({ pollMs: SPARSE_POLL_MS, heartbeat: iso(NOW - 3 * SPARSE_POLL_MS - MIN) });
  expect(evaluateStatus({ installed: true, service: { loaded: true, pid: 4242 }, state: sparse, now: NOW }).level).toBe("stuck");
  const ok = state({ pollMs: SPARSE_POLL_MS, heartbeat: iso(NOW - 2 * SPARSE_POLL_MS) });
  expect(evaluateStatus({ installed: true, service: { loaded: true, pid: 4242 }, state: ok, now: NOW }).level).toBe("on");
  // Tight polling still gets a 3-minute floor.
  expect(staleAfterMs(TIGHT_POLL_MS)).toBe(3 * MIN);
});

test("evaluateStatus: a state file from another (old) pid doesn't count", () => {
  expect(evaluateStatus({ installed: true, service: { loaded: true, pid: 9999 }, state: state(), now: NOW }).level).toBe("starting");
  const wedged = state({ pid: 9999, heartbeat: null, startedAt: iso(NOW - 10 * MIN) });
  expect(evaluateStatus({ installed: true, service: { loaded: true, pid: 9999 }, state: wedged, now: NOW }).level).toBe("stuck");
});

test("footerLine covers every level", () => {
  const on = evaluateStatus({ installed: true, service: { loaded: true, pid: 4242 }, state: state(), now: NOW });
  expect(footerLine(on, NOW)).toMatch(/^daemon: on — waiting for DEN @ UTAH /);
  const idle = evaluateStatus({ installed: true, service: { loaded: true, pid: 4242 }, state: state({ next: null }), now: NOW });
  expect(footerLine(idle, NOW)).toBe("daemon: on — no favorite games coming up");
  expect(footerLine(evaluateStatus({ installed: false, service: { loaded: false }, state: null, now: NOW }), NOW)).toBe(
    "daemon: off — sportsing daemon install",
  );
  const stuck = evaluateStatus({ installed: true, service: { loaded: true, pid: 4242 }, state: state({ heartbeat: iso(NOW - 47 * MIN) }), now: NOW });
  expect(footerLine(stuck, NOW)).toBe("daemon: stuck — last poll 47m ago (sportsing daemon logs)");
  expect(footerLine(evaluateStatus({ installed: true, service: { loaded: false }, state: null, now: NOW }), NOW)).toMatch(/^daemon: down/);
});

test("fmtDuration", () => {
  expect(fmtDuration(45_000)).toBe("45s");
  expect(fmtDuration(12 * MIN)).toBe("12m");
  expect(fmtDuration(185 * MIN)).toBe("3h 5m");
  expect(fmtDuration(52 * 60 * MIN)).toBe("2d 4h");
});

test("parseLaunchctlPrint: running job → pid; loaded-but-stopped → no pid", () => {
  const running = `gui/501/com.sportsing.daemon = {\n\tactive count = 1\n\tpath = /x.plist\n\ttype = LaunchAgent\n\tstate = running\n\n\tprogram = /b/bun\n\tpid = 81234\n}`;
  expect(parseLaunchctlPrint(running)).toEqual({ loaded: true, state: "running", pid: 81234 });
  const waiting = `gui/501/com.sportsing.daemon = {\n\tstate = not running\n\tlast exit code = 1\n}`;
  expect(parseLaunchctlPrint(waiting)).toEqual({ loaded: true, state: "not running" });
});

// ── plist ──

const NVM = "/Users/me/.nvm/versions/node/v24.11.0";

test("daemonProgram: npm global runs the prefix's stable bin under an absolute bun", () => {
  const p = daemonProgram({ kind: "npm-global", prefix: NVM }, { execPath: "/x/bun", bunOnPath: "/Users/me/.bun/bin/bun", exists: () => false });
  expect(p).toEqual(["/Users/me/.bun/bin/bun", `${NVM}/bin/sportsing`, "daemon", "run"]);
});

test("daemonProgram: bun global prefers its own bun; ephemeral installs can't host it", () => {
  const p = daemonProgram({ kind: "bun-global", bunInstall: "/Users/me/.bun" }, { execPath: "/x/bun", bunOnPath: null, exists: () => true });
  expect(p).toEqual(["/Users/me/.bun/bin/bun", "/Users/me/.bun/bin/sportsing", "daemon", "run"]);
  expect(daemonProgram({ kind: "ephemeral" }, { execPath: "/x/bun", bunOnPath: null, exists: () => true })).toBeNull();
  expect(daemonProgram({ kind: "compiled" }, { execPath: "/opt/sportsing", bunOnPath: null, exists: () => true })).toEqual(["/opt/sportsing", "daemon", "run"]);
});

test("agentPath keeps the shell PATH first, adds system dirs, no duplicates", () => {
  expect(agentPath("/a:/usr/bin:/a")).toBe("/a:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin");
});

test("launchAgentPlist: RunAtLoad + KeepAlive, logs, escaped args", () => {
  const xml = launchAgentPlist({ label: "com.sportsing.daemon", program: ["/b/bun", "/p/a&b", "daemon", "run"], logPath: "/L/daemon.log", path: "/usr/bin", home: "/Users/me" });
  expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(xml).toContain("<key>KeepAlive</key>\n  <true/>");
  expect(xml).toContain("<string>/p/a&amp;b</string>");
  expect(xml.match(/<string>\/L\/daemon\.log<\/string>/g)?.length).toBe(2);
  expect(xml).toContain("<string>com.sportsing.daemon</string>");
});

// ── upgrade restart (fake launchd) ──

function fakeLaunchd(loaded: boolean, kick?: () => void): Launchd & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    print: (l) => (calls.push(`print ${l}`), { loaded }),
    bootstrap: (p) => void calls.push(`bootstrap ${p}`),
    bootout: (l) => void calls.push(`bootout ${l}`),
    kickstart: (l) => {
      calls.push(`kickstart ${l}`);
      kick?.();
    },
  };
}

test("restartDaemonIfLoaded kicks a loaded agent and leaves an absent one alone", () => {
  const on = fakeLaunchd(true);
  expect(restartDaemonIfLoaded(on)).toBe("restarted");
  expect(on.calls).toEqual(["print com.sportsing.daemon", "kickstart com.sportsing.daemon"]);
  const off = fakeLaunchd(false);
  expect(restartDaemonIfLoaded(off)).toBe("not-loaded");
  expect(off.calls).toEqual(["print com.sportsing.daemon"]);
  const broken = fakeLaunchd(true, () => {
    throw new Error("nope");
  });
  expect(restartDaemonIfLoaded(broken)).toEqual({ error: "nope" });
});
