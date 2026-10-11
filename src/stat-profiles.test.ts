import { test, expect } from "bun:test";
// Pure — no network, never reads or writes ~/.config/sportsing.
import { SPORTS } from "./commands/cross.ts";
import type { LeagueConfig } from "./commands/league.ts";
import { NBA } from "./sports/nba.ts";
import { NHL } from "./sports/nhl.ts";
import { EPL, LIGUE1, SERIEA } from "./sports/soccer.ts";

// Every league config the SPORTS registry routes. FIFA is not in this list on
// purpose: its namespace (src/sports/fifa.ts) is the football-data/World Cup
// path, not a LeagueConfig, and has no season-long team stats to aggregate
// (only the per-match `stats` command). Every other registered key MUST be here,
// so adding a league to SPORTS without a config below fails the first test.
const LEAGUE_CONFIGS: Record<string, LeagueConfig> = { nba: NBA, nhl: NHL, epl: EPL, seriea: SERIEA, ligue1: LIGUE1 };
const NOT_LEAGUE_CONFIGS = ["fifa"];

test("every registered sport is a LeagueConfig league or explicitly exempt", () => {
  const keys = SPORTS.map((s) => s.key).filter((k) => !NOT_LEAGUE_CONFIGS.includes(k));
  expect(keys.sort()).toEqual(Object.keys(LEAGUE_CONFIGS).sort());
});

test.each(Object.entries(LEAGUE_CONFIGS))("%s declares a StatProfile with stats", (key, cfg) => {
  const p = cfg.statProfile;
  expect(p).toBeDefined();
  expect(cfg.sport).toBe(key);
  expect(["team-stats", "boxscores"]).toContain(p.source);
  expect(["wdl", "wl", "wl-otl"]).toContain(p.form);
  expect(p.stats.length).toBeGreaterThanOrEqual(1);
  const keys = p.stats.map((s) => s.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const s of p.stats) expect(s.label && s.short).toBeTruthy();
});
