import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Alias resolution against trimmed ESPN /teams fixtures, and the no-favorite
// paths (run as subprocesses under a temp HOME so the real config is never
// read or written; none of these paths touches the network).
import { leagueHasCommand, resolveTeam } from "../commands/league.ts";
import { SPORTS } from "../commands/cross.ts";
import { parseTeams } from "../espn.ts";
import { EPL, LIGUE1, SERIEA } from "./soccer.ts";

const teamsOf = (name: string) =>
  parseTeams(JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "fixtures", "espn", `soccer-teams-${name}.json`), "utf8")));
const abbr = (cfg: typeof EPL, teams: ReturnType<typeof teamsOf>, input: string) => resolveTeam(teams, input, cfg.aliases)?.abbreviation;

test("epl: club names and aliases resolve to ESPN's odd abbreviations", () => {
  const teams = teamsOf("epl");
  const cases: [string, string][] = [
    ["Man City", "MNC"], // ESPN short name
    ["man city", "MNC"],
    ["MCI", "MNC"], // alias
    ["Manchester City", "MNC"],
    ["Man United", "MAN"],
    ["Man Utd", "MAN"], // alias
    ["MAN", "MAN"],
    ["Spurs", "TOT"],
    ["Forest", "NFO"], // alias
    ["Nottm Forest", "NFO"],
    ["Palace", "CRY"],
    ["Arsenal", "ARS"],
    ["ars", "ARS"],
  ];
  for (const [input, want] of cases) expect([input, abbr(EPL, teams, input)]).toEqual([input, want]);
  expect(abbr(EPL, teams, "Nowhere FC")).toBeUndefined();
});

test("seriea: Inter, Juve, Milan, Roma and the rest", () => {
  const teams = teamsOf("seriea");
  const cases: [string, string][] = [
    ["Inter", "INT"], // alias
    ["Inter Milan", "INT"],
    ["Internazionale", "INT"],
    ["Juve", "JUV"], // alias
    ["JUV", "JUV"],
    ["Juventus", "JUV"],
    ["Milan", "MIL"],
    ["AC Milan", "MIL"],
    ["Roma", "ROMA"],
    ["AS Roma", "ROMA"],
    ["Napoli", "NAP"],
    ["Lazio", "LAZ"],
    ["Atalanta", "ATA"],
  ];
  for (const [input, want] of cases) expect([input, abbr(SERIEA, teams, input)]).toEqual([input, want]);
});

test("ligue1: PSG, OM, OL, Monaco", () => {
  const teams = teamsOf("ligue1");
  const cases: [string, string][] = [
    ["PSG", "PSG"],
    ["Paris Saint-Germain", "PSG"],
    ["OM", "OLM"], // alias
    ["Marseille", "OLM"],
    ["OL", "LYON"], // alias
    ["Lyon", "LYON"],
    ["Monaco", "MON"],
    ["AS Monaco", "MON"],
  ];
  for (const [input, want] of cases) expect([input, abbr(LIGUE1, teams, input)]).toEqual([input, want]);
  expect(abbr(LIGUE1, teams, "Paris")).toBeUndefined(); // PSG or Paris FC
});

test("every alias points at a real abbreviation (or one not in this fixture's season)", () => {
  // Aliases whose club is outside the current fixture (promoted/relegated sides).
  const offSeason = new Set(["WOL"]);
  for (const [cfg, name] of [[EPL, "epl"], [SERIEA, "seriea"], [LIGUE1, "ligue1"]] as const) {
    const abbrs = new Set(teamsOf(name).map((t) => t.abbreviation));
    for (const [k, v] of Object.entries(cfg.aliases)) expect([k, abbrs.has(v) || offSeason.has(v)]).toEqual([k, true]);
  }
});

test("season and bracket have no soccer form; the other commands do", () => {
  for (const cfg of [EPL, SERIEA, LIGUE1]) {
    expect(leagueHasCommand("season", cfg)).toBe(false);
    expect(leagueHasCommand("bracket", cfg)).toBe(false);
    for (const cmd of ["today", "next", "schedule", "results", "standings", "fav", "watch", "live"]) {
      expect(leagueHasCommand(cmd, cfg)).toBe(true);
    }
  }
  expect(leagueHasCommand("season")).toBe(true); // NBA/NHL unaffected
});

test("the registry lists the three soccer leagues, tagged by their short labels", () => {
  expect(SPORTS.map((s) => s.key)).toEqual(["fifa", "nba", "nhl", "epl", "seriea", "ligue1"]);
  expect(SPORTS.filter((s) => s.has("season")).map((s) => s.key)).toEqual(["nba", "nhl"]);
  expect(SPORTS.slice(3).map((s) => [s.label, s.icon])).toEqual([["EPL", "⚽"], ["Serie A", "⚽"], ["Ligue 1", "⚽"]]);
});

// ── No favorite ──────────────────────────────────────────────────────────────

async function sportsing(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  const home = `/tmp/sportsing-test-home-${crypto.randomUUID()}`;
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "index.ts"), ...args], {
    env: { ...process.env, HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  return { out: strip(out), err: strip(err), code };
}

test("no favorite: `epl fav` and `epl <view> --mine` print the add-a-club hint, no stack trace", async () => {
  for (const args of [["fav"], ["fav", "list"], ["today", "--mine"], ["next", "--mine"], ["schedule", "--mine"], ["results", "--mine"]]) {
    const r = await sportsing("epl", ...args);
    expect([args, r.code, r.err]).toEqual([args, 0, ""]);
    expect(r.out).toContain("sportsing epl fav add ARS");
    expect(r.out).not.toContain("at ");
  }
});

test("no favorite: `epl watch` with no team says so and exits 1", async () => {
  const r = await sportsing("epl", "watch");
  expect(r.code).toBe(1);
  expect(r.err).toContain("No Premier League favorites");
  expect(r.err).toContain("sportsing epl fav add ARS");
  expect(r.err).not.toMatch(/\n\s+at /);
});

test("no favorite: bare `today` skips quietly (every sport empty → the add-a-favorite hint)", async () => {
  const r = await sportsing("today");
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  expect(r.out).toContain("No favorite teams yet");
});

test("help lists the leagues; league help omits season and bracket", async () => {
  const top = await sportsing("help");
  for (const k of ["epl", "seriea", "ligue1"]) expect(top.out).toContain(`sportsing ${k} help`);
  for (const k of ["epl", "seriea", "ligue1"]) {
    const r = await sportsing(k, "help");
    expect(r.out).toContain("standings");
    expect(r.out).not.toMatch(/\bbracket\b|\bseason \[team\]|--conference/);
    const bad = await sportsing(k, "bracket");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain(`Unknown ${k} command: bracket`);
  }
});
