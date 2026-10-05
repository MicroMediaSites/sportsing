// A favorite team's season at a glance (`sportsing <sport> season`): record,
// last 10, streak, home/away splits, conference and division position, and
// where the team sits in the playoff race. Built from one division-level
// regular-season standings response (division tables nested under their
// conferences). Pure — the caller fetches — so it's unit-tested without network.
//
// Playoff formats are keyed by ESPN league path, like STANDINGS_LAYOUTS: they
// describe how each league turns a table into a bracket.

import { c } from "./ansi.ts";
import { LEAGUES, type EspnStandingsEntry, type EspnStandingsGroup, type League } from "./espn.ts";
import { sortEntries, type StandingsLayout } from "./standings.ts";

/** NBA: conference seeds 1..`playoffs` are in, then ..`playIn` play in. */
export type SeedsFormat = { kind: "seeds"; playoffs: number; playIn: number };
/** NHL: the top `perDivision` of each division, then `wildcards` more per conference. */
export type WildcardFormat = { kind: "wildcard"; perDivision: number; wildcards: number };
export type PlayoffFormat = SeedsFormat | WildcardFormat;

export const PLAYOFF_FORMATS: Partial<Record<League, PlayoffFormat>> = {
  [LEAGUES.nba]: { kind: "seeds", playoffs: 6, playIn: 10 },
  [LEAGUES.nhl]: { kind: "wildcard", perDivision: 3, wildcards: 2 },
};

export type RaceStatus =
  | { kind: "playoffs"; seed: number }
  | { kind: "play-in"; seed: number }
  | { kind: "out"; seed: number }
  | { kind: "division"; place: number }
  | { kind: "wildcard"; slot: number }
  /** Outside the wildcards; `pointsBack` of the last wildcard spot (0 = tied, losing the tiebreak). */
  | { kind: "chasing"; pointsBack: number };

export interface Standing {
  /** e.g. "Western Conference", "Northwest". */
  name: string;
  /** 1-based, in the standings table's order. */
  position: number;
  of: number;
}

