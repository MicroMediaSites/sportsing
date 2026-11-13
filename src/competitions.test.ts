import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Following a soccer team outside its league (AGT-2463): cups and Europe for a
// club, every competition for a national team. Pure — no network, never reads
// or writes ~/.config/sportsing. The schedule fixture is a trimmed
// `soccer/all/teams/111/schedule?fixture=true` (Juventus, captured 2026-11-12).
import { LEAGUES, SOCCER_ALL, competitionOf, competitionSlug, followsAllCompetitions, soccerCompetition, toGame } from "./espn.ts";
import { activeCompetitions, favSport, leagueHasCommand, ownGame, resolveTeam, trackLiveBoards, unknownFavoriteNote } from "./commands/league.ts";
import { allJson, bothHalves, joinTeamRows, worldCupIsOn, type Row, type TeamRows } from "./commands/cross.ts";
import { leagueDaemonGame, leagueRoute } from "./daemon.ts";
import { gameLine } from "./format.ts";
import type { Game } from "./game.ts";
import { INTL, WORLD_CUP, notWorldCup } from "./sports/intl.ts";
import { EPL, LIGUE1, SERIEA } from "./sports/soccer.ts";
import { NBA } from "./sports/nba.ts";
import { pickProvider } from "./stream.ts";
import { resolveWatch } from "./watchability.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const events: any[] = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "espn", "soccer-schedule-all-competitions.json"), "utf8"),
).events;
/** The fixture as getSoccerTeamGames parses it. */
const scheduled = (): Game[] =>
  events.map((e) => {
    const competition = competitionOf(e);
    return competition ? { ...toGame(e), competition } : toGame(e);
  });

const DAY = 24 * 60 * 60_000;
function game(over: Partial<Game> = {}): Game {
  return {
    id: "1",
    date: "2026-11-26T20:00Z",
    name: "Omonia Nicosia at Juventus",
    state: "pre",
    detail: "",
    period: 0,
    clock: "",
    seasonType: "regular",
    home: { id: "111", name: "Juventus", abbreviation: "JUV", score: "" },
    away: { id: "999", name: "Omonia Nicosia", abbreviation: "OMON", score: "" },
    broadcasts: [],
    ...over,
  };
}
const UEL = { slug: "uefa.europa", name: "UEFA Europa League" };
const NATIONS = { slug: "uefa.nations", name: "UEFA Nations League" };

describe("competition paths", () => {
  test("a slug ESPN reports becomes a soccer path; anything else is refused", () => {
    expect(soccerCompetition("uefa.europa")).toBe("soccer/uefa.europa");
    expect(soccerCompetition("ita.coppa_italia")).toBe("soccer/ita.coppa_italia");
    expect(soccerCompetition("concacaf.nations.league")).toBe("soccer/concacaf.nations.league");
    for (const bad of ["", "../nba", "uefa/europa", "uefa.europa?x=1", "UEFA.EUROPA", "a..b", ".a", "a b", "all/teams"]) {
      expect([bad, soccerCompetition(bad)]).toEqual([bad, null]);
    }
  });

  test("competitionSlug is the league path without its sport", () => {
    expect(competitionSlug(LEAGUES.seriea)).toBe("ita.1");
    expect(competitionSlug(SOCCER_ALL)).toBe("all");
  });

  test("the club leagues and the national teams are followed everywhere; NBA, NHL and the World Cup are not", () => {
    expect([LEAGUES.epl, LEAGUES.seriea, LEAGUES.ligue1, LEAGUES.intl].map(followsAllCompetitions)).toEqual([true, true, true, true]);
    expect([LEAGUES.nba, LEAGUES.nhl, LEAGUES.fifa].map(followsAllCompetitions)).toEqual([false, false, false]);
  });
});

