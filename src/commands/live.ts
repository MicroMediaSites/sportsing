import { c } from "../ansi.ts";
import { getMatches, NoKeyError } from "../api.ts";
import { matchLine, fmtTimeOnly, stageLabel } from "../format.ts";
import { ymd, addDays, localDateOf, sortByDate } from "./_lib.ts";
import { getFavorites } from "../config.ts";
import { diffEvents, type MatchEvent } from "../events.ts";
import { notify } from "../notify.ts";
import { matchHasTeam } from "../match-util.ts";
import type { Match } from "../types.ts";

const REFRESH_MS = 60_000; // free tier note: scores are delayed; 60s is plenty.

export async function live(args: string[] = []) {
  const wantNotify = args.includes("--notify");
  const wantQuiet = args.includes("--quiet");

  // --quiet is only meaningful as an ambient alerter — it suppresses the screen
  // UI, so without --notify it would do nothing visible at all.
  if (wantQuiet && !wantNotify) {
    console.error(c.yellow("--quiet only makes sense with --notify (it hides the live view)."));
    console.error(c.dim("Try: sportsball fifa live --notify --quiet &"));
    return;
  }

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

  let favorites: string[] = [];
  if (wantNotify) {
    favorites = await getFavorites();
    if (favorites.length === 0) {
      // --notify with no favourites would silently never alert; say so once.
      // All on stderr so --quiet keeps stdout clean for backgrounding.
      console.error(c.yellow("--notify is on but you have no favorite teams — you won't get alerts."));
      console.error(c.dim("Add one with ") + c.bold("sportsball fifa fav add USA") + c.dim(" to get alerts."));
      console.error("");
    }
  }

  // In quiet mode there's no screen UI, so print one startup line (to stderr, so
  // stdout stays clean for backgrounding) confirming the alerter is running.
  if (wantQuiet) {
    const who = favorites.length ? favorites.join(", ") : "no favorites set";
    console.error(c.dim(`Favorite-team alerts running (${who}) — Ctrl-C to stop.`));
  }

  // Previous tick's full snapshot of today's matches, for fav-event diffing.
  // diffEvents only emits transitions between prev→cur, so an event fires once
  // and never re-alerts on a later unchanged tick (AGT-507 idempotency).
  let prevSnapshot: Match[] = [];

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

    // Full-screen scoreboard — skipped in --quiet so the command can be
    // backgrounded without alt-screen clears corrupting the parent shell.
    if (!wantQuiet) {
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
        if (upcoming.length > 6) console.log(c.dim(`  … and ${upcoming.length - 6} more`));
        console.log();
      }
      if (done.length) {
        console.log(c.bold(c.dim("Finished today")));
        for (const m of done.sort(sortByDate)) console.log("  " + matchLine(m));
      }
    }

    if (wantNotify) {
      // Diff this snapshot against the previous tick's and alert on new fav
      // events. The first tick has an empty prevSnapshot, so it only establishes
      // a baseline (a match already in play when you start raises no kickoff).
      for (const e of diffEvents(prevSnapshot, matches, favorites)) {
        const { title, body } = formatEvent(e);
        // Kickoff alerts are click-to-watch: clicking launches `watch <fav team>`
        // (terminal-notifier -execute). notify() degrades to a plain, non-clickable
        // notification when terminal-notifier is absent. Goal/full-time stay informational.
        const onClick = kickoffWatchCommand(e, matches, favorites, process.execPath);
        notify(title, body, { group: `sportsball-${e.matchId}`, sound: e.kind === "goal", onClick });
      }
      prevSnapshot = matches;
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

function stageTag(m: Match): string {
  return c.dim("  " + stageLabel(m));
}

/** POSIX single-quote a string so it's safe as one shell argument. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The click-to-watch command for a kickoff event, or undefined when none applies.
 * Returns `<exe> fifa watch <fav>` (shell-quoted) where `fav` is the favourite
 * term that put this match on the alert list — so clicking the kickoff alert opens
 * that team's broadcast. Only kickoff events are clickable (goal/full-time are
 * informational); returns undefined if the match or a matching favourite is gone.
 */
export function kickoffWatchCommand(
  e: MatchEvent,
  matches: Match[],
  favorites: string[],
  exe: string,
): string | undefined {
  if (e.kind !== "kickoff") return undefined;
  const match = matches.find((m) => m.id === e.matchId);
  if (!match) return undefined;
  const fav = favorites.find((f) => matchHasTeam(match, f.trim().toLowerCase()));
  if (!fav) return undefined;
  return `${shQuote(exe)} fifa watch ${shQuote(fav)}`;
}

/** Notification title + body for a fav match event. */
function formatEvent(e: MatchEvent): { title: string; body: string } {
  const scoreline = `${e.home} ${e.score.home}–${e.score.away} ${e.away}`;
  switch (e.kind) {
    case "kickoff":
      return { title: "⚽ Kickoff", body: `${e.fixture} has kicked off` };
    case "goal": {
      const scorer = e.scoringSide === "home" ? e.home : e.away;
      return { title: `⚽ GOAL — ${scorer}`, body: scoreline };
    }
    case "full-time":
      return { title: "Full time", body: scoreline };
  }
}
