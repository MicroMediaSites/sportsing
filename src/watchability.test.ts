import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWatch, type Subscription } from "./watchability.ts";
import { toGame, SEASON_TYPES } from "./espn.ts";
import type { Broadcast, Game, GameCompetitor } from "./game.ts";

// Pure resolver tests — no network, no config. Team ids are ESPN's.
const team = (id: string, name: string, abbreviation: string): GameCompetitor => ({ id, name, abbreviation, score: "" });
const JAZZ = team("26", "Utah Jazz", "UTAH");
const NUGGETS = team("7", "Denver Nuggets", "DEN");
const CELTICS = team("2", "Boston Celtics", "BOS");
const LAKERS = team("13", "Los Angeles Lakers", "LAL");
const MAMMOTH = team("129764", "Utah Mammoth", "UTA");
// Real ESPN ids — the Rangers share id 13 with the Lakers: ids are per league.
const RANGERS = team("13", "New York Rangers", "NYR");

function game(away: GameCompetitor, home: GameCompetitor, broadcasts: Broadcast[]): Game {
  return {
    id: "1",
    date: "2026-10-22T01:00Z",
    name: `${away.name} at ${home.name}`,
    state: "pre",
    detail: "",
    period: 0,
    clock: "",
    seasonType: "regular",
    home,
    away,
    broadcasts,
  };
}

const ALL: Subscription[] = ["fubo", "nba-league-pass", "local-ota"];

describe("acceptance cases", () => {
  test("in-market Jazz regional game → Fubo", () => {
    const g = game(LAKERS, JAZZ, [
      { name: "KJZZ-TV", market: "home" },
      { name: "Jazz+", market: "home" },
      { name: "Spectrum Sports Net", market: "away" },
    ]);
    expect(resolveWatch(g, ALL, "utah", "nba")).toEqual({ watchable: true, via: "Fubo", service: "fubo", note: "on KJZZ-TV" });
  });

  test("out-of-market NBA game → League Pass", () => {
    const g = game(CELTICS, LAKERS, [
      { name: "Spectrum Sports Net", market: "home" },
      { name: "NBC Sports BO", market: "away" },
      { name: "NBA League Pass", market: "away" },
    ]);
    const r = resolveWatch(g, ALL, "utah", "nba");
    expect(r.watchable).toBe(true);
    expect(r.service).toBe("nba-league-pass");
    expect(r.via).toBe("NBA League Pass");
  });

  test("Jazz game with League Pass only → not watchable (blackout)", () => {
    const g = game(LAKERS, JAZZ, [{ name: "KJZZ-TV", market: "home" }, { name: "Jazz+", market: "home" }]);
    const r = resolveWatch(g, ["nba-league-pass"], "utah", "nba");
    expect(r.watchable).toBe(false);
    expect(r.via).toBeNull();
    expect(r.note).toContain("League Pass blacks out in-market Utah Jazz games");
  });

  test('Mammoth on Utah 16 with local-ota → watchable via "Utah 16"', () => {
    const g = game(MAMMOTH, RANGERS, [
      { name: "ESPN+", market: "national" },
      { name: "MSG", market: "home" },
      { name: "Utah 16", market: "away" },
    ]);
    expect(resolveWatch(g, ["local-ota"], "utah", "nhl")).toEqual({
      watchable: true,
      via: "Utah 16",
      service: "local-ota",
      note: "Utah 16 — over the air",
    });
  });

  test("ESPN+-only national NHL game without it → not watchable", () => {
    const g = game(RANGERS, MAMMOTH, [{ name: "ESPN+", market: "national" }]);
    expect(resolveWatch(g, ALL, "utah", "nhl")).toEqual({
      watchable: false,
      via: null,
      service: null,
      note: "ESPN+ exclusive — no subscription",
    });
  });
});

