// `sportsing daemon …` — the always-on watcher (see src/daemon.ts for the
// pure logic and src/daemon-io.ts for files + launchd).
//
//   install [--dry-run]   write + load the LaunchAgent (dry run: print the plist)
//   uninstall             unload + remove it
//   status [--json]       installed / running / last poll / next game / last action; exit 0 only if healthy
//   logs [-f] [-n N]      tail the log
//   mode [open|notify]    show or set what a game start does
//   run [--once] [--dry-run]   the poll loop launchd runs (also usable in the foreground)

import { spawn } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { c } from "../ansi.ts";
import { notify } from "../notify.ts";
import { getDaemonMode, setDaemonMode } from "../config.ts";
import { inTerminal, selfInvocation, shQuote } from "../click-to-watch.ts";
import {
  DAEMON_LABEL,
  DAEMON_MODES,
  agentPath,
  daemonProgram,
  fmtDuration,
  isHealthy,
  launchAgentPlist,
  nextUp,
  parseDaemonMode,
  pollDelayMs,
  pruneActed,
  routeWhere,
  staleAfterMs,
  startsToAct,
  whenLabel,
  type DaemonGame,
  type DaemonMode,
  type DaemonState,
  type DaemonStatus,
  type LastAction,
} from "../daemon.ts";
import { LOG_DIR, LOG_FILE, PLIST_PATH, STATE_FILE, gatherStatus, readState, systemLaunchd, writeState, type Launchd } from "../daemon-io.ts";
import { describeInstall, detectInstall } from "../upgrade.ts";
import { SPORTS, type Sport } from "./cross.ts";
import { runningScript } from "./upgrade.ts";

function usage(): void {
  console.log(`${c.bold("sportsing daemon")} — always-on watcher: opens your teams' games when they start

  sportsing daemon install [--dry-run]   install + start the LaunchAgent (runs at login, restarts if it dies)
  sportsing daemon uninstall             stop + remove it
  sportsing daemon status [--json]       is it running, what it's waiting for, what it last did (exit 0 = healthy)
  sportsing daemon logs [-f] [-n N]      show (or follow) its log
  sportsing daemon mode [open|notify]    what a game start does: open the window (default) or notify with click-to-watch
  sportsing daemon run [--once] [--dry-run]   the loop itself, in the foreground (--dry-run: act on nothing)`);
}

function fail(msg: string, hint?: string): void {
  console.error(c.red(msg));
  if (hint) console.error(c.dim(hint));
  process.exitCode = 1;
}

const tilde = (p: string) => (p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p);

// ── install / uninstall ──────────────────────────────────────────────────────

/** The plist for this install, or an error saying why there isn't one. */
export function plistForThisInstall(): { plist: string; program: string[] } | { error: string } {
  const install = detectInstall(runningScript());
  const program = daemonProgram(install, { execPath: process.execPath, bunOnPath: Bun.which("bun"), exists: existsSync });
  if (!program) {
    return {
      error: `Can't install the daemon from a ${describeInstall(install)} — it needs a stable path to run. Install sportsing globally first: npm install -g sportsing (or bun add -g sportsing).`,
    };
  }
  const plist = launchAgentPlist({ label: DAEMON_LABEL, program, logPath: LOG_FILE, path: agentPath(process.env.PATH), home: homedir() });
  return { plist, program };
}

export function install(args: string[], launchd: Launchd): void {
  const made = plistForThisInstall();
  if ("error" in made) return fail(made.error);
  if (args.includes("--dry-run")) {
    console.log(c.dim(`# would write ${PLIST_PATH} and run: launchctl bootstrap gui/<uid> ${tilde(PLIST_PATH)}`));
    process.stdout.write(made.plist);
    return;
  }
  // Idempotent: unload a previous copy, rewrite the plist, load it fresh.
  if (launchd.print(DAEMON_LABEL).loaded) launchd.bootout(DAEMON_LABEL);
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(PLIST_PATH.slice(0, PLIST_PATH.lastIndexOf("/")), { recursive: true });
  writeFileSync(PLIST_PATH, made.plist);
  try {
    launchd.bootstrap(PLIST_PATH);
  } catch (e) {
    return fail(`Wrote ${tilde(PLIST_PATH)} but couldn't load it: ${(e as Error).message}`);
  }
  console.log(c.green(`✓ sportsing daemon installed and started (${DAEMON_LABEL}).`));
  console.log(c.dim(`  runs: ${made.program.join(" ")}`));
  console.log(c.dim(`  log:  ${tilde(LOG_FILE)}`));
  console.log(c.dim("  check it with: sportsing daemon status"));
}

export function uninstall(launchd: Launchd): void {
  const loaded = launchd.print(DAEMON_LABEL).loaded;
  if (loaded) {
    try {
      launchd.bootout(DAEMON_LABEL);
    } catch (e) {
      return fail(`Couldn't stop the daemon: ${(e as Error).message}`);
    }
  }
  const had = existsSync(PLIST_PATH);
  rmSync(PLIST_PATH, { force: true });
  console.log(loaded || had ? c.green("✓ sportsing daemon stopped and removed.") : c.dim("sportsing daemon wasn't installed — nothing to do."));
}

