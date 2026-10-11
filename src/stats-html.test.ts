import { test, expect } from "bun:test";
// Pure — hand-built LeagueStats; nothing is fetched or written.
import { NBA } from "./sports/nba.ts";
import { NHL } from "./sports/nhl.ts";
import { SERIEA } from "./sports/soccer.ts";
import { HEATMAP_LENGTH, esc, niceTicks, renderStatsHtml } from "./stats-html.ts";
import { parseStatsArgs, resolveStat } from "./stats-views.ts";
import { assignRanks, type LeagueStats, type Outcome, type StatProfile, type TeamResult, type TeamStatLine } from "./stats.ts";

let n = 0;
const res = (outcome: Outcome, opp = "OPP"): TeamResult => ({
  gameId: String(++n),
  date: new Date(Date.UTC(2026, 8, 1 + (n % 28))).toISOString(),
  home: n % 2 === 0,
  opponentId: "x",
  opponent: opp,
  scored: outcome === "W" ? 2 : 1,
  conceded: outcome === "W" ? 1 : outcome === "D" ? 1 : 2,
  outcome,
});

function build(profile: StatProfile, names: string[], results: (i: number) => TeamResult[]): LeagueStats {
  const teams: TeamStatLine[] = names.map((name, i) => {
    const rs = results(i);
    return {
      teamId: String(i + 1),
      abbreviation: name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TM",
      name,
      played: rs.length,
      values: Object.fromEntries(profile.stats.map((d, k) => [d.key, 10 + ((i * 7 + k * 3) % 11) + i / 10])),
      ranks: {},
      results: rs,
      form: rs.slice(-5),
    };
  });
  for (const d of profile.stats) {
    const ranks = assignRanks(teams.map((t) => t.values[d.key] ?? null), d.higherIsBetter);
    teams.forEach((t, i) => (t.ranks[d.key] = ranks[i]!));
  }
  return { sport: "x", label: "Serie A", profile, kind: "current", season: 2026, seasonName: "2026-27", upcoming: "", teams };
}

const NAMES = ["Atalanta", "Bologna", "Como", "Roma & Lazio", `<script>alert("x")</script>`, "O'Brien FC"];
const FIVE: Outcome[] = ["W", "D", "L", "W", "W"];
const soccer = () => build(SERIEA.statProfile, NAMES, () => FIVE.map((o) => res(o)));
const favs = new Set(["2"]);
const opts = { favoriteIds: favs, by: null, fetchedAt: new Date("2026-10-11T12:00:00Z") };

