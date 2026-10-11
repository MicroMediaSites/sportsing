// The `stats` views for every league: the form table (default), `--by <stat>`
// rankings and `--list`. Everything here is pure — it takes the LeagueStats the
// engine (src/stats.ts) loaded and returns rows, JSON or text — so it is
// unit-tested without network. The command wiring lives in
// src/commands/league.ts.

import { c, pad } from "./ansi.ts";
import { formatStat, rankBy, type LeagueStats, type Outcome, type StatDef, type StatProfile, type TeamResult, type TeamStatLine } from "./stats.ts";

// ── Arguments ────────────────────────────────────────────────────────────────

/** `html` is present (true) only with `--html`: the chart page instead of text. */
export type StatsRequest = (
  | { mode: "form"; json: boolean }
  | { mode: "list"; json: boolean }
  | { mode: "by"; stat: string; json: boolean }
  | { mode: "compare"; a: string; b: string; json: boolean }
  | { mode: "ahead"; team: string | null; json: boolean }
) & { html?: true };

/** Parse `stats` arguments. `--by` takes the words up to the next flag (labels
 *  have spaces: `--by shots on target`); two bare words are a comparison;
 *  `--ahead` takes an optional team. Throws a usage message on anything else. */
export function parseStatsArgs(args: string[]): StatsRequest {
  const req = parseStatsMode(args);
  if (!args.includes("--html")) return req;
  if (req.json) throw new Error("Use --html or --json, not both.");
  if (req.mode === "list") throw new Error("--html doesn't combine with --list.");
  return { ...req, html: true };
}

function parseStatsMode(args: string[]): StatsRequest {
  const json = args.includes("--json");
  const rest: string[] = [];
  let by: string | null = null;
  let ahead = false;
  let list = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json" || a === "--html") continue;
    if (a === "--list") list = true;
    else if (a === "--ahead") ahead = true;
    else if (a === "--by") {
      const words: string[] = [];
      while (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) words.push(args[++i]!);
      if (words.length === 0) throw new Error("Flag --by requires a stat (see `stats --list`).");
      by = words.join(" ");
    } else if (a.startsWith("--")) throw new Error(`Unknown option ${a}.`);
    else rest.push(a);
  }
  const modes = [by !== null, list, ahead].filter(Boolean).length;
  if (modes > 1) throw new Error("Use one of --by, --list or --ahead.");
  if (list) return noPositionals({ mode: "list", json }, rest);
  if (by !== null) return noPositionals({ mode: "by", stat: by, json }, rest);
  if (ahead) {
    if (rest.length > 1) throw new Error("--ahead takes at most one team.");
    return { mode: "ahead", team: rest[0] ?? null, json };
  }
  if (rest.length === 0) return { mode: "form", json };
  if (rest.length === 2) return { mode: "compare", a: rest[0]!, b: rest[1]!, json };
  throw new Error("Usage: stats [--by <stat> | --list | --ahead [team] | <team> <team>] [--json | --html]");
}

function noPositionals<T extends StatsRequest>(req: T, rest: string[]): T {
  if (rest.length > 0) throw new Error(`Unexpected argument "${rest[0]}".`);
  return req;
}

// ── Stat lookup ──────────────────────────────────────────────────────────────

/** Find a profile stat by key, short label or label (case-insensitive, in that
 *  order of precedence); failing an exact match, ignoring punctuation and
 *  spaces too ("3p" finds "3P%"). Null if none. */
export function resolveStat(profile: StatProfile, input: string): StatDef | null {
  const exact = input.trim().toLowerCase();
  if (!exact) return null;
  const loose = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const picks: ((s: StatDef) => string)[] = [(s) => s.key, (s) => s.short, (s) => s.label];
  for (const norm of [(t: string) => t.toLowerCase(), loose]) {
    const q = norm(exact);
    if (!q) continue;
    for (const pick of picks) {
      const hit = profile.stats.find((s) => norm(pick(s)) === q);
      if (hit) return hit;
    }
  }
  return null;
}

const direction = (def: StatDef) => (def.higherIsBetter ? "higher is better" : "lower is better");

/** The valid stats, for `--list` and for an unknown `--by`. */
export function renderStatList(profile: StatProfile): string {
  const keyW = Math.max(...profile.stats.map((s) => s.key.length)) + 2;
  const labelW = Math.max(...profile.stats.map((s) => s.label.length)) + 2;
  const rows = profile.stats.map((s) => `  ${c.green(pad(s.short, 7))}${pad(s.label, labelW)}${c.dim(pad(s.key, keyW))}${direction(s)}`);
  return [c.dim(`  ${pad("SHORT", 7)}${pad("STAT", labelW)}${pad("KEY", keyW)}BETTER`), ...rows].join("\n");
}

export function statListJson(league: { sport: string; label: string; profile: StatProfile }) {
  return { sport: league.sport, label: league.label, stats: league.profile.stats.map(statJson) };
}

const statJson = (s: StatDef) => ({ key: s.key, label: s.label, short: s.short, higherIsBetter: s.higherIsBetter, format: s.format });

// ── Form derivation ──────────────────────────────────────────────────────────

