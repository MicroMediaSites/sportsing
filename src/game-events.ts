// Per-sport live event diffing over sport-neutral `Game` snapshots (NBA, NHL).
//
// The World Cup path keeps its own football-data `Match` differ (events.ts);
// this is the ESPN-backed sibling. Each sport gets a rule set, because what is
// alert-worthy differs: every NHL goal matters, every NBA basket would be noise
// (so NBA alerts on tip-off, lead changes, a close finish, and the final).
//
// Pure apart from the caller-owned `GameMemory`: the live tick holds the
// previous snapshot plus one memory map per sport, and feeds successive polls
// in here. Two NBA rules need more than two snapshots — a lead change bridged
// by a tie (home leads → tied → away leads) and "close-late fires once per
// game" — so they remember per-game facts in that map. Diffing a snapshot
// against itself yields nothing, with or without memory.

import type { Game } from "./game.ts";

export type GameEventKind =
  | "puck-drop"
  | "tip-off"
  | "goal"
  | "period-end"
  | "overtime"
  | "shootout"
  | "lead-change"
  | "close-late"
  | "final";

export type Side = "home" | "away";

export interface GameEvent {
  kind: GameEventKind;
  gameId: string;
  /** Short fixture label, away @ home, e.g. "UTAH @ DEN". */
  fixture: string;
  home: string;
  away: string;
  /** Score at the moment of the event. */
  score: { home: number; away: number };
  /** Period the event belongs to — for `period-end`, the period that ended. */
  period: number;
  /** Source status text of the newer snapshot, e.g. "End of 1st", "Final/SO". */
  detail: string;
  /** `goal`: which side scored. */
  scoringSide?: Side;
  /** `lead-change`: which side now leads. */
  leader?: Side;
}

/** Per-game facts a rule needs beyond the two snapshots being diffed. */
export interface GameMemo {
  /** NBA: the last side seen leading (ties don't clear it). */
  leader?: Side;
  /** NBA: close-late already fired (or was already true at baseline). */
  closeLate?: boolean;
}

/** Caller-owned, keyed by game id; one map per sport. Entries are tiny and
 *  are never pruned here — a game can drop out of one poll and come back. */
export type GameMemory = Map<string, GameMemo>;

/** What a rule emits; `diffGames` stamps on the shared game fields. */
type Emit = Pick<GameEvent, "kind" | "period"> & Partial<Pick<GameEvent, "scoringSide" | "leader">>;

/** One alert rule: the events for a single game moving `before` → `after`. */
type Rule = (before: Game, after: Game, memo: GameMemo) => Emit[];

// ── shared helpers ──────────────────────────────────────────────────────────

/** Numeric score, treating "" (not started) or junk as 0. */
const pts = (score: string): number => Number(score) || 0;

function scoreOf(g: Game): { home: number; away: number } {
  return { home: pts(g.home.score), away: pts(g.away.score) };
}

function leaderOf(g: Game): Side | undefined {
  const s = scoreOf(g);
  return s.home > s.away ? "home" : s.away > s.home ? "away" : undefined;
}

/** Seconds left on a game clock ("4:21", "0:00", NBA's sub-minute "45.3"),
 *  or undefined when there is no parseable clock. */
