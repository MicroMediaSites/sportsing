import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Pure parsing / filtering / rendering over recorded ESPN payloads — no network.
import { NBA } from "./sports/nba.ts";
import { NHL } from "./sports/nhl.ts";
import { EPL } from "./sports/soccer.ts";
import { FIFA_SQUAD } from "./sports/fifa.ts";
import { attachStats, parseRoster, statsFromAthleteStatistics, statsFromRoster, type Squad, type SquadLeague } from "./squad.ts";
import { applyRosterView, parseRosterArgs, renderRoster, rosterJson, seasonLines, statusText } from "./roster.ts";
import { rosterTeams } from "./commands/roster.ts";
import { resolveTeam } from "./commands/league.ts";
import { parseTeams } from "./espn.ts";

const fixture = (name: string): any => JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "espn", name), "utf8"));
// Strip color codes so assertions are stable whatever the terminal.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function squadOf(cfg: SquadLeague, rosterFile: string, statsFile?: string): Squad {
  const profile = cfg.playerStatProfile;
  const raw = fixture(rosterFile);
  let players = parseRoster(raw, profile);
  if (statsFile) players = attachStats(players, profile, statsFromAthleteStatistics(fixture(statsFile)));
  else if (profile.source === "roster") players = attachStats(players, profile, statsFromRoster(raw));
  return { sport: cfg.sport, label: cfg.label, team: { id: "1", abbreviation: "TST", name: "Test FC" }, profile, players, season: null };
}

const nhl = () => squadOf(NHL, "nhl-roster.json", "nhl-athlete-statistics.json");
const epl = () => squadOf(EPL, "soccer-roster-epl.json");
const nba = () => squadOf(NBA, "nba-roster.json", "nba-athlete-statistics.json");

// ── Arguments ────────────────────────────────────────────────────────────────

test("parseRosterArgs: positional words or --team name the team; --by implies stats", () => {
  expect(parseRosterArgs([])).toEqual({ team: null, pos: null, by: null, stats: false, json: false });
  expect(parseRosterArgs(["Utah", "Jazz"]).team).toBe("Utah Jazz");
  expect(parseRosterArgs(["--team", "UTAH", "--stats"])).toMatchObject({ team: "UTAH", stats: true });
  expect(parseRosterArgs(["ARS", "--by", "shots", "on", "target", "--json"])).toMatchObject({ team: "ARS", by: "shots on target", stats: true, json: true });
  expect(parseRosterArgs(["--pos", "gk", "ARS"])).toMatchObject({ team: "ARS", pos: "gk" });
});

test("parseRosterArgs: bad input throws", () => {
  expect(() => parseRosterArgs(["--wat"])).toThrow(/Unknown option --wat/);
  expect(() => parseRosterArgs(["--pos"])).toThrow(/requires a value/);
  expect(() => parseRosterArgs(["--by", "--json"])).toThrow(/requires a stat/);
  expect(() => parseRosterArgs(["UTAH", "--team", "LAL"])).toThrow(/once/);
});

// ── Team resolution ──────────────────────────────────────────────────────────

const teams = parseTeams(fixture("soccer-teams-epl.json"));
const cfg = { ...EPL, icon: "⚽" };

test("rosterTeams: a named team, favorites in turn, or a clear error", () => {
  expect(rosterTeams(cfg, teams, "ARS", [], resolveTeam).map((t) => t.abbreviation)).toEqual(["ARS"]);
  expect(rosterTeams(cfg, teams, null, ["ARS", "LIV", "ARS"], resolveTeam).map((t) => t.abbreviation)).toEqual(["ARS", "LIV"]);
  expect(() => rosterTeams(cfg, teams, null, [], resolveTeam)).toThrow(/no .* favorites/i);
  expect(() => rosterTeams(cfg, teams, "Nope FC", [], resolveTeam)).toThrow(/Unknown .* team "Nope FC"/);
});

// ── --pos ────────────────────────────────────────────────────────────────────

test("--pos is case-insensitive on the group key and keeps squad order", () => {
  const { squad } = applyRosterView(epl(), { pos: "gk", by: null });
  expect(squad.players.length).toBe(2);
  expect(squad.players.every((p) => p.positionGroup === "GK")).toBe(true);
  expect(applyRosterView(nhl(), { pos: "lw", by: null }).squad.players.every((p) => p.positionGroup === "LW")).toBe(true);
});

test("--pos with an unknown group lists the valid keys", () => {
  expect(() => applyRosterView(epl(), { pos: "STRIKER", by: null })).toThrow(/Valid positions: GK \(goalkeepers\), DEF/);
});

// ── Grouped rendering ────────────────────────────────────────────────────────

