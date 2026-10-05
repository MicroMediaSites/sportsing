import { test, expect, describe } from "bun:test";
import { clockSeconds, diffGames, type GameEvent, type GameMemory, type GameSport } from "./game-events.ts";
import type { Game, GameState, SeasonPhase } from "./game.ts";

// Synthetic Game snapshots — only the fields the differ reads matter.
interface Snap {
  state?: GameState;
  period?: number;
  clock?: string;
  home?: number | "";
  away?: number | "";
  detail?: string;
  season?: SeasonPhase;
  id?: string;
}

function g(s: Snap = {}): Game {
  const state = s.state ?? "in";
  return {
    id: s.id ?? "g1",
    date: "2026-10-22T01:00Z",
    name: "Utah Jazz at Memphis Grizzlies",
    state,
    detail: s.detail ?? "",
    period: s.period ?? (state === "pre" ? 0 : 1),
    clock: s.clock ?? (state === "in" ? "10:00" : ""),
    seasonType: s.season ?? "regular",
    home: { id: "29", name: "Memphis Grizzlies", abbreviation: "MEM", score: String(s.home ?? (state === "pre" ? "" : 0)) },
    away: { id: "26", name: "Utah Jazz", abbreviation: "UTAH", score: String(s.away ?? (state === "pre" ? "" : 0)) },
    broadcasts: [],
  };
}

/** Feed a sequence of single-game snapshots through the differ, one tick at a
 *  time with shared memory (as the live tick will), collecting every event. */
function run(sport: GameSport, snaps: Game[]): GameEvent[] {
  const memory: GameMemory = new Map();
  const out: GameEvent[] = [];
  for (let i = 1; i < snaps.length; i++) out.push(...diffGames([snaps[i - 1]!], [snaps[i]!], sport, memory));
  return out;
}

const kinds = (es: GameEvent[]) => es.map((e) => e.kind);

describe("clockSeconds", () => {
  test("parses m:ss, sub-minute tenths, and rejects junk", () => {
    expect(clockSeconds("4:21")).toBe(261);
    expect(clockSeconds("0:00")).toBe(0);
    expect(clockSeconds("12:00")).toBe(720);
    expect(clockSeconds("45.3")).toBeCloseTo(45.3);
    expect(clockSeconds("0.0")).toBe(0);
    expect(clockSeconds("")).toBeUndefined();
    expect(clockSeconds("Halftime")).toBeUndefined();
  });
});

describe("shared behaviour", () => {
  test("a snapshot diffed against itself yields nothing, for every sport and state", () => {
    const snaps = [
      g({ state: "pre" }),
      g({ period: 1, clock: "20:00" }),
      g({ period: 2, clock: "0:00", home: 2, away: 1 }),
      g({ period: 4, clock: "3:00", home: 100, away: 98 }),
      g({ period: 5, clock: "0:00", home: 2, away: 2 }),
      g({ state: "post", period: 3, home: 3, away: 1 }),
    ];
    for (const sport of ["nba", "nhl"] as const) {
      for (const s of snaps) {
        expect(diffGames([s], [s], sport)).toEqual([]);
        const memory: GameMemory = new Map();
        expect(diffGames([s], [s], sport, memory)).toEqual([]);
        expect(diffGames([s], [s], sport, memory)).toEqual([]);
      }
    }
  });

  test("a game with no prior snapshot is skipped until it has one", () => {
    expect(diffGames([], [g({ home: 3 })], "nhl")).toEqual([]);
    expect(diffGames([g({ id: "other", state: "pre" })], [g({ home: 3 })], "nhl")).toEqual([]);
  });

  test("events carry fixture, abbreviations, score and detail of the newer snapshot", () => {
    const [e] = diffGames([g({ home: 0 })], [g({ home: 1, period: 2, detail: "8:12 - 2nd" })], "nhl");
    expect(e).toEqual({
      kind: "goal",
      gameId: "g1",
      fixture: "UTAH @ MEM",
      home: "MEM",
      away: "UTAH",
      score: { home: 1, away: 0 },
      period: 2,
      detail: "8:12 - 2nd",
      scoringSide: "home",
    });
  });

  test("games are diffed independently by id", () => {
    const prev = [g({ id: "a", state: "pre" }), g({ id: "b", home: 0 })];
    const cur = [g({ id: "a", period: 1, clock: "20:00" }), g({ id: "b", home: 1 })];
    expect(diffGames(prev, cur, "nhl").map((e) => [e.gameId, e.kind])).toEqual([
      ["a", "puck-drop"],
      ["b", "goal"],
    ]);
  });
});

