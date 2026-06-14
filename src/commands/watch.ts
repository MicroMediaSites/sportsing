import { c } from "../ansi.ts";
import { findCurrentMatch, resolveWatchTarget, type EspnEvent } from "../espn.ts";
import { getStreamProvider } from "../config.ts";
import { PROVIDERS, launchStream, spawnStreamWindow } from "../stream.ts";
import { runOverlayStream, type WatchLang } from "../overlay.ts";
import { freePort, attachToPage } from "../cdp.ts";
import { writeWatchPidfile } from "../liveness.ts";
import { getFlag } from "./_lib.ts";

// `sportsball fifa watch [team] [team] [--wait] [--provider peacock|fubo] [--url <link>] [--overlay] [--lang english|spanish]`
// Opens the broadcast in a persistent-profile Chrome window via ui-leaf.
//   --wait      block until the match is live, then open it (deep-links to the
//               game with the overlay). With no team, waits for the NEXT match —
//               i.e. `sportsball fifa watch --wait` = "open the next game when it
//               goes live". Polls ESPN's state (the prompt live signal), not the
//               lagging football-data feed behind `live`.
//   --url       jump straight to a specific game link (skips the hub)
//   --provider  override the configured default (config.streamProvider, else fubo)
//   --overlay   inject a live-stats panel onto the page via CDP (interactive; needs ui-leaf >=1.5)
//   --lang      preferred broadcast language (english|spanish, default english) — biases
//               deep-linking on providers (Fubo) that carry both Fox & Telemundo airings
export async function watch(args: string[]) {
  const url = getFlag(args, "--url"); // throws if --url has no value
  const providerFlag = getFlag(args, "--provider");
  const overlay = args.includes("--overlay");
  const wait = args.includes("--wait");
  const sizeFlag = getFlag(args, "--size"); // e.g. --size 660x500
  const windowSize = parseSize(sizeFlag);
  if (sizeFlag && !windowSize) {
    console.warn(c.yellow(`Ignoring --size "${sizeFlag}" — expected WxH, e.g. 660x500. Opening at the default size.`));
  }

  // Preferred broadcast language (default english). Validated like --provider.
  const langFlag = getFlag(args, "--lang"); // throws if --lang has no value
  let lang: WatchLang = "english";
  if (langFlag) {
    const v = langFlag.toLowerCase();
    if (v === "english" || v === "spanish") {
      lang = v; // positive check narrows v to WatchLang
    } else {
      console.error(c.red(`Unknown language "${langFlag}". Known: english, spanish.`));
      process.exitCode = 1;
      return;
    }
  }

  const terms = positionalTerms(args);

  // Default to Fubo (English/Fox). Peacock is Spanish-only (Telemundo).
  const key = (providerFlag ?? (await getStreamProvider()) ?? "fubo").toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    console.error(c.red(`Unknown provider "${key}". Known: ${Object.keys(PROVIDERS).join(", ")}.`));
    process.exitCode = 1;
    return;
  }

  // `watch` opens a window and BLOCKS until you close it (or Ctrl-C). With no
  // controlling TTY — an agent/build smoke-test, `< /dev/null` — nothing ever
  // closes it, so it would hang forever holding a Chrome + ui-leaf process tree.
  // Guard that: without a TTY, either run a bounded --smoke (open → confirm → tear
  // down → exit 0) or refuse with a message naming the alternatives.
  // --smoke is bounded (open → confirm → tear down → exit) and works in ANY
  // context, TTY or not — an operator in a terminal can smoke-test too.
  if (args.includes("--smoke")) return smokeWatch(url ?? provider.hub, provider.label, windowSize);
  // With no controlling TTY, watch would block forever with nothing to close it —
  // refuse, UNLESS --supervised: the agent-setup supervisor deliberately backgrounds
  // `watch --wait --supervised` and reaps it via the pidfile, so the long block is
  // intentional and managed. The guard only catches ACCIDENTAL non-interactive hangs
  // (e.g. a build smoke-test), not the supervised path.
  if (process.stdin.isTTY !== true && !args.includes("--supervised")) {
    console.error(c.yellow("`watch` is interactive — it opens a stream window and blocks until you close it, so it isn't usable in scripts or smoke-tests."));
    console.error(c.dim("Run it in a terminal; use `--smoke` to just confirm the window opens; or `--supervised` for a pidfile-managed background watcher (what `/loop agent-setup` uses)."));
    process.exitCode = 1;
    return;
  }

  // --wait: block until a match is live, then open it. The whole point is to
  // open THE GAME, which needs the deep-link path (overlay), so --wait always
  // opens with the overlay + auto-navigation regardless of --overlay.
  if (wait) {
    // Record liveness so a supervisor (agent-setup --check / /loop agent-setup)
    // can detect a silent death and restart. Removed on exit/SIGINT/SIGTERM.
    writeWatchPidfile();
    const ev = await waitForLive(terms);
    await runOverlayStream(url ?? provider.hub, provider.label, ev, { deepLink: !url, windowSize, lang });
    return;
  }

  // --overlay needs a resolved match (for the panel's stats + head-to-head).
  if (overlay) {
    if (terms.length === 0) {
      console.error(c.red("Usage: sportsball fifa watch <team> [team] --overlay [--provider] [--url]   (or add --wait to wait for the next game)"));
      process.exitCode = 1;
      return;
    }
    const ev = await findCurrentMatch(terms);
    if (!ev) {
      console.error(c.yellow(`No match found for "${terms.join(" ")}".`));
      process.exitCode = 1;
      return;
    }
    // deep-link only when we opened the hub (no explicit --url to honor).
    await runOverlayStream(url ?? provider.hub, provider.label, ev, { deepLink: !url, windowSize, lang });
    return;
  }

  // Direct link wins — open it straight away (no match lookup needed).
  if (url) {
    await launchStream(url, provider.label, { windowSize });
    return;
  }

  if (terms.length === 0) {
    console.error(c.red("Usage: sportsball fifa watch <team> [team] [--wait] [--provider peacock|fubo] [--url <link>] [--overlay] [--lang english|spanish] [--smoke] [--supervised]"));
    console.error(c.dim("For a hands-off agent-driven session (open the game + answer Ask Claude / catchup), use  /loop agent-setup  — see  sportsball fifa agent-setup"));
    process.exitCode = 1;
    return;
  }

  // Resolve the match for context (and to fail clearly on a bad team name).
  const ev = await findCurrentMatch(terms);
  if (!ev) {
    console.error(c.yellow(`No match found for "${terms.join(" ")}".`));
    process.exitCode = 1;
    return;
  }

  // No per-game deep-link API exists for these providers, so open the provider's
  // hub and let the user pick the game (use --url for a known direct link).
  console.log(c.dim(`${ev.name} — opening ${provider.label}'s hub (use --url for a direct game link).`));
  await launchStream(provider.hub, provider.label, { windowSize });
}

