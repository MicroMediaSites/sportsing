import { test, expect } from "bun:test";
import { renderTeamRows, teamRows } from "./team-list.ts";
import { resolveTeam } from "./commands/league.ts";
import { NBA } from "./sports/nba.ts";
import type { EspnTeam } from "./espn.ts";

const t = (id: string, abbreviation: string, name: string): EspnTeam => ({
  id,
  abbreviation,
  name,
  shortName: name.split(" ").pop()!,
  location: name.split(" ")[0]!,
});
const TEAMS = [t("26", "UTAH", "Utah Jazz"), t("9", "GS", "Golden State Warriors"), t("1", "ATL", "Atlanta Hawks")];

test("teamRows: alphabetical by name, aliases mapped by abbreviation, favorites flagged", () => {
  const rows = teamRows(TEAMS, NBA.aliases, new Set(["26"]));
  expect(rows.map((r) => r.name)).toEqual(["Atlanta Hawks", "Golden State Warriors", "Utah Jazz"]);
  expect(rows.find((r) => r.abbreviation === "GS")!.aliases).toEqual(["GSW"]);
  expect(rows.find((r) => r.abbreviation === "UTAH")!.aliases).toEqual(["UTA"]);
  expect(rows.find((r) => r.abbreviation === "ATL")!.aliases).toEqual([]);
  expect(rows.map((r) => r.favorite)).toEqual([false, false, true]);
});

test("teamRows: every listed alias resolves back to its own team", () => {
  for (const r of teamRows(TEAMS, NBA.aliases, new Set())) {
    for (const a of [r.abbreviation, ...r.aliases]) expect(resolveTeam(TEAMS, a, NBA.aliases)?.id).toBe(r.id);
  }
});

test("teamRows: alias matching is case-insensitive and skips self-aliases", () => {
  const rows = teamRows([t("1", "MAN", "Manchester United")], { "Man Utd": "man", MAN: "MAN" }, new Set());
  expect(rows[0]!.aliases).toEqual(["Man Utd"]);
});

test("renderTeamRows: aligned columns, star marker, aliases trailing", () => {
  const out = renderTeamRows(teamRows(TEAMS, NBA.aliases, new Set(["26"]))).split("\n");
  expect(out).toEqual([
    "  ATL   Atlanta Hawks          ",
    "  GS    Golden State Warriors  aka GSW",
    "★ UTAH  Utah Jazz              aka UTA",
  ].map((s) => s.trimEnd()));
});
