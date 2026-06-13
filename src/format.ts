import { c, pad, visibleLen } from "./ansi.ts";
import type { Match, StandingRow, Stage } from "./types.ts";

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
  const line = "─".repeat(Math.max(text.length, 8));
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

export { visibleLen };
