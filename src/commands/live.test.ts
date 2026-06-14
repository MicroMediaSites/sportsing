import { test, expect } from "bun:test";
import { kickoffWatchCommand } from "./live.ts";
import type { MatchEvent } from "../events.ts";
import type { Match, MatchStatus } from "../types.ts";

function mk(id: number, status: MatchStatus, home: string, away: string): Match {
  return {
    id,
    utcDate: "2026-06-14T18:00:00Z",
    status,
    stage: "GROUP_STAGE",
    group: "Group A",
    matchday: 1,
    homeTeam: { name: home, tla: home.slice(0, 3).toUpperCase() },
    awayTeam: { name: away, tla: away.slice(0, 3).toUpperCase() },
    score: { winner: null, fullTime: { home: 0, away: 0 } },
  };
}

function ev(kind: MatchEvent["kind"], matchId: number): MatchEvent {
  return { kind, matchId, fixture: "USA vs England", home: "USA", away: "ENG", score: { home: 0, away: 0 } };
}

const EXE = "/usr/local/bin/sportsing";

test("kickoff for a fav match → `<exe> fifa watch <fav>`, targeting the favourite team", () => {
  const matches = [mk(1, "IN_PLAY", "USA", "England")];
  const cmd = kickoffWatchCommand(ev("kickoff", 1), matches, ["USA"], EXE);
  expect(cmd).toBe(`'/usr/local/bin/sportsing' fifa watch 'USA'`);
});

test("the favourite is chosen even when it's the away side", () => {
  const matches = [mk(1, "IN_PLAY", "Brazil", "USA")];
  const cmd = kickoffWatchCommand(ev("kickoff", 1), matches, ["USA"], EXE);
  expect(cmd).toContain(`fifa watch 'USA'`);
});

test("goal and full-time events get no click action", () => {
  const matches = [mk(1, "IN_PLAY", "USA", "England")];
  expect(kickoffWatchCommand(ev("goal", 1), matches, ["USA"], EXE)).toBeUndefined();
  expect(kickoffWatchCommand(ev("full-time", 1), matches, ["USA"], EXE)).toBeUndefined();
});

test("no command when the match is missing from the snapshot", () => {
  expect(kickoffWatchCommand(ev("kickoff", 1), [], ["USA"], EXE)).toBeUndefined();
});

test("no command when no favourite matches the kickoff's teams", () => {
  const matches = [mk(1, "IN_PLAY", "USA", "England")];
  expect(kickoffWatchCommand(ev("kickoff", 1), matches, ["Brazil"], EXE)).toBeUndefined();
});

test("team and exe with an apostrophe are POSIX-escaped (no shell injection)", () => {
  const matches = [mk(1, "IN_PLAY", "Côte d'Ivoire", "Brazil")];
  const cmd = kickoffWatchCommand(ev("kickoff", 1), matches, ["Côte d'Ivoire"], EXE);
  expect(cmd).toBe(`'/usr/local/bin/sportsing' fifa watch 'Côte d'\\''Ivoire'`);
});
