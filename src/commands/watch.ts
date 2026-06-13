import { c } from "../ansi.ts";
import { findEvent } from "../espn.ts";
import { getStreamProvider } from "../config.ts";
import { PROVIDERS, launchStream } from "../stream.ts";
import { getFlag } from "./fixtures.ts";

// `sportsball fifa watch <team> [team] [--provider peacock|fubo] [--url <link>]`
// Opens the broadcast in a persistent-profile Chrome window via ui-leaf.
//   --url   jump straight to a specific game link (skips the hub)
//   --provider  override the configured default (config.streamProvider, else peacock)
export async function watch(args: string[]) {
  const url = getFlag(args, "--url"); // throws if --url has no value
  const providerFlag = getFlag(args, "--provider");
  const terms = positionalTerms(args);

  const key = (providerFlag ?? (await getStreamProvider()) ?? "peacock").toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    console.error(c.red(`Unknown provider "${key}". Known: ${Object.keys(PROVIDERS).join(", ")}.`));
    process.exitCode = 1;
    return;
  }

  // Direct link wins — open it straight away (no match lookup needed).
  if (url) {
    await launchStream(url, provider.label);
    return;
  }

  if (terms.length === 0) {
    console.error(c.red("Usage: sportsball fifa watch <team> [team] [--provider peacock|fubo] [--url <link>]"));
    process.exitCode = 1;
    return;
  }

  // Resolve the match for context (and to fail clearly on a bad team name).
  const ev = await findEvent(terms);
  if (!ev) {
    console.log(c.dim(`No match found for "${terms.join(" ")}".`));
    return;
  }

  // No per-game deep-link API exists for these providers, so open the provider's
  // hub and let the user pick the game (use --url for a known direct link).
  console.log(c.dim(`${ev.name} — opening ${provider.label}'s hub (use --url for a direct game link).`));
  await launchStream(provider.hub, provider.label);
}

/** Positional args, dropping flags and the values consumed by --url / --provider. */
function positionalTerms(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--url" || a === "--provider") {
      i++; // skip its value
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}
