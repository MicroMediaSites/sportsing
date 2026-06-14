import { c } from "../ansi.ts";
import { findCurrentMatch, resolveWatchTarget, type EspnEvent } from "../espn.ts";
import { getStreamProvider } from "../config.ts";
import { PROVIDERS, launchStream } from "../stream.ts";
import { runOverlayStream } from "../overlay.ts";
import { getFlag } from "./_lib.ts";

// `sportsball fifa watch [team] [team] [--wait] [--provider peacock|fubo] [--url <link>] [--overlay]`
// Opens the broadcast in a persistent-profile Chrome window via ui-leaf.
//   --wait      block until the match is live, then open it (deep-links to the
//               game with the overlay). With no team, waits for the NEXT match —
//               i.e. `sportsball fifa watch --wait` = "open the next game when it
//               goes live". Polls ESPN's state (the prompt live signal), not the
//               lagging football-data feed behind `live`.
//   --url       jump straight to a specific game link (skips the hub)
//   --provider  override the configured default (config.streamProvider, else fubo)
//   --overlay   inject a live-stats panel onto the page via CDP (interactive; needs ui-leaf >=1.5)
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
  const terms = positionalTerms(args);

  // Default to Fubo (English/Fox). Peacock is Spanish-only (Telemundo).
  const key = (providerFlag ?? (await getStreamProvider()) ?? "fubo").toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    console.error(c.red(`Unknown provider "${key}". Known: ${Object.keys(PROVIDERS).join(", ")}.`));
    process.exitCode = 1;
    return;
  }

  // --wait: block until a match is live, then open it. The whole point is to
  // open THE GAME, which needs the deep-link path (overlay), so --wait always
  // opens with the overlay + auto-navigation regardless of --overlay.
  if (wait) {
    const ev = await waitForLive(terms);
    await runOverlayStream(url ?? provider.hub, provider.label, ev, { deepLink: !url, windowSize });
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
    await runOverlayStream(url ?? provider.hub, provider.label, ev, { deepLink: !url, windowSize });
    return;
  }

  // Direct link wins — open it straight away (no match lookup needed).
  if (url) {
    await launchStream(url, provider.label, { windowSize });
    return;
  }

  if (terms.length === 0) {
    console.error(c.red("Usage: sportsball fifa watch <team> [team] [--wait] [--provider peacock|fubo] [--url <link>] [--overlay]"));
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
    if (a === "--url" || a === "--provider" || a === "--size") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}