describe("unknown broadcasters never resolve to a false yes", () => {
  test("unrecognized national name → unknown", () => {
    const g = game(RANGERS, MAMMOTH, [{ name: "Mystery Sports+", market: "national" }]);
    const r = resolveWatch(g, ALL, "utah", "nhl");
    expect(r.watchable).toBe("unknown");
    expect(r.via).toBeNull();
    expect(r.note).toContain("Mystery Sports+");
  });

  test("unrecognized in-market regional name → unknown", () => {
    const g = game(LAKERS, JAZZ, [{ name: "New Jazz Channel", market: "home" }]);
    expect(resolveWatch(g, ALL, "utah", "nba").watchable).toBe("unknown");
  });

  test("an unknown national blocks the League Pass route (could be an exclusive)", () => {
    const g = game(CELTICS, LAKERS, [{ name: "Mystery Sports+", market: "national" }]);
    expect(resolveWatch(g, ["nba-league-pass"], "utah", "nba").watchable).toBe("unknown");
  });

  test("no broadcasts listed yet → unknown, even with League Pass", () => {
    expect(resolveWatch(game(CELTICS, LAKERS, []), ALL, "utah", "nba").watchable).toBe("unknown");
    expect(resolveWatch(game(LAKERS, JAZZ, []), ALL, "utah", "nba").watchable).toBe("unknown");
  });

  test("in-market team with no local feed listed → unknown, not no", () => {
    const g = game(MAMMOTH, RANGERS, [{ name: "MSG", market: "home" }]);
    expect(resolveWatch(g, ["local-ota"], "utah", "nhl").watchable).toBe("unknown");
  });

  test("unknown home market → unknown", () => {
    const g = game(MAMMOTH, RANGERS, [{ name: "Utah 16", market: "away" }]);
    expect(resolveWatch(g, ALL, "atlantis", "nhl").watchable).toBe("unknown");
  });

  test("prototype keys are not home markets", () => {
    const g = game(MAMMOTH, RANGERS, [{ name: "Utah 16", market: "away" }]);
    expect(resolveWatch(g, ALL, "constructor", "nhl").watchable).toBe("unknown");
  });

  test("a known route still wins over an unrecognized extra row", () => {
    const g = game(MAMMOTH, RANGERS, [{ name: "Utah 16", market: "away" }, { name: "Mystery", market: "national" }]);
    expect(resolveWatch(g, ["local-ota"], "utah", "nhl").via).toBe("Utah 16");
  });
});

describe("routing details", () => {
  test("other markets' regional feeds are geo-locked: unknown names there are ignored", () => {
    const g = game(CELTICS, LAKERS, [{ name: "Spectrum Sports Net", market: "home" }]);
    expect(resolveWatch(g, ["fubo"], "utah", "nba")).toMatchObject({ watchable: false });
  });

  test("national NBA game blacks out League Pass for out-of-market teams too", () => {
    const g = game(CELTICS, LAKERS, [{ name: "Prime Video", market: "national" }]);
    expect(resolveWatch(g, ["nba-league-pass"], "utah", "nba")).toMatchObject({
      watchable: false,
      note: "Prime Video exclusive — no subscription",
    });
  });

  test("League Pass row alone, without League Pass → no, named plainly", () => {
    const g = game(CELTICS, LAKERS, [{ name: "NBA League Pass", market: "away" }]);
    expect(resolveWatch(g, ["fubo"], "utah", "nba")).toMatchObject({
      watchable: false,
      note: "only on NBA League Pass — no subscription",
    });
  });

  test("League Pass is NBA-only", () => {
    const g = game(RANGERS, team("1", "Boston Bruins", "BOS"), [{ name: "NESN", market: "home" }]);
    expect(resolveWatch(g, ["nba-league-pass"], "utah", "nhl").watchable).toBe(false);
  });

  test("ids are per league: NHL team 26 isn't the Jazz", () => {
    const g = game(team("26", "Some NHL Team", "XYZ"), RANGERS, [{ name: "MSG", market: "home" }]);
    expect(resolveWatch(g, ["local-ota"], "utah", "nhl").watchable).toBe(false);
  });

  test("a service beats over-the-air when both carry it", () => {
    const g = game(CELTICS, LAKERS, [{ name: "NBC", market: "national" }]);
    expect(resolveWatch(g, ["local-ota", "fubo"], "utah", "nba")).toMatchObject({ via: "Fubo", note: "on NBC" });
    expect(resolveWatch(g, ["local-ota"], "utah", "nba")).toMatchObject({ via: "NBC", service: "local-ota" });
  });

  test("broadcaster names match case-insensitively", () => {
    const g = game(MAMMOTH, RANGERS, [{ name: "UTAH 16", market: "away" }]);
    expect(resolveWatch(g, ["local-ota"], "utah", "nhl").watchable).toBe(true);
  });
});

describe("real ESPN games (fixtures captured 2026-10-04)", () => {
  const fixture = (name: string): any[] =>
    JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8")).events;

  test("Jazz @ Nuggets preseason on NBA TV", () => {
    const e = fixture("nba-schedule-preseason.json").find((x) => x.id === "401914127");
    const g = toGame(e, SEASON_TYPES.preseason);
    expect(resolveWatch(g, ALL, "utah", "nba")).toMatchObject({ watchable: true, via: "Fubo", note: "on NBA TV" });
    expect(resolveWatch(g, ["nba-league-pass"], "utah", "nba")).toMatchObject({ watchable: false });
  });

  test("Mammoth regular season: Utah 16 vs ESPN+/Disney+/Hulu exclusive", () => {
    const events = fixture("nhl-schedule-regular.json");
    const at = (id: string) => toGame(events.find((x) => x.id === id), SEASON_TYPES.regular);
    expect(resolveWatch(at("401892443"), ALL, "utah", "nhl")).toMatchObject({ watchable: true, via: "Utah 16" });
    expect(resolveWatch(at("401891828"), ALL, "utah", "nhl")).toMatchObject({
      watchable: false,
      note: "Disney+ / ESPN+ / Hulu exclusive — no subscription",
    });
  });
});
