import { test, expect } from "bun:test";
// Pure — fixtures only; no network, no ~/.config/sportsing.
import { LEAGUES, parseLeagueSeason, toPlayoffGame, type EspnStandingsEntry, type EspnStandingsGroup, type PlayoffGame } from "./espn.ts";
import {
  BRACKET_FORMATS,
  bracketOrder,
  buildSeries,
  conferenceOf,
  gameWinner,
  parseSeasonArg,
  projectNba,
  projectNhl,
  renderBracket,
  renderProjection,
  seasonLabel,
  seriesStatus,
  type Series,
} from "./playoff-bracket.ts";
import type { Game } from "./game.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const NBA = BRACKET_FORMATS[LEAGUES.nba]!;
const NHL = BRACKET_FORMATS[LEAGUES.nhl]!;

// ── ESPN parsing ─────────────────────────────────────────────────────────────

/** A team-schedule postseason event, shaped like ESPN's 2025-26 responses. */
function rawEvent(opts: { id: string; type: number; headline: string; round?: string; home: string; away: string; hs?: number; as?: number }) {
  const side = (id: string, homeAway: string, score?: number) => ({
    homeAway,
    team: { id, abbreviation: id.toUpperCase(), displayName: `Team ${id}` },
    score: score === undefined ? null : { value: score, displayValue: String(score) },
  });
  return {
    id: opts.id,
    date: "2026-04-19T17:00Z",
    name: "x",
    seasonType: { type: opts.type },
    competitions: [
      {
        notes: [{ type: "event", headline: opts.headline }],
        type: { abbreviation: opts.round ?? "STD" },
        status: { type: { state: opts.hs === undefined ? "pre" : "post" } },
        competitors: [side(opts.home, "home", opts.hs), side(opts.away, "away", opts.as)],
      },
    ],
  };
}

test("toPlayoffGame: round from competition type, conference from the note", () => {
  const pg = toPlayoffGame(rawEvent({ id: "1", type: 3, headline: "East 1st Round - Game 5", round: "RD16", home: "bos", away: "phi" }));
  expect(pg).toMatchObject({ round: 1, conference: "East", playIn: false, label: "East 1st Round" });
  expect(pg.game.seasonType).toBe("postseason");
  expect(toPlayoffGame(rawEvent({ id: "2", type: 3, headline: "West Final - Game 2", round: "SEMI", home: "a", away: "b" }))).toMatchObject({
    round: 3,
    conference: "West",
  });
  // The league final has no conference.
  expect(toPlayoffGame(rawEvent({ id: "3", type: 3, headline: "NBA Finals - Game 4", round: "FINAL", home: "a", away: "b" }))).toMatchObject({
    round: 4,
    conference: null,
    label: "NBA Finals",
  });
  expect(toPlayoffGame(rawEvent({ id: "4", type: 3, headline: "Mystery", round: "??", home: "a", away: "b" })).round).toBeNull();
});

test("toPlayoffGame: NBA play-in (season type 5)", () => {
  const pg = toPlayoffGame(rawEvent({ id: "5", type: 5, headline: "NBA Play-In - West - 8th Seed Game", home: "phx", away: "gs" }));
  expect(pg).toMatchObject({ round: null, conference: "West", playIn: true, label: "8th Seed Game" });
  expect(pg.game.seasonType).toBe("postseason");
});

test("parseLeagueSeason: scoreboard league season, else top-level season, else null", () => {
  expect(parseLeagueSeason({ leagues: [{ season: { year: 2027, type: { type: 1 } } }] })).toEqual({ year: 2027, type: 1 });
  expect(parseLeagueSeason({ season: { year: 2026, type: 3 } })).toEqual({ year: 2026, type: 3 });
  expect(parseLeagueSeason({})).toBeNull();
});

// ── Series ───────────────────────────────────────────────────────────────────

let gid = 0;
function game(home: string, away: string, hs: number | null, as: number | null, date: string): Game {
  const side = (id: string, score: number | null) => ({ id, name: `Team ${id}`, abbreviation: id.toUpperCase(), score: score === null ? "" : String(score) });
  return {
    id: String(++gid),
    date,
    name: "",
    state: hs === null ? "pre" : "post",
    detail: "",
    period: 0,
    clock: "",
    seasonType: "postseason",
    home: side(home, hs),
    away: side(away, as),
    broadcasts: [],
  };
}
const pg = (g: Game, round: number | null, conference: PlayoffGame["conference"], playIn = false): PlayoffGame => ({
  game: g,
  round,
  conference,
  playIn,
  label: "",
});