/** Poll ESPN until the target match goes live, then return it. The target is the
 *  live-or-soonest match for `terms` (or any match if `terms` is empty). Polls
 *  faster as kickoff nears. Blocks indefinitely (Ctrl-C to stop) — meant to be
 *  left running. */
async function waitForLive(terms: string[]): Promise<EspnEvent> {
  const who = terms.length ? `"${terms.join(" ")}"` : "the next match";
  console.log(c.bold(c.cyan(`⌛ Waiting for ${who} to go live…`)) + c.dim("  (Ctrl-C to stop)"));
  let lastName = "";
  for (;;) {
    let target: EspnEvent | null = null;
    try {
      target = await resolveWatchTarget(terms);
    } catch (e) {
      console.error(c.dim("  (data fetch failed, retrying) " + (e instanceof Error ? e.message : String(e))));
    }

    if (target?.state === "in") {
      console.log(c.green(`● ${target.name} is LIVE — opening…`));
      return target;
    }

    let pollMs = 60_000;
    if (!target) {
      console.log(c.dim(`  Nothing scheduled for ${who} yet — checking again in 60s.`));
    } else {
      if (target.name !== lastName) {
        console.log(c.dim(`  Next up: ${target.name}`));
        lastName = target.name;
      }
      const ms = Date.parse(target.date) - Date.now();
      const eta = ms > 0 ? `kicks off in ${fmtEta(ms)}` : "at/just past kickoff — waiting for it to flip live";
      console.log(c.dim(`  ${eta}.`));
      if (ms <= 5 * 60_000) pollMs = 15_000; // tighten near kickoff (and once past it)
      else if (ms <= 15 * 60_000) pollMs = 30_000;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Coarse human ETA: "1h 4m", "12m 30s", or "45s". */
function fmtEta(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`;
}

/**
 * `watch --smoke`: prove the window-launch path works without blocking. Opens the
 * stream window with a debug port, confirms Chrome came up + CDP is reachable,
 * then tears it down and exits. Bounded (CDP attach has its own timeout) and
 * leaves no survivors — win.close() reaps the ui-leaf/Chrome tree.
 */
async function smokeWatch(url: string, label: string, windowSize: { width: number; height: number } | undefined): Promise<void> {
  const port = await freePort();
  const win = await spawnStreamWindow(url, label, { debugPort: port, windowSize });
  if (!win) {
    process.exitCode = 1; // ui-leaf missing — spawnStreamWindow already explained
    return;
  }
  try {
    const session = await attachToPage(port, 15_000); // confirms the window + CDP came up
    session.close();
    console.log(c.green(`✓ watch --smoke: ${label} window opened and CDP attached — tearing it down.`));
  } catch (e) {
    console.error(c.yellow(`watch --smoke: the window/CDP didn't come up in time — ${e instanceof Error ? e.message : String(e)}`));
    process.exitCode = 1;
  } finally {
    win.close();
  }
}

/** Parse a `WxH` size string into a window size, or undefined if absent/invalid. */
function parseSize(s: string | null): { width: number; height: number } | undefined {
  const m = s?.match(/^(\d+)x(\d+)$/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** Positional args, dropping flags and the values consumed by --url / --provider / --size. */
function positionalTerms(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--url" || a === "--provider" || a === "--size" || a === "--lang") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}
