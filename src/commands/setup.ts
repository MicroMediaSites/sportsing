import { c } from "../ansi.ts";
import { setApiKey, getApiKey, CONFIG_FILE } from "../config.ts";

export async function setup(args: string[]) {
  // Non-interactive: `sportsball setup <key>`
  const inline = args.find((a) => !a.startsWith("--"));

  console.log(c.bold(c.cyan("⚽ sportsball setup")));
  console.log(
    "\nLive data comes from " +
      c.underline("football-data.org") +
      " (free tier: World Cup, 10 req/min).",
  );
  console.log("Get a free key in ~30s: " + c.cyan("https://www.football-data.org/client/register") + "\n");

  let key = inline ?? null;
  if (!key) {
    key = (prompt("Paste your API key (or leave blank to cancel):") ?? "").trim();
  }
  if (!key) {
    const existing = await getApiKey();
    console.log(c.dim(existing ? "Cancelled — existing key kept." : "Cancelled — no key set."));
    return;
  }

  process.stdout.write("Validating… ");
  const res = await fetch("https://api.football-data.org/v4/competitions/WC", {
    headers: { "X-Auth-Token": key },
  });
  if (!res.ok) {
    console.log(c.red(`failed (HTTP ${res.status}).`));
    console.log(c.yellow("Key looks invalid or lacks World Cup access. Not saved."));
    process.exitCode = 1;
    return;
  }
  console.log(c.green("ok ✓"));
  await setApiKey(key);
  console.log(c.dim(`Saved to ${CONFIG_FILE}`));
  console.log("\nTry: " + c.bold("sportsball today") + " · " + c.bold("sportsball next") + " · " + c.bold("sportsball bracket"));
}