test("gameWinner: higher score once final; null before, or level", () => {
  expect(gameWinner(game("a", "b", 100, 90, "2026-04-19"))).toBe("a");
  expect(gameWinner(game("a", "b", 2, 3, "2026-04-19"))).toBe("b");
  expect(gameWinner(game("a", "b", null, null, "2026-04-19"))).toBeNull();
});

test("buildSeries: one series per pair, game-one home first, duplicates once, play-in and TBD skipped", () => {
  const g1 = game("bos", "phi", 110, 100, "2026-04-19");
  const g2 = game("phi", "bos", 105, 99, "2026-04-22");
  const g3 = game("bos", "phi", null, null, "2026-04-25");
  const series = buildSeries(
    [
      pg(g2, 1, "East"),
      pg(g1, 1, "East"),
      pg(g1, 1, "East"), // the same game from the other team's schedule
      pg(g3, 1, "East"),
      pg(game("phi", "orl", 109, 97, "2026-04-15"), null, "East", true),
      pg(game("", "bos", null, null, "2026-05-01"), 2, "East"),
    ],
    new Map([["bos", "2"], ["phi", "7"]]),
  );
  expect(series).toHaveLength(1);
  const [s] = series;
  expect(s!.teams.map((t) => [t.id, t.seed, t.wins])).toEqual([
    ["bos", "2", 1],
    ["phi", "7", 1],
  ]);
  expect(s!.games).toHaveLength(3);
  expect(seriesStatus(s!, 4)).toBe("Tied 1-1");
});

function series(round: number, a: [string, string, number], b: [string, string, number], conference: Series["conference"] = "East"): Series {
  const t = ([id, seed, wins]: [string, string, number]) => ({ id, name: `Team ${id}`, abbreviation: id.toUpperCase(), seed, wins });
  return { round, conference, teams: [t(a), t(b)], games: [] };
}

test("seriesStatus: winner, leader, tied, not started", () => {
  expect(seriesStatus(series(1, ["okc", "1", 4], ["phx", "8", 0]), 4)).toBe("OKC wins 4-0");
  expect(seriesStatus(series(1, ["bos", "2", 3], ["phi", "7", 4]), 4)).toBe("PHI wins 4-3");
  expect(seriesStatus(series(1, ["ny", "3", 1], ["atl", "6", 3]), 4)).toBe("ATL leads 3-1");
  expect(seriesStatus(series(1, ["a", "1", 0], ["b", "8", 0]), 4)).toBe("Not started");
});

test("bracketOrder: rounds ascending; earlier series follow the later series they feed", () => {
  const r1 = [
    series(1, ["det", "1", 4], ["orl", "8", 3]),
    series(1, ["bos", "2", 3], ["phi", "7", 4]),
    series(1, ["ny", "3", 4], ["atl", "6", 2]),
    series(1, ["cle", "4", 4], ["tor", "5", 3]),
  ];
  const r2 = [series(2, ["det", "1", 3], ["cle", "4", 4]), series(2, ["ny", "3", 4], ["phi", "7", 0])];
  const ids = (s: Series) => s.teams.map((t) => t.id).join("-");
  expect(bracketOrder([...r1, ...r2]).map(ids)).toEqual(["det-orl", "cle-tor", "ny-atl", "bos-phi", "det-cle", "ny-phi"]);
  // Only one round known: by best seed.
  expect(bracketOrder([...r1].reverse()).map(ids)).toEqual(["det-orl", "bos-phi", "ny-atl", "cle-tor"]);
});

test("renderBracket: play-in, conference rounds, the final; winners ticked, favorites starred", () => {
  const out = strip(
    renderBracket(
      NBA,
      [
        series(1, ["ny", "3", 4], ["atl", "6", 2]),
        series(1, ["okc", "1", 4], ["phx", "8", 0], "West"),
        series(4, ["sa", "2", 1], ["ny", "3", 4], null),
      ],
      [pg(game("phi", "orl", 109, 97, "2026-04-15"), null, "East", true)],
      new Set(["ny"]),
    ),
  );
  expect(out).toContain("Play-In");
  expect(out).toContain("Eastern Conference");
  expect(out).toContain("First Round");
  expect(out).toContain("NBA Finals");
  expect(out).toMatch(/✓ ★ \(3\) Team ny\s+4-2\s+\(6\) Team atl\s+NY wins 4-2/);
  expect(out).toContain("NY wins 4-1");
  expect(out).toContain("97-109");
  expect(out.indexOf("Play-In")).toBeLessThan(out.indexOf("Eastern Conference"));
  expect(out.indexOf("Western Conference")).toBeLessThan(out.indexOf("NBA Finals"));
});

