// Favorite-team alerts for the ESPN-backed leagues (NBA, NHL, club soccer): successive
// scoreboard polls → game-events.ts rules → notifications. Pure — the live
// command (league.ts) does the fetching, config reads, and notify() calls.
//
// Start-of-game alerts (tip-off / puck drop) are click-to-watch, routed like
// `<sport> watch`: a game you can stream (Fubo, League Pass, or the configured
// provider) opens `watch` on click; an over-the-air-only game names its
// channel and has nothing to click into; an unwatchable one says why.

import type { Alert } from "./alerts.ts";
import { inTerminal, watchCommand } from "./click-to-watch.ts";
import { periodLabel, type PeriodNaming } from "./format.ts";
import { diffGames, isSoccerSport, type GameEvent, type GameMemory, type GameSport } from "./game-events.ts";
import type { Game, SeasonPhase } from "./game.ts";
import { planWatch, watchOf, type WatchContext } from "./watch-route.ts";

/** A league as the alerts see it. */
export interface AlertLeague {
  sport: GameSport;
  icon: string;
  /** Period naming (NHL); without it, period text comes from the source. */
  periods?: PeriodNaming;
}

/** "UTAH 3–2 DEN" — away first, matching the "away @ home" fixture. */
function scoreline(e: GameEvent): string {
  return `${e.away} ${e.score.away}–${e.score.home} ${e.home}`;
}

/** Soccer reads home first ("PSG 2–1 Lyon"), as the FIFA alerts do. */
function soccerScoreline(e: GameEvent): string {
  return `${e.home} ${e.score.home}–${e.score.away} ${e.away}`;
}

/** Club-soccer notification text. Goals name the scorer and minute when the
 *  scoreboard lists them, else just the score; full time says so on a draw. */
function formatSoccerEvent(e: GameEvent, t: (text: string) => string): { title: string; body: string; sound: boolean } {
  const line = soccerScoreline(e);
  const team = (side?: "home" | "away") => (side === "home" ? e.home : e.away);
  switch (e.kind) {
    case "kickoff":
      return { title: t("Kickoff"), body: `${e.home} v ${e.away} has kicked off`, sound: false };
    case "goal": {
      const how = e.ownGoal ? " (own goal)" : e.penalty ? " (pen)" : "";
      const who = e.player ? `${e.player} ${e.minute}${how}` : "";
      return { title: t(`GOAL — ${team(e.scoringSide)}`), body: who ? `${line} · ${who}` : line, sound: true };
    }
    case "red-card": {
      const who = e.player ? ` (${[e.player, e.minute].filter(Boolean).join(" ")})` : "";
      return { title: t(`RED CARD — ${team(e.cardSide)}${who}`), body: line, sound: true };
    }
    case "halftime":
      return { title: t("Half time"), body: line, sound: false };
    case "full-time": {
      const draw = e.score.home === e.score.away;
      return { title: t(draw ? "Full time — draw" : "Full time"), body: line, sound: false };
    }
    default:
      return { title: t(e.detail), body: line, sound: false };
  }
}

/** Name of the event's period ("2nd", "OT", "2OT"), else the source's text. */
function periodName(e: GameEvent, seasonType: SeasonPhase, periods?: PeriodNaming): string {
  return periods ? periodLabel({ period: e.period, seasonType }, periods) : e.detail;
}