describe("NHL", () => {
  test("puck-drop on pre → in", () => {
    const es = diffGames([g({ state: "pre" })], [g({ period: 1, clock: "20:00" })], "nhl");
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "puck-drop", period: 1, score: { home: 0, away: 0 } });
  });

  test("goal reports the scoring side and resulting score; both sides in one tick → one each", () => {
    expect(diffGames([g()], [g({ away: 1 })], "nhl")).toMatchObject([
      { kind: "goal", scoringSide: "away", score: { home: 0, away: 1 } },
    ]);
    expect(diffGames([g()], [g({ home: 1, away: 1 })], "nhl").map((e) => e.scoringSide)).toEqual(["home", "away"]);
  });

  test("a multi-goal burst between polls collapses to one event with the resulting score", () => {
    const es = diffGames([g()], [g({ home: 2 })], "nhl");
    expect(es).toHaveLength(1);
    expect(es[0]!.score).toEqual({ home: 2, away: 0 });
  });

  test("end of period when the clock hits 0:00, once, not again when the next period starts", () => {
    const es = run("nhl", [
      g({ period: 1, clock: "1:10" }),
      g({ period: 1, clock: "0:00", detail: "End of 1st" }),
      g({ period: 1, clock: "0:00", detail: "End of 1st" }),
      g({ period: 2, clock: "20:00" }),
    ]);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "period-end", period: 1, detail: "End of 1st" });
  });

  test("end of period still fires when a poll gap skips the 0:00 snapshot", () => {
    const es = diffGames([g({ period: 1, clock: "3:00" })], [g({ period: 2, clock: "18:40" })], "nhl");
    expect(es).toMatchObject([{ kind: "period-end", period: 1 }]);
  });

  test("full regular-season game through OT and a shootout", () => {
    const es = run("nhl", [
      g({ state: "pre" }),
      g({ period: 1, clock: "20:00" }),
      g({ period: 1, clock: "12:00", away: 1 }),
      g({ period: 1, clock: "0:00", away: 1 }),
      g({ period: 2, clock: "20:00", away: 1 }),
      g({ period: 2, clock: "0:00", home: 1, away: 1 }),
      g({ period: 3, clock: "20:00", home: 1, away: 1 }),
      g({ period: 3, clock: "0:00", home: 1, away: 1 }),
      g({ period: 4, clock: "5:00", home: 1, away: 1 }),
      g({ period: 4, clock: "0:00", home: 1, away: 1 }),
      g({ period: 5, clock: "0:00", home: 1, away: 1 }),
      // ESPN credits the shootout winner +1 only when the game goes final.
      g({ state: "post", period: 5, home: 2, away: 1, detail: "Final/SO" }),
    ]);
    expect(es.map((e) => [e.kind, e.period])).toEqual([
      ["puck-drop", 1],
      ["goal", 1],
      ["period-end", 1],
      ["goal", 2],
      ["period-end", 2],
      ["period-end", 3],
      ["overtime", 4],
      ["period-end", 4],
      ["shootout", 5],
      ["final", 5],
    ]);
    expect(es.at(-1)).toMatchObject({ score: { home: 2, away: 1 }, detail: "Final/SO" });
  });

  test("playoff overtime: every extra period is overtime, never a shootout", () => {
    const es = run("nhl", [
      g({ season: "postseason", period: 4, clock: "0:00", home: 2, away: 2 }),
      g({ season: "postseason", period: 5, clock: "20:00", home: 2, away: 2 }),
      g({ season: "postseason", period: 5, clock: "7:30", home: 2, away: 3 }),
      g({ season: "postseason", state: "post", period: 5, home: 2, away: 3, detail: "Final/2OT" }),
    ]);
    expect(es.map((e) => [e.kind, e.period])).toEqual([
      ["overtime", 5],
      ["goal", 5],
      ["final", 5],
    ]);
  });

  test("final on in → post; a goal in the last poll gap also reports", () => {
    expect(kinds(diffGames([g({ period: 3, clock: "0:30" })], [g({ state: "post", period: 3 })], "nhl"))).toEqual([
      "final",
    ]);
    expect(
      kinds(diffGames([g({ period: 3, clock: "0:30" })], [g({ state: "post", period: 3, home: 1 })], "nhl")),
    ).toEqual(["goal", "final"]);
  });

  test("never emits NBA-only events", () => {
    const es = run("nhl", [
      g({ period: 4, clock: "3:00", home: 1 }),
      g({ period: 4, clock: "2:00", home: 1, away: 2 }), // would be lead-change + close-late in the NBA
    ]);
    expect(kinds(es)).toEqual(["goal"]);
  });
});