/** The markup inside `<section id="…">`. */
const section = (html: string, id: string) => html.match(new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`))![1]!;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("the page is a full document and names every team in each chart and the table", () => {
  const html = renderStatsHtml(soccer(), opts);
  expect(html.startsWith("<!doctype html>")).toBe(true);
  for (const id of ["scatter", "form", "ranking", "table"]) {
    const part = section(html, id);
    for (const name of NAMES) expect(part).toContain(esc(name));
  }
  expect(html).toContain("Season 2026-27");
  expect(html).toContain("data fetched");
});

test("team names are escaped everywhere", () => {
  const html = renderStatsHtml(soccer(), opts);
  expect(html).not.toContain("<script>alert");
  expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  expect(html).toContain("Roma &amp; Lazio");
  expect(html).toContain("O&#39;Brien FC");
  // the only <script> is the sort script at the end
  expect(count(html, /<script>/g)).toBe(1);
});

test("the scatter has exactly one point per team, with a label each", () => {
  const html = renderStatsHtml(soccer(), opts);
  const sc = section(html, "scatter");
  expect(count(sc, /<circle class="pt/g)).toBe(NAMES.length);
  expect(count(sc, /class="plabel/g)).toBe(NAMES.length);
  expect(count(sc, /class="pt fav"/g)).toBe(1);
  expect(sc).toContain("Possession");
  expect(sc).toContain("Shots");
});

test("a team missing one of the two stats gets no point", () => {
  const s = soccer();
  s.teams[0]!.values[s.profile.scatter.x] = null;
  expect(count(section(renderStatsHtml(s, opts), "scatter"), /<circle class="pt/g)).toBe(NAMES.length - 1);
});

test("the heatmap has one cell per result, capped at the last 10", () => {
  const s = build(SERIEA.statProfile, ["A", "B", "C"], (i) => Array.from({ length: [3, 10, 14][i]! }, () => res("W")));
  const fm = section(renderStatsHtml(s, opts), "form");
  expect(count(fm, /<rect class="cell /g)).toBe(3 + HEATMAP_LENGTH + HEATMAP_LENGTH);
  expect(count(fm, /<title>/g)).toBe(3 + 10 + 10);
});

test("heatmap cells carry the letter, the opponent and the score", () => {
  const s = build(SERIEA.statProfile, ["A"], () => [res("L", "JUV")]);
  const fm = section(renderStatsHtml(s, opts), "form");
  expect(fm).toMatch(/<text class="cellt l"[^>]*>L<\/text>/);
  expect(fm).toContain("Loss");
  expect(fm).toContain("JUV");
  expect(fm).toContain("1–2");
});

test("NHL heatmap distinguishes OTL; NBA has no draws in its key", () => {
  const nhl = build(NHL.statProfile, ["A", "B"], () => [res("OTL"), res("W")]);
  const fm = section(renderStatsHtml(nhl, opts), "form");
  expect(fm).toContain("cell otl");
  expect(fm).toContain("Overtime loss");
  const nba = section(renderStatsHtml(build(NBA.statProfile, ["A", "B"], () => [res("W")]), opts), "form");
  expect(nba).not.toContain("Draw");
});

test("the ranking follows --by, best first, favorites starred", () => {
  const s = soccer();
  const by = resolveStat(s.profile, "goals against")!;
  const html = renderStatsHtml(s, { ...opts, by });
  const rk = section(html, "ranking");
  expect(rk).toContain("Goals against by team");
  expect(rk).toContain("lower is better");
  expect(count(rk, /<rect class="barfill/g)).toBe(NAMES.length);
  expect(count(rk, /barfill fav/g)).toBe(1);
  expect(rk).toContain("★ Bologna");
  // default is the profile's first stat
  expect(section(renderStatsHtml(s, opts), "ranking")).toContain("Goals for by team");
});

test("the table lists every stat for every team with ranks and a sortable header", () => {
  const s = soccer();
  const tb = section(renderStatsHtml(s, opts), "table");
  expect(count(tb, /<tbody>[\s\S]*<\/tbody>/g)).toBe(1);
  expect(count(tb, /<tr/g)).toBe(NAMES.length + 1);
  expect(count(tb, /<button/g)).toBe(4 + s.profile.stats.length);
  expect(count(tb, /class="rk"/g)).toBe(NAMES.length * s.profile.stats.length);
  expect(tb).toContain('<tr class="fav">');
  expect(tb).toContain("★");
});

test("a last-season page says so", () => {
  const s = { ...soccer(), kind: "last-season" as const, upcoming: "2026-27", seasonName: "2025-26" };
  const html = renderStatsHtml(s, opts);
  expect(html).toContain("hasn't started");
  expect(html).toContain("2025-26 (final)");
});

test("fully offline: no external URLs in src or href, no scripts or styles pulled in", () => {
  for (const s of [soccer(), build(NBA.statProfile, ["A", "B"], () => [res("W")])]) {
    const html = renderStatsHtml(s, opts);
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/\b(?:src|href)\s*=/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toContain("http");
  }
});

test("every league's scatter pair renders points", () => {
  for (const cfg of [NBA, NHL, SERIEA]) {
    const html = renderStatsHtml(build(cfg.statProfile, ["A", "B", "C"], () => [res("W")]), opts);
    expect(count(section(html, "scatter"), /<circle class="pt/g)).toBe(3);
  }
});

test("niceTicks covers the range with round steps", () => {
  expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(niceTicks(1.1, 2.9, 4)[0]).toBeGreaterThanOrEqual(1.1);
  expect(niceTicks(5, 5)).toEqual([5]);
});

test("--html parsing: alone, with --by, and refused with --list / --json", () => {
  expect(parseStatsArgs(["--html"])).toEqual({ mode: "form", json: false, html: true });
  expect(parseStatsArgs(["--html", "--by", "possession"])).toEqual({ mode: "by", stat: "possession", json: false, html: true });
  expect(parseStatsArgs(["--by", "shots", "on", "target", "--html"])).toEqual({ mode: "by", stat: "shots on target", json: false, html: true });
  expect(parseStatsArgs(["--html", "juv", "int"])).toMatchObject({ mode: "compare", html: true });
  expect(parseStatsArgs(["--html", "--ahead"])).toMatchObject({ mode: "ahead", html: true });
  expect(parseStatsArgs([])).toEqual({ mode: "form", json: false });
  expect(() => parseStatsArgs(["--html", "--list"])).toThrow(/--list/);
  expect(() => parseStatsArgs(["--html", "--json"])).toThrow(/not both/);
});
