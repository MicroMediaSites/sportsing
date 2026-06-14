import { c } from "../ansi.ts";
import { findEvent, getMatchStats, type EspnTeamStats } from "../espn.ts";

// `sportsing fifa stats <team> [team] [--json]` — per-match statistics
// (possession, shots, passes, cards…) from ESPN. Resolves the most recent
// played match for the given team(s). --json emits the raw structured data
// for a Claude agent to analyze.

// Curated display order + labels for the stats we surface (ESPN stat `name` →
// human label). Anything not listed is omitted from the table view (but kept
// in --json).
const ROWS: { name: string; label: string; suffix?: string }[] = [
  { name: "possessionPct", label: "Possession", suffix: "%" },
  { name: "totalShots", label: "Shots" },
  { name: "shotsOnTarget", label: "On target" },
  { name: "wonCorners", label: "Corners" },
  { name: "foulsCommitted", label: "Fouls" },
  { name: "yellowCards", label: "Yellow cards" },
  { name: "redCards", label: "Red cards" },
  { name: "offsides", label: "Offsides" },
  { name: "saves", label: "Saves" },
  { name: "accuratePasses", label: "Accurate passes" },
  { name: "totalPasses", label: "Total passes" },
];

export async function stats(args: string[]) {
  const json = args.includes("--json");
  const terms = args.filter((a) => !a.startsWith("--"));
  if (terms.length === 0) {
    console.error(c.red("Usage: sportsing fifa stats <team> [team] [--json]"));
    process.exitCode = 1;
    return;
  }

  const ev = await findEvent(terms, { playedOnly: true });
  if (!ev) {
    console.log(c.dim(`No played match found for "${terms.join(" ")}". Stats appear once a match kicks off.`));
    return;
  }

  const teamStats = await getMatchStats(ev.id);

  if (json) {
    console.log(JSON.stringify({ event: ev, teams: teamStats }, null, 2));
    return;
  }

  if (teamStats.length < 2) {
    console.log(c.dim("No statistics available for this match yet."));
    return;
  }

  const home = ev.competitors.find((t) => t.homeAway === "home");
  const away = ev.competitors.find((t) => t.homeAway === "away");
  const homeStats = byAbbr(teamStats, home?.abbreviation) ?? teamStats[0]!;
  const awayStats = byAbbr(teamStats, away?.abbreviation) ?? teamStats[1]!;

  const score = home && away ? `${home.score} – ${away.score}` : "";
  console.log(
    c.bold(c.cyan(`⚽ ${homeStats.team} ${score} ${awayStats.team}`)) + "  " + c.dim(ev.detail),
  );
  console.log();

  const W = 16;
  const col = (s: string) => s.padStart(7);
  console.log(c.dim("".padEnd(W)) + col(homeStats.abbreviation) + "  " + col(awayStats.abbreviation));
  for (const row of ROWS) {
    const h = lookup(homeStats, row.name);
    const a = lookup(awayStats, row.name);
    if (h === null && a === null) continue;
    const fmt = (v: string | null) => (v === null ? "—" : v + (row.suffix ?? ""));
    console.log(row.label.padEnd(W) + col(fmt(h)) + "  " + col(fmt(a)));
  }
}

function byAbbr(all: EspnTeamStats[], abbr?: string): EspnTeamStats | undefined {
  return abbr ? all.find((t) => t.abbreviation === abbr) : undefined;
}

function lookup(t: EspnTeamStats, name: string): string | null {
  return t.stats.find((s) => s.name === name)?.value ?? null;
}
