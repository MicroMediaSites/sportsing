// What the NBA/NHL stream overlay shows: each league's panel list (the
// settings checkboxes) and the pure mapping from a `LiveGame` box score to
// those panels' rows. No I/O — src/league-overlay.ts fetches and renders.
//
// Rows read US-style, away team on the left and home on the right, matching
// the "AWAY @ HOME" score line.

import { LEAGUES, type League, type LiveGame, type LiveGameSide } from "./espn.ts";

/** One stat row: a centered label between the two teams' values. */
export interface PanelRow {
  label: string;
  away: string;
  home: string;
}

export interface LeaguePanels {
  /** [key, settings label] in display order; "score" is the score/clock line. */
  panels: [string, string][];
  /** Rows for every non-score panel, keyed like `panels`. */
  rows: (g: LiveGame) => Record<string, PanelRow[]>;
}

/** NBA teams get 7 timeouts in regulation (OT periods add 2 each). */
export const NBA_REGULATION_TIMEOUTS = 7;
const NBA_REGULATION_PERIODS = 4;

/** A box-score value, or "—" when the feed doesn't have it (yet). */
function stat(s: LiveGameSide, name: string): string {
  return s.stats[name] || "—";
}

/** "39-93 · 42%" — made-attempted plus the percentage, whichever exist. */
function shooting(s: LiveGameSide, madeAtt: string, pct: string): string {
  const parts = [s.stats[madeAtt], s.stats[pct] ? s.stats[pct] + "%" : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function leader(s: LiveGameSide, category: string): string {
  const l = s.leaders[category];
  return l ? `${l.name} ${l.values[category] ?? ""}`.trim() : "—";
}

function nbaRows(g: LiveGame): Record<string, PanelRow[]> {
  const both = (label: string, f: (s: LiveGameSide) => string): PanelRow => ({ label, away: f(g.away), home: f(g.home) });
  const timeouts: PanelRow[] = [both("used", (s) => String(s.timeoutsUsed))];
  // Remaining is only knowable from the rules in regulation; OT resets to 2.
  if (g.period <= NBA_REGULATION_PERIODS) {
    timeouts.push(both("left", (s) => String(Math.max(0, NBA_REGULATION_TIMEOUTS - s.timeoutsUsed))));
  }
  return {
    shooting: [
      both("FG", (s) => shooting(s, "fieldGoalsMade-fieldGoalsAttempted", "fieldGoalPct")),
      both("3PT", (s) => shooting(s, "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "threePointFieldGoalPct")),
    ],
    leaders: [
      both("PTS", (s) => leader(s, "points")),
      both("REB", (s) => leader(s, "rebounds")),
      both("AST", (s) => leader(s, "assists")),
    ],
    fouls: [both("total", (s) => stat(s, "fouls")), both("this period", (s) => String(s.periodFouls))],
    timeouts,
  };
}

/** One row per goalie slot: "S. Cossa 17/18 .944" each side. */
function goalieRows(g: LiveGame): PanelRow[] {
  const line = (s: LiveGameSide, i: number): string => {
    const gl = s.goalies[i];
    if (!gl) return "";
    const v = gl.values;
    return `${gl.name} ${v.saves ?? "0"}/${v.shotsAgainst ?? "0"}${v.savePct ? " " + v.savePct : ""}`;
  };
  const n = Math.max(g.away.goalies.length, g.home.goalies.length);
  return Array.from({ length: n }, (_, i) => ({ label: "saves", away: line(g.away, i), home: line(g.home, i) }));
}

function nhlRows(g: LiveGame): Record<string, PanelRow[]> {
  const both = (label: string, f: (s: LiveGameSide) => string): PanelRow => ({ label, away: f(g.away), home: f(g.home) });
  return {
    shots: [both("SOG", (s) => stat(s, "shotsTotal"))],
    powerplay: [
      both("PP", (s) => (s.stats.powerPlayGoals || s.stats.powerPlayOpportunities ? `${stat(s, "powerPlayGoals")}/${stat(s, "powerPlayOpportunities")}` : "—")),
      both("PIM", (s) => stat(s, "penaltyMinutes")),
    ],
    faceoffs: [both("FO%", (s) => (s.stats.faceoffPercent ? s.stats.faceoffPercent + "%" : "—"))],
    goalies: goalieRows(g),
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
    ],
    rows: nhlRows,
  },
};

/** Every panel off — a fresh stream shows just the gear, like the FIFA overlay. */
export function panelDefaults(spec: LeaguePanels): Record<string, boolean> {
  return Object.fromEntries(spec.panels.map(([k]) => [k, false]));
}