describe("NBA", () => {
  test("tip-off on pre → in, and individual baskets are not events", () => {
    const es = run("nba", [
      g({ state: "pre" }),
      g({ period: 1, clock: "12:00" }),
      g({ period: 1, clock: "11:30", home: 2 }),
      g({ period: 1, clock: "11:00", home: 4 }),
    ]);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ kind: "tip-off", period: 1 });
  });

  test("lead change when the leader flips; extending a lead is not one", () => {
    const es = run("nba", [
      g({ home: 10, away: 8 }),
      g({ home: 14, away: 8 }),
      g({ home: 14, away: 15, period: 2 }),
      g({ home: 14, away: 19, period: 2 }),
    ]);
    expect(es).toMatchObject([{ kind: "lead-change", leader: "away", period: 2, score: { home: 14, away: 15 } }]);
  });

  test("a lead change bridged by a tie across polls still counts; tie → same leader does not", () => {
    expect(
      run("nba", [g({ home: 10, away: 8 }), g({ home: 10, away: 10 }), g({ home: 10, away: 12 })]).map((e) => e.leader),
    ).toEqual(["away"]);
    expect(run("nba", [g({ home: 10, away: 8 }), g({ home: 10, away: 10 }), g({ home: 12, away: 10 })])).toEqual([]);
  });

  test("the first lead of the game is not a lead change", () => {
    const es = run("nba", [g({ state: "pre" }), g({ clock: "12:00" }), g({ home: 2 }), g({ home: 2, away: 2 })]);
    expect(kinds(es)).toEqual(["tip-off"]);
  });

  test("close-late fires once when the 4th gets within 5 with ≤ 5:00 left", () => {
    const es = run("nba", [
      g({ period: 4, clock: "7:00", home: 90, away: 84 }),
      g({ period: 4, clock: "5:00", home: 90, away: 84 }), // 6 pts: not close
      g({ period: 4, clock: "4:40", home: 90, away: 86 }), // 4 pts → fires
      g({ period: 4, clock: "3:00", home: 96, away: 86 }), // pulls away
      g({ period: 4, clock: "1:00", home: 96, away: 93 }), // close again — no repeat
    ]);
    expect(es).toMatchObject([{ kind: "close-late", period: 4, score: { home: 90, away: 86 } }]);
  });

  test("close-late boundaries: exactly 5 pts at exactly 5:00 counts; earlier periods never do", () => {
    expect(kinds(run("nba", [g({ period: 4, clock: "5:01", home: 50, away: 45 }), g({ period: 4, clock: "5:00", home: 50, away: 45 })]))).toEqual([
      "close-late",
    ]);
    expect(run("nba", [g({ period: 3, clock: "6:00", home: 50, away: 49 }), g({ period: 3, clock: "1:00", home: 50, away: 49 })])).toEqual([]);
    expect(run("nba", [g({ period: 4, clock: "6:00", home: 60, away: 50 }), g({ period: 4, clock: "45.2", home: 60, away: 50 })])).toEqual([]);
  });

  test("close-late reaches an overtime that the 4th never qualified for, once", () => {
    const es = run("nba", [
      g({ period: 4, clock: "8:00", home: 100, away: 92 }),
      g({ period: 4, clock: "0.0", home: 104, away: 104 }), // tied up at the buzzer → OT
      g({ period: 5, clock: "5:00", home: 104, away: 104 }),
      g({ period: 6, clock: "5:00", home: 110, away: 110 }),
    ]);
    expect(es.filter((e) => e.kind === "close-late")).toMatchObject([{ period: 4 }]);
  });

  test("close-late already true when we start watching is the baseline, not an alert", () => {
    expect(
      run("nba", [
        g({ period: 4, clock: "2:00", home: 100, away: 99 }),
        g({ period: 4, clock: "1:30", home: 100, away: 101 }),
        g({ period: 4, clock: "1:00", home: 100, away: 103 }),
      ]).map((e) => e.kind),
    ).toEqual(["lead-change"]);
  });

  test("full game: tip-off, lead change, close-late, final — in that order", () => {
    const es = run("nba", [
      g({ state: "pre" }),
      g({ period: 1, clock: "12:00" }),
      g({ period: 2, clock: "6:00", home: 50, away: 40 }),
      g({ period: 4, clock: "4:00", home: 98, away: 100 }), // flips and gets close in one poll gap
      g({ state: "post", period: 4, home: 108, away: 110, detail: "Final" }),
    ]);
    expect(es.map((e) => e.kind)).toEqual(["tip-off", "lead-change", "close-late", "final"]);
    expect(es.at(-1)).toMatchObject({ kind: "final", score: { home: 108, away: 110 }, detail: "Final" });
  });

  test("a last-gasp flip at the final reports only the final", () => {
    expect(kinds(run("nba", [g({ period: 4, clock: "0:02", home: 99, away: 98 }), g({ state: "post", period: 4, home: 99, away: 101 })]))).toEqual([
      "final",
    ]);
  });

  test("memory is per game id", () => {
    const memory: GameMemory = new Map();
    const close = (id: string, clock: string) => g({ id, period: 4, clock, home: 100, away: 98 });
    const far = (id: string) => g({ id, period: 4, clock: "8:00", home: 100, away: 80 });
    const es = diffGames([far("a"), far("b")], [close("a", "4:00"), close("b", "4:00")], "nba", memory);
    expect(es.map((e) => [e.gameId, e.kind])).toEqual([
      ["a", "close-late"],
      ["b", "close-late"],
    ]);
    expect(diffGames([close("a", "4:00")], [close("a", "3:00")], "nba", memory)).toEqual([]);
  });
});