// ── status ───────────────────────────────────────────────────────────────────

const LEVEL_COLOR = { on: c.green, starting: c.yellow, stuck: c.red, down: c.red, off: c.yellow } as const;

/** `daemon status` text, one fact per line. */
export function statusLines(s: DaemonStatus, now: number): string[] {
  const st = s.state && s.state.pid === s.pid ? s.state : null;
  const head = `sportsing daemon: ${LEVEL_COLOR[s.level](c.bold(s.level))}`;
  const row = (k: string, v: string) => `  ${c.dim(k.padEnd(11))} ${v}`;
  const out = [head];
  if (s.level === "off") {
    out.push(row("installed", "no — install it with: sportsing daemon install"));
    return out;
  }
  out.push(row("installed", s.installed ? tilde(PLIST_PATH) : "no plist (running in the foreground?)"));
  if (s.pid === null) out.push(row("running", c.red("no") + c.dim(" — see: sportsing daemon logs")));
  else {
    const up = st ? ` · up ${fmtDuration(now - Date.parse(st.startedAt))} · v${st.version} · mode ${st.mode}` : "";
    out.push(row("running", `pid ${s.pid}${up}`));
  }
  const last = s.state;
  if (last?.heartbeat) {
    const age = now - Date.parse(last.heartbeat);
    const ago = `${new Date(last.heartbeat).toLocaleTimeString()} (${fmtDuration(age)} ago)`;
    const stuck = s.level === "stuck" ? c.red(` — STUCK: no poll for over ${fmtDuration(staleAfterMs(last.pollMs))}`) : c.dim(` · polling every ${fmtDuration(last.pollMs)}`);
    out.push(row("last poll", ago + stuck));
  } else out.push(row("last poll", c.dim("none yet")));
  if (last) {
    const n = last.next;
    out.push(row("next game", n ? `${n.icon} ${n.fixture} · ${whenLabel(n.start, now)} → ${n.where}` : c.dim("no favorite games coming up")));
    const a = last.lastAction;
    out.push(row("last acted", a ? `${a.icon} ${a.did} ${a.fixture} · ${whenLabel(a.at, now)}${a.detail ? c.dim(` (${a.detail})`) : ""}` : c.dim("nothing yet")));
    for (const [sport, err] of Object.entries(last.errors)) out.push(row("warning", c.yellow(`${sport}: ${err}`)));
  }
  out.push(row("log", tilde(LOG_FILE)));
  return out;
}

function status(args: string[], launchd: Launchd): void {
  const now = Date.now();
  const s = gatherStatus(launchd, now);
  if (args.includes("--json")) console.log(JSON.stringify({ ...s, healthy: isHealthy(s) }, null, 2));
  else for (const l of statusLines(s, now)) console.log(l);
  if (!isHealthy(s)) process.exitCode = 1;
}

// ── logs ─────────────────────────────────────────────────────────────────────

async function logs(args: string[]): Promise<void> {
  if (!existsSync(LOG_FILE)) return fail(`No daemon log yet (${tilde(LOG_FILE)}).`, "It's created when the daemon first runs: sportsing daemon install");
  const nIdx = args.indexOf("-n");
  const n = nIdx >= 0 ? Number(args[nIdx + 1]) : 50;
  const follow = args.includes("-f") || args.includes("--follow");
  const cmd = ["tail", "-n", String(Number.isInteger(n) && n > 0 ? n : 50), ...(follow ? ["-f"] : []), LOG_FILE];
  const proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exitCode = await proc.exited;
}

// ── mode ─────────────────────────────────────────────────────────────────────

async function mode(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(`daemon mode: ${c.bold(await getDaemonMode())}  ${c.dim("(open = open the game window · notify = notification, click to watch)")}`);
    return;
  }
  const m = parseDaemonMode(args[0]);
  if (!m) return fail(`Unknown mode "${args[0]}". Use one of: ${DAEMON_MODES.join(", ")}.`);
  await setDaemonMode(m);
  console.log(c.green(`✓ daemon mode: ${m}`) + c.dim(" — takes effect from the next game start."));
}

// ── run ──────────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`${new Date().toISOString()}  ${msg}`);
}

/** Every sport's favorite games; a sport that fails is recorded and skipped. */
async function collect(sports: Sport[]): Promise<{ games: DaemonGame[]; errors: Record<string, string> }> {
  const settled = await Promise.allSettled(sports.map((s) => s.daemonGames()));
  const games: DaemonGame[] = [];
  const errors: Record<string, string> = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") games.push(...(r.value ?? []));
    else errors[sports[i]!.label] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  });
  return { games, errors };
}