export interface Record3 {
  w: number;
  d: number;
  l: number;
  otl: number;
}

const emptyRecord = (): Record3 => ({ w: 0, d: 0, l: 0, otl: 0 });

export function recordOf(results: TeamResult[]): Record3 {
  const r = emptyRecord();
  for (const x of results) {
    if (x.outcome === "W") r.w++;
    else if (x.outcome === "D") r.d++;
    else if (x.outcome === "OTL") r.otl++;
    else r.l++;
  }
  return r;
}

/** "W-D-L" (soccer), "W-L" (NBA), "W-L-OTL" (NHL). */
export function recordText(r: Record3, form: StatProfile["form"]): string {
  switch (form) {
    case "wdl":
      return `${r.w}-${r.d}-${r.l}`;
    case "wl":
      return `${r.w}-${r.l}`;
    case "wl-otl":
      return `${r.w}-${r.l}-${r.otl}`;
  }
}

export interface FormRow {
  teamId: string;
  abbreviation: string;
  name: string;
  played: number;
  /** Last results' letters, oldest first. */
  form: Outcome[];
  /** Soccer: league points (3/1/0); NHL: standings points (2/1/0); NBA: null. */
  points: number | null;
  /** Soccer points per game; null elsewhere or with no games. */
  ppg: number | null;
  /** Wins ÷ games, 0..1 (NBA/NHL); null for soccer or with no games. */
  winPct: number | null;
  overall: Record3;
  home: Record3;
  away: Record3;
  scoredPerGame: number | null;
  concededPerGame: number | null;
  /** Soccer only: games conceding none / scoring none; null elsewhere. */
  cleanSheets: number | null;
  failedToScore: number | null;
}

/** Derive a team's form-table row from its results. */
export function formRow(line: TeamStatLine, form: StatProfile["form"]): FormRow {
  const rs = line.results;
  const played = rs.length;
  const overall = recordOf(rs);
  const soccer = form === "wdl";
  const points = soccer ? overall.w * 3 + overall.d : form === "wl-otl" ? overall.w * 2 + overall.otl : null;
  const per = (n: number) => (played > 0 ? n / played : null);
  return {
    teamId: line.teamId,
    abbreviation: line.abbreviation,
    name: line.name,
    played,
    form: line.form.map((r) => r.outcome),
    points,
    ppg: soccer && points !== null ? per(points) : null,
    winPct: soccer ? null : per(overall.w),
    overall,
    home: recordOf(rs.filter((r) => r.home)),
    away: recordOf(rs.filter((r) => !r.home)),
    scoredPerGame: per(rs.reduce((n, r) => n + r.scored, 0)),
    concededPerGame: per(rs.reduce((n, r) => n + r.conceded, 0)),
    cleanSheets: soccer ? rs.filter((r) => r.conceded === 0).length : null,
    failedToScore: soccer ? rs.filter((r) => r.scored === 0).length : null,
  };
}

/** Table order: soccer by points, then goal difference, then goals for; NHL by
 *  points then wins; NBA by win%; teams with no games last. Ties by name. */
