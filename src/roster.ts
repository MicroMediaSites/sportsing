// The `roster` view for every league (and FIFA): argument parsing, the
// --pos / --by transforms and the text rendering. Pure — it takes the Squad the
// engine (src/squad.ts) loaded — so it is unit-tested against recorded
// payloads. The command wiring (team resolution, favorites) lives in
// src/commands/roster.ts.

import { c, pad } from "./ansi.ts";
import { renderStatList, resolveStat } from "./stats-views.ts";
import {
  formatPlayerStat,
  sortPlayersBy,
  statDefsFor,
  type Player,
  type PlayerStatDef,
  type PlayerStatProfile,
  type Squad,
  type SquadSeason,
} from "./squad.ts";

// ── Arguments ────────────────────────────────────────────────────────────────

export interface RosterRequest {
  /** The team the user named (positional words or `--team`); null = favorites. */
  team: string | null;
  /** `--pos X`, as typed. */
  pos: string | null;
  /** `--by <stat>`, as typed (implies stats). */
  by: string | null;
  stats: boolean;
  json: boolean;
}

/** Parse `roster` arguments. Bare words are the team ("Utah Jazz"); `--team X`
 *  is the same; `--by` takes the words up to the next flag (labels have
 *  spaces). Throws a usage message on anything unknown. */
export function parseRosterArgs(args: string[]): RosterRequest {
  const words: string[] = [];
  let teamFlag: string | null = null;
  let pos: string | null = null;
  let by: string | null = null;
  let stats = false;
  let json = false;
  const value = (flag: string, i: number): string => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`Flag ${flag} requires a value.`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--stats") stats = true;
    else if (a === "--team") teamFlag = value(a, i++);
    else if (a === "--pos") pos = value(a, i++);
    else if (a === "--by") {
      const parts: string[] = [];
      while (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) parts.push(args[++i]!);
      if (parts.length === 0) throw new Error("Flag --by requires a stat (it lists them when it doesn't know one).");
      by = parts.join(" ");
    } else if (a.startsWith("--")) throw new Error(`Unknown option ${a}.`);
    else words.push(a);
  }
  const positional = words.join(" ").trim();
  if (teamFlag !== null && positional) throw new Error("Name the team once: either as an argument or with --team.");
  return { team: teamFlag ?? (positional || null), pos, by, stats: stats || by !== null, json };
}

// ── --pos / --by ─────────────────────────────────────────────────────────────

/** The position group a `--pos` input names (case-insensitive key); null if none. */
export function resolvePosGroup(profile: PlayerStatProfile, input: string) {
  const q = input.trim().toLowerCase();
  return profile.positionGroups.find((g) => g.key.toLowerCase() === q) ?? null;
}

/** Error text for an unknown `--pos`, listing the valid group keys. */
export function posHelp(label: string, profile: PlayerStatProfile, input: string): string {
  const keys = profile.positionGroups.map((g) => `${g.key} (${g.label.toLowerCase()})`).join(", ");
  return `Unknown ${label} position "${input}". Valid positions: ${keys}.`;
}

/** A player stat `--by` can rank: the default line's, else the goalie line's.
 *  Key, short label or full label, case-insensitive. */
export function resolvePlayerStat(profile: PlayerStatProfile, input: string): PlayerStatDef | null {
  return resolveStat(profile, input) ?? (profile.goalie ? resolveStat({ stats: profile.goalie.stats }, input) : null);
}

/** Every stat `--by` accepts, as a table (goalie stats under their own heading). */
export function renderPlayerStatOptions(profile: PlayerStatProfile): string {
  const out = [renderStatList(profile)];
  if (profile.goalie) {
    const only = profile.goalie.stats.filter((d) => !profile.stats.some((s) => s.key === d.key));
    const group = profile.positionGroups.find((g) => g.key === profile.goalie!.group);
    if (only.length > 0) out.push("", c.dim(`  ${group?.label ?? profile.goalie.group} only (ranks just them):`), renderStatList({ stats: only }));
  }
  return out.join("\n");
}

/** The players a ranking by `def` covers: those whose stat line has that stat
 *  (a goalie-only stat ranks only the goalies, a skater stat skips them). */
function rankable(players: Player[], profile: PlayerStatProfile, def: PlayerStatDef): Player[] {
  return players.filter((p) => statDefsFor(profile, p).some((d) => d.key === def.key));
}

export interface RosterView {
  /** Squad with `players` filtered by `--pos` and, with `--by`, ranked best first. */
  squad: Squad;
  /** The stat ranked by, when `--by` was given. */
  by: PlayerStatDef | null;
}

/** Apply `--pos` and `--by` to a squad. Throws on an unknown position or stat
 *  (the message lists the valid ones). */
export function applyRosterView(squad: Squad, req: Pick<RosterRequest, "pos" | "by">): RosterView {
  let players = squad.players;
  if (req.pos !== null) {
    const group = resolvePosGroup(squad.profile, req.pos);
    if (!group) throw new Error(posHelp(squad.label, squad.profile, req.pos));
    players = players.filter((p) => p.positionGroup === group.key);
  }
  let by: PlayerStatDef | null = null;
  if (req.by !== null) {
    by = resolvePlayerStat(squad.profile, req.by);
    if (!by) throw new Error(`Unknown ${squad.label} stat "${req.by}". Valid stats:\n${renderPlayerStatOptions(squad.profile)}`);
    players = sortPlayersBy(rankable(players, squad.profile, by), by);
  }
  return { squad: { ...squad, players }, by };
}