describe("a team's schedule across competitions", () => {
  test("each event carries the competition ESPN lists it under", () => {
    expect(scheduled().map((g) => [g.name, g.competition])).toEqual([
      ["Venezia at Juventus", { slug: "ita.1", name: "Italian Serie A" }],
      ["Omonia Nicosia at Juventus", UEL],
      ["Juventus at Como", { slug: "ita.1", name: "Italian Serie A" }],
      ["Sassuolo at Juventus", { slug: "ita.coppa_italia", name: "Coppa Italia" }],
    ]);
  });

  test("competitionOf: no league, or a slug that isn't path-safe, is no competition", () => {
    expect(competitionOf({})).toBeUndefined();
    expect(competitionOf({ league: { slug: "../x", name: "Bad" } })).toBeUndefined();
    expect(competitionOf({ league: { slug: "uefa.europa" } })).toEqual({ slug: "uefa.europa", name: "uefa.europa" });
  });

  test("competitionOf: control characters in the feed's name never reach the terminal", () => {
    expect(competitionOf({ league: { slug: "uefa.europa", name: "\u001b[31mUEFA\u0007 Europa League\u009b" } })?.name).toBe("[31mUEFA Europa League");
    expect(competitionOf({ league: { slug: "uefa.europa", name: "\u001b\u0007" } })?.name).toBe("uefa.europa");
  });

  test("ownGame: a club's league games lose the tag, its cup and European games keep it", () => {
    expect(scheduled().map((g) => ownGame(SERIEA, g).competition?.slug)).toEqual([undefined, "uefa.europa", undefined, "ita.coppa_italia"]);
    // Another league's config doesn't own Serie A games.
    expect(ownGame(EPL, scheduled()[0]!).competition?.slug).toBe("ita.1");
  });

  test("ownGame: a national team has no league of its own — every game keeps its tag", () => {
    const friendly = game({ competition: { slug: "fifa.friendly", name: "International Friendly" } });
    expect(ownGame(INTL, friendly).competition?.slug).toBe("fifa.friendly");
  });

  test("gameLine ends with the competition for a game outside the league", () => {
    const [serieA, europa] = scheduled().map((g) => ownGame(SERIEA, g));
    expect(strip(gameLine(europa!))).toMatch(/^OMON\s+@\s+JUV\s+.*\s+UEFA Europa League$/);
    expect(strip(gameLine(serieA!))).not.toContain("Serie A");
  });
});

describe("which scoreboards to read", () => {
  const now = Date.parse("2026-11-12T12:00Z");
  const at = (days: number, competition?: Game["competition"]) =>
    game({ id: String(days), date: new Date(now + days * DAY).toISOString(), ...(competition ? { competition } : {}) });

  test("activeCompetitions: other competitions with a game within 45 days either side, once each", () => {
    const coppa = { slug: "ita.coppa_italia", name: "Coppa Italia" };
    const old = { slug: "club.friendly", name: "Club Friendly" };
    const games = [at(-117, old), at(-7, UEL), at(3), at(14, UEL), at(21, coppa), at(80, { slug: "ita.super_cup", name: "Supercoppa" })];
    expect(activeCompetitions(games, now)).toEqual([UEL, coppa]);
    expect(activeCompetitions([at(3)], now)).toEqual([]);
  });

  test("trackLiveBoards: adds the nearby games' scoreboards (US-Eastern day) and keeps earlier ones until they age out", () => {
    const boards = new Map();
    // 00:30Z is still the previous day in US-Eastern: ESPN lists it there.
    const late = game({ id: "a", date: "2026-11-13T00:30Z", competition: { slug: "concacaf.nations.league", name: "Concacaf Nations League" } });
    trackLiveBoards(boards, [late, game({ id: "b", date: "2026-11-12T19:45Z", competition: NATIONS }), game({ id: "c" })], "20261110");
    expect([...boards.keys()].sort()).toEqual(["concacaf.nations.league|20261112", "uefa.nations|20261112"]);

    // Next poll: the schedule no longer lists either game (it lags after full
    // time) — the boards are still read, so the poller sees the games end.
    trackLiveBoards(boards, [], "20261111");
    expect(boards.size).toBe(2);
    // Two days on they're dropped.
    trackLiveBoards(boards, [], "20261113");
    expect(boards.size).toBe(0);
  });
});

