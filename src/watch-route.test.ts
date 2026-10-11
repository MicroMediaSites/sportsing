import { test, expect, describe } from "bun:test";
// Pure — no network, no config, never launches a window.
import { visibleLen } from "./ansi.ts";
import type { Broadcast, Game, GameCompetitor, GameState } from "./game.ts";
import { PROVIDERS } from "./stream.ts";
import {
  SERVICE_PROVIDER,
  isWatchSport,
  planWatch,
  watchCell,
  watchHeading,
  watchOf,
  watchSummary,
  withWatchColumn,
  type WatchContext,
} from "./watch-route.ts";
import type { Watchability } from "./watchability.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const team = (id: string, name: string, abbreviation: string): GameCompetitor => ({ id, name, abbreviation, score: "" });
const JAZZ = team("26", "Utah Jazz", "UTAH");
const LAKERS = team("13", "Los Angeles Lakers", "LAL");
const CELTICS = team("2", "Boston Celtics", "BOS");
const MAMMOTH = team("129764", "Utah Mammoth", "UTA");
const RANGERS = team("13", "New York Rangers", "NYR");

function game(away: GameCompetitor, home: GameCompetitor, broadcasts: Broadcast[], state: GameState = "pre"): Game {
  return {
    id: "1",
    date: "2026-10-22T01:00Z",
    name: `${away.name} at ${home.name}`,
    state,
    detail: "",
    period: 0,
    clock: "",
    seasonType: "regular",
    home,
    away,
    broadcasts,
  };
}

const NBA_ALL: WatchContext = { sport: "nba", subscriptions: ["fubo", "nba-league-pass", "local-ota"], homeMarket: "utah" };
const NHL_ALL: WatchContext = { sport: "nhl", subscriptions: ["fubo", "nba-league-pass", "local-ota"], homeMarket: "utah" };
const NHL_OTA: WatchContext = { ...NHL_ALL, subscriptions: ["local-ota"] };

const JAZZ_HOME = game(LAKERS, JAZZ, [{ name: "KJZZ-TV", market: "home" }]);
const OUT_OF_MARKET = game(CELTICS, LAKERS, [{ name: "Spectrum Sports Net", market: "home" }]);
const MAMMOTH_OTA = game(MAMMOTH, RANGERS, [{ name: "MSG", market: "home" }, { name: "Utah 16", market: "away" }]);
const ESPN_PLUS = game(RANGERS, MAMMOTH, [{ name: "ESPN+", market: "national" }]);
const UNLISTED = game(CELTICS, LAKERS, []);

test("isWatchSport: only the resolver's leagues", () => {
  expect(isWatchSport("nba")).toBe(true);
  expect(isWatchSport("nhl")).toBe(true);
  expect(isWatchSport("fifa")).toBe(false);
});

describe("WATCH cell", () => {
  test("service, over-the-air channel, ✗, ?", () => {
    expect(strip(watchCell(JAZZ_HOME, NBA_ALL))).toBe("Fubo");
    expect(strip(watchCell(OUT_OF_MARKET, NBA_ALL))).toBe("NBA League Pass");
    expect(strip(watchCell(MAMMOTH_OTA, NHL_ALL))).toBe("Fubo");
    expect(strip(watchCell(MAMMOTH_OTA, NHL_OTA))).toBe("Utah 16");
    expect(strip(watchCell(ESPN_PLUS, NHL_ALL))).toBe("✗");
    expect(strip(watchCell(UNLISTED, NHL_ALL))).toBe("?");
    // NBA: an unlisted out-of-market game is assumed to be on League Pass.
    expect(strip(watchCell(UNLISTED, NBA_ALL))).toBe("NBA League Pass");
  });

  test("live games get a cell; finished games don't", () => {
    expect(strip(watchCell({ ...JAZZ_HOME, state: "in" }, NBA_ALL))).toBe("Fubo");
    expect(watchCell({ ...JAZZ_HOME, state: "post" }, NBA_ALL)).toBe("");
  });

  test("subscriptions matter: the Jazz on League Pass alone is blacked out", () => {
    expect(strip(watchCell(JAZZ_HOME, { ...NBA_ALL, subscriptions: ["nba-league-pass"] }))).toBe("✗");
  });
});