test("renderBracket: next game for an open series", () => {
  const next = game("ny", "atl", null, null, "2099-04-25T23:00Z");
  const s: Series = { ...series(1, ["ny", "3", 2], ["atl", "6", 1]), games: [game("ny", "atl", 1, 0, "2026-04-19"), game("ny", "atl", 1, 0, "2026-04-21"), game("atl", "ny", 1, 0, "2026-04-23"), next] };
  expect(strip(renderBracket(NHL, [s], [], new Set(), Date.parse("2026-04-24")))).toContain("NY leads 2-1 · Game 4 ");
});

// ── Projection ───────────────────────────────────────────────────────────────

const entry = (teamId: string, stats: Record<string, string>): EspnStandingsEntry => ({
  teamId,
  team: `Team ${teamId}`,
  abbreviation: teamId.toUpperCase(),
  stats,
});
const group = (name: string, entries: EspnStandingsEntry[], parent: string | null = null): EspnStandingsGroup => ({
  name,
  abbreviation: name.split(" ")[0]!,
  parent: parent ? { name: parent, abbreviation: parent.split(" ")[0]! } : null,
  entries,
});

test("conferenceOf", () => {
  expect(conferenceOf("Eastern Conference")).toBe("East");
  expect(conferenceOf("west")).toBe("West");
  expect(conferenceOf("Pacific Division")).toBeNull();
});

test("projectNba: ranks by record; 1-6 in, 7-10 play-in, 1v8 4v5 3v6 2v7", () => {
  // e1 is best; listed shuffled. e15 worst.
  const east = Array.from({ length: 15 }, (_, i) => entry(`e${i + 1}`, { winPercent: String(0.9 - i * 0.05) })).reverse();
  const [p] = projectNba([group("Eastern Conference", east)], "winPercent");
  expect(p!.conference).toBe("East");
  const show = ([a, b]: [any, any]) => `${a.seed}:${a.team?.teamId ?? a.placeholder} v ${b.seed}:${b.team?.teamId ?? b.placeholder}`;
  expect(p!.matchups.map(show)).toEqual([
    "1:e1 v 8:Play-in winner",
    "4:e4 v 5:e5",
    "3:e3 v 6:e6",
    "2:e2 v 7:Play-in winner",
  ]);
  expect(p!.playIn.map(show)).toEqual(["7:e7 v 8:e8", "9:e9 v 10:e10"]);
  // Too few teams to project: skipped rather than half-drawn.
  expect(projectNba([group("Western Conference", east.slice(0, 5))], "winPercent")).toEqual([]);
});

test("projectNhl: top three per division + two wild cards; better division winner gets WC2", () => {
  const div = (name: string, prefix: string, pts: number[]) =>
    group(name, pts.map((p, i) => entry(`${prefix}${i + 1}`, { points: String(p) })), "Western Conference");
  // Central winner (110) beats Pacific winner (100), so plays WC2.
  // Wild cards: c4 (95) then p4 (90); c5 (89) misses.
  const central = div("Central Division", "c", [110, 105, 96, 95, 89]);
  const pacific = div("Pacific Division", "p", [100, 99, 97, 90, 80]);
  const [p] = projectNhl([pacific, central], "points");
  const show = ([a, b]: [any, any]) => `${a.seed}:${a.team.teamId} v ${b.seed}:${b.team.teamId}`;
  expect(p!.matchups.map(show)).toEqual(["C1:c1 v WC2:p4", "C2:c2 v C3:c3", "P1:p1 v WC1:c4", "P2:p2 v P3:p3"]);
  expect(p!.playIn).toEqual([]);
});

test("renderProjection: play-in and first round per conference; placeholders and favorites", () => {
  const east = Array.from({ length: 10 }, (_, i) => entry(`e${i + 1}`, { winPercent: String(0.9 - i * 0.05) }));
  const out = strip(renderProjection(NBA, projectNba([group("Eastern Conference", east)], "winPercent"), new Set(["e4"])));
  expect(out).toContain("Eastern Conference");
  expect(out).toContain("Play-In");
  expect(out).toMatch(/\(1\) Team e1\s+vs\s+\(8\) Play-in winner/);
  expect(out).toMatch(/★ \(4\) Team e4\s+vs\s+\(5\) Team e5/);
});

test("parseSeasonArg / seasonLabel", () => {
  expect(parseSeasonArg("2026")).toBe(2026);
  expect(parseSeasonArg("2025-26")).toBe(2026);
  expect(parseSeasonArg("1999-00")).toBe(2000);
  expect(parseSeasonArg("2025-27")).toBeNull();
  expect(parseSeasonArg("last")).toBeNull();
  expect(seasonLabel(2026)).toBe("2025-26");
  expect(seasonLabel(2000)).toBe("1999-00");
});
