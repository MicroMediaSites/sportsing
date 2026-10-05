import { test, expect, describe } from "bun:test";
// Pure: synthetic snapshots, no network, no config, no notifications raised.
import type { GameEvent } from "./game-events.ts";
import type { Broadcast, Game, GameState } from "./game.ts";
import { formatGameEvent, leagueFeed, startWatch, type AlertLeague } from "./league-alerts.ts";
import type { WatchContext } from "./watch-route.ts";

const NBA: AlertLeague = { sport: "nba", icon: "🏀" };
const NHL: AlertLeague = { sport: "nhl", icon: "🏒", periods: { regulation: 3, shootout: true } };
const EXE = ["/usr/local/bin/sportsing"];
const JAZZ = new Set(["26"]);

interface Snap {
  id?: string;
  state?: GameState;
  period?: number;
  clock?: string;
  home?: number;
  away?: number;
  detail?: string;
  homeId?: string;
  awayId?: string;
  broadcasts?: Broadcast[];
}

/** Jazz @ Lakers by default; scores and clock as given. */
function g(s: Snap = {}): Game {
  const state = s.state ?? "in";
  const score = (n: number | undefined) => (state === "pre" ? "" : String(n ?? 0));
  return {
    id: s.id ?? "g1",
    date: "2026-10-22T02:00Z",
    name: "Utah Jazz at Los Angeles Lakers",
    state,
    detail: s.detail ?? "",
    period: s.period ?? (state === "pre" ? 0 : 1),
    clock: s.clock ?? (state === "in" ? "10:00" : ""),
    seasonType: "regular",
    home: { id: s.homeId ?? "13", name: "Los Angeles Lakers", abbreviation: "LAL", score: score(s.home) },
    away: { id: s.awayId ?? "26", name: "Utah Jazz", abbreviation: "UTAH", score: score(s.away) },
    broadcasts: s.broadcasts ?? [],
  };
}

const ev = (kind: GameEvent["kind"], over: Partial<GameEvent> = {}): GameEvent => ({
  kind,
  gameId: "g1",
  fixture: "UTAH @ LAL",
  home: "LAL",
  away: "UTAH",
  score: { home: 2, away: 3 },
  period: 2,
  detail: "",
  ...over,
});

describe("formatGameEvent", () => {
  test("start, goal, final — score away-first like the fixture", () => {
    expect(formatGameEvent(ev("tip-off"), "regular", NBA)).toEqual({ title: "🏀 Tip-off", body: "UTAH @ LAL is under way", sound: false });
    expect(formatGameEvent(ev("puck-drop"), "regular", NHL).title).toBe("🏒 Puck drop");
    expect(formatGameEvent(ev("goal", { scoringSide: "away" }), "regular", NHL)).toEqual({
      title: "🏒 GOAL — UTAH",
      body: "UTAH 3–2 LAL",
      sound: true,
    });
    expect(formatGameEvent(ev("final", { detail: "Final/SO" }), "regular", NHL).title).toBe("🏒 Final/SO");
    expect(formatGameEvent(ev("final", { detail: "" }), "regular", NBA).title).toBe("🏀 Final");
  });

  test("NHL periods use hockey names; playoff OT counts up", () => {
    expect(formatGameEvent(ev("period-end", { period: 2 }), "regular", NHL).title).toBe("🏒 End of 2nd");
    expect(formatGameEvent(ev("overtime", { period: 4 }), "regular", NHL).title).toBe("🏒 Overtime (OT)");
    expect(formatGameEvent(ev("overtime", { period: 5 }), "postseason", NHL).title).toBe("🏒 Overtime (2OT)");
    expect(formatGameEvent(ev("shootout", { period: 5 }), "regular", NHL).title).toBe("🏒 Shootout");
  });

  test("NBA lead change and close-late carry the clock text", () => {
    const lc = formatGameEvent(ev("lead-change", { leader: "home", detail: "4:12 - 3rd" }), "regular", NBA);
    expect(lc).toEqual({ title: "🏀 Lead change — LAL", body: "UTAH 3–2 LAL · 4:12 - 3rd", sound: false });
    const cl = formatGameEvent(ev("close-late", { detail: "2:00 - 4th" }), "regular", NBA);
    expect(cl.title).toBe("🏀 Close game late");
    expect(cl.sound).toBe(true);
  });
});