describe("withWatchColumn", () => {
  test("pads every line to one column; empty cells leave the line alone", () => {
    const { lines, column } = withWatchColumn(["  short", "  a much longer line", "  done"], ["Fubo", "✗", ""]);
    expect(column).toBe("  a much longer line".length + 2);
    expect(lines[0]).toBe("  short".padEnd(column!) + "Fubo");
    expect(lines[1]).toBe("  a much longer line  ✗");
    expect(lines[2]).toBe("  done");
  });

  test("all cells empty (only finished games) → no column", () => {
    expect(withWatchColumn(["  a", "  bb"], ["", ""])).toEqual({ lines: ["  a", "  bb"], column: null });
  });

  test("aligns by visible width, ignoring ANSI codes", () => {
    const { lines } = withWatchColumn(["\x1b[1mbold\x1b[22m", "plain!"], ["A", "B"]);
    expect(lines.map((l) => visibleLen(l))).toEqual([9, 9]);
  });

  test("heading lands on the column", () => {
    expect(strip(watchHeading("Sat, Oct 4", 14))).toBe("Sat, Oct 4    WATCH");
  });
});

test("watchSummary: one line per outcome", () => {
  expect(watchSummary(watchOf(JAZZ_HOME, NBA_ALL))).toBe("Fubo — on KJZZ-TV");
  expect(watchSummary(watchOf(MAMMOTH_OTA, NHL_ALL))).toBe("Fubo — on Utah 16");
  expect(watchSummary(watchOf(MAMMOTH_OTA, NHL_OTA))).toBe("Utah 16 — over the air");
  expect(watchSummary(watchOf(ESPN_PLUS, NHL_ALL))).toBe("✗ ESPN+ exclusive — no subscription");
  expect(watchSummary(watchOf(UNLISTED, NHL_ALL))).toBe("? no broadcasts listed yet");
  expect(watchSummary(watchOf(UNLISTED, NBA_ALL))).toBe("NBA League Pass — no broadcast listed yet (assumed)");
});

describe("planWatch", () => {
  test("Fubo / League Pass open their provider", () => {
    expect(planWatch(watchOf(JAZZ_HOME, NBA_ALL), null)).toEqual({ kind: "open", provider: "fubo", note: "Fubo — on KJZZ-TV" });
    expect(planWatch(watchOf(OUT_OF_MARKET, NBA_ALL), "fubo")).toMatchObject({ kind: "open", provider: "nba-league-pass" });
  });

  test("resolver beats the configured provider for a placeable game", () => {
    expect(planWatch(watchOf(JAZZ_HOME, NBA_ALL), "nba-league-pass")).toMatchObject({ provider: "fubo" });
  });

  test("over the air: name the channel, open nothing", () => {
    expect(planWatch(watchOf(MAMMOTH_OTA, NHL_OTA), "fubo")).toEqual({ kind: "tune", message: "Utah 16 — over the air" });
  });

  test("Utah 16 with Fubo: open Fubo's hub instead of tuning in", () => {
    expect(planWatch(watchOf(MAMMOTH_OTA, NHL_ALL), null)).toEqual({ kind: "open", provider: "fubo", note: "Fubo — on Utah 16" });
  });

  test("unwatchable: say why, even with a fallback provider", () => {
    expect(planWatch(watchOf(ESPN_PLUS, NHL_ALL), "fubo")).toEqual({ kind: "none", message: "ESPN+ exclusive — no subscription" });
  });

  test("unknown: fall back to the configured provider, else explain", () => {
    expect(planWatch(watchOf(UNLISTED, NHL_ALL), "fubo")).toMatchObject({ kind: "open", provider: "fubo" });
    const none = planWatch(watchOf(UNLISTED, NHL_ALL), null);
    expect(none.kind).toBe("none");
    expect(none.kind === "none" && none.message).toBe("Can't tell where it airs — no broadcasts listed yet.");
  });

  test("a watchable answer with no service is treated as unplaceable", () => {
    const odd: Watchability = { watchable: true, via: "X", service: null, note: "odd" };
    expect(planWatch(odd, null).kind).toBe("none");
  });
});