export function clockSeconds(clock: string): number | undefined {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(clock);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

/** Live with the clock run out — between periods (or at the final buzzer,
 *  before the source flips the game to "post"). */
const atPeriodEnd = (g: Game): boolean => g.state === "in" && clockSeconds(g.clock) === 0;

// Shared rules.

const start =
  (kind: "puck-drop" | "tip-off"): Rule =>
  (b, a) =>
    b.state === "pre" && a.state === "in" ? [{ kind, period: a.period }] : [];

const final: Rule = (b, a) => (b.state === "in" && a.state === "post" ? [{ kind: "final", period: a.period }] : []);

// ── NHL ─────────────────────────────────────────────────────────────────────

const NHL_REGULATION_PERIODS = 3;

/** A shootout is "period 5" outside the playoffs; playoff OT never ends in one. */
const inShootout = (g: Game): boolean => g.seasonType !== "postseason" && g.period > NHL_REGULATION_PERIODS + 1;

/**
 * One goal event per side whose score rose (a multi-goal burst between polls
 * collapses into one event with the resulting score). Skipped around a
 * shootout: ESPN credits the shootout winner's +1 only when the game goes
 * final, and that isn't a goal.
 */
const nhlGoals: Rule = (b, a) => {
  if (inShootout(b) || inShootout(a)) return [];
  const was = scoreOf(b);
  const now = scoreOf(a);
  const out: Emit[] = [];
  if (now.home > was.home) out.push({ kind: "goal", period: a.period, scoringSide: "home" });
  if (now.away > was.away) out.push({ kind: "goal", period: a.period, scoringSide: "away" });
  return out;
};

/**
 * End of a period: the clock hit 0:00 in a new snapshot, or the period number
 * advanced without us ever seeing the 0:00 snapshot (a poll gap). The
 * game-ending period is covered by `final`, and a shootout has no period end.
 */
const nhlPeriodEnd: Rule = (b, a) => {
  if (b.state !== "in" || a.state !== "in") return [];
  const out: Emit[] = [];
  if (a.period > b.period && !atPeriodEnd(b) && !inShootout(b)) out.push({ kind: "period-end", period: b.period });
  if (atPeriodEnd(a) && !inShootout(a) && !(atPeriodEnd(b) && b.period === a.period)) {
    out.push({ kind: "period-end", period: a.period });
  }
  return out;
};

/** Entering overtime (each playoff OT period) or the shootout. */
const nhlOvertime: Rule = (b, a) => {
  if (b.state !== "in" || a.state !== "in" || a.period <= b.period || a.period <= NHL_REGULATION_PERIODS) return [];
  return [{ kind: inShootout(a) ? "shootout" : "overtime", period: a.period }];
};

// ── NBA ─────────────────────────────────────────────────────────────────────

const NBA_FOURTH = 4;
const CLOSE_LATE_MARGIN = 5;
const CLOSE_LATE_SECONDS = 5 * 60;

/**
 * The lead switched sides. Ties don't count as a change, but they don't reset
 * the memory either, so home leads → tied → away leads (across polls) is one
 * lead change. Only while live; the final covers a last-gasp swing.
 */
const nbaLeadChange: Rule = (b, a, memo) => {
  const was = leaderOf(b);
  const now = leaderOf(a);
  memo.leader ??= was;
  const changed = a.state === "in" && now !== undefined && now !== was && memo.leader !== undefined && now !== memo.leader;
  if (now) memo.leader = now;
  return changed ? [{ kind: "lead-change", period: a.period, leader: now }] : [];
};

/** Live, in the 4th or any OT, ≤ 5:00 left, margin ≤ 5. */
function isCloseLate(g: Game): boolean {
  if (g.state !== "in" || g.period < NBA_FOURTH) return false;
  const left = clockSeconds(g.clock);
  if (left === undefined || left > CLOSE_LATE_SECONDS) return false;
  const s = scoreOf(g);
  return Math.abs(s.home - s.away) <= CLOSE_LATE_MARGIN;
}

/**
 * Close game late — once per game. If the earlier snapshot already qualified
 * (we started watching mid-crunch), that's the baseline: remember it, no alert.
 */
const nbaCloseLate: Rule = (b, a, memo) => {
  if (memo.closeLate) return [];
  if (isCloseLate(b)) {
    memo.closeLate = true;
    return [];
  }
  if (!isCloseLate(a)) return [];
  memo.closeLate = true;
  return [{ kind: "close-late", period: a.period }];
};

// ── rule sets + differ ──────────────────────────────────────────────────────

/** Alert rules per ESPN-backed sport, in emission order. */
export const GAME_RULES = {
  nhl: [start("puck-drop"), nhlGoals, nhlPeriodEnd, nhlOvertime, final],
  nba: [start("tip-off"), nbaLeadChange, nbaCloseLate, final],
} satisfies Record<string, Rule[]>;

export type GameSport = keyof typeof GAME_RULES;

/**
 * Diff two `Game` snapshots into events using `sport`'s rule set.
 *
 * A game must appear in both snapshots (keyed by id) to diff a transition;
 * brand-new entries are skipped until there is a prior state. Narrowing to
 * favourite teams is the caller's job (filter `cur` first). Pass the same
 * `memory` map on every tick for a sport so once-per-game rules hold across
 * polls; omitted, each call starts fresh.
 */
export function diffGames(prev: Game[], cur: Game[], sport: GameSport, memory: GameMemory = new Map()): GameEvent[] {
  const rules: Rule[] = GAME_RULES[sport];
  const prevById = new Map(prev.map((g) => [g.id, g]));
  const events: GameEvent[] = [];

  for (const g of cur) {
    const before = prevById.get(g.id);
    if (!before) continue;
    let memo = memory.get(g.id);
    if (!memo) memory.set(g.id, (memo = {}));

    const base = {
      gameId: g.id,
      fixture: `${g.away.abbreviation} @ ${g.home.abbreviation}`,
      home: g.home.abbreviation,
      away: g.away.abbreviation,
      score: scoreOf(g),
      detail: g.detail,
    };
    for (const rule of rules) {
      for (const e of rule(before, g, memo)) events.push({ ...base, ...e });
    }
  }

  return events;
}
