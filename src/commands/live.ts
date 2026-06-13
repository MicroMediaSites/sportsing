import { c } from "../ansi.ts";
import { getMatches, NoKeyError } from "../api.ts";
import { matchLine, fmtTimeOnly, groupName, STAGE_LABELS } from "../format.ts";
import { ymd, addDays, localDateOf, sortByDate } from "./_lib.ts";

const REFRESH_MS = 60_000; // free tier note: scores are delayed; 60s is plenty.

export async function live() {
  // Quick key check before entering the loop.
  try {
    await getMatches({ status: "IN_PLAY" }, 0);
  } catch (e) {
    if (e instanceof NoKeyError) {
      console.error(c.yellow("Live scores need an API key. Run `sportsball setup` first."));
      return;
    }
    throw e;
  }

  const tick = async () => {
    const now = new Date();
    const today = ymd(now);
    // Query ±1 UTC day, then keep only matches on today's local calendar date
    // (a local day straddles two UTC days — see today.ts).
    const { matches: raw } = await getMatches(
      { dateFrom: ymd(addDays(now, -1)), dateTo: ymd(addDays(now, 1)) },
      20_000,
    );
    const matches = raw.filter((m) => localDateOf(m.utcDate) === today);
    const live = matches.filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
    const upcoming = matches
      .filter((m) => m.status === "TIMED" || m.status === "SCHEDULED")
      .sort(sortByDate);
    const done = matches.filter((m) => m.status === "FINISHED");

    process.stdout.write("\x1b[2J\x1b[H"); // clear + home
    console.log(c.bold(c.cyan("⚽ World Cup 2026 — LIVE")) + c.dim(`   ${new Date().toLocaleTimeString()}`));
    console.log(c.dim("Refreshing every 60s · Ctrl-C to quit\n"));

    if (live.length) {
      console.log(c.bold(c.green("● LIVE NOW")));
      for (const m of live.sort(sortByDate)) console.log("  " + matchLine(m) + stageTag(m));
      console.log();
    } else {
      console.log(c.dim("No matches in play right now.\n"));
    }

    if (upcoming.length) {
      console.log(c.bold("Later today"));
      for (const m of upcoming.slice(0, 6))
        console.log(`  ${c.cyan(fmtTimeOnly(m.utcDate).padEnd(8))} ${matchLine(m)}`);
      console.log();
    }
    if (done.length) {
      console.log(c.bold(c.dim("Finished today")));
      for (const m of done.sort(sortByDate)) console.log("  " + matchLine(m));
    }
  };

  await tick();
  const interval = setInterval(() => tick().catch((e) => console.error(c.red(String(e)))), REFRESH_MS);
  process.on("SIGINT", () => {
    clearInterval(interval);
    process.stdout.write("\n");
    process.exit(0);
  });
}

function stageTag(m: { stage: any; group: string | null }): string {
  const s = m.stage === "GROUP_STAGE" ? groupName(m.group) : STAGE_LABELS[m.stage as keyof typeof STAGE_LABELS];
  return s ? c.dim(`  ${s}`) : "";
}