describe("where to watch a game in another competition", () => {
  const subs = ["fubo", "peacock", "paramount-plus"] as const;

  test("a league's assumed service is not applied to its clubs' cup and European games", () => {
    const leagueMatch = game();
    expect(resolveWatch(leagueMatch, subs, "utah", "epl")).toMatchObject({ watchable: true, service: "peacock", note: "no broadcast listed yet (assumed)" });
    expect(resolveWatch(leagueMatch, subs, "utah", "ligue1")).toMatchObject({ watchable: true, service: "fubo" });
    const cup = game({ competition: { slug: "eng.fa", name: "English FA Cup" } });
    expect(resolveWatch(cup, subs, "utah", "epl")).toMatchObject({ watchable: "unknown", note: "no broadcasts listed yet" });
    expect(resolveWatch(game({ competition: { slug: "uefa.champions", name: "UEFA Champions League" } }), subs, "utah", "ligue1").watchable).toBe("unknown");
  });

  test("listed broadcasts still decide: Paramount+ for Europe, FS1/FS2 on Fubo for national teams", () => {
    const europa = game({ competition: UEL, broadcasts: [{ name: "Paramount+", market: "national" }] });
    expect(resolveWatch(europa, subs, "utah", "seriea")).toMatchObject({ watchable: true, service: "paramount-plus" });
    for (const name of ["FS1", "FS2"]) {
      const nations = game({ competition: NATIONS, broadcasts: [{ name, market: "national" }] });
      expect(resolveWatch(nations, subs, "utah", "intl")).toMatchObject({ watchable: true, service: "fubo", note: `on ${name}` });
    }
    // A national-team game nothing lists stays unknown: there's no usual home to assume.
    expect(resolveWatch(game({ competition: NATIONS }), subs, "utah", "intl").watchable).toBe("unknown");
  });

  test("pickProvider: a competition's own page wins over the sport's hub, and stands in for a missing one", () => {
    const ucl = "https://www.paramountplus.com/shows/uefa-champions-league/";
    expect(pickProvider("paramount-plus", "seriea", undefined, "uefa.europa")).toMatchObject({ ok: true, hub: "https://www.paramountplus.com/shows/uefa-europa-league/" });
    // PSG in the Champions League: Paramount+ has no Ligue 1 hub, but it has this page.
    expect(pickProvider("paramount-plus", "ligue1").ok).toBe(false);
    expect(pickProvider("paramount-plus", "ligue1", undefined, "uefa.champions")).toMatchObject({ ok: true, hub: ucl });
    // No page for the competition: the sport's hub, as before.
    expect(pickProvider("paramount-plus", "seriea", undefined, "ita.coppa_italia")).toMatchObject({ ok: true, hub: "https://www.paramountplus.com/shows/serie-a/" });
    expect(pickProvider("fubo", "intl", undefined, "uefa.nations")).toMatchObject({ ok: true, hub: "https://www.fubo.tv/p/soccer" });
    // Feed data never reaches a prototype key.
    expect(pickProvider("paramount-plus", "ligue1", undefined, "constructor").ok).toBe(false);
    expect(pickProvider("constructor", "seriea").ok).toBe(false);
  });
});

describe("the intl namespace (national teams)", () => {
  test("its favorites are the fifa ones; a league's are its own", () => {
    expect(favSport(INTL)).toBe("fifa");
    expect([NBA, SERIEA, LIGUE1].map(favSport)).toEqual(["nba", "seriea", "ligue1"]);
  });

  test("it has the team commands only — nothing that needs a league table or league-wide board", () => {
    for (const cmd of ["today", "t", "next", "n", "schedule", "results", "watch", "teams", "fav"]) expect([cmd, leagueHasCommand(cmd, INTL)]).toEqual([cmd, true]);
    for (const cmd of ["standings", "st", "stats", "live", "roster", "squad", "season", "bracket", "analyze", "predict", "recap", "toString"]) {
      expect([cmd, leagueHasCommand(cmd, INTL)]).toEqual([cmd, false]);
    }
    // The club leagues are unaffected by the allowlist.
    expect(leagueHasCommand("standings", SERIEA)).toBe(true);
  });

  test("favorites as typed for fifa resolve against ESPN's national teams", () => {
    const team = (id: string, abbreviation: string, name: string) => ({ id, abbreviation, name, shortName: name, location: name });
    const teams = [team("660", "USA", "United States"), team("478", "FRA", "France"), team("465", "TUR", "Türkiye"), team("449", "NED", "Netherlands")];
    const id = (input: string) => resolveTeam(teams, input, INTL.aliases)?.id;
    expect(["USA", "usmnt", "United States", "France", "fra", "Turkey", "Türkiye", "Holland"].map(id)).toEqual(["660", "660", "660", "478", "478", "465", "465", "449"]);
    expect(id("Atlantis")).toBeUndefined();
  });

  test("fav add says so when a name isn't a national team it can follow", () => {
    expect(unknownFavoriteNote(INTL, "Atlantis")).toBe(
      `"Atlantis" isn't a team sportsing intl knows, so its International games won't show — see \`sportsing intl teams\`.`,
    );
  });

  test("`all --json` rows name the competition of a game outside the league", () => {
    const row = (g: Game) => ({ sport: { key: "seriea", label: "Serie A", icon: "⚽" }, game: g, line: "", cell: "", watch: { watchable: null, via: null, note: "" }, favorite: true });
    expect(allJson(row(game({ competition: UEL }))).competition).toBe("UEFA Europa League");
    expect(allJson(row(game())).competition).toBeNull();
  });

  test("notWorldCup drops only World Cup games — `sportsing fifa` already follows those", () => {
    const games = [game({ competition: NATIONS }), game({ competition: { slug: WORLD_CUP, name: "FIFA World Cup" } }), game()];
    expect(games.map(notWorldCup)).toEqual([true, false, true]);
  });

  test("the daemon opens a national-team game through `intl watch`, routed by its listed broadcast", () => {
    const g = game({
      id: "401",
      date: "2026-11-12T19:45Z",
      name: "France at Italy",
      state: "in",
      home: { id: "162", name: "Italy", abbreviation: "ITA", score: "1" },
      away: { id: "478", name: "France", abbreviation: "FRA", score: "0" },
      broadcasts: [{ name: "FS1", market: "national" }],
      competition: NATIONS,
    });
    const route = leagueRoute(g, { sport: "intl", subscriptions: ["fubo"], homeMarket: "utah" }, INTL.watchProvider ?? null);
    expect(route).toEqual({ kind: "open", note: "Fubo — on FS1" });
    expect(leagueDaemonGame(INTL.sport, INTL.icon, g, new Set(["478"]), route)).toMatchObject({
      key: "intl:401",
      fixture: "FRA @ ITA",
      state: "in",
      openArgs: ["intl", "watch", "478", "--supervised"],
      clickArgs: ["intl", "watch", "478"],
    });
  });
});

