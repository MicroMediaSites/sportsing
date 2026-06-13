import { c } from "../ansi.ts";
import { findCurrentMatch } from "../espn.ts";
import { getStreamProvider } from "../config.ts";
import { PROVIDERS, launchStream } from "../stream.ts";
import { runOverlayStream } from "../overlay.ts";
import { getFlag } from "./_lib.ts";

// `sportsball fifa watch <team> [team] [--provider peacock|fubo] [--url <link>] [--overlay]`
// Opens the broadcast in a persistent-profile Chrome window via ui-leaf.
//   --url       jump straight to a specific game link (skips the hub)
//   --provider  override the configured default (config.streamProvider, else fubo)
//   --overlay   inject a live-stats panel onto the page via CDP (interactive; needs ui-leaf >=1.5)
export async function watch(args: string[]) {
  const url = getFlag(args, "--url"); // throws if --url has no value
  const providerFlag = getFlag(args, "--provider");
  const overlay = args.includes("--overlay");
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

  // --overlay needs a resolved match (for the panel's stats + head-to-head).
  if (overlay) {
    if (terms.length === 0) {
      console.error(c.red("Usage: sportsball fifa watch <team> [team] --overlay [--provider] [--url]"));
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
    console.error(c.red("Usage: sportsball fifa watch <team> [team] [--provider peacock|fubo] [--url <link>] [--overlay]"));
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
