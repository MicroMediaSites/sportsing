import { afterEach, beforeEach, describe, test, expect, setSystemTime, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGameSummary, parseTeams, toGame, SEASON_TYPES, type EspnGameSummary } from "../espn.ts";
import type { Game } from "../game.ts";
import { NBA } from "../sports/nba.ts";
import { resolveTeam } from "./league.ts";
import { leagueAnalyze, leaguePredict, leagueRecap, pickPlayed, pickUpcoming, resolveTerms, withTeam, type LeagueGames } from "./league-ai.ts";

// The NBA/NHL AI commands against real ESPN fixtures (captured 2026-10-04),
// through a fake LeagueGames — no network, no ask bus (every run uses --prompt),
// no config.
const fixture = (name: string): any => JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "espn", name), "utf8"));
const jazzSeason = (fixture("nba-schedule-preseason.json").events as any[]).map((e) => toGame(e, SEASON_TYPES.preseason));
const nbaSummary = parseGameSummary(fixture("nba-summary-preseason-final.json"))!;

const teams = parseTeams({
  sports: [{ leagues: [{ teams: [
    { team: { id: "26", abbreviation: "UTAH", displayName: "Utah Jazz", shortDisplayName: "Jazz", location: "Utah" } },
    { team: { id: "7", abbreviation: "DEN", displayName: "Denver Nuggets", shortDisplayName: "Nuggets", location: "Denver" } },
    { team: { id: "13", abbreviation: "LAL", displayName: "Los Angeles Lakers", shortDisplayName: "Lakers", location: "Los Angeles" } },
  ] }] }],
});

/** Fake league data: every team's season is the Jazz fixture (it holds both Jazz–Nuggets games). */
function fakeGames(summary: EspnGameSummary | null = nbaSummary): LeagueGames & { summaries: string[] } {
  const summaries: string[] = [];
  return {
    summaries,
    team: async (input) => resolveTeam(teams, input, NBA.aliases),
    season: async (id) => withTeam(jazzSeason, id),
    summary: async (id) => {
      summaries.push(id);
      return summary;
    },
  };
}

let out: string[];
let logSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  out = [];
  logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  errSpy = spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = 0;
});

describe("game selection", () => {
  const at = (id: string, date: string, state: Game["state"]): Game => ({ ...jazzSeason[0]!, id, date, state });

  test("pickPlayed: live beats finished; else the newest finished; never an unplayed game", () => {
    expect(pickPlayed([at("a", "2026-10-01T00:00Z", "post"), at("b", "2026-10-03T00:00Z", "post"), at("c", "2026-10-05T00:00Z", "pre")])?.id).toBe("b");
    expect(pickPlayed([at("a", "2026-10-01T00:00Z", "post"), at("l", "2026-10-02T00:00Z", "in")])?.id).toBe("l");
    expect(pickPlayed([at("c", "2026-10-05T00:00Z", "pre")])).toBeNull();
  });

  test("pickUpcoming: the soonest unstarted game at or after now", () => {
    const games = [at("x", "2026-10-09T00:00Z", "pre"), at("y", "2026-10-07T00:00Z", "pre"), at("z", "2026-10-02T00:00Z", "post")];
    expect(pickUpcoming(games, Date.parse("2026-10-05T00:00Z"))?.id).toBe("y");
    expect(pickUpcoming(games, Date.parse("2026-10-10T00:00Z"))).toBeNull();
  });
});

describe("resolveTerms", () => {
  test("a whole phrase is one team; separate terms are two; unknown throws", async () => {
    const g = fakeGames();
    expect((await resolveTerms(NBA, g, ["Utah", "Jazz"])).map((t) => t.id)).toEqual(["26"]);
    expect((await resolveTerms(NBA, g, ["jazz", "nuggets"])).map((t) => t.id)).toEqual(["26", "7"]);
    expect((await resolveTerms(NBA, g, ["UTA"])).map((t) => t.id)).toEqual(["26"]);
    await expect(resolveTerms(NBA, g, ["jazz", "zzz"])).rejects.toThrow('Unknown NBA team "zzz"');
    await expect(resolveTerms(NBA, g, ["a", "b", "c"])).rejects.toThrow("one or two NBA teams");
  });
});

describe("commands (--prompt)", () => {
  test("analyze: the latest finished Jazz game's NBA prompt", async () => {
    const g = fakeGames();
    await leagueAnalyze(NBA, g, ["jazz", "--prompt"]);
    expect(g.summaries).toEqual(["401914127"]);
    const p = out.join("\n");
    expect(p).toContain("basketball analyst");
    expect(p).toContain("Game: UTAH 109–97 DEN (Final)");
  });

  test("analyze vs a team the Jazz haven't played: a note, no summary fetch", async () => {
    const g = fakeGames();
    await leagueAnalyze(NBA, g, ["jazz", "lakers", "--prompt"]);
    expect(g.summaries).toEqual([]);
    expect(out.join("\n")).toContain("No played NBA game found for Utah Jazz vs Los Angeles Lakers");
  });

  test("analyze with no box score yet: a note, no prompt", async () => {
    await leagueAnalyze(NBA, fakeGames(null), ["jazz", "--prompt"]);
    expect(out.join("\n")).toContain("No team stats for Utah Jazz at Denver Nuggets yet");
  });

  test("predict: the next Jazz game, both teams' form", async () => {
    setSystemTime(new Date("2026-10-05T12:00Z")); // between the fixture's final and its next game
    try {
      await leaguePredict(NBA, fakeGames(), ["UTAH", "--prompt"]);
    } finally {
      setSystemTime();
    }
    const p = out.join("\n");
    expect(p).toContain("Upcoming NBA preseason game: Denver Nuggets (away) at Utah Jazz (home)");
    expect(p).toContain("Utah Jazz recent form (oldest → newest): W 109-97 @ DEN [preseason]");
    expect(p).toContain("Denver Nuggets recent form (oldest → newest): L 97-109 vs UTAH [preseason]");
  });

  test("recap: the catch-up prompt in basketball terms", async () => {
    await leagueRecap(NBA, fakeGames(), ["jazz", "nuggets", "--prompt"]);
    const p = out.join("\n");
    expect(p).toContain("concise basketball commentator");
    expect(p).toContain("End of 4th: UTAH 109–97 DEN");
  });

  test("no team: usage error, exit 1", async () => {
    await leagueRecap(NBA, fakeGames(), ["--prompt"]);
    expect(out.join("\n")).toContain("Usage: sportsing nba recap <team> [team] [--prompt]");
    expect(process.exitCode).toBe(1);
  });
});
