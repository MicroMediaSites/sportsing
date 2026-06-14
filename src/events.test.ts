import { test, expect } from "bun:test";
import { diffEvents } from "./events.ts";
import type { Match, MatchStatus } from "./types.ts";

// Minimal Match factory — only the fields diffEvents reads.
function mk(
  id: number,
  status: MatchStatus,
  home: string,
  away: string,
  hg: number | null = 0,
  ag: number | null = 0,
): Match {
  return {
    id,
    utcDate: "2026-06-14T18:00:00Z",
    status,
    stage: "GROUP_STAGE",
    group: "Group A",
    matchday: 1,
    homeTeam: { name: home, tla: home.slice(0, 3).toUpperCase() },
    awayTeam: { name: away, tla: away.slice(0, 3).toUpperCase() },
    score: { winner: null, fullTime: { home: hg, away: ag } },
  };
}

const FAVS = ["USA"];

test("kickoff: pre → live emits one kickoff event", () => {
  const prev = [mk(1, "TIMED", "USA", "England")];
  const cur = [mk(1, "IN_PLAY", "USA", "England")];
  const events = diffEvents(prev, cur, FAVS);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "kickoff", matchId: 1, score: { home: 0, away: 0 } });
});

test("goal: score delta reports scoring side and resulting scoreline", () => {
  const prev = [mk(1, "IN_PLAY", "USA", "England", 0, 0)];
  const cur = [mk(1, "IN_PLAY", "USA", "England", 1, 0)];
  const events = diffEvents(prev, cur, FAVS);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "goal", scoringSide: "home", score: { home: 1, away: 0 } });
});

test("goal: both sides scoring in one tick emits one event each", () => {
  const prev = [mk(1, "IN_PLAY", "USA", "England", 0, 0)];
  const cur = [mk(1, "IN_PLAY", "USA", "England", 1, 1)];
  const sides = diffEvents(prev, cur, FAVS).map((e) => e.scoringSide);
  expect(sides).toEqual(["home", "away"]);
});

test("goal: a multi-goal burst on one side collapses to a single event (resulting scoreline)", () => {
  const prev = [mk(1, "IN_PLAY", "USA", "England", 0, 0)];
  const cur = [mk(1, "IN_PLAY", "USA", "England", 2, 0)];
  const events = diffEvents(prev, cur, FAVS);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "goal", scoringSide: "home", score: { home: 2, away: 0 } });
});

test("PAUSED counts as live: pre → PAUSED kicks off, PAUSED → post is full-time", () => {
  expect(diffEvents([mk(1, "TIMED", "USA", "England")], [mk(1, "PAUSED", "USA", "England")], FAVS)).toMatchObject([
    { kind: "kickoff" },
  ]);
  expect(
    diffEvents([mk(1, "PAUSED", "USA", "England", 1, 1)], [mk(1, "FINISHED", "USA", "England", 1, 1)], FAVS),
  ).toMatchObject([{ kind: "full-time" }]);
});

test("full-time: live → post emits one full-time event with the final score", () => {
  const prev = [mk(1, "IN_PLAY", "USA", "England", 2, 1)];
  const cur = [mk(1, "FINISHED", "USA", "England", 2, 1)];
  const events = diffEvents(prev, cur, FAVS);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "full-time", score: { home: 2, away: 1 } });
});

test("no-change: identical snapshots are idempotent (no duplicate alerts)", () => {
  const snap = [mk(1, "IN_PLAY", "USA", "England", 1, 0)];
  expect(diffEvents(snap, snap, FAVS)).toEqual([]);
});

test("non-favourite matches are ignored", () => {
  const prev = [mk(2, "TIMED", "Brazil", "France")];
  const cur = [mk(2, "IN_PLAY", "Brazil", "France")];
  expect(diffEvents(prev, cur, FAVS)).toEqual([]);
});

test("empty favourites yields no events", () => {
  const prev = [mk(1, "TIMED", "USA", "England")];
  const cur = [mk(1, "IN_PLAY", "USA", "England")];
  expect(diffEvents(prev, cur, [])).toEqual([]);
});

test("a match with no prior snapshot is skipped (needs a transition to diff)", () => {
  const cur = [mk(1, "IN_PLAY", "USA", "England", 1, 0)];
  expect(diffEvents([], cur, FAVS)).toEqual([]);
});