/** Notification text for one game event, and whether it plays a sound. */
export function formatGameEvent(
  e: GameEvent,
  seasonType: SeasonPhase,
  league: Pick<AlertLeague, "icon" | "periods"> & Partial<Pick<AlertLeague, "sport">>,
): { title: string; body: string; sound: boolean } {
  const t = (text: string) => `${league.icon} ${text}`;
  const line = scoreline(e);
  if (league.sport && isSoccerSport(league.sport)) return formatSoccerEvent(e, t);
  switch (e.kind) {
    case "tip-off":
      return { title: t("Tip-off"), body: `${e.fixture} is under way`, sound: false };
    case "puck-drop":
      return { title: t("Puck drop"), body: `${e.fixture} is under way`, sound: false };
    case "goal":
      return { title: t(`GOAL — ${e.scoringSide === "home" ? e.home : e.away}`), body: line, sound: true };
    case "period-end":
      return { title: t(`End of ${periodName(e, seasonType, league.periods)}`), body: line, sound: false };
    case "overtime":
      return { title: t(`Overtime (${periodName(e, seasonType, league.periods)})`), body: line, sound: false };
    case "shootout":
      return { title: t("Shootout"), body: line, sound: false };
    case "lead-change":
      return { title: t(`Lead change — ${e.leader === "home" ? e.home : e.away}`), body: `${line} · ${e.detail}`, sound: false };
    case "close-late":
      return { title: t("Close game late"), body: `${line} · ${e.detail}`, sound: true };
    case "kickoff":
    case "halftime":
    case "red-card":
    case "full-time":
      return formatSoccerEvent(e, t);
    case "final":
      return { title: t(e.detail.startsWith("Final") ? e.detail : "Final"), body: line, sound: false };
  }
}

/** Where a click-to-watch start alert can take you. */
export interface StartWatch {
  /** `sportsing <sport> watch <team>` (shell) when there's a stream to open. */
  command?: string;
  /** Where it's on, or why it can't be opened, e.g. "📺 Utah 16 — over the air". */
  note?: string;
}

/**
 * The click action for a favorite's game starting, mirroring what
 * `<sport> watch <team>` would do. With subscriptions set (`watch`), the
 * resolver decides: an openable service is clickable, over-the-air or
 * unwatchable isn't (the note says why). Without them, it's clickable only if
 * there's a provider to fall back to — the same one `watch` would open.
 */
export function startWatch(
  g: Game,
  favIds: ReadonlySet<string>,
  sport: GameSport,
  watch: WatchContext | null,
  fallback: string | null,
  exe: string[],
): StartWatch {
  const fav = [g.away, g.home].find((t) => favIds.has(t.id));
  if (!fav) return {};
  const command = watchCommand(exe, sport, fav.id);
  if (!watch) return fallback ? { command } : {};
  const plan = planWatch(watchOf(g, watch), fallback);
  if (plan.kind === "open") return { command, note: `📺 ${plan.note}` };
  return { note: plan.kind === "tune" ? `📺 ${plan.message}` : `✗ ${plan.message}` };
}

export interface LeagueFeedOptions {
  league: AlertLeague;
  /** ESPN ids of the favorite teams. */
  favIds: ReadonlySet<string>;
  /** Subscriptions + home market, or null when none are configured. */
  watch: WatchContext | null;
  /** Provider `watch` falls back to (configured, else the league default). */
  fallback: string | null;
  /** argv that runs sportsing (see selfInvocation). */
  exe: string[];
}

/**
 * A stateful alert feed: hand it each poll's games (any teams — it keeps the
 * favorites' games) and it returns the alerts since the previous poll. The
 * first poll sets the baseline and alerts nothing. Holds the previous
 * snapshot and the sport's GameMemory across polls.
 */
export function leagueFeed(o: LeagueFeedOptions): (games: Game[]) => Alert[] {
  let prev: Game[] = [];
  const memory: GameMemory = new Map();
  return (games) => {
    const cur = games.filter((g) => o.favIds.has(g.home.id) || o.favIds.has(g.away.id));
    const events = diffGames(prev, cur, o.league.sport, memory);
    prev = cur;
    return events.map((e) => {
      const g = cur.find((x) => x.id === e.gameId)!;
      const { title, body, sound } = formatGameEvent(e, g.seasonType, o.league);
      const start = e.kind === "tip-off" || e.kind === "puck-drop" || e.kind === "kickoff";
      const click = start ? startWatch(g, o.favIds, o.league.sport, o.watch, o.fallback, o.exe) : {};
      return {
        title,
        body,
        options: {
          group: `sportsing-${o.league.sport}-${e.gameId}`,
          sound,
          subtitle: click.note,
          onClick: click.command && inTerminal(click.command),
        },
      };
    });
  };
}