export interface SeasonSummary {
  team: string;
  /** e.g. "22-60" (NBA), "43-30-9" (NHL). */
  record: string;
  /** NHL points; null for leagues without them. */
  points: string | null;
  lastTen: string;
  streak: string;
  home: string;
  away: string;
  conference: Standing;
  division: Standing;
  race: RaceStatus;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A split as displayed, minus NHL's trailing ", N PTS" ("3-1-0, 0 PTS" → "3-1-0"); "-" if absent. */
export function split(v: string | undefined): string {
  const s = (v ?? "").split(",")[0]!.trim();
  return s || "-";
}

/** Position of `teamId` in `entries` ranked by the layout (1-based; 0 if absent). */
function positionIn(entries: EspnStandingsEntry[], rankBy: string, teamId: string): number {
  return sortEntries(entries, rankBy).findIndex((e) => e.teamId === teamId) + 1;
}

/** Where `teamId` stands in an NHL-style wildcard race across its conference's divisions. */
export function wildcardStatus(
  divisions: EspnStandingsGroup[],
  rankBy: string,
  teamId: string,
  format: WildcardFormat,
): RaceStatus {
  const rest: EspnStandingsEntry[] = [];
  for (const d of divisions) {
    const place = positionIn(d.entries, rankBy, teamId);
    if (place > 0 && place <= format.perDivision) return { kind: "division", place };
    rest.push(...sortEntries(d.entries, rankBy).slice(format.perDivision));
  }
  const race = sortEntries(rest, rankBy);
  const slot = race.findIndex((e) => e.teamId === teamId) + 1;
  if (slot > 0 && slot <= format.wildcards) return { kind: "wildcard", slot };
  const last = race[format.wildcards - 1];
  const team = race[slot - 1];
  return { kind: "chasing", pointsBack: last && team ? num(last.stats[rankBy]) - num(team.stats[rankBy]) : 0 };
}

/** NBA-style status from ESPN's conference seed (it reflects tiebreakers and
 *  the play-in), falling back to the team's conference position. */
export function seedStatus(seed: number, format: SeedsFormat): RaceStatus {
  if (seed <= format.playoffs) return { kind: "playoffs", seed };
  if (seed <= format.playIn) return { kind: "play-in", seed };
  return { kind: "out", seed };
}

/**
 * Summarise `teamId`'s season from division tables (each with its conference
 * as `parent`). Null if the team isn't in the standings.
 */
export function summarizeSeason(
  groups: EspnStandingsGroup[],
  teamId: string,
  layout: StandingsLayout,
  format: PlayoffFormat,
): SeasonSummary | null {
  const division = groups.find((g) => g.entries.some((e) => e.teamId === teamId));
  const entry = division?.entries.find((e) => e.teamId === teamId);
  if (!division || !entry) return null;

  const conferenceName = division.parent?.name ?? division.name;
  const divisions = division.parent ? groups.filter((g) => g.parent?.name === conferenceName) : [division];
  const conferenceEntries = divisions.flatMap((d) => d.entries);
  const confPos = positionIn(conferenceEntries, layout.rankBy, teamId);

  const race =
    format.kind === "seeds"
      ? seedStatus(num(entry.stats.playoffSeed) || confPos, format)
      : wildcardStatus(divisions, layout.rankBy, teamId, format);

  const s = entry.stats;
  const hasPoints = layout.rankBy === "points";
  return {
    team: entry.team,
    record: (hasPoints ? [s.wins, s.losses, s.otLosses] : [s.wins, s.losses]).map((v) => v || "0").join("-"),
    points: hasPoints ? (s.points ?? "0") : null,
    lastTen: split(s["Last Ten Games"]),
    streak: s.streak || "-",
    home: split(s.Home),
    away: split(s.Road),
    conference: { name: conferenceName, position: confPos, of: conferenceEntries.length },
    division: { name: division.name, position: positionIn(division.entries, layout.rankBy, teamId), of: division.entries.length },
    race,
  };
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** One-line playoff-race status, coloured by how safe it is. */
export function raceLine(r: RaceStatus): string {
  switch (r.kind) {
    case "playoffs":
      return c.green(`Playoff spot — ${ordinal(r.seed)} seed`);
    case "play-in":
      return c.yellow(`Play-in — ${ordinal(r.seed)} seed`);
    case "out":
      return c.red(`Out of the playoff picture — ${ordinal(r.seed)} seed`);
    case "division":
      return c.green(`Playoff spot — ${ordinal(r.place)} in division`);
    case "wildcard":
      return c.green(`Playoff spot — wildcard ${r.slot}`);
    case "chasing":
      return r.pointsBack > 0
        ? c.red(`Out — ${r.pointsBack} ${r.pointsBack === 1 ? "pt" : "pts"} back of the last wildcard`)
        : c.yellow("Out — level on points with the last wildcard, losing the tiebreak");
  }
}

/** Render a summary as a labelled block. */
export function renderSeasonSummary(s: SeasonSummary): string {
  const label = (t: string) => c.dim(t.padEnd(12));
  const pos = (p: Standing) => `${ordinal(p.position)} of ${p.of} in the ${p.name}`;
  return [
    c.bold(c.yellow(s.team)),
    `  ${label("Record")}${c.bold(s.record)}${s.points !== null ? c.dim(`  ${s.points} pts`) : ""}`,
    `  ${label("Last 10")}${s.lastTen}   ${c.dim("Streak")} ${s.streak}`,
    `  ${label("Home / Away")}${s.home} / ${s.away}`,
    `  ${label("Conference")}${pos(s.conference)}`,
    `  ${label("Division")}${pos(s.division)}`,
    `  ${label("Playoffs")}${raceLine(s.race)}`,
  ].join("\n");
}