describe("startWatch", () => {
  const ALL: WatchContext = { sport: "nba", subscriptions: ["fubo", "nba-league-pass", "local-ota"], homeMarket: "utah" };
  const CMD = `'/usr/local/bin/sportsing' nba watch '26'`;

  test("no subscriptions: clickable only when there's a provider to fall back to", () => {
    expect(startWatch(g(), JAZZ, "nba", null, "fubo", EXE)).toEqual({ command: CMD });
    expect(startWatch(g(), JAZZ, "nba", null, null, EXE)).toEqual({});
  });

  test("subscriptions: a streamable game is clickable with where it's on", () => {
    const w = startWatch(g({ broadcasts: [{ name: "KJZZ-TV", market: "away" }] }), JAZZ, "nba", ALL, "fubo", EXE);
    expect(w.command).toBe(CMD);
    expect(w.note).toStartWith("📺 Fubo");
  });

  test("over the air only: no click, the channel instead", () => {
    const ota: WatchContext = { ...ALL, sport: "nhl", subscriptions: ["local-ota"] };
    const game = g({ awayId: "129764", broadcasts: [{ name: "Utah 16", market: "away" }] });
    const w = startWatch(game, new Set(["129764"]), "nhl", ota, null, EXE);
    expect(w.command).toBeUndefined();
    expect(w.note).toContain("Utah 16");
  });

  test("unwatchable: no click, says why", () => {
    const w = startWatch(g({ broadcasts: [{ name: "ESPN+", market: "national" }] }), JAZZ, "nba", { ...ALL, subscriptions: ["local-ota"] }, null, EXE);
    expect(w.command).toBeUndefined();
    expect(w.note).toStartWith("✗");
  });

  test("the favorite is the team watched, home or away; none → nothing", () => {
    expect(startWatch(g({ homeId: "26", awayId: "13" }), JAZZ, "nba", null, "fubo", EXE).command).toBe(CMD);
    expect(startWatch(g({ homeId: "1", awayId: "2" }), JAZZ, "nba", null, "fubo", EXE)).toEqual({});
  });
});

describe("leagueFeed", () => {
  const feedFor = (league = NBA, fallback: string | null = "fubo") =>
    leagueFeed({ league, favIds: JAZZ, watch: null, fallback, exe: EXE });

  test("first poll is the baseline; tip-off is click-to-watch in a Terminal", () => {
    const feed = feedFor();
    expect(feed([g({ state: "pre" })])).toEqual([]);
    const [a, ...rest] = feed([g({ state: "in" })]);
    expect(rest).toEqual([]);
    expect(a!.title).toBe("🏀 Tip-off");
    expect(a!.options.group).toBe("sportsing-nba-g1");
    expect(a!.options.onClick).toStartWith("osascript ");
    expect(a!.options.onClick).toContain("nba watch");
    // Unchanged next poll: nothing re-alerts.
    expect(feed([g({ state: "in" })])).toEqual([]);
  });

  test("tip-off with nowhere to watch isn't clickable", () => {
    const feed = feedFor(NBA, null);
    feed([g({ state: "pre" })]);
    expect(feed([g({ state: "in" })])[0]!.options.onClick).toBeUndefined();
  });

  test("only favorites' games alert", () => {
    const feed = feedFor();
    const other = (state: GameState) => g({ id: "x", state, homeId: "1", awayId: "2" });
    feed([other("pre")]);
    expect(feed([other("in")])).toEqual([]);
  });

  test("NHL goals sound and aren't clickable; memory spans polls (NBA tie-bridged lead change)", () => {
    const nhl = feedFor(NHL);
    nhl([g({ away: 0 })]);
    const [goal] = nhl([g({ away: 1 })]);
    expect(goal!.title).toBe("🏒 GOAL — UTAH");
    expect(goal!.options.sound).toBe(true);
    expect(goal!.options.onClick).toBeUndefined();

    const nba = feedFor();
    nba([g({ home: 10, away: 8 })]);
    expect(nba([g({ home: 10, away: 10 })])).toEqual([]);
    expect(nba([g({ home: 10, away: 12 })]).map((a) => a.title)).toEqual(["🏀 Lead change — UTAH"]);
  });
});