describe("fifa in the cross-sport views = the World Cup + every other competition", () => {
  const row = (id: string, start: string): Row => ({ id, start, state: "post", line: id });
  const DURING = Date.parse("2026-06-20T00:00Z");
  const AFTER = Date.parse("2026-11-12T00:00Z");
  const concat = <T>(a: T[] | null, b: T[] | null) => (a === null && b === null ? null : [...(a ?? []), ...(b ?? [])]);

  test("worldCupIsOn: the tournament and a week either side", () => {
    expect(["2026-06-01T00:00Z", "2026-06-05T00:00Z", "2026-07-19T20:00Z", "2026-07-25T00:00Z", "2026-07-28T00:00Z"].map((d) => worldCupIsOn(Date.parse(d)))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  test("joinTeamRows: one entry per team, the two feeds' games merged by start time", () => {
    const wc: TeamRows[] = [
      { team: "USA", rows: [row("wc-usa", "2026-06-12T00:00Z")] },
      { team: "France", rows: [row("wc-fra", "2026-07-10T00:00Z")] },
    ];
    const others: TeamRows[] = [
      { team: "United States", rows: [row("friendly", "2026-09-05T00:00Z")] },
      { team: "France", rows: [row("nations-2", "2026-11-12T19:45Z"), row("nations-1", "2026-10-02T18:45Z")] },
    ];
    const nameOf = (fav: string) => ({ USA: "United States", France: "France" })[fav];
    expect(joinTeamRows(wc, others, nameOf)!.map((t) => [t.team, t.rows.map((r) => r.id)])).toEqual([
      ["USA", ["wc-usa", "friendly"]],
      ["France", ["wc-fra", "nations-1", "nations-2"]],
    ]);
  });

  test("joinTeamRows: a team only one feed knows keeps its own entry; one feed alone passes through", () => {
    const wc: TeamRows[] = [{ team: "Wakanda", rows: [] }];
    const others: TeamRows[] = [{ team: "Italy", rows: [row("x", "2026-11-12T19:45Z")] }];
    expect(joinTeamRows(wc, others)!.map((t) => t.team)).toEqual(["Wakanda", "Italy"]);
    expect(joinTeamRows(null, others)).toBe(others);
    expect(joinTeamRows(wc, null)).toBe(wc);
    expect(joinTeamRows(null, null)).toBeNull();
  });

  test("bothHalves: both feeds' games; null only when neither has favorites", async () => {
    expect(await bothHalves(async () => ["wc"], async () => ["nations"], concat, AFTER)).toEqual(["wc", "nations"]);
    expect(await bothHalves<string[]>(async () => null, async () => null, concat, AFTER)).toBeNull();
    expect(await bothHalves<string[]>(async () => null, async () => [], concat, AFTER)).toEqual([]);
  });

  test("bothHalves: a World Cup feed that can't run (no API key) doesn't hide the other games — except during the World Cup", async () => {
    const noKey = async (): Promise<string[]> => {
      throw new Error("needs an API key");
    };
    expect(await bothHalves(noKey, async () => ["nations"], concat, AFTER)).toEqual(["nations"]);
    await expect(bothHalves(noKey, async () => ["nations"], concat, DURING)).rejects.toThrow("needs an API key");
  });

  test("bothHalves: the other feed failing is reported unless the World Cup has games to show", async () => {
    const down = async (): Promise<string[]> => {
      throw new Error("ESPN down");
    };
    expect(await bothHalves(async () => ["wc"], down, concat, DURING)).toEqual(["wc"]);
    await expect(bothHalves<string[]>(async () => null, down, concat, AFTER)).rejects.toThrow("ESPN down");
    const noKey = async (): Promise<string[]> => {
      throw new Error("no key");
    };
    await expect(bothHalves(noKey, down, concat, AFTER)).rejects.toThrow("ESPN down");
  });
});