/** Run `args` as a detached sportsing child (its own process group, so it
 *  outlives a daemon restart), output into the daemon's log. */
function spawnDetached(exe: string[], args: string[]): void {
  const child = spawn(exe[0]!, [...exe.slice(1), ...args], { detached: true, stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", (e) => log(`couldn't start ${args.join(" ")}: ${e.message}`));
  child.unref();
}

/** Act on one game start. */
function act(g: DaemonGame, mode: DaemonMode, exe: string[], dry: boolean): LastAction {
  const base = { at: new Date().toISOString(), key: g.key, icon: g.icon, fixture: g.fixture };
  const click = `${exe.map(shQuote).join(" ")} ${g.clickArgs.map(shQuote).join(" ")}`;
  const title = `${g.icon} ${g.fixture} is under way`;
  if (g.route.kind === "open" && mode === "open") {
    if (dry) return { ...base, did: "dry-run", detail: `would open: ${g.openArgs.join(" ")}` };
    spawnDetached(exe, g.openArgs);
    notify(title, `Opening — ${g.route.note}`, { group: `sportsing-daemon-${g.key}` });
    return { ...base, did: "opened", detail: g.route.note };
  }
  const body = g.route.kind === "open" ? `Click to watch — ${g.route.note}` : g.route.kind === "tune" ? `📺 ${g.route.message}` : `✗ ${g.route.message}`;
  if (dry) return { ...base, did: "dry-run", detail: `would notify: ${body}` };
  notify(title, body, { group: `sportsing-daemon-${g.key}`, onClick: g.route.kind === "open" ? inTerminal(click) : undefined });
  return { ...base, did: "notified", detail: body };
}

/**
 * The poll loop. Each poll: fetch every sport's favorite games, act on any
 * live one not acted on before (recorded in the state file *before* acting,
 * so a crash or restart never double-opens), record the heartbeat and next
 * game, then sleep — sparse when nothing's near, tight around a start.
 */
export async function run(args: string[], version: string, sports: Sport[] = SPORTS): Promise<void> {
  const once = args.includes("--once");
  const dry = args.includes("--dry-run");
  const exe = selfInvocation();
  const prev = readState();
  const state: DaemonState = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    version,
    mode: await getDaemonMode(),
    heartbeat: null,
    pollMs: 0,
    next: null,
    lastAction: prev?.lastAction ?? null,
    acted: prev?.acted ?? {},
    errors: {},
  };
  const save = () => {
    if (!dry) writeState(state);
  };
  log(`sportsing daemon ${version} started (pid ${process.pid}${dry ? ", dry run" : ""}; state ${tilde(STATE_FILE)})`);
  save();

  let stop = false;
  let wake: (() => void) | null = null;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      log(`${sig} — stopping`);
      stop = true;
      wake?.();
    });
  }

  while (!stop) {
    state.mode = await getDaemonMode().catch(() => state.mode);
    const { games, errors } = await collect(sports);
    const now = Date.now();
    state.errors = errors;
    for (const [sport, err] of Object.entries(errors)) log(`${sport}: ${err}`);

    state.acted = pruneActed(state.acted, now);
    for (const g of startsToAct(games, state.acted)) {
      state.acted[g.key] = new Date(now).toISOString();
      save(); // persist the dedupe before acting
      try {
        state.lastAction = act(g, state.mode, exe, dry);
      } catch (e) {
        state.lastAction = { at: new Date().toISOString(), key: g.key, icon: g.icon, fixture: g.fixture, did: "failed", detail: (e as Error).message };
      }
      log(`${state.lastAction.did} ${g.fixture} — ${state.lastAction.detail}`);
    }

    const n = nextUp(games, now);
    state.next = n && { key: n.key, icon: n.icon, fixture: n.fixture, start: n.start, where: routeWhere(n.route, state.mode) };
    state.pollMs = pollDelayMs(games, now);
    state.heartbeat = new Date(now).toISOString();
    save();
    const waiting = n ? `next ${n.fixture} ${new Date(n.start).toLocaleString()} (${state.next!.where})` : "no favorite games coming up";
    log(`poll: ${games.length} favorite game(s); ${waiting}; next poll in ${fmtDuration(state.pollMs)}`);
    if (once) break;
    await new Promise<void>((r) => {
      const t = setTimeout(r, state.pollMs);
      wake = () => {
        clearTimeout(t);
        r();
      };
    });
  }
}

// ── dispatch ─────────────────────────────────────────────────────────────────

export async function daemon(args: string[], version: string, launchd: Launchd = systemLaunchd()): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "install":
      return install(rest, launchd);
    case "uninstall":
      return uninstall(launchd);
    case "status":
      return status(rest, launchd);
    case "logs":
    case "log":
      return logs(rest);
    case "mode":
      return mode(rest);
    case "run":
      return run(rest, version);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return usage();
    default:
      usage();
      return fail(`Unknown daemon command: ${sub}`);
  }
}