test("every openable service maps to a provider with a hub for its sport", () => {
  expect(PROVIDERS[SERVICE_PROVIDER.fubo]!.hubs.nba).toBeTruthy();
  expect(PROVIDERS[SERVICE_PROVIDER.fubo]!.hubs.nhl).toBeTruthy();
  expect(PROVIDERS[SERVICE_PROVIDER["nba-league-pass"]]!.hubs.nba).toBeTruthy();
  expect(PROVIDERS[SERVICE_PROVIDER["prime-video"]]!.hubs.nba).toBeTruthy();
});

test("every openable service maps to a provider with a hub for its sport (club soccer)", () => {
  for (const sport of ["epl", "seriea", "ligue1"]) expect(PROVIDERS[SERVICE_PROVIDER.fubo]!.hubs[sport]).toBeTruthy();
  expect(PROVIDERS[SERVICE_PROVIDER.peacock]!.hubs.epl).toBeTruthy();
  expect(PROVIDERS[SERVICE_PROVIDER["paramount-plus"]]!.hubs.seriea).toBeTruthy();
});

describe("club soccer routing", () => {
  const SPURS = team("367", "Tottenham Hotspur", "TOT");
  const ARSENAL = team("359", "Arsenal", "ARS");
  const soccer = (sport: WatchContext["sport"], subscriptions: WatchContext["subscriptions"]): WatchContext => ({ sport, subscriptions, homeMarket: "utah" });
  const nat = (name: string): Broadcast[] => [{ name, market: "national" }];

  test("isWatchSport includes the three leagues", () => {
    for (const s of ["epl", "seriea", "ligue1"]) expect(isWatchSport(s)).toBe(true);
    expect(isWatchSport("fifa")).toBe(false);
  });

  test("WATCH cell: service, assumed default, ✗, ?", () => {
    const ctx = soccer("epl", ["peacock", "paramount-plus"]);
    expect(strip(watchCell(game(SPURS, ARSENAL, nat("Peacock")), ctx))).toBe("Peacock");
    expect(strip(watchCell(game(SPURS, ARSENAL, []), ctx))).toBe("Peacock");
    expect(strip(watchCell(game(SPURS, ARSENAL, nat("NBC")), ctx))).toBe("✗");
    expect(strip(watchCell(game(SPURS, ARSENAL, nat("Mystery Net")), ctx))).toBe("?");
    expect(strip(watchCell(game(SPURS, ARSENAL, []), soccer("seriea", ["paramount-plus"])))).toBe("?");
    expect(watchCell(game(SPURS, ARSENAL, nat("Peacock"), "post"), ctx)).toBe("");
  });

  test("planWatch maps each new service to its provider", () => {
    expect(planWatch(watchOf(game(SPURS, ARSENAL, nat("Peacock")), soccer("epl", ["peacock"])), "fubo")).toMatchObject({ kind: "open", provider: "peacock" });
    expect(planWatch(watchOf(game(SPURS, ARSENAL, nat("Paramount+")), soccer("seriea", ["paramount-plus"])), null)).toMatchObject({
      kind: "open",
      provider: "paramount-plus",
    });
    expect(planWatch(watchOf(game(SPURS, ARSENAL, nat("beIN Sports")), soccer("ligue1", ["fubo"])), null)).toMatchObject({ kind: "open", provider: "fubo" });
  });

  test("assumed default is labelled in the summary and plan note", () => {
    const w = watchOf(game(SPURS, ARSENAL, []), soccer("epl", ["peacock"]));
    expect(watchSummary(w)).toBe("Peacock — no broadcast listed yet (assumed)");
    expect(planWatch(w, null)).toEqual({ kind: "open", provider: "peacock", note: "Peacock — no broadcast listed yet (assumed)" });
  });

  test("unplaceable match falls back to the league's default provider", () => {
    const w = watchOf(game(SPURS, ARSENAL, []), soccer("seriea", ["paramount-plus"]));
    expect(planWatch(w, "paramount-plus")).toMatchObject({ kind: "open", provider: "paramount-plus" });
  });
});
