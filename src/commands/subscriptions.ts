import { c } from "../ansi.ts";
import {
  getSubscriptions,
  setSubscriptions,
  getHomeMarket,
  setHomeMarket,
  parseSubscriptions,
  parseHomeMarket,
  CONFIG_FILE,
} from "../config.ts";
import { SUBSCRIPTIONS, SUBSCRIPTION_LABELS, HOME_MARKETS } from "../watchability.ts";

// `sportsing subscriptions [set <ids…> | market <id>]` — what you can watch
// with, and where you live (for blackouts and local channels). Cross-sport:
// the same Fubo / antenna covers every league.
export async function subscriptions(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (!sub || sub === "list" || sub === "show") return show();

  if (sub === "set") {
    if (rest.length === 0) return usage("subscriptions set <" + SUBSCRIPTIONS.join("|") + "|none>…");
    const none = rest.length === 1 && rest[0]!.trim().toLowerCase() === "none";
    const { subscriptions: subs, invalid } = none ? { subscriptions: [], invalid: [] } : parseSubscriptions(rest);
    if (invalid.length) {
      console.error(c.red(`Unknown subscription: ${invalid.join(", ")}`) + c.dim(` (choose from ${SUBSCRIPTIONS.join(", ")})`));
      process.exitCode = 1;
      return;
    }
    await setSubscriptions(subs);
    console.log(c.green("✓ Saved.") + c.dim(` (${CONFIG_FILE})`));
    return show();
  }

  if (sub === "market") {
    const input = rest.join(" ").trim();
    if (!input) return usage("subscriptions market <" + Object.keys(HOME_MARKETS).join("|") + ">");
    const market = parseHomeMarket(input);
    if (!market) {
      console.error(c.red(`Unknown home market: ${input}`) + c.dim(` (choose from ${Object.keys(HOME_MARKETS).join(", ")})`));
      process.exitCode = 1;
      return;
    }
    await setHomeMarket(market);
    console.log(c.green("✓ Saved.") + c.dim(` (${CONFIG_FILE})`));
    return show();
  }

  usage("subscriptions [set <ids…> | market <id>]");
}

async function show(): Promise<void> {
  const [subs, market] = await Promise.all([getSubscriptions(), getHomeMarket()]);
  console.log(c.bold(c.cyan("📺 Subscriptions")));
  if (subs.length === 0) {
    console.log(c.dim("  none yet — e.g. ") + c.bold("sportsing subscriptions set fubo nba-league-pass local-ota"));
  } else {
    for (const s of subs) console.log(`  ${s} ${c.dim("— " + SUBSCRIPTION_LABELS[s])}`);
  }
  console.log(c.bold("Home market: ") + (HOME_MARKETS[market]?.name ?? market) + c.dim(`  (${Object.keys(HOME_MARKETS).join(", ")})`));
}

function usage(form: string): void {
  console.error(c.red(`Usage: sportsing ${form}`));
  process.exitCode = 1;
}
