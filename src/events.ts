// Pure match-snapshot diffing: turn two successive score polls into discrete
// favourite-team events (kickoff / goal / full-time). No I/O — the live tick
// (AGT-508) holds the previous snapshot and feeds successive polls in here, then
// routes the returned events to notify(). Idempotent: diffing a snapshot against
// itself yields nothing, so the same transition never alerts twice.

import { teamLabel } from "./format.ts";
import type { Match, MatchStatus } from "./types.ts";

export type MatchEventKind = "kickoff" | "goal" | "full-time";

export interface MatchEvent {
  kind: MatchEventKind;
  matchId: number;
  /** Short fixture label, e.g. "USA vs ENG". */
  fixture: string;
  home: string;
  away: string;
  /** Scoreline at the moment of the event (0–0 at kickoff, final at full-time). */
  score: { home: number; away: number };
  /** For goals only: which side scored. */
  scoringSide?: "home" | "away";
}

const PRE: ReadonlySet<MatchStatus> = new Set(["SCHEDULED", "TIMED"]);
const LIVE: ReadonlySet<MatchStatus> = new Set(["IN_PLAY", "PAUSED"]);
const POST: ReadonlySet<MatchStatus> = new Set(["FINISHED", "AWARDED"]);

/** Current goals for each side, treating a not-yet-reported score as 0. */
function goalsOf(m: Match): { home: number; away: number } {
  return { home: m.score.fullTime.home ?? 0, away: m.score.fullTime.away ?? 0 };
}

/** True if either side of the match matches `needle` (lowercased) by name/tla/shortName.
 *  Local to keep this module pure and dependency-light; mirrors the field set in
 *  commands/_lib.ts `matchHasTeam` so favourites resolve the same way as `--mine`. */
function involvesTeam(m: Match, needle: string): boolean {
  const fields = [
    m.homeTeam.name,
    m.homeTeam.tla,
    m.homeTeam.shortName,
    m.awayTeam.name,
    m.awayTeam.tla,
    m.awayTeam.shortName,
  ];
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

/**
 * Diff two match-list snapshots into favourite-team events.
 *
 * - `kickoff`   — status moved pre (SCHEDULED/TIMED) → live (IN_PLAY/PAUSED)
 * - `goal`      — a side's goal count increased (one event per side that scored)
 * - `full-time` — status moved live → post (FINISHED/AWARDED)
 *
 * Only matches involving a favourite team are considered. A match must appear in
 * both snapshots (keyed by id) to diff a transition; brand-new entries are skipped
 * until there is a prior state to compare against. Pure and order-stable.
 *
 * Polling-model caveat: at most one `goal` event is emitted per side per tick.
 * If a side's count jumps by more than one between polls (a multi-goal burst in
 * one interval), it collapses to a single event carrying the resulting scoreline —
 * the intermediate goals are not reconstructable from two snapshots.
 */
export function diffEvents(prev: Match[], cur: Match[], favorites: string[]): MatchEvent[] {
  const favs = favorites.map((f) => f.trim().toLowerCase()).filter(Boolean);
  if (favs.length === 0) return [];

  const prevById = new Map(prev.map((m) => [m.id, m]));
  const events: MatchEvent[] = [];

  for (const m of cur) {
    if (!favs.some((n) => involvesTeam(m, n))) continue;
    const before = prevById.get(m.id);
    if (!before) continue; // need a prior state to diff a transition

    const base = {
      matchId: m.id,
      fixture: `${teamLabel(m.homeTeam)} vs ${teamLabel(m.awayTeam)}`,
      home: teamLabel(m.homeTeam),
      away: teamLabel(m.awayTeam),
    };
    const score = goalsOf(m);

    if (PRE.has(before.status) && LIVE.has(m.status)) {
      events.push({ kind: "kickoff", ...base, score });
    }

    const wasScore = goalsOf(before);
    if (score.home > wasScore.home) events.push({ kind: "goal", ...base, score, scoringSide: "home" });
    if (score.away > wasScore.away) events.push({ kind: "goal", ...base, score, scoringSide: "away" });

    if (LIVE.has(before.status) && POST.has(m.status)) {
      events.push({ kind: "full-time", ...base, score });
    }
  }

  return events;
}