test("grouped roster: group headers in profile order with counts, columns, no stats", () => {
  const out = plain(renderRoster(applyRosterView(nhl(), { pos: null, by: null }), { stats: false }));
  const headers = out.split("\n").filter((l) => /^[A-Z][a-z ]+ \(\d+\)$/.test(l));
  expect(headers.map((h) => h.replace(/ \(\d+\)/, ""))).toEqual(["Centers", "Left wings", "Right wings", "Defensemen", "Goalies"]);
  expect(out).toMatch(/#\s+NAME\s+POS\s+AGE\s+NATIONALITY/);
  expect(out).not.toMatch(/\bGP\b/);
  expect(out).toContain("Logan Cooley");
});

test("injury text appears only when present (STATUS column omitted otherwise)", () => {
  const nhlOut = plain(renderRoster(applyRosterView(nhl(), { pos: null, by: null })));
  expect(nhlOut).toContain("STATUS");
  expect(nhlOut).toMatch(/Nick DeSimone.*Out/);
  const healthy = applyRosterView(epl(), { pos: "GK", by: null });
  expect(plain(renderRoster(healthy))).not.toContain("STATUS");
  expect(statusText({ ...nhl().players[0]!, injury: null, status: "Active" })).toBe("");
});

test("--stats: skater and goalie groups each get their own header columns, missing is –", () => {
  const out = plain(renderRoster(applyRosterView(nhl(), { pos: null, by: null }), { stats: true }));
  const heads = out.split("\n").filter((l) => /NAME\s+POS/.test(l));
  expect(heads.length).toBeGreaterThanOrEqual(2);
  expect(heads[0]).toMatch(/GP\s+G\s+A\s+PTS\s+\+\/-\s+PIM\s+TOI/);
  expect(heads[heads.length - 1]).toMatch(/GP\s+W\s+L\s+GAA\s+SV%/);
});

test("--stats on a flat NBA roster prints one header (no goalie variant)", () => {
  const out = plain(renderRoster(applyRosterView(nba(), { pos: null, by: null }), { stats: true }));
  expect(out.match(/NAME\s+POS/g)).toHaveLength(1);
  expect(out).toMatch(/GP\s+MIN\s+PTS\s+REB\s+AST/);
});

// ── --by ─────────────────────────────────────────────────────────────────────

test("--by ranks best first in a flat list with a rank column, missing last", () => {
  const view = applyRosterView(nba(), { pos: null, by: "pts" });
  expect(view.by?.key).toBe("avgPoints");
  const vals = view.squad.players.map((p) => p.stats?.avgPoints);
  const present = vals.filter((v) => v !== undefined) as number[];
  expect(present).toEqual([...present].sort((a, b) => b - a));
  expect(vals.slice(present.length).every((v) => v === undefined)).toBe(true);
  const out = plain(renderRoster(view, { stats: true }));
  expect(out).toMatch(/^\s*RK\s+#\s+NAME/);
  expect(out).not.toMatch(/Centers|Forwards|Guards/);
  expect(out.split("\n")[1]).toMatch(/^\s+1\s/);
});

test("--by accepts key, short label or label, any case", () => {
  for (const input of ["avgPoints", "PTS", "points", "Pts"]) expect(applyRosterView(nba(), { pos: null, by: input }).by?.key).toBe("avgPoints");
});

test("--by a lower-is-better stat ranks lowest first", () => {
  const view = applyRosterView(nhl(), { pos: "D", by: "pim" });
  const vals = view.squad.players.map((p) => p.stats?.penaltyMinutes).filter((v) => v !== undefined) as number[];
  expect(vals).toEqual([...vals].sort((a, b) => a - b));
});

test("--by a goalie-only stat ranks only the goalies; a skater stat skips them", () => {
  const goalie = applyRosterView(nhl(), { pos: null, by: "GAA" });
  expect(goalie.squad.players.length).toBeGreaterThan(0);
  expect(goalie.squad.players.every((p) => p.positionGroup === "G")).toBe(true);
  const skater = applyRosterView(nhl(), { pos: null, by: "TOI" });
  expect(skater.squad.players.some((p) => p.positionGroup === "G")).toBe(false);
});

test("--by with an unknown stat lists the options, goalie ones included", () => {
  expect(() => applyRosterView(nhl(), { pos: null, by: "nope" })).toThrow(/Unknown NHL stat "nope"[\s\S]*PTS[\s\S]*Goalies only[\s\S]*GAA/);
});

// ── JSON / season / fifa ─────────────────────────────────────────────────────

test("--json is the Squad as displayed, with what was asked for", () => {
  const view = applyRosterView(nhl(), { pos: "g", by: null });
  const doc = rosterJson(view, { pos: "g" });
  expect(doc.players.every((p) => p.positionGroup === "G")).toBe(true);
  expect(doc.team.abbreviation).toBe("TST");
  expect(doc.view).toEqual({ pos: "G", by: null });
  expect(rosterJson(applyRosterView(nba(), { pos: null, by: "pts" }), { pos: null }).view.by).toBe("avgPoints");
});

test("season header: current, last season, not started", () => {
  const base = { season: 2027, seasonName: "2026-27", upcoming: "2026-27" };
  expect(seasonLines(null)).toEqual([]);
  expect(plain(seasonLines({ ...base, kind: "current" })[0]!)).toContain("2026-27");
  expect(plain(seasonLines({ kind: "last-season", season: 2026, seasonName: "2025-26", upcoming: "2026-27" })[0]!)).toMatch(/2026-27 season hasn't started — showing last season's stats \(2025-26\)/);
  expect(plain(seasonLines({ kind: "not-started", season: null, seasonName: "", upcoming: "2026-27" })[0]!)).toMatch(/no stats yet/);
});

test("FIFA squads render like club soccer", () => {
  const squad = squadOf(FIFA_SQUAD, "soccer-roster-fifa.json");
  const out = plain(renderRoster(applyRosterView(squad, { pos: null, by: null })));
  expect(out).toContain("Goalkeepers");
  expect(applyRosterView(squad, { pos: "fwd", by: null }).squad.players.every((p) => p.positionGroup === "FWD")).toBe(true);
});

test("roster is a command with a squad alias in every league", async () => {
  const { leagueHasCommand } = await import("./commands/league.ts");
  const { fifaHasCommand } = await import("./sports/fifa.ts");
  for (const cmd of ["roster", "squad"]) {
    expect(leagueHasCommand(cmd, { league: NBA.league })).toBe(true);
    expect(leagueHasCommand(cmd, { league: EPL.league })).toBe(true);
    expect(fifaHasCommand(cmd)).toBe(true);
  }
});