export function formRows(stats: LeagueStats): FormRow[] {
  const form = stats.profile.form;
  const rows = stats.teams.map((t) => formRow(t, form));
  const gd = (r: FormRow) => ((r.scoredPerGame ?? 0) - (r.concededPerGame ?? 0)) * r.played;
  const gf = (r: FormRow) => (r.scoredPerGame ?? 0) * r.played;
  return rows.sort((a, b) => {
    if ((a.played === 0) !== (b.played === 0)) return a.played === 0 ? 1 : -1;
    const d =
      form === "wdl"
        ? (b.points ?? 0) - (a.points ?? 0) || gd(b) - gd(a) || gf(b) - gf(a)
        : form === "wl-otl"
          ? (b.points ?? 0) - (a.points ?? 0) || b.overall.w - a.overall.w
          : (b.winPct ?? 0) - (a.winPct ?? 0);
    return d || a.name.localeCompare(b.name);
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

const LETTER_COLOR: Record<Outcome, (s: string) => string> = { W: c.green, D: c.yellow, L: c.red, OTL: c.magenta };

/** Colored result letters, oldest first. */
export function formatForm(form: Outcome[]): string {
  return form.map((o) => LETTER_COLOR[o](o)).join(" ");
}

const avg = (v: number | null, digits = 2) => (v === null ? "—" : v.toFixed(digits));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** The season banner lines shared by every view: the season shown and, when it
 *  is last season's, a note saying so (as `standings` does). */
export function seasonNotice(stats: LeagueStats): string | null {
  if (stats.kind !== "last-season") return null;
  const upcoming = stats.upcoming ? `The ${stats.upcoming} regular season` : "The regular season";
  return c.yellow(`${upcoming} hasn't started — showing last season's stats.`);
}

export const NOT_STARTED = "The regular season hasn't started yet, and ESPN has no earlier stats to show.";

/** Title suffix: "2025-26" plus "(final)" for last season. */
export function seasonSuffix(stats: LeagueStats): string {
  return `${stats.seasonName}${stats.kind === "last-season" ? " (final)" : ""}`.trim();
}

const TEAM_W = 24;

/** The form table. Favorites (by team id) get ★ and are bolded. */
export function renderFormTable(stats: LeagueStats, favoriteIds: ReadonlySet<string>): string {
  const form = stats.profile.form;
  const soccer = form === "wdl";
  const formW = form === "wl-otl" ? 20 : 10;
  const rate = soccer ? "PPG" : "W%";
  const cols = [
    pad("#", 3),
    pad("  Team", TEAM_W),
    pad("P", 4, "right"),
    "  " + pad("Last 5", formW),
    ...(form === "wl-otl" ? [pad("PTS", 5, "right")] : []),
    pad(rate, 7, "right"),
    pad("Home", 10, "right"),
    pad("Away", 10, "right"),
    pad("GF/g", 8, "right"),
    pad("GA/g", 8, "right"),
    ...(soccer ? [pad("CS", 4, "right"), pad("FTS", 5, "right")] : []),
  ];
  const lines = formRows(stats).map((r, i) => {
    const fav = favoriteIds.has(r.teamId);
    const name = fav ? c.bold(c.yellow(`★ ${r.name}`)) : `  ${r.name}`;
    const cells = [
      pad(String(r.played), 4, "right"),
      "  " + pad(formatForm(r.form), formW),
      ...(form === "wl-otl" ? [pad(String(r.points ?? "—"), 5, "right")] : []),
      pad(soccer ? avg(r.ppg) : pct(r.winPct), 7, "right"),
      pad(recordText(r.home, form), 10, "right"),
      pad(recordText(r.away, form), 10, "right"),
      pad(avg(r.scoredPerGame), 8, "right"),
      pad(avg(r.concededPerGame), 8, "right"),
      ...(soccer ? [pad(String(r.cleanSheets ?? "—"), 4, "right"), pad(String(r.failedToScore ?? "—"), 5, "right")] : []),
    ].join("");
    return pad(c.dim(String(i + 1)), 3) + pad(name, TEAM_W) + (fav ? c.bold(cells) : cells);
  });
  const legend = soccer
    ? "P played · Last 5 oldest → newest · PPG points per game · Home/Away W-D-L · GF/GA goals per game · CS clean sheets · FTS failed to score"
    : form === "wl-otl"
      ? "P played · Last 5 oldest → newest · PTS points (2 per win, 1 per OTL) · W% win rate · Home/Away W-L-OTL · GF/GA goals per game"
      : "P played · Last 5 oldest → newest · W% win rate · Home/Away W-L · GF/GA points per game";
  return [c.dim(cols.join("")), ...lines, "", c.dim(legend)].join("\n");
}

export function formJson(stats: LeagueStats, favoriteIds: ReadonlySet<string>) {
  const form = stats.profile.form;
  const rec = (r: Record3) => ({ ...r, text: recordText(r, form) });
  return {
    ...header(stats),
    teams: formRows(stats).map((r, i) => ({
      position: i + 1,
      teamId: r.teamId,
      abbreviation: r.abbreviation,
      name: r.name,
      favorite: favoriteIds.has(r.teamId),
      played: r.played,
      form: r.form,
      points: r.points,
      pointsPerGame: r.ppg,
      winPct: r.winPct,
      overall: rec(r.overall),
      home: rec(r.home),
      away: rec(r.away),
      scoredPerGame: r.scoredPerGame,
      concededPerGame: r.concededPerGame,
      cleanSheets: r.cleanSheets,
      failedToScore: r.failedToScore,
    })),
  };
}

const header = (stats: LeagueStats) => ({
  sport: stats.sport,
  label: stats.label,
  kind: stats.kind,
  season: stats.season,
  seasonName: stats.seasonName,
});

/** The `--by` ranking: rank, team, value, matches played. Ties share a rank. */
export function renderRanking(stats: LeagueStats, def: StatDef, favoriteIds: ReadonlySet<string>): string {
  const rows = rankBy(stats, def.key);
  const head = c.dim(pad("#", 4) + pad("  Team", TEAM_W) + pad(def.short, 9, "right") + pad("P", 5, "right"));
  const lines = rows.map(({ rank, team, value }) => {
    const fav = favoriteIds.has(team.teamId);
    const name = fav ? c.bold(c.yellow(`★ ${team.name}`)) : `  ${team.name}`;
    const cells = pad(formatStat(def, value), 9, "right") + pad(String(team.played), 5, "right");
    return pad(c.dim(String(rank)), 4) + pad(name, TEAM_W) + (fav ? c.bold(cells) : cells);
  });
  return [head, ...lines, "", c.dim(`${def.label}: ${direction(def)}. P = matches the figure covers.`)].join("\n");
}

export function rankingJson(stats: LeagueStats, def: StatDef, favoriteIds: ReadonlySet<string>) {
  return {
    ...header(stats),
    stat: statJson(def),
    teams: rankBy(stats, def.key).map(({ rank, team, value }) => ({
      rank,
      teamId: team.teamId,
      abbreviation: team.abbreviation,
      name: team.name,
      favorite: favoriteIds.has(team.teamId),
      value,
      formatted: formatStat(def, value),
      played: team.played,
    })),
  };
}