/** The `--json` document: the Squad as displayed (filtered/sorted), plus what
 *  was asked for. */
export function rosterJson(view: RosterView, req: Pick<RosterRequest, "pos">) {
  return { ...view.squad, view: { pos: req.pos ? resolvePosGroup(view.squad.profile, req.pos)?.key ?? req.pos : null, by: view.by?.key ?? null } };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The stats header lines: which season the figures are from. Empty without stats. */
export function seasonLines(season: SquadSeason | null, fifa = false): string[] {
  if (!season) return [];
  const name = season.seasonName;
  if (season.kind === "current") return [c.dim(`Stats: ${name || (season.season ?? "this season")}${fifa ? "" : " season"}`)];
  const upcoming = season.upcoming ? `The ${season.upcoming} season` : "The season";
  if (season.kind === "last-season") {
    return [c.yellow(`${upcoming} hasn't started — showing last season's stats${name ? ` (${name})` : ""}.`)];
  }
  return [c.yellow(`${upcoming} hasn't started and ESPN has no earlier figures — no stats yet.`)];
}

interface Col {
  head: string;
  right: boolean;
  cell: (p: Player, i: number) => string;
}

const statText = (p: Player, d: PlayerStatDef) => formatPlayerStat(d, p.stats?.[d.key]);

/** Injury text (red) when present; a non-Active roster status (dim) otherwise. */
export function statusText(p: Player): string {
  if (p.injury) return c.red(p.injury);
  return p.status && !/^active$/i.test(p.status) ? c.dim(p.status) : "";
}

function renderTable(cols: Col[], players: Player[], widths: number[]): string[] {
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 && !cols[i]!.right ? cell : pad(cell, widths[i]!, cols[i]!.right ? "right" : "left")))
      .join("  ")
      .trimEnd();
  return players.map((p, i) => "  " + line(cols.map((col) => col.cell(p, i))));
}

const widthsOf = (cols: Col[], players: Player[]) =>
  cols.map((col) => Math.max(col.head.length, ...players.map((p, i) => visibleWidth(col.cell(p, i)))));

const visibleWidth = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/**
 * The roster as text. Players are grouped under their position group (profile
 * order); with stats each group also shows its stat columns — goalies get
 * their own header — and with `by` the grouping is dropped for one ranked list
 * (rank, then the ranked stat beside the first stat, GP/appearances).
 */
export function renderRoster(view: RosterView, opts: { stats: boolean } = { stats: false }): string {
  const { squad, by } = view;
  const { profile, players } = squad;
  if (players.length === 0) return c.dim("  No players.");
  const hasStatus = players.some((p) => statusText(p) !== "");
  const base: Col[] = [
    { head: "#", right: true, cell: (p) => p.jersey ?? "" },
    { head: "NAME", right: false, cell: (p) => p.name },
    { head: "POS", right: false, cell: (p) => p.position },
    { head: "AGE", right: true, cell: (p) => (p.age === null ? "" : String(p.age)) },
    { head: "NATIONALITY", right: false, cell: (p) => p.nationality ?? "" },
  ];
  const status: Col[] = hasStatus ? [{ head: "STATUS", right: false, cell: (p) => statusText(p) }] : [];
  const statCols = (defs: PlayerStatDef[]): Col[] => defs.map((d) => ({ head: d.short, right: true, cell: (p) => statText(p, d) }));
  const header = (cols: Col[], widths: number[]) =>
    c.dim("  " + cols.map((col, i) => (i === cols.length - 1 && !col.right ? col.head : pad(col.head, widths[i]!, col.right ? "right" : "left"))).join("  "));

  if (by) {
    const lead = profile.stats[0]!;
    const defs = lead.key === by.key ? [by] : [lead, by];
    const cols: Col[] = [{ head: "RK", right: true, cell: (_p, i) => String(i + 1) }, ...base, ...statCols(defs), ...status];
    const widths = widthsOf(cols, players);
    return [header(cols, widths), ...renderTable(cols, players, widths)].join("\n");
  }

  // Groups in profile order (squad.players is already in that order); players
  // in a group the profile doesn't know keep their own heading.
  const groups: { key: string; label: string; players: Player[] }[] = [];
  for (const p of players) {
    let g = groups.find((x) => x.key === p.positionGroup);
    if (!g) {
      const known = profile.positionGroups.find((x) => x.key === p.positionGroup);
      g = { key: p.positionGroup, label: known?.label ?? p.positionGroup, players: [] };
      groups.push(g);
    }
    g.players.push(p);
  }
  // One set of widths for the base columns across groups, so they line up.
  const baseWidths = widthsOf([...base, ...status], players);
  const out: string[] = [];
  let prevSig: string | null = null;
  for (const g of groups) {
    const defs = opts.stats ? statDefsFor(profile, g.players[0]!) : [];
    const cols = [...base, ...statCols(defs), ...status];
    // Stat columns get widths from their own group; the base columns share.
    const statWidths = widthsOf(statCols(defs), g.players);
    const widths = [...baseWidths.slice(0, base.length), ...statWidths, ...baseWidths.slice(base.length)];
    out.push("", c.bold(`${g.label} (${g.players.length})`));
    const sig = defs.map((d) => d.key).join(",");
    if (sig !== prevSig) out.push(header(cols, widths));
    prevSig = sig;
    out.push(...renderTable(cols, g.players, widths));
  }
  return out.slice(1).join("\n");
}
