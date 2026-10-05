import { c, pad, visibleLen } from "./ansi.ts";
import type { Match, StandingRow, Stage } from "./types.ts";
import type { Game, GameCompetitor } from "./game.ts";

export function teamLabel(t: { name: string | null; tla?: string | null }): string {
  return t.tla || t.name || "TBD";
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTimeOnly(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Date-only header, e.g. "Sat, Jun 13" — for grouping a list by day (local). */
export function fmtDayHeader(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function statusBadge(m: Match): string {
  switch (m.status) {
    case "IN_PLAY":
      return c.bgGreen(c.bold(" LIVE ")) + (m.minute ? c.green(` ${m.minute}'`) : "");
    case "PAUSED":
      return c.yellow("HT");
    case "FINISHED":
      return c.dim("FT");
    case "POSTPONED":
      return c.red("PPD");
    case "CANCELLED":
      return c.red("CANC");
    case "SUSPENDED":
      return c.red("SUSP");
    default:
      return c.cyan(fmtTimeOnly(m.utcDate));
  }
}

/** One match as a single aligned line: "ENG  2 - 1  USA   FT". */
export function matchLine(m: Match): string {
  const home = teamLabel(m.homeTeam);
  const away = teamLabel(m.awayTeam);
  const hs = m.score.fullTime.home;
  const as = m.score.fullTime.away;
  const played = hs != null && as != null;

  const scoreCol = played
    ? scoreStr(hs, as, m)
    : c.dim(" v ");

  const homeStr = winnerBold(home, m, "HOME_TEAM");
  const awayStr = winnerBold(away, m, "AWAY_TEAM");

  return (
    pad(homeStr, 18, "right") +
    "  " +
    pad(scoreCol, 9) +
    "  " +
    pad(awayStr, 18, "left") +
    "  " +
    statusBadge(m)
  );
}

function scoreStr(hs: number, as: number, m: Match): string {
  const live = m.status === "IN_PLAY" || m.status === "PAUSED";
  const core = `${hs} - ${as}`;
  return live ? c.green(c.bold(core)) : c.bold(core);
}

function winnerBold(name: string, m: Match, side: "HOME_TEAM" | "AWAY_TEAM"): string {
  return m.score.winner === side ? c.bold(c.white(name)) : name;
}

export function groupName(g: string | null): string {
  if (!g) return "";
  return g.replace("GROUP_", "Group ");
}

export const STAGE_LABELS: Record<Stage, string> = {
  GROUP_STAGE: "Group Stage",
  LAST_32: "Round of 32",
  LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals",
  THIRD_PLACE: "Third-place Play-off",
  FINAL: "Final",
};

/** Canonical stage label for a match: group name (e.g. "Group B") for the group
 *  stage, or the knockout-round label. Falls back to "Group Stage" when the
 *  group letter is unknown. */
export function stageLabel(m: Match): string {
  return m.stage === "GROUP_STAGE" ? groupName(m.group) || "Group Stage" : STAGE_LABELS[m.stage];
}

export const KNOCKOUT_ORDER: Stage[] = [
  "LAST_32",
  "LAST_16",
  "QUARTER_FINALS",
  "SEMI_FINALS",
  "THIRD_PLACE",
  "FINAL",
];

/** Render a standings table for one group. */
export function standingsTable(group: string | null, rows: StandingRow[]): string {
  const header =
    c.dim(
      pad("#", 2) +
        " " +
        pad("Team", 18) +
        pad("P", 4, "right") +
        pad("W", 3, "right") +
        pad("D", 3, "right") +
        pad("L", 3, "right") +
        pad("GF", 4, "right") +
        pad("GA", 4, "right") +
        pad("GD", 4, "right") +
        pad("Pts", 5, "right"),
    );
  const body = rows
    .map((r) => {
      const qualifies = r.position <= 2;
      const posMark = qualifies ? c.green(String(r.position)) : c.dim(String(r.position));
      const name = qualifies ? c.bold(teamLabel(r.team)) : teamLabel(r.team);
      return (
        pad(posMark, 2) +
        " " +
        pad(name, 18) +
        pad(String(r.playedGames), 4, "right") +
        pad(String(r.won), 3, "right") +
        pad(String(r.draw), 3, "right") +
        pad(String(r.lost), 3, "right") +
        pad(String(r.goalsFor), 4, "right") +
        pad(String(r.goalsAgainst), 4, "right") +
        pad(signed(r.goalDifference), 4, "right") +
        pad(c.bold(String(r.points)), 5, "right")
      );
    })
    .join("\n");
  const title = c.bold(c.cyan(groupName(group)));
  return `${title}\n${header}\n${body}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function heading(text: string): string {
  const line = "─".repeat(Math.max(visibleLen(text), 8));
  return `\n${c.bold(c.magenta(text))}\n${c.dim(line)}`;
}

export function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  let s: string;
  if (days >= 1) s = `${days}d ${hours % 24}h`;
  else if (hours >= 1) s = `${hours}h ${mins % 60}m`;
  else s = `${mins}m`;
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

// --- Sport-neutral Game lines (NBA/NHL) ---

/** Season-phase tag: "PRE" for preseason, "POST" for postseason (incl. the
 *  NBA play-in), "" for the regular season. Plain text, for tests/alignment. */
export function phaseTag(g: Game): string {
  return g.seasonType === "preseason" ? "PRE" : g.seasonType === "postseason" ? "POST" : "";
}

/** How a league names its periods. Leagues that set this get live/final
 *  status rendered from `period` + `clock` in their own terms (hockey:
 *  1st/2nd/3rd/OT/SO) instead of the source's status text. */
export interface PeriodNaming {
  /** Periods in regulation (NHL: 3). Later periods are overtime. */
  regulation: number;
  /** True if a regular-season/preseason tie after one OT goes to a shootout
   *  (NHL). Postseason overtime never ends in one. */
  shootout: boolean;
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return n + suffix;
};

/** Name of period `g.period` under `naming`: "1st".."3rd", then "OT" (playoff
 *  multi-OT: "2OT", "3OT", …), or "SO" for a shootout. "" before the game. */
export function periodLabel(g: Pick<Game, "period" | "seasonType">, naming: PeriodNaming): string {
  const p = g.period;
  if (p <= 0) return "";
  if (p <= naming.regulation) return ordinal(p);
  const ot = p - naming.regulation;
  if (naming.shootout && g.seasonType !== "postseason" && ot > 1) return "SO";
  return ot === 1 ? "OT" : `${ot}OT`;
}

/** Plain status text from period + clock: "12:34 - 2nd", "End of 2nd", "SO",
 *  "Final", "Final/OT", "Final/SO". Only for live and finished games. A live
 *  game with no clock at all falls back to the source's text — only an
 *  explicit "0:00" means the period has ended. */
export function periodStatus(g: Game, naming: PeriodNaming): string {
  const label = periodLabel(g, naming);
  if (g.state === "post") return g.period > naming.regulation ? `Final/${label}` : "Final";
  if (!label) return g.detail;
  if (label === "SO") return "SO";
  if (!g.clock) return g.detail || label;
  return g.clock !== "0:00" ? `${g.clock} - ${label}` : `End of ${label}`;
}

/** Status column: local start time before the game, a LIVE badge + the clock
 *  text during it, the final text after it. Clock/final text comes from the
 *  league's period naming when given, else the source's own status text. */
function gameStatus(g: Game, naming?: PeriodNaming): string {
  if (g.state === "pre") return c.cyan(fmtTimeOnly(g.date));
  const text = naming ? periodStatus(g, naming) : g.detail;
  if (g.state === "in") return c.bgGreen(c.bold(" LIVE ")) + (text ? c.green(" " + text) : "");
  return c.dim(text || "Final");
}

/** Score as a number for comparison; NaN when not yet scored. */
const scoreNum = (s: string) => (s === "" ? NaN : Number(s));

function side(t: GameCompetitor, other: GameCompetitor, g: Game): string {
  const label = t.abbreviation || t.name;
  if (g.state === "pre") return pad(label, 5) + "    ";
  const won = g.state === "post" && scoreNum(t.score) > scoreNum(other.score);
  const text = pad(label, 5) + pad(t.score, 4, "right");
  return won ? c.bold(c.white(text)) : text;
}

/** One game as an aligned line, US style (away @ home):
 *  "UTAH  109  @  DEN    97   Final  PRE". `naming` renders the status in the
 *  league's period terms (see `PeriodNaming`). */
export function gameLine(g: Game, naming?: PeriodNaming): string {
  const tag = phaseTag(g);
  const tagStr = tag === "PRE" ? c.yellow(tag) : tag === "POST" ? c.magenta(tag) : "";
  return (
    side(g.away, g.home, g) +
    c.dim("  @  ") +
    side(g.home, g.away, g) +
    "   " +
    pad(gameStatus(g, naming), 12) +
    (tagStr ? " " + tagStr : "")
  ).trimEnd();
}

export { visibleLen };
