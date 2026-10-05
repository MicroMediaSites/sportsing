// What the NBA/NHL stream overlay shows: each league's panel list (the
// settings checkboxes) and the pure mapping from a game summary (espn.ts
// getGameSummary) to those panels' rows. No I/O — src/league-overlay.ts
// fetches and renders.
//
// Rows read US-style, away team on the left and home on the right, matching
// the "AWAY @ HOME" score line.

import { LEAGUES, type EspnGameSummary, type EspnSummarySide, type League } from "./espn.ts";

/** One stat row: a centered label between the two teams' values. */
export interface PanelRow {
  label: string;
  away: string;
  home: string;
}

export interface LeaguePanels {
  /** [key, settings label] in display order. "score" is the score/clock line
   *  and "catchup" the "Get caught up" button; the rest are stat panels. */
  panels: [string, string][];
  /** Rows for every stat panel, keyed like `panels`. */
  rows: (s: EspnGameSummary) => Record<string, PanelRow[]>;
}

/** Panels the page renders itself rather than from `rows`. */
export const SPECIAL_PANELS = ["score", "catchup"];

/** NBA teams get 7 timeouts in regulation (OT periods add 2 each). */
export const NBA_REGULATION_TIMEOUTS = 7;
const NBA_REGULATION_PERIODS = 4;

/** A box-score value by ESPN stat name, or "" when the feed doesn't have it (yet). */
function statOf(side: EspnSummarySide, name: string): string {
  return side.stats.find((x) => x.name === name)?.value ?? "";
}

function stat(side: EspnSummarySide, name: string): string {
  return statOf(side, name) || "—";
}

/** "39-93 · 42%" — made-attempted plus the percentage, whichever exist. */
function shooting(side: EspnSummarySide, madeAtt: string, pct: string): string {
  const p = statOf(side, pct);
  const parts = [statOf(side, madeAtt), p ? p + "%" : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

/** "Lauri Markkanen" → "L. Markkanen" — keeps two names on one panel row. */
export function shortName(full: string): string {
  const [first, ...rest] = full.trim().split(/\s+/);
  return rest.length && first ? `${first[0]}. ${rest.join(" ")}` : full.trim();
}

function leader(side: EspnSummarySide, category: string): string {
  const l = side.leaders.find((x) => x.category === category);
  return l ? `${shortName(l.athlete)} ${l.value}`.trim() : "—";
}

/** The current (or last) period: the header's, else the latest play's. */
export function currentPeriod(s: EspnGameSummary): number {
  return s.period || s.plays.reduce((max, p) => Math.max(max, p.period), 0);
}

/** Timeouts a team has called, counted from the play-by-play. */
export function timeoutsUsed(s: EspnGameSummary, teamId: string): number {
  return s.plays.filter((p) => p.teamId === teamId && /timeout/i.test(p.type)).length;
}

/** Team fouls toward the bonus in `period` (the fouling team is the play's
 *  team; offensive fouls, their turnover rows, and technicals don't count). */
export function periodFouls(s: EspnGameSummary, teamId: string, period: number): number {
  return s.plays.filter(
    (p) => p.teamId === teamId && p.period === period && /foul/i.test(p.type) && !/offensive|technical|turnover/i.test(p.type),
  ).length;
}

function nbaRows(s: EspnGameSummary): Record<string, PanelRow[]> {
  const both = (label: string, f: (side: EspnSummarySide) => string): PanelRow => ({ label, away: f(s.away), home: f(s.home) });
  const period = currentPeriod(s);
  const used = (side: EspnSummarySide) => timeoutsUsed(s, side.id);
  const timeouts: PanelRow[] = [both("used", (side) => String(used(side)))];
  // Remaining is only knowable from the rules in regulation; OT resets to 2.
  if (period <= NBA_REGULATION_PERIODS) {
    timeouts.push(both("left", (side) => String(Math.max(0, NBA_REGULATION_TIMEOUTS - used(side)))));
  }
  return {
    shooting: [
      both("FG", (side) => shooting(side, "fieldGoalsMade-fieldGoalsAttempted", "fieldGoalPct")),
      both("3PT", (side) => shooting(side, "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "threePointFieldGoalPct")),
    ],
    leaders: [
      both("PTS", (side) => leader(side, "Points")),
      both("REB", (side) => leader(side, "Rebounds")),
      both("AST", (side) => leader(side, "Assists")),
    ],
    fouls: [both("total", (side) => stat(side, "fouls")), both("this period", (side) => String(periodFouls(s, side.id, period)))],
    timeouts,
  };
}

/** One row per goalie slot: "S. Cossa 17/18 .944" each side. */
function goalieRows(s: EspnGameSummary): PanelRow[] {
  const line = (side: EspnSummarySide, i: number): string => {
    const gl = side.goalies[i];
    if (!gl) return "";
    return `${shortName(gl.athlete)} ${gl.saves || "0"}/${gl.shotsAgainst || "0"}${gl.savePct ? " " + gl.savePct : ""}`;
  };
  const n = Math.max(s.away.goalies.length, s.home.goalies.length);
  return Array.from({ length: n }, (_, i) => ({ label: "saves", away: line(s.away, i), home: line(s.home, i) }));
}

function nhlRows(s: EspnGameSummary): Record<string, PanelRow[]> {
  const both = (label: string, f: (side: EspnSummarySide) => string): PanelRow => ({ label, away: f(s.away), home: f(s.home) });
  return {
    shots: [both("SOG", (side) => stat(side, "shotsTotal"))],
    powerplay: [
      both("PP", (side) =>
        statOf(side, "powerPlayGoals") || statOf(side, "powerPlayOpportunities")
          ? `${stat(side, "powerPlayGoals")}/${stat(side, "powerPlayOpportunities")}`
          : "—",
      ),
      both("PIM", (side) => stat(side, "penaltyMinutes")),
    ],
    faceoffs: [both("FO%", (side) => (statOf(side, "faceoffPercent") ? statOf(side, "faceoffPercent") + "%" : "—"))],
    goalies: goalieRows(s),
  };
}

/** Panel specs for the leagues the overlay supports (by ESPN league path). */
export const LEAGUE_PANELS: Partial<Record<League, LeaguePanels>> = {
  [LEAGUES.nba]: {
    panels: [
      ["score", "Score & clock"],
      ["shooting", "FG% / 3P%"],
      ["leaders", "Leaders (PTS / REB / AST)"],
      ["fouls", "Fouls"],
      ["timeouts", "Timeouts"],
      ["catchup", "Get caught up"],
    ],
    rows: nbaRows,
  },
  [LEAGUES.nhl]: {
    panels: [
      ["score", "Score & clock"],
      ["shots", "Shots on goal"],
      ["powerplay", "Power plays"],
      ["faceoffs", "Faceoff %"],
      ["goalies", "Goalie saves"],
      ["catchup", "Get caught up"],
    ],
    rows: nhlRows,
  },
};

/** Every panel off — a fresh stream shows just the gear, like the FIFA overlay. */
export function panelDefaults(spec: LeaguePanels): Record<string, boolean> {
  return Object.fromEntries(spec.panels.map(([k]) => [k, false]));
}
